/**
 * Background Service Worker for Student Table Maker
 * Handles extension icon clicks, opens the dashboard, and coordinates course extraction
 */

chrome.action.onClicked.addListener((tab) => {
  // Open the dashboard in a new tab
  chrome.tabs.create({
    url: chrome.runtime.getURL('dashboard.html')
  });
});

// Inject content script on QU pages when they load
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const url = tab.url;
    if ((url.includes('qu.edu.sa') || url.includes('stu-gate.qu.edu.sa')) && 
        (url.includes('offeredCourses') || url.includes('student'))) {
      // Inject content script programmatically
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/contentScript.js'],
      }).catch((error) => {
        // Ignore errors (script might already be injected)
        console.log('Content script injection:', error);
      });
    }
  }
});

// Handle messages from dashboard and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle message from content script button to open dashboard with courses
  if (message.type === 'OPEN_DASHBOARD_WITH_COURSES') {
    // Store courses in chrome.storage
    chrome.storage.local.set({ extractedCourses: message.payload }, () => {
      // Open dashboard
      chrome.tabs.create({
        url: chrome.runtime.getURL('dashboard.html?extracted=true')
      });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'EXTRACT_COURSES_FROM_TAB') {
    // Get the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0 || !tabs[0].id) {
        sendResponse({
          type: 'EXTRACTION_FAILED',
          error: 'No active tab found',
        });
        return;
      }

      const tabId = tabs[0].id;
      const tabUrl = tabs[0].url || '';

      // Check if the tab is a QU student page
      const isQUPage = tabUrl.includes('qu.edu.sa') || 
                       tabUrl.includes('stu-gate.qu.edu.sa') ||
                       tabUrl.includes('offeredCourses') ||
                       tabUrl.includes('student');
      
      if (!isQUPage) {
        sendResponse({
          type: 'EXTRACTION_FAILED',
          error: 'Please navigate to the QU student portal course page first. Make sure you are logged in and viewing your available courses.',
        });
        return;
      }

      // Try to send message to content script
      chrome.tabs.sendMessage(
        tabId,
        { type: 'EXTRACT_COURSES' },
        (response) => {
          if (chrome.runtime.lastError) {
            // Content script might not be loaded, try to inject it
            chrome.scripting.executeScript({
              target: { tabId },
              files: ['src/content/contentScript.js'],
            }).then(() => {
              // Retry sending message after injection
              chrome.tabs.sendMessage(
                tabId,
                { type: 'EXTRACT_COURSES' },
                (retryResponse) => {
                  if (chrome.runtime.lastError) {
                    sendResponse({
                      type: 'EXTRACTION_FAILED',
                      error: chrome.runtime.lastError.message,
                    });
                  } else {
                    sendResponse(retryResponse);
                  }
                }
              );
            }).catch((error) => {
              sendResponse({
                type: 'EXTRACTION_FAILED',
                error: error.message || 'Failed to inject content script',
              });
            });
          } else {
            sendResponse(response);
          }
        }
      );
    });

    // Return true to indicate we will send a response asynchronously
    return true;
  }

  return false;
});

