import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  PURGED_CAP,
  TEXT_MAX,
  TITLE_MAX,
  blankPage,
  decodePage,
  defaultsFor,
  emptyIndex,
  makeLibraryFile,
  makeNotebookFile,
  makePageFile,
  migrate,
  notebookOf,
  prunePurged,
  readEncodedItem,
  readIndex,
  readLibraryFile,
  readNotebookFile,
  readPageFile,
  readSettings,
} from '../../../src/notebook/core/model/index.ts';
import type { Notebook, Page } from '../../../src/notebook/core/model/index.ts';

const T0 = '2026-11-23T10:00:00.000Z';

function notebook(over: Partial<Notebook> = {}): Notebook {
  return {
    id: 'nb1',
    title: 'محاضرة 1',
    createdAt: T0,
    updatedAt: T0,
    defaults: { style: 'lined', color: 'white', size: 'a4' },
    pageIds: ['p1', 'p2'],
    removedPageIds: [],
    recordings: [],
    assets: {},
    origin: { kind: 'blank' },
    contentRev: 3,
    ...over,
  };
}

describe('notebook.json', () => {
  test('round trips through make/read with fixed key order and the sentinel last', () => {
    const nb = notebook({ courseCode: 'CS102', pending: { jobId: 'j1', fileId: 'f1', kind: 'pdf-pages', firstPageIndex: 0, insertAt: 2, nextPage: 5, total: 40 } });
    const file = makeNotebookFile(nb, { rev: 9, savedAt: T0, app: '1.4.0' });
    const keys = Object.keys(file);
    assert.equal(keys[0], 'format');
    assert.equal(keys[keys.length - 1], '$');
    const text = JSON.stringify(file);
    assert.ok(text.endsWith('"$":"end"}'));
    const back = readNotebookFile(JSON.parse(text));
    assert.ok(back);
    assert.equal(back.rev, 9);
    assert.deepEqual(notebookOf(back), nb);
  });

  test('rebuilds field by field and drops bad values', () => {
    const raw = {
      format: 'qu-notebook',
      version: 1,
      rev: 'x',
      id: 'nb2',
      title: 'a'.repeat(500),
      defaults: { style: 'wavy', color: 'cream', size: 'a4' },
      pageIds: ['p1', 'p1', '../evil', 7, 'p2'],
      removedPageIds: ['p2', 'p3'],
      recordings: [{ id: 'r1', title: 'تسجيل 1', startedAt: T0, durationMs: 5000, segments: [{ fileId: 'a1', startMs: 0, durationMs: 5000, state: 'done' }, { fileId: 'x', state: 'weird' }] }, 'junk'],
      assets: { f1: { id: 'f1', kind: 'pdf', ext: 'PDF', bytes: 100, addedAt: T0 }, f2: { id: 'other', kind: 'pdf', ext: 'pdf' }, f3: { id: 'f3', kind: 'exe', ext: 'exe' } },
      origin: { kind: 'martian' },
      contentRev: -4,
      $: 'end',
    };
    const f = readNotebookFile(raw);
    assert.ok(f);
    assert.equal(f.rev, 0);
    assert.equal(f.title.length, TITLE_MAX);
    assert.deepEqual(f.defaults, { style: 'lined', color: 'cream', size: 'a4' });
    assert.deepEqual(f.pageIds, ['p1', 'p2']);
    assert.deepEqual(f.removedPageIds, ['p3']);
    assert.equal(f.recordings.length, 1);
    assert.equal(f.recordings[0].segments.length, 1);
    assert.deepEqual(Object.keys(f.assets), ['f1']);
    assert.equal(f.assets.f1.ext, 'pdf');
    assert.equal(f.origin.kind, 'blank');
    assert.equal(f.contentRev, 0);
  });

  test('wrong format or a missing/unsafe id is not a notebook', () => {
    assert.equal(readNotebookFile({ format: 'qu-page', id: 'a' }), null);
    assert.equal(readNotebookFile({ format: 'qu-notebook', id: '../a' }), null);
    assert.equal(readNotebookFile(null), null);
    assert.equal(readNotebookFile([]), null);
  });

  test("an asset keyed '__proto__' is dropped and cannot replace the assets prototype", () => {
    const raw = JSON.parse(
      '{"format":"qu-notebook","id":"nb1","assets":{"__proto__":{"id":"__proto__","kind":"pdf","ext":"pdf"},"a1":{"id":"a1","kind":"image","ext":"PNG"}}}',
    ) as unknown;
    const f = readNotebookFile(raw);
    assert.ok(f);
    assert.deepEqual(Object.keys(f.assets), ['a1']);
    assert.equal(Object.getPrototypeOf(f.assets), Object.prototype);
    assert.equal(f.assets.a1.ext, 'png');
  });
});

