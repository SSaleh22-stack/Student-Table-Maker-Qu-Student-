/**
 * The lasso tool (P27, NB-43): draw a loop around ink, shapes, text and images to select them.
 *
 * useSelectionTool(ctx) returns the 'lasso' ToolPlugin:
 * - handler (JS, called by the canvas through scheduleOnRN):
 *   - onBegin / onUpdate / onEnd draw the lasso polygon (dashed accent, drawn by SelectionOverlay),
 *     then core/ink/lasso.ts selectByLasso picks the items and the selection store selects them.
 *   - onTap on an item selects it; on empty space it clears the selection, or (nothing selected and the
 *     clipboard filled) shows the 'لصق' menu at that point. onLongPress on empty space shows 'لصق'.
 * - overlay: <SelectionOverlay/> (lasso path, dashed frame with 8 handles, rotate handle, size chip and
 *   the selection menu). It shows for ANY selection, whatever the current tool, so the editor must
 *   render this overlay all the time, not only while the lasso is the tool.
 *
 * Selection housekeeping (module-level, no re-render of the editor):
 * - the selection is cleared when the editor mounts and unmounts, and when the tool changes to
 *   anything but the lasso;
 * - while another tool is active, a page change that ADDS an item outside the selection (a new pen
 *   stroke after a shape snap, say) clears it;
 * - ids that disappear (undo, eraser) are pruned.
 *
 * The lasso polygon and the paste menu live in small module stores (lassoStore, pasteMenuStore, defined
 * in SelectionOverlay.tsx and re-exported here) that only SelectionOverlay subscribes to, so a 60 Hz
 * lasso never re-renders the editor.
 */
import { createElement, useEffect, useMemo } from 'react';

import type { PagePoint, ToolContext, ToolPlugin, UseSelectionTool } from '@/notebook/contracts/tools';
import { getSelection, pruneSelection } from '@/notebook/canvas/selection';
import { selectByLasso } from '@/notebook/core/ink/lasso';
import type { Id } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { itemAt } from '@/notebook/core/tools/selection';
import { notebookClipboard } from '@/notebook/store/hooks';
import { getToolState, subscribeToolState } from '@/notebook/toolbar/toolState';

import { SelectionOverlay, closePasteMenu, lassoStore, pasteMenuStore } from './SelectionOverlay';

export {
  closePasteMenu,
  lassoStore,
  pasteMenuStore,
  useLassoPath,
  usePasteMenu,
  type LassoPath,
  type PasteMenuAt,
} from './SelectionOverlay';

/** Lasso points closer than this to the previous one are skipped (page points). */
const LASSO_STEP = 1.5;
/** How close a tap must be to an item to select it (page points). */
export const TAP_RADIUS = 8;

// ===== handler

function pageOf(session: NotebookSession, pageId: Id) {
  return session.notebook.pageIds.includes(pageId) ? session.getPage(pageId) : undefined;
}

function makeHandler(session: NotebookSession) {
  const showPaste = (p: PagePoint) => {
    if (!notebookClipboard.get() || session.readOnly) return false;
    pasteMenuStore.set({ pageId: p.pageId, x: p.x, y: p.y });
    return true;
  };
  return {
    onBegin(p: PagePoint) {
      closePasteMenu();
      getSelection().clear();
      lassoStore.set({ pageId: p.pageId, pts: [p.x, p.y] });
    },
    onUpdate(p: PagePoint) {
      const cur = lassoStore.get();
      if (!cur || cur.pageId !== p.pageId) return;
      const n = cur.pts.length;
      const dx = p.x - cur.pts[n - 2];
      const dy = p.y - cur.pts[n - 1];
      if (dx * dx + dy * dy < LASSO_STEP * LASSO_STEP) return;
      lassoStore.set({ pageId: cur.pageId, pts: [...cur.pts, p.x, p.y] });
    },
    onEnd(p: PagePoint, cancelled: boolean) {
      const cur = lassoStore.get();
      lassoStore.set(null);
      if (!cur || cancelled) return;
      const pts = p.pageId === cur.pageId ? [...cur.pts, p.x, p.y] : cur.pts;
      const page = pageOf(session, cur.pageId);
      if (!page) return;
      const ids = selectByLasso(page.items, pts);
      if (ids.length) getSelection().select(cur.pageId, ids);
      else getSelection().clear();
    },
    onTap(p: PagePoint) {
      closePasteMenu();
      const page = pageOf(session, p.pageId);
      const hit = page ? itemAt(page.items, p.x, p.y, TAP_RADIUS) : null;
      if (hit) {
        getSelection().select(p.pageId, [hit.id]);
        return;
      }
      const had = getSelection().ids.length > 0;
      getSelection().clear();
      if (!had) showPaste(p);
    },
    onLongPress(p: PagePoint) {
      closePasteMenu();
      const page = pageOf(session, p.pageId);
      const hit = page ? itemAt(page.items, p.x, p.y, TAP_RADIUS) : null;
      if (hit) {
        getSelection().select(p.pageId, [hit.id]);
        return;
      }
      getSelection().clear();
      showPaste(p);
    },
  };
}

