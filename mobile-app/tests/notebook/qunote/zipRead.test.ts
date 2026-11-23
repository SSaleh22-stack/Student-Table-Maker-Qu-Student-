import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { Zip, ZipPassThrough } from 'fflate';

import { crc32, crc32Stream } from '../../../src/notebook/core/qunote/crc32.ts';
import {
  MAX_ZIP_ENTRIES,
  ZIP_CHUNK,
  ZipError,
  extractEntry,
  fileSource,
  memorySource,
  readEntryBytes,
  readZipDirectory,
} from '../../../src/notebook/core/qunote/zipRead.ts';
import type { ByteSink, ByteSource, ZipDirectory } from '../../../src/notebook/core/qunote/zipRead.ts';
import { ZipWriteError, createZipWriter, fileSink, memorySink } from '../../../src/notebook/core/qunote/zipWrite.ts';
import { createMemFs } from '../helpers/memfs.ts';

const NOW = () => Date.parse('2026-11-23T10:00:00.000Z');
const enc = new TextEncoder();
const dec = new TextDecoder();

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const put16 = (b: Uint8Array, i: number, v: number) => {
  b[i] = v & 0xff;
  b[i + 1] = (v >>> 8) & 0xff;
};
const put32 = (b: Uint8Array, i: number, v: number) => {
  b[i] = v & 0xff;
  b[i + 1] = (v >>> 8) & 0xff;
  b[i + 2] = (v >>> 16) & 0xff;
  b[i + 3] = (v >>> 24) & 0xff;
};

/** A binary that is full of zip signatures, the data-descriptor one above all. */
function trickyBinary(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
  const sigs = [
    [0x50, 0x4b, 0x07, 0x08],
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x01, 0x02],
    [0x50, 0x4b, 0x05, 0x06],
  ];
  // Every other planted signature is the data-descriptor one.
  for (let at = 0, k = 0; at + 4 <= n; at += 97, k++) b.set(sigs[k % 2 === 0 ? 0 : (k >> 1) % 4], at);
  return b;
}

async function buildZip(files: { name: string; data: Uint8Array; deflate: boolean }[]): Promise<Uint8Array> {
  const sink = memorySink();
  const zip = createZipWriter(sink, { now: NOW });
  for (const f of files) await zip.addBytes(f.name, f.data, { deflate: f.deflate });
  await zip.finish();
  return sink.bytes();
}

async function readAll(src: ByteSource, dir: ZipDirectory, name: string): Promise<Uint8Array> {
  const e = dir.byName.get(name);
  assert.ok(e, `entry ${name}`);
  return readEntryBytes(src, dir, e, 1 << 30);
}

/** Central-directory entry offsets of an archive without a comment. */
function cdEntries(zip: Uint8Array): number[] {
  const eocd = zip.length - 22;
  assert.equal(u32(zip, eocd), 0x06054b50);
  const count = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(p);
    p += 46 + u16(zip, p + 28) + u16(zip, p + 30) + u16(zip, p + 32);
  }
  return out;
}

const rejects = async (p: Promise<unknown>, code: ZipError['code']) => {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ZipError, `expected ZipError, got ${String(e)}`);
    assert.equal(e.code, code, e.message);
    return true;
  });
};

describe('crc32', () => {
  test('known value and incremental use', () => {
    assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
    assert.equal(crc32(new Uint8Array(0)), 0);
    const data = trickyBinary(100_003);
    const whole = crc32(data);
    let run = 0;
    for (let i = 0; i < data.length; i += 4099) run = crc32(data.subarray(i, i + 4099), run);
    assert.equal(run, whole);
    const s = crc32Stream();
    s.push(data.subarray(0, 10));
    s.push(data.subarray(10));
    assert.equal(s.value, whole);
    assert.equal(s.bytes, data.length);
  });
});

