/**
 * Canvas input (P22, NB-40 to NB-52): every gesture of the page canvas, composed as ONE simultaneous
 * gesture on the canvas view.
 *
 *   draw    useManualGesture with NO maxPointers. It locks to ONE pointer (the first that may draw,
 *           palm.ts shouldDraw) and ignores every other touch, so a palm landing mid-stroke never
 *           cancels the stroke. Pen, highlighter, eraser, and the forwarded lasso / shapes / text.
 *   stylus  a pan with minDistance 0 that only reads stylusData (pressure): manual gestures carry
 *           none (Phase 0 spike).
 *   nav     a pan (one or two fingers) plus a pinch, simultaneous: zoom 1 to 4 about the focal
 *           point, pan, fling. One finger pans only when that finger does not draw.
 *   taps    3-finger tap = redo, 2-finger tap = undo (exclusive, MULTI_TAP_MAX_MS), the play
 *           tool's one-finger tap and the text tool's one-finger tap (exclusive after them).
 *
 * ARBITRATION (ruling (p)):
 * - Every canvas gesture fails in onBegin while overlayBusy > 0 (an overlay gesture owns the touch).
 * - Nav and the undo / redo taps fail in onTouchesDown when the first two pointers both start on the
 *   ruler (RulerApi.hitTest): the ruler gesture (P28) owns those.
 * - While a stroke is live, nav ignores its updates and the taps do not fire. In finger mode a second
 *   finger within NAV_YIELD_MS of the first, before NAV_YIELD_PX of movement, cancels the stroke
 *   (nothing is committed) and nav takes over (two-finger scroll on phones).
 * - A stylus landing during a finger stroke takes over: the finger stroke is dropped and the stylus
 *   draws (palm-first on a canvas that has not seen the stylus yet).
 * - After a stylus lifts, touches inside palmZone (the hand side) are ignored for PALM_MS: they
 *   neither draw nor scroll.
 *
 * THREAD BOUNDARY (ruling (l)). Everything below marked 'worklet' runs on the UI runtime: the
 * gesture callbacks, coordinate transforms, wetStep (wetInk.ts), updateHold / tickHold,
 * recognizeShape (at 'holding' entry), the ruler projection, straighten and the eraser mirror hit
 * test. The ONLY ways back to JS are scheduleOnRN calls with plain payloads:
 *   commitStroke(StrokeCommit)    ONE call per stroke; on JS it makes the ids, calls addItems and, when
 *                                 snap is set, then onShapeSnap (ruling (g): stroke entry, then shape)
 *   commitErase(EraseCommit)      one removeItems / replaceItems per eraser stroke
 *   eraseOnJs(EraseProbe)         the 60 Hz JS hit test for pages above MIRROR_MAX_POINTS
 *   forward(kind, tool, point)    lasso / shapes / text handlers (60 Hz)
 *   playAt(...)                   the play tool
 *   undo() / redo()               the multi-finger taps
 *   setCandidate(...)             holdSignal (JS only)
 * No session method, newId or recMark is ever called from a worklet.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  GestureStateManager,
  PointerType,
  useExclusiveGestures,
  useManualGesture,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
  type ComposedGesture,
} from 'react-native-gesture-handler';
import { useFrameCallback, useSharedValue, withDecay, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { holdSignal, setCandidate } from '@/notebook/canvas/holdSignal';
import { isOverlayBusy } from '@/notebook/canvas/overlayContext';
import type { MirrorRecord } from '@/notebook/canvas/pageMirror';
import { getRuler, RULER_LENGTH, RULER_WIDTH } from '@/notebook/canvas/ruler';
import { getSelection } from '@/notebook/canvas/selection';
import { clampViewport, minZoomFor, screenToPage, screenToPageOf, translateBounds, zoomAbout } from '@/notebook/core/canvas/viewport';
import { layoutContentH, layoutContentW, layoutScale } from '@/notebook/core/canvas/layout';
import { mirrorHits } from '@/notebook/core/canvas/eraseMirror';
import { ignoreTouch, palmZone, pointerName, shouldDraw, yieldsToNav, type PointerName } from '@/notebook/core/canvas/palm';
import { beginPress, createPress, endPress, movePress, shouldForward, tickPress, MULTI_TAP_MAX_DIST, MULTI_TAP_MAX_MS, TAP_SLOP, type PressState } from '@/notebook/core/canvas/taps';
import type { PagePoint, ToolId } from '@/notebook/core/contracts/tools';
import { projectToRuler, rulerEdgeAt } from '@/notebook/core/ink/ruler';
import { straighten } from '@/notebook/core/ink/smooth';
import { createHoldState, holdTolerance, resetHold, tickHold, updateHold, type HoldState, type HoldUpdate } from '@/notebook/core/shapes/hold';
import { recognizeShape, type ShapeCandidate } from '@/notebook/core/shapes/recognize';

import { insetsOf, setViewport, stopMotion, viewOf, viewportOf, type CanvasCore } from './useCanvasApi';
import { shapeFromDrag, type ShapeDragKind } from '@/notebook/core/shapes/drag';

import { clearEraserPath, clearShapePreview, setEraserPath, setPreview, setShapePreview, wetAdd, wetBegin, wetDiscard, wetEnd, wetReplace, type WetInk, type WetStyle } from './wetInk';

// ===== tuning

/** A stroke may start this far (screen px) outside its page. */
export const PAGE_SLOP = 12;
/** A stroke starting this close (screen px) to a ruler edge is drawn along it. */
export const RULER_SNAP_PX = 24;
/** The play tool picks the nearest recorded item within this distance (screen px). */
export const PLAY_HIT_PX = 24;
/** The JS fallback hit test of the stroke eraser runs at most this often (ms, 60 Hz). */
export const JS_ERASE_INTERVAL_MS = 16;
/** The highlighter's straighten hold needs a stroke whose ends are at least this far apart (screen px). */
export const STRAIGHT_MIN_PX = 24;

// ===== payloads (plain data, safe for scheduleOnRN)

export interface StrokeCommit {
  pageId: string;
  /** wetInk stroke sequence: the wet ink of this stroke is cleared once its picture is on screen. */
  seq: number;
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  pressure: boolean;
  /** Flat x, y, p in page points. */
  pts: number[];
  /** The hold-to-snap candidate: commit the stroke, then hand it to onShapeSnap. */
  snap: ShapeCandidate | null;
  /** The highlighter hold straightened the stroke. */
  straight: boolean;
}

