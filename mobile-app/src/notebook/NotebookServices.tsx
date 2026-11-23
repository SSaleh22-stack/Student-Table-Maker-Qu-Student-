/**
 * The notebook's app-wide services (P30). This is their ONLY mount point. The root layout
 * (src/app/_layout.tsx) renders <NotebookServices/> inside NotebooksProvider and OUTSIDE
 * <View key={lang}>, so a language switch never restarts a recording, a cover render or a backup.
 * Every service is an idempotent, ref-counted module singleton. A second mount (Fast Refresh,
 * StrictMode) still runs one of each.
 *
 * WHAT IT MOUNTS (iOS and Android; NotebookServices.web.tsx renders null, so the web bundle never
 * pulls in Skia, expo-audio or the PDF module):
 * - <RecorderHost/> (P12). This is the recorder's host slot. The recorder itself is a module
 *   singleton (expo-audio 58 has a constructible AudioRecorder), so the host renders nothing.
 * - useThumbnailWorker() (P23). This is the ONLY writer of notebooks/<id>/thumbs/cover.png.
 * - useBackupAutoRun() (P20). Backup is OFF until the student turns it on (NB-85), and nothing
 *   runs while it is off.
 * - Once per app run, at boot:
 *   - cleanupIncomingLeftovers() (P17) removes share payloads and Inbox copies left by an earlier
 *     run. It leaves a share that is waiting to be stashed alone.
 *   - resumeAllPending() (P17) resumes every background PDF import (NB-36) once the index is
 *     loaded.
 *   - The renderer crash journal (pdfEngine.consumeCrashJournal, P10/P10A) is read once, through
 *     import/jobs.ts takeRenderCrash, so the import jobs share the same entry. When the crashed
 *     render was a notebook's own PDF asset, that page is marked damaged through the notebook's
 *     session (markDamagedPdfPage, history: false), and the session flushes. The page then shows
 *     the damaged-page placeholder and never takes the app down again. A crash inside a running
 *     import (the notebook's pending.fileId) is left to that import job (claimRenderCrash in
 *     runJob, plus its probing record).
 *
 * =====================================================================================
 * SCENARIO WALKTHROUGH (PRD section 4; the owning packages for each step are in brackets)
 * =====================================================================================
 * S1, lecture notes on iPad:
 *   1. Home > المذكرات (P14, shown in development builds or once NOTEBOOK_HOME_FLAG is on) opens
 *      the library (P21). The course folder comes from the timetable (P03 courseFolders, P21
 *      section rules).
 *   2. 'مذكرة جديدة في CS102' > lined paper (P21 NewNotebookModal, P04U PaperPicker). The
 *      notebook file and its index entry are created by P03 ops.create through the P03B store.
 *   3. The record button (P12 RecordButton, in P29's recordSlot): permission sheet (P12), then
 *      recording. Marks are taken only for this notebook (recMark, P29 useToolPlugins).
 *   4. Writing with Apple Pencil (P22 canvas, P16 painter, P05 ink). Palm rejection and Pencil
 *      double tap (P11, P22 pencil.ts) follow the settings (P26).
 *   5. Stop, then play (P12 PlayerBar, P29 usePlaybackFlow). With the play tool, a tap on a formula
 *      seeks to its mark (P22 onPlayFrom, P12 player). Ink after the current moment is dimmed (P22
 *      playback.ts).
 * S2, marking up slides from WhatsApp:
 *   1. Share the PDF to QU Student. P17 +native-intent stashes it, and the receive screen (P17
 *      ReceiveScreen) opens.
 *   2. Pick the course (P04U LocationChips) or an existing notebook (P17 NotebookPickerSheet).
 *   3. The import runs in the background (P17 jobs, P10/P10A engine). Page 1 is usable at once
 *      (NB-36), and the card shows progress (P21 Thumb).
 *   4. Highlight and write (P22 canvas, P13 toolbar, P16 PDF tiles and the highlighter group).
 * S3, solving a past exam:
 *   1. 'مسح بالكاميرا' (P17 scan, expo-camera scanDocumentAsync).
 *   2. Write on it (P22, P13).
 *   3. Export a PDF (P23 ExportSheet and pdfExport: vector ink, highlighter transparency group).
 *   4. Share it (P04U shareFile).
 * S4, quick note on a phone:
 *   1. Open a notebook with a finger. The phone default is Finger with fingerDraws (NB-51, P02
 *      defaults, P15 setup). P22 palm and finger rules apply.
 *   2. The compact toolbar (P13 phone layout, P29 editorFrames).
 *   3. A text box (P28 text tool).
 *   4. A photo of the whiteboard (P27 image tool, camera or photos).
 *   5. Review earlier notes: the library and sections (P21), and the pages grid (P25).
 * S5, sharing an editable notebook:
 *   1. Export a .qunote (P23 ExportSheet, P08 pack). The recordings choice is NB-74.
 *   2. The friend opens the file (P17 receive, through 'Open in' or a share).
 *   3. P08 importQunote creates a copy (asCopy, then ops.adoptFolder, P03).
 *   4. The friend keeps writing in their own copy (P29 editor).
 * S6, new phone:
 *   1. Notebook settings > backup on (P26 SettingsScreen, P20 BackupSection, P20 useEnableBackupFlow).
 *      The remote check finds the old backup and offers restore (RemoteFoundDialog).
 *   2. Restore (P20 RestoreScreen, P09 planRestore). Folders and course names come back with
 *      library.json (P09 mergeLibraryData).
 *   3. Automatic backups follow (P20 useBackupAutoRun, mounted here).
 *
 * PRD section 11 'Done when' gates, mapped to scenarios:
 * - Phase 0 (spike): the ink latency and smoothness targets on the reference devices. P16 spike
 *   screen, gates G-INK/G-MEM/G-PDF/G-AUDIO/G-RTL. These are prerequisites for S1 and S4 (writing).
 * - Phase 1 (core notebook, "take notes end to end"): S4 steps 1, 2 and 5, and S1 steps 1, 2 and 4.
 * - Phase 2 (PDF and import): S2 and S3.
 * - Phase 3 (full toolset, "every tool in 7.3 works"): S4 steps 3 and 4. Also lasso, shapes, ruler,
 *   eraser modes and the calculator in the editor (P27, P28, P24).
 * - Phase 4 (audio): S1.
 * - Phase 5 (export, share, backup): S5 and S6, plus S3 step 3.
 * - Beta release: NOTEBOOK_HOME_FLAG = true in a store build (Home cell, Beta badge, announcement
 *   slide; the @QUStud X slide stays), the feedback topic (P14), and S1-S6 passing on devices.
 *
 * PRD section 9 targets (ids PRD9-*), and where each is checked:
 * - PRD9-ink-latency, PRD9-smoothness: Phase 0 G-INK on device, plus P22 wet ink on the UI runtime.
 *   Device item 2.9 (no visible lag, 60 fps on a 100-page notebook), with 2.1-2.4 for the pen paths.
 * - PRD9-open-time: device item 3.6 (a 50-page PDF shows page 1 in under 1 s) and item 2.9 (a
 *   notebook opened from the library shows its first page in under 1 s).
 * - PRD9-pdf-clarity: device item 3.6 (tiles at 400 %).
 * - PRD9-reliability: the Node crash matrices (P02 journal, P03 session) and
 *   tests/notebook/integration/flow.test.ts (P30). On device, force-quit 2 s after a stroke and
 *   reopen (item 1.1).
 * - PRD9-accessibility: VoiceOver and TalkBack pass (item 9.3).
 * - PRD9-localization: every string goes through tr(ar, en), which tsc enforces since tr takes two
 *   arguments. The RTL and LTR passes are item 9.1, and the canvas never mirrors.
 * - PRD9-privacy: no network calls except the student's own iCloud or Drive (P20). Item 9.4.
 *
 * =====================================================================================
 * DEVICE CHECKLIST (consolidated from every package; development builds, iOS and Android)
 * =====================================================================================
 * 1. Saving and storage (P02, P03, P03B, P30)
 *   1.1 Write, wait 2 s, force-quit, then reopen. Nothing is lost (NB-81, PRD9-reliability).
 *   1.2 Move the app to the background mid-edit, then kill it from the app switcher. The edit is
 *       there (the AppState flush).
 *   1.3 Switch the language with a notebook open. The editor remounts, the recording continues and
 *       no service restarts (NotebooksProvider and NotebookServices sit outside key={lang}).
 *   1.4 More > clear the timetable data. The notebooks stay (NB-84), and the alert text says so
 *       when the notebook is shown.
 * 2. Ink and canvas (P22, P16, P05, P06; from the PageCanvas.tsx checklist)
 *   2.1 Palm first, then the pen. Then pen first with the palm landing mid-stroke. Then the palm
 *       dragged during a stroke. The ink follows the pen, and nothing scrolls or splits.
 *   2.2 Right after a pen lift, the side of the hand does nothing for 300 ms. A finger elsewhere
 *       scrolls at once.
 *   2.3 Finger mode: one finger draws. Two fingers scroll or zoom with no dot left behind. A
 *       two-finger tap undoes and a three-finger tap redoes.
 *   2.4 Hold-to-snap: after a 500 ms hold, the ring and preview show and the shape replaces the
 *       stroke with the pen down. A lift before 500 ms keeps the stroke. The highlighter hold
 *       straightens the stroke. A 4000-point stroke continues across the split.
 *   2.5 Two fingers on the ruler move it, with no zoom and no undo. Drawing is blocked while a
 *       selection handle is held (overlayBusy).
 *   2.6 Android: no black flash while the editor fades in and out (SurfaceView). Rotate the tablet
 *       mid-stroke.
 *   2.7 Apple Pencil double tap and squeeze follow the settings. P11 pencil-interaction items 1-7:
 *       one event per tap, no doubling after a reload, Split View.
 *   2.8 Phase 0 G-RTL: physicalLeft boxes land on the physical left in a release (native RTL) build
 *       and in Expo Go.
 *   2.9 PRD section 9 on the oldest supported devices and the reference iPad and Android tablet
 *       (P22, P16, P25, P03): with a busy JS thread (Perf Monitor), the ink still follows the pen
 *       with no visible lag (PRD9-ink-latency). Writing, zooming and scrolling a 100-page notebook
 *       stay at 60 fps (PRD9-smoothness). A notebook opened from the library shows its first page
 *       in under 1 s (PRD9-open-time).
 * 3. PDF (P10, P10A, P16, P17; from engine.ts and pdf-render/android/build.gradle)
 *   3.1 iOS: 20 concurrent renderRegion calls plus one renderPage all resolve. Thread Sanitizer and
 *       Main Thread Checker stay clean.
 *   3.2 Password PDFs: needsPassword, then 'password-required' and 'wrong-password', then
 *       saveDecrypted. Android 8, 12, 14 and 15. iOS: the decrypted output opens without a
 *       password. If the redraw fallback ran, the text may not be selectable.
 *   3.3 Rotated pages (/Rotate 90, 180, 270, crop box offset) render upright, and the tiles line up.
 *   3.4 Crash isolation. Android: kill ':pdf' mid-render. The call rejects 'renderer-crashed', the
 *       next call works, and PDFium is mapped only in ':pdf'. iOS: kill inside renderRegion and
 *       reopen. NotebookServices (or the import job) marks that page damaged, and it opens without
 *       crashing.
 *   3.5 16 KB pages: Play Console compliance, zipalign -c -P 16, LOAD align 0x4000, and a 16 KB
 *       emulator image. If any fails, use the fallback artifact io.github.oothp:pdfium-android.
 *   3.6 A 50-page PDF shows page 1 in under 1 s (PRD9-open-time). At 400 % the tiles are sharp
 *       (PRD9-pdf-clarity). After a relaunch, tiles come from the cache. Phase 0 G-MEM: a 100-page
 *       PDF at 400 % stays at or under 48 MB decoded on a 3-4 GB Android device.
 *   3.7 Idle release: the ':pdf' service unbinds after 2 minutes, and the next render binds again.
 * 4. Import and sharing in (P17, P08)
 *   4.1 Android: share, then cancel on the receive screen. No payload is left (getSharedPayloads is
 *       empty after the next boot). Share, then import: the file is copied before it is cleared.
 *   4.2 iOS 'Open in' from Files and from WhatsApp, for .pdf and .qunote. Inbox copies are removed
 *       after the import, or at the next boot.
 *   4.3 A 100 MB+ PDF: the free-space warning, a background import with progress on the card, and
 *       writing on page 1 meanwhile. Kill the app mid-import: the import resumes at the next launch
 *       (resumeAllPending).
 *   4.4 A scan with the camera, photos (several), and a camera photo as a page.
 *   4.5 The Android octet-stream and zip VIEW filters list QU Student for unknown files, which is
 *       accepted.
 * 5. Audio (P12; from interruptions.ts)
 *   5.1 An incoming call or Siri pauses the recording and shows the continue banner. Pulling Control
 *       Center or 'inactive' alone keeps recording. The lock button and the home gesture count as
 *       leaving the app, on iOS and Android.
 *   5.2 Phase 0 G-AUDIO: kill the app mid-recording. The m4a is probed against ADTS (the iOS '.aac'
 *       ADTS check), and the segment is recovered or marked lost.
 *   5.3 Leave the editor while recording. It stops after the 5 s grace with 'حُفظ التسجيل'. Pushing
 *       the pages, settings or export screen keeps it going.
 *   5.4 The low-storage warning before recording has a 'continue' path.
 * 6. Backup (P20, P09, P11; from icloud-drive/index.ts)
 *   6.1 iCloud: available, documentsPath, files visible in Files > QU Student, a 50 MB copyIn
 *       uploads, an evicted file downloads again, airplane mode gives ERR_ICLOUD_TIMEOUT, iCloud
 *       Drive off fires availabilityChanged, a full iCloud gives 'quota', NSMetadataQuery runs on
 *       the main queue, and a sub-folder from another device is listed.
 *   6.2 Google Drive (Android): sign in once with drive.file. A revoke turns backup off with a
 *       message, while a temporary 401 retries. Wi-Fi only (the default) waits for Wi-Fi. Airplane
 *       mode mid-upload resumes later.
 *   6.3 S6 on a fresh install: turning backup on offers restore, the restore brings back the
 *       notebooks, folders and course names, and nothing remote is deleted.
 *   6.4 Two devices on one account: each keeps the other's notebooks. A conflict is skipped and
 *       shown as a note.
 *   6.5 iOS: the google-signin pod is NOT in Podfile.lock (autolinking exclude), and the app never
 *       imports the package (only googleAuth.android.ts does).
 * 7. Export (P23, P08)
 *   7.1 The exported PDF has selectable PDF text, vector ink, and the highlighter group looks the
 *       same as on screen. Page ranges work. A PNG of one page works.
 *   7.2 A .qunote with and without recordings opens on another device as an editable copy (S5).
 * 8. Tools (P27, P28, P24, P13)
 *   8.1 Text: no weight or wrap change after editing ends (IBM Plex 500/700, the same in Skia).
 *   8.2 Lasso: the 8 handles, rotate, size chip, and a menu away from the writing hand. Cut, then
 *       paste into another notebook, keeps the image (staged clipboard).
 *   8.3 The calculator: docked on the physical left in Arabic and the right in English on a tablet,
 *       floating on a phone. Every mode opens.
 *   8.4 Toolbar drag-to-dock on all four edges, and the compact phone layout.
 * 9. Platform passes
 *   9.1 RTL (Arabic) and LTR (English), on a phone and a tablet, portrait and landscape.
 *   9.2 The tours and the first-time setup: 'تخطي الإعداد' gives Pen on tablets and Finger on
 *       phones (NB-51).
 *   9.3 VoiceOver and TalkBack: every toolbar button and header pill has a label and a hint
 *       (PRD9-accessibility).
 *   9.4 Privacy: a proxy (Charles or mitmproxy) shows no traffic except Apple iCloud or Google
 *       Drive, and the feedback Worker only when feedback is sent (PRD9-privacy).
 *   9.5 Home: with NOTEBOOK_HOME_FLAG false, a store (release) build shows the usual 8 cells and
 *       the usual announcement slides, the @QUStud X slide included. A development build shows the
 *       9th cell (4+4+1 on phones and iPad portrait). The web app never shows it (NB-1, NB-2,
 *       NB-3).
 */
