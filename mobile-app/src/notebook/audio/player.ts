/**
 * Recording playback with ink (NB-62, Figma 11): one module singleton over ONE expo-audio player
 * (createAudioPlayer, released by unload()).
 *
 * A recording is several files (segments, see core/audio/timeline.ts). The player plays the playable
 * segments one after the other on the recording line: position = segment.startMs + the file's
 * currentTime. Lost segments are skipped (seeking into one lands at the next playable start).
 *
 * - ms: a Reanimated shared value with the position, written on every status update (100 ms). The
 *   canvas reads it on the UI runtime to dim ink made after the current moment, with no re-render.
 * - The snapshot (subscribe / getSnapshot) changes at most every 250 ms of position, plus on every
 *   play / pause / load / rate change. It also carries what the PlayerBar shows: the title, the
 *   scrubber ticks (marks of this recording on the pages in memory) and playFromCount.
 * - playFrom(session, mark): the 'play from here' tool: load the mark's recording if needed, seek,
 *   play. The PlayerBar hides its pointer tip after the first one.
 * - Playback never runs while the recorder records: starting a recording pauses it, and play() is
 *   ignored while the recorder is starting, recording or stopping.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { makeMutable } from 'react-native-reanimated';

import type { PlaybackController, PlaybackRate, PlaybackSnapshot } from '@/notebook/contracts/audio';
import { locate, markTicks, marksOf, nextPlayable, recordingLength, sortedSegments } from '@/notebook/core/audio/timeline';
import type { Id, RecMark, RecSegment, Recording } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';

import { recorder } from './recorder';

/** What the PlayerBar reads on top of the contract's snapshot. */
export interface PlayerSnapshot extends PlaybackSnapshot {
  title: string | null;
  /** Fractions 0..1 of durationMs where ink of this recording was made (pages in memory). */
  ticks: number[];
  /** playFrom() calls since this recording was loaded. */
  playFromCount: number;
  /** True while a segment file is being opened. */
  loading: boolean;
  /** False when no segment of the loaded recording can be played. */
  playable: boolean;
}

export interface PlayerController extends PlaybackController {
  getSnapshot(): PlayerSnapshot;
  /** 'Play from here': the mark's recording (loading it if needed) from the mark's moment. */
  playFrom(session: NotebookSession, mark: RecMark): Promise<void>;
}

const UPDATE_MS = 100;
const SNAPSHOT_STEP_MS = 250;
const LOAD_TIMEOUT_MS = 4000;
const TICK_GAP = 0.004;
const TICKS_REFRESH_MS = 2000;

interface Loaded {
  session: NotebookSession;
  recordingId: Id;
  title: string;
  segments: RecSegment[];
  /** Index (in segments) of the file in the native player, or -1 for none. */
  index: number;
  unsubSession: () => void;
  ticksAt: number;
  ticksTimer: ReturnType<typeof setTimeout> | null;
}

const ms = makeMutable(0);

let native: AudioPlayer | null = null;
let statusSub: { remove(): void } | null = null;
let loaded: Loaded | null = null;
let positionMs = 0;
let durationMs = 0;
let playing = false;
let rate: PlaybackRate = 1;
let ticks: number[] = [];
let playFromCount = 0;
let loading = false;
let playable = false;
/** While a seek or a segment switch runs, status updates of the old position are ignored. */
let seeking = false;
let loadWaiter: { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> } | null = null;
let queue: Promise<unknown> = Promise.resolve();

let snapshot: PlayerSnapshot = {
  recordingId: null,
  playing: false,
  positionMs: 0,
  durationMs: 0,
  rate: 1,
  title: null,
  ticks: [],
  playFromCount: 0,
  loading: false,
  playable: false,
};
const listeners = new Set<() => void>();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** Queues fn with no caller awaiting it: a native failure must not become an unhandled rejection. */
function fireAndForget(fn: () => Promise<unknown>): void {
  serial(fn).catch(() => {
    playing = false;
    loading = false;
    seeking = false;
    publish(true);
  });
}

function publish(force = false): void {
  const pos = Math.floor(positionMs / SNAPSHOT_STEP_MS) * SNAPSHOT_STEP_MS;
  const s = snapshot;
  const same =
    s.recordingId === (loaded?.recordingId ?? null) &&
    s.playing === playing &&
    s.positionMs === pos &&
    s.durationMs === durationMs &&
    s.rate === rate &&
    s.title === (loaded?.title ?? null) &&
    s.ticks === ticks &&
    s.playFromCount === playFromCount &&
    s.loading === loading &&
    s.playable === playable;
  if (same && !force) return;
  snapshot = {
    recordingId: loaded?.recordingId ?? null,
    playing,
    positionMs: pos,
    durationMs,
    rate,
    title: loaded?.title ?? null,
    ticks,
    playFromCount,
    loading,
    playable,
  };
  for (const cb of [...listeners]) cb();
}

