import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { writeJsonAtomic } from '../../../src/notebook/core/fs/journal.ts';
import { nbLayout } from '../../../src/notebook/core/fs/layout.ts';
import { makeNotebookFile, makePageFile, notebookOf, readNotebookFile, readPageFile } from '../../../src/notebook/core/model/index.ts';
import type { Asset, Id, Notebook, Page, StrokeItem } from '../../../src/notebook/core/model/index.ts';
import { crc32 } from '../../../src/notebook/core/qunote/crc32.ts';
import { QunoteError } from '../../../src/notebook/core/qunote/manifest.ts';
import type { QunoteManifest } from '../../../src/notebook/core/qunote/manifest.ts';
import { packNotebook } from '../../../src/notebook/core/qunote/pack.ts';
import { fileSource, readEntryBytes, readZipDirectory } from '../../../src/notebook/core/qunote/zipRead.ts';
import { openSession } from '../../../src/notebook/core/session/session.ts';
import type { SessionDeps } from '../../../src/notebook/core/session/types.ts';
import { createMemFs } from '../helpers/memfs.ts';
import type { MemFs } from '../helpers/memfs.ts';

const ROOT = '/root/notebooks';
const L = nbLayout(ROOT);
const OUT = '/cache/out.qunote';
const T0 = '2026-11-23T10:00:00.000Z';
const NOW = () => Date.parse('2026-11-23T12:00:00.000Z');
const dec = new TextDecoder();
const PAPER = { style: 'lined', color: 'white', size: 'a4' } as const;

function binary(n: number, seed: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 13 + seed) & 0xff;
  for (let at = 0; at + 4 <= n; at += 211) b.set([0x50, 0x4b, 0x07, 0x08], at);
  return b;
}

function stroke(id: Id, rec?: { recordingId: Id; ms: number }): StrokeItem {
  const s: StrokeItem = { id, kind: 'stroke', tool: 'pen', color: '#1B2533', width: 3, pressure: false, pts: [10, 20, 0.5, 15, 25, 0.5] };
  if (rec) s.rec = rec;
  return s;
}

function page(id: Id, items: Page['items'] = []): Page {
  return { id, size: { w: 595.28, h: 841.89 }, background: { kind: 'paper', paper: PAPER }, items };
}

const FILES = {
  pdf: binary(70_000, 1),
  img: binary(9000, 2),
  aud1: binary(40_000, 3),
  aud2: binary(1000, 4),
  cover: binary(3000, 5),
};

async function put(fs: MemFs, path: string, data: Uint8Array) {
  await fs.remove(path);
  await fs.appendBytes(path, data);
}

async function seed(fs: MemFs, id: Id = 'nb1', o?: { version?: number }): Promise<Notebook> {
  const paths = L.notebook(id);
  for (const d of [paths.pagesDir, paths.assetsDir, paths.audioDir, paths.thumbsDir]) await fs.mkdirp(d);
  const asset = (aid: Id, kind: Asset['kind'], ext: string, bytes: number): Asset => ({ id: aid, kind, ext, bytes, addedAt: T0 });
  const nb: Notebook = {
    id,
    title: 'مذكرة الفيزياء',
    folderId: 'f1',
    courseCode: 'PHYS101',
    createdAt: T0,
    updatedAt: T0,
    defaults: PAPER,
    pageIds: ['p0', 'p1'],
    removedPageIds: ['p9'],
    recordings: [
      { id: 'r1', title: 'تسجيل 1', startedAt: T0, durationMs: 5000, segments: [{ fileId: 'aud1', startMs: 0, durationMs: 5000, state: 'done' }] },
      { id: 'r2', title: 'تسجيل 2', startedAt: T0, durationMs: 100, segments: [{ fileId: 'aud2', startMs: 0, durationMs: 100, state: 'recording', pendingPath: '/tmp/x.m4a' }] },
    ],
    assets: {
      pdf1: asset('pdf1', 'pdf', 'pdf', FILES.pdf.length),
      img1: asset('img1', 'image', 'png', FILES.img.length),
      aud1: asset('aud1', 'audio', 'm4a', FILES.aud1.length),
      aud2: asset('aud2', 'audio', 'm4a', FILES.aud2.length),
    },
    origin: { kind: 'blank' },
    contentRev: 4,
  };
  const pages = [
    page('p0', [stroke('s1', { recordingId: 'r1', ms: 100 }), stroke('s2', { recordingId: 'r2', ms: 50 }), stroke('s3')]),
    page('p1', [{ id: 't1', kind: 'text', box: { x: 10, y: 10, w: 200, h: 40, rot: 0 }, text: 'مرحبا', size: 16, color: '#1B2533', bold: false }]),
    page('p9', [stroke('gone')]),
  ];
  for (const p of pages) await writeJsonAtomic(fs, paths.page(p.id), makePageFile(p, { rev: 2, savedAt: T0 }));
  const file = makeNotebookFile(nb, { rev: 3, savedAt: T0, app: '1.0.0' });
  const value: { rev: number } = o?.version ? Object.assign({}, file, { version: o.version }) : file;
  await writeJsonAtomic(fs, paths.json, value);
  await put(fs, paths.asset(nb.assets.pdf1), FILES.pdf);
  await put(fs, paths.asset(nb.assets.img1), FILES.img);
  await put(fs, paths.asset(nb.assets.aud1), FILES.aud1);
  await put(fs, paths.asset(nb.assets.aud2), FILES.aud2);
  await put(fs, paths.cover, FILES.cover);
  return nb;
}

