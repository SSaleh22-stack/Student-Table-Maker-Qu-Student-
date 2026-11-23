/**
 * The RecorderHost fallback slot (mounted ONLY by NotebookServices, outside key={lang}).
 *
 * The plan kept a host component in case expo-audio's recorder could only be created by the
 * useAudioRecorder hook. The installed expo-audio 58 shows it can be created directly
 * (`new AudioModule.AudioRecorder(options)`, which is all useAudioRecorder does; see the findings in
 * recorder.ts), so the singleton in recorder.ts owns the native recorder and this host has nothing
 * to hold: it renders null and keeps the mount point stable for NotebookServices.
 */
import type { RecorderHostComponent } from '@/notebook/contracts/audio';

export const RecorderHost: RecorderHostComponent = function RecorderHost() {
  return null;
};

export default RecorderHost;
