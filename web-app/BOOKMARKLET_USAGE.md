# Bookmarklet Usage Instructions

## Quick Setup

1. **Copy the bookmarklet code** from `bookmarklet.js` (non-minified version for reliability)
2. **Create a new bookmark** in your browser
3. **Paste the code** as the URL (it should start with `javascript:`)
4. **Save the bookmark**

## Using the Bookmarklet

1. Navigate to the QU student portal course page
2. Make sure all courses are loaded and visible
3. Click your bookmarklet
4. Wait for the extraction to complete
5. Open the web app to view your courses

## Troubleshooting

### If you get "n is not a function" error:
- Use the **non-minified version** (`bookmarklet.js`) instead of the minified one
- The minified version may have issues with function references

### If courses don't appear:
1. Open browser console (F12)
2. Check for errors
3. Run: `localStorage.getItem('qu-student-courses')` to see if data was saved
4. Click "Refresh Courses" button in the web app

### If only a few courses are extracted:
- Check the console for warnings about skipped rows
- Make sure you're on the correct page with all courses visible
- Some courses might not have complete data

