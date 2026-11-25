/**
 * Versioned readers, in the readTask style of src/store/Tasks.tsx (NB-83): every saved object is
 * rebuilt field by field, enums are checked against const arrays, numbers must be finite, colors must
 * be hex, strings are capped (title 200, text 20000) and bad items are dropped. A reader never throws;
 * it returns null only when the object is not that kind of file at all.
 *
 * Readers do not check the version: callers run migrate() first (readJsonRecovering does), which
 * flags a newer version readOnly. Writers build envelopes with make*File so the key order is fixed
 * and the '$' sentinel is last.
 */
import { CURRENT_VERSION } from './migrate.ts';
import { DEFAULT_PAPER, PAGE_SIZE_KEYS, PAPER_COLORS, PAPER_STYLES, copyPaper, sizeOf } from './paper.ts';
import { encodePage } from './codec.ts';
import { isSafeId } from './ids.ts';
import { CUSTOM_COLORS_MAX, ERASER_SIZE_MAX, ERASER_SIZE_MIN, HL_WIDTHS, PEN_PRESET_NAME_MAX, PEN_WIDTHS, deepMerge, defaultsFor } from './settings.ts';
import type { DeepPartial } from './settings.ts';
import type {
  Asset,
  AssetKind,
  Box,
  EncodedItem,
  EncodedPage,
  EncodedStroke,
  Folder,
  Hex,
  Id,
  IndexCover,
  IndexEntry,
  IndexFile,
  IsoDate,
  LibraryFile,
  Notebook,
  NotebookFile,
  NotebookOriginKind,
  NotebookSettings,
  Page,
  PageBackground,
  PageFile,
  PaperSpec,
  PencilAction,
  PendingImport,
  PenPreset,
  PurgedTombstone,
  RecMark,
  RecSegment,
  Recording,
  ShapeItem,
  ShapeKind,
  Size,
  SortKey,
  ToolbarPos,
  TourFlag,
} from './types.ts';

// ===== limits and enums

export const TITLE_MAX = 200;
export const TEXT_MAX = 20000;
export const NAME_MAX = 200;
export const PURGED_CAP = 2000;
export const PURGED_DAYS = 400;
const DAY_MS = 86_400_000;
/** The largest page side accepted, in points (PDF's 200-inch limit). */
export const PAGE_SIDE_MAX = 14400;
const ITEM_WIDTH_MAX = 500;
const TEXT_SIZE_MAX = 500;
const EPOCH: IsoDate = '1970-01-01T00:00:00.000Z';

export const SHAPE_KINDS: readonly ShapeKind[] = ['line', 'arrow', 'rect', 'ellipse', 'triangle', 'polygon'];
export const ASSET_KINDS: readonly AssetKind[] = ['pdf', 'image', 'audio'];
export const ORIGIN_KINDS: readonly NotebookOriginKind[] = ['blank', 'pdf', 'scan', 'photos', 'qunote', 'restore', 'duplicate'];
export const SORT_KEYS: readonly SortKey[] = ['updated', 'name', 'created'];
const ROTATIONS: readonly (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];
const SEGMENT_STATES: readonly RecSegment['state'][] = ['recording', 'done', 'recovered', 'lost'];
const TOUR_FLAGS: readonly TourFlag[] = ['unseen', 'done', 'skipped'];
const PENCIL_ACTIONS: readonly PencilAction[] = ['eraser', 'lastTool', 'off'];
const TOOLBAR_POSITIONS: readonly ToolbarPos[] = ['top', 'bottom', 'left', 'right'];

export const HEX_RE = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

// ===== primitives

type Rec = Record<string, unknown>;

