/**
 * The iCloud Drive backup provider (iOS, NB-86), over the local icloud-drive module (P11).
 *
 * The container's Documents folder is what the Files app shows as "QU Student", so the backup tree
 * lives at Documents/Backups/{manifest.json, library.json, <nbId>/…}: every contract `rel` (relative
 * to QU Student/Backups) becomes 'Backups/<rel>'.
 *
 * - upload is a coordinated copy into the container (copyIn); iCloud uploads it later in the
 *   background. A full iCloud account shows up as an uploadError of kind 'quota' on the files, so
 *   problem() checks manifest.json (written last in every run) before the next run.
 * - download starts the download of an evicted file and waits for it (copyOut).
 * - Errors become DriveError (core/backup/drive.ts, a plain coded error despite its name) with a
 *   BackupError code: ERR_ICLOUD_QUOTA -> 'quota', ERR_ICLOUD_TIMEOUT -> 'network',
 *   ERR_ICLOUD_UNAVAILABLE -> 'icloud-off', anything else -> 'unknown' (ERR_ICLOUD_NOT_FOUND with
 *   status 404, as Drive reports a missing file).
 * - availability(): 'unavailable' in builds without the native module (Expo Go), 'icloud-off' when
 *   the student is signed out of iCloud or iCloud Drive is off (help: ICLOUD_HELP).
 */
import type { BackupError, RemoteFile } from '@/notebook/core/contracts/backup';
import { BackupAbortError, DriveError } from '@/notebook/core/backup/drive';
import { tr } from '@/lib/i18n';

import {
  copyIn,
  copyOut,
  ensureDir,
  iCloudDriveModulePresent,
  iCloudErrorCode,
  isAvailable,
  list,
  readText,
  remove,
  status,
  writeText,
} from '../../../modules/icloud-drive';
import type { BackupProvider } from './service';

const ROOT = 'Backups';
/** An evicted file may need a while to come down (a long recording on a slow connection). */
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** How to turn iCloud Drive on (NB-86). */
export function icloudHelp(): string {
  return tr('سجّل الدخول إلى iCloud وفعّل iCloud Drive من الإعدادات', 'Sign in to iCloud and turn on iCloud Drive in Settings');
}

const at = (rel: string): string => (rel ? `${ROOT}/${rel}` : ROOT);

function codeOf(e: unknown): BackupError {
  switch (iCloudErrorCode(e)) {
    case 'ERR_ICLOUD_QUOTA':
      return 'quota';
    case 'ERR_ICLOUD_TIMEOUT':
      return 'network';
    case 'ERR_ICLOUD_UNAVAILABLE':
      return 'icloud-off';
    default:
      return 'unknown';
  }
}

async function wrap<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DriveError) throw e;
    // A file iCloud does not have reads as 404, like Drive (restore turns a missing page into a blank one).
    const status = iCloudErrorCode(e) === 'ERR_ICLOUD_NOT_FOUND' ? 404 : 0;
    throw new DriveError(codeOf(e), `iCloud ${what}: ${e instanceof Error ? e.message : String(e)}`, status);
  }
}

export function createIcloudProvider(): BackupProvider {
  return {
    kind: 'icloud',

    async availability() {
      if (!iCloudDriveModulePresent) return 'unavailable';
      try {
        return (await isAvailable()) ? 'ok' : 'icloud-off';
      } catch {
        return 'icloud-off';
      }
    },

    ensureRoot: () => wrap('ensureRoot', () => ensureDir(ROOT)),

    readText: (rel) => wrap('read', () => readText(at(rel))),

    writeText: (rel, text) => wrap('write', () => writeText(at(rel), text)),

    async upload(localPath, rel, o) {
      if (o.signal?.aborted) throw new BackupAbortError();
      const n = await wrap('upload', () => copyIn(localPath, at(rel)));
      o.onProgress?.(n);
    },

    async download(rel, localPath, o) {
      const expected = o?.bytes ?? 0;
      const report = o?.onProgress;
      const n = await wrap('download', () =>
        copyOut(at(rel), localPath, {
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
          onProgress: report && expected > 0 ? (percent) => report(Math.floor((expected * Math.min(100, Math.max(0, percent))) / 100)) : undefined,
        }),
      );
      report?.(n);
    },

    async remove(rel) {
      await wrap('remove', () => remove(at(rel)));
    },

    async list(relDir) {
      const entries = await wrap('list', () => list(at(relDir)));
      return entries.map((e): RemoteFile => {
        const f: RemoteFile = { name: e.name, isDir: e.isDirectory, bytes: e.size ?? 0 };
        if (typeof e.modifiedAt === 'number' && Number.isFinite(e.modifiedAt)) f.modifiedAt = new Date(e.modifiedAt).toISOString();
        return f;
      });
    },

    async problem() {
      try {
        const st = await status(at('manifest.json'));
        if (st.uploadError?.kind === 'quota') return 'quota';
      } catch {
        // Status is advisory.
      }
      return null;
    },
  };
}
