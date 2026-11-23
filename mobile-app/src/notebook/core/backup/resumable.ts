/**
 * Resumable chunked upload to Google Drive (P09), for assets and audio (pages and JSON files go through
 * DriveClient.putText). Follows https://developers.google.com/workspace/drive/api/guides/manage-uploads:
 *
 * - POST (new file) or PATCH (existing file) to upload/drive/v3/files?uploadType=resumable with the
 *   metadata, X-Upload-Content-Type and X-Upload-Content-Length; the Location header is the session URL
 *   (valid for a week; P20 may keep it through onSession to resume after the app is killed).
 * - PUT chunks of 8 MiB (always a multiple of 256 KiB except the last) as Uint8Array bodies through the
 *   injected fetch (expo/fetch in the app: raw bytes, no base64), with
 *   'Content-Range: bytes <first>-<last>/<total>' and redirect 'manual'.
 * - 308 Resume Incomplete: continue from the end of its Range header ('bytes=0-N' -> N+1; no Range = 0).
 *   The server may have kept fewer bytes than were sent, so the next chunk always starts there.
 * - 200/201: done (the body is the file resource).
 * - A network failure, 429, 403 rate limit or 5xx: back off, then ask with an empty PUT and
 *   'Content-Range: bytes * /<total>' (no space) how much arrived, and continue from there.
 * - 404 (or 410): the session expired; start a new session from byte 0. Other 4xx: restart as the docs
 *   say. 403 storageQuotaExceeded: DriveError 'quota'. At most maxRestarts restarts.
 * - 401 is handled by DriveClient.send (one token refresh).
 */
import type { AbortSignalLike } from '../contracts/backup.ts';
import { APP_PROPERTY_KEY, APP_PROPERTY_VALUE, BackupAbortError, DRIVE_UPLOAD, DriveError, errorOf, FILE_FIELDS, isAbortError, isRetryable, readDriveFile } from './drive.ts';
import type { DriveClient, DriveFile, DriveResponse } from './drive.ts';

export const CHUNK_UNIT = 256 * 1024;
export const DEFAULT_CHUNK = 8 * 1024 * 1024;
export const MAX_RESTARTS = 3;

export interface ResumableSource {
  size: number;
  /** Exactly `length` bytes starting at `offset` (P20: expoFs.readBytes). */
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface ResumableTarget {
  parentId: string;
  name: string;
  mime: string;
  /** Replace the content of this existing file (PATCH); a missing one is created instead. */
  fileId?: string | null;
}

export interface ResumableOptions {
  /** Rounded down to a multiple of 256 KiB (at least 256 KiB). Default 8 MiB. */
  chunkSize?: number;
  signal?: AbortSignalLike;
  onProgress?(sent: number, total: number): void;
  /** A session URL saved from an earlier, interrupted upload of the same file. */
  sessionUrl?: string | null;
  /** Called with each new session URL, and with null once it is finished or abandoned. */
  onSession?(url: string | null): void;
  maxRestarts?: number;
  /** Consecutive failures without progress before giving up (default client.maxRetries). */
  maxRetries?: number;
}

export type UploadClient = Pick<DriveClient, 'send' | 'request' | 'backoff' | 'maxRetries'>;

export type UploadStatus = { state: 'done'; file: DriveFile } | { state: 'partial'; offset: number } | { state: 'expired' };

export function chunkSizeOf(n?: number): number {
  if (n === undefined || !Number.isFinite(n)) return DEFAULT_CHUNK;
  return Math.max(CHUNK_UNIT, Math.floor(n / CHUNK_UNIT) * CHUNK_UNIT);
}

/** The next byte to send after a 308 ('bytes=0-42' -> 43; missing -> 0). */
export function nextOffset(range: string | null): number {
  if (!range) return 0;
  const m = /bytes\s*=\s*(\d+)\s*-\s*(\d+)/i.exec(range);
  return m ? Number(m[2]) + 1 : 0;
}

function doneFile(res: DriveResponse): DriveFile {
  let raw: unknown = null;
  try {
    raw = JSON.parse(res.body);
  } catch {
    raw = null;
  }
  const f = readDriveFile(raw);
  if (!f) throw new DriveError('unknown', 'upload finished without a file resource', res.status);
  return f;
}

/** Opens a resumable session and returns its URL. */
export async function startSession(client: UploadClient, target: ResumableTarget, size: number, signal?: AbortSignalLike): Promise<string> {
  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': target.mime,
    'X-Upload-Content-Length': String(size),
  };
  const fields = encodeURIComponent(FILE_FIELDS);
  let res: DriveResponse | null = null;
  if (target.fileId) {
    res = await client.request('PATCH', `${DRIVE_UPLOAD}/files/${encodeURIComponent(target.fileId)}?uploadType=resumable&fields=${fields}`, {
      headers,
      body: JSON.stringify({ name: target.name, mimeType: target.mime }),
      signal,
    });
    if (res.status === 404) res = null;
  }
  if (!res) {
    res = await client.request('POST', `${DRIVE_UPLOAD}/files?uploadType=resumable&fields=${fields}`, {
      headers,
      body: JSON.stringify({ name: target.name, mimeType: target.mime, parents: [target.parentId], appProperties: { [APP_PROPERTY_KEY]: APP_PROPERTY_VALUE } }),
      signal,
    });
  }
  if (res.status < 200 || res.status >= 300) throw errorOf(res, 'start upload');
  const url = res.headers.get('location');
  if (!url) throw new DriveError('unknown', 'start upload: no Location header', res.status);
  return url;
}

