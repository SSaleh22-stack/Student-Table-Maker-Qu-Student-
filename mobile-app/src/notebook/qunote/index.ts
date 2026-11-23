/**
 * .qunote export and import for the app (NB-72, NB-73, NB-74). Thin glue over core/qunote:
 *
 * - exportQunote(session, { includeRecordings, onProgress }): packs the OPEN notebook under
 *   session.withWriteLock (which flushes first, and holds every save while files are read) into
 *   Paths.cache/qunote/<random>/<title>.qunote. Share it with shareFile(uri, { mimeType: QUNOTE_MIME,
 *   UTI: QUNOTE_UTI, ... }), which deletes the file afterwards.
 * - inspectQunote(uri): title, page count, size and whether recordings are inside, from the zip
 *   central directory and the manifest only; or { error: 'not-qunote' | 'damaged' | 'newer-version' }.
 * - importQunote(uri, { location, mode }): unpacks into a staging job (zip-bomb guard: the content
 *   must fit in the free space), validates everything, remaps (mode 'copy': a new notebook, NB-73;
 *   'restore': the same id, replacing a notebook with that id), then store.adoptFolder(dir, location).
 *   Rejects with QunoteError ('not-qunote' | 'damaged' | 'newer-version' | 'no-space') or a
 *   LibraryError from adoptFolder.
 * - estimateQunoteForSession(session): estimateQunoteSize with the page files' size on disk (NB-74).
 *
 * uri may be file:// or (Android) content://; a content:// file is copied into the staging job
 * first, because the zip reader needs random access. Native only: every function rejects on web.
 */
import { Directory, File, Paths } from 'expo-file-system';

import type { ExportQunote, ImportQunote, InspectQunote, QunoteInfo } from '@/notebook/contracts/export';
import { joinPath } from '@/notebook/core/fs/adapter';
import { nbLayout } from '@/notebook/core/fs/layout';
import type { Id } from '@/notebook/core/model';
import { estimateQunoteSize } from '@/notebook/core/qunote/estimate';
import { QunoteError } from '@/notebook/core/qunote/manifest';
import { packNotebook } from '@/notebook/core/qunote/pack';
import { asCopy, asRestore } from '@/notebook/core/qunote/remap';
import { inspectQunote as inspectArchive, unpackQunote } from '@/notebook/core/qunote/unpack';
import { fileSource } from '@/notebook/core/qunote/zipRead';
import type { NotebookSession } from '@/notebook/core/session/types';
import { notebookSupported } from '@/notebook/flags';
import { appVersion, nbFreeBytes, nbFs, nbNewId, nbNow, nbRoot } from '@/notebook/store/deps';
import { getNotebooksStore, notebookRegistry, type NotebooksStore } from '@/notebook/store/hooks';
import { tr } from '@/lib/i18n';

export { estimateQunoteSize } from '@/notebook/core/qunote/estimate';
export { QunoteError, isQunoteError } from '@/notebook/core/qunote/manifest';
export type { QunoteErrorCode } from '@/notebook/core/qunote/manifest';

const EXPORT_DIR = 'qunote';
/** Export folders still being written (empty until the first bytes land): cleanup skips them. */
const inFlight = new Set<string>();

const unsupported = () => new Error('The notebook is not available on this platform');

function needStore(): NotebooksStore {
  if (!notebookSupported) throw unsupported();
  const s = getNotebooksStore();
  if (!s) throw new Error('The notebook store is not ready yet');
  return s;
}

