/**
 * Google sign-in for the Drive backup (NB-86a): the STUB used on iOS and web.
 *
 * Metro picks googleAuth.android.ts on Android; every other platform gets this file, which never
 * imports the Google sign-in package (only googleAuth.android.ts does), so it is never bundled for
 * iOS (its iOS native side is also excluded from autolinking, see package.json expo.autolinking).
 * Every function resolves 'unavailable'.
 *
 * TypeScript always resolves './googleAuth' to this file, so the types below are THE API: the
 * Android file imports them and must export the same functions.
 */
import type { TokenResult } from '@/notebook/core/backup/drive';

/** The scope that lets the app see only the files it created (NB-86a). */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export type GoogleAvailability = 'ok' | 'unavailable' | 'no-play-services';

export type GoogleSignInResult =
  | { ok: true; account: string }
  | { ok: false; error: 'cancelled' | 'unavailable' | 'no-play-services' | 'network' | 'revoked' | 'signed-out' | 'unknown' };

export type GoogleSilentResult = { ok: true; account: string } | { ok: false; error: 'unavailable' | 'revoked' | 'network' | 'signed-out' };

/** True only in the Android file. */
export const googleAuthSupported = false;

/**
 * Sign-in is configured (a web client id in app.json extra.notebook.googleWebClientId) and Google
 * Play services are present. interactive: let Play services offer its update dialog.
 */
export async function availability(_o?: { interactive?: boolean }): Promise<GoogleAvailability> {
  return 'unavailable';
}

/** Interactive sign-in (the account chooser), asking for the drive.file scope. */
export async function signIn(): Promise<GoogleSignInResult> {
  return { ok: false, error: 'unavailable' };
}

/** Restores the previous sign-in without any UI. */
export async function signInSilently(): Promise<GoogleSilentResult> {
  return { ok: false, error: 'unavailable' };
}

/** An access token for Drive (refresh: drop the cached one first). The DriveClient token source. */
export async function tokenFor(_refresh: boolean): Promise<TokenResult> {
  return { error: 'unavailable' };
}

/** The signed-in account's e-mail, or null. */
export async function currentAccount(): Promise<string | null> {
  return null;
}

export async function signOut(): Promise<'ok' | 'unavailable'> {
  return 'unavailable';
}

export async function revokeAccess(): Promise<'ok' | 'unavailable'> {
  return 'unavailable';
}
