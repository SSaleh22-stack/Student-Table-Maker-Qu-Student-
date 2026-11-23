/**
 * The notebook editor (P29; Figma 06-12, 14, 18-23, 29-35; NB-24, NB-47a, NB-48, NB-49, NB-49a,
 * NB-51, NB-60, NB-62, NB-63, NB-65, NB-68, NB-81, NB-T2, NB-T3, PRD9 open time).
 *
 * STATES
 * - Opening: the canvas grey with the back button (a spinner after a moment).
 * - 'missing' / 'unreadable': EditorError (exact strings there).
 * - Read-only (made by a newer app version): the warning banner 'أُنشئت هذه المذكرة بإصدار أحدث من
 *   التطبيق. حدّث التطبيق لتعديلها.', no toolbar and no tools on the canvas (it can still be read,
 *   scrolled, zoomed, exported and played).
 *
 * LAYOUT (everything over one full-size PageCanvas; physical placement only)
 * - editorFrames (P13) with { screen: the editor box, insets: the safe area (physical), toolbarPos
 *   (a portrait phone falls back from left / right to top), barThickness, dock: calc open and docked
 *   on a regular window ? { side: 'left', width: 360 } : null } (the physical left in every language). It gives the
 *   toolbar slot (MovableToolbar), the dock rect (CalculatorDock) and the canvas contentInsets. A left
 *   toolbar next to a left dock sits at the dock's inner edge (ruling (f)).
 * - Compact windows: the docked calculator is a bottom panel (P24, 45 % of the height). The frames are
 *   computed for the area above it and the canvas keeps its height clear too.
 * - The docked panel runs the full height of the editor (top safe area inside it); the header buttons
 *   on its side move to its inner edge.
 * - EditorHeader: back at the reading-start top corner, the 'ed.actions' pill (pages, share, more) at
 *   the other one. On regular windows a TOP toolbar sits in that same row, between them
 *   (editorFrames headerReserve); on phones it keeps its own row under the header. PageCounter and ZoomPill sit in the footer band at the bottom corners (Figma 06;
 *   a bottom toolbar sits above that band, Figma 20).
 *
 * TOOLS: useToolPlugins (lasso, image action, shapes, snap, ruler, text). The toolbar's record slot is
 * the RecordButton wrapped in the 'ed.record' tour target (attached once, here). onImage opens the
 * image source sheet; the calculator button toggles settings.calc.open.
 *
 * RECORDING AND PLAYBACK: useEditorLifecycle (grace stop on unmount, recovery on open),
 * ContinueRecordingBanner (only for this notebook's recording paused by a leave), usePlaybackFlow
 * (recordings panel, player bar, the 'play' pointer tool and back).
 *
 * AUTO PAGE (core/pages/autoPage.ts): once the last page is a paper page with something on it, a blank
 * page with the same paper is added after it (no undo entry), so writing never runs out of pages.
 *
 * FIRST OPEN: SetupModal (tours.setup 'unseen'; backup through useEnableBackupFlow, its 'restore'
 * answer opens the restore screen), then EditorTour.
 *
 * OPEN TIME (PRD9): the canvas and the header render first; the calculator, the setup, the tour, the
 * recordings UI and the export sheet mount two frames later.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';

import { tr } from '@/lib/i18n';
import { useScreenInsets } from '@/lib/insets';
import { isRTL } from '@/lib/rtl';
import { shadow } from '@/lib/theme';
import { ContinueRecordingBanner } from '@/notebook/audio/ContinueRecordingBanner';
import { PlayerBar } from '@/notebook/audio/PlayerBar';
import { recorder } from '@/notebook/audio/recorder';
import { RecordButton } from '@/notebook/audio/RecordButton';
import { RecordingsPanel } from '@/notebook/audio/RecordingsPanel';
import { useEnableBackupFlow } from '@/notebook/backup/useEnableBackupFlow';
import { CALC_DOCK_WIDTH, CALC_PHONE_DOCK_FRACTION } from '@/notebook/calc/CalculatorPanel';
import { PageCanvas } from '@/notebook/canvas/PageCanvas';
import type { CanvasInput, PageCanvasHandle } from '@/notebook/contracts/canvas';
import { newId, type Id } from '@/notebook/core/model';
import { autoPageAfter, needsAutoPage } from '@/notebook/core/pages/autoPage';
import type { NotebookSession } from '@/notebook/core/session/types';
import { BAR, FRAME, barThickness, editorFrames, type DockSpec, type Insets, type Rect } from '@/notebook/core/toolbar/dock';
import { ExportSheet } from '@/notebook/export/ExportSheet';
import { goBackOr, openLibrary, openNotebookSettings, openPages } from '@/notebook/nav';
import { useNotebookSession, useNotebookSettings, usePage, useSessionSnapshot } from '@/notebook/store/hooks';
import { nbColors } from '@/notebook/theme';
import { MovableToolbar } from '@/notebook/toolbar/MovableToolbar';
import { useToolState } from '@/notebook/toolbar/toolState';
import { paperColorOf } from '@/notebook/tools/shapes/useShapeTool';
import { EditorTour } from '@/notebook/tours/EditorTour';
import { SetupModal } from '@/notebook/tours/SetupModal';
import { CircleButton } from '@/notebook/ui/CircleButton';
import { InfoBanner } from '@/notebook/ui/InfoBanner';
import { useIsCompact } from '@/notebook/ui/layout';
import { physicalBox, physicalLeft, physicalRight, physicalSides } from '@/notebook/ui/physical';
import type { AnchorRect } from '@/notebook/ui/Popover';
import { useTourTarget } from '@/notebook/ui/tourTargets';

import { CalculatorDock } from './CalculatorDock';
import { EditorError } from './EditorError';
import { EditorHeader, HEADER_SIDE, headerReserve } from './EditorHeader';
import { EditorMoreMenu, type EditorMoreAction } from './EditorMoreMenu';
import { PageCounter } from './PageCounter';
import { useEditorLifecycle, type EditorLifecycle } from './useEditorLifecycle';
import { usePlaybackFlow } from './usePlaybackFlow';
import { useToolPlugins } from './useToolPlugins';
import { ZoomPill } from './ZoomPill';

/** Footer pills: distance from the canvas side edges (Figma 18) and their height. */
const FOOTER_SIDE = 18;
const FOOTER_PILL_H = 34;
/** Gap between the bottom chrome and the banners / player bar above it. */
const OVER_GAP = 12;
/** The spinner shows only when opening takes longer than this. */
const SPINNER_DELAY_MS = 400;

