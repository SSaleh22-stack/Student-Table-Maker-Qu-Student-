import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { pdfPaths, planPdfCopies, safeFileName, type PdfCopySource } from '../../../src/notebook/core/backup/pdfCopies.ts';

const nb = (id: string, title: string, folder = '', rev = 1, createdAt = `2026-11-0${id.length}T00:00:00Z`): PdfCopySource => ({
  id,
  title,
  folder,
  rev,
  createdAt,
});

describe('safeFileName', () => {
  test('replaces characters clouds refuse and trims dots and spaces', () => {
    assert.equal(safeFileName(' Lecture 6: A/B? ', 'x'), 'Lecture 6- A-B-');
    assert.equal(safeFileName('notes...', 'x'), 'notes');
    assert.equal(safeFileName('...', 'Untitled'), 'Untitled');
    assert.equal(safeFileName('CON', 'x'), 'CON_');
  });

  test('keeps Arabic names', () => {
    assert.equal(safeFileName('محاضرة 6 — المحددات', 'x'), 'محاضرة 6 — المحددات');
  });

  test('caps long names without splitting an emoji', () => {
    const long = `${'a'.repeat(79)}😀tail`;
    const out = safeFileName(long, 'x');
    assert.equal(out, 'a'.repeat(79));
  });
});

describe('pdfPaths', () => {
  test('puts notebooks in their folder and numbers duplicate names by creation order', () => {
    const paths = pdfPaths(
      [
        nb('b2', 'Lecture', 'CS102 — Programming', 1, '2026-11-02T00:00:00Z'),
        nb('a1', 'Lecture', 'CS102 — Programming', 1, '2026-11-01T00:00:00Z'),
        nb('c3', 'Lecture', '', 1, '2026-11-03T00:00:00Z'),
        nb('d4', '', '', 1, '2026-11-04T00:00:00Z'),
      ],
      'Untitled notebook',
    );
    assert.deepEqual(paths, {
      a1: 'CS102 — Programming/Lecture.pdf',
      b2: 'CS102 — Programming/Lecture (2).pdf',
      c3: 'Lecture.pdf',
      d4: 'Untitled notebook.pdf',
    });
  });
});

describe('planPdfCopies', () => {
  test('uploads new and changed notebooks, skips unchanged ones', () => {
    const plan = planPdfCopies(
      [nb('a', 'One', '', 2), nb('bb', 'Two', '', 1), nb('ccc', 'Three', '', 1)],
      { a: { rev: 1, path: 'One.pdf' }, bb: { rev: 1, path: 'Two.pdf' } },
      'Untitled',
    );
    assert.deepEqual(
      plan.upload.map((u) => u.id),
      ['a', 'ccc'],
    );
    assert.deepEqual(plan.remove, []);
  });

  test('a renamed or moved notebook goes to its new path and the old file is removed', () => {
    const plan = planPdfCopies([nb('a', 'New name', 'Math', 1)], { a: { rev: 1, path: 'Old name.pdf' } }, 'Untitled');
    assert.deepEqual(plan.upload, [{ id: 'a', rev: 1, path: 'Math/New name.pdf' }]);
    assert.deepEqual(plan.remove, ['Old name.pdf']);
  });

  test("a deleted notebook's PDF is removed, unless another notebook now uses that name", () => {
    const plan = planPdfCopies(
      [nb('bb', 'Same', '', 1)],
      { a: { rev: 1, path: 'Same.pdf' }, c: { rev: 1, path: 'Gone.pdf' } },
      'Untitled',
    );
    assert.deepEqual(plan.remove, ['Gone.pdf']);
    assert.deepEqual(plan.upload, [{ id: 'bb', rev: 1, path: 'Same.pdf' }]);
  });
});
