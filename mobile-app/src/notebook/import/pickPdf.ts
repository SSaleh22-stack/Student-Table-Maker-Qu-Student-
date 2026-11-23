/**
 * The system document picker for one PDF (NB-30): the Files app on iOS, the Storage Access
 * Framework picker on Android.
 *
 * - iOS copies the pick into the cache (the picked URL is security-scoped and may stop working);
 *   the caller deletes that copy with discardPick once it is in a staging job.
 * - Android hands back a content:// URI, which the importer stream-copies (no second copy).
 */
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { QUNOTE_MIME_TYPE } from '@/notebook/core/importing/sniff';

export interface PickedFile {
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
}

async function pick(types: string[]): Promise<PickedFile | null> {
  const r = await DocumentPicker.getDocumentAsync({
    type: types,
    multiple: false,
    copyToCacheDirectory: Platform.OS === 'ios',
  });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const out: PickedFile = { uri: a.uri, name: a.name || 'document.pdf' };
  if (typeof a.size === 'number' && a.size >= 0) out.size = a.size;
  if (a.mimeType) out.mimeType = a.mimeType;
  return out;
}

/** Picks one PDF; null when the student cancels. */
export function pickPdf(): Promise<PickedFile | null> {
  return pick(['application/pdf']);
}

/** Picks one .qunote file (restore and receive flows); null when cancelled. */
export function pickQunote(): Promise<PickedFile | null> {
  // Android providers often report .qunote files as octet-stream or zip.
  return pick(Platform.OS === 'android' ? [QUNOTE_MIME_TYPE, 'application/octet-stream', 'application/zip'] : [QUNOTE_MIME_TYPE, 'public.data']);
}

/** Deletes the picker's cache copy (iOS), if the file is in the app cache. */
export function discardPick(f: PickedFile | null | undefined): void {
  if (!f || !f.uri.startsWith('file:')) return;
  try {
    const cache = Paths.cache.uri.replace(/\/+$/, '');
    if (!f.uri.startsWith(cache)) return;
    const file = new File(f.uri);
    if (file.exists) file.delete();
  } catch {
    // The system clears the cache eventually.
  }
}