import { useEffect } from 'react';

import { RecorderHost } from '@/notebook/audio/RecorderHost';
// TEMPORARY (development only): see devTourReset.ts.
import { useDevTourReset } from '@/notebook/devTourReset';
import { useBackupAutoRun } from '@/notebook/backup/useBackup';
import { pdfPathTail } from '@/notebook/core/pdf/tiles';
import type { Id } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { useThumbnailWorker } from '@/notebook/export/thumbnails';
import { notebookSupported } from '@/notebook/flags';
import { cleanupIncomingLeftovers } from '@/notebook/import/incoming';
import { claimRenderCrash, markDamagedPdfPage, resumeAllPending, takeRenderCrash } from '@/notebook/import/jobs';
import { pdfEngine } from '@/notebook/pdf/engine';
import { getNotebooksStore, type NotebooksStore } from '@/notebook/store/hooks';
import { subscribeStore } from '@/notebook/store/library';

/** How long the boot steps wait for the notebook index before giving up quietly. */
const STORE_WAIT_MS = 60_000;

/** A notebook's own asset path, from the notebooks folder on: notebooks/<id>/assets/<fileId>.<ext>. */
const ASSET_TAIL = /^notebooks\/([^/]+)\/assets\/([^/]+)\.([A-Za-z0-9]+)$/;

