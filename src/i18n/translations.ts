/**
 * Translation dictionary for bilingual support (English & Arabic)
 */

import { Language } from '../types';

export type { Language };

export interface Translations {
  appTitle: string;
  appSubtitle: string;
  welcome: string;
  extractCourses: string;
  courses: string;
  timetable: string;
  addToTimetable: string;
  removeFromTimetable: string;
  noCourses: string;
  courseCode: string;
  courseName: string;
  section: string;
  days: string;
  time: string;
  location: string;
  instructor: string;
  sunday: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  finalExam: string;
  status: string;
  classType: string;
  open: string;
  closed: string;
  practical: string;
  theoretical: string;
  exercise: string;
  removeAll: string;
  summary: string;
  close: string;
  export: string;
  exportToPDF: string;
  exportToExcel: string;
  exportToCalendar: string;
  exportToJPG: string;
  exportJPGTimetable: string;
  exportJPGSummary: string;
  exportJPGBoth: string;
  examConflict: string;
  offeredCourses: string;
  search: string;
  searchPlaceholder: string;
  filter: string;
  filterByCode: string;
  codeFilterPlaceholder: string;
  filterByStatus: string;
  filterByType: string;
  all: string;
  instructions: string;
  instructionsTitle: string;
  instructionsContent: string;
  courseReviewHelper: string;
  qeeemSite: string;
  openQUReviewPage: string;
  reviewInstructions: string;
  reviewInstructionsContent: string;
  // GPA Calculator translations
  gpaCalculator: string;
  gpaAdvanced: string;
  gpaSettings: string;
  gpaScale: string;
  gpaPrevGpa: string;
  gpaPrevHours: string;
  gpaCurrentCourses: string;
  gpaAddCourse: string;
  gpaClearAll: string;
  gpaClearAllConfirm: string;
  gpaCourseName: string;
  gpaCourseNamePlaceholder: string;
  gpaGrade: string;
  gpaHours: string;
  gpaPoints: string;
  gpaActions: string;
  gpaDuplicate: string;
  gpaRemove: string;
  gpaResults: string;
  gpaSemesterResults: string;
  gpaCurrentHours: string;
  gpaCurrentPoints: string;
  gpaSemesterGpa: string;
  gpaCumulativeResults: string;
  gpaTotalHours: string;
  gpaTotalPoints: string;
  gpaNewCumulativeGpa: string;
  gpaNoHoursWarning: string;
  gpaAdvancedGradeMapping: string;
  gpaAdvancedDescription: string;
  gpaResetToDefaults: string;
  gpaResetGradeMapConfirm: string;
  // Absence Calculator translations
  absenceCalculator: string;
  absenceStudyWeeks: string;
  absenceHoursPerWeek: string;
  absenceHoursAbsent: string;
  absenceMaxPercent: string;
  absenceTotalHours: string;
  absencePercent: string;
  absenceHoursRemaining: string;
  absenceStatus: string;
  absenceSafe: string;
  absenceWarning: string;
  absenceDanger: string;
  absenceExceeded: string;
  absenceCanStillAttend: string;
  absenceCannotAttend: string;
  absenceResults: string;
  // Contact Us translations
  contactUs: string;
  contactEmail: string;
  contactTelegram: string;
  contactEmailLabel: string;
  contactTelegramLabel: string;
  contactCopyEmail: string;
  contactCopyTelegram: string;
  contactCopied: string;
}

