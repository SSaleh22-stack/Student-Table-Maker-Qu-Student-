import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createRegistry } from '../../../src/notebook/core/session/registry.ts';
import type { NotebookSession, OpenResult } from '../../../src/notebook/core/session/types.ts';

function timers() {
  const map = new Map<number, () => void>();
  let seq = 0;
  return {
    set: (fn: () => void) => {
      map.set(++seq, fn);
      return seq;
    },
    clear: (h: unknown) => {
      map.delete(h as number);
    },
    fireAll() {
      const fns = [...map.values()];
      map.clear();
      for (const f of fns) f();
    },
    size: () => map.size,
  };
}

function fakeSession(id: string, log: string[]): NotebookSession {
  return {
    id,
    release: async () => {
      log.push(`release:${id}`);
    },
    flush: async () => {
      log.push(`flush:${id}`);
    },
  } as unknown as NotebookSession;
}

describe('createRegistry', () => {
  test('a remount within the grace returns the same object; after the grace a new one', async () => {
    const tm = timers();
    const log: string[] = [];
    let opens = 0;
    const reg = createRegistry({
      open: async (id) => {
        opens++;
        return { session: fakeSession(`${id}#${opens}`, log) };
      },
      graceMs: 5000,
      setTimer: tm.set,
      clearTimer: tm.clear,
    });
    const a = await reg.acquire('nb');
    assert.ok('session' in a);
    reg.release('nb');
    assert.equal(tm.size(), 1, 'grace timer');
    assert.ok(reg.get('nb'), 'still open during the grace');
    const b = await reg.acquire('nb');
    assert.ok('session' in b);
    assert.equal(b.session, a.session, 'same object');
    assert.equal(tm.size(), 0, 'grace cancelled');
    assert.equal(opens, 1);
    reg.release('nb');
    tm.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(log, ['release:nb#1']);
    assert.equal(reg.get('nb'), null);
    const c = await reg.acquire('nb');
    assert.ok('session' in c);
    assert.notEqual(c.session, a.session);
    assert.equal(opens, 2);
  });

  test('concurrent acquires share one open; references are counted', async () => {
    const tm = timers();
    const log: string[] = [];
    let opens = 0;
    let finish!: (r: OpenResult) => void;
    const reg = createRegistry({
      open: () => {
        opens++;
        return new Promise<OpenResult>((r) => (finish = r));
      },
      graceMs: 5000,
      setTimer: tm.set,
      clearTimer: tm.clear,
    });
    const p1 = reg.acquire('x');
    const p2 = reg.acquire('x');
    await new Promise((r) => setTimeout(r, 0));
    finish({ session: fakeSession('x', log) });
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(opens, 1);
    assert.ok('session' in r1 && 'session' in r2 && r1.session === r2.session);
    reg.release('x');
    assert.equal(tm.size(), 0, 'one reference left');
    reg.release('x');
    assert.equal(tm.size(), 1);
    reg.release('x');
    assert.equal(tm.size(), 1, 'extra releases are ignored');
    await reg.flushAll();
    assert.deepEqual(log, ['flush:x']);
    assert.equal(reg.sessions().length, 1);
  });

  test('a failed open is not cached; evict releases at once', async () => {
    const tm = timers();
    const log: string[] = [];
    let fail = true;
    const reg = createRegistry({
      open: async (id) => (fail ? { error: 'unreadable' } : { session: fakeSession(id, log) }),
      graceMs: 5000,
      setTimer: tm.set,
      clearTimer: tm.clear,
    });
    assert.deepEqual(await reg.acquire('y'), { error: 'unreadable' });
    assert.equal(reg.get('y'), null);
    fail = false;
    const r = await reg.acquire('y');
    assert.ok('session' in r);
    await reg.evict('y');
    assert.deepEqual(log, ['release:y']);
    assert.equal(reg.get('y'), null);
    reg.release('y');
    assert.equal(tm.size(), 0);
  });

  test('a late release by a holder of an evicted session does not release the newer session', async () => {
    const tm = timers();
    const log: string[] = [];
    let n = 0;
    const reg = createRegistry({
      open: async (id) => ({ session: fakeSession(`${id}${++n}`, log) }),
      graceMs: 5000,
      setTimer: tm.set,
      clearTimer: tm.clear,
    });
    const first = await reg.acquire('z'); // the old editor
    assert.ok('session' in first);
    await reg.evict('z'); // e.g. restore over the open notebook
    const second = await reg.acquire('z'); // the editor remounts on the restored notebook
    assert.ok('session' in second);
    assert.notEqual(second.session, first.session);
    reg.release('z'); // the OLD editor unmounts late
    assert.equal(tm.size(), 0, 'no grace timer: the new session is still held');
    assert.equal(reg.get('z'), second.session);
    reg.release('z'); // the new editor unmounts
    assert.equal(tm.size(), 1);
    tm.fireAll();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(log, ['release:z1', 'release:z2']);
  });
});
