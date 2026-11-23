import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Id, PageBackground, PaperSpec } from '../../../src/notebook/core/model/index.ts';
import {
  PAGE_ACTIONS,
  actionStates,
  actionTargets,
  addPagePlan,
  backgroundWithPaper,
  canDelete,
  canReorder,
  currentAfterDelete,
  deletePagesTitle,
  deletedPagesText,
  duplicateTargets,
  effectiveCurrent,
  initialPaper,
  insertIndexAfter,
  lastTarget,
  pagesHint,
  paperAfter,
  paperPlan,
  pruneSelection,
  selectionChanged,
  tapAction,
  toggleSelected,
  type PagesView,
} from '../../../src/notebook/core/pages/pageSelection.ts';

const DEFAULTS: PaperSpec = { style: 'lined', color: 'white', size: 'a4' };
const GRID_CREAM: PaperSpec = { style: 'grid', color: 'cream', size: 'a4' };
const DOTTED_WIDE: PaperSpec = { style: 'dotted', color: 'dark', size: 'wide' };
const BLANK_LETTER: PaperSpec = { style: 'blank', color: 'white', size: 'letter' };

/** p1 grid paper, p2 PDF, p3 image (blank letter under it), p4 dotted paper, p5 PDF. */
const IDS: Id[] = ['p1', 'p2', 'p3', 'p4', 'p5'];
const BG: Record<Id, PageBackground> = {
  p1: { kind: 'paper', paper: GRID_CREAM },
  p2: { kind: 'pdf', fileId: 'f1', pageIndex: 0, rotation: 0 },
  p3: { kind: 'image', fileId: 'img', paper: BLANK_LETTER },
  p4: { kind: 'paper', paper: DOTTED_WIDE },
  p5: { kind: 'pdf', fileId: 'f1', pageIndex: 1, rotation: 0 },
};
const bgOf = (id: Id): PageBackground | undefined => BG[id];

const normal = (current: Id | null = 'p3'): PagesView => ({ pageIds: IDS, current, mode: 'normal', selected: [] });
const select = (selected: Id[], current: Id | null = 'p3'): PagesView => ({ pageIds: IDS, current, mode: 'select', selected });

describe('modes', () => {
  test('a tap jumps in normal mode and toggles in select mode', () => {
    assert.equal(tapAction('normal'), 'jump');
    assert.equal(tapAction('select'), 'toggle');
  });
  test('reorder only in normal mode, never read-only', () => {
    assert.equal(canReorder('normal'), true);
    assert.equal(canReorder('select'), false);
    assert.equal(canReorder('normal', true), false);
  });
  test('the action bar order matches Figma 13', () => {
    assert.deepEqual(PAGE_ACTIONS, ['add', 'duplicate', 'paper', 'insertPdf', 'delete']);
  });
});

describe('selection', () => {
  test('toggle adds and removes', () => {
    assert.deepEqual(toggleSelected([], 'p2'), ['p2']);
    assert.deepEqual(toggleSelected(['p2', 'p4'], 'p2'), ['p4']);
    assert.deepEqual(toggleSelected(['p4'], 'p1'), ['p4', 'p1']);
  });
  test('prune drops removed pages and duplicates', () => {
    assert.deepEqual(pruneSelection(['p9', 'p2', 'p2', 'p4'], IDS), ['p2', 'p4']);
    assert.equal(selectionChanged(['p2'], IDS), false);
    assert.equal(selectionChanged(['p2', 'gone'], IDS), true);
  });
  test('effectiveCurrent falls back to the first page', () => {
    assert.equal(effectiveCurrent(IDS, 'p4'), 'p4');
    assert.equal(effectiveCurrent(IDS, 'gone'), 'p1');
    assert.equal(effectiveCurrent(IDS, null), 'p1');
    assert.equal(effectiveCurrent([], 'p1'), null);
  });
});

