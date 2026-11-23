/**
 * PDF export (NB-70): the whole notebook, the current page or a page range as one PDF, with the ink
 * drawn as VECTORS on the pages. Audio is never included.
 *
 * Per page (core/export/pdfOps.ts gives the ops in draw order, already in PDF user space):
 * - PDF background: the original page is brought over with copyPages, so its text stays selectable
 *   and searchable. The copy gets its own Contents array (copies of one page never share ink), its
 *   original content is wrapped in q/Q (a stray matrix in it cannot move the ink), and its /Rotate
 *   becomes the page's own rotation plus the notebook's background rotation. A source PDF that cannot
 *   be parsed or copied (encrypted, broken, over MAX_SOURCE_PDF_BYTES) falls back to a raster of the
 *   page from the PDF engine; a damaged page gets the canvas's neutral placeholder.
 * - Paper backgrounds: patternFor lines (pdfOps). Photo pages: paper fill + the photo.
 * - Image items: decoded and re-encoded through Skia (so EXIF orientation and HEIC/WebP match the
 *   screen), JPEG or PNG for PNG/WebP/GIF sources, at about 216 dpi (pdfOps sizes them).
 * - The HIGHLIGHTER GROUP is drawn opaque on a temporary page of a scratch PDFDocument, embedded with
 *   embedPage, marked as a transparency group (/Group /S /Transparency) and drawn ONCE with
 *   drawPage({ opacity: 0.35 }): the same compositing as the screen's saveLayer, so overlapping
 *   highlights do not darken each other. If that fails on some file, the group's ops are drawn at
 *   constant alpha 0.35 instead (overlaps then darken slightly; logged in dev).
 * - Text boxes: rendered with the app's Skia text layout (P16 layoutText / renderTextImage, Arabic
 *   shaping and per-paragraph direction exactly as on screen) as a 4x PNG, embedded with embedPng.
 *
 * Saving uses object streams and yields every 50 objects (objectsPerTick) so the UI stays alive.
 * Progress: one step per page, plus one for saving. signal.aborted is checked between pages (an
 * aborted export rejects ExportError('aborted') and writes nothing). Before any work, free space is
 * checked against an estimate (source PDFs + images + pages, x2), else ExportError('no-space').
 *
 * The file is written to Paths.cache/nb-export/<random>/<title>.pdf; share it with shareFile (P04U),
 * which deletes it afterwards. JS runtime only (Skia objects are created and disposed here).
 */
import {
  LineCapStyle,
  LineJoinStyle,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  appendBezierCurve,
  clip,
  closePath,
  concatTransformationMatrix,
  degrees,
  drawObject,
  endPath,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  reduceRotation,
  setFillingRgbColor,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { ImageFormat, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';

import { tr } from '@/lib/i18n';
import type { ExportPdf } from '@/notebook/contracts/export';
import type { ExportPdfOptions } from '@/notebook/core/contracts/pdf';
import { exportFileName, resolvePageRange } from '@/notebook/core/export/pageRange';
import {
  HIGHLIGHTER_GROUP_OPACITY,
  blankTarget,
  buildPageOps,
  normalizeRotate,
  parseHex,
  type ImageRequest,
  type PdfOp,
  type PdfTarget,
} from '@/notebook/core/export/pdfOps';
import { newId, type Id, type Notebook, type Page, type TextItem } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { notebookSupported } from '@/notebook/flags';
import { freeBytes } from '@/notebook/fs/expoFs';
import { decodeImageFile, disposeUnseen, layoutText, loadNotebookFonts, renderTextImage, withPdf } from '@/notebook/ink';

// ===== errors

export type ExportErrorCode = 'aborted' | 'no-space' | 'empty' | 'unsupported' | 'failed';

/** Why an export did not produce a file. */
export class ExportError extends Error {
  code: ExportErrorCode;

  constructor(code: ExportErrorCode, message?: string) {
    super(message ?? `ExportError: ${code}`);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ExportError';
    this.code = code;
  }
}

export function isExportError(e: unknown): e is ExportError {
  return e instanceof ExportError || (!!e && typeof e === 'object' && (e as { name?: unknown }).name === 'ExportError');
}

// ===== output files (shared with pngExport.ts)

const EXPORT_DIR = 'nb-export';
/** Folders still being written: the cleanup leaves them alone. */
const writing = new Set<string>();

/** Removes empty export folders (their file was shared and deleted, or the export failed). */
function cleanExportDirs(): void {
  try {
    const root = new Directory(Paths.cache, EXPORT_DIR);
    if (!root.exists) return;
    for (const d of root.list()) {
      if (!(d instanceof Directory) || writing.has(d.name)) continue;
      try {
        if (d.list().length === 0) d.delete();
      } catch {
        // Gone already.
      }
    }
  } catch {
    // The cache is the system's to clean as well.
  }
}

/**
 * Writes bytes to Paths.cache/nb-export/<random>/<name> and returns its file:// URI. The folder is
 * removed again when writing fails.
 */
export async function writeExportFile(name: string, bytes: Uint8Array): Promise<string> {
  cleanExportDirs();
  const folder = newId();
  writing.add(folder);
  const dir = new Directory(Paths.cache, EXPORT_DIR, folder);
  try {
    dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, name);
    await file.write(bytes);
    return file.uri;
  } catch (e) {
    try {
      if (dir.exists) dir.delete();
    } catch {
      // Best effort.
    }
    throw e;
  } finally {
    writing.delete(folder);
  }
}

/** Deletes an exported file that will not be shared (cancelled after it was written). */
export function discardExportFile(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Nothing to clean.
  }
  cleanExportDirs();
}

