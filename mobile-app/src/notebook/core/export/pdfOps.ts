/**
 * Vector PDF export ops (NB-70): one notebook page as PDF drawing operations, in the data model's
 * DRAW ORDER (core/model/types.ts), split the way the exporter composites them:
 *
 *   under             1 the background: paper from patternFor (the same lines as the screen), the
 *                       paper fill + photo of an image page, or nothing for a PDF page (the original
 *                       page is copied with copyPages, so its text stays selectable); a damaged PDF
 *                       page gets the neutral placeholder the canvas shows
 *                     2 image items, in array order
 *   highlighterGroup  3 highlighter strokes and highlighter shapes, drawn OPAQUE; the exporter puts
 *                       them in ONE transparency group composited at HIGHLIGHTER_GROUP_OPACITY (0.35),
 *                       exactly like the screen's saveLayer, so overlapping highlights do not darken
 *   over              4 every other item (pen strokes, other shapes, text), in array order
 *
 * Geometry matches the Skia painter (src/notebook/ink/items.ts) item for item:
 * - strokes: the freehand outline of THE stroke style strokeOptions(item, true), as the quadratic
 *   outline curve of core/ink/outline.ts (the curve outlineToSvgPath writes), converted to cubic
 *   Béziers, filled with the nonzero rule
 * - shapes: shapeOutline centerlines stroked with round caps and joins, filled first when item.fill is
 *   set; ellipses are true rotated ovals (4 Béziers); arrows are a stroked shaft plus a FILLED head;
 *   a one-point shape is a dot of the stroke width
 * - text: an image (the exporter renders it with Skia at 4x through layoutText) placed over the box,
 *   rotated about the box center
 * - images: the asset over the box, cropped (item.crop, 0..1 of the source) with a clip path
 *
 * COORDINATES. Notebook pages are in points, origin top-left, y down, as DISPLAYED. A PDF page's
 * user space has y up, its origin wherever the crop box says, and the viewer turns it clockwise by
 * /Rotate. pageToPdfMatrix maps one onto the other (y flip, crop box origin, rotation, and a scale
 * when the page size and the crop box differ), and every coordinate below is already mapped: the ops
 * are in PDF user space and need no extra transform. Image ops carry their full matrix (cm) for the
 * unit square of the image.
 *
 * Pure core: no Skia, no pdf-lib. The exporter (src/notebook/export/pdfExport.ts) turns the ops into
 * pdf-lib operators and resolves `images`.
 */
import { getStroke, strokeOptions } from '../ink/freehand.ts';
import { shapeOutline } from '../ink/bounds.ts';
import { outlineToCommands } from '../ink/outline.ts';
import type { Box, Hex, ImageItem, Page, PageItem, PaperSpec, ShapeItem, Size, StrokeItem, TextItem } from '../model/index.ts';
import { patternFor } from '../paper/pattern.ts';

/** Composite opacity of the highlighter group (the painter's HIGHLIGHTER_ALPHA). */
export const HIGHLIGHTER_GROUP_OPACITY = 0.35;

/** Fill of an image item whose image cannot be read (the painter's IMAGE_PLACEHOLDER_FILL). */
export const IMAGE_PLACEHOLDER: Hex = '#E3E9F0';

/** Fill and border of a damaged PDF page (the painter's paintPdfPlaceholder). */
export const PDF_PLACEHOLDER_FILL: Hex = '#F3F6F9';
export const PDF_PLACEHOLDER_BORDER: Hex = '#DCE4EC';

/** Pixels per point asset images are exported at (about 216 dpi), and the cap on their long side. */
export const EXPORT_IMAGE_PX_PER_PT = 3;
export const EXPORT_IMAGE_MAX_PX = 3072;
/** Pixels per point of a rasterized PDF background (the fallback when the original cannot be copied). */
export const EXPORT_RASTER_PX_PER_PT = 2;
/** Largest bitmap side the renderers make. */
export const EXPORT_MAX_BITMAP_PX = 8192;

/** Bézier circle constant: 4 (sqrt 2 - 1) / 3. */
const KAPPA = 0.5522847498307936;

