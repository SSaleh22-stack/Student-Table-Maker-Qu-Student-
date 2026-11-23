/**
 * The PDF engine (P10): `pdfEngine: PdfEngine` (contract core/contracts/pdf.ts) over the native
 * module PdfRender (modules/pdf-render; iOS PDFKit P10, Android PDFium P10A).
 *
 * - Every rejection is a PdfError (toPdfError maps the native ERR_PDF_* codes; ERR_PDF_CRASHED
 *   becomes 'renderer-crashed', and the caller marks that page damaged).
 * - With no native module (web, Expo Go, an older build) `available` is false and every method
 *   rejects PdfError('no-native'). Nothing throws synchronously and nothing touches the disk at import.
 * - Rendered images are JPEG files in the tile cache, Paths.cache/pdf-tiles/<pdfCacheId>/ (tileCache.ts:
 *   200 MB LRU on disk, in-flight dedupe, survives launches). Pick regions with core/pdf/tiles.ts
 *   (tilesFor, previewWidth) so the same tiles come back from the cache.
 * - renderRegion and renderPage retry ONCE after 'renderer-crashed' (Android: the ':pdf' process can
 *   be killed under memory pressure; the client reopens the document). probe never retries: a crash
 *   there is the answer. On iOS a crash takes the app down instead; the render journal reports the
 *   page at the next launch (consumeCrashJournal, crashJournal.ts).
 *
 * DEVICE CHECKLIST (development build; the Swift and Kotlin are first compiled by that build):
 * 1. Concurrency: on the spike screen (P16), fire 20 renderRegion calls at once for one page at 400 %
 *    zoom, plus a renderPage of another page. All 21 resolve, the images are right, no crash or
 *    hang, and Xcode's Thread Sanitizer / Main Thread Checker report nothing (iOS: every PDFKit call
 *    runs on the serial queue 'net.qustudent.pdf'; the UI keeps scrolling meanwhile).
 * 2. Password unlock: inspect() of a password PDF gives needsPassword true; open() rejects
 *    'password-required'; saveDecrypted(src, wrong, dest) rejects 'wrong-password'; the right
 *    password writes dest, and open(dest) then works with no password. Android 8, 12, 14 and 15.
 * 3. Rotated pages: a PDF whose pages have /Rotate 90, 180 and 270 (and a non-zero crop box origin)
 *    reports the displayed sizes from pageSizes() (w and h swapped for 90/270) and renders upright,
 *    with tiles that line up at their edges.
 * 4. Decrypted-output check (iOS): after saveDecrypted, the dest file opens in Files/Preview without a
 *    password. If PDFKit kept the encryption, the native fallback redrew the pages into a new
 *    CGPDFContext document: check that it still opens, and note that its text may no longer be
 *    selectable (Xcode log 'PdfRender: redraw fallback').
 * 5. Journal recovery after a forced crash: in a debug build, set a breakpoint inside renderRegion
 *    after the journal write and kill the app from Xcode (or use a PDF known to crash PDFKit). Reopen:
 *    consumeCrashJournal() returns that {path, page} once and null on the next call, and the importer
 *    (P17) or NotebookServices (P30) marks that page damaged. Android: a malformed PDF kills ':pdf';
 *    the call rejects 'renderer-crashed' and the next call succeeds.
 * 6. Cache: open a 50-page PDF; the first page shows in under 1 s (PRD9-open-time). Zoom to 400 %:
 *    tiles replace the preview and are sharp (PRD9-pdf-clarity). Relaunch: the same tiles come from
 *    the cache without a render (no 'renderRegion' in the native log). The folder stays under 200 MB.
 */
import { PdfRenderNative, type NativeImageFormat, type PdfRenderNativeModule } from '../../../modules/pdf-render';

import { PdfError, toPdfError, type PdfEngine, type PdfHandle, type PdfInfo, type PdfPageSize, type PdfRenderResult, type RegionReq } from '@/notebook/core/contracts/pdf';
import { pageCacheKey, pdfCacheId, regionCacheKey } from '@/notebook/core/pdf/tiles';
import { consumeCrashJournal, crashMatchesPath } from '@/notebook/pdf/crashJournal';
import { getTileCache, type ImageExt } from '@/notebook/pdf/tileCache';

/** Image format of every cached render: JPEG keeps the 200 MB cache roomy and decodes fast. */
const FORMAT: NativeImageFormat = 'jpeg';
const EXT: ImageExt = 'jpg';
const JPEG_QUALITY = 0.9;

/** Largest bitmap side the engine asks for (the native side rejects bigger ones too). */
const MAX_SIDE_PX = 8192;

const noNative = (): PdfError => new PdfError('no-native', 'The PDF renderer is not in this build');

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function badRequest(what: string): PdfError {
  return new PdfError('io', `Bad PDF request: ${what}`);
}

function checkPage(page: number, pageCount: number): void {
  if (!isInt(page) || page < 0 || page >= pageCount) throw badRequest(`page ${page} of ${pageCount}`);
}

function checkPx(v: number, name: string): void {
  if (!isInt(v) || v < 1 || v > MAX_SIDE_PX) throw badRequest(`${name} ${v}`);
}

const ROTATIONS = [0, 90, 180, 270] as const;

