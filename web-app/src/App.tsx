import React, { useState } from 'react';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { TimetableProvider } from './contexts/TimetableContext';
import NavBar from './components/NavBar';
import HeroSection from './components/HeroSection';
import CourseList from './components/CourseList';
import TimetableGrid from './components/TimetableGrid';
import OfferedCoursesModal from './components/OfferedCoursesModal';
import AddCourseModal from './components/AddCourseModal';
import ReviewHelperModal from './components/ReviewHelperModal';
import GpaCalculator from './components/GpaCalculator';
import AbsenceCalculator from './components/AbsenceCalculator';
import { Course } from './types';
import './App.css';

type ViewMode = 'timetable' | 'gpa' | 'absence';

const AppContent: React.FC = () => {
  const { language, t } = useLanguage();
  
  // Detect if device is a phone (max-width: 768px)
  const [isPhone, setIsPhone] = useState(false);
  
  React.useEffect(() => {
    const checkIsPhone = () => {
      setIsPhone(window.innerWidth <= 768);
    };
    
    checkIsPhone();
    window.addEventListener('resize', checkIsPhone);
    return () => window.removeEventListener('resize', checkIsPhone);
  }, []);
  
  // On phones, default to GPA calculator instead of timetable
  const [currentView, setCurrentView] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      return 'gpa';
    }
    return 'timetable';
  });
  
  // Redirect to GPA if trying to access timetable on phone
  React.useEffect(() => {
    if (isPhone && currentView === 'timetable') {
      setCurrentView('gpa');
    }
  }, [isPhone, currentView]);
  
  const handleViewChange = (view: ViewMode) => {
    // Prevent accessing timetable on phones
    if (view === 'timetable' && isPhone) {
      return;
    }
    setCurrentView(view);
  };
  const [courses, setCourses] = useState<Course[]>([]);
  const [showOfferedCoursesModal, setShowOfferedCoursesModal] = useState(false);
  const [showAddCourseModal, setShowAddCourseModal] = useState(false);
  const [showReviewHelper, setShowReviewHelper] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Load courses from localStorage on mount and check for updates
  React.useEffect(() => {
    const loadCourses = (showMessage = true) => {
      try {
        // First, check URL hash for course data (from bookmarklet)
        const urlHash = window.location.hash;
        if (urlHash && urlHash.startsWith('#courses=')) {
          try {
            const encodedData = urlHash.substring(9); // Remove '#courses='
            const decodedData = decodeURIComponent(encodedData);
            const coursesFromUrl = JSON.parse(decodedData);
            console.log('Loading courses from URL hash:', coursesFromUrl?.length, 'courses');
            if (Array.isArray(coursesFromUrl) && coursesFromUrl.length > 0) {
              // Save to localStorage
              localStorage.setItem('qu-student-courses', JSON.stringify(coursesFromUrl));
              localStorage.setItem('qu-student-courses-timestamp', Date.now().toString());
              // Clear the hash
              window.history.replaceState(null, '', window.location.pathname + window.location.search);
              // Set courses
              setCourses(coursesFromUrl);
              setIsLoading(false);
              setIsInitialLoad(false);
              if (showMessage) {
                const message = language === 'en'
                  ? `✅ Loaded ${coursesFromUrl.length} courses from bookmarklet!`
                  : `✅ تم تحميل ${coursesFromUrl.length} مقرر من الإشارة المرجعية!`;
                setSuccessMessage(message);
                setTimeout(() => setSuccessMessage(null), 5000);
              }
              return;
            }
          } catch (urlError) {
            console.error('Error parsing courses from URL:', urlError);
          }
        }
        
        const saved = localStorage.getItem('qu-student-courses');
        console.log('Loading courses from localStorage:', saved ? `Found ${saved.length} chars` : 'No data');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            console.log('Parsed courses:', parsed, 'Type:', typeof parsed, 'Is Array:', Array.isArray(parsed), 'Length:', parsed?.length);
            if (Array.isArray(parsed) && parsed.length > 0) {
              console.log('Setting courses:', parsed.length, 'courses');
              setCourses(parsed);
              setIsLoading(false);
              setIsInitialLoad(false);
              const timestamp = localStorage.getItem('qu-student-courses-timestamp');
              if (timestamp && showMessage) {
                const message = language === 'en'
                  ? `✅ Loaded ${parsed.length} courses from bookmarklet extraction!`
                  : `✅ تم تحميل ${parsed.length} مقرر من استخراج الإشارة المرجعية!`;
                setSuccessMessage(message);
                setTimeout(() => setSuccessMessage(null), 5000);
              }
            } else {
            console.warn('No valid courses found in localStorage - parsed:', parsed, 'Type:', typeof parsed, 'Is Array:', Array.isArray(parsed), 'Length:', parsed?.length);
            // Don't show error message for empty array - it's normal if no courses extracted yet
            setIsLoading(false);
            setIsInitialLoad(false);
            }
          } catch (parseError) {
            console.error('Error parsing courses from localStorage:', parseError, 'Raw data:', saved?.substring(0, 200));
            setIsLoading(false);
            setIsInitialLoad(false);
            if (showMessage) {
              const errorMsg = language === 'en'
                ? '❌ Error parsing courses data. Check console for details.'
                : '❌ خطأ في تحليل بيانات المقررات. تحقق من وحدة التحكم للتفاصيل.';
              setSuccessMessage(errorMsg);
              setTimeout(() => setSuccessMessage(null), 5000);
            }
          }
        } else {
          console.log('No courses data in localStorage');
          setIsLoading(false);
          setIsInitialLoad(false);
        }
      } catch (error) {
        console.error('Error loading courses:', error);
        setIsLoading(false);
        setIsInitialLoad(false);
        // Show error message
        if (showMessage) {
          const errorMsg = language === 'en'
            ? '❌ Error loading courses. Check console for details.'
            : '❌ خطأ في تحميل المقررات. تحقق من وحدة التحكم للتفاصيل.';
          setSuccessMessage(errorMsg);
          setTimeout(() => setSuccessMessage(null), 5000);
        }
      }
    };
    
    // Load immediately on mount
    loadCourses();
    
    // Initialize timestamp tracking
    const initialTimestamp = localStorage.getItem('qu-student-courses-timestamp');
    if (initialTimestamp) {
      (window as any).__lastCoursesTimestamp = initialTimestamp;
    }
    
    // Listen for storage changes (when bookmarklet runs on another tab)
    const handleStorageChange = (e: StorageEvent) => {
      console.log('Storage event:', e.key, e.newValue ? 'has new value' : 'no new value');
      if (e.key === 'qu-student-courses' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          console.log('Storage event - parsed courses:', parsed);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setCourses(parsed);
            const message = language === 'en'
              ? `✅ Updated! ${parsed.length} courses loaded from bookmarklet.`
              : `✅ تم التحديث! تم تحميل ${parsed.length} مقرر من الإشارة المرجعية.`;
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
        console.log('Detected new courses from bookmarklet, reloading...');
        loadCourses(true); // Show message when reloading
      }
    }, 500); // Check every 500ms for faster updates
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [language]);

  // Save courses to localStorage whenever they change (but don't overwrite if we're loading)
  React.useEffect(() => {
    // Don't save during initial load - wait until we've loaded from localStorage first
    if (isInitialLoad) {
      return;
    }
    
    // Only save if courses array has items (don't overwrite with empty array)
    // This prevents overwriting bookmarklet-extracted courses
    if (courses.length > 0) {
      try {
        console.log('Saving courses to localStorage:', courses.length, 'courses');
        localStorage.setItem('qu-student-courses', JSON.stringify(courses));
      } catch (error) {
        console.error('Error saving courses:', error);
      }
    }
  }, [courses, isInitialLoad]);

  const handleExtractCourses = () => {
    // Check if courses were extracted via bookmarklet
    const timestamp = localStorage.getItem('qu-student-courses-timestamp');
    if (timestamp && courses.length > 0) {
      const message = language === 'en'
        ? '✅ Courses are automatically loaded from bookmarklet! If you need to extract again, use the bookmarklet on the QU portal page.'
        : '✅ يتم تحميل المقررات تلقائياً من الإشارة المرجعية! إذا كنت بحاجة للاستخراج مرة أخرى، استخدم الإشارة المرجعية على صفحة بوابة جامعة القصيم.';
      setSuccessMessage(message);
      setTimeout(() => setSuccessMessage(null), 6000);
    } else {
      // Show instructions for bookmarklet setup
      const message = language === 'en'
        ? '📚 Use the bookmarklet to auto-extract courses! Click "Setup Bookmarklet" above, or manually add courses using "Add Course Manually".'
        : '📚 استخدم الإشارة المرجعية لاستخراج المقررات تلقائياً! انقر على "إعداد الإشارة المرجعية" أعلاه، أو أضف المقررات يدوياً باستخدام "إضافة مقرر يدوياً".';
      setSuccessMessage(message);
      setTimeout(() => setSuccessMessage(null), 8000);
    }
  };

  return (
    <div className="app" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <NavBar 
        currentView={currentView}
        onViewChange={handleViewChange}
        onShowReviewHelper={() => setShowReviewHelper(true)}
        isPhone={isPhone}
      />
      
      {currentView === 'timetable' ? (
        <>
          <HeroSection onExtractCourses={handleExtractCourses} />
          
          {isLoading && (
            <div className="success-message" style={{ background: '#bee3f8', color: '#2c5282' }}>
              <span className="success-icon">⏳</span>
              <span className="success-message-text">
                {language === 'en' ? 'Loading courses...' : 'جاري تحميل المقررات...'}
              </span>
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
            <button 
              className="refresh-courses-btn"
              onClick={() => {
                console.log('Manual refresh clicked');
                const saved = localStorage.getItem('qu-student-courses');
                console.log('localStorage data:', saved);
                if (saved) {
                  try {
                    const parsed = JSON.parse(saved);
                    console.log('Parsed courses:', parsed);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                      setCourses(parsed);
                      const message = language === 'en'
                        ? `✅ Refreshed! Loaded ${parsed.length} courses.`
                        : `✅ تم التحديث! تم تحميل ${parsed.length} مقرر.`;
                      setSuccessMessage(message);
                      setTimeout(() => setSuccessMessage(null), 5000);
                    } else {
                      const message = language === 'en'
                        ? '⚠️ No courses found in storage. Use bookmarklet to extract courses.'
                        : '⚠️ لم يتم العثور على مقررات في التخزين. استخدم الإشارة المرجعية لاستخراج المقررات.';
                      setSuccessMessage(message);
                      setTimeout(() => setSuccessMessage(null), 5000);
                    }
                  } catch (error) {
                    console.error('Error parsing:', error);
                    const message = language === 'en'
                      ? '❌ Error parsing courses data. Check console.'
                      : '❌ خطأ في تحليل بيانات المقررات. تحقق من وحدة التحكم.';
                    setSuccessMessage(message);
                    setTimeout(() => setSuccessMessage(null), 5000);
                  }
                } else {
                  const message = language === 'en'
                    ? '⚠️ No courses in storage. Extract courses using the bookmarklet first.'
                    : '⚠️ لا توجد مقررات في التخزين. استخرج المقررات باستخدام الإشارة المرجعية أولاً.';
                  setSuccessMessage(message);
                  setTimeout(() => setSuccessMessage(null), 5000);
                }
              }}
            >
              🔄 {language === 'en' ? 'Refresh Courses' : 'تحديث المقررات'}
            </button>
            <button 
              className="clear-courses-btn"
              onClick={() => {
                if (window.confirm(
                  language === 'en' 
                    ? 'Are you sure you want to clear all courses? This action cannot be undone.'
                    : 'هل أنت متأكد أنك تريد حذف جميع المقررات؟ لا يمكن التراجع عن هذا الإجراء.'
                )) {
                  setCourses([]);
                  localStorage.removeItem('qu-student-courses');
                  localStorage.removeItem('qu-student-courses-timestamp');
                  const message = language === 'en'
                    ? '✅ All courses have been cleared.'
                    : '✅ تم حذف جميع المقررات.';
                  setSuccessMessage(message);
                  setTimeout(() => setSuccessMessage(null), 5000);
                }
              }}
            >
              🗑️ {language === 'en' ? 'Clear All Courses' : 'حذف جميع المقررات'}
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
              setCourses((prev) => [...prev, course]);
              setShowAddCourseModal(false);
              const message = language === 'en'
                ? `✅ Course "${course.code}" has been added successfully!`
                : `✅ تم إضافة المقرر "${course.code}" بنجاح!`;
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
        <div className="app-content">
          <GpaCalculator />
        </div>
      ) : (
        <div className="app-content">
          <AbsenceCalculator />
        </div>
      )}

      <ReviewHelperModal
        isOpen={showReviewHelper}
        onClose={() => setShowReviewHelper(false)}
      />
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

