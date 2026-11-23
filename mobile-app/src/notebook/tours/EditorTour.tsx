/**
 * The notebook tour (NB-T3, Figma 31-35), right after the first-time setup: the toolbar
 * (ed.toolbar), the grip (ed.grip), undo and redo (ed.undo; the text says which side undo is on, from
 * the reading direction, or top/bottom in a vertical toolbar), the record button (ed.record), and the
 * header pill of pages, share and more (ed.actions, spotlighted as one pill) with 'تم، لنبدأ'.
 *
 * It runs when the store is loaded, settings.tours.editor is 'unseen', the setup is no longer
 * 'unseen' (the setup comes first), the screen is focused and `enabled` is true. Missing targets are
 * dropped and the rest renumbered. onDone is called when the tour ends (done or skipped), when there
 * is nothing to show (the tour was already seen, or no target was found), so the editor can go on.
 *
 * When the setup was showing in this mount, the tour waits AFTER_SETUP_MS before it looks for its
 * targets, so the setup Modal has finished closing (iOS does not present a Modal while another is
 * being dismissed, and the tour would never appear).
 */
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import type { EditorTourProps } from '@/notebook/contracts/tours';
import { useNotebooks } from '@/notebook/store/hooks';

import { EDITOR_STEPS } from './stepText';
import { TourOverlay, type TourResult } from './TourOverlay';
import { setTourFlag } from './tourState';

export interface EditorTourFullProps extends EditorTourProps {
  /** false holds the tour back (e.g. while a dialog is open). Default true. */
  enabled?: boolean;
}

/** Longer than the setup Modal's fade-out. */
const AFTER_SETUP_MS = 500;

export function EditorTour({ onDone, enabled = true }: EditorTourFullProps) {
  const store = useNotebooks();
  const focused = useIsFocused();
  const [over, setOver] = useState(false);
  const doneSent = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const flag = store.settings.tours.editor;
  const setupPending = store.settings.tours.setup === 'unseen';
  const notNeeded = store.loaded && flag !== 'unseen';
  /** The setup was pending at some point in this mount (so its Modal may still be closing). */
  const [afterSetup, setAfterSetup] = useState(false);
  if (store.loaded && setupPending && !afterSetup) setAfterSetup(true);

  const sendDone = () => {
    if (doneSent.current) return;
    doneSent.current = true;
    onDoneRef.current();
  };

  // Already seen or skipped: nothing to show, let the editor go on.
  useEffect(() => {
    if (!notNeeded || doneSent.current) return;
    doneSent.current = true;
    onDoneRef.current();
  }, [notNeeded]);

  if (over || !store.loaded || flag !== 'unseen' || setupPending) return null;

  const onFinish = (result: TourResult) => {
    setOver(true);
    if (result !== 'none') setTourFlag('editor', result === 'done' ? 'done' : 'skipped');
    sendDone();
  };

  return <TourOverlay steps={EDITOR_STEPS} onFinish={onFinish} active={enabled && focused} delayMs={afterSetup ? AFTER_SETUP_MS : 0} />;
}
