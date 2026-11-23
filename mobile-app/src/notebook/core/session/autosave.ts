/**
 * Debounced autosave (NB-81): markDirty() (re)starts a debounceMs timer that calls flush(). Only one
 * flush runs at a time; a change while a flush runs schedules another one after it. A failed flush is
 * retried with a growing delay (debounce x 2^n, at most 30 s) until one succeeds.
 *
 * Timers are injected (setTimer / clearTimer), so tests drive time by hand.
 */

export interface AutosaveOptions {
  debounceMs?: number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(h: unknown): void;
  flush(): Promise<void>;
  /** Called with the error of a failed flush (the retry is already scheduled). */
  onError?(e: unknown): void;
}

export interface Autosave {
  markDirty(): void;
  /** Flushes now (after a running flush) and resolves when everything marked so far is saved; rejects if that flush fails. */
  flushNow(): Promise<void>;
  isDirty(): boolean;
  isFlushing(): boolean;
  isScheduled(): boolean;
  /** Stops the timer (nothing is flushed). */
  cancel(): void;
}

export const AUTOSAVE_DEBOUNCE_MS = 1000;
export const AUTOSAVE_MAX_RETRY_MS = 30_000;

export function createAutosave(o: AutosaveOptions): Autosave {
  const debounce = Math.max(0, o.debounceMs ?? AUTOSAVE_DEBOUNCE_MS);
  let dirty = false;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let failures = 0;

  const stopTimer = () => {
    if (timer !== null) {
      o.clearTimer(timer);
      timer = null;
    }
  };

  const schedule = (ms: number) => {
    stopTimer();
    timer = o.setTimer(() => {
      timer = null;
      void run().catch(() => undefined);
    }, ms);
  };

  const retryDelay = () => Math.min(AUTOSAVE_MAX_RETRY_MS, Math.max(debounce, 1) * 2 ** Math.min(failures, 15));

  /** One flush of everything dirty now. */
  const run = (): Promise<void> => {
    if (running) return running;
    if (!dirty) return Promise.resolve();
    stopTimer();
    dirty = false;
    // flush() starts now, but a synchronous throw becomes a rejection: the body below then always
    // awaits first, so its finally runs after `running = p` (else `running` would stay set forever).
    let started: Promise<void>;
    try {
      started = Promise.resolve(o.flush());
    } catch (e) {
      started = Promise.reject(e);
    }
    const p = (async () => {
      try {
        await started;
        failures = 0;
      } catch (e) {
        failures++;
        dirty = true;
        o.onError?.(e);
        throw e;
      } finally {
        running = null;
        // Changes made during the flush (or a failure) get their own save.
        if (dirty && timer === null) schedule(failures ? retryDelay() : debounce);
      }
    })();
    running = p;
    return p;
  };

  return {
    markDirty() {
      dirty = true;
      if (running) return; // rescheduled when the running flush ends
      schedule(debounce);
    },
    async flushNow() {
      if (running) {
        try {
          await running;
        } catch {
          // The next run below retries.
        }
      }
      if (dirty) await run();
    },
    isDirty: () => dirty,
    isFlushing: () => running !== null,
    isScheduled: () => timer !== null,
    cancel: stopTimer,
  };
}
