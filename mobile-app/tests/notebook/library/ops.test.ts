import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readJsonRecovering, writeJsonAtomic } from '../../../src/notebook/core/fs/journal.ts';
import { nbLayout } from '../../../src/notebook/core/fs/layout.ts';
import { createLibraryOps, inboxTime, LibraryError } from '../../../src/notebook/core/library/ops.ts';
import { computeUsage } from '../../../src/notebook/core/library/usage.ts';
import { upsertEntry } from '../../../src/notebook/core/library/derive.ts';
import { emptyIndex, makePageFile, readLibraryFile, readNotebookFile } from '../../../src/notebook/core/model/index.ts';
import type { Id, IndexFile, Notebook, Page } from '../../../src/notebook/core/model/index.ts';
import { createRegistry } from '../../../src/notebook/core/session/registry.ts';
import { openSession } from '../../../src/notebook/core/session/session.ts';
import type { IndexAccess, LibraryOpsDeps, SessionDeps } from '../../../src/notebook/core/session/types.ts';
import { createMemFs } from '../helpers/memfs.ts';
import type { MemFs } from '../helpers/memfs.ts';

const ROOT = '/root/notebooks';
const L = nbLayout(ROOT);
const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-11-23T10:00:00.000Z');
const PAPER = { style: 'grid', color: 'white', size: 'a4' } as const;

function setup(extra?: Partial<LibraryOpsDeps> & { chosen?: string[] }) {
  const fs = createMemFs({ dirs: [ROOT, '/src'] });
  let idx: IndexFile = emptyIndex();
  const index: IndexAccess = {
    get: () => idx,
    update: (fn) => {
      idx = fn(idx);
    },
  };
  let clock = START;
  let n = 0;
  const now = () => (clock += 11);
  const newId = () => `k${(++n).toString().padStart(4, '0')}`;
  let changes = 0;
  const ops = createLibraryOps({
    fs,
    root: ROOT,
    now,
    newId,
    index,
    appVersion: 'test',
    chosenCodes: () => extra?.chosen ?? [],
    copyTitle: (t) => `${t} (نسخة)`,
    onChanged: () => changes++,
    ...extra,
  });
  return {
    fs,
    ops,
    index,
    idx: () => idx,
    setClock: (t: number) => (clock = t),
    newId,
    now,
    changes: () => changes,
  };
}

async function readNb(fs: MemFs, id: Id): Promise<Notebook & { rev: number }> {
  const r = await readJsonRecovering(fs, L.notebook(id).json, readNotebookFile, L.notebook(id).quarantine, { repair: false });
  assert.ok(r.ok, `notebook ${id} readable`);
  return r.value;
}

const entry = (idx: IndexFile, id: Id) => idx.entries.find((e) => e.id === id);

