/**
 * Export and share contract (P04): PDF and PNG export, cover thumbnails, .qunote files.
 *
 * Implementers:
 * - P23 src/notebook/export/pdfExport.ts: `exportPdf: ExportPdf` (vector ink on the original PDF pages,
 *   the highlighter group as one transparency group at 0.35)
 * - P23 src/notebook/export/pngExport.ts: `exportPagePng: ExportPagePng`
 * - P23 src/notebook/export/thumbnails.ts: `useThumbnailWorker: UseThumbnailWorker` (module singleton,
 *   ref-counted, mounted only by NotebookServices; per-notebook mutex; the SOLE writer of thumbs/cover.png)
 * - P08 src/notebook/qunote/index.ts: `exportQunote: ExportQunote`, `importQunote: ImportQunote`,
 *   `inspectQunote: InspectQunote`
 * - P08 src/notebook/core/qunote/estimate.ts: `estimateQunoteSize: EstimateQunoteSize`
 * - P04U src/notebook/ui/shareFile.ts: `shareFile: ShareFile` (deletes the cache file afterwards)
 *
 * Every export writes into the cache and resolves to a file:// URI.
 */
import type { Id, LocationKey, Notebook } from '@/notebook/core/model';
import type { ExportPdfOptions } from '@/notebook/core/contracts/pdf';
import type { NotebookSession } from '@/notebook/core/session/types';

export type { ExportPdfOptions, PageRange } from '@/notebook/core/contracts/pdf';

export type ExportPdf = (s: NotebookSession, o: ExportPdfOptions) => Promise<string>;
/** scale: pixels per page point (default 3, P23 pngExport PNG_SCALE); the long side is capped at 4096 px. */
export type ExportPagePng = (s: NotebookSession, pageId: Id, o?: { scale?: number }) => Promise<string>;
export type UseThumbnailWorker = () => void;

export type QunoteExportOptions = { includeRecordings: boolean; onProgress?: (done: number, total: number) => void };
export type ExportQunote = (s: NotebookSession, o: QunoteExportOptions) => Promise<{ uri: string; bytes: number }>;
/** pageBytes: total bytes of the page files. */
export type EstimateQunoteSize = (nb: Notebook, pageBytes: number) => { withRecordings: number; withoutRecordings: number };
/** 'copy' gives the notebook a new id; 'restore' keeps the file's id (replacing a notebook with that id). */
export type ImportQunote = (uri: string, o: { location: LocationKey; mode: 'copy' | 'restore' }) => Promise<Id>;

export type QunoteInfo = { title: string; pageCount: number; bytes: number; includesRecordings: boolean };
export type QunoteInspectError = 'not-qunote' | 'damaged' | 'newer-version';
export type InspectQunote = (uri: string) => Promise<QunoteInfo | { error: QunoteInspectError }>;

/** The .qunote file type (app.json document types). */
export const QUNOTE_EXT = 'qunote';
export const QUNOTE_MIME = 'application/vnd.qustudent.qunote';
export const QUNOTE_UTI = 'net.qustudent.qunote';

export interface ShareFileOptions {
  mimeType: string;
  /** iOS uniform type identifier, e.g. 'com.adobe.pdf', 'public.png', QUNOTE_UTI. */
  UTI: string;
  dialogTitle: string;
  /** iPad popover anchor in window coordinates. */
  anchor?: { x: number; y: number; width: number; height: number };
}

export type ShareFile = (uri: string, o: ShareFileOptions) => Promise<void>;