export function isRecord(v: unknown): v is Rec {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonNegInt = (v: unknown): number | undefined => (isFiniteNum(v) && v >= 0 ? Math.floor(v) : undefined);
const nonNeg = (v: unknown): number | undefined => (isFiniteNum(v) && v >= 0 ? v : undefined);
const optString = (v: unknown, max = NAME_MAX): string | undefined => (typeof v === 'string' && v ? v.slice(0, max) : undefined);
const capString = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const oneOf = <T>(list: readonly T[], v: unknown): T | undefined => (list.includes(v as T) ? (v as T) : undefined);

export function isHex(v: unknown): v is Hex {
  return typeof v === 'string' && HEX_RE.test(v);
}

/** An id that is used in a file name (and as a Record key): [A-Za-z0-9_-], 1..64 chars, not '__proto__'. */
function fileId(v: unknown): Id | undefined {
  return isSafeId(v) ? v : undefined;
}

/** An item or entry id: any non-empty string up to 100 chars. */
function looseId(v: unknown): Id | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= 100 ? v : undefined;
}

function isoDate(v: unknown): IsoDate | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= 40 ? v : undefined;
}

function uniqueIds(v: unknown, check: (x: unknown) => Id | undefined = fileId): Id[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<Id>();
  const out: Id[] = [];
  for (const x of v) {
    const id = check(x);
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function finiteArray(v: unknown, multipleOf: number): number[] | null {
  if (!Array.isArray(v)) return null;
  const n = v.length - (v.length % multipleOf);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const x = v[i];
    if (!isFiniteNum(x)) return null;
    out[i] = x;
  }
  return out;
}

// ===== shared structures

export function readPaper(raw: unknown, fallback: PaperSpec = DEFAULT_PAPER): PaperSpec {
  if (!isRecord(raw)) return copyPaper(fallback);
  return {
    style: oneOf(PAPER_STYLES, raw.style) ?? fallback.style,
    color: oneOf(PAPER_COLORS, raw.color) ?? fallback.color,
    size: oneOf(PAGE_SIZE_KEYS, raw.size) ?? fallback.size,
  };
}

export function readSize(raw: unknown): Size | null {
  if (!isRecord(raw)) return null;
  const w = raw.w;
  const h = raw.h;
  if (!isFiniteNum(w) || !isFiniteNum(h) || w <= 0 || h <= 0 || w > PAGE_SIDE_MAX || h > PAGE_SIDE_MAX) return null;
  return { w, h };
}

export function readBox(raw: unknown): Box | null {
  if (!isRecord(raw)) return null;
  const { x, y, w, h } = raw;
  if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(w) || !isFiniteNum(h) || w < 0 || h < 0) return null;
  return { x, y, w, h, rot: isFiniteNum(raw.rot) ? raw.rot : 0 };
}

