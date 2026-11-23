/**
 * Metro config: Expo's defaults, plus one web rule.
 *
 * The notebook (المذكرات) runs only on iOS and Android (NB-2). Each notebook route has a .web.tsx
 * stub that redirects home. Expo Router's route context still bundles the native route files for
 * web as lazy chunks, though, and those reach @shopify/react-native-skia (the canvas, the painter
 * and the spike screen). On web that package resolves to an empty module. No web screen ever
 * renders that code (the .web.tsx routes win, and NotebookServices.web.tsx renders null), and the
 * web export then carries no Skia or CanvasKit (ruling (e), checked by P30 with
 * `npx expo export -p web`).
 * See https://docs.expo.dev/versions/latest/config/metro/ (Mocking modules).
 */
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const WEB_EMPTY = ['@shopify/react-native-skia'];

const isWebEmpty = (moduleName) => WEB_EMPTY.some((m) => moduleName === m || moduleName.startsWith(`${m}/`));

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && isWebEmpty(moduleName)) return { type: 'empty' };
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
