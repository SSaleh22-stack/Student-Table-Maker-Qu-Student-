# Icon Setup Instructions

The web app needs icon files for PWA (Progressive Web App) functionality. Here are easy ways to create them:

## Option 1: Use the Icon Generator (Easiest)

1. Open `generate-icons.html` in your browser
2. Click "Generate Icons"
3. Download the generated icons
4. Place them in the `public/` folder:
   - `public/icon-192.png`
   - `public/icon-512.png`

## Option 2: Create Simple Icons Online

1. Go to https://www.favicon-generator.org/ or similar
2. Upload a logo/image
3. Generate icons in sizes 192x192 and 512x512
4. Download and place in `public/` folder

## Option 3: Use Node.js Script

If you have Node.js installed:
```bash
cd web-app
node create-icons.js
```

This creates minimal placeholder icons.

## Option 4: Use Your Own Icons

1. Create or find icon images (192x192 and 512x512 pixels)
2. Save as PNG format
3. Place in `public/` folder:
   - `public/icon-192.png`
   - `public/icon-512.png`

## Quick Fix (Temporary)

If you just want to remove the warnings temporarily, the icons are already set to optional in `manifest.json`. The app will work without them, but icons are recommended for a better user experience.

## Recommended Icon Design

- **Size**: 192x192 and 512x512 pixels
- **Format**: PNG with transparency
- **Design**: Simple, recognizable logo or "QU" text
- **Colors**: Match your app theme (#667eea to #764ba2 gradient)

