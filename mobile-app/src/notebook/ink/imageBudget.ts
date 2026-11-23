/**
 * One LRU of DECODED images for the whole notebook (PDF previews, PDF tiles and image assets), under a
 * 48 MB budget, plus the disposal queue every painter object goes through.
 *
 * RUNTIME RULE (react-native-skia issue #4339): every SkImage, SkPicture and SkParagraph of the
 * painter is created on the JS runtime, handed to <Canvas> as a prop or a shared value, and disposed
 * on the JS runtime AFTER the canvas stopped drawing it. Skia objects that are created or dropped on
 * the UI runtime are only freed when that runtime's GC runs, which on 3-4 GB Android tablets lets
 * decoded bitmaps pile up until the app is killed. So nothing here runs in a worklet, and nothing is
 * disposed while a frame may still draw it: disposeLater() queues the object and the queue is flushed
 * two animation frames later (the frame that receives the new props, then one more).
 *
 * BUDGET
 * - Bytes are counted as width x height x 4 (RGBA) of each decoded image. The cap is
 *   IMAGE_BUDGET_BYTES (48 MB) and is enforced at admission: an image that does not fit after the
 *   evictions below is not kept (its hook shows nothing, the canvas keeps the preview or a
 *   placeholder) and is disposed at once (no canvas ever saw it). A mounted hook whose image was
 *   refused decodes it again once a release frees enough room (see "retrying refused images").
 * - PINNING: an entry is pinned while a hook holds it (hold/release). The canvas (P22) mounts the
 *   image hooks only for the visible pages +-1, so exactly those are pinned. Released entries stay
 *   cached (LRU) until the budget needs their room.
 * - Admission order: evict unpinned entries, least recently used first; then, for a preview or an
 *   asset (what a page needs to show at all), pinned TILES too (tiles only refine a preview, and the
 *   hook that held one drops it on the eviction notice); then give up.
 * - Tiles: at most MAX_LIVE_TILES (12) decoded tiles exist at a time, pinned or not; unpinned tiles
 *   are evicted first, and a 13th pinned tile is refused.
 * - The size caps (preview long side <= 1.5 x screen px and its pixel cap, tiles 512 px, assets
 *   2048 px) live in pdfTiles.ts and images.ts; this file only counts.
 * - Transient images (renderPageImage, pageThumb, export) are not counted: they live for one offscreen
 *   render and are disposed right after it.
 *
 * The decoded images are RASTER images (decoded on the JS runtime into CPU memory by drawing into a
 * raster surface, see images.ts decodeImageFile), so the bytes counted here are the bytes used, and
 * the UI thread never has to decode them during a frame.
 */
import type { SkImage } from '@shopify/react-native-skia';

/** The decoded-image budget: 48 MB. */
export const IMAGE_BUDGET_BYTES = 48 * 1024 * 1024;

/** At most this many decoded PDF tiles exist at a time. */
export const MAX_LIVE_TILES = 12;

export type BudgetKind = 'preview' | 'tile' | 'asset';

/** Anything with a dispose() (SkImage, SkPicture, SkParagraph, SkSurface, ...). */
export interface DisposableLike {
  dispose(): void;
}

// ===== disposal queue

let queue: DisposableLike[] = [];
let scheduled = false;

const nextFrame: (cb: () => void) => void =
  typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(() => cb()) : (cb) => setTimeout(cb, 16);

function disposeNow(o: DisposableLike): void {
  try {
    o.dispose();
  } catch {
    // Already disposed (dispose is idempotent in Skia 2.x, but never let one failure stop the queue).
  }
}

/** Disposes everything queued so far (normally called by the frame scheduler). */
export function flushDisposals(): void {
  scheduled = false;
  const items = queue;
  queue = [];
  for (const o of items) disposeNow(o);
}

/**
 * Disposes o on the JS runtime two frames from now: after the canvas has received props without it
 * and drawn one more frame. Use it for every painter object the canvas may have drawn. Objects the
 * canvas never saw (a refused decode, an offscreen surface) can be disposed directly.
 */
