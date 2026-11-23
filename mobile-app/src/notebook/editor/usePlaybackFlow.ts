/**
 * Playback in the editor (NB-62, NB-63, Figma 11): how the student gets into the player and out again.
 *
 * Entry: the more menu's 'التسجيلات' (or the player bar's list button) opens RecordingsPanel. Tapping
 * a row loads that recording (player.load), shows PlayerBar and remembers the tool in use (prevTool),
 * once per visit of the bar.
 * Pointer: PlayerBar.onPointer selects the 'play from here' tool (setTool('play')); pointerActive is
 * tool === 'play' (a second tap gives the previous tool back). The canvas calls onPlayFrom(mark) for a tap on ink with a mark: the player loads
 * that mark's recording if needed, seeks and plays (player.playFrom).
 * Exit: PlayerBar.onClose unloads the player, hides the bar and gives back the previous tool (when
 * the play tool is still the tool). A recording that disappears while the bar is open (deleted,
 * undone) closes the bar the same way.
 * The canvas `playback` prop ({ recordingId, ms }) is set while a recording is loaded, which dims the
 * ink made after the current moment.
 *
 * When the editor goes, a recording of this notebook is unloaded (the player holds the session).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { player } from '@/notebook/audio/player';
import { usePlaybackSnapshot } from '@/notebook/audio/usePlayback';
import type { PageCanvasProps } from '@/notebook/contracts/canvas';
import type { ToolId } from '@/notebook/contracts/tools';
import type { Id, RecMark } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { getToolState, toolActions, useToolState } from '@/notebook/toolbar/toolState';
import { showToast } from '@/notebook/ui/toast';
import { tr } from '@/lib/i18n';

export interface PlaybackFlow {
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  /** RecordingsPanel.onLoad */
  onLoad: (recordingId: Id) => void;
  barOpen: boolean;
  /** PlayerBar props */
  onPointer: () => void;
  pointerActive: boolean;
  onCloseBar: () => void;
  /** PageCanvas onPlayFrom */
  onPlayFrom: (mark: RecMark) => void;
  /** PageCanvas playback */
  playback: PageCanvasProps['playback'];
}

function belongsTo(session: NotebookSession, recordingId: Id | null): boolean {
  return !!recordingId && session.notebook.recordings.some((r) => r.id === recordingId);
}

export function usePlaybackFlow(session: NotebookSession): PlaybackFlow {
  const snap = usePlaybackSnapshot();
  const { state: tools } = useToolState();
  const [panelOpen, setPanelOpen] = useState(false);
  const [barOpen, setBarOpen] = useState(false);
  /** The tool before the bar opened; null while the bar is closed. */
  const prevTool = useRef<ToolId | null>(null);
  const loadSeq = useRef(0);
  /** Loads in flight (the player shows no recording while it switches). */
  const loads = useRef(0);
  const barOpenRef = useRef(false);
  useEffect(() => {
    barOpenRef.current = barOpen;
  }, [barOpen]);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const closeBar = useCallback(() => {
    loadSeq.current++;
    barOpenRef.current = false;
    player.unload();
    setBarOpen(false);
    const back = prevTool.current;
    prevTool.current = null;
    if (back && getToolState().state.tool === 'play') toolActions.setTool(back === 'play' ? 'pen' : back);
  }, []);

  const onLoad = useCallback(
    (recordingId: Id) => {
      if (prevTool.current === null) prevTool.current = getToolState().state.tool;
      const seq = ++loadSeq.current;
      loads.current++;
      const done = () => {
        loads.current = Math.max(0, loads.current - 1);
      };
      player.load(session, recordingId).then(
        () => {
          done();
          if (seq !== loadSeq.current) return;
          barOpenRef.current = true;
          setBarOpen(true);
        },
        () => {
          done();
          if (seq !== loadSeq.current) return;
          showToast({ text: tr('تعذّر تشغيل التسجيل', 'Could not play the recording'), tone: 'warn', id: 'nb-playback-error' });
          if (player.recordingId) return;
          // Nothing is loaded: close the bar (giving back the previous tool), or forget the tool.
          if (barOpenRef.current) closeBar();
          else prevTool.current = null;
        },
      );
    },
    [session, closeBar],
  );

  const onPointer = useCallback(() => {
    const t = getToolState().state.tool;
    if (t === 'play') {
      // A second tap on the pointer gives the previous tool back (the bar stays).
      toolActions.setTool(prevTool.current && prevTool.current !== 'play' ? prevTool.current : 'pen');
      return;
    }
    toolActions.setTool('play');
  }, []);

  const onPlayFrom = useCallback(
    (mark: RecMark) => {
      if (prevTool.current === null) prevTool.current = getToolState().state.tool;
      barOpenRef.current = true;
      setBarOpen(true);
      loads.current++;
      player
        .playFrom(session, mark)
        .catch(() => {
          showToast({ text: tr('تعذّر تشغيل التسجيل', 'Could not play the recording'), tone: 'warn', id: 'nb-playback-error' });
        })
        .finally(() => {
          loads.current = Math.max(0, loads.current - 1);
          // The player may have emitted while this load was still counted: close an empty bar now.
          if (barOpenRef.current && loads.current === 0 && !player.recordingId) closeBar();
        });
    },
    [session, closeBar],
  );

  // The loaded recording went away (deleted, or unloaded elsewhere): close the bar.
  const loadedHere = belongsTo(session, snap.recordingId);
  useEffect(
    () =>
      player.subscribe(() => {
        if (barOpenRef.current && loads.current === 0 && !player.recordingId) closeBar();
      }),
    [closeBar],
  );

  // Leaving the editor: unload this notebook's recording.
  useEffect(
    () => () => {
      if (belongsTo(session, player.recordingId)) player.unload();
    },
    [session],
  );

  const recordingId = loadedHere ? snap.recordingId : null;
  const playback = useMemo<PageCanvasProps['playback']>(
    () => (barOpen && recordingId ? { recordingId, ms: player.ms } : null),
    [barOpen, recordingId],
  );

  return {
    panelOpen,
    openPanel,
    closePanel,
    onLoad,
    barOpen,
    onPointer,
    pointerActive: tools.tool === 'play',
    onCloseBar: closeBar,
    onPlayFrom,
    playback,
  };
}
