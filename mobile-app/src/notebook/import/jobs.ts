/**
 * Background PDF import jobs (NB-36): the app side of core/importing/plan.ts.
 *
 * An import creates every page at once (page 1 with its size, placeholders after it) and leaves a
 * PendingImport in notebook.json. The job then reads page sizes in batches of 20, probes each page
 * under the probing journal, and shows it with setPageBackground(history: false). The student can
 * write on page 1 straight away; the library card shows store.setImporting progress.
 *
 * - resumePendingImport(session) is IDEMPOTENT: one run per `${notebookId}:${jobId}` (a module-level
 *   registry); a second call while it runs returns the same promise. The job holds its own session
 *   reference (store.openSession / releaseSession), so it keeps going after the editor closes.
 * - resumeAllPending() (boot, NotebookServices) resumes every notebook whose index entry says it is
 *   importing, one after another.
 * - A probe that rejects 'renderer-crashed' (Android ':pdf' died) marks that page damaged and the job
 *   goes on. On reopen, a probing record left on disk, or a pdfEngine.consumeCrashJournal() entry for
 *   this PDF (claimRenderCrash), marks that page damaged, so a page that kills PDFKit on iOS never
 *   locks the student out.
 * - When page 1 of the notebook resolves, store.requestThumb(id) asks for a new cover. This module
 *   never writes thumbs/ (the thumbnail worker, P23, is its only writer).
 * - Inserting a PDF into an open notebook is ONE undo step (importPdf.ts). When none of the job's
 *   remaining pages are in the notebook any more (the insert was undone, or the student deleted
 *   them), the job is abandoned: it stops, drops its pending record and the library progress, and
 *   the next queued PDF starts. Pages brought back by a redo afterwards keep the state they had
 *   (resolved pages their size, the rest page 1's size; they still show their PDF page).
 * - A notebook has one pending slot. A second PDF added while a job runs waits in memory and starts
 *   when the first finishes (its pages already exist as placeholders, so if the app is closed
 *   before, they keep page 1's size and are simply not probed).
 */
import { toPdfError, type PdfHandle } from '@/notebook/core/contracts/pdf';
import type { ImportJob } from '@/notebook/core/contracts/importing';
import { createJobRegistry, failureOutcome, jobKey, pagePlaceholderId, runPdfJob, type JobResult, type PdfJobPort } from '@/notebook/core/importing/plan';
import type { Id, PageBackground, PendingImport } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { notebookSupported } from '@/notebook/flags';
import { pdfEngine } from '@/notebook/pdf/engine';
import { crashMatchesPath, type RenderCrash } from '@/notebook/pdf/crashJournal';
import { getNotebooksStore, notebookRegistry, type NotebooksStore } from '@/notebook/store/hooks';
import { subscribeStore } from '@/notebook/store/library';
import { showToast } from '@/notebook/ui/toast';
import { tr } from '@/lib/i18n';

// ===== job list (subscribeJobs / getJobs)

const jobs = new Map<string, ImportJob>();
let jobsSnapshot: readonly ImportJob[] = [];
const jobListeners = new Set<() => void>();

function setJob(key: string, job: ImportJob): void {
  const prev = jobs.get(key);
  if (
    prev &&
    prev.done === job.done &&
    prev.total === job.total &&
    prev.state === job.state &&
    prev.damagedPages.length === job.damagedPages.length
  ) {
    return;
  }
  jobs.set(key, job);
  jobsSnapshot = [...jobs.values()];
  for (const cb of [...jobListeners]) {
    try {
      cb();
    } catch {
      // A listener failing never stops the others.
    }
  }
}

export function subscribeJobs(cb: () => void): () => void {
  jobListeners.add(cb);
  return () => {
    jobListeners.delete(cb);
  };
}

/** Cached: the same array until a job changes. */
export function getJobs(): readonly ImportJob[] {
  return jobsSnapshot;
}

/** The running (or last) job of a notebook, or null. */
export function jobOf(notebookId: Id): ImportJob | null {
  let found: ImportJob | null = null;
  for (const j of jobsSnapshot) if (j.notebookId === notebookId && (!found || j.state === 'running')) found = j;
  return found;
}

// ===== renderer crash journal (read once per app run, shared with NotebookServices)

let crashRead: Promise<void> | null = null;
let crashEntry: RenderCrash | null = null;

