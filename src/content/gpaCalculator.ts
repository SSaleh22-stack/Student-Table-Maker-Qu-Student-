/**
 * Content script for QU academic record page
 * Adds a button next to "السجل الأكاديمي" to extract GPA and calculate new GPA
 * Works similarly to the course extractor button
 */

// Check if extension context is valid BEFORE importing modules
let extensionContextValid = false;
try {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    extensionContextValid = true;
  }
} catch (e) {
  // Extension context invalidated - chrome.runtime access throws an error
  extensionContextValid = false;
  console.warn('Extension context invalidated. Please refresh the page to use the extension.');
}

// Helper function to check if runtime is valid
function isRuntimeValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id !== undefined;
  } catch (e) {
    return false;
  }
}

// Global error handler for extension context invalidated errors
const handleContextInvalidated = (error: any): boolean => {
  const errorMsg = error?.message || String(error);
  if (errorMsg.includes('Extension context invalidated') || 
      errorMsg.includes('message port closed') ||
      errorMsg.includes('context invalidated')) {
    console.warn('Extension context invalidated. Please refresh the page to use the extension.');
    return true; // Indicate error was handled
  }
  return false; // Error was not handled
};

// Set up global error handlers immediately to catch errors during script execution
if (typeof window !== 'undefined') {
  // Catch synchronous errors
  const originalErrorHandler = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    if (message && typeof message === 'string' && 
        (message.includes('Extension context invalidated') || 
         message.includes('message port closed'))) {
      handleContextInvalidated({ message });
      return true; // Prevent default error handling
    }
    if (originalErrorHandler) {
      return originalErrorHandler(message, source, lineno, colno, error);
    }
    return false;
  };

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && (
        (event.reason.message && event.reason.message.includes('Extension context invalidated')) ||
        (typeof event.reason === 'string' && event.reason.includes('Extension context invalidated'))
      )) {
      handleContextInvalidated(event.reason);
      event.preventDefault();
    }
  }, { once: false });
}

import { extractGPAFromDom, GPAData } from './extractGPA';
import {
  CourseGrade,
  GradeLetter,
  GradePointMap,
  GPAScale,
  getDefaultGradePoints,
  calcQualityPoints,
  calcTotalHours,
  calcSemesterGpa,
  calcNewCumulativeGpa,
} from '../lib/gpa';

// Language preference
let currentLanguage: 'en' | 'ar' = 'ar';

// Load language preference
function loadLanguage() {
  try {
    if (!isRuntimeValid()) {
      return; // Extension context invalidated, can't load language
    }
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.get(['language'], (result) => {
        try {
          if (result.language === 'en' || result.language === 'ar') {
            currentLanguage = result.language;
          }
        } catch (e) {
          // Context invalidated during callback
          console.warn('Extension context invalidated while loading language');
        }
      });
    }
  } catch (error) {
    // Context invalidated - can't access chrome.storage
    if (error instanceof Error && 
        (error.message.includes('Extension context invalidated') || 
         error.message.includes('message port closed'))) {
      console.warn('Extension context invalidated. Please refresh the page.');
    } else {
      console.warn('Error loading language preference:', error);
    }
  }
}

// Translations
const translations = {
  en: {
    buttonText: '📊 Calculate New GPA',
    modalTitle: 'GPA Calculator',
    prevGpa: 'Previous GPA',
    prevHours: 'Earned Hours',
    termNumber: 'Term',
    addCourse: 'Add Course',
    courseName: 'Course Name',
    grade: 'Grade',
    hours: 'Hours',
    points: 'Points',
    actions: 'Actions',
    remove: 'Remove',
    duplicate: 'Duplicate',
    semesterGpa: 'Semester GPA',
    newCumulativeGpa: 'New Cumulative GPA',
    currentHours: 'Current Hours',
    totalHours: 'Total Hours',
    close: 'Close',
    clearAll: 'Clear All',
    notSpecified: 'Not Specified',
  },
  ar: {
    buttonText: '📊 حساب المعدل التراكمي',
    modalTitle: 'حاسبة المعدل التراكمي',
    prevGpa: 'المعدل التراكمي السابق',
    prevHours: 'الساعات المكتسبة',
    termNumber: 'الفصل',
    addCourse: 'إضافة مقرر',
    courseName: 'اسم المقرر',
    grade: 'التقدير',
    hours: 'الساعات',
    points: 'النقاط',
    actions: 'الإجراءات',
    remove: 'حذف',
    duplicate: 'نسخ',
    semesterGpa: 'معدل الفصل',
    newCumulativeGpa: 'المعدل التراكمي الجديد',
    currentHours: 'الساعات الحالية',
    totalHours: 'إجمالي الساعات',
    close: 'إغلاق',
    clearAll: 'مسح الكل',
    notSpecified: 'غير محدد',
  },
};

