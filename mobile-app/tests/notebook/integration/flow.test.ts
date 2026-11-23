/**
 * End-to-end notebook flow on the pure core (P30): library ops create a notebook, the session edits
 * and flushes it, a crash hits the next flush at every write step, and the app "restarts" (new
 * session deps and a new library boot on the same disk). Nothing older than the last completed
 * flush is ever lost, and reading never throws (PRD9-reliability, NB-81, NB-82, NB-83).
 * Concurrent flushPendingNow calls while edits flush keep every write in one serial order.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readJsonRecovering } from '../../../src/notebook/core/fs/journal.ts';
import { nbLayout } from '../../../src/notebook/core/fs/layout.ts';
import { createLibraryOps } from '../../../src/notebook/core/library/ops.ts';
import { emptyIndex, readNotebookFile } from '../../../src/notebook/core/model/index.ts';
import type { Id, IndexFile, PendingImport, StrokeItem } from '../../../src/notebook/core/model/index.ts';
import { openSession } from '../../../src/notebook/core/session/session.ts';
import type { NotebookSession, SessionDeps } from '../../../src/notebook/core/session/types.ts';
import { createMemFs } from '../helpers/memfs.ts';
import type { MemFs } from '../helpers/memfs.ts';

const ROOT = '/root/notebooks';
const L = nbLayout(ROOT);
const PAPER = { style: 'lined', color: 'white', size: 'a4' } as const;
const START = Date.parse('2026-11-23T10:00:00.000Z');

/** One "app run" on a disk: its own clock, ids, timers (never fire: flushes are explicit) and index. */
function appRun(fs: MemFs, index: { file: IndexFile }, seed: string) {
  let clock = START;
  let n = 0;
  const now = () => (clock += 17);
  const newId = () => `${seed}${(++n).toString(36).padStart(4, '0')}`;
  const deps: SessionDeps = {
    fs,
    root: ROOT,
    now,
    newId,
    setTimer: () => 0,
    clearTimer: () => undefined,
    appVersion: 'test',
    onIndexEntry: (e) => {
      index.file = { ...index.file, entries: [...index.file.entries.filter((x) => x.id !== e.id), e] };
    },
    onSaved: () => undefined,
  };
  const ops = createLibraryOps({
    fs,
    root: ROOT,
    now,
    newId,
    appVersion: 'test',
    index: {
      get: () => index.file,
      update: (fn) => {
        index.file = fn(index.file);
      },
    },
  });
  const open = async (id: Id): Promise<NotebookSession> => {
    const r = await openSession(deps, id);
    assert.ok('session' in r, `open ${id}: ${JSON.stringify(r)}`);
    return r.session;
  };
  return { deps, ops, open, newId };
}

const stroke = (id: Id, x: number): StrokeItem => ({
  id,
  kind: 'stroke',
  tool: 'pen',
  color: '#1B2533',
  width: 3,
  pressure: true,
  pts: [x, 40, 0.5, x + 12, 52, 0.6, x + 20, 60, 0.4],
});

async function itemIds(s: NotebookSession, pid: Id): Promise<Id[]> {
  const p = await s.loadPage(pid);
  return p.items.map((i) => i.id);
}

/** A notebook with one flushed edit (stroke s1 on page 1); returns the disk and the ids. */
async function firstSave() {
  const fs = createMemFs({ dirs: [ROOT, '/src'] });
  const index = { file: emptyIndex() };
  const run = appRun(fs, index, 'a');
  const id = await run.ops.create({ title: 'محاضرة ١', location: { kind: 'course', code: 'CS102' }, paper: PAPER });
  const s = await run.open(id);
  const p0 = s.notebook.pageIds[0];
  await s.loadPage(p0);
  s.addItems(p0, [stroke('s1', 10)]);
  await s.flush();
  assert.equal(s.getSnapshot().saveState, 'saved');
  return { fs, index, id, p0, session: s };
}

/** The second edit: a stroke on page 1, a new page with a stroke, and a new title. */
async function secondEdit(s: NotebookSession, p0: Id): Promise<Id> {
  s.addItems(p0, [stroke('s2', 80)]);
  const p1 = s.addPage(p0);
  await s.loadPage(p1);
  s.addItems(p1, [stroke('s3', 30)]);
  s.setMeta({ title: 'محاضرة ١ - الجزء الثاني' });
  return p1;
}