/** Asks the server how much of the session arrived. Throws on network errors and bad statuses. */
export async function queryStatus(client: UploadClient, url: string, size: number, signal?: AbortSignalLike): Promise<UploadStatus> {
  const res = await client.send('PUT', url, { headers: { 'Content-Range': `bytes */${size}` }, body: new Uint8Array(0), redirect: 'manual', signal });
  if (res.status === 200 || res.status === 201) return { state: 'done', file: doneFile(res) };
  if (res.status === 308) return { state: 'partial', offset: nextOffset(res.headers.get('range')) };
  if (res.status === 404 || res.status === 410) return { state: 'expired' };
  const err = errorOf(res, 'upload status');
  // Retryable ('network') and a full Drive ('quota', restarting would not help) are thrown.
  if (err.code === 'network' || err.code === 'quota') throw err;
  // Any other 4xx on a session: start over.
  return { state: 'expired' };
}

function retryable(e: unknown): boolean {
  return e instanceof DriveError && e.code === 'network';
}

/** Uploads src as target, resuming and restarting as needed. Resolves to the Drive file. */
export async function uploadResumable(client: UploadClient, src: ResumableSource, target: ResumableTarget, o: ResumableOptions = {}): Promise<DriveFile> {
  const total = src.size;
  if (!Number.isFinite(total) || total < 0) throw new DriveError('unknown', 'upload: bad size');
  const chunk = chunkSizeOf(o.chunkSize);
  const signal = o.signal;
  const maxRestarts = o.maxRestarts ?? MAX_RESTARTS;
  const maxRetries = o.maxRetries ?? client.maxRetries;

  let url: string | null = o.sessionUrl ?? null;
  let needSync = url !== null;
  let offset = 0;
  let restarts = 0;
  let failures = 0;
  let reported = -1;

  const progress = (n: number) => {
    if (n !== reported) {
      reported = n;
      o.onProgress?.(n, total);
    }
  };
  const fail = async (e: unknown) => {
    failures++;
    if (failures > maxRetries) throw e;
    await client.backoff(failures, null, signal);
  };
  const restart = () => {
    restarts++;
    if (restarts > maxRestarts) throw new DriveError('unknown', 'upload: the session keeps failing, gave up');
    url = null;
    needSync = false;
    offset = 0;
    o.onSession?.(null);
    progress(0);
  };
  const finish = (file: DriveFile) => {
    progress(total);
    o.onSession?.(null);
    return file;
  };

  for (;;) {
    if (signal?.aborted) throw new BackupAbortError();
    if (url === null) {
      url = await startSession(client, target, total, signal);
      offset = 0;
      needSync = false;
      o.onSession?.(url);
    }

    if (needSync) {
      let st: UploadStatus;
      try {
        st = await queryStatus(client, url, total, signal);
      } catch (e) {
        if (isAbortError(e) || !retryable(e)) throw e;
        await fail(e);
        continue;
      }
      needSync = false;
      if (st.state === 'done') return finish(st.file);
      if (st.state === 'expired') {
        restart();
        continue;
      }
      if (st.offset > offset) failures = 0;
      offset = Math.min(st.offset, total);
      progress(offset);
    }

    const len = Math.min(chunk, total - offset);
    if (total > 0 && len <= 0) {
      // Every byte was acknowledged but no final response arrived: ask again.
      needSync = true;
      await fail(new DriveError('network', 'upload: no final response'));
      continue;
    }
    const bytes = len > 0 ? await src.read(offset, len) : new Uint8Array(0);
    if (bytes.length !== len) throw new DriveError('unknown', `upload: read ${bytes.length} of ${len} bytes at ${offset}`);
    const range = total === 0 ? 'bytes */0' : `bytes ${offset}-${offset + len - 1}/${total}`;

    let res: DriveResponse;
    try {
      // Content-Type is set explicitly: without one, iOS URLSession labels a body as form data.
      res = await client.send('PUT', url, { headers: { 'Content-Type': target.mime, 'Content-Range': range }, body: bytes, redirect: 'manual', signal });
    } catch (e) {
      if (isAbortError(e) || !retryable(e)) throw e;
      await fail(e);
      needSync = true;
      continue;
    }

    if (res.status === 200 || res.status === 201) return finish(doneFile(res));
    if (res.status === 308) {
      const next = Math.min(nextOffset(res.headers.get('range')), total);
      const advanced = next > offset;
      offset = next;
      progress(offset);
      if (advanced) failures = 0;
      else await fail(new DriveError('network', 'upload: the server kept no bytes of the chunk'));
      continue;
    }
    if (res.status === 404 || res.status === 410) {
      restart();
      continue;
    }
    if (isRetryable(res.status, res.body)) {
      await fail(errorOf(res, 'upload chunk'));
      needSync = true;
      continue;
    }
    const err = errorOf(res, 'upload chunk');
    if (err.code === 'quota') throw err;
    restart();
  }
}
