/**
 * The background PDF import job (NB-36) as a pure, tested state machine (P17). The app glue
 * (src/notebook/import/jobs.ts) gives it a port over the PDF engine and the notebook session.
 *
 * Model. An import creates every page up front: page 1 with its real size and one placeholder per
 * remaining PDF page (a 'pdf' background with the right pageIndex and page 1's size). Page ids are
 * derived from the job id (pagePlaceholderId), so the job finds a page by its PDF index without
 * loading any page, and the student may reorder, delete or write on pages meanwhile.
 * PendingImport (notebook.json, no history) records where the job is:
 *   nextPage  the first PDF page not resolved yet (sizes known and probed)
 *   total     the PDF's page count
 *   probing   a page index < total: the page was being probed (renderer journal on disk);
 *             total + k: the size batch starting at page k was being read
 *   damagedPages  pages known to break the renderer: never probed again, marked damaged
 *
 * The loop, per batch of SIZE_BATCH pages:
 *   1. durable save probing = total + from, then pageSizes(from, count)
 *   2. for each page: durable save probing = i, probe(i), apply size + damaged flag (history:false),
 *      then nextPage = i + 1 (saved without waiting)
 * A probe that rejects 'renderer-crashed' (Android ':pdf' died), 'damaged' or 'unsupported' marks the
 * page damaged and the job goes on. Any other failure ('io', 'no-native') stops the job and keeps
 * the pending record for the next resume.
 *
 * Resume (planResume) after the app died:
 *   - probing < total: that page killed the renderer (iOS, where PDFKit runs in the app). It joins
 *     damagedPages, so it is marked damaged without being probed again.
 *   - probing >= total: the size batch at probing - total killed the app. That batch is read again in
 *     careful mode: one page at a time, each under its own probing record, so the next crash (if
 *     any) names the exact page. Nothing innocent is marked damaged and no crash repeats forever.
 *   - a renderer crash journal entry for this PDF (pdfEngine.consumeCrashJournal) marks that page
 *     damaged too: right away when it is already resolved, else when the loop reaches it.
 *
 * createJobRegistry makes resume idempotent: a second run for the same key while one is running
 * gets the same promise.
 */
import type { Id, PendingImport } from '../model/index.ts';

/** Pages whose sizes are read in one native call. */
export const SIZE_BATCH = 20;

/** A4 portrait in points: the size of a page whose size could not be read. */
export const FALLBACK_PAGE_SIZE: Readonly<{ w: number; h: number }> = { w: 595.28, h: 841.89 };

export interface JobPageSize {
  w: number;
  h: number;
  rotation: 0 | 90 | 180 | 270;
}

/** The id of the page that shows PDF page `pageIndex` of import job `jobId` (safe for file names). */
export function pagePlaceholderId(jobId: Id, pageIndex: number): Id {
  return `${jobId}_${Math.max(0, Math.floor(pageIndex))}`;
}

/** A new pending record: nothing resolved yet. */
export function newPdfPending(o: { jobId: Id; fileId: Id; total: number; insertAt: number; firstPageIndex?: number }): PendingImport {
  const total = Math.max(0, Math.floor(o.total));
  const first = Math.min(total, Math.max(0, Math.floor(o.firstPageIndex ?? 0)));
  return { jobId: o.jobId, fileId: o.fileId, kind: 'pdf-pages', firstPageIndex: first, insertAt: Math.max(0, Math.floor(o.insertAt)), nextPage: first, total };
}

/** What a failed probe or size read means for the job. */
export type ProbeOutcome = 'ok' | 'damaged' | 'fatal';

/** The PdfError code (or any error) of a failed probe / size read as an outcome. */
export function failureOutcome(e: unknown): Exclude<ProbeOutcome, 'ok'> {
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  return code === 'renderer-crashed' || code === 'damaged' || code === 'unsupported' || code === 'not-pdf' ? 'damaged' : 'fatal';
}

