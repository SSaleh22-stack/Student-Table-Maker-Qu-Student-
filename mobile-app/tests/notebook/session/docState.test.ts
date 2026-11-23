import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyPatch } from '../../../src/notebook/core/model/index.ts';
import type { DocState, Notebook, Page, Recording, StrokeItem } from '../../../src/notebook/core/model/index.ts';
import * as ds from '../../../src/notebook/core/session/docState.ts';

const T0 = '2026-11-23T10:00:00.000Z';

function page(id: string, items: StrokeItem[] = []): Page {
  return { id, size: { w: 595.28, h: 841.89 }, background: { kind: 'paper', paper: { style: 'lined', color: 'white', size: 'a4' } }, items };
}

function st(id: string, rec?: string): StrokeItem {
  const s: StrokeItem = { id, kind: 'stroke', tool: 'pen', color: '#000000', width: 2, pressure: false, pts: [0, 0, 0.5] };
  if (rec) s.rec = { recordingId: rec, ms: 1 };
  return s;
}

function doc(pages: Page[], extra?: Partial<Notebook>): DocState {
  const nb: Notebook = {
    id: 'nb',
    title: 't',
    createdAt: T0,
    updatedAt: T0,
    defaults: { style: 'grid', color: 'cream', size: 'letter' },
    pageIds: pages.map((p) => p.id),
    removedPageIds: [],
    recordings: [],
    assets: {},
    origin: { kind: 'blank' },
    contentRev: 0,
    ...extra,
  };
  return { notebook: nb, pages: new Map(pages.map((p) => [p.id, p])) };
}

const back = (d: DocState, e: ds.Edit) => ds.applyEntry(e.state, e.patches, 'back', () => undefined);
const itemIds = (d: DocState, pid: string) => d.pages.get(pid)?.items.map((i) => i.id);

let n = 0;
const nid = () => `g${++n}`;

describe('item edits', () => {
  test('add, update, remove and replace give one patch and never change the input', () => {
    const d0 = doc([page('p', [st('a'), st('b')])]);
    const frozen = JSON.stringify([...d0.pages]);
    const add = ds.addItems(d0, 'p', [st('c')]);
    assert.equal(add.patches.length, 1);
    assert.deepEqual(itemIds(add.state, 'p'), ['a', 'b', 'c']);
    const upd = ds.updateItems(add.state, 'p', [{ ...st('a'), color: '#FF0000' }]);
    assert.equal((upd.state.pages.get('p')?.items[0] as StrokeItem).color, '#FF0000');
    const rem = ds.removeItems(upd.state, 'p', ['b']);
    assert.deepEqual(itemIds(rem.state, 'p'), ['a', 'c']);
    const rep = ds.replaceItems(rem.state, 'p', ['a', 'c'], [st('shape')]);
    assert.equal(rep.patches.length, 1);
    assert.deepEqual(itemIds(rep.state, 'p'), ['shape']);
    assert.deepEqual(itemIds(back(rem.state, rep), 'p'), ['a', 'c']);
    assert.equal(JSON.stringify([...d0.pages]), frozen);
    assert.equal(ds.addItems(d0, 'missing', [st('x')]).patches.length, 0);
    assert.equal(ds.removeItems(d0, 'p', ['nope']).state, d0);
  });
});

describe('page edits', () => {
  test('deletePages tombstones; deleting every page leaves one blank page', () => {
    const d0 = doc([page('p1'), page('p2')]);
    const del = ds.deletePages(d0, ['p1'], nid);
    assert.deepEqual(del.state.notebook.pageIds, ['p2']);
    assert.deepEqual(del.state.notebook.removedPageIds, ['p1']);
    assert.ok(del.state.pages.has('p1'), 'tombstones stay in the cache');
    const undo = back(d0, del);
    assert.deepEqual(undo.notebook.pageIds, ['p1', 'p2']);
    assert.deepEqual(undo.notebook.removedPageIds, []);
    const all = ds.deletePages(d0, ['p1', 'p2'], () => 'fresh');
    assert.deepEqual(all.state.notebook.pageIds, ['fresh']);
    assert.deepEqual(all.state.pages.get('fresh')?.size, { w: 612, h: 792 }, 'notebook defaults');
  });

  test('addPage, insertPages, duplicatePages and movePage', () => {
    const d0 = doc([page('a', [st('x')]), page('b')]);
    const add = ds.addPage(d0, 'a', 'n1');
    assert.deepEqual(add.state.notebook.pageIds, ['a', 'n1', 'b']);
    const bg = add.state.pages.get('n1')?.background;
    assert.deepEqual(bg, { kind: 'paper', paper: { style: 'grid', color: 'cream', size: 'letter' } });
    const end = ds.addPage(d0, 'end', 'n2', { size: { w: 100, h: 200 } });
    assert.deepEqual(end.state.notebook.pageIds, ['a', 'b', 'n2']);
    assert.deepEqual(end.state.pages.get('n2')?.size, { w: 100, h: 200 });
    const ins = ds.insertPages(d0, 1, [page('i1'), page('a'), page('i2')]);
    assert.deepEqual(ins.state.notebook.pageIds, ['a', 'i1', 'i2', 'b'], 'existing ids skipped');
    const dup = ds.duplicatePages(d0, ['a', 'b'], () => `c${++n}`);
    assert.equal(dup.newIds.length, 2);
    assert.deepEqual(dup.state.notebook.pageIds, ['a', dup.newIds[0], 'b', dup.newIds[1]]);
    assert.deepEqual(itemIds(dup.state, dup.newIds[0]), ['x']);
    const mv = ds.movePage(d0, 'a', 5);
    assert.deepEqual(mv.state.notebook.pageIds, ['b', 'a']);
    assert.equal(ds.movePage(d0, 'a', 0).patches.length, 0);
  });

  test('setPageBackground: value or function, paper size follows the paper', () => {
    const d0 = doc([page('a'), page('b')]);
    const e = ds.setPageBackground(d0, ['a', 'b', 'zz'], (p) => (p.id === 'b' ? null : { kind: 'paper', paper: { style: 'blank', color: 'dark', size: 'a4-landscape' } }));
    assert.equal(e.patches.length, 1);
    assert.deepEqual(e.state.pages.get('a')?.size, { w: 841.89, h: 595.28 });
    assert.equal(e.state.pages.get('b'), d0.pages.get('b'));
    const pdf = ds.setPageBackground(d0, ['a'], { kind: 'pdf', fileId: 'f', pageIndex: 2, rotation: 0 }, { w: 300, h: 400 });
    assert.deepEqual(pdf.state.pages.get('a')?.size, { w: 300, h: 400 });
    const back1 = applyPatch(pdf.state, pdf.patches[0], 'back', () => undefined);
    assert.deepEqual(back1.pages.get('a'), d0.pages.get('a'));
  });

  test('setDefaults and setMeta are undoable; empty titles are ignored', () => {
    const d0 = doc([page('a')]);
    const def = ds.setDefaults(d0, { style: 'dotted', color: 'white', size: 'wide' });
    assert.equal(def.patches.length, 1);
    assert.equal(def.state.notebook.defaults.style, 'dotted');
    const t = ds.setMeta(d0, { title: '   محاضرة   ٣  ' });
    assert.equal(t.state.notebook.title, 'محاضرة ٣');
    assert.equal(ds.setMeta(d0, { title: '   ' }).patches.length, 0);
  });
});

