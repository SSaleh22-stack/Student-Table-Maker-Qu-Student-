/**
 * PDF background sizing for the canvas (P22, PRD9-pdf-clarity): which preview width a page asks for
 * and which tile request (P16 usePdfTiles) it makes for the SETTLED view.
 *
 * - The preview is sized once per page from the screen (pdfPreviewWidth: 1.5 x the screen's long side
 *   in device px, capped by the budget), never from the zoom, so zooming never re-renders it.
 * - Tiles are asked for only once the view settled (no pan, pinch or fling in progress), for the part
 *   of the page on screen, at the zoom's device px per point. usePdfTiles returns nothing while the
 *   preview is sharp enough.
 * - At most MAX_LIVE_TILES live tiles exist; only the current page asks for the full count, its
 *   neighbours a third each, so the budget holds three pinned previews plus 12 tiles.
 */
import { MAX_LIVE_TILES, pdfPreviewWidth, pdfSizeOf, type PdfRotation, type PdfTilesOptions } from '@/notebook/ink';
import { layoutCount, layoutScale } from '@/notebook/core/canvas/layout';
import { visiblePageRect, type Viewport, type ViewSize } from '@/notebook/core/canvas/viewport';
import type { Size } from '@/notebook/core/model';

/** The settled view, as JS knows it (updated when the view stops moving). */
export interface SettledView {
  vp: Viewport;
  view: ViewSize;
  layout: readonly number[];
  /** Device pixels per screen point (PixelRatio.get()). */
  pixelRatio: number;
  /** False while the view moves. */
  settled: boolean;
}

/** Preview width (px) and preview px per PDF point for a page of displayed size shown at rotation. */
export function previewSpec(pageSize: Size, rotation: PdfRotation, screenLongPx: number): { widthPx: number; pxPerPt: number; pdfSize: Size } {
  const pdfSize = pdfSizeOf(pageSize, rotation);
  const widthPx = pdfPreviewWidth(pdfSize, screenLongPx);
  return { widthPx, pxPerPt: widthPx / Math.max(1e-6, pdfSize.w), pdfSize };
}

/**
 * The usePdfTiles options for page `index` (displayed size `pageSize`) in the settled view, with tiles
 * disabled while moving or when the page is off screen.
 */
export function tileOptionsFor(sv: SettledView | null, index: number, pageSize: Size, rotation: PdfRotation, previewPxPerPt: number, isCurrent: boolean): PdfTilesOptions {
  const off: PdfTilesOptions = { size: pageSize, pxPerPt: 0, visible: { x: 0, y: 0, w: 0, h: 0 }, previewPxPerPt, rotation, enabled: false };
  if (!sv || index < 0 || index >= layoutCount(sv.layout)) return off;
  const visible = visiblePageRect(sv.layout, sv.vp, sv.view, index);
  if (!visible) return off;
  const pxPerPt = layoutScale(sv.layout) * sv.vp.scale * sv.pixelRatio;
  return {
    size: pageSize,
    pxPerPt,
    visible,
    previewPxPerPt,
    rotation,
    maxTiles: isCurrent ? MAX_LIVE_TILES : Math.max(1, Math.floor(MAX_LIVE_TILES / 3)),
    enabled: sv.settled,
  };
}