function t(key: keyof typeof translations.en): string {
  return translations[currentLanguage][key];
}

// GPA Calculator Modal
class GPACalculatorModal {
  private modal: HTMLDivElement | null = null;
  private gpaData: GPAData | null = null;
  private courses: CourseGrade[] = [{ id: '1', title: '', hours: 0, grade: '' }];
  private scale: GPAScale = 5;
  private gradePointMap: GradePointMap = getDefaultGradePoints(5);

  constructor(gpaData: GPAData) {
    this.gpaData = gpaData;
    this.createModal();
  }

  private createModal() {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'qu-gpa-calculator-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.6);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.3s ease-out;
    `;

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'qu-gpa-calculator-modal';
    modal.style.cssText = `
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      max-width: 900px;
      width: 90%;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
      animation: slideUp 0.3s ease-out;
      direction: ${currentLanguage === 'ar' ? 'rtl' : 'ltr'};
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    `;

    // Add styles
    this.addStyles();

    // Modal content
    modal.innerHTML = this.getModalHTML();

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    this.modal = overlay;

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.close();
      }
    });

    // Setup event listeners
    this.setupEventListeners(modal);
  }

  private addStyles() {
    if (document.getElementById('qu-gpa-calculator-styles')) return;

    const style = document.createElement('style');
    style.id = 'qu-gpa-calculator-styles';
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from { transform: translateY(30px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      #qu-gpa-calculator-modal {
        padding: 24px;
      }
      #qu-gpa-calculator-modal h2 {
        margin: 0 0 20px 0;
        color: #333;
        font-size: 24px;
      }
      #qu-gpa-calculator-modal .gpa-info {
        background: #f5f5f5;
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 20px;
      }
      #qu-gpa-calculator-modal .gpa-info-item {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      #qu-gpa-calculator-modal .gpa-info-label {
        font-weight: 600;
        color: #555;
      }
      #qu-gpa-calculator-modal .gpa-info-value {
        color: #333;
        font-size: 18px;
      }
      #qu-gpa-calculator-modal table {
        width: 100%;
        border-collapse: collapse;
        margin: 20px 0;
      }
      #qu-gpa-calculator-modal th {
        background: #667eea;
        color: white;
        padding: 12px;
        text-align: ${currentLanguage === 'ar' ? 'right' : 'left'};
        font-weight: 600;
      }
      #qu-gpa-calculator-modal td {
        padding: 10px;
        border-bottom: 1px solid #e0e0e0;
      }
      #qu-gpa-calculator-modal input,
      #qu-gpa-calculator-modal select {
        width: 100%;
        padding: 8px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 14px;
      }
      #qu-gpa-calculator-modal .gpa-btn {
        padding: 10px 20px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        transition: all 0.2s;
      }
      #qu-gpa-calculator-modal .gpa-btn-primary {
        background: #667eea;
        color: white;
      }
      #qu-gpa-calculator-modal .gpa-btn-primary:hover {
        background: #5568d3;
      }
      #qu-gpa-calculator-modal .gpa-btn-secondary {
        background: #48bb78;
        color: white;
      }
      #qu-gpa-calculator-modal .gpa-btn-secondary:hover {
        background: #38a169;
      }
      #qu-gpa-calculator-modal .gpa-btn-danger {
        background: #e53e3e;
        color: white;
      }
      #qu-gpa-calculator-modal .gpa-btn-danger:hover {
        background: #c53030;
      }
      #qu-gpa-calculator-modal .gpa-results {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 20px;
        border-radius: 8px;
        margin-top: 20px;
      }
      #qu-gpa-calculator-modal .gpa-results h3 {
        margin: 0 0 15px 0;
        color: white;
      }
      #qu-gpa-calculator-modal .gpa-result-item {
        display: flex;
        justify-content: space-between;
        margin-bottom: 10px;
        font-size: 16px;
      }
      #qu-gpa-calculator-modal .gpa-result-big {
        font-size: 28px;
        font-weight: 700;
      }
      #qu-gpa-calculator-modal .gpa-actions {
        display: flex;
        gap: 10px;
        margin-top: 20px;
      }
      #qu-gpa-calculator-modal .gpa-close-btn {
        position: absolute;
        top: 15px;
        ${currentLanguage === 'ar' ? 'left' : 'right'}: 15px;
        background: none;
        border: none;
        font-size: 28px;
        cursor: pointer;
        color: #666;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.2s;
      }
      #qu-gpa-calculator-modal .gpa-close-btn:hover {
        background: #f0f0f0;
        color: #333;
      }
    `;
    document.head.appendChild(style);
  }