describe('integration: create, edit, crash during flush, reopen', () => {
  test('a clean run: create, edit, flush, restart, everything is there and the index matches', async () => {
    const { fs, index, id, p0, session } = await firstSave();
    const p1 = await secondEdit(session, p0);
    await session.flush();
    await session.release();

    const run2 = appRun(fs, index, 'b');
    await run2.ops.boot();
    const s2 = await run2.open(id);
    assert.deepEqual(s2.notebook.pageIds, [p0, p1]);
    assert.equal(s2.notebook.title, 'محاضرة ١ - الجزء الثاني');
    assert.deepEqual(await itemIds(s2, p0), ['s1', 's2']);
    assert.deepEqual(await itemIds(s2, p1), ['s3']);
    const e = index.file.entries.find((x) => x.id === id);
    assert.ok(e, 'index entry');
    assert.equal(e.pageCount, 2);
    assert.equal(e.courseCode, 'CS102');
    assert.equal(e.title, 'محاضرة ١ - الجزء الثاني');
    // No journal leftovers after a clean flush.
    assert.deepEqual(Object.keys(fs.dump()).filter((p) => p.endsWith('.tmp')), []);
  });

  test('a crash at every write step of the second flush (clean and torn) never loses the first save', async () => {
    // Count the mutations of a successful second flush.
    const probe = await firstSave();
    probe.fs.clearLog();
    await secondEdit(probe.session, probe.p0);
    await probe.session.flush();
    const steps = probe.fs.log.length;
    assert.ok(steps >= 4, `the second flush writes pages, notebook.json and the journal (${steps} steps)`);

    for (const torn of [false, true]) {
      for (let n = 0; n <= steps; n++) {
        const { fs, index, id, p0, session } = await firstSave();
        await secondEdit(session, p0);
        fs.failAfter(n, { torn });
        let flushed = true;
        try {
          await session.flush();
        } catch {
          flushed = false;
        }
        if (fs.crashed) flushed = false;
        fs.failAfter(null);

        // Restart: a new run on the same disk (the index is what AsyncStorage kept).
        const run2 = appRun(fs, index, 'r');
        await run2.ops.boot();
        const r = await openSession(run2.deps, id);
        assert.ok('session' in r, `crash at step ${n} (torn ${torn}): ${JSON.stringify(r)}`);
        const s2 = r.session;
        const label = `step ${n}${torn ? ' torn' : ''}`;
        assert.equal(s2.notebook.pageIds[0], p0, label);
        const first = await itemIds(s2, p0);
        assert.ok(first.includes('s1'), `${label}: the first save survives (${first.join(',')})`);
        for (const pid of s2.notebook.pageIds) await s2.loadPage(pid);
        if (flushed) {
          assert.deepEqual(first, ['s1', 's2'], label);
          assert.equal(s2.notebook.pageIds.length, 2, label);
          assert.deepEqual(await itemIds(s2, s2.notebook.pageIds[1]), ['s3'], label);
        }
        // The student keeps writing after the restart, and that save is complete.
        s2.addItems(p0, [stroke('after', 120)]);
        await s2.flush();
        // The index lists the notebook, and after the first save of this run (open-time recovery may
        // have appended a page written just before the crash) its page count matches the file.
        const e = index.file.entries.find((x) => x.id === id);
        assert.ok(e, label);
        assert.equal(e.pageCount, s2.notebook.pageIds.length, label);
        const run3 = appRun(fs, index, 'x');
        const s3 = await run3.open(id);
        assert.ok((await itemIds(s3, p0)).includes('after'), label);
        assert.ok((await itemIds(s3, p0)).includes('s1'), label);
      }
    }
  });

  test('concurrent flushPendingNow while edits flush: one serial order, nothing lost, revs increase', async () => {
    const { fs, index, id, p0, session: s } = await firstSave();
    fs.putText('/src/slides.pdf', '%PDF-1.4 slides');
    const asset = await s.addAsset('/src/slides.pdf', 'pdf', 'pdf', { name: 'slides.pdf', pageCount: 30 });
    await s.flush();
    const before = await readJsonRecovering(fs, L.notebook(id).json, readNotebookFile, L.notebook(id).quarantine, { repair: false });
    assert.ok(before.ok);

    // Every fs call waits a little, so the flushes really overlap.
    fs.setDelay(() => 1);
    const pending = (next: number): PendingImport => ({
      jobId: 'job1',
      fileId: asset.id,
      kind: 'pdf-pages',
      firstPageIndex: 0,
      insertAt: 1,
      nextPage: next,
      total: 30,
    });
    const runs: Promise<void>[] = [];
    for (let i = 1; i <= 6; i++) {
      s.addItems(p0, [stroke(`c${i}`, 10 + i * 5)]);
      s.setPending(pending(i));
      runs.push(s.flushPendingNow());
      if (i % 2 === 0) runs.push(s.flush());
    }
    await Promise.all(runs);
    await s.flush();
    fs.setDelay(null);

    const after = await readJsonRecovering(fs, L.notebook(id).json, readNotebookFile, L.notebook(id).quarantine, { repair: false });
    assert.ok(after.ok);
    assert.equal(after.source, 'main');
    assert.ok(after.value.rev > before.value.rev, `rev ${after.value.rev} > ${before.value.rev}`);
    assert.equal(after.value.pending?.nextPage, 6);
    assert.deepEqual(Object.keys(fs.dump()).filter((p) => p.endsWith('.tmp')), []);

    const run2 = appRun(fs, index, 'q');
    const s2 = await run2.open(id);
    assert.equal(s2.notebook.pending?.jobId, 'job1');
    assert.equal(s2.notebook.pending?.nextPage, 6);
    assert.ok(s2.notebook.assets[asset.id], 'the asset is listed');
    assert.deepEqual(await itemIds(s2, p0), ['s1', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  });
});
