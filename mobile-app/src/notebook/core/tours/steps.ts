/**
 * Tour steps, pure: which steps can be shown and how they are numbered (NB-T1, NB-T3).
 *
 * A step points at one or more tour targets (ids such as 'lib.search'; core takes them as plain
 * strings). A step whose targets were not measured (not mounted, zero size, or scrolled off screen)
 * is dropped, and the remaining steps are renumbered: with 3 of the 4 library steps available the
 * card reads '1 من 3', '2 من 3', '3 من 3', and the last available step gets 'تم، لنبدأ'.
 *
 * A step with several targets shows the union of the ones that were measured.
 */
import { clipRect, isValidRect, unionAll, type Rect } from './placement.ts';

export interface StepTargets {
  readonly targets: readonly string[];
}

export interface AvailableStep<S extends StepTargets> {
  step: S;
  /** The union of the step's measured targets (clipped to the viewport when one was given). */
  rect: Rect;
  /** 1-based number among the available steps. */
  number: number;
  /** How many steps are available. */
  total: number;
  /** The last available step (its button reads 'تم، لنبدأ'). */
  last: boolean;
}

export type MeasuredTargets = ReadonlyMap<string, Rect | null> | Readonly<Record<string, Rect | null | undefined>>;

function lookup(measured: MeasuredTargets, id: string): Rect | null {
  const v = measured instanceof Map ? measured.get(id) : (measured as Readonly<Record<string, Rect | null | undefined>>)[id];
  return isValidRect(v) ? v : null;
}

/** The union of a step's measured targets, or null when none was measured (or none is on screen). */
export function stepRect(step: StepTargets, measured: MeasuredTargets, viewport?: Rect): Rect | null {
  const rects = step.targets.map((id) => {
    const r = lookup(measured, id);
    if (!r || !viewport) return r;
    return clipRect(r, viewport);
  });
  return unionAll(rects);
}

/**
 * The steps that can be shown, in order, renumbered 1..M (M = the number of available steps).
 * viewport (the window) drops targets that are entirely off screen and clips the rest.
 */
export function availableSteps<S extends StepTargets>(steps: readonly S[], measured: MeasuredTargets, viewport?: Rect): AvailableStep<S>[] {
  const found: { step: S; rect: Rect }[] = [];
  for (const step of steps) {
    const rect = stepRect(step, measured, viewport);
    if (rect) found.push({ step, rect });
  }
  const total = found.length;
  return found.map((f, i) => ({ step: f.step, rect: f.rect, number: i + 1, total, last: i === total - 1 }));
}

/** Every target id the steps use, once each (what the tour waits for and measures). */
export function stepTargetIds(steps: readonly StepTargets[]): string[] {
  const out: string[] = [];
  for (const s of steps) for (const id of s.targets) if (!out.includes(id)) out.push(id);
  return out;
}

/** The step counter text, 'N من M' / 'N of M' (core has no tr(); the UI picks the language). */
export function stepCountLabel(n: number, total: number): { ar: string; en: string } {
  return { ar: `${n} من ${total}`, en: `${n} of ${total}` };
}

/**
 * The welcome card's step count phrase ('خذ جولة سريعة من 4 خطوات'), with Arabic number agreement:
 * 1 'خطوة واحدة', 2 'خطوتين', 3-10 'N خطوات', 11+ 'N خطوة'.
 */
export function stepsPhrase(count: number): { ar: string; en: string } {
  const c = Math.max(0, Math.floor(count));
  let ar: string;
  if (c === 1) ar = 'خطوة واحدة';
  else if (c === 2) ar = 'خطوتين';
  else if (c >= 3 && c <= 10) ar = `${c} خطوات`;
  else ar = `${c} خطوة`;
  return { ar, en: c === 1 ? '1 step' : `${c} steps` };
}

/**
 * Where undo sits relative to redo on screen (the undo step's text, NB-T3 'Undo (right) and redo
 * (left)'). Undo comes first in reading order, so it is on the right in a right-to-left layout and on
 * the left in a left-to-right one. A vertical toolbar (the target clearly taller than wide) puts undo
 * on top.
 */
export type UndoLayout = 'undo-right' | 'undo-left' | 'undo-top';

export function undoLayout(isRTL: boolean, rect?: { width: number; height: number } | null): UndoLayout {
  if (rect && rect.width > 0 && rect.height > rect.width * 1.2) return 'undo-top';
  return isRTL ? 'undo-right' : 'undo-left';
}
