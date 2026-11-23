/**
 * Cut and paste across notebooks on the pure core (P30, NB-43 lasso, S4): an image and ink are cut
 * from notebook A (stageClipboard copies the image into .staging/clipboard). A is then released for
 * good, so GC deletes the now unreferenced image from A, and A is even trashed and purged. A library
 * boot meanwhile keeps the live clipboard folder. The items are pasted into notebook B (one undo
 * step, new ids, the asset copied into B), B is saved, and a fresh open of B from disk shows them
 * with the image bytes. Discarding the clipboard removes its staging folder.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { nbLayout } from '../../../src/notebook/core/fs/layout.ts';
import { discardClipboard, liveClipIds, pasteClipboard, stageClipboard } from '../../../src/notebook/core/library/clipboard.ts';
import { createLibraryOps } from '../../../src/notebook/core/library/ops.ts';
import { emptyIndex } from '../../../src/notebook/core/model/index.ts';
import type { Id, ImageItem, IndexFile } from '../../../src/notebook/core/model/index.ts';
import { createRegistry } from '../../../src/notebook/core/session/registry.ts';
import { openSession } from '../../../src/notebook/core/session/session.ts';
import type { NotebookSession, SessionDeps } from '../../../src/notebook/core/session/types.ts';
import { createMemFs } from '../helpers/memfs.ts';

const ROOT = '/root/notebooks';
const L = nbLayout(ROOT);
const PAPER = { style: 'blank', color: 'white', size: 'a4' } as const;
const PHOTO = 'JPEG bytes of the whiteboard photo';
const GRACE_MS = 5;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function world() {
  const fs = createMemFs({ dirs: [ROOT, '/camera'] });
  let n = 0;
  let clock = Date.parse('2026-11-23T10:00:00.000Z');
  const newId = () => `w${(++n).toString(36).padStart(4, '0')}`;
  const now = () => (clock += 23);
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
  const reg = createRegistry({ open: (id) => openSession(deps, id), graceMs: GRACE_MS, setTimer: deps.setTimer, clearTimer: deps.clearTimer });
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
  return { fs, deps, reg, ops, acquire, newId, index: () => idx };
}

describe('integration: clipboard across notebooks', () => {
  test('cut an image in A, release and purge A, paste into B, reopen B from disk', async () => {
    const w = world();
    w.fs.putText('/camera/board.jpg', PHOTO);
    const a = await w.ops.create({ title: 'A', location: { kind: 'unfiled' }, paper: PAPER });
    const b = await w.ops.create({ title: 'B', location: { kind: 'course', code: 'MATH101' }, paper: PAPER });

    // A: an image (from the camera) and a stroke.
    const sa = await w.acquire(a);
    const pa = sa.notebook.pageIds[0];
    await sa.loadPage(pa);
    const asset = await sa.addAsset('/camera/board.jpg', 'image', 'jpg', { name: 'board.jpg' });
    sa.addItems(pa, [
      { id: 'img', kind: 'image', fileId: asset.id, box: { x: 20, y: 40, w: 240, h: 160, rot: 0.1 }, crop: { x: 0, y: 0, w: 0.5, h: 1 } },
      { id: 'ink', kind: 'stroke', tool: 'pen', color: '#DC2626', width: 3, pressure: true, pts: [30, 220, 0.5, 90, 240, 0.6] },
    ]);
    await sa.flush();
    const assetFile = L.notebook(a).asset(asset);
    assert.equal(w.fs.getText(assetFile), PHOTO);

    // Cut: stage the selection, then remove it (the lasso menu's 'قص').
    const selection = (sa.getPage(pa)?.items ?? []).slice();
    const clip = await stageClipboard(w.fs, ROOT, sa, selection, w.newId);
    sa.removeItems(pa, ['img', 'ink'], 'cut');
    assert.equal(clip.assets.length, 1);
    assert.ok(liveClipIds().has(clip.clipId));

    // The editor closes: after the grace, the final release flushes and GC drops the image from A.
    w.reg.release(a);
    await wait(GRACE_MS * 6);
    assert.equal(w.reg.get(a), null, 'A is closed');
    assert.equal(w.fs.getText(assetFile), null, 'GC removed the cut image from A');

    // A library boot (another screen) keeps the live clipboard folder.
    await w.ops.boot();
    assert.equal(w.fs.getText(clip.assets[0].stagedPath), PHOTO, 'the staged copy survives boot');

    // A is trashed and purged: its whole folder is gone, the clipboard still holds the image.
    await w.ops.trash(a);
    await w.ops.purge(a);
    assert.equal(w.fs.hasDir(L.notebook(a).dir), false);

    // Paste into B.
    const sb = await w.acquire(b);
    const pb = sb.notebook.pageIds[0];
    const pasted = await pasteClipboard(sb, pb, clip, { dx: 15, dy: 25 }, w.newId);
    assert.equal(pasted.length, 2);
    const img = sb.getPage(pb)?.items.find((i) => i.kind === 'image') as ImageItem | undefined;
    assert.ok(img);
    assert.ok(!['img', 'ink'].includes(img.id), 'new item ids');
    assert.deepEqual(img.box, { x: 35, y: 65, w: 240, h: 160, rot: 0.1 });
    assert.deepEqual(img.crop, { x: 0, y: 0, w: 0.5, h: 1 });
    assert.equal(w.fs.getText(sb.assetPath(img.fileId)), PHOTO, 'the image was copied into B');

    // One undo step, and redo brings it back.
    assert.equal(sb.undo(), true);
    assert.deepEqual(sb.getPage(pb)?.items, []);
    assert.equal(sb.redo(), true);
    assert.equal(sb.getPage(pb)?.items.length, 2);
    await sb.flush();

    // A second paste reuses B's copy of the image (one asset, one file).
    await pasteClipboard(sb, pb, clip, { dx: 300, dy: 0 }, w.newId);
    assert.equal(Object.values(sb.notebook.assets).filter((x) => x.kind === 'image').length, 1);
    await sb.flush();

    // The clipboard is discarded (a new copy replaces it); B does not need it any more.
    await discardClipboard(w.fs, ROOT, clip);
    assert.equal(liveClipIds().has(clip.clipId), false);
    assert.equal(w.fs.hasDir(L.clipboardDir(clip.clipId)), false);
    w.reg.release(b);
    await wait(GRACE_MS * 6);
    assert.equal(w.reg.get(b), null);

    // A fresh open of B from disk (a new app run): both pastes and the image are there.
    const r = await openSession({ ...w.deps, setTimer: () => 0, clearTimer: () => undefined }, b);
    assert.ok('session' in r);
    const page = await r.session.loadPage(pb);
    assert.equal(page.items.length, 4);
    const images = page.items.filter((i): i is ImageItem => i.kind === 'image');
    assert.equal(images.length, 2);
    assert.equal(images[0].fileId, images[1].fileId);
    assert.ok(r.session.notebook.assets[images[0].fileId]);
    assert.equal(w.fs.getText(r.session.assetPath(images[0].fileId)), PHOTO);
    // A's purge left a tombstone; B's entry is still in its course folder.
    assert.ok(w.index().purged.some((t) => t.id === a));
    assert.equal(w.index().entries.find((e) => e.id === b)?.courseCode, 'MATH101');
  });
});
