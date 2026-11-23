/**
 * Tool state (P13): the current tool and its options, shared by the toolbar, the canvas (P22) and the
 * tool hooks (P27, P28). Implements contracts/tools.ts UseToolState / GetToolState.
 *
 *   const { state, actions } = useToolState();   // re-renders on every change; actions are stable
 *   getToolState()                               // the same outside React (latest values)
 *
 * - Module singleton, initialized from the notebook settings the first time it is read.
 * - It persists ONLY its own fields, through the settings store's deep merge, debounced 500 ms:
 *   { pen: { color, widthIndex } }, { highlighter: { color, widthIndex, straight } },
 *   { eraser: { mode, highlighterOnly, size } } and { shapeSnap }. Several changes inside the window are
 *   merged into one write. flushToolState() writes a pending change right away (the editor calls it
 *   when it unmounts).
 * - The current tool, the last tool, the ruler and the shape kind are NOT persisted: every editor visit
 *   starts with the pen.
 * - `pressure` mirrors settings.pressure (the pen options switch writes the setting directly).
 * - When the settings change elsewhere (they finish loading, the settings screen changes them), the
 *   mirrored fields follow, except a field this module is still about to write.
 * - 'image' is not a tool: it is an action (Toolbar.onImage).
 */
import { useSyncExternalStore } from 'react';

import { HL_WIDTHS, PEN_WIDTHS, type DeepPartial, type NotebookSettings } from '@/notebook/core/model';
import type { GetToolState, ToolActions, ToolId, ToolState, ToolStateHandle, UseToolState } from '@/notebook/contracts/tools';
import { settingsStore } from '@/notebook/store/settingsStore';

/** Debounce of the settings write. */
export const TOOL_PERSIST_MS = 500;

type Persisted = 'pen' | 'highlighter' | 'eraser' | 'shapeSnap';

function nearestIndex(widths: readonly number[], w: number): number {
  let best = 0;
  for (let i = 1; i < widths.length; i++) if (Math.abs(widths[i] - w) < Math.abs(widths[best] - w)) best = i;
  return best;
}

function widthAt(widths: readonly number[], index: number): number {
  const i = Number.isInteger(index) ? Math.min(widths.length - 1, Math.max(0, index)) : 0;
  return widths[i];
}

/** The preset matching a color and width, or null. */
function matchPreset(s: NotebookSettings, color: string, width: number): number | null {
  const i = s.pen.presets.findIndex((p) => p.color.toUpperCase() === color.toUpperCase() && p.width === width);
  return i >= 0 ? i : null;
}

function fromSettings(s: NotebookSettings, base?: ToolState): ToolState {
  const penWidth = widthAt(PEN_WIDTHS, s.pen.widthIndex);
  return {
    tool: base?.tool ?? 'pen',
    lastTool: base?.lastTool ?? 'pen',
    rulerOn: base?.rulerOn ?? false,
    pen: { color: s.pen.color, width: penWidth, presetIndex: matchPreset(s, s.pen.color, penWidth) },
    highlighter: { color: s.highlighter.color, width: widthAt(HL_WIDTHS, s.highlighter.widthIndex), straight: s.highlighter.straight },
    eraser: { mode: s.eraser.mode, highlighterOnly: s.eraser.highlighterOnly, size: s.eraser.size },
    shapeKind: base?.shapeKind ?? 'rect',
    shapeSnap: s.shapeSnap,
    pressure: s.pressure,
  };
}

let state: ToolState | null = null;
let lastSettings: NotebookSettings | null = null;
const listeners = new Set<() => void>();
/** Fields changed here and not yet written to the settings. */
const dirty = new Set<Persisted>();
let timer: ReturnType<typeof setTimeout> | null = null;
let settingsUnsub: (() => void) | null = null;

function notify(): void {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      // One listener failing never stops the others.
    }
  }
}

/** Follows outside settings changes for the fields that are not about to be written. */
function onSettings(): void {
  const s = settingsStore.getSnapshot();
  if (!state || s === lastSettings) return;
  lastSettings = s;
  const fresh = fromSettings(s, state);
  // A width that is not one of the steps (an old preset) stays as long as it maps to the same step.
  const penSame = state.pen.color === s.pen.color && nearestIndex(PEN_WIDTHS, state.pen.width) === s.pen.widthIndex;
  const hlSame =
    state.highlighter.color === s.highlighter.color &&
    state.highlighter.straight === s.highlighter.straight &&
    nearestIndex(HL_WIDTHS, state.highlighter.width) === s.highlighter.widthIndex;
  const next: ToolState = {
    ...state,
    pen: dirty.has('pen') || penSame ? { ...state.pen, presetIndex: matchPreset(s, state.pen.color, state.pen.width) } : fresh.pen,
    highlighter: dirty.has('highlighter') || hlSame ? state.highlighter : fresh.highlighter,
    eraser: dirty.has('eraser') ? state.eraser : fresh.eraser,
    shapeSnap: dirty.has('shapeSnap') ? state.shapeSnap : fresh.shapeSnap,
    pressure: fresh.pressure,
  };
  if (
    next.pen.color === state.pen.color &&
    next.pen.width === state.pen.width &&
    next.pen.presetIndex === state.pen.presetIndex &&
    next.highlighter === state.highlighter &&
    next.eraser === state.eraser &&
    next.shapeSnap === state.shapeSnap &&
    next.pressure === state.pressure
  ) {
    return;
  }
  // Keep the unchanged parts' identity (memo deps on state.highlighter … stay stable).
  if (
    next.highlighter.color === state.highlighter.color &&
    next.highlighter.width === state.highlighter.width &&
    next.highlighter.straight === state.highlighter.straight
  ) {
    next.highlighter = state.highlighter;
  }
  if (
    next.eraser.mode === state.eraser.mode &&
    next.eraser.highlighterOnly === state.eraser.highlighterOnly &&
    next.eraser.size === state.eraser.size
  ) {
    next.eraser = state.eraser;
  }
  state = next;
  notify();
}

