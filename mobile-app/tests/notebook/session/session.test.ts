import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { writeJsonAtomic } from '../../../src/notebook/core/fs/journal.ts';
import { nbLayout } from '../../../src/notebook/core/fs/layout.ts';
import { makeNotebookFile, makePageFile } from '../../../src/notebook/core/model/index.ts';
import type { Id, IndexEntry, Notebook, Page, PageItem, Recording, StrokeItem } from '../../../src/notebook/core/model/index.ts';
import { openSession } from '../../../src/notebook/core/session/session.ts';
import type { NotebookSession, SessionDeps } from '../../../src/notebook/core/session/types.ts';
import { createMemFs } from '../helpers/memfs.ts';
import type { MemFs } from '../helpers/memfs.ts';

const ROOT = '/root/notebooks';
const L = nbLayout(ROOT);
const T0 = '2026-11-23T10:00:00.000Z';
let idSeq = 0;
const nextId = () => `id${(++idSeq).toString(36).padStart(4, '0')}`;

function fakeTimers() {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clear: (h: unknown) => {
      timers.delete(h as number);
    },
    advance(ms: number) {
      t += ms;
      for (const [id, x] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (x.at <= t && timers.has(id)) {
          timers.delete(id);
          x.fn();
        }
      }
    },
    size: () => timers.size,
  };
}

function makeDeps(fs: MemFs, extra?: Partial<SessionDeps>) {
  const timers = fakeTimers();
  let clock = Date.parse(T0);
  const entries: IndexEntry[] = [];
  const saved: { id: Id; contentRev: number; firstPageChanged: boolean }[] = [];
  const deps: SessionDeps = {
    fs,
    root: ROOT,
    now: () => (clock += 7),
    newId: nextId,
    setTimer: timers.set,
    clearTimer: timers.clear,
    appVersion: 'test',
    onIndexEntry: (e) => entries.push(e),
    onSaved: (id, info) => saved.push({ id, ...info }),
    ...extra,
  };
  return { deps, timers, entries, saved };
}

function blank(id: Id): Page {
  return { id, size: { w: 595.28, h: 841.89 }, background: { kind: 'paper', paper: { style: 'lined', color: 'white', size: 'a4' } }, items: [] };
}

export function stroke(id: Id, x = 10, rec?: { recordingId: Id; ms: number }): StrokeItem {
  const s: StrokeItem = { id, kind: 'stroke', tool: 'pen', color: '#1B2533', width: 3, pressure: false, pts: [x, 20, 0.5, x + 5, 25, 0.5] };
  if (rec) s.rec = rec;
  return s;
}

async function seed(fs: MemFs, id: Id, o?: { pages?: Page[]; nb?: Partial<Notebook>; version?: number }): Promise<Notebook> {
  const pages = o?.pages ?? [blank('p0')];
  const paths = L.notebook(id);
  await fs.mkdirp(paths.pagesDir);
  for (const p of pages) await writeJsonAtomic(fs, paths.page(p.id), makePageFile(p, { rev: 1, savedAt: T0 }));
  const nb: Notebook = {
    id,
    title: 'Notes',
    createdAt: T0,
    updatedAt: T0,
    defaults: { style: 'lined', color: 'white', size: 'a4' },
    pageIds: pages.map((p) => p.id),
    removedPageIds: [],
    recordings: [],
    assets: {},
    origin: { kind: 'blank' },
    contentRev: 1,
    ...o?.nb,
  };
  const file = { ...makeNotebookFile(nb, { rev: 1, savedAt: T0, app: 'test' }), ...(o?.version ? { version: o.version } : {}) };
  await writeJsonAtomic(fs, paths.json, file as { rev: number });
  return nb;
}

async function open(deps: SessionDeps, id = 'nb1'): Promise<NotebookSession> {
  const r = await openSession(deps, id);
  assert.ok('session' in r, `open failed: ${JSON.stringify(r)}`);
  return r.session;
}

const ids = (p: Page | undefined) => (p ? p.items.map((i) => i.id) : []);

