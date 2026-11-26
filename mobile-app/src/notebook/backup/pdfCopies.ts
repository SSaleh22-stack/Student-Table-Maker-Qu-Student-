/**
 * The readable PDF copies (core/backup/pdfCopies.ts has the layout and the plan), run by the backup
 * service at the end of every successful backup run, with the same provider and sign-in:
 *
 *   QU Student/PDF/<course or folder>/<notebook>.pdf   (Google Drive, iCloud Drive)
 *   Apps/QU Student/PDF/…                              (OneDrive)
 *
 * Only Backups/… is ever read back by a restore; these files are for opening the notes anywhere.
 *
 * RULES
 * - A notebook gets a new PDF when its content changed (contentRev), it was renamed or moved, or its
 *   PDF is missing from the folder (deleted by hand). A notebook in Recently deleted, still being
 *   imported or saved by a newer app version gets none, and the PDF of one that left is removed.
 * - A notebook open in the editor is skipped this run (exporting it would compete with the writing);
 *   the next run after it closes makes its PDF.
 * - Failures never fail the backup: a notebook that cannot be exported or uploaded is tried again on
 *   the next run. Running out of space or a network error ends this pass. An abort stops it at once.
 */
import { tr } from '@/lib/i18n';
import { isAbortError } from '@/notebook/core/backup/drive';
import { planPdfCopies, type PdfCopySource } from '@/notebook/core/backup/pdfCopies';
import type { AbortSignalLike, BackupProviderKind } from '@/notebook/core/contracts/backup';
import { entryLocation } from '@/notebook/core/library/derive';
import type { Id, IndexEntry } from '@/notebook/core/model';
import { discardExportFile, exportPdf, isExportError } from '@/notebook/export/pdfExport';
import { expoFs } from '@/notebook/fs/expoFs';
import { getNotebooksStore, type NotebooksStore } from '@/notebook/store/hooks';
import { notebookRegistry } from '@/notebook/store/sessions';

import { getBackupState, updateBackupState } from './backupStore';
import { createDriveProvider } from './driveProvider';
import { createIcloudProvider } from './icloudProvider';
import { createOneDriveProvider } from './oneDriveProvider';
import type { BackupProvider } from './service';

export const PDF_FOLDER = 'PDF';

let instance: BackupProvider | null = null;
let instanceKind: BackupProviderKind | null = null;

/** A provider rooted at the PDF folder (it shares the backup's sign-in). */
function pdfProvider(kind: BackupProviderKind): BackupProvider {
  if (!instance || instanceKind !== kind) {
    instance =
      kind === 'gdrive'
        ? createDriveProvider({ folder: PDF_FOLDER })
        : kind === 'onedrive'
          ? createOneDriveProvider({ folder: PDF_FOLDER })
          : createIcloudProvider({ folder: PDF_FOLDER });
    instanceKind = kind;
  }
  return instance;
}

/** Forget what was uploaded (another account or place: everything is made again there). */
export async function resetPdfCopies(): Promise<void> {
  instance?.reset?.();
  await updateBackupState((s) => {
    if (!s.pdfUploaded) return s;
    const next = { ...s };
    delete next.pdfUploaded;
    return next;
  });
}

/** The sub-folder a notebook's PDF goes in ('' for notebooks without a folder). */
function folderName(e: IndexEntry, store: NotebooksStore): string {
  const loc = entryLocation(e, store.folders);
  if (loc.kind === 'course') {
    const c = store.courseFolders.find((x) => x.code === loc.code);
    return c && c.name && c.name !== c.code ? `${c.code} — ${c.name}` : loc.code;
  }
  if (loc.kind === 'folder') return store.folders.find((f) => f.id === loc.id)?.name ?? '';
  return '';
}

const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const nameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);

function isOpenInEditor(id: Id): boolean {
  try {
    return notebookRegistry().get(id) !== null;
  } catch {
    return false;
  }
}

/** Errors that end the pass (the next run tries again) rather than skip one notebook. */
function endsPass(e: unknown): boolean {
  if (isExportError(e)) return e.code === 'no-space';
  const code = (e as { code?: unknown } | null)?.code;
  return code === 'network' || code === 'signed-out' || code === 'revoked' || code === 'quota' || code === 'icloud-off';
}

