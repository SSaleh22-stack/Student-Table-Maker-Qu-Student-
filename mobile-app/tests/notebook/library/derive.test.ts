import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  courseFolders,
  entryLocation,
  folderInfos,
  listEntries,
  SECTION_LIMIT,
  sections,
  sortEntries,
  trashDaysLeft,
  trashExpired,
  updateCourseNames,
  upsertEntry,
} from '../../../src/notebook/core/library/derive.ts';
import { emptyIndex } from '../../../src/notebook/core/model/index.ts';
import type { IndexEntry, IndexFile } from '../../../src/notebook/core/model/index.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-23T12:00:00.000Z');
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function entry(id: string, extra?: Partial<IndexEntry>): IndexEntry {
  return {
    id,
    title: id,
    createdAt: ago(10),
    updatedAt: ago(1),
    pageCount: 1,
    recordingCount: 0,
    hasPdf: false,
    cover: { kind: 'paper', paper: { style: 'lined', color: 'white', size: 'a4' } },
    thumbRev: 0,
    contentRev: 1,
    ...extra,
  };
}

function index(entries: IndexEntry[], extra?: Partial<IndexFile>): IndexFile {
  return { ...emptyIndex(), entries, ...extra };
}

describe('courseFolders', () => {
  test('chosen courses are inTimetable; codes used but not chosen are orphans named from courseNames', () => {
    const f = index(
      [
        entry('a', { courseCode: 'CS102' }),
        entry('b', { courseCode: 'CS102' }),
        entry('c', { courseCode: 'MATH101' }),
        entry('d', { courseCode: 'PHYS201' }),
        entry('e', { courseCode: 'HIST100', deletedAt: ago(1) }),
        entry('f', { courseCode: 'CS102', folderId: 'fold' }),
      ],
      { courseNames: { MATH101: 'تفاضل وتكامل', CS102: 'old name' }, folders: [{ id: 'fold', name: 'F', createdAt: ago(5), order: 0 }] },
    );
    const out = courseFolders(
      [
        { code: 'CS102', name: 'برمجة ٢' },
        { code: 'ARAB101', name: 'لغة عربية' },
      ],
      f,
    );
    assert.deepEqual(out, [
      { code: 'CS102', name: 'برمجة ٢', inTimetable: true, count: 2 },
      { code: 'ARAB101', name: 'لغة عربية', inTimetable: true, count: 0 },
      // Orphans sorted by name with Arabic collation (Arabic script before Latin).
      { code: 'MATH101', name: 'تفاضل وتكامل', inTimetable: false, count: 1 },
      { code: 'PHYS201', name: 'PHYS201', inTimetable: false, count: 1 },
    ]);
  });

  test('a folderId of a deleted folder counts as unfiled (or its course)', () => {
    const f = index([entry('a', { folderId: 'ghost' }), entry('b', { folderId: 'ghost', courseCode: 'X' })]);
    assert.deepEqual(entryLocation(f.entries[0], f.folders), { kind: 'unfiled' });
    assert.deepEqual(entryLocation(f.entries[1], f.folders), { kind: 'course', code: 'X' });
  });

  test('updateCourseNames records chosen names and returns the same object when unchanged', () => {
    const f = index([], { courseNames: { A: 'a' } });
    const g = updateCourseNames(f, [
      { code: 'A', name: 'a' },
      { code: 'B', name: ' بي ' },
      { code: '', name: 'x' },
    ]);
    assert.deepEqual(g.courseNames, { A: 'a', B: 'بي' });
    assert.equal(updateCourseNames(g, [{ code: 'B', name: 'بي' }]), g);
  });
});

