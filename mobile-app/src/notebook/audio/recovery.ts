/**
 * Recording recovery after a crash (NB-66). Run by the editor when a notebook opens (P29).
 *
 * recorder.ts saves every new segment with state 'recording' and its pendingPath (the native file)
 * in notebook.json BEFORE recording into it. A segment still 'recording' that is not the live one
 * therefore belongs to a recording the app never closed (killed, crashed, out of battery):
 * - its file already in the notebook's audio/ folder (moved, but the state change was not saved),
 *   or still at pendingPath: the file is opened with a throwaway player. When it plays, it is moved
 *   into audio/ as an asset and the segment becomes 'recovered' with the file's real length.
 * - otherwise (no file, or a file the player rejects, e.g. an MPEG-4 file without its index) the
 *   segment becomes 'lost'; its time range stays, so later marks keep their place. The useless
 *   file is deleted.
 * - a probe that neither loads nor fails within PROBE_TIMEOUT_MS decides nothing: the segment stays
 *   'recording' and its file stays where it is, so the next open tries again (never delete audio on
 *   a guess).
 * pendingPath is absolute. iOS may move the app's container (an app update between the crash and
 *   the next launch), so a missing pendingPath is looked up again by its file name in the native
 *   recording folder (<document>/ExpoAudio on iOS, <filesDir>/Audio on Android).
 * Then notebook.json is written at once. Idempotent: a second run finds nothing 'recording'.
 */
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { RecoverRecordings } from '@/notebook/contracts/audio';
import { applyRecovery, staleSegments, type ProbeResult } from '@/notebook/core/audio/timeline';
import type { Id, RecSegment } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { expoFs } from '@/notebook/fs/expoFs';

import { SEGMENT_EXT } from './presets';
import { isLiveSegment } from './recorder';

const PROBE_TIMEOUT_MS = 5000;

/**
 * Opens uri in a throwaway player: playable, with its length when the player reports one. null when
 * the player neither loaded it nor failed within timeoutMs (undecided).
 */
export function probeAudio(uri: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<ProbeResult | null> {
  return new Promise<ProbeResult | null>((resolve) => {
    let p: AudioPlayer | null = null;
    let sub: { remove(): void } | null = null;
    let done = false;
    const finish = (r: ProbeResult | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub?.remove();
      try {
        p?.remove();
      } catch {
        // Already released.
      }
      resolve(r);
    };
    const timer = setTimeout(() => {
      const loadedNow = !!p?.isLoaded;
      const d = p && Number.isFinite(p.duration) && p.duration > 0 ? Math.round(p.duration * 1000) : null;
      // Loaded with a length: playable. Anything else is not known yet.
      finish(loadedNow && d !== null ? { playable: true, durationMs: d } : null);
    }, timeoutMs);
    try {
      p = createAudioPlayer({ uri }, { updateInterval: 250 });
      sub = p.addListener('playbackStatusUpdate', (st) => {
        if (st.error) {
          finish({ playable: false, durationMs: null });
          return;
        }
        if (st.isLoaded && Number.isFinite(st.duration) && st.duration > 0) finish({ playable: true, durationMs: Math.round(st.duration * 1000) });
      });
      if (p.isLoaded && Number.isFinite(p.duration) && p.duration > 0) finish({ playable: true, durationMs: Math.round(p.duration * 1000) });
    } catch {
      finish({ playable: false, durationMs: null });
    }
  });
}

const extOf = (path: string): string => {
  const m = /\.([a-z0-9]{1,10})$/i.exec(path);
  return m ? m[1].toLowerCase() : SEGMENT_EXT.replace(/^\./, '');
};

const baseName = (path: string): string => {
  const clean = path.split(/[?#]/)[0];
  const i = clean.lastIndexOf('/');
  return i >= 0 ? clean.slice(i + 1) : clean;
};

/** pendingPath, or the same file name in the native recording folder when the container moved. */
async function findPending(pending: string | undefined): Promise<string | null> {
  if (!pending) return null;
  if (await expoFs.exists(pending).catch(() => false)) return pending;
  let name = baseName(pending);
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the raw name.
  }
  if (!name || name.includes('..')) return null;
  try {
    const moved = new File(Paths.document, Platform.OS === 'ios' ? 'ExpoAudio' : 'Audio', name).uri;
    if (moved !== pending && (await expoFs.exists(moved).catch(() => false))) return moved;
  } catch {
    // No document folder (web): nothing to find.
  }
  return null;
}

async function recoverSegment(s: NotebookSession, seg: RecSegment): Promise<ProbeResult | null> {
  // Moved into audio/ before the crash, but the state change was not saved.
  if (s.notebook.assets[seg.fileId]) {
    const path = s.assetPath(seg.fileId);
    if (await expoFs.exists(path).catch(() => false)) return probeAudio(path);
  }
  const pending = await findPending(seg.pendingPath);
  if (!pending) return { playable: false, durationMs: null };
  const res = await probeAudio(pending);
  // Undecided: leave the file and the segment for the next open.
  if (!res) return null;
  if (!res.playable) {
    await expoFs.remove(pending).catch(() => {});
    return res;
  }
  try {
    await s.addAsset(pending, 'audio', extOf(pending), { move: true, id: seg.fileId });
    return res;
  } catch {
    return { playable: false, durationMs: null };
  }
}

const running = new Map<Id, Promise<{ recovered: number; lost: number }>>();

async function run(s: NotebookSession): Promise<{ recovered: number; lost: number }> {
  if (s.readOnly) return { recovered: 0, lost: 0 };
  let recovered = 0;
  let lost = 0;
  for (const r of s.notebook.recordings) {
    const stale = staleSegments(r, (fileId) => isLiveSegment(s.id, fileId));
    if (!stale.length) continue;
    const results = new Map<Id, ProbeResult>();
    for (const seg of stale) {
      const res = await recoverSegment(s, seg);
      if (res) results.set(seg.fileId, res);
    }
    if (!results.size) continue;
    const current = s.notebook.recordings.find((x) => x.id === r.id);
    if (!current) continue;
    const out = applyRecovery(current, results);
    if (out.recording === current) continue;
    s.updateRecording(r.id, { segments: out.recording.segments, durationMs: out.recording.durationMs });
    recovered += out.recovered;
    lost += out.lost;
  }
  if (recovered || lost) await s.flushPendingNow().catch(() => {});
  return { recovered, lost };
}

export const recoverRecordings: RecoverRecordings = (s) => {
  const inFlight = running.get(s.id);
  if (inFlight) return inFlight;
  const p = run(s).finally(() => {
    if (running.get(s.id) === p) running.delete(s.id);
  });
  running.set(s.id, p);
  return p;
};