// ===== matrices

/** A PDF matrix [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f (the `cm` operator's order). */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** multiply(a, b) = a ∘ b: applies b FIRST, then a. */
export function multiply(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y];
}

/** Rotation by rad in the y-down page space (positive = clockwise on screen, as Skia's rotate). */
export function rotate(rad: number): Mat {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

/** Rotation by rad about (cx, cy). */
export function rotateAbout(rad: number, cx: number, cy: number): Mat {
  if (!rad) return IDENTITY;
  return multiply(translate(cx, cy), multiply(rotate(rad), translate(-cx, -cy)));
}

export function applyMat(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** How much m scales lengths (sqrt of |det|), for line widths. */
export function matScale(m: Mat): number {
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/** Rounds to 1/1000 pt: smaller files, far below what anyone can see. */
function r3(v: number): number {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
}

function roundMat(m: Mat): Mat {
  return [Math.round(m[0] * 1e6) / 1e6, Math.round(m[1] * 1e6) / 1e6, Math.round(m[2] * 1e6) / 1e6, Math.round(m[3] * 1e6) / 1e6, r3(m[4]), r3(m[5])];
}

// ===== the PDF page a notebook page lands on

export type PdfRotate = 0 | 90 | 180 | 270;

/** A rectangle in PDF user space (y up), as a crop box: lower-left corner plus size. */
export interface PdfBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The PDF page a notebook page is drawn on: its crop box and its (total) /Rotate. */
export interface PdfTarget {
  box: PdfBox;
  rotate: PdfRotate;
}

/** A blank target page for a notebook page of `size` (media box 0 0 w h, no rotation). */
export function blankTarget(size: Size): PdfTarget {
  return { box: { x: 0, y: 0, w: size.w, h: size.h }, rotate: 0 };
}

/** Any angle as 0, 90, 180 or 270 (multiples of 90, clockwise, as /Rotate). */
export function normalizeRotate(deg: number): PdfRotate {
  const d = Number.isFinite(deg) ? Math.round(deg / 90) * 90 : 0;
  const r = ((d % 360) + 360) % 360;
  return (r === 90 || r === 180 || r === 270 ? r : 0) as PdfRotate;
}

/** The size a viewer shows the target at (the crop box turned by /Rotate). */
export function displayedSize(t: PdfTarget): Size {
  return t.rotate === 90 || t.rotate === 270 ? { w: t.box.h, h: t.box.w } : { w: t.box.w, h: t.box.h };
}

/**
 * The matrix from notebook page points (top-left origin, y down, as displayed) to the target's PDF
 * user space. The notebook page is stretched over the displayed crop box (a scale of 1 when the
 * sizes match, as they do for imported pages).
 */
export function pageToPdfMatrix(size: Size, t: PdfTarget): Mat {
  const d = displayedSize(t);
  const sx = size.w > 0 && d.w > 0 ? d.w / size.w : 1;
  const sy = size.h > 0 && d.h > 0 ? d.h / size.h : 1;
  const { x: cx, y: cy, w: cw, h: ch } = t.box;
  switch (t.rotate) {
    case 90:
      // display (dx, dy) -> user (cx + dy, cy + dx)
      return [0, sx, sy, 0, cx, cy];
    case 180:
      return [-sx, 0, 0, sy, cx + cw, cy];
    case 270:
      return [0, -sx, -sy, 0, cx + cw, cy + ch];
    default:
      return [sx, 0, 0, -sy, cx, cy + ch];
  }
}

// ===== colors

export type Rgb = [number, number, number];

/** '#RRGGBB' or '#RRGGBBAA' as 0..1 channels and alpha (black for anything else). */
export function parseHex(hex: Hex | string | null | undefined): { rgb: Rgb; alpha: number } {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex ?? '').trim());
  if (!m) return { rgb: [0, 0, 0], alpha: 1 };
  const v = parseInt(m[1], 16);
  const ch = (n: number) => Math.round((n / 255) * 10000) / 10000;
  return { rgb: [ch((v >> 16) & 255), ch((v >> 8) & 255), ch(v & 255)], alpha: m[2] ? ch(parseInt(m[2], 16)) : 1 };
}

// ===== ops

export type PdfOp =
  | { op: 'save' }
  | { op: 'restore' }
  | { op: 'fillColor'; rgb: Rgb }
  | { op: 'strokeColor'; rgb: Rgb }
  /** Constant alpha for fills and strokes (an ExtGState with ca and CA). */
  | { op: 'alpha'; value: number }
  | { op: 'lineWidth'; w: number }
  /** 0 butt, 1 round, 2 square. */
  | { op: 'lineCap'; cap: 0 | 1 | 2 }
  /** 0 miter, 1 round, 2 bevel. */
  | { op: 'lineJoin'; join: 0 | 1 | 2 }
  | { op: 'moveTo'; x: number; y: number }
  | { op: 'lineTo'; x: number; y: number }
  | { op: 'curveTo'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'close' }
  /** Fill the path (nonzero). */
  | { op: 'fill' }
  | { op: 'stroke' }
  /** Intersect the clip with the path (W n). */
  | { op: 'clip' }
  /**
   * Draw image `key` (an ImageRequest) with matrix m for its unit square. When the image cannot be
   * made, the exporter fills `placeholder.quad` (4 corners, PDF space) with placeholder.fill instead,
   * or draws nothing when placeholder is null.
   */
  | { op: 'image'; key: string; m: Mat; placeholder: { fill: Hex; quad: number[] } | null };

/** An image an image op needs. Keys are unique per distinct image (and size). */
export type ImageRequest =
  | { kind: 'asset'; key: string; fileId: string; maxPx: number }
  | { kind: 'text'; key: string; item: TextItem }
  | { kind: 'pdf'; key: string; fileId: string; pageIndex: number; widthPx: number };

export interface PageOps {
  /** Notebook page points -> PDF user space (already applied to every op). */
  matrix: Mat;
  under: PdfOp[];
  /** Opaque: composite as ONE group at HIGHLIGHTER_GROUP_OPACITY. Empty when the page has no highlights. */
  highlighterGroup: PdfOp[];
  over: PdfOp[];
  /** Images the ops reference, unique by key, in first-use order. */
  images: ImageRequest[];
}

export interface PageOpsOptions {
  /**
   * How a PDF background is exported: 'source' (default) draws nothing, because the original page IS
   * the target (copyPages); 'raster' draws a rendered image of it (ImageRequest kind 'pdf');
   * 'placeholder' the neutral fill. A damaged background is always the placeholder.
   */
  pdfBackground?: 'source' | 'raster' | 'placeholder';
  /** Size in points of a text item's image (the Skia layout: wrap width x max(height, box.h)). Default box.w x box.h. */
  textSize?: (item: TextItem) => Size | null;
  /** Asset image resolution (default EXPORT_IMAGE_PX_PER_PT) and long-side cap (default EXPORT_IMAGE_MAX_PX). */
  imagePxPerPt?: number;
  maxImagePx?: number;
  /** PDF raster resolution (default EXPORT_RASTER_PX_PER_PT). */
  rasterPxPerPt?: number;
}

/** True for the items of the highlighter group (draw order step 3). */
export function isHighlighterItem(item: PageItem): boolean {
  return (item.kind === 'stroke' && item.tool === 'highlighter') || (item.kind === 'shape' && item.highlighter === true);
}

/** Collects ops with the page matrix applied to every point. */
class OpWriter {
  readonly ops: PdfOp[] = [];
  readonly m: Mat;
  private cx = 0;
  private cy = 0;

  constructor(m: Mat) {
    this.m = m;
  }

  push(op: PdfOp): void {
    this.ops.push(op);
  }

  /** A point given in page space (or in local space through `local`). */
  private pt(x: number, y: number, local: Mat | null): [number, number] {
    const p = local ? applyMat(local, x, y) : [x, y];
    const q = applyMat(this.m, p[0], p[1]);
    return [r3(q[0]), r3(q[1])];
  }

  moveTo(x: number, y: number, local: Mat | null = null): void {
    const [X, Y] = this.pt(x, y, local);
    this.ops.push({ op: 'moveTo', x: X, y: Y });
    this.cx = x;
    this.cy = y;
  }

  lineTo(x: number, y: number, local: Mat | null = null): void {
    const [X, Y] = this.pt(x, y, local);
    this.ops.push({ op: 'lineTo', x: X, y: Y });
    this.cx = x;
    this.cy = y;
  }

  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number, local: Mat | null = null): void {
    const a = this.pt(x1, y1, local);
    const b = this.pt(x2, y2, local);
    const c = this.pt(x, y, local);
    this.ops.push({ op: 'curveTo', x1: a[0], y1: a[1], x2: b[0], y2: b[1], x: c[0], y: c[1] });
    this.cx = x;
    this.cy = y;
  }

  /** A quadratic segment from the current point, as the equivalent cubic. */
  quadTo(qx: number, qy: number, x: number, y: number, local: Mat | null = null): void {
    const x0 = this.cx;
    const y0 = this.cy;
    this.curveTo(x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y, local);
  }

  close(): void {
    this.ops.push({ op: 'close' });
  }

  /** The PDF-space corners of a local rectangle (0, 0, w, h). */
  quad(local: Mat, w: number, h: number): number[] {
    const out: number[] = [];
    for (const [x, y] of [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ]) {
      const p = this.pt(x, y, local);
      out.push(p[0], p[1]);
    }
    return out;
  }
}

