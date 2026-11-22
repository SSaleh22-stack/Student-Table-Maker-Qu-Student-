# PRD: Notebook (Beta)

**Status:** Approved, 2026-11-22. Ready to start Phase 0.
**Product:** QU Student mobile app (Expo SDK 58, React Native 0.88, Arabic-first RTL with English through `tr()`)
**Owner:** Saleh
**Last updated:** 2026-11-22

Name: **المذكرات / Notebook**

---

## 1. Summary

The app gets a notebook where students write with a pen or a finger. They can make blank notebooks on lined, grid or dotted paper, or bring in a PDF (lecture slides, a past exam, a scanned sheet) and write on top of it. A toolbar holds the pen, highlighter, eraser, lasso, shapes and ruler, text, and images. Students can record the lecture while they write and tap any stroke later to hear what was being said at that moment.

Notebooks live on the device and back up automatically to iCloud (iOS) or Google Drive (Android). Students can export them as a PDF or an image, or send the editable notebook to a classmate as a file.

The notebook launches as a **Beta** icon in the services grid on the Home page. Every student sees it, and it is free.

## 2. Decisions so far

| Topic | Decision |
|---|---|
| Name and icon | **المذكرات / Notebook**, with a notebook-and-pen icon |
| Devices (first release) | iPad, iPhone, Android tablets and phones. **Not the web app.** |
| Phones | **Full toolbar**, the same tools as tablets, laid out for a small screen |
| Oldest supported devices | The same minimum as the current app. No separate minimum for the notebook. |
| Storage | On the device, with **automatic** backup once the student turns it on |
| iOS backup | A "QU Student" folder in **iCloud Drive that the student can see in the Files app** |
| Android backup | **Google Drive, with Google sign-in** (no size cap) |
| Organizing | **Both**: a folder for each course in the student's timetable, plus folders the student makes |
| Old courses | Nothing happens automatically. The folder stays, and the student moves it manually if they want. |
| Tools | Pen, highlighter, eraser, lasso select, shapes and ruler, text boxes, images, **scientific calculator** |
| Toolbar position | **Long-press and drag** the toolbar to the top (default), bottom, left or right edge |
| Calculator | Opens as a **docked side panel** by default; a button turns it into a **floating, movable panel**. It only calculates; it does not insert results into the page. |
| Library sections | Laid out **right to left**; each section shows **up to 4 items** with a "Show all" link when there are more |
| Default colors | Pens: black, blue, red, green, and the app's teal `#0E7490`. Highlighters: yellow, green, pink, blue. |
| Apple Pencil | Double-tap (and squeeze on Pencil Pro) switches to the eraser |
| PDF import | Files app / file picker, share sheet from other apps, photos and camera scan |
| PDF limits | **No size or page limit.** The app warns only when the device is low on storage. |
| Export | PDF with the ink on it, a page as an image, the editable notebook file |
| Paper | Blank, lined, grid and dotted, with a choice of page color and size |
| Extras | **Audio recording, in the first release** |
| Audio | **No length limit, voice quality** (about 30 MB per hour). **Pauses when the app leaves the screen** and continues when the student comes back. |
| Placement | A new icon in the Home services grid with a "Beta" badge |
| Beta access | Everyone |
| Beta success | Feedback form and store reviews. You remove the badge when you're happy with it. |
| Sharing between students | A file sent through the share sheet (WhatsApp, AirDrop and so on) that opens in QU Student. No server. |
| Recordings when sharing | **The student chooses**, with a switch on the share screen |
| Deleting | Notebooks go to "Recently deleted" for **30 days** |
| Pricing | Free for everyone, no limits |
| Timeline | No fixed date. Phases without dates (section 11) |

### Not chosen (out of scope for this PRD)

These were offered and not picked. They are not planned unless you decide otherwise:
- Handwriting recognition and search
- AI features (summaries, flashcards, quizzes)
- Cornell-notes template
- Infinite canvas
- Web app support
- Cloud accounts and sync across devices
- Sharing by link

## 3. Problem and goals

**Problem:** QU students take handwritten notes and mark up lecture PDFs in separate apps, away from their timetable and tasks. Those apps are usually English-first and some cost money.

