/**
 * Streaming zip writer over fflate's synchronous Zip, ZipPassThrough (binaries, stored) and
 * ZipDeflate (JSON, level 6). Entries are written one after another: a source is read in 1 MiB
 * chunks, each chunk is pushed, and everything fflate emits is awaited into the sink before the next
 * read, so at most one source chunk (plus the sink's own buffer) is in memory.
 *
 * Every entry's CRC-32 and size come back from add*() for the manifest.
 *
 * Limits: fflate writes no ZIP64 records, so an archive over 4 GiB or with more than 65535 entries
 * is refused with ZipWriteError('too-large') instead of being written corrupt. (The reader handles
 * ZIP64 archives from other tools.) Only fflate's synchronous classes are used (no workers).
 */
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

import type { FsAdapter } from '../fs/adapter.ts';
import { ZIP_CHUNK } from './zipRead.ts';
import type { ByteSink, ByteSource } from './zipRead.ts';

export type { ByteSink, ByteSource } from './zipRead.ts';

/** Largest archive (and entry) without ZIP64. */
export const ZIP32_LIMIT = 0xffffffff;
export const ZIP32_MAX_ENTRIES = 0xffff;

export type ZipWriteErrorCode = 'too-large' | 'source-changed' | 'failed';

export class ZipWriteError extends Error {
  code: ZipWriteErrorCode;
  constructor(code: ZipWriteErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ZipWriteError';
    this.code = code;
  }
}

export interface WrittenEntry {
  path: string;
  /** Uncompressed size. */
  bytes: number;
  crc32: number;
}

export interface AddOptions {
  /** true: DEFLATE level 6 (JSON); false: stored (PDFs, images, audio, PNG). */
  deflate: boolean;
  /** Running count of this entry's source bytes pushed. */
  onBytes?(n: number): void;
}

export interface ZipWriter {
  addBytes(path: string, data: Uint8Array, o: AddOptions): Promise<WrittenEntry>;
  /** Streams a source of known size (size() at the start; it must not change while read). */
  addSource(path: string, src: ByteSource, o: AddOptions): Promise<WrittenEntry>;
  /** Writes the central directory. */
  finish(): Promise<{ bytes: number; entries: WrittenEntry[] }>;
  /** Bytes emitted into the sink so far. */
  readonly bytes: number;
}

/** fflate stores DOS times: 1980 .. 2099. */
function dosSafeTime(ms: number): number {
  const y = new Date(ms).getFullYear();
  return Number.isFinite(ms) && y >= 1981 && y <= 2098 ? ms : Date.UTC(2026, 0, 1);
}

