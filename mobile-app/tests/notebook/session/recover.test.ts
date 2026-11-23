import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { writeJsonAtomic } from '../../../src/notebook/core/fs/journal.ts';
import { nbLayout } from '../../../src/notebook/core/fs/layout.ts';
import { makePageFile } from '../../../src/notebook/core/model/index.ts';
import type { Notebook, Page } from '../../../src/notebook/core/model/index.ts';
import { applyGc, assetOfFile, pageIdOfFile, planGc, recoverNotebook, referencedAssetIds } from '../../../src/notebook/core/session/recover.ts';
import { createMemFs } from '../helpers/memfs.ts';

const P = nbLayout('/root').notebook('nb');
const SAVED = '2026-11-23T10:00:00.000Z';
const OLDER = '2026-11-20T10:00:00.000Z';
const NEWER = '2026-11-23T10:00:05.000Z';

function page(id: string, extra?: Partial<Page>): Page {
  return { id, size: { w: 10, h: 10 }, background: { kind: 'paper', paper: { style: 'blank', color: 'white', size: 'a4' } }, items: [], ...extra };
}

function nb(extra?: Partial<Notebook>): Notebook {
  return {
    id: 'nb',
    title: 't',
    createdAt: SAVED,
    updatedAt: SAVED,
    defaults: { style: 'blank', color: 'white', size: 'a4' },
    pageIds: ['p1'],
    removedPageIds: ['gone'],
    recordings: [],
    assets: {},
    origin: { kind: 'blank' },
    contentRev: 3,
    ...extra,
  };
}

const deps = { newId: () => 'fresh', now: () => 1_790_000_000_000 };

describe('recoverNotebook', () => {
  test('a newer orphan page is appended, an older one deleted, a damaged one left alone', async () => {
    const fs = createMemFs({ dirs: [P.pagesDir] });
    await writeJsonAtomic(fs, P.page('p1'), makePageFile(page('p1'), { rev: 1, savedAt: OLDER }));
    await writeJsonAtomic(fs, P.page('gone'), makePageFile(page('gone'), { rev: 1, savedAt: OLDER }));
    await writeJsonAtomic(fs, P.page('late'), makePageFile(page('late'), { rev: 1, savedAt: NEWER }));
    await writeJsonAtomic(fs, P.page('old'), makePageFile(page('old'), { rev: 1, savedAt: OLDER }));
    fs.putText(`${P.page('old')}.bak`, '{}');
    fs.putText(P.page('torn'), '{"format":"qu-page","rev":4,');
    const r = await recoverNotebook(fs, P, nb(), SAVED, deps);
    assert.deepEqual(r.appendedPages, ['late']);
    assert.deepEqual(r.notebook.pageIds, ['p1', 'late']);
    assert.equal(r.changed, true);
    assert.equal(fs.getText(P.page('old')), null);
    assert.equal(fs.getText(`${P.page('old')}.bak`), null);
    assert.ok(fs.getText(P.page('torn')), 'damaged orphan kept');
    assert.ok(fs.getText(P.page('gone')), 'tombstones are not orphans');
  });

  test('asset files missing from notebook.assets are adopted; no pages gets one page', async () => {
    const fs = createMemFs({ dirs: [P.pagesDir, P.assetsDir, P.audioDir] });
    fs.putText(`${P.assetsDir}/aaa.pdf`, 'pdfdata');
    fs.putText(`${P.assetsDir}/bbb.png`, 'png');
    fs.putText(`${P.audioDir}/ccc.m4a`, 'aud');
    fs.putText(`${P.assetsDir}/weird name.png`, 'x');
    const r = await recoverNotebook(fs, P, nb({ pageIds: [], removedPageIds: [] }), SAVED, deps);
    assert.deepEqual(r.adoptedAssets.sort(), ['aaa', 'bbb', 'ccc']);
    assert.equal(r.notebook.assets.aaa.kind, 'pdf');
    assert.equal(r.notebook.assets.bbb.kind, 'image');
    assert.equal(r.notebook.assets.ccc.kind, 'audio');
    assert.equal(r.notebook.assets.aaa.bytes, 7);
    assert.deepEqual(r.notebook.pageIds, ['fresh']);
  });

  test('nothing to recover leaves the notebook object as is', async () => {
    const fs = createMemFs({ dirs: [P.pagesDir] });
    await writeJsonAtomic(fs, P.page('p1'), makePageFile(page('p1'), { rev: 1, savedAt: SAVED }));
    const n0 = nb({ removedPageIds: [] });
    const r = await recoverNotebook(fs, P, n0, SAVED, deps);
    assert.equal(r.changed, false);
    assert.equal(r.notebook, n0);
  });

  test('file name parsers', () => {
    assert.equal(pageIdOfFile('abc.json'), 'abc');
    assert.equal(pageIdOfFile('abc.json.tmp'), 'abc');
    assert.equal(pageIdOfFile('abc.json.bak'), 'abc');
    assert.equal(pageIdOfFile('abc.txt'), null);
    assert.deepEqual(assetOfFile('x1.jpg'), { id: 'x1', ext: 'jpg' });
    assert.equal(assetOfFile('noext'), null);
  });
});

