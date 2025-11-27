# GitHub Pages Deployment Checklist

## ✅ Pre-Deployment Checklist

Before deploying, ensure:

1. **GitHub Pages Source is Correct:**
   - Go to: Settings → Pages
   - Source MUST be: **"GitHub Actions"** (NOT "Deploy from a branch")
   - If wrong, change it and click Save

2. **Workflow is Configured:**
   - ✅ `.github/workflows/deploy-web-app.yml` exists
   - ✅ Workflow builds from `web-app/` directory
   - ✅ Workflow creates `.nojekyll` file
   - ✅ Workflow uploads `web-app/dist/` as artifact

3. **Build Configuration:**
   - ✅ `web-app/vite.config.ts` has correct `base` path
   - ✅ `NODE_ENV=production` is set during build
   - ✅ `.nojekyll` file exists in `web-app/public/` (will be copied to dist)

## 🚀 Deployment Steps

### Step 1: Verify GitHub Pages Source
1. Repository → **Settings** → **Pages**
2. **Source:** Must be **"GitHub Actions"**
3. If not, change it and **Save**

### Step 2: Trigger Deployment
1. Go to **Actions** tab
2. Click **"Deploy Web App to GitHub Pages"**
3. Click **"Run workflow"** (green button)
4. Select `main` branch
5. Click **"Run workflow"**

### Step 3: Monitor Build
- Watch the **build** job:
  - ✅ Should install dependencies
  - ✅ Should build the app (`npm run build`)
  - ✅ Should create `.nojekyll` file
  - ✅ Should upload artifact
- Watch the **deploy** job:
  - ✅ Should deploy to GitHub Pages

### Step 4: Wait and Test
1. Wait **2-5 minutes** after workflow completes
2. Clear browser cache (Ctrl+Shift+Delete)
3. Visit: `https://ssaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/`
4. Should see the React app (NOT README)

## 🔍 Troubleshooting

### If you still see README:

1. **Check Actions Tab:**
   - Did the workflow complete successfully?
   - Check the "build" job logs
   - Look for ".nojekyll file created successfully" message

2. **Check GitHub Pages Settings:**
   - Settings → Pages → Source
   - MUST be "GitHub Actions"
   - If it's "Deploy from a branch", that's the problem!

3. **Verify Build Output:**
   - The workflow should build to `web-app/dist/`
   - Should contain: `index.html`, `assets/`, `.nojekyll`

4. **Wait Longer:**
   - GitHub Pages can take up to 10 minutes to update
   - Be patient and try again

5. **Try Different Browser/Device:**
   - Sometimes cache is very persistent
   - Try incognito mode or different device

## 📝 Important Notes

- **DO NOT** commit `web-app/dist/` to the repository
- The workflow builds it automatically on GitHub
- The `.nojekyll` file is created by the workflow
- GitHub Pages source MUST be "GitHub Actions" (not a branch)

## ✅ Success Indicators

When it's working, you'll see:
- React app loads (not README)
- Navigation bar appears
- All features work (Timetable, GPA Calculator, Absence Calculator, etc.)
- URL: `https://ssaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/`