describe('page files', () => {
  const page: Page = {
    id: 'p1',
    size: { w: 595.28, h: 841.89 },
    background: { kind: 'paper', paper: { style: 'grid', color: 'dark', size: 'a4' } },
    items: [
      { id: 's1', kind: 'stroke', tool: 'pen', color: '#F1F5F9', width: 3, pressure: true, pts: [1, 2, 0.5, 3, 4, 0.6] },
      { id: 'h1', kind: 'shape', shape: 'rect', color: '#FDE047', width: 18, fill: null, highlighter: true, box: { x: 0, y: 0, w: 10, h: 10, rot: 0.2 } },
      { id: 'i1', kind: 'image', fileId: 'img1', box: { x: 5, y: 5, w: 50, h: 40, rot: 0 }, crop: null },
    ],
  };

  test('round trips', () => {
    const back = readPageFile(JSON.parse(JSON.stringify(makePageFile(page, { rev: 2, savedAt: T0 }))));
    assert.ok(back);
    assert.deepEqual(decodePage(back.page), page);
  });

  test('bad items are dropped, duplicates removed, text capped', () => {
    const raw = {
      format: 'qu-page',
      rev: 1,
      page: {
        id: 'p9',
        size: { w: -1, h: 5 },
        background: { kind: 'pdf', fileId: 'f1', pageIndex: 2, rotation: 45, damaged: true },
        items: [
          { id: 'a', kind: 'stroke', tool: 'pen', color: 'red', width: 2, pts: [1, 2, 3] },
          { id: 'b', kind: 'stroke', tool: 'pen', color: '#000000', width: 2, pts: [1, 2, Number.NaN] },
          { id: 'c', kind: 'stroke', tool: 'pen', color: '#000000', width: 2, pts: [1, 2, 0.5, 9], enc: 'd10' },
          { id: 'c', kind: 'stroke', tool: 'pen', color: '#000000', width: 2, pts: [1, 2, 0.5] },
          { id: 'd', kind: 'text', box: { x: 0, y: 0, w: 10, h: 10 }, text: 'x'.repeat(30000), size: 12, color: '#123456' },
          { id: 'e', kind: 'shape', shape: 'rect', color: '#000000', width: 1, fill: 'nope' },
          { id: 'f', kind: 'unknown' },
        ],
      },
      $: 'end',
    };
    const f = readPageFile(raw);
    assert.ok(f);
    const p = f.page;
    assert.deepEqual(p.background, { kind: 'pdf', fileId: 'f1', pageIndex: 2, rotation: 0, damaged: true });
    assert.deepEqual(p.size, { w: 595.28, h: 841.89 });
    assert.deepEqual(p.items.map((i) => i.id), ['c', 'd']);
    const t = p.items[1];
    assert.ok(t.kind === 'text' && t.text.length === TEXT_MAX && t.box.rot === 0);
  });

  test('a shape needs points or a box', () => {
    assert.equal(readEncodedItem({ id: 'x', kind: 'shape', shape: 'line', color: '#000000', width: 2, fill: null }), null);
    const line = readEncodedItem({ id: 'x', kind: 'shape', shape: 'line', color: '#000000', width: 2, fill: null, pts: [0, 0, 10, 10, 5] });
    assert.ok(line && line.kind === 'shape');
    assert.deepEqual(line.pts, [0, 0, 10, 10]);
  });

  test('a missing page file reads as an empty paper page', () => {
    const p = blankPage('p7', { style: 'dotted', color: 'cream', size: 'wide' });
    assert.deepEqual(p, { id: 'p7', size: { w: 960, h: 540 }, background: { kind: 'paper', paper: { style: 'dotted', color: 'cream', size: 'wide' } }, items: [] });
  });
});

describe('library.json', () => {
  test('folders and course names', () => {
    const lib = makeLibraryFile({ folders: [{ id: 'f1', name: 'مشاريع', createdAt: T0, order: 0 }], courseNames: { CS102: 'برمجة 2' } }, { rev: 3, savedAt: T0 });
    const back = readLibraryFile(JSON.parse(JSON.stringify(lib)));
    assert.deepEqual(back, lib);
    const bad = readLibraryFile({ format: 'qu-library', folders: [{ id: 'a' }, { id: 'a' }, 3], courseNames: { X: 4, Y: 'ok', '': 'no' } });
    assert.ok(bad);
    assert.equal(bad.folders.length, 1);
    assert.deepEqual(bad.courseNames, { Y: 'ok' });
    assert.equal(readLibraryFile({ format: 'other' }), null);
  });
});