**Goals**
1. Writing feels natural: ink follows the pen with no visible lag on iPad and Android tablets.
2. A student can go from "PDF in WhatsApp" to "writing on it" in a few taps.
3. Notes sit next to the student's courses without any setup.
4. Students do not lose work. Saving is automatic, saves are crash-safe, and backup is automatic.
5. It works fully in Arabic (RTL interface, Arabic text boxes) as well as English.

**Non-goals:** see "Not chosen" above.

## 4. Users and key scenarios

- **S1, lecture notes on iPad:** A student opens the course folder, makes a lined notebook, starts recording, and writes with an Apple Pencil. Afterwards they tap a formula and hear the professor explain it.
- **S2, marking up slides:** A classmate posts the slides PDF in a WhatsApp group. The student shares it to QU Student, picks the course, highlights the slides and writes on them.
- **S3, solving a past exam:** The student scans a paper exam with the camera, writes answers on it, and exports a PDF to send to a study group.
- **S4, quick note on a phone:** On an iPhone or Android phone, the student opens a notebook with a finger, adds a text box or a photo of the whiteboard, and reviews earlier notes.
- **S5, sharing notes:** A student sends the editable notebook file to a friend, who opens it in QU Student and keeps writing in their own copy.
- **S6, new phone:** The student installs the app on a new phone, turns on backup, and gets their notebooks back.

## 5. Entry point and beta

- **NB-1** Add a cell to `features()` in `src/app/(tabs)/index.tsx`, labeled `tr('المذكرات', 'Notebook')`, with a small "Beta" / "تجريبي" badge on the icon. The icon is a notebook with a pen. `src/components/Icon.tsx` has only `book` today, so a new `notebookPen` icon is needed in the same line style.
- **NB-2** Hide the cell on web (`Platform.OS === 'web'`), because web is not supported.
- **NB-3** Recheck the Home grid layout. A 9th cell changes the column math, and iPad card sizing was fixed recently (commit fb84202).
- **NB-4** The notebook library has a "Send feedback" entry that opens the existing `/feedback` screen with the topic set to Notebook.
- **NB-5** The beta is judged by the feedback form and store reviews. No analytics are added. The badge stays until you decide to remove it.

## 6. Library and organization

- **NB-10** The library screen shows course folders first, then the student's own folders, then notebooks that are in no folder ("Unfiled").
- **NB-10a** Cards in every section are laid out right to left (the first card at the right edge). Each section shows at most **4 items**. When there are more, the section title shows "عرض الكل (n)" / "Show all (n)", which opens the full list for that section. "New folder" sits next to the "Show all" link in the "My folders" title, not as a card.
- **NB-11** Course folders come from the courses the student chose in the timetable (`chosen` in `AppData`). They are keyed by **course code**, not section, so changing a section keeps the notes. When a course leaves the timetable or a new term starts, **nothing happens automatically**. The folder and its notebooks stay where they are, and the student moves them manually if they want.
- **NB-12** Students can create, rename and delete their own folders. Course folders can't be renamed or deleted while the course is in the timetable.
- **NB-13** Notebooks can be created, renamed, duplicated, moved between folders and deleted. Deleting moves a notebook to "Recently deleted" for 30 days before it is removed for good. It can be restored at any time in those 30 days.
- **NB-14** Each notebook shows a thumbnail of its first page, its last-edited time, and a badge if it has recordings.
- **NB-15** Students can sort by last edited, name or date created.

## 7. Notebook content

### 7.1 Notebook types and paper

- **NB-20** A **blank notebook** starts with paper chosen from blank, lined, grid or dotted.
- **NB-21** Page color: white, cream, or dark. Dark paper switches the default pen to a light color.
- **NB-22** Page sizes: A4 portrait (default), A4 landscape, Letter, and 16:9 widescreen.
- **NB-23** Paper, color and size can be changed for each page. The notebook's default applies to new pages.
- **NB-24** **Pages:** add a page after the current one or at the end, duplicate, delete, reorder (page grid with drag), and jump to a page.
- **NB-25** A notebook can mix pages: a PDF notebook can get blank pages inserted between PDF pages, and a blank notebook can have PDF pages added.

