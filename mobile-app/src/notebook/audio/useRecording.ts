/**
 * useRecording(): the recorder singleton, re-rendering the caller whenever its snapshot changes
 * (state, elapsed seconds, recording, notebook, title). The returned object is always the same
 * recorder; read its fields at render time.
 */
import { useSyncExternalStore } from 'react';

import type { RecordingController, RecordingSnapshot, UseRecording } from '@/notebook/contracts/audio';

import { recorder } from './recorder';

const getSnapshot = (): RecordingSnapshot => recorder.getSnapshot();

export const useRecording: UseRecording = (): RecordingController => {
  useSyncExternalStore(recorder.subscribe, getSnapshot, getSnapshot);
  return recorder;
};

/** The recorder's snapshot itself (a new object on every change), for memo dependencies. */
export function useRecordingSnapshot(): RecordingSnapshot {
  return useSyncExternalStore(recorder.subscribe, getSnapshot, getSnapshot);
}
