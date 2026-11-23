import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  applyPatch,
  applyPatches,
  blankPage,
  invertPatch,
  makeItemsPatch,
  makeMetaPatch,
  makePagePatch,
  makePagesPatch,
  patchBytes,
  patchPageIds,
} from '../../../src/notebook/core/model/index.ts';
import type { DocState, Id, Notebook, Page, PageItem, Patch } from '../../../src/notebook/core/model/index.ts';

const T0 = '2026-11-23T10:00:00.000Z';

const stroke = (id: string, x = 0): PageItem => ({ id, kind: 'stroke', tool: 'pen', color: '#1B2533', width: 3, pressure: true, pts: [x, x, 0.5, x + 1, x + 1, 0.5] });

function doc(pages: Page[], over: Partial<Notebook> = {}): DocState {
  const notebook: Notebook = {
    id: 'nb',
    title: 'T',
    createdAt: T0,
    updatedAt: T0,
    defaults: { style: 'lined', color: 'white', size: 'a4' },
    pageIds: pages.map((p) => p.id),
    removedPageIds: [],
    recordings: [],
    assets: {},
    origin: { kind: 'blank' },
    contentRev: 0,
    ...over,
  };
  return { notebook, pages: new Map(pages.map((p) => [p.id, p])) };
}

const none = (): Page | undefined => undefined;
const ids = (d: DocState, pid: Id) => d.pages.get(pid)?.items.map((i) => i.id);

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('items patches', () => {
  const page = (items: PageItem[]): Page => ({ ...blankPage('p1'), items });

  test('add, remove, update and replace round trip forward and back', () => {
    const cases: [PageItem[], PageItem[]][] = [
      [[], [stroke('a')]],
      [[stroke('a'), stroke('b'), stroke('c')], [stroke('a'), stroke('c')]],
      [[stroke('a'), stroke('b')], [stroke('a'), stroke('b', 9)]],
      [[stroke('a'), stroke('b'), stroke('c')], [stroke('a'), stroke('s'), stroke('c')]],
      [[stroke('a'), stroke('b'), stroke('c')], [stroke('c'), stroke('a'), stroke('b')]],
    ];
    for (const [before, after] of cases) {
      const p = makeItemsPatch('p1', before, after);
      assert.ok(p);
      const d0 = doc([page(before)]);
      const d1 = applyPatch(d0, p, 'forward', none);
      assert.deepEqual(d1.pages.get('p1')?.items, after);
      const d2 = applyPatch(d1, p, 'back', none);
      assert.deepEqual(d2.pages.get('p1')?.items, before);
      // The input state is never changed.
      assert.deepEqual(d0.pages.get('p1')?.items, before);
    }
  });

  test('keeps indexes and records only what changed', () => {
    const before = [stroke('a'), stroke('b'), stroke('c'), stroke('d')];
    const after = [stroke('a'), stroke('b', 5), stroke('c'), stroke('d'), stroke('e')];
    const p = makeItemsPatch('p1', before, after);
    assert.ok(p);
    assert.deepEqual(p.before.map((x) => [x.index, x.item.id]), [[1, 'b']]);
    assert.deepEqual(p.after.map((x) => [x.index, x.item.id]), [[1, 'b'], [4, 'e']]);
    assert.equal(makeItemsPatch('p1', before, before.map((i) => ({ ...i }))), null);
  });

  test('random edits always round trip (property)', () => {
    const r = rng(11);
    for (let run = 0; run < 300; run++) {
      const before: PageItem[] = Array.from({ length: Math.floor(r() * 12) }, (_, i) => stroke(`i${i}`, i));
      let after = before.filter(() => r() > 0.3).map((it) => (r() > 0.8 ? stroke(it.id, 100 + run) : it));
      const adds = Math.floor(r() * 4);
      for (let k = 0; k < adds; k++) after.splice(Math.floor(r() * (after.length + 1)), 0, stroke(`n${run}_${k}`, k));
      if (r() > 0.7) after = [...after].sort(() => r() - 0.5);
      const p = makeItemsPatch('p1', before, after);
      const d0 = doc([page(before)]);
      if (!p) {
        assert.deepEqual(after, before);
        continue;
      }
      const d1 = applyPatch(d0, p, 'forward', none);
      assert.deepEqual(ids(d1, 'p1'), after.map((i) => i.id));
      assert.deepEqual(d1.pages.get('p1')?.items, after);
      assert.deepEqual(applyPatch(d1, p, 'back', none).pages.get('p1')?.items, before);
    }
  });

  test('a patch for a page that is not loaded uses the loader, else is a no-op', () => {
    const p = makeItemsPatch('p1', [], [stroke('a')]);
    assert.ok(p);
    const d0 = doc([]);
    assert.equal(applyPatch(d0, p, 'forward', none), d0);
    const d1 = applyPatch(d0, p, 'forward', (pid) => (pid === 'p1' ? page([]) : undefined));
    assert.deepEqual(ids(d1, 'p1'), ['a']);
  });
});