export interface EraseCommit {
  pageId: string;
  seq: number;
  mode: 'stroke' | 'pixel';
  /** Stroke mode: the ids hit on the UI runtime (the JS fallback adds its own). */
  ids: string[];
  /** Pixel mode: the eraser path, flat x, y page points. */
  path: number[];
  radius: number;
  highlighterOnly: boolean;
}

export interface EraseProbe {
  pageId: string;
  seq: number;
  /** Flat x, y page points: consecutive segments to test. */
  path: number[];
  radius: number;
  highlighterOnly: boolean;
}

export type ForwardKind = 'begin' | 'update' | 'end' | 'tap' | 'longPress';

/** The JS side of the canvas. Every function must be STABLE (worklets capture it). */
export interface CanvasJsApi {
  commitStroke(c: StrokeCommit): void;
  commitErase(c: EraseCommit): void;
  eraseOnJs(p: EraseProbe): void;
  forward(kind: ForwardKind, tool: ToolId, p: PagePoint, cancelled: boolean): void;
  playAt(pageId: string, x: number, y: number, maxDist: number): void;
  undo(): void;
  redo(): void;
}

/** The props the gestures read, mirrored into one shared value by the canvas. */
export interface GestureConfig {
  tool: ToolId;
  readOnly: boolean;
  input: 'pen' | 'finger';
  fingerDraws: boolean;
  hand: 'right' | 'left';
  /** input.shapeSnap and tools.shapeSnap. */
  shapeSnap: boolean;
  /** iOS "Only Draw with Apple Pencil": fingers never draw (like a stylus already seen). */
  pencilOnly: boolean;
  penColor: string;
  /** The pen colour on dark paper (core/toolbar/colors.ts effectivePenColor). */
  penColorDark: string;
  penWidth: number;
  pressure: boolean;
  hlColor: string;
  hlWidth: number;
  hlStraight: boolean;
  eraserMode: 'stroke' | 'pixel';
  eraserHlOnly: boolean;
  /** Eraser diameter in page points. */
  eraserSize: number;
  /** The shape tool's shape (its live preview is drawn on the UI runtime). */
  shapeKind: ShapeDragKind;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  tool: 'pen',
  readOnly: false,
  input: 'pen',
  fingerDraws: false,
  hand: 'right',
  shapeSnap: true,
  pencilOnly: false,
  penColor: '#1B2533',
  penColorDark: '#F1F5F9',
  penWidth: 3,
  pressure: true,
  hlColor: '#FDE047',
  hlWidth: 18,
  hlStraight: true,
  eraserMode: 'stroke',
  eraserHlOnly: false,
  eraserSize: 20,
  shapeKind: 'rect',
};

// ===== UI-runtime draw state

type DrawMode = 'none' | 'ink' | 'erase' | 'forward' | 'fired';
type HoldKind = '' | 'snap' | 'straight';

/**
 * Lives in one shared value and is ONLY touched on the UI runtime (draw() hands out the stored
 * object, which the gestures mutate in place). It never drives rendering, so no notification is
 * needed; the values that do render (ring, wet ink, hold signal) are separate shared values.
 */
interface DrawState {
  lockId: number;
  lockPtr: PointerName | '';
  mode: DrawMode;
  tool: ToolId;
  page: number;
  pageId: string;
  /** Screen px per page point when the stroke began (nav is blocked while it lasts). */
  z: number;
  downT: number;
  downSx: number;
  downSy: number;
  /** Largest distance from the down point so far (screen px). */
  moved: number;
  lastSx: number;
  lastSy: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  /** Ruler edge of this stroke (0: not snapped) and the ruler in page points. */
  edge: number;
  rcx: number;
  rcy: number;
  rangle: number;
  rlen: number;
  rwid: number;
  holdKind: HoldKind;
  hold: HoldState;
  cand: ShapeCandidate | null;
  press: PressState;
  eraseSeq: number;
  eraseMode: 'stroke' | 'pixel';
  radius: number;
  hlOnly: boolean;
  erased: string[];
  path: number[];
  /** Index in path of the first point not yet sent to the JS hit test. */
  jsFrom: number;
  jsT: number;
  liftSx: number;
  liftSy: number;
  liftT: number;
  liftHand: 'right' | 'left';
  stylusSeen: boolean;
  /** A stroke (any tool) is live: nav ignores updates and taps do not fire. */
  drawLive: boolean;
  /** A second pointer touched while a stroke was live (and did not cancel it): no multi-finger tap. */
  tapSpoiled: boolean;
  /** Nav took this touch sequence (stroke yielded): no new finger stroke until every touch lifts. */
  navTaken: boolean;
  pressure: number;
  /** The nav pan's first touch may pan with one finger. */
  oneFinger: boolean;
  /** Nav gestures currently moving the view, and whether a fling runs. */
  navCount: number;
  panOn: boolean;
  pinchOn: boolean;
  decaying: boolean;
  ticking: boolean;
}

function initialDrawState(): DrawState {
  'worklet';
  return {
    lockId: -1,
    lockPtr: '',
    mode: 'none',
    tool: 'pen',
    page: -1,
    pageId: '',
    z: 1,
    downT: 0,
    downSx: 0,
    downSy: 0,
    moved: 0,
    lastSx: 0,
    lastSy: 0,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    edge: 0,
    rcx: 0,
    rcy: 0,
    rangle: 0,
    rlen: 0,
    rwid: 0,
    holdKind: '',
    hold: createHoldState(),
    cand: null,
    press: createPress(),
    eraseSeq: 0,
    eraseMode: 'stroke',
    radius: 10,
    hlOnly: false,
    erased: [],
    path: [],
    jsFrom: 0,
    jsT: -Infinity,
    liftSx: 0,
    liftSy: 0,
    liftT: -1,
    liftHand: 'right',
    stylusSeen: false,
    drawLive: false,
    tapSpoiled: false,
    navTaken: false,
    pressure: 0.5,
    oneFinger: false,
    navCount: 0,
    panOn: false,
    pinchOn: false,
    decaying: false,
    ticking: false,
  };
}

/**
 * The stored draw state object (UI runtime only). On the UI runtime get() hands out the stored object
 * itself, which the gestures mutate in place (the same as modify(fn, false) without a closure: an
 * assignment inside a nested worklet would only change that worklet's captured copy).
 */
