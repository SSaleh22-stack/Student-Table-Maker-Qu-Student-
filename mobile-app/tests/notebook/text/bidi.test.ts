import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { directedParagraphs, hasStrongDirection, paragraphDirection, splitParagraphs } from '../../../src/notebook/core/text/bidi.ts';

describe('paragraphDirection', () => {
  test('the first strong character decides', () => {
    assert.equal(paragraphDirection('مرحبا'), 'rtl');
    assert.equal(paragraphDirection('Hello'), 'ltr');
    assert.equal(paragraphDirection('Hello مرحبا'), 'ltr');
    assert.equal(paragraphDirection('مرحبا Hello'), 'rtl');
    assert.equal(paragraphDirection('3.2 تمارين'), 'rtl');
    assert.equal(paragraphDirection('  (12) - Chapter 3'), 'ltr');
    assert.equal(paragraphDirection('שלום'), 'rtl');
    assert.equal(paragraphDirection('Ölçü'), 'ltr');
    assert.equal(paragraphDirection('Привет'), 'ltr');
    assert.equal(paragraphDirection('日本語'), 'ltr');
  });

  test('neutral-only text uses the fallback', () => {
    assert.equal(paragraphDirection(''), 'rtl');
    assert.equal(paragraphDirection('', 'ltr'), 'ltr');
    assert.equal(paragraphDirection('123 + 45 = 168', 'ltr'), 'ltr');
    assert.equal(paragraphDirection('١٢٣', 'ltr'), 'ltr');
    assert.equal(paragraphDirection('😀 !?', 'ltr'), 'ltr');
    assert.equal(paragraphDirection('× ÷ → ∑', 'rtl'), 'rtl');
    assert.equal(hasStrongDirection('42%'), false);
    assert.equal(hasStrongDirection('42 x'), true);
  });

  test('Arabic marks and digits are neutral, the letter after them decides', () => {
    assert.equal(paragraphDirection('ً١ abc'), 'ltr');
    assert.equal(paragraphDirection('2024، ب', 'ltr'), 'rtl');
    assert.equal(paragraphDirection('😀 كتاب'), 'rtl');
    assert.equal(paragraphDirection('ﻻ', 'ltr'), 'rtl');
  });

  test('explicit marks and isolates', () => {
    assert.equal(paragraphDirection('‏abc'), 'rtl');
    assert.equal(paragraphDirection('‎كتاب'), 'ltr');
    assert.equal(paragraphDirection('؜abc'), 'rtl');
    // Text inside an isolate is skipped.
    assert.equal(paragraphDirection('⁦abc⁩ كتاب'), 'rtl');
    assert.equal(paragraphDirection('⁧كتاب⁩ abc'), 'ltr');
    assert.equal(paragraphDirection('⁦abc', 'rtl'), 'rtl');
  });

  test('a multi-paragraph string takes its first strong paragraph', () => {
    assert.equal(paragraphDirection('\n12\nNotes\nملاحظات'), 'ltr');
  });
});

describe('splitParagraphs', () => {
  test('every paragraph separator', () => {
    assert.deepEqual(splitParagraphs(''), ['']);
    assert.deepEqual(splitParagraphs('one'), ['one']);
    assert.deepEqual(splitParagraphs('a\nb'), ['a', 'b']);
    assert.deepEqual(splitParagraphs('a\r\nb\rc'), ['a', 'b', 'c']);
    assert.deepEqual(splitParagraphs('a b\u0085c'), ['a', 'b', 'c']);
    assert.deepEqual(splitParagraphs('a\n'), ['a', '']);
    assert.deepEqual(splitParagraphs('\n\n'), ['', '', '']);
    assert.deepEqual(splitParagraphs('a\u001Eb'), ['a', 'b']);
  });

  test('line separator U+2028 stays inside a paragraph', () => {
    assert.deepEqual(splitParagraphs('a b'), ['a b']);
  });
});

describe('directedParagraphs', () => {
  test('direction per paragraph with offsets', () => {
    const text = 'ملاحظة: راجع التمارين\nRecursion basics\r\n\n123\nآخر';
    const got = directedParagraphs(text, 'rtl');
    assert.deepEqual(
      got.map((p) => [p.text, p.dir]),
      [
        ['ملاحظة: راجع التمارين', 'rtl'],
        ['Recursion basics', 'ltr'],
        ['', 'ltr'],
        ['123', 'ltr'],
        ['آخر', 'rtl'],
      ],
    );
    for (const p of got) assert.equal(text.slice(p.start, p.start + p.text.length), p.text);
  });

  test('a leading neutral paragraph takes the fallback', () => {
    assert.deepEqual(
      directedParagraphs('42\nabc', 'rtl').map((p) => p.dir),
      ['rtl', 'ltr'],
    );
    assert.deepEqual(
      directedParagraphs('', 'ltr').map((p) => [p.text, p.dir, p.start]),
      [['', 'ltr', 0]],
    );
  });
});
