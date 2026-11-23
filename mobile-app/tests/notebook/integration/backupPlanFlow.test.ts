/**
 * Backup on the pure core (P30, NB-85, S6): real notebooks written through sessions and library ops
 * are snapshotted from the disk the way P20 snapshot.ts does it (non-owner reads, index fields for
 * title, location and trash, purged tombstones only for ids this device uploaded). planBackup then
 * runs against a fake remote folder that applies the plan's steps.
 * - A first run uploads everything, and an edit uploads only what changed. Trashing a notebook
 *   deletes nothing remotely.
 * - A fresh device (empty library) deletes nothing and keeps every remote entry. It can restore
 *   (planRestore, download, ops.adoptFolder) and gets the same notebook back.
 * - Only a purge deletes, and only notebooks this device uploaded.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readManifest } from '../../../src/notebook/core/backup/manifest.ts';
import type { BackupManifest, LocalNotebook, LocalSnapshot } from '../../../src/notebook/core/backup/manifest.ts';
import { planBackup, planRestore } from '../../../src/notebook/core/backup/plan.ts';
import type { BackupPlan } from '../../../src/notebook/core/backup/plan.ts';
import { joinPath } from '../../../src/notebook/core/fs/adapter.ts';
import { readJsonRecovering } from '../../../src/notebook/core/fs/journal.ts';
import { nbLayout } from '../../../src/notebook/core/fs/layout.ts';
import { upsertEntry } from '../../../src/notebook/core/library/derive.ts';
import { createLibraryOps } from '../../../src/notebook/core/library/ops.ts';
import { emptyIndex, readNotebookFile, readPageFile } from '../../../src/notebook/core/model/index.ts';
import type { Id, IndexFile, StrokeItem } from '../../../src/notebook/core/model/index.ts';
import { openSession } from '../../../src/notebook/core/session/session.ts';
import type { NotebookSession, SessionDeps } from '../../../src/notebook/core/session/types.ts';
import { createMemFs } from '../helpers/memfs.ts';

const ROOT = '/root/notebooks';
const L = nbLayout(ROOT);
const PAPER = { style: 'lined', color: 'white', size: 'a4' } as const;

/** A device: its disk, index (AsyncStorage), library ops and sessions (explicit flushes only). */
function device(deviceId: string) {
  const fs = createMemFs({ dirs: [ROOT, '/media'] });
  let clock = Date.parse('2026-11-23T10:00:00.000Z');
  let n = 0;
  const now = () => (clock += 1000);
  const newId = () => `${deviceId}${(++n).toString(36).padStart(4, '0')}`;
  const index = { file: emptyIndex() as IndexFile };
  const deps: SessionDeps = {
    fs,
    root: ROOT,
    now,
    newId,
    setTimer: () => 0,
    clearTimer: () => undefined,
    appVersion: 'test',
    onIndexEntry: (e) => {
      const prev = index.file.entries.find((x) => x.id === e.id);
      // The store keeps the index-owned fields (title, location, trash) as they are (P03B).
      const merged = prev ? { ...e, title: prev.title, folderId: prev.folderId, courseCode: prev.courseCode, deletedAt: prev.deletedAt } : e;
      index.file = upsertEntry(index.file, merged);
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
    assert.ok('session' in r, `open ${id}`);
    return r.session;
  };
  /** BackupLocalState as P20 keeps it. */
  const state = { lastUploaded: {} as Record<Id, number>, libraryUploaded: undefined as number | undefined };
  return { deviceId, fs, ops, open, now, index, state };
}
type Device = ReturnType<typeof device>;

const stroke = (id: Id, x: number): StrokeItem => ({ id, kind: 'stroke', tool: 'pen', color: '#1B2533', width: 3, pressure: false, pts: [x, 10, 0.5, x + 10, 20, 0.5] });

/** P20 snapshot.ts, on memfs: non-owner reads (repair: false), index fields for title, location and trash. */
async function snapshotOf(d: Device): Promise<LocalSnapshot> {
  const { fs } = d;
  const notebooks: Record<Id, LocalNotebook> = {};
  for (const e of d.index.file.entries) {
    const paths = L.notebook(e.id);
    const r = await readJsonRecovering(fs, paths.json, readNotebookFile, paths.quarantine, { repair: false });
    if (!r.ok) continue;
    const nb = r.value;
    const files: LocalNotebook['files'] = { 'notebook.json': { rev: nb.rev, bytes: await fs.size(paths.json) } };
    for (const pid of nb.pageIds) {
      const pr = await readJsonRecovering(fs, paths.page(pid), readPageFile, paths.quarantine, { repair: false });
      if (pr.ok) files[`pages/${pid}.json`] = { rev: pr.value.rev, bytes: await fs.size(paths.page(pid)) };
    }
    for (const a of Object.values(nb.assets)) {
      const abs = paths.asset(a);
      if (await fs.exists(abs)) files[abs.slice(paths.dir.length + 1)] = { bytes: await fs.size(abs) };
    }
    const local: LocalNotebook = { title: e.title, updatedAt: nb.updatedAt, contentRev: nb.contentRev, pageCount: nb.pageIds.length, files };
    if (e.deletedAt) local.deletedAt = e.deletedAt;
    if (e.folderId) local.folderId = e.folderId;
    if (e.courseCode) local.courseCode = e.courseCode;
    notebooks[e.id] = local;
  }
  const purged: Record<Id, string> = {};
  for (const t of d.index.file.purged) if (Object.prototype.hasOwnProperty.call(d.state.lastUploaded, t.id)) purged[t.id] = t.at;
  for (const id of Object.keys(notebooks)) delete purged[id];
  return {
    deviceId: d.deviceId,
    libraryRev: d.index.file.folders.length + Object.keys(d.index.file.courseNames).length + 1,
    libraryUploaded: d.state.libraryUploaded,
    purged,
    lastUploaded: { ...d.state.lastUploaded },
    notebooks,
  };
}

/** The student's iCloud/Drive 'QU Student/Backups' folder: rel path -> bytes. */
function remoteFolder() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    manifest(): BackupManifest | null {
      const m = files.get('manifest.json');
      return m ? readManifest(JSON.parse(new TextDecoder().decode(m))) : null;
    },
    ids(): string[] {
      return [...new Set([...files.keys()].filter((k) => k.includes('/')).map((k) => k.split('/')[0]))].sort();
    },
  };
}
type Remote = ReturnType<typeof remoteFolder>;

