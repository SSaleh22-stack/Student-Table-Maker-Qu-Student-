/**
 * Copy of the academic calendar read from https://www.qu.edu.sa/academic-calendar/ on
 * 28 October 2026. Used until the app can read the live page (offline, first launch, web).
 * Regenerate it by running the parser on the page again.
 */
import type { CalendarSection } from './parse';

export const CALENDAR_SNAPSHOT_DATE = '2026-10-28';

export const CALENDAR_SNAPSHOT: CalendarSection[] = [
  {
    title: 'التقويم الأكاديمي للفصل الدراسي الأول (481) من العام الجامعي 1448–1449هـ — المرحلة الجامعية',
    kind: 'undergrad',
    imageUrl: 'https://www.qu.edu.sa/wp-content/uploads/2026/08/REG-481-v1.jpeg',
    events: [
      {
        title:
          'تأجيل الفصل الدراسي الأول (481) للنظام الفصلي، وتأجيل السنة الدراسية للعام الجامعي 1448/1449هـ للنظام السنوي',
        start: {
          weekday: 'الأحد',
          hijri: '1448/03/03',
          iso: '2026-08-16',
        },
        end: {
          weekday: 'السبت',
          hijri: '1448/03/09',
          iso: '2026-08-22',
        },
        holiday: false,
      },
      {
        title: 'بداية الدراسة للفصل الدراسي الأول (481) من العام الجامعي 1448/1449هـ',
        start: {
          weekday: 'الأحد',
          hijri: '1448/03/10',
          iso: '2026-08-23',
        },
        holiday: false,
      },
      {
        title:
          'الاعتذار عن الفصل الدراسي الأول (481) للنظام الفصلي بدون تقدير، والانسحاب من الجامعة للنظام الفصلي بدون تقدير',
        start: {
          weekday: 'الأحد',
          hijri: '1448/04/09',
          iso: '2026-09-20',
        },
        end: {
          weekday: 'الأحد',
          hijri: '1448/07/04',
          iso: '2026-12-13',
        },
        holiday: false,
      },
      {
        title:
          'الاعتذار عن السنة الدراسية 1448هـ للنظام السنوي بدون تقدير، والانسحاب من الجامعة للنظام السنوي بدون تقدير',
        start: {
          weekday: 'الأحد',
          hijri: '1448/04/09',
          iso: '2026-09-20',
        },
        end: {
          weekday: 'الأحد',
          hijri: '1448/12/17',
          iso: '2027-05-23',
        },
        holiday: false,
      },
      {
        title: 'الانسحاب من مقرر للنظام الفصلي',
        start: {
          weekday: 'الأحد',
          hijri: '1448/04/16',
          iso: '2026-09-27',
        },
        end: {
          weekday: 'السبت',
          hijri: '1448/06/11',
          iso: '2026-11-21',
        },
        holiday: false,
      },
      {
        title: 'إجازة اليوم الوطني',
        start: {
          weekday: 'الأربعاء',
          hijri: '1448/04/12',
          iso: '2026-09-23',
        },
        end: {
          weekday: 'الخميس',
          hijri: '1448/04/13',
          iso: '2026-09-24',
        },
        holiday: true,
      },
      {
        title: 'إجازة الخريف بنهاية دوام يوم الخميس',
        start: {
          weekday: 'الخميس',
          hijri: '1448/06/09',
          iso: '2026-11-19',
        },
        holiday: true,
      },
      {
        title: 'استئناف الدراسة بعد إجازة الخريف',
        start: {
          weekday: 'الأحد',
          hijri: '1448/06/19',
          iso: '2026-11-29',
        },
        holiday: false,
      },
      {
        title: 'التحويل من داخل الجامعة (تغيير التخصص والمقر) للفصل الدراسي الثاني (482)',
        start: {
          weekday: 'السبت',
          hijri: '1448/07/10',
          iso: '2026-12-19',
        },
        end: {
          weekday: 'السبت',
          hijri: '1448/08/01',
          iso: '2027-01-09',
        },
        holiday: false,
      },
      {
        title: 'التحويل من خارج الجامعة إلى جامعة القصيم للفصل الدراسي الثاني (482)',
        start: {
          weekday: 'الأربعاء',
          hijri: '1448/07/28',
          iso: '2027-01-06',
        },
        end: {
          weekday: 'الثلاثاء',
          hijri: '1448/08/04',
          iso: '2027-01-12',
        },
        holiday: false,
      },
      {
        title: 'الاختبارات النهائية للفصل الدراسي الأول (481)',
        start: {
          weekday: 'الأحد',
          hijri: '1448/07/18',
          iso: '2026-12-27',
        },
        end: {
          weekday: 'الخميس',
          hijri: '1448/07/29',
          iso: '2027-01-07',
        },
        holiday: false,
      },
      {
        title: 'آخر موعد لرصد الدرجات للفصل الدراسي الأول (481)',
        start: {
          weekday: 'السبت',
          hijri: '1448/08/01',
          iso: '2027-01-09',
        },
        holiday: false,
      },
      {
        title: 'حساب المعدل التراكمي للفصل الدراسي الأول (481)',
        start: {
          weekday: 'الاثنين',
          hijri: '1448/08/03',
          iso: '2027-01-11',
        },
        holiday: false,
      },
      {
        title: 'إجازة منتصف العام الدراسي بنهاية دوام يوم الخميس',
        start: {
          weekday: 'الخميس',
          hijri: '1448/07/29',
          iso: '2027-01-07',
        },
        holiday: true,
      },
      {
        title: 'بداية الدراسة للفصل الدراسي الثاني (482)',
        start: {
          weekday: 'الأحد',
          hijri: '1448/08/09',
          iso: '2027-01-17',
        },
        holiday: false,
      },
    ],
  },
  {
    title: 'التقويم الأكاديمي لبرامج الدراسات العليا — الفصل الدراسي الأول 1448هـ',
    kind: 'grad',
    imageUrl: 'https://www.qu.edu.sa/wp-content/uploads/2026/08/GS-481-v4-scaled.jpg',
    events: [
      {
        title: 'طلب تقديم الفرص الإضافية للفصل (481)',
        start: {
          weekday: 'الأحد',
          hijri: '1447/09/05',
          iso: '2026-02-22',
        },
        end: {
          weekday: 'السبت',
          hijri: '1448/04/01',
          iso: '2026-09-12',
        },
        holiday: false,
      },
      {
        title: 'تأجيل الفصل الدراسي',
        start: {
          weekday: 'الأحد',
          hijri: '1448/03/03',
          iso: '2026-08-16',
        },
        end: {
          weekday: 'السبت',
          hijri: '1448/03/16',
          iso: '2026-08-29',
        },
        holiday: false,
      },
      {
        title: 'تسجيل المقررات',
        start: {
          weekday: 'الثلاثاء',
          hijri: '1448/03/05',
          iso: '2026-08-18',
        },
        end: {
          weekday: 'السبت',
          hijri: '1448/03/16',
          iso: '2026-08-29',
        },
        holiday: false,
      },
      {
        title: 'تخصيص الطلاب بالمسارات',
        start: {
          weekday: 'الأحد',
          hijri: '1448/03/10',
          iso: '2026-08-23',
        },
        end: {
          weekday: 'الخميس',
          hijri: '1448/03/21',
          iso: '2026-09-03',
        },
        holiday: false,
      },
      {
        title: 'بداية الدراسة للفصل الدراسي الأول (481) من العام الجامعي 1449/1448هـ',
        start: {
          weekday: 'الأحد',
          hijri: '1448/03/10',
          iso: '2026-08-23',
        },
        holiday: false,
      },
      {
        title: 'حذف الفصل الدراسي (الاعتذار)',
        start: {
          weekday: 'الأحد',
          hijri: '1448/03/17',
          iso: '2026-08-30',
        },
        end: {
          weekday: 'الخميس',
          hijri: '1448/06/02',
          iso: '2026-11-12',
        },
        holiday: false,
      },
      {
        title: 'آخر موعد لرفع أسماء الطلاب المنقطعين',
        start: {
          weekday: 'الخميس',
          hijri: '1448/04/06',
          iso: '2026-09-17',
        },
        holiday: false,
      },
      {
        title: 'آخر موعد لإسناد الإرشاد الأكاديمي للطلاب',
        start: {
          weekday: 'الخميس',
          hijri: '1448/04/06',
          iso: '2026-09-17',
        },
        holiday: false,
      },
      {
        title: 'إجازة اليوم الوطني',
        start: {
          weekday: 'الأربعاء',
          hijri: '1448/04/12',
          iso: '2026-09-23',
        },
        end: {
          weekday: 'الخميس',
          hijri: '1448/04/13',
          iso: '2026-09-24',
        },
        holiday: true,
      },
      {
        title: 'إجازة الخريف بنهاية دوام يوم الخميس',
        start: {
          weekday: 'الخميس',
          hijri: '1448/06/09',
          iso: '2026-11-19',
        },
        end: {
          weekday: 'السبت',
          hijri: '1448/06/18',
          iso: '2026-11-28',
        },
        holiday: true,
      },
      {
        title: 'الاختبارات النهائية ورصد الدرجات',
        start: {
          weekday: 'الأحد',
          hijri: '1448/07/11',
          iso: '2026-12-20',
        },
        end: {
          weekday: 'السبت',
          hijri: '1448/08/01',
          iso: '2027-01-09',
        },
        holiday: false,
      },
      {
        title: 'إجازة منتصف العام الدراسي بنهاية دوام يوم الخميس',
        start: {
          weekday: 'الخميس',
          hijri: '1448/07/29',
          iso: '2027-01-07',
        },
        holiday: true,
      },
      {
        title: 'إغلاق الفصل وحساب المعدل',
        start: {
          weekday: 'الأحد',
          hijri: '1448/08/02',
          iso: '2027-01-10',
        },
        holiday: false,
      },
      {
        title: 'بداية الدراسة للفصل الدراسي الثاني (482)',
        start: {
          weekday: 'الأحد',
          hijri: '1448/08/09',
          iso: '2027-01-17',
        },
        holiday: false,
      },
    ],
  },
];
