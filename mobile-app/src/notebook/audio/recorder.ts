/**
 * The lecture recorder (NB-60..NB-68): ONE module singleton for the whole app, so a recording
 * survives the editor remounting under key={lang} and screens pushed over the editor.
 *
 * EXPO-AUDIO 58 FINDINGS (node_modules/expo-audio 58.0.12: build/*.d.ts, src/ExpoAudio.ts, ios/, android/):
 * - AudioModule.AudioRecorder IS constructible outside a hook. The class is declared
 *   `constructor(options: Partial<RecordingOptions>)` in AudioModule.types.d.ts, and useAudioRecorder
 *   itself is only `useReleasingSharedObject(() => new AudioModule.AudioRecorder(createRecordingOptions(o)))`
 *   plus a status listener. So this file owns `new AudioModule.AudioRecorder(...)` and RecorderHost
 *   is a no-op. The constructor wants the FLAT per-platform options (createRecordingOptions is not
 *   exported), see presets.ts nativeConstructorOptions. It is created lazily on the first start(),
 *   because Android's constructor needs the current Activity.
 * - prepareToRecordAsync(options?: Partial<RecordingOptions>) is patched by expo-audio to flatten
 *   its argument, so it takes the nested VOICE options. With { fileName, directory: 'document' } the
 *   file is <document>/ExpoAudio/<fileName><ext> on iOS and <filesDir>/Audio/<fileName><ext> on
 *   Android; `recorder.uri` gives it right after preparing. Each prepare makes a NEW file (iOS
 *   builds a new AVAudioRecorder; Android needs a stop() in between, else it throws "already
 *   prepared"), so one recorder object records every segment.
 * - Status: `getStatus(): RecorderState` { canRecord, isRecording, durationMillis, fileSize,
 *   mediaServicesDidReset, url } is a synchronous call. durationMillis is the recorded time of the
 *   current file, pauses excluded (iOS: 0 once stopped). Events: only 'recordingStatusUpdate'
 *   (RecordingStatus { id, isFinished, hasError, error, url, mediaServicesDidReset? }), sent when a
 *   recording finishes, fails or the iOS media services reset.
 * - Interruptions: NO interruption event and no 'interrupted' field. iOS pauses recorders on
 *   AVAudioSession.interruptionNotification (pauseForSystem) silently and does not resume them;
 *   Android pauses them in OnActivityEntersBackground and resumes them in OnActivityEntersForeground
 *   when they were paused by the system. So an interruption shows only as isRecording false while we
 *   think we record (interruptions.ts polls it), and our own pause() on leave clears Android's
 *   'paused by system' flag, so the student decides (the banner) instead of an automatic resume.
 * - setAudioModeAsync({ allowsRecording: false }) STOPS any iOS recorder that is recording, so it is
 *   only called after the last segment is closed.
 * - No background options: allowsBackgroundRecording and shouldPlayInBackground stay false (the
 *   config plugin has enableBackgroundRecording false), matching NB-65.
 *
 * LIFECYCLE
 * - start(session, { ignoreLowStorage }): 'busy' while another notebook records (unless that one only
 *   waits for its grace stop, which then happens at once); low storage (store.isLowStorage(500 MB))
 *   -> { reason: 'low-storage', freeBytes } unless ignoreLowStorage; microphone permission ('denied'
 *   or 'blocked'); setAudioModeAsync; prepare segment 1; addRecording with the segment's pendingPath;
 *   flushPendingNow() so notebook.json knows the file BEFORE record() (the crash journal recovery.ts
 *   reads); record(); keep the screen awake (NB-68).
 * - Segments: every SEGMENT_MS of recorded time the file is closed, moved into audio/ as an asset
 *   (state 'done') and a new one starts. Leaving the app also closes the live file (a killed app
 *   then loses nothing); 'continue' opens a new segment of the SAME recording.
 * - A checkpoint of the live segment's length is saved every 30 s and on every pause.
 * - stopIfNotebook(id, { graceMs = 5000 }): the editor of id unmounted; stop after the grace unless
 *   cancelPendingStop(id) comes first (the editor remounted, e.g. a language switch). The stop shows
 *   'حُفظ التسجيل'.
 * - mark(notebookId): { recordingId, ms } only for the recording notebook while 'recording'.
 *
 * Every operation runs on one serial queue, so a fast tap on stop during a rotation cannot interleave.
 */
