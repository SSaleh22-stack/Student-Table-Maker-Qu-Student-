/**
 * S5 on the pure core (P30): a notebook written through its session (ink, an image, a second page,
 * a recording with marked strokes) is exported as a .qunote while it is open (packNotebook under
 * session.withWriteLock). The archive is checked (inspectQunote), and then imported the way P08
 * importQunote does it: unpack into a staging job with asCopy, ops.adoptFolder into the friend's
 * library, and endStagingJob. The copy opens, matches the original, and takes new writing without
 * touching the source. Without recordings, the audio and the marks are left out.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { joinPath } from '../../../src/notebook/core/fs/adapter.ts';
import { nbLayout } from '../../../src/notebook/core/fs/layout.ts';
import { createLibraryOps } from '../../../src/notebook/core/library/ops.ts';
import { emptyIndex } from '../../../src/notebook/core/model/index.ts';
import type { Id, IndexFile, Page, PageItem } from '../../../src/notebook/core/model/index.ts';
import { packNotebook } from '../../../src/notebook/core/qunote/pack.ts';
import { asCopy } from '../../../src/notebook/core/qunote/remap.ts';
import { inspectQunote, unpackQunote } from '../../../src/notebook/core/qunote/unpack.ts';
import { fileSource } from '../../../src/notebook/core/qunote/zipRead.ts';
import { createRegistry } from '../../../src/notebook/core/session/registry.ts';
import { openSession } from '../../../src/notebook/core/session/session.ts';
import type { NotebookSession, SessionDeps } from '../../../src/notebook/core/session/types.ts';
import { createMemFs } from '../helpers/memfs.ts';
import type { MemFs } from '../helpers/memfs.ts';

const ROOT = '/root/notebooks';
const L = nbLayout(ROOT);
const OUT = '/cache/export/notes.qunote';
const PAPER = { style: 'grid', color: 'cream', size: 'a4' } as const;

function photo(n: number, seed: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 0xff;
  // Bytes that look like a zip data descriptor must not confuse the reader.
  for (let at = 0; at + 4 <= n; at += 97) b.set([0x50, 0x4b, 0x07, 0x08], at);
  return b;
}

const JPG = photo(40_000, 5);
const M4A = photo(12_000, 9);

/** A device: disk, index, session registry and library ops. */
function device(fs: MemFs, seed: string) {
  let clock = Date.parse('2026-11-23T10:00:00.000Z');
  let n = 0;
  const now = () => (clock += 19);
  const newId = () => `${seed}${(++n).toString(36).padStart(4, '0')}`;
  let idx: IndexFile = emptyIndex();
  const deps: SessionDeps = {
    fs,
    root: ROOT,
    now,
    newId,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    appVersion: 'test',
    onIndexEntry: () => undefined,
    onSaved: () => undefined,
  };
  const reg = createRegistry({ open: (id) => openSession(deps, id), graceMs: 5, setTimer: deps.setTimer, clearTimer: deps.clearTimer });
  const ops = createLibraryOps({
    fs,
    root: ROOT,
    now,
    newId,
    appVersion: 'test',
    sessions: reg,
    index: {
      get: () => idx,
      update: (fn) => {
        idx = fn(idx);
      },
    },
  });
  const acquire = async (id: Id): Promise<NotebookSession> => {
    const r = await reg.acquire(id);
    assert.ok('session' in r, `acquire ${id}`);
    return r.session;
  };
  return { fs, ops, reg, acquire, now, newId, index: () => idx };
}

async function put(fs: MemFs, path: string, data: Uint8Array): Promise<void> {
  await fs.remove(path);
  await fs.appendBytes(path, data);
}

async function bytesOf(fs: MemFs, path: string): Promise<Uint8Array> {
  return fs.readBytes(path, 0, await fs.size(path));
}

