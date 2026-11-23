/**
 * The pages view selection model and its action rules (P25, Figma 13, NB-23, NB-24, NB-25). Pure.
 *
 * Two modes:
 * - Normal: a tap on a page jumps to it (requestJump, then back to the editor); a long press lifts it
 *   for reordering. The action bar works on the CURRENT page (the editor's page).
 * - Select ('تحديد'): a tap adds or removes the page (any number, 0 included); reordering is off. The
 *   action bar works on the selected pages, or on the current page while none is selected.
 *
 * Targets are always in page order. The actions:
 * - 'إضافة صفحة': one new page right after the LAST target. Its paper is the target's paper when the
 *   target is a paper page; after a PDF or image page it is the notebook default. The long-press
 *   choice 'في النهاية' adds it at the end of the notebook with the notebook default.
 * - 'تكرار': every target is copied right after itself (one undo step).
 * - 'تغيير الورق': paper and image targets get the chosen paper (an image page keeps its image and
 *   its size; the paper shows around and under it); PDF targets are skipped ('لا يمكن تغيير ورق صفحات
 *   PDF').
 * - 'إدراج PDF': the PDF's pages go in after the last target.
 * - 'حذف': the targets, after 'حذف n صفحة؟'. Not allowed when the targets are every page.
 *
 * The labels take the language from the caller (core cannot call tr()).
 */
import { copyPaper } from '../model/index.ts';
import type { Id, PageBackground, PaperSpec } from '../model/index.ts';
import type { LabelLang } from '../text/labels.ts';

export type PagesMode = 'normal' | 'select';

export interface PagesView {
  /** The notebook's pages, in order. */
  pageIds: readonly Id[];
  /** The editor's current page (null or a removed id falls back to the first page). */
  current: Id | null;
  mode: PagesMode;
  /** Selected pages (select mode only; ignored in normal mode). */
  selected: readonly Id[];
}

export type PageActionId = 'add' | 'duplicate' | 'paper' | 'insertPdf' | 'delete';

/** The order of the action bar (reading order). */
export const PAGE_ACTIONS: readonly PageActionId[] = ['add', 'duplicate', 'paper', 'insertPdf', 'delete'];

/** What a tap on a page does in a mode. */
export function tapAction(mode: PagesMode): 'jump' | 'toggle' {
  return mode === 'select' ? 'toggle' : 'jump';
}

/** Whether a long press may lift a page for reordering. */
export function canReorder(mode: PagesMode, readOnly = false): boolean {
  return mode === 'normal' && !readOnly;
}