/** Runs a plan the way the P20 service does, then records what was uploaded. */
async function run(d: Device, remote: Remote, name: string): Promise<BackupPlan> {
  const plan = planBackup(await snapshotOf(d), remote.manifest(), name, { now: new Date(d.now()).toISOString() });
  for (const step of plan.steps) {
    if (step.op === 'upload') {
      const abs = joinPath(L.notebook(step.item.notebookId).dir, step.item.file);
      remote.files.set(step.item.rel, await d.fs.readBytes(abs, 0, await d.fs.size(abs)));
    } else if (step.op === 'library') {
      remote.files.set(step.rel, new TextEncoder().encode(JSON.stringify({ folders: d.index.file.folders })));
    } else if (step.op === 'delete') {
      for (const k of [...remote.files.keys()]) if (k.startsWith(`${step.rel}/`)) remote.files.delete(k);
    } else {
      remote.files.set(step.rel, new TextEncoder().encode(step.text));
    }
  }
  if (plan.changed) {
    d.state.lastUploaded = plan.lastUploaded;
    if (plan.uploadLibrary) d.state.libraryUploaded = (await snapshotOf(d)).libraryRev;
  }
  return plan;
}

/** Every file the manifest lists is in the remote folder (a run never leaves the manifest ahead). */
function assertConsistent(remote: Remote): void {
  const m = remote.manifest();
  assert.ok(m, 'manifest written');
  for (const [id, e] of Object.entries(m.notebooks)) {
    for (const f of Object.keys(e.files)) assert.ok(remote.files.has(`${id}/${f}`), `remote has ${id}/${f}`);
  }
}

async function items(s: NotebookSession, pid: Id): Promise<Id[]> {
  return (await s.loadPage(pid)).items.map((i) => i.id);
}

