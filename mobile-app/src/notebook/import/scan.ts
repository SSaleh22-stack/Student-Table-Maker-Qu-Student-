/**
 * Camera scan (NB-32, ruling (d)): expo-camera's system document scanner (VisionKit on iOS, the
 * ML Kit document scanner on Android) finds the edges, crops and straightens each page. Several
 * pages become one notebook of image pages.
 *
 * The page images land in the app cache; the importer moves them into the notebook.
 */
import { CameraView } from 'expo-camera';
import { Image } from 'react-native';

import type { PickedImage } from './pickPhotos';

export type ScanResult = { ok: true; images: PickedImage[] } | { ok: false; reason: 'cancelled' | 'not-supported' };

/** The pixel size of an image file, or 0 x 0 when it cannot be read (the page then gets A4). */
export async function imageSize(uri: string): Promise<{ width: number; height: number }> {
  try {
    const s = await Image.getSize(uri);
    return { width: s.width, height: s.height };
  } catch {
    return { width: 0, height: 0 };
  }
}

/** Opens the system document scanner; the pages come back in scan order. */
export async function scanDocument(): Promise<ScanResult> {
  let r: Awaited<ReturnType<typeof CameraView.scanDocumentAsync>>;
  try {
    // VisionKit (iOS) or the ML Kit scanner with Google Play services (Android) is missing.
    if (CameraView.isDocumentScannerAvailable === false) return { ok: false, reason: 'not-supported' };
    r = await CameraView.scanDocumentAsync({ quality: 0.85 });
  } catch {
    return { ok: false, reason: 'not-supported' };
  }
  if (!r || !r.pages?.length) return { ok: false, reason: 'cancelled' };
  const images: PickedImage[] = [];
  for (const uri of r.pages) {
    const s = await imageSize(uri);
    images.push({ uri, width: s.width, height: s.height, mimeType: 'image/jpeg' });
  }
  return { ok: true, images };
}
