import React, { useState } from 'react';
import { LanguageProvider } from './contexts/LanguageContext';
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
import Icon from './components/Icon';
import './components/theme.css';
import './App.css';

type ViewMode = 'timetable' | 'gpa' | 'absence';

const AppContent: React.FC = () => {
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
  const [showOfferedCoursesModal, setShowOfferedCoursesModal] = useState(false);
  const [showAddCourseModal, setShowAddCourseModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Check for extracted courses from storage on mount
  React.useEffect(() => {
    // Function to parse courses from hash (reusable)
    const parseCoursesFromHash = () => {
      const hash = window.location.hash;
      if (hash && hash.includes('courses=')) {
        try {
          const hashParams = new URLSearchParams(hash.substring(1));
          const coursesParam = hashParams.get('courses');
          if (coursesParam) {
            const decoded = decodeURIComponent(coursesParam);
            const parsed = JSON.parse(decoded);
            if (parsed && Array.isArray(parsed) && parsed.length > 0) {
              console.log('✅ Loaded courses from URL hash:', parsed.length);
              setCourses(parsed);
              setCurrentView('timetable');
              // Also save to localStorage for consistency
              try {
                localStorage.setItem('qu-student-courses', JSON.stringify(parsed));
                localStorage.setItem('qu-student-courses-timestamp', Date.now().toString());
              } catch (e) {
                console.warn('Could not save to localStorage:', e);
              }
              // Clear hash to avoid re-parsing
              window.history.replaceState({}, '', window.location.pathname + window.location.search);
              const message = `تم تحميل ${parsed.length} مقرر من الإشارة المرجعية!`;
              setSuccessMessage(message);
              setTimeout(() => setSuccessMessage(null), 5000);
              return true; // Successfully loaded
            }
          }
        } catch (error) {
          console.error('Error parsing courses from URL hash:', error);
        }
      }
      return false; // No courses in hash
    };
    
    // FIRST: Check URL hash for courses (iPad Safari redirects with #courses=...)
    const hashLoaded = parseCoursesFromHash();
    if (hashLoaded) {
      // Courses loaded from hash, set up listeners and exit
      const handleHashChange = () => {
        parseCoursesFromHash();
      };
      window.addEventListener('hashchange', handleHashChange);
      return () => {
        window.removeEventListener('hashchange', handleHashChange);
      };
    }
    
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
    
    // Listen for hash changes (important for Safari iPad redirects)
    const handleHashChange = () => {
      parseCoursesFromHash();
    };
    
    window.addEventListener('hashchange', handleHashChange);
    
    // Listen for storage changes (when bookmarklet runs on another tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'qu-student-courses' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setCourses(parsed);
            setCurrentView('timetable');
            const message = `تم التحديث! تم تحميل ${parsed.length} مقرر من الإشارة المرجعية.`;
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
              const message = `تم التحديث! تم تحميل ${parsed.length} مقرر من الإشارة المرجعية.`;
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
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="app" dir="rtl">
      <div className="qs-shell">
        <NavBar currentView={currentView} onViewChange={setCurrentView} />

        {currentView === 'timetable' ? (
          <>
            <HeroSection
              hasCourses={courses.length > 0}
              onOpenOfferedCourses={() => setShowOfferedCoursesModal(true)}
              onAddCourse={() => setShowAddCourseModal(true)}
            />
            {successMessage && (
              <div className="qs-alert qs-alert-success" role="status">
                <Icon name="check" />
                <span>{successMessage}</span>
              </div>
            )}
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
                const message = `تمت إضافة المقرر "${course.code}" بنجاح. تجده في قائمة المقررات المطروحة.`;
                setSuccessMessage(message);
                setTimeout(() => setSuccessMessage(null), 5000);
              }}
            />
            <div className="qs-main">
              <div className="qs-main-timetable">
                <TimetableGrid />
              </div>
              <div className="qs-main-courses">
                <CourseList courses={courses} />
              </div>
            </div>
          </>
        ) : currentView === 'gpa' ? (
          <GpaCalculator />
        ) : (
          <AbsenceCalculator />
        )}
      </div>
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
