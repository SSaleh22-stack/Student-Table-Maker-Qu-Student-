import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  emptyManifest,
  mergeLibraryData,
  mergeManifest,
  parseManifest,
  readBackupLocalState,
  readManifest,
  rebaseManifest,
  remoteNotebooks,
  serializeManifest,
  summarizeManifest,
} from '../../../src/notebook/core/backup/manifest.ts';
import type { BackupManifest, LocalNotebook, LocalSnapshot } from '../../../src/notebook/core/backup/manifest.ts';
import { copyTitle, mimeOf, planBackup, planRestore, RESTORE_SUFFIX } from '../../../src/notebook/core/backup/plan.ts';
import type { BackupPlan, BackupStep } from '../../../src/notebook/core/backup/plan.ts';

const T0 = '2026-11-20T10:00:00.000Z';
const T1 = '2026-11-21T10:00:00.000Z';
const T2 = '2026-11-22T10:00:00.000Z';
const T3 = '2026-11-23T10:00:00.000Z';

function nb(title: string, contentRev: number, updatedAt: string, pages: Record<string, number>, extra: Record<string, number> = {}): LocalNotebook {
  const files: LocalNotebook['files'] = { 'notebook.json': { rev: contentRev, bytes: 500 + contentRev } };
  for (const [pid, rev] of Object.entries(pages)) files[`pages/${pid}.json`] = { rev, bytes: 1000 + rev };
  for (const [file, bytes] of Object.entries(extra)) files[file] = { bytes };
  return { title, updatedAt, contentRev, pageCount: Object.keys(pages).length, files };
}

function snap(deviceId: string, notebooks: Record<string, LocalNotebook>, o: Partial<LocalSnapshot> = {}): LocalSnapshot {
  return { deviceId, libraryRev: 1, purged: {}, lastUploaded: {}, notebooks, ...o };
}

/** What P20 does after a successful run: remember what was uploaded. */
function after(local: LocalSnapshot, plan: BackupPlan): LocalSnapshot {
  return { ...local, lastUploaded: plan.lastUploaded, libraryUploaded: plan.uploadLibrary ? local.libraryRev : local.libraryUploaded };
}

/** The remote manifest after the plan ran (null when nothing was written). */
function remoteAfter(remote: BackupManifest | null, plan: BackupPlan): BackupManifest | null {
  const last = plan.steps.at(-1);
  if (!last) return remote;
  assert.equal(last.op, 'manifest');
  return readManifest(JSON.parse((last as Extract<BackupStep, { op: 'manifest' }>).text));
}

const ops = (p: BackupPlan) => p.steps.map((s) => (s.op === 'upload' ? `up:${s.item.rel}` : s.op === 'delete' ? `del:${s.rel}` : s.op === 'manifest' ? `manifest${s.final ? '' : ':checkpoint'}` : 'library'));