/**
 * The notebook and asset a crash-journal path points at, or null when it is not a notebook asset
 * (a staging file of an import that has not been adopted yet: that import job handles it).
 */
export function crashedAsset(path: string): { notebookId: Id; fileId: Id } | null {
  const m = ASSET_TAIL.exec(pdfPathTail(path));
  if (!m) return null;
  return { notebookId: m[1], fileId: m[2] };
}

/** Resolves with the store once the index is loaded, or null (web, or not loaded within a minute). */
function waitForLoadedStore(): Promise<NotebooksStore | null> {
  return new Promise((resolve) => {
    if (!notebookSupported) {
      resolve(null);
      return;
    }
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsub: (() => void) | null = null;
    const finish = (s: NotebooksStore | null) => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      if (unsub) unsub();
      resolve(s);
    };
    const check = (): boolean => {
      const s = getNotebooksStore();
      if (s && s.loaded) {
        finish(s);
        return true;
      }
      return false;
    };
    if (check()) return;
    unsub = subscribeStore(() => {
      check();
    });
    timer = setTimeout(() => {
      const s = getNotebooksStore();
      finish(s && s.loaded ? s : null);
    }, STORE_WAIT_MS);
  });
}

/**
 * Marks the page whose PDF render crashed in the last run as damaged, through the notebook's
 * session. It skips the entry when it belongs to a running import (that job claims it).
 */