export interface EditorScreenProps {
  notebookId: Id | null;
}

export function EditorScreen({ notebookId }: EditorScreenProps) {
  const { session, error } = useNotebookSession(notebookId);
  const canvasRef = useRef<PageCanvasHandle>(null);
  const getCanvas = useCallback(() => canvasRef.current, []);
  const life = useEditorLifecycle(notebookId, session, getCanvas);

  if (!notebookId) return <EditorError kind="missing" />;
  if (error) return <EditorError kind={error} />;
  if (!session || session.id !== notebookId) return <EditorOpening />;
  return <EditorBody key={session.id} session={session} canvasRef={canvasRef} getCanvas={getCanvas} life={life} />;
}

// ===== opening

function EditorOpening() {
  const insets = useScreenInsets();
  const compact = useIsCompact();
  const size = compact ? 36 : 40;
  const [spinner, setSpinner] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, []);
  const back = isRTL ? physicalRight(insets.right + HEADER_SIDE) : physicalLeft(insets.left + HEADER_SIDE);
  return (
    <View style={styles.root}>
      {spinner ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={nbColors.accent} accessibilityLabel={tr('جارٍ فتح المذكرة', 'Opening the notebook')} />
        </View>
      ) : null}
      <View style={[styles.abs, { top: insets.top + (FRAME.header - size) / 2 }, back]}>
        <CircleButton
          icon="back"
          label={tr('رجوع', 'Back')}
          tone="clear"
          size={size}
          onPress={() => goBackOr(openLibrary)}
          style={[styles.round, { width: size, height: size, borderRadius: size / 2 }]}
        />
      </View>
    </View>
  );
}

// ===== the open notebook

interface EditorBodyProps {
  session: NotebookSession;
  canvasRef: RefObject<PageCanvasHandle | null>;
  getCanvas: () => PageCanvasHandle | null;
  life: EditorLifecycle;
}