describe('openSession', () => {
  test('missing and unreadable notebooks', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    const { deps } = makeDeps(fs);
    assert.deepEqual(await openSession(deps, 'nope'), { error: 'missing' });
    fs.putText(L.notebook('bad').json, '{"format":"qu-notebook", torn');
    assert.deepEqual(await openSession(deps, 'bad'), { error: 'unreadable' });
  });

  test('a newer version is read-only: edits ignored, nothing written', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1', { version: 9 });
    const { deps, timers } = makeDeps(fs);
    fs.clearLog();
    const s = await open(deps);
    assert.equal(s.readOnly, true);
    await s.loadPage('p0');
    assert.equal(s.addItems('p0', [stroke('a')]), '');
    s.setMeta({ title: 'X' });
    assert.equal(s.undo(), false);
    timers.advance(5000);
    await s.flush();
    await s.release();
    assert.deepEqual(fs.log, []);
    assert.equal(s.notebook.title, 'Notes');
  });
});

describe('snapshot', () => {
  test('getSnapshot returns the same object until something changes', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1');
    const { deps } = makeDeps(fs);
    const s = await open(deps);
    const a = s.getSnapshot();
    assert.equal(s.getSnapshot(), a);
    let calls = 0;
    const off = s.subscribe(() => calls++);
    await s.loadPage('p0');
    assert.equal(s.getSnapshot(), a, 'loading a page does not change the notebook snapshot');
    s.addItems('p0', [stroke('a')]);
    const b = s.getSnapshot();
    assert.notEqual(b, a);
    assert.equal(s.getSnapshot(), b);
    assert.equal(b.canUndo, true);
    assert.equal(b.saveState, 'pending');
    assert.ok(calls > 0);
    await s.flush();
    assert.equal(s.getSnapshot().saveState, 'saved');
    off();
  });
});

describe('history', () => {
  test('undoIfTop undoes only while its entry is on top', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1');
    const { deps } = makeDeps(fs);
    const s = await open(deps);
    await s.loadPage('p0');
    const e1 = s.addItems('p0', [stroke('a')]);
    const e2 = s.replaceItems('p0', ['a'], [stroke('shape')], 'snap');
    assert.equal(s.topEntryId(), e2);
    s.addItems('p0', [stroke('b')]);
    assert.equal(s.undoIfTop(e2), false, 'another push came after the snap');
    assert.deepEqual(ids(s.getPage('p0')), ['shape', 'b']);
    const e4 = s.addItems('p0', [stroke('c')]);
    assert.equal(s.undoIfTop(e4), true);
    assert.deepEqual(ids(s.getPage('p0')), ['shape', 'b']);
    assert.equal(s.undoIfTop(e1), false);
  });

  test('groups merge into one entry with the first id', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1');
    const { deps } = makeDeps(fs);
    const s = await open(deps);
    await s.loadPage('p0');
    s.beginGroup('drag');
    const first = s.addItems('p0', [stroke('a')]);
    const second = s.addItems('p0', [stroke('b')]);
    s.endGroup();
    assert.equal(first, second);
    assert.equal(s.topEntryId(), first);
    assert.equal(s.undo(), true);
    assert.deepEqual(ids(s.getPage('p0')), []);
    assert.equal(s.canUndo(), false);
    assert.equal(s.redo(), true);
    assert.deepEqual(ids(s.getPage('p0')), ['a', 'b']);
  });

  test('deleteRecording is ONE undo step; add and update recording are not undoable', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1', { pages: [blank('p0'), blank('p1')] });
    const { deps } = makeDeps(fs);
    const s = await open(deps);
    const rec: Recording = { id: 'r1', title: 'تسجيل 1', startedAt: T0, durationMs: 0, segments: [] };
    s.addRecording(rec);
    s.updateRecording('r1', { durationMs: 5000 });
    assert.equal(s.canUndo(), false, 'recordings are not in history');
    await s.loadPage('p0');
    s.addItems('p0', [stroke('m1', 10, { recordingId: 'r1', ms: 100 }), stroke('plain')]);
    // p1 is not loaded: deleteRecording loads it first.
    s.insertPages(2, [], { history: false });
    await s.flush();
    const p1 = await s.loadPage('p1');
    assert.deepEqual(ids(p1), []);
    s.addItems('p1', [stroke('m2', 30, { recordingId: 'r1', ms: 200 })]);
    const before = s.getSnapshot();
    const undoDepth = () => {
      let n = 0;
      while (s.undo()) n++;
      for (let i = 0; i < n; i++) s.redo();
      return n;
    };
    const depthBefore = undoDepth();
    await s.deleteRecording('r1');
    assert.equal(s.notebook.recordings.length, 0);
    assert.equal(s.getPage('p0')?.items[0].rec, undefined);
    assert.equal(s.getPage('p1')?.items[0].rec, undefined);
    assert.equal(undoDepth(), depthBefore + 1, 'one history entry');
    // A recording added AFTER the delete survives the undo of the delete.
    s.addRecording({ ...rec, id: 'r2', title: 'تسجيل 2' });
    assert.equal(s.undo(), true);
    assert.deepEqual(
      s.notebook.recordings.map((r) => r.id),
      ['r1', 'r2'],
    );
    assert.equal(s.notebook.recordings[0].durationMs, 5000);
    assert.deepEqual(s.getPage('p0')?.items[0].rec, { recordingId: 'r1', ms: 100 });
    assert.deepEqual(s.getPage('p1')?.items[0].rec, { recordingId: 'r1', ms: 200 });
    assert.notEqual(s.getSnapshot(), before);
  });

  test('undo of a page add after a non-history insert keeps the inserted pages', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1');
    const { deps } = makeDeps(fs);
    const s = await open(deps);
    const added = s.addPage('end');
    s.insertPages(1, [blank('imp1'), blank('imp2')], { history: false });
    assert.deepEqual(s.notebook.pageIds, ['p0', 'imp1', 'imp2', added]);
    assert.equal(s.undo(), true);
    assert.deepEqual(s.notebook.pageIds, ['p0', 'imp1', 'imp2']);
    assert.deepEqual(s.notebook.removedPageIds, [added]);
    assert.equal(s.redo(), true);
    assert.deepEqual(s.notebook.pageIds, ['p0', 'imp1', 'imp2', added]);
  });
});

