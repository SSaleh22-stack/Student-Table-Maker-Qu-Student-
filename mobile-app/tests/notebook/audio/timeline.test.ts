import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  appendSegment,
  applyRecovery,
  clampMs,
  elapsedOf,
  fractionOf,
  isPlayable,
  liveSegment,
  locate,
  markTicks,
  marksOf,
  msAtFraction,
  nextPlayable,
  nextRecordingNumber,
  nextSegmentStart,
  patchSegment,
  positionOf,
  recordingLength,
  shouldRotate,
  sortedSegments,
  staleSegments,
  withLength,
} from '../../../src/notebook/core/audio/timeline.ts';
import type { ProbeResult } from '../../../src/notebook/core/audio/timeline.ts';
import type { RecSegment, Recording } from '../../../src/notebook/core/model/index.ts';

const MIN = 60_000;

const seg = (fileId: string, startMs: number, durationMs: number, state: RecSegment['state'] = 'done'): RecSegment => ({ fileId, startMs, durationMs, state });

const rec = (segments: RecSegment[]): Recording => withLength({ id: 'r1', title: 'تسجيل 1', startedAt: '2026-11-23T07:00:00.000Z', durationMs: 0, segments });

describe('segments', () => {
  test('isPlayable: done and recovered only', () => {
    assert.equal(isPlayable({ state: 'done' }), true);
    assert.equal(isPlayable({ state: 'recovered' }), true);
    assert.equal(isPlayable({ state: 'lost' }), false);
    assert.equal(isPlayable({ state: 'recording' }), false);
  });

  test('recordingLength and nextSegmentStart are the end of the latest segment', () => {
    const s = [seg('b', 10 * MIN, 5 * MIN), seg('a', 0, 10 * MIN)];
    assert.equal(recordingLength(s), 15 * MIN);
    assert.equal(nextSegmentStart(s), 15 * MIN);
    assert.equal(recordingLength([]), 0);
  });

  test('sortedSegments orders by start and keeps equal starts stable', () => {
    const s = [seg('c', 20, 1), seg('a', 0, 10), seg('b', 0, 5)];
    assert.deepEqual(sortedSegments(s).map((x) => x.fileId), ['a', 'b', 'c']);
  });

  test('elapsedOf adds the live segment time to the closed ones', () => {
    const s = [seg('a', 0, 10 * MIN), seg('b', 10 * MIN, 0, 'recording')];
    assert.equal(elapsedOf(s, 'b', 1234), 10 * MIN + 1234);
    assert.equal(elapsedOf(s, null, 999), 10 * MIN);
    // A live time that is not finite counts as 0.
    assert.equal(elapsedOf(s, 'b', Number.NaN), 10 * MIN);
  });

  test('shouldRotate at the segment limit', () => {
    assert.equal(shouldRotate(10 * MIN - 1, 10 * MIN), false);
    assert.equal(shouldRotate(10 * MIN, 10 * MIN), true);
    assert.equal(shouldRotate(10 * MIN, 0), false);
  });

  test('liveSegment, appendSegment and patchSegment keep durationMs in step', () => {
    let r = rec([]);
    r = appendSegment(r, liveSegment('a', 0, 'file:///doc/ExpoAudio/a.m4a'));
    assert.equal(r.segments[0].state, 'recording');
    assert.equal(r.segments[0].pendingPath, 'file:///doc/ExpoAudio/a.m4a');
    r = patchSegment(r, 'a', { durationMs: 30_000.4 });
    assert.equal(r.segments[0].durationMs, 30_000);
    assert.equal(r.segments[0].pendingPath, 'file:///doc/ExpoAudio/a.m4a', 'a checkpoint keeps the pending path');
    assert.equal(r.durationMs, 30_000);
    r = patchSegment(r, 'a', { state: 'done', durationMs: 10 * MIN });
    assert.equal('pendingPath' in r.segments[0], false, 'a closed segment drops its pending path');
    assert.equal(r.durationMs, 10 * MIN);
    r = appendSegment(r, liveSegment('b', nextSegmentStart(r.segments), 'p'));
    assert.equal(r.segments[1].startMs, 10 * MIN);
    // Appending the same fileId again replaces it instead of duplicating it.
    r = appendSegment(r, liveSegment('b', 10 * MIN, 'q'));
    assert.equal(r.segments.length, 2);
    assert.equal(r.segments[1].pendingPath, 'q');
  });
});

describe('locate', () => {
  const s = [seg('a', 0, 10 * MIN), seg('lost', 10 * MIN, 4 * MIN, 'lost'), seg('c', 14 * MIN, 6 * MIN, 'recovered')];

  test('inside a playable segment', () => {
    assert.deepEqual(locate(s, 0), { index: 0, fileId: 'a', offsetMs: 0, ms: 0 });
    assert.deepEqual(locate(s, 5 * MIN), { index: 0, fileId: 'a', offsetMs: 5 * MIN, ms: 5 * MIN });
    assert.deepEqual(locate(s, 15 * MIN), { index: 2, fileId: 'c', offsetMs: MIN, ms: 15 * MIN });
  });

  test('a lost range jumps to the next playable start', () => {
    assert.deepEqual(locate(s, 11 * MIN), { index: 2, fileId: 'c', offsetMs: 0, ms: 14 * MIN });
    assert.deepEqual(locate(s, 10 * MIN), { index: 2, fileId: 'c', offsetMs: 0, ms: 14 * MIN });
  });

  test('past the end clamps to the end of the last playable segment', () => {
    assert.deepEqual(locate(s, 99 * MIN), { index: 2, fileId: 'c', offsetMs: 6 * MIN, ms: 20 * MIN });
  });

  test('negative and NaN times are the start', () => {
    assert.equal(locate(s, -5)?.ms, 0);
    assert.equal(locate(s, Number.NaN)?.ms, 0);
  });

  test('no playable segment gives null', () => {
    assert.equal(locate([seg('x', 0, 100, 'lost'), seg('y', 100, 0, 'recording')], 50), null);
    assert.equal(locate([], 0), null);
  });

  test('nextPlayable skips lost segments; positionOf maps back to the line', () => {
    assert.deepEqual(nextPlayable(s, 0)?.segment.fileId, 'c');
    assert.equal(nextPlayable(s, 0)?.index, 2);
    assert.equal(nextPlayable(s, 2), null);
    assert.equal(positionOf(s, 2, 30_000), 14 * MIN + 30_000);
    assert.equal(positionOf(s, 9, 1), 0);
  });

  test('segments given out of order are located in time order', () => {
    const shuffled = [s[2], s[0], s[1]];
    assert.equal(locate(shuffled, 15 * MIN)?.fileId, 'c');
    assert.equal(locate(shuffled, 15 * MIN)?.index, 2);
  });
});

