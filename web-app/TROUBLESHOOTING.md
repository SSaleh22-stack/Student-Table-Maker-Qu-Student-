# Troubleshooting: Courses Not Appearing

If courses were extracted successfully but don't appear in the web app, follow these steps:

## Quick Fixes

### 1. Click "Refresh Courses" Button
- Look for the orange "🔄 Refresh Courses" button
- Click it to manually reload courses from localStorage
- Check the browser console (F12) for any errors

### 2. Check Browser Console
- Press F12 (or Cmd+Option+I on Mac) to open Developer Tools
- Go to the "Console" tab
- Look for messages like:
  - "Loading courses from localStorage: Found data"
  - "Parsed courses: [...]"
  - Any error messages in red

### 3. Verify localStorage Data
In the browser console, type:
```javascript
localStorage.getItem('qu-student-courses')
```
This should show a JSON string with your courses.

To see the parsed data:
```javascript
JSON.parse(localStorage.getItem('qu-student-courses'))
```

### 4. Check Timestamp
```javascript
localStorage.getItem('qu-student-courses-timestamp')
```
This should show when courses were last extracted.

## Common Issues

### Issue: Courses extracted but not showing

**Solution:**
1. Open browser console (F12)
2. Check if there are any errors
3. Click the "🔄 Refresh Courses" button
4. If still not working, check localStorage manually (see above)

### Issue: "No courses found" error from bookmarklet

**Possible causes:**
- Not on the correct QU portal page
- Page hasn't fully loaded
- Table structure changed

**Solution:**
- Make sure you're on the course listing page with the table visible
- Wait for page to fully load
- Try refreshing the page and running bookmarklet again

### Issue: localStorage is empty

**Solution:**
- Run the bookmarklet again on the QU portal page
- Make sure you see the success message
- Check browser console for errors

### Issue: Courses appear then disappear

**Possible cause:** The save effect might be overwriting

**Solution:**
- This should be fixed in the latest version
- Try refreshing the page
- Check console for any save errors

## Manual Debug Steps

1. **Extract courses** using bookmarklet
2. **Open web app** in same browser
3. **Open console** (F12)
4. **Check for logs:**
   - Should see "Loading courses from localStorage: Found data"
   - Should see "Parsed courses: [...]"
   - Should see "Setting courses: X courses"
5. **If courses don't appear:**
   - Click "🔄 Refresh Courses" button
   - Check console for errors
   - Verify localStorage has data (see commands above)

## Still Not Working?

1. **Clear localStorage and try again:**
   ```javascript
   localStorage.removeItem('qu-student-courses');
   localStorage.removeItem('qu-student-courses-timestamp');
   ```
   Then extract courses again with bookmarklet.

2. **Check browser compatibility:**
   - Make sure localStorage is enabled
   - Try a different browser
   - Check if browser has storage restrictions

3. **Verify bookmarklet code:**
   - Make sure you're using the latest bookmarklet code
   - Check that the bookmarklet runs without errors

