/**
 * Backup manifest (P09): types, readers, builders and the per-device merge.
 *
 * Remote tree (relative to QU Student/Backups, '/' separators):
 *   manifest.json            BackupManifest (written LAST in every run, see plan.ts)
 *   library.json             folders and course names (union-merged, see mergeLibraryData)
 *   <nbId>/notebook.json, <nbId>/pages/<pageId>.json, <nbId>/assets/<fileId>.<ext>, <nbId>/audio/<fileId>.<ext>
 *
 * Every manifest entry is tagged with the deviceId that uploaded it last. A device only ever rewrites
 * the entries it uploads in that run (mergeManifest); entries owned by other devices are kept untouched.
 * Nothing here deletes anything: deletes are decided by plan.ts and only for purged tombstones.
 *
 * File keys (LocalNotebook.files, ManifestEntry.files) are paths inside the notebook folder:
 * 'notebook.json', 'pages/<pageId>.json', 'assets/<fileId>.<ext>', 'audio/<fileId>.<ext>'.
 */
import { isRecord, isSafeId, TITLE_MAX } from '../model/index.ts';
import type { Folder, Id, IsoDate } from '../model/index.ts';
import type { RemoteCheck, RemoteNotebook } from '../contracts/backup.ts';

export const MANIFEST_FORMAT = 'qu-backup';
export const MANIFEST_VERSION = 1;
export const MANIFEST_NAME = 'manifest.json';
export const LIBRARY_NAME = 'library.json';
export const NOTEBOOK_FILE = 'notebook.json';

export interface ManifestFile {
  /** Envelope rev for pages and notebook.json; undefined for assets and audio (immutable by id). */
  rev?: number;
  bytes: number;
}

export interface ManifestEntry {
  title: string;
  updatedAt: IsoDate;
  contentRev: number;
  /** Set while the notebook is in Recently deleted on the uploading device (trashed notebooks stay). */
  deletedAt?: IsoDate;
  pageCount: number;
  bytes: number;
  /** Device that uploaded this entry last (its owner). */
  deviceId: string;
  files: Record<string, ManifestFile>;
  /** Location on the uploading device (the index is the truth for it; notebook.json may lag). */
  folderId?: Id;
  courseCode?: string;
}

export interface ManifestDevice {
  name: string;
  lastAt: IsoDate;
}

export interface BackupManifest {
  format: 'qu-backup';
  version: 1;
  updatedAt: IsoDate;
  /** libraryRev of the device that wrote library.json last (informational). */
  libraryRev: number;
  devices: Record<string, ManifestDevice>;
  notebooks: Record<Id, ManifestEntry>;
}

export interface LocalNotebook {
  title: string;
  updatedAt: IsoDate;
  contentRev: number;
  deletedAt?: IsoDate;
  pageCount: number;
  files: Record<string, ManifestFile>;
  folderId?: Id;
  courseCode?: string;
}

/** What this device has, built by P20 snapshot.ts from the index (purged included) and folder listings. */
export interface LocalSnapshot {
  deviceId: string;
  /** A number that changes whenever folders or course names change (a counter or a hash). */
  libraryRev: number;
  /** libraryRev last uploaded from this device (BackupLocalState.libraryUploaded); undefined = never. */
  libraryUploaded?: number;
  /** Permanently deleted notebooks (IndexFile.purged): id -> purge time. The ONLY source of remote deletes. */
  purged: Record<Id, IsoDate>;
  /** contentRev this device last uploaded, per notebook (BackupLocalState.lastUploaded). */
  lastUploaded: Record<Id, number>;
  /** Notebooks on this device, trashed ones included. A notebook missing here is NEVER deleted remotely. */
  notebooks: Record<Id, LocalNotebook>;
}

/** Persisted by P20 under 'qu-student:notebooks:backup:v1'. */
export interface BackupLocalState {
  deviceId: string;
  drive?: { rootId: string; backupsId: string; folderIds: Record<Id, string> };
  lastUploaded: Record<Id, number>;
  /** Notebooks skipped in the last run because another device has a newer copy. */
  conflicts: Id[];
  libraryUploaded?: number;
  /** The readable PDF copies this device uploaded (core/backup/pdfCopies.ts): id -> rev and path. */
  pdfUploaded?: Record<Id, { rev: number; path: string }>;
}

