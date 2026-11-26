/**
 * The OneDrive backup provider (iOS and Android), over Microsoft Graph with the
 * Files.ReadWrite.AppFolder scope: the app sees only its own folder.
 *
 * Tree: the app folder (OneDrive shows it as Apps/QU Student) / Backups / {manifest.json,
 * library.json, <nbId>/{notebook.json, pages/*, assets/*, audio/*}} — the same layout as the other
 * providers, addressed BY PATH, so there are no ids to look up or cache. Writing a file by path
 * creates its missing parent folders.
 *
 * - Small files (≤ SIMPLE_MAX) go up with one PUT …:/content. Bigger ones (audio, PDFs) use an upload
 *   session in CHUNK pieces (a multiple of 320 KiB, as Graph requires), read from disk with
 *   expoFs.readBytes; the abort signal is checked between pieces.
 * - Downloads ask for the item's pre-signed @microsoft.graph.downloadUrl and save it straight to disk.
 * - Deletes go to the OneDrive recycle bin.
 * - 401 is retried once with a fresh token; 429 / 503 wait for Retry-After (at most 3 times); 507 is
 *   'quota'. Sign-in and tokens come from oneDriveAuth.ts.
 */
import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';

import type { BackupError, RemoteFile } from '@/notebook/core/contracts/backup';
import { BackupAbortError, DriveError, isAbortError } from '@/notebook/core/backup/drive';
import { expoFs } from '@/notebook/fs/expoFs';

import * as auth from './oneDriveAuth';
import type { BackupProvider } from './service';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const APPROOT = `${GRAPH}/me/drive/special/approot`;
const BACKUPS = 'Backups';
/** Files up to this size go up in one request (Graph allows 4 MB). */
const SIMPLE_MAX = 4 * 1024 * 1024;
/** Upload session piece: 10 x 320 KiB. */
const CHUNK = 10 * 320 * 1024;
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The Graph URL of <folder>/<rel> (rel '' = the folder itself), each segment encoded. */
function itemUrlIn(folder: string, rel: string, suffix = ''): string {
  const path = [folder, ...rel.split('/').filter(Boolean)].map(encodeURIComponent).join('/');
  return `${APPROOT}:/${path}:${suffix}`;
}

type Init = { method?: string; headers?: Record<string, string>; body?: string | Uint8Array; signal?: unknown };

function codeForStatus(status: number): BackupError {
  if (status === 401) return 'signed-out';
  if (status === 507) return 'quota';
  return status === 0 ? 'network' : 'unknown';
}

