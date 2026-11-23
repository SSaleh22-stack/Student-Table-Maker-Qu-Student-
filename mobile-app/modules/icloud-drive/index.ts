/**
 * iCloud Drive for the notebook backup (PRD NB-86): the app's ubiquity container, whose Documents
 * folder the Files app shows as "QU Student" (app.json NSUbiquitousContainers, container
 * iCloud.net.qustudent.app). iOS only. Elsewhere, and in builds without this module (Expo Go,
 * builds made before it was added), the queries answer "nothing there" (isAvailable false,
 * documentsPath null, list [], status { exists: false }, readText null) and the writes reject with
 * ERR_ICLOUD_UNAVAILABLE, so nothing ever pretends a backup was written.
 *
 * Paths: every `rel` is relative to the container's Documents folder, with "/" separators, for
 * example 'Backups/manifest.json' (the Files app shows it as QU Student > Backups). Absolute paths and "." or ".." segments reject with
 * ERR_ICLOUD_BAD_PATH. Local paths (copyIn source, copyOut target) are absolute paths or file://
 * URIs (expo-file-system `File.uri` works).
 *
 * Native side (modules/icloud-drive/ios): every call runs on one serial background queue (never the
 * main thread, so url(forUbiquityContainerIdentifier:) never blocks the UI); NSMetadataQuery is
 * created, started and observed only on the main queue and hands results back to that queue.
 * Writes are coordinated (NSFileCoordinator): copyIn and writeText replace atomically, remove is a
 * coordinated delete. copyOut and readText start the download of an evicted file and wait for it.
 *
 * DEVICE CHECKLIST (dev build on an iPhone or iPad; the Swift is first compiled by that build):
 * 1. Signed in, iCloud Drive on: isAvailable() is true; documentsPath() ends in
 *    "/Mobile Documents/iCloud~net~qustudent~app/Documents".
 * 2. writeText('probe/hello.json', '{}'), then the Files app shows iCloud Drive > QU Student > probe.
 * 3. copyIn a 50 MB file: the promise resolves with its size; status() shows isUploading, then
 *    isUploaded true. No main-thread hang (the UI keeps scrolling) during the copy.
 * 4. Evicted file: in Files, long-press the file > Remove Download. list('probe') shows it with
 *    isDownloaded false; copyOut downloads it (downloadProgress events arrive) and resolves.
 * 5. Airplane mode, evicted file: copyOut rejects with ERR_ICLOUD_TIMEOUT after timeoutMs.
 * 6. Settings > Apple Account > iCloud > iCloud Drive off (or sign out) while the app runs:
 *    availabilityChanged fires with { available: false }; isAvailable() is false; writes reject
 *    with ERR_ICLOUD_UNAVAILABLE. Turning it back on fires { available: true }.
 * 7. Full iCloud storage: status() of a new file reports uploadError.kind 'quota'.
 * 8. Main Thread Checker (Xcode scheme diagnostics) reports nothing for any call; NSMetadataQuery
 *    notifications arrive (they would not if the query ran off the main queue).
 * 9. readText of a missing file resolves null; remove of a missing file resolves false.
 * 10. A file added to probe/sub from ANOTHER device, before this device has materialised it, is in
 *    list('probe', { recursive: true }). This checks the NSMetadataItemPathKey BEGINSWITH predicate
 *    that list uses for sub-folders; if it fails, switch that predicate to the root's LIKE '*' one
 *    (the results are filtered by path in Swift anyway).
 */
import { CodedError, requireOptionalNativeModule, type EventEmitter, type EventSubscription } from 'expo';
import { Platform } from 'react-native';

export type ICloudErrorCode =
  | 'ERR_ICLOUD_UNAVAILABLE' // signed out, iCloud Drive off, no container, or not iOS
  | 'ERR_ICLOUD_BAD_PATH'
  | 'ERR_ICLOUD_NOT_FOUND'
  | 'ERR_ICLOUD_TIMEOUT' // a download did not finish in time (offline, slow)
  | 'ERR_ICLOUD_QUOTA' // the student's iCloud storage is full
  | 'ERR_ICLOUD_NO_SPACE' // this device is full
  | 'ERR_ICLOUD_IO';

/** 'quota' = iCloud storage full; 'server-unavailable' = iCloud servers unreachable. */
export type ICloudItemErrorKind = 'quota' | 'server-unavailable' | 'unavailable' | 'other';

export type ICloudItemError = { kind: ICloudItemErrorKind; domain: string; code: number; message: string };

/**
 * 'current' = the latest version is on this device; 'downloaded' = a local copy that may be older;
 * 'not-downloaded' = evicted (only in iCloud).
 */
export type ICloudDownloadStatus = 'current' | 'downloaded' | 'not-downloaded';

export type ICloudItemInfo = {
  isDirectory: boolean;
  /** The bytes are on this device ('current' or 'downloaded'). False for evicted items. */
  isDownloaded: boolean;
  /** Missing for items iCloud does not manage. */
  downloadStatus?: ICloudDownloadStatus;
  isDownloading: boolean;
  isUploaded: boolean;
  isUploading: boolean;
  /** Bytes. */
  size?: number;
  /** Milliseconds since 1970. */
  modifiedAt?: number;
  /** 0 to 100, while downloading. */
  percentDownloaded?: number;
  uploadError?: ICloudItemError;
  downloadError?: ICloudItemError;
};

export type ICloudItemStatus = ICloudItemInfo & { exists: boolean };

export type ICloudEntry = ICloudItemInfo & {
  /** File or folder name. */
  name: string;
  /** Path relative to Documents, e.g. 'Backups/nb1/notebook.json'. */
  rel: string;
};