function readRect(raw: unknown): { x: number; y: number; w: number; h: number } | null {
  if (!isRecord(raw)) return null;
  const { x, y, w, h } = raw;
  if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(w) || !isFiniteNum(h) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

export function readBackground(raw: unknown, fallback: PaperSpec = DEFAULT_PAPER): PageBackground {
  const paperBg = (): PageBackground => ({ kind: 'paper', paper: copyPaper(fallback) });
  if (!isRecord(raw)) return paperBg();
  if (raw.kind === 'paper') return { kind: 'paper', paper: readPaper(raw.paper, fallback) };
  if (raw.kind === 'pdf') {
    const id = fileId(raw.fileId);
    const pageIndex = nonNegInt(raw.pageIndex);
    if (id === undefined || pageIndex === undefined) return paperBg();
    const bg: PageBackground = { kind: 'pdf', fileId: id, pageIndex, rotation: oneOf(ROTATIONS, raw.rotation) ?? 0 };
    if (raw.damaged === true) bg.damaged = true;
    return bg;
  }
  if (raw.kind === 'image') {
    const id = fileId(raw.fileId);
    if (id === undefined) return paperBg();
    return { kind: 'image', fileId: id, paper: readPaper(raw.paper, fallback) };
  }
  return paperBg();
}

function readRecMark(raw: unknown): RecMark | undefined {
  if (!isRecord(raw)) return undefined;
  const recordingId = looseId(raw.recordingId);
  const ms = nonNeg(raw.ms);
  return recordingId !== undefined && ms !== undefined ? { recordingId, ms } : undefined;
}

function itemWidth(v: unknown): number | undefined {
  return isFiniteNum(v) && v > 0 ? Math.min(v, ITEM_WIDTH_MAX) : undefined;
}

/** Reads one item as stored in a page file. Bad items give null (and are dropped by the page reader). */
export function readEncodedItem(raw: unknown): EncodedItem | null {
  if (!isRecord(raw)) return null;
  const id = looseId(raw.id);
  if (id === undefined) return null;
  const base: { id: Id; rec?: RecMark; at?: number } = { id };
  const rec = readRecMark(raw.rec);
  if (rec) base.rec = rec;
  if (isFiniteNum(raw.at)) base.at = raw.at;

  switch (raw.kind) {
    case 'stroke': {
      const tool = raw.tool === 'highlighter' ? 'highlighter' : raw.tool === 'pen' ? 'pen' : undefined;
      const width = itemWidth(raw.width);
      const pts = finiteArray(raw.pts, 3);
      if (!tool || !isHex(raw.color) || width === undefined || !pts || pts.length < 3) return null;
      const out: EncodedStroke = { ...base, kind: 'stroke', tool, color: raw.color, width, pressure: raw.pressure === true, pts };
      if (raw.enc === 'd10') out.enc = 'd10';
      return out;
    }
    case 'shape': {
      const shape = oneOf(SHAPE_KINDS, raw.shape);
      const width = itemWidth(raw.width);
      if (!shape || !isHex(raw.color) || width === undefined) return null;
      const pts = raw.pts === undefined ? null : finiteArray(raw.pts, 2);
      const box = raw.box === undefined ? null : readBox(raw.box);
      if (!(pts && pts.length >= 4) && !box) return null;
      const out: ShapeItem = { ...base, kind: 'shape', shape, color: raw.color, width, fill: isHex(raw.fill) ? raw.fill : null };
      if (raw.highlighter === true) out.highlighter = true;
      if (pts && pts.length >= 4) out.pts = pts;
      if (box) out.box = box;
      return out;
    }
    case 'text': {
      const box = readBox(raw.box);
      const size = isFiniteNum(raw.size) && raw.size > 0 ? Math.min(raw.size, TEXT_SIZE_MAX) : undefined;
      if (!box || typeof raw.text !== 'string' || size === undefined || !isHex(raw.color)) return null;
      return { ...base, kind: 'text', box, text: raw.text.slice(0, TEXT_MAX), size, color: raw.color, bold: raw.bold === true };
    }
    case 'image': {
      const fid = fileId(raw.fileId);
      const box = readBox(raw.box);
      if (fid === undefined || !box) return null;
      return { ...base, kind: 'image', fileId: fid, box, crop: readRect(raw.crop) };
    }
    default:
      return null;
  }
}

export function readEncodedPage(raw: unknown, fallbackPaper: PaperSpec = DEFAULT_PAPER): EncodedPage | null {
  if (!isRecord(raw)) return null;
  const id = fileId(raw.id);
  if (id === undefined) return null;
  const background = readBackground(raw.background, fallbackPaper);
  const size = readSize(raw.size) ?? sizeOf(background.kind === 'pdf' ? fallbackPaper : background.paper);
  const items: EncodedItem[] = [];
  if (Array.isArray(raw.items)) {
    const seen = new Set<Id>();
    for (const r of raw.items) {
      const item = readEncodedItem(r);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
  }
  return { id, size, background, items };
}

function readRecording(raw: unknown): Recording | null {
  if (!isRecord(raw)) return null;
  const id = fileId(raw.id);
  if (id === undefined) return null;
  const segments: RecSegment[] = [];
  if (Array.isArray(raw.segments)) {
    for (const s of raw.segments) {
      if (!isRecord(s)) continue;
      const fid = fileId(s.fileId);
      const startMs = nonNeg(s.startMs);
      const durationMs = nonNeg(s.durationMs);
      const state = oneOf(SEGMENT_STATES, s.state);
      if (fid === undefined || startMs === undefined || durationMs === undefined || !state) continue;
      const seg: RecSegment = { fileId: fid, startMs, durationMs, state };
      const pending = optString(s.pendingPath, 2000);
      if (pending) seg.pendingPath = pending;
      segments.push(seg);
    }
  }
  return {
    id,
    title: capString(raw.title, TITLE_MAX),
    startedAt: isoDate(raw.startedAt) ?? EPOCH,
    durationMs: nonNeg(raw.durationMs) ?? segments.reduce((t, s) => t + s.durationMs, 0),
    segments,
  };
}

function readAsset(raw: unknown): Asset | null {
  if (!isRecord(raw)) return null;
  const id = fileId(raw.id);
  const kind = oneOf(ASSET_KINDS, raw.kind);
  const ext = typeof raw.ext === 'string' && /^[A-Za-z0-9]{1,10}$/.test(raw.ext) ? raw.ext.toLowerCase() : undefined;
  if (id === undefined || !kind || !ext) return null;
  const a: Asset = { id, kind, ext, bytes: nonNegInt(raw.bytes) ?? 0, addedAt: isoDate(raw.addedAt) ?? EPOCH };
  const name = optString(raw.name);
  if (name) a.name = name;
  const pc = nonNegInt(raw.pageCount);
  if (pc !== undefined) a.pageCount = pc;
  return a;
}

function readPending(raw: unknown): PendingImport | undefined {
  if (!isRecord(raw) || raw.kind !== 'pdf-pages') return undefined;
  const jobId = fileId(raw.jobId);
  const fid = fileId(raw.fileId);
  const firstPageIndex = nonNegInt(raw.firstPageIndex);
  const insertAt = nonNegInt(raw.insertAt);
  const nextPage = nonNegInt(raw.nextPage);
  const total = nonNegInt(raw.total);
  if (jobId === undefined || fid === undefined || firstPageIndex === undefined || insertAt === undefined || nextPage === undefined || total === undefined) {
    return undefined;
  }
  const p: PendingImport = { jobId, fileId: fid, kind: 'pdf-pages', firstPageIndex, insertAt, nextPage, total };
  const probing = nonNegInt(raw.probing);
  if (probing !== undefined) p.probing = probing;
  if (Array.isArray(raw.damagedPages)) {
    const d = raw.damagedPages.map(nonNegInt).filter((n): n is number => n !== undefined);
    p.damagedPages = [...new Set(d)];
  }
  return p;
}

function readFolder(raw: unknown, index: number): Folder | null {
  if (!isRecord(raw)) return null;
  const id = looseId(raw.id);
  if (id === undefined) return null;
  return {
    id,
    name: capString(raw.name, NAME_MAX),
    createdAt: isoDate(raw.createdAt) ?? EPOCH,
    order: isFiniteNum(raw.order) ? raw.order : index,
  };
}

function readFolders(raw: unknown): Folder[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<Id>();
  const out: Folder[] = [];
  raw.forEach((r, i) => {
    const f = readFolder(r, i);
    if (f && !seen.has(f.id)) {
      seen.add(f.id);
      out.push(f);
    }
  });
  return out;
}

function readCourseNames(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(raw)) return out;
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (k && k.length <= 40 && k !== '__proto__' && typeof v === 'string' && v) out[k] = v.slice(0, NAME_MAX);
  }
  return out;
}