  private getModalHTML(): string {
    const prevGpa = this.gpaData?.cumulativeGPA || 0;
    const prevHours = this.gpaData?.earnedHours || 0;
    const termNumber = this.gpaData?.termNumber || '';

    return `
      <button class="gpa-close-btn" onclick="this.closest('#qu-gpa-calculator-overlay').remove()">×</button>
      <h2>${t('modalTitle')}</h2>
      
      <div class="gpa-info">
        <div class="gpa-info-item">
          <span class="gpa-info-label">${t('prevGpa')}:</span>
          <span class="gpa-info-value">${prevGpa.toFixed(2)}</span>
        </div>
        <div class="gpa-info-item">
          <span class="gpa-info-label">${t('prevHours')}:</span>
          <span class="gpa-info-value">${prevHours.toFixed(1)}</span>
        </div>
        ${termNumber ? `
        <div class="gpa-info-item">
          <span class="gpa-info-label">${t('termNumber')}:</span>
          <span class="gpa-info-value">${termNumber}</span>
        </div>
        ` : ''}
      </div>

      <div class="gpa-actions">
        <button class="gpa-btn gpa-btn-secondary" id="gpa-add-course-btn">+ ${t('addCourse')}</button>
        <button class="gpa-btn gpa-btn-danger" id="gpa-clear-all-btn">${t('clearAll')}</button>
        <button class="gpa-btn gpa-btn-primary" id="gpa-open-dashboard-btn">${currentLanguage === 'ar' ? 'فتح لوحة التحكم' : 'Open Dashboard'}</button>
      </div>

      <table id="gpa-courses-table">
        <thead>
          <tr>
            <th>${t('courseName')}</th>
            <th>${t('grade')}</th>
            <th>${t('hours')}</th>
            <th>${t('points')}</th>
            <th>${t('actions')}</th>
          </tr>
        </thead>
        <tbody id="gpa-courses-tbody">
          ${this.renderCourses()}
        </tbody>
      </table>

      <div class="gpa-results" id="gpa-results">
        ${this.renderResults()}
      </div>
    `;
  }

