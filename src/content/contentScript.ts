/**
 * Content script for QU student page
 * Injects a floating button to extract courses and listens for messages
 */

// Check if extension context is valid BEFORE importing modules
// This prevents errors during module initialization
let extensionContextValid = false;
try {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    extensionContextValid = true;
  }
} catch (e) {
  // Extension context invalidated - chrome.runtime access throws an error
  extensionContextValid = false;
  console.warn('Extension context invalidated. Please refresh the page to use the extension.');
  
  // Show error message on page
  const showContextInvalidatedMessage = () => {
    try {
      const lang = ((window as any).__QU_COURSE_EXTRACTOR_LANG__ || 'ar') as 'en' | 'ar';
      const errorText = lang === 'ar' 
        ? '⚠️ تم إعادة تحميل الإضافة. يرجى تحديث الصفحة (F5) لاستخدام الإضافة.'
        : '⚠️ Extension reloaded. Please refresh the page (F5) to use the extension.';
      
      // Try to update existing button if it exists
      const existingButton = document.getElementById('qu-course-extractor-btn');
      if (existingButton) {
        existingButton.innerHTML = errorText;
        existingButton.style.background = 'linear-gradient(135deg, #ed8936 0%, #dd6b20 100%)';
        existingButton.style.cursor = 'not-allowed';
        (existingButton as HTMLButtonElement).disabled = true;
      } else {
        // Create a notification banner
        const banner = document.createElement('div');
        banner.id = 'qu-extension-error-banner';
        banner.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);
          color: white;
          padding: 1rem 1.5rem;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(237, 137, 54, 0.4);
          z-index: 999999;
          font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
          font-size: 14px;
          font-weight: 600;
          max-width: 400px;
          animation: slideIn 0.3s ease-out;
        `;
        banner.textContent = errorText;
        document.body.appendChild(banner);
        
        // Auto-remove after 10 seconds
        setTimeout(() => {
          if (banner.parentNode) {
            banner.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => banner.remove(), 300);
          }
        }, 10000);
      }
    } catch (e) {
      // Ignore errors when trying to show message
    }
  };
  
  // Show message when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showContextInvalidatedMessage);
  } else {
    showContextInvalidatedMessage();
  }
  
  // Exit early - don't continue with script execution
  // This prevents the error from propagating
}

// Only import and execute if extension context is valid
if (!extensionContextValid) {
  // Exit early - module won't execute
  // This is a workaround since we can't conditionally import in ES modules
  // The rest of the code will still try to run, but we've shown the error message
}

import { extractCoursesFromDom } from './extractCourses';
import { Course } from '../types';

// Global error handler for extension context invalidated errors
const handleContextInvalidated = (error: any): boolean => {
  const errorMsg = error?.message || String(error);
  if (errorMsg.includes('Extension context invalidated') || 
      errorMsg.includes('message port closed') ||
      errorMsg.includes('context invalidated')) {
    console.warn('Extension context invalidated. Please refresh the page to use the extension.');
    // Try to show a user-friendly message if button exists
    try {
      const button = document.getElementById('qu-course-extractor-btn');
      if (button) {
        const lang = ((window as any).__QU_COURSE_EXTRACTOR_LANG__ || 'ar') as 'en' | 'ar';
        const errorText = lang === 'ar' 
          ? '⚠️ تم إعادة تحميل الإضافة. يرجى تحديث الصفحة (F5).'
          : '⚠️ Extension reloaded. Please refresh the page (F5).';
        button.innerHTML = errorText;
        button.style.background = 'linear-gradient(135deg, #ed8936 0%, #dd6b20 100%)';
        button.style.cursor = 'not-allowed';
        (button as HTMLButtonElement).disabled = true;
      }
    } catch (e) {
      // Ignore errors when trying to update button
    }
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

// Wrap entire script execution in try-catch to handle Extension context invalidated errors
try {
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
} catch (initError) {
  if (handleContextInvalidated(initError)) {
    // Context invalidated - show message and exit gracefully
    console.warn('Extension context invalidated. Script will not initialize. Please refresh the page.');
    // Don't throw - just exit gracefully
    // The error handlers above will catch any further errors
  } else {
    console.error('Error during script initialization:', initError);
  }
  // Continue execution - don't throw to avoid breaking the page
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
  try {
    // Safely check if chrome.storage is available
    let chromeStorageAvailable = false;
    let storage: typeof chrome.storage | undefined;
    try {
      if (typeof chrome === 'undefined') {
        chromeStorageAvailable = false;
        return;
      }
      // Accessing chrome.storage can throw if context is invalidated
      try {
        storage = chrome.storage;
      } catch (e) {
        chromeStorageAvailable = false;
        console.warn('Cannot access chrome.storage (extension context may be invalidated):', e);
        return;
      }
      chromeStorageAvailable = storage !== undefined && storage.sync !== undefined;
    } catch (e) {
      chromeStorageAvailable = false;
      console.warn('Cannot access chrome.storage (extension context may be invalidated):', e);
      return;
    }

    if (!chromeStorageAvailable || !storage) {
      return;
    }

    try {
      storage.sync.get(['language'], (result) => {
        try {
          // Safely check for runtime errors
          if (chrome.runtime.lastError) {
            console.warn('Error getting language preference:', chrome.runtime.lastError);
            return;
          }
        } catch (runtimeError) {
          // Context invalidated - can't access chrome.runtime
          console.warn('Cannot access chrome.runtime (extension context may be invalidated)');
          return;
        }
        if (result.language === 'en' || result.language === 'ar') {
          (window as any).__QU_COURSE_EXTRACTOR_LANG__ = result.language;
          updateButtonText();
        }
      });
    } catch (getError) {
      console.warn('Error accessing chrome.storage.sync.get:', getError);
    }

    // Listen for language changes
    try {
      if (!storage) return;
      storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' && changes.language) {
          const newLang = changes.language.newValue;
          if (newLang === 'en' || newLang === 'ar') {
            (window as any).__QU_COURSE_EXTRACTOR_LANG__ = newLang;
            updateButtonText();
          }
        }
      });
    } catch (listenerError) {
      console.warn('Error setting up storage change listener:', listenerError);
    }
  } catch (error) {
    console.warn('Error in loadLanguage():', error);
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

    // Helper function to reset button on error
    const resetButtonOnError = (errorText: string) => {
      button.classList.remove('loading');
      button.classList.add('error');
      button.innerHTML = errorText;
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
    };

    try {
      // Helper function to safely check if chrome.runtime is available
      // Must wrap ALL chrome.runtime access in try-catch as it can throw when context is invalidated
      const isRuntimeValid = (): boolean => {
        try {
          if (typeof chrome === 'undefined') return false;
          // Accessing chrome.runtime itself can throw if context is invalidated
          let runtime: typeof chrome.runtime;
          try {
            runtime = chrome.runtime;
          } catch (e) {
            return false;
          }
          if (!runtime) return false;
          // Try to access id - this will throw if context is invalidated
          const id = runtime.id;
          return typeof id === 'string' && id.length > 0;
        } catch (e) {
          // Context invalidated - any access to chrome.runtime throws
          return false;
        }
      };

      // Check if chrome.runtime is available before proceeding
      if (!isRuntimeValid()) {
        const errorText = getCurrentLanguage() === 'ar' 
          ? '⚠️ تم إعادة تحميل الإضافة. يرجى تحديث الصفحة والمحاولة مرة أخرى.'
          : '⚠️ Extension was reloaded. Please refresh the page and try again.';
        resetButtonOnError(errorText);
        return;
      }

      const courses = extractCoursesFromDom(document);
      
      console.log(`Extracted ${courses.length} courses from ${document.querySelectorAll('tbody tr[class^="ROW"]').length} rows`);
      
      // Verify __originalIndex is present on all courses
      const coursesWithoutIndex = courses.filter((c: any) => c.__originalIndex === undefined);
      if (coursesWithoutIndex.length > 0) {
        console.warn(`⚠️ Warning: ${coursesWithoutIndex.length} courses are missing __originalIndex:`, 
          coursesWithoutIndex.map((c: any) => ({ code: c.code, section: c.section })));
      } else {
        console.log('✅ All courses have __originalIndex set correctly');
      }
      
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
      // Double-check runtime validity right before sending message
      if (!isRuntimeValid()) {
        const errorText = getCurrentLanguage() === 'ar' 
          ? '⚠️ تم إعادة تحميل الإضافة. يرجى تحديث الصفحة والمحاولة مرة أخرى.'
          : '⚠️ Extension was reloaded. Please refresh the page and try again.';
        resetButtonOnError(errorText);
        return;
      }

      try {
        // Wrap sendMessage in try-catch as it can throw synchronously
        // Also need to safely access chrome.runtime before calling sendMessage
        let runtime: typeof chrome.runtime;
        try {
          runtime = chrome.runtime;
        } catch (runtimeAccessError) {
          // Context invalidated - can't access chrome.runtime
          const errorText = getCurrentLanguage() === 'ar' 
            ? '⚠️ تم إعادة تحميل الإضافة. يرجى تحديث الصفحة والمحاولة مرة أخرى.'
            : '⚠️ Extension was reloaded. Please refresh the page and try again.';
          resetButtonOnError(errorText);
          return;
        }
        
        runtime.sendMessage(
          {
            type: 'OPEN_DASHBOARD_WITH_COURSES',
            payload: courses,
          },
          (response) => {
            try {
              button.classList.remove('loading');
              
              // Check for runtime errors - wrap in try-catch as accessing chrome.runtime can throw
              let hasError = false;
              let errorMsg = '';
              try {
                if (chrome.runtime.lastError) {
                  hasError = true;
                  errorMsg = chrome.runtime.lastError.message;
                  console.error('Error:', chrome.runtime.lastError);
                }
              } catch (runtimeAccessError) {
                // Context invalidated - can't access chrome.runtime
                hasError = true;
                errorMsg = 'Extension context invalidated';
              }
              
              if (hasError) {
                button.classList.add('error');
                
                // Check if it's a context invalidated error
                if (errorMsg.includes('Extension context invalidated') || 
                    errorMsg.includes('message port closed') ||
                    errorMsg.includes('context invalidated') ||
                    !isRuntimeValid()) {
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
            } catch (callbackError) {
              // Error in callback - likely context invalidated
              console.error('Error in sendMessage callback:', callbackError);
              const errorText = getCurrentLanguage() === 'ar' 
                ? '⚠️ تم إعادة تحميل الإضافة. يرجى تحديث الصفحة والمحاولة مرة أخرى.'
                : '⚠️ Extension was reloaded. Please refresh the page and try again.';
              resetButtonOnError(errorText);
            }
          }
        );
      } catch (sendError) {
        // sendMessage itself threw an error (context invalidated)
        console.error('Error calling chrome.runtime.sendMessage:', sendError);
        const errorMessage = sendError instanceof Error ? sendError.message : String(sendError);
        
        // Check if it's a context invalidated error
        let errorText: string;
        if (errorMessage.includes('Extension context invalidated') || 
            errorMessage.includes('message port closed') ||
            errorMessage.includes('context invalidated') ||
            !isRuntimeValid()) {
          errorText = getCurrentLanguage() === 'ar' 
            ? '⚠️ تم إعادة تحميل الإضافة. يرجى تحديث الصفحة والمحاولة مرة أخرى.'
            : '⚠️ Extension was reloaded. Please refresh the page and try again.';
        } else {
          errorText = getGenericErrorText();
        }
        
        resetButtonOnError(errorText);
      }
    } catch (error) {
      console.error('Error extracting courses:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if it's a context invalidated error
      let errorText: string;
      if (errorMessage.includes('Extension context invalidated') || 
          errorMessage.includes('message port closed') ||
          errorMessage.includes('context invalidated')) {
        errorText = getCurrentLanguage() === 'ar' 
          ? '⚠️ تم إعادة تحميل الإضافة. يرجى تحديث الصفحة والمحاولة مرة أخرى.'
          : '⚠️ Extension was reloaded. Please refresh the page and try again.';
      } else {
        errorText = getGenericErrorText();
      }
      
      resetButtonOnError(errorText);
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
      
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateX(100%);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
      
      @keyframes slideOut {
        from {
          opacity: 1;
          transform: translateX(0);
        }
        to {
          opacity: 0;
          transform: translateX(100%);
        }
      }
      
      #qu-course-extractor-btn {
        animation: fadeIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        position: relative !important;
        display: inline-block !important;
      }
      
      #qu-extension-error-banner {
        animation: slideIn 0.3s ease-out;
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

// Inject button when page loads - wrap in try-catch to handle context invalidated errors
try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try {
        injectExtractButton();
      } catch (error) {
        console.error('Error injecting extract button:', error);
        // Don't throw - script should continue
      }
    });
  } else {
    try {
      injectExtractButton();
    } catch (error) {
      console.error('Error injecting extract button:', error);
      // Don't throw - script should continue
    }
  }
} catch (error) {
  console.error('Error setting up button injection:', error);
  // Don't throw - script should continue
}

// Also listen for messages from background script (for backward compatibility)
// Set up message listener with error handling
// Wrap everything in try-catch to prevent uncaught errors during script load
try {
  // Safely check if chrome.runtime is available without throwing
  let chromeRuntimeAvailable = false;
  let onMessageAvailable = false;
  
  try {
    // Check chrome exists first
    if (typeof chrome === 'undefined') {
      chromeRuntimeAvailable = false;
    } else {
      // Try to access chrome.runtime - this can throw if context is invalidated
      try {
        const runtime = chrome.runtime;
        if (runtime) {
          chromeRuntimeAvailable = true;
          // Try to access onMessage without accessing id (which can throw)
          if (typeof runtime.onMessage !== 'undefined') {
            onMessageAvailable = true;
          }
        }
      } catch (runtimeError) {
        // Context invalidated - can't access chrome.runtime
        chromeRuntimeAvailable = false;
        onMessageAvailable = false;
        console.warn('Extension context invalidated during script load. Please refresh the page.');
      }
    }
  } catch (e) {
    // Any other error accessing chrome
    chromeRuntimeAvailable = false;
    onMessageAvailable = false;
    console.warn('Error checking chrome.runtime availability:', e);
  }

  if (chromeRuntimeAvailable && onMessageAvailable && extensionContextValid) {
      // Helper function to safely check if chrome.runtime is available
      // Must wrap ALL chrome.runtime access in try-catch as it can throw when context is invalidated
      const isRuntimeValid = (): boolean => {
        if (!extensionContextValid) return false;
        try {
          if (typeof chrome === 'undefined') return false;
          // Accessing chrome.runtime itself can throw if context is invalidated
          let runtime: typeof chrome.runtime;
          try {
            runtime = chrome.runtime;
          } catch (e) {
            extensionContextValid = false;
            return false;
          }
          if (!runtime) {
            extensionContextValid = false;
            return false;
          }
          // Try to access id - this will throw if context is invalidated
          const id = runtime.id;
          if (typeof id !== 'string' || id.length === 0) {
            extensionContextValid = false;
            return false;
          }
          return true;
        } catch (e) {
          // Context invalidated - any access to chrome.runtime throws
          extensionContextValid = false;
          return false;
        }
      };

      try {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
          if (message.type === 'EXTRACT_COURSES') {
            try {
              // Check if extension context is still valid
              if (!isRuntimeValid()) {
                sendResponse({
                  type: 'COURSES_EXTRACTED',
                  success: false,
                  error: 'Extension context invalidated. Please refresh the page and try again.',
                });
                return true;
              }

              const courses = extractCoursesFromDom(document);
              
              // Double-check before sending response
              if (!isRuntimeValid()) {
                sendResponse({
                  type: 'COURSES_EXTRACTED',
                  success: false,
                  error: 'Extension context invalidated. Please refresh the page and try again.',
                });
                return true;
              }
              
              sendResponse({
                type: 'COURSES_EXTRACTED',
                success: true,
                payload: courses,
              });
            } catch (error) {
              console.error('Error extracting courses:', error);
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              
              // Check if it's a context invalidated error
              if (errorMessage.includes('Extension context invalidated') || 
                  errorMessage.includes('message port closed') ||
                  !isRuntimeValid()) {
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
      } catch (listenerError) {
        console.warn('Error setting up message listener (context may be invalidated):', listenerError);
      }
    }
  } catch (error) {
    // Handle errors during message listener setup
    console.error('Error setting up message listener:', error);
    // Don't throw - script should continue to work even if message listener fails
  }

// Catch any unhandled errors at the script level
if (typeof window !== 'undefined') {
  const originalErrorHandler = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    if (message && typeof message === 'string' && message.includes('Extension context invalidated')) {
      console.warn('Extension context invalidated error caught by global handler:', message);
      return true; // Prevent default error handling
    }
    // Call original error handler if it exists
    if (originalErrorHandler) {
      return originalErrorHandler(message, source, lineno, colno, error);
    }
    return false;
  };

  // Also catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.message && event.reason.message.includes('Extension context invalidated')) {
      console.warn('Extension context invalidated promise rejection caught:', event.reason);
      event.preventDefault(); // Prevent the error from being logged
    }
  });
}
