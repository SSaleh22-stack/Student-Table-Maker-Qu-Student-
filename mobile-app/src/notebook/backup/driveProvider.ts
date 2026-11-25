/**
 * The Google Drive backup provider (Android, NB-86a), over the hand-written Drive v3 client
 * (core/backup/drive.ts) with the drive.file scope: the app sees only the files it created.
 *
 * Tree in My Drive: "QU Student"/Backups/{manifest.json, library.json, <nbId>/{notebook.json,
 * pages/*, assets/*, audio/*}}. Folders are created on demand and tagged appProperties
 * quApp=qu-student; when two devices race, the OLDEST folder or file of a name wins everywhere.
 *
 * - fetch is expo/fetch (binary Uint8Array bodies, no base64), adapted to core's FetchLike with a
 *   cast because its parameter types are DOM types. React Native's global fetch is never used.
 * - Small JSON files (manifest, library, notebook.json, pages) go up with one multipart request
 *   (putText). Assets and audio go up with a resumable, chunked upload whose chunks are read from
 *   disk with expoFs.readBytes; an interrupted upload resumes its session within the app run.
 * - Downloads go straight to disk with File.downloadFileAsync and an Authorization header; a 401
 *   there is retried once with a fresh token.
 * - Folder and file ids are looked up once per run (one listing per folder) and kept in memory;
 *   ensureRoot() starts each run fresh and saves the QU Student / Backups / notebook folder ids in
 *   the backup state.
 * - Sign-in, tokens and sign-out come from './googleAuth' (Metro: googleAuth.native.ts on Android
 *   and iOS, the 'unavailable' stub on web). No other file imports the Google sign-in package.
 */
import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';

import type { BackupError, RemoteFile } from '@/notebook/core/contracts/backup';
import { DriveClient, DriveError, FOLDER_MIME, isAbortError, type DriveFile } from '@/notebook/core/backup/drive';
import type { FetchLike } from '@/notebook/core/backup/fetchTypes';
import { uploadResumable } from '@/notebook/core/backup/resumable';
import { isSafeId } from '@/notebook/core/model';
import { expoFs } from '@/notebook/fs/expoFs';

import { updateBackupState } from './backupStore';
import * as googleAuth from './googleAuth';
import type { BackupProvider } from './service';

export const DRIVE_ROOT_NAME = 'QU Student';
export const DRIVE_BACKUPS_NAME = 'Backups';

