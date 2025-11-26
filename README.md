# STUDENT TABLE MAKER

Chrome Extension for Qassim University students to extract courses and build visual timetables.

## Phase 1: Boilerplate & Skeleton ✅

This phase includes:
- React + TypeScript + Vite setup
- Manifest V3 configuration
- Basic "Hello World" dashboard
- Project structure foundation

## Phase 2: Core Dashboard Layout ✅

This phase includes:
- Hero section with animated title (fade-in + translateY animation)
- Bilingual support (English/Arabic) with language toggle
- Language preference persistence in chrome.storage
- Static course list component with dummy data (4 sample courses)
- Static timetable grid view (Sunday-Thursday, 8:00-20:00)
- Responsive card-based UI with modern styling
- RTL layout support for Arabic

## Setup & Installation

1. Install dependencies:
```bash
npm install
```

2. Build the extension:
```bash
npm run build
```

3. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `dist` folder from this project

4. Test the extension:
   - Click the extension icon in Chrome toolbar
   - The dashboard should open in a new tab showing "STUDENT TABLE MAKER"

## Development

For development with auto-rebuild:
```bash
npm run dev
```

After building, reload the extension in `chrome://extensions/` to see changes.

## Project Structure

```
/
├── src/
│   ├── components/     # React components
│   ├── pages/          # Dashboard page
│   ├── background/     # Service worker
│   ├── types/          # TypeScript types
│   └── ...
├── manifest.json       # Chrome extension manifest
├── package.json
└── vite.config.ts
```

## Next Steps

Phase 3 will add:
- Real timetable logic (add/remove courses)
- Conflict detection and visual highlighting
- Timetable state persistence in chrome.storage
- Interactive course blocks in the timetable grid