/** Runs body between save/restore with the color's alpha (and any extra alpha) applied. */
function paintBlock(w: OpWriter, alpha: number, body: () => void): void {
  w.push({ op: 'save' });
  const a = Math.min(1, Math.max(0, alpha));
  if (a < 1) w.push({ op: 'alpha', value: Math.round(a * 10000) / 10000 });
  body();
  w.push({ op: 'restore' });
}

function fillPath(w: OpWriter, color: Hex, path: () => void): void {
  const c = parseHex(color);
  if (c.alpha <= 0) return;
  paintBlock(w, c.alpha, () => {
    w.push({ op: 'fillColor', rgb: c.rgb });
    path();
    w.push({ op: 'fill' });
  });
}

function strokePath(w: OpWriter, color: Hex, width: number, cap: 0 | 1 | 2, join: 0 | 1 | 2, path: () => void): void {
  const c = parseHex(color);
  if (c.alpha <= 0) return;
  paintBlock(w, c.alpha, () => {
    w.push({ op: 'strokeColor', rgb: c.rgb });
    w.push({ op: 'lineWidth', w: r3(width * matScale(w.m)) });
    w.push({ op: 'lineCap', cap });
    w.push({ op: 'lineJoin', join });
    path();
    w.push({ op: 'stroke' });
  });
}

