// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// The notebook core (src/notebook/core/**) runs in plain Node for the unit tests and on any JS
// runtime in the app, so it may import only other core files (relative paths with .ts extensions)
// and fflate. Pure enums and codes shared with core live in src/notebook/core/contracts.
const CORE_MESSAGE =
  'src/notebook/core may import only other core files (relative, with .ts) and fflate: no @/ aliases, react, react-native, expo, store, app contracts or ui.';

const corePatterns = (depth) => [
  // Every bare import except fflate: '@/…' aliases, react, react-native*, expo*, @expo/*, node:*, …
  { regex: '^(?!\\.{1,2}(/|$)|fflate(/|$))', message: CORE_MESSAGE },
  // Relative imports that climb out of src/notebook/core (to ../store, ../contracts, ../ui, …).
  { regex: `^(\\.\\./){${depth + 1},}`, message: CORE_MESSAGE },
];

const coreBlock = (depth) => ({
  files: [`src/notebook/core/${'*/'.repeat(depth)}*.{ts,tsx,js}`],
  rules: {
    'no-restricted-imports': ['error', { patterns: corePatterns(depth) }],
  },
});

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  // One block per folder depth below core, so "climbs out of core" is exact for each file.
  ...[0, 1, 2, 3, 4, 5, 6].map(coreBlock),
]);
