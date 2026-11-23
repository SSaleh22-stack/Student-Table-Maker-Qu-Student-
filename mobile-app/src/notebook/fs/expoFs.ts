/**
 * The app's FsAdapter over the expo-file-system 58 object API (File, Directory, Paths, FileHandle).
 * No legacy API. Paths are file:// URIs (content:// is accepted as a copy SOURCE on Android).
 *
 * - readBytes / appendBytes go through a FileHandle (random access, no base64).
 * - copy from a content:// URI streams 1 MiB chunks through FileHandles and reports onBytes; any
 *   other copy uses File.copy / Directory.copy.
 * - move and copy replace the destination: it is deleted first, because Directory.move/copy into an
 *   EXISTING directory would nest the source inside it.
 * - size is recursive for directories.
 */
import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';

import type { FsAdapter, FsEntry } from '@/notebook/core/fs/adapter';

const CHUNK = 1024 * 1024;

const isContentUri = (p: string): boolean => p.startsWith('content://');

/** Same location, ignoring trailing slashes (a directory URI may or may not end with '/'). */
const samePath = (a: string, b: string): boolean => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

function pathInfo(p: string): { exists: boolean; isDirectory: boolean } {
  if (isContentUri(p)) {
    try {
      return { exists: new File(p).exists, isDirectory: false };
    } catch {
      return { exists: false, isDirectory: false };
    }
  }
  try {
    const i = Paths.info(p);
    return { exists: i.exists, isDirectory: i.isDirectory === true };
  } catch {
    return { exists: false, isDirectory: false };
  }
}

function removeSync(p: string): void {
  const i = pathInfo(p);
  if (!i.exists) return;
  if (i.isDirectory) new Directory(p).delete();
  else new File(p).delete();
}

async function streamCopy(from: string, to: string, onBytes?: (n: number) => void): Promise<void> {
  const dest = new File(to);
  // Open the source first: when it cannot be opened, the destination is left as it was.
  const reader = new File(from).open(FileMode.ReadOnly);
  let writer: FileHandle | null = null;
  let total = 0;
  try {
    removeSync(to);
    dest.create();
    writer = dest.open(FileMode.WriteOnly);
    for (;;) {
      const chunk = await reader.readBytes(CHUNK);
      if (chunk.length === 0) break;
      await writer.writeBytes(chunk);
      total += chunk.length;
      onBytes?.(total);
    }
  } catch (e) {
    try {
      writer?.close();
      writer = null;
      removeSync(to);
    } catch {
      // The partial copy is cleaned up best effort.
    }
    throw e;
  } finally {
    try {
      reader.close();
    } catch {
      // Already closed.
    }
    writer?.close();
  }
}

async function sizeOf(p: string): Promise<number> {
  const i = pathInfo(p);
  if (!i.exists) return 0;
  if (!i.isDirectory) return new File(p).size ?? 0;
  let total = 0;
  for (const child of new Directory(p).list()) {
    total += child instanceof Directory ? await sizeOf(child.uri) : (child.size ?? 0);
  }
  return total;
}

export const expoFs: FsAdapter = {
  async readText(p) {
    const f = new File(p);
    if (!f.exists) return null;
    return f.text();
  },

  async writeText(p, t) {
    await new File(p).write(t);
  },

  async readBytes(p, offset, length) {
    const handle = new File(p).open(FileMode.ReadOnly);
    try {
      if (offset > 0) handle.offset = offset;
      return await handle.readBytes(Math.max(0, length));
    } finally {
      handle.close();
    }
  },

  async appendBytes(p, b) {
    const f = new File(p);
    if (!f.exists) f.create();
    const handle = f.open(FileMode.Append);
    try {
      await handle.writeBytes(b);
    } finally {
      handle.close();
    }
  },

  async exists(p) {
    return pathInfo(p).exists;
  },

  async move(from, to) {
    const src = pathInfo(from);
    if (!src.exists) throw new Error(`move: missing source ${from}`);
    // Same path: nothing to do (deleting the "destination" would delete the source).
    if (samePath(from, to)) return;
    removeSync(to);
    if (src.isDirectory) await new Directory(from).move(new Directory(to));
    else await new File(from).move(new File(to));
  },

  async copy(from, to, onBytes) {
    if (samePath(from, to)) {
      // Copying a file onto itself must not delete it first.
      if (!pathInfo(from).exists) throw new Error(`copy: missing source ${from}`);
      onBytes?.(await sizeOf(from));
      return;
    }
    if (isContentUri(from)) {
      await streamCopy(from, to, onBytes);
      return;
    }
    const src = pathInfo(from);
    if (!src.exists) throw new Error(`copy: missing source ${from}`);
    removeSync(to);
    if (src.isDirectory) {
      await new Directory(from).copy(new Directory(to));
    } else {
      await new File(from).copy(new File(to));
    }
    onBytes?.(await sizeOf(to));
  },

  async remove(p) {
    removeSync(p);
  },

  async mkdirp(p) {
    new Directory(p).create({ intermediates: true, idempotent: true });
  },

  async list(dir) {
    const d = new Directory(dir);
    if (!d.exists) return [];
    return d.list().map((e): FsEntry => (e instanceof Directory ? { name: e.name, isDir: true, size: 0 } : { name: e.name, isDir: false, size: e.size ?? 0 }));
  },

  size: sizeOf,

  join(...parts) {
    return Paths.join(...parts);
  },
};

let root: string | null = null;

/** Paths.document/notebooks as a URI without a trailing slash; the folder is created on first use. */
export function notebooksRoot(): string {
  if (root) return root;
  const dir = new Directory(Paths.document, 'notebooks');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  root = dir.uri.replace(/\/+$/, '');
  return root;
}

/** Free space on the device, in bytes. */
export function freeBytes(): number {
  return Paths.availableDiskSpace;
}
