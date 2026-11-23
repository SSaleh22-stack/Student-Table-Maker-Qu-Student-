import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createAutosave } from '../../../src/notebook/core/session/autosave.ts';

function timers() {
  let t = 0;
  let seq = 0;
  const map = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn: () => void, ms: number) => {
      map.set(++seq, { at: t + ms, fn });
      return seq;
    },
    clear: (h: unknown) => {
      map.delete(h as number);
    },
    advance(ms: number) {
      t += ms;
      for (const [id, x] of [...map]) {
        if (x.at <= t) {
          map.delete(id);
          x.fn();
        }
      }
    },
    nextDelay: () => Math.min(...[...map.values()].map((x) => x.at - t)),
    size: () => map.size,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createAutosave', () => {
  test('debounces 1 s after the last change', async () => {
    const tm = timers();
    let flushes = 0;
    const a = createAutosave({ setTimer: tm.set, clearTimer: tm.clear, flush: async () => void flushes++ });
    a.markDirty();
    tm.advance(600);
    a.markDirty();
    tm.advance(600);
    assert.equal(flushes, 0);
    tm.advance(400);
    await tick();
    assert.equal(flushes, 1);
    assert.equal(a.isDirty(), false);
  });

  test('a change during a flush schedules another flush after it', async () => {
    const tm = timers();
    let release!: () => void;
    let flushes = 0;
    const a = createAutosave({
      setTimer: tm.set,
      clearTimer: tm.clear,
      flush: () => {
        flushes++;
        return flushes === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve();
      },
    });
    a.markDirty();
    tm.advance(1000);
    assert.equal(a.isFlushing(), true);
    a.markDirty();
    assert.equal(tm.size(), 0, 'no timer while flushing');
    release();
    await tick();
    assert.equal(a.isScheduled(), true, 'rescheduled');
    tm.advance(1000);
    await tick();
    assert.equal(flushes, 2);
  });

  test('a flush that throws synchronously does not leave the autosave stuck', async () => {
    const tm = timers();
    let calls = 0;
    const a = createAutosave({
      setTimer: tm.set,
      clearTimer: tm.clear,
      flush: () => {
        calls++;
        if (calls === 1) throw new Error('sync');
        return Promise.resolve();
      },
    });
    a.markDirty();
    await assert.rejects(a.flushNow(), /sync/);
    assert.equal(a.isFlushing(), false);
    assert.equal(a.isDirty(), true);
    await a.flushNow();
    assert.equal(calls, 2);
    assert.equal(a.isDirty(), false);
  });

  test('flushNow waits for a running flush and then saves the rest', async () => {
    const tm = timers();
    const log: string[] = [];
    let release!: () => void;
    let first = true;
    const a = createAutosave({
      setTimer: tm.set,
      clearTimer: tm.clear,
      flush: async () => {
        log.push('flush');
        if (first) {
          first = false;
          await new Promise<void>((r) => (release = r));
        }
      },
    });
    a.markDirty();
    tm.advance(1000);
    a.markDirty();
    const p = a.flushNow();
    release();
    await p;
    assert.deepEqual(log, ['flush', 'flush']);
    assert.equal(a.isDirty(), false);
    await a.flushNow();
    assert.equal(log.length, 2, 'nothing dirty, nothing flushed');
  });

  test('a failed flush is retried with a growing delay', async () => {
    const tm = timers();
    let fails = 2;
    let ok = 0;
    const errors: unknown[] = [];
    const a = createAutosave({
      setTimer: tm.set,
      clearTimer: tm.clear,
      onError: (e) => errors.push(e),
      flush: async () => {
        if (fails-- > 0) throw new Error('disk');
        ok++;
      },
    });
    a.markDirty();
    await assert.rejects(a.flushNow());
    assert.equal(a.isDirty(), true);
    assert.equal(tm.nextDelay(), 2000);
    tm.advance(2000);
    await tick();
    await tick();
    assert.equal(errors.length, 2);
    assert.equal(tm.nextDelay(), 4000);
    tm.advance(4000);
    await tick();
    assert.equal(ok, 1);
    assert.equal(a.isDirty(), false);
  });
});
