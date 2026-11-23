/**
 * Crash-journal consumer (P10). The native renderer records {path, page} before every renderRegion,
 * renderPage and probe and removes it afterwards:
 * - iOS: Documents/notebooks/.render-journal. A render that never finished means the app died in
 *   PDFKit; at the next launch the native module moves that entry aside and lastRenderCrash()
 *   returns it until clearRenderCrash().
 * - Android (P10A): the app process records the request when the ':pdf' process dies
 *   (filesDir/pdf-crash.json).
 *
 * consumeCrashJournal() reads the entry, clears it and returns it, so each crash is handed out once.
 * P17 (import jobs) and P30 (NotebookServices at boot) use it to mark that page damaged
 * (PageBackground.damaged) so the student is never locked out by a page that kills the renderer.
 * Match the entry against an asset with crashMatchesPath: the stored path may be a file:// URI or a
 * plain path, and iOS may have moved the app container since.
 */
import { PdfRenderNative } from '../../../modules/pdf-render';

import { PdfError, toPdfError } from '@/notebook/core/contracts/pdf';
import { pdfPathTail } from '@/notebook/core/pdf/tiles';

export interface RenderCrash {
  /** The PDF the renderer died in, as the native side recorded it (file:// URI or path). */
  path: string;
  /** 0-based page index. */
  page: number;
}

function validEntry(raw: unknown): RenderCrash | null {
  if (!raw || typeof raw !== 'object') return null;
  const { path, page } = raw as { path?: unknown; page?: unknown };
  if (typeof path !== 'string' || path.length === 0) return null;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 0) return null;
  return { path, page };
}

/**
 * The page whose render crashed last time, cleared once read; null when there was no crash.
 * Rejects PdfError('no-native') when the build has no native renderer (web, Expo Go): callers at
 * boot catch it.
 */
export async function consumeCrashJournal(): Promise<RenderCrash | null> {
  const native = PdfRenderNative;
  if (!native) throw new PdfError('no-native', 'The PDF renderer is not in this build');
  let raw: unknown;
  try {
    raw = native.lastRenderCrash();
  } catch (e) {
    throw toPdfError(e);
  }
  if (raw == null) return null;
  try {
    native.clearRenderCrash();
  } catch (e) {
    throw toPdfError(e);
  }
  // An unreadable entry is cleared too: it can never be matched to a page.
  return validEntry(raw);
}

/**
 * True when a crash entry is about the PDF at `path` (an asset path from session.assetPath, a
 * staging path, a file:// URI or a plain path). Compares the part from the notebooks folder on, so a
 * moved iOS app container still matches.
 */
export function crashMatchesPath(entry: RenderCrash | null | undefined, path: string): boolean {
  if (!entry || typeof path !== 'string' || path.length === 0) return false;
  return pdfPathTail(entry.path) === pdfPathTail(path);
}