// ===== notebook.json

/** Rebuilds a notebook (with or without the file envelope). */
export function readNotebook(raw: unknown): Notebook | null {
  if (!isRecord(raw)) return null;
  const id = fileId(raw.id);
  if (id === undefined) return null;
  const defaults = readPaper(raw.defaults);
  const pageIds = uniqueIds(raw.pageIds);
  const live = new Set(pageIds);
  const removedPageIds = uniqueIds(raw.removedPageIds).filter((p) => !live.has(p));

  const recordings: Recording[] = [];
  if (Array.isArray(raw.recordings)) {
    const seen = new Set<Id>();
    for (const r of raw.recordings) {
      const rec = readRecording(r);
      if (rec && !seen.has(rec.id)) {
        seen.add(rec.id);
        recordings.push(rec);
      }
    }
  }

  const assets: Record<Id, Asset> = {};
  if (isRecord(raw.assets)) {
    for (const k of Object.keys(raw.assets)) {
      const a = readAsset(raw.assets[k]);
      if (a && a.id === k) assets[k] = a;
    }
  }

  const originRaw = isRecord(raw.origin) ? raw.origin : {};
  const origin: Notebook['origin'] = { kind: oneOf(ORIGIN_KINDS, originRaw.kind) ?? 'blank' };
  const originName = optString(originRaw.name);
  if (originName) origin.name = originName;

  const createdAt = isoDate(raw.createdAt) ?? EPOCH;
  const nb: Notebook = {
    id,
    title: capString(raw.title, TITLE_MAX),
    createdAt,
    updatedAt: isoDate(raw.updatedAt) ?? createdAt,
    defaults,
    pageIds,
    removedPageIds,
    recordings,
    assets,
    origin,
    contentRev: nonNegInt(raw.contentRev) ?? 0,
  };
  const folderId = looseId(raw.folderId);
  if (folderId !== undefined) nb.folderId = folderId;
  const courseCode = optString(raw.courseCode, 40);
  if (courseCode) nb.courseCode = courseCode;
  const deletedAt = isoDate(raw.deletedAt);
  if (deletedAt) nb.deletedAt = deletedAt;
  const pending = readPending(raw.pending);
  if (pending) nb.pending = pending;
  return nb;
}

