/**
 * In-memory FsAdapter for notebook core tests.
 *
 * - Posix paths ('/root/a/b'). Directories are explicit: writing a file needs its parent directory
 *   (like the device), unless created with { strictDirs: false }.
 * - failAfter(n): the next n mutations succeed, then every mutation throws (a crash) until
 *   failAfter(null). With { torn: true } the crashing writeText/appendBytes first writes half its data.
 * - snapshot() / restore(): a deep copy of the whole disk.
 * - log: every mutation that RAN (crashed calls are not logged), for "never mutates" assertions.
 * - delay: an optional per-call delay (ms, or a function of the op) so concurrency can be tested.
 */
import { joinPath } from '../../../src/notebook/core/fs/adapter.ts';
import type { FsAdapter, FsEntry } from '../../../src/notebook/core/fs/adapter.ts';

export type MemOp = 'writeText' | 'appendBytes' | 'move' | 'copy' | 'remove' | 'mkdirp';
export type ReadOp = 'readText' | 'readBytes' | 'exists' | 'list' | 'size';

export interface MemLogEntry {
  op: MemOp;
  path: string;
  to?: string;
}

export interface MemSnapshot {
  files: Record<string, Uint8Array>;
  dirs: string[];
}

export interface MemFs extends FsAdapter {
  readonly log: MemLogEntry[];
  clearLog(): void;
  /** n successful mutations, then every mutation crashes. null turns crashing off. */
  failAfter(n: number | null, o?: { torn?: boolean }): void;
  /** True once a mutation crashed since the last failAfter(). */
  readonly crashed: boolean;
  snapshot(): MemSnapshot;
  restore(s: MemSnapshot): void;
  /** Text of every file, for readable assertions. */
  dump(): Record<string, string>;
  setDelay(d: number | ((op: MemOp | ReadOp, path: string) => number) | null): void;
  /** Synchronous helpers for test setup (not logged, never crash). */
  putText(p: string, t: string): void;
  getText(p: string): string | null;
  hasDir(p: string): boolean;
}

