/**
 * PDF page images for the canvas: one PREVIEW per page, plus TILES once the page is shown larger
 * than the preview can carry sharply (PRD9-pdf-clarity). Rendering is P10's engine (file:// JPEGs in
 * its 200 MB disk cache); this file decodes those files ON THE JS RUNTIME (Skia.Data.fromURI, then
 * MakeImageFromEncoded, rasterized by images.ts decodeImageFile) and keeps them under the 48 MB
 * imageBudget. See imageBudget.ts for the runtime and disposal rules (#4339).
 *
 * SIZES
 * - Preview: long side at most PREVIEW_SCREEN_FACTOR (1.5) x the screen's long side in device px
 *   (core/pdf/tiles.ts previewWidth), and at most PREVIEW_MAX_PIXELS pixels, so three pinned previews
 *   (the visible page +-1) plus MAX_LIVE_TILES tiles fit in the 48 MB budget:
 *   3 x 12 MB + 12 x 512 x 512 x 4 (12 MB) = 48 MB. Use pdfPreviewWidth() for widthPx.
 * - Tiles: 512 px squares of a level (core/pdf/tiles.ts tilesFor), at most 12 live (maxTiles).
 *
 * Page space vs PDF space: page.size is the page as shown. A background with rotation 90/270 shows
 * the PDF page turned, so page.size is the PDF's displayed size with w and h swapped. Images are
 * rendered in PDF space; pdfToPage() / pdfRotationTransform() map them onto the page.
 *
 * Every hook here pins its images while mounted: mount them only for the visible pages +-1.
 */
import type { SkImage, Transforms3d } from '@shopify/react-native-skia';
import { useEffect, useRef, useState } from 'react';

import { isPdfError, type PdfError, type PdfHandle } from '@/notebook/core/contracts/pdf';
import type { Id, Size } from '@/notebook/core/model';
import {
  needsTiles,
  pdfCacheId,
  PREVIEW_MAX_LONG_PX,
  previewWidth,
  regionOf,
  tilesFor,
  type PageRect,
  type TileSpec,
} from '@/notebook/core/pdf/tiles';
import type { NotebookSession } from '@/notebook/core/session/types';
import { pdfEngine } from '@/notebook/pdf/engine';

import { IMAGE_BUDGET_BYTES, MAX_LIVE_TILES, cachedImage, holdImage, loadImage, onImageEvicted, peekImage, subscribeImage } from './imageBudget';
import { decodeImageFile } from './images';

/** Largest preview in pixels: a third of what the budget leaves after the 12 live tiles. */
export const PREVIEW_MAX_PIXELS = Math.floor((IMAGE_BUDGET_BYTES - MAX_LIVE_TILES * 512 * 512 * 4) / 3 / 4);

/** How long an unused PDF stays open (s). */
const IDLE_CLOSE_MS = 30_000;

export type PdfRotation = 0 | 90 | 180 | 270;

// ===== shared open documents