/** The notebook's file name for an export with this extension. */
export function notebookFileName(nb: Pick<Notebook, 'title'>, ext: string, suffix?: string): string {
  const title = suffix ? `${nb.title} – ${suffix}` : nb.title;
  return exportFileName(title, ext, tr('مذكرة', 'Notebook'));
}

// ===== limits and estimates

/** Source PDFs bigger than this are not parsed into memory: their pages are rasterized instead. */
export const MAX_SOURCE_PDF_BYTES = 256 * 1024 * 1024;
/** Text boxes are rasterized at this many pixels per point. */
export const TEXT_IMAGE_SCALE = 4;
const MB = 1024 * 1024;
const PAGE_BYTES_ESTIMATE = 48 * 1024;
const TEXT_BYTES_ESTIMATE = 96 * 1024;
const RASTER_BYTES_ESTIMATE = 600 * 1024;
const SPACE_MARGIN = 32 * MB;

/** Bytes the export may need on disk (the output, plus room for the save). */
export function estimatePdfBytes(nb: Notebook, pages: readonly Page[]): number {
  const pdfs = new Set<Id>();
  const images = new Set<Id>();
  let total = 0;
  for (const p of pages) {
    total += PAGE_BYTES_ESTIMATE;
    const bg = p.background;
    if (bg.kind === 'pdf' && !bg.damaged) pdfs.add(bg.fileId);
    if (bg.kind === 'image') images.add(bg.fileId);
    for (const it of p.items) {
      if (it.kind === 'image') images.add(it.fileId);
      else if (it.kind === 'text') total += TEXT_BYTES_ESTIMATE;
    }
  }
  for (const id of pdfs) {
    const a = nb.assets[id];
    total += a && a.bytes > 0 ? (a.bytes > MAX_SOURCE_PDF_BYTES ? RASTER_BYTES_ESTIMATE * pages.length : a.bytes) : RASTER_BYTES_ESTIMATE;
  }
  for (const id of images) {
    const a = nb.assets[id];
    total += a && a.bytes > 0 ? Math.min(a.bytes, 4 * MB) : MB;
  }
  return total;
}

function freeSpace(): number | null {
  try {
    const f = freeBytes();
    return Number.isFinite(f) && f > 0 ? f : null;
  } catch {
    return null;
  }
}

// ===== drawing ops onto pdf-lib pages

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Per-page resource names already added (images by key, alpha states by value). */
const pageResources = new WeakMap<PDFPage, { images: Map<string, PDFName>; alphas: Map<number, PDFName> }>();

function resourcesOf(page: PDFPage): { images: Map<string, PDFName>; alphas: Map<number, PDFName> } {
  let r = pageResources.get(page);
  if (!r) {
    r = { images: new Map(), alphas: new Map() };
    pageResources.set(page, r);
  }
  return r;
}

function alphaState(page: PDFPage, value: number): PDFName {
  const res = resourcesOf(page);
  let key = res.alphas.get(value);
  if (!key) {
    const dict = page.doc.context.obj({ Type: 'ExtGState', ca: value, CA: value });
    key = page.node.newExtGState('GS', dict);
    res.alphas.set(value, key);
  }
  return key;
}

