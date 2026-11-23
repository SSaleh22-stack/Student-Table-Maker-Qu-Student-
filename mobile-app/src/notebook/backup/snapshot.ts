/**
 * What this device has, for the backup planner (core/backup/plan.ts): a LocalSnapshot built from the
 * notebook index (trashed notebooks and the purged tombstones included) plus a listing of every
 * notebook folder, and the library data (folders, course names) for library.json.
 *
 * Reading rules (the files belong to their sessions, never to the backup):
 * - Every read is a non-owner read: nothing is repaired, quarantined or rewritten (repair: false).
 * - An OPEN notebook (notebookRegistry().get(id)) is read inside session.withWriteLock, which flushes
 *   first, so the snapshot sees one consistent save. A closed one is read directly (nothing writes it).
 * - File keys are paths inside the notebook folder: 'notebook.json', 'pages/<pid>.json' (envelope rev
 *   + size), 'assets/<id>.<ext>' and 'audio/<id>.<ext>' (size only: they never change once written).
 *   Only pages listed in pageIds and files in the asset table are included (tombstoned pages,
 *   quarantine, thumbnails and stray files are not backed up). An audio segment still being recorded
 *   is left out until it is finished.
 * - Index fields are the truth for title, location and trash state (notebook.json may lag after a
 *   rename, move or trash), so the LocalNotebook takes them from the index entry.
 * - Revs are read with a light parse of main/.tmp/.bak (highest complete rev wins, as the journal
 *   does); the full reader runs only for files that are uploaded (readUploadText). Results are cached
 *   per notebook by the notebook.json rev, so an unchanged notebook costs one small read per run.
 *
 * Remote deletes come only from the purged tombstones, and only for notebooks this device uploaded
 * or restored before (an id in lastUploaded): a notebook this device never backed up is never
 * deleted from the backup because of it.
 */
import { NOTEBOOK_FILE, type BackupLocalState, type LibraryData, type LocalNotebook, type LocalSnapshot, type ManifestFile } from '@/notebook/core/backup/manifest';
import { bakPath, readJsonRecovering, tmpPath } from '@/notebook/core/fs/journal';
import { nbLayout, safeExt } from '@/notebook/core/fs/layout';
import { isRecord, readNotebookFile, readPageFile } from '@/notebook/core/model';
import type { Folder, Id, IndexEntry, Notebook } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { nbFs, nbRoot } from '@/notebook/store/deps';
import { indexStore } from '@/notebook/store/indexStore';
import { notebookRegistry } from '@/notebook/store/sessions';

export interface SnapshotResult {
  snapshot: LocalSnapshot;
  library: LibraryData;
}

interface CacheEntry {
  key: string;
  files: Record<string, ManifestFile>;
}

/** Per notebook: the files map for one notebook.json rev (cleared on sign-out / reset). */
const cache = new Map<Id, CacheEntry>();

export function clearSnapshotCache(): void {
  cache.clear();
}

/** UTF-8 byte length of a string (without allocating an encoded copy). */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

/** FNV-1a over a string: a small positive integer that changes when the text changes. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Folders and course names in a stable order. */
export function libraryDataOf(folders: readonly Folder[], courseNames: Record<string, string>): LibraryData {
  const fs = folders.map((f) => ({ id: f.id, name: f.name, createdAt: f.createdAt, order: f.order }));
  fs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const names: Record<string, string> = {};
  for (const k of Object.keys(courseNames).sort()) if (k !== '__proto__') names[k] = courseNames[k];
  return { folders: fs, courseNames: names };
}

/** A number that changes whenever folders or course names change (LocalSnapshot.libraryRev). */
export function libraryRevOf(lib: LibraryData): number {
  return hash32(JSON.stringify(lib));
}

/**
 * The newest complete envelope among main, .tmp and .bak: its rev and size. A light check only
 * (format, a numeric rev and the '$' sentinel); null when none is readable.
 */
async function peekEnvelope(path: string, format: string): Promise<{ rev: number; bytes: number } | null> {
  let best: { rev: number; bytes: number } | null = null;
  for (const p of [path, tmpPath(path), bakPath(path)]) {
    let text: string | null;
    try {
      text = await nbFs.readText(p);
    } catch {
      continue;
    }
    if (!text) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      continue;
    }
    if (!isRecord(raw) || raw.format !== format || raw.$ !== 'end') continue;
    const rev = raw.rev;
    if (typeof rev !== 'number' || !Number.isFinite(rev)) continue;
    if (!best || rev > best.rev) best = { rev, bytes: utf8Length(text) };
  }
  return best;
}

/** Asset ids of audio segments that are still being recorded (the file is still growing). */
function recordingNow(nb: Notebook): Set<Id> {
  const out = new Set<Id>();
  for (const r of nb.recordings) for (const s of r.segments) if (s.state === 'recording') out.add(s.fileId);
  return out;
}

async function sizes(dir: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    for (const e of await nbFs.list(dir)) if (!e.isDir) out.set(e.name, e.size);
  } catch {
    // A missing folder lists nothing.
  }
  return out;
}