/** Adds the polyline / polygon pts (flat x, y in page space) to the current path. */
function polyPath(w: OpWriter, pts: ArrayLike<number>, closed: boolean): void {
  const n = Math.floor(pts.length / 2);
  for (let i = 0; i < n; i++) {
    if (i === 0) w.moveTo(pts[0], pts[1]);
    else w.lineTo(pts[i * 2], pts[i * 2 + 1]);
  }
  if (closed && n > 0) w.close();
}

/** An axis-aligned ellipse inscribed in (0, 0, ew, eh) of `local`, as 4 Béziers. */
function ellipsePath(w: OpWriter, local: Mat, ew: number, eh: number): void {
  const rx = ew / 2;
  const ry = eh / 2;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  // centered at (rx, ry) of the local box
  w.moveTo(ew, ry, local);
  w.curveTo(ew, ry + oy, rx + ox, eh, rx, eh, local);
  w.curveTo(rx - ox, eh, 0, ry + oy, 0, ry, local);
  w.curveTo(0, ry - oy, rx - ox, 0, rx, 0, local);
  w.curveTo(rx + ox, 0, ew, ry - oy, ew, ry, local);
  w.close();
}

/** A circle of radius r at (x, y) in page space. */
function circlePath(w: OpWriter, x: number, y: number, r: number): void {
  ellipsePath(w, translate(x - r, y - r), r * 2, r * 2);
}

