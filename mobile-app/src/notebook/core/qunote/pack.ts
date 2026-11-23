/**
 * packNotebook: writes one notebook folder as a .qunote archive (NB-72, NB-74).
 *
 * Reading:
 * - notebook.json and every page go through readJsonRecovering with repair:false (the highest valid
 *   rev of main/.tmp/.bak; the source is never written). A missing or unreadable page is left out:
 *   the receiver reads it as a blank page, as this device does.
 * - An OPEN notebook must be packed under its session's write lock: the glue passes
 *   lock = (fn) => session.withWriteLock(fn) (which flushes first), so no save lands while files are
 *   read. A closed notebook needs no lock.
 * - A notebook saved by a newer app version (readOnly) is refused ('read-only').
 *
 * What goes in: forExport() (remap.ts). Without recordings it is a filtered copy: no audio files,
 * no recordings, and the recording marks are stripped from the items (re-serialized pages).
 *
 * Two passes, because qunote.json comes first but lists every file's CRC-32 and size:
 *   1. plan: serialize the JSON entries (kept in memory up to 32 MiB, otherwise rebuilt in pass 2),
 *      stream each binary once for its CRC-32, and snapshot the cover into memory;
 *   2. write: qunote.json, notebook.json, pages, assets, audio, thumbs/cover.png. Each written entry
 *      is checked against pass 1 ('changed' when a file moved under us).
 * The output file is removed first and again on failure.
 */
import { strToU8 } from 'fflate';

import { joinPath } from '../fs/adapter.ts';
import type { FsAdapter } from '../fs/adapter.ts';
import { readJsonRecovering, serializeEnvelope } from '../fs/journal.ts';
import { safeExt } from '../fs/layout.ts';
import { makeNotebookFile, notebookOf, readNotebookFile, readPageFile } from '../model/index.ts';
import type { Asset, Id, Notebook, PageFile } from '../model/index.ts';
import { crc32 } from './crc32.ts';
import { COVER_PATH, MANIFEST_PATH, NOTEBOOK_PATH, QunoteError, buildManifest, validateEntryPath } from './manifest.ts';
import type { QunoteFileEntry, QunoteManifest } from './manifest.ts';
import { forExport, keptRecordingIds, stripMarks } from './remap.ts';
import { ZIP_CHUNK, fileSource } from './zipRead.ts';
import { ZIP32_LIMIT, ZipWriteError, createZipWriter, fileSink } from './zipWrite.ts';

export interface PackOptions {
  includeRecordings: boolean;
  /** Written into notebook.json and qunote.json ("app"). */
  appVersion: string;
  now(): number;
  /** Bytes processed over both passes, out of total (about twice the content size). */
  onProgress?(done: number, total: number): void;
  chunkSize?: number;
}

/** Runs fn while nothing else writes the notebook (session.withWriteLock for an open one). */
export type PackLock = <T>(fn: () => Promise<T>) => Promise<T>;

export interface PackResult {
  /** Size of the written archive. */
  bytes: number;
  manifest: QunoteManifest;
}

const JSON_CACHE_LIMIT = 32 * 1024 * 1024;
/**
 * The cover is snapshotted into memory in pass 1: the thumbnail worker rewrites thumbs/cover.png on
 * its own schedule (not through the write queue), so reading it twice could fail the export.
 */
const COVER_MEMORY_LIMIT = 8 * 1024 * 1024;

/** An entry written from memory: the JSON entries (deflated) and the cover snapshot (stored). */
interface JsonPlan {
  kind: 'json';
  path: string;
  bytes: number;
  crc32: number;
  /** Cached bytes, or null to rebuild them in pass 2. */
  data: Uint8Array | null;
  build(): Promise<Uint8Array>;
  deflate: boolean;
}

interface FilePlan {
  kind: 'file';
  path: string;
  abs: string;
  bytes: number;
  crc32: number;
}

type Plan = JsonPlan | FilePlan;

const folderOf = (a: Asset): string => (a.kind === 'audio' ? 'audio' : 'assets');

function mapError(e: unknown): unknown {
  if (e instanceof ZipWriteError) {
    if (e.code === 'too-large') return new QunoteError('too-large', e.message);
    if (e.code === 'source-changed') return new QunoteError('changed', e.message);
  }
  return e;
}

export async function packNotebook(fs: FsAdapter, nbDir: string, outPath: string, o: PackOptions, lock?: PackLock): Promise<PackResult> {
  const run = () => packUnlocked(fs, nbDir, outPath, o);
  try {
    return await (lock ? lock(run) : run());
  } catch (e) {
    try {
      await fs.remove(outPath);
    } catch {
      // Best effort: the cache is cleaned by the system anyway.
    }
    throw mapError(e);
  }
}

