# How to Publish Your Site to GitHub Pages

## Step 1: Enable GitHub Pages

1. Go to your GitHub repository:
   ```
   https://github.com/SSaleh22-stack/Student-Table-Maker-Qu-Student-/
   ```

2. Click on **Settings** (top menu bar)

3. Scroll down to **Pages** in the left sidebar (under "Code and automation")

4. Under **Source**, select:
   - **Source**: `GitHub Actions` (NOT "Deploy from a branch")
   
5. Click **Save**

## Step 2: Trigger Deployment

After enabling GitHub Actions as the source, you can:

**Option A: Wait for automatic deployment**
- The workflow will automatically run when you push changes to `main` branch
- It's already configured to trigger on changes to `web-app/**` files

**Option B: Manually trigger deployment**
1. Go to the **Actions** tab in your repository
2. Click on **Deploy Web App to GitHub Pages** workflow
3. Click **Run workflow** button (on the right)
4. Select `main` branch
5. Click **Run workflow**

## Step 3: Wait for Deployment

1. Go to the **Actions** tab
2. Click on the running workflow
3. Wait for both jobs to complete:
   - ✅ **build** job (builds the web app)
   - ✅ **deploy** job (deploys to GitHub Pages)

## Step 4: Access Your Site

Once deployment completes, your site will be available at:
```
https://ssaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/
```

## Troubleshooting

### If the site shows "404" or "There isn't a GitHub Pages site here":

1. **Check Actions tab**: Make sure the workflow completed successfully
2. **Check Pages settings**: Ensure "Source" is set to "GitHub Actions" (not a branch)
3. **Wait a few minutes**: Sometimes it takes 2-5 minutes for the site to be available after deployment
4. **Check the workflow logs**: Click on the workflow run and check for any errors

### If assets don't load:

- The base path is configured as `/Student-Table-Maker-Qu-Student-/`
- Make sure the repository name matches exactly (case-sensitive)
- Clear your browser cache and try again

## Current Status

✅ GitHub Actions workflow is configured
✅ Build configuration is correct
✅ Base path is set for GitHub Pages
⏳ **You need to enable GitHub Pages in Settings → Pages → Source: GitHub Actions**

