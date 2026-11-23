/**
 * ONE serial write queue per session (and one for library.json). Every page and notebook.json write
 * is a job; jobs run one at a time, in order (enqueueFront puts a job before the waiting ones).
 *
 * The rev is assigned when the job RUNS: rev = lastRev(path) + 1, and valueFn(rev) builds the value
 * at that moment, so it always holds the latest state and revs on a path strictly increase. When
 * the queue has not seen a path yet, it reads the rev of what is on disk (main, .tmp, .bak) first.
 * valueFn may return null to skip the write (the rev is not used).
 *
 * lock(fn) waits until the jobs before it are done and holds the queue while fn runs (backs
 * session.withWriteLock: pack and backup read files that are not being written).
 */
import { dirName } from '../fs/adapter.ts';
import type { FsAdapter } from '../fs/adapter.ts';
import { bakPath, tmpPath, writeJsonAtomic } from '../fs/journal.ts';

export type ValueFn = (rev: number) => { rev: number } | null | Promise<{ rev: number } | null>;

export interface WriteQueue {
  /** Resolves when the job ran (written or skipped); rejects with the write error. */
  enqueue(path: string, valueFn: ValueFn): Promise<void>;
  enqueueFront(path: string, valueFn: ValueFn): Promise<void>;
  lock<T>(fn: () => Promise<T>): Promise<T>;
  /** Resolves when no job is waiting or running. */
  idle(): Promise<void>;
  /** The last rev written (or seen) on a path, or undefined when unknown. */
  lastRev(path: string): number | undefined;
  /** Tells the queue the rev a file has on disk (after a read). Never lowers the known rev. */
  seedRev(path: string, rev: number): void;
  /** Jobs waiting (not counting the running one). */
  pending(): number;
}

interface Job {
  run(): Promise<void>;
}

/** The highest rev among a path's main, .tmp and .bak files (0 when none parse). Never throws. */
export async function probeRev(fs: FsAdapter, path: string): Promise<number> {
  let best = 0;
  for (const p of [path, tmpPath(path), bakPath(path)]) {
    try {
      const text = await fs.readText(p);
      if (!text) continue;
      const raw = JSON.parse(text) as { rev?: unknown };
      if (typeof raw.rev === 'number' && Number.isFinite(raw.rev) && raw.rev > best) best = Math.floor(raw.rev);
    } catch {
      // A torn file has no usable rev.
    }
  }
  return best;
}

export function createWriteQueue(fs: FsAdapter): WriteQueue {
  const revs = new Map<string, number>();
  const jobs: Job[] = [];
  let running = false;
  let idleWaiters: (() => void)[] = [];

  const pump = async () => {
    if (running) return;
    running = true;
    try {
      while (jobs.length) {
        const job = jobs.shift() as Job;
        await job.run();
      }
    } finally {
      running = false;
      const w = idleWaiters;
      idleWaiters = [];
      for (const fn of w) fn();
    }
  };

  const writeJob = (path: string, valueFn: ValueFn, front: boolean): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const job: Job = {
        async run() {
          try {
            let last = revs.get(path);
            if (last === undefined) {
              last = await probeRev(fs, path);
              revs.set(path, Math.max(revs.get(path) ?? 0, last));
              last = revs.get(path) as number;
            }
            const rev = last + 1;
            const value = await valueFn(rev);
            if (!value) {
              resolve();
              return;
            }
            // The rev counts as used even if the write fails half way (a .tmp with it may exist).
            revs.set(path, Math.max(rev, value.rev));
            const dir = dirName(path);
            if (dir) await fs.mkdirp(dir);
            await writeJsonAtomic(fs, path, value);
            resolve();
          } catch (e) {
            reject(e);
          }
        },
      };
      if (front) jobs.unshift(job);
      else jobs.push(job);
      void pump();
    });

  return {
    enqueue: (path, valueFn) => writeJob(path, valueFn, false),
    enqueueFront: (path, valueFn) => writeJob(path, valueFn, true),
    lock<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        jobs.push({
          async run() {
            try {
              resolve(await fn());
            } catch (e) {
              reject(e);
            }
          },
        });
        void pump();
      });
    },
    idle() {
      if (!running && jobs.length === 0) return Promise.resolve();
      return new Promise<void>((r) => idleWaiters.push(r));
    },
    lastRev: (path) => revs.get(path),
    seedRev(path, rev) {
      if (!Number.isFinite(rev)) return;
      revs.set(path, Math.max(revs.get(path) ?? 0, Math.floor(rev)));
    },
    pending: () => jobs.length,
  };
}