function setup() {
  const fs = createMemFs({ dirs: [ROOT, '/cache'] });
  return fs;
}

async function openArchive(fs: MemFs, path = OUT) {
  const src = fileSource(fs, path);
  const dir = await readZipDirectory(src);
  const bytes = async (name: string) => {
    const e = dir.byName.get(name);
    assert.ok(e, `missing entry ${name}`);
    return readEntryBytes(src, dir, e, 1 << 28);
  };
  const json = async (name: string) => JSON.parse(dec.decode(await bytes(name)));
  const manifest = (await json('qunote.json')) as QunoteManifest;
  return { dir, bytes, json, manifest, names: dir.entries.map((e) => e.name) };
}

describe('packNotebook', () => {
  test('with recordings: format order, manifest sizes and CRCs, finished segments only', async () => {
    const fs = setup();
    await seed(fs);
    const progress: [number, number][] = [];
    const r = await packNotebook(fs, L.notebook('nb1').dir, OUT, { includeRecordings: true, appVersion: '2.0.0', now: NOW, onProgress: (d, t) => progress.push([d, t]) });
    const a = await openArchive(fs);
    assert.deepEqual(a.names, ['qunote.json', 'notebook.json', 'pages/p0.json', 'pages/p1.json', 'assets/pdf1.pdf', 'assets/img1.png', 'audio/aud1.m4a', 'thumbs/cover.png']);
    assert.equal(r.bytes, await fs.size(OUT));

    const m = a.manifest;
    assert.equal(m.format, 'qunote');
    assert.equal(m.version, 1);
    assert.equal(m.app, '2.0.0');
    assert.equal(m.notebookId, 'nb1');
    assert.equal(m.title, 'مذكرة الفيزياء');
    assert.equal(m.includesRecordings, true);
    assert.equal(m.pageCount, 2);
    assert.equal(m.exportedAt, '2026-11-23T12:00:00.000Z');
    assert.deepEqual(
      m.files.map((f) => f.path),
      a.names.slice(1),
    );
    for (const f of m.files) {
      const e = a.dir.byName.get(f.path);
      assert.ok(e);
      assert.equal(e.size, f.bytes, f.path);
      assert.equal(e.crc32, f.crc32, f.path);
      assert.equal(crc32(await a.bytes(f.path)), f.crc32, f.path);
      assert.equal(e.method, f.path.endsWith('.json') ? 8 : 0, f.path);
    }
    assert.deepEqual(await a.bytes('assets/pdf1.pdf'), FILES.pdf);
    assert.deepEqual(await a.bytes('audio/aud1.m4a'), FILES.aud1);
    assert.deepEqual(await a.bytes('thumbs/cover.png'), FILES.cover);

    const nbf = readNotebookFile(await a.json('notebook.json'));
    assert.ok(nbf);
    assert.equal(nbf.app, '2.0.0');
    assert.deepEqual(nbf.removedPageIds, []);
    assert.equal(nbf.folderId, undefined);
    assert.equal(nbf.courseCode, 'PHYS101');
    assert.deepEqual(
      nbf.recordings.map((x) => x.id),
      ['r1'],
    );
    assert.deepEqual(Object.keys(nbf.assets).sort(), ['aud1', 'img1', 'pdf1']);

    const p0 = readPageFile(await a.json('pages/p0.json'));
    assert.ok(p0);
    // r1 is in the file, r2 (still recording) is not: its mark is stripped.
    assert.deepEqual(
      p0.page.items.map((i) => i.rec?.recordingId ?? null),
      ['r1', null, null],
    );

    assert.ok(progress.length > 0);
    const [done, total] = progress[progress.length - 1];
    assert.equal(done, total);
  });

  test('without recordings: a filtered copy without audio, recordings or marks', async () => {
    const fs = setup();
    await seed(fs);
    await packNotebook(fs, L.notebook('nb1').dir, OUT, { includeRecordings: false, appVersion: '2.0.0', now: NOW });
    const a = await openArchive(fs);
    assert.deepEqual(a.names, ['qunote.json', 'notebook.json', 'pages/p0.json', 'pages/p1.json', 'assets/pdf1.pdf', 'assets/img1.png', 'thumbs/cover.png']);
    assert.equal(a.manifest.includesRecordings, false);
    const nbf = readNotebookFile(await a.json('notebook.json'));
    assert.ok(nbf);
    assert.deepEqual(nbf.recordings, []);
    assert.deepEqual(Object.keys(nbf.assets).sort(), ['img1', 'pdf1']);
    const p0 = readPageFile(await a.json('pages/p0.json'));
    assert.ok(p0);
    assert.ok(p0.page.items.every((i) => i.rec === undefined));
  });

  test('a closed notebook is read with repair:false (never written) and the best rev wins', async () => {
    const fs = setup();
    await seed(fs);
    const paths = L.notebook('nb1');
    // A newer save of p1 whose main file is torn: the .bak is older, the .tmp is the newest valid one.
    const p1v3 = makePageFile(page('p1', [stroke('fresh')]), { rev: 3, savedAt: T0 });
    await fs.writeText(`${paths.page('p1')}.tmp`, JSON.stringify(p1v3));
    await fs.writeText(paths.page('p1'), '{"format":"qu-page","rev":9,');
    // notebook.json main is damaged too: the .bak (written by the second save) wins.
    await writeJsonAtomic(fs, paths.json, makeNotebookFile({ ...(await seedNotebook(fs)), title: 'second' }, { rev: 5, savedAt: T0, app: 'x' }));
    await fs.writeText(paths.json, 'garbage');
    fs.clearLog();
    await packNotebook(fs, paths.dir, OUT, { includeRecordings: true, appVersion: '2.0.0', now: NOW });
    assert.ok(
      fs.log.every((e) => e.path.startsWith('/cache/')),
      JSON.stringify(fs.log),
    );
    const a = await openArchive(fs);
    const nbf = readNotebookFile(await a.json('notebook.json'));
    assert.equal(nbf?.title, 'مذكرة الفيزياء');
    const p1 = readPageFile(await a.json('pages/p1.json'));
    assert.deepEqual(
      p1?.page.items.map((i) => i.id),
      ['fresh'],
    );
  });

  test('an open session is packed under its write lock, with unsaved edits flushed first', async () => {
    const fs = setup();
    await seed(fs);
    let t = Date.parse(T0);
    let n = 0;
    const deps: SessionDeps = {
      fs,
      root: ROOT,
      now: () => (t += 5),
      newId: () => `n${++n}`,
      setTimer: () => 0,
      clearTimer: () => {},
      appVersion: 'test',
      onIndexEntry: () => {},
      onSaved: () => {},
    };
    const r = await openSession(deps, 'nb1');
    assert.ok('session' in r);
    const s = r.session;
    await s.loadPage('p1');
    s.addItems('p1', [stroke('unsaved')]);
    let locked = 0;
    await packNotebook(fs, L.notebook('nb1').dir, OUT, { includeRecordings: true, appVersion: '2.0.0', now: NOW }, async (fn) => {
      locked++;
      return s.withWriteLock(fn);
    });
    assert.equal(locked, 1);
    const a = await openArchive(fs);
    const p1 = readPageFile(await a.json('pages/p1.json'));
    assert.ok(p1?.page.items.some((i) => i.id === 'unsaved'));
    await s.release();
  });

  test('every read happens inside the lock', async () => {
    const fs = setup();
    await seed(fs);
    let inside = false;
    const outsideReads: string[] = [];
    const watched = {
      ...fs,
      readText: async (p: string) => {
        if (!inside) outsideReads.push(p);
        return fs.readText(p);
      },
      readBytes: async (p: string, o: number, l: number) => {
        if (!inside && !p.startsWith('/cache/')) outsideReads.push(p);
        return fs.readBytes(p, o, l);
      },
    };
    await packNotebook(watched, L.notebook('nb1').dir, OUT, { includeRecordings: true, appVersion: '2.0.0', now: NOW }, async (fn) => {
      inside = true;
      try {
        return await fn();
      } finally {
        inside = false;
      }
    });
    assert.deepEqual(outsideReads, []);
  });

  test('refuses a newer-version notebook and a missing one, leaving no output', async () => {
    const fs = setup();
    await seed(fs, 'nb2', { version: 2 });
    await fs.writeText(OUT, 'old');
    await assert.rejects(packNotebook(fs, L.notebook('nb2').dir, OUT, { includeRecordings: true, appVersion: '2', now: NOW }), (e: unknown) => {
      assert.ok(e instanceof QunoteError);
      assert.equal(e.code, 'read-only');
      return true;
    });
    assert.equal(await fs.exists(OUT), false);
    await assert.rejects(packNotebook(fs, L.notebook('none').dir, OUT, { includeRecordings: true, appVersion: '2', now: NOW }), (e: unknown) => {
      assert.ok(e instanceof QunoteError);
      assert.equal(e.code, 'missing');
      return true;
    });
  });

  test('the cover is read once: a thumbnail rewrite during the pack does not fail it', async () => {
    const fs = setup();
    await seed(fs);
    const paths = L.notebook('nb1');
    let coverReads = 0;
    const racing = {
      ...fs,
      readBytes: async (p: string, o: number, l: number) => {
        const b = await fs.readBytes(p, o, l);
        if (p === paths.cover) {
          coverReads += 1;
          // The thumbnail worker writes a new cover right after the pack read it.
          await put(fs, paths.cover, binary(5000, 9));
        }
        return b;
      },
    };
    await packNotebook(racing, paths.dir, OUT, { includeRecordings: false, appVersion: '2', now: NOW });
    assert.equal(coverReads, 1);
    const a = await openArchive(fs);
    assert.deepEqual(await a.bytes('thumbs/cover.png'), FILES.cover);
    const listed = a.manifest.files.find((f) => f.path === 'thumbs/cover.png');
    assert.deepEqual(listed, { path: 'thumbs/cover.png', bytes: FILES.cover.length, crc32: crc32(FILES.cover) });
    assert.equal(a.names.at(-1), 'thumbs/cover.png');
  });

  test('missing asset files and pages are left out, not fatal', async () => {
    const fs = setup();
    const nb = await seed(fs);
    const paths = L.notebook('nb1');
    await fs.remove(paths.asset(nb.assets.img1));
    await fs.remove(paths.page('p1'));
    await fs.remove(`${paths.page('p1')}.bak`);
    await fs.remove(paths.cover);
    await packNotebook(fs, paths.dir, OUT, { includeRecordings: false, appVersion: '2', now: NOW });
    const a = await openArchive(fs);
    assert.deepEqual(a.names, ['qunote.json', 'notebook.json', 'pages/p0.json', 'assets/pdf1.pdf']);
    assert.equal(a.manifest.pageCount, 2);
  });
});

/** The seeded notebook as read back (for rewriting it). */
async function seedNotebook(fs: MemFs): Promise<Notebook> {
  const text = await fs.readText(L.notebook('nb1').json);
  const f = readNotebookFile(JSON.parse(text ?? '{}'));
  assert.ok(f);
  return notebookOf(f);
}