describe('integration: backup plan flow over real notebooks', () => {
  test('edit sequence, fresh device, restore, trash and purge', async () => {
    const a = device('devA');
    const remote = remoteFolder();

    // Two notebooks, written through sessions.
    const n1 = await a.ops.create({ title: 'فيزياء', location: { kind: 'course', code: 'PHYS101' }, paper: PAPER });
    const n2 = await a.ops.create({ title: 'مسودة', location: { kind: 'unfiled' }, paper: PAPER });
    const s1 = await a.open(n1);
    const p0 = s1.notebook.pageIds[0];
    await s1.loadPage(p0);
    a.fs.putText('/media/board.jpg', 'JPEG whiteboard bytes');
    const img = await s1.addAsset('/media/board.jpg', 'image', 'jpg');
    s1.addItems(p0, [stroke('k1', 10), { id: 'pic', kind: 'image', fileId: img.id, box: { x: 0, y: 100, w: 200, h: 120, rot: 0 }, crop: null }]);
    await s1.flush();
    const s2 = await a.open(n2);
    await s2.loadPage(s2.notebook.pageIds[0]);
    s2.addItems(s2.notebook.pageIds[0], [stroke('d1', 30)]);
    await s2.flush();

    // 1. First run: everything goes up, the manifest last, nothing is deleted.
    const first = await run(a, remote, 'iPad');
    assert.equal(first.changed, true);
    assert.deepEqual(first.deletes, []);
    assert.equal(first.steps.at(-1)?.op, 'manifest');
    assert.ok(first.uploads.some((u) => u.rel === `${n1}/assets/${img.id}.jpg`));
    assert.deepEqual(remote.ids(), [n1, n2].sort());
    assertConsistent(remote);

    // 2. Nothing changed: no write at all.
    const idle = await run(a, remote, 'iPad');
    assert.equal(idle.changed, false);
    assert.deepEqual(idle.steps, []);

    // 3. An edit: only the edited page and notebook.json go up (the image is not sent again).
    const p1 = s1.addPage(p0);
    await s1.loadPage(p1);
    s1.addItems(p1, [stroke('k2', 50)]);
    s1.addItems(p0, [stroke('k3', 90)]);
    await s1.flush();
    const edit = await run(a, remote, 'iPad');
    assert.deepEqual(edit.uploads.map((u) => u.rel).sort(), [`${n1}/notebook.json`, `${n1}/pages/${p0}.json`, `${n1}/pages/${p1}.json`].sort());
    assert.deepEqual(edit.deletes, []);
    assertConsistent(remote);
    assert.equal(remote.manifest()?.notebooks[n1].pageCount, 2);

    // 4. Trash n2: it stays in the backup (marked deleted), nothing is deleted.
    await s2.release();
    await a.ops.trash(n2);
    const trashed = await run(a, remote, 'iPad');
    assert.deepEqual(trashed.deletes, []);
    assert.ok(remote.manifest()?.notebooks[n2].deletedAt, 'the trash state is backed up');
    assert.deepEqual(remote.ids(), [n1, n2].sort());

    // 5. A fresh device with an empty library deletes nothing and keeps every entry.
    const b = device('devB');
    const fresh = await run(b, remote, 'New phone');
    assert.deepEqual(fresh.deletes, []);
    assert.deepEqual(fresh.uploads, []);
    assert.deepEqual(Object.keys(remote.manifest()?.notebooks ?? {}).sort(), [n1, n2].sort());
    assert.deepEqual(remote.ids(), [n1, n2].sort());
    assert.ok(remote.manifest()?.devices.devB, 'the new device is listed');
    assertConsistent(remote);

    // 6. S6: the new phone restores n1 (download, then adoptFolder), and gets the same notebook.
    const actions = planRestore(remote.manifest(), [], [n1]);
    assert.equal(actions.length, 1);
    const act = actions[0];
    assert.equal(act.action, 'restore');
    if (act.action !== 'restore') return;
    const job = await b.ops.stagingJob();
    const dir = joinPath(job.dir, act.targetId);
    for (const f of act.files) {
      const bytes = remote.files.get(`${act.id}/${f}`);
      assert.ok(bytes, `download ${f}`);
      const abs = joinPath(dir, f);
      await b.fs.mkdirp(abs.slice(0, abs.lastIndexOf('/')));
      await b.fs.appendBytes(abs, bytes);
    }
    const restoredId = await b.ops.adoptFolder(dir, { kind: 'course', code: act.entry.courseCode ?? 'PHYS101' });
    await b.ops.endStagingJob(job.id);
    b.state.lastUploaded[restoredId] = act.lastUploaded;
    assert.equal(restoredId, n1);
    const r1 = await b.open(n1);
    assert.deepEqual(r1.notebook.pageIds, [p0, p1]);
    assert.deepEqual(await items(r1, p0), ['k1', 'pic', 'k3']);
    assert.deepEqual(await items(r1, p1), ['k2']);
    assert.equal(b.index.file.entries.find((e) => e.id === n1)?.courseCode, 'PHYS101');
    // Right after the restore, the new phone has nothing new to upload for n1.
    const afterRestore = await run(b, remote, 'New phone');
    assert.deepEqual(afterRestore.uploads.filter((u) => u.notebookId === n1), []);
    assert.deepEqual(afterRestore.deletes, []);

    // 7. A purge on device A deletes n2 remotely (it was uploaded from A). A purged id this device
    //    never uploaded deletes nothing.
    await a.ops.purge(n2);
    a.index.file = { ...a.index.file, purged: [...a.index.file.purged, { id: 'ghost01', at: new Date(a.now()).toISOString() }] };
    assert.ok(a.index.file.purged.some((t) => t.id === n2), 'purge recorded a tombstone');
    const purge = await run(a, remote, 'iPad');
    assert.deepEqual(purge.deletes, [n2]);
    assert.deepEqual(remote.ids(), [n1]);
    assert.equal(remote.manifest()?.notebooks[n2], undefined);
    assert.ok(remote.manifest()?.notebooks[n1], 'the other notebook is kept');
    assertConsistent(remote);

    // 8. The next run deletes nothing more.
    const calm = await run(a, remote, 'iPad');
    assert.deepEqual(calm.deletes, []);
    assert.deepEqual(remote.ids(), [n1]);
  });
});