export function readNotebookFile(raw: unknown): NotebookFile | null {
  if (!isRecord(raw) || raw.format !== 'qu-notebook') return null;
  const nb = readNotebook(raw);
  if (!nb) return null;
  return makeNotebookFile(nb, {
    rev: nonNegInt(raw.rev) ?? 0,
    savedAt: isoDate(raw.savedAt) ?? nb.updatedAt,
    app: optString(raw.app, 40) ?? '',
  });
}

/** Builds the notebook.json envelope in the fixed key order ('$' sentinel last). */
export function makeNotebookFile(nb: Notebook, meta: { rev: number; savedAt: IsoDate; app: string }): NotebookFile {
  return {
    format: 'qu-notebook',
    version: CURRENT_VERSION as 1,
    rev: meta.rev,
    savedAt: meta.savedAt,
    app: meta.app,
    id: nb.id,
    title: nb.title,
    ...(nb.folderId !== undefined ? { folderId: nb.folderId } : {}),
    ...(nb.courseCode !== undefined ? { courseCode: nb.courseCode } : {}),
    createdAt: nb.createdAt,
    updatedAt: nb.updatedAt,
    ...(nb.deletedAt !== undefined ? { deletedAt: nb.deletedAt } : {}),
    defaults: nb.defaults,
    pageIds: nb.pageIds,
    removedPageIds: nb.removedPageIds,
    recordings: nb.recordings,
    assets: nb.assets,
    ...(nb.pending !== undefined ? { pending: nb.pending } : {}),
    origin: nb.origin,
    contentRev: nb.contentRev,
    $: 'end',
  };
}

/** The notebook inside a notebook.json envelope. */
export function notebookOf(f: NotebookFile): Notebook {
  const nb: Notebook = {
    id: f.id,
    title: f.title,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    defaults: f.defaults,
    pageIds: f.pageIds,
    removedPageIds: f.removedPageIds,
    recordings: f.recordings,
    assets: f.assets,
    origin: f.origin,
    contentRev: f.contentRev,
  };
  if (f.folderId !== undefined) nb.folderId = f.folderId;
  if (f.courseCode !== undefined) nb.courseCode = f.courseCode;
  if (f.deletedAt !== undefined) nb.deletedAt = f.deletedAt;
  if (f.pending !== undefined) nb.pending = f.pending;
  return nb;
}

