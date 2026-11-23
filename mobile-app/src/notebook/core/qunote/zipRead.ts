/**
 * Our own zip reader (the .qunote import path). It trusts ONLY the central directory:
 *
 * - The end-of-central-directory record is found in the last 64 KiB + 22 bytes (and the ZIP64
 *   locator and record when present, for archives over 4 GiB or 65535 entries).
 * - Each central-directory entry gives the name, method, sizes, CRC-32 and local header offset.
 * - An entry's data is located through its local header (only to skip the name and extra field)
 *   and EXACTLY compressedSize bytes are read. Nothing scans for data-descriptor signatures, so
 *   stored binaries that contain 'PK\x07\x08' extract intact. (fflate's streaming zip-reading
 *   classes scan for those signatures, so they are not used; only fflate's raw Inflate is.)
 * - Stored entries are copied in 1 MiB chunks; deflated entries stream through fflate's Inflate in
 *   small slices, so a hostile entry cannot inflate far past its declared size in one step.
 * - Every entry is checked: CRC-32 and the actual byte count against the declared sizes.
 *
 * Rejected ('damaged' unless noted): a missing or inconsistent EOCD ('not-zip' when there is none at
 * all), multi-disk archives, methods other than 0 (stored) and 8 (deflate) and encrypted entries
 * ('unsupported'), duplicate names, more than 100k entries, offsets or sizes outside the archive,
 * and a total uncompressed size above o.maxTotalSize ('too-large', the zip-bomb guard: callers pass
 * the checked free space).
 */
import { Inflate, strFromU8 } from 'fflate';

import type { FsAdapter } from '../fs/adapter.ts';
import { crc32 } from './crc32.ts';

/** Random-access bytes (a file on disk, or memory in tests). */
export interface ByteSource {
  size(): Promise<number>;
  /** Up to `length` bytes from `offset` (fewer only at the end). */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** Where output bytes go. A sink may keep the chunk it is given: producers never reuse it. */
export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>;
}

export const ZIP_CHUNK = 1024 * 1024;
export const MAX_ZIP_ENTRIES = 100_000;
/** The central directory is read in one piece; real .qunote directories are tiny. */
const MAX_CD_BYTES = 64 * 1024 * 1024;
/** Compressed bytes per Inflate.push: bounds what one push can produce (deflate tops out near 1032:1). */
const INFLATE_SLICE = 16 * 1024;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_Z64_LOCATOR = 0x07064b50;
const SIG_Z64_EOCD = 0x06064b50;

export type ZipErrorCode = 'not-zip' | 'damaged' | 'unsupported' | 'too-large';

export class ZipError extends Error {
  code: ZipErrorCode;
  constructor(code: ZipErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ZipError';
    this.code = code;
  }
}

export const isZipError = (e: unknown): e is ZipError => e instanceof ZipError;

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflate. */
  method: 0 | 8;
  flags: number;
  crc32: number;
  compressedSize: number;
  /** Uncompressed size. */
  size: number;
  localOffset: number;
}

export interface ZipDirectory {
  entries: ZipEntry[];
  byName: Map<string, ZipEntry>;
  /** Sum of the uncompressed sizes. */
  totalSize: number;
  archiveSize: number;
  /** Where the central directory starts: entry data must end before it. */
  cdOffset: number;
  zip64: boolean;
}

// ===== little-endian helpers

const u16 = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number): number => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
function u64(b: Uint8Array, i: number): number {
  const lo = u32(b, i);
  const hi = u32(b, i + 4);
  // Above 2^53 cannot be a real offset or size.
  if (hi > 0x1fffff) throw new ZipError('damaged', 'zip64 value out of range');
  return hi * 0x100000000 + lo;
}