/**
 * The renderer crash journal entry of the last run (consumed from the native side once; later
 * calls see what is left of it). Null when there was none or this build has no renderer.
 */
export async function takeRenderCrash(): Promise<RenderCrash | null> {
  if (!crashRead) {
    crashRead = pdfEngine.available
      ? pdfEngine.consumeCrashJournal().then(
          (e) => {
            crashEntry = e;
          },
          () => {
            crashEntry = null;
          },
        )
      : Promise.resolve();
  }
  await crashRead;
  return crashEntry;
}

/** The crashed page when the journal entry is about the PDF at `path` (then it is used up), else null. */
export async function claimRenderCrash(path: string): Promise<number | null> {
  const e = await takeRenderCrash();
  if (!e || !crashMatchesPath(e, path)) return null;
  crashEntry = null;
  return e.page;
}

/**
 * Marks every page that shows PDF page `pageIndex` of asset `fileId` as damaged (history: false).
 * For a crash outside an import (the editor's renders, NotebookServices at boot). Loads the pages.
 */
export function markDamagedPdfPage(s: NotebookSession, fileId: Id, pageIndex: number): void {
  s.setPageBackground(
    s.notebook.pageIds,
    (pg) =>
      pg.background.kind === 'pdf' && pg.background.fileId === fileId && pg.background.pageIndex === pageIndex && !pg.background.damaged
        ? { ...pg.background, damaged: true }
        : null,
    undefined,
    { history: false },
  );
}

// ===== running jobs

const registry = createJobRegistry<void>();
/** PDFs added while the notebook's pending slot was busy, by notebook id. */
const queued = new Map<Id, PendingImport[]>();

function storeOrNull(): NotebooksStore | null {
  return notebookSupported ? getNotebooksStore() : null;
}

function jobState(id: Id, p: PendingImport, state: ImportJob['state'], damaged?: number[]): ImportJob {
  return {
    jobId: p.jobId,
    notebookId: id,
    done: Math.max(0, p.nextPage - p.firstPageIndex),
    total: Math.max(0, p.total - p.firstPageIndex),
    state,
    damagedPages: damaged ?? [...(p.damagedPages ?? [])],
  };
}

/** The first of the job's pages from `from` on that is in the notebook, or -1 when none is. */
function firstLiveJobPage(p: PendingImport, from: number, has: (pid: Id) => boolean): number {
  for (let i = Math.max(0, from, p.firstPageIndex); i < p.total; i++) if (has(pagePlaceholderId(p.jobId, i))) return i;
  return -1;
}

/** true when the job still has pages to resolve but none of them is in the notebook (insert undone). */
function jobAbandoned(s: NotebookSession, p: PendingImport): boolean {
  if (p.nextPage >= p.total) return false;
  const live = new Set(s.notebook.pageIds);
  return firstLiveJobPage(p, p.nextPage, (pid) => live.has(pid)) < 0;
}

/** This session object is still the notebook's open, writable session. */
function stillOwned(s: NotebookSession): boolean {
  try {
    return notebookRegistry().get(s.id) === s && !s.readOnly;
  } catch {
    return false;
  }
}

/** Ends an abandoned job: no pending record, no library progress. */
async function dropAbandoned(s: NotebookSession, store: NotebooksStore, p: PendingImport, key: string): Promise<void> {
  if (s.notebook.pending?.jobId === p.jobId) {
    s.setPending(undefined);
    await s.flushPendingNow();
  }
  store.setImporting(s.id, undefined);
  setJob(key, jobState(s.id, { ...p, nextPage: p.total }, 'done'));
}

type JobPort = PdfJobPort & {
  /** None of the job's remaining pages is in the notebook (see jobAbandoned). */
  abandoned(): boolean;
};