/** The local frame of a box: (0, 0) at the unrotated top-left, rotated about the box center. */
function boxFrame(b: Box): Mat {
  return multiply(rotateAbout(Number.isFinite(b.rot) ? b.rot : 0, b.x + b.w / 2, b.y + b.h / 2), translate(b.x, b.y));
}

/** Image unit square -> a (0, 0, w, h) rectangle with the image upright (PDF images have y up). */
function unitToRect(w: number, h: number): Mat {
  return [w, 0, 0, -h, 0, h];
}

// ===== items

function writeStroke(w: OpWriter, s: StrokeItem): void {
  const pts = Array.isArray(s.pts) ? s.pts : [];
  if (pts.length < 3) return;
  const cmds = outlineToCommands(getStroke(pts, strokeOptions(s, true)), true);
  if (cmds.length === 0) return;
  fillPath(w, s.color, () => {
    for (const c of cmds) {
      if (c[0] === 0) w.moveTo(c[1], c[2]);
      else if (c[0] === 1) w.lineTo(c[1], c[2]);
      else if (c[0] === 2) w.quadTo(c[1], c[2], c[3], c[4]);
      else w.close();
    }
  });
}

function writeShape(w: OpWriter, s: ShapeItem): void {
  const width = Number.isFinite(s.width) && s.width > 0 ? s.width : 1;
  if (s.shape === 'ellipse' && s.box) {
    const b = s.box;
    const local = boxFrame(b);
    if (s.fill) fillPath(w, s.fill, () => ellipsePath(w, local, b.w, b.h));
    strokePath(w, s.color, width, 1, 1, () => ellipsePath(w, local, b.w, b.h));
    return;
  }
  const o = shapeOutline(s);
  const n = Math.floor(o.pts.length / 2);
  if (n === 0) return;
  if (s.shape === 'arrow' && n === 5) {
    // the shaft, then the head triangle (left barb, tip, right barb), filled and stroked
    strokePath(w, s.color, width, 1, 1, () => polyPath(w, o.pts.slice(0, 4), false));
    const head = o.pts.slice(4, 10);
    fillPath(w, s.color, () => polyPath(w, head, true));
    strokePath(w, s.color, width, 1, 1, () => polyPath(w, head, true));
    return;
  }
  if (n === 1) {
    // a dot: what a zero-length line with round caps draws
    fillPath(w, s.color, () => circlePath(w, o.pts[0], o.pts[1], width / 2));
    return;
  }
  if (s.fill && o.closed) fillPath(w, s.fill, () => polyPath(w, o.pts, true));
  strokePath(w, s.color, width, 1, 1, () => polyPath(w, o.pts, o.closed));
}

interface ImageSink {
  add(r: ImageRequest): void;
}

function writeText(w: OpWriter, t: TextItem, o: PageOpsOptions, images: ImageSink): void {
  if (!t.text || !t.box) return;
  const size = o.textSize?.(t) ?? { w: t.box.w, h: t.box.h };
  if (!(size.w > 0 && size.h > 0)) return;
  const key = `text:${t.id}`;
  images.add({ kind: 'text', key, item: t });
  w.push({ op: 'image', key, m: roundMat(multiply(w.m, multiply(boxFrame(t.box), unitToRect(size.w, size.h)))), placeholder: null });
}

/** Long side in px for an image shown `longPt` points long (rounded up to 256 px steps, capped). */
function imagePx(longPt: number, o: PageOpsOptions): number {
  const k = Number.isFinite(o.imagePxPerPt) && (o.imagePxPerPt as number) > 0 ? (o.imagePxPerPt as number) : EXPORT_IMAGE_PX_PER_PT;
  const cap = Number.isFinite(o.maxImagePx) && (o.maxImagePx as number) > 0 ? (o.maxImagePx as number) : EXPORT_IMAGE_MAX_PX;
  const need = Math.max(1, Math.ceil(longPt * k));
  return Math.max(1, Math.min(cap, Math.ceil(need / 256) * 256));
}