### 7.2 PDF and image import

- **NB-30** **File picker:** pick a PDF from the Files app (iOS) or the system document picker (Android).
- **NB-31** **Share sheet / "Open in":** QU Student appears as a target for PDFs in other apps (WhatsApp, Mail, Blackboard, browsers). On receiving one, the app asks: new notebook (and which folder or course) or add to an existing notebook.
- **NB-32** **Camera scan:** scan paper pages with edge detection and cropping. Several pages become one notebook.
- **NB-33** **Photos:** import one or more photos as pages.
- **NB-34** The PDF is copied into app storage, so the notebook still works if the original is deleted.
- **NB-35** Password-protected PDFs ask for the password once on import. Bad or damaged PDFs show a clear error and never crash the app.
- **NB-36** Large PDFs import in the background with a progress indicator, and the student can start writing on page 1 before the rest finishes. There is **no size or page limit**. Before an import (and before recording), the app checks free space and warns if the device is low on storage.

### 7.3 Tools

All tools sit in one toolbar, which mirrors for RTL.

- **NB-39** **Movable toolbar:** a long press on the toolbar (or its grip handle) lifts it, and drop zones appear at the four edges. Dropping it snaps it to the **top** (default), **bottom**, **left** or **right** edge. At the left or right edge it becomes a vertical bar. The chosen position is remembered for all notebooks.

| ID | Tool | Requirements |
|---|---|---|
| NB-40 | **Pen** | Pressure-sensitive with Apple Pencil and S Pen, smoothed lines. 3 saved pen presets (color and width). Default colors: black, blue, red, green, and the app's teal `#0E7490`, plus a color picker for any other color. 5 widths. |
| NB-41 | **Highlighter** | See-through, drawn under the pen ink so it never covers writing. Default colors: yellow, green, pink, blue, plus the color picker. Optional straight-line mode (hold at the end of a stroke). |
| NB-42 | **Eraser** | Two modes: whole-stroke eraser (default) and pixel eraser. Can be set to erase highlighter only. |
| NB-43 | **Lasso** | Select strokes, shapes, text and images to move, resize, rotate, recolor, copy, cut, paste (also onto another page or notebook), or delete. |
| NB-44 | **Shapes** | Hold at the end of a stroke to snap it to a straight line, arrow, rectangle, circle/ellipse or triangle. A shape tool for drawing shapes directly. |
| NB-45 | **Ruler** | An on-screen ruler you can move and rotate with two fingers. Ink drawn along it snaps straight. Shows its angle. |
| NB-46 | **Text box** | Type Arabic or English with automatic text direction per paragraph. Font size, color, bold. Uses IBM Plex Sans Arabic like the rest of the app. Text boxes can be moved and resized. |
| NB-47 | **Image** | Insert from photos or the camera, then move, resize, rotate, crop and delete. |
| NB-47a | **Scientific calculator** | A toolbar button opens a scientific calculator laid out like a classic exam calculator (the fx-991ES PLUS key set from the reference photo): an LCD-style display with natural math (fractions, integrals, powers); SHIFT and ALPHA keys with gold and pink second-function labels above each key; the round replay (cursor) pad; MODE/SETUP and ON; CALC/SOLVE, ∫ and d/dx, x⁻¹/x!, log with any base and Σ; fractions, √/∛, x²/x³, xⁿ/ⁿ√x, log/10ˣ, ln/eˣ; (−), ° ' ", hyp, sin/cos/tan and their inverses; RCL/STO, ENG, parentheses, S⇔D, M+/M−; the 0–9 keys with CONST, CONV, CLR, MATRIX, VECTOR, STAT, CMPLX, BASE, Rnd and Ran#; green DEL/AC; ×, ÷, +, − with nPr, nCr, Pol and Rec; ×10ˣ with π and e; Ans and =. A short history sits under it. It opens **docked** as a side panel (the page shrinks beside it); a "floating" button turns it into a movable window, and a "dock" button puts it back. It only calculates and never writes onto the page. It copies the layout, colors and functions, but **not the brand name, logo, model name or solar panel** of the real calculator. |
| NB-48 | **Undo / redo** | At least 50 steps per open notebook. Two-finger tap to undo and three-finger tap to redo on tablets. |
| NB-49 | **Navigation** | Pinch to zoom (up to 400%) and pan with two fingers. Scroll pages vertically. |
| NB-49a | **Icons-only header** | The open notebook has no title bar. Only icon buttons float over the canvas: back (top right), and pages, share and more (top left). The page number stays in the counter at the bottom, and the notebook name shows in the pages view and the library. This gives the page about 10% more room. |