describe('planBackup: first and incremental runs', () => {
  const local = snap('devA', {
    n1: nb('فيزياء', 3, T1, { p1: 2, p2: 1 }, { 'assets/img1.png': 2048, 'audio/r1.m4a': 9000 }),
    n2: nb('Calculus', 1, T0, { q1: 1 }),
  });

  test('first run uploads everything in order, manifest last, deletes nothing', () => {
    const p = planBackup(local, null, 'iPad', { now: T3 });
    assert.deepEqual(ops(p), [
      'up:n1/assets/img1.png',
      'up:n1/audio/r1.m4a',
      'up:n1/pages/p1.json',
      'up:n1/pages/p2.json',
      'up:n1/notebook.json',
      'up:n2/pages/q1.json',
      'up:n2/notebook.json',
      'library',
      'manifest',
    ]);
    assert.deepEqual(p.deletes, []);
    assert.deepEqual(p.skippedConflicts, []);
    assert.equal(p.changed, true);
    assert.equal(p.manifest.notebooks.n1.deviceId, 'devA');
    assert.equal(p.manifest.notebooks.n1.bytes, 503 + 1002 + 1001 + 2048 + 9000);
    assert.deepEqual(p.manifest.devices, { devA: { name: 'iPad', lastAt: T3 } });
    assert.deepEqual(p.lastUploaded, { n1: 3, n2: 1 });
    assert.equal(p.totalBytes, p.uploads.reduce((s, u) => s + u.bytes, 0));
    assert.equal(p.uploads.find((u) => u.file === 'audio/r1.m4a')?.mime, 'audio/mp4');
  });

  test('incremental run uploads only changed pages, new assets and notebook.json', () => {
    const p1 = planBackup(local, null, 'iPad', { now: T3 });
    const remote = remoteAfter(null, p1);
    const l2 = after(local, p1);
    const changed = nb('فيزياء', 4, T2, { p1: 2, p2: 2, p3: 1 }, { 'assets/img1.png': 2048, 'audio/r1.m4a': 9000, 'assets/doc.pdf': 4000 });
    const local2 = { ...l2, notebooks: { ...l2.notebooks, n1: changed } };
    const p2 = planBackup(local2, remote, 'iPad', { now: T3 });
    assert.deepEqual(ops(p2), ['up:n1/assets/doc.pdf', 'up:n1/pages/p2.json', 'up:n1/pages/p3.json', 'up:n1/notebook.json', 'manifest']);
    assert.equal(p2.manifest.notebooks.n1.contentRev, 4);
    assert.equal(p2.manifest.notebooks.n2.contentRev, 1);
    assert.deepEqual(p2.lastUploaded, { n1: 4, n2: 1 });

    // Nothing changed since: no write at all.
    const p3 = planBackup(after(local2, p2), remoteAfter(remote, p2), 'iPad', { now: T3 });
    assert.equal(p3.changed, false);
    assert.deepEqual(p3.steps, []);
  });

  test('a trashed notebook stays, with deletedAt, without re-uploading its files', () => {
    const p1 = planBackup(local, null, 'iPad', { now: T1 });
    const remote = remoteAfter(null, p1);
    const l2 = after(local, p1);
    const trashed = { ...l2, notebooks: { ...l2.notebooks, n2: { ...l2.notebooks.n2, deletedAt: T2 } } };
    const p2 = planBackup(trashed, remote, 'iPad', { now: T3 });
    assert.deepEqual(ops(p2), ['manifest']);
    assert.equal(p2.manifest.notebooks.n2.deletedAt, T2);
    assert.deepEqual(p2.deletes, []);
  });

  test('a large first run writes checkpoint manifests between notebooks', () => {
    const p = planBackup(local, null, 'iPad', { now: T3, checkpointBytes: 1000 });
    assert.deepEqual(ops(p).filter((o) => o.startsWith('manifest')), ['manifest:checkpoint', 'manifest']);
    const cp = p.steps.find((s) => s.op === 'manifest' && !s.final) as Extract<BackupStep, { op: 'manifest' }>;
    assert.deepEqual(Object.keys(cp.manifest.notebooks), ['n1']);
    assert.deepEqual(cp.lastUploaded, { n1: 3 });
    assert.equal(p.steps.at(-1)?.op, 'manifest');
  });

  test('a snapshot without notebook.json is left alone', () => {
    const broken: LocalNotebook = { ...nb('x', 1, T0, { a: 1 }), files: { 'pages/a.json': { rev: 1, bytes: 9 } } };
    const p = planBackup(snap('devA', { bad: broken }), null, 'iPad', { now: T3 });
    assert.ok(p.uploads.every((u) => u.notebookId !== 'bad'));
    assert.equal(p.manifest.notebooks.bad, undefined);
  });
});

