import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { serializeEnvelope, writeJsonAtomic } from '../../../src/notebook/core/fs/journal.ts';
import { nbLayout } from '../../../src/notebook/core/fs/layout.ts';
import { createLibraryOps } from '../../../src/notebook/core/library/ops.ts';
import { emptyIndex, makeNotebookFile, makePageFile, readNotebookFile } from '../../../src/notebook/core/model/index.ts';
import type { Asset, Id, IndexFile, Notebook, Page } from '../../../src/notebook/core/model/index.ts';
import { crc32 } from '../../../src/notebook/core/qunote/crc32.ts';
import { QunoteError, buildManifest, readManifest, validateEntryPath } from '../../../src/notebook/core/qunote/manifest.ts';
import type { QunoteErrorCode } from '../../../src/notebook/core/qunote/manifest.ts';
import { packNotebook } from '../../../src/notebook/core/qunote/pack.ts';
import { asCopy, asRestore } from '../../../src/notebook/core/qunote/remap.ts';
import { inspectQunote, unpackQunote } from '../../../src/notebook/core/qunote/unpack.ts';
import { fileSource } from '../../../src/notebook/core/qunote/zipRead.ts';
import { createZipWriter, memorySink } from '../../../src/notebook/core/qunote/zipWrite.ts';
import { openSession } from '../../../src/notebook/core/session/session.ts';
import type { IndexAccess, SessionDeps } from '../../../src/notebook/core/session/types.ts';
import { createMemFs } from '../helpers/memfs.ts';
import type { MemFs } from '../helpers/memfs.ts';

const ROOT = '/root/notebooks';
const L = nbLayout(ROOT);
const OUT = '/cache/in.qunote';
const STAGE = '/root/notebooks/.staging/job1/nb';
const T0 = '2026-11-23T10:00:00.000Z';
const NOW = () => Date.parse('2026-11-23T12:00:00.000Z');
const enc = new TextEncoder();
const PAPER = { style: 'grid', color: 'cream', size: 'a4' } as const;

function binary(n: number, seed: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 17 + seed) & 0xff;
  for (let at = 0; at + 4 <= n; at += 101) b.set([0x50, 0x4b, 0x07, 0x08], at);
  return b;
}

const PDF = binary(50_000, 9);
const AUDIO = binary(20_000, 3);

function page(id: Id, items: Page['items'] = []): Page {
  return { id, size: { w: 612, h: 792 }, background: { kind: 'pdf', fileId: 'pdf1', pageIndex: 0, rotation: 0 }, items };
}

function sampleNotebook(id: Id): Notebook {
  const asset = (aid: Id, kind: Asset['kind'], ext: string, bytes: number): Asset => ({ id: aid, kind, ext, bytes, addedAt: T0 });
  return {
    id,
    title: 'Chem notes',
    createdAt: T0,
    updatedAt: T0,
    defaults: PAPER,
    pageIds: ['p0', 'p1'],
    removedPageIds: [],
    recordings: [{ id: 'r1', title: 'تسجيل 1', startedAt: T0, durationMs: 900, segments: [{ fileId: 'aud1', startMs: 0, durationMs: 900, state: 'done' }] }],
    assets: { pdf1: asset('pdf1', 'pdf', 'pdf', PDF.length), aud1: asset('aud1', 'audio', 'm4a', AUDIO.length) },
    origin: { kind: 'pdf', name: 'chem.pdf' },
    contentRev: 7,
  };
}

async function put(fs: MemFs, path: string, data: Uint8Array) {
  await fs.remove(path);
  await fs.appendBytes(path, data);
}

async function seed(fs: MemFs, id: Id): Promise<Notebook> {
  const nb = sampleNotebook(id);
  const paths = L.notebook(id);
  for (const d of [paths.pagesDir, paths.assetsDir, paths.audioDir]) await fs.mkdirp(d);
  const s1 = { id: 's1', kind: 'stroke', tool: 'pen', color: '#1D4ED8', width: 3, pressure: true, pts: [1, 2, 0.5, 3, 4, 0.6], rec: { recordingId: 'r1', ms: 10 } } as const;
  await writeJsonAtomic(fs, paths.page('p0'), makePageFile(page('p0', [{ ...s1, pts: [...s1.pts], rec: { ...s1.rec } }]), { rev: 1, savedAt: T0 }));
  await writeJsonAtomic(fs, paths.page('p1'), makePageFile(page('p1'), { rev: 1, savedAt: T0 }));
  await writeJsonAtomic(fs, paths.json, makeNotebookFile(nb, { rev: 2, savedAt: T0, app: '1.0.0' }));
  await put(fs, paths.asset(nb.assets.pdf1), PDF);
  await put(fs, paths.asset(nb.assets.aud1), AUDIO);
  return nb;
}

