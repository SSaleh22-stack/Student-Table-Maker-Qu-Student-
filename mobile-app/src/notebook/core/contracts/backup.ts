/**
 * Backup contract, pure part (P04). Shared by core/backup (P09: planner, Drive client) and the backup
 * service (P20: src/notebook/backup/{service,useBackup,icloudProvider,driveProvider}.ts).
 *
 * Backup is OFF until the student turns it on (NB-85). Remote tree:
 *   QU Student/Backups/{manifest.json, library.json, <nbId>/{notebook.json, pages/*, assets/*, audio/*}}
 * Every `rel` path below is relative to QU Student/Backups and uses '/' separators.
 */
import type { Id, IsoDate } from '../model/index.ts';

export type BackupError =
  | 'icloud-off'
  | 'signed-out'
  | 'revoked'
  | 'no-play-services'
  | 'unavailable'
  | 'quota'
  | 'network'
  | 'unknown';

export const BACKUP_ERRORS: readonly BackupError[] = ['icloud-off', 'signed-out', 'revoked', 'no-play-services', 'unavailable', 'quota', 'network', 'unknown'];

export function isBackupError(v: unknown): v is BackupError {
  return typeof v === 'string' && (BACKUP_ERRORS as readonly string[]).includes(v);
}

/** The part of AbortSignal the providers read (a real AbortSignal fits). */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface RemoteFile {
  /** Name inside the listed folder (no slashes). */
  name: string;
  isDir: boolean;
  bytes: number;
  modifiedAt?: IsoDate;
  /** Provider id (Drive file id); undefined on iCloud. */
  id?: string;
}

/** One notebook in the remote manifest, as the restore screen lists it. */
export interface RemoteNotebook {
  id: Id;
  title: string;
  updatedAt: IsoDate;
  pageCount: number;
  bytes: number;
  deletedAt?: IsoDate;
  /** Name of the device that uploaded it last. */
  deviceName?: string;
  /** A notebook with this id exists on this device (restore makes a copy or replaces, per P20). */
  existsLocally: boolean;
}

export interface CloudProvider {
  kind: 'icloud' | 'gdrive';
  availability(): Promise<'ok' | BackupError>;
  /** Creates QU Student/Backups if needed. */
  ensureRoot(): Promise<void>;
  /** null when the file does not exist. */
  readText(rel: string): Promise<string | null>;
  writeText(rel: string, text: string): Promise<void>;
  upload(localPath: string, rel: string, o: { mime: string; bytes: number; onProgress?(sent: number): void; signal?: AbortSignalLike }): Promise<void>;
  download(rel: string, localPath: string, o?: { onProgress?(got: number): void }): Promise<void>;
  /** Removes a file or a folder (recursively). Missing is not an error. */
  remove(rel: string): Promise<void>;
  list(relDir: string): Promise<RemoteFile[]>;
}

export interface BackupStatus {
  enabled: boolean;
  provider: 'icloud' | 'gdrive';
  phase: 'off' | 'idle' | 'waiting-wifi' | 'running' | 'error';
  lastBackupAt?: IsoDate;
  lastCount?: number;
  lastBytes?: number;
  error?: BackupError;
  progress?: { done: number; total: number };
  /** Google account e-mail (Android). */
  account?: string;
  /** Notebooks skipped because another device changed them (shown as a note, never merged). */
  conflicts: Id[];
}

export type RemoteCheck = { hasBackup: boolean; notebooks: number; devices: string[] };

export interface BackupService {
  /** Cached: the same object until something changes (safe as a useSyncExternalStore snapshot). */
  status: BackupStatus;
  subscribe(cb: () => void): () => void;
  checkRemote(): Promise<RemoteCheck | BackupError>;
  setEnabled(on: boolean): Promise<'ok' | 'cancelled' | BackupError>;
  setWifiOnly(on: boolean): void;
  runNow(): Promise<void>;
  listRemote(): Promise<RemoteNotebook[]>;
  /** Restores the given notebooks; resolves to the local ids created or replaced. */
  restore(ids: Id[], onProgress?: (done: number, total: number) => void): Promise<Id[]>;
  signOut(): Promise<void>;
}

/** Result of the enable flow (useEnableBackupFlow().start, SetupModal.enableBackup). */
export type EnableBackupResult = 'ok' | 'cancelled' | 'restore' | BackupError;
