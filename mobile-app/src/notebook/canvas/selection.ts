/**
 * The selection store (P04, real): which items are selected, on which page. One module store for the
 * editor; the lasso (P27), the text tool (P28) and the canvas (P22) share it.
 *
 * - getSelection(): the SelectionApi outside React (pageId and ids always read the latest state).
 * - useSelection(): the same API, re-rendering on change. It returns a NEW object per change (cached per
 *   version), so React Compiler memoization sees the change.
 * - getSnapshot() is cached: the same object until the selection changes (useSyncExternalStore safe).
 * - drag and hidden are shared values for the UI runtime (see contracts/canvas.ts). clear() does not
 *   touch them: whoever writes them resets them.
 *
 * select/clear are JS-only (from a worklet: scheduleOnRN).
 */
import { useSyncExternalStore } from 'react';
import { makeMutable } from 'react-native-reanimated';

import type { SelectionApi, SelectionSnapshot } from '@/notebook/contracts/canvas';
import type { Id } from '@/notebook/core/model';

export type { SelectionApi, SelectionSnapshot } from '@/notebook/contracts/canvas';

const EMPTY: readonly Id[] = Object.freeze([]);

let snapshot: SelectionSnapshot = Object.freeze({ pageId: null, ids: EMPTY, version: 0 });
const listeners = new Set<() => void>();

const drag = makeMutable<number[]>([]);
const hidden = makeMutable<string[]>([]);

function sameIds(a: readonly Id[], b: readonly Id[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const id of b) if (!set.has(id)) return false;
  return true;
}

function emit(): void {
  for (const cb of [...listeners]) cb();
}

function setState(pageId: Id | null, ids: readonly Id[]): void {
  const unique = ids.length ? [...new Set(ids)] : EMPTY;
  if (snapshot.pageId === pageId && sameIds(snapshot.ids, unique)) return;
  snapshot = Object.freeze({ pageId, ids: unique.length ? Object.freeze(unique) : EMPTY, version: snapshot.version + 1 });
  emit();
}

function select(pageId: Id, ids: readonly Id[]): void {
  if (!ids.length) setState(null, EMPTY);
  else setState(pageId, ids);
}

function clear(): void {
  setState(null, EMPTY);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): SelectionSnapshot {
  return snapshot;
}

const api: SelectionApi = {
  get pageId() {
    return snapshot.pageId;
  },
  get ids() {
    return snapshot.ids;
  },
  get version() {
    return snapshot.version;
  },
  select,
  clear,
  subscribe,
  getSnapshot,
  drag,
  hidden,
};

/** The selection outside React (always the latest state). */
export function getSelection(): SelectionApi {
  return api;
}

/** Removes ids that no longer exist (after an undo or a delete); clears when none are left. */
export function pruneSelection(exists: (id: Id) => boolean): void {
  const { pageId, ids } = snapshot;
  if (!pageId || !ids.length) return;
  const kept = ids.filter(exists);
  if (kept.length !== ids.length) select(pageId, kept);
}

// One API object per snapshot, so components see a new value when the selection changes.
let viewFor: SelectionSnapshot | null = null;
let view: SelectionApi = api;

function viewOf(s: SelectionSnapshot): SelectionApi {
  if (viewFor !== s) {
    viewFor = s;
    view = { pageId: s.pageId, ids: s.ids, version: s.version, select, clear, subscribe, getSnapshot, drag, hidden };
  }
  return view;
}

export function useSelection(): SelectionApi {
  return viewOf(useSyncExternalStore(subscribe, getSnapshot, getSnapshot));
}