describe('planBackup: never deletes what is not purged', () => {
  const remoteFromA = (() => {
    const a = snap('devA', { n1: nb('One', 2, T0, { p1: 1 }), n2: nb('Two', 5, T1, { p1: 3 }), n3: nb('Three', 1, T1, {}) });
    return remoteAfter(null, planBackup(a, null, 'Phone A', { now: T1 }))!;
  })();

  test('a fresh device with an empty library deletes nothing and keeps every entry', () => {
    const fresh = snap('devB', {}, { libraryRev: 0 });
    const p = planBackup(fresh, remoteFromA, 'Tablet B', { now: T3 });
    assert.deepEqual(p.deletes, []);
    assert.ok(p.steps.every((s) => s.op !== 'delete' && s.op !== 'upload'));
    assert.deepEqual(Object.keys(p.manifest.notebooks).sort(), ['n1', 'n2', 'n3']);
    for (const id of ['n1', 'n2', 'n3']) assert.deepEqual(p.manifest.notebooks[id], remoteFromA.notebooks[id]);
    assert.deepEqual(Object.keys(p.manifest.devices).sort(), ['devA', 'devB']);
    // library.json is (union-)merged, never replaced by an empty one: see mergeLibraryData.
    assert.equal(p.uploadLibrary, true);
  });

  test('a purged id is deleted remotely; an unknown purged id and a missing local id are not', () => {
    const a = snap('devA', { n1: nb('One', 2, T0, { p1: 1 }) }, {
      purged: { n2: T2, ghost: T2 },
      lastUploaded: { n1: 2, n2: 5, n3: 1 },
      libraryUploaded: 1,
    });
    const p = planBackup(a, remoteFromA, 'Phone A', { now: T3 });
    assert.deepEqual(p.deletes, ['n2']);
    assert.deepEqual(ops(p), ['del:n2', 'manifest']);
    assert.ok(p.manifest.notebooks.n3, 'n3 is gone locally but not purged: kept');
    assert.equal(p.manifest.notebooks.n2, undefined);
    assert.equal(p.lastUploaded.n2, undefined);
    assert.equal(p.lastUploaded.n3, 1);
  });

  test('the delete comes after the library and before the final manifest', () => {
    const a = snap('devA', {}, { purged: { n1: T2 }, libraryRev: 7, libraryUploaded: 3 });
    const p = planBackup(a, remoteFromA, 'Phone A', { now: T3 });
    assert.deepEqual(ops(p), ['library', 'del:n1', 'manifest']);
  });

  test('a purged id that another device changed after the purge is kept and reported', () => {
    const remote: BackupManifest = structuredClone(remoteFromA);
    remote.notebooks.n2 = { ...remote.notebooks.n2, deviceId: 'devB', contentRev: 9, updatedAt: T3 };
    const a = snap('devA', {}, { purged: { n2: T2 }, lastUploaded: { n2: 5 }, libraryUploaded: 1 });
    const p = planBackup(a, remote, 'Phone A', { now: T3 });
    assert.deepEqual(p.deletes, []);
    assert.deepEqual(p.skippedConflicts, ['n2']);
    assert.deepEqual(p.manifest.notebooks.n2, remote.notebooks.n2);
  });
});

describe('planBackup: a purge on one device while another still has the notebook', () => {
  test('deleted once, then the other device’s re-upload is kept (no delete/re-upload ping-pong)', () => {
    let a = snap('devA', { x: nb('X', 2, T0, { p: 1 }) });
    const pa1 = planBackup(a, null, 'iPad', { now: T0 });
    let remote = remoteAfter(null, pa1);
    a = after(a, pa1);

    // B restores x and keeps it.
    const r = planRestore(remote, [], ['x'])[0];
    let b = snap('devB', { x: nb('X', 2, T0, { p: 1 }) }, { lastUploaded: { x: r.action === 'restore' ? r.lastUploaded : -1 } });

    // A purges x at T1 and backs up: x is A's, so it is deleted.
    a = { ...a, notebooks: {}, purged: { x: T1 }, libraryUploaded: a.libraryRev };
    const pa2 = planBackup(a, remote, 'iPad', { now: T1 });
    assert.deepEqual(pa2.deletes, ['x']);
    remote = remoteAfter(remote, pa2);
    a = after(a, pa2);

    // B still has x: its next run uploads it again (B owns it now).
    const pb1 = planBackup(b, remote, 'Galaxy', { now: T2 });
    assert.ok(pb1.uploads.some((u) => u.notebookId === 'x'));
    remote = remoteAfter(remote, pb1);
    b = after(b, pb1);
    assert.equal(remote!.notebooks.x.deviceId, 'devB');

    // A does not delete it again, and does not report a conflict for it.
    const pa3 = planBackup(a, remote, 'iPad', { now: T3 });
    assert.deepEqual(pa3.deletes, []);
    assert.deepEqual(pa3.skippedConflicts, []);
    assert.ok(pa3.manifest.notebooks.x);
    assert.equal(pa3.changed, false);
  });

  test('another device’s entry is still deleted when that device has not run since the purge', () => {
    const remote = emptyManifest(T0);
    remote.devices.devB = { name: 'Old phone', lastAt: T0 };
    remote.notebooks.x = { title: 'X', updatedAt: T0, contentRev: 2, pageCount: 0, bytes: 1, deviceId: 'devB', files: { 'notebook.json': { rev: 2, bytes: 1 } } };
    const a = snap('devA', {}, { purged: { x: T1 }, lastUploaded: { x: 2 }, libraryUploaded: 1 });
    const p = planBackup(a, remote, 'iPad', { now: T2 });
    assert.deepEqual(p.deletes, ['x']);
  });
});

