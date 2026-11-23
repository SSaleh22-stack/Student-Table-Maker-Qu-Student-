/**
 * The .qunote file format (NB-72, NB-73): a zip archive of
 *
 *   qunote.json            this manifest (deflate)
 *   notebook.json          the notebook envelope (deflate)
 *   pages/<pageId>.json    page envelopes (deflate)
 *   assets/<id>.<ext>      PDFs and images (stored)
 *   audio/<id>.<ext>       recordings, only when includesRecordings (stored)
 *   thumbs/cover.png       the cover, when there is one (stored)
 *
 * in that order. The manifest lists every other entry with its uncompressed size and CRC-32, so an
 * import checks each file twice (zip central directory and manifest).
 *
 * The manifest is built and read field by field (readManifest never throws). A manifest with a
 * version above QUNOTE_VERSION was written by a newer app: 'newer-version'.
 *
 * Contract extension (accepted in P30 integration): the manifest also carries pageCount (the
 * shared data model omits it), so inspectQunote can show the page count from the manifest alone. A manifest without it falls back
 * to the number of pages/*.json files.
 */
import type { Id, IsoDate } from '../model/index.ts';

export const QUNOTE_FORMAT = 'qunote';
export const QUNOTE_VERSION = 1;
export const MANIFEST_PATH = 'qunote.json';
export const NOTEBOOK_PATH = 'notebook.json';
export const COVER_PATH = 'thumbs/cover.png';

export interface QunoteFileEntry {
  path: string;
  bytes: number;
  crc32: number;
}

export interface QunoteManifest {
  format: 'qunote';
  version: 1;
  app: string;
  exportedAt: IsoDate;
  notebookId: Id;
  title: string;
  includesRecordings: boolean;
  pageCount: number;
  files: QunoteFileEntry[];
}

export type QunoteErrorCode =
  /** Not a zip, or a zip without a qunote manifest. */
  | 'not-qunote'
  /** CRC, size, structure, path or JSON check failed. */
  | 'damaged'
  /** Written by a newer app version. */
  | 'newer-version'
  /** The unpacked files would not fit in the free space. */
  | 'no-space'
  /** Over the format's 4 GiB limit (export). */
  | 'too-large'
  /** The notebook was saved by a newer app version and cannot be exported. */
  | 'read-only'
  /** The notebook to export is missing or its notebook.json cannot be read. */
  | 'missing'
  | 'unreadable'
  /** A file changed while it was being packed. */
  | 'changed';

export class QunoteError extends Error {
  code: QunoteErrorCode;
  constructor(code: QunoteErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'QunoteError';
    this.code = code;
  }
}

export const isQunoteError = (e: unknown): e is QunoteError => e instanceof QunoteError;

// ===== entry paths

export type EntryKind = 'manifest' | 'notebook' | 'page' | 'asset' | 'audio' | 'cover';

export interface EntryPathInfo {
  kind: EntryKind;
  /** The page id (page) or file id (asset, audio). */
  id?: Id;
  /** The file extension (asset, audio). */
  ext?: string;
}

/** Ids in entry names: the notebook folder-name alphabet. */
const ENTRY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ENTRY_EXT = /^[a-z0-9]{1,10}$/;

/**
 * Checks a zip entry name against the closed list of .qunote paths and returns what it is, or null.
 * Rejects absolute paths, '..', backslashes, empty segments, unknown folders and odd characters, so
 * nothing can be written outside the staging folder (zip-slip).
 */
export function validateEntryPath(path: unknown): EntryPathInfo | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 200) return null;
  if (path === MANIFEST_PATH) return { kind: 'manifest' };
  if (path === NOTEBOOK_PATH) return { kind: 'notebook' };
  if (path === COVER_PATH) return { kind: 'cover' };
  const parts = path.split('/');
  if (parts.length !== 2) return null;
  const [dir, name] = parts;
  if (dir === 'pages') {
    if (!name.endsWith('.json')) return null;
    const id = name.slice(0, -'.json'.length);
    return ENTRY_ID.test(id) && id !== '__proto__' ? { kind: 'page', id } : null;
  }
  if (dir === 'assets' || dir === 'audio') {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return null;
    const id = name.slice(0, dot);
    const ext = name.slice(dot + 1);
    if (!ENTRY_ID.test(id) || id === '__proto__' || !ENTRY_EXT.test(ext)) return null;
    return { kind: dir === 'assets' ? 'asset' : 'audio', id, ext };
  }
  return null;
}

