# Deploying the Web App to GitHub Pages

This guide will help you deploy the Qu Student web app to GitHub Pages.

## Prerequisites

1. Your code is pushed to GitHub
2. GitHub Pages is enabled in your repository settings

## Steps to Deploy

### 1. Enable GitHub Pages

1. Go to your repository on GitHub: `https://github.com/SSaleh22-stack/Student-Table-Maker-Qu-Student-`
2. Click on **Settings** (in the repository menu)
3. Scroll down to **Pages** (in the left sidebar)
4. Under **Source**, select:
   - **Source**: `GitHub Actions`
5. Click **Save**

### 2. Commit and Push Your Changes

The GitHub Actions workflow will automatically deploy when you push changes to the `web-app` folder:

```bash
# Add all changes
git add .

# Commit
git commit -m "Deploy web app to GitHub Pages"

# Push to GitHub
git push origin main
```

### 3. Monitor Deployment

1. Go to your repository on GitHub
2. Click on the **Actions** tab
3. You'll see the "Deploy Web App to GitHub Pages" workflow running
4. Wait for it to complete (usually takes 1-2 minutes)

### 4. Access Your Web App

Once deployed, your web app will be available at:
```
https://SSaleh22-stack.github.io/Student-Table-Maker-Qu-Student-/
```

## Manual Deployment (Alternative)

If you prefer to deploy manually:

1. Build the web app:
   ```bash
   cd web-app
   npm run build
   ```

2. The built files will be in `web-app/dist/`

3. You can then:
   - Use a tool like `gh-pages` to deploy
   - Or manually copy the `dist` folder contents to a `gh-pages` branch

## Troubleshooting

### The app doesn't load correctly

- Check that the `base` path in `vite.config.ts` matches your repository name
- Make sure all assets are loading (check browser console)

### Build fails

- Make sure all dependencies are installed: `npm install` in the `web-app` folder
- Check the Actions tab for error messages

### Changes not appearing

- Clear your browser cache
- Wait a few minutes for GitHub Pages to update (can take up to 10 minutes)

## Updating the Deployment

Every time you push changes to files in the `web-app` folder, the workflow will automatically:
1. Build the app
2. Deploy it to GitHub Pages

No manual steps required!

