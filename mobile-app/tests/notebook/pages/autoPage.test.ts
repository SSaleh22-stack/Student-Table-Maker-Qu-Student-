import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { blankPage } from '../../../src/notebook/core/model/paper.ts';
import type { Page, StrokeItem } from '../../../src/notebook/core/model/types.ts';
import { autoPageAfter, needsAutoPage } from '../../../src/notebook/core/pages/autoPage.ts';

const stroke = { id: 's1', kind: 'stroke' } as unknown as StrokeItem;

describe('auto page', () => {
  test('a paper last page with something on it gets a next page', () => {
    const last: Page = { ...blankPage('p1', { style: 'grid', color: 'cream', size: 'a4' }), items: [stroke] };
    assert.equal(needsAutoPage(last), true);
    const next = autoPageAfter(last, 'p2');
    assert.equal(next.id, 'p2');
    assert.deepEqual(next.items, []);
    assert.deepEqual(next.size, last.size);
    assert.deepEqual(next.background, { kind: 'paper', paper: { style: 'grid', color: 'cream', size: 'a4' } });
  });

  test('an empty last page, a PDF page or a scanned page get none', () => {
    assert.equal(needsAutoPage(blankPage('p1')), false);
    assert.equal(needsAutoPage(undefined), false);
    const pdf: Page = { id: 'p1', size: { w: 595, h: 842 }, background: { kind: 'pdf', fileId: 'f', pageIndex: 0, rotation: 0 }, items: [stroke] };
    assert.equal(needsAutoPage(pdf), false);
    const scan: Page = { ...pdf, background: { kind: 'image', fileId: 'f', paper: { style: 'blank', color: 'white', size: 'a4' } } };
    assert.equal(needsAutoPage(scan), false);
  });
});
