/**
 * Crash-safe JSON files (NB-82, PRD 9 reliability).
 *
 * writeJsonAtomic: write <path>.tmp; move <path> -> <path>.bak (if it exists); move <path>.tmp -> <path>.
 * A crash at any step leaves the old value (main or .bak) or the new value (.tmp) readable.
 *
 * readJsonRecovering: parses main, .tmp and .bak; a candidate is valid when it parses, ends with the
 * '$': 'end' sentinel and the reader accepts it (after migrate()). The highest valid rev wins (ties:
 * main, then tmp, then bak). It NEVER touches the disk unless o.repair is true AND nothing it read is
 * readOnly (a newer format). Repair moves damaged candidates to <quarantineDir>/<base>.<epoch>.json,
 * rewrites main from the winner, and removes a stale valid .tmp. When nothing is valid, repair only
 * COPIES the damaged files into quarantine (the originals stay, so the error is reported again and a
 * later save cannot destroy the only copy).
 *
 * Only the owner of the files (the open session, library ops) passes repair: true. Pack, backup
 * snapshots, duplicate, thumbnails and usage pass repair: false.
 */
import { migrate } from '../model/migrate.ts';
import { isRecord } from '../model/readers.ts';
import { baseName, joinPath } from './adapter.ts';
import type { FsAdapter } from './adapter.ts';

export type ReadSource = 'main' | 'tmp' | 'bak';

export type ReadResult<T> =
  | { ok: true; value: T; source: ReadSource; repaired: boolean; readOnly: boolean }
  | { ok: false; reason: 'missing' | 'unreadable'; quarantined: string[] };

export const TMP_SUFFIX = '.tmp';
export const BAK_SUFFIX = '.bak';

export const tmpPath = (path: string): string => path + TMP_SUFFIX;
export const bakPath = (path: string): string => path + BAK_SUFFIX;

/** JSON text of an envelope with the '$': 'end' sentinel as the LAST key. */
export function serializeEnvelope(value: object): string {
  const rest: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  delete rest.$;
  return JSON.stringify({ ...rest, $: 'end' });
}

/** The tmp -> bak -> main write sequence for text that is already serialized. */
export async function writeTextAtomic(fs: FsAdapter, path: string, text: string): Promise<void> {
  const tmp = tmpPath(path);
  await fs.writeText(tmp, text);
  if (await fs.exists(path)) await fs.move(path, bakPath(path));
  await fs.move(tmp, path);
}

export async function writeJsonAtomic(fs: FsAdapter, path: string, value: { rev: number }): Promise<void> {
  await writeTextAtomic(fs, path, serializeEnvelope(value));
}

/** 'notebook.json' -> 'notebook', 'p1.json.tmp' -> 'p1.tmp', 'library.json.bak' -> 'library.bak'. */
function quarantineBase(path: string): string {
  return baseName(path).replace(/\.json(?=$|\.)/, '');
}

async function freeQuarantinePath(fs: FsAdapter, dir: string, base: string, epoch: number): Promise<string> {
  let p = joinPath(dir, `${base}.${epoch}.json`);
  for (let i = 1; (await fs.exists(p)) && i < 1000; i++) p = joinPath(dir, `${base}.${epoch}-${i}.json`);
  return p;
}

/** True when the quarantine folder already holds a file with exactly this text for this base name. */
async function alreadyQuarantined(fs: FsAdapter, dir: string, base: string, text: string): Promise<boolean> {
  const entries = await fs.list(dir);
  for (const e of entries) {
    if (e.isDir || !e.name.startsWith(`${base}.`) || !e.name.endsWith('.json')) continue;
    const other = await fs.readText(joinPath(dir, e.name));
    if (other === text) return true;
  }
  return false;
}

interface Candidate<T> {
  source: ReadSource;
  path: string;
  text: string | null;
  value: T | null;
  readOnly: boolean;
}