/** The entries this device contributes to one manifest write (see mergeManifest). */
export interface MineManifest {
  updatedAt: IsoDate;
  notebooks: Record<Id, ManifestEntry>;
  /** Ids to drop from the manifest (purged and deleted remotely in this run). */
  removed?: Id[];
  /** Set when this run uploaded library.json. */
  libraryRev?: number;
}

export type ParsedManifest =
  | { ok: true; manifest: BackupManifest }
  | { ok: false; reason: 'missing' | 'invalid' | 'newer' };

// ----- small checks -----

const SAFE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/;

/** A file key inside a notebook folder: one or two safe segments, no '..', no leading '/'. */
export function isSafeRel(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) return false;
  const parts = v.split('/');
  if (parts.length > 2) return false;
  return parts.every((p) => SAFE_SEGMENT.test(p) && p !== '__proto__' && !p.includes('..'));
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length <= max ? v : undefined;
}

function iso(v: unknown): IsoDate | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= 40 ? v : undefined;
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function finiteInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : undefined;
}

function deviceKey(v: unknown): v is string {
  return typeof v === 'string' && v !== '__proto__' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
}

function capTitle(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, TITLE_MAX) : '';
}

function readFiles(raw: unknown): Record<string, ManifestFile> {
  const out: Record<string, ManifestFile> = {};
  if (!isRecord(raw)) return out;
  for (const key of Object.keys(raw)) {
    const f = raw[key];
    if (!isSafeRel(key) || !isRecord(f)) continue;
    const file: ManifestFile = { bytes: count(f.bytes) };
    const rev = finiteInt(f.rev);
    if (rev !== undefined) file.rev = rev;
    out[key] = file;
  }
  return out;
}

function readEntry(raw: unknown): ManifestEntry | null {
  if (!isRecord(raw)) return null;
  const deviceId = deviceKey(raw.deviceId) ? raw.deviceId : '';
  const entry: ManifestEntry = {
    title: capTitle(raw.title),
    updatedAt: iso(raw.updatedAt) ?? '1970-01-01T00:00:00.000Z',
    contentRev: finiteInt(raw.contentRev) ?? 0,
    pageCount: count(raw.pageCount),
    bytes: count(raw.bytes),
    deviceId,
    files: readFiles(raw.files),
  };
  const deletedAt = iso(raw.deletedAt);
  if (deletedAt) entry.deletedAt = deletedAt;
  if (isSafeId(raw.folderId)) entry.folderId = raw.folderId;
  const course = str(raw.courseCode, 40);
  if (course) entry.courseCode = course;
  return entry;
}

// ----- readers -----

/**
 * Rebuilds a manifest field by field. Lenient on purpose: an entry with odd fields is kept with safe
 * defaults (dropping it would remove another device's notebook on the next write); only entries whose
 * id is not a safe file name are dropped. Returns null for anything that is not a v1 qu-backup manifest.
 */
export function readManifest(raw: unknown): BackupManifest | null {
  if (!isRecord(raw) || raw.format !== MANIFEST_FORMAT || raw.version !== MANIFEST_VERSION) return null;
  const devices: Record<string, ManifestDevice> = {};
  if (isRecord(raw.devices)) {
    for (const key of Object.keys(raw.devices)) {
      const d = raw.devices[key];
      if (!deviceKey(key) || !isRecord(d)) continue;
      devices[key] = { name: str(d.name, 100) ?? '', lastAt: iso(d.lastAt) ?? '1970-01-01T00:00:00.000Z' };
    }
  }
  const notebooks: Record<Id, ManifestEntry> = {};
  if (isRecord(raw.notebooks)) {
    for (const id of Object.keys(raw.notebooks)) {
      if (!isSafeId(id)) continue;
      const e = readEntry(raw.notebooks[id]);
      if (e) notebooks[id] = e;
    }
  }
  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    updatedAt: iso(raw.updatedAt) ?? '1970-01-01T00:00:00.000Z',
    libraryRev: finiteInt(raw.libraryRev) ?? 0,
    devices,
    notebooks,
  };
}

