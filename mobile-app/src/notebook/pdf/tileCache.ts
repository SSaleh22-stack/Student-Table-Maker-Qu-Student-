/**
 * Disk cache of rendered PDF images (P10): Paths.cache/pdf-tiles/<pdfCacheId>/<key>~<W>x<H>.<ext>.
 *
 * - LRU by file bytes, MAX_TILE_CACHE_BYTES (200 MB) on disk. The newest entry is never evicted, so
 *   a file just handed out is still there when the painter decodes it.
 * - In-flight dedupe: two requests for the same key share one native render.
 * - The pixel size is part of the file name, so the cache survives app launches: the first use scans
 *   the folder (in slices, yielding between documents) and rebuilds the LRU from modification times.
 *   Half-written '.part' files from a crash are deleted then.
 * - iOS may empty Caches under storage pressure: a hit whose file is gone is rendered again.
 *
 * The render callback writes the image to the outUri it is given (a '.part' file); the cache then
 * moves it to its final name. Nothing touches the disk at import time (web imports this file too).
 */
import { Directory, File, Paths } from 'expo-file-system';

export const MAX_TILE_CACHE_BYTES = 200 * 1024 * 1024;

export interface CachedImage {
  /** file:// URI of the image. */
  uri: string;
  width: number;
  height: number;
}

export type ImageExt = 'jpg' | 'png';

export interface TileCache {
  /**
   * The cached image for (docId, key), or the result of render(outUri) for a miss. Concurrent calls
   * for the same entry share one render. A failed render leaves nothing behind and rejects.
   */
  get(docId: string, key: string, ext: ImageExt, render: (outUri: string) => Promise<CachedImage>): Promise<CachedImage>;
  /** The cached image if it is on disk now, without rendering (counts as a use). */
  peek(docId: string, key: string): CachedImage | null;
  /** Deletes every cached image of one document. */
  dropDocument(docId: string): Promise<void>;
  /** Deletes the whole cache. */
  clear(): Promise<void>;
  /** Bytes currently counted (after the startup scan). */
  bytes(): number;
}

interface Entry {
  docId: string;
  key: string;
  uri: string;
  bytes: number;
  width: number;
  height: number;
}

const FINAL_NAME = /^(.+)~(\d+)x(\d+)\.(jpg|png)$/;
const ROOT_NAME = 'pdf-tiles';

const idOf = (docId: string, key: string): string => `${docId}/${key}`;

function deleteQuietly(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone, or the cache folder was emptied by the system.
  }
}

function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

