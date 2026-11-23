import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { writeJsonAtomic } from '../../../src/notebook/core/fs/journal.ts';
import { nbLayout } from '../../../src/notebook/core/fs/layout.ts';
import { makeNotebookFile, makePageFile } from '../../../src/notebook/core/model/index.ts';
import type { Notebook, Page } from '../../../src/notebook/core/model/index.ts';
import { openSession } from '../../../src/notebook/core/session/session.ts';
import type { SessionDeps } from '../../../src/notebook/core/session/types.ts';
import { createWriteQueue, probeRev } from '../../../src/notebook/core/session/writeQueue.ts';
import { createMemFs } from '../helpers/memfs.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T0 = '2026-11-23T10:00:00.000Z';

describe('createWriteQueue', () => {
  test('jobs run one at a time, in order, and rev is assigned when the job runs', async () => {
    const fs = createMemFs({ dirs: ['/d'] });
    fs.setDelay((op) => (op === 'writeText' ? 5 : 0));
    const q = createWriteQueue(fs);
    const ran: string[] = [];
    let active = 0;
    let maxActive = 0;
    const job = (name: string) => async (rev: number) => {
      active++;
      maxActive = Math.max(maxActive, active);
      ran.push(`${name}@${rev}`);
      await sleep(1);
      active--;
      return { rev, name };
    };
    const a = q.enqueue('/d/x.json', job('a'));
    const b = q.enqueue('/d/x.json', job('b'));
    const c = q.enqueueFront('/d/x.json', job('c'));
    await Promise.all([a, b, c]);
    assert.equal(maxActive, 1);
    // a started before c was put in front of b.
    assert.deepEqual(ran, ['a@1', 'c@2', 'b@3']);
    assert.equal(q.lastRev('/d/x.json'), 3);
    assert.equal(JSON.parse(fs.getText('/d/x.json') as string).name, 'b');
  });

  test('an unknown path starts after the rev on disk; null skips the write', async () => {
    const fs = createMemFs({ dirs: ['/d'] });
    fs.putText('/d/y.json', JSON.stringify({ rev: 7, $: 'end' }));
    fs.putText('/d/y.json.bak', JSON.stringify({ rev: 9, $: 'end' }));
    fs.putText('/d/y.json.tmp', '{"rev": 12, torn');
    assert.equal(await probeRev(fs, '/d/y.json'), 9);
    const q = createWriteQueue(fs);
    let seen = 0;
    await q.enqueue('/d/y.json', (rev) => {
      seen = rev;
      return null;
    });
    assert.equal(seen, 10);
    assert.equal(JSON.parse(fs.getText('/d/y.json') as string).rev, 7, 'skipped');
    await q.enqueue('/d/y.json', (rev) => ({ rev }));
    assert.equal(JSON.parse(fs.getText('/d/y.json') as string).rev, 10);
    q.seedRev('/d/y.json', 3);
    assert.equal(q.lastRev('/d/y.json'), 10, 'seedRev never lowers');
  });

  test('a failed write rejects its job only; the rev stays used', async () => {
    const fs = createMemFs({ dirs: ['/d'] });
    const q = createWriteQueue(fs);
    fs.failAfter(0);
    await assert.rejects(q.enqueue('/d/z.json', (rev) => ({ rev })));
    fs.failAfter(null);
    await q.enqueue('/d/z.json', (rev) => ({ rev }));
    assert.equal(JSON.parse(fs.getText('/d/z.json') as string).rev, 2);
  });

  test('lock waits for earlier jobs and holds later ones', async () => {
    const fs = createMemFs({ dirs: ['/d'] });
    fs.setDelay((op) => (op === 'writeText' ? 5 : 0));
    const q = createWriteQueue(fs);
    const order: string[] = [];
    const w1 = q.enqueue('/d/a.json', (rev) => {
      order.push('w1');
      return { rev };
    });
    const locked = q.lock(async () => {
      order.push('lock-start');
      assert.ok(fs.getText('/d/a.json'), 'earlier write finished');
      await sleep(10);
      order.push('lock-end');
      return 'done';
    });
    const w2 = q.enqueue('/d/a.json', (rev) => {
      order.push('w2');
      return { rev };
    });
    assert.equal(await locked, 'done');
    await Promise.all([w1, w2]);
    assert.deepEqual(order, ['w1', 'lock-start', 'lock-end', 'w2']);
    await q.idle();
    assert.equal(q.pending(), 0);
  });
});