/**
 * Parses manifest.json text (null = the file does not exist).
 * - 'newer': written by a newer app version. Do NOT run a backup (it would overwrite it); ask for an update.
 * - 'invalid': unreadable. P20 keeps a copy (manifest.corrupt-<epoch>.json) before treating it as absent,
 *   so no other device's entry list is lost for good.
 */
export function parseManifest(text: string | null): ParsedManifest {
  if (text === null) return { ok: false, reason: 'missing' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (isRecord(raw) && raw.format === MANIFEST_FORMAT && typeof raw.version === 'number' && raw.version > MANIFEST_VERSION) {
    return { ok: false, reason: 'newer' };
  }
  const m = readManifest(raw);
  return m ? { ok: true, manifest: m } : { ok: false, reason: 'invalid' };
}

export function emptyManifest(now: IsoDate): BackupManifest {
  return { format: MANIFEST_FORMAT, version: MANIFEST_VERSION, updatedAt: now, libraryRev: 0, devices: {}, notebooks: {} };
}

function sortedKeys<T>(r: Record<string, T>): string[] {
  return Object.keys(r).sort();
}

function cleanEntry(e: ManifestEntry): ManifestEntry {
  const files: Record<string, ManifestFile> = {};
  for (const k of sortedKeys(e.files)) {
    const f = e.files[k];
    files[k] = f.rev === undefined ? { bytes: f.bytes } : { rev: f.rev, bytes: f.bytes };
  }
  const out: ManifestEntry = {
    title: e.title,
    updatedAt: e.updatedAt,
    contentRev: e.contentRev,
    pageCount: e.pageCount,
    bytes: e.bytes,
    deviceId: e.deviceId,
    files,
  };
  if (e.deletedAt) out.deletedAt = e.deletedAt;
  if (e.folderId) out.folderId = e.folderId;
  if (e.courseCode) out.courseCode = e.courseCode;
  return out;
}

/** Stable JSON (sorted ids and file keys) so two writes of the same manifest are byte-identical. */
export function serializeManifest(m: BackupManifest): string {
  const devices: Record<string, ManifestDevice> = {};
  for (const k of sortedKeys(m.devices)) devices[k] = { name: m.devices[k].name, lastAt: m.devices[k].lastAt };
  const notebooks: Record<Id, ManifestEntry> = {};
  for (const id of sortedKeys(m.notebooks)) notebooks[id] = cleanEntry(m.notebooks[id]);
  return JSON.stringify({
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    updatedAt: m.updatedAt,
    libraryRev: m.libraryRev,
    devices,
    notebooks,
  });
}

export function sameEntry(a: ManifestEntry | undefined, b: ManifestEntry | undefined): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(cleanEntry(a)) === JSON.stringify(cleanEntry(b));
}

/** True when the notebook lists (and libraryRev) are equal; updatedAt and devices are ignored. */
export function sameNotebooks(a: BackupManifest | null, b: BackupManifest | null): boolean {
  if (!a || !b) return a === b;
  if (a.libraryRev !== b.libraryRev) return false;
  const ka = sortedKeys(a.notebooks);
  const kb = sortedKeys(b.notebooks);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => sameEntry(a.notebooks[k], b.notebooks[k]));
}

// ----- builders -----

export function entryBytes(files: Record<string, ManifestFile>): number {
  let n = 0;
  for (const k of Object.keys(files)) n += files[k].bytes;
  return n;
}

/** The manifest entry for a local notebook as uploaded by deviceId. files are merged by the caller. */
export function entryFromLocal(nb: LocalNotebook, deviceId: string, files: Record<string, ManifestFile>): ManifestEntry {
  const e: ManifestEntry = {
    title: nb.title,
    updatedAt: nb.updatedAt,
    contentRev: nb.contentRev,
    pageCount: nb.pageCount,
    bytes: entryBytes(nb.files),
    deviceId,
    files,
  };
  if (nb.deletedAt) e.deletedAt = nb.deletedAt;
  if (nb.folderId) e.folderId = nb.folderId;
  if (nb.courseCode) e.courseCode = nb.courseCode;
  return e;
}