function writeImage(w: OpWriter, it: ImageItem, o: PageOpsOptions, images: ImageSink): void {
  const b = it.box;
  if (!b || !(b.w > 0 && b.h > 0)) return;
  const local = boxFrame(b);
  const cr = it.crop;
  const cropped = !!cr && cr.w > 0 && cr.h > 0;
  const fraction = cropped ? Math.max(0.05, Math.min(cr.w, cr.h)) : 1;
  const maxPx = imagePx(Math.max(b.w, b.h) / fraction, o);
  const key = `asset:${it.fileId}:${maxPx}`;
  images.add({ kind: 'asset', key, fileId: it.fileId, maxPx });
  const placeholder = { fill: IMAGE_PLACEHOLDER, quad: w.quad(local, b.w, b.h) };
  if (!cropped) {
    w.push({ op: 'image', key, m: roundMat(multiply(w.m, multiply(local, unitToRect(b.w, b.h)))), placeholder });
    return;
  }
  // The whole image is laid out so that the crop rectangle lands on the box, then clipped to the box.
  const x0 = Math.max(0, cr.x);
  const y0 = Math.max(0, cr.y);
  const fw = Math.min(1, cr.w);
  const fh = Math.min(1, cr.h);
  const W = b.w / fw;
  const H = b.h / fh;
  w.push({ op: 'save' });
  w.moveTo(0, 0, local);
  w.lineTo(b.w, 0, local);
  w.lineTo(b.w, b.h, local);
  w.lineTo(0, b.h, local);
  w.close();
  w.push({ op: 'clip' });
  w.push({ op: 'image', key, m: roundMat(multiply(w.m, multiply(local, multiply(translate(-x0 * W, -y0 * H), unitToRect(W, H))))), placeholder });
  w.push({ op: 'restore' });
}

// ===== background

/** Size of the PDF page (as rendered) behind a page of `size` shown at `rotation` (w and h swap for 90/270). */
export function pdfSizeOf(size: Size, rotation: number): Size {
  return rotation === 90 || rotation === 270 ? { w: size.h, h: size.w } : { w: size.w, h: size.h };
}

/** Page-space transform that places the rendered PDF page (pdfSizeOf) on the page: translate, then rotate clockwise. */
export function pdfRotationMatrix(size: Size, rotation: number): Mat {
  switch (rotation) {
    case 90:
      return multiply(translate(size.w, 0), rotate(Math.PI / 2));
    case 180:
      return multiply(translate(size.w, size.h), rotate(Math.PI));
    case 270:
      return multiply(translate(0, size.h), rotate((3 * Math.PI) / 2));
    default:
      return IDENTITY;
  }
}

function rectPath(w: OpWriter, x: number, y: number, rw: number, rh: number): void {
  w.moveTo(x, y);
  w.lineTo(x + rw, y);
  w.lineTo(x + rw, y + rh);
  w.lineTo(x, y + rh);
  w.close();
}

function writePaper(w: OpWriter, page: Page, paper: PaperSpec, lines: boolean): void {
  const { w: pw, h: ph } = page.size;
  const pat = patternFor(paper, page.size);
  fillPath(w, pat.fill, () => rectPath(w, 0, 0, pw, ph));
  if (!lines) return;
  if (pat.lines.length > 0) {
    strokePath(w, pat.lineColor, pat.lineWidth, 0, 0, () => {
      for (const l of pat.lines) {
        w.moveTo(l.x1, l.y1);
        w.lineTo(l.x2, l.y2);
      }
    });
  }
  if (pat.dots.length > 0) {
    fillPath(w, pat.lineColor, () => {
      for (const d of pat.dots) circlePath(w, d.x, d.y, d.r);
    });
  }
  if (pat.margin) {
    const mg = pat.margin;
    strokePath(w, mg.color, mg.width, 0, 0, () => {
      w.moveTo(mg.x, 0);
      w.lineTo(mg.x, ph);
    });
  }
}

function writePdfPlaceholder(w: OpWriter, page: Page): void {
  const { w: pw, h: ph } = page.size;
  fillPath(w, PDF_PLACEHOLDER_FILL, () => rectPath(w, 0, 0, pw, ph));
  strokePath(w, PDF_PLACEHOLDER_BORDER, 1, 0, 0, () => rectPath(w, 0.5, 0.5, Math.max(0, pw - 1), Math.max(0, ph - 1)));
}