async function packUnlocked(fs: FsAdapter, nbDir: string, outPath: string, o: PackOptions): Promise<PackResult> {
  const chunk = Math.max(1, o.chunkSize ?? ZIP_CHUNK);
  const quarantine = joinPath(nbDir, 'quarantine');
  const exportedAt = new Date(o.now()).toISOString();

  // ----- notebook.json
  const nr = await readJsonRecovering(fs, joinPath(nbDir, NOTEBOOK_PATH), readNotebookFile, quarantine, { repair: false });
  if (!nr.ok) throw new QunoteError(nr.reason === 'missing' ? 'missing' : 'unreadable');
  if (nr.readOnly) throw new QunoteError('read-only');
  const source: Notebook = notebookOf(nr.value);
  const nb = forExport(source, o.includeRecordings);
  const kept = keptRecordingIds(nb);

  // ----- pass 1: plan every entry with its size and CRC-32
  const plans: Plan[] = [];
  let cached = 0;

  const notebookBytes = strToU8(serializeEnvelope(makeNotebookFile(nb, { rev: nr.value.rev, savedAt: nr.value.savedAt, app: o.appVersion })));
  plans.push({ kind: 'json', path: NOTEBOOK_PATH, bytes: notebookBytes.length, crc32: crc32(notebookBytes), data: notebookBytes, build: async () => notebookBytes, deflate: true });

  const pageText = async (pid: Id): Promise<Uint8Array | null> => {
    const r = await readJsonRecovering(fs, joinPath(nbDir, 'pages', `${pid}.json`), readPageFile, quarantine, { repair: false });
    if (!r.ok) return null;
    if (r.readOnly) throw new QunoteError('read-only');
    const pf: PageFile = { ...r.value, page: { ...r.value.page, id: pid, items: stripMarks(r.value.page.items, kept) } };
    return strToU8(serializeEnvelope(pf));
  };

  for (const pid of nb.pageIds) {
    const path = `pages/${pid}.json`;
    if (validateEntryPath(path)?.kind !== 'page') continue;
    const data = await pageText(pid);
    if (!data) continue;
    const keep = cached + data.length <= JSON_CACHE_LIMIT;
    if (keep) cached += data.length;
    plans.push({
      kind: 'json',
      path,
      bytes: data.length,
      crc32: crc32(data),
      data: keep ? data : null,
      build: async () => {
        const again = await pageText(pid);
        if (!again) throw new QunoteError('changed', `${path} disappeared`);
        return again;
      },
      deflate: true,
    });
  }

  const files: { path: string; abs: string }[] = [];
  const assets = Object.values(nb.assets);
  for (const folder of ['assets', 'audio']) {
    for (const a of assets) {
      if (folderOf(a) !== folder) continue;
      const path = `${folder}/${a.id}.${safeExt(a.ext)}`;
      if (!validateEntryPath(path)) continue;
      files.push({ path, abs: joinPath(nbDir, path) });
    }
  }

  const sized: { path: string; abs: string; bytes: number }[] = [];
  for (const f of files) {
    if (!(await fs.exists(f.abs))) continue;
    sized.push({ ...f, bytes: await fs.size(f.abs) });
  }

  // The cover: one read into memory (see COVER_MEMORY_LIMIT). A cover that cannot be read whole is
  // left out; the receiver then draws its own.
  const coverAbs = joinPath(nbDir, COVER_PATH);
  let cover: Uint8Array | null = null;
  try {
    if (await fs.exists(coverAbs)) {
      const n = await fs.size(coverAbs);
      if (n > 0 && n <= COVER_MEMORY_LIMIT) {
        const b = await fs.readBytes(coverAbs, 0, n);
        if (b.length === n) cover = b;
      }
    }
  } catch {
    cover = null;
  }

  let contentBytes = 0;
  for (const p of plans) contentBytes += p.bytes;
  for (const f of sized) contentBytes += f.bytes;
  if (cover) contentBytes += cover.length;
  if (contentBytes > ZIP32_LIMIT) throw new QunoteError('too-large');

  const total = contentBytes * 2;
  let done = 0;
  const progress = (n: number) => {
    done += n;
    o.onProgress?.(Math.min(done, total), total);
  };
  for (const p of plans) progress(p.bytes);

  for (const f of sized) {
    const src = fileSource(fs, f.abs);
    let crc = 0;
    let got = 0;
    while (got < f.bytes) {
      const b = await src.read(got, Math.min(chunk, f.bytes - got));
      if (b.length === 0) throw new QunoteError('changed', `${f.path} shrank`);
      crc = crc32(b, crc);
      got += b.length;
      progress(b.length);
    }
    plans.push({ kind: 'file', path: f.path, abs: f.abs, bytes: f.bytes, crc32: crc });
  }
  if (cover) {
    const data = cover;
    plans.push({ kind: 'json', path: COVER_PATH, bytes: data.length, crc32: crc32(data), data, build: async () => data, deflate: false });
    progress(data.length);
  }

  const listed: QunoteFileEntry[] = plans.map((p) => ({ path: p.path, bytes: p.bytes, crc32: p.crc32 }));
  const manifest = buildManifest({
    app: o.appVersion,
    exportedAt,
    notebookId: nb.id,
    title: nb.title,
    includesRecordings: o.includeRecordings && nb.recordings.length > 0,
    pageCount: nb.pageIds.length,
    files: listed,
  });

  // ----- pass 2: write
  await fs.remove(outPath);
  const sink = fileSink(fs, outPath, chunk);
  const zip = createZipWriter(sink, { now: o.now, chunkSize: chunk });
  const check = (p: Plan, w: { bytes: number; crc32: number }) => {
    if (w.bytes !== p.bytes || w.crc32 >>> 0 !== p.crc32 >>> 0) throw new QunoteError('changed', `${p.path} changed while it was packed`);
  };

  await zip.addBytes(MANIFEST_PATH, strToU8(JSON.stringify(manifest)), { deflate: true });
  for (const p of plans) {
    if (p.kind === 'json') {
      const data = p.data ?? (await p.build());
      check(p, await zip.addBytes(p.path, data, { deflate: p.deflate }));
      progress(p.bytes);
    } else {
      let last = 0;
      const w = await zip.addSource(p.path, fileSource(fs, p.abs), {
        deflate: false,
        onBytes: (n) => {
          progress(n - last);
          last = n;
        },
      });
      check(p, w);
    }
  }
  const fin = await zip.finish();
  await sink.close();
  return { bytes: fin.bytes, manifest };
}
