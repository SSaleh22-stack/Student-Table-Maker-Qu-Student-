/**
 * Page as an image (NB-71): one page rendered offscreen through the painter (P16 renderPageImage:
 * the same drawing path as the screen, PDF background from the engine at the output width, text
 * with the notebook fonts) and encoded as PNG.
 *
 * Resolution: `scale` pixels per page point (default PNG_SCALE = 3, so an A4 page is 1786 x 2526),
 * with the long side capped at PNG_MAX_LONG_PX (4096). The file is written to
 * Paths.cache/nb-export/<random>/<title> – <page n>.png; share it with shareFile (P04U), which deletes
 * it afterwards. JS runtime only: the rendered SkImage is disposed right after encoding.
 *
 * The default is 3 pixels per point with the long side at most 4096 px (P23 brief). P30 updated
 * contracts/export.ts to say so (it used to say 2).
 */
import { ImageFormat } from '@shopify/react-native-skia';

import { tr } from '@/lib/i18n';
import type { ExportPagePng } from '@/notebook/contracts/export';
import type { Id } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { notebookSupported } from '@/notebook/flags';
import { disposeUnseen, renderPageImage } from '@/notebook/ink';

import { ExportError, notebookFileName, writeExportFile } from './pdfExport';

/** Pixels per page point of the PNG export. */
export const PNG_SCALE = 3;
/** Longest side of the PNG export in pixels. */
export const PNG_MAX_LONG_PX = 4096;

/** Pixel width the page is rendered at for `scale`, with the long side capped. */
export function pngWidthPx(size: { w: number; h: number }, scale: number = PNG_SCALE): number {
  const w = Number.isFinite(size.w) && size.w > 0 ? size.w : 1;
  const h = Number.isFinite(size.h) && size.h > 0 ? size.h : 1;
  const k0 = Number.isFinite(scale) && scale > 0 ? scale : PNG_SCALE;
  const k = Math.min(k0, PNG_MAX_LONG_PX / Math.max(w, h));
  return Math.max(1, Math.round(w * k));
}

/** Renders page pageId as a PNG in the cache and resolves to its file:// URI. */
export const exportPagePng: ExportPagePng = async (s: NotebookSession, pageId: Id, o?: { scale?: number }) => {
  if (!notebookSupported) throw new ExportError('unsupported');
  const index = s.notebook.pageIds.indexOf(pageId);
  if (index < 0) throw new ExportError('empty');
  const page = s.getPage(pageId) ?? (await s.loadPage(pageId));
  const img = await renderPageImage(s, pageId, pngWidthPx(page.size, o?.scale ?? PNG_SCALE));
  let bytes: Uint8Array;
  try {
    bytes = img.encodeToBytes(ImageFormat.PNG, 100);
  } finally {
    disposeUnseen(img);
  }
  if (!bytes || bytes.length === 0) throw new ExportError('failed', 'PNG encoding failed');
  const name = notebookFileName(s.notebook, 'png', tr(`صفحة ${index + 1}`, `page ${index + 1}`));
  return writeExportFile(name, bytes);
};