function devLog(what: string, e: unknown): void {
  if (__DEV__) console.warn(`[backup pdf] ${what}`, e);
}

/** Makes the PDF folder match the notebooks. Called by the backup run after the data is backed up. */
export async function syncPdfCopies(kind: BackupProviderKind, signal: AbortSignalLike): Promise<void> {
  const store = getNotebooksStore();
  const state = getBackupState();
  if (!store || !store.loaded || !state) return;
  const p = pdfProvider(kind);

  const live = store.entries.filter((e) => !e.deletedAt && !e.importing && !e.readOnly);
  const sources: PdfCopySource[] = live.map((e) => ({
    id: e.id,
    title: e.title,
    folder: folderName(e, store),
    rev: e.contentRev,
    createdAt: e.createdAt,
  }));
  const uploaded = state.pdfUploaded ?? {};
  const plan = planPdfCopies(sources, uploaded, tr('مذكرة بدون عنوان', 'Untitled notebook'));
  const pending = new Map(plan.upload.map((u) => [u.id, u]));

  try {
    await p.ensureRoot();

    // PDFs this device uploaded that are no longer in the folder (removed by hand): made again.
    const dirs = new Set<string>();
    for (const s of sources) if (!pending.has(s.id) && uploaded[s.id]) dirs.add(parentOf(plan.wanted[s.id]));
    for (const dir of dirs) {
      if (signal.aborted) return;
      const names = new Set((await p.list(dir)).filter((f) => !f.isDir).map((f) => f.name));
      for (const s of sources) {
        const path = plan.wanted[s.id];
        if (!pending.has(s.id) && parentOf(path) === dir && !names.has(nameOf(path))) {
          pending.set(s.id, { id: s.id, rev: s.rev, path });
        }
      }
    }

    // Files no notebook uses now (deleted, renamed or moved notebooks). Missing is not an error.
    for (const path of plan.remove) {
      if (signal.aborted) return;
      await p.remove(path);
      const gone = path.toLowerCase();
      await updateBackupState((st) => {
        const map = { ...(st.pdfUploaded ?? {}) };
        for (const id of Object.keys(map)) if (map[id].path.toLowerCase() === gone) delete map[id];
        return { ...st, pdfUploaded: map };
      });
    }
    // Notebooks that left drop out of the record (their file may now be another notebook's name,
    // which that notebook's upload replaces).
    const keep = new Set(sources.map((s) => s.id));
    await updateBackupState((st) => {
      const map = st.pdfUploaded ?? {};
      if (Object.keys(map).every((id) => keep.has(id))) return st;
      const next: typeof map = {};
      for (const id of Object.keys(map)) if (keep.has(id)) next[id] = map[id];
      return { ...st, pdfUploaded: next };
    });
  } catch (e) {
    if (isAbortError(e)) throw e;
    devLog('listing or removing failed', e);
    return;
  }

  for (const job of pending.values()) {
    if (signal.aborted) return;
    if (isOpenInEditor(job.id)) continue;
    let uri: string | null = null;
    let opened = false;
    try {
      const session = await store.openSession(job.id);
      opened = true;
      uri = await exportPdf(session, { range: 'all', currentIndex: 0, signal });
      store.releaseSession(job.id);
      opened = false;
      const bytes = await expoFs.size(uri);
      await p.upload(uri, job.path, { mime: 'application/pdf', bytes, signal });
      await updateBackupState((st) => ({ ...st, pdfUploaded: { ...(st.pdfUploaded ?? {}), [job.id]: { rev: job.rev, path: job.path } } }));
    } catch (e) {
      if (isAbortError(e) || (isExportError(e) && e.code === 'aborted')) throw e;
      // A notebook with no pages has nothing to put in a PDF (it is checked again next run, cheaply).
      if (isExportError(e) && e.code === 'empty') continue;
      devLog(`notebook ${job.id}`, e);
      if (endsPass(e)) return;
    } finally {
      if (opened) store.releaseSession(job.id);
      if (uri) discardExportFile(uri);
    }
  }
}
