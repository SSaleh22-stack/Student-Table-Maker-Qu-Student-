/**
 * Wet ink (P22, PRD9-ink-latency): the stroke being drawn, built on the UI runtime from every pointer
 * event with core/ink/wetOutline.ts, so ink never waits for JS.
 *
 * - The live stroke is drawn as ONE closed outline (`tail`), rebuilt on every event: the frozen left
 *   side (outline points that can no longer change, kept in `fl`), the live end from wetStep, the
 *   frozen right side reversed (`fr`) and the start cap, smoothed the same way the painter smooths a
 *   committed stroke. Earlier the frozen part was a pile of tiny separate polygons: their antialiased
 *   edges left faint seams across the letters while writing, which vanished only when the finished
 *   stroke replaced the wet ink. `frozen` stays empty (kept for the ghost and the canvas).
 * - At WET_MAX_POINTS (4000) raw points the stroke is committed and continues from its last point; the
 *   committed part moves to the GHOST paths, which stay on screen until the painter's picture shows it.
 *   A finished stroke also becomes a ghost when the next stroke starts before its picture arrived.
 * - preview: the dashed outline of the recognised shape while the hold-to-snap ring fills (NB-44).
 * - eraser: the pixel eraser's live path (drawn with DstOut inside the page layer, PageLayer.tsx).
 * - shape: the shape tool's live preview while dragging (setShapePreview, built in the gesture on the
 *   UI runtime with core/shapes/drag.ts, in the pen's colour and width), so the student sees the size
 *   before lifting. It stays until the committed shape's picture is on screen (PageCanvas clears it).
 *
 * SKIA RUNTIME NOTE (#4339): these small SkPaths are the ONLY Skia objects made on the UI runtime (in
 * the gesture worklets, as the Phase 0 spike measured). They hold no pixels and are replaced on every
 * event; images, pictures and paragraphs are still made and disposed on JS only (src/notebook/ink).
 *
 * All paths are in PAGE POINTS of the page at index `page` (the canvas draws them under that page's
 * transform).
 */
import { Skia, type SkPath } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import { strokeOptions } from '@/notebook/core/ink/freehand';
import { outlineToCommands, polygonToCommands } from '@/notebook/core/ink/outline';
import { wetCarry, wetCreate, wetOutlinePolygon, wetReset, wetShouldSplit, wetStep } from '@/notebook/core/ink/wetOutline';
import { shapeOutline as itemOutline } from '@/notebook/core/ink/bounds';
import type { ShapeItem } from '@/notebook/core/model';
import { shapeOutline, type ShapeCandidate } from '@/notebook/core/shapes/recognize';

export interface WetStyle {
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  pressure: boolean;
}

export interface WetInk {
  frozen: SharedValue<SkPath>;
  tail: SharedValue<SkPath>;
  /** Page index of the live stroke (-1: none). */
  page: SharedValue<number>;
  color: SharedValue<string>;
  /** 'pen' | 'highlighter' of the live stroke. */
  tool: SharedValue<string>;
  style: SharedValue<WetStyle>;
  /** Raw points of the live stroke, flat x, y, p (page points). */
  pts: SharedValue<number[]>;
  /** wetOutline state. */
  state: SharedValue<number[]>;
  /** Frozen left and right outline points (flat x, y, stroke order) and the start cap. */
  fl: SharedValue<number[]>;
  fr: SharedValue<number[]>;
  cap: SharedValue<number[]>;
  /** Stroke sequence number (increases at every pen-down and split). */
  seq: SharedValue<number>;
  /** True from pen-down to lift. */
  down: SharedValue<boolean>;
  ghostFrozen: SharedValue<SkPath>;
  ghostTail: SharedValue<SkPath>;
  ghostPage: SharedValue<number>;
  ghostColor: SharedValue<string>;
  ghostTool: SharedValue<string>;
  /** The stroke sequence the ghost shows (cleared when that stroke's picture is on screen). */
  ghostSeq: SharedValue<number>;
  /** The dashed snap preview (page points of `page`). */
  preview: SharedValue<SkPath>;
  /** The pixel eraser's path (page points of eraserPage). */
  eraser: SharedValue<SkPath>;
  eraserPage: SharedValue<number>;
  /** The shape tool's live preview (page points of shapePage; -1: none). */
  shape: SharedValue<SkPath>;
  shapePage: SharedValue<number>;
  shapeColor: SharedValue<string>;
  shapeWidth: SharedValue<number>;
}

