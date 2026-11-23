/**
 * Images as pages (NB-32 scan, NB-33 photos, shared images): every image becomes one page with an
 * 'image' background, sized to the image's aspect ratio (core imagePageSize) over the default paper.
 *
 * - A new notebook: store.createFromPages with the images as assets (copied, or moved when they
 *   are our own staging / scanner cache files).
 * - An open notebook: session.addAsset for each image, then one insertPages (one undo step).
 * The free-space check runs first (LowStorageWarning through confirmLowStorage).
 */
import { DEFAULT_PAPER, newId, type Id, type Notebook, type Page, type PaperSpec } from '@/notebook/core/model';
import type { ImportResult, ImportTarget } from '@/notebook/core/contracts/importing';
import { imagePageSize } from '@/notebook/core/importing/plan';
import { imageExtFromMeta, imageExtOf } from '@/notebook/core/importing/sniff';
import type { AssetSource } from '@/notebook/core/session/types';
import { nbFs } from '@/notebook/store/deps';
import { tr } from '@/lib/i18n';

import { checkFreeSpace, importStore, type ImportUi } from './importPdf';
import type { PickedImage } from './pickPhotos';
import { imageSize } from './scan';

export interface ImportImagesOptions extends Partial<Omit<ImportUi, 'askPassword'>> {
  origin: Extract<Notebook['origin']['kind'], 'photos' | 'scan'>;
  /** The new notebook's title (default 'مستند ممسوح' for a scan, 'صور' for photos). */
  title?: string;
  /** Move the files instead of copying them (staging copies, scanner output). */
  move?: boolean;
}

async function extOf(img: PickedImage): Promise<string> {
  try {
    const head = await nbFs.readBytes(img.uri, 0, 32);
    const byBytes = imageExtOf(head);
    if (byBytes) return byBytes;
  } catch {
    // Use the name or MIME type.
  }
  return imageExtFromMeta(img.name, img.mimeType) ?? 'jpg';
}

async function sizeOfImage(img: PickedImage): Promise<{ w: number; h: number }> {
  let { width, height } = img;
  if (!(width > 0 && height > 0)) ({ width, height } = await imageSize(img.uri));
  return imagePageSize(width, height);
}

async function bytesOf(images: PickedImage[]): Promise<number> {
  let total = 0;
  for (const img of images) {
    if (typeof img.size === 'number' && img.size > 0) total += img.size;
    else {
      try {
        total += await nbFs.size(img.uri);
      } catch {
        // Unknown: counts as 0.
      }
    }
  }
  return total;
}

export function defaultImagesTitle(origin: ImportImagesOptions['origin']): string {
  return origin === 'scan' ? tr('مستند ممسوح', 'Scanned document') : tr('صور', 'Photos');
}

export async function importImages(images: PickedImage[], target: ImportTarget, o: ImportImagesOptions): Promise<ImportResult> {
  const store = importStore();
  if (!store) return { ok: false, reason: 'not-supported' };
  if (!images.length) return { ok: false, reason: 'cancelled' };
  if (!(await checkFreeSpace(store, await bytesOf(images), o.confirmLowStorage))) return { ok: false, reason: 'low-storage' };

  const paper: PaperSpec = { ...(store.settings.defaultPaper ?? DEFAULT_PAPER) };
  const total = images.length;
  o.onProgress?.({ phase: 'pages', done: 0, total });

  if ('location' in target) {
    const assets: AssetSource[] = [];
    const pages: Page[] = [];
    for (const img of images) {
      const fileId: Id = newId();
      const ext = await extOf(img);
      assets.push({ srcPath: img.uri, kind: 'image', ext, id: fileId, ...(img.name ? { name: img.name } : {}), move: !!o.move });
      pages.push({ id: newId(), size: await sizeOfImage(img), background: { kind: 'image', fileId, paper: { ...paper } }, items: [] });
      o.onProgress?.({ phase: 'pages', done: pages.length, total });
    }
    try {
      const id = await store.createFromPages({
        title: o.title || defaultImagesTitle(o.origin),
        location: target.location,
        pages,
        assets,
        origin: { kind: o.origin },
        defaults: paper,
      });
      store.requestThumb(id);
      return { ok: true, notebookId: id, pages: pages.length };
    } catch {
      return { ok: false, reason: 'io' };
    }
  }

  const s = target.session;
  if (s.readOnly) return { ok: false, reason: 'unsupported' };
  const pages: Page[] = [];
  try {
    for (const img of images) {
      const ext = await extOf(img);
      const size = await sizeOfImage(img);
      const asset = await s.addAsset(img.uri, 'image', ext, { move: !!o.move, ...(img.name ? { name: img.name } : {}) });
      pages.push({ id: newId(), size, background: { kind: 'image', fileId: asset.id, paper: { ...s.notebook.defaults } }, items: [] });
      o.onProgress?.({ phase: 'pages', done: pages.length, total });
    }
  } catch {
    if (!pages.length) return { ok: false, reason: 'io' };
  }
  const at = Math.max(0, Math.min(s.notebook.pageIds.length, Math.floor(target.at)));
  s.insertPages(at, pages, { history: true });
  return { ok: true, notebookId: s.id, pages: pages.length };
}
