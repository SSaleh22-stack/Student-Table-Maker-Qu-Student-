import { Language } from '../types';

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
  offeredCourses: string;
  courseReviewHelper: string;
  close: string;
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
  export: string;
  exportToPDF: string;
  exportToExcel: string;
  exportToCalendar: string;
  examConflict: string;
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
  openQUReviewPage: string;
  reviewInstructions: string;
  reviewInstructionsContent: string;
}

export const translations: Record<Language, Translations> = {
  en: {
    appTitle: 'STUDENT TABLE MAKER',
    appSubtitle: 'صانع الجدول الدراسي',
    welcome: 'Welcome! Build your weekly timetable from the offered courses according to the plan.',
    extractCourses: 'Extract Courses According to Plan',
    courses: 'Courses',
    timetable: 'Timetable',
    addToTimetable: 'Add to Timetable',
    removeFromTimetable: 'Remove',
    noCourses: 'No courses extracted yet.',
    courseCode: 'Code',
    courseName: 'Course Name',
    section: 'Section',
    days: 'Days',
    time: 'Time',
    location: 'Location',
    instructor: 'Instructor',
    offeredCourses: 'Offered Courses According to Plan',
    courseReviewHelper: 'Course Review Helper',
    close: 'Close',
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
    export: 'Export',
    exportToPDF: 'Export to PDF',
    exportToExcel: 'Export to Excel',
    exportToCalendar: 'Export to Calendar',
    examConflict: 'Final exam conflict',
    search: 'Search',
    searchPlaceholder: 'Search by course name or section...',
    filter: 'Filter',
    filterByCode: 'Filter by Code',
    codeFilterPlaceholder: 'Enter course code...',
    filterByStatus: 'Filter by Status',
    filterByType: 'Filter by Type',
    all: 'All',
    instructions: 'Instructions',
    instructionsTitle: 'How to Use Student Table Maker',
    instructionsContent: '1. Navigate to the QU student portal and log in\n2. Go to the "Offered Courses" page\n3. Click "المقررات المطروحة" button to view all available courses\n4. Use the search and filter options to find courses\n5. Click "Add to Timetable" to add courses to your schedule\n6. Manage your timetable and view conflicts\n7. Export or print your timetable when ready',
    openQUReviewPage: 'Open QU Review Page',
    reviewInstructions: 'Instructions',
    reviewInstructionsContent: '1. Click "Open QU Review Page" to navigate to the course evaluation page\n2. Once on the evaluation page, a floating widget will appear in the bottom-right corner\n3. Select your preferred choice (Agree or Strongly Agree) from the dropdown\n4. Click "Agree All" to automatically fill all questions\n5. Review your selections and click "Undo" if needed',
  },
  ar: {
    appTitle: 'STUDENT TABLE MAKER',
    appSubtitle: 'صانع الجدول الدراسي',
    welcome: 'مرحباً! أنشئ جدولك الأسبوعي من المقررات المطروحة وفق الخطة.',
    extractCourses: 'استخراج المقررات من جامعة القصيم',
    courses: 'المقررات',
    timetable: 'الجدول الدراسي',
    addToTimetable: 'إضافة إلى الجدول',
    removeFromTimetable: 'إزالة',
    noCourses: 'لم يتم استخراج أي مقررات بعد.',
    courseCode: 'الرمز',
    courseName: 'اسم المقرر',
    section: 'الشعبة',
    days: 'الأيام',
    time: 'الوقت',
    location: 'المكان',
    instructor: 'المحاضر',
    offeredCourses: 'المقررات المطروحة وفق الخطة',
    courseReviewHelper: 'مساعد تقييم المقررات',
    close: 'إغلاق',
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
    exercise: 'تمرين',
    removeAll: 'إزالة الكل',
    summary: 'ملخص',
    export: 'تصدير',
    exportToPDF: 'تصدير كـ PDF',
    exportToExcel: 'تصدير كـ Excel',
    exportToCalendar: 'تصدير إلى التقويم',
    examConflict: 'تعارض في الامتحان النهائي',
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
    instructionsContent: '1. انتقل إلى بوابة الطالب في جامعة القصيم وقم بتسجيل الدخول\n2. اذهب إلى صفحة "المقررات المطروحة"\n3. انقر على زر "المقررات المطروحة" لعرض جميع المقررات المتاحة\n4. استخدم خيارات البحث والتصفية للعثور على المقررات\n5. انقر على "إضافة إلى الجدول" لإضافة المقررات إلى جدولك\n6. قم بإدارة جدولك وعرض التعارضات\n7. قم بتصدير أو طباعة جدولك عند الانتهاء',
    openQUReviewPage: 'فتح صفحة تقييم جامعة القصيم',
    reviewInstructions: 'تعليمات',
    reviewInstructionsContent: '1. انقر على "فتح صفحة تقييم جامعة القصيم" للانتقال إلى صفحة التقييم\n2. بمجرد الوصول إلى صفحة التقييم، ستظهر لوحة عائمة في الزاوية اليمنى السفلى\n3. اختر خيارك المفضل (موافق أو موافق بشدة) من القائمة المنسدلة\n4. انقر على "موافقة للجميع" لملء جميع الأسئلة تلقائياً\n5. راجع اختياراتك وانقر على "تراجع" إذا لزم الأمر',
  },
};