describe('notebook ops', () => {
  test('create, rename, move, trash and restore update the file and the index', async () => {
    const t = setup();
    const id = await t.ops.create({ title: '  محاضرة   ١ ', location: { kind: 'course', code: 'CS102' }, paper: PAPER });
    let nb = await readNb(t.fs, id);
    assert.equal(nb.title, 'محاضرة ١');
    assert.equal(nb.courseCode, 'CS102');
    assert.equal(nb.pageIds.length, 1);
    assert.deepEqual(nb.defaults, PAPER);
    assert.equal(entry(t.idx(), id)?.courseCode, 'CS102');

    await t.ops.rename(id, 'جديد');
    await t.ops.rename(id, '   ');
    const folder = t.ops.createFolder('مراجعة');
    await t.ops.move(id, { kind: 'folder', id: folder.id });
    nb = await readNb(t.fs, id);
    assert.equal(nb.title, 'جديد');
    assert.equal(nb.folderId, folder.id);
    assert.equal(nb.courseCode, undefined);
    assert.equal(nb.rev, 3);
    await assert.rejects(t.ops.move(id, { kind: 'folder', id: 'nope' }), (e: unknown) => e instanceof LibraryError && e.code === 'no-folder');

    await t.ops.trash(id);
    assert.ok((await readNb(t.fs, id)).deletedAt);
    assert.ok(entry(t.idx(), id)?.deletedAt);
    t.ops.renameFolder(folder.id, 'x');
    await t.ops.deleteFolder(folder.id, 'unfile');
    await t.ops.restore(id);
    nb = await readNb(t.fs, id);
    assert.equal(nb.deletedAt, undefined);
    assert.equal(nb.folderId, undefined, 'its folder is gone: restored unfiled');
    assert.equal(entry(t.idx(), id)?.folderId, undefined);
    assert.ok(t.changes() > 0);
  });

  test('purge removes the folder AND records a purged tombstone; emptyTrash purges the trash', async () => {
    const t = setup();
    const a = await t.ops.create({ title: 'a', location: { kind: 'unfiled' }, paper: PAPER });
    const b = await t.ops.create({ title: 'b', location: { kind: 'unfiled' }, paper: PAPER });
    const c = await t.ops.create({ title: 'c', location: { kind: 'unfiled' }, paper: PAPER });
    await t.ops.purge(a);
    assert.equal(t.fs.hasDir(L.notebook(a).dir), false);
    assert.equal(entry(t.idx(), a), undefined);
    assert.deepEqual(
      t.idx().purged.map((x) => x.id),
      [a],
    );
    assert.ok(Date.parse(t.idx().purged[0].at) > START);
    await t.ops.trash(b);
    await t.ops.emptyTrash();
    assert.deepEqual(
      t.idx().purged.map((x) => x.id),
      [a, b],
    );
    assert.ok(t.fs.hasDir(L.notebook(c).dir));
  });

  test('an op on a closed notebook recovers a page file left by a crash before rewriting notebook.json', async () => {
    const t = setup();
    const id = await t.ops.create({ title: 'a', location: { kind: 'unfiled' }, paper: PAPER });
    const paths = L.notebook(id);
    // A page written just before a crash: its file exists, notebook.json does not list it yet.
    const lost: Page = { id: 'crashpage', size: { w: 595.28, h: 841.89 }, background: { kind: 'paper', paper: { ...PAPER } }, items: [] };
    await t.fs.mkdirp(paths.pagesDir);
    await writeJsonAtomic(t.fs, paths.page(lost.id), makePageFile(lost, { rev: 1, savedAt: new Date(START + DAY).toISOString() }));
    t.setClock(START + 2 * DAY);
    await t.ops.rename(id, 'b');
    const nb = await readNb(t.fs, id);
    assert.equal(nb.title, 'b');
    assert.ok(nb.pageIds.includes('crashpage'), 'the page is in notebook.json');
    const r = await openSession(sessionDeps(t.fs), id);
    assert.ok('session' in r);
    assert.ok(r.session.notebook.pageIds.includes('crashpage'), 'and survives the next open');
    assert.ok(t.fs.getText(paths.page('crashpage')));
  });

  test('a read-only notebook (newer app): ops change only the index, the index keeps them, duplicate refuses', async () => {
    const t = setup();
    const id = await t.ops.create({ title: 'new app', location: { kind: 'unfiled' }, paper: PAPER });
    const json = L.notebook(id).json;
    const raw = JSON.parse(t.fs.getText(json) as string) as Record<string, unknown>;
    t.fs.putText(json, JSON.stringify({ ...raw, version: 2 }));
    const before = t.fs.getText(json);
    const folder = t.ops.createFolder('f');
    await t.ops.move(id, { kind: 'folder', id: folder.id });
    await t.ops.trash(id);
    assert.equal(t.fs.getText(json), before, 'never written');
    assert.equal(entry(t.idx(), id)?.folderId, folder.id);
    assert.ok(entry(t.idx(), id)?.deletedAt);
    // Opening it reports a read-only entry; merging it keeps the index's location and trash flag.
    let reported: Parameters<SessionDeps['onIndexEntry']>[0] | null = null;
    const r = await openSession({ ...sessionDeps(t.fs), onIndexEntry: (e) => (reported = e) }, id);
    assert.ok('session' in r && r.session.readOnly);
    assert.ok(reported);
    t.index.update((f) => upsertEntry(f, reported as unknown as Parameters<typeof upsertEntry>[1]));
    assert.equal(entry(t.idx(), id)?.readOnly, true);
    assert.equal(entry(t.idx(), id)?.folderId, folder.id);
    assert.ok(entry(t.idx(), id)?.deletedAt, 'still in the trash');
    await assert.rejects(t.ops.duplicate(id), (e: unknown) => e instanceof LibraryError && e.code === 'read-only');
  });
});

