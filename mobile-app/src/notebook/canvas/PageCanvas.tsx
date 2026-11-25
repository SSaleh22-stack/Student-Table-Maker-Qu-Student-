/**
 * PageCanvas (P22): the notebook's pages in one vertically scrolling, zoomable column (NB-49), with
 * ink, highlighter, eraser, hold-to-snap, the ruler, multi-finger undo / redo, the Pencil and
 * playback dimming. Contract: contracts/canvas.ts (PageCanvasProps, PageCanvasHandle via `ref`).
 *
 * STRUCTURE
 * - ONE Skia <Canvas opaque> (explicitly opaque, so Android backs it with a SurfaceView, the cheapest
 *   path). A <Group transform> holds the view transform (scale, tx, ty shared values written by the
 *   gestures on the UI runtime).
 * - PageLayer for the visible pages +-1 only (virtualized; their images are pinned under the 48 MB
 *   budget while mounted). Pages +-2 are loaded ahead. Background first: the paper fill shows before
 *   the pictures are built (PRD9-open-time).
 * - The wet ink (wetInk.ts, frozen path plus tail, built on the UI runtime from every pointer event:
 *   PRD9-ink-latency) and the dashed snap preview are drawn over the pages; the hold ring in screen
 *   space at the pen tip.
 * - The `overlays` prop renders in OverlayHost as SIBLING views above the canvas (pointerEvents
 *   'box-none') inside the OverlayContext provider (ruling (p)).
 * - Gestures: gestures.ts (the thread boundary is documented there). The JS side of every stroke is the
 *   bridge below: commitStroke creates the ids, adds the stroke and THEN hands a snap to onShapeSnap
 *   (ruling (g)); the wet ink is cleared only once the page picture containing the stroke is on
 *   screen (two frames after PageLayer reports it), so the ink never blinks.
 *
 * DEVICE CHECKLIST (P30 consolidates it; not testable in Node):
 * - Palm first: rest the palm, then write with the Pencil / S Pen: ink follows the pen, the palm
 *   leaves no ink and does not scroll.
 * - Pen first, then the palm lands mid-stroke: one continuous line, never cancelled or split.
 * - Palm during a stroke dragged across the page: the stroke continues, the page does not move.
 * - Right after a pen lift, the side of the hand touching below / beside the last point (hand side)
 *   neither scrolls nor draws for 300 ms; a finger elsewhere scrolls at once.
 * - Finger mode (phone): one finger draws; two fingers landing together scroll / zoom with no ink dot
 *   left behind; a two-finger tap undoes, a three-finger tap redoes.
 * - Two fingers starting on the ruler move it and neither zoom nor undo. overlayBusy (a selection
 *   handle held) blocks drawing.
 * - Hold-to-snap: a 500 ms still hold shows the ring and the dashed preview, swaps the stroke for the
 *   shape with the pen still down, and the ring hides at once; moving after the swap adds no ink;
 *   lifting before 500 ms keeps the stroke; with the snap switch off no ring appears. The highlighter
 *   hold straightens the stroke and never snaps.
 * - 4000-point strokes: the stroke continues seamlessly across the automatic split.
 * - Zoom to 400 % on a PDF page: tiles sharpen after the view settles; the budget stays <= 48 MB.
 * - Android: no black flash or misplaced canvas while the editor route fades in and out (the
 *   SurfaceView of the opaque canvas during the transition); rotate the tablet mid-stroke.
 * - Apple Pencil double tap / squeeze follow the notebook settings (eraser, last tool, off).
 * - Playback: ink after the current moment is dimmed and catches up as the audio plays.
 */
