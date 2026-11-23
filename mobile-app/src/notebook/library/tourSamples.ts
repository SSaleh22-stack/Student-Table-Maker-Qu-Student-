/**
 * Sample course folders, folders and notebooks for the first-visit library tour (NB-T1).
 *
 * While the library tour has not been seen yet (settings.tours.library 'unseen'), the library shows
 * these in any section that is still empty, so the tour can point at real-looking cards on a brand new
 * library. They are pictures only: the library renders them with touches and screen readers off, they
 * are never saved, and they disappear as soon as the tour ends or is skipped.
 */
import { tr } from '@/lib/i18n';
import type { IndexEntry } from '@/notebook/core/model';

import type { FolderTarget } from './FolderCard';

export function sampleCourses(): FolderTarget[] {
  return [
    { kind: 'course', code: 'MATH 101', name: tr('تفاضل وتكامل 1', 'Calculus 1'), count: 4, inTimetable: true },
    { kind: 'course', code: 'PHYS 103', name: tr('فيزياء عامة', 'General physics'), count: 2, inTimetable: true },
    { kind: 'course', code: 'CS 140', name: tr('مقدمة في البرمجة', 'Intro to programming'), count: 3, inTimetable: true },
    { kind: 'course', code: 'ENG 101', name: tr('اللغة الإنجليزية', 'English'), count: 1, inTimetable: true },
  ];
}

export function sampleFolders(): FolderTarget[] {
  return [
    { kind: 'folder', id: 'tour-sample-folder-1', name: tr('مراجعة الاختبارات', 'Exam review'), count: 3 },
    { kind: 'folder', id: 'tour-sample-folder-2', name: tr('ملخصاتي', 'My summaries'), count: 5 },
    { kind: 'folder', id: 'tour-sample-folder-3', name: tr('مشاريع', 'Projects'), count: 2 },
  ];
}

const HOUR = 3600 * 1000;

/** Sample notebooks; `now` dates them a few hours and days back. */
export function sampleNotebooks(now: number): IndexEntry[] {
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString();
  const base = { thumbRev: 0, contentRev: 1, recordingCount: 0, hasPdf: false } as const;
  return [
    {
      ...base,
      id: 'tour-sample-notebook-1',
      title: tr('محاضرة 3 — المتجهات', 'Lecture 3: Vectors'),
      createdAt: at(30),
      updatedAt: at(2),
      pageCount: 6,
      recordingCount: 1,
      cover: { kind: 'paper', paper: { style: 'lined', color: 'white', size: 'a4' } },
    },
    {
      ...base,
      id: 'tour-sample-notebook-2',
      title: tr('ملزمة الفصل الثاني', 'Chapter 2 handout'),
      createdAt: at(60),
      updatedAt: at(26),
      pageCount: 14,
      hasPdf: true,
      cover: { kind: 'pdf' },
    },
    {
      ...base,
      id: 'tour-sample-notebook-3',
      title: tr('حلول التمارين', 'Exercise solutions'),
      createdAt: at(100),
      updatedAt: at(72),
      pageCount: 4,
      cover: { kind: 'paper', paper: { style: 'grid', color: 'white', size: 'a4' } },
    },
  ];
}