describe('actionTargets: 0, 1 and n', () => {
  test('normal mode targets the current page (selection ignored)', () => {
    assert.deepEqual(actionTargets(normal()), ['p3']);
    assert.deepEqual(actionTargets({ ...normal(), selected: ['p1', 'p2'] }), ['p3']);
  });
  test('select mode with 0 selected targets the current page', () => {
    assert.deepEqual(actionTargets(select([])), ['p3']);
  });
  test('select mode with 1 selected', () => {
    assert.deepEqual(actionTargets(select(['p4'])), ['p4']);
  });
  test('select mode with n selected: page order, removed ids dropped', () => {
    assert.deepEqual(actionTargets(select(['p4', 'p1', 'gone', 'p2'])), ['p1', 'p2', 'p4']);
  });
  test('an empty notebook has no targets', () => {
    assert.deepEqual(actionTargets({ pageIds: [], current: null, mode: 'select', selected: [] }), []);
  });
  test('lastTarget and insertIndexAfter', () => {
    assert.equal(lastTarget(IDS, ['p4', 'p1']), 'p4');
    assert.equal(lastTarget(IDS, []), null);
    assert.equal(insertIndexAfter(IDS, ['p1']), 1);
    assert.equal(insertIndexAfter(IDS, ['p2', 'p4']), 4);
    assert.equal(insertIndexAfter(IDS, ['p5']), 5);
    assert.equal(insertIndexAfter(IDS, []), 5);
  });
});

describe("'إضافة صفحة'", () => {
  test('1 target (normal, image page): after it, notebook default paper', () => {
    assert.deepEqual(addPagePlan(normal('p3'), bgOf, DEFAULTS), { after: 'p3', background: { kind: 'paper', paper: DEFAULTS } });
  });
  test('1 target, paper page: after it with its paper', () => {
    assert.deepEqual(addPagePlan(normal('p1'), bgOf, DEFAULTS), { after: 'p1', background: { kind: 'paper', paper: GRID_CREAM } });
  });
  test('1 target, PDF page: notebook default', () => {
    assert.deepEqual(addPagePlan(normal('p2'), bgOf, DEFAULTS).background, { kind: 'paper', paper: DEFAULTS });
  });
  test('0 selected in select mode: after the current page', () => {
    assert.equal(addPagePlan(select([], 'p4'), bgOf, DEFAULTS).after, 'p4');
  });
  test('n selected: after the LAST target, with its paper', () => {
    const plan = addPagePlan(select(['p4', 'p1', 'p2']), bgOf, DEFAULTS);
    assert.equal(plan.after, 'p4');
    assert.deepEqual(plan.background, { kind: 'paper', paper: DOTTED_WIDE });
    const pdfLast = addPagePlan(select(['p1', 'p5']), bgOf, DEFAULTS);
    assert.equal(pdfLast.after, 'p5');
    assert.deepEqual(pdfLast.background, { kind: 'paper', paper: DEFAULTS });
  });
  test("'في النهاية' appends with the notebook default", () => {
    assert.deepEqual(addPagePlan(select(['p1']), bgOf, DEFAULTS, 'end'), { after: 'end', background: { kind: 'paper', paper: DEFAULTS } });
  });
  test('no targets: the end', () => {
    assert.equal(addPagePlan({ pageIds: [], current: null, mode: 'normal', selected: [] }, bgOf, DEFAULTS).after, 'end');
  });
  test('an unloaded target counts as not paper', () => {
    assert.deepEqual(paperAfter(undefined, DEFAULTS), DEFAULTS);
  });
  test('the plan never shares the paper objects', () => {
    const plan = addPagePlan(normal('p1'), bgOf, DEFAULTS);
    assert.ok(plan.background.kind === 'paper' && plan.background.paper !== GRID_CREAM);
  });
});