// ===== pages/<id>.json

export function readPageFile(raw: unknown): PageFile | null {
  if (!isRecord(raw) || raw.format !== 'qu-page') return null;
  const page = readEncodedPage(raw.page);
  if (!page) return null;
  return { format: 'qu-page', version: CURRENT_VERSION as 1, rev: nonNegInt(raw.rev) ?? 0, savedAt: isoDate(raw.savedAt) ?? EPOCH, page, $: 'end' };
}

/** Builds a page file (points d10-encoded) in the fixed key order. */
export function makePageFile(page: Page, meta: { rev: number; savedAt: IsoDate }): PageFile {
  return { format: 'qu-page', version: CURRENT_VERSION as 1, rev: meta.rev, savedAt: meta.savedAt, page: encodePage(page), $: 'end' };
}

// ===== library.json

export function readLibraryFile(raw: unknown): LibraryFile | null {
  if (!isRecord(raw) || raw.format !== 'qu-library') return null;
  return makeLibraryFile(
    { folders: readFolders(raw.folders), courseNames: readCourseNames(raw.courseNames) },
    { rev: nonNegInt(raw.rev) ?? 0, savedAt: isoDate(raw.savedAt) ?? EPOCH },
  );
}

export function makeLibraryFile(
  data: { folders: Folder[]; courseNames: Record<string, string> },
  meta: { rev: number; savedAt: IsoDate },
): LibraryFile {
  return { format: 'qu-library', version: CURRENT_VERSION as 1, rev: meta.rev, savedAt: meta.savedAt, folders: data.folders, courseNames: data.courseNames, $: 'end' };
}

// ===== AsyncStorage index

function readCover(raw: unknown): IndexCover {
  if (isRecord(raw)) {
    if (raw.kind === 'pdf') return { kind: 'pdf' };
    if (raw.kind === 'image') return { kind: 'image' };
    if (raw.kind === 'paper') return { kind: 'paper', paper: readPaper(raw.paper) };
  }
  return { kind: 'paper', paper: copyPaper(DEFAULT_PAPER) };
}

export function readIndexEntry(raw: unknown): IndexEntry | null {
  if (!isRecord(raw)) return null;
  const id = fileId(raw.id);
  if (id === undefined) return null;
  const createdAt = isoDate(raw.createdAt) ?? EPOCH;
  const e: IndexEntry = {
    id,
    title: capString(raw.title, TITLE_MAX),
    createdAt,
    updatedAt: isoDate(raw.updatedAt) ?? createdAt,
    pageCount: nonNegInt(raw.pageCount) ?? 0,
    recordingCount: nonNegInt(raw.recordingCount) ?? 0,
    hasPdf: raw.hasPdf === true,
    cover: readCover(raw.cover),
    thumbRev: nonNegInt(raw.thumbRev) ?? 0,
    contentRev: nonNegInt(raw.contentRev) ?? 0,
  };
  const folderId = looseId(raw.folderId);
  if (folderId !== undefined) e.folderId = folderId;
  const courseCode = optString(raw.courseCode, 40);
  if (courseCode) e.courseCode = courseCode;
  const deletedAt = isoDate(raw.deletedAt);
  if (deletedAt) e.deletedAt = deletedAt;
  if (raw.needsThumb === true) e.needsThumb = true;
  const bytes = nonNegInt(raw.bytes);
  if (bytes !== undefined) e.bytes = bytes;
  if (raw.readOnly === true) e.readOnly = true;
  if (isRecord(raw.importing)) {
    const done = nonNegInt(raw.importing.done);
    const total = nonNegInt(raw.importing.total);
    if (done !== undefined && total !== undefined) e.importing = { done: Math.min(done, total), total };
  }
  return e;
}

