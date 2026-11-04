/**
 * Made-up sample sections for trying the app without a student account
 * ("تجربة التطبيق ببيانات تجريبية" on the import screen; also used by store reviewers).
 */
import type { Course } from './types';

const c = (
  code: string,
  name: string,
  section: string,
  days: string[],
  startTime: string,
  endTime: string,
  extra: Partial<Course> = {},
): Course => ({
  id: `sample-${code}-${section}`,
  code,
  name,
  section,
  hours: '3',
  days,
  startTime,
  endTime,
  status: 'open',
  classType: 'theoretical',
  activity: 'نظري',
  ...extra,
});

export const SAMPLE_COURSES: Course[] = [
  c('CS101', 'مقدمة في علوم الحاسب', '01', ['Sun', 'Tue'], '08:00', '09:30', {
    location: 'مبنى 5 · 201',
    instructor: 'د. أحمد علي',
    finalExam: { day: '', startTime: '', endTime: '', date: '2' },
  }),
  c('CS101', 'مقدمة في علوم الحاسب', '02', ['Mon', 'Wed'], '08:00', '09:30', {
    location: 'مبنى 5 · 204',
    instructor: 'د. أحمد علي',
    finalExam: { day: '', startTime: '', endTime: '', date: '2' },
  }),
  c('CS101', 'مقدمة في علوم الحاسب', '03', ['Sun', 'Tue'], '10:00', '11:30', {
    location: 'مبنى 5 · 110',
    instructor: 'د. محمد حسن',
    finalExam: { day: '', startTime: '', endTime: '', date: '2' },
  }),
  c('CS101', 'مقدمة في علوم الحاسب', '51', ['Mon'], '14:00', '15:40', {
    hours: '0',
    classType: 'practical',
    activity: 'عملي',
    location: 'معمل 5 · 103',
    instructor: 'أ. سعد العتيبي',
  }),
  c('CS101', 'مقدمة في علوم الحاسب', '52', ['Wed'], '08:00', '09:40', {
    hours: '0',
    classType: 'practical',
    activity: 'عملي',
    location: 'معمل 5 · 104',
    instructor: 'أ. سعد العتيبي',
  }),
  c('MATH201', 'التفاضل والتكامل 2', '03', ['Sun', 'Wed'], '10:00', '11:30', {
    location: 'مبنى 3 · 105',
    instructor: 'د. سارة الأحمد',
    finalExam: { day: '', startTime: '', endTime: '', date: '4' },
  }),
  c('MATH201', 'التفاضل والتكامل 2', '04', ['Mon', 'Thu'], '12:00', '13:30', {
    location: 'مبنى 3 · 105',
    instructor: 'د. سارة الأحمد',
    finalExam: { day: '', startTime: '', endTime: '', date: '4' },
  }),
  c('STAT201', 'الاحتمالات والإحصاء', '01', ['Sun', 'Wed'], '10:00', '11:30', {
    location: 'مبنى 3 · 210',
    instructor: 'د. ليلى سعد',
    finalExam: { day: '', startTime: '', endTime: '', date: '3' },
  }),
  c('STAT201', 'الاحتمالات والإحصاء', '02', ['Mon', 'Thu'], '12:00', '13:30', {
    location: 'مبنى 3 · 210',
    instructor: 'د. ليلى سعد',
    status: 'closed',
  }),
  c('ISL101', 'الثقافة الإسلامية 1', '01', ['Mon', 'Thu'], '10:00', '11:00', {
    hours: '2',
    location: 'مبنى 1 · 12',
    instructor: 'د. عبدالله صالح',
    finalExam: { day: '', startTime: '', endTime: '', date: '1' },
  }),
  c('PHYS101', 'الفيزياء العامة 1', '07', ['Mon', 'Wed'], '12:00', '13:30', {
    hours: '4',
    location: 'مبنى 7 · 110',
    instructor: 'د. خالد فهد',
    finalExam: { day: '', startTime: '', endTime: '', date: '3' },
  }),
  c('PHYS101', 'الفيزياء العامة 1', '08', ['Sun', 'Tue'], '12:00', '13:30', {
    hours: '4',
    location: 'مبنى 7 · 112',
    instructor: 'د. خالد فهد',
    finalExam: { day: '', startTime: '', endTime: '', date: '3' },
  }),
  c('PHYS101', 'الفيزياء العامة 1', '71', ['Tue'], '14:00', '15:40', {
    hours: '0',
    classType: 'exercise',
    activity: 'تدريب',
    location: 'مبنى 7 · 008',
    instructor: 'أ. نايف الحربي',
  }),
  c('ENG101', 'مهارات اللغة الإنجليزية', '01', ['Mon', 'Wed'], '14:00', '15:30', {
    location: 'مبنى 2 · 014',
    instructor: 'د. جون سميث',
    finalExam: { day: '', startTime: '', endTime: '', date: '5' },
  }),
  c('ENG101', 'مهارات اللغة الإنجليزية', '02', ['Sun', 'Thu'], '14:00', '15:30', {
    location: 'مبنى 2 · 014',
    instructor: 'د. جون سميث',
    finalExam: { day: '', startTime: '', endTime: '', date: '5' },
  }),
  c('ENG101', 'مهارات اللغة الإنجليزية', '03', ['Tue'], '12:00', '13:30', {
    location: 'مبنى 2 · 016',
    instructor: 'د. جون سميث',
    finalExam: { day: '', startTime: '', endTime: '', date: '5' },
  }),
  c('GP499', 'مشروع التخرج', '01', [], '', '', { classType: undefined, activity: 'مشروع' }),
];
