/**
 * Import from one of the 'جديد' sheet sources (Figma 04 tiles: 'استيراد PDF', 'مسح بالكاميرا',
 * 'من الصور', plus a single camera photo) into a new notebook at a location, or into an open one.
 *
 * importFromSource(source, target, ui?): opens the picker / scanner / camera, then importPdfFile or
 * importImages. Pass `ui` from useImportUi() for the password prompt, the low-storage warning and
 * progress; without it a locked PDF ends with 'password-required' and low storage is not asked.
 */
import type { ImportResult, ImportSource, ImportTarget } from '@/notebook/core/contracts/importing';
import { notebookSupported } from '@/notebook/flags';

import { importImages } from './importImages';
import { importPdfFile, type ImportUi } from './importPdf';
import { discardPick, pickPdf } from './pickPdf';
import { pickPhotos, takePhoto } from './pickPhotos';
import { scanDocument } from './scan';

const noPassword: ImportUi['askPassword'] = async () => null;

export async function importFromSource(source: ImportSource, target: ImportTarget, ui?: ImportUi): Promise<ImportResult> {
  if (!notebookSupported) return { ok: false, reason: 'not-supported' };
  const extra = { confirmLowStorage: ui?.confirmLowStorage, onProgress: ui?.onProgress, passwordDone: ui?.passwordDone };
  try {
    switch (source) {
      case 'pdf': {
        const picked = await pickPdf();
        if (!picked) return { ok: false, reason: 'cancelled' };
        try {
          const r = await importPdfFile(picked.uri, { name: picked.name, size: picked.size, target, askPassword: ui?.askPassword ?? noPassword, ...extra });
          if (!r.ok && r.reason === 'cancelled' && !ui) return { ok: false, reason: 'password-required' };
          return r;
        } finally {
          discardPick(picked);
        }
      }
      case 'photos': {
        const r = await pickPhotos();
        if (!r.ok) return { ok: false, reason: 'cancelled' };
        return await importImages(r.images, target, { origin: 'photos', ...extra });
      }
      case 'camera': {
        const r = await takePhoto();
        if (!r.ok) return { ok: false, reason: 'cancelled' };
        // The camera photo is our own cache file: move it.
        return await importImages(r.images, target, { origin: 'photos', move: true, ...extra });
      }
      case 'scan': {
        const r = await scanDocument();
        if (!r.ok) return { ok: false, reason: r.reason === 'not-supported' ? 'not-supported' : 'cancelled' };
        return await importImages(r.images, target, { origin: 'scan', move: true, ...extra });
      }
      default:
        return { ok: false, reason: 'not-supported' };
    }
  } catch {
    return { ok: false, reason: 'io' };
  }
}