function readPurged(raw: unknown): PurgedTombstone[] {
  if (!Array.isArray(raw)) return [];
  const out: PurgedTombstone[] = [];
  for (const r of raw) {
    if (!isRecord(r)) continue;
    const id = looseId(r.id);
    const at = isoDate(r.at);
    if (id !== undefined && at !== undefined) out.push({ id, at });
  }
  return out;
}

/**
 * Keeps one tombstone per id (the newest), drops those older than 400 days when now is given, and
 * keeps the newest 2000. The result is sorted oldest first.
 */
export function prunePurged(list: readonly PurgedTombstone[], now?: number): PurgedTombstone[] {
  const byId = new Map<Id, { t: PurgedTombstone; ms: number }>();
  for (const t of list) {
    const parsed = Date.parse(t.at);
    const ms = Number.isFinite(parsed) ? parsed : 0;
    const prev = byId.get(t.id);
    if (!prev || ms >= prev.ms) byId.set(t.id, { t: { id: t.id, at: t.at }, ms });
  }
  let rows = [...byId.values()];
  if (now !== undefined && Number.isFinite(now)) {
    const cutoff = now - PURGED_DAYS * DAY_MS;
    rows = rows.filter((r) => r.ms >= cutoff);
  }
  rows.sort((a, b) => a.ms - b.ms);
  if (rows.length > PURGED_CAP) rows = rows.slice(rows.length - PURGED_CAP);
  return rows.map((r) => r.t);
}

export function emptyIndex(): IndexFile {
  return { version: 1, entries: [], folders: [], courseNames: {}, purged: [] };
}

/**
 * Reads the AsyncStorage index. null means unreadable (the caller keeps the raw text aside under
 * ':unreadable' and never writes over it until a read succeeds). now (epoch ms) expires old tombstones.
 */
export function readIndex(raw: unknown, now?: number): IndexFile | null {
  if (!isRecord(raw) || !Array.isArray(raw.entries)) return null;
  const entries: IndexEntry[] = [];
  const seen = new Set<Id>();
  for (const r of raw.entries) {
    const e = readIndexEntry(r);
    if (e && !seen.has(e.id)) {
      seen.add(e.id);
      entries.push(e);
    }
  }
  return {
    version: 1,
    entries,
    folders: readFolders(raw.folders),
    courseNames: readCourseNames(raw.courseNames),
    purged: prunePurged(readPurged(raw.purged), now),
  };
}

// ===== settings

function readPreset(raw: unknown): PenPreset | null {
  if (!isRecord(raw) || !isHex(raw.color) || !isFiniteNum(raw.width) || raw.width <= 0) return null;
  const p: PenPreset = { color: raw.color, width: Math.min(raw.width, ITEM_WIDTH_MAX) };
  if (typeof raw.name === 'string' && raw.name.trim()) p.name = raw.name.slice(0, PEN_PRESET_NAME_MAX);
  return p;
}

function widthIndex(v: unknown, count: number): number | undefined {
  return isFiniteNum(v) && Number.isInteger(v) && v >= 0 && v < count ? v : undefined;
}

const optBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/**
 * Reads saved settings over the defaults for this device (deepMerge). Every field is checked on its
 * own, so one bad field falls back to its default and keeps the rest. Never returns null.
 */