/** A file name from the notebook title: no path or reserved characters, at most 80 characters. */
export function qunoteFileName(title: string): string {
  const base = String(title ?? '')
    // Path separators, reserved and control characters, and bidi controls.
    .replace(/[\\/:*?"<>|#%\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return `${base || tr('مذكرة', 'Notebook')}.qunote`;
}

/** Removes leftover export folders whose file was already shared (and deleted) or abandoned. */
async function cleanExportDirs(): Promise<void> {
  try {
    const root = new Directory(Paths.cache, EXPORT_DIR).uri;
    for (const d of await nbFs.list(root)) {
      if (!d.isDir || inFlight.has(d.name)) continue;
      const dir = joinPath(root, d.name);
      if ((await nbFs.list(dir)).length === 0) await nbFs.remove(dir);
    }
  } catch {
    // The cache is the system's to clean as well.
  }
}

export const exportQunote: ExportQunote = async (s, o) => {
  if (!notebookSupported) throw unsupported();
  await cleanExportDirs();
  const folder = nbNewId();
  const dir = new Directory(Paths.cache, EXPORT_DIR, folder).uri;
  const out = new File(Paths.cache, EXPORT_DIR, folder, qunoteFileName(s.notebook.title)).uri;
  inFlight.add(folder);
  try {
    await nbFs.mkdirp(dir);
    const nbDir = nbLayout(nbRoot()).notebook(s.id).dir;
    const r = await packNotebook(
      nbFs,
      nbDir,
      out,
      { includeRecordings: o.includeRecordings, appVersion, now: nbNow, onProgress: o.onProgress },
      (fn) => s.withWriteLock(fn),
    );
    return { uri: out, bytes: r.bytes };
  } catch (e) {
    await nbFs.remove(dir).catch(() => {});
    throw e;
  } finally {
    inFlight.delete(folder);
  }
};

const isLocalFile = (uri: string) => uri.startsWith('file://') || uri.startsWith('/');

/** A random-access local path for uri: itself, or a copy inside the staging job. */
async function localArchive(uri: string, jobDir: string): Promise<string> {
  if (isLocalFile(uri)) return uri;
  const copy = joinPath(jobDir, 'incoming.qunote');
  await nbFs.copy(uri, copy);
  return copy;
}

export const inspectQunote: InspectQunote = async (uri) => {
  const toInfo = async (path: string): Promise<QunoteInfo | { error: 'not-qunote' | 'damaged' | 'newer-version' }> => {
    const r = await inspectArchive(fileSource(nbFs, path));
    if ('error' in r) return { error: r.error };
    return { title: r.title, pageCount: r.pageCount, bytes: r.bytes, includesRecordings: r.includesRecordings };
  };
  if (isLocalFile(uri)) {
    if (!notebookSupported) throw unsupported();
    return toInfo(uri);
  }
  const store = needStore();
  const job = await store.stagingJob();
  try {
    let local: string;
    try {
      local = await localArchive(uri, job.dir);
    } catch {
      return { error: 'damaged' };
    }
    return await toInfo(local);
  } finally {
    await store.endStagingJob(job.id).catch(() => {});
  }
};

export const importQunote: ImportQunote = async (uri, o) => {
  const store = needStore();
  const job = await store.stagingJob();
  try {
    const local = await localArchive(uri, job.dir);
    const dest = joinPath(job.dir, 'nb');
    const free = nbFreeBytes();
    const r = await unpackQunote(nbFs, fileSource(nbFs, local), dest, {
      freeBytes: free ?? undefined,
      appVersion,
      now: nbNow,
      transform: (nb) => (o.mode === 'copy' ? asCopy(nb, { newId: nbNewId(), now: nbNow() }) : asRestore(nb, { now: nbNow() })),
    });
    if (local !== uri) await nbFs.remove(local).catch(() => {});

    const id: Id = r.notebook.id;
    // The snapshot taken before the (possibly long) unpack may be stale: read the library again.
    const now = getNotebooksStore() ?? store;
    if (o.mode === 'restore' && (now.entries.some((e) => e.id === id) || notebookRegistry().get(id))) {
      // Everything is validated and staged: only now is the notebook with this id replaced.
      await now.purgeNotebook(id);
    }
    const adopted = await now.adoptFolder(dest, o.location);
    if (!r.hasCover) now.requestThumb(adopted);
    return adopted;
  } finally {
    await store.endStagingJob(job.id).catch(() => {});
  }
};

/** NB-74: the share sheet's sizes with and without recordings. */
export async function estimateQunoteForSession(s: NotebookSession): Promise<{ withRecordings: number; withoutRecordings: number }> {
  if (!notebookSupported) throw unsupported();
  const pagesDir = nbLayout(nbRoot()).notebook(s.id).pagesDir;
  // Only the live page files count (not .bak/.tmp copies or tombstoned pages).
  const live = new Set(s.notebook.pageIds.map((pid) => `${pid}.json`));
  let pageBytes = 0;
  try {
    for (const f of await nbFs.list(pagesDir)) if (!f.isDir && live.has(f.name)) pageBytes += f.size;
  } catch {
    pageBytes = 0;
  }
  return estimateQunoteSize(s.notebook, pageBytes);
}

/** True when the error means the file itself is the problem (not storage or the platform). */
export function isBadQunote(e: unknown): boolean {
  return e instanceof QunoteError && (e.code === 'not-qunote' || e.code === 'damaged' || e.code === 'newer-version');
}
