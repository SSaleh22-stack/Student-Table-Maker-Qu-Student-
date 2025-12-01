/**
 * Content script for QU student page
 * Injects a floating button to extract courses and listens for messages
 */

import { extractCoursesFromDom } from './extractCourses';
import { Course } from '../types';

// Prevent multiple executions
if ((window as any).__QU_COURSE_EXTRACTOR_LOADED__) {
  // Script already loaded, prevent redeclaration by using existing variables
  // Exit early by checking if button exists
  if (document.getElementById('qu-course-extractor-btn')) {
    // Already initialized, do nothing
  }
} else {
  (window as any).__QU_COURSE_EXTRACTOR_LOADED__ = true;
}

// Language preference - use window object to avoid redeclaration
if (!(window as any).__QU_COURSE_EXTRACTOR_LANG__) {
  (window as any).__QU_COURSE_EXTRACTOR_LANG__ = 'ar';
}
const currentLanguage = (window as any).__QU_COURSE_EXTRACTOR_LANG__ as 'en' | 'ar';

// Helper to get current language
function getCurrentLanguage(): 'en' | 'ar' {
  return ((window as any).__QU_COURSE_EXTRACTOR_LANG__ || 'ar') as 'en' | 'ar';
}

// Get button text based on language
function getButtonText(): string {
  return getCurrentLanguage() === 'en' 
    ? '📚 Extract Courses According to Plan'
    : '📚 استخراج المقررات المطروحة وفق الخطة';
}

// Get loading text based on language
function getLoadingText(): string {
  return getCurrentLanguage() === 'en'
    ? '<span style="padding-left: 30px;">Extracting...</span>'
    : '<span style="padding-right: 30px;">جاري الاستخراج...</span>';
}

// Get error text based on language
function getErrorText(): string {
  return getCurrentLanguage() === 'en'
    ? '❌ Extension Error'
    : '❌ خطأ في الإضافة';
}

// Get no courses text based on language
function getNoCoursesText(): string {
  return getCurrentLanguage() === 'en'
    ? '❌ No courses found'
    : '❌ لم يتم العثور على مقررات';
}

// Get generic error text based on language
function getGenericErrorText(): string {
  return getCurrentLanguage() === 'en'
    ? '❌ Error'
    : '❌ خطأ';
}

// Get success text based on language
function getSuccessText(): string {
  return getCurrentLanguage() === 'en'
    ? '✅ Extraction Complete!'
    : '✅ تم الاستخراج!';
}

// Load language preference
function loadLanguage() {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.sync.get(['language'], (result) => {
      if (result.language === 'en' || result.language === 'ar') {
        (window as any).__QU_COURSE_EXTRACTOR_LANG__ = result.language;
        updateButtonText();
      }
    });

    // Listen for language changes
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes.language) {
        const newLang = changes.language.newValue;
        if (newLang === 'en' || newLang === 'ar') {
          (window as any).__QU_COURSE_EXTRACTOR_LANG__ = newLang;
          updateButtonText();
        }
      }
    });
  }
}

// Update button text when language changes
function updateButtonText() {
  const button = document.getElementById('qu-course-extractor-btn') as HTMLButtonElement;
  if (button) {
    // Only update if button is in default state
    if (!button.classList.contains('loading') && !button.classList.contains('error') && !button.classList.contains('success')) {
      button.innerHTML = getButtonText();
      button.style.direction = getCurrentLanguage() === 'ar' ? 'rtl' : 'ltr';
    }
  }
}

