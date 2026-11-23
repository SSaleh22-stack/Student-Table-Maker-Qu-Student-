import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { writeJsonAtomic } from '../../../src/notebook/core/fs/journal.ts';
import { nbLayout } from '../../../src/notebook/core/fs/layout.ts';
import { makeNotebookFile, makePageFile } from '../../../src/notebook/core/model/index.ts';
import type { Asset, Id, Notebook, Page, StrokeItem } from '../../../src/notebook/core/model/index.ts';
import { estimateQunoteSize } from '../../../src/notebook/core/qunote/estimate.ts';
import { packNotebook } from '../../../src/notebook/core/qunote/pack.ts';
import { createMemFs } from '../helpers/memfs.ts';

const ROOT = '/root/notebooks';
const L = nbLayout(ROOT);
const T0 = '2026-11-23T10:00:00.000Z';
const PAPER = { style: 'lined', color: 'white', size: 'a4' } as const;

const asset = (id: Id, kind: Asset['kind'], ext: string, bytes: number): Asset => ({ id, kind, ext, bytes, addedAt: T0 });

function notebook(o?: Partial<Notebook>): Notebook {
  return {
    id: 'nb1',
    title: 'Notes',
    createdAt: T0,
    updatedAt: T0,
    defaults: PAPER,
    pageIds: ['p0', 'p1', 'p2'],
    removedPageIds: [],
    recordings: [],
    assets: { pdf1: asset('pdf1', 'pdf', 'pdf', 2_000_000) },
    origin: { kind: 'blank' },
    contentRev: 1,
    ...o,
  };
}

describe('estimateQunoteSize', () => {
  test('equal with and without recordings when there are none', () => {
    const e = estimateQunoteSize(notebook(), 30_000);
    assert.equal(e.withRecordings, e.withoutRecordings);
    assert.ok(e.withoutRecordings > 2_000_000 && e.withoutRecordings < 2_100_000, String(e.withoutRecordings));
  });

  test('recordings add their audio; unfinished segments do not count', () => {
    const nb = notebook({
      recordings: [
        { id: 'r1', title: 'a', startedAt: T0, durationMs: 1, segments: [{ fileId: 'a1', startMs: 0, durationMs: 1, state: 'done' }] },
        { id: 'r2', title: 'b', startedAt: T0, durationMs: 1, segments: [{ fileId: 'a2', startMs: 0, durationMs: 1, state: 'recording' }] },
      ],
      assets: { pdf1: asset('pdf1', 'pdf', 'pdf', 2_000_000), a1: asset('a1', 'audio', 'm4a', 5_000_000), a2: asset('a2', 'audio', 'm4a', 9_000_000) },
    });
    const e = estimateQunoteSize(nb, 30_000);
    const diff = e.withRecordings - e.withoutRecordings;
    assert.ok(diff > 5_000_000 && diff < 5_010_000, String(diff));

    const onlyRecording = notebook({
      recordings: [{ id: 'r2', title: 'b', startedAt: T0, durationMs: 1, segments: [{ fileId: 'a2', startMs: 0, durationMs: 1, state: 'recording' }] }],
      assets: { a2: asset('a2', 'audio', 'm4a', 9_000_000) },
    });
    const e2 = estimateQunoteSize(onlyRecording, 0);
    assert.equal(e2.withRecordings, e2.withoutRecordings);
  });

  test('grows with the page bytes and ignores bad input', () => {
    const a = estimateQunoteSize(notebook(), 0).withoutRecordings;
    const b = estimateQunoteSize(notebook(), 1_000_000).withoutRecordings;
    assert.ok(b > a + 200_000);
    assert.equal(estimateQunoteSize(notebook(), Number.NaN).withoutRecordings, a);
    assert.equal(estimateQunoteSize(notebook(), -5).withoutRecordings, a);
  });

  test('close to the real packed size', async () => {
    const fs = createMemFs({ dirs: [ROOT, '/cache'] });
    const paths = L.notebook('nb1');
    for (const d of [paths.pagesDir, paths.assetsDir, paths.audioDir]) await fs.mkdirp(d);
    const pdf = new Uint8Array(400_000).map((_, i) => (i * 7) & 0xff);
    const audio = new Uint8Array(300_000).map((_, i) => (i * 11) & 0xff);
    const nb = notebook({
      pageIds: ['p0', 'p1'],
      assets: { pdf1: asset('pdf1', 'pdf', 'pdf', pdf.length), a1: asset('a1', 'audio', 'm4a', audio.length) },
      recordings: [{ id: 'r1', title: 'a', startedAt: T0, durationMs: 1, segments: [{ fileId: 'a1', startMs: 0, durationMs: 1, state: 'done' }] }],
    });
    let pageBytes = 0;
    for (const pid of nb.pageIds) {
      const items: StrokeItem[] = Array.from({ length: 200 }, (_, k) => ({
        id: `s${k}`,
        kind: 'stroke',
        tool: 'pen',
        color: '#1B2533',
        width: 3,
        pressure: true,
        pts: Array.from({ length: 60 }, (_, j) => (j % 3 === 2 ? 0.5 : 100 + Math.sin(j + k) * 50)),
      }));
      const p: Page = { id: pid, size: { w: 595.28, h: 841.89 }, background: { kind: 'paper', paper: PAPER }, items };
      await writeJsonAtomic(fs, paths.page(pid), makePageFile(p, { rev: 1, savedAt: T0 }));
      pageBytes += await fs.size(paths.page(pid));
    }
    await writeJsonAtomic(fs, paths.json, makeNotebookFile(nb, { rev: 1, savedAt: T0, app: 'x' }));
    await fs.appendBytes(paths.asset(nb.assets.pdf1), pdf);
    await fs.appendBytes(paths.asset(nb.assets.a1), audio);

    const est = estimateQunoteSize(nb, pageBytes);
    const now = () => Date.parse(T0);
    const withRec = await packNotebook(fs, paths.dir, '/cache/a.qunote', { includeRecordings: true, appVersion: 'x', now });
    const without = await packNotebook(fs, paths.dir, '/cache/b.qunote', { includeRecordings: false, appVersion: 'x', now });
    const near = (estimate: number, real: number) => Math.abs(estimate - real) / real < 0.15;
    // No cover on disk: the estimate counts one, so allow its size on top.
    assert.ok(near(est.withRecordings - 48 * 1024, withRec.bytes), `${est.withRecordings} vs ${withRec.bytes}`);
    assert.ok(near(est.withoutRecordings - 48 * 1024, without.bytes), `${est.withoutRecordings} vs ${without.bytes}`);
  });
});