describe('planBackup: two devices, interleaved runs', () => {
  test('each keeps the other one’s notebooks; a conflict is skipped, never overwritten', () => {
    // A backs up a1.
    let a = snap('devA', { a1: nb('A one', 1, T0, { p: 1 }) });
    const pa1 = planBackup(a, null, 'iPad', { now: T0 });
    let remote = remoteAfter(null, pa1);
    a = after(a, pa1);

    // B (fresh) backs up b1; a1 stays.
    let b = snap('devB', { b1: nb('B one', 1, T1, { q: 1 }) });
    const pb1 = planBackup(b, remote, 'Galaxy', { now: T1 });
    assert.deepEqual(pb1.deletes, []);
    remote = remoteAfter(remote, pb1);
    b = after(b, pb1);
    assert.deepEqual(Object.keys(remote!.notebooks).sort(), ['a1', 'b1']);
    assert.equal(remote!.notebooks.a1.deviceId, 'devA');

    // A runs again with a new notebook; b1 stays untouched.
    a = { ...a, notebooks: { ...a.notebooks, a2: nb('A two', 1, T1, { p: 1 }) } };
    const pa2 = planBackup(a, remote, 'iPad', { now: T1 });
    assert.ok(pa2.uploads.every((u) => u.notebookId === 'a2'));
    remote = remoteAfter(remote, pa2);
    a = after(a, pa2);
    assert.deepEqual(remote!.notebooks.b1, pb1.manifest.notebooks.b1);

    // B restores a1 (same id; lastUploaded = remote contentRev), edits it and backs it up: B owns it now.
    const restored = planRestore(remote, [], ['a1'])[0];
    assert.equal(restored.action, 'restore');
    b = {
      ...b,
      lastUploaded: { ...b.lastUploaded, a1: restored.action === 'restore' ? restored.lastUploaded : -1 },
      notebooks: { ...b.notebooks, a1: nb('A one', 2, T2, { p: 2 }) },
    };
    const pb2 = planBackup(b, remote, 'Galaxy', { now: T2 });
    assert.deepEqual(pb2.skippedConflicts, []);
    assert.deepEqual(ops(pb2), ['up:a1/pages/p.json', 'up:a1/notebook.json', 'manifest']);
    remote = remoteAfter(remote, pb2);
    b = after(b, pb2);
    assert.equal(remote!.notebooks.a1.deviceId, 'devB');

    // A edits its old copy of a1 too: conflict, skipped, B's entry untouched.
    a = { ...a, notebooks: { ...a.notebooks, a1: nb('A one (edited on A)', 2, T3, { p: 5 }) } };
    const pa3 = planBackup(a, remote, 'iPad', { now: T3 });
    assert.deepEqual(pa3.skippedConflicts, ['a1']);
    assert.ok(pa3.uploads.every((u) => u.notebookId !== 'a1'));
    assert.deepEqual(pa3.manifest.notebooks.a1, remote!.notebooks.a1);
    assert.deepEqual(pa3.deletes, []);
    assert.ok(pa3.manifest.notebooks.b1 && pa3.manifest.notebooks.a2);

    // A without local edits since its own upload: silently leaves B's newer copy alone.
    const aQuiet = { ...a, notebooks: { ...a.notebooks, a1: nb('A one', 1, T0, { p: 1 }) } };
    const pa4 = planBackup(aQuiet, remote, 'iPad', { now: T3 });
    assert.deepEqual(pa4.skippedConflicts, []);
    assert.equal(pa4.changed, false);

    // B keeps a2 after its own runs: nobody ever deleted anything.
    const pb3 = planBackup(b, remoteAfter(remote, pa3), 'Galaxy', { now: T3 });
    assert.deepEqual(pb3.deletes, []);
    assert.ok(pb3.manifest.notebooks.a2);
  });
});