function draw(ds: SharedValue<DrawState>): DrawState {
  'worklet';
  return ds.get();
}

export function nowMs(): number {
  'worklet';
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

// ===== shared stores captured by the worklets (module-level shared values, never whole objects)

const holdProgress = holdSignal.progress;
const holdSx = holdSignal.sx;
const holdSy = holdSignal.sy;
const holdActive = holdSignal.active;
const hiddenIds = getSelection().hidden;
const rulerApi = getRuler();
const rulerVisible = rulerApi.visible;
const rulerCx = rulerApi.cx;
const rulerCy = rulerApi.cy;
const rulerAngle = rulerApi.angle;
const rulerHitTest = rulerApi.hitTest;

// ===== worklet helpers

interface Ctx {
  core: CanvasCore;
  wet: WetInk;
  ds: SharedValue<DrawState>;
  cfg: SharedValue<GestureConfig>;
  mirrors: SharedValue<MirrorRecord>;
  dark: SharedValue<number[]>;
  ringOn: SharedValue<boolean>;
}

/** The JS functions, gathered ON the UI runtime from the individually captured remote functions. */
interface Js {
  commitStroke: (c: StrokeCommit) => void;
  commitErase: (c: EraseCommit) => void;
  eraseOnJs: (p: EraseProbe) => void;
  forward: (kind: ForwardKind, tool: ToolId, p: PagePoint, cancelled: boolean) => void;
  setTicking: (on: boolean) => void;
}

function pagePoint(s: DrawState, x: number, y: number, p: number): PagePoint {
  'worklet';
  const ptr: PointerName = s.lockPtr === '' ? 'touch' : s.lockPtr;
  return { pageId: s.pageId, x, y, pressure: p, pointer: ptr };
}

function startTicking(s: DrawState, js: Js): void {
  'worklet';
  if (s.ticking) return;
  s.ticking = true;
  scheduleOnRN(js.setTicking, true);
}

function stopTicking(s: DrawState, js: Js): void {
  'worklet';
  if (!s.ticking) return;
  s.ticking = false;
  scheduleOnRN(js.setTicking, false);
}

/** Hides the ring, the dashed preview and the hint (the candidate is cleared on JS). */
function clearHoldUi(x: Ctx, s: DrawState): void {
  'worklet';
  if (x.ringOn.get()) x.ringOn.set(false);
  if (holdActive.get()) holdActive.set(false);
  holdProgress.set(0);
  setPreview(x.wet, null);
  if (s.cand !== null) {
    s.cand = null;
    scheduleOnRN(setCandidate, null);
  }
}

function palmBlocked(s: DrawState, sx: number, sy: number, now: number): boolean {
  'worklet';
  if (s.liftT < 0) return false;
  const zone = palmZone({ x: s.liftSx, y: s.liftSy }, s.liftHand);
  return ignoreTouch({ x: sx, y: sy }, zone, now - s.liftT);
}

/** True when the first two touches both start on the visible ruler. */
function bothOnRuler(touches: readonly { x: number; y: number }[]): boolean {
  'worklet';
  if (touches.length < 2) return false;
  return rulerHitTest(touches[0].x, touches[0].y) && rulerHitTest(touches[1].x, touches[1].y);
}

function unlock(s: DrawState, now: number): void {
  'worklet';
  if (s.lockPtr === 'stylus') {
    s.liftSx = s.lastSx;
    s.liftSy = s.lastSy;
    s.liftT = now;
  }
  s.lockId = -1;
  s.lockPtr = '';
  s.mode = 'none';
  s.drawLive = false;
  s.holdKind = '';
}

/** The page point of a screen point on the stroke's page, ruler-projected when the stroke is snapped. */
function strokePoint(x: Ctx, s: DrawState, sx: number, sy: number): number[] {
  'worklet';
  const p = screenToPageOf(x.core.layout.get(), viewportOf(x.core), s.page, sx, sy);
  if (s.edge !== 0) return projectToRuler(p[0], p[1], { cx: s.rcx, cy: s.rcy, angle: s.rangle, length: s.rlen, width: s.rwid }, s.edge);
  return p;
}

function inkPressure(s: DrawState): number {
  'worklet';
  return s.lockPtr === 'stylus' ? s.pressure : 0.5;
}

function commitInk(x: Ctx, s: DrawState, js: Js, pts: number[], seq: number, style: WetStyle, snap: ShapeCandidate | null, straight: boolean): void {
  'worklet';
  scheduleOnRN(js.commitStroke, {
    pageId: s.pageId,
    seq,
    tool: style.tool,
    color: style.color,
    width: style.width,
    pressure: style.pressure,
    pts,
    snap,
    straight,
  });
}

/** The highlighter hold straightens only a stroke whose ends are STRAIGHT_MIN_PX (screen) apart. */
function straightLongEnough(x: Ctx, s: DrawState): boolean {
  'worklet';
  const p = x.wet.pts.get();
  const n = Math.floor(p.length / 3);
  if (n < 2) return false;
  const o = (n - 1) * 3;
  const dx = p[o] - p[0];
  const dy = p[o + 1] - p[1];
  const min = STRAIGHT_MIN_PX / (s.z > 0 ? s.z : 1);
  return dx * dx + dy * dy >= min * min;
}

/** One hold detector result (from a pen sample or a frame tick). */
function handleHold(x: Ctx, s: DrawState, js: Js, u: HoldUpdate): void {
  'worklet';
  if (s.holdKind === '' || s.mode !== 'ink') return;
  if (u.phase === 'moving') {
    // Moving before the fire resets the ring, the preview and the candidate.
    if (x.ringOn.get() || s.cand !== null || holdActive.get()) clearHoldUi(x, s);
    return;
  }
  if (u.justHeld) {
    holdSx.set(s.lastSx);
    holdSy.set(s.lastSy);
    if (s.holdKind === 'snap') {
      const c = recognizeShape(x.wet.pts.get(), 3);
      s.cand = c;
      if (c) {
        setPreview(x.wet, c);
        holdActive.set(true);
        x.ringOn.set(true);
        scheduleOnRN(setCandidate, { variant: c.variant, sides: c.sides });
      }
    } else if (straightLongEnough(x, s)) {
      x.ringOn.set(true);
    }
  }
  if (x.ringOn.get()) holdProgress.set(u.progress);
  if (!u.justFired) return;
  if (s.holdKind === 'straight' && !straightLongEnough(x, s)) {
    // A pause right after pen-down (or on a tiny stroke) is not "hold at the end of a stroke": the
    // highlighter keeps drawing, and a later hold can still straighten.
    resetHold(s.hold);
    clearHoldUi(x, s);
    return;
  }

  const style = x.wet.style.get();
  const seq = x.wet.seq.get();
  if (s.holdKind === 'snap') {
    const c = s.cand;
    if (!c) {
      // Nothing recognised: nothing happens, drawing goes on (a later hold may still snap).
      resetHold(s.hold);
      clearHoldUi(x, s);
      return;
    }
    // Ruling (g): swap while the pen is still down. The wet ink goes at once; the stroke is committed
    // and then replaced by the shape on JS, in that order, in ONE hop.
    const pts = x.wet.pts.get().slice();
    s.cand = null;
    wetDiscard(x.wet);
    x.ringOn.set(false);
    holdActive.set(false);
    holdProgress.set(0);
    setPreview(x.wet, null);
    scheduleOnRN(setCandidate, null);
    commitInk(x, s, js, pts, seq, style, c, false);
    s.mode = 'fired';
    stopTicking(s, js);
    return;
  }
  // Highlighter hold: the stroke becomes straight, is committed once, and later moves add nothing.
  const pts = straighten(x.wet.pts.get());
  wetReplace(x.wet, pts);
  wetEnd(x.wet);
  clearHoldUi(x, s);
  commitInk(x, s, js, pts, seq, style, null, true);
  s.mode = 'fired';
  stopTicking(s, js);
}

function beginInk(x: Ctx, s: DrawState, js: Js, c: GestureConfig, sx: number, sy: number, now: number): void {
  'worklet';
  const isPen = c.tool === 'pen';
  const dark = (x.dark.get()[s.page] ?? 0) === 1;
  const style: WetStyle = isPen
    ? { tool: 'pen', color: dark ? c.penColorDark : c.penColor, width: c.penWidth, pressure: c.pressure }
    : { tool: 'highlighter', color: c.hlColor, width: c.hlWidth, pressure: false };
  let p = screenToPageOf(x.core.layout.get(), viewportOf(x.core), s.page, sx, sy);
  s.edge = 0;
  if (rulerVisible.get()) {
    const cxy = screenToPageOf(x.core.layout.get(), viewportOf(x.core), s.page, rulerCx.get(), rulerCy.get());
    s.rcx = cxy[0];
    s.rcy = cxy[1];
    s.rangle = rulerAngle.get();
    s.rlen = RULER_LENGTH / s.z;
    s.rwid = RULER_WIDTH / s.z;
    const ruler = { cx: s.rcx, cy: s.rcy, angle: s.rangle, length: s.rlen, width: s.rwid };
    s.edge = rulerEdgeAt(p[0], p[1], ruler, RULER_SNAP_PX / s.z);
    if (s.edge !== 0) p = projectToRuler(p[0], p[1], ruler, s.edge);
  }
  wetBegin(x.wet, s.page, p[0], p[1], inkPressure(s), style);
  // A ruler stroke is straight already: no hold.
  s.holdKind = s.edge !== 0 ? '' : isPen ? (c.shapeSnap ? 'snap' : '') : c.hlStraight ? 'straight' : '';
  s.cand = null;
  resetHold(s.hold);
  if (s.holdKind !== '') {
    updateHold(s.hold, p[0], p[1], now, holdTolerance(s.z));
    startTicking(s, js);
  }
  s.mode = 'ink';
}

function moveInk(x: Ctx, s: DrawState, js: Js, sx: number, sy: number, now: number): void {
  'worklet';
  const p = strokePoint(x, s, sx, sy);
  if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
  const seq = x.wet.seq.get();
  const style = x.wet.style.get();
  const done = wetAdd(x.wet, p[0], p[1], inkPressure(s));
  // WET_MAX_POINTS: the first part is committed now and the stroke continues.
  if (done) commitInk(x, s, js, done, seq, style, null, false);
  if (s.holdKind !== '') handleHold(x, s, js, updateHold(s.hold, p[0], p[1], now, holdTolerance(s.z)));
}

function endInk(x: Ctx, s: DrawState, js: Js): void {
  'worklet';
  if (s.mode === 'ink') {
    const pts = x.wet.pts.get().slice();
    const seq = x.wet.seq.get();
    const style = x.wet.style.get();
    wetEnd(x.wet);
    // Lifted before the fire: the stroke stays as drawn and the hint goes.
    commitInk(x, s, js, pts, seq, style, null, false);
  }
  clearHoldUi(x, s);
  stopTicking(s, js);
}

function eraseSegment(x: Ctx, s: DrawState, js: Js, px: number, py: number, now: number, flush: boolean): void {
  'worklet';
  const x0 = s.path.length >= 2 ? s.path[s.path.length - 2] : px;
  const y0 = s.path.length >= 2 ? s.path[s.path.length - 1] : py;
  s.path.push(px, py);
  if (s.eraseMode === 'pixel') {
    setEraserPath(x.wet, s.page, s.path);
    return;
  }
  const m = x.mirrors.get()[s.pageId];
  if (!m || m.big) {
    // Not mirrored (big page, or not mirrored yet): hit-test on JS at 60 Hz.
    if (flush || now - s.jsT >= JS_ERASE_INTERVAL_MS) {
      const from = Math.max(0, s.jsFrom - 2);
      const seg = s.path.slice(from);
      s.jsFrom = s.path.length;
      s.jsT = now;
      scheduleOnRN(js.eraseOnJs, { pageId: s.pageId, seq: s.eraseSeq, path: seg, radius: s.radius, highlighterOnly: s.hlOnly });
    }
    return;
  }
  const hits = mirrorHits(m, [x0, y0, px, py], s.radius, s.hlOnly, s.erased);
  if (hits.length === 0) return;
  for (let i = 0; i < hits.length; i++) s.erased.push(hits[i]);
  hiddenIds.set(hiddenIds.get().concat(hits));
}

function beginErase(x: Ctx, s: DrawState, js: Js, c: GestureConfig, sx: number, sy: number, now: number): void {
  'worklet';
  s.eraseSeq += 1;
  s.eraseMode = c.eraserMode;
  s.hlOnly = c.eraserHlOnly;
  s.radius = Math.max(1, c.eraserSize / 2);
  s.erased = [];
  s.path = [];
  s.jsFrom = 0;
  s.jsT = -Infinity;
  s.mode = 'erase';
  const p = screenToPageOf(x.core.layout.get(), viewportOf(x.core), s.page, sx, sy);
  eraseSegment(x, s, js, p[0], p[1], now, false);
}

function endErase(x: Ctx, s: DrawState, js: Js): void {
  'worklet';
  if (s.eraseMode === 'stroke') {
    const m = x.mirrors.get()[s.pageId];
    if ((!m || m.big) && s.jsFrom < s.path.length) {
      // Send the rest of the path to the JS hit test before the commit.
      s.jsT = -Infinity;
      const last = s.path.length;
      const from = Math.max(0, s.jsFrom - 2);
      s.jsFrom = last;
      scheduleOnRN(js.eraseOnJs, { pageId: s.pageId, seq: s.eraseSeq, path: s.path.slice(from), radius: s.radius, highlighterOnly: s.hlOnly });
    }
  }
  scheduleOnRN(js.commitErase, {
    pageId: s.pageId,
    seq: s.eraseSeq,
    mode: s.eraseMode,
    ids: s.erased.slice(),
    path: s.eraseMode === 'pixel' ? s.path.slice() : [],
    radius: s.radius,
    highlighterOnly: s.hlOnly,
  });
}

/** Drops a live eraser stroke without erasing anything. */
function cancelErase(x: Ctx, s: DrawState): void {
  'worklet';
  if (s.erased.length > 0) {
    const gone = s.erased;
    hiddenIds.set(hiddenIds.get().filter((id) => gone.indexOf(id) < 0));
  }
  s.erased = [];
  clearEraserPath(x.wet);
}

/** The shape tool's live preview, drawn on the UI runtime from the start point to (px, py). */
function previewShape(x: Ctx, s: DrawState, px: number, py: number): void {
  'worklet';
  const c = x.cfg.get();
  const dark = (x.dark.get()[s.page] ?? 0) === 1;
  const item = shapeFromDrag(c.shapeKind, s.startX, s.startY, px, py, { color: dark ? c.penColorDark : c.penColor, width: c.penWidth }, 'preview');
  setShapePreview(x.wet, s.page, item);
}

function beginForward(x: Ctx, s: DrawState, js: Js, sx: number, sy: number, now: number): void {
  'worklet';
  const p = screenToPageOf(x.core.layout.get(), viewportOf(x.core), s.page, sx, sy);
  s.startX = p[0];
  s.startY = p[1];
  s.lastX = p[0];
  s.lastY = p[1];
  beginPress(s.press, sx, sy, now);
  s.mode = 'forward';
  startTicking(s, js);
}

function moveForward(x: Ctx, s: DrawState, js: Js, sx: number, sy: number, now: number): void {
  'worklet';
  const p = screenToPageOf(x.core.layout.get(), viewportOf(x.core), s.page, sx, sy);
  s.lastX = p[0];
  s.lastY = p[1];
  const ev = movePress(s.press, sx, sy, now);
  const pr = inkPressure(s);
  if (ev === 'drag-start') {
    scheduleOnRN(js.forward, 'begin', s.tool, pagePoint(s, s.startX, s.startY, pr), false);
    shouldForward(s.press, now);
    scheduleOnRN(js.forward, 'update', s.tool, pagePoint(s, p[0], p[1], pr), false);
    return;
  }
  if (ev === 'long-press') {
    scheduleOnRN(js.forward, 'longPress', s.tool, pagePoint(s, s.startX, s.startY, pr), false);
    return;
  }
  if (s.press.phase === 'drag' && shouldForward(s.press, now)) scheduleOnRN(js.forward, 'update', s.tool, pagePoint(s, p[0], p[1], pr), false);
  if (s.tool === 'shapes' && s.press.phase === 'drag') previewShape(x, s, p[0], p[1]);
}

function endForward(x: Ctx, s: DrawState, js: Js, now: number, cancelled: boolean): void {
  'worklet';
  const wasDrag = s.press.phase === 'drag';
  const r = endPress(s.press, now);
  const pr = inkPressure(s);
  if (cancelled) {
    if (wasDrag) scheduleOnRN(js.forward, 'end', s.tool, pagePoint(s, s.lastX, s.lastY, pr), true);
    if (s.tool === 'shapes') clearShapePreview(x.wet);
  } else if (r === 'tap') {
    scheduleOnRN(js.forward, 'tap', s.tool, pagePoint(s, s.startX, s.startY, pr), false);
  } else if (r === 'drag') {
    scheduleOnRN(js.forward, 'end', s.tool, pagePoint(s, s.lastX, s.lastY, pr), false);
  }
  stopTicking(s, js);
}

/** Ends the live stroke: commit (ink, eraser, forwarded drag) or, with discard, drop it. */
function finishStroke(x: Ctx, s: DrawState, js: Js, now: number, discard: boolean): void {
  'worklet';
  switch (s.mode) {
    case 'ink':
    case 'fired':
      if (discard && s.mode === 'ink') {
        wetDiscard(x.wet);
        clearHoldUi(x, s);
        stopTicking(s, js);
      } else {
        endInk(x, s, js);
      }
      break;
    case 'erase':
      if (discard) cancelErase(x, s);
      else endErase(x, s, js);
      break;
    case 'forward':
      endForward(x, s, js, now, discard);
      break;
    default:
      break;
  }
  unlock(s, now);
}

/** Tries to start a stroke with touch t; true when it locked. */
function beginStroke(x: Ctx, s: DrawState, js: Js, handlerTag: number, t: { id: number; x: number; y: number }, ptr: PointerName, now: number): boolean {
  'worklet';
  const c = x.cfg.get();
  if (c.readOnly || c.tool === 'play') return false;
  if (!shouldDraw(ptr, c.input, c.fingerDraws, s.stylusSeen || c.pencilOnly)) return false;
  if (ptr === 'touch' && palmBlocked(s, t.x, t.y, now)) return false;
  const layout = x.core.layout.get();
  const vp = viewportOf(x.core);
  const hit = screenToPage(layout, vp, t.x, t.y, PAGE_SLOP);
  if (!hit) return false;
  const pageId = x.core.pageIds.get()[hit.index];
  if (pageId === undefined) return false;
  // The pen must not write on a page that is still sliding.
  stopMotion(x.core);
  s.lockId = t.id;
  s.lockPtr = ptr;
  s.tool = c.tool;
  s.page = hit.index;
  s.pageId = pageId;
  s.z = layoutScale(layout) * vp.scale;
  s.downT = now;
  s.downSx = t.x;
  s.downSy = t.y;
  s.lastSx = t.x;
  s.lastSy = t.y;
  s.moved = 0;
  s.drawLive = true;
  s.liftHand = c.hand;
  GestureStateManager.activate(handlerTag);
  if (c.tool === 'pen' || c.tool === 'highlighter') beginInk(x, s, js, c, t.x, t.y, now);
  else if (c.tool === 'eraser') beginErase(x, s, js, c, t.x, t.y, now);
  else beginForward(x, s, js, t.x, t.y, now);
  return true;
}

// ===== nav helpers

function navBegin(x: Ctx, s: DrawState): void {
  'worklet';
  if (s.decaying) {
    s.decaying = false;
    stopMotion(x.core);
  }
  s.navCount += 1;
  x.core.moving.set(true);
  x.core.navActive.set(true);
}

function navEnd(x: Ctx, s: DrawState): void {
  'worklet';
  s.navCount = Math.max(0, s.navCount - 1);
  if (s.navCount === 0) {
    x.core.navActive.set(false);
    if (!s.decaying) x.core.moving.set(false);
  }
}

function navBlocked(s: DrawState): boolean {
  'worklet';
  return s.drawLive || isOverlayBusy();
}

// ===== the hook

export interface CanvasGestures {
  gesture: ComposedGesture;
  /** The hold ring is on screen (pen snap candidate, or the highlighter hold). */
  ringOn: SharedValue<boolean>;
}

export function useCanvasGestures(
  core: CanvasCore,
  wet: WetInk,
  mirrors: SharedValue<MirrorRecord>,
  cfg: SharedValue<GestureConfig>,
  dark: SharedValue<number[]>,
  api: CanvasJsApi,
  playEnabled: boolean,
): CanvasGestures {
  const ds = useSharedValue<DrawState>(initialDrawState());
  const ringOn = useSharedValue(false);
  const { commitStroke, commitErase, eraseOnJs, forward, playAt, undo, redo } = api;

  // Long press and the hold-to-snap clock need a tick while the pen rests (a still pen sends no
  // events). The frame callback runs only between pen-down and lift (setTicking from the worklets).
  const frameRef = useRef<ReturnType<typeof useFrameCallback> | null>(null);
  const setTicking = useCallback((on: boolean) => {
    frameRef.current?.setActive(on);
  }, []);
  const frame = useFrameCallback(() => {
    'worklet';
    const s = draw(ds);
    const now = nowMs();
    const x: Ctx = { core, wet, ds, cfg, mirrors, dark, ringOn };
    const js: Js = { commitStroke, commitErase, eraseOnJs, forward, setTicking };
    if (s.mode === 'ink' && s.holdKind !== '') handleHold(x, s, js, tickHold(s.hold, now, holdTolerance(s.z)));
    else if (s.mode === 'forward' && tickPress(s.press, now) === 'long-press') {
      scheduleOnRN(forward, 'longPress', s.tool, pagePoint(s, s.startX, s.startY, 0.5), false);
    }
  }, false);
  useEffect(() => {
    frameRef.current = frame;
    return () => {
      frameRef.current = null;
    };
  }, [frame]);

  const drawGesture = useManualGesture({
    onBegin: (e) => {
      'worklet';
      if (isOverlayBusy()) GestureStateManager.fail(e.handlerTag);
    },
    onTouchesDown: (e) => {
      'worklet';
      const s = draw(ds);
      const now = nowMs();
      const x: Ctx = { core, wet, ds, cfg, mirrors, dark, ringOn };
      const js: Js = { commitStroke, commitErase, eraseOnJs, forward, setTicking };
      const ptr = pointerName(e.pointerType);
      const fresh = e.numberOfTouches <= e.changedTouches.length;
      if (fresh) {
        s.tapSpoiled = false;
        s.navTaken = false;
      }
      if (ptr === 'stylus') s.stylusSeen = true;
      if (e.changedTouches.length === 0) return;
      const t = e.changedTouches[0];
      if (s.lockId >= 0) {
        if (s.lockPtr === 'touch' && ptr === 'stylus') {
          // The stylus takes over from a finger (palm-first before the stylus was ever seen).
          finishStroke(x, s, js, now, true);
          beginStroke(x, s, js, e.handlerTag, t, ptr, now);
          return;
        }
        if (yieldsToNav(s.lockPtr === '' ? 'touch' : s.lockPtr, now - s.downT, s.moved)) {
          // Two fingers at once: scroll / zoom (or a two-finger tap), not ink.
          finishStroke(x, s, js, now, true);
          s.navTaken = true;
          return;
        }
        // A palm or a late second finger: ignored by the stroke, and no multi-finger tap.
        s.tapSpoiled = true;
        return;
      }
      if (isOverlayBusy()) return;
      // Only a stylus may start a stroke while other touches are down (they are palm or nav).
      if (!fresh && ptr !== 'stylus') return;
      if (s.navTaken && ptr !== 'stylus') return;
      // Two fingers landing together are a nav gesture.
      if (ptr === 'touch' && e.changedTouches.length >= 2) return;
      beginStroke(x, s, js, e.handlerTag, t, ptr, now);
    },
    onTouchesMove: (e) => {
      'worklet';
      const s = draw(ds);
      if (s.lockId < 0) return;
      let t: { x: number; y: number } | null = null;
      for (let i = 0; i < e.allTouches.length; i++) {
        if (e.allTouches[i].id === s.lockId) {
          t = e.allTouches[i];
          break;
        }
      }
      if (!t) return;
      const now = nowMs();
      const x: Ctx = { core, wet, ds, cfg, mirrors, dark, ringOn };
      const js: Js = { commitStroke, commitErase, eraseOnJs, forward, setTicking };
      // An overlay (e.g. the ruler's two-finger gesture) took over a finger stroke: drop it.
      if (s.lockPtr === 'touch' && isOverlayBusy()) {
        finishStroke(x, s, js, now, true);
        return;
      }
      const dx = t.x - s.downSx;
      const dy = t.y - s.downSy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > s.moved) s.moved = d;
      if (t.x === s.lastSx && t.y === s.lastSy) return;
      s.lastSx = t.x;
      s.lastSy = t.y;
      if (s.mode === 'ink') moveInk(x, s, js, t.x, t.y, now);
      else if (s.mode === 'erase') {
        const p = screenToPageOf(core.layout.get(), viewportOf(core), s.page, t.x, t.y);
        eraseSegment(x, s, js, p[0], p[1], now, false);
      } else if (s.mode === 'forward') moveForward(x, s, js, t.x, t.y, now);
      // 'fired': the snap or the straightening happened; further moves add nothing until lift.
    },
    onTouchesUp: (e) => {
      'worklet';
      const s = draw(ds);
      if (s.lockId >= 0) {
        let mine = false;
        for (let i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].id === s.lockId) mine = true;
        if (mine) {
          const x: Ctx = { core, wet, ds, cfg, mirrors, dark, ringOn };
          const js: Js = { commitStroke, commitErase, eraseOnJs, forward, setTicking };
          finishStroke(x, s, js, nowMs(), false);
        }
      }
      if (e.numberOfTouches <= e.changedTouches.length) GestureStateManager.deactivate(e.handlerTag);
    },
    onTouchesCancel: (e) => {
      'worklet';
      const s = draw(ds);
      if (s.lockId < 0) return;
      let mine = false;
      for (let i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].id === s.lockId) mine = true;
      if (!mine) return;
      const x: Ctx = { core, wet, ds, cfg, mirrors, dark, ringOn };
      const js: Js = { commitStroke, commitErase, eraseOnJs, forward, setTicking };
      // The system took the touch: keep what was drawn (ink, eraser); a forwarded drag is cancelled.
      if (s.mode === 'forward') {
        endForward(x, s, js, nowMs(), true);
        unlock(s, nowMs());
      } else finishStroke(x, s, js, nowMs(), false);
    },
    onFinalize: () => {
      'worklet';
      const s = draw(ds);
      if (s.lockId < 0) return;
      const x: Ctx = { core, wet, ds, cfg, mirrors, dark, ringOn };
      const js: Js = { commitStroke, commitErase, eraseOnJs, forward, setTicking };
      if (s.mode === 'forward') {
        endForward(x, s, js, nowMs(), true);
        unlock(s, nowMs());
      } else finishStroke(x, s, js, nowMs(), false);
    },
  });

  // Manual gestures carry no stylusData: this pan only reads the pressure.
  const stylusGesture = usePanGesture({
    minDistance: 0,
    onBegin: (e) => {
      'worklet';
      if (e.pointerType !== PointerType.STYLUS) return;
      const p = e.stylusData ? e.stylusData.pressure : NaN;
      if (Number.isFinite(p) && p > 0) draw(ds).pressure = Math.min(1, p);
    },
    onUpdate: (e) => {
      'worklet';
      if (e.pointerType !== PointerType.STYLUS) return;
      const p = e.stylusData ? e.stylusData.pressure : NaN;
      if (Number.isFinite(p) && p > 0) draw(ds).pressure = Math.min(1, p);
    },
  });

  const navPan = usePanGesture({
    minPointers: 1,
    maxPointers: 2,
    averageTouches: true,
    onBegin: (e) => {
      'worklet';
      if (isOverlayBusy()) GestureStateManager.fail(e.handlerTag);
    },
    onTouchesDown: (e) => {
      'worklet';
      const s = draw(ds);
      if (e.numberOfTouches <= e.changedTouches.length && e.changedTouches.length > 0) {
        // A new touch stops a fling.
        if (s.decaying) {
          s.decaying = false;
          stopMotion(core);
        }
        const t = e.changedTouches[0];
        const ptr = pointerName(e.pointerType);
        const now = nowMs();
        if (ptr === 'touch' && palmBlocked(s, t.x, t.y, now)) {
          GestureStateManager.fail(e.handlerTag);
          return;
        }
        const c = cfg.get();
        let fingerDraws = false;
        if (ptr === 'touch' && c.tool !== 'play' && !c.readOnly && shouldDraw('touch', c.input, c.fingerDraws, s.stylusSeen || c.pencilOnly)) {
          // A drawing finger pans only when it starts beside the pages.
          fingerDraws = screenToPage(core.layout.get(), viewportOf(core), t.x, t.y, PAGE_SLOP) !== null;
        }
        s.oneFinger = ptr === 'touch' && !fingerDraws;
      }
      if (e.numberOfTouches >= 2 && bothOnRuler(e.allTouches)) GestureStateManager.fail(e.handlerTag);
    },
    onUpdate: (e) => {
      'worklet';
      const s = draw(ds);
      if (navBlocked(s)) return;
      if (e.numberOfPointers < 2 && !s.oneFinger) return;
      // The view counts as moving only once nav really moves it (a drawing finger also activates
      // this pan, and PDF tiles must not blink off under it).
      if (!s.panOn) {
        s.panOn = true;
        navBegin({ core, wet, ds, cfg, mirrors, dark, ringOn }, s);
      } else if (!core.moving.get()) {
        // A stroke that started meanwhile ran stopMotion, which clears `moving`: the view moves again.
        core.moving.set(true);
      }
      const vp = viewportOf(core);
      setViewport(core, clampViewport({ scale: vp.scale, tx: vp.tx + e.changeX, ty: vp.ty + e.changeY }, core.layout.get(), viewOf(core), insetsOf(core)));
    },
    onDeactivate: (e) => {
      'worklet';
      const s = draw(ds);
      if (e.canceled || !s.panOn || navBlocked(s) || s.pinchOn) return;
      // Fling, clamped to the scroll bounds.
      const view = viewOf(core);
      const layout = core.layout.get();
      const b = translateBounds(core.scale.get(), layoutContentW(layout), layoutContentH(layout), view, insetsOf(core));
      const vx = b[0] < b[1] ? e.velocityX : 0;
      const vy = b[2] < b[3] ? e.velocityY : 0;
      if (Math.abs(vx) < 50 && Math.abs(vy) < 50) return;
      s.decaying = true;
      const done = () => {
        'worklet';
        const st = draw(ds);
        if (!st.decaying) return;
        st.decaying = false;
        if (st.navCount === 0) core.moving.set(false);
      };
      if (vx !== 0) core.tx.set(withDecay({ velocity: vx, clamp: [b[0], b[1]] }, vy === 0 ? done : undefined));
      if (vy !== 0) core.ty.set(withDecay({ velocity: vy, clamp: [b[2], b[3]] }, done));
    },
    onFinalize: () => {
      'worklet';
      const s = draw(ds);
      // navEnd balances the navBegin of the first applied update.
      if (!s.panOn) return;
      s.panOn = false;
      navEnd({ core, wet, ds, cfg, mirrors, dark, ringOn }, s);
    },
  });

  const pinch = usePinchGesture({
    onBegin: (e) => {
      'worklet';
      if (isOverlayBusy()) GestureStateManager.fail(e.handlerTag);
    },
    onTouchesDown: (e) => {
      'worklet';
      if (e.numberOfTouches >= 2 && bothOnRuler(e.allTouches)) GestureStateManager.fail(e.handlerTag);
    },
    onUpdate: (e) => {
      'worklet';
      const s = draw(ds);
      if (navBlocked(s)) return;
      if (!Number.isFinite(e.scaleChange) || e.scaleChange <= 0) return;
      if (!s.pinchOn) {
        s.pinchOn = true;
        navBegin({ core, wet, ds, cfg, mirrors, dark, ringOn }, s);
      } else if (!core.moving.get()) {
        core.moving.set(true);
      }
      const vp = viewportOf(core);
      const layout = core.layout.get();
      const view = viewOf(core);
      const ins = insetsOf(core);
      const next = zoomAbout(vp, e.focalX, e.focalY, vp.scale * e.scaleChange, minZoomFor(layout, view, ins));
      setViewport(core, clampViewport(next, layout, view, ins));
    },
    onFinalize: () => {
      'worklet';
      const s = draw(ds);
      if (!s.pinchOn) return;
      s.pinchOn = false;
      navEnd({ core, wet, ds, cfg, mirrors, dark, ringOn }, s);
    },
  });

  const multiTapCheck = (e: { handlerTag: number; numberOfTouches: number; pointerType: number; allTouches: { x: number; y: number }[]; changedTouches: { x: number; y: number }[] }) => {
    'worklet';
    if (e.numberOfTouches >= 2 && bothOnRuler(e.allTouches)) {
      GestureStateManager.fail(e.handlerTag);
      return;
    }
    // The side of the hand landing (often as two or three touches) right after a stylus lift is a
    // palm, never an undo / redo tap.
    if (pointerName(e.pointerType) !== 'touch') return;
    const s = draw(ds);
    const now = nowMs();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (palmBlocked(s, e.changedTouches[i].x, e.changedTouches[i].y, now)) {
        GestureStateManager.fail(e.handlerTag);
        return;
      }
    }
  };

  const redoTap = useTapGesture({
    minPointers: 3,
    maxDuration: MULTI_TAP_MAX_MS,
    maxDistance: MULTI_TAP_MAX_DIST,
    onBegin: (e) => {
      'worklet';
      if (isOverlayBusy()) GestureStateManager.fail(e.handlerTag);
    },
    onTouchesDown: (e) => {
      'worklet';
      multiTapCheck(e);
    },
    onActivate: () => {
      'worklet';
      const s = draw(ds);
      if (s.drawLive || s.tapSpoiled || isOverlayBusy()) return;
      scheduleOnRN(redo);
    },
  });

  const undoTap = useTapGesture({
    minPointers: 2,
    maxDuration: MULTI_TAP_MAX_MS,
    maxDistance: MULTI_TAP_MAX_DIST,
    onBegin: (e) => {
      'worklet';
      if (isOverlayBusy()) GestureStateManager.fail(e.handlerTag);
    },
    onTouchesDown: (e) => {
      'worklet';
      multiTapCheck(e);
    },
    onActivate: () => {
      'worklet';
      const s = draw(ds);
      if (s.drawLive || s.tapSpoiled || isOverlayBusy()) return;
      scheduleOnRN(undo);
    },
  });

  // The play tool (NB-62): tap a stroke to hear that moment. Any pointer may tap.
  const playTap = useTapGesture({
    enabled: playEnabled,
    maxDistance: TAP_SLOP,
    onBegin: (e) => {
      'worklet';
      if (isOverlayBusy()) GestureStateManager.fail(e.handlerTag);
    },
    onActivate: (e) => {
      'worklet';
      if (isOverlayBusy()) return;
      const layout = core.layout.get();
      const vp = viewportOf(core);
      const hit = screenToPage(layout, vp, e.x, e.y, PAGE_SLOP);
      if (!hit) return;
      const pageId = core.pageIds.get()[hit.index];
      if (pageId === undefined) return;
      scheduleOnRN(playAt, pageId, hit.x, hit.y, PLAY_HIT_PX / (layoutScale(layout) * vp.scale));
    },
  });

  // The text tool with a finger: a tap places a text box even when fingers do not draw (Apple Pencil
  // mode), so a box can be added and typed into without the pencil. A finger that does draw already
  // reaches the text tool through the draw gesture, and so does the stylus: this tap skips both.
  const textTap = useTapGesture({
    maxDistance: TAP_SLOP,
    onBegin: (e) => {
      'worklet';
      if (isOverlayBusy()) GestureStateManager.fail(e.handlerTag);
    },
    onActivate: (e) => {
      'worklet';
      if (isOverlayBusy()) return;
      const c = cfg.get();
      if (c.tool !== 'text' || c.readOnly) return;
      if (pointerName(e.pointerType) !== 'touch') return;
      const s = draw(ds);
      if (s.drawLive || shouldDraw('touch', c.input, c.fingerDraws, s.stylusSeen || c.pencilOnly)) return;
      const layout = core.layout.get();
      const vp = viewportOf(core);
      const hit = screenToPage(layout, vp, e.x, e.y, PAGE_SLOP);
      if (!hit) return;
      const pageId = core.pageIds.get()[hit.index];
      if (pageId === undefined) return;
      scheduleOnRN(forward, 'tap', 'text', { pageId, x: hit.x, y: hit.y, pressure: 0.5, pointer: 'touch' }, false);
    },
  });

  const taps = useExclusiveGestures(redoTap, undoTap, playTap, textTap);
  const gesture = useSimultaneousGestures(drawGesture, stylusGesture, navPan, pinch, taps);
  return { gesture, ringOn };
}