describe('pages', () => {
  test('deletePages tombstones; undo brings a page back from disk after eviction', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1', { pages: [blank('p0'), { ...blank('p1'), items: [stroke('keep')] }] });
    const { deps } = makeDeps(fs, { lruSize: 1 });
    const s = await open(deps);
    await s.loadPage('p1');
    s.deletePages(['p1']);
    assert.deepEqual(s.notebook.pageIds, ['p0']);
    assert.deepEqual(s.notebook.removedPageIds, ['p1']);
    await s.flush();
    await s.loadPage('p0');
    assert.equal(s.getPage('p1'), undefined, 'evicted (clean, lru 1)');
    assert.equal(s.undo(), true);
    assert.deepEqual(s.notebook.pageIds, ['p0', 'p1']);
    assert.deepEqual(s.notebook.removedPageIds, []);
    assert.deepEqual(ids(await s.loadPage('p1')), ['keep']);
  });

  test('pages edited by the undo stack stay in memory (pinned), clean ones are evicted', async () => {
    const pages = Array.from({ length: 20 }, (_, i) => blank(`q${i}`));
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1', { pages });
    const { deps } = makeDeps(fs);
    const s = await open(deps);
    await s.loadPage('q0');
    s.addItems('q0', [stroke('a')]);
    await s.flush();
    for (const p of pages) await s.loadPage(p.id);
    assert.ok(s.getPage('q0'), 'q0 is referenced by history');
    assert.equal(s.getPage('q1'), undefined);
    assert.ok(s.getPage('q19'));
    assert.equal(s.undo(), true);
    assert.deepEqual(ids(s.getPage('q0')), []);
  });

  test('duplicate, move, background and defaults', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1', { pages: [{ ...blank('p0'), items: [stroke('a')] }, blank('p1')] });
    const { deps } = makeDeps(fs);
    const s = await open(deps);
    const [copy] = s.duplicatePages(['p0']);
    await s.flush();
    assert.deepEqual(s.notebook.pageIds, ['p0', copy, 'p1']);
    assert.deepEqual(ids(s.getPage(copy)), ['a']);
    s.movePage('p1', 0);
    assert.deepEqual(s.notebook.pageIds, ['p1', 'p0', copy]);
    s.setPageBackground(['p1'], { kind: 'paper', paper: { style: 'grid', color: 'dark', size: 'wide' } });
    await s.flush();
    assert.deepEqual(s.getPage('p1')?.size, { w: 960, h: 540 });
    s.setDefaults({ style: 'dotted', color: 'cream', size: 'letter' });
    const np = s.addPage('p1');
    assert.deepEqual(s.notebook.pageIds, ['p1', np, 'p0', copy]);
    assert.deepEqual(s.getPage(np)?.size, { w: 612, h: 792 });
    const v = s.pageVersion('p1');
    assert.ok(v > 0);
    s.setPageBackground(['p1'], () => null);
    assert.equal(s.pageVersion('p1'), v);
  });

  test('edits of more pages than the LRU holds reach every page (pages are held while loading)', async () => {
    const rec: Recording = { id: 'r1', title: 'r', startedAt: T0, durationMs: 1000, segments: [] };
    const pages = Array.from({ length: 8 }, (_, i) => ({ ...blank(`q${i}`), items: [stroke(`m${i}`, 10, { recordingId: 'r1', ms: i })] }));
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1', { pages, nb: { recordings: [rec] } });
    const { deps } = makeDeps(fs, { lruSize: 2 });
    const s = await open(deps);
    const all = pages.map((p) => p.id);
    s.setPageBackground(all, { kind: 'paper', paper: { style: 'grid', color: 'cream', size: 'a4' } });
    await s.flush();
    for (const pid of all) {
      const p = await s.loadPage(pid);
      assert.equal(p.background.kind === 'paper' && p.background.paper.style, 'grid', `background of ${pid}`);
    }
    await s.deleteRecording('r1');
    await s.flush();
    for (const pid of all) assert.equal((await s.loadPage(pid)).items[0].rec, undefined, `mark stripped on ${pid}`);
    assert.equal(s.undo(), true);
    for (const pid of all) assert.equal((await s.loadPage(pid)).items[0].rec?.recordingId, 'r1', `mark back on ${pid}`);
  });

  test('duplicatePages returns the copies in the order of the ids given', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1', { pages: [{ ...blank('p0'), items: [stroke('a')] }, { ...blank('p1'), items: [stroke('b')] }] });
    const { deps } = makeDeps(fs);
    const s = await open(deps);
    const [c1, c0] = s.duplicatePages(['p1', 'p0']);
    await s.flush();
    assert.deepEqual(s.notebook.pageIds, ['p0', c0, 'p1', c1]);
    assert.deepEqual(ids(s.getPage(c1)), ['b']);
    assert.deepEqual(ids(s.getPage(c0)), ['a']);
  });
});

