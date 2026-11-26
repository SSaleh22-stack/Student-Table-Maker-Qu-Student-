/**
 * Opens the system share sheet for an exported file, then deletes the file (contracts/export.ts
 * ShareFile). Used by the export sheet (P23) and the library card actions (P21).
 *
 * - Only files inside Paths.cache are deleted, so a mistaken call can never remove notebook data.
 * - iOS: shareAsync resolves when the share sheet closes, after the target app took its copy, so the
 *   file is deleted right away.
 * - Android: shareAsync resolves when the chooser returns, but the receiving app may still be reading
 *   the content:// grant (mail drafts, Drive uploads), so the delete waits ANDROID_DELETE_DELAY_MS.
 *   The cache folder is also the system's to clear.
 * - Rejects with Error('sharing-unavailable') when the platform has no share sheet; the file is still
 *   cleaned up.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { canShareFilesTogether, shareFilesTogether } from '../../../modules/text-share';

import type { ShareFile, ShareFileOptions } from '@/notebook/contracts/export';

export type { ShareFileOptions } from '@/notebook/contracts/export';

const ANDROID_DELETE_DELAY_MS = 2 * 60 * 1000;

const withSlash = (u: string) => (u.endsWith('/') ? u : u + '/');

/** Whether uri points inside the app's cache folder. */
function inCache(uri: string): boolean {
  try {
    return decodeURI(uri).startsWith(decodeURI(withSlash(Paths.cache.uri)));
  } catch {
    return uri.startsWith(withSlash(Paths.cache.uri));
  }
}

function deleteNow(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone or not ours to delete: nothing to clean up.
  }
}

function cleanUp(uri: string): void {
  if (!inCache(uri)) return;
  if (Platform.OS === 'android') setTimeout(() => deleteNow(uri), ANDROID_DELETE_DELAY_MS);
  else deleteNow(uri);
}

export const shareFile: ShareFile = async (uri: string, o: ShareFileOptions) => {
  try {
    if (!(await Sharing.isAvailableAsync())) throw new Error('sharing-unavailable');
    await Sharing.shareAsync(uri, {
      mimeType: o.mimeType,
      UTI: o.UTI,
      dialogTitle: o.dialogTitle,
      anchor: o.anchor,
    });
  } finally {
    cleanUp(uri);
  }
};

/**
 * Shares several exported files, then deletes them like shareFile. They go in ONE share sheet when
 * this build has the native multi-file share (modules/text-share); otherwise (Expo Go, an older
 * build) one sheet opens after the other closes.
 */
export async function shareFiles(uris: readonly string[], o: ShareFileOptions): Promise<void> {
  if (uris.length === 0) return;
  if (uris.length === 1) return shareFile(uris[0], o);
  if (canShareFilesTogether()) {
    try {
      await shareFilesTogether([...uris], { mimeType: o.mimeType, title: o.dialogTitle });
    } finally {
      for (const uri of uris) cleanUp(uri);
    }
    return;
  }
  for (let i = 0; i < uris.length; i++) {
    try {
      await shareFile(uris[i], o);
    } catch (e) {
      for (const rest of uris.slice(i + 1)) cleanUp(rest);
      throw e;
    }
  }
}
