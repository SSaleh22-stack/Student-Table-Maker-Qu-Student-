/**
 * What pauses a recording from outside (NB-65): leaving the app and system interruptions.
 *
 * - AppState 'background' (another app, the home screen, the lock screen): a leave.
 * - AppState 'inactive' ALONE is not a leave: Control Center, the notification center, the app
 *   switcher peek and the Face ID sheet all pass through 'inactive' and come back without going to
 *   'background', and a lecture recording must survive them.
 * - A system interruption (a phone call, Siri, another app taking the microphone). expo-audio 58 has
 *   no interruption event for recorders: on iOS AudioModule pauses every recorder on
 *   AVAudioSession.interruptionNotification (pauseForSystem) WITHOUT emitting anything, so it shows
 *   only as getStatus().isRecording === false while our own state is 'recording'. A 1 s poll
 *   catches it. A recordingStatusUpdate event with isFinished, hasError or mediaServicesDidReset that
 *   we did not cause (the media server died, the encoder failed) is treated the same way.
 *
 * Our own stop of a segment file also sends isFinished (Android emits it a moment AFTER stop()
 * resolves). An event naming a file other than the live one is therefore ignored: after a rotation it
 * belongs to the previous segment.
 *
 * Every trigger calls target.onLeave(); the recorder guards it (it acts only while 'recording'), so a
 * call that also backgrounds the app pauses once and the banner shows once.
 *
 * Device checklist (P30): an incoming call, Siri, pulling Control Center (must keep recording), the
 * lock button, and the home gesture, on iOS and Android.
 */
import type { AudioRecorder, RecordingStatus } from 'expo-audio';
import { AppState, type AppStateStatus } from 'react-native';

export type LeaveReason = 'background' | 'interruption';

export interface InterruptionTarget {
  /** True while our state is 'recording' and the native recorder is not being stopped or rotated by us. */
  expectsRecording(): boolean;
  /**
   * True while our state is 'recording', even during a segment rotation. Leaving the app is checked
   * against this (not expectsRecording), so a leave in the middle of a rotation is not missed: the
   * recorder queues it behind the rotation.
   */
  isRecordingState?(): boolean;
  /** The file:// URI of the native file being written now, or null. */
  liveUri?(): string | null;
  /** The native recorder's own isRecording, or null when it cannot be read. */
  nativeIsRecording(): boolean | null;
  /** The app left the screen or the system took the microphone. */
  onLeave(reason: LeaveReason): void;
  /** The app went to the background while the recording was already paused by the student. */
  onBackgroundWhilePaused?(): void;
}

/** How often the native recorder is polled for a silent system pause. */
export const INTERRUPTION_POLL_MS = 1000;

/** True for an app state that counts as leaving the screen ('inactive' does not). */
export function isLeaveState(s: AppStateStatus): boolean {
  return s === 'background';
}

/** True for a status event that ends or breaks the native recording. */
export function isBreakingStatus(s: Pick<RecordingStatus, 'isFinished' | 'hasError' | 'mediaServicesDidReset'>): boolean {
  return !!(s.isFinished || s.hasError || s.mediaServicesDidReset);
}

const sameUri = (a: string, b: string): boolean => {
  if (a === b) return true;
  try {
    return decodeURI(a) === decodeURI(b);
  } catch {
    return false;
  }
};

/**
 * True when a status event is about the file being written now: it names that file, or names no
 * file at all (Android's onError and the iOS encoder error and media-services reset carry no url).
 */
export function isAboutLiveFile(s: Pick<RecordingStatus, 'url' | 'mediaServicesDidReset'>, liveUri: string | null): boolean {
  if (s.mediaServicesDidReset) return true;
  if (!s.url || !liveUri) return true;
  return sameUri(s.url, liveUri);
}

/**
 * Watches AppState and the native recorder for target. Returns the unsubscribe. Polling runs only
 * while target.expectsRecording().
 */
export function watchInterruptions(target: InterruptionTarget, native: AudioRecorder, o?: { pollMs?: number; isPaused?: () => boolean }): () => void {
  const appSub = AppState.addEventListener('change', (next) => {
    if (!isLeaveState(next)) return;
    const recording = target.isRecordingState ? target.isRecordingState() : target.expectsRecording();
    if (recording) target.onLeave('background');
    else if (o?.isPaused?.()) target.onBackgroundWhilePaused?.();
  });

  let statusSub: { remove(): void } | null = null;
  try {
    statusSub = native.addListener('recordingStatusUpdate', (status: RecordingStatus) => {
      if (!isBreakingStatus(status) || !target.expectsRecording()) return;
      if (!isAboutLiveFile(status, target.liveUri?.() ?? null)) return;
      target.onLeave('interruption');
    });
  } catch {
    statusSub = null;
  }

  const poll = setInterval(() => {
    if (!target.expectsRecording()) return;
    if (target.nativeIsRecording() === false) target.onLeave('interruption');
  }, o?.pollMs ?? INTERRUPTION_POLL_MS);

  return () => {
    appSub.remove();
    statusSub?.remove();
    clearInterval(poll);
  };
}
