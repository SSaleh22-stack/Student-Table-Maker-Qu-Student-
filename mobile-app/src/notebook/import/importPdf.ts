/**
 * PDF import (NB-30, NB-34, NB-35, NB-36): one PDF into a new notebook or into an open one.
 *
 * importPdfFile(path, { name, target, askPassword, confirmLowStorage?, onProgress?, size? }):
 *  1. Free space: when store.isLowStorage(size).low, confirmLowStorage(freeBytes) shows
 *     LowStorageWarning (kind 'import'); 'متابعة' goes on, 'إلغاء' stops ('low-storage').
 *  2. Stream-copies the file into a staging job (NB-34: the notebook never depends on the original).
 *  3. importStagedPdf: checks the header, pdfEngine.inspect, asks for the password ONCE (again
 *     only after a wrong one), saves a decrypted copy (native saveDecrypted, or the @cantoo/pdf-lib
 *     fallback on 'unsupported' or 'renderer-crashed'; ruling (b): the asset is stored without its password, inside the
 *     app only), reads page 1's size, and creates every page: page 1 with its size, placeholders
 *     for the rest. A new notebook comes from store.createFromPages with the pending record; an open
 *     notebook gets addAsset + insertPages (one undo step) + the pending record. The background job
 *     (jobs.ts) then resolves the remaining pages while the student writes; when the insert is
 *     undone, the job finds none of its pages left and stops (its pending record is dropped).
 *
 * Results never throw: { ok: true, notebookId, pages } or { ok: false, reason } with reason
 * 'cancelled' | 'low-storage' | 'not-supported' | a PdfErrorCode ('not-pdf', 'damaged', …).
 * importFailureText(reason) gives the student-facing text.
 */
import { joinPath } from '@/notebook/core/fs/adapter';
import { toPdfError, type PdfErrorCode, type PdfHandle, type PdfPageSize } from '@/notebook/core/contracts/pdf';
import type { AskPassword, ImportFailure, ImportResult, ImportTarget } from '@/notebook/core/contracts/importing';
import { FALLBACK_PAGE_SIZE, newPdfPending, pagePlaceholderId } from '@/notebook/core/importing/plan';
import { SNIFF_BYTES, isPdfHead, titleFromName } from '@/notebook/core/importing/sniff';
import { DEFAULT_PAPER, newId, type Page, type PaperSpec } from '@/notebook/core/model';
import { notebookSupported } from '@/notebook/flags';
import { pdfEngine } from '@/notebook/pdf/engine';
import { nbFs } from '@/notebook/store/deps';
import { getNotebooksStore, type NotebooksStore } from '@/notebook/store/hooks';
import { tr } from '@/lib/i18n';

import { decryptFallback } from './decryptFallback';
import { startPdfJob } from './jobs';

/** What an import step is doing, for ImportProgress. */
export type ImportProgressInfo =
  | { phase: 'copying'; bytes: number; total?: number }
  | { phase: 'opening' }
  | { phase: 'pages'; done: number; total: number };

/** The UI an import needs. Callers get one from useImportUi() (ImportProgress.tsx). */
export interface ImportUi {
  askPassword: AskPassword;
  /** Low free space: true to go on ('متابعة'). Without it the import goes on. */
  confirmLowStorage?: (freeBytes: number) => Promise<boolean>;
  onProgress?: (p: ImportProgressInfo) => void;
  /**
   * The password step is over (the password worked, the student cancelled, or the import stopped).
   * The prompt stays open while a typed password is checked, so a wrong one updates it in place
   * instead of closing and presenting a new modal; this closes it.
   */
  passwordDone?: () => void;
}

export interface ImportPdfOptions extends Partial<Omit<ImportUi, 'askPassword'>> {
  name: string;
  target: ImportTarget;
  askPassword: AskPassword;
  /** The source size when known (skips a size read; used for the free-space check). */
  size?: number;
}

const fail = (reason: ImportFailure): ImportResult => ({ ok: false, reason });

/** The store, or null when the notebook is not available (web, or the provider not mounted yet). */
export function importStore(): NotebooksStore | null {
  return notebookSupported ? getNotebooksStore() : null;
}

/** The free-space check before a copy of `bytes` (NB-36). false: the student stopped. */
export async function checkFreeSpace(store: NotebooksStore, bytes: number, confirm?: (free: number) => Promise<boolean>): Promise<boolean> {
  const low = store.isLowStorage(bytes);
  if (!low.low || !confirm) return true;
  try {
    return await confirm(low.freeBytes);
  } catch {
    return false;
  }
}

async function sizeOrZero(path: string): Promise<number> {
  try {
    return await nbFs.size(path);
  } catch {
    return 0;
  }
}

