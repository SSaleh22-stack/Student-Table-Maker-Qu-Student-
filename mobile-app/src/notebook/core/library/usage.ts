/**
 * Storage used by notebooks (NB-87): total, PDFs, recordings, ink and images, other.
 * Reads only (notebook.json with repair:false); never writes or repairs anything.
 *
 * - pdf: asset files of kind pdf (assets/ files whose notebook.assets kind is pdf, or .pdf when the
 *   notebook cannot be read)
 * - audio: everything under audio/
 * - inkAndImages: page files (pages/) and image assets
 * - other: the rest (notebook.json, thumbnails, quarantine, staging, library.json, …)
 * total = the size of the whole notebooks root; other = total - the three others (never negative).
 */
import type { FsAdapter } from '../fs/adapter.ts';
import { readJsonRecovering } from '../fs/journal.ts';
import { isNotebookDirName, nbLayout } from '../fs/layout.ts';
import { readNotebookFile } from '../model/index.ts';
import type { Asset, Id } from '../model/index.ts';
import { assetOfFile } from '../session/recover.ts';
import type { StorageUsage } from '../session/types.ts';

export async function computeUsage(fs: FsAdapter, root: string): Promise<Omit<StorageUsage, 'free'>> {
  const layout = nbLayout(root);
  const total = await fs.size(root);
  let pdf = 0;
  let audio = 0;
  let inkAndImages = 0;
  for (const e of await fs.list(root)) {
    if (!e.isDir || !isNotebookDirName(e.name)) continue;
    const paths = layout.notebook(e.name);
    let assets: Record<Id, Asset> = {};
    try {
      const r = await readJsonRecovering(fs, paths.json, readNotebookFile, paths.quarantine, { repair: false });
      if (r.ok) assets = r.value.assets;
    } catch {
      // Sizes by extension below.
    }
    audio += await fs.size(paths.audioDir);
    inkAndImages += await fs.size(paths.pagesDir);
    for (const f of await fs.list(paths.assetsDir)) {
      if (f.isDir) {
        inkAndImages += await fs.size(fs.join(paths.assetsDir, f.name));
        continue;
      }
      const a = assetOfFile(f.name);
      const kind = a && assets[a.id] ? assets[a.id].kind : a?.ext === 'pdf' ? 'pdf' : 'image';
      if (kind === 'pdf') pdf += f.size;
      else if (kind === 'audio') audio += f.size;
      else inkAndImages += f.size;
    }
  }
  const other = Math.max(0, total - pdf - audio - inkAndImages);
  return { total: Math.max(total, pdf + audio + inkAndImages), pdf, audio, inkAndImages, other };
}
