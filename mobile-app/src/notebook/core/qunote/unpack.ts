/**
 * Reading .qunote archives (NB-73).
 *
 * - readQunoteManifest / inspectQunote read ONLY the zip central directory and qunote.json, and
 *   cross-check them: every listed file must be in the archive with the same size and CRC-32, and
 *   every archive entry must be listed (or be qunote.json).
 * - unpackQunote extracts into a staging folder: every entry path is validated (no traversal), every
 *   entry is CRC- and size-checked while it streams, every JSON goes through the P02 readers
 *   (readNotebookFile, readPageFile; a newer format is 'newer-version'), page files are written
 *   re-serialized from the reader's output, assets must match the notebook's asset table. The total
 *   uncompressed size must fit in o.freeBytes (zip-bomb guard). notebook.json is written LAST, after
 *   o.transform (remap.ts asCopy / asRestore), so a half-unpacked folder is never adoptable.
 *
 * Errors are QunoteError: 'not-qunote' (not a zip, no qunote.json, another format), 'damaged',
 * 'newer-version', 'no-space'. A failure to WRITE the staging folder (a full disk, a storage error)
 * is not the file's fault and is rethrown unchanged.
 */
import { strFromU8 } from 'fflate';

import { joinPath } from '../fs/adapter.ts';
import type { FsAdapter } from '../fs/adapter.ts';
import { serializeEnvelope, writeJsonAtomic } from '../fs/journal.ts';
import { safeExt } from '../fs/layout.ts';
import { isRecord, makeNotebookFile, migrate, notebookOf, readNotebookFile, readPageFile } from '../model/index.ts';
import type { Notebook, NotebookFile, PageFile } from '../model/index.ts';
import { MANIFEST_PATH, NOTEBOOK_PATH, QunoteError, isQunoteError, manifestBytes, readManifest, validateEntryPath } from './manifest.ts';
import type { QunoteManifest } from './manifest.ts';
import { ZipError, extractEntry, readEntryBytes, readZipDirectory } from './zipRead.ts';
import type { ByteSource, ReadDirectoryOptions, ZipDirectory } from './zipRead.ts';
import { fileSink } from './zipWrite.ts';

const MANIFEST_MAX = 16 * 1024 * 1024;
const JSON_MAX = 64 * 1024 * 1024;

function toQunoteError(e: unknown): QunoteError {
  if (isQunoteError(e)) return e;
  if (e instanceof ZipError) {
    if (e.code === 'not-zip') return new QunoteError('not-qunote', e.message);
    if (e.code === 'too-large') return new QunoteError('no-space', e.message);
    return new QunoteError('damaged', e.message);
  }
  return new QunoteError('damaged', e instanceof Error ? e.message : String(e));
}

export interface QunoteArchive {
  dir: ZipDirectory;
  manifest: QunoteManifest;
}

/** The central directory and the validated manifest. Throws QunoteError. */
export async function readQunoteManifest(src: ByteSource, o: ReadDirectoryOptions = {}): Promise<QunoteArchive> {
  let dir: ZipDirectory;
  try {
    dir = await readZipDirectory(src, o);
  } catch (e) {
    throw toQunoteError(e);
  }
  const me = dir.byName.get(MANIFEST_PATH);
  if (!me) throw new QunoteError('not-qunote', 'no qunote.json');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(await readEntryBytes(src, dir, me, MANIFEST_MAX)));
  } catch (e) {
    throw e instanceof ZipError ? new QunoteError('damaged', e.message) : new QunoteError('damaged', 'qunote.json is not JSON');
  }
  const r = readManifest(raw);
  if (!r.ok) throw new QunoteError(r.error);
  const m = r.manifest;

  const listed = new Set<string>();
  for (const f of m.files) {
    listed.add(f.path);
    const e = dir.byName.get(f.path);
    if (!e) throw new QunoteError('damaged', `missing ${f.path}`);
    if (e.size !== f.bytes || e.crc32 >>> 0 !== f.crc32 >>> 0) throw new QunoteError('damaged', `${f.path} does not match the manifest`);
  }
  for (const e of dir.entries) {
    if (e.name !== MANIFEST_PATH && !listed.has(e.name)) throw new QunoteError('damaged', `unlisted entry ${e.name}`);
  }
  return { dir, manifest: m };
}

export interface QunoteSummary {
  notebookId: string;
  title: string;
  pageCount: number;
  /** Uncompressed size of the content: the space an import needs. */
  bytes: number;
  includesRecordings: boolean;
  exportedAt: string;
  app: string;
}

export async function inspectQunote(src: ByteSource): Promise<QunoteSummary | { error: 'not-qunote' | 'damaged' | 'newer-version' }> {
  try {
    const { manifest: m } = await readQunoteManifest(src);
    return {
      notebookId: m.notebookId,
      title: m.title,
      pageCount: m.pageCount,
      bytes: manifestBytes(m),
      includesRecordings: m.includesRecordings,
      exportedAt: m.exportedAt,
      app: m.app,
    };
  } catch (e) {
    const q = toQunoteError(e);
    return { error: q.code === 'not-qunote' || q.code === 'newer-version' ? q.code : 'damaged' };
  }
}

/** JSON.parse + sentinel + migrate + reader, like the journal; readOnly marks a newer format. */
function parseEnvelope<T>(bytes: Uint8Array, read: (raw: unknown) => T | null): { value: T; readOnly: boolean } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(bytes));
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.$ !== 'end') return null;
  try {
    const m = migrate(raw);
    const value = read(m.raw);
    return value ? { value, readOnly: m.readOnly } : null;
  } catch {
    return null;
  }
}