describe('sorting and sections', () => {
  test('sortEntries: updated, name (Arabic collation), created', () => {
    const list = [
      entry('1', { title: 'ب', updatedAt: ago(3), createdAt: ago(1) }),
      entry('2', { title: 'أ', updatedAt: ago(1), createdAt: ago(9) }),
      entry('3', { title: 'ت', updatedAt: ago(2), createdAt: ago(5) }),
    ];
    assert.deepEqual(
      sortEntries(list, 'updated').map((e) => e.id),
      ['2', '3', '1'],
    );
    assert.deepEqual(
      sortEntries(list, 'name').map((e) => e.id),
      ['2', '1', '3'],
    );
    assert.deepEqual(
      sortEntries(list, 'created').map((e) => e.id),
      ['1', '3', '2'],
    );
  });

  test('sections: courses, then my folders, then unfiled, each capped at 4 with a total', () => {
    const folders = Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, name: `مجلد ${i}`, createdAt: ago(20 - i), order: i }));
    const entries = [
      ...Array.from({ length: 7 }, (_, i) => entry(`u${i}`, { updatedAt: ago(i) })),
      entry('in0', { folderId: 'f0' }),
      entry('in1', { folderId: 'f0', deletedAt: ago(1) }),
      entry('c', { courseCode: 'CS1' }),
    ];
    const f = index(entries, { folders });
    const courses = courseFolders(
      Array.from({ length: 5 }, (_, i) => ({ code: `CS${i}`, name: `C${i}` })),
      f,
    );
    const s = sections(f, courses, 'updated');
    assert.equal(s.courses.items.length, SECTION_LIMIT);
    assert.equal(s.courses.total, 5);
    assert.equal(s.mine.items.length, 4);
    assert.equal(s.mine.total, 6);
    assert.equal(s.mine.items[0].id, 'f0', 'the folder with the latest edit first');
    assert.equal(s.mine.items[0].count, 1, 'deleted notebooks are not counted');
    assert.deepEqual(
      s.unfiled.items.map((e) => e.id),
      ['u0', 'u1', 'u2', 'u3'],
    );
    assert.equal(s.unfiled.total, 7);
    assert.deepEqual(s.results, []);
    assert.deepEqual(
      folderInfos(f, 'created').map((x) => x.id),
      ['f0', 'f1', 'f2', 'f3', 'f4', 'f5'],
    );
  });

  test('sections with a query keep matching folders, courses and notebooks', () => {
    const f = index([entry('n1', { title: 'ملاحظات الفيزياء', courseCode: 'PHYS' }), entry('n2', { title: 'Lab report', folderId: 'f1' }), entry('n3', { title: 'غير ذلك' })], {
      folders: [
        { id: 'f1', name: 'مختبر', createdAt: ago(3), order: 0 },
        { id: 'f2', name: 'الفيزياء', createdAt: ago(2), order: 1 },
      ],
    });
    const courses = courseFolders([{ code: 'PHYS', name: 'فيزياء عامة' }], f);
    const s = sections(f, courses, 'updated', ' الفيزياء ');
    assert.equal(s.query, 'الفيزياء');
    assert.deepEqual(
      s.courses.items.map((c) => c.code),
      ['PHYS'],
    );
    assert.deepEqual(
      s.mine.items.map((x) => x.id),
      ['f2'],
    );
    assert.deepEqual(s.unfiled.items, []);
    assert.deepEqual(
      s.results.map((e) => e.id),
      ['n1'],
    );
    const lab = sections(f, courses, 'updated', 'lab');
    assert.deepEqual(
      lab.mine.items.map((x) => x.id),
      ['f1'],
    );
  });

  test('listEntries by location, deleted and all', () => {
    const f = index([entry('a', { folderId: 'f' }), entry('b'), entry('c', { deletedAt: ago(2) }), entry('d', { deletedAt: ago(1) }), entry('e', { courseCode: 'K' })], {
      folders: [{ id: 'f', name: 'F', createdAt: ago(1), order: 0 }],
    });
    assert.deepEqual(
      listEntries(f, { kind: 'folder', id: 'f' }, 'updated').map((e) => e.id),
      ['a'],
    );
    assert.deepEqual(
      listEntries(f, { kind: 'unfiled' }, 'updated').map((e) => e.id),
      ['b'],
    );
    assert.deepEqual(
      listEntries(f, { kind: 'course', code: 'K' }, 'updated').map((e) => e.id),
      ['e'],
    );
    assert.deepEqual(
      listEntries(f, 'deleted', 'updated').map((e) => e.id),
      ['d', 'c'],
    );
    assert.equal(listEntries(f, 'all', 'name').length, 3);
  });
});

describe('trash and entries', () => {
  test('trashExpired at 30 days; trashDaysLeft counts down', () => {
    const f = index([entry('old', { deletedAt: ago(30) }), entry('new', { deletedAt: ago(29.5) }), entry('live')]);
    assert.deepEqual(trashExpired(f, NOW), ['old']);
    assert.equal(trashDaysLeft({ deletedAt: ago(0) }, NOW), 30);
    assert.equal(trashDaysLeft({ deletedAt: ago(29.5) }, NOW), 1);
    assert.equal(trashDaysLeft({ deletedAt: ago(40) }, NOW), 0);
  });

  test('upsertEntry keeps the store-owned fields and returns f when nothing changed', () => {
    const f = index([entry('a', { thumbRev: 4, needsThumb: true, bytes: 99, importing: { done: 1, total: 5 }, folderId: 'x' })]);
    const g = upsertEntry(f, entry('a', { title: 'new' }));
    const e = g.entries[0];
    assert.equal(e.title, 'new');
    assert.equal(e.thumbRev, 4);
    assert.equal(e.needsThumb, true);
    assert.equal(e.bytes, 99);
    assert.deepEqual(e.importing, { done: 1, total: 5 });
    assert.equal(e.folderId, undefined, 'location comes from the new entry');
    assert.equal(upsertEntry(g, entry('a', { title: 'new' })), g);
    assert.equal(upsertEntry(g, entry('b')).entries.length, 2);
  });
});
