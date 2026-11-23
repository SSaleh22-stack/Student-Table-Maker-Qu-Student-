/**
 * Auto page: when the student starts writing on the LAST page of a notebook and that page is plain
 * paper, a new blank page with the same paper and size is added after it, so there is always a fresh
 * page to go on to. PDF pages and scanned-image pages do not get one.
 *
 * The editor adds it without an undo entry (insertPages, history false): undoing the first stroke
 * removes the ink and leaves the empty page, instead of removing the page and adding it straight back.
 */
import type { Id, Page } from '../model/index.ts';
import { blankPage } from '../model/paper.ts';

/** True when `last` (the notebook's last page) has content and is a paper page. */
export function needsAutoPage(last: Pick<Page, 'items' | 'background'> | undefined): boolean {
  return !!last && last.items.length > 0 && last.background.kind === 'paper';
}

/** The page to add after `last`: blank, same paper and size. */
export function autoPageAfter(last: Pick<Page, 'size' | 'background'>, id: Id): Page {
  const paper = last.background.kind === 'paper' ? last.background.paper : undefined;
  return blankPage(id, paper, last.size);
}
