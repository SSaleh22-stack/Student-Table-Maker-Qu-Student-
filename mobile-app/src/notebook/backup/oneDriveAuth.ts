/**
 * Microsoft sign-in for the OneDrive backup (iOS and Android), with expo-auth-session: the
 * authorization-code flow with PKCE on the Microsoft identity platform (a public client: no secret
 * in the app).
 *
 * - Client id: app.json extra.notebook.onedriveClientId (an app registration in Microsoft Entra, the
 *   'Mobile and desktop applications' platform with the redirect URI below). Without it every call
 *   answers 'unavailable'.
 * - Redirect URI: qustudent://onedrive (the app's scheme). Expo Go cannot receive it: OneDrive needs a
 *   development or store build.
 * - Scopes: Files.ReadWrite.AppFolder (the app sees ONLY its own folder, Apps/QU Student, in the
 *   student's OneDrive), User.Read (the account name shown in the settings), offline_access (a refresh
 *   token, so backups run without signing in again).
 * - The refresh token and the account name are kept in the keychain / keystore (expo-secure-store).
 *   Access tokens live in memory only.
 * - tokenFor(refresh) is the provider's token source. 'revoked' only when Microsoft rejects the refresh
 *   token (invalid_grant: the student removed the app's access or changed the password); network
 *   problems give 'network'; no saved sign-in gives 'signed-out'.
 */
import {
  AuthRequest,
  ResponseType,
  exchangeCodeAsync,
  makeRedirectUri,
  refreshAsync,
  type DiscoveryDocument,
} from 'expo-auth-session';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import type { BackupError } from '@/notebook/core/contracts/backup';

export const ONEDRIVE_SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read', 'offline_access'];

const DISCOVERY: DiscoveryDocument = {
  authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
};

const REFRESH_KEY = 'qu-student.onedrive.refresh';
const ACCOUNT_KEY = 'qu-student.onedrive.account';

/** Refresh the access token this long before it expires (ms). */
const EARLY_MS = 2 * 60_000;

export function onedriveClientId(): string {
  const extra = Constants.expoConfig?.extra as { notebook?: { onedriveClientId?: unknown } } | undefined;
  const id = extra?.notebook?.onedriveClientId;
  return typeof id === 'string' ? id.trim() : '';
}

export const onedriveRedirectUri = (): string => makeRedirectUri({ scheme: 'qustudent', path: 'onedrive' });

let access: { token: string; expiresAt: number } | null = null;

export type TokenFailure = Extract<BackupError, 'revoked' | 'network' | 'signed-out' | 'unavailable'>;

function textOf(e: unknown): string {
  if (e instanceof Error) return `${(e as { code?: string }).code ?? ''} ${e.message}`;
  return String(e);
}

function failureOf(e: unknown): TokenFailure {
  const t = textOf(e);
  if (/invalid_grant|interaction_required|consent_required/i.test(t)) return 'revoked';
  if (/network|timed? ?out|timeout|failed to fetch|offline|ENOTFOUND|UnknownHost/i.test(t)) return 'network';
  return 'signed-out';
}

async function save(refreshToken: string | undefined): Promise<void> {
  if (refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
}

async function fetchAccount(token: string): Promise<string> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail,displayName', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return 'OneDrive';
    const me = (await res.json()) as { mail?: string | null; userPrincipalName?: string | null; displayName?: string | null };
    return me.mail || me.userPrincipalName || me.displayName || 'OneDrive';
  } catch {
    return 'OneDrive';
  }
}

export function availability(): 'ok' | 'unavailable' {
  return onedriveClientId() ? 'ok' : 'unavailable';
}

/** Interactive sign-in in the system browser (Microsoft's account page). */
export async function signIn(): Promise<{ ok: true; account: string } | { ok: false; error: TokenFailure | 'cancelled' }> {
  const clientId = onedriveClientId();
  if (!clientId) return { ok: false, error: 'unavailable' };
  const redirectUri = onedriveRedirectUri();
  try {
    const req = new AuthRequest({
      clientId,
      scopes: ONEDRIVE_SCOPES,
      redirectUri,
      responseType: ResponseType.Code,
      usePKCE: true,
      extraParams: { prompt: 'select_account' },
    });
    const res = await req.promptAsync(DISCOVERY);
    if (res.type !== 'success' || !res.params.code) return { ok: false, error: res.type === 'error' ? 'signed-out' : 'cancelled' };
    const tokens = await exchangeCodeAsync(
      { clientId, code: res.params.code, redirectUri, extraParams: req.codeVerifier ? { code_verifier: req.codeVerifier } : undefined },
      DISCOVERY,
    );
    access = { token: tokens.accessToken, expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000 };
    await save(tokens.refreshToken);
    const account = await fetchAccount(tokens.accessToken);
    await SecureStore.setItemAsync(ACCOUNT_KEY, account);
    return { ok: true, account };
  } catch (e) {
    return { ok: false, error: failureOf(e) };
  }
}

/** An access token (refresh: drop the cached one first), or why there is none. */
export async function tokenFor(refresh: boolean): Promise<string | { error: TokenFailure; message?: string }> {
  const clientId = onedriveClientId();
  if (!clientId) return { error: 'unavailable' };
  if (!refresh && access && access.expiresAt - EARLY_MS > Date.now()) return access.token;
  access = null;
  let refreshToken: string | null = null;
  try {
    refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    refreshToken = null;
  }
  if (!refreshToken) return { error: 'signed-out' };
  try {
    const tokens = await refreshAsync({ clientId, refreshToken, scopes: ONEDRIVE_SCOPES }, DISCOVERY);
    access = { token: tokens.accessToken, expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000 };
    // Microsoft rotates refresh tokens: keep the newest.
    await save(tokens.refreshToken);
    return tokens.accessToken;
  } catch (e) {
    return { error: failureOf(e), message: textOf(e).slice(0, 300) };
  }
}

/** Restores the saved sign-in without any UI. */
export async function signInSilently(): Promise<{ ok: true; account: string } | { ok: false; error: TokenFailure }> {
  const t = await tokenFor(false);
  if (typeof t !== 'string') return { ok: false, error: t.error };
  return { ok: true, account: (await currentAccount()) ?? 'OneDrive' };
}

export async function currentAccount(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  access = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(ACCOUNT_KEY).catch(() => {});
}
