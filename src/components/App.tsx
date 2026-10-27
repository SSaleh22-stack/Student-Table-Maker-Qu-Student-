import React, { useState } from 'react';
import { LanguageProvider, useLanguage } from '../contexts/LanguageContext';
import { TimetableProvider } from '../contexts/TimetableContext';
import Icon from './Icon';
import NavBar from './NavBar';
import HeroSection from './HeroSection';
import CourseList from './CourseList';
import TimetableGrid from './TimetableGrid';
import OfferedCoursesModal from './OfferedCoursesModal';
import AddCourseModal from './AddCourseModal';
import GpaCalculator from './GpaCalculator';
import AbsenceCalculator from './AbsenceCalculator';
import { Course } from '../types';
import './theme.css';
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
  const { language } = useLanguage();
  const [currentView, setCurrentView] = useState<ViewMode>('timetable');

  // Check for GPA data on mount and navigate to GPA page if present
  React.useEffect(() => {
    const checkForGpaData = async () => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['gpaData'], (result) => {
          if (result.gpaData) {
            // Navigate to GPA page
            setCurrentView('gpa');
            // Clear the stored data after using it
            chrome.storage.local.remove(['gpaData']);
          }
        });
      }

      // Also check URL parameter
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

  // Keep the page language and direction in sync for screen readers and fonts
  React.useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);

  return (
    <div className="app" dir={language === 'ar' ? 'rtl' : 'ltr'}>
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
                const message = language === 'en'
                  ? `Course "${course.code}" was added. You can find it in the offered courses list.`
                  : `تمت إضافة المقرر "${course.code}" بنجاح. تجده في قائمة المقررات المطروحة.`;
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
