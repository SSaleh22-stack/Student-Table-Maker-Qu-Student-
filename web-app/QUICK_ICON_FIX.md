# Quick Icon Fix

The icon files need to be proper PNG images. Here's the fastest way to fix:

## Option 1: Use the Icon Generator (Recommended)

1. Open `public/create-icons-simple.html` in your browser
2. Icons will auto-generate
3. Click the download links
4. Save the files to `web-app/public/` folder:
   - `icon-192.png`
   - `icon-512.png`

## Option 2: Use Online Generator

1. Go to https://www.favicon-generator.org/
2. Upload any image or use their generator
3. Download 192x192 and 512x512 sizes
4. Save to `web-app/public/` folder

## Option 3: Create Simple Icons Manually

Create two PNG files:
- `public/icon-192.png` (192x192 pixels)
- `public/icon-512.png` (512x512 pixels)

Use any image editor (Paint, Photoshop, GIMP, etc.) to create simple colored squares with "QU" text.

## Temporary Fix (Remove Icons)

If you just want to remove the error temporarily, edit `manifest.json` and change:
```json
"icons": []
```

But icons are recommended for PWA functionality.

