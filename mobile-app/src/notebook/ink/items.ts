/**
 * drawItem: the ONE way a page item is drawn. paintPage, buildPagePictures, appendStrokePicture,
 * renderPageImage (thumbnails, PNG export) all come through here, so the canvas, the pages grid and
 * the exports look the same. Drawing is in page points; the caller sets the canvas matrix.
 *
 * - Strokes: the freehand outline of core/ink/freehand.ts with THE stroke style strokeOptions(item,
 *   last = true) (pen with pressure 0.5x..1.5x, pen without pressure and highlighter constant width,
 *   round caps), turned into quads by outlineToCommands and filled (nonzero). The outline commands are
 *   cached per item object (items are immutable: every edit makes a new object).
 * - Shapes: the centerline of core/ink/bounds.ts shapeOutline, stroked with round caps and joins at
 *   item.width, filled first when item.fill is set. Ellipses are drawn as true ovals (rotated with the
 *   box); arrows are a stroked shaft plus a FILLED head triangle (left barb, tip, right barb) stroked
 *   with the same width, which the PDF export (P23) matches.
 * - Text: layoutText (textLayout.ts) painted at the box, rotated about its center by box.rot.
 * - Images: ctx.image(fileId) into the box (rotated by box.rot), cropped by item.crop (0..1 of the
 *   source); a light placeholder while the image is not decoded.
 * - alpha multiplies the item's own color alpha (playback dimming passes 0.28). Highlighter items are
 *   drawn OPAQUE here: their see-through look comes from the highlighter group layer (pictures.ts).
 *
 * JS runtime only (see imageBudget.ts). Paths and paints made here are disposed before returning.
 */
import {
  FilterMode,
  MipmapMode,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkCanvas,
  type SkImage,
  type SkPaint,
  type SkPath,
  type SkTypefaceFontProvider,
} from '@shopify/react-native-skia';

import { shapeOutline } from '@/notebook/core/ink/bounds';
import { getStroke, strokeOptions } from '@/notebook/core/ink/freehand';
import { outlineToCommands, polygonToCommands } from '@/notebook/core/ink/outline';
import type { Id, ImageItem, PageItem, ShapeItem, StrokeItem, TextItem } from '@/notebook/core/model';

import { layoutText, paintTextLayout } from './textLayout';

/** What the painter needs beyond the page itself. */
export interface PaintContext {
  /** Decoded image asset (image items, photo/scan backgrounds), or null while not decoded. */
  image(fileId: Id): SkImage | null;
  /** Decoded PDF page image (whole page), or null. */
  pdfPreview(fileId: Id, pageIndex: number): SkImage | null;
  /** Text box fonts (useNotebookFonts / loadNotebookFonts), or null for the system fallback. */
  fonts: SkTypefaceFontProvider | null;
}

/** A context that draws no images (placeholders) and text with the fallback font. */
export const EMPTY_PAINT_CONTEXT: PaintContext = { image: () => null, pdfPreview: () => null, fonts: null };

/** Fill of an image item whose image is not decoded. */
export const IMAGE_PLACEHOLDER_FILL = '#E3E9F0';

/** True for the items of the highlighter group (draw order step 3). */
export function isHighlighterItem(item: PageItem): boolean {
  return (item.kind === 'stroke' && item.tool === 'highlighter') || (item.kind === 'shape' && item.highlighter === true);
}

const strokeCmds = new WeakMap<StrokeItem, number[][]>();

/** Skia path commands of a committed stroke's outline (cached per item object). */
export function strokeCommands(s: StrokeItem): number[][] {
  let cmds = strokeCmds.get(s);
  if (!cmds) {
    const pts = Array.isArray(s.pts) ? s.pts : [];
    cmds = pts.length >= 3 ? outlineToCommands(getStroke(pts, strokeOptions(s, true)), true) : [];
    strokeCmds.set(s, cmds);
  }
  return cmds;
}

function colorPaint(hex: string, alpha: number): SkPaint {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color(hex));
  if (alpha < 1) p.setAlphaf(p.getAlphaf() * Math.max(0, alpha));
  return p;
}

function withPath(cmds: number[][], fn: (path: SkPath) => void): void {
  if (cmds.length === 0) return;
  const path = Skia.Path.MakeFromCmds(cmds);
  if (!path) return;
  try {
    fn(path);
  } finally {
    path.dispose();
  }
}

function drawStroke(c: SkCanvas, s: StrokeItem, alpha: number): void {
  const paint = colorPaint(s.color, alpha);
  try {
    withPath(strokeCommands(s), (path) => c.drawPath(path, paint));
  } finally {
    paint.dispose();
  }
}

function strokePaint(s: ShapeItem, alpha: number): SkPaint {
  const p = colorPaint(s.color, alpha);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(Number.isFinite(s.width) && s.width > 0 ? s.width : 1);
  p.setStrokeCap(StrokeCap.Round);
  p.setStrokeJoin(StrokeJoin.Round);
  return p;
}