export class CrashError extends Error {
  constructor(op: string, path: string) {
    super(`memfs: injected crash during ${op} ${path}`);
    this.name = 'CrashError';
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function norm(p: string): string {
  if (!p) return '/';
  let s = p.replace(/\/+/g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.length > 1) s = s.replace(/\/$/, '');
  return s;
}

function parent(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

const under = (p: string, dir: string): boolean => (dir === '/' ? p !== '/' : p.startsWith(`${dir}/`));

export function createMemFs(o?: { strictDirs?: boolean; dirs?: string[] }): MemFs {
  const strict = o?.strictDirs !== false;
  let files = new Map<string, Uint8Array>();
  let dirs = new Set<string>(['/']);
  const log: MemLogEntry[] = [];
  let budget: number | null = null;
  let torn = false;
  let crashed = false;
  let delay: number | ((op: MemOp | ReadOp, path: string) => number) | null = null;

  const addDirs = (p: string) => {
    let d = norm(p);
    const chain: string[] = [];
    while (!dirs.has(d)) {
      chain.push(d);
      d = parent(d);
    }
    for (const c of chain) dirs.add(c);
  };
  for (const d of o?.dirs ?? []) addDirs(d);

  const wait = async (op: MemOp | ReadOp, path: string) => {
    const ms = typeof delay === 'function' ? delay(op, path) : delay;
    if (ms && ms > 0) await new Promise((r) => setTimeout(r, ms));
    else await Promise.resolve();
  };

  /** Throws when this mutation must crash; otherwise consumes one unit of the budget. */
  const gate = (): boolean => {
    if (budget === null) return false;
    if (budget <= 0) {
      crashed = true;
      return true;
    }
    budget--;
    return false;
  };

  const needParent = (p: string) => {
    if (strict && !dirs.has(parent(p))) throw new Error(`memfs: ENOENT parent directory of ${p}`);
    if (!strict) addDirs(parent(p));
    if (dirs.has(p)) throw new Error(`memfs: EISDIR ${p}`);
  };

  const removeTree = (p: string) => {
    files.delete(p);
    for (const k of [...files.keys()]) if (under(k, p)) files.delete(k);
    if (p !== '/') dirs.delete(p);
    for (const d of [...dirs]) if (under(d, p)) dirs.delete(d);
  };

  const copyTree = (from: string, to: string): number => {
    let bytes = 0;
    if (files.has(from)) {
      const data = files.get(from) as Uint8Array;
      files.set(to, data.slice());
      return data.length;
    }
    dirs.add(to);
    for (const d of [...dirs]) if (under(d, from)) dirs.add(to + d.slice(from.length));
    for (const [k, v] of [...files]) {
      if (under(k, from)) {
        files.set(to + k.slice(from.length), v.slice());
        bytes += v.length;
      }
    }
    return bytes;
  };

  const sizeOf = (p: string): number => {
    const f = files.get(p);
    if (f) return f.length;
    if (!dirs.has(p)) return 0;
    let n = 0;
    for (const [k, v] of files) if (under(k, p)) n += v.length;
    return n;
  };

  const fs: MemFs = {
    log,
    get crashed() {
      return crashed;
    },
    clearLog() {
      log.length = 0;
    },
    failAfter(n, opts) {
      budget = n === null ? null : Math.max(0, n);
      torn = opts?.torn === true;
      crashed = false;
    },
    snapshot() {
      const out: Record<string, Uint8Array> = {};
      for (const [k, v] of files) out[k] = v.slice();
      return { files: out, dirs: [...dirs].sort() };
    },
    restore(s) {
      files = new Map(Object.entries(s.files).map(([k, v]) => [k, v.slice()]));
      dirs = new Set(s.dirs);
      dirs.add('/');
    },
    dump() {
      const out: Record<string, string> = {};
      for (const k of [...files.keys()].sort()) out[k] = dec.decode(files.get(k));
      return out;
    },
    setDelay(d) {
      delay = d;
    },
    putText(p, t) {
      const n = norm(p);
      addDirs(parent(n));
      files.set(n, enc.encode(t));
    },
    getText(p) {
      const f = files.get(norm(p));
      return f ? dec.decode(f) : null;
    },
    hasDir(p) {
      return dirs.has(norm(p));
    },

    async readText(p) {
      const n = norm(p);
      await wait('readText', n);
      const f = files.get(n);
      return f ? dec.decode(f) : null;
    },
    async writeText(p, t) {
      const n = norm(p);
      await wait('writeText', n);
      needParent(n);
      const data = enc.encode(t);
      if (gate()) {
        if (torn) files.set(n, data.slice(0, Math.floor(data.length / 2)));
        throw new CrashError('writeText', n);
      }
      files.set(n, data);
      log.push({ op: 'writeText', path: n });
    },
    async readBytes(p, offset, length) {
      const n = norm(p);
      await wait('readBytes', n);
      const f = files.get(n);
      if (!f) throw new Error(`memfs: ENOENT ${n}`);
      const start = Math.max(0, offset);
      return f.slice(start, Math.min(f.length, start + Math.max(0, length)));
    },
    async appendBytes(p, b) {
      const n = norm(p);
      await wait('appendBytes', n);
      needParent(n);
      const prev = files.get(n) ?? new Uint8Array(0);
      const crash = gate();
      const add = crash ? (torn ? b.slice(0, Math.floor(b.length / 2)) : new Uint8Array(0)) : b;
      const next = new Uint8Array(prev.length + add.length);
      next.set(prev);
      next.set(add, prev.length);
      if (crash) {
        if (add.length) files.set(n, next);
        throw new CrashError('appendBytes', n);
      }
      files.set(n, next);
      log.push({ op: 'appendBytes', path: n });
    },
    async exists(p) {
      const n = norm(p);
      await wait('exists', n);
      return files.has(n) || dirs.has(n);
    },
    async move(from, to) {
      const f = norm(from);
      const t = norm(to);
      await wait('move', f);
      if (!files.has(f) && !dirs.has(f)) throw new Error(`memfs: ENOENT ${f}`);
      if (strict && !dirs.has(parent(t))) throw new Error(`memfs: ENOENT parent directory of ${t}`);
      if (gate()) throw new CrashError('move', f);
      if (f === t) return;
      if (!strict) addDirs(parent(t));
      removeTree(t);
      copyTree(f, t);
      removeTree(f);
      log.push({ op: 'move', path: f, to: t });
    },
    async copy(from, to, onBytes) {
      const f = norm(from);
      const t = norm(to);
      await wait('copy', f);
      if (!files.has(f) && !dirs.has(f)) throw new Error(`memfs: ENOENT ${f}`);
      if (strict && !dirs.has(parent(t))) throw new Error(`memfs: ENOENT parent directory of ${t}`);
      if (gate()) throw new CrashError('copy', f);
      if (!strict) addDirs(parent(t));
      if (f !== t) {
        removeTree(t);
        const n = copyTree(f, t);
        onBytes?.(n);
      }
      log.push({ op: 'copy', path: f, to: t });
    },
    async remove(p) {
      const n = norm(p);
      await wait('remove', n);
      if (!files.has(n) && !dirs.has(n)) return;
      if (gate()) throw new CrashError('remove', n);
      removeTree(n);
      log.push({ op: 'remove', path: n });
    },
    async mkdirp(p) {
      const n = norm(p);
      await wait('mkdirp', n);
      if (dirs.has(n)) return;
      if (files.has(n)) throw new Error(`memfs: EEXIST file ${n}`);
      if (gate()) throw new CrashError('mkdirp', n);
      addDirs(n);
      log.push({ op: 'mkdirp', path: n });
    },
    async list(dir) {
      const n = norm(dir);
      await wait('list', n);
      if (!dirs.has(n)) return [];
      const out: FsEntry[] = [];
      for (const d of dirs) if (d !== n && parent(d) === n) out.push({ name: d.slice(d.lastIndexOf('/') + 1), isDir: true, size: 0 });
      for (const [k, v] of files) if (parent(k) === n) out.push({ name: k.slice(k.lastIndexOf('/') + 1), isDir: false, size: v.length });
      return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },
    async size(p) {
      const n = norm(p);
      await wait('size', n);
      return sizeOf(n);
    },
    join(...parts) {
      return joinPath(...parts);
    },
  };
  return fs;
}
