/**
 * Hand-written Google Drive v3 client (P09), scope drive.file: the app sees only files it created.
 * fetch, the token source, sleep and randomness are injected (P20 passes expo/fetch, see fetchTypes.ts).
 *
 * Folders made here carry appProperties { quApp: 'qu-student' }. When two devices race and create the
 * same folder twice, every lookup picks the OLDEST match (orderBy createdTime), so both converge.
 *
 * Auth: every request sends 'Authorization: Bearer <token>'. A 401 calls getToken(true) once and
 * retries. If the refresh fails, or the retried request is a 401 again, the error is classified:
 * 'invalid_grant' anywhere in the failure, or getToken reporting { error: 'revoked' }, gives 'revoked'
 * (final: P20 turns backup off); a getToken { error: 'network' } gives 'network'; anything else gives
 * 'signed-out', which is NOT final (the next run tries again).
 *
 * Retries: 403 rateLimitExceeded / userRateLimitExceeded, 429, 5xx and network failures are retried
 * with exponential backoff (1 s doubling, at most 32 s, plus up to 1 s of jitter; Retry-After wins),
 * maxRetries times. 403 storageQuotaExceeded gives 'quota'. Aborts throw BackupAbortError.
 */
import type { AbortSignalLike, BackupError } from '../contracts/backup.ts';
import { isRecord } from '../model/index.ts';
import type { FetchBody, FetchLike, HeadersLike, ResponseLike } from './fetchTypes.ts';

export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const APP_PROPERTY_KEY = 'quApp';
export const APP_PROPERTY_VALUE = 'qu-student';
export const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,createdTime,appProperties';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes (Drive sends size as a string; folders have none). */
  size?: number;
  modifiedTime?: string;
  createdTime?: string;
  appProperties?: Record<string, string>;
}

/** What getToken resolves to: a token, or why there is none. It may also throw. */
export type TokenResult = string | { error: 'revoked' | 'signed-out' | 'network' | string; message?: string };

export interface DriveClientOptions {
  fetch: FetchLike;
  /** refresh=true must bypass any cached token (P20: clearCachedAccessToken + getTokens). */
  getToken(refresh: boolean): Promise<TokenResult>;
  sleep(ms: number): Promise<void>;
  random?: () => number;
  /** Retries per request for rate limits, 5xx and network errors (default 5). */
  maxRetries?: number;
}

export interface DriveResponse {
  status: number;
  headers: HeadersLike;
  body: string;
}

export interface SendOptions {
  headers?: Record<string, string>;
  body?: FetchBody;
  signal?: AbortSignalLike;
  redirect?: 'follow' | 'manual' | 'error';
}

export class BackupAbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof BackupAbortError || (e instanceof Error && e.name === 'AbortError');
}

export class DriveError extends Error {
  code: BackupError;
  status: number;
  reason: string;
  constructor(code: BackupError, message: string, status = 0, reason = '') {
    super(message);
    this.name = 'DriveError';
    this.code = code;
    this.status = status;
    this.reason = reason;
  }
}

export function isDriveError(e: unknown): e is DriveError {
  return e instanceof DriveError;
}

/** The BackupError for anything a Drive call threw (aborts are 'unknown'; check isAbortError first). */
export function backupErrorOf(e: unknown): BackupError {
  return e instanceof DriveError ? e.code : 'unknown';
}

const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
const QUOTA_REASONS = new Set(['storageQuotaExceeded', 'quotaExceeded', 'activeItemCreationLimitExceeded']);

/** The first errors[].reason of a Drive error body ('' when none). */
export function errorReason(body: string): string {
  try {
    const j: unknown = JSON.parse(body);
    if (!isRecord(j) || !isRecord(j.error)) return '';
    const errs = j.error.errors;
    if (Array.isArray(errs)) {
      for (const e of errs) if (isRecord(e) && typeof e.reason === 'string') return e.reason;
    }
    return typeof j.error.status === 'string' ? j.error.status : '';
  } catch {
    return '';
  }
}

/** True for responses worth retrying after a pause. */
export function isRetryable(status: number, body: string): boolean {
  if (status === 429 || status >= 500) return true;
  return status === 403 && RATE_REASONS.has(errorReason(body));
}

/** Maps a non-OK response to a DriveError. */
export function errorOf(res: DriveResponse, what: string): DriveError {
  const reason = errorReason(res.body);
  let code: BackupError = 'unknown';
  if (res.status === 401) code = /invalid_grant/.test(res.body) ? 'revoked' : 'signed-out';
  else if (res.status === 403 && QUOTA_REASONS.has(reason)) code = 'quota';
  else if (isRetryable(res.status, res.body)) code = 'network';
  return new DriveError(code, `${what}: HTTP ${res.status}${reason ? ` ${reason}` : ''}`, res.status, reason);
}