describe('pages patches (tombstones)', () => {
  test('a pages delete is restored from a tombstone loaded from disk', () => {
    const p1 = blankPage('p1');
    const p2: Page = { ...blankPage('p2'), items: [stroke('x')] };
    const p3 = blankPage('p3');
    const d0 = doc([p1, p2, p3]);
    const del = makePagesPatch(d0.notebook.pageIds, ['p1', 'p3']);
    assert.ok(del);
    const d1 = applyPatch(d0, del, 'forward', none);
    assert.deepEqual(d1.notebook.pageIds, ['p1', 'p3']);
    assert.deepEqual(d1.notebook.removedPageIds, ['p2']);

    // The cache was evicted (e.g. the LRU dropped it); the page file is read back from "disk".
    const evicted: DocState = { notebook: d1.notebook, pages: new Map([...d1.pages].filter(([k]) => k !== 'p2')) };
    const disk = new Map<Id, Page>([['p2', p2]]);
    const loads: Id[] = [];
    const d2 = applyPatch(evicted, del, 'back', (pid) => {
      loads.push(pid);
      return disk.get(pid);
    });
    assert.deepEqual(d2.notebook.pageIds, ['p1', 'p2', 'p3']);
    assert.deepEqual(d2.notebook.removedPageIds, []);
    assert.deepEqual(loads, ['p2']);
    assert.deepEqual(d2.pages.get('p2'), p2);

    // Redo deletes it again; the page stays in the cache so the next undo needs no disk read.
    const d3 = applyPatch(d2, del, 'forward', none);
    assert.ok(d3.pages.has('p2'));
    const d4 = applyPatch(d3, del, 'back', () => assert.fail('cached page must not be reloaded'));
    assert.deepEqual(d4.notebook.pageIds, ['p1', 'p2', 'p3']);
  });

  test('adding pages and undoing tombstones the new ones; a missing tombstone still restores the id', () => {
    const d0 = doc([blankPage('p1')]);
    const add = makePagesPatch(['p1'], ['p1', 'p2']);
    assert.ok(add);
    const d1 = applyPatch(d0, add, 'forward', (pid) => (pid === 'p2' ? blankPage('p2') : undefined));
    assert.ok(d1.pages.has('p2'));
    const d2 = applyPatch(d1, add, 'back', none);
    assert.deepEqual(d2.notebook.pageIds, ['p1']);
    assert.deepEqual(d2.notebook.removedPageIds, ['p2']);
    const d3 = applyPatch({ notebook: d2.notebook, pages: new Map() }, add, 'forward', none);
    assert.deepEqual(d3.notebook.pageIds, ['p1', 'p2']);
    assert.deepEqual(d3.notebook.removedPageIds, []);
  });

  test('reorder', () => {
    const d0 = doc([blankPage('a'), blankPage('b'), blankPage('c')]);
    const mv = makePagesPatch(['a', 'b', 'c'], ['c', 'a', 'b']);
    assert.ok(mv);
    const d1 = applyPatch(d0, mv, 'forward', none);
    assert.deepEqual(d1.notebook.pageIds, ['c', 'a', 'b']);
    assert.deepEqual(d1.notebook.removedPageIds, []);
    assert.deepEqual(applyPatch(d1, mv, 'back', none).notebook.pageIds, ['a', 'b', 'c']);
    assert.equal(makePagesPatch(['a'], ['a']), null);
  });
});