// Inject floating button into the page
function injectExtractButton() {
  // Check if button already exists
  if (document.getElementById('qu-course-extractor-btn')) {
    return;
  }

  // Load language preference
  loadLanguage();

  // Style will be added later in insertButtonAtTarget function

  // Create button element
  const button = document.createElement('button');
  button.id = 'qu-course-extractor-btn';
  button.innerHTML = getButtonText();
  
  // Button styles will be set in insertButtonAtTarget function

  // Enhanced hover effects with shimmer
  button.addEventListener('mouseenter', () => {
    button.style.transform = 'translateY(-3px) scale(1.02)';
    button.style.boxShadow = '0 8px 25px rgba(102, 126, 234, 0.6)';
    button.style.borderColor = 'rgba(255, 255, 255, 0.3)';
    button.style.backgroundPosition = 'right center';
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'translateY(0) scale(1)';
    button.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)';
    button.style.borderColor = 'transparent';
    button.style.backgroundPosition = 'left center';
  });
  
  // Active state
  button.addEventListener('mousedown', () => {
    button.style.transform = 'translateY(-1px) scale(0.98)';
  });
  
  button.addEventListener('mouseup', () => {
    button.style.transform = 'translateY(-3px) scale(1.02)';
  });

  // Click handler
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.classList.add('loading');
    button.innerHTML = getLoadingText();
    button.style.opacity = '0.9';
    button.style.cursor = 'wait';
    button.style.transform = 'translateY(0) scale(1)';
    button.style.animation = 'buttonPulse 1.5s ease-in-out infinite';

    try {
      // Check if chrome.runtime is available
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        console.error('Chrome extension APIs not available');
        button.classList.remove('loading');
        button.classList.add('error');
        button.innerHTML = getErrorText();
        button.style.background = 'linear-gradient(135deg, #e53e3e 0%, #c53030 100%)';
        button.style.backgroundSize = '200% auto';
        setTimeout(() => {
          button.classList.remove('error');
          button.innerHTML = getButtonText();
          button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
          button.style.backgroundSize = '200% auto';
          button.disabled = false;
          button.style.opacity = '1';
          button.style.cursor = 'pointer';
          button.style.animation = 'none';
        }, 2000);
        return;
      }

      const courses = extractCoursesFromDom(document);
      
      console.log(`Extracted ${courses.length} courses from ${document.querySelectorAll('tbody tr[class^="ROW"]').length} rows`);
      
      if (courses.length === 0) {
        button.classList.remove('loading');
        button.classList.add('error');
        button.innerHTML = getNoCoursesText();
        button.style.background = 'linear-gradient(135deg, #e53e3e 0%, #c53030 100%)';
        button.style.backgroundSize = '200% auto';
        setTimeout(() => {
          button.classList.remove('error');
          button.innerHTML = getButtonText();
          button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
          button.style.backgroundSize = '200% auto';
          button.disabled = false;
          button.style.opacity = '1';
          button.style.cursor = 'pointer';
          button.style.animation = 'none';
        }, 2000);
        return;
      }

      // Also save to localStorage for web app compatibility
      try {
        localStorage.setItem('qu-student-courses', JSON.stringify(courses));
        localStorage.setItem('qu-student-courses-timestamp', Date.now().toString());
        console.log(`Saved ${courses.length} courses to localStorage for web app`);
      } catch (error) {
        console.warn('Could not save to localStorage (may be blocked):', error);
      }

      // Send courses to background script and open dashboard
      try {
        chrome.runtime.sendMessage(
          {
            type: 'OPEN_DASHBOARD_WITH_COURSES',
            payload: courses,
          },
          (response) => {
            button.classList.remove('loading');
            if (chrome.runtime.lastError) {
              const errorMsg = chrome.runtime.lastError.message;
              console.error('Error:', chrome.runtime.lastError);
              button.classList.add('error');
              
              // Check if it's a context invalidated error
              if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('message port closed') || !chrome.runtime.id) {
                const errorText = getCurrentLanguage() === 'ar' 
                  ? '⚠️ تم إعادة تحميل الإضافة. يرجى تحديث الصفحة والمحاولة مرة أخرى.'
                  : '⚠️ Extension was reloaded. Please refresh the page and try again.';
                button.innerHTML = errorText;
              } else {
                button.innerHTML = getGenericErrorText();
              }
              
              button.style.background = 'linear-gradient(135deg, #e53e3e 0%, #c53030 100%)';
              button.style.backgroundSize = '200% auto';
              setTimeout(() => {
                button.classList.remove('error');
                button.innerHTML = getButtonText();
                button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                button.style.backgroundSize = '200% auto';
                button.disabled = false;
                button.style.opacity = '1';
                button.style.cursor = 'pointer';
                button.style.animation = 'none';
              }, 3000);
            } else {
            button.classList.add('success');
            button.innerHTML = getSuccessText();
            button.style.background = 'linear-gradient(135deg, #48bb78 0%, #38a169 100%)';
            button.style.backgroundSize = '200% auto';
            setTimeout(() => {
              button.classList.remove('success');
              button.innerHTML = getButtonText();
              button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
              button.style.backgroundSize = '200% auto';
              button.disabled = false;
              button.style.opacity = '1';
              button.style.cursor = 'pointer';
              button.style.animation = 'none';
            }, 2000);
          }
        }
      );
    } catch (error) {
      console.error('Error extracting courses:', error);
      button.classList.remove('loading');
      button.classList.add('error');
      button.innerHTML = getGenericErrorText();
      button.style.background = 'linear-gradient(135deg, #e53e3e 0%, #c53030 100%)';
      button.style.backgroundSize = '200% auto';
      setTimeout(() => {
        button.classList.remove('error');
        button.innerHTML = getButtonText();
        button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        button.style.backgroundSize = '200% auto';
        button.disabled = false;
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
        button.style.animation = 'none';
      }, 2000);
    }
  });

  // Function to find and insert button at the target location
  function insertButtonAtTarget() {
    // Strategy 1: Find the semester select table (the specific location user marked)
    // Look for the select element with id "myForm:semesterSelect"
    const semesterSelect = document.querySelector('#myForm\\:semesterSelect, select[name="myForm:semesterSelect"]');
    
    if (semesterSelect) {
      // Find the table row containing the select
      const row = semesterSelect.closest('tr');
      if (row) {
        // Find the td containing the select
        const selectTd = semesterSelect.closest('td');
        if (selectTd) {
          // Insert button after the select element (to the right in RTL layout)
          // Add some spacing
          const spacer = document.createTextNode(' ');
          selectTd.appendChild(spacer);
          selectTd.appendChild(button);
          return true;
        } else {
          // Create a new td cell after the current one (to the right)
          const newTd = document.createElement('td');
          newTd.style.paddingLeft = '15px';
          newTd.style.verticalAlign = 'middle';
          newTd.appendChild(button);
          // Find the td containing the select and insert after it
          const selectParentTd = semesterSelect.parentElement?.closest('td');
          if (selectParentTd && selectParentTd.parentElement) {
            selectParentTd.parentElement.insertBefore(newTd, selectParentTd.nextSibling);
          } else {
            row.appendChild(newTd);
          }
          return true;
        }
      }
    }
    
    // Strategy 2: Find input field near the heading "المقررات المطروحة وفق الخطة"
    const heading = Array.from(document.querySelectorAll('*')).find(el => {
      const text = el.textContent || '';
      return text.includes('المقررات المطروحة وفق الخطة') || 
             text.includes('المقررات المطروحة');
    });
    
    if (heading) {
      // Find the next input field or form container
      const container = heading.closest('form, div, table, .ui-panel, .ui-widget') || heading.parentElement;
      if (container) {
        // Find input field
        const inputField = container.querySelector('input[type="text"], input[type="search"]');
        if (inputField && inputField.parentElement) {
          // Insert button right before the input field
          inputField.parentElement.insertBefore(button, inputField);
          return true;
        } else {
          // Insert after the heading or in the container
          if (heading.nextElementSibling) {
            heading.parentElement?.insertBefore(button, heading.nextElementSibling);
          } else {
            heading.parentElement?.appendChild(button);
          }
          return true;
        }
      }
    }
    
    // Strategy 3: Find table container and insert before it
    const courseTable = document.querySelector('table tbody, tbody[class*="ROW"], .ui-datatable, table');
    if (courseTable && courseTable.parentElement) {
      courseTable.parentElement.insertBefore(button, courseTable);
      return true;
    }
    
    // Fallback: Append to body
    if (document.body) {
      document.body.appendChild(button);
      return true;
    }
    
    return false;
  }

  // Change positioning to relative/absolute within container
  button.style.cssText = `
    position: relative !important;
    display: inline-block !important;
    margin: 10px 0 !important;
    width: auto !important;
    z-index: 10000 !important;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
    background-size: 200% auto !important;
    color: white !important;
    border: 2px solid transparent !important;
    padding: 14px 28px !important;
    border-radius: 30px !important;
    font-size: 15px !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4) !important;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    user-select: none !important;
  `;
  // Set direction based on language
  button.style.direction = getCurrentLanguage() === 'ar' ? 'rtl' : 'ltr';

  // Update CSS rule for positioning
  const styleElement = document.querySelector('style[data-qu-extractor]') || document.createElement('style');
  if (!styleElement.hasAttribute('data-qu-extractor')) {
    styleElement.setAttribute('data-qu-extractor', 'true');
    document.head.appendChild(styleElement);
  }
  
  // Update the CSS rule
  const existingStyle = document.querySelector('style[data-qu-extractor]') as HTMLStyleElement;
  if (existingStyle) {
    existingStyle.textContent = `
      @keyframes buttonPulse {
        0%, 100% {
          box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }
        50% {
          box-shadow: 0 6px 25px rgba(102, 126, 234, 0.6);
        }
      }
      
      @keyframes buttonShimmer {
        0% {
          background-position: -200% center;
        }
        100% {
          background-position: 200% center;
        }
      }
      
      @keyframes buttonBounce {
        0%, 100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-5px);
        }
      }
      
      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
      
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(-10px) scale(0.95);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      
      #qu-course-extractor-btn {
        animation: fadeIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        position: relative !important;
        display: inline-block !important;
      }
      
      #qu-course-extractor-btn.loading::before {
        content: '';
        position: absolute;
        top: 50%;
        right: 15px;
        width: 18px;
        height: 18px;
        margin-top: -9px;
        border: 3px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      
      #qu-course-extractor-btn.success {
        animation: buttonBounce 0.6s ease-out;
      }
      
      #qu-course-extractor-btn.error {
        animation: buttonBounce 0.5s ease-out;
      }
    `;
  }

  // Try to insert at target location
  if (document.body) {
    const inserted = insertButtonAtTarget();
    if (!inserted) {
      // Fallback: wait a bit and try again (page might still be loading)
      setTimeout(() => {
        if (!document.getElementById('qu-course-extractor-btn')) {
          insertButtonAtTarget() || document.body.appendChild(button);
        }
      }, 500);
    }
    // Add entrance animation
    setTimeout(() => {
      button.style.animation = 'fadeIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
    }, 100);
  } else {
    // Wait for body to be available
    const observer = new MutationObserver((mutations, obs) => {
      if (document.body) {
        const inserted = insertButtonAtTarget();
        if (!inserted) {
          document.body.appendChild(button);
        }
        // Add entrance animation
        setTimeout(() => {
          button.style.animation = 'fadeIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
        }, 100);
        obs.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
}

// Inject button when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectExtractButton);
} else {
  injectExtractButton();
}

// Also listen for messages from background script (for backward compatibility)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EXTRACT_COURSES') {
      try {
        // Check if extension context is still valid
        if (!chrome.runtime.id) {
          sendResponse({
            type: 'COURSES_EXTRACTED',
            success: false,
            error: 'Extension context invalidated. Please refresh the page and try again.',
          });
          return true;
        }

        const courses = extractCoursesFromDom(document);
        
        sendResponse({
          type: 'COURSES_EXTRACTED',
          success: true,
          payload: courses,
        });
      } catch (error) {
        console.error('Error extracting courses:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Check if it's a context invalidated error
        if (errorMessage.includes('Extension context invalidated') || errorMessage.includes('message port closed')) {
          sendResponse({
            type: 'COURSES_EXTRACTED',
            success: false,
            error: 'Extension context invalidated. Please refresh the page and try again.',
          });
        } else {
          sendResponse({
            type: 'COURSES_EXTRACTED',
            success: false,
            error: errorMessage,
          });
        }
      }
      
      // Return true to indicate we will send a response asynchronously
      return true;
    }
    
    return false;
  });
}
