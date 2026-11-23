/**
 * Turning backup on (contracts/backup.ts UseEnableBackupFlow), used by BackupSection and by the
 * first-time setup (P15 SetupModal enableBackup):
 *
 *   start(): availability -> Google sign-in (Android) -> checkRemote. When a backup made on another
 *   device exists, or this device has no notebooks while the backup has some (S6), it shows
 *   RemoteFoundDialog first:
 *     'استعادة الآن' -> backup is turned on WITHOUT a first run, and start() resolves 'restore':
 *                      the caller opens openRestore() (the first run follows the restore);
 *     'متابعة النسخ' -> backup is turned on and the first run starts: 'ok';
 *     dismissed     -> nothing changes: 'cancelled'.
 *   Otherwise backup is turned on: 'ok'. Errors resolve as their BackupError ('icloud-off',
 *   'no-play-services', 'signed-out', …) and backup stays off.
 *
 * Render `ui` once in the screen that calls start(). The first run never deletes anything remotely
 * (only purged tombstones of notebooks this device backed up are ever deleted).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { EnableBackupResult } from '@/notebook/core/contracts/backup';
import { getNotebooksStore } from '@/notebook/store/hooks';

import { RemoteFoundDialog } from './RemoteFoundDialog';
import { backupService } from './service';

type Choice = 'restore' | 'continue' | 'cancel';

export function useEnableBackupFlow(): { start(): Promise<EnableBackupResult>; ui: ReactNode } {
  const [dialog, setDialog] = useState<{ count: number; devices: string[] } | null>(null);
  const resolver = useRef<((c: Choice) => void) | null>(null);
  const busy = useRef(false);

  const choose = useCallback((c: Choice) => {
    const r = resolver.current;
    resolver.current = null;
    setDialog(null);
    r?.(c);
  }, []);

  // A screen closed while the dialog is up: the flow ends as cancelled.
  useEffect(() => () => resolver.current?.('cancel'), []);

  const start = useCallback(async (): Promise<EnableBackupResult> => {
    if (busy.current) return 'cancelled';
    busy.current = true;
    try {
      const r = await backupService.prepareEnable();
      if (typeof r === 'string') return r;
      const local = (getNotebooksStore()?.entries ?? []).filter((e) => !e.deletedAt).length;
      const offer = r.hasBackup && r.notebooks > 0 && (r.devices.length > 0 || local === 0);
      let choice: Choice = 'continue';
      if (offer) {
        choice = await new Promise<Choice>((resolve) => {
          resolver.current = resolve;
          setDialog({ count: r.notebooks, devices: r.devices });
        });
        if (choice === 'cancel') return 'cancelled';
      }
      const res = choice === 'restore' ? await backupService.enableDeferred() : await backupService.setEnabled(true);
      if (res !== 'ok') return res;
      return choice === 'restore' ? 'restore' : 'ok';
    } finally {
      busy.current = false;
    }
  }, []);

  const ui = (
    <RemoteFoundDialog
      visible={dialog !== null}
      count={dialog?.count ?? 0}
      devices={dialog?.devices ?? []}
      onRestore={() => choose('restore')}
      onContinue={() => choose('continue')}
      onCancel={() => choose('cancel')}
    />
  );

  return { start, ui };
}
