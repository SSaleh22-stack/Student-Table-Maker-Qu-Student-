# Widgets (الودجات) Figma designs

A local Figma plugin that draws the home-screen and lock-screen widgets for iOS and Android, in Arabic (RTL). PNG previews of every board are in [`../widgets-previews`](../widgets-previews).

## Run it

1. Open the Figma desktop app and the design file "QU Student — Widgets (iOS & Android)".
2. Menu → Plugins → Development → **Import plugin from manifest…** and pick `manifest.json` in this folder. You only do this once.
3. Run **QU Widgets Designs** from Plugins → Development. After that, **Ctrl+Alt+P** reruns it.

Each run **deletes everything on the page named "الودجات — iOS و Android"** and draws it again. Don't hand-edit that page: rerunning throws your edits away.

## What it draws

Three widgets: **الجدول** (today's lectures), **مهامي** (tasks, ticked from the widget) and **المحاضرة القادمة** (next-lecture countdown).

- **Notes** and an **overview** of iPhone home/lock screens and Android home screens.
- **iOS** in light, dark and tinted: small 170×170, medium 364×170, large 364×382, iPad extra-large 724×340.
- **iOS empty states**: "no lectures left today" once the day's lectures are over, and all tasks done.
- **iOS Lock Screen**: circular, rectangular and inline.
- **Android** in light and dark: 2×1, 4×1, 2×2, 4×2, 4×4 (resizable), plus empty states.

Sample data comes from `mobile-app/src/lib/sampleCourses.ts`. Colors and fonts from `mobile-app/src/lib/theme.ts` and the course palette in `mobile-app/src/lib/courses.ts`.

## Edit it

Change `code.js`, then rerun the plugin. Figma reads the file from disk on every run.
