import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { bytesLabel, clockLabel, countLabel, daysLeft, daysLeftCount, durationLabel, relativeTime, TRASH_DAYS } from '../../../src/notebook/core/text/labels.ts';
import type { CountKind } from '../../../src/notebook/core/text/labels.ts';

const MB = 1024 * 1024;
const GB = 1024 * MB;
const DAY = 86_400_000;
const QA = { tzOffsetMin: 180 };

describe('countLabel', () => {
  test('Arabic notebooks: 0, 1, 2, 3, 10, 11, 100 and beyond', () => {
    assert.equal(countLabel(0, 'notebook', 'ar'), 'لا توجد مذكرات');
    assert.equal(countLabel(1, 'notebook', 'ar'), 'مذكرة واحدة');
    assert.equal(countLabel(2, 'notebook', 'ar'), 'مذكرتان');
    assert.equal(countLabel(3, 'notebook', 'ar'), '3 مذكرات');
    assert.equal(countLabel(10, 'notebook', 'ar'), '10 مذكرات');
    assert.equal(countLabel(11, 'notebook', 'ar'), '11 مذكرة');
    assert.equal(countLabel(12, 'notebook', 'ar'), '12 مذكرة');
    assert.equal(countLabel(99, 'notebook', 'ar'), '99 مذكرة');
    assert.equal(countLabel(100, 'notebook', 'ar'), '100 مذكرة');
    assert.equal(countLabel(102, 'notebook', 'ar'), '102 مذكرة');
    assert.equal(countLabel(103, 'notebook', 'ar'), '103 مذكرات');
    assert.equal(countLabel(111, 'notebook', 'ar'), '111 مذكرة');
  });

  test('Arabic pages, folders and recordings', () => {
    const table: Record<Exclude<CountKind, 'notebook'>, string[]> = {
      page: ['لا توجد صفحات', 'صفحة واحدة', 'صفحتان', '3 صفحات', '11 صفحة', '100 صفحة'],
      folder: ['لا توجد مجلدات', 'مجلد واحد', 'مجلدان', '3 مجلدات', '11 مجلداً', '100 مجلد'],
      recording: ['لا توجد تسجيلات', 'تسجيل واحد', 'تسجيلان', '3 تسجيلات', '11 تسجيلاً', '100 تسجيل'],
    };
    for (const [kind, want] of Object.entries(table)) {
      const got = [0, 1, 2, 3, 11, 100].map((n) => countLabel(n, kind as CountKind, 'ar'));
      assert.deepEqual(got, want, kind);
    }
    // Figma 13 and 03 subtitles
    assert.equal(countLabel(8, 'page', 'ar'), '8 صفحات');
    assert.equal(countLabel(24, 'page', 'ar'), '24 صفحة');
    // Masculine nouns: accusative after 11..99, genitive from 100 (n % 100 decides).
    assert.equal(countLabel(99, 'folder', 'ar'), '99 مجلداً');
    assert.equal(countLabel(102, 'recording', 'ar'), '102 تسجيل');
    assert.equal(countLabel(105, 'folder', 'ar'), '105 مجلدات');
    assert.equal(countLabel(124, 'recording', 'ar'), '124 تسجيلاً');
  });

  test('English for every kind', () => {
    assert.deepEqual(
      [0, 1, 2, 3, 11, 100].map((n) => countLabel(n, 'notebook', 'en')),
      ['No notebooks', '1 notebook', '2 notebooks', '3 notebooks', '11 notebooks', '100 notebooks'],
    );
    assert.deepEqual(
      [0, 1, 2, 3, 11, 100].map((n) => countLabel(n, 'page', 'en')),
      ['No pages', '1 page', '2 pages', '3 pages', '11 pages', '100 pages'],
    );
    assert.deepEqual(
      [0, 1, 2, 3, 11, 100].map((n) => countLabel(n, 'folder', 'en')),
      ['No folders', '1 folder', '2 folders', '3 folders', '11 folders', '100 folders'],
    );
    assert.deepEqual(
      [0, 1, 2, 3, 11, 100].map((n) => countLabel(n, 'recording', 'en')),
      ['No recordings', '1 recording', '2 recordings', '3 recordings', '11 recordings', '100 recordings'],
    );
  });

  test('bad counts read as whole counts >= 0', () => {
    assert.equal(countLabel(-4, 'notebook', 'ar'), 'لا توجد مذكرات');
    assert.equal(countLabel(Number.NaN, 'page', 'en'), 'No pages');
    assert.equal(countLabel(2.9, 'page', 'ar'), 'صفحتان');
    assert.equal(countLabel(Infinity, 'page', 'en'), 'No pages');
  });
});