import { AudioModule, setAudioModeAsync, type AudioRecorder, type NativeAudioModule } from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { File, Paths } from 'expo-file-system';
import { AppState, Platform } from 'react-native';

import { tr } from '@/lib/i18n';
import type { RecorderState, RecordingController, RecordingSnapshot, StartResult } from '@/notebook/contracts/audio';
import { appendSegment, liveSegment, nextRecordingNumber, patchSegment, shouldRotate } from '@/notebook/core/audio/timeline';
import { newId, type Id, type RecMark, type Recording } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { notebookSupported } from '@/notebook/flags';
import { expoFs } from '@/notebook/fs/expoFs';
import { getNotebooksStore } from '@/notebook/store/hooks';
import { notebookRegistry } from '@/notebook/store/sessions';
import { showToast } from '@/notebook/ui/toast';

import { RECORD_NEEDED_BYTES, SEGMENT_EXT, SEGMENT_MS, VOICE, nativeConstructorOptions, segmentOptions } from './presets';
import { watchInterruptions } from './interruptions';
import { ensureMicPermission } from './permissions';

const KEEP_AWAKE_TAG = 'qu-notebook-recording';
const TICK_MS = 1000;
const CHECKPOINT_MS = 30_000;
/** A closed segment shorter than this holds no usable audio: its file is dropped. */
const MIN_SEGMENT_MS = 300;
export const STOP_GRACE_MS = 5000;

const ASSET_EXT = SEGMENT_EXT.replace(/^\./, '');

interface LiveSegment {
  fileId: Id;
  startMs: number;
  pendingPath: string;
  /** Recorded ms of this file when it was last paused (JS clock fallback). */
  baseMs: number;
  /** Date.now() of the last record() while recording, else null. */
  resumedAt: number | null;
}

interface Live {
  session: NotebookSession;
  recordingId: Id;
  title: string;
  /** Recording time of the closed segments: where the next segment starts. */
  closedMs: number;
  seg: LiveSegment | null;
  lastCheckpointAt: number;
  /** Frozen segment time while the native file is being closed (the native clock reads 0 then). */
  frozenSegMs: number | null;
}

// ===== native recorder

let native: AudioRecorder | null = null;

/** The native module, typed (the import is a re-exported default, not a namespace). */
const audioModule: NativeAudioModule = AudioModule;

function nativeRecorder(): AudioRecorder {
  if (!native) native = new audioModule.AudioRecorder(nativeConstructorOptions(VOICE));
  return native;
}

function nativeStatus(): { isRecording: boolean; durationMillis: number; canRecord: boolean } | null {
  if (!native) return null;
  try {
    const s = native.getStatus();
    return { isRecording: !!s.isRecording, durationMillis: Number(s.durationMillis) || 0, canRecord: !!s.canRecord };
  } catch {
    return null;
  }
}

async function recordMode(): Promise<void> {
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    allowsBackgroundRecording: false,
    interruptionMode: 'doNotMix',
    shouldRouteThroughEarpiece: false,
  });
}

async function idleMode(): Promise<void> {
  try {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false, allowsBackgroundRecording: false });
  } catch {
    // The next recording or playback sets its own mode.
  }
}

function keepAwake(on: boolean): void {
  if (on) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
  else deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
}

// ===== state

let state: RecorderState = 'idle';
let live: Live | null = null;
/** The notebook of a start() in progress (before live exists). */
let startingNotebook: Id | null = null;
/**
 * start() calls per notebook that have not finished yet, counted from the moment they are queued
 * (before the permission prompt), so an editor that unmounts meanwhile still gets its grace stop.
 */
