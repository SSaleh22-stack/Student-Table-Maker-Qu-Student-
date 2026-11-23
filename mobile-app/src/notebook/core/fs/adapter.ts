/**
 * The file-system port used by all notebook core code. The app adapter is src/notebook/fs/expoFs.ts
 * (expo-file-system 58 object API); tests use tests/notebook/helpers/memfs.ts.
 *
 * Paths are plain strings: file:// URIs on device, posix paths in tests. Every method rejects on an
 * I/O error, except readText (null when the file is missing), exists, and remove (missing is fine).
 */

export interface FsEntry {
  name: string;
  isDir: boolean;
  size: number;
}

export interface FsAdapter {
  /** The UTF-8 text of a file, or null when it does not exist. */
  readText(p: string): Promise<string | null>;
  /** Creates or replaces a file. The parent directory must exist. */
  writeText(p: string, t: string): Promise<void>;
  /** Up to `length` bytes from `offset` (fewer at the end of the file). */
  readBytes(p: string, offset: number, length: number): Promise<Uint8Array>;
  /** Appends bytes, creating the file if needed. The parent directory must exist. */
  appendBytes(p: string, b: Uint8Array): Promise<void>;
  exists(p: string): Promise<boolean>;
  /** Moves a file or directory to exactly `to`, replacing whatever is there. */
  move(from: string, to: string): Promise<void>;
  /** Copies a file or directory to exactly `to`, replacing whatever is there. onBytes gets the running byte count. */
  copy(from: string, to: string, onBytes?: (n: number) => void): Promise<void>;
  /** Deletes a file or a whole directory. Missing is not an error. */
  remove(p: string): Promise<void>;
  /** Creates a directory and its parents. Existing is not an error. */
  mkdirp(p: string): Promise<void>;
  /** Direct children of a directory ([] when it does not exist). */
  list(dir: string): Promise<FsEntry[]>;
  /** Size in bytes of a file, or of everything under a directory (recursive). 0 when missing. */
  size(p: string): Promise<number>;
  join(...parts: string[]): string;
}

/**
 * Joins path parts with single slashes. The first part keeps its scheme ('file:///…') and leading
 * slash; empty parts are skipped. No encoding is done: callers join file-name-safe ids only.
 */
export function joinPath(...parts: string[]): string {
  const clean = parts.filter((p) => typeof p === 'string' && p.length > 0);
  if (clean.length === 0) return '';
  const first = clean[0];
  const trimmed = first.replace(/\/+$/, '');
  // A bare root ('/', 'file:///') keeps its slashes.
  let out = trimmed === '' || /^[a-z][a-z0-9+.-]*:$/i.test(trimmed) ? first : trimmed;
  for (let i = 1; i < clean.length; i++) {
    const seg = clean[i].replace(/^\/+/, '').replace(/\/+$/, '');
    if (!seg) continue;
    out = out.endsWith('/') ? out + seg : `${out}/${seg}`;
  }
  return out;
}

/** The last path segment ('' for a bare root). */
export function baseName(p: string): string {
  const t = p.replace(/\/+$/, '');
  const i = t.lastIndexOf('/');
  return i >= 0 ? t.slice(i + 1) : t;
}

/** Everything before the last path segment. */
export function dirName(p: string): string {
  const t = p.replace(/\/+$/, '');
  const i = t.lastIndexOf('/');
  if (i < 0) return '';
  if (i === 0) return '/';
  const d = t.slice(0, i);
  // Keep 'file://' + '/' intact for a file directly under the URI root.
  return /^[a-z][a-z0-9+.-]*:\/*$/i.test(d) ? `${d}/` : d;
}
