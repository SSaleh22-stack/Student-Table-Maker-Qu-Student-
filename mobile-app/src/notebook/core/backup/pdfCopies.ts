/**
 * Readable PDF copies of the notebooks, next to the backup (QU Student/PDF beside QU Student/Backups).
 * The backup data (Backups/…) stays the only thing a restore reads; the PDFs are for opening the
 * notes in Google Drive, OneDrive or the Files app.
 *
 * Layout (paths relative to the PDF folder): a notebook in a course or a folder of the student's own
 * goes in a sub-folder named after it ('CS102 — Programming/Lecture 6.pdf'); a notebook without a
 * folder sits at the top ('Lecture 6.pdf'). Two notebooks with the same name in one folder get
 * ' (2)', ' (3)' … by creation order, so each keeps its file from run to run.
 *
 * planPdfCopies compares what should be there with what this device uploaded last time
 * (BackupLocalState.pdfUploaded: id -> { rev, path }) and gives the uploads (new or changed content,
 * a new path after a rename or move) and the removals (paths no notebook uses any more: the notebook
 * was deleted, renamed or moved). It never touches a file this device did not upload.
 */
import type { Id } from '../model/index.ts';

export interface PdfCopySource {
  id: Id;
  title: string;
  /** The sub-folder's display name; '' for notebooks without a folder. */
  folder: string;
  /** Changes whenever the notebook's content changes (IndexEntry.contentRev). */
  rev: number;
  createdAt: string;
}

export interface PdfCopyRecord {
  rev: number;
  path: string;
}

export interface PdfCopyPlan {
  /** Notebooks whose PDF is (re)made and uploaded to `path`. */
  upload: { id: Id; rev: number; path: string }[];
  /** Paths uploaded before that no notebook uses now. */
  remove: string[];
  /** Every notebook's wanted path (id -> path). */
  wanted: Record<Id, string>;
}

const BAD_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
/** Names OneDrive and Windows refuse. */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d|desktop\.ini|\.lock)$/i;
const MAX_NAME = 80;

/**
 * A file or folder name every cloud accepts: no slashes or other reserved characters, no leading
 * or trailing spaces or dots, at most MAX_NAME characters (never splitting a surrogate pair).
 */
export function safeFileName(name: string, fallback: string): string {
  let s = name.replace(BAD_CHARS, '-').replace(/\s+/g, ' ').trim();
  if (s.length > MAX_NAME) {
    s = s.slice(0, MAX_NAME);
    const last = s.charCodeAt(s.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
  }
  s = s.replace(/^[\s.~]+/, '').replace(/[\s.]+$/, '');
  if (!s) s = fallback;
  if (RESERVED.test(s)) s = `${s}_`;
  return s;
}

/** The wanted path of every notebook, names made unique per folder. */
export function pdfPaths(notebooks: readonly PdfCopySource[], fallbackTitle: string): Record<Id, string> {
  const ordered = [...notebooks].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const used = new Map<string, Set<string>>();
  const out: Record<Id, string> = {};
  for (const nb of ordered) {
    const folder = nb.folder ? safeFileName(nb.folder, 'Folder') : '';
    let taken = used.get(folder.toLowerCase());
    if (!taken) {
      taken = new Set();
      used.set(folder.toLowerCase(), taken);
    }
    const base = safeFileName(nb.title, fallbackTitle);
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    taken.add(name.toLowerCase());
    out[nb.id] = folder ? `${folder}/${name}.pdf` : `${name}.pdf`;
  }
  return out;
}

export function planPdfCopies(
  notebooks: readonly PdfCopySource[],
  uploaded: Readonly<Record<Id, PdfCopyRecord>>,
  fallbackTitle: string,
): PdfCopyPlan {
  const wanted = pdfPaths(notebooks, fallbackTitle);
  const upload: PdfCopyPlan['upload'] = [];
  for (const nb of notebooks) {
    const path = wanted[nb.id];
    const had = Object.prototype.hasOwnProperty.call(uploaded, nb.id) ? uploaded[nb.id] : undefined;
    if (!had || had.rev !== nb.rev || had.path !== path) upload.push({ id: nb.id, rev: nb.rev, path });
  }
  const inUse = new Set(Object.values(wanted).map((p) => p.toLowerCase()));
  const remove = new Set<string>();
  for (const id of Object.keys(uploaded)) {
    const path = uploaded[id].path;
    if (!inUse.has(path.toLowerCase())) remove.add(path);
  }
  return { upload, remove: [...remove], wanted };
}