export function disposeLater(o: DisposableLike | null | undefined): void {
  if (!o) return;
  queue.push(o);
  if (scheduled) return;
  scheduled = true;
  nextFrame(() => nextFrame(flushDisposals));
}

/** Disposes o right away (it was never handed to a canvas). */
export function disposeUnseen(o: DisposableLike | null | undefined): void {
  if (o) disposeNow(o);
}

// ===== the LRU

interface Entry {
  key: string;
  kind: BudgetKind;
  image: SkImage;
  bytes: number;
}

/** Insertion order is recency: the first entry is the least recently used. */
const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<SkImage | null>>();
const holds = new Map<string, number>();
const evictListeners = new Map<string, Set<() => void>>();
const statListeners = new Set<() => void>();

let totalBytes = 0;
let liveTiles = 0;
let peakBytes = 0;
let refused = 0;
let statsCache: BudgetStats | null = null;

export interface BudgetStats {
  /** Decoded bytes kept now. */
  bytes: number;
  /** The highest bytes seen since launch (or since resetBudgetPeak). */
  peakBytes: number;
  budget: number;
  count: number;
  tiles: number;
  /** Entries held by a mounted hook (the visible pages +-1). */
  pinned: number;
  /** Decodes refused because they did not fit. */
  refused: number;
}

/** Decoded size of an image as the budget counts it. */
export function imageBytes(img: SkImage): number {
  return Math.max(1, img.width()) * Math.max(1, img.height()) * 4;
}

const isHeld = (key: string): boolean => (holds.get(key) ?? 0) > 0;

function notifyStats(): void {
  statsCache = null;
  for (const cb of [...statListeners]) {
    try {
      cb();
    } catch {
      // A listener's failure never breaks the budget.
    }
  }
}

function touch(e: Entry): void {
  entries.delete(e.key);
  entries.set(e.key, e);
}

function evict(e: Entry): void {
  if (entries.get(e.key) !== e) return;
  entries.delete(e.key);
  totalBytes -= e.bytes;
  if (e.kind === 'tile') liveTiles -= 1;
  const ls = evictListeners.get(e.key);
  if (ls) {
    for (const cb of [...ls]) {
      try {
        cb();
      } catch {
        // The hook will simply not drop its image; it is disposed two frames later anyway.
      }
    }
  }
  disposeLater(e.image);
}

/** Evicts until `fits()` or nothing evictable is left. Returns fits(). */
function evictWhile(fits: () => boolean, pick: (e: Entry) => boolean): boolean {
  if (fits()) return true;
  for (const e of [...entries.values()]) {
    if (!pick(e)) continue;
    evict(e);
    if (fits()) return true;
  }
  return fits();
}

/**
 * True when an image of kind and bytes can be admitted now (after evicting what admit may evict):
 * unpinned entries, and for a preview or an asset also pinned tiles. A tile also needs a free slot
 * among the MAX_LIVE_TILES after evicting unpinned tiles. No side effects.
 */
function roomFor(kind: BudgetKind, bytes: number): boolean {
  if (bytes > IMAGE_BUDGET_BYTES) return false;
  let freeable = 0;
  let freeTiles = 0;
  for (const e of entries.values()) {
    const held = isHeld(e.key);
    if (!held || (kind !== 'tile' && e.kind === 'tile')) freeable += e.bytes;
    if (e.kind === 'tile' && !held) freeTiles += 1;
  }
  if (kind === 'tile' && liveTiles - freeTiles >= MAX_LIVE_TILES) return false;
  return totalBytes - freeable + bytes <= IMAGE_BUDGET_BYTES;
}