export function readSettings(raw: unknown, isTablet: boolean): NotebookSettings {
  const defaults = defaultsFor(isTablet);
  if (!isRecord(raw)) return defaults;
  const p: DeepPartial<NotebookSettings> = {};

  if (raw.input === 'pen' || raw.input === 'finger') p.input = raw.input;
  p.fingerDraws = optBool(raw.fingerDraws);
  if (raw.hand === 'right' || raw.hand === 'left') p.hand = raw.hand;
  p.pencilDoubleTap = oneOf(PENCIL_ACTIONS, raw.pencilDoubleTap);
  p.pencilSqueeze = oneOf(PENCIL_ACTIONS, raw.pencilSqueeze);
  p.pressure = optBool(raw.pressure);
  if (isRecord(raw.defaultPaper)) p.defaultPaper = readPaper(raw.defaultPaper, defaults.defaultPaper);
  p.toolbarPos = oneOf(TOOLBAR_POSITIONS, raw.toolbarPos);
  p.shapeSnap = optBool(raw.shapeSnap);
  p.snapHintsShown = nonNegInt(raw.snapHintsShown);
  p.rulerHintShown = optBool(raw.rulerHintShown);
  p.pagesPinned = optBool(raw.pagesPinned);

  if (isRecord(raw.pen)) {
    const pen: DeepPartial<NotebookSettings['pen']> = {};
    if (Array.isArray(raw.pen.presets) && raw.pen.presets.length === 3) {
      const d = defaults.pen.presets;
      const r = raw.pen.presets;
      pen.presets = [readPreset(r[0]) ?? d[0], readPreset(r[1]) ?? d[1], readPreset(r[2]) ?? d[2]];
    }
    if (isHex(raw.pen.color)) pen.color = raw.pen.color;
    pen.widthIndex = widthIndex(raw.pen.widthIndex, PEN_WIDTHS.length);
    p.pen = pen;
  }
  if (isRecord(raw.highlighter)) {
    p.highlighter = {
      color: isHex(raw.highlighter.color) ? raw.highlighter.color : undefined,
      widthIndex: widthIndex(raw.highlighter.widthIndex, HL_WIDTHS.length),
      straight: optBool(raw.highlighter.straight),
    };
  }
  if (isRecord(raw.eraser)) {
    const size = raw.eraser.size;
    p.eraser = {
      mode: raw.eraser.mode === 'stroke' || raw.eraser.mode === 'pixel' ? raw.eraser.mode : undefined,
      highlighterOnly: optBool(raw.eraser.highlighterOnly),
      size: isFiniteNum(size) ? Math.min(ERASER_SIZE_MAX, Math.max(ERASER_SIZE_MIN, size)) : undefined,
    };
  }
  if (Array.isArray(raw.customColors)) {
    const colors = [...new Set(raw.customColors.filter(isHex).map((c) => c.toUpperCase()))];
    p.customColors = colors.slice(-CUSTOM_COLORS_MAX);
  }
  p.sort = oneOf(SORT_KEYS, raw.sort);

  if (isRecord(raw.backup)) {
    const b = raw.backup;
    // Only fields that are present are read; optional ones absent from the save stay absent.
    const backup: DeepPartial<NotebookSettings['backup']> = { enabled: optBool(b.enabled), wifiOnly: optBool(b.wifiOnly) };
    const lastBackupAt = isoDate(b.lastBackupAt);
    if (lastBackupAt) backup.lastBackupAt = lastBackupAt;
    const lastError = optString(b.lastError, 200);
    if (lastError) backup.lastError = lastError;
    const account = optString(b.account, 320);
    if (account) backup.account = account;
    const lastCount = nonNegInt(b.lastCount);
    if (lastCount !== undefined) backup.lastCount = lastCount;
    const lastBytes = nonNegInt(b.lastBytes);
    if (lastBytes !== undefined) backup.lastBytes = lastBytes;
    if (b.provider === 'icloud' || b.provider === 'gdrive' || b.provider === 'onedrive') backup.provider = b.provider;
    p.backup = backup;
  }
  if (isRecord(raw.tours)) {
    p.tours = { library: oneOf(TOUR_FLAGS, raw.tours.library), setup: oneOf(TOUR_FLAGS, raw.tours.setup), editor: oneOf(TOUR_FLAGS, raw.tours.editor) };
  }
  if (isRecord(raw.calc)) {
    const c = raw.calc;
    const calc: DeepPartial<NotebookSettings['calc']> = { open: optBool(c.open), docked: optBool(c.docked) };
    if (isRecord(c.float) && isFiniteNum(c.float.x) && isFiniteNum(c.float.y)) calc.float = { x: c.float.x, y: c.float.y };
    p.calc = calc;
  }
  return deepMerge(defaults, p);
}
