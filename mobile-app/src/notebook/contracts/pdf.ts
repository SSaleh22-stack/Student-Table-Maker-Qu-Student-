/**
 * PDF contract (P04): the pure PDF types from core, plus the app-side function contracts.
 *
 * Implementers:
 * - P10 src/notebook/pdf/engine.ts: `pdfEngine: PdfEngine` (with available false, every method rejects
 *   PdfError('no-native')); `consumeCrashJournal` is also a method of it.
 * - Native module API: modules/pdf-render/src/PdfRender.types.ts (iOS P10, Android P10A).
 * - P16 src/notebook/ink/index.ts: usePdfPreview, usePdfTiles (painter contract, not here).
 */
export type {
  ExportPdfOptions,
  PageRange,
  PdfEngine,
  PdfErrorCode,
  PdfHandle,
  PdfInfo,
  PdfPageSize,
  PdfRenderResult,
  RegionReq,
} from '@/notebook/core/contracts/pdf';
export { PDF_ERROR_CODES, PDF_NATIVE_ERROR_MAP, PdfError, isPdfError, isPdfErrorCode, toPdfError } from '@/notebook/core/contracts/pdf';