/** The import's title: the file name without its extension, else 'مذكرة'. */
export function pdfTitle(name: string): string {
  return titleFromName(name) || tr('مذكرة', 'Notebook');
}

/** Copies `path` (file:// or content://) into `dest` with copy progress. */
export async function stageCopy(path: string, dest: string, total: number | undefined, onProgress?: (p: ImportProgressInfo) => void): Promise<void> {
  onProgress?.({ phase: 'copying', bytes: 0, total });
  let last = 0;
  await nbFs.copy(path, dest, (n) => {
    // A progress event per ~1 MiB is plenty.
    if (n - last >= 1024 * 1024 || (total !== undefined && n >= total)) {
      last = n;
      onProgress?.({ phase: 'copying', bytes: n, total });
    }
  });
}

/** importPdfFile: free-space check, stream copy into staging, then importStagedPdf. */
export async function importPdfFile(path: string, o: ImportPdfOptions): Promise<ImportResult> {
  const store = importStore();
  if (!store) return fail('not-supported');
  if (!pdfEngine.available) return fail('no-native');
  const size = o.size ?? (await sizeOrZero(path));
  if (!(await checkFreeSpace(store, size, o.confirmLowStorage))) return fail('low-storage');
  let job: { id: string; dir: string };
  try {
    job = await store.stagingJob();
  } catch {
    return fail('io');
  }
  try {
    const staged = joinPath(job.dir, 'source.pdf');
    try {
      await stageCopy(path, staged, size || undefined, o.onProgress);
    } catch {
      return fail('io');
    }
    return await importStagedPdf(staged, job.dir, o);
  } finally {
    await store.endStagingJob(job.id).catch(() => {});
  }
}

function pageOf(id: string, size: { w: number; h: number }, fileId: string, pageIndex: number): Page {
  return { id, size: { w: size.w, h: size.h }, background: { kind: 'pdf', fileId, pageIndex, rotation: 0 }, items: [] };
}

/**
 * The import of a PDF that is already in a staging job (`workDir` is that job's folder; the
 * decrypted copy is written there). The staged file is MOVED into the notebook on success.
 */