function setPosition(p: number): void {
  positionMs = Math.max(0, Math.min(p, durationMs || p));
  ms.value = positionMs;
}

// ===== native player

function ensureNative(): AudioPlayer {
  if (native) return native;
  const p = createAudioPlayer(null, { updateInterval: UPDATE_MS });
  statusSub = p.addListener('playbackStatusUpdate', onStatus);
  native = p;
  return p;
}

function releaseNative(): void {
  statusSub?.remove();
  statusSub = null;
  if (native) {
    try {
      native.pause();
    } catch {
      // Not loaded.
    }
    try {
      native.remove();
    } catch {
      // Already released.
    }
  }
  native = null;
}

function settleLoad(ok: boolean): void {
  const w = loadWaiter;
  if (!w) return;
  loadWaiter = null;
  clearTimeout(w.timer);
  w.resolve(ok);
}

function waitLoaded(p: AudioPlayer): Promise<boolean> {
  settleLoad(false);
  if (p.isLoaded) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => settleLoad(p.isLoaded), LOAD_TIMEOUT_MS);
    loadWaiter = { resolve, timer };
  });
}

function onStatus(st: AudioStatus): void {
  if (st.isLoaded) settleLoad(true);
  else if (st.error) settleLoad(false);
  const l = loaded;
  if (!l || l.index < 0) return;
  const seg = l.segments[l.index];
  if (!seg) return;
  if (st.didJustFinish || (st.error && !seeking)) {
    fireAndForget(() => advance(l));
    return;
  }
  if (!seeking && st.isLoaded) {
    setPosition(seg.startMs + Math.max(0, st.currentTime) * 1000);
    playing = !!st.playing;
  }
  publish();
}

/** The file of one segment ended: the next playable one starts, or playback ends. */
async function advance(l: Loaded, from: number = l.index): Promise<void> {
  if (loaded !== l) return;
  const next = nextPlayable(l.segments, from);
  if (!next) {
    playing = false;
    setPosition(durationMs);
    try {
      native?.pause();
    } catch {
      // Already stopped.
    }
    publish(true);
    return;
  }
  await openSegment(l, next.index, 0, true);
}

/** Puts segment index into the native player at offsetMs and plays it when autoplay. */
async function openSegment(l: Loaded, index: number, offsetMs: number, autoplay: boolean): Promise<void> {
  const seg = l.segments[index];
  if (!seg) return;
  const p = ensureNative();
  seeking = true;
  loading = true;
  publish(true);
  const fresh = l.index !== index;
  try {
    if (fresh) {
      p.replace({ uri: l.session.assetPath(seg.fileId) });
      l.index = index;
      const ok = await waitLoaded(p);
      if (loaded !== l) return;
      if (!ok) {
        // This file does not open: go on with the next one (or try again on the next play()).
        l.index = -1;
        loading = false;
        seeking = false;
        if (autoplay) await advance(l, index);
        return;
      }
      applyRate(p);
    }
    // A freshly opened file already starts at 0.
    if (!fresh || offsetMs > 0) await p.seekTo(Math.max(0, offsetMs) / 1000);
    setPosition(seg.startMs + offsetMs);
    if (autoplay) {
      p.play();
      playing = true;
    }
  } finally {
    if (loaded === l) {
      seeking = false;
      loading = false;
      publish(true);
    }
  }
}

function applyRate(p: AudioPlayer): void {
  try {
    p.shouldCorrectPitch = true;
    p.setPlaybackRate(rate, 'high');
  } catch {
    // Rate changes need a loaded file; it is applied again after the next load.
  }
}

async function playbackMode(): Promise<void> {
  // Only when nothing records: switching the session category would stop an iOS recorder.
  if (recorder.getSnapshot().state !== 'idle') return;
  try {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'doNotMix' });
  } catch {
    // Keep the current mode.
  }
}

// ===== ticks and the loaded recording

function recordingOf(l: Loaded): Recording | undefined {
  return l.session.notebook.recordings.find((r) => r.id === l.recordingId);
}

function computeTicks(l: Loaded): number[] {
  const marks: number[] = [];
  for (const pid of l.session.notebook.pageIds) {
    const page = l.session.getPage(pid);
    if (page) marks.push(...marksOf(page.items, l.recordingId));
  }
  return markTicks(marks, durationMs, TICK_GAP);
}

