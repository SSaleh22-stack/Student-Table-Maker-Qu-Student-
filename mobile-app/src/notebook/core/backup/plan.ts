/**
 * Backup and restore planning (P09). Pure: the service (P20) builds a LocalSnapshot, reads the remote
 * manifest, calls planBackup, then runs plan.steps in order.
 *
 * SAFETY RULES
 * - A notebook is uploaded only if its remote entry is absent, or it is ours (remote.deviceId ===
 *   local.deviceId), or the remote copy is not newer than what we uploaded last
 *   (remote.contentRev <= local.lastUploaded[id]). Otherwise another device changed it after us, so it
 *   is skipped and reported in skippedConflicts. Nothing is ever merged.
 * - Deletes: ONLY ids that are in local.purged AND in the remote manifest. A notebook missing from
 *   this device is never a delete (a fresh device with an empty library deletes nothing). Trashed
 *   notebooks are uploaded as usual and keep deletedAt. A purged id whose remote copy was changed by
 *   another device after the purge is kept (and reported as a conflict). A purged id whose remote copy
 *   belongs to another device that has backed up since the purge is kept silently: that device still
 *   has the notebook and would upload it again on its next run, so deleting it would only repeat
 *   (a full re-upload plus a copy in the Drive trash) on every run.
 * - No file inside a notebook folder is deleted either: remote files the device no longer has stay
 *   listed in the entry (restore follows notebook.json, so they are harmless).
 *
 * STEP ORDER (plan.steps)
 *   per notebook (newest first): assets, audio and other files, then pages, then notebook.json
 *   [a checkpoint manifest after every ~CHECKPOINT_BYTES of uploads, so an interrupted big first
 *    backup does not start over]
 *   then library.json (if it changed), then the remote deletes, then manifest.json LAST (merged).
 * Deletes run before the final manifest so a crash between them is repaired by the next run (the
 * purged id is still in the remote manifest and is deleted again; remove() of a missing path is fine).
 *
 * After a 'manifest' step succeeds, P20 stores step.lastUploaded as BackupLocalState.lastUploaded (and
 * libraryUploaded = local.libraryRev after the final one when plan.uploadLibrary), and keeps
 * plan.skippedConflicts as BackupLocalState.conflicts.
 */
import { isSafeId, newId as makeId, TITLE_MAX } from '../model/index.ts';
import type { Id, IsoDate } from '../model/index.ts';
import {
  entryFromLocal,
  isSafeRel,
  LIBRARY_NAME,
  MANIFEST_NAME,
  mergeManifest,
  NOTEBOOK_FILE,
  ownValue,
  sameEntry,
  sameNotebooks,
  serializeManifest,
} from './manifest.ts';
import type { BackupManifest, LocalNotebook, LocalSnapshot, ManifestEntry, ManifestFile, MineManifest } from './manifest.ts';

export const CHECKPOINT_BYTES = 32 * 1024 * 1024;
export const RESTORE_SUFFIX = ' (نسخة احتياطية)';

export type UploadKind = 'asset' | 'audio' | 'other' | 'page' | 'notebook';

export interface UploadItem {
  notebookId: Id;
  /** Path inside the notebook folder ('pages/p1.json'); the same path locally under notebooks/<id>/. */
  file: string;
  /** Path relative to QU Student/Backups ('<id>/pages/p1.json'). */
  rel: string;
  kind: UploadKind;
  bytes: number;
  rev?: number;
  mime: string;
}

export type BackupStep =
  | { op: 'upload'; item: UploadItem }
  /** Write library.json: read the remote one and upload mergeLibraryData(remote, local). */
  | { op: 'library'; rel: string; libraryRev: number }
  /** Remove the remote notebook folder (recursively). Only purged ids get here. */
  | { op: 'delete'; notebookId: Id; rel: string }
  /**
   * Write manifest.json. final is true for the last step of the plan. `mine` is what this run adds, for
   * rebaseManifest(remote, freshlyRead, step.mine, ...) when the service re-reads manifest.json first.
   */
  | { op: 'manifest'; rel: string; manifest: BackupManifest; text: string; mine: MineManifest; lastUploaded: Record<Id, number>; final: boolean };