describe('session write concurrency', () => {
  test('flushPendingNow during a debounced flush: revs strictly increase and both writes are visible', async () => {
    const ROOT = '/root/notebooks';
    const L = nbLayout(ROOT).notebook('nb1');
    const fs = createMemFs({ dirs: [L.pagesDir] });
    const page: Page = { id: 'p0', size: { w: 595.28, h: 841.89 }, background: { kind: 'paper', paper: { style: 'lined', color: 'white', size: 'a4' } }, items: [] };
    await writeJsonAtomic(fs, L.page('p0'), makePageFile(page, { rev: 1, savedAt: T0 }));
    const nb: Notebook = {
      id: 'nb1',
      title: 'n',
      createdAt: T0,
      updatedAt: T0,
      defaults: { style: 'lined', color: 'white', size: 'a4' },
      pageIds: ['p0'],
      removedPageIds: [],
      recordings: [],
      assets: {},
      origin: { kind: 'pdf' },
      contentRev: 1,
    };
    await writeJsonAtomic(fs, L.json, makeNotebookFile(nb, { rev: 1, savedAt: T0, app: 't' }));

    // Every notebook.json write, as it is written.
    const written: { rev: number; pending: boolean; items: number }[] = [];
    const writeText = fs.writeText.bind(fs);
    fs.writeText = async (p: string, t: string) => {
      if (p === `${L.json}.tmp`) {
        const v = JSON.parse(t) as { rev: number; pending?: unknown; pageIds: string[] };
        written.push({ rev: v.rev, pending: !!v.pending, items: 0 });
      }
      return writeText(p, t);
    };
    fs.setDelay((op, path) => (op === 'writeText' && path.includes('/pages/') ? 25 : 0));

    let timer: (() => void) | null = null;
    let n = 0;
    let clock = Date.parse(T0);
    const deps: SessionDeps = {
      fs,
      root: ROOT,
      now: () => (clock += 3),
      newId: () => `x${++n}`,
      setTimer: (fn) => {
        timer = fn;
        return 1;
      },
      clearTimer: () => {
        timer = null;
      },
      appVersion: 't',
      onIndexEntry: () => undefined,
      onSaved: () => undefined,
    };
    const r = await openSession(deps, 'nb1');
    assert.ok('session' in r);
    const s = r.session;
    await s.loadPage('p0');
    s.addItems('p0', [{ id: 'ink', kind: 'stroke', tool: 'pen', color: '#000000', width: 2, pressure: false, pts: [1, 1, 0.5] }]);
    assert.ok(timer, 'debounce armed');
    (timer as () => void)(); // the debounce fires: the page write starts (slow)
    await sleep(5);
    s.setPending({ jobId: 'j1', fileId: 'f1', kind: 'pdf-pages', firstPageIndex: 0, insertAt: 1, nextPage: 3, total: 9 });
    const front = s.flushPendingNow();
    await Promise.all([front, s.flush()]);

    assert.ok(written.length >= 2, `two notebook.json writes (${written.length})`);
    for (let i = 1; i < written.length; i++) assert.ok(written[i].rev > written[i - 1].rev, `revs strictly increase: ${written.map((w) => w.rev).join(',')}`);
    assert.equal(written[0].pending, true, 'the pending write went first');
    const finalNb = JSON.parse(fs.getText(L.json) as string) as Notebook & { rev: number };
    assert.equal(finalNb.rev, written[written.length - 1].rev);
    assert.equal(finalNb.pending?.nextPage, 3, 'pending is in the final file');
    const finalPage = JSON.parse(fs.getText(L.page('p0')) as string) as { page: Page };
    assert.deepEqual(
      finalPage.page.items.map((i) => i.id),
      ['ink'],
      'the page write is visible',
    );
    // Reopen: both changes are there.
    const again = await openSession({ ...deps }, 'nb1');
    assert.ok('session' in again);
    assert.equal(again.session.notebook.pending?.jobId, 'j1');
    assert.deepEqual(
      (await again.session.loadPage('p0')).items.map((i) => i.id),
      ['ink'],
    );
  });
});