function current(): ToolState {
  if (!state) {
    lastSettings = settingsStore.getSnapshot();
    state = fromSettings(lastSettings);
    settingsUnsub = settingsStore.subscribe(onSettings);
  }
  return state;
}

function patchFor(s: ToolState, fields: Iterable<Persisted>): DeepPartial<NotebookSettings> {
  const p: DeepPartial<NotebookSettings> = {};
  for (const f of fields) {
    if (f === 'pen') p.pen = { color: s.pen.color, widthIndex: nearestIndex(PEN_WIDTHS, s.pen.width) };
    else if (f === 'highlighter')
      p.highlighter = {
        color: s.highlighter.color,
        widthIndex: nearestIndex(HL_WIDTHS, s.highlighter.width),
        straight: s.highlighter.straight,
      };
    else if (f === 'eraser') p.eraser = { mode: s.eraser.mode, highlighterOnly: s.eraser.highlighterOnly, size: s.eraser.size };
    else p.shapeSnap = s.shapeSnap;
  }
  return p;
}

/** Writes the pending fields now (no-op when nothing is pending). */
export function flushToolState(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!state || dirty.size === 0) return;
  const patch = patchFor(state, dirty);
  dirty.clear();
  settingsStore.set(patch);
  lastSettings = settingsStore.getSnapshot();
}

function schedule(field: Persisted): void {
  dirty.add(field);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    flushToolState();
  }, TOOL_PERSIST_MS);
}

function commit(next: ToolState, persist?: Persisted): void {
  state = next;
  if (persist) schedule(persist);
  notify();
}

const actions: ToolActions = {
  setTool(t: ToolId) {
    const s = current();
    if (s.tool === t) return;
    commit({ ...s, tool: t, lastTool: s.tool });
  },
  toggleEraser(mode: 'eraser' | 'lastTool') {
    const s = current();
    if (mode === 'eraser') {
      if (s.tool === 'eraser') commit({ ...s, tool: s.lastTool === 'eraser' ? 'pen' : s.lastTool, lastTool: 'eraser' });
      else commit({ ...s, tool: 'eraser', lastTool: s.tool });
      return;
    }
    if (s.lastTool === s.tool) return;
    commit({ ...s, tool: s.lastTool, lastTool: s.tool });
  },
  setPen(p) {
    const s = current();
    const color = p.color ?? s.pen.color;
    const width = p.width !== undefined && Number.isFinite(p.width) && p.width > 0 ? p.width : s.pen.width;
    const presetIndex = p.presetIndex !== undefined ? p.presetIndex : matchPreset(settingsStore.getSnapshot(), color, width);
    if (color === s.pen.color && width === s.pen.width && presetIndex === s.pen.presetIndex) return;
    commit({ ...s, pen: { color, width, presetIndex } }, 'pen');
  },
  setHighlighter(p) {
    const s = current();
    const next = { ...s.highlighter, ...p };
    if (!(next.width > 0)) next.width = s.highlighter.width;
    const h = s.highlighter;
    if (next.color === h.color && next.width === h.width && next.straight === h.straight) return;
    commit({ ...s, highlighter: next }, 'highlighter');
  },
  setEraser(p) {
    const s = current();
    const next = { ...s.eraser, ...p };
    const e = s.eraser;
    if (next.mode === e.mode && next.highlighterOnly === e.highlighterOnly && next.size === e.size) return;
    commit({ ...s, eraser: next }, 'eraser');
  },
  setShapeKind(k) {
    const s = current();
    if (s.shapeKind === k) return;
    commit({ ...s, shapeKind: k });
  },
  toggleRuler() {
    const s = current();
    commit({ ...s, rulerOn: !s.rulerOn });
  },
  setShapeSnap(on: boolean) {
    const s = current();
    if (s.shapeSnap === on) return;
    commit({ ...s, shapeSnap: on }, 'shapeSnap');
  },
};

let handle: ToolStateHandle | null = null;

function getHandle(): ToolStateHandle {
  const s = current();
  if (!handle || handle.state !== s) handle = { state: s, actions };
  return handle;
}

function subscribe(cb: () => void): () => void {
  current();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Tool state and its stable actions; re-renders on every change. */
export const useToolState: UseToolState = () => useSyncExternalStore(subscribe, getHandle, getHandle);

/** Tool state outside React (latest values). */
export const getToolState: GetToolState = () => getHandle();

/** The stable actions object (same as useToolState().actions). */
export const toolActions: ToolActions = actions;

/** Subscribe outside React; returns the unsubscribe. */
export function subscribeToolState(cb: () => void): () => void {
  return subscribe(cb);
}

/**
 * Starts a fresh editor visit: the pen is selected again, the ruler is off, and the options are
 * re-read from the settings (pending writes are flushed first).
 */
export function resetToolSession(): void {
  flushToolState();
  if (!state) return;
  lastSettings = settingsStore.getSnapshot();
  commit(fromSettings(lastSettings));
}

/** Tests and hot reload: forget the state and the settings subscription. */
export function disposeToolState(): void {
  flushToolState();
  settingsUnsub?.();
  settingsUnsub = null;
  state = null;
  handle = null;
  lastSettings = null;
}
