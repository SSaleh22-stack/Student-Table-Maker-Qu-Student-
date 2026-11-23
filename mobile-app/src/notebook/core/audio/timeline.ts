/**
 * Recording timeline math (P12). Pure: no I/O, no time, no native audio.
 *
 * A Recording is a list of SEGMENTS (one audio file each, at most SEGMENT_MS long, see
 * src/notebook/audio/presets.ts). Times are RECORDING time in ms: time spent recording, pauses
 * excluded. Segment k starts where segment k-1 ended (startMs = the sum of the earlier durations), so
 * a mark { recordingId, ms } on ink is a point on this one line, whatever segment holds it.
 *
 * Segment states:
 * - 'recording': being written (or the app died while it was: recovery decides what it becomes)
 * - 'done': closed normally, the file is in the notebook's audio/ folder
 * - 'recovered': closed by recovery after a crash, the file plays
 * - 'lost': closed by recovery, the file did not play. Its time range stays on the line (marks made
 *   during it keep their place); playback skips it.
 *
 * Used by recorder.ts (segments, default titles, rotation), player.ts (locate, next segment),
 * recovery.ts (applyRecovery) and the PlayerBar scrubber (fractions, mark ticks).
 */
import type { Id, RecSegment, Recording } from '../model/index.ts';

/** True when the segment's file can be played. */
export function isPlayable(s: Pick<RecSegment, 'state'>): boolean {
  return s.state === 'done' || s.state === 'recovered';
}

const finite = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

/** The segments sorted by start (stable for equal starts). */
export function sortedSegments(segments: readonly RecSegment[]): RecSegment[] {
  return segments
    .map((s, i) => ({ s, i }))
    .sort((a, b) => finite(a.s.startMs) - finite(b.s.startMs) || a.i - b.i)
    .map((x) => x.s);
}

/** Length of the recording line: the end of the latest segment (0 for none). */
export function recordingLength(segments: readonly RecSegment[]): number {
  let end = 0;
  for (const s of segments) end = Math.max(end, finite(s.startMs) + finite(s.durationMs));
  return Math.round(end);
}

/** Where the next segment starts (the end of the line). */
export function nextSegmentStart(segments: readonly RecSegment[]): number {
  return recordingLength(segments);
}

/** Total recording time: the closed segments plus the live segment's recorded time so far. */
export function elapsedOf(segments: readonly RecSegment[], liveFileId: Id | null, liveMs: number): number {
  let closed = 0;
  for (const s of segments) if (s.fileId !== liveFileId) closed = Math.max(closed, finite(s.startMs) + finite(s.durationMs));
  const live = segments.find((s) => s.fileId === liveFileId);
  if (!live) return Math.round(closed);
  return Math.round(Math.max(closed, finite(live.startMs) + finite(liveMs)));
}

/** True when the live segment has reached the rotation length. */
export function shouldRotate(segmentMs: number, limitMs: number): boolean {
  return Number.isFinite(limitMs) && limitMs > 0 && finite(segmentMs) >= limitMs;
}

/** A position inside one playable segment. */
export interface SegmentPos {
  /** Index into sortedSegments(segments). */
  index: number;
  fileId: Id;
  /** Offset inside that segment's file, in ms. */
  offsetMs: number;
  /** The same position on the recording line. */
  ms: number;
}

/**
 * The playable segment holding recording time ms.
 * - ms inside a playable segment: that segment and the offset in it
 * - ms in a lost segment or a gap: the start of the next playable segment
 * - ms past the end: the END of the last playable segment (offset = its duration)
 * - no playable segment: null
 */
export function locate(segments: readonly RecSegment[], ms: number): SegmentPos | null {
  const list = sortedSegments(segments);
  const t = finite(ms);
  let last: SegmentPos | null = null;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!isPlayable(s)) continue;
    const start = finite(s.startMs);
    const dur = finite(s.durationMs);
    if (t < start) return { index: i, fileId: s.fileId, offsetMs: 0, ms: start };
    if (t < start + dur) return { index: i, fileId: s.fileId, offsetMs: t - start, ms: t };
    last = { index: i, fileId: s.fileId, offsetMs: dur, ms: start + dur };
  }
  return last;
}

/** The first playable segment after index (in sortedSegments order), or null. */
export function nextPlayable(segments: readonly RecSegment[], index: number): { index: number; segment: RecSegment } | null {
  const list = sortedSegments(segments);
  for (let i = Math.max(0, index + 1); i < list.length; i++) if (isPlayable(list[i])) return { index: i, segment: list[i] };
  return null;
}

/** Recording time of an offset inside segment index (sortedSegments order). */
export function positionOf(segments: readonly RecSegment[], index: number, offsetMs: number): number {
  const s = sortedSegments(segments)[index];
  if (!s) return 0;
  return Math.round(finite(s.startMs) + finite(offsetMs));
}

/** ms clamped to [0, total]. */
export function clampMs(ms: number, total: number): number {
  const t = finite(total);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(ms, t);
}