describe('createFromPages, duplicate and adoptFolder', () => {
  test('createFromPages writes assets, then pages, then notebook.json', async () => {
    const t = setup();
    t.fs.putText('/src/file.pdf', '%PDF-1.7 data');
    t.fs.clearLog();
    const pages: Page[] = [
      { id: 'pg1', size: { w: 10, h: 20 }, background: { kind: 'pdf', fileId: 'pdf1', pageIndex: 0, rotation: 0 }, items: [] },
      { id: 'pg2', size: { w: 10, h: 20 }, background: { kind: 'pdf', fileId: 'pdf1', pageIndex: 1, rotation: 0 }, items: [] },
    ];
    const id = await t.ops.createFromPages({
      title: 'Lecture',
      location: { kind: 'course', code: 'CS1' },
      pages,
      assets: [{ srcPath: '/src/file.pdf', kind: 'pdf', ext: 'PDF', id: 'pdf1', pageCount: 30 }],
      origin: { kind: 'pdf', name: 'file.pdf' },
      pending: { jobId: 'j', fileId: 'pdf1', kind: 'pdf-pages', firstPageIndex: 0, insertAt: 2, nextPage: 2, total: 30 },
    });
    const paths = L.notebook(id);
    const steps = t.fs.log.filter((x) => x.op === 'copy' || x.op === 'writeText').map((x) => x.path);
    assert.deepEqual(steps, ['/src/file.pdf', `${paths.page('pg1')}.tmp`, `${paths.page('pg2')}.tmp`, `${paths.json}.tmp`]);
    const nb = await readNb(t.fs, id);
    assert.equal(nb.assets.pdf1.bytes, 13);
    assert.equal(nb.assets.pdf1.ext, 'pdf');
    assert.equal(nb.pending?.total, 30);
    const e = entry(t.idx(), id);
    assert.equal(e?.hasPdf, true);
    assert.deepEqual(e?.cover, { kind: 'pdf' });
    assert.equal(e?.needsThumb, true);
    assert.equal(e?.pageCount, 2);
  });

  test('duplicate copies the folder with a new id (through the session when it is open)', async () => {
    const t = setup();
    const reg = createRegistry({
      open: (id) => openSession(sessionDeps(t.fs), id),
      graceMs: 10,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    // The same disk and index, with the session registry wired in.
    const ops = createLibraryOps({ fs: t.fs, root: ROOT, now: t.now, newId: t.newId, index: t.index, appVersion: 'test', sessions: reg, copyTitle: (x) => `${x} (نسخة)` });
    const src = await ops.create({ title: 'أصل', location: { kind: 'unfiled' }, paper: PAPER });
    const r = await reg.acquire(src);
    assert.ok('session' in r);
    const s = r.session;
    const pid = s.notebook.pageIds[0];
    await s.loadPage(pid);
    s.addItems(pid, [{ id: 'ink', kind: 'stroke', tool: 'pen', color: '#000000', width: 2, pressure: false, pts: [1, 1, 0.5] }]);
    s.deletePages([s.addPage('end')]);
    const copy = await ops.duplicate(src);
    assert.notEqual(copy, src);
    const nb = await readNb(t.fs, copy);
    assert.equal(nb.id, copy);
    assert.equal(nb.title, 'أصل (نسخة)');
    assert.equal(nb.origin.kind, 'duplicate');
    assert.deepEqual(nb.removedPageIds, []);
    const page = JSON.parse(t.fs.getText(L.notebook(copy).page(pid)) as string) as { page: Page };
    assert.deepEqual(
      page.page.items.map((i) => i.id),
      ['ink'],
      'the open session was flushed before the copy',
    );
    assert.deepEqual(await t.fs.list(L.staging), [], 'staging cleaned');
    // Renaming the open notebook goes through its session.
    await ops.rename(src, 'مفتوح');
    assert.equal(s.notebook.title, 'مفتوح');
    assert.equal((await readNb(t.fs, src)).title, 'مفتوح');
    reg.release(src);
    await reg.evict(src);
  });

  test('adoptFolder moves a prepared folder in, clears the trash flag and the purged tombstone', async () => {
    const t = setup();
    const id = await t.ops.create({ title: 'export me', location: { kind: 'folder', id: 'missing' }, paper: PAPER });
    // Prepare a staged copy (as an import would) and remove the original.
    const job = await t.ops.stagingJob();
    await t.fs.copy(L.notebook(id).dir, `${job.dir}/nb`);
    await t.ops.purge(id);
    assert.equal(t.idx().purged.length, 1);
    const folder = t.ops.createFolder('وارد');
    const adopted = await t.ops.adoptFolder(`${job.dir}/nb`, { kind: 'folder', id: folder.id });
    assert.equal(adopted, id);
    assert.equal((await readNb(t.fs, id)).folderId, folder.id);
    assert.equal(entry(t.idx(), id)?.folderId, folder.id);
    assert.equal(entry(t.idx(), id)?.needsThumb, true);
    assert.deepEqual(t.idx().purged, []);
    await t.ops.endStagingJob(job.id);
    await assert.rejects(t.ops.adoptFolder('/src/nothing', null), (e: unknown) => e instanceof LibraryError && e.code === 'not-notebook');
  });
});

function sessionDeps(fs: MemFs): SessionDeps {
  let n = 0;
  let clock = START;
  return {
    fs,
    root: ROOT,
    now: () => (clock += 5),
    newId: () => `s${++n}`,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    appVersion: 'test',
    onIndexEntry: () => undefined,
    onSaved: () => undefined,
  };
}

describe('folders and course folders', () => {
  test('folders are mirrored to library.json', async () => {
    const t = setup();
    const a = t.ops.createFolder('  أ  ');
    const b = t.ops.createFolder('ب');
    assert.equal(b.order, a.order + 1);
    assert.throws(() => t.ops.createFolder('  '), (e: unknown) => e instanceof LibraryError && e.code === 'empty-name');
    t.ops.renameFolder(a.id, 'أول');
    t.ops.syncCourseNames([{ code: 'CS1', name: 'برمجة' }]);
    await t.ops.libraryWritten();
    const r = await readJsonRecovering(t.fs, L.library, readLibraryFile, `${ROOT}/q`, { repair: false });
    assert.ok(r.ok);
    assert.deepEqual(
      r.value.folders.map((f) => f.name),
      ['أول', 'ب'],
    );
    assert.deepEqual(r.value.courseNames, { CS1: 'برمجة' });
  });

  test('deleteFolder trash mode trashes its notebooks', async () => {
    const t = setup();
    const f = t.ops.createFolder('F');
    const a = await t.ops.create({ title: 'a', location: { kind: 'folder', id: f.id }, paper: PAPER });
    await t.ops.deleteFolder(f.id, 'trash');
    assert.ok(entry(t.idx(), a)?.deletedAt);
    assert.equal(t.idx().folders.length, 0);
  });

  test('an orphan course folder converts into a user folder; one in the timetable cannot', async () => {
    const t = setup({ chosen: ['CS102'] });
    t.ops.syncCourseNames([
      { code: 'CS102', name: 'برمجة ٢' },
      { code: 'HIST1', name: 'تاريخ' },
    ]);
    const a = await t.ops.create({ title: 'a', location: { kind: 'course', code: 'HIST1' }, paper: PAPER });
    const b = await t.ops.create({ title: 'b', location: { kind: 'course', code: 'HIST1' }, paper: PAPER });
    await t.ops.trash(b);
    const keep = await t.ops.create({ title: 'c', location: { kind: 'course', code: 'CS102' }, paper: PAPER });
    await assert.rejects(t.ops.convertCourseFolder('CS102', 'x'), (e: unknown) => e instanceof LibraryError && e.code === 'in-timetable');
    await assert.rejects(t.ops.deleteCourseFolder('CS102', 'unfile'), (e: unknown) => e instanceof LibraryError && e.code === 'in-timetable');
    const folder = await t.ops.convertCourseFolder('HIST1', 'تاريخ قديم');
    for (const id of [a, b]) {
      const nb = await readNb(t.fs, id);
      assert.equal(nb.folderId, folder.id);
      assert.equal(nb.courseCode, undefined);
      assert.equal(entry(t.idx(), id)?.folderId, folder.id);
    }
    assert.equal((await readNb(t.fs, keep)).courseCode, 'CS102');
    assert.equal(t.idx().courseNames.HIST1, undefined);
    assert.equal(t.idx().courseNames.CS102, 'برمجة ٢');
    assert.equal(t.idx().folders[0].name, 'تاريخ قديم');
  });

  test('deleteCourseFolder unfiles an orphan course folder', async () => {
    const t = setup();
    const a = await t.ops.create({ title: 'a', location: { kind: 'course', code: 'OLD' }, paper: PAPER });
    await t.ops.deleteCourseFolder('OLD', 'unfile');
    assert.equal((await readNb(t.fs, a)).courseCode, undefined);
    assert.equal(entry(t.idx(), a)?.courseCode, undefined);
  });
});

describe('boot', () => {
  test('wipes staging, cleans the inbox, purges 30-day trash and reconciles', async () => {
    const t = setup();
    const keepJob = await t.ops.stagingJob();
    t.fs.putText(`${L.staging}/oldjob/file.pdf`, 'x');
    t.fs.putText(`${L.staging}/clipboard/clipA/img.png`, 'x');
    const fresh = START + 31 * DAY - 60_000;
    t.fs.putText(`${L.inbox}/${fresh}-new.pdf`, 'x');
    t.fs.putText(`${L.inbox}/${START - 2 * DAY}-old.pdf`, 'x');
    t.fs.putText(`${L.inbox}/noprefix.pdf`, 'x');
    const old = await t.ops.create({ title: 'old', location: { kind: 'unfiled' }, paper: PAPER });
    await t.ops.trash(old);
    const live = await t.ops.create({ title: 'live', location: { kind: 'unfiled' }, paper: PAPER });
    // An index that lost an entry and has a stale one.
    t.index.update((f) => ({ ...f, entries: f.entries.filter((e) => e.id !== live).concat([{ ...f.entries[0], id: 'ghost', deletedAt: undefined }]) }));
    // A folder of an interrupted create (no notebook.json).
    await t.fs.mkdirp(L.notebook('partial').pagesDir);
    t.setClock(START + 31 * DAY);
    const report = await t.ops.boot();
    assert.equal(t.fs.hasDir(`${L.staging}/oldjob`), false);
    assert.equal(t.fs.hasDir(`${L.staging}/clipboard/clipA`), false);
    assert.equal(t.fs.hasDir(keepJob.dir), true, 'a job in use is kept');
    assert.equal(report.inboxRemoved, 2);
    assert.ok(t.fs.getText(`${L.inbox}/${fresh}-new.pdf`));
    assert.deepEqual(report.purged, [old]);
    assert.ok(t.idx().purged.some((p) => p.id === old));
    assert.deepEqual(report.added, [live]);
    assert.deepEqual(report.removed, ['ghost']);
    assert.deepEqual(report.deletedDirs, ['partial']);
    assert.equal(t.fs.hasDir(L.notebook('partial').dir), false);
    assert.ok(entry(t.idx(), live));
    assert.equal(inboxTime('1790000000-x'), 1790000000000);
    assert.equal(inboxTime('abc'), null);
  });

  test('library.json brings back folders and course names the index lost', async () => {
    const t = setup();
    const f = t.ops.createFolder('محفوظ');
    t.ops.syncCourseNames([{ code: 'K1', name: 'كيمياء' }]);
    await t.ops.libraryWritten();
    t.index.update(() => emptyIndex());
    await t.ops.boot();
    assert.deepEqual(
      t.idx().folders.map((x) => x.id),
      [f.id],
    );
    assert.equal(t.idx().courseNames.K1, 'كيمياء');
  });
});

describe('computeUsage', () => {
  test('splits PDFs, audio and ink/images, with repair:false reads only', async () => {
    const t = setup();
    t.fs.putText('/src/a.pdf', 'P'.repeat(100));
    t.fs.putText('/src/i.png', 'I'.repeat(40));
    const id = await t.ops.createFromPages({
      title: 'u',
      location: { kind: 'unfiled' },
      pages: [{ id: 'pg', size: { w: 1, h: 1 }, background: { kind: 'pdf', fileId: 'pa', pageIndex: 0, rotation: 0 }, items: [] }],
      assets: [
        { srcPath: '/src/a.pdf', kind: 'pdf', ext: 'pdf', id: 'pa' },
        { srcPath: '/src/i.png', kind: 'image', ext: 'png', id: 'im' },
      ],
      origin: { kind: 'pdf' },
    });
    await t.fs.mkdirp(L.notebook(id).audioDir);
    t.fs.putText(`${L.notebook(id).audioDir}/rec.m4a`, 'A'.repeat(70));
    t.fs.clearLog();
    const u = await computeUsage(t.fs, ROOT);
    assert.deepEqual(t.fs.log, []);
    assert.equal(u.pdf, 100);
    assert.equal(u.audio, 70);
    const pageBytes = await t.fs.size(L.notebook(id).pagesDir);
    assert.equal(u.inkAndImages, 40 + pageBytes);
    assert.equal(u.total, await t.fs.size(ROOT));
    assert.equal(u.other, u.total - u.pdf - u.audio - u.inkAndImages);
    assert.ok(u.other > 0, 'notebook.json counts as other');
  });
});
