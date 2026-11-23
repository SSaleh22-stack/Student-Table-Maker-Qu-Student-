/**
 * This device's backup bookkeeping in AsyncStorage ('qu-student:notebooks:backup:v1'):
 * BackupLocalState (core/backup/manifest.ts) = { deviceId, lastUploaded, conflicts, libraryUploaded?,
 * drive? }.
 *
 * - deviceId is a new random id (model newId) the first time the state is read and found empty. It
 *   tags this device's entries in the remote manifest, so two devices never overwrite each other.
 * - lastUploaded: contentRev this device last uploaded (or restored) per notebook. Only the backup
 *   service writes it, after each manifest write (plan.ts) and after a restore.
 * - drive: the Google Drive folder ids (QU Student, Backups, one per notebook), refreshed every run.
 *
 * The Tasks.tsx read pattern: the read is tried up to 3 times more (1 s, 2 s, 3 s); nothing is
 * written until the saved state was read; a save that cannot be read is kept under ':unreadable'
 * before being replaced (a new deviceId then makes this device's old entries look like another
 * device's: they are skipped as conflicts, never deleted). When every read fails, loadBackupState
 * resolves null and the next call tries again.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { defaultLocalState, readBackupLocalState, type BackupLocalState } from '@/notebook/core/backup/manifest';
import { newId } from '@/notebook/core/model';

const STORAGE_KEY = 'qu-student:notebooks:backup:v1';
/** Where a save that could not be read is kept, so it is never lost by the next write. */
const UNREADABLE_KEY = 'qu-student:notebooks:backup:v1:unreadable';

let state: BackupLocalState | null = null;
let loading: Promise<BackupLocalState | null> | null = null;
let chain: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function write(): Promise<void> {
  const snapshot = state;
  if (!snapshot) return chain;
  chain = chain
    .then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)))
    .catch(() => {
      // The next update writes again; the in-memory state stays the truth meanwhile.
    });
  return chain;
}

async function readOnce(): Promise<BackupLocalState | null> {
  for (let attempt = 0; ; attempt++) {
    let json: string | null;
    try {
      json = await AsyncStorage.getItem(STORAGE_KEY);
    } catch {
      if (attempt < 3) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return null;
    }
    let read: BackupLocalState | null = null;
    if (json) {
      try {
        read = readBackupLocalState(JSON.parse(json));
      } catch {
        read = null;
      }
      // Unreadable save: keep a copy aside before the next write replaces it.
      if (!read) await AsyncStorage.setItem(UNREADABLE_KEY, json).catch(() => {});
    }
    state = read ?? defaultLocalState(newId());
    if (!read) await write();
    return state;
  }
}

/** The state, read once (later calls return it at once). null when AsyncStorage cannot be read. */
export function loadBackupState(): Promise<BackupLocalState | null> {
  if (state) return Promise.resolve(state);
  if (!loading) {
    loading = readOnce().finally(() => {
      loading = null;
    });
  }
  return loading;
}

/** The state when it was read, else null. */
export function getBackupState(): BackupLocalState | null {
  return state;
}

/**
 * Replaces the state with fn(latest) and writes it. Does nothing before the state was read (so a
 * failed read is never overwritten). Resolves when the write finished (or failed).
 */
export function updateBackupState(fn: (s: BackupLocalState) => BackupLocalState): Promise<void> {
  if (!state) return chain;
  const next = fn(state);
  if (next === state) return chain;
  state = next;
  return write();
}