/** ms as a 0..1 fraction of total (0 when total is 0). */
export function fractionOf(ms: number, total: number): number {
  const t = finite(total);
  if (t === 0) return 0;
  return clampMs(ms, t) / t;
}

/** The recording time at fraction f (clamped to 0..1) of total. */
export function msAtFraction(f: number, total: number): number {
  const t = finite(total);
  const x = Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
  return Math.round(x * t);
}

/**
 * Scrubber ticks for the ink marks of one recording: sorted fractions of total, marks closer than
 * minGap (a fraction) to the previous tick merged into it. Marks outside [0, total] are dropped.
 */
export function markTicks(marks: readonly number[], total: number, minGap: number = 0.01): number[] {
  const t = finite(total);
  if (t === 0) return [];
  const gap = Number.isFinite(minGap) && minGap > 0 ? minGap : 0;
  const fr = marks.filter((m) => Number.isFinite(m) && m >= 0 && m <= t).map((m) => m / t).sort((a, b) => a - b);
  const out: number[] = [];
  for (const f of fr) {
    if (out.length && f - out[out.length - 1] < gap) continue;
    out.push(f);
  }
  return out;
}

/** The marks (ms) of one recording found on a set of items. */
export function marksOf(items: Iterable<{ rec?: { recordingId: Id; ms: number } }>, recordingId: Id): number[] {
  const out: number[] = [];
  for (const it of items) if (it.rec && it.rec.recordingId === recordingId && Number.isFinite(it.rec.ms)) out.push(it.rec.ms);
  return out;
}

const DEFAULT_TITLE = /^(?:تسجيل|Recording)\s+(\d{1,6})$/;

/**
 * The n of the default title 'تسجيل n' / 'Recording n' for a new recording: one more than the
 * number of recordings, moved past any n a default-titled recording already uses.
 */
export function nextRecordingNumber(titles: readonly string[]): number {
  const used = new Set<number>();
  for (const t of titles) {
    const m = DEFAULT_TITLE.exec(String(t ?? '').trim());
    if (m) used.add(Number(m[1]));
  }
  let n = titles.length + 1;
  while (used.has(n)) n++;
  return n;
}

/** A new live segment at the end of the line. */
export function liveSegment(fileId: Id, startMs: number, pendingPath: string): RecSegment {
  return { fileId, startMs: Math.round(finite(startMs)), durationMs: 0, state: 'recording', pendingPath };
}

/** The recording with its durationMs recomputed from the segments. */
export function withLength(r: Recording): Recording {
  return { ...r, durationMs: recordingLength(r.segments) };
}

/** The recording with one segment changed (matched by fileId), durationMs recomputed. */
export function patchSegment(r: Recording, fileId: Id, patch: Partial<RecSegment>): Recording {
  const segments = r.segments.map((s) => {
    if (s.fileId !== fileId) return s;
    const next: RecSegment = { ...s, ...patch, fileId };
    // Only a live segment has a pending file; a closed one lives in audio/ under its fileId.
    if (next.state !== 'recording' || !next.pendingPath) delete next.pendingPath;
    next.durationMs = Math.round(finite(next.durationMs));
    return next;
  });
  return withLength({ ...r, segments });
}

/** The recording with a segment appended, durationMs recomputed. */
export function appendSegment(r: Recording, seg: RecSegment): Recording {
  return withLength({ ...r, segments: [...r.segments.filter((s) => s.fileId !== seg.fileId), seg] });
}

/** Segments left 'recording' that are not being written right now (a crash left them). */
export function staleSegments(r: Recording, isLive: (fileId: Id) => boolean): RecSegment[] {
  return r.segments.filter((s) => s.state === 'recording' && !isLive(s.fileId));
}

/** What recovery found for one stale segment. */
export interface ProbeResult {
  playable: boolean;
  /** The file's length when it played; null to keep the last saved checkpoint. */
  durationMs: number | null;
}

/**
 * Closes the stale segments with what the probes found: playable ones become 'recovered' (with the
 * probed length when there is one), the rest 'lost' (keeping the checkpointed length, so later marks
 * keep their place). Segments without a probe result are left as they are. pendingPath is dropped
 * from every closed segment.
 */
export function applyRecovery(r: Recording, results: ReadonlyMap<Id, ProbeResult>): { recording: Recording; recovered: number; lost: number } {
  let recovered = 0;
  let lost = 0;
  const segments = r.segments.map((s) => {
    const res = s.state === 'recording' ? results.get(s.fileId) : undefined;
    if (!res) return s;
    const next: RecSegment = { fileId: s.fileId, startMs: s.startMs, durationMs: s.durationMs, state: res.playable ? 'recovered' : 'lost' };
    if (res.playable) {
      recovered++;
      if (res.durationMs !== null && Number.isFinite(res.durationMs) && res.durationMs > 0) next.durationMs = Math.round(res.durationMs);
    } else {
      lost++;
    }
    return next;
  });
  if (!recovered && !lost) return { recording: r, recovered, lost };
  return { recording: withLength({ ...r, segments }), recovered, lost };
}