describe('GC', () => {
  test('references: image items, backgrounds, pending and recordings', () => {
    const n0 = nb({
      pending: { jobId: 'j', fileId: 'pend', kind: 'pdf-pages', firstPageIndex: 0, insertAt: 0, nextPage: 0, total: 1 },
      recordings: [{ id: 'r', title: 'r', startedAt: SAVED, durationMs: 1, segments: [{ fileId: 'aud', startMs: 0, durationMs: 1, state: 'done' }] }],
    });
    const pages = [
      page('p1', { background: { kind: 'pdf', fileId: 'pdf', pageIndex: 0, rotation: 0 } }),
      page('p2', { items: [{ id: 'i', kind: 'image', fileId: 'img', box: { x: 0, y: 0, w: 1, h: 1, rot: 0 }, crop: null }] }),
      page('p3', { background: { kind: 'image', fileId: 'scan', paper: { style: 'blank', color: 'white', size: 'a4' } } }),
    ];
    assert.deepEqual([...referencedAssetIds(n0, pages)].sort(), ['aud', 'img', 'pdf', 'pend', 'scan']);
  });

  test('planGc drops tombstones and unreferenced assets; an unreadable page keeps every asset', async () => {
    const asset = (id: string) => ({ id, kind: 'image' as const, ext: 'png', bytes: 1, addedAt: SAVED });
    const n0 = nb({ assets: { used: asset('used'), unused: asset('unused') } });
    const pages = [page('p1', { items: [{ id: 'i', kind: 'image', fileId: 'used', box: { x: 0, y: 0, w: 1, h: 1, rot: 0 }, crop: null }] })];
    const plan = planGc(n0, pages);
    assert.deepEqual(plan.deletePages, ['gone']);
    assert.deepEqual(
      plan.deleteAssets.map((a) => a.id),
      ['unused'],
    );
    assert.deepEqual(Object.keys(plan.notebook.assets), ['used']);
    assert.deepEqual(plan.notebook.removedPageIds, []);
    const safe = planGc(n0, null);
    assert.deepEqual(safe.deleteAssets, []);
    assert.deepEqual(safe.deletePages, ['gone']);

    const fs = createMemFs({ dirs: [P.pagesDir, P.assetsDir] });
    fs.putText(P.page('gone'), '{}');
    fs.putText(`${P.page('gone')}.bak`, '{}');
    fs.putText(`${P.assetsDir}/unused.png`, 'x');
    fs.putText(`${P.assetsDir}/used.png`, 'x');
    const removed = await applyGc(fs, P, plan);
    assert.equal(removed.length, 3);
    assert.ok(fs.getText(`${P.assetsDir}/used.png`));
    assert.equal(planGc(nb({ removedPageIds: [] }), []).changed, false);
  });
});
