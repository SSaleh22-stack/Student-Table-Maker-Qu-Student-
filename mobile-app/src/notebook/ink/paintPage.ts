/**
 * paintPage: a whole page in DRAW ORDER onto any canvas, and renderPageImage: a page rendered
 * offscreen into a raster image (page thumbnails, the cover, the PNG export).
 *
 * Both draw through pictures.ts paintUnderLayer / paintInkLayer and items.ts drawItem: one drawing
 * path for the screen, thumbnails and export.
 *
 * renderPageImage runs on the JS runtime: the PDF background comes from the engine's renderPage
 * (P10, cached on disk) at exactly the output width, image assets are decoded for this render at the
 * size they are shown, and everything is drawn into a CPU raster surface. Those decoded images are
 * not part of the 48 MB budget: they are disposed as soon as the snapshot is taken (no canvas ever
 * saw them). The returned image belongs to the caller (dispose it when done).
 */
import { ClipOp, Skia, type SkCanvas, type SkImage } from '@shopify/react-native-skia';

import type { Id, Page } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';

import { loadNotebookFonts } from './fonts';
import { disposeUnseen } from './imageBudget';
import { ASSET_MAX_PX, decodeImageFile } from './images';
import type { PaintContext } from './items';
import { paintBackground } from './paper';
import { decodePdfPage, pdfSizeOf } from './pdfTiles';
import { paintInkLayer, paintUnderLayer, type LayerOptions } from './pictures';

/** Largest offscreen render side in px. */
export const MAX_RENDER_PX = 8192;

export interface PaintPageOptions extends LayerOptions {
  /**
   * Device px per page point the caller scaled the canvas to. The drawing itself is in points and
   * does not depend on it (images and PDF previews are chosen by the caller for this scale).
   */
  scale: number;
  /** Paint the background (step 1). Default true. */
  background?: boolean;
}

/** Paints page in page points, in draw order, onto c (the caller sets the matrix). */
export function paintPage(c: SkCanvas, page: Page, ctx: PaintContext, o: PaintPageOptions): void {
  c.save();
  try {
    c.clipRect(Skia.XYWHRect(0, 0, page.size.w, page.size.h), ClipOp.Intersect, true);
    if (o.background !== false) paintBackground(c, page, ctx);
    paintUnderLayer(c, page, ctx, o);
    paintInkLayer(c, page, ctx, o);
  } finally {
    c.restore();
  }
}

/** Pixel size of a page rendered widthPx wide. */
export function renderSize(page: Pick<Page, 'size'>, widthPx: number): { w: number; h: number; scale: number } {
  const pw = Math.max(1e-6, page.size.w);
  const ph = Math.max(1e-6, page.size.h);
  const want = Number.isFinite(widthPx) && widthPx >= 1 ? widthPx : 1;
  // Both sides stay within MAX_RENDER_PX with the page's aspect ratio kept (a tall page asked for
  // at a big width is rendered smaller, never cut off at the bottom).
  const scale = Math.min(Math.min(want, MAX_RENDER_PX) / pw, MAX_RENDER_PX / ph);
  const w = Math.max(1, Math.min(MAX_RENDER_PX, Math.round(pw * scale)));
  const h = Math.max(1, Math.min(MAX_RENDER_PX, Math.round(ph * scale)));
  return { w, h, scale };
}

/** Long side in px an image asset needs to look sharp in this render (at most ASSET_MAX_PX). */
function neededPx(page: Page, fileId: Id, scale: number): number {
  let need = 0;
  const bg = page.background;
  if (bg.kind === 'image' && bg.fileId === fileId) need = Math.max(page.size.w, page.size.h) * scale;
  for (const it of page.items) {
    if (it.kind !== 'image' || it.fileId !== fileId) continue;
    const crop = it.crop && it.crop.w > 0 && it.crop.h > 0 ? Math.min(it.crop.w, it.crop.h) : 1;
    need = Math.max(need, (Math.max(it.box.w, it.box.h) * scale) / Math.max(0.05, crop));
  }
  return Math.max(1, Math.min(ASSET_MAX_PX, Math.ceil(need)));
}

/**
 * Renders page pageId of the session widthPx wide (height from the page's aspect ratio) offscreen,
 * with its PDF background through the engine's renderPage. The caller owns the result. A PDF page
 * that cannot render is drawn as the neutral placeholder; a missing image as its placeholder.
 */
export async function renderPageImage(session: NotebookSession, pageId: Id, widthPx: number): Promise<SkImage> {
  const page = session.getPage(pageId) ?? (await session.loadPage(pageId));
  const { w, h, scale } = renderSize(page, widthPx);

  const fonts = page.items.some((it) => it.kind === 'text') ? await loadNotebookFonts() : null;

  const images = new Map<Id, SkImage>();
  const pdfs = new Map<string, SkImage>();
  try {
    const bg = page.background;
    if (bg.kind === 'pdf' && !bg.damaged) {
      const pdfW = Math.round(pdfSizeOf(page.size, bg.rotation).w * scale);
      try {
        const img = await decodePdfPage(session.assetPath(bg.fileId), bg.pageIndex, Math.max(1, Math.min(MAX_RENDER_PX, pdfW)));
        if (img) pdfs.set(`${bg.fileId}:${bg.pageIndex}`, img);
      } catch {
        // Drawn as the placeholder (the canvas marks damaged pages; a thumbnail just shows the fill).
      }
    }
    const fileIds = new Set<Id>();
    if (bg.kind === 'image') fileIds.add(bg.fileId);
    for (const it of page.items) if (it.kind === 'image') fileIds.add(it.fileId);
    for (const fileId of fileIds) {
      try {
        const img = await decodeImageFile(session.assetPath(fileId), neededPx(page, fileId, scale));
        if (img) images.set(fileId, img);
      } catch {
        // Drawn as the image placeholder.
      }
    }

    const ctx: PaintContext = {
      image: (id) => images.get(id) ?? null,
      pdfPreview: (id, index) => pdfs.get(`${id}:${index}`) ?? null,
      fonts,
    };
    const surface = Skia.Surface.Make(w, h);
    if (!surface) throw new Error(`Cannot make a ${w} x ${h} surface`);
    try {
      const c = surface.getCanvas();
      c.clear(Skia.Color('#FFFFFF'));
      c.scale(scale, scale);
      paintPage(c, page, ctx, { scale, background: true });
      surface.flush();
      return surface.makeImageSnapshot();
    } finally {
      surface.dispose();
    }
  } finally {
    for (const img of images.values()) disposeUnseen(img);
    for (const img of pdfs.values()) disposeUnseen(img);
  }
}