describe('planRestore', () => {
  const remote = remoteAfter(null, planBackup(snap('devA', { n1: nb('محاضرة', 5, T2, { p1: 3 }, { 'assets/x.pdf': 10 }), n2: nb('Two', 2, T1, {}) }), null, 'iPad', { now: T2 }))!;
  let k = 0;
  const newId = () => `copy${++k}aaaaaaaaaaaa`.slice(0, 16);

  test('absent locally: restore under the same id, files notebook.json first', () => {
    const [a] = planRestore(remote, [], ['n1']);
    assert.equal(a.action, 'restore');
    if (a.action !== 'restore') return;
    assert.equal(a.targetId, 'n1');
    assert.equal(a.lastUploaded, 5);
    assert.deepEqual(a.files, ['notebook.json', 'pages/p1.json', 'assets/x.pdf']);
  });

  test('newer locally: keep both, the copy gets a new id and the suffix', () => {
    const [a] = planRestore(remote, [{ id: 'n1', contentRev: 7, updatedAt: T3 }], ['n1'], { newId });
    assert.equal(a.action, 'copy');
    if (a.action !== 'copy') return;
    assert.notEqual(a.targetId, 'n1');
    assert.equal(a.title, 'محاضرة (نسخة احتياطية)');
  });

  test('changed locally since the last upload counts as newer even with a lower contentRev', () => {
    const [a] = planRestore(remote, [{ id: 'n1', contentRev: 4, updatedAt: T0 }], ['n1'], { newId, lastUploaded: { n1: 3 } });
    assert.equal(a.action, 'copy');
  });

  test('older locally: replace; identical: skip; unknown: skip missing; duplicates ignored', () => {
    const r = planRestore(
      remote,
      [
        { id: 'n1', contentRev: 2, updatedAt: T0 },
        { id: 'n2', contentRev: 2, updatedAt: T1 },
      ],
      ['n1', 'n2', 'zz', 'n1'],
      { newId, lastUploaded: { n1: 2, n2: 2 } },
    );
    assert.deepEqual(
      r.map((x) => x.action),
      ['replace', 'skip', 'skip'],
    );
    assert.deepEqual(r[1], { action: 'skip', id: 'n2', reason: 'same' });
    assert.deepEqual(r[2], { action: 'skip', id: 'zz', reason: 'missing' });
  });

  test('older locally but with no upload history: copy, never replace', () => {
    const [a] = planRestore(remote, [{ id: 'n1', contentRev: 2, updatedAt: T0 }], ['n1'], { newId });
    assert.equal(a.action, 'copy');
    const [b] = planRestore(remote, [{ id: 'n1', contentRev: 2, updatedAt: T0 }], ['n1'], { newId, lastUploaded: { n1: 1 } });
    assert.equal(b.action, 'copy', 'changed since the last upload');
  });

  test('copy ids never collide with local or remote ids', () => {
    const ids = ['n2aaaaaaaaaaaaaa', 'n2', 'freshidaaaaaaaaa'];
    let i = 0;
    const [a] = planRestore(remote, [{ id: 'n2', contentRev: 9, updatedAt: T3 }, { id: 'n2aaaaaaaaaaaaaa', contentRev: 1, updatedAt: T0 }], ['n2'], { newId: () => ids[i++] });
    assert.equal(a.action === 'copy' && a.targetId, 'freshidaaaaaaaaa');
  });

  test('copyTitle stays within 200 characters', () => {
    const t = copyTitle('x'.repeat(300));
    assert.equal(t.length, 200);
    assert.ok(t.endsWith(RESTORE_SUFFIX));
  });
});

