# Qu Student - Web App for iPad

This is a standalone web application version of the Chrome extension that works on iPad Safari and other browsers.

## Features

- ✅ Extract courses from QU student portal (via bookmarklet)
- ✅ Build visual timetables
- ✅ Course review autofill helper
- ✅ Works on iPad, iPhone, and desktop browsers
- ✅ No installation required - just open in browser
- ✅ Auto-extract courses using bookmarklet (works like Chrome extension!)

## How to Use on iPad

1. **Host the web app** on a web server (or use local development server)
2. **Open Safari on iPad** and navigate to the web app URL
3. **Add to Home Screen** (optional) for app-like experience:
   - Tap the Share button
   - Select "Add to Home Screen"
   - The app will work like a native app

## Auto-Extract Courses with Bookmarklet

**NEW!** You can now automatically extract courses just like the Chrome extension!

1. **Set up the bookmarklet** (see `BOOKMARKLET_INSTRUCTIONS.md`)
2. **Go to QU portal** course page
3. **Click the bookmarklet** - it extracts all courses automatically
4. **Open the web app** - courses are automatically loaded!

The bookmarklet saves data to localStorage, which the web app reads automatically.

## Setup Instructions

1. Install dependencies:
   ```bash
   cd web-app
   npm install
   ```

2. Start development server:
   ```bash
   npm run dev
   ```

3. For production, build and serve:
   ```bash
   npm run build
   npm run preview
   ```

## Deployment Options

- **GitHub Pages**: Free hosting for static sites
- **Netlify**: Free hosting with easy deployment
- **Vercel**: Free hosting for web apps
- **Your own server**: Any web server that can serve static files