const requestedStarts = new Map<Id, number>();
let snapshot: RecordingSnapshot = { state: 'idle', elapsedMs: 0, recordingId: null, notebookId: null, title: null };
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();
let tick: ReturnType<typeof setInterval> | null = null;
let unwatch: (() => void) | null = null;
let pendingStop: { id: Id; timer: ReturnType<typeof setTimeout> } | null = null;
/** True while we stop, rotate or open a native file ourselves (its status events are ours). */
let transition = false;
let rotating = false;
/** The fileId of a segment being opened (saved in notebook.json, not yet in live.seg). */
let openingFileId: Id | null = null;

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** Queues fn without a caller to await it: a failure must not become an unhandled rejection. */
function fireAndForget(fn: () => Promise<unknown>): void {
  serial(fn).catch(() => {});
}

function segMsNow(): number {
  const seg = live?.seg;
  if (!live || !seg) return 0;
  if (live.frozenSegMs !== null) return live.frozenSegMs;
  const js = seg.baseMs + (seg.resumedAt !== null ? Date.now() - seg.resumedAt : 0);
  const n = nativeStatus();
  return n && n.durationMillis > 0 ? n.durationMillis : js;
}

function elapsedNow(): number {
  if (!live) return 0;
  return live.seg ? live.closedMs + segMsNow() : live.closedMs;
}

function publish(): void {
  const next: RecordingSnapshot = {
    state,
    elapsedMs: live ? Math.max(0, Math.floor(elapsedNow() / 1000) * 1000) : 0,
    recordingId: live?.recordingId ?? null,
    notebookId: live?.session.id ?? startingNotebook ?? null,
    // The saved title: a rename in RecordingsPanel while recording shows in the banner too.
    title: live ? (currentRecording()?.title ?? live.title) : null,
  };
  const s = snapshot;
  if (s.state === next.state && s.elapsedMs === next.elapsedMs && s.recordingId === next.recordingId && s.notebookId === next.notebookId && s.title === next.title) return;
  snapshot = next;
  for (const cb of [...listeners]) cb();
}

/** The state read fresh (not narrowed by an earlier check, it changes across awaits). */
function currentState(): RecorderState {
  return state;
}

function setState(next: RecorderState): void {
  state = next;
  publish();
}

function currentRecording(): Recording | undefined {
  if (!live) return undefined;
  return live.session.notebook.recordings.find((r) => r.id === live?.recordingId);
}

/** Writes a recording change made with the timeline helpers (no history). */
function saveRecording(r: Recording): void {
  if (!live) return;
  live.session.updateRecording(r.id, { segments: r.segments, durationMs: r.durationMs });
}

function checkpoint(): void {
  const r = currentRecording();
  const seg = live?.seg;
  if (!live || !r || !seg) return;
  saveRecording(patchSegment(r, seg.fileId, { durationMs: segMsNow() }));
  live.lastCheckpointAt = Date.now();
}

// ===== ticks and interruptions

function startTick(): void {
  if (tick) return;
  tick = setInterval(() => {
    if (!live || state !== 'recording') return;
    publish();
    if (live.seg && !rotating && shouldRotate(segMsNow(), SEGMENT_MS)) {
      rotating = true;
      serial(rotate)
        .catch(() => {})
        .finally(() => {
          rotating = false;
        });
      return;
    }
    if (Date.now() - live.lastCheckpointAt >= CHECKPOINT_MS) checkpoint();
  }, TICK_MS);
}

function stopTick(): void {
  if (tick) clearInterval(tick);
  tick = null;
}

function onLeave(): void {
  if (state !== 'recording') return;
  fireAndForget(leave);
}

function watch(): void {
  if (unwatch || !native) return;
  unwatch = watchInterruptions(
    {
      expectsRecording: () => state === 'recording' && !transition && !!live?.seg,
      isRecordingState: () => state === 'recording',
      liveUri: () => live?.seg?.pendingPath ?? null,
      nativeIsRecording: () => nativeStatus()?.isRecording ?? null,
      onLeave,
      // A paused file waiting in the background is closed too, so a killed app keeps it.
      onBackgroundWhilePaused: () => fireAndForget(leave),
    },
    native,
    { isPaused: () => state === 'paused' },
  );
}

function unwatchAll(): void {
  unwatch?.();
  unwatch = null;
}

// ===== segments

/**
 * The native file of a prepared segment: recorder.uri, else where expo-audio 58 documents it
 * (<document>/ExpoAudio/<fileName><ext> on iOS, <filesDir>/Audio/<fileName><ext> on Android).
 */