function parseCandidate<T extends { rev: number }>(text: string, read: (raw: unknown) => T | null): { value: T; readOnly: boolean } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.$ !== 'end') return null;
  try {
    const m = migrate(raw);
    const value = read(m.raw);
    if (!value || typeof value.rev !== 'number' || !Number.isFinite(value.rev)) return null;
    return { value, readOnly: m.readOnly };
  } catch {
    return null;
  }
}

export async function readJsonRecovering<T extends { rev: number }>(
  fs: FsAdapter,
  path: string,
  read: (raw: unknown) => T | null,
  quarantineDir: string,
  o: { repair: boolean; now?: () => number },
): Promise<ReadResult<T>> {
  const sources: [ReadSource, string][] = [
    ['main', path],
    ['tmp', tmpPath(path)],
    ['bak', bakPath(path)],
  ];
  const cands: Candidate<T>[] = [];
  for (const [source, p] of sources) {
    let text: string | null = null;
    try {
      text = await fs.readText(p);
    } catch {
      // An unreadable file (I/O error) counts as damaged, never as missing.
      text = '';
    }
    const parsed = text === null ? null : parseCandidate(text, read);
    cands.push({ source, path: p, text, value: parsed ? parsed.value : null, readOnly: parsed ? parsed.readOnly : false });
  }

  let win: Candidate<T> | null = null;
  for (const c of cands) if (c.value && (!win || c.value.rev > (win.value as T).rev)) win = c;

  const damaged = cands.filter((c) => c.text !== null && c.value === null);
  const anyReadOnly = cands.some((c) => c.value !== null && c.readOnly);
  const epoch = () => Math.floor((o.now ?? Date.now)());

  if (!win) {
    if (damaged.length === 0) return { ok: false, reason: 'missing', quarantined: [] };
    const quarantined: string[] = [];
    if (o.repair && !anyReadOnly) {
      try {
        await fs.mkdirp(quarantineDir);
        for (const c of damaged) {
          // Each copy is best effort on its own: one failure does not skip the other files.
          try {
            const base = quarantineBase(c.path);
            if (c.text && (await alreadyQuarantined(fs, quarantineDir, base, c.text))) continue;
            const dest = await freeQuarantinePath(fs, quarantineDir, base, epoch());
            await fs.copy(c.path, dest);
            quarantined.push(dest);
          } catch {
            // The original stays where it is.
          }
        }
      } catch {
        // Keeping a copy aside is best effort; the originals are untouched either way.
      }
    }
    return { ok: false, reason: 'unreadable', quarantined };
  }

  const value = win.value as T;
  if (!o.repair || anyReadOnly) {
    return { ok: true, value, source: win.source, repaired: false, readOnly: win.readOnly };
  }

  // Repair is best effort: a failure here never hides the value that was read. Every step leaves a
  // state that the next read recovers from (the winner stays on disk until main holds it).
  let repaired = false;
  try {
    if (damaged.length) {
      await fs.mkdirp(quarantineDir);
      for (const c of damaged) {
        const dest = await freeQuarantinePath(fs, quarantineDir, quarantineBase(c.path), epoch());
        await fs.move(c.path, dest);
        repaired = true;
      }
    }
    if (win.source === 'tmp') {
      // Finish the interrupted write by renaming only: rewriting .tmp could tear the only new copy.
      if (await fs.exists(path)) await fs.move(path, bakPath(path));
      await fs.move(win.path, path);
      repaired = true;
    } else if (win.source === 'bak') {
      // .tmp is fully written before main is replaced, so .bak (the winner) survives any crash here.
      await writeTextAtomic(fs, path, win.text as string);
      repaired = true;
    } else {
      const tmp = cands[1];
      if (tmp.value !== null && tmp.value.rev <= value.rev) {
        await fs.remove(tmp.path);
        repaired = true;
      }
    }
  } catch {
    // Left for the next owner read to finish.
  }
  return { ok: true, value, source: win.source, repaired, readOnly: false };
}
