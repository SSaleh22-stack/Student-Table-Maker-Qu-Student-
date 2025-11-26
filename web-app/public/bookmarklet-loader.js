// Bookmarklet loader - Safari compatible version
// This loads the actual bookmarklet code from an external file
(function() {
  'use strict';
  
  // Check if already loaded
  if (window.__QU_BOOKMARKLET_LOADED__) {
    return;
  }
  window.__QU_BOOKMARKLET_LOADED__ = true;
  
  // Load the bookmarklet code
  var script = document.createElement('script');
  script.src = 'https://SSaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/bookmarklet-code.js';
  script.onerror = function() {
    // Fallback: try to load from same origin
    script.src = './bookmarklet-code.js';
    document.head.appendChild(script);
  };
  document.head.appendChild(script);
})();