**Input rules**
- **NB-50** With a stylus connected (Apple Pencil, S Pen), the stylus draws and fingers scroll and zoom, which also gives palm rejection. A "draw with finger" switch lets a finger draw too.
- **NB-51** Phones have no stylus, so finger drawing is on by default and two fingers scroll. Phones get the **full toolbar**, the same tools as tablets. Less-used tools go into a "more" menu, so it fits a small screen.
- **NB-52** Apple Pencil double-tap (and squeeze on Pencil Pro) switches between the current tool and the eraser by default. In notebook settings, the student can change it to "switch to last tool" or turn it off.

### 7.4 Audio recording

- **NB-60** A record button in the notebook toolbar starts and stops recording. While it records, a timer shows and a red dot appears on the toolbar.
- **NB-61** Every stroke, shape and text box made during a recording stores the time it was made in that recording.
- **NB-62** **Playback:** there is a player bar (play/pause, scrub, speed 1x / 1.5x / 2x). While it plays, ink made after the current moment is dimmed, so students can follow along. Tapping a stroke with the "play from here" tool jumps the audio to that moment.
- **NB-63** A notebook can hold several recordings, listed with date and length. Recordings can be renamed and deleted.
- **NB-64** The microphone permission is requested the first time someone records, with a clear explanation. Recording without permission shows how to turn it on in Settings.
- **NB-65** Recording **pauses** when the app leaves the screen (the student switches apps, the screen locks, or a call comes in). When the student comes back, a banner offers "Continue recording", and the audio continues in the same recording. No background-audio permission is needed.
- **NB-66** If the app crashes mid-recording, the audio up to that point is kept.
- **NB-67** **No length limit.** Recordings use voice quality: mono AAC at about 64 kbps, roughly 30 MB per hour. Recording is limited only by free storage, with the low-storage warning from NB-36.
- **NB-68** The screen stays awake while recording in the notebook, so auto-lock doesn't pause a lecture recording halfway.

### 7.5 Export and sharing

- **NB-70** **Export as PDF:** the whole notebook or a range of pages, with the ink drawn onto the pages. Original PDF pages keep their text, so it can still be selected and searched in other apps. Ink is exported as vectors, not a blurry image. Audio is not included.
- **NB-71** **Export a page as an image** (PNG) at a sharp resolution.
- **NB-72** **Share the editable notebook:** a single notebook file (for example `.qunote`: a zip holding the notebook data, its PDFs, images, and optionally recordings) sent through the system share sheet. The file extension is still to be confirmed.
- **NB-73** Opening a `.qunote` file on a device with QU Student imports a **copy** into the library and asks which folder or course to put it in. Nothing syncs back to the sender.
- **NB-74** The share screen has an "Include recordings" switch that shows the file size with and without them. It only appears when the notebook has recordings.

## 8. Storage, saving and backup