function admit(key: string, kind: BudgetKind, img: SkImage | null): SkImage | null {
  if (!img) {
    // A failed decode is not a lack of room: never retried by the waiters below.
    refusedSizes.delete(key);
    return null;
  }
  const existing = entries.get(key);
  if (existing) {
    // Raced with another decode of the same key: keep the first one.
    disposeUnseen(img);
    touch(existing);
    return existing.image;
  }
  const bytes = imageBytes(img);
  // Nothing is evicted for an image that would not fit anyway. A preview or an asset may also push
  // pinned tiles out (the preview under them stays); a tile never pushes out a pinned image.
  let ok = roomFor(kind, bytes);
  if (ok && kind === 'tile') ok = evictWhile(() => liveTiles < MAX_LIVE_TILES, (e) => e.kind === 'tile' && !isHeld(e.key));
  if (ok) {
    const fitsBytes = () => totalBytes + bytes <= IMAGE_BUDGET_BYTES;
    ok = evictWhile(fitsBytes, (e) => !isHeld(e.key));
    if (!ok && kind !== 'tile') ok = evictWhile(fitsBytes, (e) => e.kind === 'tile');
  }
  if (!ok) {
    refused += 1;
    // Only a held key can have a waiter (subscribeImage); others are not remembered.
    if (isHeld(key)) refusedSizes.set(key, bytes);
    else refusedSizes.delete(key);
    if (__DEV__) console.warn(`[imageBudget] refused ${kind} ${key} (${(bytes / 1048576).toFixed(1)} MB): budget full`);
    disposeUnseen(img);
    notifyStats();
    return null;
  }
  refusedSizes.delete(key);
  const e: Entry = { key, kind, image: img, bytes };
  entries.set(key, e);
  totalBytes += bytes;
  if (kind === 'tile') liveTiles += 1;
  if (totalBytes > peakBytes) peakBytes = totalBytes;
  notifyStats();
  return img;
}

// ===== retrying refused images
//
// A mounted hook whose image was refused (the budget was full of other pinned images, for example
// while the canvas mounted the next page before releasing the previous one) would otherwise show
// the placeholder until it remounts. It waits here instead: whenever room is freed (a hold is
// released, entries are dropped), the first waiter whose image now fits decodes again. One retry
// runs at a time, so a freed slot is not raced by several decodes.

interface Waiter {
  key: string;
  kind: BudgetKind;
  decode: () => Promise<SkImage | null>;
  deliver: (img: SkImage | null) => void;
}

/** Decoded size of the last refused image per key (what a retry needs room for). */
const refusedSizes = new Map<string, number>();
const waiters = new Set<Waiter>();
let retryScheduled = false;
let retrying = false;

function scheduleRetry(): void {
  if (retryScheduled || retrying || waiters.size === 0) return;
  retryScheduled = true;
  setTimeout(runRetry, 0);
}

function runRetry(): void {
  retryScheduled = false;
  if (retrying) return;
  for (const w of [...waiters]) {
    if (!waiters.has(w)) continue;
    if (!isHeld(w.key)) {
      waiters.delete(w);
      refusedSizes.delete(w.key);
      continue;
    }
    // Another waiter (or any loadImage) of the same key got it in meanwhile: hand over the cached one.
    const cached = entries.get(w.key);
    if (cached) {
      waiters.delete(w);
      touch(cached);
      w.deliver(cached.image);
      continue;
    }
    // Being decoded right now: its completion schedules the next retry.
    if (pending.has(w.key)) continue;
    const need = refusedSizes.get(w.key);
    if (need === undefined) {
      // The last decode of this key failed (not a lack of room): nothing to wait for.
      waiters.delete(w);
      continue;
    }
    if (!roomFor(w.kind, need)) continue;
    waiters.delete(w);
    retrying = true;
    void loadImage(w.key, w.kind, w.decode).then((img) => {
      retrying = false;
      w.deliver(img);
      scheduleRetry();
    });
    return;
  }
}

/** The cached image for key without counting it as a use (safe to call while rendering), or null. */
export function cachedImage(key: string): SkImage | null {
  return entries.get(key)?.image ?? null;
}

/** The cached image for key (counts as a use), or null. */
export function peekImage(key: string): SkImage | null {
  const e = entries.get(key);
  if (!e) return null;
  touch(e);
  return e.image;
}

/**
 * The image for key: cached, or decoded by decode() and admitted under the budget. Concurrent calls
 * for one key share one decode. Resolves null when decode fails or the image does not fit. Never
 * rejects.
 */