const yieldToJs = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export function createTileCache(o: { maxBytes?: number; rootName?: string } = {}): TileCache {
  const maxBytes = o.maxBytes ?? MAX_TILE_CACHE_BYTES;
  const rootName = o.rootName ?? ROOT_NAME;
  /** Insertion order = recency: the first entry is the least recently used. */
  const lru = new Map<string, Entry>();
  const inflight = new Map<string, Promise<CachedImage>>();
  let total = 0;
  let ready: Promise<void> | null = null;
  let rootDir: Directory | null = null;

  const root = (): Directory => {
    if (!rootDir) rootDir = new Directory(Paths.cache, rootName);
    return rootDir;
  };

  const docDir = (docId: string): Directory => new Directory(root(), docId);

  function add(e: Entry): void {
    const id = idOf(e.docId, e.key);
    const old = lru.get(id);
    if (old) {
      lru.delete(id);
      total -= old.bytes;
      if (old.uri !== e.uri) deleteQuietly(old.uri);
    }
    lru.set(id, e);
    total += e.bytes;
  }

  function forget(id: string): void {
    const e = lru.get(id);
    if (!e) return;
    lru.delete(id);
    total -= e.bytes;
  }

  function touch(id: string, e: Entry): void {
    lru.delete(id);
    lru.set(id, e);
  }

  function evict(): void {
    // The newest entry (the one just rendered) is never evicted, whatever its size.
    while (total > maxBytes && lru.size > 1) {
      const first = lru.entries().next();
      if (first.done) break;
      const [id, e] = first.value;
      forget(id);
      deleteQuietly(e.uri);
    }
  }

  async function scan(): Promise<void> {
    const found: { e: Entry; at: number }[] = [];
    try {
      const r = root();
      if (!r.exists) {
        r.create({ intermediates: true, idempotent: true });
        return;
      }
      for (const child of r.list()) {
        if (!(child instanceof Directory)) {
          deleteQuietly(child.uri);
          continue;
        }
        const docId = child.name;
        for (const f of child.list()) {
          if (!(f instanceof File)) continue;
          const m = FINAL_NAME.exec(f.name);
          if (!m) {
            // A '.part' file from a render the app did not live through, or a stranger.
            deleteQuietly(f.uri);
            continue;
          }
          found.push({ e: { docId, key: m[1], uri: f.uri, bytes: f.size || 0, width: Number(m[2]), height: Number(m[3]) }, at: f.lastModified ?? 0 });
        }
        await yieldToJs();
      }
    } catch {
      // An unreadable cache is just an empty cache; new renders still work.
    }
    found.sort((a, b) => a.at - b.at);
    // Renders that finished during the scan are newer than anything on disk: they go last.
    const during = [...lru.values()];
    lru.clear();
    total = 0;
    for (const f of found) add(f.e);
    for (const e of during) add(e);
    evict();
  }

  const whenReady = (): Promise<void> => {
    if (!ready) ready = scan();
    return ready;
  };

  async function render(docId: string, key: string, ext: ImageExt, run: (outUri: string) => Promise<CachedImage>): Promise<CachedImage> {
    const dir = docDir(docId);
    try {
      dir.create({ intermediates: true, idempotent: true });
    } catch {
      // The native renderer creates the folder too; a real failure shows up as its rejection.
    }
    const part = new File(dir, `${key}.part.${ext}`);
    deleteQuietly(part.uri);
    let result: CachedImage;
    try {
      result = await run(part.uri);
    } catch (e) {
      deleteQuietly(part.uri);
      throw e;
    }
    const width = Math.round(result.width);
    const height = Math.round(result.height);
    const final = new File(dir, `${key}~${width}x${height}.${ext}`);
    try {
      const written = new File(result.uri);
      if (final.exists) final.delete();
      written.moveSync(final);
    } catch (e) {
      deleteQuietly(part.uri);
      throw e;
    }
    const entry: Entry = { docId, key, uri: final.uri, bytes: final.size || 0, width, height };
    add(entry);
    evict();
    return { uri: entry.uri, width, height };
  }

  return {
    async get(docId, key, ext, run) {
      await whenReady();
      const id = idOf(docId, key);
      const hit = lru.get(id);
      if (hit) {
        if (fileExists(hit.uri)) {
          touch(id, hit);
          return { uri: hit.uri, width: hit.width, height: hit.height };
        }
        forget(id);
      }
      const pending = inflight.get(id);
      if (pending) return pending;
      const p = render(docId, key, ext, run).finally(() => {
        inflight.delete(id);
      });
      inflight.set(id, p);
      return p;
    },

    peek(docId, key) {
      const id = idOf(docId, key);
      const hit = lru.get(id);
      if (!hit) return null;
      if (!fileExists(hit.uri)) {
        forget(id);
        return null;
      }
      touch(id, hit);
      return { uri: hit.uri, width: hit.width, height: hit.height };
    },

    async dropDocument(docId) {
      await whenReady();
      for (const [id, e] of [...lru]) {
        if (e.docId === docId) forget(id);
      }
      try {
        const d = docDir(docId);
        if (d.exists) d.delete();
      } catch {
        // Best effort: the LRU no longer points at these files either way.
      }
    },

    async clear() {
      await whenReady();
      lru.clear();
      total = 0;
      try {
        const r = root();
        if (r.exists) r.delete();
      } catch {
        // Best effort.
      }
    },

    bytes: () => total,
  };
}

let shared: TileCache | null = null;

/** The app-wide cache (created on first use). */
export function getTileCache(): TileCache {
  if (!shared) shared = createTileCache();
  return shared;
}
