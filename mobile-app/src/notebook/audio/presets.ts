/**
 * Recording settings for lecture audio (NB-67): voice quality, mono AAC at 64 kbps, 44.1 kHz,
 * about 30 MB per hour. No background options anywhere (NB-65): recording pauses when the app
 * leaves the screen, so neither the config plugin nor setAudioModeAsync asks for background audio.
 *
 * ADTS_MODE (Phase 0 gate G-AUDIO): an interrupted MPEG-4 (.m4a) file has no index ('moov' atom)
 * and usually does not play, so a crash loses the live segment (at most SEGMENT_MS). A raw ADTS
 * stream (.aac) plays up to the last written frame, but Android's player (Media3 ADTS extractor)
 * cannot seek inside it by default, which breaks 'play from here'. The default is m4a with
 * 10-minute segments; the device gate kills the app mid-recording, probes both formats and flips
 * this constant if ADTS seeks well enough on both platforms.
 */
import { AudioQuality, IOSOutputFormat, type RecordingOptions } from 'expo-audio';
import { Platform } from 'react-native';

/** true: raw ADTS AAC (.aac); false: AAC in MPEG-4 (.m4a). See the header. */
export const ADTS_MODE: boolean = false;

/** A new segment (a new file) starts after this much recorded time: what a crash can cost. */
export const SEGMENT_MS = 10 * 60 * 1000;

/** The file extension of new segments, with its dot. */
export const SEGMENT_EXT = ADTS_MODE ? '.aac' : '.m4a';

/** Free space below which the low-storage warning shows before recording (store.isLowStorage). */
export const RECORD_NEEDED_BYTES = 500 * 1024 * 1024;

const SAMPLE_RATE = 44_100;
const BIT_RATE = 64_000;

/**
 * Mono 44.1 kHz AAC at 64 kbps. Files go to the app's DOCUMENT folder (never the cache, which the
 * system may clear while a crashed segment waits for recovery); recorder.ts moves each closed
 * segment into the notebook's audio/ folder.
 */
export const VOICE: RecordingOptions = {
  extension: SEGMENT_EXT,
  sampleRate: SAMPLE_RATE,
  numberOfChannels: 1,
  bitRate: BIT_RATE,
  isMeteringEnabled: false,
  directory: 'document',
  android: {
    extension: SEGMENT_EXT,
    sampleRate: SAMPLE_RATE,
    outputFormat: ADTS_MODE ? 'aac_adts' : 'mpeg4',
    audioEncoder: 'aac',
    audioSource: 'mic',
  },
  ios: {
    extension: SEGMENT_EXT,
    sampleRate: SAMPLE_RATE,
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: BIT_RATE,
  },
};

/** VOICE with the per-segment file name (the segment's fileId; no extension, no slashes). */
export function segmentOptions(fileId: string): RecordingOptions {
  return { ...VOICE, fileName: fileId };
}

/**
 * The options in the flat per-platform form the native AudioRecorder CONSTRUCTOR expects. expo-audio
 * patches prepareToRecordAsync to flatten its argument, but not the constructor (useAudioRecorder
 * flattens with its internal createRecordingOptions, which the package does not export), so this
 * mirrors that function for expo-audio 58.
 */
export function nativeConstructorOptions(o: RecordingOptions): Partial<RecordingOptions> {
  const common = {
    extension: o.extension,
    sampleRate: o.sampleRate,
    numberOfChannels: o.numberOfChannels,
    bitRate: o.bitRate,
    isMeteringEnabled: o.isMeteringEnabled ?? false,
  };
  const flat =
    Platform.OS === 'ios'
      ? { ...common, directory: o.directory, fileName: o.fileName, ...o.ios }
      : Platform.OS === 'android'
        ? { ...common, directory: o.directory, fileName: o.fileName, ...o.android }
        : { ...common, ...o.web };
  // The native side reads the flat fields; the declared type is the nested RecordingOptions.
  return flat as unknown as Partial<RecordingOptions>;
}