  private renderCourses(): string {
    const gradeOptions: GradeLetter[] = ['', 'A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F', 'DN'];
    
    return this.courses.map((course, index) => {
      const coursePoints = course.grade && course.hours > 0
        ? (this.gradePointMap[course.grade] || 0) * course.hours
        : 0;
      
      return `
        <tr data-course-id="${course.id}">
          <td>
            <input type="text" 
                   value="${course.title || ''}" 
                   placeholder="${t('courseName')}"
                   data-field="title"
                   class="gpa-course-input" />
          </td>
          <td>
            <select data-field="grade" class="gpa-course-select">
              ${gradeOptions.map(grade => `
                <option value="${grade}" ${course.grade === grade ? 'selected' : ''}>
                  ${grade || t('notSpecified')}
                </option>
              `).join('')}
            </select>
          </td>
          <td>
            <input type="number" 
                   min="0" 
                   step="0.5" 
                   value="${course.hours}" 
                   data-field="hours"
                   class="gpa-course-input" />
          </td>
          <td class="gpa-points-cell">${coursePoints.toFixed(2)}</td>
          <td>
            <button class="gpa-btn gpa-btn-secondary" 
                    data-action="duplicate" 
                    title="${t('duplicate')}">📋</button>
            <button class="gpa-btn gpa-btn-danger" 
                    data-action="remove" 
                    ${this.courses.length === 1 ? 'disabled' : ''}
                    title="${t('remove')}">×</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  private renderResults(): string {
    const prevGpa = this.gpaData?.cumulativeGPA || 0;
    const prevHours = this.gpaData?.earnedHours || 0;
    const currentHours = calcTotalHours(this.courses);
    const currentQualityPoints = calcQualityPoints(this.courses, this.gradePointMap);
    const semesterGpa = calcSemesterGpa(this.courses, this.gradePointMap);
    const cumulativeGpa = calcNewCumulativeGpa(prevGpa, prevHours, this.courses, this.gradePointMap);

    return `
      <h3>${t('semesterGpa')}</h3>
      <div class="gpa-result-item">
        <span>${t('currentHours')}:</span>
        <span>${currentHours.toFixed(1)}</span>
      </div>
      <div class="gpa-result-item">
        <span>${t('semesterGpa')}:</span>
        <span class="gpa-result-big">${semesterGpa !== null ? semesterGpa.toFixed(2) : '—'}</span>
      </div>
      
      <h3 style="margin-top: 20px;">${t('newCumulativeGpa')}</h3>
      <div class="gpa-result-item">
        <span>${t('totalHours')}:</span>
        <span>${(prevHours + currentHours).toFixed(1)}</span>
      </div>
      <div class="gpa-result-item">
        <span>${t('newCumulativeGpa')}:</span>
        <span class="gpa-result-big">${cumulativeGpa !== null ? cumulativeGpa.toFixed(2) : '—'}</span>
      </div>
    `;
  }

  private setupEventListeners(modal: HTMLDivElement) {
    // Add course button
    const addBtn = modal.querySelector('#gpa-add-course-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const newId = Date.now().toString();
        this.courses.push({ id: newId, title: '', hours: 0, grade: '' });
        this.updateModal();
      });
    }

    // Clear all button
    const clearBtn = modal.querySelector('#gpa-clear-all-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm(currentLanguage === 'ar' 
          ? 'هل أنت متأكد من مسح جميع المقررات؟'
          : 'Are you sure you want to clear all courses?')) {
          this.courses = [{ id: '1', title: '', hours: 0, grade: '' }];
          this.updateModal();
        }
      });
    }

    // Open dashboard button
    const dashboardBtn = modal.querySelector('#gpa-open-dashboard-btn');
    if (dashboardBtn) {
      dashboardBtn.addEventListener('click', () => {
        // Check if runtime is valid before using it
        if (!isRuntimeValid()) {
          const errorText = currentLanguage === 'ar' 
            ? '⚠️ تم إعادة تحميل الإضافة. يرجى تحديث الصفحة والمحاولة مرة أخرى.'
            : '⚠️ Extension was reloaded. Please refresh the page and try again.';
          alert(errorText);
          return;
        }

        try {
          // Prepare GPA data to send to dashboard
          const gpaData = {
            cumulativeGPA: this.gpaData?.cumulativeGPA || 0,
            earnedHours: this.gpaData?.earnedHours || 0,
            termNumber: this.gpaData?.termNumber || '',
            courses: this.courses,
            scale: this.scale,
            gradePointMap: this.gradePointMap,
          };
          
          chrome.runtime.sendMessage({ 
            type: 'OPEN_DASHBOARD_WITH_GPA',
            payload: gpaData
          }, (response) => {
            try {
              if (chrome.runtime.lastError) {
                const errorMsg = chrome.runtime.lastError.message;
                // Check if it's a context invalidated error
                if (errorMsg.includes('Extension context invalidated') || 
                    errorMsg.includes('message port closed') ||
                    errorMsg.includes('context invalidated')) {
                  const errorText = currentLanguage === 'ar' 
                    ? '⚠️ تم إعادة تحميل الإضافة. يرجى تحديث الصفحة والمحاولة مرة أخرى.'
                    : '⚠️ Extension was reloaded. Please refresh the page and try again.';
                  alert(errorText);
                } else {
                  console.error('Error opening dashboard:', chrome.runtime.lastError);
                  // Fallback: try to open dashboard.html directly
                  try {
                    const dashboardUrl = chrome.runtime.getURL('dashboard.html?gpa=true');
                    window.open(dashboardUrl, '_blank');
                  } catch (e) {
                    console.error('Failed to open dashboard:', e);
                  }
                }
              }
            } catch (e) {
              // Context invalidated - can't access chrome.runtime
              const errorText = currentLanguage === 'ar' 
                ? '⚠️ تم إعادة تحميل الإضافة. يرجى تحديث الصفحة والمحاولة مرة أخرى.'
                : '⚠️ Extension was reloaded. Please refresh the page and try again.';
              alert(errorText);
            }
          });
        } catch (e) {
          // Context invalidated - can't access chrome.runtime
          const errorMsg = e instanceof Error ? e.message : String(e);
          if (errorMsg.includes('Extension context invalidated') || 
              errorMsg.includes('message port closed')) {
            const errorText = currentLanguage === 'ar' 
              ? '⚠️ تم إعادة تحميل الإضافة. يرجى تحديث الصفحة والمحاولة مرة أخرى.'
              : '⚠️ Extension was reloaded. Please refresh the page and try again.';
            alert(errorText);
          } else {
            console.error('Error opening dashboard:', e);
          }
        }
      });
    }

    // Course input changes
    const tbody = modal.querySelector('#gpa-courses-tbody');
    if (tbody) {
      tbody.addEventListener('input', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('gpa-course-input') || target.classList.contains('gpa-course-select')) {
          const row = target.closest('tr');
          if (row) {
            const courseId = row.getAttribute('data-course-id');
            const field = target.getAttribute('data-field');
            if (courseId && field) {
              const course = this.courses.find(c => c.id === courseId);
              if (course) {
                if (field === 'hours') {
                  course.hours = parseFloat((target as HTMLInputElement).value) || 0;
                } else if (field === 'title') {
                  course.title = (target as HTMLInputElement).value;
                } else if (field === 'grade') {
                  course.grade = (target as HTMLSelectElement).value as GradeLetter;
                }
                this.updateModal();
              }
            }
          }
        }
      });

      // Action buttons
      tbody.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.hasAttribute('data-action')) {
          const row = target.closest('tr');
          if (row) {
            const courseId = row.getAttribute('data-course-id');
            const action = target.getAttribute('data-action');
            if (courseId && action) {
              if (action === 'remove' && this.courses.length > 1) {
                this.courses = this.courses.filter(c => c.id !== courseId);
                this.updateModal();
              } else if (action === 'duplicate') {
                const course = this.courses.find(c => c.id === courseId);
                if (course) {
                  const newId = Date.now().toString();
                  this.courses.push({ ...course, id: newId });
                  this.updateModal();
                }
              }
            }
          }
        }
      });
    }
  }

  private updateModal() {
    if (!this.modal) return;
    const modal = this.modal.querySelector('#qu-gpa-calculator-modal');
    if (modal) {
      const tbody = modal.querySelector('#gpa-courses-tbody');
      const results = modal.querySelector('#gpa-results');
      if (tbody) {
        tbody.innerHTML = this.renderCourses();
      }
      if (results) {
        results.innerHTML = this.renderResults();
      }
    }
  }

  public close() {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  }
}

// Function to extract GPA and show calculator
function extractAndShowGPA() {
  // Wait for page to fully load and data to be available
  const checkAndShow = (attempts = 0) => {
    const gpaData = extractGPAFromDom(document);
    
    if (gpaData) {
      // Data is available, show modal
      new GPACalculatorModal(gpaData);
    } else if (attempts < 10) {
      // Data not ready yet, try again
      setTimeout(() => checkAndShow(attempts + 1), 500);
    } else {
      // Max attempts reached, show error
      alert(currentLanguage === 'ar' 
        ? 'لم يتم العثور على بيانات المعدل التراكمي. يرجى التأكد من أنك على صفحة السجل الأكاديمي.'
        : 'GPA data not found. Please make sure you are on the academic record page.');
    }
  };
  
  checkAndShow();
}

// Function to check if page contains "السجل الأكاديمي" title (exact full word match)
function checkForAcademicRecordTitle(): boolean {
  // Check if the exact full phrase "السجل الأكاديمي" exists in the DOM
  const exactPhrase = 'السجل الأكاديمي';
  const allElements = document.querySelectorAll('*');
  
  for (const el of allElements) {
    const text = el.textContent || '';
    
    // Check if the exact phrase exists
    if (text.includes(exactPhrase)) {
      // Verify it's the full word, not part of another word
      const index = text.indexOf(exactPhrase);
      if (index !== -1) {
        // Check characters before and after to ensure it's a complete word
        const charBefore = index > 0 ? text[index - 1] : '';
        const charAfter = index + exactPhrase.length < text.length 
          ? text[index + exactPhrase.length] 
          : '';
        
        // Allow if at start/end of text, or surrounded by whitespace/punctuation
        // Arabic text doesn't use spaces between words in the same way, so we check for:
        // - Start or end of text
        // - Whitespace characters
        // - Common punctuation
        const isStartOrEnd = index === 0 || index + exactPhrase.length === text.length;
        const isSurroundedByWhitespace = /\s/.test(charBefore) || /\s/.test(charAfter);
        const isSurroundedByPunctuation = /[،,.\-:;]/.test(charBefore) || /[،,.\-:;]/.test(charAfter);
        
        // Also check if the element itself contains only this text (most reliable)
        const trimmedText = text.trim();
        if (trimmedText === exactPhrase || 
            isStartOrEnd || 
            isSurroundedByWhitespace || 
            isSurroundedByPunctuation) {
          return true;
        }
      }
    }
  }
  
  return false;
}

// Function to check if we're on the academic record page (by checking for title)
function isAcademicRecordPage(): boolean {
  return checkForAcademicRecordTitle();
}

// Inject button next to "السجل الأكاديمي" table
function injectGPACalculatorButton() {
  // Double check we're on the academic record page
  if (!isAcademicRecordPage()) {
    return;
  }
  
  // Check if button already exists
  if (document.getElementById('qu-gpa-calculator-btn')) {
    return;
  }

  // Create button
  const button = document.createElement('button');
  button.id = 'qu-gpa-calculator-btn';
  button.type = 'button'; // Prevent form submission
  button.innerHTML = t('buttonText');
  button.style.cssText = `
    margin: 0 0 0 8px;
    padding: 12px 32px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    transition: all 0.3s;
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    direction: ${currentLanguage === 'ar' ? 'rtl' : 'ltr'};
    white-space: nowrap;
    min-height: 44px;
    min-width: 200px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    vertical-align: middle;
  `;

  button.addEventListener('mouseenter', () => {
    button.style.transform = 'translateY(-2px)';
    button.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'translateY(0)';
    button.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
  });

  button.addEventListener('click', (e) => {
    // Prevent any default behavior or page reload
    e.preventDefault();
    e.stopPropagation();
    
    // We're on the academic record page, extract GPA and show calculator
    extractAndShowGPA();
    
    return false;
  });

  // Function to find and insert button next to "* هذا السجل لا يستخدم للأغراض الرسمية"
  function insertButtonAtTarget() {
    // Strategy 1: Find the td with class "fontTextRed" containing "هذا السجل لا يستخدم للأغراض الرسمية"
    const fontTextRedTds = document.querySelectorAll('td.fontTextRed');
    let targetTd: HTMLTableCellElement | null = null;
    
    for (const td of fontTextRedTds) {
      const text = td.textContent || '';
      if (text.includes('هذا السجل لا يستخدم للأغراض الرسمية')) {
        targetTd = td as HTMLTableCellElement;
        break;
      }
    }
    
    if (targetTd) {
      // Find the table row containing this td
      const parentRow = targetTd.closest('tr');
      if (parentRow) {
        // Insert button in the same row, next to the text
        // Check if there's already a second cell (for the print button)
        const cells = parentRow.querySelectorAll('td');
        if (cells.length >= 2) {
          // There's already a second cell (print button), insert button after the first cell
          const buttonCell = document.createElement('td');
          buttonCell.style.paddingLeft = '2px';
          buttonCell.style.verticalAlign = 'middle';
          buttonCell.appendChild(button);
          parentRow.insertBefore(buttonCell, cells[1]);
          return true;
        } else {
          // Only one cell, add button directly in the same cell or very close
          // Try to add it directly in the same td for maximum closeness
          const spacer = document.createTextNode(' ');
          targetTd.appendChild(spacer);
          targetTd.appendChild(button);
          return true;
        }
      }
    }
    
    // Strategy 2: Find by table structure - table with width="100%" containing the text
    const tables = document.querySelectorAll('table[width="100%"]');
    for (const table of tables) {
      const fontTextRedTd = table.querySelector('td.fontTextRed');
      if (fontTextRedTd && fontTextRedTd.textContent?.includes('هذا السجل لا يستخدم للأغراض الرسمية')) {
        // Find the parent row
        const parentRow = fontTextRedTd.closest('tr');
        if (parentRow) {
          // Insert button directly in the same cell for maximum closeness
          const spacer = document.createTextNode(' ');
          fontTextRedTd.appendChild(spacer);
          fontTextRedTd.appendChild(button);
          return true;
        }
      }
    }
    
    // Fallback: Append to body
    if (document.body) {
      document.body.appendChild(button);
      return true;
    }
    
    return false;
  }

  // Try to insert at target location
  if (document.body) {
    const inserted = insertButtonAtTarget();
    if (!inserted) {
      // Fallback: wait a bit and try again (page might still be loading)
      setTimeout(() => {
        if (!document.getElementById('qu-gpa-calculator-btn')) {
          insertButtonAtTarget() || document.body.appendChild(button);
        }
      }, 500);
    }
  } else {
    // Wait for body to be available
    const observer = new MutationObserver((mutations, obs) => {
      if (document.body) {
        const inserted = insertButtonAtTarget();
        if (!inserted) {
          document.body.appendChild(button);
        }
        obs.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
}

// Initialize - similar to course extractor button
loadLanguage();

// Inject button when page loads - similar to course extractor button
function injectGPACalculatorButtonOnLoad() {
  // Check if title exists (page might have loaded dynamically)
  const hasTitle = checkForAcademicRecordTitle();
  
  if (hasTitle) {
    // Title found - inject button
    injectGPACalculatorButton();
    
    // Also listen for DOM changes to detect when title appears/disappears
    const domObserver = new MutationObserver(() => {
      const titleExists = checkForAcademicRecordTitle();
      const button = document.getElementById('qu-gpa-calculator-btn');
      
      if (titleExists && !button) {
        // Title found but button doesn't exist, inject it
        setTimeout(() => {
          if (!document.getElementById('qu-gpa-calculator-btn')) {
            injectGPACalculatorButton();
          }
        }, 500);
      } else if (!titleExists && button) {
        // Title not found but button exists, remove it
        button.remove();
      }
    });
    
    // Wait for body to be available before observing
    if (document.body) {
      domObserver.observe(document.body, { 
        childList: true, 
        subtree: true 
      });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) {
          domObserver.observe(document.body, { 
            childList: true, 
            subtree: true 
          });
        }
      });
    }

    // Check if we should auto-open the calculator (e.g., from a redirect)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('openGpaCalculator') === 'true') {
      // Wait for page to fully load before showing calculator
      const checkAndShow = (attempts = 0) => {
        const gpaData = extractGPAFromDom(document);
        if (gpaData) {
          // Page is loaded and GPA data is available, show calculator
          new GPACalculatorModal(gpaData);
          // Remove the URL parameter to prevent reopening on refresh
          const newUrl = window.location.href.split('?')[0];
          window.history.replaceState({}, '', newUrl);
        } else if (attempts < 20) {
          // Page still loading, check again (max 20 attempts = 10 seconds)
          setTimeout(() => checkAndShow(attempts + 1), 500);
        }
      };
      
      // Start checking after initial delay
      setTimeout(() => checkAndShow(), 1000);
    }
  }
  
  // Listen for language changes (always, regardless of page)
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes.language) {
        const newLang = changes.language.newValue;
        if (newLang === 'en' || newLang === 'ar') {
          currentLanguage = newLang;
          const button = document.getElementById('qu-gpa-calculator-btn');
          if (button) {
            button.innerHTML = t('buttonText');
            button.style.direction = currentLanguage === 'ar' ? 'rtl' : 'ltr';
          }
        }
      }
    });
  }
}

// Inject button when page loads - similar to course extractor button
try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try {
        setTimeout(injectGPACalculatorButtonOnLoad, 500);
      } catch (error) {
        console.error('Error injecting GPA calculator button:', error);
      }
    });
  } else {
    try {
      setTimeout(injectGPACalculatorButtonOnLoad, 500);
    } catch (error) {
      console.error('Error injecting GPA calculator button:', error);
    }
  }
} catch (error) {
  console.error('Error setting up GPA calculator button injection:', error);
}