describe('relativeTime', () => {
  // Sunday 22 November 2026, 11:30 in Qatar (08:30 UTC).
  const now = Date.UTC(2026, 10, 22, 8, 30);

  test('today with the clock time, 12-hour, unpadded hour', () => {
    assert.equal(relativeTime(Date.UTC(2026, 10, 22, 7, 32), now, 'ar', QA), 'اليوم 10:32 ص');
    assert.equal(relativeTime(Date.UTC(2026, 10, 22, 6, 12), now, 'ar', QA), 'اليوم 9:12 ص');
    assert.equal(relativeTime(Date.UTC(2026, 10, 22, 7, 32), now, 'en', QA), 'Today 10:32 AM');
    assert.equal(relativeTime(new Date(Date.UTC(2026, 10, 22, 7, 32)).toISOString(), now, 'ar', QA), 'اليوم 10:32 ص');
  });

  test('today without the time', () => {
    assert.equal(relativeTime(now - 60_000, now, 'ar', { ...QA, time: false }), 'اليوم');
    assert.equal(relativeTime(now - 60_000, now, 'en', { ...QA, time: false }), 'Today');
  });

  test('day boundaries follow the local time zone', () => {
    // 00:10 local today (21:10 UTC the day before) is today; 23:50 local yesterday is yesterday.
    assert.equal(relativeTime(Date.UTC(2026, 10, 21, 21, 10), now, 'ar', QA), 'اليوم 12:10 ص');
    assert.equal(relativeTime(Date.UTC(2026, 10, 21, 20, 50), now, 'ar', QA), 'أمس');
    assert.equal(relativeTime(Date.UTC(2026, 10, 21, 20, 50), now, 'en', QA), 'Yesterday');
    // Afternoon today.
    const evening = Date.UTC(2026, 10, 22, 17, 0);
    assert.equal(relativeTime(Date.UTC(2026, 10, 22, 12, 5), evening, 'ar', QA), 'اليوم 3:05 م');
    assert.equal(relativeTime(Date.UTC(2026, 10, 22, 12, 5), evening, 'en', QA), 'Today 3:05 PM');
  });

  test('older dates: day and month, with the year when it differs', () => {
    assert.equal(relativeTime(Date.UTC(2026, 10, 19, 9), now, 'ar', QA), '19 نوفمبر');
    assert.equal(relativeTime(Date.UTC(2026, 10, 19, 9), now, 'en', QA), 'Nov 19');
    assert.equal(relativeTime(Date.UTC(2025, 0, 5, 9), now, 'ar', QA), '5 يناير 2025');
    assert.equal(relativeTime(Date.UTC(2025, 0, 5, 9), now, 'en', QA), 'Jan 5, 2025');
  });

  test('clock skew and bad input', () => {
    assert.equal(relativeTime(now + 5 * 60_000, now, 'ar', QA), 'اليوم 11:35 ص');
    assert.equal(relativeTime('not a date', now, 'ar', QA), '');
    assert.equal(clockLabel(Date.UTC(2026, 0, 1, 21, 0), 'ar', QA), '12:00 ص');
    assert.equal(clockLabel(Date.UTC(2026, 0, 1, 9, 0), 'en', QA), '12:00 PM');
  });
});