describe('zip reader (central directory only)', () => {
  test('a stored binary full of PK\\x07\\x08 extracts intact (fflate writes data descriptors)', async () => {
    const bin = trickyBinary(300_001);
    let count = 0;
    for (let i = 0; i + 4 <= bin.length; i++) if (bin[i] === 0x50 && bin[i + 1] === 0x4b && bin[i + 2] === 7 && bin[i + 3] === 8) count++;
    assert.ok(count > 100, 'the binary holds many data-descriptor signatures');
    const json = enc.encode(JSON.stringify({ hello: 'مرحبا', list: Array.from({ length: 500 }, (_, i) => i) }));
    const zip = await buildZip([
      { name: 'qunote.json', data: json, deflate: true },
      { name: 'assets/a1.pdf', data: bin, deflate: false },
      { name: 'empty.bin', data: new Uint8Array(0), deflate: false },
      { name: 'empty.json', data: new Uint8Array(0), deflate: true },
    ]);
    // The local headers do use the data-descriptor flag (sizes unknown when the header was written).
    assert.equal(u16(zip, 6) & 0x8, 0x8);

    const src = memorySource(zip);
    const dir = await readZipDirectory(src);
    assert.deepEqual(
      dir.entries.map((e) => [e.name, e.method]),
      [
        ['qunote.json', 8],
        ['assets/a1.pdf', 0],
        ['empty.bin', 0],
        ['empty.json', 8],
      ],
    );
    assert.equal(dir.totalSize, json.length + bin.length);
    assert.deepEqual(await readAll(src, dir, 'assets/a1.pdf'), bin);
    assert.equal(dec.decode(await readAll(src, dir, 'qunote.json')), dec.decode(json));
    assert.equal((await readAll(src, dir, 'empty.bin')).length, 0);
    assert.equal((await readAll(src, dir, 'empty.json')).length, 0);
  });

  test('a CRC mismatch is rejected (stored and deflated)', async () => {
    const bin = trickyBinary(5000);
    const json = enc.encode(JSON.stringify({ a: 'x'.repeat(2000), b: [1, 2, 3] }));
    const zip = await buildZip([
      { name: 'a.bin', data: bin, deflate: false },
      { name: 'b.json', data: json, deflate: true },
    ]);
    // Flip a byte inside a.bin's data (right after its local header).
    const bad = zip.slice();
    const dataAt = 30 + u16(bad, 26) + u16(bad, 28);
    bad[dataAt + 1234] ^= 0xff;
    const src = memorySource(bad);
    const dir = await readZipDirectory(src);
    await rejects(readAll(src, dir, 'a.bin'), 'damaged');
    // b.json still reads.
    assert.equal(dec.decode(await readAll(src, dir, 'b.json')), dec.decode(json));

    // A wrong CRC in the central directory of the deflated entry.
    const bad2 = zip.slice();
    const [, second] = cdEntries(bad2);
    put32(bad2, second + 16, (u32(bad2, second + 16) ^ 1) >>> 0);
    const src2 = memorySource(bad2);
    await rejects(readAll(src2, await readZipDirectory(src2), 'b.json'), 'damaged');
  });

  test('a truncated archive is rejected', async () => {
    const zip = await buildZip([
      { name: 'a.bin', data: trickyBinary(20_000), deflate: false },
      { name: 'b.json', data: enc.encode('{"x":1}'), deflate: true },
    ]);
    // Cut at the end: the end record is gone.
    for (const cut of [1, 10, 22, 100, zip.length - 30]) {
      await assert.rejects(readZipDirectory(memorySource(zip.subarray(0, zip.length - cut))), ZipError);
    }
    // Bytes missing in the middle: the directory now points past where it is.
    const holed = new Uint8Array(zip.length - 500);
    holed.set(zip.subarray(0, 5000));
    holed.set(zip.subarray(5500), 5000);
    await assert.rejects(
      (async () => {
        const src = memorySource(holed);
        const dir = await readZipDirectory(src);
        await readAll(src, dir, 'a.bin');
      })(),
      ZipError,
    );
    // A source that returns fewer bytes than the directory promises.
    const src = memorySource(zip);
    const dir = await readZipDirectory(src);
    const short: ByteSource = { size: src.size, read: async (o, l) => (await src.read(o, l)).subarray(0, Math.max(0, l - 1)) };
    await rejects(readAll(short, dir, 'a.bin'), 'damaged');
    // Not a zip at all.
    await rejects(readZipDirectory(memorySource(enc.encode('%PDF-1.7 not a zip'))), 'not-zip');
    await rejects(readZipDirectory(memorySource(new Uint8Array(10))), 'not-zip');
  });

  test('an entry that inflates past its declared size is rejected', async () => {
    const zip = await buildZip([{ name: 'big.json', data: enc.encode('a'.repeat(200_000)), deflate: true }]);
    const bad = zip.slice();
    const [e] = cdEntries(bad);
    put32(bad, e + 24, 1000);
    const src = memorySource(bad);
    await rejects(readAll(src, await readZipDirectory(src), 'big.json'), 'damaged');
  });

  test('a deflated entry extracts with any chunk size (shorter than, or not a multiple of, the inflate slice)', async () => {
    // Low-entropy noise: compresses, but to well over one 16 KiB inflate slice.
    const data = new Uint8Array(3_000_000);
    let x = 1;
    for (let i = 0; i < data.length; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      data[i] = (x >>> 24) & 0x0f;
    }
    const zip = await buildZip([{ name: 'a.json', data, deflate: true }]);
    const src = memorySource(zip);
    const dir = await readZipDirectory(src);
    const e = dir.byName.get('a.json');
    assert.ok(e);
    assert.ok(e.compressedSize > 40_000, `compressed ${e.compressedSize}`);
    for (const chunkSize of [1000, 16 * 1024, 20_000, 50_000, ZIP_CHUNK]) {
      const parts: Uint8Array[] = [];
      await extractEntry(src, dir, e, { write: async (b) => void parts.push(b) }, { chunkSize });
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      assert.equal(out.length, data.length, `chunk ${chunkSize}`);
      assert.equal(crc32(out), crc32(data), `chunk ${chunkSize}`);
    }
  });

  test('zip-bomb guard: the total uncompressed size must fit', async () => {
    const zip = await buildZip([
      { name: 'a.json', data: enc.encode('a'.repeat(100_000)), deflate: true },
      { name: 'b.json', data: enc.encode('b'.repeat(100_000)), deflate: true },
    ]);
    assert.ok(zip.length < 5000);
    await rejects(readZipDirectory(memorySource(zip), { maxTotalSize: 150_000 }), 'too-large');
    const dir = await readZipDirectory(memorySource(zip), { maxTotalSize: 200_000 });
    assert.equal(dir.totalSize, 200_000);
  });

  test('duplicate names, odd methods, encryption and too many entries are rejected', async () => {
    const zip = await buildZip([
      { name: 'a.bin', data: trickyBinary(100), deflate: false },
      { name: 'b.bin', data: trickyBinary(100), deflate: false },
    ]);
    const [, second] = cdEntries(zip);

    const dup = zip.slice();
    dup[second + 46] = 'a'.charCodeAt(0);
    await rejects(readZipDirectory(memorySource(dup)), 'damaged');

    const method = zip.slice();
    put16(method, second + 10, 12); // bzip2
    await rejects(readZipDirectory(memorySource(method)), 'unsupported');

    const crypt = zip.slice();
    put16(crypt, second + 8, u16(crypt, second + 8) | 1);
    await rejects(readZipDirectory(memorySource(crypt)), 'unsupported');

    const many = zip.slice();
    put16(many, many.length - 22 + 8, 0xffff);
    put16(many, many.length - 22 + 10, 0xffff);
    // 0xFFFF entries without a ZIP64 record: inconsistent.
    await rejects(readZipDirectory(memorySource(many)), 'damaged');
    await rejects(readZipDirectory(memorySource(zip), { maxEntries: 1 }), 'damaged');
    assert.equal(MAX_ZIP_ENTRIES, 100_000);
  });

  test('ZIP64 archives are read (records, locator and extra fields)', async () => {
    const data = trickyBinary(4321);
    const name = enc.encode('assets/z64.bin');
    const crc = crc32(data);
    const parts: Uint8Array[] = [];
    let size = 0;
    const push = (b: Uint8Array) => {
      parts.push(b);
      size += b.length;
    };
    const bytes = (n: number, fill: (b: Uint8Array) => void) => {
      const b = new Uint8Array(n);
      fill(b);
      return b;
    };
    const put64 = (b: Uint8Array, i: number, v: number) => {
      put32(b, i, v % 0x100000000);
      put32(b, i + 4, Math.floor(v / 0x100000000));
    };
    // local header + zip64 extra
    push(
      bytes(30, (b) => {
        put32(b, 0, 0x04034b50);
        put16(b, 4, 45);
        put16(b, 12, 0x21);
        put32(b, 14, crc);
        put32(b, 18, 0xffffffff);
        put32(b, 22, 0xffffffff);
        put16(b, 26, name.length);
        put16(b, 28, 20);
      }),
    );
    push(name);
    push(
      bytes(20, (b) => {
        put16(b, 0, 1);
        put16(b, 2, 16);
        put64(b, 4, data.length);
        put64(b, 12, data.length);
      }),
    );
    push(data);
    const cdOffset = size;
    push(
      bytes(46, (b) => {
        put32(b, 0, 0x02014b50);
        put16(b, 4, 45);
        put16(b, 6, 45);
        put16(b, 14, 0x21);
        put32(b, 16, crc);
        put32(b, 20, 0xffffffff);
        put32(b, 24, 0xffffffff);
        put16(b, 28, name.length);
        put16(b, 30, 28);
        put32(b, 42, 0xffffffff);
      }),
    );
    push(name);
    push(
      bytes(28, (b) => {
        put16(b, 0, 1);
        put16(b, 2, 24);
        put64(b, 4, data.length);
        put64(b, 12, data.length);
        put64(b, 20, 0);
      }),
    );
    const cdSize = size - cdOffset;
    const recOffset = size;
    push(
      bytes(56, (b) => {
        put32(b, 0, 0x06064b50);
        put64(b, 4, 44);
        put16(b, 12, 45);
        put16(b, 14, 45);
        put64(b, 24, 1);
        put64(b, 32, 1);
        put64(b, 40, cdSize);
        put64(b, 48, cdOffset);
      }),
    );
    push(
      bytes(20, (b) => {
        put32(b, 0, 0x07064b50);
        put64(b, 8, recOffset);
        put32(b, 16, 1);
      }),
    );
    push(
      bytes(22, (b) => {
        put32(b, 0, 0x06054b50);
        put16(b, 8, 0xffff);
        put16(b, 10, 0xffff);
        put32(b, 12, 0xffffffff);
        put32(b, 16, 0xffffffff);
      }),
    );
    const zip = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      zip.set(p, at);
      at += p.length;
    }

    const src = memorySource(zip);
    const dir = await readZipDirectory(src);
    assert.equal(dir.zip64, true);
    assert.equal(dir.entries.length, 1);
    assert.equal(dir.entries[0].size, data.length);
    assert.equal(dir.entries[0].localOffset, 0);
    assert.deepEqual(await readAll(src, dir, 'assets/z64.bin'), data);
  });

  test('bytes that only look like a ZIP64 locator do not break a plain archive', async () => {
    // The last central-directory record's comment ends in the 20 bytes right before the EOCD, so a
    // comment starting with 'PK' looks like a ZIP64 locator.
    const parts: Uint8Array[] = [];
    const zip = new Zip((err, data) => {
      assert.equal(err, null);
      parts.push(data);
    });
    const file = new ZipPassThrough('a.bin');
    file.comment = 'PKzzzzzzzzzzzzzzzz';
    zip.add(file);
    file.push(trickyBinary(500), true);
    zip.end();
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.length;
    }
    assert.equal(u32(bytes, bytes.length - 42), 0x07064b50);
    const src = memorySource(bytes);
    const dir = await readZipDirectory(src);
    assert.equal(dir.zip64, false);
    assert.deepEqual(await readAll(src, dir, 'a.bin'), trickyBinary(500));
  });

  test('the writer refuses duplicate names', async () => {
    const zip = createZipWriter(memorySink(), { now: NOW });
    await zip.addBytes('a', new Uint8Array(1), { deflate: false });
    await assert.rejects(zip.addBytes('a', new Uint8Array(1), { deflate: false }), ZipWriteError);
  });

  test('a 50 MB asset round-trips with at most 2 chunks resident', async () => {
    const SIZE = 50 * 1024 * 1024 + 12345;
    const gen = (offset: number, length: number) => {
      const b = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        const x = offset + i;
        b[i] = x % 1009 < 4 ? [0x50, 0x4b, 0x07, 0x08][x % 1009] : (x * 2654435761) >>> 24;
      }
      return b;
    };

    // Write: track source bytes handed out minus archive bytes accepted.
    let read = 0;
    let maxInFlight = 0;
    const source: ByteSource = {
      size: async () => SIZE,
      read: async (offset, length) => {
        const b = gen(offset, Math.min(length, SIZE - offset));
        read += b.length;
        return b;
      },
    };
    const parts: Uint8Array[] = [];
    let archived = 0;
    const sink: ByteSink = {
      async write(chunk) {
        parts.push(chunk);
        archived += chunk.length;
        maxInFlight = Math.max(maxInFlight, read - archived);
      },
    };
    const zip = createZipWriter(sink, { now: NOW });
    const w = await zip.addSource('assets/big.bin', source, { deflate: false });
    await zip.finish();
    assert.equal(w.bytes, SIZE);
    assert.ok(maxInFlight <= 2 * ZIP_CHUNK, `writer in flight ${maxInFlight}`);
    const archive = new Uint8Array(archived);
    let at = 0;
    for (const p of parts) {
      archive.set(p, at);
      at += p.length;
    }
    parts.length = 0;

    // Read: extract through a buffered file sink into memfs, tracking archive bytes read minus bytes
    // appended to the file (the local header read is 30 bytes).
    const mem = createMemFs({ dirs: ['/out'] });
    let flushed = 0;
    const fs = {
      ...mem,
      appendBytes: async (p: string, b: Uint8Array) => {
        flushed += b.length;
        await mem.appendBytes(p, b);
      },
    };
    const src = memorySource(archive);
    const dir = await readZipDirectory(src);
    let pulled = 0;
    let maxResident = 0;
    const counted: ByteSource = {
      size: src.size,
      read: async (o, l) => {
        const b = await src.read(o, l);
        pulled += b.length;
        maxResident = Math.max(maxResident, pulled - 30 - flushed);
        return b;
      },
    };
    const entry = dir.byName.get('assets/big.bin');
    assert.ok(entry);
    const out = fileSink(fs, '/out/big.bin');
    await extractEntry(counted, dir, entry, out);
    await out.close();
    assert.ok(maxResident <= 2 * ZIP_CHUNK, `reader resident ${maxResident}`);
    assert.equal(await mem.size('/out/big.bin'), SIZE);
    const back = await mem.readBytes('/out/big.bin', 0, SIZE);
    assert.equal(crc32(back), crc32(gen(0, SIZE)));
    assert.deepEqual(back.subarray(SIZE - 5000), gen(SIZE - 5000, 5000));
  });

  test('fileSource reads through the FsAdapter', async () => {
    const fs = createMemFs({ dirs: ['/z'] });
    const zip = await buildZip([{ name: 'x.bin', data: trickyBinary(3000), deflate: false }]);
    await fs.appendBytes('/z/a.zip', zip);
    const src = fileSource(fs, '/z/a.zip');
    const dir = await readZipDirectory(src);
    assert.deepEqual(await readAll(src, dir, 'x.bin'), trickyBinary(3000));
    await rejects(readZipDirectory(fileSource(fs, '/z/missing.zip')), 'not-zip');
  });
});
