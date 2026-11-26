import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { addDays, isNoClassDay, noClassRanges, upcomingLectureEnds } from '../../src/lib/calendar/classDays.ts';
import type { CalendarEvent, CalendarSection } from '../../src/lib/calendar/parse.ts';

const ev = (title: string, start: string, end?: string, holiday = false): CalendarEvent => ({
  title,
  start: { weekday: '', hijri: '', iso: start },
  end: end ? { weekday: '', hijri: '', iso: end } : undefined,
  holiday,
});

/** The first term of 1448 as the university page lists it (trimmed). */
const term: CalendarSection = {
  title: 'التقويم الأكاديمي للفصل الدراسي الأول (481)',
  kind: 'undergrad',
  events: [
    ev('بداية الدراسة للفصل الدراسي الأول (481)', '2026-08-23'),
    ev('إجازة اليوم الوطني', '2026-09-23', '2026-09-24', true),
    ev('إجازة الخريف بنهاية دوام يوم الخميس', '2026-11-19', undefined, true),
    ev('استئناف الدراسة بعد إجازة الخريف', '2026-11-29'),
    ev('الاختبارات النهائية للفصل الدراسي الأول (481)', '2026-12-27', '2027-01-07'),
    ev('إجازة منتصف العام الدراسي بنهاية دوام يوم الخميس', '2027-01-07', undefined, true),
    ev('بداية الدراسة للفصل الدراسي الثاني (482)', '2027-01-17'),
  ],
};

describe('noClassRanges', () => {
  const ranges = noClassRanges([term]);

  test('a holiday with an end date covers every day of it', () => {
    assert.equal(isNoClassDay('2026-09-22', ranges), false);
    assert.equal(isNoClassDay('2026-09-23', ranges), true);
    assert.equal(isNoClassDay('2026-09-24', ranges), true);
    assert.equal(isNoClassDay('2026-09-25', ranges), false);
  });

  test('a holiday from the end of Thursday keeps Thursday and lasts until studies resume', () => {
    assert.equal(isNoClassDay('2026-11-19', ranges), false);
    assert.equal(isNoClassDay('2026-11-20', ranges), true);
    assert.equal(isNoClassDay('2026-11-26', ranges), true);
    assert.equal(isNoClassDay('2026-11-28', ranges), true);
    assert.equal(isNoClassDay('2026-11-29', ranges), false);
  });

  test('final exams and the mid-year break have no lectures until the next term starts', () => {
    assert.equal(isNoClassDay('2026-12-24', ranges), false);
    assert.equal(isNoClassDay('2026-12-27', ranges), true);
    assert.equal(isNoClassDay('2027-01-12', ranges), true);
    assert.equal(isNoClassDay('2027-01-16', ranges), true);
    assert.equal(isNoClassDay('2027-01-17', ranges), false);
  });

  test('without a known next term, classes stay over after the final exams', () => {
    const only = noClassRanges([{ ...term, events: term.events.slice(0, 5) }]);
    assert.equal(isNoClassDay('2027-03-01', only), true);
  });

  test('graduate tables are ignored when undergraduate ones exist', () => {
    const grad: CalendarSection = { title: 'grad', kind: 'grad', events: [ev('إجازة', '2026-10-05', undefined, true)] };
    assert.equal(isNoClassDay('2026-10-05', noClassRanges([term, grad])), false);
    assert.equal(isNoClassDay('2026-10-05', noClassRanges([grad])), true);
  });
});

describe('upcomingLectureEnds', () => {
  const lectures = [
    { day: 'Sun', endMinutes: 9 * 60 + 50, code: 'CS102', name: 'Programming' },
    { day: 'Sun', endMinutes: 9 * 60 + 50, code: 'CS102', name: 'Programming' },
    { day: 'Mon', endMinutes: 11 * 60, code: 'MATH201', name: 'Calculus' },
  ];

  test('lists the coming ends in order, once each, after now', () => {
    // Sunday 29 November 2026, 10:00: Sunday's CS102 already ended.
    const now = new Date(2026, 10, 29, 10, 0);
    const ends = upcomingLectureEnds(lectures, now, 7, []);
    assert.deepEqual(
      ends.map((e) => [e.code, e.at.getDate(), e.at.getHours(), e.at.getMinutes()]),
      [
        ['MATH201', 30, 11, 0],
        ['CS102', 6, 9, 50],
      ],
    );
  });

  test('skips days without lectures', () => {
    const now = new Date(2026, 10, 26, 8, 0);
    const ends = upcomingLectureEnds(lectures, now, 7, noClassRanges([term]));
    // Sunday 29 November is the first day back after the autumn break.
    assert.deepEqual(ends.map((e) => e.at.getDate()), [29, 30]);
  });

  test('addDays crosses months', () => {
    assert.equal(addDays('2026-11-30', 1), '2026-12-01');
    assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  });
});
