/**
 * Foundation smoke test (P01): the test runner works with type stripping, and the notebook's
 * project configuration keeps the decisions the other packages rely on.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readText = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');
const readJson = (rel: string): any => JSON.parse(readText(rel));

type PluginEntry = string | [string, Record<string, unknown>];
const pluginName = (p: PluginEntry): string => (Array.isArray(p) ? p[0] : p);
const pluginProps = (plugins: PluginEntry[], name: string): any => {
  const entry = plugins.find((p) => pluginName(p) === name);
  return Array.isArray(entry) ? entry[1] : undefined;
};

describe('node test runner', () => {
  test('runs TypeScript with erasable syntax', () => {
    const pair: readonly [number, string] = [1, 'a'];
    assert.equal(pair.length, 2);
  });
});

describe('app.json', () => {
  const expo = readJson('app.json').expo;
  const plugins: PluginEntry[] = expo.plugins;
  const names = plugins.map(pluginName);

  test('keeps the existing plugins first, in order, and adds the notebook ones after expo-notifications', () => {
    assert.deepEqual(names, [
      'expo-router',
      'expo-splash-screen',
      'expo-localization',
      'expo-sharing',
      'expo-image',
      'expo-status-bar',
      'expo-web-browser',
      'expo-notifications',
      'expo-audio',
      'expo-camera',
      'expo-image-picker',
      'expo-dev-client',
      './plugins/withNotebookNative',
      // OneDrive backup: the refresh token in the keychain / keystore.
      'expo-secure-store',
    ]);
  });

  test('records in the foreground only, with no background audio', () => {
    const audio = pluginProps(plugins, 'expo-audio');
    assert.equal(audio.enableBackgroundRecording, false);
    assert.equal(audio.enableBackgroundPlayback, false);
    assert.equal(audio.recordAudioAndroid, true);
    assert.ok(expo.android.blockedPermissions.includes('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'));
    assert.ok(expo.android.blockedPermissions.includes('android.permission.FOREGROUND_SERVICE_MICROPHONE'));
  });

  test('has Arabic permission texts', () => {
    const mic = 'يستخدم QU Student الميكروفون لتسجيل المحاضرة أثناء كتابة ملاحظاتك في المذكرات.';
    assert.equal(pluginProps(plugins, 'expo-audio').microphonePermission, mic);
    assert.equal(pluginProps(plugins, 'expo-camera').microphonePermission, mic);
    assert.equal(pluginProps(plugins, 'expo-camera').barcodeScannerEnabled, false);
    assert.equal(pluginProps(plugins, 'expo-image-picker').photosPermission, 'يحتاج QU Student إلى صورك لإضافتها كصفحات أو صور داخل المذكرات.');
  });

  test('does not use the google-signin config plugin (Android with a web client id needs none)', () => {
    assert.ok(!names.includes('@react-native-google-signin/google-signin'));
  });

  test('receives PDFs and .qunote files', () => {
    const share = pluginProps(plugins, 'expo-sharing');
    assert.equal(share.android.enabled, true);
    assert.ok(share.android.singleShareMimeTypes.includes('application/vnd.qustudent.qunote'));
    assert.notEqual(share.ios?.enabled, true, 'the iOS share extension stays off');
    const plist = expo.ios.infoPlist;
    assert.deepEqual(
      plist.CFBundleDocumentTypes.map((d: any) => d.LSItemContentTypes[0]),
      ['com.adobe.pdf', 'net.qustudent.qunote'],
    );
    assert.equal(plist.UTExportedTypeDeclarations[0].UTTypeIdentifier, 'net.qustudent.qunote');
    // plugins/withNotebookNative.ts is the only writer of this key.
    assert.equal('LSSupportsOpeningDocumentsInPlace' in plist, false);
    const viewMimes = expo.android.intentFilters.flatMap((f: any) => f.data.map((d: any) => d.mimeType));
    assert.ok(viewMimes.includes('application/pdf'));
    assert.ok(viewMimes.includes('application/vnd.qustudent.qunote'));
  });

  test('declares the iCloud container and the notebook extras', () => {
    const container = 'iCloud.net.qustudent.app';
    assert.ok(container in expo.ios.infoPlist.NSUbiquitousContainers);
    assert.deepEqual(expo.ios.entitlements['com.apple.developer.icloud-services'], ['CloudDocuments']);
    assert.deepEqual(expo.ios.entitlements['com.apple.developer.ubiquity-container-identifiers'], [container]);
    assert.equal(expo.extra.notebook.icloudContainer, container);
    // The Google Cloud Web OAuth client (Android Drive sign-in).
    assert.match(expo.extra.notebook.googleWebClientId, /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
  });
});

describe('package.json', () => {
  const pkg = readJson('package.json');

  test('links google-signin on iOS too (Google Drive backup on iPhone and iPad)', () => {
    assert.equal(pkg.expo?.autolinking?.ios?.exclude?.includes('@react-native-google-signin/google-signin') ?? false, false);
    assert.ok(pkg.dependencies['@react-native-google-signin/google-signin']);
  });

  test('has the notebook scripts', () => {
    assert.match(pkg.scripts.test, /--experimental-strip-types --test/);
    assert.equal(pkg.scripts['typecheck:core'], 'tsc -p tsconfig.core.json');
    assert.equal(pkg.scripts.gate, 'node scripts/notebook-gate.mjs');
  });

  test('installs the scoped Skia package, never the unscoped one', () => {
    assert.ok(pkg.dependencies['@shopify/react-native-skia']);
    assert.equal(pkg.dependencies['react-native-skia'], undefined);
  });

  test('keeps expo-sharing at the patched version', () => {
    assert.equal(readJson('node_modules/expo-sharing/package.json').version, '58.0.23');
    assert.ok(fs.existsSync(path.join(root, 'patches', 'expo-sharing+58.0.23.patch')));
  });
});

describe('eas.json', () => {
  const build = readJson('eas.json').build;

  test('has the development-client profiles on the same iOS image as the store builds', () => {
    assert.equal(build.development.developmentClient, true);
    assert.equal(build.development.distribution, 'internal');
    assert.equal(build.development.android.buildType, 'apk');
    assert.equal(build.development.ios.image, build.production.ios.image);
    assert.equal(build['development-simulator'].extends, 'development');
    assert.equal(build['development-simulator'].ios.simulator, true);
  });
});

describe('scripts/notebook-owners.json', () => {
  const owners: Record<string, { files: string[]; tests: string[] }> = readJson('scripts/notebook-owners.json');

  test('lists every package with disjoint files', () => {
    const ids = Object.keys(owners);
    assert.equal(ids.length, 34);
    assert.ok(ids.includes('P01') && ids.includes('P30') && ids.includes('P22N'));
    const seen = new Map<string, string>();
    for (const [id, entry] of Object.entries(owners)) {
      assert.ok(entry.files.length > 0, `${id} owns files`);
      for (const file of entry.files) {
        assert.equal(seen.get(file), undefined, `${file} is owned by ${seen.get(file)} and ${id}`);
        seen.set(file, id);
      }
      for (const t of entry.tests) assert.ok(entry.files.includes(t), `${id} test ${t} is one of its files`);
    }
  });
});

describe('notebook source rules', () => {
  test('nav.ts imports only expo-router', () => {
    const sources = [...readText('src/notebook/nav.ts').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(sources, ['expo-router']);
  });

  test('the core checker uses erasable syntax and Node types', () => {
    const core = readJson('tsconfig.core.json').compilerOptions;
    assert.equal(core.erasableSyntaxOnly, true);
    assert.equal(core.verbatimModuleSyntax, true);
    assert.deepEqual(core.types, ['node']);
  });
});