/**
 * Merges this device's entries into the remote manifest.
 * - Remote entries that `mine` does not mention are kept untouched (whatever device owns them).
 * - Entries in `mine.notebooks` replace the remote ones and are tagged with deviceId.
 * - Ids in `mine.removed` are dropped (the planner only puts purged ids there).
 * - devices[deviceId] = { name: deviceName, lastAt: mine.updatedAt }; other devices are kept.
 * Pure: neither input is changed.
 */
export function mergeManifest(remote: BackupManifest | null, mine: MineManifest, deviceId: string, deviceName: string): BackupManifest {
  const base = remote ?? emptyManifest(mine.updatedAt);
  const notebooks: Record<Id, ManifestEntry> = {};
  for (const id of Object.keys(base.notebooks)) notebooks[id] = base.notebooks[id];
  for (const id of mine.removed ?? []) delete notebooks[id];
  for (const id of Object.keys(mine.notebooks)) {
    if (!isSafeId(id)) continue;
    notebooks[id] = { ...cleanEntry(mine.notebooks[id]), deviceId };
  }
  const devices: Record<string, ManifestDevice> = {};
  for (const k of Object.keys(base.devices)) devices[k] = base.devices[k];
  devices[deviceId] = { name: deviceName.slice(0, 100), lastAt: mine.updatedAt };
  const updatedAt = base.updatedAt > mine.updatedAt ? base.updatedAt : mine.updatedAt;
  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    updatedAt,
    libraryRev: mine.libraryRev ?? base.libraryRev,
    devices,
    notebooks,
  };
}

/**
 * Re-merges a planned manifest write onto the manifest.json that is on the server NOW (read again just
 * before writing), so a device that wrote the manifest while this run was uploading does not lose its
 * entries (a lost update would drop its new notebooks and revert its changed ones).
 * - base: the remote manifest the plan was made from; fresh: the one read again (null = still none).
 * - An entry of ours is NOT written when another device changed that id's entry since `base`: theirs is
 *   kept and the id is returned in conflicts.
 * - A removal is NOT applied when the id's entry changed since `base` (re-uploaded meanwhile).
 * With fresh equal to base this gives exactly mergeManifest(base, mine, ...).
 */
export function rebaseManifest(
  base: BackupManifest | null,
  fresh: BackupManifest | null,
  mine: MineManifest,
  deviceId: string,
  deviceName: string,
): { manifest: BackupManifest; conflicts: Id[] } {
  const changedSince = (id: Id): boolean => !sameEntry(ownValue(base?.notebooks, id), ownValue(fresh?.notebooks, id));
  const notebooks: Record<Id, ManifestEntry> = {};
  const conflicts: Id[] = [];
  for (const id of Object.keys(mine.notebooks)) {
    const now = ownValue(fresh?.notebooks, id);
    if (now && now.deviceId !== deviceId && changedSince(id)) conflicts.push(id);
    else notebooks[id] = mine.notebooks[id];
  }
  const removed = (mine.removed ?? []).filter((id) => !changedSince(id));
  const next: MineManifest = { updatedAt: mine.updatedAt, notebooks, removed };
  if (mine.libraryRev !== undefined) next.libraryRev = mine.libraryRev;
  return { manifest: mergeManifest(fresh, next, deviceId, deviceName), conflicts: conflicts.sort() };
}

// ----- local state -----

export function defaultLocalState(deviceId: string): BackupLocalState {
  return { deviceId, lastUploaded: {}, conflicts: [] };
}

function readRevMap(raw: unknown): Record<Id, number> {
  const out: Record<Id, number> = {};
  if (!isRecord(raw)) return out;
  for (const id of Object.keys(raw)) {
    const v = finiteInt(raw[id]);
    if (isSafeId(id) && v !== undefined) out[id] = v;
  }
  return out;
}