export const translations: Record<Language, Translations> = {
  en: {
    appTitle: 'Qu Student',
    appSubtitle: 'صانع الجدول الدراسي',
    welcome: 'Welcome! Build your weekly timetable from the offered courses according to the plan.',
    extractCourses: 'Extract Courses According to Plan',
    courses: 'Courses',
    timetable: 'Timetable',
    addToTimetable: 'Add to Timetable',
    removeFromTimetable: 'Remove',
    noCourses: 'No courses extracted yet. Click "Extract Courses from QU" to get started.',
    courseCode: 'Code',
    courseName: 'Course Name',
    section: 'Section',
    days: 'Days',
    time: 'Time',
    location: 'Location',
    instructor: 'Instructor',
    sunday: 'Sunday',
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
    finalExam: 'Final Exam',
    status: 'Status',
    classType: 'Type',
    open: 'Open',
    closed: 'Closed',
    practical: 'Practical',
    theoretical: 'Theoretical',
    exercise: 'Exercise',
    removeAll: 'Remove All',
    summary: 'Summary',
    close: 'Close',
    export: 'Export',
    exportToPDF: 'Export to PDF',
    exportToExcel: 'Export to Excel',
    exportToCalendar: 'Export to Calendar',
    exportToJPG: 'Export to JPG',
    exportJPGTimetable: 'Timetable Only',
    exportJPGSummary: 'Summary Only',
    exportJPGBoth: 'Both',
    examConflict: 'Final exam conflict',
    offeredCourses: 'Offered Courses According to Plan',
    search: 'Search',
    searchPlaceholder: 'Search by course name or section...',
    filter: 'Filter',
    filterByCode: 'Filter by Code',
    codeFilterPlaceholder: 'Enter course code...',
    filterByStatus: 'Filter by Status',
    filterByType: 'Filter by Type',
    all: 'All',
    instructions: 'Instructions',
    instructionsTitle: 'How to Use Qu Student',
    instructionsContent: '1. Navigate to the QU student portal and log in\n2. Go to the "Offered Courses" page\n3. Click "المقررات المطروحة" button to view all available courses\n4. Use the search and filter options to find courses\n5. Click "Add to Timetable" to add courses to your schedule\n6. Manage your timetable and view conflicts\n7. Export or print your timetable when ready',
    courseReviewHelper: 'Course Review Helper',
    qeeemSite: 'Qeeem Site (Instructor Ratings)',
    openQUReviewPage: 'Open QU Review Page',
    reviewInstructions: 'Instructions',
    reviewInstructionsContent: '1. Click "Open QU Review Page" to navigate to the course evaluation page\n2. Once on the evaluation page, a floating widget will appear in the bottom-right corner\n3. Select your preferred choice (Agree or Strongly Agree) from the dropdown\n4. Click "Agree All" to automatically fill all questions\n5. Review your selections and click "Undo" if needed',
    // GPA Calculator
    gpaCalculator: 'GPA Calculator',
    gpaAdvanced: 'Advanced',
    gpaSettings: 'Settings',
    gpaScale: 'GPA Scale',
    gpaPrevGpa: 'Previous GPA',
    gpaPrevHours: 'Previous Hours',
    gpaCurrentCourses: 'Current Courses',
    gpaAddCourse: 'Add Course',
    gpaClearAll: 'Clear All',
    gpaClearAllConfirm: 'Are you sure you want to clear all courses?',
    gpaCourseName: 'Course Name',
    gpaCourseNamePlaceholder: 'Course name',
    gpaGrade: 'Grade',
    gpaHours: 'Hours',
    gpaPoints: 'Points',
    gpaActions: 'Actions',
    gpaDuplicate: 'Duplicate',
    gpaRemove: 'Remove',
    gpaResults: 'Results',
    gpaSemesterResults: 'Semester Results',
    gpaCurrentHours: 'Current Hours',
    gpaCurrentPoints: 'Current Quality Points',
    gpaSemesterGpa: 'Semester GPA',
    gpaCumulativeResults: 'Cumulative Results',
    gpaTotalHours: 'Total Hours',
    gpaTotalPoints: 'Total Quality Points',
    gpaNewCumulativeGpa: 'New Cumulative GPA',
    gpaNoHoursWarning: 'Please add courses with credit hours to calculate GPA.',
    gpaAdvancedGradeMapping: 'Advanced Grade Mapping',
    gpaAdvancedDescription: 'Customize grade point values for the selected scale.',
    gpaResetToDefaults: 'Reset to Defaults',
    gpaResetGradeMapConfirm: 'Reset to default grade mappings?',
    // Absence Calculator
    absenceCalculator: 'Absence Calculator',
    absenceStudyWeeks: 'Study Weeks',
    absenceHoursPerWeek: 'Hours Per Week',
    absenceHoursAbsent: 'Hours Absent',
    absenceMaxPercent: 'Max Absence Percent',
    absenceTotalHours: 'Total Hours',
    absencePercent: 'Absence Percent',
    absenceHoursRemaining: 'Hours Remaining',
    absenceStatus: 'Status',
    absenceSafe: 'Safe',
    absenceWarning: 'Warning',
    absenceDanger: 'Danger',
    absenceExceeded: 'Exceeded',
    absenceCanStillAttend: 'You can still attend',
    absenceCannotAttend: 'You cannot attend (exceeded limit)',
    absenceResults: 'Results',
    // Contact Us
    contactUs: 'Contact Us',
    contactEmail: 'Email',
    contactTelegram: 'Telegram',
    contactEmailLabel: 'Email Address',
    contactTelegramLabel: 'Telegram Username',
    contactCopyEmail: 'Copy Email',
    contactCopyTelegram: 'Copy Telegram',
    contactCopied: 'Copied!',
  },
  ar: {
    appTitle: 'Qu Student',
    appSubtitle: 'صانع الجدول الدراسي',
    welcome: 'مرحباً! أنشئ جدولك الأسبوعي من المقررات المطروحة وفق الخطة.',
    extractCourses: 'استخراج المقررات من جامعة القصيم',
    courses: 'المقررات',
    timetable: 'الجدول الدراسي',
    addToTimetable: 'إضافة إلى الجدول',
    removeFromTimetable: 'إزالة',
    noCourses: 'لم يتم استخراج أي مقررات بعد. انقر على "استخراج المقررات" للبدء.',
    courseCode: 'الرمز',
    courseName: 'اسم المقرر',
    section: 'الشعبة',
    days: 'الأيام',
    time: 'الوقت',
    location: 'المكان',
    instructor: 'المحاضر',
    sunday: 'الأحد',
    monday: 'الاثنين',
    tuesday: 'الثلاثاء',
    wednesday: 'الأربعاء',
    thursday: 'الخميس',
    friday: 'الجمعة',
    saturday: 'السبت',
    finalExam: 'الامتحان النهائي',
    status: 'الحالة',
    classType: 'النوع',
    open: 'مفتوح',
    closed: 'مغلق',
    practical: 'عملي',
    theoretical: 'نظري',
    exercise: 'تدريب',
    removeAll: 'إزالة الكل',
    summary: 'ملخص',
    close: 'إغلاق',
    export: 'تصدير',
    exportToPDF: 'تصدير كـ PDF',
    exportToExcel: 'تصدير كـ Excel',
    exportToCalendar: 'تصدير إلى التقويم',
    exportToJPG: 'تصدير كـ JPG',
    exportJPGTimetable: 'الجدول فقط',
    exportJPGSummary: 'الملخص فقط',
    exportJPGBoth: 'كلاهما',
    examConflict: 'تعارض في الامتحان النهائي',
    offeredCourses: 'المقررات المطروحة وفق الخطة',
    search: 'بحث',
    searchPlaceholder: 'بحث باسم المقرر أو الشعبة...',
    filter: 'تصفية',
    filterByCode: 'تصفية حسب الرمز',
    codeFilterPlaceholder: 'أدخل رمز المقرر...',
    filterByStatus: 'تصفية حسب الحالة',
    filterByType: 'تصفية حسب النوع',
    all: 'الكل',
    instructions: 'تعليمات',
    instructionsTitle: 'كيفية استخدام صانع الجدول الدراسي',
    instructionsContent: 'الدخول للبوابة\n\nادخل إلى بوابة الطالب بجامعة القصيم وسجّل الدخول بحسابك الجامعي.\n\n\n\nفتح صفحة المقررات حسب الخطة\n\nمن القوائم انتقل إلى: المقررات المطروحة وفق الخطة.\n\n\n\nاستخراج المقررات للفصل\n\nاختر الفصل الدراسي المطلوب، ثم اضغط على الأيقونة الموجودة بجانب اختيار الفصل:\n\n"استخراج المقررات المطروحة وفق الخطة".\n\n\n\nالبحث والتصفية\n\nاستخدم خيارات البحث/التصفية للوصول بسرعة للمقرر (مثل: رمز المقرر، اسم المقرر، المستوى، الشعبة…).\n\n\n\nإضافة المقررات إلى الجدول\n\nعند ظهور المقررات، اضغط "إضافة إلى الجدول" أو استخدم الأيقونات المخصصة للإضافة لكل مقرر/شعبة.\n\n\n\nإدارة الجدول والتعارضات\n\nراجع جدولك بعد الإضافة، وتحقق من وجود تعارضات (تداخل أوقات/أيام).\n\nعند وجود تعارض: غيّر الشعبة أو احذف المقرر المتعارض ثم أعد المحاولة.\n\n\n\nالتصدير أو الطباعة\n\nبعد الانتهاء، قم بـ تصدير الجدول (إن توفر خيار PDF/تصدير) أو طباعة الجدول مباشرة.\n\n\n\nملاحظة سريعة: إذا لم تظهر أيقونة "استخراج…" أو خيارات الطباعة/التصدير، جرّب تحديث الصفحة، أو استخدام متصفح Chrome/Edge، والتأكد من السماح بالنوافذ المنبثقة (Pop-ups).',
    courseReviewHelper: 'مساعد تقييم المقررات',
    qeeemSite: 'موقع قيم (تقييم الدكاترة)',
    openQUReviewPage: 'فتح صفحة تقييم جامعة القصيم',
    reviewInstructions: 'تعليمات',
    reviewInstructionsContent: '1. انقر على "فتح صفحة تقييم جامعة القصيم" للانتقال إلى صفحة التقييم\n2. بمجرد الوصول إلى صفحة التقييم، ستظهر لوحة عائمة في الزاوية اليمنى السفلى\n3. اختر خيارك المفضل (موافق أو موافق بشدة) من القائمة المنسدلة\n4. انقر على "موافقة للجميع" لملء جميع الأسئلة تلقائياً\n5. راجع اختياراتك وانقر على "تراجع" إذا لزم الأمر',
    // GPA Calculator
    gpaCalculator: 'حاسبة المعدل',
    gpaAdvanced: 'متقدم',
    gpaSettings: 'الإعدادات',
    gpaScale: 'نظام المعدل',
    gpaPrevGpa: 'المعدل التراكمي السابق',
    gpaPrevHours: 'عدد الساعات السابقة',
    gpaCurrentCourses: 'مقررات الفصل الحالي',
    gpaAddCourse: 'إضافة مقرر',
    gpaClearAll: 'مسح الكل',
    gpaClearAllConfirm: 'هل أنت متأكد أنك تريد مسح جميع المقررات؟',
    gpaCourseName: 'اسم المقرر',
    gpaCourseNamePlaceholder: 'اسم المقرر',
    gpaGrade: 'الدرجة',
    gpaHours: 'الساعات',
    gpaPoints: 'النقاط',
    gpaActions: 'الإجراءات',
    gpaDuplicate: 'نسخ',
    gpaRemove: 'إزالة',
    gpaResults: 'النتائج',
    gpaSemesterResults: 'نتائج الفصل',
    gpaCurrentHours: 'الساعات الحالية',
    gpaCurrentPoints: 'النقاط الحالية (دقة 100%)',
    gpaSemesterGpa: 'معدل الفصل',
    gpaCumulativeResults: 'النتائج التراكمية',
    gpaTotalHours: 'إجمالي الساعات',
    gpaTotalPoints: 'إجمالي النقاط (دقة 100%)',
    gpaNewCumulativeGpa: 'المعدل التراكمي الجديد',
    gpaNoHoursWarning: 'يرجى إضافة مقررات بساعات معتمدة لحساب المعدل.',
    gpaAdvancedGradeMapping: 'تعيين الدرجات المتقدم',
    gpaAdvancedDescription: 'تخصيص قيم نقاط الدرجات للنظام المحدد.',
    gpaResetToDefaults: 'إعادة التعيين إلى الافتراضي',
    gpaResetGradeMapConfirm: 'إعادة تعيين تعيين الدرجات إلى الافتراضي؟',
    // Absence Calculator
    absenceCalculator: 'حاسبة الغياب',
    absenceStudyWeeks: 'أسابيع الدراسة',
    absenceHoursPerWeek: 'ساعات في الأسبوع',
    absenceHoursAbsent: 'ساعات الغياب',
    absenceMaxPercent: 'نسبة الغياب المسموحة',
    absenceTotalHours: 'إجمالي الساعات',
    absencePercent: 'نسبة الغياب',
    absenceHoursRemaining: 'الساعات المتبقية',
    absenceStatus: 'الحالة',
    absenceSafe: 'آمن',
    absenceWarning: 'تحذير',
    absenceDanger: 'خطر',
    absenceExceeded: 'تم تجاوز الحد',
    absenceCanStillAttend: 'يمكنك الحضور',
    absenceCannotAttend: 'لا يمكنك الحضور (تم تجاوز الحد)',
    absenceResults: 'النتائج',
    // Contact Us
    contactUs: 'اتصل بنا',
    contactEmail: 'البريد الإلكتروني',
    contactTelegram: 'تيليجرام',
    contactEmailLabel: 'عنوان البريد الإلكتروني',
    contactTelegramLabel: 'اسم المستخدم في تيليجرام',
    contactCopyEmail: 'نسخ البريد الإلكتروني',
    contactCopyTelegram: 'نسخ تيليجرام',
    contactCopied: 'تم النسخ!',
  },
};

