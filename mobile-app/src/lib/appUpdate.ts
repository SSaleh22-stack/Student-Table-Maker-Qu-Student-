/**
 * Update check: compares this app's version with https://qustudent.net/app-version.json
 * (source: web-app/public/app-version.json).
 *
 *   version < minimum           → "required": the app is blocked until the student updates.
 *   minimum ≤ version < latest  → "optional": a prompt with "Later"; it comes back only when
 *                                 `latest` goes up again.
 *   otherwise, offline or error → nothing, so the app never locks anyone out by mistake.
 *
 * Raise the numbers in that file only after the new version is live in both stores.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

const VERSION_URL = 'https://qustudent.net/app-version.json';
const DISMISSED_KEY = 'qu-student:update-dismissed';
const TIMEOUT_MS = 8000;

const ANDROID_PACKAGE = 'net.qustudent.app';
const ANDROID_STORE = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
const FALLBACK_URL = 'https://qustudent.net';

interface VersionFile {
  latest?: string;
  minimum?: string;
  message_ar?: string;
  message_en?: string;
  ios_url?: string;
  android_url?: string;
}

export interface UpdateInfo {
  kind: 'required' | 'optional';
  latest: string;
  messageAr: string;
  messageEn: string;
  storeUrl: string;
}

export const currentVersion = (): string => Constants.expoConfig?.version ?? '0.0.0';

/** -1 if a < b, 0 if equal, 1 if a > b. "1.10.0" > "1.9.2"; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const isVersion = (v: unknown): v is string => typeof v === 'string' && /^\d+(\.\d+)*$/.test(v.trim());

/** Returns what to show, or null when the app is up to date (or the check could not run). */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  // The web build is always the newest one; there is no store to send anyone to.
  if (Platform.OS === 'web') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let data: VersionFile;
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return null;
    data = (await res.json()) as VersionFile;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  const version = currentVersion();
  const latest = isVersion(data.latest) ? data.latest.trim() : null;
  const minimum = isVersion(data.minimum) ? data.minimum.trim() : null;

  let kind: UpdateInfo['kind'] | null = null;
  if (minimum && compareVersions(version, minimum) < 0) {
    kind = 'required';
  } else if (latest && compareVersions(version, latest) < 0) {
    const dismissed = await AsyncStorage.getItem(DISMISSED_KEY).catch(() => null);
    if (dismissed !== latest) kind = 'optional';
  }
  if (!kind) return null;

  const storeUrl =
    Platform.OS === 'ios'
      ? data.ios_url?.trim() || FALLBACK_URL
      : data.android_url?.trim() || ANDROID_STORE;

  return {
    kind,
    latest: latest ?? minimum ?? version,
    messageAr: data.message_ar?.trim() ?? '',
    messageEn: data.message_en?.trim() ?? '',
    storeUrl,
  };
}

/** "Later" on the optional prompt: stay quiet until a newer `latest` is published. */
export function dismissUpdate(latest: string) {
  AsyncStorage.setItem(DISMISSED_KEY, latest).catch(() => {});
}

/** Opens the store page. On Android the Play Store app is tried first. */
export async function openStore(url: string) {
  if (Platform.OS === 'android' && url.includes('play.google.com')) {
    const market = `market://details?id=${ANDROID_PACKAGE}`;
    try {
      await Linking.openURL(market);
      return;
    } catch {
      // No Play Store app; fall through to the web page.
    }
  }
  Linking.openURL(url).catch(() => {});
}