/** Reads BackupLocalState (AsyncStorage JSON). null when deviceId is missing or unsafe. */
export function readBackupLocalState(raw: unknown): BackupLocalState | null {
  if (!isRecord(raw) || !deviceKey(raw.deviceId)) return null;
  const state: BackupLocalState = { deviceId: raw.deviceId, lastUploaded: readRevMap(raw.lastUploaded), conflicts: [] };
  if (Array.isArray(raw.conflicts)) {
    const seen = new Set<Id>();
    for (const c of raw.conflicts) if (isSafeId(c) && !seen.has(c)) seen.add(c);
    state.conflicts = [...seen];
  }
  const lib = finiteInt(raw.libraryUploaded);
  if (lib !== undefined) state.libraryUploaded = lib;
  const d = raw.drive;
  if (isRecord(d) && typeof d.rootId === 'string' && d.rootId && typeof d.backupsId === 'string' && d.backupsId) {
    const folderIds: Record<Id, string> = {};
    if (isRecord(d.folderIds)) {
      for (const id of Object.keys(d.folderIds)) {
        const v = d.folderIds[id];
        if (isSafeId(id) && typeof v === 'string' && v.length > 0 && v.length <= 200) folderIds[id] = v;
      }
    }
    state.drive = { rootId: d.rootId, backupsId: d.backupsId, folderIds };
  }
  if (isRecord(raw.pdfUploaded)) {
    const pdf: Record<Id, { rev: number; path: string }> = {};
    for (const id of Object.keys(raw.pdfUploaded)) {
      const v = raw.pdfUploaded[id];
      if (!isSafeId(id) || !isRecord(v)) continue;
      const rev = finiteInt(v.rev);
      const path = v.path;
      if (rev === undefined || typeof path !== 'string' || !path || path.length > 400 || path.includes('..')) continue;
      pdf[id] = { rev, path };
    }
    state.pdfUploaded = pdf;
  }
  return state;
}

// ----- views for the service and the restore screen -----

/** Own-property lookup: ids such as 'constructor' are valid keys but must not reach Object.prototype. */
export function ownValue<T>(r: Record<string, T> | undefined, key: string): T | undefined {
  return r && Object.prototype.hasOwnProperty.call(r, key) ? r[key] : undefined;
}

/** checkRemote(): hasBackup, notebook count (trashed ones excluded) and the OTHER devices' names. */
export function summarizeManifest(m: BackupManifest | null, myDeviceId: string): RemoteCheck {
  if (!m) return { hasBackup: false, notebooks: 0, devices: [] };
  const ids = Object.keys(m.notebooks);
  const live = ids.filter((id) => !m.notebooks[id].deletedAt).length;
  const names = new Set<string>();
  for (const id of ids) {
    const owner = m.notebooks[id].deviceId;
    if (owner && owner !== myDeviceId) names.add(ownValue(m.devices, owner)?.name || owner);
  }
  return { hasBackup: ids.length > 0, notebooks: live, devices: [...names].sort() };
}

/** Restore screen rows, newest first (trashed ones keep deletedAt so the screen can mark them). */
export function remoteNotebooks(m: BackupManifest | null, localIds: Iterable<Id>): RemoteNotebook[] {
  if (!m) return [];
  const local = new Set(localIds);
  const out: RemoteNotebook[] = [];
  for (const id of Object.keys(m.notebooks)) {
    const e = m.notebooks[id];
    const row: RemoteNotebook = { id, title: e.title, updatedAt: e.updatedAt, pageCount: e.pageCount, bytes: e.bytes, existsLocally: local.has(id) };
    if (e.deletedAt) row.deletedAt = e.deletedAt;
    const name = ownValue(m.devices, e.deviceId)?.name;
    if (name) row.deviceName = name;
    out.push(row);
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1));
  return out;
}

// ----- library.json -----

export interface LibraryData {
  folders: Folder[];
  courseNames: Record<string, string>;
}

/**
 * The library.json content to upload: the union of the remote one and this device's (this device wins
 * for the same folder id or course code). Folders made on another device are never dropped, so a
 * restore there can still put notebooks back into them.
 */
export function mergeLibraryData(remote: LibraryData | null, local: LibraryData): LibraryData {
  const byId = new Map<Id, Folder>();
  for (const f of remote?.folders ?? []) byId.set(f.id, f);
  for (const f of local.folders) byId.set(f.id, f);
  const folders = [...byId.values()].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const courseNames: Record<string, string> = {};
  for (const [k, v] of Object.entries(remote?.courseNames ?? {})) if (k !== '__proto__') courseNames[k] = v;
  for (const [k, v] of Object.entries(local.courseNames)) if (k !== '__proto__') courseNames[k] = v;
  return { folders, courseNames };
}
