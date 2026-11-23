/**
 * Native API of the local Expo module `PdfRender` (P04 contract), shared by:
 * - iOS (P10): modules/pdf-render/ios/PdfRenderModule.swift, PDFKit on ONE serial queue, render journal
 * - Android (P10A): net.qustudent.pdfrender.PdfRenderModule (Kotlin), bundled PDFium in a separate
 *   ':pdf' process service, reached over a Messenger
 * - JS (P10): modules/pdf-render/index.ts loads it with requireOptionalNativeModule<PdfRenderNativeModule>
 *   ('PdfRender'); src/notebook/pdf/engine.ts wraps it as the PdfEngine contract.
 *
 * Conventions for every function:
 * - Async functions (Expo AsyncFunction) unless marked sync (Expo Function).
 * - Paths in: a file:// URI or an absolute path (native strips the file:// prefix). Paths out: file:// URIs.
 * - Pages are 0-based. Geometry is in PDF points of the page as DISPLAYED (crop box, with the page's
 *   /Rotate applied), origin top-left, y down. Bitmaps are opaque and pre-filled white.
 * - Every failure rejects with an Expo CodedError whose `code` is one of PDF_NATIVE_ERROR_CODES (never
 *   a crash or an unhandled exception; no force unwraps). JS maps it with core/contracts/pdf.ts
 *   toPdfError (ERR_PDF_PASSWORD -> 'password-required', ..., ERR_PDF_CRASHED -> 'renderer-crashed').
 * - A handle is an opaque string from open(); a closed or unknown handle rejects ERR_PDF_IO. Native keeps
 *   an LRU of 3 open documents and transparently reopens an evicted one (path and password kept in
 *   memory only).
 * - Crash journal: before every renderRegion, renderPage and probe, native records {path, page}
 *   synchronously and removes it afterwards (iOS: Documents/notebooks/.render-journal; Android: the
 *   app process records the request when the ':pdf' process dies, filesDir/pdf-crash.json). After a
 *   crash, lastRenderCrash() returns that entry until clearRenderCrash().
 */

/** Name passed to requireOptionalNativeModule (the module's Name(...) in Swift and Kotlin). */
export const PDF_RENDER_MODULE_NAME = 'PdfRender';

/** Fixed Android class (expo-module.config.json android.modules). */
export const PDF_RENDER_ANDROID_CLASS = 'net.qustudent.pdfrender.PdfRenderModule';

/** iOS module class (expo-module.config.json apple.modules). */
export const PDF_RENDER_IOS_CLASS = 'PdfRenderModule';

export const PDF_NATIVE_ERROR_CODES = [
  /** The document needs a password and none was given. */
  'ERR_PDF_PASSWORD',
  /** The password given does not open the document. */
  'ERR_PDF_WRONG_PASSWORD',
  /** Not parseable as a PDF, or the page is broken. */
  'ERR_PDF_DAMAGED',
  /** A feature the engine cannot do (e.g. saving without security on this engine). */
  'ERR_PDF_UNSUPPORTED',
  /** File missing or unreadable, output not writable, unknown handle, out of memory. */
  'ERR_PDF_IO',
  /** The renderer died while working (Android ':pdf' process gone; iOS: reported via the journal). */
  'ERR_PDF_CRASHED',
] as const;

export type PdfNativeErrorCode = (typeof PDF_NATIVE_ERROR_CODES)[number];

export interface NativePdfInspect {
  /** 0 when needsPassword is true. */
  pageCount: number;
  encrypted: boolean;
  needsPassword: boolean;
}

export interface NativePdfOpen {
  handle: string;
  pageCount: number;
}

export interface NativePageSize {
  /** Displayed width and height in points. */
  w: number;
  h: number;
  /** The page's own /Rotate (already applied to w and h). */
  rotation: 0 | 90 | 180 | 270;
}

export type NativeImageFormat = 'png' | 'jpeg';

export interface NativeRegionRequest {
  handle: string;
  page: number;
  /** Region in displayed page points. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Output bitmap size; the region is scaled to fill it exactly. */
  widthPx: number;
  heightPx: number;
  /** Where to write the image (overwritten). */
  outPath: string;
  format: NativeImageFormat;
  /** JPEG quality 0..1 (default 0.9); ignored for PNG. */
  quality?: number;
}

export interface NativePageRequest {
  handle: string;
  page: number;
  /** Output width; the height follows the page's aspect ratio. */
  widthPx: number;
  outPath: string;
  format: NativeImageFormat;
  quality?: number;
}

export interface NativeRenderResult {
  /** file:// URI of the written image. */
  uri: string;
  width: number;
  height: number;
}

export interface NativeRenderCrash {
  path: string;
  page: number;
}

export interface PdfRenderNativeModule {
  /** Page count and encryption without a password. Rejects ERR_PDF_DAMAGED for a non-PDF. */
  inspect(path: string): Promise<NativePdfInspect>;
  /** Opens a document (password null for an unprotected one). */
  open(path: string, password: string | null): Promise<NativePdfOpen>;
  /** Sizes of pages [from, from + count), clamped to the document. */
  pageSizes(handle: string, from: number, count: number): Promise<NativePageSize[]>;
  renderRegion(req: NativeRegionRequest): Promise<NativeRenderResult>;
  renderPage(req: NativePageRequest): Promise<NativeRenderResult>;
  /** Parses and renders the page at a tiny size; rejects if it is broken. */
  probe(handle: string, page: number): Promise<void>;
  /**
   * Writes an unprotected copy of src to dest (unlock with the password, save without security, re-open
   * dest and verify it is not encrypted). Rejects ERR_PDF_WRONG_PASSWORD, or ERR_PDF_UNSUPPORTED when
   * the engine cannot write a decrypted copy (JS then falls back to @cantoo/pdf-lib, P17).
   */
  saveDecrypted(src: string, password: string, dest: string): Promise<void>;
  /** Closes the handle (an unknown handle resolves too). */
  close(handle: string): Promise<void>;
  /** Sync. The page whose render crashed last time, or null. */
  lastRenderCrash(): NativeRenderCrash | null;
  /** Sync. Forgets the crash entry. */
  clearRenderCrash(): void;
}
