# Bookmarklet Instructions - Auto Extract Courses

The bookmarklet allows you to automatically extract courses from the QU student portal page, just like the Chrome extension!

## How to Create the Bookmarklet

### Method 1: Quick Setup (Recommended)

1. **Copy the bookmarklet code** from `bookmarklet-minified.js`
2. **Create a new bookmark** in your browser:
   - **Chrome/Edge**: Press `Ctrl+Shift+O` (or `Cmd+Shift+O` on Mac) to open bookmarks
   - **Safari (iPad)**: Tap the Share button → Add Bookmark
   - **Firefox**: Press `Ctrl+Shift+B` to show bookmarks bar
3. **Edit the bookmark**:
   - Right-click the bookmark → Edit
   - **Name**: "Extract QU Courses"
   - **URL**: Paste the entire minified code from `bookmarklet-minified.js`
4. **Save** the bookmark

### Method 2: Manual Creation

1. Open `bookmarklet-minified.js` in a text editor
2. Copy the entire content (it's one long line starting with `javascript:`)
3. Create a new bookmark with this as the URL

## How to Use the Bookmarklet

### On Desktop/Chrome:

1. **Navigate** to the QU student portal course page:
   - Go to: `https://*.qu.edu.sa/*` (offered courses page)
   - Make sure the course table is visible
2. **Click the bookmarklet** from your bookmarks bar
3. **Wait for extraction** - you'll see an alert with the number of courses extracted
4. **Open the web app** - enter your web app URL when prompted, or open it manually
5. **View your courses** - they'll automatically appear in the web app!

### On iPad Safari:

1. **Add bookmarklet to Safari**:
   - Open Safari on iPad
   - Go to any page
   - Tap the Share button (square with arrow)
   - Tap "Add Bookmark"
   - Edit the bookmark:
     - Name: "Extract QU Courses"
     - URL: Paste the bookmarklet code
   - Save

2. **Use the bookmarklet**:
   - Navigate to QU portal course page in Safari
   - Tap the bookmarks icon (book symbol)
   - Tap "Extract QU Courses" bookmarklet
   - Wait for extraction
   - Open the web app in another tab/window
   - Courses will be automatically loaded!

## What the Bookmarklet Does

1. **Extracts course data** from the QU portal page:
   - Course code and name
   - Section number
   - Days and times
   - Location
   - Instructor
   - Class type (theoretical/practical/exercise)
   - Status (open/closed)

2. **Saves to localStorage**:
   - Data is saved with key: `qu-student-courses`
   - Timestamp is saved: `qu-student-courses-timestamp`

3. **Web app automatically loads**:
   - When you open the web app, it checks localStorage
   - Courses are automatically displayed
   - Works even if bookmarklet was used in a different tab/window

## Troubleshooting

### "No courses found" error:
- Make sure you're on the correct QU portal page
- The page should have a table with course rows
- Wait for the page to fully load before clicking the bookmarklet

### Courses not appearing in web app:
- Make sure both pages are on the same domain (or use the storage event listener)
- Check browser console for errors
- Try refreshing the web app page
- Make sure localStorage is enabled in your browser

### Bookmarklet not working on iPad:
- Safari on iPad may have restrictions
- Try using Chrome or another browser on iPad
- Make sure JavaScript is enabled
- Some browsers may block bookmarklets - check browser settings

## Technical Details

- **Storage Key**: `qu-student-courses` (JSON array)
- **Timestamp Key**: `qu-student-courses-timestamp` (Unix timestamp)
- **Format**: Same as Chrome extension course format
- **Compatibility**: Works in all modern browsers (Chrome, Firefox, Safari, Edge)

## Security Note

The bookmarklet only reads data from the page you're on and saves it locally. It doesn't send any data to external servers. All data stays in your browser's localStorage.