function EditorBody({ session, canvasRef, getCanvas, life }: EditorBodyProps) {
  const [settings, setSettings] = useNotebookSettings();
  const snap = useSessionSnapshot(session);
  const { state: tools } = useToolState();
  const compact = useIsCompact();
  const safe = useScreenInsets();
  const win = useWindowDimensions();
  const readOnly = session.readOnly;
  const notebook = snap?.notebook ?? session.notebook;

  // ----- the editor box (the canvas fills it; every frame is in its coordinates)
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b && b.width === width && b.height === height ? b : { width, height }));
  }, []);
  const W = box?.width ?? win.width;
  const H = box?.height ?? win.height;

  // ----- frames (physical)
  const insets: Insets = useMemo(
    () => ({ top: safe.top, bottom: safe.bottom, left: safe.left, right: safe.right }),
    [safe.top, safe.bottom, safe.left, safe.right],
  );
  const calcOpen = settings.calc.open;
  const calcDocked = settings.calc.docked;
  const phoneDock = compact && calcOpen && calcDocked;
  const panelH = phoneDock ? Math.round(H * CALC_PHONE_DOCK_FRACTION) : 0;
  const dockSpec: DockSpec | null = useMemo(
    () => (calcOpen && calcDocked && !compact ? { side: 'left', width: CALC_DOCK_WIDTH } : null),
    [calcOpen, calcDocked, compact],
  );
  const frameScreen = useMemo(() => ({ width: W, height: H - panelH }), [W, H, panelH]);
  // Tablets: a top toolbar goes into the header row, between the back button and the actions pill.
  const headerRoom = useMemo(() => {
    if (compact || readOnly) return null;
    const r = headerReserve(40);
    return isRTL ? { left: r.end, right: r.start } : { left: r.start, right: r.end };
  }, [compact, readOnly]);
  const frameInsets: Insets = useMemo(() => (phoneDock ? { ...insets, bottom: 0 } : insets), [phoneDock, insets]);
  const frames = useMemo(
    () =>
      editorFrames({
        screen: frameScreen,
        insets: frameInsets,
        toolbarPos: readOnly ? 'top' : settings.toolbarPos,
        barThickness: readOnly ? 0 : barThickness(compact ? BAR.compactButton : BAR.button),
        dock: dockSpec,
        headerReserve: headerRoom,
      }),
    [frameScreen, frameInsets, readOnly, settings.toolbarPos, compact, dockSpec, headerRoom],
  );

  // Read-only banner (measured, so the page starts under it).
  const [bannerH, setBannerH] = useState(0);
  const contentInsets = useMemo(() => {
    const c = frames.canvasInsets;
    return {
      top: c.top + (readOnly && bannerH > 0 ? bannerH + OVER_GAP : 0),
      bottom: c.bottom + panelH,
      left: c.left,
      right: c.right,
    };
  }, [frames.canvasInsets, readOnly, bannerH, panelH]);

  const dockLeft = !!frames.dock && frames.dock.x === 0;
  const dockRight = !!frames.dock && frames.dock.x > 0;
  /** Physical offsets of the page area's side edges (the dock's inner edge, or the safe inset). */
  const sideLeft = dockLeft && frames.dock ? frames.dock.width : insets.left;
  const sideRight = dockRight && frames.dock ? frames.dock.width : insets.right;
  const dockFrame: Rect | null = useMemo(() => {
    if (phoneDock) return { x: 0, y: H - panelH, width: W, height: panelH };
    if (!frames.dock) return null;
    // Full height: from the very top of the editor to the bottom.
    return { x: frames.dock.x, y: 0, width: frames.dock.width, height: H };
  }, [phoneDock, H, W, panelH, frames.dock]);
  const dockPad = phoneDock
    ? { bottom: insets.bottom, left: insets.left, right: insets.right }
    : { top: insets.top, bottom: insets.bottom, left: dockLeft ? insets.left : 0, right: dockRight ? insets.right : 0 };

  /** Distance from the box bottom to the bottom of the footer band (the pills sit in it). */
  const footerBase = phoneDock ? panelH : insets.bottom;
  const footerBottom = footerBase + (FRAME.footer - FOOTER_PILL_H) / 2;
  /** Banners and the player bar sit above the footer band, or above a bottom toolbar. */
  const overBottom =
    (frames.pos === 'bottom' && !readOnly ? H - frames.toolbar.y : footerBase + FRAME.footer) + OVER_GAP;
  /** The player bar's height: a 'continue recording' banner sits above an open bar, not under it. */
  const [playerH, setPlayerH] = useState(0);
  const overSides = physicalSides(frames.canvasInsets.left + (compact ? 12 : 32), frames.canvasInsets.right + (compact ? 12 : 32));

  // ----- page and zoom
  const [page, setPage] = useState<{ index: number; id: Id | null }>({ index: 0, id: notebook.pageIds[0] ?? null });
  const [scale, setScale] = useState(1);
  const notePage = life.notePage;
  const onPageChange = useCallback(
    (index: number, pageId: Id) => {
      setPage((p) => (p.index === index && p.id === pageId ? p : { index, id: pageId }));
      notePage(pageId);
    },
    [notePage],
  );
  const onZoomChange = useCallback((s: number) => setScale(s), []);
  const currentPage = usePage(session, page.id);
  const paperColor = paperColorOf(currentPage);

  // ----- auto page: writing on the last paper page adds the next page
  const lastId = notebook.pageIds[notebook.pageIds.length - 1] ?? null;
  const lastPage = usePage(session, lastId);
  useEffect(() => {
    if (readOnly || !lastPage || lastPage.id !== lastId || !needsAutoPage(lastPage)) return;
    const ids = session.notebook.pageIds;
    if (ids[ids.length - 1] !== lastPage.id) return;
    session.insertPages(ids.length, [autoPageAfter(lastPage, newId())], { history: false });
  }, [readOnly, session, lastPage, lastId]);

  // ----- tools
  const editorTools = useToolPlugins(session, getCanvas, settings.hand, { rulerHintTop: contentInsets.top + 12 });
  const playback = usePlaybackFlow(session);
  const canvasInput: CanvasInput = useMemo(
    () => ({
      input: settings.input,
      fingerDraws: settings.fingerDraws,
      hand: settings.hand,
      pencilDoubleTap: settings.pencilDoubleTap,
      pencilSqueeze: settings.pencilSqueeze,
      // Hold-to-snap was removed: a pen stroke always stays as drawn.
      shapeSnap: false,
    }),
    [settings.input, settings.fingerDraws, settings.hand, settings.pencilDoubleTap, settings.pencilSqueeze],
  );
  const onUndo = useCallback(() => {
    if (!session.readOnly) session.undo();
  }, [session]);
  const onRedo = useCallback(() => {
    if (!session.readOnly) session.redo();
  }, [session]);
  const onToggleCalc = useCallback(() => setSettings((s) => ({ calc: { open: !s.calc.open } })), [setSettings]);
  const recordTarget = useTourTarget('ed.record');
  const recordSlot = useMemo(
    () => (
      <View ref={recordTarget} collapsable={false}>
        <RecordButton session={session} />
      </View>
    ),
    [recordTarget, session],
  );

  // ----- header actions
  const [exportOpen, setExportOpen] = useState(false);
  const [more, setMore] = useState<AnchorRect | null>(null);
  const flushNow = life.flushNow;
  const onBack = useCallback(() => {
    flushNow();
    goBackOr(openLibrary);
  }, [flushNow]);
  const onPages = useCallback(() => {
    openPages(session.id, { current: page.id ?? undefined });
  }, [session, page.id]);
  const onMoreAction = useCallback(
    (a: EditorMoreAction) => {
      if (a === 'recordings') playback.openPanel();
      else if (a === 'settings') openNotebookSettings();
      else if (a === 'addPage' && !session.readOnly) {
        const id = session.addPage(page.id ?? 'end');
        // Once the canvas has laid the new page out, go there (useEditorLifecycle's onJump scrolls).
        setTimeout(() => session.requestJump(id), 60);
      }
    },
    [playback, session, page.id],
  );

  // ----- deferred panels (PRD9 open time: the first page first)
  const [panelsReady, setPanelsReady] = useState(false);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setPanelsReady(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);
  const [setupDone, setSetupDone] = useState(false);
  const onSetupDone = useCallback(() => setSetupDone(true), []);
  const onTourDone = useCallback(() => {}, []);
  const backupFlow = useEnableBackupFlow();

  const counterPlace = isRTL ? physicalRight(sideRight + FOOTER_SIDE) : physicalLeft(sideLeft + FOOTER_SIDE);
  const zoomPlace = isRTL ? physicalLeft(sideLeft + FOOTER_SIDE) : physicalRight(sideRight + FOOTER_SIDE);
  const panelPlace = compact
    ? [{ top: contentInsets.top + 8, maxHeight: Math.max(160, H * 0.5) }, physicalSides(insets.left + 12, insets.right + 12)]
    : [
        { top: contentInsets.top + 10, maxHeight: Math.max(200, H - contentInsets.top - overBottom - (playback.barOpen ? 120 : 20)) },
        isRTL ? physicalLeft(frames.canvasInsets.left + 16) : physicalRight(frames.canvasInsets.right + 16),
      ];

  return (
    <View style={styles.root} onLayout={onLayout}>
      <View style={StyleSheet.absoluteFill}>
        <PageCanvas
          ref={canvasRef}
          session={session}
          tools={tools}
          input={canvasInput}
          recMark={editorTools.recMark}
          playback={playback.playback}
          toolHandlers={editorTools.toolHandlers}
          onPlayFrom={playback.onPlayFrom}
          onUndo={onUndo}
          onRedo={onRedo}
          onPageChange={onPageChange}
          onZoomChange={onZoomChange}
          onPencilAction={editorTools.onPencilAction}
          overlays={editorTools.overlays}
          contentInsets={contentInsets}
        />
      </View>

      {readOnly ? (
        <View
          style={[styles.abs, { top: insets.top + FRAME.header }, physicalSides(sideLeft + 16, sideRight + 16)]}
          onLayout={(e) => setBannerH(Math.round(e.nativeEvent.layout.height))}>
          <InfoBanner
            tone="warn"
            icon="lock"
            text={tr(
              'أُنشئت هذه المذكرة بإصدار أحدث من التطبيق. حدّث التطبيق لتعديلها.',
              'This notebook was made with a newer version of the app. Update the app to edit it.',
            )}
          />
        </View>
      ) : null}

      <PageCounter index={page.index} count={notebook.pageIds.length} onPress={onPages} style={[styles.abs, { bottom: footerBottom }, counterPlace]} />
      <ZoomPill scale={scale} onReset={() => canvasRef.current?.zoomTo(1)} style={[styles.abs, { bottom: footerBottom }, zoomPlace]} />

      {panelsReady ? (
        <View
          style={[styles.abs, { bottom: overBottom + (playback.barOpen && playerH > 0 ? playerH + OVER_GAP : 0) }, overSides]}
          pointerEvents="box-none">
          <ContinueRecordingBanner notebookId={session.id} onContinue={() => recorder.resume()} onFinish={() => recorder.stop()} />
        </View>
      ) : null}

      {panelsReady && playback.barOpen ? (
        <View
          style={[styles.abs, styles.playerRow, { bottom: overBottom }, overSides]}
          pointerEvents="box-none"
          onLayout={(e) => setPlayerH(Math.round(e.nativeEvent.layout.height))}>
          <PlayerBar
            onPointer={playback.onPointer}
            pointerActive={playback.pointerActive}
            onClose={playback.onCloseBar}
            onOpenList={playback.openPanel}
          />
        </View>
      ) : null}

      {panelsReady && playback.panelOpen ? (
        <View style={[styles.abs, ...panelPlace]} pointerEvents="box-none">
          <RecordingsPanel session={session} onLoad={playback.onLoad} onClose={playback.closePanel} style={styles.fill} />
        </View>
      ) : null}

      {panelsReady && calcOpen && calcDocked ? <CalculatorDock frame={dockFrame} pad={dockPad} /> : null}

      {readOnly ? null : (
        <View style={[styles.abs, physicalBox(0, 0, frameScreen.width, frameScreen.height)]} pointerEvents="box-none">
          <MovableToolbar
            pos={frames.pos}
            frame={frames.toolbar}
            screen={frameScreen}
            insets={frameInsets}
            dock={dockSpec}
            onUndo={onUndo}
            onRedo={onRedo}
            canUndo={snap?.canUndo ?? false}
            canRedo={snap?.canRedo ?? false}
            calcOpen={calcOpen}
            onToggleCalc={onToggleCalc}
            recordSlot={recordSlot}
            onImage={editorTools.openImage}
            paperColor={paperColor}
            compact={compact}
            hand={settings.hand}
          />
        </View>
      )}

      {panelsReady && calcOpen && !calcDocked ? <CalculatorDock frame={null} /> : null}

      <EditorHeader
        top={insets.top + (FRAME.header - (compact ? 36 : 40)) / 2}
        left={sideLeft}
        right={sideRight}
        onBack={onBack}
        onPages={onPages}
        onShare={() => setExportOpen(true)}
        onMore={setMore}
      />

      {editorTools.sheets}
      <EditorMoreMenu
        visible={!!more}
        anchor={more}
        onClose={() => setMore(null)}
        onAction={onMoreAction}
        recordingCount={notebook.recordings.length}
        readOnly={readOnly}
      />
      {panelsReady ? (
        <ExportSheet visible={exportOpen} session={session} currentIndex={page.index} onClose={() => setExportOpen(false)} />
      ) : null}
      {panelsReady ? <SetupModal onDone={onSetupDone} enableBackup={backupFlow.start} backupUi={backupFlow.ui} isTablet={!compact} /> : null}
      {panelsReady && !readOnly ? (
        <EditorTour onDone={onTourDone} enabled={setupDone && !exportOpen && !more && !playback.panelOpen} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: nbColors.canvas, overflow: 'hidden' },
  abs: { position: 'absolute' },
  center: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  round: { backgroundColor: nbColors.surface, ...shadow },
  playerRow: { alignItems: 'center' },
  fill: { flexShrink: 1 },
});