function setup() {
  return createMemFs({ dirs: [ROOT, `${ROOT}/.staging/job1`, '/cache'] });
}

async function packed(fs: MemFs, id: Id = 'src1') {
  await seed(fs, id);
  await packNotebook(fs, L.notebook(id).dir, OUT, { includeRecordings: true, appVersion: '2.0.0', now: NOW });
}

/** Writes a hand-made archive. The manifest lists the entries (minus qunote.json) unless overridden. */
async function custom(
  fs: MemFs,
  entries: { path: string; data: Uint8Array; deflate?: boolean }[],
  o?: { manifest?: (m: Record<string, unknown>) => unknown; noManifest?: boolean },
) {
  const sink = memorySink();
  const zip = createZipWriter(sink, { now: NOW });
  if (!o?.noManifest) {
    const m = buildManifest({
      app: 'x',
      exportedAt: T0,
      notebookId: 'src1',
      title: 'T',
      includesRecordings: false,
      pageCount: 1,
      files: entries.map((e) => ({ path: e.path, bytes: e.data.length, crc32: crc32(e.data) })),
    });
    const raw = o?.manifest ? o.manifest(m as unknown as Record<string, unknown>) : m;
    await zip.addBytes('qunote.json', enc.encode(JSON.stringify(raw)), { deflate: true });
  }
  for (const e of entries) await zip.addBytes(e.path, e.data, { deflate: e.deflate ?? e.path.endsWith('.json') });
  await zip.finish();
  await fs.remove(OUT);
  await fs.appendBytes(OUT, sink.bytes());
}

const nbJson = (nb: Notebook, version = 1) => enc.encode(serializeEnvelope({ ...makeNotebookFile(nb, { rev: 1, savedAt: T0, app: 'x' }), version }));
const pageJson = (p: Page) => enc.encode(serializeEnvelope(makePageFile(p, { rev: 1, savedAt: T0 })));

function minimal(): Notebook {
  return { ...sampleNotebook('src1'), pageIds: ['p0'], recordings: [], assets: {} };
}

const unpack = (fs: MemFs, extra?: { freeBytes?: number }) =>
  unpackQunote(fs, fileSource(fs, OUT), STAGE, { appVersion: '3.0.0', now: NOW, transform: (nb) => asCopy(nb, { newId: 'copy1', now: NOW() }), ...extra });

async function rejectsWith(p: Promise<unknown>, code: QunoteErrorCode) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof QunoteError, `expected QunoteError, got ${String(e)}`);
    assert.equal(e.code, code, e.message);
    return true;
  });
}

describe('validateEntryPath', () => {
  test('accepts only the format paths', () => {
    assert.deepEqual(validateEntryPath('notebook.json'), { kind: 'notebook' });
    assert.deepEqual(validateEntryPath('pages/p0.json'), { kind: 'page', id: 'p0' });
    assert.deepEqual(validateEntryPath('assets/pdf1.pdf'), { kind: 'asset', id: 'pdf1', ext: 'pdf' });
    assert.deepEqual(validateEntryPath('audio/a_1.m4a'), { kind: 'audio', id: 'a_1', ext: 'm4a' });
    assert.deepEqual(validateEntryPath('thumbs/cover.png'), { kind: 'cover' });
    for (const bad of [
      '../notebook.json',
      '/notebook.json',
      'pages/../../x.json',
      'pages/..json',
      'pages\\p0.json',
      'pages/p0.json/x',
      'pages//p0.json',
      'assets/x',
      'assets/.pdf',
      'assets/a.PDF',
      'assets/a b.pdf',
      'audio/__proto__.m4a',
      'thumbs/other.png',
      'other/x.json',
      '',
      'pages/',
      'notebook.json.bak',
    ]) {
      assert.equal(validateEntryPath(bad), null, bad);
    }
  });

  test('readManifest: newer version, other formats and duplicate paths', () => {
    const base = { format: 'qunote', version: 1, notebookId: 'n1', files: [{ path: 'notebook.json', bytes: 1, crc32: 2 }] };
    assert.equal(readManifest(base).ok, true);
    assert.deepEqual(readManifest({ ...base, version: 2 }), { ok: false, error: 'newer-version' });
    assert.deepEqual(readManifest({ ...base, format: 'zip' }), { ok: false, error: 'not-qunote' });
    assert.deepEqual(readManifest(null), { ok: false, error: 'not-qunote' });
    assert.deepEqual(readManifest({ ...base, files: [...base.files, ...base.files] }), { ok: false, error: 'damaged' });
    assert.deepEqual(readManifest({ ...base, files: [{ path: '../x', bytes: 1, crc32: 1 }] }), { ok: false, error: 'damaged' });
    assert.deepEqual(readManifest({ ...base, files: [] }), { ok: false, error: 'damaged' });
    assert.deepEqual(readManifest({ ...base, files: [{ path: 'notebook.json', bytes: -1, crc32: 1 }] }), { ok: false, error: 'damaged' });
  });
});