function writeBackground(w: OpWriter, page: Page, o: PageOpsOptions, images: ImageSink): void {
  const bg = page.background;
  if (bg.kind === 'paper') {
    writePaper(w, page, bg.paper, true);
    return;
  }
  if (bg.kind === 'pdf') {
    const mode = bg.damaged ? 'placeholder' : (o.pdfBackground ?? 'source');
    if (mode === 'source') return;
    if (mode === 'placeholder') {
      writePdfPlaceholder(w, page);
      return;
    }
    const pdf = pdfSizeOf(page.size, bg.rotation);
    const kRaw = Number.isFinite(o.rasterPxPerPt) && (o.rasterPxPerPt as number) > 0 ? (o.rasterPxPerPt as number) : EXPORT_RASTER_PX_PER_PT;
    const k = Math.min(kRaw, EXPORT_MAX_BITMAP_PX / Math.max(1, pdf.w), EXPORT_MAX_BITMAP_PX / Math.max(1, pdf.h));
    const widthPx = Math.max(1, Math.min(EXPORT_MAX_BITMAP_PX, Math.round(pdf.w * k)));
    const key = `pdf:${bg.fileId}:${bg.pageIndex}:${widthPx}`;
    images.add({ kind: 'pdf', key, fileId: bg.fileId, pageIndex: bg.pageIndex, widthPx });
    // White under the page (a PDF page with no background of its own is transparent), as on screen.
    fillPath(w, '#FFFFFF', () => rectPath(w, 0, 0, page.size.w, page.size.h));
    const local = pdfRotationMatrix(page.size, bg.rotation);
    w.push({
      op: 'image',
      key,
      m: roundMat(multiply(w.m, multiply(local, unitToRect(pdf.w, pdf.h)))),
      placeholder: { fill: PDF_PLACEHOLDER_FILL, quad: w.quad(local, pdf.w, pdf.h) },
    });
    return;
  }
  // A photo or scan page: its paper fill, then the image over the whole page.
  writePaper(w, page, bg.paper, false);
  const maxPx = imagePx(Math.max(page.size.w, page.size.h), o);
  const key = `asset:${bg.fileId}:${maxPx}`;
  images.add({ kind: 'asset', key, fileId: bg.fileId, maxPx });
  w.push({ op: 'image', key, m: roundMat(multiply(w.m, unitToRect(page.size.w, page.size.h))), placeholder: null });
}

// ===== a page

/** The ops of one notebook page drawn on `target` (see the file comment). */
export function buildPageOps(page: Page, target: PdfTarget, o: PageOpsOptions = {}): PageOps {
  const matrix = pageToPdfMatrix(page.size, target);
  const seen = new Map<string, ImageRequest>();
  const images: ImageSink = {
    add(r) {
      if (!seen.has(r.key)) seen.set(r.key, r);
    },
  };

  const under = new OpWriter(matrix);
  writeBackground(under, page, o, images);
  for (const it of page.items) if (it.kind === 'image') writeImage(under, it, o, images);

  const group = new OpWriter(matrix);
  for (const it of page.items) {
    if (!isHighlighterItem(it)) continue;
    if (it.kind === 'stroke') writeStroke(group, it);
    else if (it.kind === 'shape') writeShape(group, it);
  }

  const over = new OpWriter(matrix);
  for (const it of page.items) {
    if (it.kind === 'image' || isHighlighterItem(it)) continue;
    if (it.kind === 'stroke') writeStroke(over, it);
    else if (it.kind === 'shape') writeShape(over, it);
    else if (it.kind === 'text') writeText(over, it, o, images);
  }

  return { matrix, under: under.ops, highlighterGroup: group.ops, over: over.ops, images: [...seen.values()] };
}

/** Number of ops across the three layers (progress weighting, tests). */
export function opCount(p: PageOps): number {
  return p.under.length + p.highlighterGroup.length + p.over.length;
}
