import React, { useState } from 'react';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { TimetableProvider } from './contexts/TimetableContext';
import NavBar from './components/NavBar';
import HeroSection from './components/HeroSection';
import CourseList from './components/CourseList';
import TimetableGrid from './components/TimetableGrid';
import OfferedCoursesModal from './components/OfferedCoursesModal';
import AddCourseModal from './components/AddCourseModal';
import GpaCalculator from './components/GpaCalculator';
import AbsenceCalculator from './components/AbsenceCalculator';
import { Course } from './types';
import './App.css';

type ViewMode = 'timetable' | 'gpa' | 'absence';

const AppContent: React.FC = () => {
  const { t } = useLanguage();
  const [currentView, setCurrentView] = useState<ViewMode>('timetable');
  
  // Check for GPA data on mount and navigate to GPA page if present
  React.useEffect(() => {
    const checkForGpaData = async () => {
      // Check URL parameter
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('gpa') === 'true') {
        setCurrentView('gpa');
        // Remove the parameter from URL
        window.history.replaceState({}, '', window.location.pathname);
      }
    };
    
    checkForGpaData();
  }, []);
  
  const [courses, setCourses] = useState<Course[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [showOfferedCoursesModal, setShowOfferedCoursesModal] = useState(false);
  const [showAddCourseModal, setShowAddCourseModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Check for extracted courses from storage on mount
  React.useEffect(() => {
    // Check URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('extracted') === 'true') {
      // Set view to timetable
      setCurrentView('timetable');
      // Load courses from localStorage (bookmarklet saves here)
      const saved = localStorage.getItem('qu-student-courses');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && Array.isArray(parsed) && parsed.length > 0) {
            setCourses(parsed);
          }
        } catch (error) {
          console.error('Error parsing courses from localStorage:', error);
        }
      }
    }
    
    // Also load from localStorage on mount (for bookmarklet)
    const saved = localStorage.getItem('qu-student-courses');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed) && parsed.length > 0) {
          setCourses(parsed);
        }
      } catch (error) {
        console.error('Error parsing courses from localStorage:', error);
      }
    }
    
    // Listen for storage changes (when bookmarklet runs on another tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'qu-student-courses' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setCourses(parsed);
            setCurrentView('timetable');
            const message = `✅ تم التحديث! تم تحميل ${parsed.length} مقرر من الإشارة المرجعية.`;
            setSuccessMessage(message);
            setTimeout(() => setSuccessMessage(null), 5000);
          }
        } catch (error) {
          console.error('Error parsing updated courses:', error);
        }
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // Also check periodically (for same-tab updates when bookmarklet runs)
    const interval = setInterval(() => {
      const timestamp = localStorage.getItem('qu-student-courses-timestamp');
      const lastLoaded = (window as any).__lastCoursesTimestamp;
      if (timestamp && timestamp !== lastLoaded) {
        (window as any).__lastCoursesTimestamp = timestamp;
        const saved = localStorage.getItem('qu-student-courses');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setCourses(parsed);
              setCurrentView('timetable');
              const message = `✅ تم التحديث! تم تحميل ${parsed.length} مقرر من الإشارة المرجعية.`;
              setSuccessMessage(message);
              setTimeout(() => setSuccessMessage(null), 5000);
            }
          } catch (error) {
            console.error('Error parsing courses:', error);
          }
        }
      }
    }, 500);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  const handleExtractCourses = () => {
    setIsExtracting(true);
    setExtractionError(null);

    // For web-app, we use bookmarklet instead of chrome.runtime
    // Check if courses were extracted via bookmarklet
    const timestamp = localStorage.getItem('qu-student-courses-timestamp');
    const saved = localStorage.getItem('qu-student-courses');
    
    if (saved && timestamp) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setIsExtracting(false);
          setCourses(parsed);
          setCurrentView('timetable');
          setExtractionError(null);
          const message = `✅ تم تحميل ${parsed.length} مقرر من الإشارة المرجعية!`;
          setSuccessMessage(message);
          setTimeout(() => setSuccessMessage(null), 5000);
        } else {
          setIsExtracting(false);
          setExtractionError('لم يتم العثور على مقررات. يرجى استخدام الإشارة المرجعية على صفحة المقررات المطروحة والتأكد من تحميل الصفحة بالكامل.');
        }
      } catch (error) {
        setIsExtracting(false);
        setExtractionError('خطأ في تحليل بيانات المقررات. يرجى المحاولة مرة أخرى باستخدام الإشارة المرجعية.');
      }
    } else {
      setIsExtracting(false);
      setExtractionError('لم يتم العثور على مقررات. يرجى استخدام الإشارة المرجعية لاستخراج المقررات من صفحة بوابة جامعة القصيم. انقر على "إعداد الإشارة المرجعية" في القسم الرئيسي أعلاه للبدء.');
    }
  };

  return (
    <div className="app" dir="rtl">
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
              ➕ إضافة مقرر يدوياً
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
              const message = `✅ تم إضافة المقرر "${course.code}" بنجاح! تحقق من قائمة المقررات في اللوحة اليمنى.`;
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

