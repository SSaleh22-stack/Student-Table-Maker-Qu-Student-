/**
 * PDF contract, pure part (P04). Shared by core (import planning, export ops) and the app.
 *
 * Implementers:
 * - PdfEngine / PdfHandle: P10 src/notebook/pdf/engine.ts exports `pdfEngine: PdfEngine`, on top of the
 *   native module described in modules/pdf-render/src/PdfRender.types.ts (iOS P10, Android P10A).
 * - toPdfError() is the one place that maps a native rejection (ERR_PDF_* codes) to a PdfError.
 * - PageRange / ExportPdfOptions: P23 src/notebook/export/pdfExport.ts (exportPdf) and
 *   core/export/pageRange.ts. They live here (not in contracts/export.ts) because core uses them.
 *
 * Coordinates: PDF points, origin top-left, y down, in the page as DISPLAYED (crop box, page rotation
 * applied). A renderer crash rejects with PdfError('renderer-crashed'); the caller marks that page
 * damaged (PageBackground.damaged) and goes on.
 */

export type PdfErrorCode =
  | 'no-native'
  | 'not-pdf'
  | 'damaged'
  | 'password-required'
  | 'wrong-password'
  | 'unsupported'
  | 'io'
  | 'renderer-crashed';

export const PDF_ERROR_CODES: readonly PdfErrorCode[] = [
  'no-native',
  'not-pdf',
  'damaged',
  'password-required',
  'wrong-password',
  'unsupported',
  'io',
  'renderer-crashed',
];

/** An error from the PDF engine. `code` says what went wrong; the message is for logs only. */
export class PdfError extends Error {
  code: PdfErrorCode;

  constructor(code: PdfErrorCode, message?: string) {
    super(message ?? `PdfError: ${code}`);
    // Keeps `instanceof PdfError` true where Error subclassing is transpiled (Babel class transform).
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'PdfError';
    this.code = code;
  }
}

export function isPdfError(e: unknown): e is PdfError {
  return e instanceof PdfError || (!!e && typeof e === 'object' && (e as { name?: unknown }).name === 'PdfError' && isPdfErrorCode((e as { code?: unknown }).code));
}

export function isPdfErrorCode(v: unknown): v is PdfErrorCode {
  return typeof v === 'string' && (PDF_ERROR_CODES as readonly string[]).includes(v);
}

/**
 * The error code strings the native module rejects with (same list as PdfRender.types.ts
 * PDF_NATIVE_ERROR_CODES; kept here too because core may not import modules/).
 */
export const PDF_NATIVE_ERROR_MAP: Readonly<Record<string, PdfErrorCode>> = {
  ERR_PDF_PASSWORD: 'password-required',
  ERR_PDF_WRONG_PASSWORD: 'wrong-password',
  ERR_PDF_DAMAGED: 'damaged',
  ERR_PDF_UNSUPPORTED: 'unsupported',
  ERR_PDF_IO: 'io',
  ERR_PDF_CRASHED: 'renderer-crashed',
};

/**
 * Any rejection from the engine or the native module as a PdfError: a PdfError passes through, a
 * native error with an ERR_PDF_* `code` is mapped, and anything else becomes `fallback` ('io').
 */
export function toPdfError(e: unknown, fallback: PdfErrorCode = 'io'): PdfError {
  if (e instanceof PdfError) return e;
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  const message = e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : String(e);
  if (typeof code === 'string') {
    const mapped = PDF_NATIVE_ERROR_MAP[code];
    if (mapped) return new PdfError(mapped, message);
    if (isPdfErrorCode(code)) return new PdfError(code, message);
  }
  return new PdfError(fallback, message);
}

/** A page's displayed size in points (crop box, rotation applied) and its intrinsic rotation. */
export interface PdfPageSize {
  w: number;
  h: number;
  rotation: 0 | 90 | 180 | 270;
}

/** What inspect() learns without a password. */
export interface PdfInfo {
  pageCount: number;
  encrypted: boolean;
  /** true when the file cannot be opened without a password (pageCount is then 0). */
  needsPassword: boolean;
}

/** A region of one page rendered to an image of exactly widthPx x heightPx pixels. */
export interface RegionReq {
  /** 0-based page index. */
  page: number;
  /** The region in page points (displayed page space, top-left origin). */
  x: number;
  y: number;
  w: number;
  h: number;
  widthPx: number;
  heightPx: number;
}

/** A rendered image file (file:// URI in the cache) and its pixel size. */
export interface PdfRenderResult {
  uri: string;
  width: number;
  height: number;
}

export interface PdfHandle {
  readonly pageCount: number;
  /** Sizes of pages [from, from + count) (clamped to the document). */
  pageSizes(from: number, count: number): Promise<PdfPageSize[]>;
  renderRegion(o: RegionReq): Promise<PdfRenderResult>;
  /** The whole page at widthPx wide (height follows the aspect ratio). */
  renderPage(page: number, widthPx: number): Promise<PdfRenderResult>;
  /** Parses and renders the page at a tiny size; rejects (often 'renderer-crashed') if it is broken. */
  probe(page: number): Promise<void>;
  close(): Promise<void>;
}

export interface PdfEngine {
  /** false on web, in Expo Go and in builds without the module: every method rejects PdfError('no-native'). */
  readonly available: boolean;
  inspect(path: string): Promise<PdfInfo>;
  /** Writes an unprotected copy of src to dest (assets are stored decrypted, ruling (b)). */
  saveDecrypted(src: string, password: string, dest: string): Promise<void>;
  /** Opens an unprotected PDF (a protected one rejects 'password-required'; decrypt it first). */
  open(path: string): Promise<PdfHandle>;
  /** The page whose render crashed the app or the ':pdf' process last time, cleared once read. */
  consumeCrashJournal(): Promise<{ path: string; page: number } | null>;
}

// ===== PDF export (P23)

/** 'current' uses ExportPdfOptions.currentIndex; from/to are 1-based and inclusive. */
export type PageRange = 'all' | 'current' | { from: number; to: number };

export interface ExportPdfOptions {
  range: PageRange;
  /** 0-based index of the page on screen (for 'current'). */
  currentIndex: number;
  onProgress?: (done: number, total: number) => void;
  signal?: { readonly aborted: boolean };
}
