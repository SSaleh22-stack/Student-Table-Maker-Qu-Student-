/**
 * Eraser mirrors of the visible pages (P22, NB-42): per page a core/canvas/eraseMirror.ts mirror (ids,
 * bboxes, offsets, pts, flags) inside ONE shared value keyed by page id, so the stroke eraser hit-tests
 * on the UI runtime with no JS hop.
 *
 * - Built on JS in the page's subscribePage callback. A change that only APPENDS items (a new stroke)
 *   sends just those items to the UI runtime, where they are appended in place; any other change sends
 *   the rebuilt mirror for that page. The record itself is only ever modified on the UI runtime.
 * - Mounted only while the eraser is the tool, for the visible pages +-1. Pages that leave the list are
 *   dropped.
 * - A page above MIRROR_MAX_POINTS gets a `big` mirror (ids only); the canvas then hit-tests on JS at
 *   60 Hz (see PageCanvas eraseSegmentOnJs).
 */
import { useEffect, useRef } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';

import { appendedItems, mirrorAppend, mirrorFromItems, type EraseMirror } from '@/notebook/core/canvas/eraseMirror';
import type { Id, PageItem } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';

export type MirrorRecord = Record<string, EraseMirror>;

function setMirror(sv: SharedValue<MirrorRecord>, pageId: string, m: EraseMirror): void {
  'worklet';
  sv.modify((r) => {
    'worklet';
    r[pageId] = m;
    return r;
  }, false);
}

function appendToMirror(sv: SharedValue<MirrorRecord>, pageId: string, items: PageItem[]): void {
  'worklet';
  sv.modify((r) => {
    'worklet';
    const m = r[pageId];
    if (m) mirrorAppend(m, items);
    else r[pageId] = mirrorFromItems(items);
    return r;
  }, false);
}

function dropMirror(sv: SharedValue<MirrorRecord>, pageId: string): void {
  'worklet';
  sv.modify((r) => {
    'worklet';
    delete r[pageId];
    return r;
  }, false);
}

/** The mirror record (UI runtime reads it from the eraser worklet). */
export function useMirrorStore(): SharedValue<MirrorRecord> {
  return useSharedValue<MirrorRecord>({});
}

/**
 * Keeps mirrors of `pageIds` (visible +-1) in `store` while enabled. Each page is mirrored as soon as
 * it is in memory, and again on every change.
 */
export function usePageMirrors(store: SharedValue<MirrorRecord>, session: NotebookSession, pageIds: readonly Id[], enabled: boolean): void {
  const lastItems = useRef(new Map<Id, readonly PageItem[]>());
  const key = enabled ? pageIds.join('|') : '';

  useEffect(() => {
    const seen = lastItems.current;
    if (!key) {
      for (const pid of seen.keys()) scheduleOnUI(dropMirror, store, pid);
      seen.clear();
      return undefined;
    }
    const ids = key.split('|');
    // Drop the pages that left the list.
    for (const pid of [...seen.keys()]) {
      if (!ids.includes(pid)) {
        seen.delete(pid);
        scheduleOnUI(dropMirror, store, pid);
      }
    }
    const sync = (pid: Id) => {
      const page = session.getPage(pid);
      if (!page) return;
      const prev = seen.get(pid);
      if (prev === page.items) return;
      const added = prev ? appendedItems(prev, page.items) : null;
      seen.set(pid, page.items);
      if (added) {
        if (added.length) scheduleOnUI(appendToMirror, store, pid, added);
      } else {
        scheduleOnUI(setMirror, store, pid, mirrorFromItems(page.items));
      }
    };
    const offs = ids.map((pid) => {
      sync(pid);
      if (!session.getPage(pid)) session.loadPage(pid).catch(() => undefined);
      return session.subscribePage(pid, () => sync(pid));
    });
    return () => {
      for (const off of offs) off();
    };
  }, [key, session, store]);

  // Unmount: drop everything.
  useEffect(() => {
    const seen = lastItems.current;
    return () => {
      for (const pid of seen.keys()) scheduleOnUI(dropMirror, store, pid);
      seen.clear();
    };
  }, [store]);
}