export function useWetInk(): WetInk {
  // Initial (empty) paths are made on JS, once (not on every render).
  const [empty] = useState(() => ({
    frozen: Skia.Path.Make(),
    tail: Skia.Path.Make(),
    ghostFrozen: Skia.Path.Make(),
    ghostTail: Skia.Path.Make(),
    preview: Skia.Path.Make(),
    eraser: Skia.Path.Make(),
    shape: Skia.Path.Make(),
  }));
  const frozen = useSharedValue<SkPath>(empty.frozen);
  const tail = useSharedValue<SkPath>(empty.tail);
  const page = useSharedValue(-1);
  const color = useSharedValue('#1B2533');
  const tool = useSharedValue('pen');
  const style = useSharedValue<WetStyle>({ tool: 'pen', color: '#1B2533', width: 3, pressure: true });
  const pts = useSharedValue<number[]>([]);
  const state = useSharedValue<number[]>(wetCreate());
  const fl = useSharedValue<number[]>([]);
  const fr = useSharedValue<number[]>([]);
  const cap = useSharedValue<number[]>([]);
  const seq = useSharedValue(0);
  const down = useSharedValue(false);
  const ghostFrozen = useSharedValue<SkPath>(empty.ghostFrozen);
  const ghostTail = useSharedValue<SkPath>(empty.ghostTail);
  const ghostPage = useSharedValue(-1);
  const ghostColor = useSharedValue('#1B2533');
  const ghostTool = useSharedValue('pen');
  const ghostSeq = useSharedValue(-1);
  const preview = useSharedValue<SkPath>(empty.preview);
  const eraser = useSharedValue<SkPath>(empty.eraser);
  const eraserPage = useSharedValue(-1);
  const shape = useSharedValue<SkPath>(empty.shape);
  const shapePage = useSharedValue(-1);
  const shapeColor = useSharedValue('#1B2533');
  const shapeWidth = useSharedValue(3);
  return useMemo(
    () => ({
      frozen,
      tail,
      page,
      color,
      tool,
      style,
      pts,
      state,
      fl,
      fr,
      cap,
      seq,
      down,
      ghostFrozen,
      ghostTail,
      ghostPage,
      ghostColor,
      ghostTool,
      ghostSeq,
      preview,
      eraser,
      eraserPage,
      shape,
      shapePage,
      shapeColor,
      shapeWidth,
    }),
    [frozen, tail, page, color, tool, style, pts, state, fl, fr, cap, seq, down, ghostFrozen, ghostTail, ghostPage, ghostColor, ghostTool, ghostSeq, preview, eraser, eraserPage, shape, shapePage, shapeColor, shapeWidth],
  );
}

function emptyPath(): SkPath {
  'worklet';
  return Skia.Path.Make();
}

/** Empties the frozen sides (a new stroke or a split). */
function resetSides(w: WetInk): void {
  'worklet';
  w.fl.set([]);
  w.fr.set([]);
  w.cap.set([]);
}