async function markBootRenderCrash(): Promise<void> {
  if (!pdfEngine.available) return;
  const entry = await takeRenderCrash();
  if (!entry) return;
  const target = crashedAsset(entry.path);
  if (!target) return;
  const store = await waitForLoadedStore();
  if (!store) return;
  const indexEntry = store.entries.find((e) => e.id === target.notebookId);
  if (!indexEntry || indexEntry.readOnly) return;
  let s: NotebookSession;
  try {
    s = await store.openSession(target.notebookId);
  } catch {
    // Gone or unreadable: nothing to mark.
    return;
  }
  try {
    if (s.readOnly) return;
    const asset = s.notebook.assets[target.fileId];
    if (!asset || asset.kind !== 'pdf') return;
    // A crash inside a running import is that job's: runJob claims it (claimRenderCrash).
    if (s.notebook.pending?.fileId === target.fileId) return;
    const page = await claimRenderCrash(s.assetPath(target.fileId));
    if (page === null) return;
    markDamagedPdfPage(s, target.fileId, page);
    // flush waits for the pages markDamagedPdfPage loads, then writes them.
    await s.flush();
  } catch {
    // Best effort: the page may crash the renderer once more, and is marked on the next launch.
  } finally {
    store.releaseSession(target.notebookId);
  }
}

let booted = false;

/** The boot steps, once per app run (a remount or Fast Refresh does not repeat them). */
function bootOnce(): void {
  if (booted || !notebookSupported) return;
  booted = true;
  void cleanupIncomingLeftovers().catch(() => {});
  void resumeAllPending().catch(() => {});
  void markBootRenderCrash().catch(() => {});
}

export function NotebookServices() {
  useThumbnailWorker();
  useBackupAutoRun();
  useDevTourReset();
  useEffect(() => {
    bootOnce();
  }, []);
  return <RecorderHost />;
}

export default NotebookServices;