/** Runs fn with the canvas rotated by rot (radians) about (cx, cy). */
function rotated(c: SkCanvas, rot: number, cx: number, cy: number, fn: () => void): void {
  if (!rot) {
    fn();
    return;
  }
  c.save();
  try {
    c.rotate((rot * 180) / Math.PI, cx, cy);
    fn();
  } finally {
    c.restore();
  }
}

function drawShape(c: SkCanvas, s: ShapeItem, alpha: number): void {
  const stroke = strokePaint(s, alpha);
  const fill = s.fill ? colorPaint(s.fill, alpha) : null;
  try {
    if (s.shape === 'ellipse' && s.box) {
      const b = s.box;
      rotated(c, b.rot || 0, b.x + b.w / 2, b.y + b.h / 2, () => {
        const r = Skia.XYWHRect(b.x, b.y, b.w, b.h);
        if (fill) c.drawOval(r, fill);
        c.drawOval(r, stroke);
      });
      return;
    }
    const o = shapeOutline(s);
    const n = Math.floor(o.pts.length / 2);
    if (n === 0) return;
    if (s.shape === 'arrow' && n === 5) {
      // shaft, then the head triangle (left barb, tip, right barb), filled and stroked
      withPath(polygonToCommands(o.pts.slice(0, 4), false), (path) => c.drawPath(path, stroke));
      const head = [o.pts[4], o.pts[5], o.pts[6], o.pts[7], o.pts[8], o.pts[9]];
      const headFill = colorPaint(s.color, alpha);
      try {
        withPath(polygonToCommands(head, true), (path) => {
          c.drawPath(path, headFill);
          c.drawPath(path, stroke);
        });
      } finally {
        headFill.dispose();
      }
      return;
    }
    if (n === 1) {
      // a dot: a zero-length line with round caps
      c.drawLine(o.pts[0], o.pts[1], o.pts[0], o.pts[1], stroke);
      return;
    }
    withPath(polygonToCommands(o.pts, o.closed), (path) => {
      if (fill && o.closed) c.drawPath(path, fill);
      c.drawPath(path, stroke);
    });
  } finally {
    stroke.dispose();
    fill?.dispose();
  }
}

/** Runs fn inside a layer at alpha (nothing extra when alpha is 1). */
function withAlpha(c: SkCanvas, alpha: number, fn: () => void): void {
  if (alpha >= 1) {
    fn();
    return;
  }
  const p = Skia.Paint();
  p.setAlphaf(Math.max(0, alpha));
  c.saveLayer(p);
  try {
    fn();
  } finally {
    c.restore();
    p.dispose();
  }
}

function drawText(c: SkCanvas, t: TextItem, fonts: SkTypefaceFontProvider | null, alpha: number): void {
  if (!t.text) return;
  const b = t.box;
  const layout = layoutText(t, fonts);
  withAlpha(c, alpha, () => {
    rotated(c, b.rot || 0, b.x + b.w / 2, b.y + b.h / 2, () => paintTextLayout(c, layout, b.x, b.y));
  });
}

function drawImageItem(c: SkCanvas, it: ImageItem, ctx: PaintContext, alpha: number): void {
  const b = it.box;
  if (!(b.w > 0 && b.h > 0)) return;
  const img = ctx.image(it.fileId);
  rotated(c, b.rot || 0, b.x + b.w / 2, b.y + b.h / 2, () => {
    const dest = Skia.XYWHRect(b.x, b.y, b.w, b.h);
    if (!img) {
      const p = colorPaint(IMAGE_PLACEHOLDER_FILL, alpha);
      try {
        c.drawRect(dest, p);
      } finally {
        p.dispose();
      }
      return;
    }
    const iw = img.width();
    const ih = img.height();
    const cr = it.crop;
    const src =
      cr && cr.w > 0 && cr.h > 0
        ? Skia.XYWHRect(Math.max(0, cr.x) * iw, Math.max(0, cr.y) * ih, Math.min(1, cr.w) * iw, Math.min(1, cr.h) * ih)
        : Skia.XYWHRect(0, 0, iw, ih);
    const p = Skia.Paint();
    try {
      p.setAntiAlias(true);
      if (alpha < 1) p.setAlphaf(Math.max(0, alpha));
      c.drawImageRectOptions(img, src, dest, FilterMode.Linear, MipmapMode.None, p);
    } finally {
      p.dispose();
    }
  });
}

/** Draws one item in page points. alpha multiplies its color alpha (1 = as stored). */
export function drawItem(c: SkCanvas, item: PageItem, ctx: PaintContext, alpha: number = 1): void {
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  if (a <= 0) return;
  switch (item.kind) {
    case 'stroke':
      drawStroke(c, item, a);
      return;
    case 'shape':
      // Stroke, fill and arrowhead overlap: dim them as ONE layer so the overlaps do not darken.
      if (a < 1) withAlpha(c, a, () => drawShape(c, item, 1));
      else drawShape(c, item, 1);
      return;
    case 'text':
      drawText(c, item, ctx.fonts, a);
      return;
    case 'image':
      drawImageItem(c, item, ctx, a);
      return;
  }
}