import { Canvas, Circle, DashPathEffect, Fill, Group, Paint, Path, type Transforms3d } from '@shopify/react-native-skia';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type Ref } from 'react';
import { AppState, PixelRatio, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useAnimatedReaction, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import type { PageCanvasComponent, PageCanvasHandle, PageCanvasProps } from '@/notebook/contracts/canvas';
import { holdSignal } from '@/notebook/canvas/holdSignal';
import { getSelection } from '@/notebook/canvas/selection';
import { computeLayout, layoutCount, layoutScale, pageRect, LAYOUT_HEADER } from '@/notebook/core/canvas/layout';
import { currentPage, visiblePages, type Viewport, type ViewSize } from '@/notebook/core/canvas/viewport';
import type { PagePoint, ShapeSnapEvent, ToolId, ToolPointerHandler } from '@/notebook/core/contracts/tools';
import { eraseItems } from '@/notebook/core/ink/erase';
import { itemsIntersectingSegment, nearestItemWithRec } from '@/notebook/core/ink/hittest';
import { PAGE_SIZES, newId, type Id, type Page, type PaperColor, type RecMark, type Size, type StrokeItem } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { shapeName } from '@/notebook/core/shapes/names';
import { toShapeItem } from '@/notebook/core/shapes/recognize';
import { effectivePenColor } from '@/notebook/core/toolbar/colors';
import { HIGHLIGHTER_ALPHA, trimImageBudget, useNotebookFonts } from '@/notebook/ink';
import { useSessionSnapshot } from '@/notebook/store/hooks';
import { nbColors } from '@/notebook/theme';

import { DEFAULT_GESTURE_CONFIG, useCanvasGestures, type CanvasJsApi, type EraseCommit, type EraseProbe, type ForwardKind, type GestureConfig, type StrokeCommit } from './gestures';
import { OverlayHost } from './OverlayHost';
import { PageLayer } from './PageLayer';
import { useMirrorStore, usePageMirrors } from './pageMirror';
import { usePencilActions, usePencilOnlyPreference } from './pencil';
import { usePlaybackDim } from './playback';
import type { SettledView } from './tiles';
import { applyLayout, insetsOf, useCanvasCore, useCanvasHandle, useOverlayValue, viewOf, viewportOf, type CanvasCore } from './useCanvasApi';
import { clearEraserPath, clearShapePreview, clearWet, useWetInk, type WetInk } from './wetInk';

/** If a page picture never reports (page unmounted, write ignored), the wet ink still goes after this. */
const WET_CLEAR_FALLBACK_MS = 1200;
/** Hold ring (Figma 36): radius, stroke, track and fill colours (screen px). */
const RING_R = 24;
const RING_W = 6;
const RING_TRACK = nbColors.accentSoft ?? '#DDF0F4';
const RING_PATH = `M 0 ${-RING_R} A ${RING_R} ${RING_R} 0 1 1 0 ${RING_R} A ${RING_R} ${RING_R} 0 1 1 0 ${-RING_R}`;
/** Snap preview (Figma 36): accent stroke 2 px, dashes 9 / 7 px, accent fill at 0.06. */
const PREVIEW_STROKE_PX = 2;
const PREVIEW_DASH_PX = [9, 7];
const PREVIEW_FILL_OPACITY = 0.06;

const EMPTY_IDS: readonly string[] = Object.freeze([]);
const hidden = getSelection().hidden;

// ===== small worklets for the JS -> UI hops

function addHidden(ids: string[]): void {
  'worklet';
  if (ids.length === 0) return;
  hidden.set(hidden.get().concat(ids));
}

function removeHidden(ids: string[]): void {
  'worklet';
  if (ids.length === 0) return;
  hidden.set(hidden.get().filter((id) => ids.indexOf(id) < 0));
}

function pageTransformOf(l: number[], i: number): Transforms3d {
  'worklet';
  const r = pageRect(l, i);
  if (!r) return [{ translateX: 0 }, { translateY: 0 }, { scale: 0 }];
  return [{ translateX: r[0] }, { translateY: r[1] }, { scale: layoutScale(l) }];
}

// ===== page sizes (pages that are not loaded yet are laid out with the nearest known size)

interface PageInfo {
  w: number;
  h: number;
  dark: boolean;
}

interface InfoStore {
  get(): ReadonlyMap<Id, PageInfo>;
  subscribe(cb: () => void): () => void;
  record(page: Page | undefined): void;
}

function paperOf(page: Page): PaperColor {
  return page.background.kind === 'pdf' ? 'white' : page.background.paper.color;
}

function createInfoStore(): InfoStore {
  let snap: ReadonlyMap<Id, PageInfo> = new Map();
  const listeners = new Set<() => void>();
  return {
    get: () => snap,
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    record(page) {
      if (!page) return;
      const dark = paperOf(page) === 'dark';
      const prev = snap.get(page.id);
      if (prev && prev.w === page.size.w && prev.h === page.size.h && prev.dark === dark) return;
      const next = new Map(snap);
      next.set(page.id, { w: page.size.w, h: page.size.h, dark });
      snap = next;
      for (const cb of [...listeners]) cb();
    },
  };
}

/** Page sizes in layout order: a page not loaded yet takes the size of the nearest known page before it (else the first known, else the notebook default). */
function layoutSizes(pageIds: readonly Id[], info: ReadonlyMap<Id, PageInfo>, fallback: Size): Size[] {
  let carry: Size | null = null;
  for (const id of pageIds) {
    const i = info.get(id);
    if (i) {
      carry = { w: i.w, h: i.h };
      break;
    }
  }
  const out: Size[] = [];
  for (const id of pageIds) {
    const i = info.get(id);
    if (i) carry = { w: i.w, h: i.h };
    out.push(carry ?? fallback);
  }
  return out;
}

// ===== the JS bridge (stable functions the worklets call through scheduleOnRN)

interface Latest {
  session: NotebookSession;
  pageIds: readonly Id[];
  recMark?: () => RecMark | undefined;
  toolHandlers?: Partial<Record<ToolId, ToolPointerHandler>>;
  onShapeSnap?: (e: ShapeSnapEvent) => void;
  onPlayFrom?: (mark: RecMark) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPageChange?: (index: number, pageId: Id) => void;
  onZoomChange?: (scale: number) => void;
}

interface ViewRange {
  first: number;
  last: number;
  cur: number;
}

interface Pending {
  kind: 'wet' | 'eraser' | 'shape';
  seq: number;
  pageId: Id;
  version: number;
  timer: ReturnType<typeof setTimeout>;
}

interface Bridge {
  api: CanvasJsApi;
  setLatest(l: Latest): void;
  onShown(pageId: Id, version: number): void;
  onView(first: number, last: number, cur: number): void;
  onZoom(scale: number): void;
  view(): ViewRange;
  dispose(): void;
}

function createBridge(wet: WetInk, setRange: (r: ViewRange) => void): Bridge {
  let L: Latest | null = null;
  let range: ViewRange = { first: 0, last: 0, cur: 0 };
  /** The page last reported to onPageChange (none yet at open). */
  let reported: { cur: number; id: Id | null } = { cur: -1, id: null };
  let pending: Pending[] = [];
  let jsErase: { seq: number; ids: Set<string> } = { seq: -1, ids: new Set() };

  const clearNow = (kind: Pending['kind'], seq: number) => {
    if (kind === 'wet') scheduleOnUI(clearWet, wet, seq);
    else if (kind === 'shape') scheduleOnUI(clearShapePreview, wet);
    else scheduleOnUI(clearEraserPath, wet);
  };
  // Two frames after the picture was committed it is on screen; then the wet ink can go.
  const clearSoon = (kind: Pending['kind'], seq: number) => {
    requestAnimationFrame(() => requestAnimationFrame(() => clearNow(kind, seq)));
  };
  const resolve = (p: Pending) => {
    clearTimeout(p.timer);
    pending = pending.filter((q) => q !== p);
    clearSoon(p.kind, p.seq);
  };
  const addPending = (kind: Pending['kind'], seq: number, pageId: Id, version: number) => {
    const p: Pending = { kind, seq, pageId, version, timer: setTimeout(() => resolve(p), WET_CLEAR_FALLBACK_MS) };
    pending.push(p);
  };

  const commitStroke = (c: StrokeCommit) => {
    const l = L;
    if (!l || l.session.readOnly || c.pts.length < 3) {
      clearNow('wet', c.seq);
      return;
    }
    const s = l.session;
    const rec = l.recMark ? l.recMark() : undefined;
    const at = Date.now();
    const id = newId();
    const item: StrokeItem = { id, kind: 'stroke', tool: c.tool, color: c.color, width: c.width, pressure: c.pressure, pts: c.pts, at };
    if (rec) item.rec = rec;
    const entryId = s.addItems(c.pageId, [item], c.straight ? 'straight-line' : 'stroke');
    if (!entryId) {
      clearNow('wet', c.seq);
      return;
    }
    if (!c.snap) {
      addPending('wet', c.seq, c.pageId, s.pageVersion(c.pageId));
      return;
    }
    // Ruling (g): the hand-drawn stroke is history entry 1; the receiver replaces it (entry 2).
    if (l.onShapeSnap) {
      const shape = toShapeItem(c.snap, { color: c.color, width: c.width }, newId(), rec, at);
      l.onShapeSnap({ pageId: c.pageId, strokeId: id, strokeEntryId: entryId, shape, name: shapeName(c.snap) });
    }
  };

  const eraseOnJs = (p: EraseProbe) => {
    const l = L;
    if (!l) return;
    if (jsErase.seq !== p.seq) jsErase = { seq: p.seq, ids: new Set() };
    const page = l.session.getPage(p.pageId);
    if (!page) return;
    const fresh: string[] = [];
    const n = Math.floor(p.path.length / 2);
    for (let i = 0; i < Math.max(1, n - 1); i++) {
      const a = Math.min(i, n - 1) * 2;
      const b = Math.min(i + 1, n - 1) * 2;
      const ids = itemsIntersectingSegment(page.items, p.path[a], p.path[a + 1], p.path[b], p.path[b + 1], p.radius, { highlighterOnly: p.highlighterOnly });
      for (const id of ids) {
        if (jsErase.ids.has(id)) continue;
        jsErase.ids.add(id);
        fresh.push(id);
      }
    }
    if (fresh.length) scheduleOnUI(addHidden, fresh);
  };

  const commitErase = (c: EraseCommit) => {
    const l = L;
    if (c.mode === 'stroke') {
      const ids = new Set(c.ids);
      if (jsErase.seq === c.seq) for (const id of jsErase.ids) ids.add(id);
      jsErase = { seq: -1, ids: new Set() };
      const list = [...ids];
      // One history entry for the whole eraser stroke.
      if (l && list.length) l.session.removeItems(c.pageId, list, 'erase');
      if (list.length) scheduleOnUI(removeHidden, list);
      return;
    }
    const page = l ? l.session.getPage(c.pageId) : undefined;
    if (!l || !page || c.path.length < 2) {
      clearNow('eraser', c.seq);
      return;
    }
    const r = eraseItems(page.items, c.path, c.radius, { mode: 'pixel', highlighterOnly: c.highlighterOnly, newId: () => newId() });
    const entry = r.removeIds.length || r.add.length ? l.session.replaceItems(c.pageId, r.removeIds, r.add, 'erase') : '';
    if (entry) addPending('eraser', c.seq, c.pageId, l.session.pageVersion(c.pageId));
    else clearNow('eraser', c.seq);
  };

  const forward = (kind: ForwardKind, tool: ToolId, p: PagePoint, cancelled: boolean) => {
    const h = L && L.toolHandlers ? L.toolHandlers[tool] : undefined;
    if (!h) return;
    if (kind === 'begin') h.onBegin?.(p);
    else if (kind === 'update') h.onUpdate?.(p);
    else if (kind === 'end') {
      const before = L ? L.session.pageVersion(p.pageId) : 0;
      h.onEnd?.(p, cancelled);
      if (tool === 'shapes') {
        // The live preview (drawn by the gesture) stays until the new shape's picture is on screen.
        const after = L ? L.session.pageVersion(p.pageId) : 0;
        if (cancelled || after === before) clearNow('shape', 0);
        else addPending('shape', 0, p.pageId, after);
      }
    }
    else if (kind === 'tap') h.onTap?.(p);
    else h.onLongPress?.(p);
  };

  const playAt = (pageId: string, x: number, y: number, maxDist: number) => {
    const l = L;
    const page = l ? l.session.getPage(pageId) : undefined;
    if (!l || !page) return;
    const item = nearestItemWithRec(page.items, x, y, maxDist);
    if (item && item.rec) l.onPlayFrom?.({ recordingId: item.rec.recordingId, ms: item.rec.ms });
  };

  const api: CanvasJsApi = {
    commitStroke,
    commitErase,
    eraseOnJs,
    forward,
    playAt,
    undo: () => L?.onUndo(),
    redo: () => L?.onRedo(),
  };

  return {
    api,
    setLatest(l) {
      L = l;
    },
    onShown(pageId, version) {
      for (const p of [...pending]) if (p.pageId === pageId && p.version <= version) resolve(p);
    },
    onView(first, last, cur) {
      const prev = range;
      range = { first, last, cur };
      if (prev.first !== first || prev.last !== last || prev.cur !== cur) setRange(range);
      // Reported by page id too, so the first page is reported at open and a page that took the
      // current index (insert, delete, move) is reported as well.
      const id = cur >= 0 && L ? L.pageIds[cur] : undefined;
      if (L && id !== undefined && (cur !== reported.cur || id !== reported.id)) {
        reported = { cur, id };
        L.onPageChange?.(cur, id);
      }
    },
    onZoom(scale) {
      L?.onZoomChange?.(scale);
    },
    view: () => range,
    dispose() {
      for (const p of pending) clearTimeout(p.timer);
      pending = [];
    },
  };
}

// ===== wet ink and hold ring (inside the Canvas)

function WetLayer({ core, wet, hlLayer }: { core: CanvasCore; wet: WetInk; hlLayer: boolean }) {
  const liveT = useDerivedValue(() => pageTransformOf(core.layout.get(), wet.page.get()));
  const ghostT = useDerivedValue(() => pageTransformOf(core.layout.get(), wet.ghostPage.get()));
  const shapeT = useDerivedValue(() => pageTransformOf(core.layout.get(), wet.shapePage.get()));
  const shapeOn = useDerivedValue(() => (wet.shapePage.get() >= 0 ? 1 : 0));
  const livePen = useDerivedValue(() => (wet.tool.get() === 'pen' ? 1 : 0));
  const liveHl = useDerivedValue(() => (wet.tool.get() === 'highlighter' ? 1 : 0));
  const ghostPen = useDerivedValue(() => (wet.ghostTool.get() === 'pen' ? 1 : 0));
  const ghostHl = useDerivedValue(() => (wet.ghostTool.get() === 'highlighter' ? 1 : 0));
  // The dashed preview keeps its screen size at any zoom.
  const previewW = useDerivedValue(() => PREVIEW_STROKE_PX / Math.max(1e-6, layoutScale(core.layout.get()) * core.scale.get()));
  const dash = useDerivedValue(() => {
    const z = Math.max(1e-6, layoutScale(core.layout.get()) * core.scale.get());
    return [PREVIEW_DASH_PX[0] / z, PREVIEW_DASH_PX[1] / z];
  });
  const hlPaint = hlLayer ? <Paint opacity={HIGHLIGHTER_ALPHA} /> : false;
  const hlOpacity = hlLayer ? 1 : HIGHLIGHTER_ALPHA;
  return (
    <>
      <Group transform={ghostT}>
        <Group opacity={ghostPen}>
          <Path path={wet.ghostFrozen} color={wet.ghostColor} />
          <Path path={wet.ghostTail} color={wet.ghostColor} />
        </Group>
        <Group layer={hlPaint} opacity={hlOpacity}>
          <Group opacity={ghostHl}>
            <Path path={wet.ghostFrozen} color={wet.ghostColor} />
            <Path path={wet.ghostTail} color={wet.ghostColor} />
          </Group>
        </Group>
      </Group>
      <Group transform={liveT}>
        <Group opacity={livePen}>
          <Path path={wet.frozen} color={wet.color} />
          <Path path={wet.tail} color={wet.color} />
        </Group>
        <Group layer={hlPaint} opacity={hlOpacity}>
          <Group opacity={liveHl}>
            <Path path={wet.frozen} color={wet.color} />
            <Path path={wet.tail} color={wet.color} />
          </Group>
        </Group>
        <Path path={wet.preview} color={nbColors.accent} opacity={PREVIEW_FILL_OPACITY} />
        <Path path={wet.preview} color={nbColors.accent} style="stroke" strokeWidth={previewW} strokeJoin="round">
          <DashPathEffect intervals={dash} />
        </Path>
      </Group>
      <Group transform={shapeT} opacity={shapeOn}>
        <Path path={wet.shape} color={wet.shapeColor} style="stroke" strokeWidth={wet.shapeWidth} strokeCap="round" strokeJoin="round" />
      </Group>
    </>
  );
}

function HoldRing({ ringOn }: { ringOn: SharedValue<boolean> }) {
  const t = useDerivedValue(() => [{ translateX: holdSignal.sx.get() }, { translateY: holdSignal.sy.get() }]);
  const opacity = useDerivedValue(() => (ringOn.get() ? 1 : 0));
  const end = useDerivedValue(() => Math.min(1, Math.max(0, holdSignal.progress.get())));
  return (
    <Group transform={t} opacity={opacity}>
      <Circle cx={0} cy={0} r={RING_R} style="stroke" strokeWidth={RING_W} color={RING_TRACK} />
      <Path path={RING_PATH} style="stroke" strokeWidth={RING_W} strokeCap="round" color={nbColors.accent} start={0} end={end} />
    </Group>
  );
}

// ===== the canvas

function PageCanvasImpl(props: PageCanvasProps & { ref?: Ref<PageCanvasHandle> }) {
  const { session, tools, input, recMark, playback, toolHandlers, onShapeSnap, onPlayFrom, onUndo, onRedo, onPageChange, onZoomChange, onPencilAction, overlays, contentInsets, ref } = props;

  const core = useCanvasCore();
  const wet = useWetInk();
  const mirrors = useMirrorStore();
  const cfg = useSharedValue<GestureConfig>(DEFAULT_GESTURE_CONFIG);
  const dark = useSharedValue<number[]>([]);
  const overlayValue = useOverlayValue(core);
  const fonts = useNotebookFonts();
  const dimAfter = usePlaybackDim(playback);

  const snapshot = useSessionSnapshot(session);
  const notebook = snapshot ? snapshot.notebook : session.notebook;
  const pageIds = notebook.pageIds;
  const defaults = notebook.defaults;

  const { width: winW, height: winH } = useWindowDimensions();
  const screenLongPx = Math.round(Math.max(winW, winH) * PixelRatio.get());
  const [view, setView] = useState<ViewSize>({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setView((v) => (v.w === width && v.h === height ? v : { w: width, h: height }));
  }, []);

  const [range, setRange] = useState<ViewRange>({ first: 0, last: 0, cur: 0 });
  const [bridge] = useState(() => createBridge(wet, setRange));
  useEffect(() => () => bridge.dispose(), [bridge]);
  useLayoutEffect(() => {
    bridge.setLatest({ session, pageIds, recMark, toolHandlers, onShapeSnap, onPlayFrom, onUndo, onRedo, onPageChange, onZoomChange });
  });

  // ---- Pencil (NB-52)
  const [pencilOnly, setPencilOnly] = useState(false);
  usePencilOnlyPreference(setPencilOnly);
  usePencilActions(input.pencilDoubleTap, input.pencilSqueeze, onPencilAction);

  // ---- the props the gestures read
  const penColor = tools.pen.color;
  const penColorDark = useMemo(() => effectivePenColor(penColor, 'dark'), [penColor]);
  useEffect(() => {
    cfg.set({
      tool: tools.tool,
      readOnly: session.readOnly,
      input: input.input,
      fingerDraws: input.fingerDraws,
      hand: input.hand,
      shapeSnap: input.shapeSnap && tools.shapeSnap,
      pencilOnly,
      penColor,
      penColorDark,
      penWidth: tools.pen.width,
      pressure: tools.pressure,
      hlColor: tools.highlighter.color,
      hlWidth: tools.highlighter.width,
      hlStraight: tools.highlighter.straight,
      eraserMode: tools.eraser.mode,
      eraserHlOnly: tools.eraser.highlighterOnly,
      eraserSize: tools.eraser.size,
      shapeKind: tools.shapeKind,
    });
  }, [
    cfg,
    tools.tool,
    tools.shapeKind,
    session.readOnly,
    input.input,
    input.fingerDraws,
    input.hand,
    input.shapeSnap,
    tools.shapeSnap,
    pencilOnly,
    penColor,
    penColorDark,
    tools.pen.width,
    tools.pressure,
    tools.highlighter.color,
    tools.highlighter.width,
    tools.highlighter.straight,
    tools.eraser.mode,
    tools.eraser.highlighterOnly,
    tools.eraser.size,
  ]);

  // "Play from here" only reads the page, so it also works in a read-only notebook.
  const { gesture, ringOn } = useCanvasGestures(core, wet, mirrors, cfg, dark, bridge.api, tools.tool === 'play');

  // ---- layout (JS): every page in one column; unknown sizes borrow the nearest known size
  const [infoStore] = useState(createInfoStore);
  const info = useSyncExternalStore(infoStore.subscribe, infoStore.get, infoStore.get);
  const defaultSize: Size = PAGE_SIZES[defaults.size] ?? PAGE_SIZES.a4;
  const sizes = useMemo(() => layoutSizes(pageIds, info, defaultSize), [pageIds, info, defaultSize]);
  const darkFlags = useMemo(() => pageIds.map((id) => ((info.get(id)?.dark ?? defaults.color === 'dark') ? 1 : 0)), [pageIds, info, defaults.color]);
  const insetsArr = useMemo(
    () => [contentInsets.top, contentInsets.bottom, contentInsets.left, contentInsets.right],
    [contentInsets.top, contentInsets.bottom, contentInsets.left, contentInsets.right],
  );
  const layout = useMemo(
    () => computeLayout(sizes, view.w, { top: insetsArr[0], bottom: insetsArr[1], left: insetsArr[2], right: insetsArr[3] }),
    [sizes, view.w, insetsArr],
  );

  useEffect(() => {
    if (view.w <= 0 || view.h <= 0) return;
    scheduleOnUI(applyLayout, core, layout, pageIds.slice(), view.w, view.h, insetsArr);
  }, [core, layout, pageIds, view.w, view.h, insetsArr]);
  useEffect(() => {
    dark.set(darkFlags);
  }, [dark, darkFlags]);

  // ---- the visible range, the current page and the zoom (UI -> JS)
  const onView = bridge.onView;
  const onZoom = bridge.onZoom;
  useAnimatedReaction(
    () => {
      const l = core.layout.get();
      const v = viewOf(core);
      if (v.w <= 0 || layoutCount(l) === 0) return [-1, -1, -1];
      const vp = viewportOf(core);
      const r = visiblePages(l, vp, v);
      return [r[0], r[1], currentPage(l, vp, v, insetsOf(core))];
    },
    (cur, prev) => {
      if (prev && cur[0] === prev[0] && cur[1] === prev[1] && cur[2] === prev[2]) return;
      if (cur[2] < 0) return;
      scheduleOnRN(onView, cur[0], cur[1], cur[2]);
    },
    [core, onView],
  );
  useAnimatedReaction(
    () => Math.round(core.scale.get() * 100),
    (cur, prev) => {
      if (cur !== prev) scheduleOnRN(onZoom, cur / 100);
    },
    [core, onZoom],
  );

  // ---- the settled view (PDF tiles load only when nothing moves)
  const [settledVp, setSettledVp] = useState<{ moving: boolean; vp: Viewport; view: ViewSize } | null>(null);
  const reportSettled = useCallback((moving: boolean, scale: number, tx: number, ty: number, w: number, h: number) => {
    setSettledVp({ moving, vp: { scale, tx, ty }, view: { w, h } });
  }, []);
  useAnimatedReaction(
    () => (core.moving.get() ? [1, 0, 0, 0, 0, 0] : [0, core.scale.get(), core.tx.get(), core.ty.get(), core.viewW.get(), core.viewH.get()]),
    (cur, prev) => {
      if (prev && cur.every((v, i) => v === prev[i])) return;
      scheduleOnRN(reportSettled, cur[0] === 1, cur[1], cur[2], cur[3], cur[4], cur[5]);
    },
    [core, reportSettled],
  );
  const settled: SettledView | null = useMemo(
    () => (settledVp && !settledVp.moving ? { vp: settledVp.vp, view: settledVp.view, layout, pixelRatio: PixelRatio.get(), settled: true } : null),
    [settledVp, layout],
  );

  // ---- hidden ids (selection.hidden, UI -> JS)
  const [hiddenKey, setHiddenKey] = useState('');
  useAnimatedReaction(
    () => hidden.get().join('|'),
    (cur, prev) => {
      if (cur !== prev) scheduleOnRN(setHiddenKey, cur);
    },
    [],
  );
  const hiddenIds = useMemo(() => (hiddenKey ? hiddenKey.split('|') : EMPTY_IDS), [hiddenKey]);

  // ---- virtualization: mount the visible pages +-1, load +-2
  const n = pageIds.length;
  const first = range.first >= 0 ? Math.min(range.first, n - 1) : 0;
  const last = range.last >= 0 ? Math.min(Math.max(range.last, first), n - 1) : Math.min(1, n - 1);
  const mountLo = Math.max(0, first - 1);
  const mountHi = Math.min(n - 1, last + 1);
  const mountedIds = useMemo(() => (n > 0 ? pageIds.slice(mountLo, mountHi + 1) : []), [pageIds, n, mountLo, mountHi]);
  const loadKey = n > 0 ? pageIds.slice(Math.max(0, first - 2), Math.min(n - 1, last + 2) + 1).join('|') : '';

  useEffect(() => {
    if (!loadKey) return undefined;
    const ids = loadKey.split('|');
    let alive = true;
    const offs = ids.map((id) => {
      const page = session.getPage(id);
      if (page) infoStore.record(page);
      else {
        session
          .loadPage(id)
          .then((p) => {
            if (alive) infoStore.record(p);
          })
          .catch(() => undefined);
      }
      return session.subscribePage(id, () => infoStore.record(session.getPage(id)));
    });
    return () => {
      alive = false;
      for (const off of offs) off();
    };
  }, [session, loadKey, infoStore]);

  // Eraser mirrors for the mounted pages while the stroke eraser is the tool (NB-42).
  usePageMirrors(mirrors, session, mountedIds, tools.tool === 'eraser' && tools.eraser.mode === 'stroke' && !session.readOnly);

  // A memory warning drops every unpinned decoded image.
  useEffect(() => {
    const sub = AppState.addEventListener('memoryWarning', () => trimImageBudget());
    return () => sub.remove();
  }, []);

  // ---- the handle
  const handleDeps = useMemo(
    () => ({
      currentIndex: () => bridge.view().cur,
      visibleRange: () => {
        const r = bridge.view();
        return [r.first, r.last];
      },
    }),
    [bridge],
  );
  useCanvasHandle(ref, core, handleDeps);

  const viewTransform = useDerivedValue(() => [{ translateX: core.tx.get() }, { translateY: core.ty.get() }, { scale: core.scale.get() }]);
  const onShown = bridge.onShown;
  const pixelEraser = tools.tool === 'eraser' && tools.eraser.mode === 'pixel';
  const k = layoutScale(layout);
  const fallbackPaper: PaperColor = defaults.color;

  return (
    <View style={styles.root} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <Canvas style={StyleSheet.absoluteFill} opaque>
            <Fill color={nbColors.canvas} />
            {view.w > 0 && layoutCount(layout) > 0 ? (
              <Group transform={viewTransform}>
                {mountedIds.map((id, j) => {
                  const i = mountLo + j;
                  const b = LAYOUT_HEADER + i * 4;
                  return (
                    <PageLayer
                      key={id}
                      session={session}
                      pageId={id}
                      index={i}
                      x={layout[b]}
                      y={layout[b + 1]}
                      k={k}
                      fallbackSize={sizes[i] ?? defaultSize}
                      fallbackPaper={fallbackPaper}
                      fonts={fonts}
                      dimAfter={dimAfter}
                      hiddenIds={hiddenIds}
                      settled={settled}
                      isCurrent={i === range.cur}
                      screenLongPx={screenLongPx}
                      pixelEraser={pixelEraser}
                      eraserWidth={tools.eraser.size}
                      eraserPath={wet.eraser}
                      eraserPage={wet.eraserPage}
                      onShown={onShown}
                    />
                  );
                })}
                <WetLayer core={core} wet={wet} hlLayer={tools.tool === 'highlighter'} />
              </Group>
            ) : null}
            <HoldRing ringOn={ringOn} />
          </Canvas>
        </View>
      </GestureDetector>
      <OverlayHost value={overlayValue}>{overlays}</OverlayHost>
    </View>
  );
}

export const PageCanvas: PageCanvasComponent = PageCanvasImpl;

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: nbColors.canvas },
});
