import React, { useState } from 'react';
import { LanguageProvider, useLanguage } from '../contexts/LanguageContext';
import { TimetableProvider } from '../contexts/TimetableContext';
import LanguageToggle from './LanguageToggle';
import NavBar from './NavBar';
import HeroSection from './HeroSection';
import CourseList from './CourseList';
import TimetableGrid from './TimetableGrid';
import OfferedCoursesModal from './OfferedCoursesModal';
import AddCourseModal from './AddCourseModal';
import GpaCalculator from './GpaCalculator';
import AbsenceCalculator from './AbsenceCalculator';
import { Course } from '../types';
import './App.css';

// Dummy courses for Phase 2 - includes multiple sections to demonstrate grouping
const dummyCourses: Course[] = [
  {
    id: '1',
    code: 'CS101',
    name: 'Introduction to Computer Science',
    section: '01',
    days: ['Sun', 'Tue'],
    startTime: '08:00',
    endTime: '09:30',
    location: 'Building 5, Room 201',
    instructor: 'Dr. Ahmed Ali',
    status: 'open',
    classType: 'theoretical',
    finalExam: {
      day: 'Sun',
      startTime: '08:00',
      endTime: '10:00',
      location: 'Building 5, Hall A',
    },
  },
  {
    id: '1b',
    code: 'CS101',
    name: 'Introduction to Computer Science',
    section: '02',
    days: ['Mon', 'Wed'],
    startTime: '08:00',
    endTime: '09:30',
    location: 'Building 5, Room 202',
    instructor: 'Dr. Ahmed Ali',
  },
  {
    id: '1c',
    code: 'CS101',
    name: 'Introduction to Computer Science',
    section: '03',
    days: ['Sun', 'Tue'],
    startTime: '10:00',
    endTime: '11:30',
    location: 'Building 5, Room 203',
    instructor: 'Dr. Mohammed Hassan',
    status: 'open',
    classType: 'exercise',
  },
  {
    id: '2',
    code: 'MATH201',
    name: 'Calculus I',
    section: '01',
    days: ['Mon', 'Wed'],
    startTime: '10:00',
    endTime: '11:30',
    location: 'Building 3, Room 105',
    instructor: 'Dr. Sarah Mohammed',
    status: 'open',
    classType: 'theoretical',
    finalExam: {
      day: 'Sun',
      startTime: '08:00',
      endTime: '10:00',
      location: 'Building 3, Hall B',
    },
  },
  {
    id: '2b',
    code: 'MATH201',
    name: 'Calculus I',
    section: '02',
    days: ['Sun', 'Thu'],
    startTime: '10:00',
    endTime: '11:30',
    location: 'Building 3, Room 106',
    instructor: 'Dr. Sarah Mohammed',
    status: 'open',
    classType: 'theoretical',
  },
  {
    id: '3',
    code: 'ENG101',
    name: 'English Composition',
    section: '01',
    days: ['Sun', 'Thu'],
    startTime: '14:00',
    endTime: '15:30',
    location: 'Building 2, Room 301',
    instructor: 'Dr. John Smith',
    status: 'open',
    classType: 'theoretical',
  },
  {
    id: '3b',
    code: 'ENG101',
    name: 'English Composition',
    section: '02',
    days: ['Tue', 'Thu'],
    startTime: '14:00',
    endTime: '15:30',
    location: 'Building 2, Room 302',
    instructor: 'Dr. Jane Doe',
    status: 'closed',
    classType: 'practical',
  },
  {
    id: '4',
    code: 'PHYS101',
    name: 'General Physics',
    section: '01',
    days: ['Tue', 'Thu'],
    startTime: '12:00',
    endTime: '13:30',
    location: 'Building 4, Lab 102',
    instructor: 'Dr. Fatima Hassan',
    status: 'open',
    classType: 'practical',
  },
  {
    id: '4b',
    code: 'PHYS101',
    name: 'General Physics',
    section: '02',
    days: ['Mon', 'Wed'],
    startTime: '12:00',
    endTime: '13:30',
    location: 'Building 4, Lab 103',
    instructor: 'Dr. Fatima Hassan',
    status: 'open',
    classType: 'exercise',
  },
];

type ViewMode = 'timetable' | 'gpa' | 'absence';