/** The source notebook, written through its session and left OPEN (the export runs on a live one). */
async function writeSource(a: ReturnType<typeof device>) {
  await a.fs.mkdirp('/inbox');
  await put(a.fs, '/inbox/board.jpg', JPG);
  await put(a.fs, '/inbox/rec.m4a', M4A);
  const id = await a.ops.create({ title: 'كيمياء عضوية', location: { kind: 'course', code: 'CHEM101' }, paper: PAPER });
  const s = await a.acquire(id);
  const p0 = s.notebook.pageIds[0];
  await s.loadPage(p0);
  const img = await s.addAsset('/inbox/board.jpg', 'image', 'jpg', { name: 'board.jpg' });
  const audio = await s.addAsset('/inbox/rec.m4a', 'audio', 'm4a');
  s.addRecording({
    id: 'rec1',
    title: 'تسجيل 1',
    startedAt: '2026-11-23T10:00:00.000Z',
    durationMs: 60_000,
    segments: [{ fileId: audio.id, startMs: 0, durationMs: 60_000, state: 'done' }],
  });
  s.addItems(p0, [
    { id: 'ink1', kind: 'stroke', tool: 'pen', color: '#1D4ED8', width: 3, pressure: true, pts: [10, 10, 0.5, 40, 30, 0.7, 80, 35, 0.6], rec: { recordingId: 'rec1', ms: 1200 } },
    { id: 'hl1', kind: 'stroke', tool: 'highlighter', color: '#FDE047', width: 18, pressure: false, pts: [10, 60, 0.5, 200, 60, 0.5] },
    { id: 'pic', kind: 'image', fileId: img.id, box: { x: 100, y: 200, w: 300, h: 200, rot: 0 }, crop: null },
    { id: 'txt', kind: 'text', box: { x: 40, y: 450, w: 300, h: 30, rot: 0 }, text: 'تفاعل الاستبدال SN2', size: 16, color: '#1B2533', bold: true },
  ]);
  const p1 = s.addPage(p0);
  await s.loadPage(p1);
  s.addItems(p1, [{ id: 'sq', kind: 'shape', shape: 'rect', color: '#DC2626', width: 2, fill: null, box: { x: 50, y: 50, w: 120, h: 80, rot: 0 } }]);
  // Not flushed: packing under the write lock flushes first.
  return { id, s, p0, p1, img: img.id, audio: audio.id };
}

const strip = (items: PageItem[]) => items.map((i) => ({ ...i, rec: undefined, ...('fileId' in i ? { fileId: undefined } : {}) }));

/** P08 importQunote, on the core: staging job, unpack asCopy, adoptFolder, end the job. */
async function importCopy(b: ReturnType<typeof device>, archive: string, location: Parameters<ReturnType<typeof device>['ops']['adoptFolder']>[1]) {
  const job = await b.ops.stagingJob();
  const dest = joinPath(job.dir, 'nb');
  const newId = b.newId();
  const res = await unpackQunote(b.fs, fileSource(b.fs, archive), dest, {
    appVersion: 'test',
    now: b.now,
    freeBytes: 10 * 1024 * 1024 * 1024,
    transform: (nb) => asCopy(nb, { newId, now: b.now() }),
  });
  assert.equal(res.notebook.id, newId);
  const id = await b.ops.adoptFolder(dest, location);
  await b.ops.endStagingJob(job.id);
  assert.equal(await b.fs.exists(job.dir), false, 'the staging job is gone');
  return id;
}

