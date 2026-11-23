/**
 * Photos as pages (NB-33) and a single camera photo.
 *
 * - The library picker allows several photos in the order they were picked, as JPEG-compatible
 *   files (iOS converts HEIC with the 'compatible' representation, so every page decodes in Skia).
 * - Android can kill the activity while the picker is open ("Don't keep activities", low memory);
 *   the result is then lost to the original call. getPendingResultAsync returns it on the next try,
 *   so pickPhotos / takePhoto first look for such a result (recoverPendingPhotos).
 */
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
  name?: string;
  mimeType?: string;
  size?: number;
}

export type PickPhotosResult = { ok: true; images: PickedImage[] } | { ok: false; reason: 'cancelled' | 'denied' };

function toImages(assets: ImagePicker.ImagePickerAsset[] | null | undefined): PickedImage[] {
  const out: PickedImage[] = [];
  for (const a of assets ?? []) {
    if (!a?.uri || (a.type && a.type !== 'image' && a.type !== 'livePhoto')) continue;
    const img: PickedImage = { uri: a.uri, width: a.width, height: a.height };
    if (a.fileName) img.name = a.fileName;
    if (a.mimeType) img.mimeType = a.mimeType;
    if (typeof a.fileSize === 'number') img.size = a.fileSize;
    out.push(img);
  }
  return out;
}

/** Android: images picked by a call whose activity was killed; null when there are none. */
export async function recoverPendingPhotos(): Promise<PickedImage[] | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const r = await ImagePicker.getPendingResultAsync();
    if (!r || 'code' in r || r.canceled) return null;
    const images = toImages(r.assets);
    return images.length ? images : null;
  } catch {
    return null;
  }
}

/** Opens the photo library for one or more photos (in pick order). */
export async function pickPhotos(): Promise<PickPhotosResult> {
  const pending = await recoverPendingPhotos();
  if (pending) return { ok: true, images: pending };
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 0,
    orderedSelection: true,
    quality: 1,
    exif: false,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (r.canceled) return { ok: false, reason: 'cancelled' };
  const images = toImages(r.assets);
  return images.length ? { ok: true, images } : { ok: false, reason: 'cancelled' };
}

/** Takes one photo with the camera (asks for the camera permission first). */
export async function takePhoto(): Promise<PickPhotosResult> {
  const pending = await recoverPendingPhotos();
  if (pending) return { ok: true, images: pending };
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: 'denied' };
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9, exif: false });
  if (r.canceled) return { ok: false, reason: 'cancelled' };
  const images = toImages(r.assets);
  return images.length ? { ok: true, images } : { ok: false, reason: 'cancelled' };
}
