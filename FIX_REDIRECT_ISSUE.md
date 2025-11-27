# Fix: Seeing "qu-students.com" Instead of GitHub Pages URL

## Problem
When visiting `https://ssaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/`, the browser shows "qu-students.com" instead.

## Possible Causes & Solutions

### 1. Browser Extension Redirect
A browser extension might be redirecting the page.

**Fix:**
1. Open the site in **Incognito/Private mode** (extensions are usually disabled)
2. Or disable browser extensions one by one to find the culprit
3. Common culprits: VPN extensions, ad blockers, privacy extensions

### 2. Custom Domain in GitHub Pages Settings
A custom domain might be configured incorrectly.

**Fix:**
1. Go to: https://github.com/SSaleh22-stack/Student-Table-Maker-Qu-Student-/settings/pages
2. Check the "Custom domain" section
3. If "qu-students.com" is listed there:
   - **Remove it** (click the X or clear the field)
   - Click **Save**
   - Wait 2-5 minutes for changes to propagate

### 3. DNS/Hosts File Issue
Your computer's hosts file might be redirecting.

**Fix (Windows):**
1. Open Notepad as Administrator
2. Open file: `C:\Windows\System32\drivers\etc\hosts`
3. Look for any line containing "qu-students.com" or "ssaleh22-stack.github.io"
4. If found, delete that line
5. Save the file

**Fix (Mac/Linux):**
1. Open terminal
2. Run: `sudo nano /etc/hosts`
3. Look for and remove any lines with "qu-students.com"
4. Save (Ctrl+X, then Y, then Enter)

### 4. Browser Cache/DNS Cache
Stale cache might be causing issues.

**Fix:**
1. **Clear browser cache:**
   - Chrome: Ctrl+Shift+Delete → Clear browsing data
   - Firefox: Ctrl+Shift+Delete → Clear recent history
   - Safari: Cmd+Option+E (Mac)

2. **Flush DNS cache (Windows):**
   - Open Command Prompt as Administrator
   - Run: `ipconfig /flushdns`

3. **Flush DNS cache (Mac):**
   - Open Terminal
   - Run: `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`

### 5. Check What You're Actually Seeing

**Clarification needed:**
- Are you seeing "qu-students.com" in the **address bar**?
- Or is it in the **page content**?
- Or is it an **error message**?

**To verify:**
1. Open browser Developer Tools (F12)
2. Go to **Network** tab
3. Visit: `https://ssaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/`
4. Check what URL the browser is actually requesting
5. Check the **Console** tab for any errors

## Quick Test

1. **Try a different browser** (Chrome, Firefox, Edge, Safari)
2. **Try incognito/private mode**
3. **Try on a different device/network**
4. **Check the actual URL in the address bar** - does it show the GitHub Pages URL or qu-students.com?

## If Nothing Works

1. **Check GitHub Pages Settings:**
   - Go to: https://github.com/SSaleh22-stack/Student-Table-Maker-Qu-Student-/settings/pages
   - Screenshot the entire page and check for any custom domain settings

2. **Check Browser Extensions:**
   - Disable ALL extensions
   - Try accessing the site again

3. **Check Network:**
   - Try from a different network (mobile data, different WiFi)
   - This will rule out router/DNS issues

## Expected Behavior

When you visit `https://ssaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/`:
- The **address bar** should show: `ssaleh22-stack.github.io`
- The **page** should show: "STUDENT TABLE MAKER" with navigation buttons
- You should **NOT** see "qu-students.com" anywhere

If you're seeing "qu-students.com" in the address bar, something is redirecting your browser.

