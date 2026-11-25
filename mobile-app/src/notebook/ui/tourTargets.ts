/**
 * Tour target registry (contracts/tours.ts): screens mark the views a tour step points at, and the
 * tours (P15) measure them in window coordinates.
 *
 *   const ref = useTourTarget(TOUR_TARGETS.libSearch);
 *   <View ref={ref} collapsable={false}>…</View>
 *
 * - The registry is a module singleton keyed by target id. A component can attach several views under
 *   different ids (lib.search and lib.headerActions), and a step can union several ids with
 *   measureTargets([...]).
 * - When two mounted views use the same id (a screen pushed over another), the latest one wins; when
 *   it unmounts the earlier one is used again.
 * - Android: give the target view collapsable={false}, or a layout-only View may be flattened away and
 *   never reach the ref.
 */
import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';

import type { MeasurableNode, MeasureTarget, TourRect, TourTargetId, UseTourTarget } from '@/notebook/contracts/tours';

export type { MeasurableNode, TourRect, TourTargetId } from '@/notebook/contracts/tours';

/** measureInWindow normally answers on the next frame; give up after this long. */
const MEASURE_TIMEOUT_MS = 600;

const registry = new Map<TourTargetId, MeasurableNode[]>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of [...listeners]) cb();
}

/** Attaches a node to an id directly (for code that cannot use the hook). Returns the detach. */
export function attachTourTarget(id: TourTargetId, node: MeasurableNode): () => void {
  const list = registry.get(id) ?? [];
  if (!list.includes(node)) {
    registry.set(id, [...list, node]);
    emit();
  }
  return () => detachTourTarget(id, node);
}

function detachTourTarget(id: TourTargetId, node: MeasurableNode): void {
  const list = registry.get(id);
  if (!list || !list.includes(node)) return;
  const rest = list.filter((n) => n !== node);
  if (rest.length) registry.set(id, rest);
  else registry.delete(id);
  emit();
}

/** A stable ref callback that registers the element under id while it is mounted. */
export const useTourTarget: UseTourTarget = (id) => {
  const attached = useRef<{ id: TourTargetId; node: MeasurableNode } | null>(null);
  return useCallback(
    (node: MeasurableNode | null) => {
      const prev = attached.current;
      if (prev && (prev.node !== node || prev.id !== id)) {
        detachTourTarget(prev.id, prev.node);
        attached.current = null;
      }
      if (node && !attached.current) {
        attachTourTarget(id, node);
        attached.current = { id, node };
      }
    },
    [id],
  );
};

/** Whether a view is currently attached under id. */
export function hasTourTarget(id: TourTargetId): boolean {
  return (registry.get(id)?.length ?? 0) > 0;
}

/** Called whenever a target is attached or detached (tours re-measure then). */
export function subscribeTourTargets(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function measureNode(node: MeasurableNode): Promise<TourRect | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, MEASURE_TIMEOUT_MS);
    const answer = (x: number, y: number, width: number, height: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const ok = [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0;
      resolve(ok ? { x, y, width, height } : null);
    };
    try {
      // Android draws edge to edge, and so does the tour's full-screen Modal (statusBarTranslucent),
      // but measureInWindow there leaves out the status bar: every spotlight sat a status bar's
      // height too high, half off its button. measure()'s pageX / pageY count from the root view,
      // which is the top of the screen, the same origin the Modal draws from.
      if (Platform.OS === 'android' && typeof node.measure === 'function') {
        node.measure((_x, _y, width, height, pageX, pageY) => answer(pageX, pageY, width, height));
      } else {
        node.measureInWindow(answer);
      }
    } catch {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** The target's rect in window coordinates, or null when it is not mounted or has no size. */
export const measureTarget: MeasureTarget = async (id) => {
  const list = registry.get(id);
  const node = list?.[list.length - 1];
  return node ? measureNode(node) : null;
};

/** The smallest rect holding a and b. */
export function unionRects(a: TourRect, b: TourRect): TourRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** The union of every measurable target among ids (a step that spans several targets); null if none. */
export async function measureTargets(ids: readonly TourTargetId[]): Promise<TourRect | null> {
  const rects = await Promise.all(ids.map((id) => measureTarget(id)));
  let out: TourRect | null = null;
  for (const r of rects) if (r) out = out ? unionRects(out, r) : r;
  return out;
}
