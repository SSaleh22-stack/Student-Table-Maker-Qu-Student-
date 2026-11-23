/**
 * Microphone permission for lecture recording (NB-64).
 *
 * The system prompt is shown the first time the student records; its explanation is the
 * microphonePermission text of the expo-audio config plugin (app.json). When the student refused and
 * the system will not ask again ('blocked': iOS after one refusal, Android after "don't ask again"),
 * RecordPermissionSheet explains how to turn it on and opens the app's page in Settings.
 */
import { getRecordingPermissionsAsync, PermissionStatus, requestRecordingPermissionsAsync } from 'expo-audio';
import { Linking } from 'react-native';

/** granted; denied (the system may ask again next time); blocked (only Settings can change it). */
export type MicPermission = 'granted' | 'denied' | 'blocked';

/** Asks only when needed: a granted permission resolves without a prompt. */
export async function ensureMicPermission(): Promise<MicPermission> {
  try {
    const current = await getRecordingPermissionsAsync();
    if (current.granted) return 'granted';
    if (current.status === PermissionStatus.DENIED && !current.canAskAgain) return 'blocked';
    const asked = await requestRecordingPermissionsAsync();
    if (asked.granted) return 'granted';
    return asked.canAskAgain ? 'denied' : 'blocked';
  } catch {
    return 'denied';
  }
}

/** Opens this app's page in the system Settings. */
export async function openMicSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // No settings page on this platform: nothing else to open.
  }
}