function refresh(l: Loaded): void {
  if (loaded !== l) return;
  const r = recordingOf(l);
  if (!r) {
    // Deleted while loaded.
    unloadNow();
    return;
  }
  l.title = r.title;
  l.ticksAt = Date.now();
  const nextTicks = computeTicks(l);
  if (nextTicks.length !== ticks.length || nextTicks.some((t, i) => t !== ticks[i])) ticks = nextTicks;
  publish();
}

function onSessionChange(l: Loaded): void {
  if (loaded !== l) return;
  const r = recordingOf(l);
  if (!r) {
    unloadNow();
    return;
  }
  if (r.title !== l.title) {
    l.title = r.title;
    publish();
  }
  if (l.ticksTimer) return;
  const wait = Math.max(0, TICKS_REFRESH_MS - (Date.now() - l.ticksAt));
  l.ticksTimer = setTimeout(() => {
    l.ticksTimer = null;
    refresh(l);
  }, wait);
}

function unloadNow(): void {
  const l = loaded;
  if (l) {
    l.unsubSession();
    if (l.ticksTimer) clearTimeout(l.ticksTimer);
  }
  loaded = null;
  settleLoad(false);
  releaseNative();
  playing = false;
  loading = false;
  seeking = false;
  playable = false;
  ticks = [];
  playFromCount = 0;
  durationMs = 0;
  setPosition(0);
  publish(true);
}

async function doLoad(session: NotebookSession, recordingId: Id): Promise<void> {
  unloadNow();
  const r = session.notebook.recordings.find((x) => x.id === recordingId);
  if (!r) return;
  const segments = sortedSegments(r.segments);
  const l: Loaded = { session, recordingId, title: r.title, segments, index: -1, unsubSession: () => {}, ticksAt: 0, ticksTimer: null };
  loaded = l;
  l.unsubSession = session.subscribe(() => onSessionChange(l));
  durationMs = Math.max(r.durationMs, recordingLength(segments));
  playable = segments.some((s) => s.state === 'done' || s.state === 'recovered');
  setPosition(0);
  refresh(l);
  const first = locate(segments, 0);
  if (first) await openSegment(l, first.index, first.offsetMs, false);
  publish(true);
}

async function doSeek(target: number): Promise<void> {
  const l = loaded;
  if (!l) return;
  const pos = locate(l.segments, Math.max(0, Math.min(target, durationMs)));
  if (!pos) return;
  const wasPlaying = playing;
  if (pos.index !== l.index) {
    await openSegment(l, pos.index, pos.offsetMs, wasPlaying);
    return;
  }
  seeking = true;
  try {
    setPosition(pos.ms);
    publish();
    await native?.seekTo(pos.offsetMs / 1000);
  } finally {
    seeking = false;
    publish(true);
  }
}

async function doPlay(): Promise<void> {
  const l = loaded;
  if (!l || !playable) return;
  const rs = recorder.getSnapshot().state;
  if (rs === 'starting' || rs === 'recording' || rs === 'stopping') return;
  await playbackMode();
  if (loaded !== l) return;
  // At the end: start over.
  if (positionMs >= durationMs - 50 || l.index < 0) {
    const first = locate(l.segments, positionMs >= durationMs - 50 ? 0 : positionMs);
    if (!first) return;
    await openSegment(l, first.index, first.offsetMs, true);
    return;
  }
  try {
    native?.play();
    playing = true;
  } catch {
    playing = false;
  }
  publish(true);
}

function doPause(): void {
  try {
    native?.pause();
  } catch {
    // Not loaded.
  }
  playing = false;
  publish(true);
}

// A recording that starts (or continues) stops playback first.
recorder.subscribe(() => {
  const st = recorder.getSnapshot().state;
  if ((st === 'starting' || st === 'recording') && playing) doPause();
});

export const player: PlayerController = {
  get recordingId() {
    return snapshot.recordingId;
  },
  get playing() {
    return snapshot.playing;
  },
  get positionMs() {
    return snapshot.positionMs;
  },
  get durationMs() {
    return snapshot.durationMs;
  },
  get rate() {
    return snapshot.rate;
  },
  ms,

  load: (session, recordingId) => serial(() => doLoad(session, recordingId)),
  play() {
    fireAndForget(doPlay);
  },
  pause() {
    doPause();
  },
  seek: (target) => serial(() => doSeek(target)),
  setRate(r) {
    rate = r;
    if (native) applyRate(native);
    publish(true);
  },
  unload() {
    fireAndForget(async () => unloadNow());
  },
  playFrom: (session, mark) =>
    serial(async () => {
      if (!loaded || loaded.session !== session || loaded.recordingId !== mark.recordingId) await doLoad(session, mark.recordingId);
      if (!loaded) return;
      playFromCount += 1;
      await doSeek(mark.ms);
      await doPlay();
      publish(true);
    }),

  subscribe(cb) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  getSnapshot: () => snapshot,
};
