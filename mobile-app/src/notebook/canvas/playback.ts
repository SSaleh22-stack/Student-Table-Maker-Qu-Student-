/**
 * Playback dimming (P22, NB-62): while a recording plays, ink made after the current moment is drawn
 * dimmed (core painter DIM_ALPHA), so the student can follow along.
 *
 * The player position is a shared value (PlaybackController.ms) that moves every frame; the painter's
 * pictures are built on JS. usePlaybackDim brings the position to JS at most every DIM_STEP_MS, and
 * dimSignature lets a page rebuild its pictures only when the SET of dimmed items changed (the count
 * of a page's items after the mark only grows or shrinks as the mark moves, so an equal count means an
 * equal set).
 */
import { useMemo, useState } from 'react';
import { useAnimatedReaction, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { Id, PageItem, RecMark } from '@/notebook/core/model';

/** How often the dim mark follows the player (ms of audio). */
export const DIM_STEP_MS = 100;

export interface PlaybackProp {
  recordingId: Id;
  ms: SharedValue<number>;
}

/** The mark after which ink is dimmed, or null when nothing plays. */
export function usePlaybackDim(playback: PlaybackProp | null | undefined): RecMark | null {
  const [ms, setMs] = useState<number | null>(null);
  const fallback = useSharedValue(-1);
  const src = playback ? playback.ms : fallback;
  const on = !!playback;

  useAnimatedReaction(
    () => (on ? Math.floor(src.get() / DIM_STEP_MS) : -1),
    (step, prev) => {
      if (step === prev) return;
      scheduleOnRN(setMs, step < 0 ? null : step * DIM_STEP_MS);
    },
    [on, src],
  );

  const recordingId = playback ? playback.recordingId : null;
  return useMemo(() => (recordingId === null || ms === null ? null : { recordingId, ms }), [recordingId, ms]);
}

/** A key that changes exactly when the set of items dimmed by dimAfter changes. */
export function dimSignature(items: readonly PageItem[], dimAfter: RecMark | null): string {
  if (!dimAfter) return '';
  let n = 0;
  for (const it of items) if (it.rec && it.rec.recordingId === dimAfter.recordingId && it.rec.ms > dimAfter.ms) n += 1;
  return `${dimAfter.recordingId}:${n}`;
}
