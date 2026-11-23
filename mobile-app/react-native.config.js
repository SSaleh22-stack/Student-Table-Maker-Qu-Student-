/**
 * Google sign-in is Android only (backup to Google Drive, NB-86a). iOS backs up to iCloud Drive,
 * so the google-signin native code must not be linked into the iOS app.
 *
 * Autolinking check (Expo SDK 58, @react-native-google-signin/google-signin 17.0.0, 2026-11-23):
 * - The package ships expo-module.config.json (platforms: ios, an Expo adapter podspec with an
 *   AppDelegate subscriber) AND a plain RNGoogleSignin.podspec without a react-native.config.js.
 * - `npx expo-modules-autolinking resolve --platform ios` listed it  -> Expo autolinking links it.
 * - `npx expo-modules-autolinking react-native-config --platform ios` listed RNGoogleSignin.podspec
 *   -> RN-CLI autolinking (Expo's implementation used by the Podfile) links it too.
 * Both link it, so both excludes are in place:
 * - package.json  expo.autolinking.ios.exclude = ['@react-native-google-signin/google-signin']
 *   (in SDK 58 this alone removes it from BOTH commands' iOS output)
 * - this file: platforms.ios = null (removes it from the RN-CLI iOS output even without the
 *   package.json exclude). Android still links it through RN-CLI autolinking, as intended.
 * Re-run both commands after upgrading the package or Expo.
 */
module.exports = {
  dependencies: {
    '@react-native-google-signin/google-signin': {
      platforms: {
        ios: null,
      },
    },
  },
};
