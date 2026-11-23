/**
 * The library tour (NB-T1, Figma 24-28): a welcome card ('ابدأ الجولة' / 'لاحقاً'), then up to 4
 * steps: course folders (lib.courses), my folders (lib.folders), the new-notebook button (lib.new),
 * and search + sort + settings (the union of lib.search and lib.headerActions).
 *
 * Render it ONLY in the normal library view, never in the empty state (P21). It starts when:
 * - the store is loaded (index and settings read),
 * - settings.tours.library is 'unseen',
 * - the screen is focused and `enabled` is true.
 * It waits up to 1.5 s for the targets; steps whose target is missing or off screen are dropped and
 * the rest renumbered ('1 من 3'). The flag becomes 'done' after the last step and 'skipped' after
 * 'لاحقاً' or 'تخطي الجولة'. When no target could be found the flag stays 'unseen' (it tries again
 * the next time the library opens or comes back into focus).
 *
 * 'Show the tour again' (resetTours) from the notebook settings, which are pushed over the library,
 * replays the tour when the student comes back to this same library screen: the mount is not
 * blocked by an earlier run.
 */
import { useIsFocused } from 'expo-router';
import { useState } from 'react';

import type { LibraryTourProps } from '@/notebook/contracts/tours';
import { useNotebooks } from '@/notebook/store/hooks';

import { LIBRARY_STEPS } from './stepText';
import { TourOverlay, type TourResult } from './TourOverlay';
import { setTourFlag } from './tourState';

export interface LibraryTourFullProps extends LibraryTourProps {
  /** false holds the tour back (e.g. while a sheet is open). Default true. */
  enabled?: boolean;
}

export function LibraryTour({ onDone, enabled = true }: LibraryTourFullProps) {
  const store = useNotebooks();
  const focused = useIsFocused();
  const flag = store.settings.tours.library;
  /** This run ended. Cleared when the flag is written (a later replay starts fresh) or on blur. */
  const [over, setOver] = useState(false);
  const [seen, setSeen] = useState({ flag, focused });
  if (seen.flag !== flag || seen.focused !== focused) {
    // Adjusting state while rendering (React's pattern for state derived from changing props).
    setSeen({ flag, focused });
    if (over && (flag !== 'unseen' || !focused)) setOver(false);
  }

  if (over || !store.loaded || flag !== 'unseen') return null;

  const onFinish = (result: TourResult) => {
    setOver(true);
    if (result === 'none') return;
    setTourFlag('library', result === 'done' ? 'done' : 'skipped');
    onDone?.();
  };

  return <TourOverlay steps={LIBRARY_STEPS} welcome onFinish={onFinish} active={enabled && focused} />;
}
