/**
 * The app's first-time tours, drawn with the notebook's tour overlay (spotlight + card):
 *
 * - HomeTour (home tab, first launch, after the opening animation):
 *   1. 'الاستيراد' — bring the offered courses in from MyQU;
 *   2. 'جدولي'    — pick sections and build the timetable.
 * - TasksTour (tasks tab, first visit): the day's summary, the filters, the new-task button.
 *
 * Steps whose target is not on screen are dropped (the tasks summary only shows once there are
 * tasks). Finishing or skipping saves the flag (src/lib/appTours.ts); a tour that found nothing
 * tries again next time.
 */
import { useIsFocused } from 'expo-router';

import { setAppTourFlag, useAppTour, type AppTourName } from '@/lib/appTours';
import { tr } from '@/lib/i18n';
import { TOUR_TARGETS } from '@/notebook/contracts/tours';
import type { TourStepDef } from '@/notebook/tours/stepText';
import { TourOverlay, type TourResult } from '@/notebook/tours/TourOverlay';

const HOME_STEPS: readonly TourStepDef[] = [
  {
    key: 'app.import',
    targets: [TOUR_TARGETS.appImport],
    title: () => tr('استورد مقرراتك', 'Import your courses'),
    body: () =>
      tr(
        'ابدأ من هنا: سجّل الدخول إلى بوابة MyQU داخل التطبيق، وستُجلب المقررات المطروحة لك تلقائياً.',
        'Start here: sign in to the MyQU portal inside the app and your offered courses come in automatically.',
      ),
    prefer: 'below',
    pad: 8,
    radius: 22,
  },
  {
    key: 'app.timetable',
    targets: [TOUR_TARGETS.appTimetable],
    title: () => tr('اصنع جدولك', 'Build your timetable'),
    body: () =>
      tr(
        'اختر شعبة لكل مقرر وشاهد جدولك يتكوّن مباشرة، مع تنبيه عند تعارض المواعيد. يمكنك تصديره صورة أو PDF.',
        'Pick a section for each course and watch your timetable build live, with a warning when times clash. Export it as an image or PDF.',
      ),
    prefer: 'below',
    pad: 8,
    radius: 22,
  },
];

const TASKS_STEPS: readonly TourStepDef[] = [
  {
    key: 'tasks.summary',
    targets: [TOUR_TARGETS.tasksSummary],
    title: () => tr('يومك في لمحة', 'Your day at a glance'),
    body: () => tr('كم أنجزت من مهام اليوم، ومتى يرنّ التذكير القادم.', "How many of today's tasks are done, and when the next reminder rings."),
    prefer: 'below',
    pad: 8,
    radius: 20,
  },
  {
    key: 'tasks.filters',
    targets: [TOUR_TARGETS.tasksFilters],
    title: () => tr('صفِّ المهام', 'Filter your tasks'),
    body: () => tr('الكل، أو مهام اليوم، أو القادمة، أو المنجزة.', 'All, today, upcoming or done.'),
    prefer: 'below',
    pad: 8,
    radius: 999,
  },
  {
    key: 'tasks.new',
    targets: [TOUR_TARGETS.tasksNew],
    title: () => tr('أضف مهمة', 'Add a task'),
    body: () =>
      tr(
        'عنوان فقط يكفي. أضف موعداً إن أردت، وتذكيراً بإشعار، وكرّرها يومياً أو أسبوعياً، واربطها بمقرر.',
        'A title is enough. Add a date if you like, a reminder, a daily or weekly repeat, and link it to a course.',
      ),
    prefer: 'above',
    pad: 8,
    radius: 999,
  },
];

function AppTour({ name, steps }: { name: AppTourName; steps: readonly TourStepDef[] }) {
  const due = useAppTour(name);
  const focused = useIsFocused();
  if (!due) return null;
  const onFinish = (result: TourResult) => {
    if (result === 'none') return;
    setAppTourFlag(name, result === 'done' ? 'done' : 'skipped');
  };
  return <TourOverlay steps={steps} onFinish={onFinish} active={focused} delayMs={300} />;
}

/** Home tab: import courses, then build the timetable. */
export function HomeTour() {
  return <AppTour name="home" steps={HOME_STEPS} />;
}

/** Tasks tab, first visit. */
export function TasksTour() {
  return <AppTour name="tasks" steps={TASKS_STEPS} />;
}