/** fetch with the access token: one retry on 401 (fresh token), waits on 429 / 503. */
async function graph(url: string, init: Init = {}, o: { auth?: boolean } = {}): Promise<Response> {
  const useAuth = o.auth !== false;
  let refresh = false;
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (useAuth) {
      const t = await auth.tokenFor(refresh);
      if (typeof t !== 'string') throw new DriveError(t.error, `OneDrive token: ${t.message ?? t.error}`);
      headers.Authorization = `Bearer ${t}`;
    }
    let res: Response;
    try {
      res = (await expoFetch(url, { ...init, headers } as Parameters<typeof expoFetch>[1])) as unknown as Response;
    } catch (e) {
      if (isAbortError(e)) throw e;
      throw new DriveError('network', `OneDrive: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status === 401 && useAuth && !refresh) {
      refresh = true;
      continue;
    }
    if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
      const after = Number(res.headers.get('Retry-After'));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    return res;
  }
}

async function fail(res: Response, what: string): Promise<never> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    // No body.
  }
  throw new DriveError(codeForStatus(res.status), `OneDrive ${what}: ${res.status} ${detail}`, res.status);
}

interface GraphItem {
  name: string;
  size?: number;
  folder?: unknown;
  id?: string;
  lastModifiedDateTime?: string;
  '@microsoft.graph.downloadUrl'?: string;
}

/**
 * folder: the folder in the app folder that every `rel` is relative to: 'Backups' (default) for the
 * backup, 'PDF' for the readable copies.
 */
export function createOneDriveProvider(options: { folder?: string } = {}): BackupProvider {
  const folder = options.folder ?? BACKUPS;
  const itemUrl = (rel: string, suffix = '') => itemUrlIn(folder, rel, suffix);

  async function putSmall(rel: string, body: string | Uint8Array, mime: string): Promise<void> {
    const res = await graph(itemUrl(rel, '/content?@microsoft.graph.conflictBehavior=replace'), {
      method: 'PUT',
      headers: { 'Content-Type': mime },
      body,
    });
    if (!res.ok) await fail(res, `upload ${rel}`);
  }

  return {
    kind: 'onedrive',

    async availability() {
      return auth.availability();
    },

    async ensureRoot() {
      // The app folder is created by OneDrive on first use; Backups appears with the first file.
      const res = await graph(APPROOT);
      if (!res.ok) await fail(res, 'app folder');
    },

    async readText(rel) {
      const res = await graph(itemUrl(rel, '/content'));
      if (res.status === 404) return null;
      if (!res.ok) await fail(res, `read ${rel}`);
      return res.text();
    },

    async writeText(rel, text) {
      await putSmall(rel, text, 'application/json');
    },

    async upload(localPath, rel, o) {
      const size = await expoFs.size(localPath);
      const aborted = () => !!(o.signal as { aborted?: boolean } | undefined)?.aborted;
      if (size <= SIMPLE_MAX) {
        if (aborted()) throw new BackupAbortError();
        const bytes = await expoFs.readBytes(localPath, 0, size);
        await putSmall(rel, bytes, o.mime);
        o.onProgress?.(size);
        return;
      }
      const start = await graph(itemUrl(rel, '/createUploadSession'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
      });
      if (!start.ok) await fail(start, `upload session ${rel}`);
      const { uploadUrl } = (await start.json()) as { uploadUrl?: string };
      if (!uploadUrl) throw new DriveError('unknown', `OneDrive upload session ${rel}: no URL`);
      let offset = 0;
      while (offset < size) {
        if (aborted()) {
          // Drop the half-done session; the next run starts the file over.
          void graph(uploadUrl, { method: 'DELETE' }, { auth: false }).catch(() => {});
          throw new BackupAbortError();
        }
        const length = Math.min(CHUNK, size - offset);
        const bytes = await expoFs.readBytes(localPath, offset, length);
        const res = await graph(
          uploadUrl,
          { method: 'PUT', headers: { 'Content-Length': String(length), 'Content-Range': `bytes ${offset}-${offset + length - 1}/${size}` }, body: bytes },
          // The session URL carries its own authorization.
          { auth: false },
        );
        if (!res.ok && res.status !== 202) await fail(res, `upload ${rel}`);
        offset += length;
        o.onProgress?.(offset);
      }
    },

    async download(rel, localPath, o) {
      const res = await graph(itemUrl(rel, '?select=name,size,@microsoft.graph.downloadUrl'));
      if (res.status === 404) throw new DriveError('unknown', `missing in OneDrive: ${rel}`, 404);
      if (!res.ok) await fail(res, `download ${rel}`);
      const item = (await res.json()) as GraphItem;
      const url = item['@microsoft.graph.downloadUrl'];
      if (!url) throw new DriveError('unknown', `OneDrive download ${rel}: no URL`);
      try {
        await File.downloadFileAsync(url, new File(localPath), {
          idempotent: true,
          onProgress: o?.onProgress ? (p) => o.onProgress?.(p.bytesWritten) : undefined,
        });
      } catch (e) {
        if (isAbortError(e)) throw e;
        throw new DriveError('network', `OneDrive download ${rel}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (o?.onProgress) o.onProgress(await expoFs.size(localPath));
    },

    async remove(rel) {
      const res = await graph(itemUrl(rel), { method: 'DELETE' });
      if (res.status === 404 || res.ok) return;
      await fail(res, `delete ${rel}`);
    },

    async list(relDir) {
      const out: RemoteFile[] = [];
      let url: string | undefined = itemUrl(relDir, '/children?$select=name,size,folder,id,lastModifiedDateTime&$top=999');
      while (url) {
        const res = await graph(url);
        if (res.status === 404) return out;
        if (!res.ok) await fail(res, `list ${relDir || 'Backups'}`);
        const page = (await res.json()) as { value?: GraphItem[]; '@odata.nextLink'?: string };
        for (const it of page.value ?? []) {
          const r: RemoteFile = { name: it.name, isDir: !!it.folder, bytes: it.folder ? 0 : (it.size ?? 0), id: it.id };
          if (it.lastModifiedDateTime) r.modifiedAt = it.lastModifiedDateTime as RemoteFile['modifiedAt'];
          out.push(r);
        }
        url = page['@odata.nextLink'];
      }
      return out;
    },

    async signIn(interactive) {
      const silent = await auth.signInSilently();
      if (silent.ok) return silent;
      if (!interactive) return { ok: false, error: silent.error };
      return auth.signIn();
    },

    signOut: () => auth.signOut(),

    account: () => auth.currentAccount(),

    reset() {
      // Nothing cached by id: paths are looked up fresh on every call.
    },
  };
}
