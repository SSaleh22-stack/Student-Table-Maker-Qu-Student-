/**
 * Picking and inserting an image (P27, NB-47).
 *
 * - pickImage('library' | 'camera'): one image from the photo library or the camera (expo-image-picker,
 *   quality 0.9, no picker cropping: the notebook has its own crop sheet). iOS returns a compatible
 *   (JPEG) representation so Skia can decode HEIC photos. The camera asks for its permission first.
 * - recoverPendingImage(): on Android, a photo picked just before the system killed the app's activity
 *   (common with the camera on low-memory phones) is returned by getPendingResultAsync once; the
 *   image tool asks for it when the editor opens. pickImage never returns it in place of a new pick.
 * - insertImage(ctx, image): copies the file into the notebook (session.addAsset), places it at the
 *   center of the visible area, at most 60 % of the page width (core insertImageBox), adds it as one
 *   undo step and selects it, so its handles and menu show right away.
 */
import * as ImagePicker from 'expo-image-picker';
import { Image, Platform } from 'react-native';

import { getSelection } from '@/notebook/canvas/selection';
import type { ToolContext } from '@/notebook/contracts/tools';
import { newId, type Id, type ImageItem } from '@/notebook/core/model';
import { insertImageBox } from '@/notebook/core/tools/selection';

export type ImageSource = 'library' | 'camera';

export interface PickedImage {
  uri: string;
  /** Pixels; 0 when the picker did not report them. */
  width: number;
  height: number;
  mimeType?: string;
  name?: string;
}

export type PickImageResult = { ok: true; image: PickedImage } | { ok: false; reason: 'cancelled' | 'denied' };

/** Picker quality (NB-47 brief): small files, no visible loss. */
export const IMAGE_QUALITY = 0.9;

function firstImage(assets: ImagePicker.ImagePickerAsset[] | null | undefined): PickedImage | null {
  for (const a of assets ?? []) {
    if (!a?.uri || (a.type && a.type !== 'image' && a.type !== 'livePhoto')) continue;
    const img: PickedImage = { uri: a.uri, width: a.width || 0, height: a.height || 0 };
    if (a.mimeType) img.mimeType = a.mimeType;
    if (a.fileName) img.name = a.fileName;
    return img;
  }
  return null;
}

/** Android: the image of a pick whose activity was killed before it returned (once), else null. */
export async function recoverPendingImage(): Promise<PickedImage | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const r = await ImagePicker.getPendingResultAsync();
    if (!r || 'code' in r || r.canceled) return null;
    return firstImage(r.assets);
  } catch {
    return null;
  }
}

/** One image from the library or the camera. */
export async function pickImage(source: ImageSource): Promise<PickImageResult> {
  let r: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'denied' };
    r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: IMAGE_QUALITY, exif: false, allowsEditing: false });
  } else {
    r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: IMAGE_QUALITY,
      exif: false,
      allowsEditing: false,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
  }
  if (r.canceled) return { ok: false, reason: 'cancelled' };
  const image = firstImage(r.assets);
  return image ? { ok: true, image } : { ok: false, reason: 'cancelled' };
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** The file extension to store the image with (from the MIME type, else the file name, else jpg). */
export function imageExt(img: Pick<PickedImage, 'uri' | 'mimeType' | 'name'>): string {
  const byMime = img.mimeType ? EXT_BY_MIME[img.mimeType.toLowerCase()] : undefined;
  if (byMime) return byMime;
  const from = (img.name || img.uri.split('?')[0]).toLowerCase();
  const m = /\.([a-z0-9]{2,5})$/.exec(from);
  if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
  return 'jpg';
}

async function sizeOf(img: PickedImage): Promise<{ w: number; h: number }> {
  if (img.width > 0 && img.height > 0) return { w: img.width, h: img.height };
  try {
    const s = await Image.getSize(img.uri);
    if (s.width > 0 && s.height > 0) return { w: s.width, h: s.height };
  } catch {
    // Unknown size: insertImageBox assumes 4:3.
  }
  return { w: 0, h: 0 };
}

/** Adds the image to the visible page, centered, and selects it. Resolves to the new item id (null: nothing added). */
export async function insertImage(ctx: ToolContext, img: PickedImage): Promise<Id | null> {
  const { session } = ctx;
  if (session.readOnly) return null;
  const canvas = ctx.canvas();
  const center = canvas?.visiblePageCenter() ?? null;
  const ids = session.notebook.pageIds;
  const pageId = center?.pageId ?? ids[Math.max(0, Math.min(ids.length - 1, canvas?.currentPageIndex() ?? 0))];
  if (!pageId) return null;
  const page = session.getPage(pageId) ?? (await session.loadPage(pageId));
  const { w, h } = await sizeOf(img);
  const asset = await session.addAsset(img.uri, 'image', imageExt(img), img.name ? { name: img.name } : undefined);
  const at = center && center.pageId === pageId ? { x: center.x, y: center.y } : { x: page.size.w / 2, y: page.size.h / 2 };
  const item: ImageItem = {
    id: newId(),
    kind: 'image',
    fileId: asset.id,
    box: insertImageBox(w, h, page.size, at),
    crop: null,
    at: Date.now(),
  };
  const rec = ctx.recMark();
  if (rec) item.rec = rec;
  const entry = session.addItems(pageId, [item], 'image');
  if (!entry) return null;
  getSelection().select(pageId, [item.id]);
  return item.id;
}
