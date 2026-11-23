/**
 * CRC-32 (IEEE 802.3, the zip checksum), table based with slicing-by-8 so large assets hash fast on
 * Hermes too. Incremental: pass the previous result to continue a running checksum.
 *
 *   crc32(bytes)                  -> the checksum of bytes
 *   crc32(more, crc32(first))     -> the checksum of first + more
 *
 * Results are unsigned 32-bit integers (0 .. 0xFFFFFFFF).
 */

const POLY = 0xedb88320;

function makeTables(): Int32Array[] {
  const t0 = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? POLY ^ (c >>> 1) : c >>> 1;
    t0[n] = c;
  }
  const tables = [t0];
  for (let s = 1; s < 8; s++) {
    const prev = tables[s - 1];
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) t[n] = (prev[n] >>> 8) ^ t0[prev[n] & 0xff];
    tables.push(t);
  }
  return tables;
}

let TABLES: Int32Array[] | null = null;

export function crc32(data: Uint8Array, prev = 0): number {
  if (!TABLES) TABLES = makeTables();
  const [t0, t1, t2, t3, t4, t5, t6, t7] = TABLES;
  let c = ~prev;
  const n = data.length;
  let i = 0;
  const end8 = n - (n % 8);
  while (i < end8) {
    const a = c ^ (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24));
    c =
      t7[a & 0xff] ^
      t6[(a >>> 8) & 0xff] ^
      t5[(a >>> 16) & 0xff] ^
      t4[a >>> 24] ^
      t3[data[i + 4]] ^
      t2[data[i + 5]] ^
      t1[data[i + 6]] ^
      t0[data[i + 7]];
    i += 8;
  }
  while (i < n) c = t0[(c ^ data[i++]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** A running CRC-32 with a byte count. */
export interface Crc32Stream {
  push(data: Uint8Array): void;
  readonly value: number;
  readonly bytes: number;
}

export function crc32Stream(): Crc32Stream {
  let value = 0;
  let bytes = 0;
  return {
    push(data) {
      value = crc32(data, value);
      bytes += data.length;
    },
    get value() {
      return value;
    },
    get bytes() {
      return bytes;
    },
  };
}
