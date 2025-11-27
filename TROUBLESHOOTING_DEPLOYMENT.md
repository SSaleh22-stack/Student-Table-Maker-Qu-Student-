# Troubleshooting: Site Not Accessible

## ⚠️ Important: The Correct URL

Your site URL should be:
```
https://ssaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/
```

**DO NOT use:**
- ❌ `qu-students.com` (this domain doesn't exist)
- ❌ `http://` (must use `https://`)
- ❌ Missing trailing slash

## Step-by-Step Fix

### Step 1: Verify GitHub Pages is Enabled

1. Go to: https://github.com/SSaleh22-stack/Student-Table-Maker-Qu-Student-/settings/pages
2. Check the "Source" section:
   - ✅ Should say: **"GitHub Actions"**
   - ❌ If it says "None" or "Deploy from a branch" → Change it to "GitHub Actions"
3. Click **Save** if you made changes

### Step 2: Check if Deployment Has Run

1. Go to: https://github.com/SSaleh22-stack/Student-Table-Maker-Qu-Student-/actions
2. Look for workflow runs named **"Deploy Web App to GitHub Pages"**
3. Check the status:
   - ✅ **Green checkmark** = Success (site should be working)
   - ⏳ **Yellow circle** = In progress (wait for it to finish)
   - ❌ **Red X** = Failed (check the logs for errors)
   - ⚪ **No runs** = Workflow hasn't run yet

### Step 3: Manually Trigger Deployment (If Needed)

If there are no workflow runs or they failed:

1. Go to: https://github.com/SSaleh22-stack/Student-Table-Maker-Qu-Student-/actions
2. Click on **"Deploy Web App to GitHub Pages"** in the left sidebar
3. Click **"Run workflow"** button (top right)
4. Select branch: **main**
5. Click **"Run workflow"**
6. Wait 2-3 minutes for it to complete

### Step 4: Verify the Site URL

After deployment completes:

1. Go to: https://github.com/SSaleh22-stack/Student-Table-Maker-Qu-Student-/settings/pages
2. You should see a message like:
   ```
   Your site is live at https://ssaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/
   ```
3. Click that URL to open your site

### Step 5: Test the Site

1. Open a new incognito/private browser window
2. Go to: `https://ssaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/`
3. You should see the "Qu Student" web app

## Common Issues

### Issue: "This site can't be reached" or "qu-students.com"

**Cause:** You're using the wrong URL or GitHub Pages isn't enabled

**Fix:**
1. Make sure you're using: `https://ssaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/`
2. Enable GitHub Pages (Step 1 above)
3. Wait 2-5 minutes after enabling

### Issue: "404 Not Found"

**Cause:** Deployment hasn't completed yet or failed

**Fix:**
1. Check Actions tab (Step 2 above)
2. Make sure workflow completed successfully
3. Wait a few more minutes and try again

### Issue: "There isn't a GitHub Pages site here"

**Cause:** GitHub Pages source is not set to "GitHub Actions"

**Fix:**
1. Go to Settings → Pages
2. Change Source to "GitHub Actions"
3. Save and wait for deployment

### Issue: Assets don't load (blank page, broken images)

**Cause:** Base path configuration issue

**Fix:**
1. Clear browser cache (Ctrl+Shift+Delete)
2. Try incognito mode
3. Check browser console (F12) for errors

## Quick Checklist

- [ ] GitHub Pages is enabled (Settings → Pages → Source: GitHub Actions)
- [ ] Workflow has run successfully (Actions tab → Green checkmark)
- [ ] Using correct URL: `https://ssaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/`
- [ ] Waited 2-5 minutes after enabling GitHub Pages
- [ ] Tried incognito/private mode
- [ ] Cleared browser cache

## Still Not Working?

If you've completed all steps above and it still doesn't work:

1. **Check the workflow logs:**
   - Go to Actions tab
   - Click on the latest workflow run
   - Click on "build" job
   - Look for any red error messages

2. **Verify repository name:**
   - Make sure it's exactly: `Student-Table-Maker-Qu-Student-`
   - Case-sensitive and includes the trailing dash

3. **Contact support:**
   - Share a screenshot of:
     - Settings → Pages page
     - Actions tab showing workflow status
     - The exact error message you see