function imageName(page: PDFPage, key: string, img: PDFImage): PDFName {
  const res = resourcesOf(page);
  let name = res.images.get(key);
  if (!name) {
    name = page.node.newXObject('Image', img.ref);
    res.images.set(key, name);
  }
  return name;
}

const CAPS = [LineCapStyle.Butt, LineCapStyle.Round, LineCapStyle.Projecting] as const;
const JOINS = [LineJoinStyle.Miter, LineJoinStyle.Round, LineJoinStyle.Bevel] as const;

/** Pushes ops in chunks (a huge spread could overflow the stack). */
function pushAll(page: PDFPage, out: PDFOperator[]): void {
  const CHUNK = 2000;
  for (let i = 0; i < out.length; i += CHUNK) page.pushOperators(...out.slice(i, i + CHUNK));
}

/** Turns pdfOps ops into pdf-lib operators on page. images: resolved image keys (null = not available). */
export function drawOps(page: PDFPage, ops: readonly PdfOp[], images: ReadonlyMap<string, PDFImage | null>): void {
  const out: PDFOperator[] = [];
  for (const o of ops) {
    switch (o.op) {
      case 'save':
        out.push(pushGraphicsState());
        break;
      case 'restore':
        out.push(popGraphicsState());
        break;
      case 'fillColor':
        out.push(setFillingRgbColor(o.rgb[0], o.rgb[1], o.rgb[2]));
        break;
      case 'strokeColor':
        out.push(setStrokingRgbColor(o.rgb[0], o.rgb[1], o.rgb[2]));
        break;
      case 'alpha':
        out.push(setGraphicsState(alphaState(page, o.value)));
        break;
      case 'lineWidth':
        out.push(setLineWidth(o.w));
        break;
      case 'lineCap':
        out.push(setLineCap(CAPS[o.cap] ?? LineCapStyle.Round));
        break;
      case 'lineJoin':
        out.push(setLineJoin(JOINS[o.join] ?? LineJoinStyle.Round));
        break;
      case 'moveTo':
        out.push(moveTo(o.x, o.y));
        break;
      case 'lineTo':
        out.push(lineTo(o.x, o.y));
        break;
      case 'curveTo':
        out.push(appendBezierCurve(o.x1, o.y1, o.x2, o.y2, o.x, o.y));
        break;
      case 'close':
        out.push(closePath());
        break;
      case 'fill':
        out.push(fill());
        break;
      case 'stroke':
        out.push(stroke());
        break;
      case 'clip':
        out.push(clip(), endPath());
        break;
      case 'image': {
        const img = images.get(o.key) ?? null;
        if (img) {
          const m = o.m;
          out.push(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]), drawObject(imageName(page, o.key, img)), popGraphicsState());
        } else if (o.placeholder) {
          const q = o.placeholder.quad;
          const c = parseHex(o.placeholder.fill).rgb;
          out.push(pushGraphicsState(), setFillingRgbColor(c[0], c[1], c[2]), moveTo(q[0], q[1]));
          for (let i = 2; i + 1 < q.length; i += 2) out.push(lineTo(q[i], q[i + 1]));
          out.push(closePath(), fill(), popGraphicsState());
        }
        break;
      }
    }
  }
  pushAll(page, out);
}

// ===== the document

interface ExportState {
  s: NotebookSession;
  doc: PDFDocument;
  fonts: SkTypefaceFontProvider | null;
  /** Embedded images by request key (null: could not be made). */
  images: Map<string, PDFImage | null>;
  /** Copied PDF pages by export position. */
  copied: Map<number, PDFPage>;
  /** Source PDFs that cannot be copied (their pages are rasterized). */
  badSources: Set<Id>;
  groupFallbackLogged: boolean;
}

function warn(message: string, e?: unknown): void {
  if (__DEV__) console.warn(`[pdfExport] ${message}`, e ?? '');
}

/** Gives a copied page its own Contents array (copies of one page may share an indirect array). */
function unshareContents(page: PDFPage): void {
  const node = page.node;
  const raw = node.get(PDFName.of('Contents'));
  if (!raw) return;
  const resolved = node.context.lookup(raw);
  if (resolved instanceof PDFArray) {
    const fresh = PDFArray.withContext(node.context);
    for (const ref of resolved.asArray()) fresh.push(ref);
    node.set(PDFName.of('Contents'), fresh);
  }
}