/** Recomputes the outline after pts changed (one wetStep). */
function stepWet(w: WetInk): void {
  'worklet';
  const p = w.pts.get();
  const o = strokeOptions(w.style.get(), false);
  // On the UI runtime get() is the stored state array itself; wetStep updates it in place. (Reading
  // the result out of a nested modify() worklet would not work: an assignment there only changes
  // that worklet's captured copy of the variable.)
  const r = wetStep(w.state.get(), p, o);
  if (r.frozenLeft.length > 0) {
    const add = r.frozenLeft;
    w.fl.modify((a) => {
      'worklet';
      for (let k = 0; k < add.length; k++) a.push(add[k]);
      return a;
    }, false);
  }
  if (r.frozenRight.length > 0) {
    const add = r.frozenRight;
    w.fr.modify((a) => {
      'worklet';
      for (let k = 0; k < add.length; k++) a.push(add[k]);
      return a;
    }, false);
  }
  if (r.startCap.length > 0) w.cap.set(r.startCap.slice());
  const poly = wetOutlinePolygon(w.fl.get(), r.tail, w.fr.get(), w.cap.get());
  const t = poly.length >= 4 ? Skia.Path.MakeFromCmds(outlineToCommands(poly, true)) : null;
  w.tail.set(t ?? emptyPath());
}

/** Moves the live paths to the ghost (they stay on screen until clearGhost(seq)). */
function toGhost(w: WetInk): void {
  'worklet';
  // Quick short strokes (Arabic dots, i'jam) can start before the previous ghost's picture arrived.
  // Opaque pen ink of the same page and colour is then MERGED into the ghost, so the older stroke
  // does not blink off; the merged ghost clears with the newest stroke's picture (pictures of one
  // page arrive in order, so it holds the older strokes too) or its fallback timer.
  const merge =
    w.ghostSeq.get() >= 0 &&
    w.ghostPage.get() === w.page.get() &&
    w.ghostTool.get() === 'pen' &&
    w.tool.get() === 'pen' &&
    w.ghostColor.get() === w.color.get();
  if (merge) {
    const b = Skia.PathBuilder.MakeFromPath(w.ghostFrozen.get());
    b.addPath(w.ghostTail.get());
    b.addPath(w.frozen.get());
    b.addPath(w.tail.get());
    w.ghostFrozen.set(b.build());
    w.ghostTail.set(emptyPath());
    w.ghostSeq.set(w.seq.get());
    return;
  }
  w.ghostFrozen.set(w.frozen.get());
  w.ghostTail.set(w.tail.get());
  w.ghostPage.set(w.page.get());
  w.ghostColor.set(w.color.get());
  w.ghostTool.set(w.tool.get());
  w.ghostSeq.set(w.seq.get());
}

/** Starts a stroke at page point (x, y) with pressure p. */
export function wetBegin(w: WetInk, pageIndex: number, x: number, y: number, p: number, style: WetStyle): void {
  'worklet';
  // The previous stroke's picture may not be on screen yet: keep its ink as the ghost.
  if (w.page.get() >= 0) toGhost(w);
  w.seq.set(w.seq.get() + 1);
  w.down.set(true);
  w.page.set(pageIndex);
  w.style.set(style);
  w.color.set(style.color);
  w.tool.set(style.tool);
  w.pts.set([x, y, p]);
  w.state.modify((st) => {
    'worklet';
    wetReset(st);
    return st;
  }, false);
  w.frozen.set(emptyPath());
  resetSides(w);
  stepWet(w);
}

/**
 * Adds a point. Returns the committed part's raw points when the stroke reached WET_MAX_POINTS and was
 * split (the caller commits them; the live stroke continues from the last point), else null.
 */
export function wetAdd(w: WetInk, x: number, y: number, p: number): number[] | null {
  'worklet';
  w.pts.modify((a) => {
    'worklet';
    a.push(x, y, p);
    return a;
  }, false);
  const all = w.pts.get();
  if (wetShouldSplit(all)) {
    const done = all.slice();
    toGhost(w);
    w.seq.set(w.seq.get() + 1);
    w.pts.set(wetCarry(all));
    w.state.modify((st) => {
      'worklet';
      wetReset(st);
      return st;
    }, false);
    w.frozen.set(emptyPath());
    resetSides(w);
    stepWet(w);
    return done;
  }
  stepWet(w);
  return null;
}

