/**
 * React access to the backup service (contracts/backup.ts UseBackup, UseBackupAutoRun).
 *
 * - useBackup(): the service with its current status; re-renders when the status changes (the
 *   status object is cached, so it is a safe useSyncExternalStore snapshot).
 * - useBackupAutoRun(): turns on the automatic runs (save, library change, foreground, network,
 *   retry timers) while mounted. Ref-counted in the service, so mounting it twice is harmless; only
 *   NotebookServices mounts it. Nothing runs while backup is off.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { backupService, type BackupServiceImpl, type ServiceStatus } from './service';

const getStatus = (): ServiceStatus => backupService.status;

export function useBackup(): BackupServiceImpl {
  const status = useSyncExternalStore(backupService.subscribe, getStatus, getStatus);
  return useMemo(
    () => ({
      status,
      subscribe: backupService.subscribe,
      checkRemote: backupService.checkRemote,
      prepareEnable: backupService.prepareEnable,
      setEnabled: backupService.setEnabled,
      enableDeferred: backupService.enableDeferred,
      setWifiOnly: backupService.setWifiOnly,
      runNow: backupService.runNow,
      listRemote: backupService.listRemote,
      restore: backupService.restore,
      restoreDetailed: backupService.restoreDetailed,
      signOut: backupService.signOut,
      signInAgain: backupService.signInAgain,
      cancel: backupService.cancel,
      startAutoRun: backupService.startAutoRun,
      setProvider: backupService.setProvider,
    }),
    [status],
  );
}

export function useBackupAutoRun(): void {
  useEffect(() => backupService.startAutoRun(), []);
}