const AppContent: React.FC = () => {
  const { language, t } = useLanguage();
  const [currentView, setCurrentView] = useState<ViewMode>('timetable');
  const [courses, setCourses] = useState<Course[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [showOfferedCoursesModal, setShowOfferedCoursesModal] = useState(false);
  const [showAddCourseModal, setShowAddCourseModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Check for extracted courses from storage on mount
  React.useEffect(() => {
    // Check if chrome.storage is available
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return;
    }

    // Check URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('extracted') === 'true') {
      // Set view to timetable
      setCurrentView('timetable');
      // Load courses from storage
      chrome.storage.local.get(['extractedCourses'], (result) => {
        if (result.extractedCourses && Array.isArray(result.extractedCourses)) {
          setCourses(result.extractedCourses);
          // Clear the stored courses
          chrome.storage.local.remove(['extractedCourses']);
        }
      });
    }
  }, []);

  const handleExtractCourses = () => {
    setIsExtracting(true);
    setExtractionError(null);

    // Check if chrome.runtime is available
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      setIsExtracting(false);
      setExtractionError(
        language === 'en'
          ? 'Chrome extension APIs are not available. Please make sure you are using this extension in Chrome.'
          : 'واجهات برمجة الإضافة غير متاحة. يرجى التأكد من استخدام هذه الإضافة في Chrome.'
      );
      return;
    }

    // Check if extension context is still valid
    if (!chrome.runtime || !chrome.runtime.id) {
      setIsExtracting(false);
      setExtractionError(
        language === 'en'
          ? 'Extension context invalidated. Please reload the page and try again.'
          : 'تم إبطال سياق الإضافة. يرجى إعادة تحميل الصفحة والمحاولة مرة أخرى.'
      );
      return;
    }

    // Send message to background script to extract courses
    try {
      chrome.runtime.sendMessage(
        { type: 'EXTRACT_COURSES_FROM_TAB' },
        (response) => {
          setIsExtracting(false);

          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('message port closed')) {
              setExtractionError(
                language === 'en'
                  ? 'Extension was reloaded. Please refresh the QU student page and try extracting again.'
                  : 'تم إعادة تحميل الإضافة. يرجى تحديث صفحة الطالب والمحاولة مرة أخرى.'
              );
            } else {
              setExtractionError(
                language === 'en'
                  ? `Failed to communicate with extension: ${errorMsg}. Please reload the page.`
                  : `فشل التواصل مع الإضافة: ${errorMsg}. يرجى إعادة تحميل الصفحة.`
              );
            }
            return;
          }

        if (response && response.type === 'COURSES_EXTRACTED' && response.success) {
          const extractedCourses = response.payload as Course[];
          if (extractedCourses.length > 0) {
            setCourses(extractedCourses);
            // Ensure we're on the timetable view after extraction
            setCurrentView('timetable');
            setExtractionError(null);
          } else {
            setExtractionError(
              language === 'en'
                ? 'No courses found on this page. Please make sure you are on the QU student course page (offeredCourses page) and the page has fully loaded.'
                : 'لم يتم العثور على مقررات في هذه الصفحة. يرجى التأكد من أنك في صفحة المقررات المطروحة وأن الصفحة تم تحميلها بالكامل.'
            );
          }
        } else if (response && response.type === 'EXTRACTION_FAILED') {
          // Handle extraction failed response
          const errorMsg = response.error || 
            (language === 'en'
              ? 'Failed to extract courses. Please make sure you are logged in and on the offered courses page (offeredCoursesIndex.faces).'
              : 'فشل استخراج المقررات. يرجى التأكد من تسجيل الدخول وأنك في صفحة المقررات المطروحة.');
          setExtractionError(errorMsg);
        } else {
          // No response or unexpected response format
          const errorMsg = response?.error || 
            (language === 'en'
              ? 'Failed to extract courses. Please make sure you are logged in and on the offered courses page (offeredCoursesIndex.faces).'
              : 'فشل استخراج المقررات. يرجى التأكد من تسجيل الدخول وأنك في صفحة المقررات المطروحة.');
          setExtractionError(errorMsg);
        }
      }
      );
    } catch (error) {
      setIsExtracting(false);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Extension context invalidated') || errorMessage.includes('message port closed')) {
        setExtractionError(
          language === 'en'
            ? 'Extension was reloaded. Please refresh the QU student page and try extracting again.'
            : 'تم إعادة تحميل الإضافة. يرجى تحديث صفحة الطالب والمحاولة مرة أخرى.'
        );
      } else {
        setExtractionError(
          language === 'en'
            ? `Error: ${errorMessage}. Please reload the page.`
            : `خطأ: ${errorMessage}. يرجى إعادة تحميل الصفحة.`
        );
      }
    }
  };

  return (
    <div className="app" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <NavBar currentView={currentView} onViewChange={setCurrentView} />
      
      {currentView === 'timetable' ? (
        <>
          <HeroSection 
            onExtractCourses={handleExtractCourses}
            isExtracting={isExtracting}
          />
          {extractionError && (
            <div className="extraction-error">
              <span className="error-icon">⚠️</span>
              <span className="error-message">{extractionError}</span>
            </div>
          )}
          {successMessage && (
            <div className="success-message">
              <span className="success-icon">✅</span>
              <span className="success-message-text">{successMessage}</span>
            </div>
          )}
          <div className="offered-courses-button-container">
            <button 
              className="offered-courses-btn"
              onClick={() => setShowOfferedCoursesModal(true)}
            >
              📋 {t.offeredCourses}
            </button>
            <button 
              className="add-course-manually-btn"
              onClick={() => setShowAddCourseModal(true)}
            >
              ➕ {language === 'en' ? 'Add Course Manually' : 'إضافة مقرر يدوياً'}
            </button>
          </div>
          <OfferedCoursesModal
            courses={courses}
            isOpen={showOfferedCoursesModal}
            onClose={() => setShowOfferedCoursesModal(false)}
          />
          <AddCourseModal
            isOpen={showAddCourseModal}
            onClose={() => setShowAddCourseModal(false)}
            onAdd={(course) => {
              // Add __originalIndex to manually added courses so they appear at the end
              const courseWithIndex = {
                ...course,
                __originalIndex: 999999 + (courses.length || 0) // High number to ensure they appear after extracted courses
              };
              setCourses((prev) => [...prev, courseWithIndex]);
              setShowAddCourseModal(false);
              const message = language === 'en'
                ? `✅ Course "${course.code}" has been added successfully! Check the course list on the right pane.`
                : `✅ تم إضافة المقرر "${course.code}" بنجاح! تحقق من قائمة المقررات في اللوحة اليمنى.`;
              setSuccessMessage(message);
              setTimeout(() => setSuccessMessage(null), 5000);
            }}
          />
          <div className="app-content">
            <div className="main-layout">
              <div className="timetable-wrapper">
                <TimetableGrid />
              </div>
              <div className="course-list-wrapper">
                <CourseList courses={courses} />
              </div>
            </div>
          </div>
        </>
      ) : currentView === 'gpa' ? (
        <GpaCalculator />
      ) : (
        <AbsenceCalculator />
      )}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <LanguageProvider>
      <TimetableProvider>
        <AppContent />
      </TimetableProvider>
    </LanguageProvider>
  );
};

export default App;