interface OpenDoc {
  handle: Promise<PdfHandle>;
  refs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const docs = new Map<string, OpenDoc>();

function closeDoc(path: string, d: OpenDoc): void {
  if (docs.get(path) !== d) return;
  docs.delete(path);
  void d.handle.then((h) => h.close()).catch(() => undefined);
}

/**
 * The open PDF at path, shared by every caller (one native document per file). Call release() when
 * done; the document closes 30 s after the last release. Rejects like pdfEngine.open (a PdfError).
 */
export function acquirePdf(path: string): { handle: Promise<PdfHandle>; release(): void } {
  let d = docs.get(path);
  if (!d) {
    const opened = pdfEngine.open(path);
    const fresh: OpenDoc = { handle: opened, refs: 0, timer: null };
    d = fresh;
    docs.set(path, fresh);
    // A failed open is not cached: the next caller tries again.
    opened.catch(() => {
      if (docs.get(path) === fresh) docs.delete(path);
    });
  }
  const doc = d;
  doc.refs += 1;
  if (doc.timer) {
    clearTimeout(doc.timer);
    doc.timer = null;
  }
  let released = false;
  return {
    handle: doc.handle,
    release() {
      if (released) return;
      released = true;
      doc.refs -= 1;
      if (doc.refs <= 0 && !doc.timer) doc.timer = setTimeout(() => closeDoc(path, doc), IDLE_CLOSE_MS);
    },
  };
}

/** Runs fn with the open document at path. */
export async function withPdf<T>(path: string, fn: (h: PdfHandle) => Promise<T>): Promise<T> {
  const a = acquirePdf(path);
  try {
    return await fn(await a.handle);
  } finally {
    a.release();
  }
}

// ===== geometry

/** Size of the PDF page (as the engine renders it) behind a page of pageSize shown at rotation. */
export function pdfSizeOf(pageSize: Size, rotation: PdfRotation): Size {
  return rotation === 90 || rotation === 270 ? { w: pageSize.h, h: pageSize.w } : { w: pageSize.w, h: pageSize.h };
}

/** Maps a point of the PDF page to the page (rotation clockwise). */
export function pdfToPage(pageSize: Size, rotation: PdfRotation, x: number, y: number): { x: number; y: number } {
  const p = pdfSizeOf(pageSize, rotation);
  switch (rotation) {
    case 90:
      return { x: p.h - y, y: x };
    case 180:
      return { x: p.w - x, y: p.h - y };
    case 270:
      return { x: y, y: p.w - x };
    default:
      return { x, y };
  }
}

/** Maps a rectangle of the page to the PDF page (axis-aligned bounds). */
export function pageRectToPdf(pageSize: Size, rotation: PdfRotation, r: PageRect): PageRect {
  if (rotation === 0) return r;
  const p = pdfSizeOf(pageSize, rotation);
  const inv = (px: number, py: number): { x: number; y: number } => {
    if (rotation === 90) return { x: py, y: p.h - px };
    if (rotation === 180) return { x: p.w - px, y: p.h - py };
    return { x: p.w - py, y: px };
  };
  const a = inv(r.x, r.y);
  const b = inv(r.x + r.w, r.y + r.h);
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** The canvas ops that map PDF space onto the page: translate, then rotate clockwise. */
export function pdfRotationOps(pageSize: Size, rotation: PdfRotation): { tx: number; ty: number; deg: number } {
  switch (rotation) {
    case 90:
      return { tx: pageSize.w, ty: 0, deg: 90 };
    case 180:
      return { tx: pageSize.w, ty: pageSize.h, deg: 180 };
    case 270:
      return { tx: 0, ty: pageSize.h, deg: 270 };
    default:
      return { tx: 0, ty: 0, deg: 0 };
  }
}

/**
 * The same mapping as a Skia `transform` prop, for <Group transform={...}> around images whose rects
 * are in PDF space (identity for rotation 0).
 */
export function pdfRotationTransform(pageSize: Size, rotation: PdfRotation): Transforms3d {
  const o = pdfRotationOps(pageSize, rotation);
  if (o.deg === 0) return [];
  return [{ translateX: o.tx }, { translateY: o.ty }, { rotate: (o.deg * Math.PI) / 180 }];
}

/**
 * widthPx for usePdfPreview: previewWidth (long side <= 1.5 x the screen's long side in device px,
 * at most PREVIEW_MAX_LONG_PX) and at most PREVIEW_MAX_PIXELS pixels. pdfSize is the PDF page size
 * (pdfSizeOf).
 */
export function pdfPreviewWidth(pdfSize: Size, screenLongPx: number): number {
  let w = previewWidth(pdfSize, screenLongPx);
  const h = (w * pdfSize.h) / Math.max(1e-6, pdfSize.w);
  if (w * h > PREVIEW_MAX_PIXELS) w = Math.floor(Math.sqrt((PREVIEW_MAX_PIXELS * pdfSize.w) / Math.max(1e-6, pdfSize.h)));
  return Math.max(1, Math.min(PREVIEW_MAX_LONG_PX, w));
}

// ===== previews

/** Budget key of a whole-page image. */
export function pdfPreviewKey(path: string, pageIndex: number, widthPx: number): string {
  return `pdf:${pdfCacheId(path)}:p${pageIndex}:w${Math.round(widthPx)}`;
}

/** Budget key of a tile. */
export function pdfTileKey(path: string, tile: TileSpec): string {
  return `pdf:${pdfCacheId(path)}:t${tile.key}`;
}

/**
 * Renders (or reads from the disk cache) and decodes page pageIndex of the PDF at path, widthPx wide,
 * NOT counted in the budget: the caller owns the image (offscreen renders). Rejects with a PdfError.
 */
export async function decodePdfPage(path: string, pageIndex: number, widthPx: number): Promise<SkImage | null> {
  const r = await withPdf(path, (h) => h.renderPage(pageIndex, Math.max(1, Math.round(widthPx))));
  return decodeImageFile(r.uri, Number.MAX_SAFE_INTEGER);
}

/** Decoder of a whole-page preview for imageBudget (errors resolve null and go to onError). */
export function pdfPreviewDecoder(path: string, pageIndex: number, widthPx: number, onError?: (e: PdfError) => void): () => Promise<SkImage | null> {
  return async () => {
    try {
      return await decodePdfPage(path, pageIndex, widthPx);
    } catch (e) {
      if (isPdfError(e)) onError?.(e);
      return null;
    }
  };
}

/** Decoder of one tile for imageBudget (errors resolve null and go to onError). */
export function pdfTileDecoder(path: string, tile: TileSpec, onError?: (e: PdfError) => void): () => Promise<SkImage | null> {
  return async () => {
    try {
      const r = await withPdf(path, (h) => h.renderRegion(regionOf(tile)));
      return await decodeImageFile(r.uri, Number.MAX_SAFE_INTEGER);
    } catch (e) {
      if (isPdfError(e)) onError?.(e);
      return null;
    }
  };
}

/** The preview through the budget, outside React (not pinned). Errors resolve null. */
export function loadPdfPreview(path: string, pageIndex: number, widthPx: number, onError?: (e: PdfError) => void): Promise<SkImage | null> {
  return loadImage(pdfPreviewKey(path, pageIndex, widthPx), 'preview', pdfPreviewDecoder(path, pageIndex, widthPx, onError));
}

/** One tile through the budget, outside React (not pinned). Errors resolve null. */
export function loadPdfTile(path: string, tile: TileSpec, onError?: (e: PdfError) => void): Promise<SkImage | null> {
  return loadImage(pdfTileKey(path, tile), 'tile', pdfTileDecoder(path, tile, onError));
}

/** The PDF asset path of fileId, or null when the notebook has no such PDF. */
function pdfPathOf(s: NotebookSession, fileId: Id): string | null {
  const a = s.notebook.assets[fileId];
  if (a && a.kind !== 'pdf') return null;
  return s.assetPath(fileId);
}

/**
 * The whole PDF page pageIndex of asset fileId, widthPx wide (use pdfPreviewWidth), decoded under the
 * budget; null while it loads, on error, or when the budget is full. onError gets the PdfError (a
 * 'renderer-crashed' or 'damaged' page should be marked damaged by the caller). Pins while mounted.
 */
export function usePdfPreview(
  s: NotebookSession | null,
  fileId: Id | null,
  pageIndex: number,
  widthPx: number,
  onError?: (e: PdfError) => void,
): SkImage | null {
  const [state, setState] = useState<{ key: string; image: SkImage | null } | null>(null);
  const errRef = useRef(onError);
  useEffect(() => {
    errRef.current = onError;
  }, [onError]);

  const path = s && fileId ? pdfPathOf(s, fileId) : null;
  const w = Math.round(widthPx);
  const valid = !!path && Number.isInteger(pageIndex) && pageIndex >= 0 && w >= 1;
  const key = valid && path ? pdfPreviewKey(path, pageIndex, w) : null;

  useEffect(() => {
    if (!key || !path) return undefined;
    return subscribeImage(
      key,
      'preview',
      pdfPreviewDecoder(path, pageIndex, w, (e) => errRef.current?.(e)),
      (image) => setState({ key, image }),
    );
  }, [key, path, pageIndex, w]);

  return state && key && state.key === key ? state.image : null;
}

// ===== tiles

export interface PdfTilesOptions {
  /** The page as shown, in points (page.size). */
  size: Size;
  /** On-screen scale in device px per page point (fit x zoom x pixel ratio). */
  pxPerPt: number;
  /** The visible part of the page, in page points. */
  visible: PageRect;
  /** Pixels per point of the preview under the tiles (previewScale); no tiles unless they are sharper. */
  previewPxPerPt: number;
  /** The background's rotation (default 0). */
  rotation?: PdfRotation;
  /** At most this many tiles for this page (default MAX_LIVE_TILES). */
  maxTiles?: number;
  /** false while the view moves (tiles are requested on settle). Default true. */
  enabled?: boolean;
}

export interface PdfTileImage {
  image: SkImage;
  /** Where the image goes, in PDF space; wrap in <Group transform={pdfRotationTransform(...)}>. */
  rect: { x: number; y: number; width: number; height: number };
  key: string;
}

interface TilePlan {
  path: string;
  tiles: TileSpec[];
  sig: string;
}

function planTiles(path: string | null, pageIndex: number, o: PdfTilesOptions): TilePlan | null {
  if (!path || !Number.isInteger(pageIndex) || pageIndex < 0) return null;
  if (o.enabled === false || !needsTiles(o.pxPerPt, o.previewPxPerPt)) return null;
  const rotation = o.rotation ?? 0;
  const pdfSize = pdfSizeOf(o.size, rotation);
  const set = tilesFor({
    page: pageIndex,
    size: pdfSize,
    pxPerPt: o.pxPerPt,
    visible: pageRectToPdf(o.size, rotation, o.visible),
    maxTiles: Math.max(1, Math.min(MAX_LIVE_TILES, Math.floor(o.maxTiles ?? MAX_LIVE_TILES))),
  });
  // A level that is not sharper than the preview adds nothing (maxTiles may have forced it down).
  if (set.tiles.length === 0 || set.scale <= o.previewPxPerPt) return null;
  return { path, tiles: set.tiles, sig: `${pdfCacheId(path)}|${set.tiles.map((t) => t.key).join(',')}` };
}

/**
 * Sharp tiles over the visible part of PDF page pageIndex of asset fileId, nearest to the centre
 * first, decoded under the budget (at most 12 live). Only the tiles already decoded are returned; draw
 * them over the preview. Empty while the view moves (enabled false), when the preview is sharp
 * enough, or on errors.
 */
export function usePdfTiles(s: NotebookSession | null, fileId: Id | null, pageIndex: number, o: PdfTilesOptions, onError?: (e: PdfError) => void): PdfTileImage[] {
  const [loaded, setLoaded] = useState<{ sig: string; images: Map<string, SkImage> } | null>(null);
  const errRef = useRef(onError);
  useEffect(() => {
    errRef.current = onError;
  }, [onError]);

  const path = s && fileId ? pdfPathOf(s, fileId) : null;
  const plan = planTiles(path, pageIndex, o);
  const sig = plan?.sig ?? null;
  const planRef = useRef<TilePlan | null>(plan);
  useEffect(() => {
    planRef.current = plan;
  });

  useEffect(() => {
    const p = planRef.current;
    if (!sig || !p || p.sig !== sig) {
      setLoaded(null);
      return undefined;
    }
    let alive = true;
    const images = new Map<string, SkImage>();
    const offs: (() => void)[] = [];
    const publish = () => {
      if (alive) setLoaded({ sig, images: new Map(images) });
    };
    for (const tile of p.tiles) {
      const key = pdfTileKey(p.path, tile);
      offs.push(holdImage(key));
      offs.push(
        onImageEvicted(key, () => {
          if (images.delete(key)) publish();
        }),
      );
      const hit = peekImage(key);
      if (hit) images.set(key, hit);
    }
    publish();
    // Sequential decodes, nearest tile first: each decode blocks the JS thread for a moment, so the
    // tiles stream in one by one instead of freezing the UI for all twelve.
    void (async () => {
      for (const tile of p.tiles) {
        if (!alive) return;
        const key = pdfTileKey(p.path, tile);
        if (images.has(key)) continue;
        const img = await loadPdfTile(p.path, tile, (e) => errRef.current?.(e));
        if (!alive) return;
        if (img) {
          images.set(key, img);
          publish();
        }
      }
    })();
    return () => {
      alive = false;
      for (const off of offs) off();
    };
  }, [sig]);

  if (!plan) return [];
  // Right after the tile set changed (a pan or zoom step), the effect has not published the new set
  // yet: show the tiles of the new set that are already decoded, so the shared ones do not blink off
  // for a frame. The effect pins them right after this render.
  const current = loaded && loaded.sig === plan.sig ? loaded.images : null;
  const out: PdfTileImage[] = [];
  for (const tile of plan.tiles) {
    const key = pdfTileKey(plan.path, tile);
    const image = current ? current.get(key) : cachedImage(key);
    if (image) out.push({ image, key, rect: { x: tile.x, y: tile.y, width: tile.w, height: tile.h } });
  }
  return out;
}
