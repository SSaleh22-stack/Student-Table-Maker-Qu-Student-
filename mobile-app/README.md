# Qu Student — mobile app (Expo)

The iOS / Android version of Qu Student, in the "Teal Planner" design.
Arabic only, right-to-left. Built with Expo SDK 58 and Expo Router.

## Run it

```bash
cd mobile-app
npm install
npx expo start
```

Scan the QR code with **Expo Go** on your phone (iOS or Android).

`npm run web` opens a browser preview. The portal import and the Qeeem site need the phone app
(they use a WebView), so in the browser preview the import screen offers made-up sample courses instead.

## What's in it

| Tab / screen | File |
| --- | --- |
| الجدول — timetable + course list, live preview, clashes, undo | `src/app/(tabs)/index.tsx` |
| استيراد — student portal in a WebView, extracts the offered courses | `src/app/import.tsx` |
| الملخص — chosen sections, exam periods, share as text | `src/app/summary.tsx` |
| المعدل — GPA calculator (5 or 4 scale) | `src/app/(tabs)/gpa.tsx` |
| الغياب — absence per course (15 weeks, 25% limit by default) | `src/app/(tabs)/absence.tsx` |
| قيم — qeeem.com/qu inside the app | `src/app/(tabs)/qeeem.tsx` |
| المزيد — refresh import, contact, share, delete data | `src/app/(tabs)/more.tsx` |

Data stays on the phone (AsyncStorage, `src/store/AppData.tsx`).

## Code shared with the extension

- **Course extractor:** `src/lib/portal/extractor.generated.ts` is built from the extension's
  `src/content/extractCourses.ts`. After changing the extractor, run `npm run build:extractor`.
- **GPA and absence math:** `src/lib/gpa.ts` and `src/lib/absence.ts` are copies of the extension's
  `src/lib` files. Keep both copies in sync.

## Right-to-left

Release builds force RTL through the `expo-localization` plugin (`forcesRTL` in `app.json`).
Expo Go and the web preview can't force RTL, so layouts use the helpers in `src/lib/rtl.ts`
(`row`, `textStart`, `fromStart`, `ltr`, ...) instead of plain `row` / `left` / `right`.
That keeps every screen the same in Expo Go, on the web and in release builds.

## Checks

```bash
npm run typecheck
npx expo lint
npx expo-doctor
```

## Building for the stores

Use EAS: `npx eas-cli@latest build` (needs an Expo account). The app id is `net.qustudent.app`
in `app.json`. Change it before the first store build if you want a different one.

## Not built yet

Export as image / PDF / calendar, adding a course by hand, the course-evaluation helper,
the welcome screen, and iPad-specific layouts. The designs for these are ready.
