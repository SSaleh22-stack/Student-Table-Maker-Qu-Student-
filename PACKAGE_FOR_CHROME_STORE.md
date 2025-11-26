# How to Package Extension for Chrome Web Store

## Important: Only ONE manifest.json file

The Chrome Web Store requires exactly **ONE** `manifest.json` file at the root of your extension package.

## Steps to Package:

1. **Build the extension** (if not already done):
   ```bash
   npm run build
   ```

2. **Navigate to the dist folder**:
   - Go to: `C:\Users\week8\Desktop\Table Maker Extension\dist`

3. **Select ALL contents INSIDE the dist folder** (NOT the dist folder itself):
   - manifest.json (this is the ONLY manifest.json file)
   - assets/
   - dashboard.html
   - src/

4. **Create a ZIP file**:
   - Select all the files/folders listed above
   - Right-click → Send to → Compressed (zipped) folder
   - OR use 7-Zip/WinRAR to create a zip
   - Name it something like: `qu-student-extension-v3.0.0.zip`

5. **Verify the ZIP structure**:
   When you open the ZIP, it should look like this:
   ```
   qu-student-extension-v3.0.0.zip
   ├── manifest.json          ← ONLY ONE manifest.json at root
   ├── dashboard.html
   ├── assets/
   │   ├── dashboard.css
   │   └── dashboard.js
   └── src/
       ├── background/
       │   └── index.js
       ├── content/
       │   ├── contentScript.js
       │   └── reviewAutofill.js
       └── pages/
           └── dashboard.html
   ```

6. **Upload to Chrome Web Store**:
   - Go to Chrome Web Store Developer Dashboard
   - Upload the ZIP file
   - The manifest.json should be at the root level of the ZIP

## ⚠️ Common Mistakes to Avoid:

- ❌ DON'T zip the `dist` folder itself (this creates `dist/manifest.json` inside the zip)
- ❌ DON'T include the root `manifest.json` from the project folder
- ❌ DON'T include `node_modules`, `.git`, or source files
- ✅ DO zip only the contents of the `dist` folder
- ✅ DO ensure `manifest.json` is at the root of the ZIP file

## Current Extension Info:
- **Name**: Qu Student
- **Version**: 3.0.0
- **Manifest Version**: 3