/** The visible box of a page: its crop box inside its media box. */
function visibleBox(page: PDFPage): PdfTarget['box'] {
  const mb = page.getMediaBox();
  const cb = page.getCropBox();
  const x0 = Math.max(Math.min(mb.x, mb.x + mb.width), Math.min(cb.x, cb.x + cb.width));
  const y0 = Math.max(Math.min(mb.y, mb.y + mb.height), Math.min(cb.y, cb.y + cb.height));
  const x1 = Math.min(Math.max(mb.x, mb.x + mb.width), Math.max(cb.x, cb.x + cb.width));
  const y1 = Math.min(Math.max(mb.y, mb.y + mb.height), Math.max(cb.y, cb.y + cb.height));
  if (x1 - x0 > 1 && y1 - y0 > 1) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  return { x: Math.min(mb.x, mb.x + mb.width), y: Math.min(mb.y, mb.y + mb.height), w: Math.abs(mb.width), h: Math.abs(mb.height) };
}

/** Prepares a copied PDF page for our ink and returns where the ink goes. */
function prepareCopiedPage(page: PDFPage, extraRotation: number): PdfTarget {
  unshareContents(page);
  // Normalizes Contents into an array, then wraps the original content in q ... Q.
  page.node.normalizedEntries();
  const ctx = page.doc.context;
  page.node.wrapContentStreams(ctx.getPushGraphicsStateContentStream(), ctx.getPopGraphicsStateContentStream());
  const own = reduceRotation(page.getRotation().angle);
  const total = normalizeRotate(own + extraRotation);
  if (total !== own) page.setRotation(degrees(total));
  return { box: visibleBox(page), rotate: total };
}

/**
 * Loads source PDF fileId once and copies every page the export still needs from it (positions
 * >= from), so shared resources (fonts) are copied once per batch. A page used twice is copied in a
 * second batch, so the two copies never share content.
 */
async function copySource(st: ExportState, pages: readonly Page[], from: number, fileId: Id): Promise<void> {
  const asset = st.s.notebook.assets[fileId];
  if (!asset || asset.kind !== 'pdf' || asset.bytes > MAX_SOURCE_PDF_BYTES) {
    st.badSources.add(fileId);
    return;
  }
  try {
    const bytes = await new File(st.s.assetPath(fileId)).bytes();
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    if (src.isEncrypted) {
      st.badSources.add(fileId);
      return;
    }
    const count = src.getPageCount();
    const batches: { positions: number[]; indices: number[] }[] = [];
    for (let i = from; i < pages.length; i++) {
      const bg = pages[i].background;
      if (bg.kind !== 'pdf' || bg.fileId !== fileId || bg.damaged) continue;
      if (!Number.isInteger(bg.pageIndex) || bg.pageIndex < 0 || bg.pageIndex >= count) continue;
      let b = batches.find((x) => !x.indices.includes(bg.pageIndex));
      if (!b) {
        b = { positions: [], indices: [] };
        batches.push(b);
      }
      b.positions.push(i);
      b.indices.push(bg.pageIndex);
    }
    for (const b of batches) {
      const copies = await st.doc.copyPages(src, b.indices);
      b.positions.forEach((pos, k) => st.copied.set(pos, copies[k]));
    }
  } catch (e) {
    warn(`source PDF ${fileId} cannot be copied; its pages are rasterized`, e);
    st.badSources.add(fileId);
  }
}

const PNG_SOURCES = new Set(['png', 'webp', 'gif']);

