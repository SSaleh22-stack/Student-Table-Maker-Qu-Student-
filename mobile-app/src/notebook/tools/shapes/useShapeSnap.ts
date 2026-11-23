/**
 * Hold-to-snap feedback (P28, NB-44, Figma 36 and 37; ruling (g)).
 *
 * useShapeSnap(ctx) returns:
 * - onShapeSnap(e): pass it to PageCanvas.onShapeSnap. It runs on JS after the canvas (P22) committed
 *   the hand-drawn stroke (history entry 1, e.strokeEntryId). It then:
 *   1. replaces the stroke with the clean shape: session.replaceItems(pageId, [strokeId], [shape],
 *      'shape-snap') (entry 2, whose id the toast keeps);
 *   2. selects the shape, so the lasso's handles (P27) let the student resize and rotate it;
 *   3. shows the top toast 'تحوّل إلى مستطيل' with the action 'تراجع'. The action calls
 *      session.undoIfTop(entryId): it brings the hand-drawn stroke back only while the snap is still
 *      the newest change. As soon as the top of the history changes (another stroke, an undo, a redo)
 *      the toast hides, so a late 'تراجع' can never undo something else;
 *   4. counts the snap in settings.snapHintsShown (an updater, merged against the latest settings),
 *      which retires the hint after SNAP_HINT_LIMIT snaps.
 * - overlay: <SnapHint/>, the 'ثبّت القلم لحظة… سيصبح مستطيلاً' hint above the pen (render it with the
 *   other canvas overlays).
 *
 * snapShape(session, e) is the same step outside React (tests, P29 wiring).
 */
import { createElement, useCallback, useEffect, useMemo } from 'react';

import { tr } from '@/lib/i18n';
import { getSelection } from '@/notebook/canvas/selection';
import type { ShapeSnapEvent, ToolContext, UseShapeSnap } from '@/notebook/contracts/tools';
import type { Id } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { doneText, SNAP_UNDO_LABEL } from '@/notebook/core/shapes/names';
import { getSettings, setSettings } from '@/notebook/store/settingsStore';
import { getToast, hideToast, showToast, subscribeToast } from '@/notebook/ui/toast';

import { SNAP_HINT_LIMIT, SnapHint } from './SnapHint';

/** The toast id: a newer snap replaces the toast in place. */
export const SNAP_TOAST_ID = 'snap';

/** History label of the snap entry. */
export const SNAP_HISTORY_LABEL = 'shape-snap';

/** Stops watching the current snap toast (one at a time, module-wide). */
let stopWatch: (() => void) | null = null;

function stopWatching(): void {
  const stop = stopWatch;
  stopWatch = null;
  if (stop) stop();
}

/**
 * Watches the snap toast: hides it when the session's top entry is no longer `entryId`, and stops
 * when the toast went away (hidden, timed out, or replaced by another toast).
 */
function watchSnapToast(session: NotebookSession, entryId: Id, hide: () => void): void {
  stopWatching();
  let unsubSession: (() => void) | null = null;
  let unsubToast: (() => void) | null = null;
  const stop = () => {
    unsubSession?.();
    unsubToast?.();
    unsubSession = null;
    unsubToast = null;
  };
  stopWatch = stop;
  unsubSession = session.subscribe(() => {
    if (session.topEntryId() === entryId) return;
    if (stopWatch === stop) stopWatching();
    hide();
  });
  unsubToast = subscribeToast(() => {
    const t = getToast();
    if ((!t || t.id !== SNAP_TOAST_ID) && stopWatch === stop) stopWatching();
  });
}

/** Counts one snap for the hint (only while the hint is still shown, so later snaps write nothing). */
function countSnap(): void {
  if (getSettings().snapHintsShown >= SNAP_HINT_LIMIT) return;
  setSettings((s) => ({ snapHintsShown: s.snapHintsShown + 1 }));
}

/**
 * Replaces the hand-drawn stroke with the clean shape, selects it and shows the undo toast.
 * Returns the history entry id of the snap ('' when nothing changed: read-only notebook, page not
 * loaded, stroke gone).
 */
export function snapShape(session: NotebookSession, e: ShapeSnapEvent): Id {
  const entryId = session.replaceItems(e.pageId, [e.strokeId], [e.shape], SNAP_HISTORY_LABEL);
  if (!entryId) return '';
  const shapeId = e.shape.id;
  getSelection().select(e.pageId, [shapeId]);

  const done = doneText(e.shape);
  const hide = showToast({
    id: SNAP_TOAST_ID,
    text: tr(done.ar, done.en),
    actionLabel: tr(SNAP_UNDO_LABEL.ar, SNAP_UNDO_LABEL.en),
    onAction: () => {
      stopWatching();
      if (!session.undoIfTop(entryId)) return;
      const sel = getSelection();
      if (sel.ids.includes(shapeId)) sel.clear();
    },
    tone: 'ok',
    position: 'top',
  });
  watchSnapToast(session, entryId, hide);
  countSnap();
  return entryId;
}

export const useShapeSnap: UseShapeSnap = (ctx: ToolContext) => {
  const { session, hand } = ctx;

  // Leaving the editor (or switching notebooks) ends the snap toast: its undo belongs to this session.
  useEffect(
    () => () => {
      stopWatching();
      hideToast(SNAP_TOAST_ID);
    },
    [session],
  );

  const onShapeSnap = useCallback((e: ShapeSnapEvent) => {
    snapShape(session, e);
  }, [session]);

  const overlay = useMemo(() => createElement(SnapHint, { hand }), [hand]);

  return { onShapeSnap, overlay };
};