describe('scrubber math', () => {
  test('clampMs, fractionOf and msAtFraction', () => {
    assert.equal(clampMs(-1, 100), 0);
    assert.equal(clampMs(150, 100), 100);
    assert.equal(clampMs(Number.NaN, 100), 0);
    assert.equal(fractionOf(25, 100), 0.25);
    assert.equal(fractionOf(25, 0), 0);
    assert.equal(fractionOf(500, 100), 1);
    assert.equal(msAtFraction(0.5, 47 * MIN), 23.5 * MIN);
    assert.equal(msAtFraction(2, 100), 100);
    assert.equal(msAtFraction(-1, 100), 0);
    assert.equal(msAtFraction(Number.NaN, 100), 0);
  });

  test('markTicks sorts, drops out-of-range marks and merges close ones', () => {
    assert.deepEqual(markTicks([500, 100, 101, 900, -1, 2000], 1000), [0.1, 0.5, 0.9]);
    assert.deepEqual(markTicks([100, 140, 200], 1000, 0.05), [0.1, 0.2]);
    assert.deepEqual(markTicks([1, 2], 0), []);
    assert.deepEqual(markTicks([], 1000), []);
  });

  test('marksOf collects the marks of one recording', () => {
    const items = [{ rec: { recordingId: 'r1', ms: 10 } }, {}, { rec: { recordingId: 'r2', ms: 20 } }, { rec: { recordingId: 'r1', ms: 30 } }];
    assert.deepEqual(marksOf(items, 'r1'), [10, 30]);
    assert.deepEqual(marksOf(items, 'none'), []);
  });
});

describe('default titles', () => {
  test('one more than the count', () => {
    assert.equal(nextRecordingNumber([]), 1);
    assert.equal(nextRecordingNumber(['تسجيل 1']), 2);
    assert.equal(nextRecordingNumber(['شرح الواجب', 'تسجيل 2 — المراجعة']), 3);
  });

  test('skips numbers a default title already uses, in either language', () => {
    assert.equal(nextRecordingNumber(['تسجيل 2']), 3);
    assert.equal(nextRecordingNumber(['Recording 2', 'تسجيل 3']), 4);
    assert.equal(nextRecordingNumber(['تسجيل 1', 'تسجيل 4', 'x']), 5);
  });
});

describe('recovery', () => {
  test('staleSegments ignores the live segment', () => {
    const r = rec([seg('a', 0, 10 * MIN), seg('b', 10 * MIN, 20_000, 'recording'), seg('c', 0, 0, 'recording')]);
    assert.deepEqual(staleSegments(r, (id) => id === 'c').map((s) => s.fileId), ['b']);
    assert.deepEqual(staleSegments(r, () => false).map((s) => s.fileId), ['b', 'c']);
  });

  test('a playable file becomes recovered with the probed length', () => {
    const r = rec([seg('a', 0, 10 * MIN), { ...seg('b', 10 * MIN, 30_000, 'recording'), pendingPath: 'p' }]);
    const res = new Map<string, ProbeResult>([['b', { playable: true, durationMs: 41_500 }]]);
    const out = applyRecovery(r, res);
    assert.equal(out.recovered, 1);
    assert.equal(out.lost, 0);
    assert.deepEqual(out.recording.segments[1], { fileId: 'b', startMs: 10 * MIN, durationMs: 41_500, state: 'recovered' });
    assert.equal(out.recording.durationMs, 10 * MIN + 41_500);
  });

  test('a playable file without a probed length keeps the checkpoint', () => {
    const r = rec([{ ...seg('b', 0, 30_000, 'recording'), pendingPath: 'p' }]);
    const out = applyRecovery(r, new Map([['b', { playable: true, durationMs: null }]]));
    assert.equal(out.recording.segments[0].durationMs, 30_000);
    assert.equal(out.recording.segments[0].state, 'recovered');
  });

  test('an unplayable file becomes lost and keeps its time range', () => {
    const r = rec([{ ...seg('b', 0, 30_000, 'recording'), pendingPath: 'p' }]);
    const out = applyRecovery(r, new Map([['b', { playable: false, durationMs: null }]]));
    assert.equal(out.lost, 1);
    assert.deepEqual(out.recording.segments[0], { fileId: 'b', startMs: 0, durationMs: 30_000, state: 'lost' });
    assert.equal(out.recording.durationMs, 30_000);
  });

  test('nothing to do returns the same recording', () => {
    const r = rec([seg('a', 0, 100)]);
    const out = applyRecovery(r, new Map([['a', { playable: false, durationMs: null }]]));
    assert.equal(out.recording, r, 'a closed segment is never touched');
    assert.equal(out.lost, 0);
  });
});
