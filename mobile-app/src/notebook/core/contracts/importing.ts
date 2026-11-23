/**
 * Import contract, pure part (P04). Implemented by P17 (src/notebook/import/{incoming,importFromSource,
 * importPdf,insertPdf,jobs}.ts and core/importing/{plan,sniff}.ts). The app-facing function types are in
 * src/notebook/contracts/importing.ts.
 */
import type { Id, LocationKey } from '../model/index.ts';
import type { NotebookSession } from '../session/types.ts';
import type { PdfErrorCode } from './pdf.ts';

/** Where a new import comes from (the 'جديد' sheet tiles and nav.openImport). */
export type ImportSource = 'pdf' | 'scan' | 'photos' | 'camera';

export const IMPORT_SOURCES: readonly ImportSource[] = ['pdf', 'scan', 'photos', 'camera'];

export function isImportSource(v: unknown): v is ImportSource {
  return typeof v === 'string' && (IMPORT_SOURCES as readonly string[]).includes(v);
}

/** A file handed to the app by "Open in", the share sheet or a VIEW intent. */
export interface IncomingFile {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
  via: 'open-in' | 'share' | 'view';
  /** true for an Android share payload (expo-sharing): cleared only after the staging copy or on cancel. */
  sharedPayload: boolean;
}

/** A new notebook at a library location, or pages inserted into an open notebook at index `at`. */
export type ImportTarget = { location: LocationKey } | { session: NotebookSession; at: number };

/** Why an import did not finish. */
export type ImportFailure = 'cancelled' | 'low-storage' | 'not-supported' | PdfErrorCode;

export type ImportResult =
  | { ok: true; notebookId: Id; /** Pages added so far (a PDF keeps importing in the background). */ pages: number }
  | { ok: false; reason: ImportFailure };

/** A background PDF import job (NB-36), as subscribeJobs reports it. */
export interface ImportJob {
  jobId: Id;
  notebookId: Id;
  done: number;
  total: number;
  state: 'running' | 'done' | 'failed';
  damagedPages: number[];
}

/** Asks the student for a PDF password; null when they cancel. `wrong` is true after a bad attempt. */
export type AskPassword = (o: { name: string; wrong: boolean }) => Promise<string | null>;
