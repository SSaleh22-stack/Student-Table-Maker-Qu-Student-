import { requireOptionalNativeModule } from 'expo';
import { Platform, Share } from 'react-native';

type TextShareModule = {
  /** iOS only. */
  shareAsync?(message: string): Promise<boolean>;
  /** iOS: (paths). Android: (paths, mimeType, title). Missing in builds made before it was added. */
  shareFilesAsync?(paths: string[], mimeType?: string | null, title?: string | null): Promise<boolean>;
};

// Missing in Expo Go and in builds made before this module was added: React Native's sheet is used then.
const native = Platform.OS === 'web' ? null : requireOptionalNativeModule<TextShareModule>('TextShare');

/**
 * Opens the share sheet with `message`. On iOS this goes through our own module, so the sheet
 * is anchored on regular-width iPhones (iPhone Duo's inner display), where React Native's
 * `Share.share` crashes. Elsewhere it is React Native's `Share.share`.
 */
export async function shareText(message: string): Promise<void> {
  if (Platform.OS === 'ios' && native?.shareAsync) {
    await native.shareAsync(message);
    return;
  }
  await Share.share({ message });
}

/** Whether several files can go in one share sheet (this build has the native function). */
export function canShareFilesTogether(): boolean {
  return typeof native?.shareFilesAsync === 'function';
}

/**
 * Shares several files (file:// URIs in the app's cache or files folder) in one share sheet.
 * Resolves when the sheet closes on iOS, once it is open on Android. Throws when this build has
 * no such function (check canShareFilesTogether first).
 */
export async function shareFilesTogether(uris: string[], o: { mimeType?: string; title?: string } = {}): Promise<void> {
  if (!native?.shareFilesAsync) throw new Error('sharing-unavailable');
  if (Platform.OS === 'ios') await native.shareFilesAsync(uris);
  else await native.shareFilesAsync(uris, o.mimeType ?? null, o.title ?? null);
}