async function makeImage(st: ExportState, r: ImageRequest): Promise<PDFImage | null> {
  if (r.kind === 'text') {
    const l = layoutText(r.item, st.fonts);
    const h = Math.max(l.height, r.item.box.h);
    const k = Math.max(0.5, Math.min(TEXT_IMAGE_SCALE, 8192 / Math.max(1, l.width), 8192 / Math.max(1, h)));
    const img = renderTextImage(r.item, st.fonts, k);
    if (!img) return null;
    let bytes: Uint8Array;
    try {
      bytes = img.encodeToBytes(ImageFormat.PNG, 100);
    } finally {
      disposeUnseen(img);
    }
    return bytes && bytes.length > 0 ? st.doc.embedPng(bytes) : null;
  }
  if (r.kind === 'pdf') {
    const rendered = await withPdf(st.s.assetPath(r.fileId), (h) => h.renderPage(r.pageIndex, r.widthPx));
    const bytes = await new File(rendered.uri).bytes();
    return bytes.length > 0 ? st.doc.embedJpg(bytes) : null;
  }
  const asset = st.s.notebook.assets[r.fileId];
  if (!asset || asset.kind !== 'image') return null;
  const img = await decodeImageFile(st.s.assetPath(r.fileId), r.maxPx);
  if (!img) return null;
  const png = PNG_SOURCES.has(String(asset.ext).toLowerCase());
  let bytes: Uint8Array;
  try {
    bytes = png ? img.encodeToBytes(ImageFormat.PNG, 100) : img.encodeToBytes(ImageFormat.JPEG, 90);
  } finally {
    disposeUnseen(img);
  }
  if (!bytes || bytes.length === 0) return null;
  return png ? st.doc.embedPng(bytes) : st.doc.embedJpg(bytes);
}

async function resolveImages(st: ExportState, requests: readonly ImageRequest[]): Promise<void> {
  for (const r of requests) {
    if (st.images.has(r.key)) continue;
    try {
      st.images.set(r.key, await makeImage(st, r));
    } catch (e) {
      warn(`image ${r.key} cannot be exported`, e);
      st.images.set(r.key, null);
    }
  }
}

/**
 * Marks an embedded page (form XObject) as an ISOLATED transparency group, so its opacity applies to
 * it as a whole, exactly like Skia's saveLayer (which is isolated too).
 */
function markTransparencyGroup(doc: PDFDocument, ref: PDFImage['ref']): void {
  const stream = doc.context.lookup(ref, PDFStream);
  stream.dict.set(PDFName.of('Group'), doc.context.obj({ Type: 'Group', S: 'Transparency', CS: 'DeviceRGB', I: true }));
}

/**
 * embedPage copies the scratch page into the export document, its content streams included, and the
 * form XObject then gets the DECODED content: the copied streams stay behind unreferenced and would
 * be saved as a second copy of the page's highlights. Deletes the streams registered while embedding
 * (object numbers after firstNew) that are neither the form XObject nor the document's shared q / Q
 * streams. The scratch page's resources are direct objects, so nothing else is left behind.
 */
function dropEmbedLeftovers(doc: PDFDocument, firstNew: number, keep: PDFRef): void {
  const ctx = doc.context;
  const last = ctx.largestObjectNumber;
  const shared = new Set([keep.objectNumber, ctx.getPushGraphicsStateContentStream().objectNumber, ctx.getPopGraphicsStateContentStream().objectNumber]);
  const TYPE = PDFName.of('Type');
  for (let n = firstNew + 1; n <= last; n++) {
    if (shared.has(n)) continue;
    const ref = PDFRef.of(n);
    const obj = ctx.lookup(ref);
    if (obj instanceof PDFStream && !obj.dict.has(TYPE)) ctx.delete(ref);
  }
}

/**
 * Draws the highlighter group ONCE at HIGHLIGHTER_GROUP_OPACITY: opaque on the page of a scratch
 * document with the target's media box, embedded as a transparency group, then one drawPage at the
 * identity placement (the ops are already in the target's user space). The scratch document is made
 * per group and dropped right after embedding (embedPage copies what it needs), so a long export
 * does not keep a second copy of every page's highlights in memory.
 */
async function drawHighlighterGroup(st: ExportState, target: PDFPage, ops: readonly PdfOp[]): Promise<void> {
  try {
    const scratch = await PDFDocument.create({ updateMetadata: false });
    const mb = target.getMediaBox();
    const sp = scratch.addPage([Math.abs(mb.width), Math.abs(mb.height)]);
    sp.setMediaBox(mb.x, mb.y, mb.width, mb.height);
    drawOps(sp, ops, new Map());
    const left = Math.min(mb.x, mb.x + mb.width);
    const bottom = Math.min(mb.y, mb.y + mb.height);
    const firstNew = st.doc.context.largestObjectNumber;
    const embedded = await st.doc.embedPage(sp, { left, bottom, right: left + Math.abs(mb.width), top: bottom + Math.abs(mb.height) }, [1, 0, 0, 1, 0, 0]);
    await embedded.embed();
    dropEmbedLeftovers(st.doc, firstNew, embedded.ref);
    markTransparencyGroup(st.doc, embedded.ref);
    target.drawPage(embedded, { x: 0, y: 0, xScale: 1, yScale: 1, opacity: HIGHLIGHTER_GROUP_OPACITY });
  } catch (e) {
    if (!st.groupFallbackLogged) {
      st.groupFallbackLogged = true;
      warn('highlighter group could not be embedded; drawing it at constant alpha', e);
    }
    drawOps(target, [{ op: 'save' }, { op: 'alpha', value: HIGHLIGHTER_GROUP_OPACITY }, ...ops, { op: 'restore' }], new Map());
  }
}