- **NB-80** Notebooks are stored as files in the app's document directory (`expo-file-system`), **not** in AsyncStorage, which is too small for PDFs, images and audio. A small index (titles, folders, thumbnails) can stay in AsyncStorage, following the tasks pattern (`qu-student:notebooks:v1`).
- **NB-81** Saving is automatic: after every change (debounced about 1 s), when a page is left, and when the app goes to the background. There is no save button.
- **NB-82** Writes are crash-safe: write to a temporary file, then rename. A save that can't be read is kept aside, not overwritten, the same idea as `BACKUP_KEY` in `src/store/Tasks.tsx`.
- **NB-83** The data has a version number (`version: 1`) and is read field by field, so older or damaged saves don't crash the app (the same as `readTask`).
- **NB-84** Notebooks are separate from the timetable data. Clearing the timetable never deletes notes.
- **NB-85** **Automatic backup** is off until the student turns it on in the notebook settings. Once on, it backs up in the background after changes. A "Restore from backup" screen lists backed-up notebooks. The last backup time is shown.
- **NB-86** **iOS:** backups go to a "QU Student" folder in iCloud Drive that the student can see in the Files app. The student must be signed in to iCloud with iCloud Drive on. If not, the app explains how to turn it on.
- **NB-86a** **Android:** backups go to the student's Google Drive. Turning backup on asks the student to sign in with Google once. The app uses the narrow `drive.file` permission, so it sees only the files it created, and keeps them in a "QU Student" folder that is visible like on iOS. Signing out or revoking access turns backup off, with a clear message.
- **NB-86b** Backup runs only over Wi-Fi by default, with a switch to allow mobile data, because PDFs and audio are large.
- **NB-87** Settings show how much storage notebooks use (total, plus recordings and PDFs separately).

## 9. Non-functional requirements

These targets must hold on the oldest devices the app already supports. The notebook has no separate minimum.

| Area | Target |
|---|---|
| Ink latency | Ink is drawn on the UI thread, never waiting on JS. No visible lag on the reference iPad and Android tablet. |
| Smoothness | 60 fps while writing, zooming and scrolling, on a 100-page notebook |
| Open time | A notebook (or a 50-page PDF) shows its first page in under 1 s |
| PDF clarity | Pages are re-rendered sharply at every zoom level |
| Reliability | Zero lost strokes on a crash or force-quit after the debounce window |
| Accessibility | Toolbar buttons have labels and hints, like the existing `accessibilityLabel` usage |
| Localization | Every string goes through `tr()`. The whole UI mirrors in RTL. The drawing area itself does not mirror. |
| Privacy | Notes, PDFs and audio stay on the device and in the student's own iCloud/Drive. Nothing goes to QU Student servers. |

## 10. Technical approach (approved)

Every option below adds **native code**. The notebook therefore needs a new store build (`eas build`) and can't ship as an over-the-air update. Versions must be checked against the Expo SDK 58 docs before installing (see `AGENTS.md`).

| Need | Proposal | Notes |
|---|---|---|
| Ink canvas | `@shopify/react-native-skia` + `react-native-gesture-handler` + Reanimated (both already installed) | One drawing engine on iOS and Android, so ink looks the same on both. Apple's PencilKit would be iOS-only. |
| PDF page rendering | A local Expo module in `modules/` (iOS PDFKit, Android `PdfRenderer`) that renders page tiles at the needed zoom | The repo already has local modules (`modules/text-share`) |
| PDF export with ink | `pdf-lib` (JS) to draw ink paths onto the original PDF pages | Keeps the original text selectable |
| Camera scan | iOS VisionKit document camera, Android ML Kit Document Scanner, through a local module or a maintained library | Needs camera permission |
| Audio | `expo-audio` | Needs microphone permission (`NSMicrophoneUsageDescription`, Android `RECORD_AUDIO`). No background-audio mode, because recording pauses when the app leaves the screen (NB-65). |
| Screen awake while recording | `expo-keep-awake` | For NB-68 |
| iCloud Drive backup | A local Expo module for the app's iCloud Drive (ubiquity) container, set as visible in Files | Needs an iCloud container on the Apple developer account, plus iCloud entitlements through a config plugin. `expo-file-system` can't write to iCloud on its own. |
| Google Drive backup | Google Sign-In for React Native + the Drive REST API, with the `drive.file` scope | Needs a Google Cloud project, an OAuth client for the Android package `net.qustudent.app`, and an OAuth consent screen |
| Receive PDFs and `.qunote` files | Register document types (iOS `CFBundleDocumentTypes`, Android intent filters) through `app.json` or a config plugin | Never edit `ios/` or `android/` by hand |
| Notebook file | Zip with `fflate` (already installed) | |
| Saving | `expo-file-system` (already installed) | |

**Permission changes:** `app.json` has `"permissions": []` on Android and only the iOS entries listed now. The notebook adds the microphone and camera permissions. `READ_EXTERNAL_STORAGE` can stay blocked, because the system document picker doesn't need it.

