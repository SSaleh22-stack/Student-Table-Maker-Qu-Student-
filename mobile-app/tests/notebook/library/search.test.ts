import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { matchesEntry, normalizeArabic, queryTokens, searchEntries } from '../../../src/notebook/core/library/search.ts';

describe('normalizeArabic', () => {
  test('alef forms, hamza carriers, taa marbuta, alef maqsura, tatweel and diacritics', () => {
    assert.equal(normalizeArabic('أحمد'), 'احمد');
    assert.equal(normalizeArabic('إسلام'), 'اسلام');
    assert.equal(normalizeArabic('آية'), 'ايه');
    assert.equal(normalizeArabic('ٱلكتاب'), 'الكتاب');
    assert.equal(normalizeArabic('مؤتمر'), 'موتمر');
    assert.equal(normalizeArabic('مسائل'), 'مسايل');
    assert.equal(normalizeArabic('مساء'), 'مسا');
    assert.equal(normalizeArabic('مدرسة'), 'مدرسه');
    assert.equal(normalizeArabic('مستشفى'), 'مستشفي');
    assert.equal(normalizeArabic('كتـــاب'), 'كتاب');
    assert.equal(normalizeArabic('مُحَاضَرَةٌ'), 'محاضره');
    assert.equal(normalizeArabic('  Physics   LAB  '), 'physics lab');
    assert.equal(normalizeArabic('محاضرة ٣ و۴'), 'محاضره 3 و4');
  });

  test('queryTokens splits normalized words', () => {
    assert.deepEqual(queryTokens('  مُحاضرة   أولى '), ['محاضره', 'اولي']);
    assert.deepEqual(queryTokens(''), []);
    assert.deepEqual(queryTokens(undefined), []);
  });
});

describe('matching', () => {
  const ctx = {
    folders: [{ id: 'f1', name: 'مراجعات', createdAt: '2026-01-01T00:00:00.000Z', order: 0 }],
    courseNames: { CS102: 'برمجة الحاسب' },
    chosen: [{ code: 'MATH101', name: 'تفاضل' }],
  };

  test('title, folder name, course name and code; every word must match', () => {
    assert.ok(matchesEntry({ title: 'المحاضرة الأولى' }, 'محاضره اولي', ctx));
    assert.ok(matchesEntry({ title: 'x', folderId: 'f1' }, 'مُراجع', ctx));
    assert.ok(matchesEntry({ title: 'x', courseCode: 'CS102' }, 'برمجه', ctx));
    assert.ok(matchesEntry({ title: 'x', courseCode: 'CS102' }, 'cs102', ctx));
    assert.ok(matchesEntry({ title: 'x', courseCode: 'MATH101' }, 'تفاضل', ctx));
    assert.ok(!matchesEntry({ title: 'المحاضرة الأولى' }, 'محاضره ثانيه', ctx));
    assert.ok(matchesEntry({ title: 'anything' }, '   ', ctx), 'empty query matches');
  });

  test('searchEntries keeps order and filters', () => {
    const list = [{ title: 'Lab 1' }, { title: 'ملاحظات' }, { title: 'lab 2' }];
    assert.deepEqual(
      searchEntries(list, 'LAB', ctx).map((e) => e.title),
      ['Lab 1', 'lab 2'],
    );
    assert.equal(searchEntries(list, '', ctx).length, 3);
  });
});