describe('recordings and pending', () => {
  const rec = (id: string): Recording => ({ id, title: id, startedAt: T0, durationMs: 0, segments: [] });

  test('add/update recording and pending give no patch', () => {
    const d0 = doc([page('a')]);
    const a = ds.addRecording(d0, rec('r1'));
    assert.equal(a.patches.length, 0);
    assert.equal(a.state.notebook.recordings.length, 1);
    const u = ds.updateRecording(a.state, 'r1', { durationMs: 9 });
    assert.equal(u.patches.length, 0);
    assert.equal(u.state.notebook.recordings[0].durationMs, 9);
    const p = ds.setPending(d0, { jobId: 'j', fileId: 'f', kind: 'pdf-pages', firstPageIndex: 0, insertAt: 0, nextPage: 0, total: 1 });
    assert.equal(p.patches.length, 0);
    assert.equal(ds.setPending(p.state, undefined).state.notebook.pending, undefined);
  });

  test('deleteRecording: one meta patch plus mark-stripping item patches', () => {
    const d0 = doc([page('a', [st('m', 'r1'), st('k')]), page('b', [st('m2', 'r1')]), page('c', [st('o', 'r2')])], { recordings: [rec('r1'), rec('r2')] });
    const e = ds.deleteRecording(d0, 'r1');
    assert.deepEqual(
      e.patches.map((p) => p.t),
      ['meta', 'items', 'items'],
    );
    assert.deepEqual(
      e.state.notebook.recordings.map((r) => r.id),
      ['r2'],
    );
    assert.equal(e.state.pages.get('a')?.items[0].rec, undefined);
    assert.deepEqual(e.state.pages.get('c')?.items[0].rec, { recordingId: 'r2', ms: 1 });
    const u = back(d0, e);
    assert.deepEqual(
      u.notebook.recordings.map((r) => r.id),
      ['r1', 'r2'],
    );
    assert.deepEqual(u.pages.get('b')?.items[0].rec, { recordingId: 'r1', ms: 1 });
  });
});

describe('rebasing', () => {
  test('undoing an old pages patch keeps pages added without history', () => {
    const d0 = doc([page('a'), page('b')]);
    const del = ds.deletePages(d0, ['b'], nid);
    const imported = ds.insertPages(del.state, 0, [page('i0')]);
    assert.deepEqual(imported.state.notebook.pageIds, ['i0', 'a']);
    const u = ds.applyEntry(imported.state, del.patches, 'back', () => undefined);
    assert.deepEqual(u.notebook.pageIds, ['i0', 'a', 'b']);
    const r = ds.applyEntry(u, del.patches, 'forward', () => undefined);
    assert.deepEqual(r.notebook.pageIds, ['i0', 'a']);
    assert.deepEqual(r.notebook.removedPageIds, ['b']);
  });

  test('rebasePatch returns the patch itself when the document matches', () => {
    const d0 = doc([page('a')]);
    const add = ds.addPage(d0, 'end', 'z');
    assert.equal(ds.rebasePatch(add.patches[0], add.state, 'back'), add.patches[0]);
  });

  test('changedPageIds lists only pages whose object changed', () => {
    const d0 = doc([page('a'), page('b')]);
    const e = ds.addItems(d0, 'b', [st('q')]);
    assert.deepEqual(ds.changedPageIds(d0, e.state), ['b']);
    assert.deepEqual(ds.changedPageIds(d0, d0), []);
  });
});