/** Adds or removes a page from the selection (a new array; order of selection kept). */
export function toggleSelected(selected: readonly Id[], id: Id): Id[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

/** Drops ids that are no longer pages (after a delete, an undo or an import), and duplicates. */
export function pruneSelection(selected: readonly Id[], pageIds: readonly Id[]): Id[] {
  const live = new Set(pageIds);
  const seen = new Set<Id>();
  const out: Id[] = [];
  for (const id of selected) {
    if (!live.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Whether pruneSelection would change anything (so callers can skip a state update). */
export function selectionChanged(selected: readonly Id[], pageIds: readonly Id[]): boolean {
  const pruned = pruneSelection(selected, pageIds);
  return pruned.length !== selected.length;
}

/** The current page, or the first page when current is not (or no longer) a page. */
export function effectiveCurrent(pageIds: readonly Id[], current: Id | null): Id | null {
  if (current && pageIds.includes(current)) return current;
  return pageIds.length ? pageIds[0] : null;
}

/** The pages the action bar works on, in page order. */
export function actionTargets(v: PagesView): Id[] {
  if (v.mode === 'select') {
    const chosen = new Set(v.selected);
    const inOrder = v.pageIds.filter((id) => chosen.has(id));
    if (inOrder.length) return inOrder;
  }
  const cur = effectiveCurrent(v.pageIds, v.current);
  return cur ? [cur] : [];
}

/** The target that comes last in the notebook, or null. */
export function lastTarget(pageIds: readonly Id[], targets: readonly Id[]): Id | null {
  let best = -1;
  for (const id of targets) {
    const i = pageIds.indexOf(id);
    if (i > best) best = i;
  }
  return best >= 0 ? pageIds[best] : null;
}

/** The pageIds index right after the last target (the end of the notebook without targets). */
export function insertIndexAfter(pageIds: readonly Id[], targets: readonly Id[]): number {
  const last = lastTarget(pageIds, targets);
  return last === null ? pageIds.length : pageIds.indexOf(last) + 1;
}

/** The paper a new page takes after a page with this background (undefined: not loaded). */
export function paperAfter(bg: PageBackground | undefined, defaults: PaperSpec): PaperSpec {
  if (bg && bg.kind === 'paper') return copyPaper(bg.paper);
  return copyPaper(defaults);
}

export interface AddPagePlan {
  /** session.addPage's first argument. */
  after: Id | 'end';
  background: PageBackground;
}

/**
 * Where 'إضافة صفحة' puts the new page and with which paper. where 'end' (the long-press choice and
 * the dashed tile) appends with the notebook default.
 */
export function addPagePlan(
  v: PagesView,
  bgOf: (id: Id) => PageBackground | undefined,
  defaults: PaperSpec,
  where: 'after' | 'end' = 'after',
): AddPagePlan {
  if (where === 'end') return { after: 'end', background: { kind: 'paper', paper: copyPaper(defaults) } };
  const last = lastTarget(v.pageIds, actionTargets(v));
  if (last === null) return { after: 'end', background: { kind: 'paper', paper: copyPaper(defaults) } };
  return { after: last, background: { kind: 'paper', paper: paperAfter(bgOf(last), defaults) } };
}

/** The pages 'تكرار' copies (each right after itself), in page order. */
export function duplicateTargets(v: PagesView): Id[] {
  return actionTargets(v);
}

export interface PaperPlan {
  /** Paper and image pages that take the new paper. */
  apply: Id[];
  /** PDF pages that are skipped. */
  skippedPdf: number;
  /** Pages whose background is unknown (not loaded): neither applied nor counted as PDF. */
  unknown: number;
}

/** Splits the targets of 'تغيير الورق' into the pages that change and the PDF pages that cannot. */
export function paperPlan(targets: readonly Id[], bgOf: (id: Id) => PageBackground | undefined): PaperPlan {
  const apply: Id[] = [];
  let skippedPdf = 0;
  let unknown = 0;
  for (const id of targets) {
    const bg = bgOf(id);
    if (!bg) unknown += 1;
    else if (bg.kind === 'pdf') skippedPdf += 1;
    else apply.push(id);
  }
  return { apply, skippedPdf, unknown };
}

/**
 * The new background of a page for a chosen paper: a paper page takes it, an image page keeps its
 * image with the new paper, a PDF page is skipped (null).
 */
export function backgroundWithPaper(bg: PageBackground, paper: PaperSpec): PageBackground | null {
  if (bg.kind === 'paper') return { kind: 'paper', paper: copyPaper(paper) };
  if (bg.kind === 'image') return { kind: 'image', fileId: bg.fileId, paper: copyPaper(paper) };
  return null;
}

/** The paper the sheet opens with: the first paper or image target's paper, else the notebook default. */
export function initialPaper(targets: readonly Id[], bgOf: (id: Id) => PageBackground | undefined, defaults: PaperSpec): PaperSpec {
  for (const id of targets) {
    const bg = bgOf(id);
    if (bg && (bg.kind === 'paper' || bg.kind === 'image')) return copyPaper(bg.paper);
  }
  return copyPaper(defaults);
}

/** Whether 'حذف' is allowed: at least one target, and not every page of the notebook. */
export function canDelete(pageIds: readonly Id[], targets: readonly Id[]): boolean {
  if (!targets.length || !pageIds.length) return false;
  const live = new Set(pageIds);
  const doomed = new Set(targets.filter((id) => live.has(id)));
  return doomed.size > 0 && doomed.size < live.size;
}

/**
 * The current page after deleting `deleted`: unchanged when it survives, else the first surviving
 * page after it, else the last surviving page before it, else null.
 */
export function currentAfterDelete(pageIds: readonly Id[], deleted: readonly Id[], current: Id | null): Id | null {
  const gone = new Set(deleted);
  const cur = effectiveCurrent(pageIds, current);
  if (cur === null) return null;
  if (!gone.has(cur)) return cur;
  const at = pageIds.indexOf(cur);
  for (let i = at + 1; i < pageIds.length; i++) if (!gone.has(pageIds[i])) return pageIds[i];
  for (let i = at - 1; i >= 0; i--) if (!gone.has(pageIds[i])) return pageIds[i];
  return null;
}

export interface ActionState {
  enabled: boolean;
}

/** Enabled state of every action for the view (readOnly notebooks allow nothing). */
export function actionStates(v: PagesView, readOnly = false): Record<PageActionId, ActionState> {
  const targets = actionTargets(v);
  const any = targets.length > 0 && !readOnly;
  return {
    add: { enabled: !readOnly },
    duplicate: { enabled: any },
    // Enabled with only PDF targets too: the tap explains why nothing changes.
    paper: { enabled: any },
    insertPdf: { enabled: !readOnly },
    delete: { enabled: !readOnly && canDelete(v.pageIds, targets) },
  };
}

// ===== labels

/** 'حذف صفحة واحدة؟', 'حذف صفحتين؟', 'حذف 3 صفحات؟', 'حذف 11 صفحة؟' / 'Delete 3 pages?'. */
export function deletePagesTitle(n: number, lang: LabelLang): string {
  const c = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (lang === 'en') return c === 1 ? 'Delete 1 page?' : `Delete ${c} pages?`;
  if (c === 1) return 'حذف صفحة واحدة؟';
  if (c === 2) return 'حذف صفحتين؟';
  const r = c % 100;
  return `حذف ${c} ${r >= 3 && r <= 10 ? 'صفحات' : 'صفحة'}؟`;
}

/** The toast after a delete: 'حُذفت الصفحة', 'حُذفت صفحتان', 'حُذفت 3 صفحات' / '3 pages deleted'. */
export function deletedPagesText(n: number, lang: LabelLang): string {
  const c = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (lang === 'en') return c === 1 ? 'Page deleted' : `${c} pages deleted`;
  if (c === 1) return 'حُذفت الصفحة';
  if (c === 2) return 'حُذفت صفحتان';
  const r = c % 100;
  return `حُذفت ${c} ${r >= 3 && r <= 10 ? 'صفحات' : 'صفحة'}`;
}

/** The hint above the action bar. */
export function pagesHint(v: PagesView, lang: LabelLang, readOnly = false): string {
  if (readOnly) return lang === 'en' ? 'This notebook is read-only' : 'هذه المذكرة للقراءة فقط';
  if (v.mode === 'normal') return lang === 'en' ? 'Drag a page to change its order' : 'اسحب الصفحة لتغيير ترتيبها';
  const n = pruneSelection(v.selected, v.pageIds).length;
  if (n === 0) return lang === 'en' ? 'Tap pages to select them' : 'اضغط على الصفحات لتحديدها';
  if (lang === 'en') return n === 1 ? '1 page selected' : `${n} pages selected`;
  if (n === 1) return 'حُددت صفحة واحدة';
  if (n === 2) return 'حُددت صفحتان';
  const r = n % 100;
  return `حُددت ${n} ${r >= 3 && r <= 10 ? 'صفحات' : 'صفحة'}`;
}
