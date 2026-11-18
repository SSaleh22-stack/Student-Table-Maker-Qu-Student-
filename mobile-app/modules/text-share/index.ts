import { requireOptionalNativeModule } from 'expo';
import { Platform, Share } from 'react-native';

type TextShareModule = { shareAsync(message: string): Promise<boolean> };

// Missing in Expo Go and in builds made before this module was added: React Native's sheet is used then.
const native = Platform.OS === 'ios' ? requireOptionalNativeModule<TextShareModule>('TextShare') : null;

/**
 * Opens the share sheet with `message`. On iOS this goes through our own module, so the sheet
 * is anchored on regular-width iPhones (iPhone Duo's inner display), where React Native's
 * `Share.share` crashes. Elsewhere it is React Native's `Share.share`.
 */
export async function shareText(message: string): Promise<void> {
  if (native) {
    await native.shareAsync(message);
    return;
  }
  await Share.share({ message });
}
