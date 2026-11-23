/**
 * Import contract (P04): the pure import types from core, plus the app-side function contracts.
 *
 * Implementers (P17):
 * - src/notebook/import/incoming.ts: `setIncoming: SetIncoming`, `takeIncoming: TakeIncoming`,
 *   `finishIncoming: FinishIncoming` (clearSharedPayloads + delete Inbox copies; called after the
 *   staging copy or on cancel, never earlier), `cleanupIncomingLeftovers: CleanupIncomingLeftovers` (boot)
 * - src/notebook/import/importFromSource.ts: `importFromSource: ImportFromSource`
 * - src/notebook/import/importPdf.ts: `importPdfFile: ImportPdfFile`
 * - src/notebook/import/insertPdf.ts: `insertPdfInto: InsertPdfInto`
 * - src/notebook/import/jobs.ts: `resumePendingImport: ResumePendingImport` (idempotent per
 *   notebook + jobId), `resumeAllPending: ResumeAllPending` (boot), `subscribeJobs: SubscribeJobs`,
 *   `getJobs: GetJobs`
 *
 * Locations travel as encodeLoc strings through routes (nav.openImport(source, loc)); decodeLoc turns
 * them back into a LocationKey. The type checks at the bottom fail to compile if the codec or nav
 * drift from these types.
 */
import type { decodeLoc, encodeLoc, LocationKey } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import type { AskPassword, ImportJob, ImportResult, ImportSource, ImportTarget, IncomingFile } from '@/notebook/core/contracts/importing';
import type { openImport } from '@/notebook/nav';

export type { AskPassword, ImportFailure, ImportJob, ImportResult, ImportSource, ImportTarget, IncomingFile } from '@/notebook/core/contracts/importing';
export { IMPORT_SOURCES, isImportSource } from '@/notebook/core/contracts/importing';

export type SetIncoming = (files: IncomingFile[]) => void;
/** The files waiting for the receive screen, or null. Does not clear them (finishIncoming does). */
export type TakeIncoming = () => IncomingFile[] | null;
export type FinishIncoming = () => Promise<void>;
export type CleanupIncomingLeftovers = () => Promise<void>;

export type ImportFromSource = (source: ImportSource, target: ImportTarget) => Promise<ImportResult>;
export type ImportPdfFile = (path: string, o: { name: string; target: ImportTarget; askPassword: AskPassword }) => Promise<ImportResult>;
/** Picks a PDF and inserts its pages into the open notebook at page index `at`. */
export type InsertPdfInto = (session: NotebookSession, at: number) => Promise<ImportResult>;
export type ResumePendingImport = (session: NotebookSession) => Promise<void>;
export type ResumeAllPending = () => Promise<void>;
export type SubscribeJobs = (cb: () => void) => () => void;
/** Cached: the same array until a job changes. */
export type GetJobs = () => readonly ImportJob[];

// ===== type-level checks (compile errors, no runtime code)

// prettier-ignore
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

/** encodeLoc takes exactly a LocationKey and gives a string ... */
export type CheckEncodeLoc = Assert<Equals<[Parameters<typeof encodeLoc>[0], ReturnType<typeof encodeLoc>], [LocationKey, string]>>;
/** ... and decodeLoc gives back exactly LocationKey | null, so a location round-trips through a route. */
export type CheckDecodeLoc = Assert<Equals<[Parameters<typeof decodeLoc>[0], ReturnType<typeof decodeLoc>], [string, LocationKey | null]>>;
/** nav.openImport takes the same sources and an encodeLoc string. */
export type CheckOpenImport = Assert<Equals<[Parameters<typeof openImport>[0], Parameters<typeof openImport>[1]], [ImportSource, string | undefined]>>;