export async function importStagedPdf(staged: string, workDir: string, o: ImportPdfOptions): Promise<ImportResult> {
  const store = importStore();
  if (!store) return fail('not-supported');
  if (!pdfEngine.available) return fail('no-native');
  o.onProgress?.({ phase: 'opening' });

  let head: Uint8Array;
  try {
    head = await nbFs.readBytes(staged, 0, SNIFF_BYTES);
  } catch {
    return fail('io');
  }
  if (!isPdfHead(head)) return fail('not-pdf');

  let info: { pageCount: number; encrypted: boolean; needsPassword: boolean };
  try {
    info = await pdfEngine.inspect(staged);
  } catch (e) {
    return fail(toPdfError(e, 'damaged').code);
  }

  let src = staged;
  if (info.needsPassword) {
    const decrypted = joinPath(workDir, 'decrypted.pdf');
    let wrong = false;
    try {
      for (;;) {
        let pw: string | null;
        try {
          pw = await o.askPassword({ name: o.name, wrong });
        } catch {
          pw = null;
        }
        if (pw === null) return fail('cancelled');
        let code: PdfErrorCode | null = null;
        try {
          await pdfEngine.saveDecrypted(staged, pw, decrypted);
        } catch (e) {
          code = toPdfError(e).code;
          if (code === 'unsupported' || code === 'renderer-crashed') {
            // PDFKit / PDFium could not write the file without security, or PDFium died writing it
            // (Android ':pdf' crashed or ran out of memory in FPDF_SaveAsCopy on a malformed or very
            // large file; the engine restarts it for the next call): decrypt it in JS instead. A
            // fallback that cannot read the file either ends as 'damaged' / 'unsupported'.
            try {
              await decryptFallback(staged, pw, decrypted);
              code = null;
            } catch (e2) {
              code = toPdfError(e2, 'unsupported').code;
            }
          }
        }
        if (code === 'wrong-password' || code === 'password-required') {
          wrong = true;
          continue;
        }
        if (code) return fail(code);
        break;
      }
    } finally {
      try {
        o.passwordDone?.();
      } catch {
        // UI only.
      }
    }
    src = decrypted;
    try {
      info = await pdfEngine.inspect(src);
    } catch (e) {
      return fail(toPdfError(e, 'damaged').code);
    }
    if (info.needsPassword) return fail('unsupported');
  }
  if (info.pageCount <= 0) return fail('damaged');

  // Page 1's size; the job reads the rest (and probes every page, page 1 included).
  let first: PdfPageSize = { w: FALLBACK_PAGE_SIZE.w, h: FALLBACK_PAGE_SIZE.h, rotation: 0 };
  let handle: PdfHandle;
  try {
    handle = await pdfEngine.open(src);
  } catch (e) {
    const code = toPdfError(e, 'damaged').code;
    return fail(code === 'password-required' ? 'unsupported' : code);
  }
  try {
    const sizes = await handle.pageSizes(0, 1);
    if (sizes[0] && sizes[0].w > 0 && sizes[0].h > 0) first = sizes[0];
  } catch {
    // Not fatal: page 1 keeps A4 until the job reads its size.
  } finally {
    await handle.close().catch(() => {});
  }

  const total = info.pageCount;
  const fileId = newId();
  const jobId = newId();
  const pages: Page[] = [];
  for (let i = 0; i < total; i++) pages.push(pageOf(pagePlaceholderId(jobId, i), first, fileId, i));
  o.onProgress?.({ phase: 'pages', done: 1, total });

  const target = o.target;
  if ('location' in target) {
    const pending = newPdfPending({ jobId, fileId, total, insertAt: 0 });
    let id: string;
    try {
      const defaults: PaperSpec = { ...(store.settings.defaultPaper ?? DEFAULT_PAPER) };
      id = await store.createFromPages({
        title: pdfTitle(o.name),
        location: target.location,
        pages,
        assets: [{ srcPath: src, kind: 'pdf', ext: 'pdf', id: fileId, name: o.name, pageCount: total, move: true }],
        origin: { kind: 'pdf', name: o.name },
        defaults,
        pending,
      });
    } catch {
      return fail('io');
    }
    store.setImporting(id, { done: 0, total });
    // The job takes its own session reference; this one only opens the notebook for it.
    try {
      const s = await store.openSession(id);
      try {
        await startPdfJob(s, s.notebook.pending ?? pending);
      } finally {
        store.releaseSession(id);
      }
    } catch {
      // The job resumes at the next boot (the index entry says it is importing).
    }
    return { ok: true, notebookId: id, pages: total };
  }

  const s = target.session;
  if (s.readOnly) return fail('unsupported');
  const at = Math.max(0, Math.min(s.notebook.pageIds.length, Math.floor(target.at)));
  try {
    await s.addAsset(src, 'pdf', 'pdf', { move: true, name: o.name, pageCount: total, id: fileId });
  } catch {
    return fail('io');
  }
  // ONE undo step ('إدراج PDF', P25). Undoing it removes the job's pages: the job notices that none
  // of its remaining pages are in the notebook and drops its pending record (jobs.ts, abandoned).
  s.insertPages(at, pages, { history: true });
  try {
    await startPdfJob(s, newPdfPending({ jobId, fileId, total, insertAt: at }));
  } catch {
    // Saved with the next autosave; the pages stay as placeholders until a resume.
  }
  return { ok: true, notebookId: s.id, pages: total };
}

/** The student-facing text for a failed import (null for a cancel, which needs none). */
export function importFailureText(reason: ImportFailure, kind: 'pdf' | 'qunote' | 'image' = 'pdf'): string | null {
  switch (reason) {
    case 'cancelled':
      return null;
    case 'not-pdf':
      return kind === 'image'
        ? tr('تعذّر فتح الصورة', 'The image could not be opened')
        : tr('هذا الملف ليس PDF صالحاً', 'This file is not a valid PDF');
    case 'damaged':
    case 'unsupported':
      return tr('تعذّر فتح الملف لأنه تالف', 'The file could not be opened because it is damaged');
    case 'low-storage':
      return tr('لا توجد مساحة كافية على الجهاز', 'There is not enough space on the device');
    case 'no-native':
    case 'not-supported':
      return tr('الاستيراد غير متاح في هذا الإصدار من التطبيق', 'Importing is not available in this version of the app');
    case 'password-required':
    case 'wrong-password':
      return tr('هذا الملف محمي بكلمة مرور', 'This file is password protected');
    case 'io':
    case 'renderer-crashed':
    default:
      return tr('تعذّر نسخ الملف، حاول مرة أخرى', 'The file could not be copied, try again');
  }
}

/** The text for a .qunote that cannot be imported. */
export function qunoteFailureText(code: string): string {
  switch (code) {
    case 'newer-version':
      return tr('أُنشئ هذا الملف بإصدار أحدث من التطبيق', 'This file was made with a newer version of the app');
    case 'no-space':
      return tr('لا توجد مساحة كافية على الجهاز', 'There is not enough space on the device');
    case 'not-qunote':
    case 'damaged':
    default:
      return tr('تعذّر فتح الملف لأنه تالف', 'The file could not be opened because it is damaged');
  }
}