describe('saving', () => {
  test('flush writes pages, then notebook.json (contentRev + 1), then the index entry, then onSaved', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1');
    const order: string[] = [];
    const { deps, saved, timers } = makeDeps(fs, {
      onIndexEntry: (e) => order.push(`index:${e.contentRev}`),
      onSaved: (_id, info) => order.push(`saved:${info.contentRev}:${info.firstPageChanged}`),
    });
    const s = await open(deps);
    order.length = 0;
    await s.loadPage('p0');
    fs.clearLog();
    s.addItems('p0', [stroke('a')]);
    timers.advance(999);
    assert.equal(fs.log.length, 0, 'debounced');
    timers.advance(1);
    await s.flush();
    const writes = fs.log.filter((x) => x.op === 'writeText').map((x) => x.path);
    assert.deepEqual(writes, [`${L.notebook('nb1').page('p0')}.tmp`, `${L.notebook('nb1').json}.tmp`]);
    assert.deepEqual(order, ['index:2', 'saved:2:true']);
    assert.equal(s.notebook.contentRev, 2);
    assert.notEqual(s.notebook.updatedAt, T0);
    assert.equal(saved.length, 0, 'replaced listener');
  });

  test('the index cover follows the first page even when it is not in memory', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    const pdfPage: Page = { ...blank('p0'), background: { kind: 'pdf', fileId: 'f', pageIndex: 0, rotation: 0 } };
    await seed(fs, 'nb1', { pages: [pdfPage, blank('p1')] });
    const { deps, entries } = makeDeps(fs);
    const s = await open(deps);
    assert.equal(entries.length, 0, 'no entry at open for a writable notebook');
    await s.loadPage('p1');
    s.addItems('p1', [stroke('a')]);
    await s.flush();
    assert.deepEqual(entries[entries.length - 1].cover, { kind: 'pdf' });
    assert.equal(entries[entries.length - 1].pageCount, 2);
  });

  test('withWriteLock holds the queue', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1');
    const { deps } = makeDeps(fs);
    const s = await open(deps);
    await s.loadPage('p0');
    s.addItems('p0', [stroke('a')]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let seen = '';
    const locked = s.withWriteLock(async () => {
      seen = fs.getText(L.notebook('nb1').page('p0')) ?? '';
      await gate;
      return 42;
    });
    await new Promise((r) => setTimeout(r, 5));
    s.addItems('p0', [stroke('b')]);
    const later = s.flush();
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(seen.includes('"a"'), 'flushed before the lock');
    assert.ok(!(fs.getText(L.notebook('nb1').page('p0')) ?? '').includes('"b"'), 'nothing written while locked');
    release();
    assert.equal(await locked, 42);
    await later;
    assert.ok((fs.getText(L.notebook('nb1').page('p0')) ?? '').includes('"b"'));
  });

  test('final release GCs tombstoned pages and unreferenced assets, keeps referenced ones', async () => {
    const fs = createMemFs({ dirs: [ROOT, '/src'] });
    for (const n of ['img1', 'img2', 'pdf1', 'aud1']) fs.putText(`/src/${n}`, `bytes of ${n}`);
    await seed(fs, 'nb1', { pages: [blank('p0'), blank('p1')] });
    const { deps } = makeDeps(fs);
    const s = await open(deps);
    const a1 = await s.addAsset('/src/img1', 'image', 'png');
    const a2 = await s.addAsset('/src/img2', 'image', 'JPG');
    const pdf = await s.addAsset('/src/pdf1', 'pdf', 'pdf');
    const aud = await s.addAsset('/src/aud1', 'audio', 'm4a');
    assert.equal(a2.ext, 'jpg');
    assert.equal(s.assetPath(aud.id), `${L.notebook('nb1').audioDir}/${aud.id}.m4a`);
    await s.loadPage('p0');
    s.addItems('p0', [{ id: 'im', kind: 'image', fileId: a1.id, box: { x: 0, y: 0, w: 10, h: 10, rot: 0 }, crop: null }]);
    s.setPending({ jobId: 'j', fileId: pdf.id, kind: 'pdf-pages', firstPageIndex: 0, insertAt: 1, nextPage: 1, total: 3 });
    s.addRecording({ id: 'r', title: 't', startedAt: T0, durationMs: 1, segments: [{ fileId: aud.id, startMs: 0, durationMs: 1, state: 'done' }] });
    s.deletePages(['p1']);
    await s.release();
    const paths = L.notebook('nb1');
    assert.equal(fs.getText(paths.page('p1')), null, 'tombstone collected');
    assert.ok(fs.getText(paths.asset(a1)), 'image in use');
    assert.equal(fs.getText(paths.asset(a2)), null, 'unreferenced image collected');
    assert.ok(fs.getText(paths.asset(pdf)), 'pending import asset kept');
    assert.ok(fs.getText(paths.asset(aud)), 'recording audio kept');
    const saved = JSON.parse(fs.getText(paths.json) as string) as Notebook;
    assert.deepEqual(saved.removedPageIds, []);
    assert.deepEqual(Object.keys(saved.assets).sort(), [a1.id, pdf.id, aud.id].sort());
    assert.equal(s.canUndo(), false);
  });

  test('final release reads no page files when nothing could unreference an asset; a damaged page keeps every asset', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    const pdfPage = (id: Id): Page => ({ id, size: { w: 595.28, h: 841.89 }, background: { kind: 'pdf', fileId: 'pdfA', pageIndex: 0, rotation: 0 }, items: [] });
    const asset = { id: 'pdfA', kind: 'pdf' as const, ext: 'pdf', bytes: 3, addedAt: T0 };
    const pages = [pdfPage('p0'), pdfPage('p1'), pdfPage('p2')];
    await seed(fs, 'nb1', { pages, nb: { assets: { pdfA: asset } } });
    const paths = L.notebook('nb1');
    await fs.mkdirp(paths.assetsDir);
    fs.putText(paths.asset(asset), 'pdf');
    // Strokes only: no asset can lose its last reference, so no page file is read at the close.
    const { deps } = makeDeps(fs);
    const s = await open(deps);
    await s.loadPage('p0');
    s.addItems('p0', [stroke('ink')]);
    await s.flush();
    let pageReads = 0;
    fs.setDelay((op, path) => {
      if (op === 'readText' && path.includes('/pages/')) pageReads++;
      return 0;
    });
    await s.release();
    fs.setDelay(null);
    assert.equal(pageReads, 0, 'no page file read at the close');
    assert.ok(fs.getText(paths.asset(asset)), 'pdf kept');

    // A page that could not be read (shown blank) may have referenced anything: no asset is deleted.
    fs.putText(paths.page('p1'), '{ torn');
    for (const sfx of ['.bak', '.tmp']) await fs.remove(`${paths.page('p1')}${sfx}`);
    const s2 = await open(makeDeps(fs).deps);
    await s2.loadPage('p1');
    await s2.loadPage('p0');
    // Removing the pdf background of p0 and p2 would leave pdfA referenced only by the damaged p1.
    s2.setPageBackground(['p0', 'p2'], { kind: 'paper', paper: { style: 'blank', color: 'white', size: 'a4' } });
    await s2.flush();
    await s2.release();
    assert.ok(fs.getText(paths.asset(asset)), 'pdf kept: the damaged page may still use it');
    const saved = JSON.parse(fs.getText(paths.json) as string) as Notebook;
    assert.ok(saved.assets.pdfA, 'asset still listed');
  });

  test('200 edits with crashes at random flush points: reopen loses nothing older than the last completed flush', async () => {
    let seedN = 1234567;
    const rand = () => {
      seedN = (seedN * 1103515245 + 12345) % 2147483648;
      return seedN / 2147483648;
    };
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1');
    const { deps } = makeDeps(fs);
    let s = await open(deps);
    await s.loadPage('p0');

    const stateOf = async (sess: NotebookSession) => {
      const out = new Map<Id, Set<Id>>();
      for (const pid of sess.notebook.pageIds) out.set(pid, new Set(ids(await sess.loadPage(pid))));
      return out;
    };
    let committed = await stateOf(s);
    let crashes = 0;
    let completed = 0;
    let item = 0;
    // Items removed after the last completed flush may or may not be gone after a crash.
    const removedSince = new Set<Id>();

    for (let i = 0; i < 200; i++) {
      const pids = s.notebook.pageIds;
      const r = rand();
      if (r < 0.06) {
        s.addPage('end');
      } else if (r < 0.12) {
        const pid = pids[Math.floor(rand() * pids.length)];
        const page = await s.loadPage(pid);
        if (page.items.length) {
          removedSince.add(page.items[0].id);
          s.removeItems(pid, [page.items[0].id]);
        }
      } else {
        const pid = pids[Math.floor(rand() * pids.length)];
        await s.loadPage(pid);
        s.addItems(pid, [stroke(`s${++item}`, item % 400)]);
      }
      if (rand() < 0.3) {
        const crash = rand() < 0.6;
        if (crash) fs.failAfter(Math.floor(rand() * 7), { torn: rand() < 0.5 });
        let ok = true;
        try {
          await s.flush();
        } catch {
          ok = false;
        }
        fs.failAfter(null);
        if (ok) {
          completed++;
          // Removed items may legitimately be gone; check only what must be there.
          committed = await stateOf(s);
          removedSince.clear();
        } else {
          crashes++;
          const r2 = await openSession(deps, 'nb1');
          assert.ok('session' in r2, 'reopen never fails');
          s = r2.session;
          const now = await stateOf(s);
          for (const [pid, items] of committed) {
            assert.ok(now.has(pid), `page ${pid} lost (crash ${crashes})`);
            const have = now.get(pid) as Set<Id>;
            for (const it of items) if (!removedSince.has(it)) assert.ok(have.has(it), `item ${it} on ${pid} lost (crash ${crashes})`);
          }
          committed = now;
          removedSince.clear();
        }
      }
    }
    assert.ok(crashes > 5, `crashes happened (${crashes})`);
    assert.ok(completed > 5, `flushes completed (${completed})`);
    await s.flush();
    const last = await openSession(deps, 'nb1');
    assert.ok('session' in last);
    const final = await stateOf(last.session);
    for (const [pid, items] of await stateOf(s)) assert.deepEqual([...(final.get(pid) ?? [])].sort(), [...items].sort());
  });
});

describe('jump and page subscriptions', () => {
  test('requestJump reaches onJump listeners; subscribePage fires on changes', async () => {
    const fs = createMemFs({ dirs: [ROOT] });
    await seed(fs, 'nb1');
    const { deps } = makeDeps(fs);
    const s = await open(deps);
    const jumps: Id[] = [];
    const off = s.onJump((p) => jumps.push(p));
    s.requestJump('p0');
    off();
    s.requestJump('p0');
    assert.deepEqual(jumps, ['p0']);
    let n = 0;
    const offPage = s.subscribePage('p0', () => n++);
    await s.loadPage('p0');
    s.addItems('p0', [stroke('a')] as PageItem[]);
    offPage();
    s.addItems('p0', [stroke('b')]);
    assert.equal(n, 2);
  });
});