### Data model (draft)

```ts
interface Notebook {
  id: string;
  title: string;
  folderId?: string;        // a folder the student made
  courseCode?: string;      // a course folder
  createdAt: string;        // ISO
  updatedAt: string;
  defaults: PaperSpec;
  pageIds: string[];        // order
  recordings: Recording[];
}

type PaperSpec = { style: 'blank' | 'lined' | 'grid' | 'dotted'; color: 'white' | 'cream' | 'dark'; size: 'a4' | 'a4-landscape' | 'letter' | 'wide' };

interface Page {
  id: string;
  background: { kind: 'paper'; paper: PaperSpec } | { kind: 'pdf'; fileId: string; pageIndex: number } | { kind: 'image'; fileId: string };
  items: PageItem[];        // drawn in order; highlighter drawn below the rest
}

type PageItem =
  | { kind: 'stroke'; id: string; tool: 'pen' | 'highlighter'; color: string; width: number; points: number[] /* x,y,pressure,… */; rec?: RecMark }
  | { kind: 'shape'; id: string; shape: 'line' | 'arrow' | 'rect' | 'ellipse' | 'triangle'; /* geometry */ rec?: RecMark }
  | { kind: 'text'; id: string; text: string; /* box, font size, color */ rec?: RecMark }
  | { kind: 'image'; id: string; fileId: string; /* box, rotation, crop */ };

type RecMark = { recordingId: string; ms: number };   // where in the recording this was made
interface Recording { id: string; fileId: string; title: string; startedAt: string; durationMs: number }
```

Each page is saved as its own file, so a change on one page doesn't rewrite the whole notebook.

## 11. Phases (no dates)

| Phase | Contents | Done when |
|---|---|---|
| **0. Technical spike** | Skia ink with pressure on a real iPad and an Android tablet. PDF tile rendering. Audio timestamps on strokes. | Ink latency and smoothness meet section 9 on the reference devices |
| **1. Core notebook** | Library, folders and course folders, blank notebooks and paper, pen, highlighter, eraser, undo, zoom, autosave | Students can take notes end to end |
| **2. PDF and import** | PDF render, file picker, share sheet / Open in, photos, camera scan, mixed pages | Scenarios S2 and S3 work |
| **3. Full toolset** | Lasso, shapes and ruler, text boxes, images | Every tool in 7.3 works |
| **4. Audio** | Recording, linked playback, recordings list | Scenario S1 works |
| **5. Export, share, backup** | PDF/PNG export, `.qunote` share and open, automatic iCloud/Drive backup and restore | Scenarios S5 and S6 work |
| **Beta release** | Home icon with Beta badge, feedback entry, store build | Live for everyone |

## 12. Risks

- **Ink quality on Android** varies by device and stylus. Phase 0 is there to find this out early.
- **Storage growth:** audio and PDFs get big quickly. Mitigations: the storage view (NB-87) and the recordings choice on share (NB-74).
- **Google sign-in:** this is the app's first sign-in of any kind. It needs Google Cloud setup and an OAuth consent screen, and the privacy policy must explain it. Some students won't want to sign in, so their notebooks stay on the device only.
- **iCloud setup:** the iCloud container and entitlements must be set up before the iOS build. Students with iCloud Drive turned off get no backup.
- **Recording pauses on leave:** a student who checks another app mid-lecture loses that part of the recording unless they come back and continue. NB-68 (keeping the screen awake) reduces this.
- **App size and review:** new native modules plus microphone and camera permissions. The App Store review needs clear permission texts.
- **Home grid layout** with a 9th icon, on both iPhone and iPad (NB-3).

## 13. Approval

Approved on 2026-11-22. Every product question is answered, and the earlier proposals are accepted: the technical approach (section 10), the performance targets (section 9), keeping the screen awake while recording (NB-68), the Google Drive `drive.file` permission with a visible folder (NB-86a), and Wi-Fi-only backup by default (NB-86b).

Before the Phase 0 code starts, check every library in section 10 against the Expo SDK 58 docs (see `AGENTS.md`).
