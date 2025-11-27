# Fix: GitHub Pages Showing README Instead of Web App

## Problem
After clearing cache, the site loads but shows the README.md file instead of the web app.

## Root Cause
GitHub Pages is either:
1. Serving from a branch instead of GitHub Actions deployment
2. Jekyll is processing the files (needs .nojekyll file)

## Solution

### Step 1: Verify GitHub Pages Source

1. Go to: https://github.com/SSaleh22-stack/Student-Table-Maker-Qu-Student-/settings/pages
2. Under **"Source"**, make sure it says:
   - ✅ **"GitHub Actions"** (NOT "Deploy from a branch")
3. If it says "Deploy from a branch" or "None":
   - Change it to **"GitHub Actions"**
   - Click **Save**

### Step 2: Check Workflow Status

1. Go to: https://github.com/SSaleh22-stack/Student-Table-Maker-Qu-Student-/actions
2. Look for **"Deploy Web App to GitHub Pages"** workflow
3. Check if it has run and completed successfully:
   - ✅ Green checkmark = Success
   - ❌ Red X = Failed (check logs)
   - ⚪ No runs = Needs to be triggered

### Step 3: Manually Trigger Deployment

If the workflow hasn't run or failed:

1. Go to: https://github.com/SSaleh22-stack/Student-Table-Maker-Qu-Student-/actions
2. Click **"Deploy Web App to GitHub Pages"** in left sidebar
3. Click **"Run workflow"** (top right)
4. Select branch: **main**
5. Click **"Run workflow"**
6. Wait 2-3 minutes for completion

### Step 4: Verify Deployment

After the workflow completes:

1. Go to: https://github.com/SSaleh22-stack/Student-Table-Maker-Qu-Student-/settings/pages
2. You should see: **"Your site is live at https://ssaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/"**
3. Visit that URL
4. You should see the **"STUDENT TABLE MAKER"** web app, NOT the README

## What Should You See?

**✅ Correct (Web App):**
- "STUDENT TABLE MAKER" title
- Navigation bar with buttons (Timetable, GPA Calculator, etc.)
- Hero section with "Extract Courses" button
- Full React app interface

**❌ Wrong (README):**
- "# STUDENT TABLE MAKER" (markdown heading)
- Installation instructions
- Code blocks
- Just the README.md content

## If Still Showing README

1. **Clear browser cache again** (Ctrl+Shift+Delete)
2. **Try incognito mode**
3. **Wait 5 minutes** after changing GitHub Pages source
4. **Check the workflow logs** for any errors
5. **Verify the artifact was uploaded** - in the workflow run, check the "Upload artifact" step

## Important Notes

- The `.nojekyll` file has been added to prevent Jekyll from processing files
- The workflow now creates this file automatically during build
- GitHub Pages must be set to **"GitHub Actions"**, not a branch
- The web app is built from `web-app/dist` directory