export function loadImage(key: string, kind: BudgetKind, decode: () => Promise<SkImage | null>): Promise<SkImage | null> {
  const hit = peekImage(key);
  if (hit) return Promise.resolve(hit);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const p = (async () => {
    let img: SkImage | null = null;
    try {
      img = await decode();
    } catch (e) {
      if (__DEV__) console.warn(`[imageBudget] decode failed for ${key}`, e);
      img = null;
    }
    return admit(key, kind, img);
  })().finally(() => {
    pending.delete(key);
    // A waiter of this key (refused earlier) can take the image that is cached now.
    if (waiters.size > 0) scheduleRetry();
  });
  pending.set(key, p);
  return p;
}

/**
 * Pins key while held (a mounted hook of a visible page +-1). Returns the release function
 * (idempotent). The key does not need to be loaded yet.
 */
export function holdImage(key: string): () => void {
  holds.set(key, (holds.get(key) ?? 0) + 1);
  statsCache = null;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (holds.get(key) ?? 0) - 1;
    if (n > 0) holds.set(key, n);
    else holds.delete(key);
    notifyStats();
    scheduleRetry();
  };
}

/** Calls cb when key is evicted (its image is then disposed two frames later). */
export function onImageEvicted(key: string, cb: () => void): () => void {
  let set = evictListeners.get(key);
  if (!set) {
    set = new Set();
    evictListeners.set(key, set);
  }
  set.add(cb);
  return () => {
    const s = evictListeners.get(key);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) evictListeners.delete(key);
  };
}

/**
 * Hook helper (call it inside an effect): holds key, delivers the image to onImage as soon as it is
 * cached or decoded (null when the decode failed or did not fit), and null again when it is evicted.
 * The returned function releases everything.
 */
export function subscribeImage(key: string, kind: BudgetKind, decode: () => Promise<SkImage | null>, onImage: (img: SkImage | null) => void): () => void {
  let alive = true;
  const release = holdImage(key);
  const offEvict = onImageEvicted(key, () => {
    if (alive) onImage(null);
  });
  let waiter: Waiter | null = null;
  const deliver = (img: SkImage | null): void => {
    waiter = null;
    if (!alive) return;
    onImage(img);
    // Refused for lack of room (not a failed decode): wait for room and try again.
    if (!img && refusedSizes.has(key)) {
      waiter = { key, kind, decode, deliver };
      waiters.add(waiter);
    }
  };
  const hit = peekImage(key);
  if (hit) onImage(hit);
  else void loadImage(key, kind, decode).then(deliver);
  return () => {
    alive = false;
    if (waiter) waiters.delete(waiter);
    offEvict();
    release();
    if (!isHeld(key)) refusedSizes.delete(key);
  };
}

/** Drops every unpinned entry whose key matches (for example a closed notebook's images). */
export function dropImages(match: (key: string) => boolean): void {
  let changed = false;
  for (const e of [...entries.values()]) {
    if (match(e.key) && !isHeld(e.key)) {
      evict(e);
      changed = true;
    }
  }
  if (changed) {
    notifyStats();
    scheduleRetry();
  }
}

/** Drops every unpinned entry (memory warning). */
export function trimImageBudget(): void {
  dropImages(() => true);
}

export function budgetStats(): BudgetStats {
  if (statsCache) return statsCache;
  let pinned = 0;
  for (const k of entries.keys()) if (isHeld(k)) pinned += 1;
  statsCache = { bytes: totalBytes, peakBytes, budget: IMAGE_BUDGET_BYTES, count: entries.size, tiles: liveTiles, pinned, refused };
  return statsCache;
}

/** Resets the peak to the current total (spike screen). */
export function resetBudgetPeak(): void {
  peakBytes = totalBytes;
  refused = 0;
  notifyStats();
}

/** Calls cb whenever budgetStats() changes. */
export function subscribeBudget(cb: () => void): () => void {
  statListeners.add(cb);
  return () => {
    statListeners.delete(cb);
  };
}