describe('inspectQunote', () => {
  test('summary from the central directory and manifest only', async () => {
    const fs = setup();
    await packed(fs);
    let reads = 0;
    const src = fileSource(fs, OUT);
    const counted = { size: src.size, read: async (o: number, l: number) => (reads++, src.read(o, l)) };
    const info = await inspectQunote(counted);
    assert.ok(!('error' in info));
    assert.equal(info.title, 'Chem notes');
    assert.equal(info.pageCount, 2);
    assert.equal(info.includesRecordings, true);
    assert.equal(info.notebookId, 'src1');
    assert.ok(info.bytes >= PDF.length + AUDIO.length);
    // EOCD tail, central directory, qunote.json local header and data.
    assert.ok(reads <= 5, `reads ${reads}`);
  });

  test('errors: not a zip, no manifest, newer version, damaged', async () => {
    const fs = setup();
    await fs.writeText(OUT, '%PDF-1.4 this is a pdf');
    assert.deepEqual(await inspectQunote(fileSource(fs, OUT)), { error: 'not-qunote' });
    await custom(fs, [{ path: 'notebook.json', data: nbJson(minimal()) }], { noManifest: true });
    assert.deepEqual(await inspectQunote(fileSource(fs, OUT)), { error: 'not-qunote' });
    await custom(fs, [{ path: 'notebook.json', data: nbJson(minimal()) }], { manifest: (m) => ({ ...m, version: 2 }) });
    assert.deepEqual(await inspectQunote(fileSource(fs, OUT)), { error: 'newer-version' });
    await custom(fs, [{ path: 'notebook.json', data: nbJson(minimal()) }], {
      manifest: (m) => ({ ...m, files: [{ path: 'notebook.json', bytes: 3, crc32: 1 }] }),
    });
    assert.deepEqual(await inspectQunote(fileSource(fs, OUT)), { error: 'damaged' });
  });
});