export interface UnpackOptions {
  /** The checked free space: the archive's total uncompressed size must fit. Omit to skip the guard. */
  freeBytes?: number;
  appVersion: string;
  now(): number;
  /** asCopy / asRestore (remap.ts). Default: unchanged. */
  transform?(nb: Notebook, m: QunoteManifest): Notebook;
  onProgress?(done: number, total: number): void;
}

export interface UnpackResult {
  /** The folder holding the unpacked notebook (destDir). */
  dir: string;
  /** The notebook as written (after transform). */
  notebook: Notebook;
  manifest: QunoteManifest;
  hasCover: boolean;
}

/** Unpacks into destDir (created; it should not exist). On failure destDir is removed. */
export async function unpackQunote(fs: FsAdapter, src: ByteSource, destDir: string, o: UnpackOptions): Promise<UnpackResult> {
  try {
    return await unpackInto(fs, src, destDir, o);
  } catch (e) {
    try {
      await fs.remove(destDir);
    } catch {
      // The staging job is removed by its owner anyway.
    }
    // Archive problems become QunoteError. Anything else is the destination's (a full disk, a failed
    // write) and is rethrown as it is, so callers do not tell the student the file is damaged.
    throw isQunoteError(e) || e instanceof ZipError ? toQunoteError(e) : e;
  }
}

async function unpackInto(fs: FsAdapter, src: ByteSource, destDir: string, o: UnpackOptions): Promise<UnpackResult> {
  const { dir, manifest } = await readQunoteManifest(src, o.freeBytes !== undefined ? { maxTotalSize: Math.max(0, o.freeBytes) } : {});
  const entry = (path: string) => {
    const e = dir.byName.get(path);
    if (!e) throw new QunoteError('damaged', `missing ${path}`);
    return e;
  };

  // ----- notebook.json (validated first, written last)
  const nbParsed = parseEnvelope(await readEntryBytes(src, dir, entry(NOTEBOOK_PATH), JSON_MAX), readNotebookFile);
  if (!nbParsed) throw new QunoteError('damaged', 'notebook.json');
  if (nbParsed.readOnly) throw new QunoteError('newer-version');
  const file: NotebookFile = nbParsed.value;
  if (file.id !== manifest.notebookId) throw new QunoteError('damaged', 'notebook id does not match the manifest');
  const source = notebookOf(file);
  const pageIds = new Set(source.pageIds);

  const total = manifestBytes(manifest);
  let done = 0;
  const progress = (n: number) => {
    done += n;
    o.onProgress?.(Math.min(done, total), total);
  };

  await fs.mkdirp(destDir);
  const made = new Set<string>();
  const ensureDir = async (sub: string) => {
    if (made.has(sub)) return;
    await fs.mkdirp(joinPath(destDir, sub));
    made.add(sub);
  };

  let hasCover = false;
  for (const f of manifest.files) {
    const info = validateEntryPath(f.path);
    if (!info || info.kind === 'manifest') throw new QunoteError('damaged', `bad path ${f.path}`);
    if (info.kind === 'notebook') {
      progress(f.bytes);
      continue;
    }
    const e = entry(f.path);

    if (info.kind === 'page') {
      const id = info.id as string;
      const parsed = parseEnvelope(await readEntryBytes(src, dir, e, JSON_MAX), readPageFile);
      if (!parsed) throw new QunoteError('damaged', f.path);
      if (parsed.readOnly) throw new QunoteError('newer-version');
      progress(f.bytes);
      // A page the notebook does not list is never shown: it is not kept.
      if (!pageIds.has(id)) continue;
      const pf: PageFile = { ...parsed.value, page: { ...parsed.value.page, id } };
      await ensureDir('pages');
      await fs.writeText(joinPath(destDir, 'pages', `${id}.json`), serializeEnvelope(pf));
      continue;
    }

    if (info.kind === 'asset' || info.kind === 'audio') {
      const fid = info.id as string;
      const asset = Object.prototype.hasOwnProperty.call(source.assets, fid) ? source.assets[fid] : undefined;
      // A file the asset table does not list is never used: it is not kept.
      if (!asset) {
        progress(f.bytes);
        continue;
      }
      const folder = asset.kind === 'audio' ? 'audio' : 'assets';
      if (f.path !== `${folder}/${asset.id}.${safeExt(asset.ext)}`) throw new QunoteError('damaged', `${f.path} does not match its asset`);
    }

    const sub = f.path.slice(0, f.path.indexOf('/'));
    await ensureDir(sub);
    const out = joinPath(destDir, f.path);
    await fs.remove(out);
    const sink = fileSink(fs, out);
    let last = 0;
    await extractEntry(src, dir, e, sink, {
      onBytes: (n) => {
        progress(n - last);
        last = n;
      },
    });
    await sink.close();
    if (info.kind === 'cover') hasCover = true;
  }

  const notebook = o.transform ? o.transform(source, manifest) : source;
  await writeJsonAtomic(
    fs,
    joinPath(destDir, NOTEBOOK_PATH),
    makeNotebookFile(notebook, { rev: file.rev, savedAt: new Date(o.now()).toISOString(), app: o.appVersion }),
  );
  return { dir: destDir, notebook, manifest, hasCover };
}