/** Resets everything the selection overlay drives (selection, live drag, hidden ids, lasso, menus). */
export function resetSelectionUi(): void {
  const sel = getSelection();
  sel.clear();
  sel.drag.set([]);
  sel.hidden.set([]);
  lassoStore.set(null);
  closePasteMenu();
}

export const useSelectionTool: UseSelectionTool = (ctx: ToolContext): ToolPlugin => {
  const { session, hand } = ctx;

  // Fresh selection per editor visit; nothing survives the editor.
  useEffect(() => {
    resetSelectionUi();
    return resetSelectionUi;
  }, [session]);

  // Changing to another tool drops the selection (the lasso keeps it).
  useEffect(() => {
    let tool = getToolState().state.tool;
    return subscribeToolState(() => {
      const next = getToolState().state.tool;
      if (next === tool) return;
      tool = next;
      lassoStore.set(null);
      closePasteMenu();
      if (next !== 'lasso') getSelection().clear();
    });
  }, []);

  // Watch the selected page: prune vanished ids; another tool adding an item ends the selection.
  useEffect(() => {
    const sel = getSelection();
    let pageId: Id | null = null;
    /** The page's item ids at the last look (null until the page is in memory). */
    let known: Set<Id> | null = null;
    let unsubPage: (() => void) | null = null;

    const idsOf = (pid: Id): Set<Id> | null => {
      const pg = session.getPage(pid);
      return pg ? new Set(pg.items.map((i) => i.id)) : null;
    };

    const onPage = () => {
      if (!pageId) return;
      const page = session.getPage(pageId);
      if (!page) return;
      const now = new Set(page.items.map((i) => i.id));
      if (!known) {
        // First look at this page (it was still loading): nothing to compare with.
        known = now;
        pruneSelection((id) => now.has(id));
        return;
      }
      const selected = new Set(sel.ids);
      const tool = getToolState().state.tool;
      let foreignAdd = false;
      for (const id of now) {
        if (!known.has(id) && !selected.has(id)) {
          foreignAdd = true;
          break;
        }
      }
      known = now;
      if (foreignAdd && tool !== 'lasso' && sel.ids.length) {
        sel.clear();
        return;
      }
      pruneSelection((id) => now.has(id));
    };

    const follow = () => {
      const next = sel.pageId;
      if (next && !session.notebook.pageIds.includes(next)) {
        // A selection from another notebook (or a deleted page).
        sel.clear();
        return;
      }
      if (next === pageId) return;
      unsubPage?.();
      unsubPage = null;
      pageId = next;
      if (pageId) {
        known = idsOf(pageId);
        unsubPage = session.subscribePage(pageId, onPage);
      }
    };

    follow();
    const unsubSel = sel.subscribe(follow);
    const unsubSession = session.subscribe(() => {
      // Pages deleted or moved away.
      if (pageId && !session.notebook.pageIds.includes(pageId)) sel.clear();
    });
    return () => {
      unsubSel();
      unsubSession();
      unsubPage?.();
    };
  }, [session]);

  return useMemo<ToolPlugin>(() => {
    const handler = makeHandler(session);
    return {
      tool: 'lasso',
      handler,
      overlay: createElement(SelectionOverlay, { session, hand }),
      onActivate() {
        closePasteMenu();
      },
      onDeactivate() {
        lassoStore.set(null);
        closePasteMenu();
      },
    };
  }, [session, hand]);
};
