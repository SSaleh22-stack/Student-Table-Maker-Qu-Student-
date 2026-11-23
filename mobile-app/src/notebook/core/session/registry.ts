/**
 * Ref-counted registry of open sessions with a grace period (default 5 s in the store).
 *
 * acquire(id) opens the session once (concurrent acquires share the open) and counts a reference.
 * release(id) drops one; at zero a grace timer starts, and only when it fires is the session
 * released for good (session.release(): flush, history dropped, GC). An acquire within the grace
 * cancels the timer and gets the SAME session object, so a remount (language switch, a pushed
 * screen) keeps the undo history and the page cache.
 *
 * A failed open ({ error }) is not cached: the next acquire tries again.
 */
import type { Id } from '../model/index.ts';
import type { NotebookSession, OpenResult, Registry } from './types.ts';

export interface RegistryOptions {
  open(id: Id): Promise<OpenResult>;
  graceMs: number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(h: unknown): void;
}

interface Slot {
  refs: number;
  opening: Promise<OpenResult>;
  session: NotebookSession | null;
  timer: unknown;
  closing: Promise<void> | null;
  /** References dropped by evict() (their holders still call release() later). */
  ghosted: number;
}

export const SESSION_GRACE_MS = 5000;

export function createRegistry(o: RegistryOptions): Registry {
  const slots = new Map<Id, Slot>();
  /** Final releases still running (a new open of the same id waits for them). */
  const closing = new Map<Id, Promise<void>>();
  /**
   * Per id, releases still owed by holders of an EVICTED session. Their release(id) calls are
   * absorbed here, so they never count against a newer session of the same id (a remount after a
   * restore over an open notebook would otherwise be released while still on screen).
   */
  const ghosts = new Map<Id, number>();
  const dropGhosts = (id: Id, n: number) => {
    const left = (ghosts.get(id) ?? 0) - n;
    if (left > 0) ghosts.set(id, left);
    else ghosts.delete(id);
  };

  const stopTimer = (slot: Slot) => {
    if (slot.timer !== null) {
      o.clearTimer(slot.timer);
      slot.timer = null;
    }
  };

  const finalRelease = (id: Id, slot: Slot): Promise<void> => {
    if (slot.closing) return slot.closing;
    stopTimer(slot);
    if (slots.get(id) === slot) slots.delete(id);
    const p = (async () => {
      try {
        const r = await slot.opening;
        if ('session' in r) await r.session.release();
      } catch {
        // A failed open has nothing to release.
      }
    })();
    slot.closing = p;
    closing.set(id, p);
    void p.then(() => {
      if (closing.get(id) === p) closing.delete(id);
    });
    return p;
  };

  return {
    acquire(id) {
      let slot = slots.get(id);
      if (slot) {
        stopTimer(slot);
        slot.refs++;
        return slot.opening;
      }
      const pendingClose = closing.get(id) ?? Promise.resolve();
      const fresh: Slot = { refs: 1, opening: Promise.resolve({ error: 'missing' }), session: null, timer: null, closing: null, ghosted: 0 };
      // A failed open holds no reference (its acquirers never release), so nothing is owed for it.
      const failed = () => {
        if (slots.get(id) === fresh) slots.delete(id);
        if (fresh.ghosted) {
          dropGhosts(id, fresh.ghosted);
          fresh.ghosted = 0;
        }
      };
      fresh.opening = pendingClose
        .then(() => o.open(id))
        .then(
          (r) => {
            if ('session' in r) fresh.session = r.session;
            else failed();
            return r;
          },
          () => {
            failed();
            return { error: 'unreadable' } as OpenResult;
          },
        );
      slot = fresh;
      slots.set(id, slot);
      return slot.opening;
    },
    release(id) {
      if (ghosts.has(id)) {
        dropGhosts(id, 1);
        return;
      }
      const slot = slots.get(id);
      if (!slot || slot.refs <= 0) return;
      slot.refs--;
      if (slot.refs > 0) return;
      stopTimer(slot);
      slot.timer = o.setTimer(() => {
        slot.timer = null;
        if (slot.refs === 0) void finalRelease(id, slot);
      }, Math.max(0, o.graceMs));
    },
    get(id) {
      return slots.get(id)?.session ?? null;
    },
    sessions() {
      const out: NotebookSession[] = [];
      for (const s of slots.values()) if (s.session) out.push(s.session);
      return out;
    },
    async flushAll() {
      await Promise.allSettled([...slots.values()].filter((s) => s.session).map((s) => (s.session as NotebookSession).flush()));
    },
    evict(id) {
      const slot = slots.get(id);
      if (!slot) return closing.get(id) ?? Promise.resolve();
      if (slot.refs > 0) {
        ghosts.set(id, (ghosts.get(id) ?? 0) + slot.refs);
        slot.ghosted += slot.refs;
      }
      slot.refs = 0;
      return finalRelease(id, slot);
    },
  };
}