function textOf(x: unknown): string {
  if (typeof x === 'string') return x;
  if (x instanceof Error) {
    const code = (x as { code?: unknown }).code;
    return `${typeof code === 'string' ? code : ''} ${x.message}`;
  }
  if (isRecord(x)) return `${typeof x.error === 'string' ? x.error : ''} ${typeof x.message === 'string' ? x.message : ''}`;
  return String(x);
}

/** Classifies a token failure (a thrown error or a { error } result). */
export function classifyTokenFailure(x: unknown): 'revoked' | 'signed-out' | 'network' {
  if (isRecord(x) && !(x instanceof Error)) {
    if (x.error === 'revoked') return 'revoked';
    if (x.error === 'network') return 'network';
  }
  return /invalid_grant/i.test(textOf(x)) ? 'revoked' : 'signed-out';
}

/** Escapes a value for a Drive q string literal. */
export function qString(v: string): string {
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const k of Object.keys(params)) {
    const v = params[k];
    if (v !== undefined) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Rebuilds a Drive file resource; null without an id. */
export function readDriveFile(raw: unknown): DriveFile | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const f: DriveFile = {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : '',
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : 'application/octet-stream',
  };
  const size = typeof raw.size === 'string' ? Number(raw.size) : typeof raw.size === 'number' ? raw.size : NaN;
  if (Number.isFinite(size) && size >= 0) f.size = size;
  if (typeof raw.modifiedTime === 'string') f.modifiedTime = raw.modifiedTime;
  if (typeof raw.createdTime === 'string') f.createdTime = raw.createdTime;
  if (isRecord(raw.appProperties)) {
    const props: Record<string, string> = {};
    for (const k of Object.keys(raw.appProperties)) {
      const v = raw.appProperties[k];
      if (typeof v === 'string' && k !== '__proto__') props[k] = v;
    }
    f.appProperties = props;
  }
  return f;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function retryAfterMs(h: HeadersLike): number | null {
  const v = h.get('retry-after');
  if (!v) return null;
  const s = Number(v);
  return Number.isFinite(s) && s >= 0 ? Math.min(60_000, s * 1000) : null;
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

export class DriveClient {
  fetchFn: FetchLike;
  tokenSource: (refresh: boolean) => Promise<TokenResult>;
  sleepFn: (ms: number) => Promise<void>;
  random: () => number;
  maxRetries: number;
  token: string | null = null;

  constructor(o: DriveClientOptions) {
    this.fetchFn = o.fetch;
    this.tokenSource = o.getToken;
    this.sleepFn = o.sleep;
    this.random = o.random ?? Math.random;
    this.maxRetries = o.maxRetries ?? 5;
  }

  /** Forgets the cached token (sign-out). */
  reset(): void {
    this.token = null;
  }

  /** A token, refreshed when asked; throws DriveError 'revoked' | 'signed-out' | 'network'. */
  async accessToken(refresh = false): Promise<string> {
    if (this.token && !refresh) return this.token;
    let r: TokenResult;
    try {
      r = await this.tokenSource(refresh);
    } catch (e) {
      this.token = null;
      throw new DriveError(classifyTokenFailure(e), `token: ${textOf(e).trim()}`, 401);
    }
    if (typeof r !== 'string' || !r) {
      this.token = null;
      throw new DriveError(classifyTokenFailure(typeof r === 'string' ? 'empty token' : r), 'token unavailable', 401);
    }
    this.token = r;
    return r;
  }

  /**
   * Waits before retry number `attempt` (1-based). An abort ends the wait at once (the injected sleep
   * cannot be cancelled, so its timer just runs out unobserved) and throws BackupAbortError.
   */
  async backoff(attempt: number, retryAfter?: number | null, signal?: AbortSignalLike): Promise<void> {
    const base = Math.min(32_000, 1000 * 2 ** Math.max(0, attempt - 1));
    const ms = retryAfter ?? base + Math.floor(this.random() * 1000);
    if (signal?.aborted) throw new BackupAbortError();
    if (!signal) {
      await this.sleepFn(ms);
      return;
    }
    let wake: () => void = () => {};
    const aborted = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const onAbort = () => wake();
    signal.addEventListener('abort', onAbort);
    try {
      await Promise.race([this.sleepFn(ms), aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    if (signal.aborted) throw new BackupAbortError();
  }

  private async raw(method: string, url: string, token: string, o: SendOptions): Promise<DriveResponse> {
    if (o.signal?.aborted) throw new BackupAbortError();
    const headers: Record<string, string> = { ...(o.headers ?? {}), Authorization: `Bearer ${token}` };
    let res: ResponseLike;
    try {
      res = await this.fetchFn(url, { method, headers, body: o.body, signal: o.signal, redirect: o.redirect, credentials: 'omit' });
    } catch (e) {
      if (o.signal?.aborted || isAbortError(e)) throw new BackupAbortError();
      throw new DriveError('network', `${method} ${url}: ${textOf(e).trim()}`);
    }
    let body = '';
    try {
      body = await res.text();
    } catch (e) {
      if (o.signal?.aborted || isAbortError(e)) throw new BackupAbortError();
      throw new DriveError('network', `${method} ${url}: body ${textOf(e).trim()}`);
    }
    return { status: res.status, headers: res.headers, body };
  }

  /**
   * One request with auth (a 401 refreshes the token once). Returns any other status as is; network
   * failures throw DriveError 'network'. Used directly by the resumable uploader.
   */
  async send(method: string, url: string, o: SendOptions = {}): Promise<DriveResponse> {
    const res = await this.raw(method, url, await this.accessToken(false), o);
    if (res.status !== 401) return res;
    const fresh = await this.accessToken(true);
    const again = await this.raw(method, url, fresh, o);
    if (again.status === 401) {
      this.token = null;
      throw errorOf(again, `${method} ${url}`);
    }
    return again;
  }

  /** send() plus backoff for rate limits, 5xx and network errors. Returns the final response. */
  async request(method: string, url: string, o: SendOptions = {}): Promise<DriveResponse> {
    for (let attempt = 0; ; attempt++) {
      let res: DriveResponse;
      try {
        res = await this.send(method, url, o);
      } catch (e) {
        if (e instanceof DriveError && e.code === 'network' && e.status === 0 && attempt < this.maxRetries) {
          await this.backoff(attempt + 1, null, o.signal);
          continue;
        }
        throw e;
      }
      if (isRetryable(res.status, res.body) && attempt < this.maxRetries) {
        await this.backoff(attempt + 1, retryAfterMs(res.headers), o.signal);
        continue;
      }
      return res;
    }
  }

  private async json(method: string, url: string, what: string, o: SendOptions = {}): Promise<unknown> {
    const res = await this.request(method, url, o);
    if (!isOk(res.status)) throw errorOf(res, what);
    return parseJson(res.body);
  }

  /** Children of parentId (not trashed), oldest first, every page. */
  async listChildren(parentId: string, o?: { folders?: boolean; name?: string; pageSize?: number; signal?: AbortSignalLike }): Promise<DriveFile[]> {
    let q = `${qString(parentId)} in parents and trashed = false`;
    if (o?.name !== undefined) q += ` and name = ${qString(o.name)}`;
    if (o?.folders === true) q += ` and mimeType = ${qString(FOLDER_MIME)}`;
    if (o?.folders === false) q += ` and mimeType != ${qString(FOLDER_MIME)}`;
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    for (let guard = 0; guard < 10_000; guard++) {
      const url = `${DRIVE_API}/files${qs({ q, fields: `nextPageToken,files(${FILE_FIELDS})`, pageSize: o?.pageSize ?? 1000, orderBy: 'createdTime', spaces: 'drive', pageToken })}`;
      const j = await this.json('GET', url, 'list', { signal: o?.signal });
      if (!isRecord(j)) throw new DriveError('unknown', 'list: bad response');
      if (Array.isArray(j.files)) {
        for (const f of j.files) {
          const file = readDriveFile(f);
          if (file) out.push(file);
        }
      }
      pageToken = typeof j.nextPageToken === 'string' && j.nextPageToken ? j.nextPageToken : undefined;
      if (!pageToken) break;
    }
    return out;
  }

  /** The oldest child with this exact name (folders only when folder is true), or null. */
  async findChild(parentId: string, name: string, o?: { folder?: boolean; signal?: AbortSignalLike }): Promise<DriveFile | null> {
    const list = await this.listChildren(parentId, { name, folders: o?.folder, pageSize: 100, signal: o?.signal });
    const exact = list.filter((f) => f.name === name);
    const ours = exact.filter((f) => f.appProperties?.[APP_PROPERTY_KEY] === APP_PROPERTY_VALUE);
    return ours[0] ?? exact[0] ?? null;
  }

  /** Finds or creates a folder (tagged with appProperties quApp). parentId 'root' is My Drive. */
  async ensureFolder(name: string, parentId: string, o?: { signal?: AbortSignalLike }): Promise<string> {
    const found = await this.findChild(parentId, name, { folder: true, signal: o?.signal });
    if (found) return found.id;
    const j = await this.json('POST', `${DRIVE_API}/files${qs({ fields: FILE_FIELDS })}`, 'create folder', {
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId], appProperties: { [APP_PROPERTY_KEY]: APP_PROPERTY_VALUE } }),
      signal: o?.signal,
    });
    const f = readDriveFile(j);
    if (!f) throw new DriveError('unknown', 'create folder: bad response');
    // A device racing us may have created one too: converge on the oldest.
    const again = await this.findChild(parentId, name, { folder: true, signal: o?.signal });
    return again ? again.id : f.id;
  }

  /** ensureFolder for each segment in turn; returns the last folder id. */
  async ensureFolderPath(parentId: string, parts: readonly string[], o?: { signal?: AbortSignalLike }): Promise<string> {
    let id = parentId;
    for (const p of parts) id = await this.ensureFolder(p, id, o);
    return id;
  }

  /** File content as text; null when the file does not exist (404). */
  async getText(fileId: string, o?: { signal?: AbortSignalLike }): Promise<string | null> {
    const res = await this.request('GET', `${DRIVE_API}/files/${encodeURIComponent(fileId)}${qs({ alt: 'media' })}`, { signal: o?.signal });
    if (res.status === 404) return null;
    if (!isOk(res.status)) throw errorOf(res, 'download');
    return res.body;
  }

  /**
   * Creates or replaces a small text file with one multipart request.
   * fileId: a string updates that file; null always creates; undefined looks the name up first.
   * An update of a file that no longer exists creates it.
   */
  async putText(parentId: string, name: string, text: string, o?: { fileId?: string | null; mime?: string; signal?: AbortSignalLike }): Promise<DriveFile> {
    const mime = o?.mime ?? 'application/json';
    let fileId = o?.fileId;
    if (fileId === undefined) fileId = (await this.findChild(parentId, name, { folder: false, signal: o?.signal }))?.id ?? null;
    let boundary = `qu-${Math.floor(this.random() * 1e12).toString(36)}-${text.length.toString(36)}`;
    while (text.includes(boundary)) boundary += Math.floor(this.random() * 36).toString(36);
    const build = (meta: object) =>
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n${text}\r\n--${boundary}--`;
    const headers = { 'Content-Type': `multipart/related; boundary=${boundary}` };
    if (fileId) {
      const res = await this.request('PATCH', `${DRIVE_UPLOAD}/files/${encodeURIComponent(fileId)}${qs({ uploadType: 'multipart', fields: FILE_FIELDS })}`, {
        headers,
        body: build({ name, mimeType: mime }),
        signal: o?.signal,
      });
      if (isOk(res.status)) {
        const f = readDriveFile(parseJson(res.body));
        if (f) return f;
        throw new DriveError('unknown', 'update: bad response');
      }
      if (res.status !== 404) throw errorOf(res, 'update');
    }
    const j = await this.json('POST', `${DRIVE_UPLOAD}/files${qs({ uploadType: 'multipart', fields: FILE_FIELDS })}`, 'upload', {
      headers,
      body: build({ name, mimeType: mime, parents: [parentId], appProperties: { [APP_PROPERTY_KEY]: APP_PROPERTY_VALUE } }),
      signal: o?.signal,
    });
    const f = readDriveFile(j);
    if (!f) throw new DriveError('unknown', 'upload: bad response');
    return f;
  }

  /**
   * Removes a file or folder (a folder takes its children with it). By default it goes to the Drive
   * trash (recoverable for 30 days); permanent deletes it. A missing file is not an error.
   */
  async remove(fileId: string, o?: { permanent?: boolean; signal?: AbortSignalLike }): Promise<void> {
    const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}`;
    const res = o?.permanent
      ? await this.request('DELETE', url, { signal: o?.signal })
      : await this.request('PATCH', `${url}${qs({ fields: 'id' })}`, {
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ trashed: true }),
          signal: o?.signal,
        });
    if (isOk(res.status) || res.status === 404) return;
    throw errorOf(res, 'remove');
  }

  /**
   * URL and headers for a binary download done natively (P20: File.downloadFileAsync with headers).
   * After a 401 there, call again with refresh: true.
   */
  async downloadRequest(fileId: string, o?: { refresh?: boolean }): Promise<{ url: string; headers: Record<string, string> }> {
    const token = await this.accessToken(o?.refresh ?? false);
    return { url: `${DRIVE_API}/files/${encodeURIComponent(fileId)}${qs({ alt: 'media' })}`, headers: { Authorization: `Bearer ${token}` } };
  }
}
