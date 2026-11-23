/**
 * Adds a PDF's pages to an open notebook (NB-25: a blank notebook can get PDF pages; the pages view
 * and the editor's insert action use this). Picks the file, then importPdfFile with target
 * { session, at }: page `at` onwards moves down, the PDF's pages resolve in the background.
 *
 * Pass `ui` from useImportUi() (ImportProgress.tsx) so a locked PDF asks for its password and low
 * storage asks before copying. Without it, a locked PDF ends with 'password-required'.
 */
import type { ImportResult } from '@/notebook/core/contracts/importing';
import type { NotebookSession } from '@/notebook/core/session/types';

import { importPdfFile, type ImportUi } from './importPdf';
import { discardPick, pickPdf } from './pickPdf';

const noPassword: ImportUi['askPassword'] = async () => null;

export async function insertPdfInto(session: NotebookSession, at: number, ui?: ImportUi): Promise<ImportResult> {
  let picked;
  try {
    picked = await pickPdf();
  } catch {
    return { ok: false, reason: 'io' };
  }
  if (!picked) return { ok: false, reason: 'cancelled' };
  try {
    const r = await importPdfFile(picked.uri, {
      name: picked.name,
      size: picked.size,
      target: { session, at },
      askPassword: ui?.askPassword ?? noPassword,
      confirmLowStorage: ui?.confirmLowStorage,
      onProgress: ui?.onProgress,
      passwordDone: ui?.passwordDone,
    });
    if (!r.ok && r.reason === 'cancelled' && !ui) return { ok: false, reason: 'password-required' };
    return r;
  } finally {
    discardPick(picked);
  }
}
