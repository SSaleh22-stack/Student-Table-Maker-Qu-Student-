/**
 * What kind of file the app was handed (P17), from its first bytes, its name and its MIME type.
 * Pure: the caller reads the head of the (staged) file and passes it in.
 *
 * The bytes decide when they are clear; the name and MIME type are only used for files the bytes
 * cannot tell apart (an empty or unreadable head). Sniffing is a routing hint, never the real check:
 * a PDF still goes through pdfEngine.inspect and a .qunote through inspectQunote.
 *
 * - PDF: '%PDF-' within the first 1024 bytes (the spec allows leading junk).
 * - .qunote: a zip local file header 'PK\x03\x04' whose first entry name is 'qunote.json' (P08 always
 *   writes the manifest first). Any other zip with a .qunote name or the qunote MIME type is still
 *   routed to inspectQunote, which gives the precise error.
 * - Images: JPEG, PNG, GIF, WebP, HEIC/HEIF (ftyp brands), BMP.
 */

export type IncomingKind = 'pdf' | 'qunote' | 'image' | 'unknown';

/** How many head bytes sniffKind looks at. Read at least this much. */
export const SNIFF_BYTES = 1024;

export const QUNOTE_MIME_TYPE = 'application/vnd.qustudent.qunote';

export type ImageExt = 'jpg' | 'png' | 'gif' | 'webp' | 'heic' | 'bmp';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const MANIFEST_NAME = 'qunote.json';

function startsWith(b: Uint8Array, sig: readonly number[], at = 0): boolean {
  if (b.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false;
  return true;
}

function ascii(b: Uint8Array, from: number, len: number): string {
  let s = '';
  for (let i = from; i < Math.min(b.length, from + len); i++) s += String.fromCharCode(b[i]);
  return s;
}

/** True when '%PDF-' appears within the first 1024 bytes. */
export function isPdfHead(b: Uint8Array): boolean {
  const end = Math.min(b.length, SNIFF_BYTES) - PDF_MAGIC.length;
  for (let i = 0; i <= end; i++) if (startsWith(b, PDF_MAGIC, i)) return true;
  return false;
}

/** True for a zip (local file header at offset 0). */
export function isZipHead(b: Uint8Array): boolean {
  return startsWith(b, ZIP_LOCAL);
}

/** True for a zip whose first entry is qunote.json. */
export function isQunoteHead(b: Uint8Array): boolean {
  if (!isZipHead(b) || b.length < 30) return false;
  const nameLen = b[26] | (b[27] << 8);
  if (nameLen !== MANIFEST_NAME.length) return false;
  return ascii(b, 30, nameLen) === MANIFEST_NAME;
}

/** The image format from the head bytes, or null. */
export function imageExtOf(b: Uint8Array): ImageExt | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'heif'].includes(brand)) return 'heic';
  }
  if (ascii(b, 0, 2) === 'BM' && b.length >= 14) return 'bmp';
  return null;
}

/** The lowercase extension of a file name ('' when none). */
export function extOfName(name: string | undefined | null): string {
  const n = String(name ?? '');
  const slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
  const base = n.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** A file name without its extension (for a notebook title), trimmed; '' when nothing is left. */
export function titleFromName(name: string | undefined | null): string {
  const n = String(name ?? '');
  const slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
  const base = n.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const IMAGE_EXTS: Record<string, ImageExt> = {
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
  gif: 'gif',
  webp: 'webp',
  heic: 'heic',
  heif: 'heic',
  bmp: 'bmp',
};

/** The image extension from a name or MIME type (used when the bytes are not available). */
export function imageExtFromMeta(name?: string | null, mime?: string | null): ImageExt | null {
  const byName = IMAGE_EXTS[extOfName(name)];
  if (byName) return byName;
  const m = String(mime ?? '').toLowerCase();
  if (!m.startsWith('image/')) return null;
  return IMAGE_EXTS[m.slice('image/'.length).replace(/^x-/, '')] ?? null;
}

/** The kind of an incoming file. head may be empty (unreadable): then the name and MIME type decide. */
export function sniffKind(head: Uint8Array, name?: string | null, mime?: string | null): IncomingKind {
  const ext = extOfName(name);
  const m = String(mime ?? '').toLowerCase();
  if (head.length > 0) {
    if (isPdfHead(head)) return 'pdf';
    if (isQunoteHead(head)) return 'qunote';
    if (imageExtOf(head)) return 'image';
    // A zip that is not ours but is named or typed as one goes to inspectQunote for the real error.
    if (isZipHead(head) && (ext === 'qunote' || m === QUNOTE_MIME_TYPE)) return 'qunote';
    // The bytes are readable and match nothing: a file named .pdf is still reported as a PDF, so
    // the student gets the PDF error ('not a valid PDF') rather than a generic one.
    if (ext === 'pdf' || m === 'application/pdf') return 'pdf';
    if (ext === 'qunote' || m === QUNOTE_MIME_TYPE) return 'qunote';
    return 'unknown';
  }
  if (ext === 'pdf' || m === 'application/pdf') return 'pdf';
  if (ext === 'qunote' || m === QUNOTE_MIME_TYPE) return 'qunote';
  if (imageExtFromMeta(name, mime)) return 'image';
  return 'unknown';
}
