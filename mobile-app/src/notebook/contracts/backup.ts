/**
 * Backup contract (P04): the pure backup types from core, plus the React-facing hooks.
 *
 * Implementers:
 * - P20 src/notebook/backup/useBackup.ts: `useBackup: UseBackup`, `useBackupAutoRun: UseBackupAutoRun`
 *   (module singleton, ref-counted; mounted only by NotebookServices)
 * - P20 src/notebook/backup/useEnableBackupFlow.tsx: `useEnableBackupFlow: UseEnableBackupFlow`
 *   (checkRemote -> RemoteFoundDialog -> setEnabled; render `ui` once)
 * - P20 src/notebook/backup/service.ts: the BackupService singleton; providers in icloudProvider.ts
 *   and driveProvider.ts (Drive only through googleAuth.android.ts).
 * - Core (P09 src/notebook/core/backup/*): planBackup, planRestore, shouldRun, DriveClient.
 *
 * Backup is OFF until the student turns it on (NB-85); enabling first checks for an existing backup
 * and offers restore.
 */
import type { ReactNode } from 'react';

import type { BackupService, EnableBackupResult } from '@/notebook/core/contracts/backup';

export type {
  AbortSignalLike,
  BackupError,
  BackupService,
  BackupStatus,
  CloudProvider,
  EnableBackupResult,
  RemoteCheck,
  RemoteFile,
  RemoteNotebook,
} from '@/notebook/core/contracts/backup';
export { BACKUP_ERRORS, isBackupError } from '@/notebook/core/contracts/backup';

export type UseBackup = () => BackupService;
export type UseBackupAutoRun = () => void;
export type UseEnableBackupFlow = () => { start(): Promise<EnableBackupResult>; ui: ReactNode };