function toSize(raw: { w?: unknown; h?: unknown; rotation?: unknown }): PdfPageSize {
  const w = isFiniteNum(raw?.w) && raw.w > 0 ? raw.w : 595.28;
  const h = isFiniteNum(raw?.h) && raw.h > 0 ? raw.h : 841.89;
  const r = ROTATIONS.find((x) => x === raw?.rotation) ?? 0;
  return { w, h, rotation: r };
}

function toResult(raw: { uri?: unknown; width?: unknown; height?: unknown }): PdfRenderResult {
  if (typeof raw?.uri !== 'string' || !isFiniteNum(raw.width) || !isFiniteNum(raw.height)) {
    throw new PdfError('io', 'The PDF renderer returned no image');
  }
  return { uri: raw.uri, width: raw.width, height: raw.height };
}

/** Runs a native call; every failure becomes a PdfError. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toPdfError(e);
  }
}

/**
 * A render that is tried again once when the renderer died (Android ':pdf' killed). After a
 * successful retry the crash entry that the first attempt left for this page is cleared, so the
 * page is not marked damaged at the next launch.
 */
async function renderWithRetry(native: PdfRenderNativeModule, path: string, page: number, run: () => Promise<PdfRenderResult>): Promise<PdfRenderResult> {
  try {
    return await call(run);
  } catch (e) {
    if (!(e instanceof PdfError) || e.code !== 'renderer-crashed') throw e;
  }
  const result = await call(run);
  try {
    const left = native.lastRenderCrash();
    if (left && left.page === page && crashMatchesPath(left, path)) native.clearRenderCrash();
  } catch {
    // The journal is advisory; the render itself succeeded.
  }
  return result;
}

function createHandle(native: PdfRenderNativeModule, path: string, handle: string, pageCount: number): PdfHandle {
  const docId = pdfCacheId(path);
  const cache = getTileCache();
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new PdfError('io', 'The PDF was closed');
  };

  return {
    pageCount,

    async pageSizes(from, count) {
      assertOpen();
      const start = isInt(from) ? Math.max(0, from) : 0;
      const n = isInt(count) ? Math.max(0, Math.min(count, pageCount - start)) : 0;
      if (n === 0) return [];
      const raw = await call(() => native.pageSizes(handle, start, n));
      return Array.isArray(raw) ? raw.map(toSize) : [];
    },

    async renderRegion(o: RegionReq) {
      assertOpen();
      checkPage(o.page, pageCount);
      checkPx(o.widthPx, 'widthPx');
      checkPx(o.heightPx, 'heightPx');
      if (![o.x, o.y, o.w, o.h].every(isFiniteNum) || o.w <= 0 || o.h <= 0) throw badRequest('region');
      const req = { page: o.page, x: o.x, y: o.y, w: o.w, h: o.h, widthPx: o.widthPx, heightPx: o.heightPx };
      return cache.get(docId, regionCacheKey(req), EXT, (outUri) =>
        renderWithRetry(native, path, o.page, async () => {
          assertOpen();
          return toResult(await native.renderRegion({ handle, ...req, outPath: outUri, format: FORMAT, quality: JPEG_QUALITY }));
        }),
      );
    },

    async renderPage(page, widthPx) {
      assertOpen();
      checkPage(page, pageCount);
      const w = isFiniteNum(widthPx) ? Math.round(widthPx) : NaN;
      checkPx(w, 'widthPx');
      return cache.get(docId, pageCacheKey(page, w), EXT, (outUri) =>
        renderWithRetry(native, path, page, async () => {
          assertOpen();
          return toResult(await native.renderPage({ handle, page, widthPx: w, outPath: outUri, format: FORMAT, quality: JPEG_QUALITY }));
        }),
      );
    },

    async probe(page) {
      assertOpen();
      checkPage(page, pageCount);
      await call(() => native.probe(handle, page));
    },

    async close() {
      if (closed) return;
      closed = true;
      await call(() => native.close(handle));
    },
  };
}

function createEngine(native: PdfRenderNativeModule | null): PdfEngine {
  if (!native) {
    return {
      available: false,
      inspect: async () => {
        throw noNative();
      },
      saveDecrypted: async () => {
        throw noNative();
      },
      open: async () => {
        throw noNative();
      },
      consumeCrashJournal: async () => {
        throw noNative();
      },
    };
  }
  return {
    available: true,

    async inspect(path): Promise<PdfInfo> {
      const raw = await call(() => native.inspect(path));
      const needsPassword = raw?.needsPassword === true;
      return {
        pageCount: !needsPassword && isInt(raw?.pageCount) && raw.pageCount > 0 ? raw.pageCount : 0,
        encrypted: raw?.encrypted === true || needsPassword,
        needsPassword,
      };
    },

    async saveDecrypted(src, password, dest) {
      await call(() => native.saveDecrypted(src, password, dest));
    },

    async open(path) {
      const raw = await call(() => native.open(path, null));
      if (typeof raw?.handle !== 'string' || !isInt(raw.pageCount) || raw.pageCount < 0) {
        throw new PdfError('io', 'The PDF renderer returned no document');
      }
      return createHandle(native, path, raw.handle, raw.pageCount);
    },

    consumeCrashJournal,
  };
}

export const pdfEngine: PdfEngine = createEngine(PdfRenderNative);

/** Deletes the cached images of one PDF (for example when its notebook is purged). */
export async function dropPdfTiles(path: string): Promise<void> {
  if (!pdfEngine.available) return;
  await getTileCache().dropDocument(pdfCacheId(path));
}