export interface BackupPlan {
  /** Run in order. Empty when nothing changed (no write at all). */
  steps: BackupStep[];
  /** The file uploads in step order (library and manifest not included). */
  uploads: UploadItem[];
  uploadLibrary: boolean;
  /** Notebook ids removed remotely: always a subset of local.purged ∩ remote. */
  deletes: Id[];
  /** Ids not uploaded (or not deleted) because another device has a newer copy. Sorted. */
  skippedConflicts: Id[];
  /** The final merged manifest. */
  manifest: BackupManifest;
  /** BackupLocalState.lastUploaded after the final manifest is written. */
  lastUploaded: Record<Id, number>;
  changed: boolean;
  /** Bytes of plan.uploads (progress total). */
  totalBytes: number;
  /** Notebooks whose entry this run writes (uploaded or metadata changed). */
  notebookIds: Id[];
}

export interface PlanOptions {
  /** ISO time of this run (injected; default the current time). */
  now?: IsoDate;
  checkpointBytes?: number;
}

const MIME: Record<string, string> = {
  json: 'application/json',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
  gif: 'image/gif',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  caf: 'audio/x-caf',
};

/** MIME type by extension (application/octet-stream when unknown). */
export function mimeOf(file: string): string {
  const dot = file.lastIndexOf('.');
  const ext = dot >= 0 ? file.slice(dot + 1).toLowerCase() : '';
  return MIME[ext] ?? 'application/octet-stream';
}

export function kindOf(file: string): UploadKind {
  if (file === NOTEBOOK_FILE) return 'notebook';
  if (file.startsWith('pages/')) return 'page';
  if (file.startsWith('assets/')) return 'asset';
  if (file.startsWith('audio/')) return 'audio';
  return 'other';
}

const KIND_ORDER: Record<UploadKind, number> = { asset: 0, audio: 0, other: 0, page: 1, notebook: 2 };

function fileChanged(local: ManifestFile, remote: ManifestFile | undefined): boolean {
  if (!remote) return true;
  if (local.rev !== undefined) return remote.rev !== local.rev || remote.bytes !== local.bytes;
  return remote.bytes !== local.bytes;
}