describe('manifest helpers', () => {
  test('mergeManifest keeps other devices’ entries and updates the devices map', () => {
    const remote = emptyManifest(T0);
    remote.devices.devB = { name: 'Galaxy', lastAt: T0 };
    remote.notebooks.b1 = { title: 'B', updatedAt: T0, contentRev: 1, pageCount: 0, bytes: 1, deviceId: 'devB', files: {} };
    remote.notebooks.gone = { title: 'G', updatedAt: T0, contentRev: 1, pageCount: 0, bytes: 1, deviceId: 'devA', files: {} };
    const before = structuredClone(remote);
    const m = mergeManifest(
      remote,
      { updatedAt: T2, removed: ['gone'], notebooks: { a1: { title: 'A', updatedAt: T2, contentRev: 3, pageCount: 1, bytes: 9, deviceId: 'whoever', files: { 'notebook.json': { rev: 3, bytes: 9 } } } } },
      'devA',
      'iPad',
    );
    assert.deepEqual(remote, before, 'inputs are not changed');
    assert.deepEqual(m.notebooks.b1, remote.notebooks.b1);
    assert.equal(m.notebooks.a1.deviceId, 'devA');
    assert.equal(m.notebooks.gone, undefined);
    assert.deepEqual(m.devices, { devB: { name: 'Galaxy', lastAt: T0 }, devA: { name: 'iPad', lastAt: T2 } });
  });

  test('rebaseManifest: a manifest written by another device during the run is not lost', () => {
    const base = emptyManifest(T0);
    base.devices.devB = { name: 'Galaxy', lastAt: T0 };
    base.notebooks.b1 = { title: 'B1', updatedAt: T0, contentRev: 1, pageCount: 0, bytes: 1, deviceId: 'devB', files: {} };
    base.notebooks.x = { title: 'X', updatedAt: T0, contentRev: 1, pageCount: 0, bytes: 1, deviceId: 'devA', files: {} };
    base.notebooks.gone = { title: 'G', updatedAt: T0, contentRev: 1, pageCount: 0, bytes: 1, deviceId: 'devA', files: {} };
    const local = snap('devA', { a1: nb('A1', 1, T2, { p1: 1 }), x: nb('X', 2, T2, { p1: 2 }) }, { purged: { gone: T1 }, lastUploaded: { x: 1, gone: 1 }, libraryUploaded: 1 });
    const plan = planBackup(local, base, 'iPad', { now: T2 });
    const step = plan.steps.at(-1) as Extract<BackupStep, { op: 'manifest' }>;
    assert.equal(step.final, true);
    assert.deepEqual(plan.deletes, ['gone']);

    // Unchanged server: exactly the planned manifest.
    const same = rebaseManifest(base, structuredClone(base), step.mine, 'devA', 'iPad');
    assert.equal(serializeManifest(same.manifest), step.text);
    assert.deepEqual(same.conflicts, []);

    // Meanwhile devB added b2, changed x and re-uploaded gone.
    const fresh = structuredClone(base);
    fresh.devices.devB = { name: 'Galaxy', lastAt: T2 };
    fresh.notebooks.b2 = { title: 'B2', updatedAt: T2, contentRev: 1, pageCount: 0, bytes: 1, deviceId: 'devB', files: {} };
    fresh.notebooks.x = { title: 'X on B', updatedAt: T2, contentRev: 3, pageCount: 0, bytes: 1, deviceId: 'devB', files: {} };
    fresh.notebooks.gone = { title: 'G', updatedAt: T2, contentRev: 2, pageCount: 0, bytes: 1, deviceId: 'devB', files: {} };
    const r = rebaseManifest(base, fresh, step.mine, 'devA', 'iPad');
    assert.deepEqual(r.conflicts, ['x']);
    assert.deepEqual(Object.keys(r.manifest.notebooks).sort(), ['a1', 'b1', 'b2', 'gone', 'x']);
    assert.equal(r.manifest.notebooks.x.title, 'X on B', 'the other device’s newer entry wins');
    assert.equal(r.manifest.notebooks.a1.deviceId, 'devA');
    assert.equal(r.manifest.notebooks.gone.deviceId, 'devB', 'a re-uploaded purged id is not dropped');
    assert.deepEqual(r.manifest.devices.devB, { name: 'Galaxy', lastAt: T2 });
    assert.equal(r.manifest.devices.devA.name, 'iPad');
  });

  test('parseManifest: missing, invalid, newer, and a lenient round trip', () => {
    assert.deepEqual(parseManifest(null), { ok: false, reason: 'missing' });
    assert.deepEqual(parseManifest('{"format":"qu-backup","version":1'), { ok: false, reason: 'invalid' });
    assert.deepEqual(parseManifest('{"format":"qu-backup","version":2}'), { ok: false, reason: 'newer' });
    const m = emptyManifest(T0);
    m.notebooks.n1 = { title: 'x', updatedAt: T0, contentRev: 2, pageCount: 1, bytes: 3, deviceId: 'devA', files: { 'pages/p.json': { rev: 1, bytes: 3 } } };
    const raw = JSON.parse(serializeManifest(m));
    raw.notebooks.n1.pageCount = 'oops';
    raw.notebooks['../evil'] = raw.notebooks.n1;
    raw.notebooks.n1.files['../../x'] = { bytes: 1 };
    const back = parseManifest(JSON.stringify(raw));
    assert.ok(back.ok);
    if (!back.ok) return;
    assert.deepEqual(Object.keys(back.manifest.notebooks), ['n1']);
    assert.equal(back.manifest.notebooks.n1.pageCount, 0);
    assert.deepEqual(Object.keys(back.manifest.notebooks.n1.files), ['pages/p.json']);
  });

  test('readBackupLocalState', () => {
    assert.equal(readBackupLocalState({}), null);
    const s = readBackupLocalState({ deviceId: 'abc', lastUploaded: { n1: 3, bad: 'x', '../x': 1 }, conflicts: ['n1', 'n1', 7], drive: { rootId: 'r', backupsId: 'b', folderIds: { n1: 'f1' } }, libraryUploaded: 4 });
    assert.deepEqual(s, { deviceId: 'abc', lastUploaded: { n1: 3 }, conflicts: ['n1'], libraryUploaded: 4, drive: { rootId: 'r', backupsId: 'b', folderIds: { n1: 'f1' } } });
  });

  test('summarizeManifest, remoteNotebooks and mergeLibraryData', () => {
    const m = emptyManifest(T0);
    m.devices = { devA: { name: 'iPad', lastAt: T0 }, devB: { name: 'Galaxy', lastAt: T1 } };
    m.notebooks.n1 = { title: 'old', updatedAt: T0, contentRev: 1, pageCount: 1, bytes: 1, deviceId: 'devB', files: {} };
    m.notebooks.n2 = { title: 'new', updatedAt: T2, contentRev: 1, pageCount: 2, bytes: 2, deviceId: 'devA', files: {}, deletedAt: T2 };
    assert.deepEqual(summarizeManifest(m, 'devA'), { hasBackup: true, notebooks: 1, devices: ['Galaxy'] });
    assert.deepEqual(summarizeManifest(null, 'devA'), { hasBackup: false, notebooks: 0, devices: [] });
    const rows = remoteNotebooks(m, ['n1']);
    assert.deepEqual(rows.map((r) => [r.id, r.existsLocally, r.deviceName, r.deletedAt]), [
      ['n2', false, 'iPad', T2],
      ['n1', true, 'Galaxy', undefined],
    ]);
    const lib = mergeLibraryData(
      { folders: [{ id: 'f1', name: 'Remote', createdAt: T0, order: 1 }, { id: 'f2', name: 'Other device', createdAt: T0, order: 2 }], courseNames: { PHYS101: 'Physics', MATH: 'Remote' } },
      { folders: [{ id: 'f1', name: 'Local', createdAt: T0, order: 0 }], courseNames: { MATH: 'Calculus' } },
    );
    assert.deepEqual(lib.folders.map((f) => f.name), ['Local', 'Other device']);
    assert.deepEqual(lib.courseNames, { PHYS101: 'Physics', MATH: 'Calculus' });
    assert.equal(mimeOf('assets/a.PDF'), 'application/pdf');
    assert.equal(mimeOf('assets/a.bin'), 'application/octet-stream');
  });
});