/** Reads one notebook folder's files map (no lock: the caller holds it when the notebook is open). */
async function scanNotebook(id: Id): Promise<Record<string, ManifestFile> | null> {
  const paths = nbLayout(nbRoot()).notebook(id);
  const head = await peekEnvelope(paths.json, 'qu-notebook');
  if (!head) return null;
  const key = `${head.rev}|${head.bytes}`;
  const cached = cache.get(id);
  if (cached && cached.key === key) return cached.files;

  const r = await readJsonRecovering(nbFs, paths.json, readNotebookFile, paths.quarantine, { repair: false });
  if (!r.ok) return null;
  const nb = r.value;
  const files: Record<string, ManifestFile> = { [NOTEBOOK_FILE]: { rev: head.rev, bytes: head.bytes } };
  for (const pid of nb.pageIds) {
    const p = await peekEnvelope(paths.page(pid), 'qu-page');
    // A missing or unreadable page is left out: a restore reads it as a blank page, like this device.
    if (p) files[`pages/${pid}.json`] = { rev: p.rev, bytes: p.bytes };
  }
  const busy = recordingNow(nb);
  const assetSizes = await sizes(paths.assetsDir);
  const audioSizes = await sizes(paths.audioDir);
  for (const aid of Object.keys(nb.assets)) {
    const a = nb.assets[aid];
    if (busy.has(a.id)) continue;
    const name = `${a.id}.${safeExt(a.ext)}`;
    const audio = a.kind === 'audio';
    const size = (audio ? audioSizes : assetSizes).get(name);
    if (size === undefined) continue;
    files[`${audio ? 'audio' : 'assets'}/${name}`] = { bytes: size };
  }
  cache.set(id, { key, files });
  return files;
}

function localOf(e: IndexEntry, files: Record<string, ManifestFile>): LocalNotebook {
  const nb: LocalNotebook = { title: e.title, updatedAt: e.updatedAt, contentRev: e.contentRev, pageCount: e.pageCount, files };
  if (e.deletedAt) nb.deletedAt = e.deletedAt;
  if (e.folderId) nb.folderId = e.folderId;
  if (e.courseCode) nb.courseCode = e.courseCode;
  return nb;
}

function openSession(id: Id): NotebookSession | null {
  try {
    return notebookRegistry().get(id);
  } catch {
    return null;
  }
}

/**
 * Builds the snapshot for one backup run. signal: stop early (the run was cancelled). Never throws
 * for one unreadable notebook: it is simply left out (and so never touched remotely).
 */
export async function buildSnapshot(state: BackupLocalState, signal?: { readonly aborted: boolean }): Promise<SnapshotResult> {
  const notebooks: Record<Id, LocalNotebook> = {};
  const ids = indexStore.get().entries.map((e) => e.id);
  const seen = new Set<Id>();
  for (const id of ids) {
    if (signal?.aborted) break;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = openSession(id);
    let files: Record<string, ManifestFile> | null = null;
    try {
      files = s ? await s.withWriteLock(() => scanNotebook(id)) : await scanNotebook(id);
    } catch {
      files = null;
    }
    // Read the entry after the (flushing) lock, so an open notebook's contentRev is current.
    const entry = indexStore.get().entries.find((e) => e.id === id);
    if (!files || !entry) continue;
    notebooks[id] = localOf(entry, files);
  }

  const index = indexStore.get();
  const purged: Record<Id, string> = {};
  for (const t of index.purged) {
    if (Object.prototype.hasOwnProperty.call(state.lastUploaded, t.id)) purged[t.id] = t.at;
  }
  for (const id of Object.keys(notebooks)) delete purged[id];

  const library = libraryDataOf(index.folders, index.courseNames);
  const snapshot: LocalSnapshot = {
    deviceId: state.deviceId,
    libraryRev: libraryRevOf(library),
    purged,
    lastUploaded: { ...state.lastUploaded },
    notebooks,
  };
  if (state.libraryUploaded !== undefined) snapshot.libraryUploaded = state.libraryUploaded;
  return { snapshot, library };
}

/** The local path of a file key inside a notebook folder ('pages/p1.json'). */
export function localFilePath(notebookId: Id, file: string): string {
  return nbFs.join(nbLayout(nbRoot()).notebook(notebookId).dir, ...file.split('/'));
}

/**
 * The text to upload for a JSON file of a notebook (notebook.json or a page): the newest valid copy
 * among main/.tmp/.bak, byte for byte as saved (a newer app's fields are kept). null when no copy is
 * readable. Call it inside the session's write lock when the notebook is open.
 */
export async function readUploadText(notebookId: Id, file: string): Promise<string | null> {
  const paths = nbLayout(nbRoot()).notebook(notebookId);
  const path = localFilePath(notebookId, file);
  const read = file === NOTEBOOK_FILE ? readNotebookFile : readPageFile;
  const r = await readJsonRecovering<{ rev: number }>(nbFs, path, read, paths.quarantine, { repair: false });
  if (!r.ok) return null;
  const src = r.source === 'main' ? path : r.source === 'tmp' ? tmpPath(path) : bakPath(path);
  const text = await nbFs.readText(src);
  if (text !== null) {
    try {
      const raw: unknown = JSON.parse(text);
      if (isRecord(raw) && raw.rev === r.value.rev) return text;
    } catch {
      // Replaced between the two reads: fall through.
    }
  }
  // The file changed under us (or vanished): use the validated value.
  return JSON.stringify(r.value);
}