/** A size that can be trusted, else null. */
export function cleanSize(s: unknown): JobPageSize | null {
  if (!s || typeof s !== 'object') return null;
  const { w, h, rotation } = s as { w?: unknown; h?: unknown; rotation?: unknown };
  if (typeof w !== 'number' || typeof h !== 'number' || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const r = rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0;
  return { w, h, rotation: r };
}

function withoutProbing(p: PendingImport): PendingImport {
  const out: PendingImport = { ...p };
  delete out.probing;
  return out;
}

function addDamaged(p: PendingImport, page: number): PendingImport {
  const list = p.damagedPages ?? [];
  if (list.includes(page)) return p;
  return { ...p, damagedPages: [...list, page].sort((a, b) => a - b) };
}

export interface ResumePlan {
  /** The record to continue from (probing cleared). */
  pending: PendingImport;
  /** Already resolved pages to mark damaged now (from the crash journal). */
  markNow: number[];
  /** A size batch to read one page at a time: [from, to). */
  careful: { from: number; to: number } | null;
}

/**
 * Where to go on after a restart. crashPage: the page of a crash-journal entry for THIS PDF, or null.
 */
export function planResume(p: PendingImport, crashPage: number | null = null): ResumePlan {
  let pending = withoutProbing(p);
  const markNow: number[] = [];
  let careful: ResumePlan['careful'] = null;
  const total = p.total;
  if (p.probing !== undefined) {
    if (p.probing < total) {
      pending = addDamaged(pending, p.probing);
    } else {
      const from = Math.max(pending.nextPage, p.probing - total);
      if (from < total) careful = { from, to: Math.min(total, from + SIZE_BATCH) };
    }
  }
  if (crashPage !== null && Number.isInteger(crashPage) && crashPage >= 0 && crashPage < total) {
    if (crashPage < pending.nextPage) {
      if (!(p.damagedPages ?? []).includes(crashPage)) markNow.push(crashPage);
      pending = addDamaged(pending, crashPage);
    } else {
      pending = addDamaged(pending, crashPage);
    }
  }
  return { pending, markNow, careful };
}

/** The port the job runs against (jobs.ts on device, fakes in tests). */
export interface PdfJobPort {
  /** Sizes of pages [from, from + count). Rejects like the engine (PdfError codes). */
  pageSizes(from: number, count: number): Promise<unknown[]>;
  /** Renders the page at a tiny size; rejects when it is broken. */
  probe(page: number): Promise<void>;
  /**
   * Stores the record. durable: written to disk before this resolves (around native calls that
   * may kill the app); otherwise the regular autosave is enough. undefined: the job is finished.
   */
  savePending(p: PendingImport | undefined, durable: boolean): Promise<void>;
  /** Shows PDF page `page` with its size (undefined: keep the current size) and damaged flag. */
  applyPage(page: number, r: { size?: JobPageSize; damaged: boolean }): void;
  /** Pages resolved so far out of the job's pages. */
  progress(done: number, total: number): void;
  /** The job's first page (the notebook's page 1 for a new notebook) has its size and probe. */
  firstPageResolved?(): void;
  /** true: stop now (the notebook was closed for good, trashed or purged). */
  cancelled(): boolean;
}

export interface JobResult {
  state: 'done' | 'failed' | 'cancelled';
  /** The record left behind (undefined when done). */
  pending: PendingImport | undefined;
  /** Every page marked damaged by this run or before it. */
  damagedPages: number[];
  /** The error that stopped a failed job. */
  error?: unknown;
}

/** Runs (or resumes) the job until every page is resolved, a fatal error, or cancellation. */
export async function runPdfJob(port: PdfJobPort, start: PendingImport, o: { crashPage?: number | null } = {}): Promise<JobResult> {
  const plan = planResume(start, o.crashPage ?? null);
  let p = plan.pending;
  const total = p.total;
  const first = Math.min(p.firstPageIndex, total);
  const count = total - first;
  let firstDone = p.nextPage > first;
  const result = (state: JobResult['state'], error?: unknown): JobResult => {
    const r: JobResult = { state, pending: state === 'done' ? undefined : p, damagedPages: [...(p.damagedPages ?? [])] };
    if (error !== undefined) r.error = error;
    return r;
  };

  for (const page of plan.markNow) port.applyPage(page, { damaged: true });
  if (start.probing !== undefined || p.damagedPages !== start.damagedPages) await port.savePending(p, true);
  port.progress(Math.max(0, p.nextPage - first), count);

  let careful = plan.careful;

  /** Probes page i (unless it is known to be bad), shows it and moves nextPage past it. Throws on a fatal error. */
  const resolve = async (i: number, size: JobPageSize | undefined, sizeBad: boolean, journaled: boolean): Promise<void> => {
    let damaged = sizeBad || (p.damagedPages ?? []).includes(i);
    if (!damaged) {
      if (!journaled) await port.savePending({ ...p, probing: i }, true);
      try {
        await port.probe(i);
      } catch (e) {
        if (failureOutcome(e) === 'fatal') {
          await port.savePending(p, true);
          throw e;
        }
        damaged = true;
      }
    }
    if (damaged) p = addDamaged(p, i);
    port.applyPage(i, size ? { size, damaged } : { damaged });
    p = withoutProbing({ ...p, nextPage: i + 1 });
    await port.savePending(p, false);
    port.progress(p.nextPage - first, count);
    if (!firstDone && i === first) {
      firstDone = true;
      port.firstPageResolved?.();
    }
  };

  try {
    if (p.nextPage < first) p = { ...p, nextPage: first };
    while (p.nextPage < total) {
      if (port.cancelled()) return result('cancelled');
      const from = p.nextPage;
      if ((p.damagedPages ?? []).includes(from)) {
        // A page known to be bad at the head of the work is resolved without touching the engine:
        // its size read may be what killed the app last time (careful mode journals both).
        await resolve(from, undefined, true, true);
        continue;
      }
      if (careful && from >= careful.from && from < careful.to) {
        // One page at a time, each under its own probing record.
        await port.savePending({ ...p, probing: from }, true);
        let size: JobPageSize | undefined;
        let bad = false;
        try {
          const got = await port.pageSizes(from, 1);
          size = cleanSize(got[0]) ?? undefined;
        } catch (e) {
          if (failureOutcome(e) === 'fatal') {
            await port.savePending(p, true);
            return result('failed', e);
          }
          bad = true;
        }
        await resolve(from, size, bad, true);
        if (p.nextPage >= careful.to) careful = null;
        continue;
      }

      const n = Math.min(SIZE_BATCH, total - from);
      await port.savePending({ ...p, probing: total + from }, true);
      let sizes: (JobPageSize | null)[];
      try {
        const got = await port.pageSizes(from, n);
        sizes = Array.from({ length: n }, (_, k) => cleanSize(got[k]));
      } catch (e) {
        if (failureOutcome(e) === 'fatal') {
          await port.savePending(p, true);
          return result('failed', e);
        }
        // The batch failed as a whole: read it again one page at a time.
        careful = { from, to: from + n };
        continue;
      }
      for (let k = 0; k < n; k++) {
        if (port.cancelled()) {
          await port.savePending(p, true);
          return result('cancelled');
        }
        // A size the engine could not give keeps the placeholder's size.
        await resolve(from + k, sizes[k] ?? undefined, false, false);
      }
    }
  } catch (e) {
    return result('failed', e);
  }

  await port.savePending(undefined, true);
  return result('done');
}

/** A registry of running jobs keyed by `${notebookId}:${jobId}`: one run per key at a time. */
export interface JobRegistry<T> {
  /** The running promise for key, or a new run of start(). The entry goes when the run settles. */
  run(key: string, start: () => Promise<T>): Promise<T>;
  running(key: string): boolean;
  keys(): string[];
}

export function jobKey(notebookId: Id, jobId: Id): string {
  return `${notebookId}:${jobId}`;
}

export function createJobRegistry<T>(): JobRegistry<T> {
  const live = new Map<string, Promise<T>>();
  return {
    run(key, start) {
      const cur = live.get(key);
      if (cur) return cur;
      let p: Promise<T>;
      try {
        p = Promise.resolve(start());
      } catch (e) {
        p = Promise.reject(e);
      }
      const tracked = p.finally(() => {
        if (live.get(key) === tracked) live.delete(key);
      });
      live.set(key, tracked);
      return tracked;
    },
    running: (key) => live.has(key),
    keys: () => [...live.keys()],
  };
}

// ===== image pages

/**
 * The page size for an image page: the image's aspect ratio with its long side on the long side of
 * A4 (841.89 pt), so a photo of a sheet fills a page like a scanned A4 sheet.
 */
export function imagePageSize(widthPx: number, heightPx: number): { w: number; h: number } {
  const LONG = 841.89;
  const w = Number.isFinite(widthPx) && widthPx > 0 ? widthPx : 0;
  const h = Number.isFinite(heightPx) && heightPx > 0 ? heightPx : 0;
  if (!w || !h) return { w: FALLBACK_PAGE_SIZE.w, h: FALLBACK_PAGE_SIZE.h };
  const round = (v: number) => Math.round(v * 100) / 100;
  // Very thin images (a receipt strip) keep at least 1:8, so the page stays usable.
  const ratio = Math.min(8, Math.max(1 / 8, w / h));
  return ratio >= 1 ? { w: LONG, h: round(LONG / ratio) } : { w: round(LONG * ratio), h: LONG };
}

/** Progress percent shown next to 'جارٍ الاستيراد… d من n صفحة' (0..100, whole). */
export function progressPercent(done: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const d = Number.isFinite(done) ? Math.min(total, Math.max(0, done)) : 0;
  return Math.floor((d / total) * 100);
}