async function readExact(src: ByteSource, offset: number, length: number): Promise<Uint8Array> {
  if (length === 0) return new Uint8Array(0);
  let b: Uint8Array;
  try {
    b = await src.read(offset, length);
  } catch (e) {
    throw new ZipError('damaged', `read failed at ${offset}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (b.length !== length) throw new ZipError('damaged', `truncated at ${offset}`);
  return b;
}

// ===== central directory

interface Eocd {
  pos: number;
  entries: number;
  cdSize: number;
  cdOffset: number;
  zip64: boolean;
  /** Where the records after the central directory start (ZIP64 record or EOCD). */
  cdLimit: number;
}

function findEocd(tail: Uint8Array): number {
  // Prefer a record whose comment ends exactly at the end of the file; else the last signature.
  let loose = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) !== SIG_EOCD) continue;
    const commentLen = u16(tail, i + 20);
    if (i + 22 + commentLen === tail.length) return i;
    if (loose < 0 && i + 22 + commentLen <= tail.length) loose = i;
  }
  return loose;
}

async function readEocd(src: ByteSource, size: number): Promise<Eocd> {
  if (size < 22) throw new ZipError('not-zip', 'too small');
  const tailLen = Math.min(size, 0xffff + 22);
  const tailStart = size - tailLen;
  const tail = await readExact(src, tailStart, tailLen);
  const at = findEocd(tail);
  if (at < 0) throw new ZipError('not-zip', 'no end of central directory');
  const pos = tailStart + at;

  const disk = u16(tail, at + 4);
  const cdDisk = u16(tail, at + 6);
  const onDisk = u16(tail, at + 8);
  let entries = u16(tail, at + 10);
  let cdSize = u32(tail, at + 12);
  let cdOffset = u32(tail, at + 16);
  let cdLimit = pos;
  let zip64 = false;

  // ZIP64 end-of-central-directory locator: the 20 bytes right before the EOCD.
  let locator: Uint8Array | null = null;
  if (pos >= 20) {
    locator = at >= 20 ? tail.subarray(at - 20, at) : await readExact(src, pos - 20, 20);
    if (u32(locator, 0) !== SIG_Z64_LOCATOR) locator = null;
  }
  const needs64 = entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
  let z64: { entries: number; cdSize: number; cdOffset: number; recOffset: number } | null = null;
  if (locator) {
    try {
      const recOffset = u64(locator, 8);
      if (u32(locator, 4) !== 0 || u32(locator, 16) > 1) throw new ZipError('unsupported', 'multi-disk zip64');
      if (recOffset + 56 > pos - 20) throw new ZipError('damaged', 'zip64 record out of range');
      const rec = await readExact(src, recOffset, 56);
      if (u32(rec, 0) !== SIG_Z64_EOCD) throw new ZipError('damaged', 'bad zip64 record');
      if (u32(rec, 16) !== 0 || u32(rec, 20) !== 0) throw new ZipError('unsupported', 'multi-disk zip64');
      const onDisk64 = u64(rec, 24);
      const entries64 = u64(rec, 32);
      if (onDisk64 !== entries64) throw new ZipError('unsupported', 'multi-disk zip64');
      z64 = { entries: entries64, cdSize: u64(rec, 40), cdOffset: u64(rec, 48), recOffset };
    } catch (e) {
      // Bytes that only LOOK like a locator (the end of the last central-directory record) must not
      // break a plain archive: without 0xFFFF / 0xFFFFFFFF markers the 32-bit record is used.
      if (needs64) throw e;
      z64 = null;
    }
  }
  if (z64) {
    entries = z64.entries;
    cdSize = z64.cdSize;
    cdOffset = z64.cdOffset;
    cdLimit = z64.recOffset;
    zip64 = true;
  } else {
    if (needs64) throw new ZipError('damaged', 'zip64 fields without a zip64 record');
    if (disk !== 0 || cdDisk !== 0 || onDisk !== entries) throw new ZipError('unsupported', 'multi-disk zip');
  }

  if (cdOffset + cdSize > cdLimit) throw new ZipError('damaged', 'central directory out of range (truncated?)');
  return { pos, entries, cdSize, cdOffset, zip64, cdLimit };
}

function parseZip64Extra(
  extra: Uint8Array,
  want: { size: boolean; csize: boolean; offset: boolean },
): { size?: number; csize?: number; offset?: number } {
  const out: { size?: number; csize?: number; offset?: number } = {};
  let i = 0;
  while (i + 4 <= extra.length) {
    const id = u16(extra, i);
    const len = u16(extra, i + 2);
    const start = i + 4;
    if (start + len > extra.length) break;
    if (id === 0x0001) {
      let p = start;
      const take = (): number => {
        if (p + 8 > start + len) throw new ZipError('damaged', 'short zip64 extra field');
        const v = u64(extra, p);
        p += 8;
        return v;
      };
      if (want.size) out.size = take();
      if (want.csize) out.csize = take();
      if (want.offset) out.offset = take();
      return out;
    }
    i = start + len;
  }
  if (want.size || want.csize || want.offset) throw new ZipError('damaged', 'missing zip64 extra field');
  return out;
}

export interface ReadDirectoryOptions {
  /** Reject when the total uncompressed size is above this (the checked free space). */
  maxTotalSize?: number;
  maxEntries?: number;
}

export async function readZipDirectory(src: ByteSource, o: ReadDirectoryOptions = {}): Promise<ZipDirectory> {
  let size: number;
  try {
    size = await src.size();
  } catch (e) {
    throw new ZipError('not-zip', e instanceof Error ? e.message : String(e));
  }
  const eocd = await readEocd(src, size);
  const maxEntries = o.maxEntries ?? MAX_ZIP_ENTRIES;
  if (eocd.entries > maxEntries) throw new ZipError('damaged', `too many entries (${eocd.entries})`);
  if (eocd.cdSize > MAX_CD_BYTES) throw new ZipError('damaged', 'central directory too large');
  if (eocd.cdSize < eocd.entries * 46) throw new ZipError('damaged', 'central directory too small');

  const cd = await readExact(src, eocd.cdOffset, eocd.cdSize);
  const entries: ZipEntry[] = [];
  const byName = new Map<string, ZipEntry>();
  let total = 0;
  let p = 0;
  for (let n = 0; n < eocd.entries; n++) {
    if (p + 46 > cd.length || u32(cd, p) !== SIG_CENTRAL) throw new ZipError('damaged', `bad central directory entry ${n}`);
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    const crc = u32(cd, p + 16);
    let csize = u32(cd, p + 20);
    let usize = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    const diskStart = u16(cd, p + 34);
    let offset = u32(cd, p + 42);
    const nameStart = p + 46;
    const extraStart = nameStart + nameLen;
    const next = extraStart + extraLen + commentLen;
    if (next > cd.length) throw new ZipError('damaged', `central directory entry ${n} overruns`);

    let name: string;
    try {
      name = strFromU8(cd.subarray(nameStart, extraStart), (flags & 0x800) === 0);
    } catch {
      throw new ZipError('damaged', `bad entry name ${n}`);
    }
    if (flags & 0x1 || flags & 0x40) throw new ZipError('unsupported', `encrypted entry ${name}`);
    if (method !== 0 && method !== 8) throw new ZipError('unsupported', `compression method ${method} (${name})`);
    if (diskStart !== 0 && diskStart !== 0xffff) throw new ZipError('unsupported', 'multi-disk zip');

    const want = { size: usize === 0xffffffff, csize: csize === 0xffffffff, offset: offset === 0xffffffff };
    if (want.size || want.csize || want.offset) {
      const z = parseZip64Extra(cd.subarray(extraStart, extraStart + extraLen), want);
      if (z.size !== undefined) usize = z.size;
      if (z.csize !== undefined) csize = z.csize;
      if (z.offset !== undefined) offset = z.offset;
    }

    if (method === 0 && csize !== usize) throw new ZipError('damaged', `stored entry sizes differ (${name})`);
    if (offset + 30 + csize > eocd.cdOffset) throw new ZipError('damaged', `entry data out of range (${name})`);
    if (byName.has(name)) throw new ZipError('damaged', `duplicate entry ${name}`);

    const e: ZipEntry = { name, method, flags, crc32: crc, compressedSize: csize, size: usize, localOffset: offset };
    entries.push(e);
    byName.set(name, e);
    total += usize;
    if (o.maxTotalSize !== undefined && total > o.maxTotalSize) throw new ZipError('too-large', 'uncompressed size above the free space');
    p = next;
  }

  return { entries, byName, totalSize: total, archiveSize: size, cdOffset: eocd.cdOffset, zip64: eocd.zip64 };
}

// ===== entry data

/** The absolute offset of an entry's data (after its local header). */
async function dataStart(src: ByteSource, dir: ZipDirectory, e: ZipEntry): Promise<number> {
  const h = await readExact(src, e.localOffset, 30);
  if (u32(h, 0) !== SIG_LOCAL) throw new ZipError('damaged', `bad local header (${e.name})`);
  if (u16(h, 6) & 0x1) throw new ZipError('unsupported', `encrypted entry ${e.name}`);
  const start = e.localOffset + 30 + u16(h, 26) + u16(h, 28);
  if (start + e.compressedSize > dir.cdOffset) throw new ZipError('damaged', `entry data out of range (${e.name})`);
  return start;
}

export interface ExtractOptions {
  chunkSize?: number;
  /** Running count of uncompressed bytes written. */
  onBytes?(n: number): void;
}

/**
 * Streams one entry's uncompressed bytes into sink, then checks the byte count and the CRC-32 against
 * the central directory. Rejects ZipError('damaged') on any mismatch (the sink has then received
 * bad data: callers write into a staging folder they delete).
 */
export async function extractEntry(src: ByteSource, dir: ZipDirectory, e: ZipEntry, sink: ByteSink, o: ExtractOptions = {}): Promise<void> {
  const chunk = Math.max(1, o.chunkSize ?? ZIP_CHUNK);
  const start = await dataStart(src, dir, e);
  let crc = 0;
  let produced = 0;

  const emit = async (b: Uint8Array) => {
    if (b.length === 0) return;
    produced += b.length;
    if (produced > e.size) throw new ZipError('damaged', `entry longer than declared (${e.name})`);
    crc = crc32(b, crc);
    await sink.write(b);
    o.onBytes?.(produced);
  };

  if (e.method === 0) {
    for (let off = 0; off < e.compressedSize; off += chunk) {
      const b = await readExact(src, start + off, Math.min(chunk, e.compressedSize - off));
      await emit(b);
    }
  } else {
    if (e.compressedSize === 0) throw new ZipError('damaged', `empty deflate stream (${e.name})`);
    const out: Uint8Array[] = [];
    // The last push is final: fflate then throws on a stream that ends early or never ends.
    const inflater = new Inflate((data: Uint8Array) => {
      if (data.length) out.push(data);
    });
    for (let off = 0; off < e.compressedSize; off += chunk) {
      const len = Math.min(chunk, e.compressedSize - off);
      const b = await readExact(src, start + off, len);
      for (let s = 0; s < b.length; s += INFLATE_SLICE) {
        // The slice's real end (a chunk may be shorter than INFLATE_SLICE or not a multiple of it).
        const sliceEnd = Math.min(b.length, s + INFLATE_SLICE);
        const last = off + sliceEnd >= e.compressedSize;
        try {
          inflater.push(b.subarray(s, sliceEnd), last);
        } catch (err) {
          throw new ZipError('damaged', `bad deflate data (${e.name}): ${err instanceof Error ? err.message : String(err)}`);
        }
        while (out.length) await emit(out.shift() as Uint8Array);
      }
    }
  }

  if (produced !== e.size) throw new ZipError('damaged', `entry shorter than declared (${e.name})`);
  if (crc >>> 0 !== e.crc32 >>> 0) throw new ZipError('damaged', `CRC mismatch (${e.name})`);
}

/** An entry's whole content in memory (JSON entries). Rejects 'too-large' above maxBytes. */
export async function readEntryBytes(src: ByteSource, dir: ZipDirectory, e: ZipEntry, maxBytes: number): Promise<Uint8Array> {
  if (e.size > maxBytes) throw new ZipError('too-large', `entry too large (${e.name})`);
  const buf = new Uint8Array(e.size);
  let at = 0;
  await extractEntry(src, dir, e, {
    async write(b) {
      buf.set(b, at);
      at += b.length;
    },
  });
  return buf;
}

// ===== sources

export function memorySource(bytes: Uint8Array): ByteSource {
  return {
    async size() {
      return bytes.length;
    },
    async read(offset, length) {
      const s = Math.max(0, Math.min(bytes.length, offset));
      return bytes.slice(s, Math.min(bytes.length, s + Math.max(0, length)));
    },
  };
}

/** A file through the FsAdapter (random access via readBytes). */
export function fileSource(fs: FsAdapter, path: string): ByteSource {
  let known: number | null = null;
  return {
    async size() {
      if (known === null) known = await fs.size(path);
      return known;
    },
    read: (offset, length) => fs.readBytes(path, offset, length),
  };
}