export function createZipWriter(sink: ByteSink, o: { now(): number; chunkSize?: number; level?: number }): ZipWriter {
  const chunkSize = Math.max(1, o.chunkSize ?? ZIP_CHUNK);
  const level = (o.level ?? 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  const queue: Uint8Array[] = [];
  const entries: WrittenEntry[] = [];
  const names = new Set<string>();
  let failure: Error | null = null;
  let ended = false;
  let written = 0;
  let busy = false;

  const zip = new Zip((err, data, final) => {
    if (err) {
      failure ??= err;
      return;
    }
    queue.push(data);
    if (final) ended = true;
  });

  const drain = async () => {
    if (failure) throw new ZipWriteError('failed', failure.message);
    while (queue.length) {
      const b = queue.shift() as Uint8Array;
      written += b.length;
      if (written > ZIP32_LIMIT) throw new ZipWriteError('too-large', 'archive over 4 GiB');
      await sink.write(b);
    }
  };

  async function add(path: string, o2: AddOptions, feed: (push: (chunk: Uint8Array, last: boolean) => Promise<void>) => Promise<void>): Promise<WrittenEntry> {
    if (busy) throw new ZipWriteError('failed', 'entries are written one at a time');
    if (ended) throw new ZipWriteError('failed', 'archive already finished');
    if (names.has(path)) throw new ZipWriteError('failed', `duplicate entry ${path}`);
    if (entries.length + 1 > ZIP32_MAX_ENTRIES) throw new ZipWriteError('too-large', 'too many entries');
    busy = true;
    try {
      names.add(path);
      const file = o2.deflate ? new ZipDeflate(path, { level }) : new ZipPassThrough(path);
      file.mtime = dosSafeTime(o.now());
      zip.add(file);
      await drain();
      let pushed = 0;
      let finalSent = false;
      await feed(async (chunk, last) => {
        if (finalSent) return;
        pushed += chunk.length;
        if (pushed > ZIP32_LIMIT) throw new ZipWriteError('too-large', `entry over 4 GiB (${path})`);
        try {
          file.push(chunk, last);
        } catch (e) {
          throw new ZipWriteError('failed', e instanceof Error ? e.message : String(e));
        }
        if (last) finalSent = true;
        await drain();
        o2.onBytes?.(pushed);
      });
      if (!finalSent) throw new ZipWriteError('failed', `entry not finished (${path})`);
      const e: WrittenEntry = { path, bytes: file.size, crc32: file.crc >>> 0 };
      entries.push(e);
      return e;
    } finally {
      busy = false;
    }
  }

  return {
    get bytes() {
      return written;
    },

    addBytes(path, data, o2) {
      return add(path, o2, async (push) => {
        await push(data, true);
      });
    },

    addSource(path, src, o2) {
      return add(path, o2, async (push) => {
        const total = await src.size();
        if (total === 0) {
          await push(new Uint8Array(0), true);
          return;
        }
        let off = 0;
        while (off < total) {
          const want = Math.min(chunkSize, total - off);
          const b = await src.read(off, want);
          if (b.length !== want) throw new ZipWriteError('source-changed', `${path} changed while it was read`);
          off += b.length;
          await push(b, off >= total);
        }
      });
    },

    async finish() {
      if (busy) throw new ZipWriteError('failed', 'an entry is still being written');
      if (!ended) {
        zip.end();
        await drain();
      }
      if (!ended) throw new ZipWriteError('failed', 'the archive did not end');
      return { bytes: written, entries: entries.slice() };
    },
  };
}

// ===== sinks

export interface FileSink extends ByteSink {
  /** Writes what is still buffered. */
  close(): Promise<void>;
  readonly bytes: number;
}

/**
 * Appends to a file through the FsAdapter, buffering up to bufferSize bytes (1 MiB) so a stream of
 * small chunks becomes few appends. The file is created by the first append; the caller removes any
 * old file first.
 */
export function fileSink(fs: FsAdapter, path: string, bufferSize = ZIP_CHUNK): FileSink {
  const size = Math.max(1, bufferSize);
  let buf: Uint8Array | null = null;
  let fill = 0;
  let total = 0;

  const flush = async () => {
    if (!buf || fill === 0) return;
    const n = fill;
    fill = 0;
    await fs.appendBytes(path, buf.subarray(0, n));
  };

  return {
    get bytes() {
      return total;
    },
    async write(chunk) {
      total += chunk.length;
      if (fill === 0 && chunk.length >= size) {
        await fs.appendBytes(path, chunk);
        return;
      }
      let at = 0;
      while (at < chunk.length) {
        buf ??= new Uint8Array(size);
        const n = Math.min(size - fill, chunk.length - at);
        buf.set(chunk.subarray(at, at + n), fill);
        fill += n;
        at += n;
        if (fill === size) await flush();
      }
    },
    async close() {
      await flush();
      if (total === 0) await fs.appendBytes(path, new Uint8Array(0));
      buf = null;
    },
  };
}

/** Collects everything in memory (tests, small archives). */
export function memorySink(): ByteSink & { bytes(): Uint8Array; readonly length: number } {
  const parts: Uint8Array[] = [];
  let length = 0;
  return {
    async write(chunk) {
      parts.push(chunk);
      length += chunk.length;
    },
    get length() {
      return length;
    },
    bytes() {
      const out = new Uint8Array(length);
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      return out;
    },
  };
}