/** Replaces the live points (ruler snap, straighten) and redraws. */
export function wetReplace(w: WetInk, pts: number[]): void {
  'worklet';
  w.pts.set(pts);
  w.state.modify((st) => {
    'worklet';
    wetReset(st);
    return st;
  }, false);
  w.frozen.set(emptyPath());
  resetSides(w);
  stepWet(w);
}

/** The pen lifted: the live paths stay until clearWet(seq) (the picture is on screen then). */
export function wetEnd(w: WetInk): void {
  'worklet';
  w.down.set(false);
}

/** Drops the live stroke at once (cancel, or the snap fired). */
export function wetDiscard(w: WetInk): void {
  'worklet';
  w.down.set(false);
  w.page.set(-1);
  w.frozen.set(emptyPath());
  w.tail.set(emptyPath());
  w.pts.set([]);
}

/** Clears the ink of stroke `seq` (live or ghost) once its committed picture is on screen. */
export function clearWet(w: WetInk, seq: number): void {
  'worklet';
  if (w.ghostSeq.get() === seq) {
    w.ghostFrozen.set(emptyPath());
    w.ghostTail.set(emptyPath());
    w.ghostPage.set(-1);
    w.ghostSeq.set(-1);
  }
  if (w.seq.get() === seq && !w.down.get()) {
    w.page.set(-1);
    w.frozen.set(emptyPath());
    w.tail.set(emptyPath());
  }
}

/** Shows the dashed outline of a recognised shape. */
export function setPreview(w: WetInk, c: ShapeCandidate | null): void {
  'worklet';
  if (!c) {
    w.preview.set(emptyPath());
    return;
  }
  const outlines = shapeOutline({ shape: c.kind, pts: c.pts, box: c.box, width: w.style.get().width });
  const b = Skia.PathBuilder.Make();
  for (let i = 0; i < outlines.length; i++) {
    const o = outlines[i];
    if (o.pts.length < 4) continue;
    const part = Skia.Path.MakeFromCmds(polygonToCommands(o.pts, o.closed));
    if (part) b.addPath(part);
  }
  w.preview.set(b.build());
}

/** The pixel eraser path from flat x, y points (page points of page). */
export function setEraserPath(w: WetInk, page: number, pts: number[]): void {
  'worklet';
  w.eraserPage.set(page);
  if (pts.length < 2) {
    w.eraser.set(emptyPath());
    return;
  }
  // A single point still draws a dot: repeat it.
  const poly = pts.length === 2 ? [pts[0], pts[1], pts[0] + 0.01, pts[1]] : pts;
  const p = Skia.Path.MakeFromCmds(polygonToCommands(poly, false));
  w.eraser.set(p ?? emptyPath());
}

export function clearEraserPath(w: WetInk): void {
  'worklet';
  w.eraserPage.set(-1);
  w.eraser.set(emptyPath());
}

/** Shows the shape tool's live preview on page `page` (null hides it). */
export function setShapePreview(w: WetInk, page: number, item: ShapeItem | null): void {
  'worklet';
  if (!item) {
    w.shapePage.set(-1);
    w.shape.set(emptyPath());
    return;
  }
  const o = itemOutline(item);
  const n = o.pts.length;
  let p: SkPath | null = null;
  if (item.shape === 'ellipse' && item.box) {
    const b = Skia.PathBuilder.Make();
    b.addOval(Skia.XYWHRect(item.box.x, item.box.y, item.box.w, item.box.h));
    p = b.build();
  } else if (n >= 4) {
    p = Skia.Path.MakeFromCmds(polygonToCommands(o.pts, o.closed));
  }
  w.shape.set(p ?? emptyPath());
  w.shapeColor.set(item.color);
  w.shapeWidth.set(item.width);
  w.shapePage.set(page);
}

/** Hides the shape preview. */
export function clearShapePreview(w: WetInk): void {
  'worklet';
  w.shapePage.set(-1);
  w.shape.set(emptyPath());
}