function pathOf(fileId: Id): string {
  const uri = native?.uri;
  if (uri) return uri;
  return new File(Paths.document, Platform.OS === 'ios' ? 'ExpoAudio' : 'Audio', `${fileId}${SEGMENT_EXT}`).uri;
}

/**
 * Prepares a new file, saves its pendingPath (flushed) and starts recording into it. With create, the
 * recording itself is added here, together with its first segment, so a failure before that leaves
 * no empty entry.
 */
async function openSegment(create?: { startedAt: string }): Promise<void> {
  if (!live) throw new Error('no recording');
  const rec = nativeRecorder();
  const fileId = newId();
  transition = true;
  openingFileId = fileId;
  try {
    await rec.prepareToRecordAsync(segmentOptions(fileId));
    const pendingPath = pathOf(fileId);
    const seg = liveSegment(fileId, live.closedMs, pendingPath);
    if (create) {
      live.session.addRecording({ id: live.recordingId, title: live.title, startedAt: create.startedAt, durationMs: 0, segments: [seg] });
    } else {
      const r = currentRecording();
      if (!r) throw new Error('recording missing');
      saveRecording(appendSegment(r, seg));
    }
    // The crash journal: notebook.json must name the file before any audio goes into it.
    await live.session.flushPendingNow();
    try {
      rec.record();
    } catch (e) {
      // Nothing went into the file: take the segment off the list again.
      const r = currentRecording();
      if (r && !create) saveRecording({ ...r, segments: r.segments.filter((x) => x.fileId !== fileId) });
      throw e;
    }
    live.seg = { fileId, startMs: live.closedMs, pendingPath, baseMs: 0, resumedAt: Date.now() };
    live.lastCheckpointAt = Date.now();
  } finally {
    openingFileId = null;
    transition = false;
  }
}

/**
 * Stops the native file and moves it into the notebook's audio/ folder as an asset (state 'done').
 * A file that is gone keeps its time range as 'lost' (marks made during it keep their place); a
 * missing file shorter than MIN_SEGMENT_MS is dropped from the list.
 */
async function closeSegment(): Promise<void> {
  if (!live || !live.seg) return;
  const seg = live.seg;
  const session = live.session;
  const ms = Math.max(0, Math.round(segMsNow()));
  live.frozenSegMs = ms;
  transition = true;
  try {
    try {
      await native?.stop();
    } catch {
      // Already stopped (an error or the system ended it): the file is what it is.
    }
    const exists = await expoFs.exists(seg.pendingPath).catch(() => false);
    let next: 'done' | 'lost' | 'drop' = exists ? 'done' : ms < MIN_SEGMENT_MS ? 'drop' : 'lost';
    if (exists) {
      try {
        await session.addAsset(seg.pendingPath, 'audio', ASSET_EXT, { move: true, id: seg.fileId });
      } catch {
        next = 'lost';
      }
    }
    const r = currentRecording();
    if (r) {
      if (next === 'drop') saveRecording({ ...r, segments: r.segments.filter((x) => x.fileId !== seg.fileId), durationMs: live.closedMs });
      else saveRecording(patchSegment(r, seg.fileId, { state: next, durationMs: ms }));
    }
    if (next !== 'drop') live.closedMs = seg.startMs + ms;
    live.seg = null;
    await session.flushPendingNow().catch(() => {});
  } finally {
    if (live) live.frozenSegMs = null;
    transition = false;
  }
}

async function rotate(): Promise<void> {
  if (state !== 'recording' || !live?.seg) return;
  try {
    await closeSegment();
    await openSegment();
  } catch {
    // The next file could not start: keep what is saved and let the student continue by hand.
    if (live) {
      stopTick();
      keepAwake(false);
      setState('paused');
    }
  }
  publish();
}

// ===== operations

function lowStorage(): { low: boolean; freeBytes: number } {
  try {
    return getNotebooksStore()?.isLowStorage(RECORD_NEEDED_BYTES) ?? { low: false, freeBytes: 0 };
  } catch {
    return { low: false, freeBytes: 0 };
  }
}

function defaultTitle(session: NotebookSession): string {
  const n = nextRecordingNumber(session.notebook.recordings.map((r) => r.title));
  return tr(`تسجيل ${n}`, `Recording ${n}`);
}