function makePort(s: NotebookSession, store: NotebooksStore, p: PendingImport, handle: PdfHandle, key: string): JobPort {
  const id = s.id;
  let liveFor: Id[] = [];
  let live = new Set<Id>();
  const hasPage = (pid: Id): boolean => {
    const ids = s.notebook.pageIds;
    if (ids !== liveFor) {
      liveFor = ids;
      live = new Set(ids);
    }
    return live.has(pid);
  };
  let damaged: number[] = [...(p.damagedPages ?? [])];
  let nextPage = p.nextPage;
  // A remaining page known to be in the notebook, for the pageIds it was found in (cancelled() runs
  // before every page, so a scan only happens when the page list changed or the job passed it).
  let anchorFor: Id[] | null = null;
  let anchor = -1;
  const abandoned = (): boolean => {
    if (nextPage >= p.total) return false;
    const ids = s.notebook.pageIds;
    if (ids === anchorFor && anchor >= nextPage) return false;
    anchor = firstLiveJobPage(p, nextPage, hasPage);
    anchorFor = ids;
    return anchor < 0;
  };
  return {
    pageSizes: (from, count) => handle.pageSizes(from, count),
    probe: (page) => handle.probe(page),
    async savePending(next, durable) {
      if (next) {
        damaged = [...(next.damagedPages ?? [])];
        nextPage = next.nextPage;
      }
      s.setPending(next);
      if (durable) await s.flushPendingNow();
    },
    applyPage(page, r) {
      const pid = pagePlaceholderId(p.jobId, page);
      if (!hasPage(pid)) return;
      s.setPageBackground(
        [pid],
        (pg): PageBackground | null => {
          const bg = pg.background;
          // The student gave this page another background meanwhile: leave it alone.
          if (bg.kind !== 'pdf' || bg.fileId !== p.fileId || bg.pageIndex !== page) return null;
          const next: PageBackground = { kind: 'pdf', fileId: p.fileId, pageIndex: page, rotation: bg.rotation };
          if (r.damaged) next.damaged = true;
          return next;
        },
        r.size ? { w: r.size.w, h: r.size.h } : undefined,
        { history: false },
      );
    },
    progress(done, total) {
      store.setImporting(id, { done, total });
      setJob(key, { jobId: p.jobId, notebookId: id, done, total, state: 'running', damagedPages: damaged });
    },
    firstPageResolved() {
      if (s.notebook.pageIds[0] === pagePlaceholderId(p.jobId, p.firstPageIndex)) store.requestThumb(id);
    },
    cancelled() {
      // Purged, restored over or closed for good: this session object is no longer the notebook's.
      // Or the insert was undone (or its pages deleted): nothing left to resolve.
      return !stillOwned(s) || abandoned();
    },
    abandoned,
  };
}

async function runJob(id: Id, jobId: Id, key: string): Promise<void> {
  const store = storeOrNull();
  if (!store) return;
  let s: NotebookSession;
  try {
    s = await store.openSession(id);
  } catch {
    return;
  }
  let handle: PdfHandle | null = null;
  let result: JobResult | null = null;
  let startNext = false;
  try {
    const p = s.notebook.pending;
    if (!p || p.jobId !== jobId || s.readOnly) return;
    if (!s.notebook.assets[p.fileId]) {
      // The PDF is gone (should not happen): nothing to import any more.
      s.setPending(undefined);
      await s.flushPendingNow();
      store.setImporting(id, undefined);
      return;
    }
    if (jobAbandoned(s, p)) {
      // The insert was undone before the job ran (or at a previous launch): nothing to import.
      await dropAbandoned(s, store, p, key);
      startNext = true;
      return;
    }
    const path = s.assetPath(p.fileId);
    const crashPage = await claimRenderCrash(path);
    setJob(key, jobState(id, p, 'running'));
    try {
      handle = await pdfEngine.open(path);
    } catch (e) {
      const err = toPdfError(e);
      setJob(key, jobState(id, p, 'failed'));
      if (failureOutcome(err) === 'damaged') {
        // The stored PDF no longer opens: show the remaining pages as damaged and finish.
        const left = new Set<Id>();
        for (let i = p.nextPage; i < p.total; i++) left.add(pagePlaceholderId(p.jobId, i));
        s.setPageBackground(
          s.notebook.pageIds.filter((pid) => left.has(pid)),
          (pg) => (pg.background.kind === 'pdf' && pg.background.fileId === p.fileId ? { ...pg.background, damaged: true } : null),
          undefined,
          { history: false },
        );
        s.setPending(undefined);
        await s.flushPendingNow();
        store.setImporting(id, undefined);
      }
      return;
    }
    const port = makePort(s, store, p, handle, key);
    result = await runPdfJob(port, p, { crashPage });
    const last = result.pending ?? { ...p, nextPage: p.total };
    if (result.state === 'cancelled' && stillOwned(s) && port.abandoned()) {
      await dropAbandoned(s, store, last, key);
      startNext = true;
      return;
    }
    setJob(key, jobState(id, last, result.state === 'done' ? 'done' : result.state === 'failed' ? 'failed' : 'running', result.damagedPages));
    if (result.state === 'done') {
      startNext = true;
      store.setImporting(id, undefined);
      if (result.damagedPages.length) {
        showToast({
          id: `import-damaged-${id}`,
          tone: 'warn',
          text: tr('تعذّر عرض بعض صفحات الملف لأنها تالفة', 'Some pages of the file could not be shown because they are damaged'),
        });
      }
    }
  } catch {
    // An unexpected failure: the pending record stays for the next resume.
  } finally {
    if (handle) await handle.close().catch(() => {});
    store.releaseSession(id);
  }
  if (startNext) void startQueued(id).catch(() => {});
}

