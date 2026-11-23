import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { writeJsonAtomic } from '../../../src/notebook/core/fs/journal.ts';
import { nbLayout } from '../../../src/notebook/core/fs/layout.ts';
import { applyReconcile, planReconcile, scanNotebooks } from '../../../src/notebook/core/library/reconcile.ts';
import type { DiskNotebook } from '../../../src/notebook/core/library/reconcile.ts';
import { emptyIndex, makeNotebookFile, makePageFile } from '../../../src/notebook/core/model/index.ts';
import type { IndexEntry, IndexFile, Notebook } from '../../../src/notebook/core/model/index.ts';
import { createMemFs } from '../helpers/memfs.ts';

const T0 = '2026-11-23T10:00:00.000Z';

function nb(id: string, extra?: Partial<Notebook>): Notebook {
  return {
    id,
    title: `title ${id}`,
    createdAt: T0,
    updatedAt: T0,
    defaults: { style: 'lined', color: 'white', size: 'a4' },
    pageIds: ['p1'],
    removedPageIds: [],
    recordings: [],
    assets: {},
    origin: { kind: 'blank' },
    contentRev: 5,
    ...extra,
  };
}

function entry(id: string, extra?: Partial<IndexEntry>): IndexEntry {
  return {
    id,
    title: `title ${id}`,
    createdAt: T0,
    updatedAt: T0,
    pageCount: 1,
    recordingCount: 0,
    hasPdf: false,
    cover: { kind: 'paper', paper: { style: 'lined', color: 'white', size: 'a4' } },
    thumbRev: 3,
    contentRev: 5,
    ...extra,
  };
}

const ok = (n: Notebook, extra?: Partial<Extract<DiskNotebook, { state: 'ok' }>>): DiskNotebook => ({
  id: n.id,
  state: 'ok',
  notebook: n,
  readOnly: false,
  cover: null,
  hasCover: true,
  ...extra,
});

describe('planReconcile', () => {
  test('adds, refreshes, removes, deletes interrupted creates and purges', () => {
    const f: IndexFile = {
      ...emptyIndex(),
      entries: [entry('same'), entry('stale', { contentRev: 2, title: 'old' }), entry('vanished'), entry('broken'), entry('nojson')],
      purged: [{ id: 'zombie', at: T0 }],
    };
    const disk: DiskNotebook[] = [
      ok(nb('same')),
      ok(nb('stale', { title: 'fresh', contentRev: 6 })),
      ok(nb('new'), { hasCover: false }),
      { id: 'broken', state: 'unreadable' },
      { id: 'lost', state: 'unreadable' },
      { id: 'nojson', state: 'missing' },
      { id: 'partial', state: 'missing' },
      ok(nb('zombie')),
    ];
    const plan = planReconcile(f, disk);
    assert.deepEqual(plan.removeIds, ['vanished']);
    assert.deepEqual(plan.deleteDirs.sort(), ['partial', 'zombie']);
    assert.deepEqual(
      plan.upserts.map((e) => e.id),
      ['stale', 'new', 'lost'],
    );
    const g = applyReconcile(f, plan);
    const by = new Map(g.entries.map((e) => [e.id, e]));
    assert.equal(by.get('stale')?.title, 'fresh');
    assert.equal(by.get('stale')?.thumbRev, 3, 'store-owned field kept');
    assert.equal(by.get('new')?.needsThumb, true);
    assert.equal(by.get('lost')?.title, '');
    assert.ok(by.has('nojson'), 'a folder with an index entry is left alone');
    assert.ok(!by.has('vanished'));
    assert.ok(!by.has('zombie'));
  });

  test('a read-only notebook keeps the index title and location; open sessions are skipped', () => {
    const f: IndexFile = { ...emptyIndex(), entries: [entry('ro', { title: 'renamed here', deletedAt: T0 }), entry('open', { title: 'x' })] };
    const plan = planReconcile(f, [ok(nb('ro', { title: 'on disk' }), { readOnly: true })], { openIds: new Set(['open']) });
    assert.equal(plan.upserts.length, 1);
    assert.equal(plan.upserts[0].title, 'renamed here');
    assert.equal(plan.upserts[0].deletedAt, T0);
    assert.equal(plan.upserts[0].readOnly, true);
    assert.deepEqual(plan.removeIds, []);
  });
});

describe('scanNotebooks', () => {
  test('reads every notebook folder without repairing anything', async () => {
    const ROOT = '/root/nbs';
    const L = nbLayout(ROOT);
    const fs = createMemFs({ dirs: [L.staging, L.inbox] });
    const a = L.notebook('a');
    await fs.mkdirp(a.pagesDir);
    await writeJsonAtomic(fs, a.page('p1'), makePageFile({ id: 'p1', size: { w: 1, h: 1 }, background: { kind: 'pdf', fileId: 'f', pageIndex: 0, rotation: 0 }, items: [] }, { rev: 1, savedAt: T0 }));
    await writeJsonAtomic(fs, a.json, makeNotebookFile(nb('a'), { rev: 1, savedAt: T0, app: 't' }));
    fs.putText(`${L.notebook('b').json}`, 'torn{');
    await fs.mkdirp(L.notebook('c').pagesDir);
    fs.putText(`${ROOT}/library.json`, '{}');
    fs.clearLog();
    const disk = await scanNotebooks(fs, ROOT);
    assert.deepEqual(fs.log, [], 'no mutation');
    const by = new Map(disk.map((d) => [d.id, d]));
    assert.equal(by.size, 3);
    const da = by.get('a');
    assert.ok(da && da.state === 'ok');
    assert.deepEqual(da.cover, { kind: 'pdf' });
    assert.equal(da.hasCover, false);
    assert.equal(by.get('b')?.state, 'unreadable');
    assert.equal(by.get('c')?.state, 'missing');
    const lazy = await scanNotebooks(fs, ROOT, { needCover: () => false });
    const la = lazy.find((d) => d.id === 'a');
    assert.ok(la && la.state === 'ok' && la.cover === null);
  });
});