describe('unpackQunote', () => {
  test('round trip as a copy, adopted into the library and opened', async () => {
    const fs = setup();
    await packed(fs);
    const r = await unpack(fs);
    assert.equal(r.notebook.id, 'copy1');
    assert.equal(r.notebook.origin.kind, 'qunote');
    assert.equal(r.notebook.contentRev, 0);
    assert.equal(r.hasCover, false);
    const nbf = readNotebookFile(JSON.parse((await fs.readText(`${STAGE}/notebook.json`)) ?? 'null'));
    assert.equal(nbf?.id, 'copy1');
    assert.equal(nbf?.app, '3.0.0');
    assert.deepEqual(await fs.readBytes(`${STAGE}/assets/pdf1.pdf`, 0, 1 << 20), PDF);
    assert.deepEqual(await fs.readBytes(`${STAGE}/audio/aud1.m4a`, 0, 1 << 20), AUDIO);

    let idx: IndexFile = emptyIndex();
    const index: IndexAccess = { get: () => idx, update: (fn) => void (idx = fn(idx)) };
    let t = NOW();
    const ops = createLibraryOps({ fs, root: ROOT, now: () => (t += 3), newId: () => 'unused', index, appVersion: '3.0.0' });
    const id = await ops.adoptFolder(STAGE, { kind: 'course', code: 'CHEM101' });
    assert.equal(id, 'copy1');
    const entry = idx.entries.find((e) => e.id === 'copy1');
    assert.equal(entry?.courseCode, 'CHEM101');
    assert.equal(entry?.pageCount, 2);
    assert.equal(entry?.needsThumb, true);

    const deps: SessionDeps = {
      fs,
      root: ROOT,
      now: () => (t += 3),
      newId: () => `x${t}`,
      setTimer: () => 0,
      clearTimer: () => {},
      appVersion: '3.0.0',
      onIndexEntry: () => {},
      onSaved: () => {},
    };
    const o = await openSession(deps, 'copy1');
    assert.ok('session' in o);
    const p0 = await o.session.loadPage('p0');
    assert.equal(p0.items.length, 1);
    assert.equal(p0.items[0].rec?.recordingId, 'r1');
    assert.deepEqual(await fs.readBytes(o.session.assetPath('pdf1'), 0, 1 << 20), PDF);
    assert.equal(o.session.notebook.recordings.length, 1);
    await o.session.release();
  });

  test('as a restore the id and dates are kept', async () => {
    const fs = setup();
    await packed(fs);
    const r = await unpackQunote(fs, fileSource(fs, OUT), STAGE, { appVersion: '3', now: NOW, transform: (nb) => asRestore(nb, { now: NOW() }) });
    assert.equal(r.notebook.id, 'src1');
    assert.equal(r.notebook.createdAt, T0);
    assert.equal(r.notebook.contentRev, 7);
    assert.equal(r.notebook.origin.kind, 'pdf');
  });

  test('path traversal is rejected, listed or not', async () => {
    const fs = setup();
    const nb = nbJson(minimal());
    await custom(fs, [
      { path: 'notebook.json', data: nb },
      { path: '../evil.json', data: enc.encode('{}') },
    ]);
    await rejectsWith(unpack(fs), 'damaged');
    assert.equal(await fs.exists('/root/notebooks/.staging/evil.json'), false);

    // Not in the manifest at all.
    const sink = memorySink();
    const zip = createZipWriter(sink, { now: NOW });
    const files = [{ path: 'notebook.json', bytes: nb.length, crc32: crc32(nb) }];
    await zip.addBytes('qunote.json', enc.encode(JSON.stringify(buildManifest({ app: 'x', exportedAt: T0, notebookId: 'src1', title: 'T', includesRecordings: false, pageCount: 1, files }))), { deflate: true });
    await zip.addBytes('notebook.json', nb, { deflate: true });
    await zip.addBytes('../../outside.bin', enc.encode('x'), { deflate: false });
    await zip.finish();
    await fs.remove(OUT);
    await fs.appendBytes(OUT, sink.bytes());
    await rejectsWith(unpack(fs), 'damaged');
    assert.equal(await fs.exists(STAGE), false);
  });

  test('duplicate entries are rejected', async () => {
    const fs = setup();
    const nb = nbJson(minimal());
    const p = pageJson({ ...page('p0'), background: { kind: 'paper', paper: PAPER } });
    await custom(fs, [
      { path: 'notebook.json', data: nb },
      { path: 'pages/p0.json', data: p },
      { path: 'pages/p1.json', data: p },
    ]);
    // Rename the last central-directory entry onto the one before it.
    const bytes = await fs.readBytes(OUT, 0, 1 << 20);
    const eocd = bytes.length - 22;
    const count = bytes[eocd + 10] | (bytes[eocd + 11] << 8);
    let at = (bytes[eocd + 16] | (bytes[eocd + 17] << 8) | (bytes[eocd + 18] << 16) | (bytes[eocd + 19] << 24)) >>> 0;
    for (let i = 0; i < count - 1; i++) at += 46 + (bytes[at + 28] | (bytes[at + 29] << 8)) + (bytes[at + 30] | (bytes[at + 31] << 8));
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + 13));
    assert.equal(name, 'pages/p1.json');
    bytes[at + 46 + 7] = '0'.charCodeAt(0);
    await fs.remove(OUT);
    await fs.appendBytes(OUT, bytes);
    await rejectsWith(unpack(fs), 'damaged');
  });

  test('a v2 manifest and a v2 notebook.json are newer-version', async () => {
    const fs = setup();
    await custom(fs, [{ path: 'notebook.json', data: nbJson(minimal()) }], { manifest: (m) => ({ ...m, version: 2 }) });
    await rejectsWith(unpack(fs), 'newer-version');
    await custom(fs, [{ path: 'notebook.json', data: nbJson(minimal(), 2) }]);
    await rejectsWith(unpack(fs), 'newer-version');
  });

  test('not a qunote: no zip, no manifest, another format', async () => {
    const fs = setup();
    await fs.writeText(OUT, 'hello');
    await rejectsWith(unpack(fs), 'not-qunote');
    await custom(fs, [{ path: 'notebook.json', data: nbJson(minimal()) }], { noManifest: true });
    await rejectsWith(unpack(fs), 'not-qunote');
    await custom(fs, [{ path: 'notebook.json', data: nbJson(minimal()) }], { manifest: (m) => ({ ...m, format: 'other' }) });
    await rejectsWith(unpack(fs), 'not-qunote');
  });

  test('damaged content: corrupt bytes, bad JSON, wrong id, asset path mismatch', async () => {
    const fs = setup();
    await packed(fs);
    const bytes = await fs.readBytes(OUT, 0, 1 << 22);
    // Corrupt the PDF data (stored): find it by its content.
    const probe = PDF.subarray(1000, 1032);
    let hit = -1;
    for (let i = 0; i + probe.length <= bytes.length && hit < 0; i++) {
      let ok = true;
      for (let k = 0; k < probe.length && ok; k++) ok = bytes[i + k] === probe[k];
      if (ok) hit = i;
    }
    assert.ok(hit > 0);
    bytes[hit + 5] ^= 0x55;
    await fs.remove(OUT);
    await fs.appendBytes(OUT, bytes);
    await rejectsWith(unpack(fs), 'damaged');
    assert.equal(await fs.exists(STAGE), false);

    await custom(fs, [{ path: 'notebook.json', data: enc.encode('{"format":"qu-notebook"') }]);
    await rejectsWith(unpack(fs), 'damaged');

    await custom(fs, [{ path: 'notebook.json', data: nbJson({ ...minimal(), id: 'other' }) }]);
    await rejectsWith(unpack(fs), 'damaged');

    const withAsset: Notebook = { ...minimal(), assets: { img1: { id: 'img1', kind: 'image', ext: 'jpg', bytes: 3, addedAt: T0 } } };
    await custom(fs, [
      { path: 'notebook.json', data: nbJson(withAsset) },
      { path: 'assets/img1.png', data: enc.encode('png') },
    ]);
    await rejectsWith(unpack(fs), 'damaged');
  });

  test('a failed write into the staging folder is not reported as a damaged file', async () => {
    const fs = setup();
    await packed(fs);
    const full = new Error('ENOSPC: no space left on device');
    const failing: MemFs = {
      ...fs,
      appendBytes: async (p: string, b: Uint8Array) => {
        if (p.startsWith(STAGE)) throw full;
        await fs.appendBytes(p, b);
      },
    };
    await assert.rejects(
      unpackQunote(failing, fileSource(fs, OUT), STAGE, { appVersion: '3.0.0', now: NOW }),
      (e: unknown) => e === full,
    );
    assert.equal(await fs.exists(STAGE), false);
  });

  test('zip-bomb guard: content larger than the free space is refused', async () => {
    const fs = setup();
    await packed(fs);
    await rejectsWith(unpack(fs, { freeBytes: 10_000 }), 'no-space');
    const ok = await unpack(fs, { freeBytes: 10_000_000 });
    assert.equal(ok.notebook.id, 'copy1');
  });

  test('pages and assets the notebook does not list are not kept', async () => {
    const fs = setup();
    const nb = minimal();
    const p = pageJson({ ...page('p0'), background: { kind: 'paper', paper: PAPER } });
    await custom(fs, [
      { path: 'notebook.json', data: nbJson(nb) },
      { path: 'pages/p0.json', data: p },
      { path: 'pages/stray.json', data: pageJson({ ...page('stray'), background: { kind: 'paper', paper: PAPER } }) },
      { path: 'assets/loose.pdf', data: enc.encode('x') },
      { path: 'thumbs/cover.png', data: enc.encode('png!') },
    ]);
    const r = await unpack(fs);
    assert.equal(r.hasCover, true);
    assert.equal(await fs.exists(`${STAGE}/pages/p0.json`), true);
    assert.equal(await fs.exists(`${STAGE}/pages/stray.json`), false);
    assert.equal(await fs.exists(`${STAGE}/assets/loose.pdf`), false);
    assert.equal(await fs.readText(`${STAGE}/thumbs/cover.png`), 'png!');
  });
});
