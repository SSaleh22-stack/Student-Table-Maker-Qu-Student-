/**
 * The tour steps and their text (Figma 24-28 library tour, 31-35 notebook tour; NB-T1, NB-T3).
 *
 * Text is read at render time through tr(), so a language switch (which remounts the screens) shows
 * the other language. The undo step's text depends on where undo sits on screen: on the right in a
 * right-to-left layout, on the left in a left-to-right one, on top in a vertical toolbar
 * (core/tours/steps.ts undoLayout).
 *
 * Spotlight padding and corner radius follow the Figma spotlight() calls (default pad 10, radius 18;
 * 999 is a pill).
 */
import { tr } from '@/lib/i18n';
import { TOUR_TARGETS, type TourRect, type TourTargetId } from '@/notebook/contracts/tours';
import { undoLayout } from '@/notebook/core/tours/steps';

export interface TourStepContext {
  /** The step's measured rect (window coordinates, before padding). */
  rect: TourRect;
  /** The app's reading direction (src/lib/rtl.ts isRTL), not the native one. */
  isRTL: boolean;
}

export interface TourStepDef {
  key: string;
  /** One or more targets; several are shown as one union (Figma 28). */
  targets: readonly TourTargetId[];
  title(ctx: TourStepContext): string;
  body(ctx: TourStepContext): string;
  /** The side of the spotlight the card prefers. */
  prefer: 'above' | 'below';
  /** Spotlight padding around the target. */
  pad: number;
  /** Spotlight corner radius (999 = pill). */
  radius: number;
}

export const LIBRARY_STEPS: readonly TourStepDef[] = [
  {
    key: 'lib.courses',
    targets: [TOUR_TARGETS.libCourses],
    title: () => tr('مجلد لكل مادة', 'A folder for each course'),
    body: () =>
      tr(
        'تُنشأ مجلدات موادك تلقائياً من جدولك. اضغط على مادة لترى مذكراتها، أو «عرض الكل» لكل المواد.',
        'Your course folders are made from your timetable. Tap a course to see its notebooks, or “Show all” for every course.',
      ),
    prefer: 'below',
    pad: 10,
    radius: 18,
  },
  {
    key: 'lib.folders',
    targets: [TOUR_TARGETS.libFolders],
    title: () => tr('مجلداتك الخاصة', 'Your own folders'),
    body: () =>
      tr(
        'أنشئ مجلدات بالأسماء التي تريد ورتّب فيها مذكراتك. يظهر هنا 4 فقط، واضغط «عرض الكل» لرؤية البقية.',
        'Make folders with any name and keep your notebooks in them. Only 4 show here; tap “Show all” to see the rest.',
      ),
    prefer: 'below',
    pad: 10,
    radius: 18,
  },
  {
    key: 'lib.new',
    targets: [TOUR_TARGETS.libNew],
    title: () => tr('ابدأ مذكرة جديدة', 'Start a new notebook'),
    body: () =>
      tr(
        'اختر ورقاً فارغاً أو مسطراً، أو استورد ملف PDF، أو امسح ورقة بالكاميرا.',
        'Pick blank or lined paper, import a PDF, or scan a page with the camera.',
      ),
    prefer: 'above',
    pad: 10,
    radius: 999,
  },
  {
    key: 'lib.search',
    targets: [TOUR_TARGETS.libSearch, TOUR_TARGETS.libHeaderActions],
    title: () => tr('البحث والترتيب والإعدادات', 'Search, sort and settings'),
    body: () =>
      tr(
        'ابحث في مذكراتك ورتّبها، ومن الإعدادات فعّل النسخ الاحتياطي واعرف مساحة التخزين.',
        'Search and sort your notebooks. In settings, turn on backup and see your storage.',
      ),
    prefer: 'below',
    pad: 10,
    radius: 18,
  },
];

/** The undo step's text for where undo sits on screen. */
export function undoStepBody(isRTL: boolean, rect?: TourRect | null): string {
  const layout = undoLayout(isRTL, rect);
  if (layout === 'undo-top') {
    return tr(
      'الزر العلوي للتراجع والسفلي للإعادة. أو انقر بإصبعين للتراجع وبثلاثة أصابع للإعادة.',
      'The top button undoes and the bottom one redoes. Or tap with two fingers to undo and three fingers to redo.',
    );
  }
  if (layout === 'undo-right') {
    return tr(
      'الزر الأيمن للتراجع والأيسر للإعادة. أو انقر بإصبعين للتراجع وبثلاثة أصابع للإعادة.',
      'The right button undoes and the left one redoes. Or tap with two fingers to undo and three fingers to redo.',
    );
  }
  return tr(
    'الزر الأيسر للتراجع والأيمن للإعادة. أو انقر بإصبعين للتراجع وبثلاثة أصابع للإعادة.',
    'The left button undoes and the right one redoes. Or tap with two fingers to undo and three fingers to redo.',
  );
}

export const EDITOR_STEPS: readonly TourStepDef[] = [
  {
    key: 'ed.toolbar',
    targets: [TOUR_TARGETS.edToolbar],
    title: () => tr('كل أدواتك هنا', 'All your tools are here'),
    body: () =>
      tr(
        'القلم، التظليل، الممحاة، التحديد، الأشكال، المسطرة، النص، الصور، والآلة الحاسبة العلمية.',
        'Pen, highlighter, eraser, lasso, shapes, ruler, text, images and the scientific calculator.',
      ),
    prefer: 'below',
    pad: 10,
    radius: 26,
  },
  {
    key: 'ed.grip',
    targets: [TOUR_TARGETS.edGrip],
    title: () => tr('انقل الشريط كما تحب', 'Move the toolbar where you like'),
    body: () =>
      tr(
        'اضغط مطولاً على الشريط ثم اسحبه إلى الأعلى أو الأسفل أو اليمين أو اليسار.',
        'Press and hold the toolbar, then drag it to the top, bottom, right or left.',
      ),
    prefer: 'below',
    pad: 8,
    radius: 14,
  },
  {
    key: 'ed.undo',
    targets: [TOUR_TARGETS.edUndo],
    title: () => tr('تراجع وإعادة', 'Undo and redo'),
    body: ({ isRTL, rect }) => undoStepBody(isRTL, rect),
    prefer: 'below',
    pad: 8,
    radius: 14,
  },
  {
    key: 'ed.record',
    targets: [TOUR_TARGETS.edRecord],
    title: () => tr('سجّل المحاضرة وأنت تكتب', 'Record the lecture as you write'),
    body: () =>
      tr(
        'بعدها اضغط على أي كتابة لتسمع ما قاله الدكتور في تلك اللحظة.',
        'Later, tap any writing to hear what the lecturer said at that moment.',
      ),
    prefer: 'below',
    pad: 8,
    radius: 999,
  },
  {
    key: 'ed.actions',
    // The whole header pill (pages, share, more), Figma 35.
    targets: [TOUR_TARGETS.edActions],
    title: () => tr('الصفحات والمشاركة', 'Pages and sharing'),
    body: () =>
      tr(
        'رتّب الصفحات وأضف صفحات جديدة، وشارك المذكرة كملف PDF أو صورة أو ملف قابل للتعديل.',
        'Reorder and add pages, and share the notebook as a PDF, an image or an editable file.',
      ),
    prefer: 'below',
    pad: 8,
    radius: 999,
  },
];

/** Shared button and counter text. */
export const tourText = {
  next: () => tr('التالي', 'Next'),
  finish: () => tr('تم، لنبدأ', "Done, let's start"),
  skip: () => tr('تخطي الجولة', 'Skip tour'),
};