/** The entry order of the format: manifest, notebook, pages, assets, audio, cover. */
export function entryRank(path: string): number {
  const k = validateEntryPath(path)?.kind;
  switch (k) {
    case 'manifest':
      return 0;
    case 'notebook':
      return 1;
    case 'page':
      return 2;
    case 'asset':
      return 3;
    case 'audio':
      return 4;
    case 'cover':
      return 5;
    default:
      return 6;
  }
}

// ===== build / read

export function buildManifest(i: {
  app: string;
  exportedAt: IsoDate;
  notebookId: Id;
  title: string;
  includesRecordings: boolean;
  pageCount: number;
  files: QunoteFileEntry[];
}): QunoteManifest {
  return {
    format: QUNOTE_FORMAT,
    version: QUNOTE_VERSION,
    app: i.app,
    exportedAt: i.exportedAt,
    notebookId: i.notebookId,
    title: i.title,
    includesRecordings: i.includesRecordings,
    pageCount: i.pageCount,
    files: i.files.map((f) => ({ path: f.path, bytes: f.bytes, crc32: f.crc32 >>> 0 })),
  };
}

export type ManifestRead = { ok: true; manifest: QunoteManifest } | { ok: false; error: 'not-qunote' | 'damaged' | 'newer-version' };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isUint = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Rebuilds a parsed qunote.json field by field. */
export function readManifest(raw: unknown): ManifestRead {
  if (!isRec(raw) || raw.format !== QUNOTE_FORMAT) return { ok: false, error: 'not-qunote' };
  const version = raw.version;
  if (typeof version === 'number' && Number.isInteger(version) && version > QUNOTE_VERSION) return { ok: false, error: 'newer-version' };
  if (version !== QUNOTE_VERSION) return { ok: false, error: 'damaged' };
  const notebookId = raw.notebookId;
  if (typeof notebookId !== 'string' || !ENTRY_ID.test(notebookId) || notebookId === '__proto__') return { ok: false, error: 'damaged' };
  if (!Array.isArray(raw.files) || raw.files.length > MAX_MANIFEST_FILES) return { ok: false, error: 'damaged' };

  const files: QunoteFileEntry[] = [];
  const seen = new Set<string>();
  for (const f of raw.files) {
    if (!isRec(f)) return { ok: false, error: 'damaged' };
    const info = validateEntryPath(f.path);
    if (!info || info.kind === 'manifest') return { ok: false, error: 'damaged' };
    const path = f.path as string;
    if (seen.has(path)) return { ok: false, error: 'damaged' };
    seen.add(path);
    if (!isUint(f.bytes, Number.MAX_SAFE_INTEGER) || !isUint(f.crc32, 0xffffffff)) return { ok: false, error: 'damaged' };
    files.push({ path, bytes: f.bytes, crc32: f.crc32 });
  }
  if (!seen.has(NOTEBOOK_PATH)) return { ok: false, error: 'damaged' };

  const pagesListed = files.filter((f) => f.path.startsWith('pages/')).length;
  const pageCount = isUint(raw.pageCount, 1_000_000) ? raw.pageCount : pagesListed;
  const exportedAt = typeof raw.exportedAt === 'string' && ISO_RE.test(raw.exportedAt) ? raw.exportedAt : new Date(0).toISOString();
  const title = typeof raw.title === 'string' ? raw.title.slice(0, 200) : '';
  const app = typeof raw.app === 'string' ? raw.app.slice(0, 40) : '';

  return {
    ok: true,
    manifest: {
      format: QUNOTE_FORMAT,
      version: QUNOTE_VERSION,
      app,
      exportedAt,
      notebookId,
      title,
      includesRecordings: raw.includesRecordings === true,
      pageCount,
      files,
    },
  };
}

/** The zip reader's entry cap (also the manifest's). */
export const MAX_MANIFEST_FILES = 100_000;

/** Sum of the uncompressed sizes of every listed file. */
export function manifestBytes(m: QunoteManifest): number {
  let n = 0;
  for (const f of m.files) n += f.bytes;
  return n;
}
