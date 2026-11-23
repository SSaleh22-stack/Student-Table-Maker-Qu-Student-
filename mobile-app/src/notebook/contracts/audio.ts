/**
 * Audio contract (P04): lecture recording while writing (NB-6x) and playback with ink (Figma 10-12).
 *
 * Implementers (P12):
 * - src/notebook/audio/recorder.ts: `recorder: RecordingController` (module singleton; a non-hook
 *   recorder or the RecorderHost fallback, see the P12 header)
 * - src/notebook/audio/useRecording.ts: `useRecording: UseRecording`
 * - src/notebook/audio/player.ts: `player: PlaybackController`
 * - src/notebook/audio/usePlayback.ts: `usePlayback: UsePlayback`
 * - src/notebook/audio/recovery.ts: `recoverRecordings: RecoverRecordings`
 * - src/notebook/audio/RecorderHost.tsx: `RecorderHost: ComponentType` (mounted ONLY by NotebookServices)
 *
 * Lifecycle (ruling (o)): screens pushed over the editor keep recording; when the editor unmounts the
 * recording stops after a 5 s grace (stopIfNotebook) with the toast 'حُفظ التسجيل'; opening another
 * notebook stops it; mark() returns undefined unless notebookId matches the recording notebook.
 * Leaving the app (AppState 'background') or an interruption pauses ('pausedByLeave'); 'inactive' alone
 * does not.
 */
import type { ComponentType } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import type { Id, RecMark } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'pausedByLeave' | 'stopping';

export type StartResult =
  | { ok: true }
  | { ok: false; reason: 'denied' | 'blocked' | 'busy' | 'error' }
  | { ok: false; reason: 'low-storage'; freeBytes: number };

export type PlaybackRate = 1 | 1.5 | 2;

/** The recorder's state as plain data. Cached: the same object until something changes. */
export interface RecordingSnapshot {
  state: RecorderState;
  elapsedMs: number;
  recordingId: Id | null;
  notebookId: Id | null;
  title: string | null;
}

export interface RecordingController extends RecordingSnapshot {
  /** ignoreLowStorage: the student chose 'continue' in LowStorageWarning. */
  start(session: NotebookSession, o?: { ignoreLowStorage?: boolean }): Promise<StartResult>;
  pause(): void;
  resume(): Promise<void>;
  stop(): Promise<void>;
  /** Stops the recording if it belongs to notebook id, after graceMs (default 5000). */
  stopIfNotebook(id: Id, o?: { graceMs?: number }): void;
  /** Cancels a pending stopIfNotebook for id (the editor remounted within the grace, e.g. a language switch). */
  cancelPendingStop(id: Id): void;
  /** The mark for new ink, or undefined unless notebookId is the recording notebook and it is recording. */
  mark(notebookId: Id): RecMark | undefined;
  subscribe(cb: () => void): () => void;
  getSnapshot(): RecordingSnapshot;
}

/** The player's state as plain data. Cached: the same object until something changes. */
export interface PlaybackSnapshot {
  recordingId: Id | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  rate: PlaybackRate;
}

export interface PlaybackController extends PlaybackSnapshot {
  /** The playback position on the UI runtime (drives ink dimming without re-renders). */
  ms: SharedValue<number>;
  load(session: NotebookSession, recordingId: Id): Promise<void>;
  play(): void;
  pause(): void;
  seek(ms: number): Promise<void>;
  setRate(r: PlaybackRate): void;
  unload(): void;
  subscribe(cb: () => void): () => void;
  getSnapshot(): PlaybackSnapshot;
}

export type UseRecording = () => RecordingController;
export type UsePlayback = () => PlaybackController;
/** Fixes segments left 'recording' by a crash: playable ones become 'recovered', the rest 'lost'. */
export type RecoverRecordings = (s: NotebookSession) => Promise<{ recovered: number; lost: number }>;
export type RecorderHostComponent = ComponentType;
