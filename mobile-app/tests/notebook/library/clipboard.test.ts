import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { nbLayout } from '../../../src/notebook/core/fs/layout.ts';
import { discardClipboard, liveClipIds, pasteClipboard, stageClipboard, translateItem } from '../../../src/notebook/core/library/clipboard.ts';
import { createLibraryOps } from '../../../src/notebook/core/library/ops.ts';
import { emptyIndex } from '../../../src/notebook/core/model/index.ts';
import type { ImageItem, IndexFile, Notebook, PageItem } from '../../../src/notebook/core/model/index.ts';
import { createRegistry } from '../../../src/notebook/core/session/registry.ts';
import { openSession } from '../../../src/notebook/core/session/session.ts';
import type { NotebookSession, SessionDeps } from '../../../src/notebook/core/session/types.ts';
import { createMemFs } from '../helpers/memfs.ts';
import type { MemFs } from '../helpers/memfs.ts';

const ROOT = '/root/notebooks';
const L = nbLayout(ROOT);
const PAPER = { style: 'blank', color: 'white', size: 'a4' } as const;

function world() {
  const fs = createMemFs({ dirs: [ROOT, '/photos'] });
  let n = 0;
  let clock = Date.parse('2026-11-23T10:00:00.000Z');
  const newId = () => `c${(++n).toString().padStart(4, '0')}`;
  const now = () => (clock += 13);
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
  const acquire = async (id: string): Promise<NotebookSession> => {
    const r = await reg.acquire(id);
    assert.ok('session' in r);
    return r.session;
  };
  return { fs, newId, reg, ops, acquire };
}

const image = (id: string, fileId: string, x = 10): ImageItem => ({ id, kind: 'image', fileId, box: { x, y: 20, w: 100, h: 50, rot: 0 }, crop: null });

async function readJson(fs: MemFs, p: string): Promise<Notebook> {
  return JSON.parse((await fs.readText(p)) as string) as Notebook;
}

describe('clipboard', () => {
  test('cut an image in A, final release of A (GC runs), paste into B: the asset is copied', async () => {
    const w = world();
    w.fs.putText('/photos/cat.jpg', 'JPEG bytes of a cat');
    const a = await w.ops.create({ title: 'A', location: { kind: 'unfiled' }, paper: PAPER });
    const b = await w.ops.create({ title: 'B', location: { kind: 'unfiled' }, paper: PAPER });

    const sa = await w.acquire(a);
    const pa = sa.notebook.pageIds[0];
    await sa.loadPage(pa);
    const asset = await sa.addAsset('/photos/cat.jpg', 'image', 'jpg', { name: 'cat.jpg' });
    sa.addItems(pa, [image('img', asset.id), { id: 'ink', kind: 'stroke', tool: 'pen', color: '#000000', width: 2, pressure: false, pts: [5, 5, 0.5, 6, 6, 0.5] }]);
    await sa.flush();

    // Cut = stage, then remove.
    const items = (sa.getPage(pa)?.items ?? []).slice();
    const clip = await stageClipboard(w.fs, ROOT, sa, items, w.newId);
    assert.ok(liveClipIds().has(clip.clipId));
    assert.equal(clip.assets.length, 1);
    assert.ok(clip.assets[0].stagedPath.startsWith(L.clipboardDir(clip.clipId)));
    sa.removeItems(pa, ['img', 'ink'], 'cut');

    // Final release of A: the image is no longer referenced, so GC deletes it.
    w.reg.release(a);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(w.reg.get(a), null);
    assert.equal(w.fs.getText(L.notebook(a).asset(asset)), null, 'GC removed the cut asset from A');
    assert.equal(Object.keys((await readJson(w.fs, L.notebook(a).json)).assets).length, 0);

    // Paste into B.
    const sb = await w.acquire(b);
    const pb = sb.notebook.pageIds[0];
    const pasted = await pasteClipboard(sb, pb, clip, { dx: 30, dy: 40 }, w.newId);
    assert.equal(pasted.length, 2);
    const page = sb.getPage(pb);
    const img = page?.items.find((i) => i.kind === 'image') as ImageItem;
    assert.ok(img);
    assert.notEqual(img.id, 'img', 'new item ids');
    assert.equal(img.box.x, 40);
    assert.equal(img.box.y, 60);
    assert.ok(sb.notebook.assets[img.fileId], 'asset added to B');
    assert.equal(w.fs.getText(sb.assetPath(img.fileId)), 'JPEG bytes of a cat');
    assert.equal(sb.canUndo(), true);
    assert.equal(sb.undo(), true);
    assert.deepEqual(sb.getPage(pb)?.items, [], 'one history entry');
    assert.equal(sb.redo(), true);

    // Pasting again reuses the asset already in B.
    const again = await pasteClipboard(sb, pb, clip, { dx: 0, dy: 0 }, w.newId);
    assert.equal(again.length, 2);
    assert.equal(Object.keys(sb.notebook.assets).length, 1);
    await sb.flush();

    await discardClipboard(w.fs, ROOT, clip);
    assert.equal(liveClipIds().has(clip.clipId), false);
    assert.equal(w.fs.hasDir(L.clipboardDir(clip.clipId)), false);
    w.reg.release(b);
    await w.reg.evict(b);
  });

  test('recording marks survive only when the target has the recording; items are translated', async () => {
    const w = world();
    const a = await w.ops.create({ title: 'A', location: { kind: 'unfiled' }, paper: PAPER });
    const s = await w.acquire(a);
    const pid = s.notebook.pageIds[0];
    s.addRecording({ id: 'r1', title: 'r', startedAt: '2026-11-23T10:00:00.000Z', durationMs: 10, segments: [] });
    const items: PageItem[] = [
      { id: 'k', kind: 'stroke', tool: 'pen', color: '#000000', width: 2, pressure: true, pts: [1, 2, 0.5], rec: { recordingId: 'r1', ms: 5 } },
      { id: 'q', kind: 'shape', shape: 'line', color: '#000000', width: 2, fill: null, pts: [0, 0, 10, 10], rec: { recordingId: 'other', ms: 5 } },
    ];
    const clip = await stageClipboard(w.fs, ROOT, s, items, w.newId);
    assert.equal(clip.assets.length, 0);
    const ids = await pasteClipboard(s, pid, clip, { dx: 1, dy: 1 }, w.newId);
    const out = s.getPage(pid)?.items ?? [];
    assert.deepEqual(
      out.map((i) => i.id),
      ids,
    );
    assert.deepEqual(out[0].rec, { recordingId: 'r1', ms: 5 });
    assert.equal(out[1].rec, undefined);
    assert.deepEqual((out[0] as { pts: number[] }).pts, [2, 3, 0.5]);
    assert.deepEqual((out[1] as { pts: number[] }).pts, [1, 1, 11, 11]);
    const t = translateItem({ id: 'x', kind: 'text', box: { x: 1, y: 1, w: 5, h: 5, rot: 0 }, text: 'نص', size: 16, color: '#000000', bold: false }, 2, 3, 'y');
    assert.equal(t.id, 'y');
    assert.deepEqual((t as { box: { x: number; y: number } }).box.x, 3);
    await discardClipboard(w.fs, ROOT, clip);
    w.reg.release(a);
    await w.reg.evict(a);
  });
});