describe('AsyncStorage index', () => {
  test('reads entries, folders, courseNames and purged', () => {
    const raw = {
      version: 1,
      entries: [
        { id: 'n1', title: 'A', createdAt: T0, updatedAt: T0, pageCount: 3, recordingCount: 1, hasPdf: true, cover: { kind: 'pdf' }, thumbRev: 2, contentRev: 5, importing: { done: 9, total: 4 } },
        { id: 'n1', title: 'dup' },
        { title: 'no id' },
      ],
      folders: [{ id: 'f1', name: 'F', createdAt: T0, order: 2 }],
      courseNames: { MATH101: 'تفاضل' },
      purged: [{ id: 'x', at: T0 }, { id: 'bad' }],
    };
    const f = readIndex(raw);
    assert.ok(f);
    assert.equal(f.entries.length, 1);
    assert.deepEqual(f.entries[0].importing, { done: 4, total: 4 });
    assert.deepEqual(f.courseNames, { MATH101: 'تفاضل' });
    assert.deepEqual(f.purged, [{ id: 'x', at: T0 }]);
    assert.equal(f.folders[0].order, 2);
  });

  test('unreadable shapes give null; an empty index is valid', () => {
    assert.equal(readIndex(null), null);
    assert.equal(readIndex({ entries: 'x' }), null);
    assert.deepEqual(readIndex(emptyIndex()), emptyIndex());
  });

  test('purged tombstones: one per id, capped at 2000, expired after 400 days', () => {
    const now = Date.parse(T0);
    const list = [];
    for (let i = 0; i < 2100; i++) list.push({ id: `n${i}`, at: new Date(now - i * 60_000).toISOString() });
    list.push({ id: 'old', at: new Date(now - 401 * 86_400_000).toISOString() });
    list.push({ id: 'n5', at: new Date(now + 1000).toISOString() });
    const pruned = prunePurged(list, now);
    assert.equal(pruned.length, PURGED_CAP);
    assert.ok(!pruned.some((t) => t.id === 'old'));
    assert.equal(pruned.filter((t) => t.id === 'n5').length, 1);
    assert.equal(pruned[pruned.length - 1].id, 'n5');
    const viaIndex = readIndex({ entries: [], purged: list }, now);
    assert.ok(viaIndex);
    assert.equal(viaIndex.purged.length, PURGED_CAP);
    // Without a clock nothing expires, but the cap still applies.
    assert.ok(prunePurged([{ id: 'old', at: '1999-01-01T00:00:00.000Z' }]).length === 1);
  });
});

describe('fuzz', () => {
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
  const KEYS = ['id', 'format', 'version', 'rev', 'title', 'pageIds', 'page', 'items', 'kind', 'pts', 'box', 'background', 'paper', 'entries', 'folders', 'purged', 'pen', 'presets', 'calc', 'float', 'assets', 'recordings', 'segments', '$', 'tool', 'color', 'size', 'w', 'h', 'x', 'y', 'courseNames', 'backup', 'tours', '__proto__'];
  const STRINGS = ['', 'p1', 'qu-notebook', 'qu-page', 'qu-library', 'stroke', 'shape', 'text', 'image', 'pdf', 'paper', 'pen', '#FFFFFF', 'end', '../x', 'lined', 'a4', 'تسجيل'];

  function value(r: () => number, depth: number): unknown {
    const k = Math.floor(r() * 10);
    if (depth > 4 || k < 2) return STRINGS[Math.floor(r() * STRINGS.length)];
    if (k === 2) return (r() - 0.5) * 1e6;
    if (k === 3) return [Number.NaN, Infinity, -0, null, undefined, true, false][Math.floor(r() * 7)];
    if (k <= 6) {
      const n = Math.floor(r() * 6);
      return Array.from({ length: n }, () => value(r, depth + 1));
    }
    const o: Record<string, unknown> = {};
    const n = Math.floor(r() * 8);
    for (let i = 0; i < n; i++) o[KEYS[Math.floor(r() * KEYS.length)]] = value(r, depth + 1);
    return o;
  }

  test('500 random objects never make a reader throw', () => {
    const r = rng(2026);
    for (let i = 0; i < 500; i++) {
      const v = value(r, 0);
      const withFormat = (fmt: string) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as object), format: fmt } : v);
      assert.doesNotThrow(() => {
        readNotebookFile(withFormat('qu-notebook'));
        const pf = readPageFile(withFormat('qu-page'));
        if (pf) decodePage(pf.page);
        readLibraryFile(withFormat('qu-library'));
        readIndex(v, Date.now());
        readIndex(v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as object), entries: [v, v] } : v);
        readSettings(v, i % 2 === 0);
        readEncodedItem(v);
        if (v && typeof v === 'object' && !Array.isArray(v)) migrate(v as Record<string, unknown>);
      }, `object ${i}: ${JSON.stringify(v)}`);
    }
    // Defaults are never damaged by fuzzing (fresh copies each time).
    assert.equal(defaultsFor(true).input, 'pen');
  });
});