/** Starts the next PDF that waited for this notebook's pending slot. */
async function startQueued(id: Id): Promise<void> {
  const list = queued.get(id);
  const next = list?.shift();
  if (!list?.length) queued.delete(id);
  if (!next) return;
  const store = storeOrNull();
  if (!store) return;
  let s: NotebookSession;
  try {
    s = await store.openSession(id);
  } catch {
    return;
  }
  try {
    await startPdfJob(s, next);
  } catch {
    // The pending record could not be written: its pages keep page 1's size (see the header).
  } finally {
    store.releaseSession(id);
  }
}

/**
 * Resumes (or starts) the notebook's pending import. Idempotent: while a run for the same notebook
 * and job is going, every call returns that run's promise. Resolves when the job stops (done,
 * failed or cancelled); never rejects.
 */
export function resumePendingImport(session: NotebookSession): Promise<void> {
  const p = session.notebook.pending;
  if (!p || session.readOnly || !pdfEngine.available || !storeOrNull()) return Promise.resolve();
  const key = jobKey(session.id, p.jobId);
  return registry.run(key, () => runJob(session.id, p.jobId, key).catch(() => {}));
}

/**
 * Gives the session a new pending PDF job and starts it, or queues it when the notebook's pending
 * slot is busy with another job.
 */
export async function startPdfJob(s: NotebookSession, pending: PendingImport): Promise<void> {
  const cur = s.notebook.pending;
  const store = storeOrNull();
  if (cur && cur.jobId !== pending.jobId) {
    const list = queued.get(s.id) ?? [];
    list.push(pending);
    queued.set(s.id, list);
    setJob(jobKey(s.id, pending.jobId), jobState(s.id, pending, 'running'));
    // Make sure the current job is running, so the queue moves.
    void resumePendingImport(s);
    return;
  }
  if (!cur) {
    s.setPending(pending);
    await s.flushPendingNow();
  }
  store?.setImporting(s.id, { done: Math.max(0, pending.nextPage - pending.firstPageIndex), total: Math.max(0, pending.total - pending.firstPageIndex) });
  void resumePendingImport(s);
}

function waitForLoaded(): Promise<NotebooksStore | null> {
  return new Promise((resolve) => {
    const check = (): boolean => {
      const st = storeOrNull();
      if (st && st.loaded) {
        resolve(st);
        return true;
      }
      return false;
    };
    if (!notebookSupported) {
      resolve(null);
      return;
    }
    if (check()) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeStore(() => {
      if (!check()) return;
      unsub();
      if (timer !== null) clearTimeout(timer);
    });
    // The provider mounts at app start; give up quietly after a minute.
    timer = setTimeout(() => {
      unsub();
      resolve(storeOrNull());
    }, 60_000);
  });
}

let resumingAll: Promise<void> | null = null;

/** Boot (NotebookServices): resumes every notebook whose index entry says it is still importing. */
export function resumeAllPending(): Promise<void> {
  if (resumingAll) return resumingAll;
  resumingAll = (async () => {
    if (!pdfEngine.available) return;
    const store = await waitForLoaded();
    if (!store?.loaded) return;
    const ids = store.entries.filter((e) => e.importing && !e.readOnly).map((e) => e.id);
    for (const id of ids) {
      let s: NotebookSession;
      try {
        s = await store.openSession(id);
      } catch {
        // Gone or unreadable: drop the stale progress.
        store.setImporting(id, undefined);
        continue;
      }
      try {
        if (!s.notebook.pending) store.setImporting(id, undefined);
        else await resumePendingImport(s);
      } finally {
        store.releaseSession(id);
      }
    }
  })().finally(() => {
    resumingAll = null;
  });
  return resumingAll;
}
