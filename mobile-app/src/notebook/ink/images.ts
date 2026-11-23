/**
 * Image decoding for the painter, on the JS runtime only (see imageBudget.ts for the runtime rule).
 *
 * decodeImageFile reads an encoded file (JPEG, PNG, HEIC where the platform decodes it) with
 * Skia.Data.fromURI, makes the image with Skia.Image.MakeImageFromEncoded, and draws it into a RASTER
 * surface (Skia.Surface.Make, CPU memory) of at most maxLongPx on the long side. The snapshot of that
 * surface is the image the canvas gets:
 * - MakeImageFromEncoded alone gives a LAZY image that Skia would decode during the first frame on
 *   the UI thread (a visible hitch), outside any budget; drawing it here decodes it now, on JS.
 * - a raster snapshot belongs to no GPU context, so it can be drawn by the UI thread's canvas, and its
 *   width x height x 4 is what it really costs.
 * - the full-size decode exists only for the moment of the downscale and is disposed right away.
 *
 * useAssetImage(session, fileId): an image asset (image items, photo/scan page backgrounds) downscaled
 * to at most ASSET_MAX_PX (2048) on the long side, through the 48 MB budget. Mount it only for the
 * visible pages +-1 (a mounted hook pins its image).
 */
import { FilterMode, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';

import type { Id } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';

import { disposeUnseen, subscribeImage } from './imageBudget';

/** Long side cap of a decoded image asset. */
export const ASSET_MAX_PX = 2048;

/** Largest side a raster surface is made with (matches the PDF engine's cap). */
const MAX_SURFACE_PX = 8192;

/** file:// for a plain absolute path (Skia.Data.fromURI wants a URI). */
export function toFileUri(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  return path.startsWith('/') ? `file://${path}` : path;
}

/**
 * Draws img into a new raster image of exactly w x h (scaled to fill). The caller still owns img.
 * null when the surface cannot be made.
 */
export function rasterize(img: SkImage, w: number, h: number): SkImage | null {
  // Shrunk uniformly when a side is over MAX_SURFACE_PX, so the aspect ratio is kept.
  const k = Math.min(1, MAX_SURFACE_PX / Math.max(1, w), MAX_SURFACE_PX / Math.max(1, h));
  const W = Math.max(1, Math.min(MAX_SURFACE_PX, Math.round(w * k)));
  const H = Math.max(1, Math.min(MAX_SURFACE_PX, Math.round(h * k)));
  const surface = Skia.Surface.Make(W, H);
  if (!surface) return null;
  const paint = Skia.Paint();
  try {
    const c = surface.getCanvas();
    // Mipmaps only help a real downscale (a 12 MP photo to 2048 px); a same-size copy skips them.
    const shrinking = W < img.width() * 0.75 || H < img.height() * 0.75;
    c.drawImageRectOptions(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(0, 0, W, H), FilterMode.Linear, shrinking ? MipmapMode.Linear : MipmapMode.None, paint);
    surface.flush();
    return surface.makeImageSnapshot();
  } finally {
    paint.dispose();
    surface.dispose();
  }
}

/** Size that fits w x h inside maxLongPx on the long side (never upscales). */
export function fitLong(w: number, h: number, maxLongPx: number): { w: number; h: number } {
  const long = Math.max(w, h);
  const k = long > maxLongPx ? maxLongPx / long : 1;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * Decodes an image file into a raster SkImage of at most maxLongPx on the long side. null when the
 * file cannot be read or decoded. JS runtime only.
 */
export async function decodeImageFile(uri: string, maxLongPx: number = ASSET_MAX_PX): Promise<SkImage | null> {
  const data = await Skia.Data.fromURI(toFileUri(uri));
  let lazy: SkImage | null = null;
  try {
    lazy = Skia.Image.MakeImageFromEncoded(data);
    if (!lazy) return null;
    const size = fitLong(lazy.width(), lazy.height(), Math.max(1, Math.floor(maxLongPx)));
    return rasterize(lazy, size.w, size.h);
  } finally {
    disposeUnseen(lazy);
    disposeUnseen(data);
  }
}

/** Budget key of an asset image (per notebook, file and size cap). */
export function assetImageKey(notebookId: Id, fileId: Id, maxLongPx: number = ASSET_MAX_PX): string {
  return `asset:${notebookId}:${fileId}:${maxLongPx}`;
}

/** Loads an asset image outside React (through the budget, not pinned). */
export function assetImageDecoder(session: NotebookSession, fileId: Id, maxLongPx: number = ASSET_MAX_PX): () => Promise<SkImage | null> {
  return async () => {
    const asset = session.notebook.assets[fileId];
    if (asset && asset.kind !== 'image') return null;
    return decodeImageFile(session.assetPath(fileId), maxLongPx);
  };
}

/**
 * The decoded image asset fileId of the session's notebook (at most maxLongPx, default 2048, on the
 * long side), or null while it loads, when it is missing or when the budget is full. Mounting this
 * hook pins the image (visible pages +-1 only).
 */
export function useAssetImage(s: NotebookSession | null, fileId: Id | null, maxLongPx: number = ASSET_MAX_PX): SkImage | null {
  const [state, setState] = useState<{ key: string; image: SkImage | null } | null>(null);
  const key = s && fileId ? assetImageKey(s.id, fileId, maxLongPx) : null;

  useEffect(() => {
    if (!s || !fileId || !key) return undefined;
    return subscribeImage(key, 'asset', assetImageDecoder(s, fileId, maxLongPx), (image) => setState({ key, image }));
  }, [s, fileId, key, maxLongPx]);

  return state && key && state.key === key ? state.image : null;
}