describe("'تكرار'", () => {
  test('0 selected -> the current page', () => {
    assert.deepEqual(duplicateTargets(select([])), ['p3']);
  });
  test('1 -> that page', () => {
    assert.deepEqual(duplicateTargets(select(['p2'])), ['p2']);
  });
  test('n -> every page, in page order', () => {
    assert.deepEqual(duplicateTargets(select(['p5', 'p1', 'p3'])), ['p1', 'p3', 'p5']);
  });
});

describe("'تغيير الورق'", () => {
  test('0 selected: the current page', () => {
    assert.deepEqual(paperPlan(actionTargets(select([], 'p1')), bgOf), { apply: ['p1'], skippedPdf: 0, unknown: 0 });
  });
  test('1 PDF target: skipped', () => {
    assert.deepEqual(paperPlan(actionTargets(normal('p2')), bgOf), { apply: [], skippedPdf: 1, unknown: 0 });
  });
  test('n targets: paper and image pages change, PDF pages are skipped', () => {
    assert.deepEqual(paperPlan(actionTargets(select(IDS)), bgOf), { apply: ['p1', 'p3', 'p4'], skippedPdf: 2, unknown: 0 });
  });
  test('unloaded pages are counted apart', () => {
    assert.deepEqual(paperPlan(['p1', 'x'], bgOf), { apply: ['p1'], skippedPdf: 0, unknown: 1 });
  });
  test('backgroundWithPaper', () => {
    assert.deepEqual(backgroundWithPaper(BG.p1, DOTTED_WIDE), { kind: 'paper', paper: DOTTED_WIDE });
    assert.deepEqual(backgroundWithPaper(BG.p3, DOTTED_WIDE), { kind: 'image', fileId: 'img', paper: DOTTED_WIDE });
    assert.equal(backgroundWithPaper(BG.p2, DOTTED_WIDE), null);
  });
  test('initialPaper: the first paper or image target, else the default', () => {
    assert.deepEqual(initialPaper(['p2', 'p3', 'p1'], bgOf, DEFAULTS), BLANK_LETTER);
    assert.deepEqual(initialPaper(['p2', 'p5'], bgOf, DEFAULTS), DEFAULTS);
    assert.deepEqual(initialPaper([], bgOf, DEFAULTS), DEFAULTS);
  });
});

describe("'إدراج PDF'", () => {
  test('0 selected: after the current page', () => {
    assert.equal(insertIndexAfter(IDS, actionTargets(select([], 'p2'))), 2);
  });
  test('1: after it', () => {
    assert.equal(insertIndexAfter(IDS, actionTargets(select(['p4']))), 4);
  });
  test('n: after the last', () => {
    assert.equal(insertIndexAfter(IDS, actionTargets(select(['p1', 'p3']))), 3);
  });
});

describe("'حذف'", () => {
  test('0 selected: the current page can go', () => {
    assert.equal(canDelete(IDS, actionTargets(select([]))), true);
  });
  test('1 selected', () => {
    assert.equal(canDelete(IDS, actionTargets(select(['p5']))), true);
  });
  test('n selected, not all', () => {
    assert.equal(canDelete(IDS, actionTargets(select(['p1', 'p2', 'p3', 'p4']))), true);
  });
  test('every page selected: disabled', () => {
    assert.equal(canDelete(IDS, actionTargets(select([...IDS]))), false);
  });
  test('a one-page notebook cannot delete its page', () => {
    assert.equal(canDelete(['only'], ['only']), false);
  });
  test('nothing to delete', () => {
    assert.equal(canDelete(IDS, []), false);
    assert.equal(canDelete(IDS, ['gone']), false);
    assert.equal(canDelete([], []), false);
  });
  test('currentAfterDelete', () => {
    assert.equal(currentAfterDelete(IDS, ['p1'], 'p3'), 'p3');
    assert.equal(currentAfterDelete(IDS, ['p3'], 'p3'), 'p4');
    assert.equal(currentAfterDelete(IDS, ['p3', 'p4', 'p5'], 'p3'), 'p2');
    assert.equal(currentAfterDelete(IDS, IDS, 'p3'), null);
    assert.equal(currentAfterDelete(IDS, ['p1'], null), 'p2');
  });
});

