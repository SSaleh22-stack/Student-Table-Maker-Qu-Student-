/**
 * Builds a signed Android App Bundle (.aab) on this computer, for when EAS cloud builds aren't available.
 *
 *   1. npx expo prebuild --platform android --no-install   (android/ is generated and gitignored)
 *      Set the versionCode first: it must be higher than the last upload to Google Play.
 *   2. npx eas-cli credentials -p android → production → credentials.json → "Download credentials from EAS"
 *      This writes credentials.json and credentials/android/keystore.jks (both gitignored).
 *   3. node scripts/build-android-local.mjs
 *
 * With --apk it builds an installable APK instead (same signing key), to test on a phone without
 * going through Google Play.
 *
 * The keystore passwords are read from credentials.json and handed to Gradle through environment
 * variables, so they are never printed or written anywhere else. The bundle is copied to dist/.
 *
 * Tool locations can be overridden with JAVA_HOME, ANDROID_HOME and GRADLE_USER_HOME.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apk = process.argv.includes('--apk');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');

const JAVA_HOME = process.env.JAVA_HOME || 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.19.10-hotspot';
const ANDROID_HOME = process.env.ANDROID_HOME || 'D:\\Android\\sdk';
const GRADLE_USER_HOME = process.env.GRADLE_USER_HOME || 'D:\\Android\\gradle-home';

const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

if (!existsSync(androidDir)) fail('android/ is missing. Run: npx expo prebuild --platform android --no-install');
for (const [name, dir] of Object.entries({ JAVA_HOME, ANDROID_HOME })) {
  if (!existsSync(dir)) fail(`${name} not found at ${dir}`);
}

const credPath = join(root, 'credentials.json');
if (!existsSync(credPath)) fail('credentials.json is missing. Download it with: npx eas-cli credentials -p android');
const ks = JSON.parse(readFileSync(credPath, 'utf8'))?.android?.keystore;
if (!ks?.keystorePath || !ks.keystorePassword || !ks.keyAlias || !ks.keyPassword) {
  fail('credentials.json has no complete android.keystore entry.');
}
const keystoreFile = resolve(root, ks.keystorePath);
if (!existsSync(keystoreFile)) fail(`Keystore file not found: ${ks.keystorePath}`);

// Gradle finds the SDK through local.properties (forward slashes are fine on Windows).
writeFileSync(join(androidDir, 'local.properties'), `sdk.dir=${ANDROID_HOME.replace(/\\/g, '/')}\n`);

const versionCode = readFileSync(join(androidDir, 'app', 'build.gradle'), 'utf8').match(/versionCode\s+(\d+)/)?.[1];
const versionName = readFileSync(join(androidDir, 'app', 'build.gradle'), 'utf8').match(/versionName\s+"([^"]+)"/)?.[1];
console.log(`Building ${apk ? 'an APK' : 'an App Bundle'} of ${versionName} (versionCode ${versionCode}), signed with key "${ks.keyAlias}"…\n`);

const env = {
  ...process.env,
  JAVA_HOME,
  ANDROID_HOME,
  ANDROID_SDK_ROOT: ANDROID_HOME,
  GRADLE_USER_HOME,
  PATH: `${join(JAVA_HOME, 'bin')};${process.env.PATH}`,
  NODE_ENV: 'production',
  // Android Gradle Plugin's "injected" signing: overrides the release signing config for this run only.
  'ORG_GRADLE_PROJECT_android.injected.signing.store.file': keystoreFile,
  'ORG_GRADLE_PROJECT_android.injected.signing.store.password': ks.keystorePassword,
  'ORG_GRADLE_PROJECT_android.injected.signing.key.alias': ks.keyAlias,
  'ORG_GRADLE_PROJECT_android.injected.signing.key.password': ks.keyPassword,
  // The same key under the names android/app/build.gradle's release signingConfig reads
  // (project.property('QU_UPLOAD_…')); without them Gradle stops while configuring the app.
  ORG_GRADLE_PROJECT_QU_UPLOAD_STORE_FILE: keystoreFile,
  ORG_GRADLE_PROJECT_QU_UPLOAD_STORE_PASSWORD: ks.keystorePassword,
  ORG_GRADLE_PROJECT_QU_UPLOAD_KEY_ALIAS: ks.keyAlias,
  ORG_GRADLE_PROJECT_QU_UPLOAD_KEY_PASSWORD: ks.keyPassword,
};

// ".\" so it is found even when NoDefaultCurrentDirectoryInExePath is set.
const gradle = spawnSync('cmd.exe', ['/d', '/c', '.\\gradlew.bat', apk ? 'assembleRelease' : 'bundleRelease', '--no-daemon'], {
  cwd: androidDir,
  env,
  stdio: 'inherit',
});
if (gradle.status !== 0) fail(`Gradle failed (exit ${gradle.status}).`);

const built = apk
  ? join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
  : join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
if (!existsSync(built)) fail(`Build finished but ${built} was not found.`);
mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', `qu-student-${versionName}-${versionCode}.${apk ? 'apk' : 'aab'}`);
copyFileSync(built, out);

// Show who signed it, so it can be checked against the upload key in Play Console.
// keytool only reads the old jar signature, which APKs no longer carry, so APKs go through apksigner.
console.log('\nSigning certificate:');
if (apk) {
  const tools = join(ANDROID_HOME, 'build-tools');
  const latest = readdirSync(tools).sort().pop();
  spawnSync('cmd.exe', ['/d', '/c', join(tools, latest, 'apksigner.bat'), 'verify', '--print-certs', out], { env, stdio: 'inherit' });
} else {
  spawnSync(join(JAVA_HOME, 'bin', 'keytool.exe'), ['-printcert', '-jarfile', out], { stdio: 'inherit' });
}
console.log(`\n✔ ${out}\n`);
