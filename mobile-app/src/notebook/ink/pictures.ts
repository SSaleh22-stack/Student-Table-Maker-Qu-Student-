/**
 * The page's items in DRAW ORDER (core/model/types.ts), as layers the canvas can cache as pictures:
 *   1 background            (paper.ts paintBackground; the canvas usually draws PDF previews/tiles itself)
 *   2 images                \ the UNDER layer
 *   3 the HIGHLIGHTER GROUP /  highlighter strokes and highlighter shapes, drawn opaque into ONE
 *                              saveLayer composited at alpha HIGHLIGHTER_ALPHA (0.35), normal blend, so
 *                              overlapping highlights do not darken each other and never cover ink
 *   4 everything else       the INK layer: pen strokes, other shapes and text, in array order
 *
 * PLAYBACK DIMMING (NB-62): with dimAfter = the player's position, items made later in that recording
 * (rec.recordingId === dimAfter.recordingId and rec.ms > dimAfter.ms) are drawn at DIM_ALPHA (0.28).
 * Items of other recordings and items made without recording are not dimmed.
 *
 * Every picture here is created on the JS runtime. The caller hands it to <Canvas> (a <Picture>
 * prop or a shared value) and, when it replaces it, disposes the old one with disposeLater
 * (imageBudget.ts), never directly and never from a worklet (#4339).
 */
import { Skia, type SkCanvas, type SkPicture } from '@shopify/react-native-skia';

import { PAGE_SIDE_MAX, type Id, type Page, type PageItem, type RecMark } from '@/notebook/core/model';

import { drawItem, isHighlighterItem, type PaintContext } from './items';
import { paintBackground } from './paper';

/** Composite alpha of the highlighter group. */
export const HIGHLIGHTER_ALPHA = 0.35;

/** Alpha of ink made after the playback position. */
export const DIM_ALPHA = 0.28;

/** Appended pictures nest; after this many appends the canvas should rebuild with buildPagePictures. */
export const MAX_APPEND_DEPTH = 32;

export interface LayerOptions {
  /** Dim items recorded after this mark (playback). */
  dimAfter?: RecMark | null;
  /** Items not drawn (being edited, erased live, dragged). */
  skipIds?: ReadonlySet<Id> | null;
}

/** True when playback at dimAfter should dim item. */
export function isDimmed(item: PageItem, dimAfter: RecMark | null | undefined): boolean {
  const r = item.rec;
  return !!dimAfter && !!r && r.recordingId === dimAfter.recordingId && r.ms > dimAfter.ms;
}

/** The alpha drawItem gets for item. */
export function itemAlpha(item: PageItem, dimAfter: RecMark | null | undefined): number {
  return isDimmed(item, dimAfter) ? DIM_ALPHA : 1;
}

const skipped = (item: PageItem, o: LayerOptions): boolean => !!o.skipIds && o.skipIds.has(item.id);

/** Draws the highlighter items as ONE layer at HIGHLIGHTER_ALPHA (nothing when there are none). */
export function paintHighlighterGroup(c: SkCanvas, items: readonly PageItem[], ctx: PaintContext, o: LayerOptions = {}): void {
  const group = items.filter((it) => isHighlighterItem(it) && !skipped(it, o));
  if (group.length === 0) return;
  const p = Skia.Paint();
  p.setAlphaf(HIGHLIGHTER_ALPHA);
  c.saveLayer(p);
  try {
    for (const it of group) drawItem(c, it, ctx, itemAlpha(it, o.dimAfter));
  } finally {
    c.restore();
    p.dispose();
  }
}

/** Draw order steps 2 and 3: the image items, then the highlighter group. */
export function paintUnderLayer(c: SkCanvas, page: Page, ctx: PaintContext, o: LayerOptions = {}): void {
  for (const it of page.items) {
    if (it.kind === 'image' && !skipped(it, o)) drawItem(c, it, ctx, itemAlpha(it, o.dimAfter));
  }
  paintHighlighterGroup(c, page.items, ctx, o);
}

/** Draw order step 4: everything that is neither an image nor a highlighter item, in array order. */
export function paintInkLayer(c: SkCanvas, page: Page, ctx: PaintContext, o: LayerOptions = {}): void {
  for (const it of page.items) {
    if (it.kind === 'image' || isHighlighterItem(it) || skipped(it, o)) continue;
    drawItem(c, it, ctx, itemAlpha(it, o.dimAfter));
  }
}

const depths = new WeakMap<SkPicture, number>();

/** Records a picture of the page rectangle (w x h points). The caller owns it. */
export function recordPicture(w: number, h: number, draw: (c: SkCanvas) => void): SkPicture {
  const rec = Skia.PictureRecorder();
  try {
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, Math.max(1, w), Math.max(1, h)));
    draw(c);
    return rec.finishRecordingAsPicture();
  } finally {
    rec.dispose();
  }
}

export interface PagePictures {
  /** Steps 2-3 (and step 1 with background: true): images and the highlighter group. */
  under: SkPicture;
  /** Step 4: pen ink, shapes and text. */
  ink: SkPicture;
}

/**
 * The page as two pictures in page points (draw `under`, then `ink`). The canvas draws the PDF
 * preview and tiles itself under `under`; pass background: true to record the background too (paper
 * pages, photo pages). The caller owns both pictures (dispose with disposeLater).
 */
export function buildPagePictures(page: Page, ctx: PaintContext, o: LayerOptions & { background?: boolean } = {}): PagePictures {
  const { w, h } = page.size;
  const under = recordPicture(w, h, (c) => {
    if (o.background) paintBackground(c, page, ctx);
    paintUnderLayer(c, page, ctx, o);
  });
  const ink = recordPicture(w, h, (c) => paintInkLayer(c, page, ctx, o));
  return { under, ink };
}

/**
 * A new picture: prev, then item on top. The new picture keeps its own reference to prev's content,
 * so once the canvas shows the new one, dispose prev with disposeLater as usual.
 *
 * Exact for an item that belongs on top of prev's layer: a pen stroke, shape or text just added to
 * the INK picture. A highlighter item is drawn in its own layer at HIGHLIGHTER_ALPHA, which looks
 * the same unless it overlaps another highlight; rebuild `under` with buildPagePictures for those.
 * After MAX_APPEND_DEPTH appends (appendDepth) rebuild, so pictures do not nest without end.
 * Pass size (the page size) so the recording bounds are tight.
 */
export function appendStrokePicture(prev: SkPicture, item: PageItem, ctx: PaintContext, o: LayerOptions & { size?: { w: number; h: number } } = {}): SkPicture {
  // The recording bounds only cull; without the page size, cover the largest page there can be.
  const w = o.size?.w ?? PAGE_SIDE_MAX;
  const h = o.size?.h ?? PAGE_SIDE_MAX;
  const pic = recordPicture(w, h, (c) => {
    c.drawPicture(prev);
    if (skipped(item, o)) return;
    if (isHighlighterItem(item)) paintHighlighterGroup(c, [item], ctx, o);
    else drawItem(c, item, ctx, itemAlpha(item, o.dimAfter));
  });
  depths.set(pic, (depths.get(prev) ?? 0) + 1);
  return pic;
}

/** How many appendStrokePicture calls a picture is made of (0 for a built one). */
export function appendDepth(p: SkPicture): number {
  return depths.get(p) ?? 0;
}