async function exportPage(st: ExportState, pages: readonly Page[], i: number): Promise<void> {
  const page = pages[i];
  const bg = page.background;
  let target: PdfTarget;
  let pdfPage: PDFPage;
  let mode: 'source' | 'raster' = 'source';
  if (bg.kind === 'pdf' && !bg.damaged) {
    if (!st.copied.has(i) && !st.badSources.has(bg.fileId)) await copySource(st, pages, i, bg.fileId);
    const copy = st.copied.get(i);
    if (copy) {
      st.copied.delete(i);
      pdfPage = st.doc.addPage(copy);
      target = prepareCopiedPage(pdfPage, bg.rotation);
    } else {
      mode = 'raster';
      pdfPage = st.doc.addPage([page.size.w, page.size.h]);
      target = blankTarget(page.size);
    }
  } else {
    pdfPage = st.doc.addPage([page.size.w, page.size.h]);
    target = blankTarget(page.size);
  }

  const ops = buildPageOps(page, target, {
    pdfBackground: mode,
    textSize: (t: TextItem) => {
      const l = layoutText(t, st.fonts);
      return { w: l.width, h: Math.max(l.height, t.box.h) };
    },
  });
  await resolveImages(st, ops.images);
  drawOps(pdfPage, ops.under, st.images);
  if (ops.highlighterGroup.length > 0) await drawHighlighterGroup(st, pdfPage, ops.highlighterGroup);
  drawOps(pdfPage, ops.over, st.images);
}

/**
 * Exports the pages of `o.range` as a PDF file in the cache and resolves to its file:// URI.
 * Rejects with ExportError ('aborted' | 'no-space' | 'empty' | 'unsupported') or the underlying error.
 */
export const exportPdf: ExportPdf = async (s: NotebookSession, o: ExportPdfOptions) => {
  if (!notebookSupported) throw new ExportError('unsupported');
  const nb = s.notebook;
  const indices = resolvePageRange(o.range, nb.pageIds.length, o.currentIndex);
  if (indices.length === 0) throw new ExportError('empty');
  const checkAbort = () => {
    if (o.signal?.aborted) throw new ExportError('aborted');
  };
  const total = indices.length + 1;
  o.onProgress?.(0, total);

  const pages: Page[] = [];
  for (const index of indices) {
    checkAbort();
    const pid = nb.pageIds[index];
    pages.push(s.getPage(pid) ?? (await s.loadPage(pid)));
  }

  const free = freeSpace();
  if (free !== null && free < estimatePdfBytes(nb, pages) * 2 + SPACE_MARGIN) throw new ExportError('no-space');

  const fonts = pages.some((p) => p.items.some((it) => it.kind === 'text')) ? await loadNotebookFonts() : null;
  const doc = await PDFDocument.create({ updateMetadata: false });
  const now = new Date();
  doc.setTitle(nb.title || tr('مذكرة', 'Notebook'));
  doc.setCreator('QU Student');
  doc.setProducer('QU Student');
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  const st: ExportState = {
    s,
    doc,
    fonts,
    images: new Map(),
    copied: new Map(),
    badSources: new Set(),
    groupFallbackLogged: false,
  };

  for (let i = 0; i < pages.length; i++) {
    checkAbort();
    await exportPage(st, pages, i);
    o.onProgress?.(i + 1, total);
    await yieldToUi();
  }
  checkAbort();

  const bytes = await doc.save({ useObjectStreams: true, objectsPerTick: 50 });
  checkAbort();
  const uri = await writeExportFile(notebookFileName(nb, 'pdf'), bytes);
  if (o.signal?.aborted) {
    discardExportFile(uri);
    throw new ExportError('aborted');
  }
  o.onProgress?.(total, total);
  return uri;
};