async function doStart(session: NotebookSession, o?: { ignoreLowStorage?: boolean }): Promise<StartResult> {
  if (!notebookSupported || session.readOnly) return { ok: false, reason: 'error' };
  if (state !== 'idle' && live) {
    if (live.session.id === session.id) {
      cancelPendingStop(session.id);
      if (state === 'paused' || state === 'pausedByLeave') {
        await doResume();
        return currentState() === 'recording' ? { ok: true } : { ok: false, reason: 'error' };
      }
      return state === 'recording' ? { ok: true } : { ok: false, reason: 'busy' };
    }
    // Another notebook: only one that is already waiting for its grace stop gives way.
    if (pendingStop && pendingStop.id === live.session.id) {
      clearTimeout(pendingStop.timer);
      pendingStop = null;
      await doStop();
      savedToast();
    } else {
      return { ok: false, reason: 'busy' };
    }
  }
  if (!o?.ignoreLowStorage) {
    const ls = lowStorage();
    if (ls.low) return { ok: false, reason: 'low-storage', freeBytes: ls.freeBytes };
  }
  const perm = await ensureMicPermission();
  if (perm !== 'granted') return { ok: false, reason: perm };

  startingNotebook = session.id;
  setState('starting');
  let acquired = false;
  try {
    const got = await notebookRegistry().acquire(session.id);
    if (!('session' in got)) throw new Error(got.error);
    acquired = true;
    const s = got.session;
    await recordMode();
    nativeRecorder();
    const recordingId = newId();
    live = { session: s, recordingId, title: defaultTitle(s), closedMs: 0, seg: null, lastCheckpointAt: Date.now(), frozenSegMs: null };
    await openSegment({ startedAt: new Date().toISOString() });
    startingNotebook = null;
    keepAwake(true);
    watch();
    startTick();
    setState('recording');
    // Left the app while it was starting: pause right away like any leave.
    if (AppState.currentState === 'background') await leave();
    return { ok: true };
  } catch {
    try {
      await native?.stop();
    } catch {
      // Nothing to stop.
    }
    // A native recorder that failed to start (e.g. after an iOS media-services reset) is not reused:
    // the next start() creates a fresh one.
    unwatchAll();
    try {
      native?.release();
    } catch {
      // Already released.
    }
    native = null;
    // record() failed after the entry was saved: an entry without audio is not kept.
    const r = currentRecording();
    if (r && r.segments.every((x) => x.state === 'recording' && x.durationMs === 0)) {
      await live?.session.deleteRecording(r.id).catch(() => {});
      for (const x of r.segments) if (x.pendingPath) await expoFs.remove(x.pendingPath).catch(() => {});
    }
    if (acquired) notebookRegistry().release(session.id);
    live = null;
    startingNotebook = null;
    await idleMode();
    setState('idle');
    return { ok: false, reason: 'error' };
  }
}

async function leave(): Promise<void> {
  if (!live) return;
  // Paused by the student (a pause tap can land just before the leave): only close the open file, so
  // a killed app keeps it; 'continue' opens a new segment of the same recording.
  if (state === 'paused') {
    if (live.seg) await closeSegment();
    return;
  }
  if (state !== 'recording') return;
  // Guarded and published first: the banner shows once, whatever else calls in.
  stopTick();
  keepAwake(false);
  setState('pausedByLeave');
  try {
    native?.pause();
  } catch {
    // Already paused by the system.
  }
  if (live.seg) {
    live.seg.baseMs = segMsNow();
    live.seg.resumedAt = null;
    await closeSegment();
  }
  publish();
}

async function doPause(): Promise<void> {
  if (state !== 'recording' || !live?.seg) return;
  const ms = segMsNow();
  try {
    native?.pause();
  } catch {
    // Already paused.
  }
  live.seg.baseMs = ms;
  live.seg.resumedAt = null;
  stopTick();
  keepAwake(false);
  checkpoint();
  setState('paused');
  await live.session.flushPendingNow().catch(() => {});
}