describe('actionStates', () => {
  test('normal mode: everything on', () => {
    const s = actionStates(normal());
    for (const a of PAGE_ACTIONS) assert.equal(s[a].enabled, true, a);
  });
  test('select mode, 0 selected: everything on (the current page)', () => {
    const s = actionStates(select([]));
    for (const a of PAGE_ACTIONS) assert.equal(s[a].enabled, true, a);
  });
  test('select mode, 1 selected: everything on', () => {
    const s = actionStates(select(['p2']));
    for (const a of PAGE_ACTIONS) assert.equal(s[a].enabled, true, a);
  });
  test('select mode, n selected but all pages: delete off', () => {
    const s = actionStates(select([...IDS]));
    assert.equal(s.delete.enabled, false);
    assert.equal(s.add.enabled, true);
    assert.equal(s.duplicate.enabled, true);
    assert.equal(s.paper.enabled, true);
    assert.equal(s.insertPdf.enabled, true);
  });
  test('a one-page notebook: delete off', () => {
    assert.equal(actionStates({ pageIds: ['a'], current: 'a', mode: 'normal', selected: [] }).delete.enabled, false);
  });
  test('read-only: everything off', () => {
    const s = actionStates(select(['p1']), true);
    for (const a of PAGE_ACTIONS) assert.equal(s[a].enabled, false, a);
  });
});

describe('labels', () => {
  test('delete titles follow Arabic number agreement', () => {
    assert.equal(deletePagesTitle(1, 'ar'), 'حذف صفحة واحدة؟');
    assert.equal(deletePagesTitle(2, 'ar'), 'حذف صفحتين؟');
    assert.equal(deletePagesTitle(3, 'ar'), 'حذف 3 صفحات؟');
    assert.equal(deletePagesTitle(10, 'ar'), 'حذف 10 صفحات؟');
    assert.equal(deletePagesTitle(11, 'ar'), 'حذف 11 صفحة؟');
    assert.equal(deletePagesTitle(100, 'ar'), 'حذف 100 صفحة؟');
    assert.equal(deletePagesTitle(103, 'ar'), 'حذف 103 صفحات؟');
    assert.equal(deletePagesTitle(1, 'en'), 'Delete 1 page?');
    assert.equal(deletePagesTitle(4, 'en'), 'Delete 4 pages?');
  });
  test('delete toast', () => {
    assert.equal(deletedPagesText(1, 'ar'), 'حُذفت الصفحة');
    assert.equal(deletedPagesText(2, 'ar'), 'حُذفت صفحتان');
    assert.equal(deletedPagesText(5, 'ar'), 'حُذفت 5 صفحات');
    assert.equal(deletedPagesText(12, 'ar'), 'حُذفت 12 صفحة');
    assert.equal(deletedPagesText(1, 'en'), 'Page deleted');
    assert.equal(deletedPagesText(3, 'en'), '3 pages deleted');
  });
  test('hint', () => {
    assert.equal(pagesHint(normal(), 'ar'), 'اسحب الصفحة لتغيير ترتيبها');
    assert.equal(pagesHint(select([]), 'ar'), 'اضغط على الصفحات لتحديدها');
    assert.equal(pagesHint(select(['p1']), 'ar'), 'حُددت صفحة واحدة');
    assert.equal(pagesHint(select(['p1', 'p2']), 'ar'), 'حُددت صفحتان');
    assert.equal(pagesHint(select(['p1', 'p2', 'p3']), 'ar'), 'حُددت 3 صفحات');
    assert.equal(pagesHint(select(['p1', 'gone']), 'en'), '1 page selected');
    assert.equal(pagesHint(normal(), 'ar', true), 'هذه المذكرة للقراءة فقط');
  });
});
