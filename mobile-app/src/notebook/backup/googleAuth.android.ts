/**
 * Google sign-in for the Drive backup (NB-86a), Android only. This is the ONLY file in the app that
 * imports '@react-native-google-signin/google-signin' (v17, the free "Original" API). Metro resolves
 * './googleAuth' to this file on Android and to the stub (googleAuth.ts) everywhere else; the types
 * come from the stub, which is the API both files share.
 *
 * - configure() runs once, lazily, with the web client id from app.json
 *   extra.notebook.googleWebClientId and the drive.file scope (the app sees only files it created).
 *   No offline access: the app talks to Drive itself, never through a server.
 * - tokenFor(refresh) is the DriveClient token source. refresh = clearCachedAccessToken(last token)
 *   then getTokens, so a token Drive rejected with 401 is never handed out again.
 * - The revocation rule: tokenFor reports 'revoked' ONLY when silent sign-in fails with
 *   SIGN_IN_REQUIRED (v17 turns that rejection into a 'noSavedCredentialFound' result) or the token
 *   endpoint answers invalid_grant. Network problems give 'network'; anything else 'signed-out',
 *   which is temporary (backup stays on and the next run tries again).
 */
import Constants from 'expo-constants';
import { GoogleSignin, isErrorWithCode, statusCodes, type User } from '@react-native-google-signin/google-signin';

import type { TokenResult } from '@/notebook/core/backup/drive';

import type { GoogleAvailability, GoogleSignInResult, GoogleSilentResult } from './googleAuth';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const googleAuthSupported = true;

/** GMS CommonStatusCodes.NETWORK_ERROR (the error code arrives as a string). */
const NETWORK_ERROR_CODE = '7';

function webClientId(): string {
  const extra = Constants.expoConfig?.extra as { notebook?: { googleWebClientId?: unknown } } | undefined;
  const id = extra?.notebook?.googleWebClientId;
  return typeof id === 'string' ? id.trim() : '';
}

let configured = false;

/** Configures the module once. False when no web client id is set (backup then reports 'unavailable'). */
function ensureConfigured(): boolean {
  if (configured) return true;
  const id = webClientId();
  if (!id) return false;
  GoogleSignin.configure({ webClientId: id, scopes: [DRIVE_FILE_SCOPE], offlineAccess: false });
  configured = true;
  return true;
}

function textOf(e: unknown): string {
  if (e instanceof Error) return `${isErrorWithCode(e) ? e.code : ''} ${e.message}`;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function isNetworkFailure(e: unknown): boolean {
  if (isErrorWithCode(e) && e.code === NETWORK_ERROR_CODE) return true;
  return /network|timed? ?out|timeout|unable to resolve host|IOException|SocketException|UnknownHost/i.test(textOf(e));
}

/** Classifies a failed getTokens / silent sign-in rejection. */
function tokenFailure(e: unknown): 'revoked' | 'network' | 'signed-out' {
  if (/invalid_grant/i.test(textOf(e))) return 'revoked';
  if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_REQUIRED) return 'revoked';
  if (isNetworkFailure(e)) return 'network';
  return 'signed-out';
}

const hasDriveScope = (u: User | null | undefined): boolean => !!u && Array.isArray(u.scopes) && u.scopes.includes(DRIVE_FILE_SCOPE);

export async function availability(o?: { interactive?: boolean }): Promise<GoogleAvailability> {
  if (!ensureConfigured()) return 'unavailable';
  try {
    const ok = await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: o?.interactive === true });
    return ok ? 'ok' : 'no-play-services';
  } catch {
    // PLAY_SERVICES_NOT_AVAILABLE (missing, disabled or too old).
    return 'no-play-services';
  }
}

export async function signIn(): Promise<GoogleSignInResult> {
  const avail = await availability({ interactive: true });
  if (avail !== 'ok') return { ok: false, error: avail };
  try {
    const res = await GoogleSignin.signIn();
    if (res.type !== 'success') return { ok: false, error: 'cancelled' };
    let user = res.data;
    if (!hasDriveScope(user)) {
      // The student unticked the Drive permission on the consent screen: ask for it once more.
      const added = await GoogleSignin.addScopes({ scopes: [DRIVE_FILE_SCOPE] });
      if (!added || added.type !== 'success' || !hasDriveScope(added.data)) return { ok: false, error: 'cancelled' };
      user = added.data;
    }
    return { ok: true, account: user.user.email };
  } catch (e) {
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS) return { ok: false, error: 'cancelled' };
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return { ok: false, error: 'no-play-services' };
    }
    if (isNetworkFailure(e)) return { ok: false, error: 'network' };
    return { ok: false, error: 'unknown' };
  }
}

export async function signInSilently(): Promise<GoogleSilentResult> {
  if (!ensureConfigured()) return { ok: false, error: 'unavailable' };
  try {
    const res = await GoogleSignin.signInSilently();
    // v17 resolves SIGN_IN_REQUIRED as 'noSavedCredentialFound': the grant is gone (revoked, or the
    // account was removed from the device).
    if (res.type !== 'success') return { ok: false, error: 'revoked' };
    if (!hasDriveScope(res.data)) return { ok: false, error: 'revoked' };
    return { ok: true, account: res.data.user.email };
  } catch (e) {
    return { ok: false, error: tokenFailure(e) };
  }
}

/** The last token handed out, so a refresh can clear it from the Play services cache. */
let lastToken: string | null = null;

export async function tokenFor(refresh: boolean): Promise<TokenResult> {
  if (!ensureConfigured()) return { error: 'unavailable' };
  try {
    if (refresh || !GoogleSignin.getCurrentUser()) {
      const s = await signInSilently();
      if (!s.ok) return { error: s.error };
    }
    if (refresh && lastToken) {
      const stale = lastToken;
      lastToken = null;
      try {
        await GoogleSignin.clearCachedAccessToken(stale);
      } catch {
        // Already gone from the cache.
      }
    }
    const t = await GoogleSignin.getTokens();
    if (!t.accessToken) return { error: 'signed-out', message: 'empty access token' };
    lastToken = t.accessToken;
    return t.accessToken;
  } catch (e) {
    return { error: tokenFailure(e), message: textOf(e).trim().slice(0, 300) };
  }
}

export async function currentAccount(): Promise<string | null> {
  if (!ensureConfigured()) return null;
  try {
    return GoogleSignin.getCurrentUser()?.user.email ?? null;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<'ok' | 'unavailable'> {
  if (!ensureConfigured()) return 'unavailable';
  lastToken = null;
  try {
    await GoogleSignin.signOut();
  } catch {
    // Signed out already.
  }
  return 'ok';
}

export async function revokeAccess(): Promise<'ok' | 'unavailable'> {
  if (!ensureConfigured()) return 'unavailable';
  lastToken = null;
  try {
    await GoogleSignin.revokeAccess();
  } catch {
    // Nothing to revoke.
  }
  return 'ok';
}