describe('page and meta patches', () => {
  test('page background and size', () => {
    const p = blankPage('p1');
    const d0 = doc([p]);
    const after = { size: { w: 960, h: 540 }, background: { kind: 'paper' as const, paper: { style: 'grid' as const, color: 'dark' as const, size: 'wide' as const } } };
    const patch = makePagePatch('p1', p, after);
    assert.ok(patch);
    const d1 = applyPatch(d0, patch, 'forward', none);
    assert.deepEqual(d1.pages.get('p1')?.background, after.background);
    assert.deepEqual(d1.pages.get('p1')?.size, after.size);
    const d2 = applyPatch(d1, patch, 'back', none);
    assert.deepEqual(d2.pages.get('p1'), p);
    assert.equal(makePagePatch('p1', p, { size: { ...p.size }, background: p.background }), null);
  });

  test('meta: title, defaults and recordings', () => {
    const d0 = doc([], { recordings: [{ id: 'r1', title: 'تسجيل 1', startedAt: T0, durationMs: 1, segments: [] }] });
    const patch = makeMetaPatch(
      { title: 'T', recordings: d0.notebook.recordings, defaults: d0.notebook.defaults },
      { title: 'جديد', recordings: [], defaults: { style: 'blank', color: 'cream', size: 'letter' } },
    );
    assert.ok(patch);
    const d1 = applyPatch(d0, patch, 'forward', none);
    assert.equal(d1.notebook.title, 'جديد');
    assert.deepEqual(d1.notebook.recordings, []);
    assert.equal(d1.notebook.defaults.style, 'blank');
    const d2 = applyPatch(d1, patch, 'back', none);
    assert.deepEqual(d2.notebook, d0.notebook);
    assert.equal(makeMetaPatch({ title: 'a' }, { title: 'a' }), null);
  });
});

describe('helpers', () => {
  test('invertPatch swaps before and after for every kind', () => {
    const list: Patch[] = [
      { t: 'items', pageId: 'p', before: [{ index: 0, item: stroke('a') }], after: [] },
      { t: 'pages', before: ['a'], after: ['a', 'b'] },
      { t: 'page', pageId: 'p', before: { size: { w: 1, h: 1 }, background: { kind: 'paper', paper: { style: 'blank', color: 'white', size: 'a4' } } }, after: { size: { w: 2, h: 2 }, background: { kind: 'paper', paper: { style: 'lined', color: 'white', size: 'a4' } } } },
      { t: 'meta', before: { title: 'a' }, after: { title: 'b' } },
    ];
    for (const p of list) {
      const inv = invertPatch(p);
      assert.equal(inv.t, p.t);
      assert.deepEqual(invertPatch(inv), p);
      assert.deepEqual((inv as { before: unknown }).before, (p as { after: unknown }).after);
    }
  });

  test('applyPatches runs back in reverse order; patchPageIds; patchBytes ~ JSON length', () => {
    const d0 = doc([blankPage('p1')]);
    const a = makeItemsPatch('p1', [], [stroke('a')]);
    const b = makeItemsPatch('p1', [stroke('a')], [stroke('a'), stroke('b')]);
    assert.ok(a && b);
    const d1 = applyPatches(d0, [a, b], 'forward', none);
    assert.deepEqual(ids(d1, 'p1'), ['a', 'b']);
    assert.deepEqual(ids(applyPatches(d1, [a, b], 'back', none), 'p1'), []);
    assert.deepEqual(patchPageIds(a), ['p1']);
    assert.deepEqual(patchPageIds({ t: 'pages', before: ['x'], after: ['y', 'x'] }), ['x', 'y']);
    assert.equal(patchBytes(a), JSON.stringify(a).length);
    assert.ok(patchBytes(a) > 50);
  });
});