describe('bytesLabel', () => {
  test('Figma sizes', () => {
    assert.equal(bytesLabel(48.6 * MB, 'ar'), '48.6 ميجابايت');
    assert.equal(bytesLabel(6.2 * MB, 'ar'), '6.2 ميجابايت');
    assert.equal(bytesLabel(3.2 * MB, 'ar'), '3.2 ميجابايت');
    assert.equal(bytesLabel(1.4 * GB, 'ar'), '1.4 جيجابايت');
    assert.equal(bytesLabel(900 * MB, 'ar'), '900 ميجابايت');
    assert.equal(bytesLabel(38 * GB, 'ar'), '38 جيجابايت');
    assert.equal(bytesLabel(48.6 * MB, 'en'), '48.6 MB');
    assert.equal(bytesLabel(1.4 * GB, 'en'), '1.4 GB');
  });

  test('small values and unit changes', () => {
    assert.equal(bytesLabel(0, 'ar'), '0 بايت');
    assert.equal(bytesLabel(-5, 'en'), '0 B');
    assert.equal(bytesLabel(512, 'en'), '512 B');
    assert.equal(bytesLabel(1536, 'en'), '1.5 KB');
    assert.equal(bytesLabel(2 * MB, 'en'), '2 MB');
    assert.equal(bytesLabel(1010 * MB, 'en'), '1 GB');
    assert.equal(bytesLabel(250 * GB, 'en'), '250 GB');
    assert.equal(bytesLabel(2048 * GB, 'ar'), '2 تيرابايت');
  });
});

describe('durationLabel', () => {
  test('minutes and seconds, hours when needed', () => {
    assert.equal(durationLabel(0), '00:00');
    assert.equal(durationLabel(5_400), '00:05');
    assert.equal(durationLabel((8 * 60 + 14) * 1000), '08:14');
    assert.equal(durationLabel((47 * 60 + 32) * 1000 + 999), '47:32');
    assert.equal(durationLabel((31 * 60 + 8) * 1000), '31:08');
    assert.equal(durationLabel((3600 + 2 * 60 + 5) * 1000), '1:02:05');
    assert.equal(durationLabel(12 * 3600 * 1000), '12:00:00');
    assert.equal(durationLabel(-10), '00:00');
    assert.equal(durationLabel(Number.NaN), '00:00');
  });
});

describe('daysLeft', () => {
  const deletedAt = Date.UTC(2026, 10, 1, 12);

  test('Figma 16 texts', () => {
    assert.equal(daysLeft(deletedAt, deletedAt + 3 * DAY, 'ar'), 'يتبقى 27 يوماً');
    assert.equal(daysLeft(deletedAt, deletedAt + 18 * DAY, 'ar'), 'يتبقى 12 يوماً');
    assert.equal(daysLeft(deletedAt, deletedAt + 28 * DAY, 'ar'), 'يتبقى يومان');
  });

  test('Arabic agreement and the last day', () => {
    assert.equal(daysLeft(deletedAt, deletedAt + 29 * DAY, 'ar'), 'يتبقى يوم واحد');
    assert.equal(daysLeft(deletedAt, deletedAt + 25 * DAY, 'ar'), 'يتبقى 5 أيام');
    assert.equal(daysLeft(deletedAt, deletedAt + 20 * DAY, 'ar'), 'يتبقى 10 أيام');
    assert.equal(daysLeft(deletedAt, deletedAt + 30 * DAY, 'ar'), 'يُحذف اليوم');
    assert.equal(daysLeft(deletedAt, deletedAt + 40 * DAY, 'ar'), 'يُحذف اليوم');
  });

  test('English', () => {
    assert.equal(daysLeft(deletedAt, deletedAt + 3 * DAY, 'en'), '27 days left');
    assert.equal(daysLeft(deletedAt, deletedAt + 29 * DAY, 'en'), '1 day left');
    assert.equal(daysLeft(deletedAt, deletedAt + 30 * DAY, 'en'), 'Deleted today');
  });

  test('counts round up and stay within the retention', () => {
    assert.equal(TRASH_DAYS, 30);
    assert.equal(daysLeftCount(deletedAt, deletedAt), 30);
    assert.equal(daysLeftCount(deletedAt, deletedAt + 1), 30);
    assert.equal(daysLeftCount(deletedAt, deletedAt + DAY), 29);
    assert.equal(daysLeftCount(deletedAt, deletedAt - 5 * DAY), 30);
    assert.equal(daysLeftCount(new Date(deletedAt).toISOString(), deletedAt + 29.5 * DAY), 1);
    assert.equal(daysLeftCount('bad', deletedAt), 0);
  });
});