async function doResume(): Promise<void> {
  if ((state !== 'paused' && state !== 'pausedByLeave') || !live) return;
  try {
    await recordMode();
    let resumed = false;
    if (live.seg) {
      const st = nativeStatus();
      if (st && st.canRecord) {
        try {
          native?.record();
          resumed = nativeStatus()?.isRecording !== false;
        } catch {
          resumed = false;
        }
      }
      if (resumed) live.seg.resumedAt = Date.now();
      else await closeSegment();
    }
    if (!resumed) await openSegment();
    keepAwake(true);
    watch();
    startTick();
    setState('recording');
  } catch {
    // The microphone could not start again: stay paused, the student can retry or finish.
    setState(currentState() === 'pausedByLeave' ? 'pausedByLeave' : 'paused');
  }
}

async function doStop(): Promise<void> {
  if (!live || (state !== 'recording' && state !== 'paused' && state !== 'pausedByLeave')) return;
  if (pendingStop && pendingStop.id === live.session.id) {
    clearTimeout(pendingStop.timer);
    pendingStop = null;
  }
  setState('stopping');
  stopTick();
  unwatchAll();
  const session = live.session;
  try {
    await closeSegment();
    const r = currentRecording();
    if (r && r.segments.length === 0) await session.deleteRecording(r.id).catch(() => {});
    await session.flushPendingNow().catch(() => {});
  } finally {
    keepAwake(false);
    await idleMode();
    live = null;
    notebookRegistry().release(session.id);
    setState('idle');
  }
}

function savedToast(): void {
  showToast({ text: tr('حُفظ التسجيل', 'Recording saved'), tone: 'ok', id: 'nb-recording-saved' });
}

function cancelPendingStop(id: Id): void {
  if (pendingStop && pendingStop.id === id) {
    clearTimeout(pendingStop.timer);
    pendingStop = null;
  }
}

/** True when fileId is the segment being written right now (recovery must leave it alone). */
export function isLiveSegment(notebookId: Id, fileId: Id): boolean {
  if (!live || live.session.id !== notebookId) return false;
  // Also the segment being opened: notebook.json names it before record() runs.
  return live.seg?.fileId === fileId || openingFileId === fileId;
}

/** True when recordingId is the recording in progress (or paused) right now. */
export function isLiveRecording(recordingId: Id): boolean {
  return !!live && live.recordingId === recordingId;
}

export const recorder: RecordingController = {
  get state() {
    return snapshot.state;
  },
  get elapsedMs() {
    return snapshot.elapsedMs;
  },
  get recordingId() {
    return snapshot.recordingId;
  },
  get notebookId() {
    return snapshot.notebookId;
  },
  get title() {
    return snapshot.title;
  },

  start(session, o) {
    requestedStarts.set(session.id, (requestedStarts.get(session.id) ?? 0) + 1);
    return serial(() => doStart(session, o)).finally(() => {
      const n = (requestedStarts.get(session.id) ?? 1) - 1;
      if (n > 0) requestedStarts.set(session.id, n);
      else requestedStarts.delete(session.id);
    });
  },
  pause() {
    fireAndForget(doPause);
  },
  resume: () => serial(doResume),
  stop: () => serial(doStop),

  stopIfNotebook(id, o) {
    // Also while start() for id is queued or still running (the permission prompt included): the
    // queued stop then runs right after it.
    const ours = (!!live && live.session.id === id) || startingNotebook === id || requestedStarts.has(id);
    if (!ours) return;
    if (pendingStop && pendingStop.id === id) return;
    const ms = o?.graceMs ?? STOP_GRACE_MS;
    const timer = setTimeout(
      () => {
        if (pendingStop?.timer !== timer) return;
        pendingStop = null;
        fireAndForget(async () => {
          // Only id's own recording: a start() for id that ended 'busy' must not stop another notebook.
          if (!live || live.session.id !== id) return;
          await doStop();
          savedToast();
        });
      },
      Math.max(0, ms),
    );
    pendingStop = { id, timer };
  },
  cancelPendingStop,

  mark(notebookId): RecMark | undefined {
    if (state !== 'recording' || !live || live.session.id !== notebookId) return undefined;
    return { recordingId: live.recordingId, ms: Math.max(0, Math.round(elapsedNow())) };
  },

  subscribe(cb) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  getSnapshot: () => snapshot,
};