function timeOf(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function byNewest(notebooks: Record<Id, LocalNotebook>): Id[] {
  return Object.keys(notebooks)
    .filter(isSafeId)
    .sort((a, b) => {
      const d = timeOf(notebooks[b].updatedAt) - timeOf(notebooks[a].updatedAt);
      return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0;
    });
}

/**
 * Plans one backup run. deviceName is shown on the other devices' restore screens.
 * See the file header for the rules; remote null means there is no manifest.json yet.
 */
export function planBackup(local: LocalSnapshot, remote: BackupManifest | null, deviceName: string, o?: PlanOptions): BackupPlan {
  const now = o?.now ?? new Date().toISOString();
  const checkpointBytes = o?.checkpointBytes ?? CHECKPOINT_BYTES;
  const remoteNbs: Record<Id, ManifestEntry> = remote?.notebooks ?? {};
  const deviceId = local.deviceId;

  const steps: BackupStep[] = [];
  const uploads: UploadItem[] = [];
  const conflicts = new Set<Id>();
  const mine: Record<Id, ManifestEntry> = {};
  const lastUploaded: Record<Id, number> = { ...local.lastUploaded };
  const notebookIds: Id[] = [];
  let sinceCheckpoint = 0;

  const ids = byNewest(local.notebooks);
  ids.forEach((id, index) => {
    const nb = local.notebooks[id];
    const r: ManifestEntry | undefined = Object.prototype.hasOwnProperty.call(remoteNbs, id) ? remoteNbs[id] : undefined;
    const last = ownValue(local.lastUploaded, id);
    const files: Record<string, ManifestFile> = {};
    for (const k of Object.keys(nb.files)) if (isSafeRel(k)) files[k] = nb.files[k];
    // A snapshot without notebook.json is incomplete (unreadable notebook): leave it alone.
    if (!files[NOTEBOOK_FILE]) return;

    const eligible = !r || r.deviceId === deviceId || (last !== undefined && r.contentRev <= last);
    if (!eligible) {
      const unchangedSinceOurUpload = last !== undefined && nb.contentRev === last;
      const sameAsRemote = last === undefined && nb.contentRev === r.contentRev;
      if (!unchangedSinceOurUpload && !sameAsRemote) conflicts.add(id);
      return;
    }

    const items: UploadItem[] = [];
    for (const k of Object.keys(files).sort()) {
      if (k === NOTEBOOK_FILE) continue;
      if (fileChanged(files[k], r?.files[k])) items.push(itemOf(id, k, files[k]));
    }
    items.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    const nbFile = files[NOTEBOOK_FILE];
    if (items.length > 0 || !r || r.contentRev !== nb.contentRev || fileChanged(nbFile, r.files[NOTEBOOK_FILE])) {
      items.push(itemOf(id, NOTEBOOK_FILE, nbFile));
    }

    const merged: Record<string, ManifestFile> = { ...(r?.files ?? {}), ...files };
    const entry = entryFromLocal({ ...nb, files }, deviceId, merged);
    if (items.length === 0 && r && sameEntry({ ...entry, deviceId: r.deviceId }, r)) return;

    mine[id] = entry;
    lastUploaded[id] = nb.contentRev;
    notebookIds.push(id);
    for (const item of items) {
      uploads.push(item);
      steps.push({ op: 'upload', item });
      sinceCheckpoint += item.bytes;
    }
    if (sinceCheckpoint >= checkpointBytes && index < ids.length - 1) {
      sinceCheckpoint = 0;
      const part: MineManifest = { updatedAt: now, notebooks: { ...mine } };
      const m = mergeManifest(remote, part, deviceId, deviceName);
      steps.push({ op: 'manifest', rel: MANIFEST_NAME, manifest: m, text: serializeManifest(m), mine: part, lastUploaded: { ...lastUploaded }, final: false });
    }
  });

  const uploadLibrary = remote === null || local.libraryUploaded === undefined || local.libraryUploaded !== local.libraryRev;
  if (uploadLibrary) steps.push({ op: 'library', rel: LIBRARY_NAME, libraryRev: local.libraryRev });

  const deletes: Id[] = [];
  for (const id of Object.keys(local.purged).sort()) {
    if (!isSafeId(id) || Object.prototype.hasOwnProperty.call(local.notebooks, id)) continue;
    if (!Object.prototype.hasOwnProperty.call(remoteNbs, id)) continue;
    const r = remoteNbs[id];
    const last = ownValue(local.lastUploaded, id);
    const purgedAt = timeOf(local.purged[id]);
    const otherOwner = r.deviceId !== deviceId;
    const newerElsewhere = otherOwner && timeOf(r.updatedAt) > purgedAt && (last === undefined || r.contentRev > last);
    if (newerElsewhere) {
      conflicts.add(id);
      continue;
    }
    // The owner ran after the purge and still lists it: it still has the notebook (no ping-pong).
    const owner = otherOwner ? ownValue(remote?.devices, r.deviceId) : undefined;
    if (owner && timeOf(owner.lastAt) > purgedAt) continue;
    deletes.push(id);
    steps.push({ op: 'delete', notebookId: id, rel: id });
  }
  // Purged ids need no lastUploaded entry any more.
  for (const id of Object.keys(lastUploaded)) {
    if (Object.prototype.hasOwnProperty.call(local.purged, id) && !Object.prototype.hasOwnProperty.call(local.notebooks, id)) delete lastUploaded[id];
  }

  const finalMine: MineManifest = { updatedAt: now, notebooks: mine, removed: deletes };
  if (uploadLibrary) finalMine.libraryRev = local.libraryRev;
  const manifest = mergeManifest(remote, finalMine, deviceId, deviceName);
  const changed = remote === null || uploads.length > 0 || uploadLibrary || deletes.length > 0 || !sameNotebooks(remote, manifest);
  if (changed) {
    steps.push({ op: 'manifest', rel: MANIFEST_NAME, manifest, text: serializeManifest(manifest), mine: finalMine, lastUploaded: { ...lastUploaded }, final: true });
  }
  let totalBytes = 0;
  for (const u of uploads) totalBytes += u.bytes;
  return {
    steps: changed ? steps : [],
    uploads: changed ? uploads : [],
    uploadLibrary: changed && uploadLibrary,
    deletes: changed ? deletes : [],
    skippedConflicts: [...conflicts].sort(),
    manifest,
    lastUploaded,
    changed,
    totalBytes: changed ? totalBytes : 0,
    notebookIds: changed ? notebookIds : [],
  };
}

function itemOf(notebookId: Id, file: string, f: ManifestFile): UploadItem {
  const item: UploadItem = { notebookId, file, rel: `${notebookId}/${file}`, kind: kindOf(file), bytes: f.bytes, mime: mimeOf(file) };
  if (f.rev !== undefined) item.rev = f.rev;
  return item;
}

// ===== restore =====

/** The local side of a restore decision (an IndexEntry fits). */
export interface LocalEntryLike {
  id: Id;
  updatedAt: IsoDate;
  contentRev: number;
}

interface RestoreBase {
  /** Id in the remote manifest (the remote folder name). */
  id: Id;
  entry: ManifestEntry;
  /** Files to download, paths inside the remote notebook folder: notebook.json first, then pages, assets, audio. */
  files: string[];
}

export type RestoreAction =
  /** Not on this device: restore under the same id. Then lastUploaded[id] = lastUploaded. */
  | (RestoreBase & { action: 'restore'; targetId: Id; title: string; lastUploaded: number })
  /**
   * On this device, unchanged since this device last uploaded or restored it (o.lastUploaded), and the
   * backup is strictly newer: replace the local copy. Then lastUploaded[id] = lastUploaded.
   */
  | (RestoreBase & { action: 'replace'; targetId: Id; title: string; lastUploaded: number })
  /** On this device and the local copy is newer (or diverged): keep both; the copy gets a new id and the suffix. */
  | (RestoreBase & { action: 'copy'; targetId: Id; title: string })
  | { action: 'skip'; id: Id; reason: 'missing' | 'same' };

export interface RestoreOptions {
  /** Id factory for copies (injected randomness; default model newId). */
  newId?: () => Id;
  /** Title suffix for copies (default ' (نسخة احتياطية)'; pass tr(...) for English). */
  suffix?: string;
  /**
   * BackupLocalState.lastUploaded: a local copy changed since our last upload counts as newer. A local
   * copy with no lastUploaded entry (never uploaded or restored here) is never replaced, only copied,
   * because nothing proves it holds no edits of its own.
   */
  lastUploaded?: Record<Id, number>;
}

function restoreFiles(entry: ManifestEntry): string[] {
  const keys = Object.keys(entry.files).filter((k) => isSafeRel(k) && k !== NOTEBOOK_FILE);
  keys.sort((a, b) => KIND_ORDER[kindOf(b)] - KIND_ORDER[kindOf(a)] || (a < b ? -1 : a > b ? 1 : 0));
  return [NOTEBOOK_FILE, ...keys];
}

export function copyTitle(title: string, suffix: string = RESTORE_SUFFIX): string {
  return title.slice(0, Math.max(0, TITLE_MAX - suffix.length)) + suffix;
}

/**
 * Plans restoring the given ids (in the given order, duplicates ignored).
 * Same id locally and newer (higher contentRev, later updatedAt, or changed since our last upload):
 * keep both, the restored copy gets a new id and ' (نسخة احتياطية)'. Identical: skip 'same'.
 * Remote higher contentRev and not an older updatedAt, and the local copy provably unchanged since
 * our last upload or restore (o.lastUploaded): replace. Anything else that differs: copy.
 */
export function planRestore(remote: BackupManifest | null, localEntries: readonly LocalEntryLike[], ids: readonly Id[], o?: RestoreOptions): RestoreAction[] {
  const make = o?.newId ?? (() => makeId());
  const suffix = o?.suffix ?? RESTORE_SUFFIX;
  const local = new Map<Id, LocalEntryLike>();
  for (const e of localEntries) local.set(e.id, e);
  const taken = new Set<Id>([...local.keys(), ...Object.keys(remote?.notebooks ?? {})]);
  const seen = new Set<Id>();
  const out: RestoreAction[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = remote && Object.prototype.hasOwnProperty.call(remote.notebooks, id) ? remote.notebooks[id] : undefined;
    if (!entry || !isSafeId(id)) {
      out.push({ action: 'skip', id, reason: 'missing' });
      continue;
    }
    const files = restoreFiles(entry);
    const mine = local.get(id);
    if (!mine) {
      out.push({ action: 'restore', id, entry, files, targetId: id, title: entry.title, lastUploaded: entry.contentRev });
      continue;
    }
    const lt = timeOf(mine.updatedAt);
    const rt = timeOf(entry.updatedAt);
    if (mine.contentRev === entry.contentRev && lt === rt) {
      out.push({ action: 'skip', id, reason: 'same' });
      continue;
    }
    const last = ownValue(o?.lastUploaded, id);
    // Unknown history counts as changed: replacing could destroy edits made only on this device.
    const localChanged = last === undefined || mine.contentRev > last;
    const remoteNewer = entry.contentRev > mine.contentRev && rt >= lt && !localChanged;
    if (remoteNewer) {
      out.push({ action: 'replace', id, entry, files, targetId: id, title: entry.title, lastUploaded: entry.contentRev });
      continue;
    }
    let targetId = make();
    for (let i = 0; taken.has(targetId) || !isSafeId(targetId); i++) {
      if (i > 100) throw new Error('planRestore: newId keeps colliding');
      targetId = make();
    }
    taken.add(targetId);
    out.push({ action: 'copy', id, entry, files, targetId, title: copyTitle(entry.title, suffix) });
  }
  return out;
}
