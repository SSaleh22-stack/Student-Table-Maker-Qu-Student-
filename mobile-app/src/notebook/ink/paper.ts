/**
 * Page backgrounds (draw order step 1): paper from core/paper/pattern.ts patternFor (the only paper
 * geometry; PaperPicker, library thumbnails and the PDF export draw the same lines), a PDF page image
 * (rotated by the background's rotation), or a photo/scan image over its paper fill.
 * Everything is drawn in page points; the caller sets the canvas matrix.
 */
import { FilterMode, MipmapMode, PaintStyle, Skia, StrokeCap, type SkCanvas, type SkImage } from '@shopify/react-native-skia';

import { patternFor, type Page, type PaperSpec, type Size } from '@/notebook/core/model';

import type { PaintContext } from './items';
import { pdfRotationOps, pdfSizeOf, type PdfRotation } from './pdfTiles';

/** Fill of a PDF page that is damaged or not rendered yet. */
export const PDF_PLACEHOLDER_FILL = '#F3F6F9';
const PDF_PLACEHOLDER_BORDER = '#DCE4EC';

/** Paints the paper of `paper` over the rectangle (0, 0, size.w, size.h). */
export function paintPaper(c: SkCanvas, paper: PaperSpec, size: Size, o: { lines?: boolean } = {}): void {
  const pat = patternFor(paper, size);
  const paint = Skia.Paint();
  try {
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(pat.fill));
    c.drawRect(Skia.XYWHRect(0, 0, size.w, size.h), paint);
    if (o.lines === false) return;
    if (pat.lines.length > 0 || pat.dots.length > 0) {
      paint.setColor(Skia.Color(pat.lineColor));
      paint.setStyle(PaintStyle.Stroke);
      paint.setStrokeWidth(pat.lineWidth);
      paint.setStrokeCap(StrokeCap.Butt);
      for (const l of pat.lines) c.drawLine(l.x1, l.y1, l.x2, l.y2, paint);
      paint.setStyle(PaintStyle.Fill);
      for (const d of pat.dots) c.drawCircle(d.x, d.y, d.r, paint);
    }
    if (pat.margin) {
      paint.setStyle(PaintStyle.Stroke);
      paint.setColor(Skia.Color(pat.margin.color));
      paint.setStrokeWidth(pat.margin.width);
      c.drawLine(pat.margin.x, 0, pat.margin.x, size.h, paint);
    }
  } finally {
    paint.dispose();
  }
}

/** Draws an image stretched over (0, 0, w, h). */
export function drawImageFill(c: SkCanvas, img: SkImage, w: number, h: number): void {
  const paint = Skia.Paint();
  try {
    paint.setAntiAlias(true);
    c.drawImageRectOptions(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(0, 0, w, h), FilterMode.Linear, MipmapMode.None, paint);
  } finally {
    paint.dispose();
  }
}

/** A PDF page image (rendered in PDF space) placed on a page of pageSize shown at rotation. */
export function drawPdfImage(c: SkCanvas, img: SkImage, pageSize: Size, rotation: PdfRotation): void {
  const pdf = pdfSizeOf(pageSize, rotation);
  const ops = pdfRotationOps(pageSize, rotation);
  c.save();
  try {
    if (ops.deg !== 0) {
      c.translate(ops.tx, ops.ty);
      c.rotate(ops.deg, 0, 0);
    }
    drawImageFill(c, img, pdf.w, pdf.h);
  } finally {
    c.restore();
  }
}

/** The neutral fill of a PDF page with no image (damaged, or still loading). */
export function paintPdfPlaceholder(c: SkCanvas, size: Size): void {
  const paint = Skia.Paint();
  try {
    paint.setColor(Skia.Color(PDF_PLACEHOLDER_FILL));
    c.drawRect(Skia.XYWHRect(0, 0, size.w, size.h), paint);
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(1);
    paint.setColor(Skia.Color(PDF_PLACEHOLDER_BORDER));
    c.drawRect(Skia.XYWHRect(0.5, 0.5, Math.max(0, size.w - 1), Math.max(0, size.h - 1)), paint);
  } finally {
    paint.dispose();
  }
}

/**
 * Draw order step 1, the page background:
 * - paper: patternFor
 * - pdf: ctx.pdfPreview(fileId, pageIndex), rotated; the placeholder fill when damaged or not loaded
 * - image: the paper fill, then ctx.image(fileId) over the whole page
 */
export function paintBackground(c: SkCanvas, page: Page, ctx: PaintContext): void {
  const bg = page.background;
  if (bg.kind === 'paper') {
    paintPaper(c, bg.paper, page.size);
    return;
  }
  if (bg.kind === 'pdf') {
    const img = bg.damaged ? null : ctx.pdfPreview(bg.fileId, bg.pageIndex);
    if (img) {
      // White under the PDF: PDF pages with no background of their own are transparent.
      const paint = Skia.Paint();
      try {
        paint.setColor(Skia.Color('#FFFFFF'));
        c.drawRect(Skia.XYWHRect(0, 0, page.size.w, page.size.h), paint);
      } finally {
        paint.dispose();
      }
      drawPdfImage(c, img, page.size, bg.rotation);
    } else {
      paintPdfPlaceholder(c, page.size);
    }
    return;
  }
  paintPaper(c, bg.paper, page.size, { lines: false });
  const img = ctx.image(bg.fileId);
  if (img) drawImageFill(c, img, page.size.w, page.size.h);
}