const driveFetch: FetchLike = (url, init) => expoFetch(url, init as Parameters<typeof expoFetch>[1]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Children {
  folders: Map<string, string>;
  files: Map<string, string>;
}

const parentOf = (rel: string): string => {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
};
const nameOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

function toRemote(f: DriveFile, isDir: boolean): RemoteFile {
  const r: RemoteFile = { name: f.name, isDir, bytes: f.size ?? 0, id: f.id };
  if (f.modifiedTime) r.modifiedAt = f.modifiedTime;
  return r;
}

function availabilityError(a: googleAuth.GoogleAvailability): BackupError {
  return a === 'no-play-services' ? 'no-play-services' : 'unavailable';
}

export function createDriveProvider(): BackupProvider {
  const client = new DriveClient({ fetch: driveFetch, getToken: (refresh) => googleAuth.tokenFor(refresh), sleep });

  let backupsId: string | null = null;
  /** relDir ('' = Backups) -> folder id. */
  const dirs = new Map<string, string>();
  /** relDir -> its children (listed once per run). */
  const children = new Map<string, Children>();
  /** rel -> resumable session URL of an interrupted upload (same app run). */
  const sessions = new Map<string, string>();

  function resetCaches(): void {
    backupsId = null;
    dirs.clear();
    children.clear();
  }

  async function root(): Promise<string> {
    if (backupsId) return backupsId;
    const rootId = await client.ensureFolder(DRIVE_ROOT_NAME, 'root');
    const id = await client.ensureFolder(DRIVE_BACKUPS_NAME, rootId);
    backupsId = id;
    dirs.set('', id);
    await updateBackupState((s) =>
      s.drive && s.drive.rootId === rootId && s.drive.backupsId === id ? s : { ...s, drive: { rootId, backupsId: id, folderIds: s.drive?.backupsId === id ? s.drive.folderIds : {} } },
    );
    return id;
  }

  async function listing(relDir: string, dirId: string): Promise<Children> {
    const known = children.get(relDir);
    if (known) return known;
    const c: Children = { folders: new Map(), files: new Map() };
    // Oldest first: the first of a name wins (the same choice every device makes).
    for (const f of await client.listChildren(dirId)) {
      const map = f.mimeType === FOLDER_MIME ? c.folders : c.files;
      if (!map.has(f.name)) map.set(f.name, f.id);
    }
    children.set(relDir, c);
    return c;
  }

  /** The folder id of relDir; create makes missing folders, otherwise null when one is missing. */
  async function dirId(relDir: string, create: boolean): Promise<string | null> {
    const known = dirs.get(relDir);
    if (known) return known;
    if (relDir === '') return root();
    const parent = await dirId(parentOf(relDir), create);
    if (!parent) return null;
    const name = nameOf(relDir);
    const c = await listing(parentOf(relDir), parent);
    let id = c.folders.get(name) ?? null;
    if (!id && create) {
      id = await client.ensureFolder(name, parent);
      c.folders.set(name, id);
    }
    if (!id) return null;
    dirs.set(relDir, id);
    if (parentOf(relDir) === '' && isSafeId(name)) {
      const folderId = id;
      await updateBackupState((s) =>
        s.drive && s.drive.folderIds[name] !== folderId ? { ...s, drive: { ...s.drive, folderIds: { ...s.drive.folderIds, [name]: folderId } } } : s,
      );
    }
    return id;
  }

  async function fileId(rel: string): Promise<{ parent: string; id: string | null } | null> {
    const dir = parentOf(rel);
    const parent = await dirId(dir, false);
    if (!parent) return null;
    const c = await listing(dir, parent);
    return { parent, id: c.files.get(nameOf(rel)) ?? null };
  }

  function remember(rel: string, id: string): void {
    const c = children.get(parentOf(rel));
    if (c) c.files.set(nameOf(rel), id);
  }

  return {
    kind: 'gdrive',

    async availability(o) {
      const a = await googleAuth.availability({ interactive: o?.interactive === true });
      return a === 'ok' ? 'ok' : availabilityError(a);
    },

    async ensureRoot() {
      resetCaches();
      await root();
    },

    async readText(rel) {
      const f = await fileId(rel);
      if (!f || !f.id) return null;
      return client.getText(f.id);
    },

    async writeText(rel, text) {
      const dir = parentOf(rel);
      const parent = await dirId(dir, true);
      if (!parent) throw new DriveError('unknown', `no folder for ${rel}`);
      const c = await listing(dir, parent);
      const f = await client.putText(parent, nameOf(rel), text, { fileId: c.files.get(nameOf(rel)) ?? null, mime: 'application/json' });
      remember(rel, f.id);
    },

    async upload(localPath, rel, o) {
      const dir = parentOf(rel);
      const parent = await dirId(dir, true);
      if (!parent) throw new DriveError('unknown', `no folder for ${rel}`);
      const c = await listing(dir, parent);
      const size = await expoFs.size(localPath);
      const key = `${rel}|${size}`;
      const f = await uploadResumable(
        client,
        { size, read: (offset, length) => expoFs.readBytes(localPath, offset, length) },
        { parentId: parent, name: nameOf(rel), mime: o.mime, fileId: c.files.get(nameOf(rel)) ?? null },
        {
          signal: o.signal,
          onProgress: (sent) => o.onProgress?.(sent),
          sessionUrl: sessions.get(key) ?? null,
          onSession: (url) => {
            if (url) sessions.set(key, url);
            else sessions.delete(key);
          },
        },
      );
      remember(rel, f.id);
    },

    async download(rel, localPath, o) {
      const f = await fileId(rel);
      if (!f || !f.id) throw new DriveError('unknown', `missing in Drive: ${rel}`, 404);
      const id = f.id;
      const target = new File(localPath);
      const attempt = async (refresh: boolean) => {
        const req = await client.downloadRequest(id, { refresh });
        await File.downloadFileAsync(req.url, target, {
          headers: req.headers,
          idempotent: true,
          onProgress: o?.onProgress ? (p) => o.onProgress?.(p.bytesWritten) : undefined,
        });
      };
      try {
        await attempt(false);
      } catch (e) {
        if (isAbortError(e) || e instanceof DriveError) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        if (/\b401\b/.test(msg)) {
          try {
            await attempt(true);
          } catch (e2) {
            if (e2 instanceof DriveError) throw e2;
            const m2 = e2 instanceof Error ? e2.message : String(e2);
            throw new DriveError(/\b401\b/.test(m2) ? 'signed-out' : 'network', `download ${rel}: ${m2}`, /\b401\b/.test(m2) ? 401 : 0);
          }
        } else {
          throw new DriveError(/\b404\b/.test(msg) ? 'unknown' : 'network', `download ${rel}: ${msg}`, /\b404\b/.test(msg) ? 404 : 0);
        }
      }
      if (o?.onProgress) o.onProgress(await expoFs.size(localPath));
    },

    async remove(rel) {
      const dir = parentOf(rel);
      const parent = await dirId(dir, false);
      if (!parent) return;
      const c = await listing(dir, parent);
      const name = nameOf(rel);
      const folder = c.folders.get(name);
      const file = c.files.get(name);
      // To the Drive trash (recoverable for 30 days), never a hard delete.
      if (folder) {
        await client.remove(folder);
        c.folders.delete(name);
        dirs.delete(rel);
        for (const k of [...dirs.keys()]) if (k.startsWith(`${rel}/`)) dirs.delete(k);
        for (const k of [...children.keys()]) if (k === rel || k.startsWith(`${rel}/`)) children.delete(k);
        if (dir === '' && isSafeId(name)) {
          await updateBackupState((s) => {
            if (!s.drive || !(name in s.drive.folderIds)) return s;
            const folderIds = { ...s.drive.folderIds };
            delete folderIds[name];
            return { ...s, drive: { ...s.drive, folderIds } };
          });
        }
      }
      if (file) {
        await client.remove(file);
        c.files.delete(name);
      }
    },

    async list(relDir) {
      const id = await dirId(relDir, false);
      if (!id) return [];
      const files = await client.listChildren(id);
      return files.map((f) => toRemote(f, f.mimeType === FOLDER_MIME));
    },

    async signIn(interactive) {
      if (!interactive) {
        const s = await googleAuth.signInSilently();
        return s.ok ? { ok: true, account: s.account } : { ok: false, error: s.error };
      }
      const silent = await googleAuth.signInSilently();
      if (silent.ok) return { ok: true, account: silent.account };
      const r = await googleAuth.signIn();
      if (r.ok) return { ok: true, account: r.account };
      return { ok: false, error: r.error === 'cancelled' ? 'cancelled' : r.error };
    },

    async signOut() {
      client.reset();
      resetCaches();
      sessions.clear();
      await googleAuth.signOut();
      await updateBackupState((s) => {
        if (!s.drive) return s;
        const next = { ...s };
        delete next.drive;
        return next;
      });
    },

    account: () => googleAuth.currentAccount(),

    reset() {
      client.reset();
      resetCaches();
    },
  };
}