export type ICloudDownloadProgress = { token: string; rel: string; percent: number };

type ICloudDriveEvents = {
  availabilityChanged: (event: { available: boolean }) => void;
  downloadProgress: (event: ICloudDownloadProgress) => void;
};

type NativeICloudDrive = EventEmitter<ICloudDriveEvents> & {
  isAvailable(): Promise<boolean>;
  documentsPath(): Promise<string | null>;
  ensureDir(rel: string): Promise<null>;
  copyIn(localPath: string, rel: string): Promise<number>;
  copyOut(rel: string, localPath: string, timeoutMs: number, token: string): Promise<number>;
  readText(rel: string, timeoutMs: number): Promise<string | null>;
  writeText(rel: string, text: string): Promise<null>;
  list(relDir: string, recursive: boolean): Promise<ICloudEntry[]>;
  status(rel: string): Promise<ICloudItemStatus>;
  remove(rel: string): Promise<boolean>;
};

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeICloudDrive>('ICloudDrive') : null;

/** True when this build has the native module (iOS dev or store build made after it was added). */
export const iCloudDriveModulePresent = native !== null;

export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;
export const DEFAULT_READ_TIMEOUT_MS = 60_000;

const MISSING: ICloudItemStatus = {
  exists: false,
  isDirectory: false,
  isDownloaded: false,
  isDownloading: false,
  isUploaded: false,
  isUploading: false,
};

function unavailable(): never {
  throw new CodedError('ERR_ICLOUD_UNAVAILABLE', 'iCloud Drive is only available in the iOS app');
}

/** The error code of a rejection from this module, or null for any other error. */
export function iCloudErrorCode(error: unknown): ICloudErrorCode | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('ERR_ICLOUD_') ? (code as ICloudErrorCode) : null;
}

/** Signed in to iCloud with iCloud Drive on, and the container is reachable. */
export async function isAvailable(): Promise<boolean> {
  return native ? native.isAvailable() : false;
}

/** Absolute path (no file:// scheme) of the container's Documents folder, or null when unavailable. */
export async function documentsPath(): Promise<string | null> {
  return native ? native.documentsPath() : null;
}

/** Creates a folder (and its parents). Resolves when it exists. */
export async function ensureDir(rel: string): Promise<void> {
  if (!native) unavailable();
  await native.ensureDir(rel);
}

/**
 * Copies a local file into iCloud at `rel` (parents are created), replacing what is there through
 * a coordinated replace. Resolves with the bytes copied. The upload itself happens later, in the
 * background: watch status(rel).isUploaded / uploadError.
 */
export async function copyIn(localPath: string, rel: string): Promise<number> {
  if (!native) unavailable();
  return native.copyIn(localPath, rel);
}

let nextToken = 0;

/**
 * Copies the iCloud file at `rel` to a local path (parents are created, an existing file is
 * replaced). An evicted file is downloaded first: rejects with ERR_ICLOUD_TIMEOUT when that takes
 * longer than `timeoutMs` and ERR_ICLOUD_NOT_FOUND when iCloud has no such file. `onProgress`
 * gets the download percent (0 to 100); it is not called for files already on the device.
 * Resolves with the bytes copied.
 */
export async function copyOut(
  rel: string,
  localPath: string,
  options: { timeoutMs?: number; onProgress?: (percent: number) => void } = {},
): Promise<number> {
  if (!native) unavailable();
  const { timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS, onProgress } = options;
  const token = onProgress ? `dl-${++nextToken}` : '';
  const subscription = onProgress
    ? native.addListener('downloadProgress', (event) => {
        if (event.token === token) onProgress(event.percent);
      })
    : null;
  try {
    return await native.copyOut(rel, localPath, timeoutMs, token);
  } finally {
    subscription?.remove();
  }
}

/** UTF-8 text of the file at `rel` (downloaded first if evicted), or null when there is no such file. */
export async function readText(rel: string, options: { timeoutMs?: number } = {}): Promise<string | null> {
  if (!native) return null;
  return native.readText(rel, options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS);
}

/** Writes UTF-8 text to `rel` atomically under file coordination (parents are created). */
export async function writeText(rel: string, text: string): Promise<void> {
  if (!native) unavailable();
  await native.writeText(rel, text);
}

/**
 * The items in the folder `relDir` ('' = Documents), sorted by rel. Merges what is on this device
 * with iCloud's metadata index, so evicted items are listed with isDownloaded false and items that
 * only exist in iCloud so far are listed too. Hidden files are skipped. A missing folder lists [].
 */
export async function list(relDir: string, options: { recursive?: boolean } = {}): Promise<ICloudEntry[]> {
  if (!native) return [];
  return native.list(relDir, options.recursive ?? false);
}

/** Sync state of one item, including uploadError (e.g. kind 'quota'). exists false when there is nothing. */
export async function status(rel: string): Promise<ICloudItemStatus> {
  if (!native) return { ...MISSING };
  return native.status(rel);
}

/** Deletes the file or folder at `rel` under a coordinated delete. Resolves false when nothing was there. */
export async function remove(rel: string): Promise<boolean> {
  if (!native) unavailable();
  return native.remove(rel);
}

/**
 * Fires when the student signs in or out of iCloud or turns iCloud Drive on or off while the app
 * runs. Off iOS this never fires.
 */
export function addAvailabilityListener(listener: (available: boolean) => void): EventSubscription {
  if (!native) return { remove() {} };
  return native.addListener('availabilityChanged', (event) => listener(event.available));
}