describe('integration: .qunote round trip through ops.adoptFolder (S5)', () => {
  test('export an open notebook, import it as a copy, keep writing in the copy', async () => {
    const fs = createMemFs({ dirs: [ROOT, '/cache/export'] });
    const a = device(fs, 'a');
    const src = await writeSource(a);

    const packed = await packNotebook(fs, L.notebook(src.id).dir, OUT, { includeRecordings: true, appVersion: 'test', now: a.now }, (fn) => src.s.withWriteLock(fn));
    assert.ok(packed.bytes > JPG.length + M4A.length);
    assert.equal(src.s.getSnapshot().saveState, 'saved', 'the write lock flushed the open notebook first');

    // A stroke added after the export is not in the archive.
    src.s.addItems(src.p0, [{ id: 'late', kind: 'stroke', tool: 'pen', color: '#000000', width: 2, pressure: false, pts: [1, 1, 0.5, 2, 2, 0.5] }]);
    await src.s.flush();

    const info = await inspectQunote(fileSource(fs, OUT));
    assert.ok(!('error' in info), JSON.stringify(info));
    assert.equal(info.title, 'كيمياء عضوية');
    assert.equal(info.pageCount, 2);
    assert.equal(info.includesRecordings, true);

    // The friend's device (same memfs root, separate library: the source folder is moved aside).
    const fsB = createMemFs({ dirs: [ROOT, '/cache/export'] });
    await put(fsB, OUT, await bytesOf(fs, OUT));
    const b = device(fsB, 'b');
    const folder = b.ops.createFolder('مشترك');
    const copyId = await importCopy(b, OUT, { kind: 'folder', id: folder.id });
    assert.notEqual(copyId, src.id);

    const entry = b.index().entries.find((e) => e.id === copyId);
    assert.ok(entry, 'the copy is in the library');
    assert.equal(entry.folderId, folder.id);
    assert.equal(entry.courseCode, undefined);
    assert.equal(entry.pageCount, 2);
    assert.equal(entry.recordingCount, 1);
    assert.equal(entry.needsThumb, true, 'no cover was exported, so the worker renders one');

    const c = await b.acquire(copyId);
    assert.equal(c.notebook.title, 'كيمياء عضوية');
    assert.equal(c.notebook.origin.kind, 'qunote');
    assert.equal(c.notebook.recordings.length, 1);
    assert.deepEqual(c.notebook.pageIds, [src.p0, src.p1]);
    const q0 = await c.loadPage(src.p0);
    const q1 = await c.loadPage(src.p1);
    const o0 = await src.s.loadPage(src.p0);
    const o1 = await src.s.loadPage(src.p1);
    assert.deepEqual(
      q0.items.map((i) => i.id),
      ['ink1', 'hl1', 'pic', 'txt'],
    );
    assert.deepEqual(strip(q0.items), strip(o0.items.filter((i) => i.id !== 'late')));
    assert.deepEqual(q1.items, o1.items);
    assert.equal(q0.items[0].rec?.recordingId, 'rec1', 'marks of a kept recording stay');

    // Assets come over byte for byte.
    const pic = q0.items.find((i) => i.kind === 'image');
    assert.ok(pic && pic.kind === 'image');
    assert.deepEqual(await bytesOf(fsB, c.assetPath(pic.fileId)), JPG);
    const seg = c.notebook.recordings[0].segments[0];
    assert.deepEqual(await bytesOf(fsB, c.assetPath(seg.fileId)), M4A);

    // The friend keeps writing in their own copy.
    c.addItems(src.p1, [{ id: 'friend', kind: 'stroke', tool: 'pen', color: '#15803D', width: 3, pressure: true, pts: [5, 5, 0.5, 50, 50, 0.5] }]);
    await c.flush();
    b.reg.release(copyId);
    await new Promise((r) => setTimeout(r, 30));
    const reopened = await openSession({ fs: fsB, root: ROOT, now: b.now, newId: b.newId, setTimer: () => 0, clearTimer: () => undefined, appVersion: 'test', onIndexEntry: () => undefined, onSaved: () => undefined }, copyId);
    assert.ok('session' in reopened);
    assert.deepEqual(
      (await reopened.session.loadPage(src.p1)).items.map((i) => i.id),
      ['sq', 'friend'],
    );
    // The source is untouched by the friend's writing.
    assert.deepEqual(
      (await src.s.loadPage(src.p1)).items.map((i) => i.id),
      ['sq'],
    );
    a.reg.release(src.id);
    await new Promise((r) => setTimeout(r, 30));
  });

  test('without recordings: no audio file, no recording, no marks; importing twice gives two copies', async () => {
    const fs = createMemFs({ dirs: [ROOT, '/cache/export'] });
    const a = device(fs, 'a');
    const src = await writeSource(a);
    const packed = await packNotebook(fs, L.notebook(src.id).dir, OUT, { includeRecordings: false, appVersion: 'test', now: a.now }, (fn) => src.s.withWriteLock(fn));
    assert.equal(packed.manifest.includesRecordings, false);
    assert.ok(!packed.manifest.files.some((f) => f.path.startsWith('audio/')), 'no audio in the archive');
    assert.ok(packed.bytes < JPG.length + M4A.length);

    // Imported into the SAME library as the source: a copy with a new id, the source stays.
    const first = await importCopy(a, OUT, { kind: 'unfiled' });
    const second = await importCopy(a, OUT, null);
    assert.notEqual(first, second);
    const live = a.index().entries.filter((e) => !e.deletedAt).map((e) => e.id);
    assert.deepEqual([...live].sort(), [src.id, first, second].sort());

    const c = await a.acquire(first);
    assert.deepEqual(c.notebook.recordings, []);
    assert.ok(!Object.values(c.notebook.assets).some((x) => x.kind === 'audio'));
    const p: Page = await c.loadPage(src.p0);
    assert.equal(p.items[0].rec, undefined, 'marks of a dropped recording are stripped');
    assert.equal(p.items.length, 4);
    a.reg.release(first);
    a.reg.release(src.id);
    await new Promise((r) => setTimeout(r, 30));
  });
});
