/**
 * Text box layout (NB-46) with Skia Paragraph, the ONE layout the canvas, thumbnails, the PNG and PDF
 * export (P23 renders text through renderTextImage) and the text tool (P28 recomputes box.h from
 * layoutText after every edit) all use.
 *
 * - Each paragraph (core/text/bidi.ts directedParagraphs) gets its own direction from its first
 *   strong character: an Arabic line is right-to-left and starts at the right edge, an English line
 *   left-to-right from the left edge. A paragraph with no strong character takes the direction of the
 *   one before it; the first falls back to TEXT_FALLBACK_DIR ('rtl', Arabic-first), whatever the UI
 *   language, so a box looks the same in every language.
 * - Font: NB_TEXT_FAMILY at weight 500, or 700 when the box is bold (contracts/fonts.ts NB_TEXT_FONTS),
 *   at item.size points, wrapped at box.w.
 * - An empty paragraph still takes one line (a zero-width space keeps the line box), so a trailing
 *   empty line gives the box its height, as it does in the TextInput editor.
 *
 * CACHE: by item id and a content hash (text, size, color, weight, wrap width, fonts). A changed item
 * replaces its entry; the old paragraphs are disposed through the disposal queue (the canvas may have
 * drawn them this frame). At most TEXT_CACHE_MAX items are kept. Everything here runs on the JS runtime.
 */
import {
  FontWeight,
  Skia,
  TextAlign,
  TextDirection,
  type SkCanvas,
  type SkImage,
  type SkParagraph,
  type SkTypefaceFontProvider,
} from '@shopify/react-native-skia';

import { NB_TEXT_FAMILY, nbTextFont } from '@/notebook/contracts/fonts';
import type { TextItem } from '@/notebook/core/model';
import { hashString } from '@/notebook/core/pdf/tiles';
import { directedParagraphs, type TextDir } from '@/notebook/core/text/bidi';

import { disposeLater, disposeUnseen } from './imageBudget';

/** Direction of a first paragraph that has no strong character. */
export const TEXT_FALLBACK_DIR: TextDir = 'rtl';

/** Text items whose layout is kept. */
export const TEXT_CACHE_MAX = 300;

const ZWSP = '​';

export interface TextLayout {
  paragraphs: SkParagraph[];
  /** Top of each paragraph inside the box, in points. */
  offsets: number[];
  /** Total height in points (what box.h should be). */
  height: number;
  /** Width the paragraphs were wrapped at. */
  width: number;
}

interface CacheEntry {
  hash: string;
  layout: TextLayout;
  fonts: SkTypefaceFontProvider | null;
}

const cache = new Map<string, CacheEntry>();

function contentHash(item: TextItem, width: number): string {
  return `${hashString(item.text)}:${item.text.length}|${item.size}|${item.color}|${item.bold ? 7 : 5}|${width}`;
}

function wrapWidth(item: TextItem): number {
  const w = item.box?.w;
  return Number.isFinite(w) && w > 1 ? w : 1;
}

function disposeLayout(l: TextLayout, later: boolean): void {
  for (const p of l.paragraphs) {
    if (later) disposeLater(p);
    else disposeUnseen(p);
  }
}

/** Builds the paragraphs (not cached). The caller owns them. */
export function buildTextLayout(item: TextItem, fonts: SkTypefaceFontProvider | null): TextLayout {
  const width = wrapWidth(item);
  const size = Number.isFinite(item.size) && item.size > 0 ? item.size : 16;
  const weight = nbTextFont(item.bold).weight === 700 ? FontWeight.Bold : FontWeight.Medium;
  const color = Skia.Color(item.color);
  const paragraphs: SkParagraph[] = [];
  const offsets: number[] = [];
  let y = 0;
  for (const part of directedParagraphs(item.text ?? '', TEXT_FALLBACK_DIR)) {
    const rtl = part.dir === 'rtl';
    const style = {
      textDirection: rtl ? TextDirection.RTL : TextDirection.LTR,
      textAlign: TextAlign.Start,
      textStyle: { fontFamilies: [NB_TEXT_FAMILY], fontSize: size, fontStyle: { weight }, color },
    };
    const builder = fonts ? Skia.ParagraphBuilder.Make(style, fonts) : Skia.ParagraphBuilder.Make(style);
    try {
      builder.pushStyle({ fontFamilies: [NB_TEXT_FAMILY], fontSize: size, fontStyle: { weight }, color });
      builder.addText(part.text.length > 0 ? part.text : ZWSP);
      builder.pop();
      const p = builder.build();
      p.layout(width);
      paragraphs.push(p);
      offsets.push(y);
      y += p.getHeight();
    } finally {
      builder.dispose();
    }
  }
  return { paragraphs, offsets, height: y, width };
}

/**
 * The layout of a text item: cached paragraphs, their offsets and the total height. With fonts null
 * the system fallback font is used (the text still shows, but its metrics may differ: pass the
 * provider from useNotebookFonts / loadNotebookFonts whenever possible).
 */
export function layoutText(item: TextItem, fonts: SkTypefaceFontProvider | null): TextLayout {
  const hash = contentHash(item, wrapWidth(item));
  const hit = cache.get(item.id);
  if (hit && hit.hash === hash && hit.fonts === fonts) {
    cache.delete(item.id);
    cache.set(item.id, hit);
    return hit.layout;
  }
  if (hit) {
    cache.delete(item.id);
    disposeLayout(hit.layout, true);
  }
  const layout = buildTextLayout(item, fonts);
  cache.set(item.id, { hash, layout, fonts });
  while (cache.size > TEXT_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const e = cache.get(oldest);
    cache.delete(oldest);
    if (e) disposeLayout(e.layout, true);
  }
  return layout;
}

/** box.h for a text item: the laid-out height (P28 writes it after every edit). */
export function measureTextHeight(item: TextItem, fonts: SkTypefaceFontProvider | null): number {
  return layoutText(item, fonts).height;
}

/** Paints a layout with its top-left at (x, y) (the box's local origin). */
export function paintTextLayout(c: SkCanvas, layout: TextLayout, x: number, y: number): void {
  for (let i = 0; i < layout.paragraphs.length; i++) layout.paragraphs[i].paint(c, x, y + layout.offsets[i]);
}

/** Drops a text item's cached layout (deleted items). */
export function forgetTextLayout(itemId: string): void {
  const e = cache.get(itemId);
  if (!e) return;
  cache.delete(itemId);
  disposeLayout(e.layout, true);
}

/**
 * The text of one item rendered alone, unrotated, at `scale` px per point, on a transparent raster
 * image of ceil(box.w x scale) x ceil(height x scale) (P23 embeds it in the PDF as a PNG). The caller
 * owns the image. null for an empty box.
 */
export function renderTextImage(item: TextItem, fonts: SkTypefaceFontProvider | null, scale: number): SkImage | null {
  const layout = layoutText(item, fonts);
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const w = Math.min(8192, Math.ceil(layout.width * k));
  const h = Math.min(8192, Math.ceil(Math.max(layout.height, item.box.h) * k));
  if (w < 1 || h < 1) return null;
  const surface = Skia.Surface.Make(w, h);
  if (!surface) return null;
  try {
    const c = surface.getCanvas();
    c.scale(k, k);
    paintTextLayout(c, layout, 0, 0);
    surface.flush();
    return surface.makeImageSnapshot();
  } finally {
    surface.dispose();
  }
}
