/**
 * Coordinates (checked by P30 against P22 useCanvasApi.ts and OverlayHost.tsx): pageOrigin / toScreen /
 * toPage are in the canvas view's own coordinates, which are also the OverlayHost's. This overlay's
 * root (an absolute-fill child of OverlayHost) shares them. Touch points from RNGH are window
 * coordinates, so the root measures its window origin (measureInWindow) for the rotate handle; moves
 * and resizes only use deltas. Handles also capture scale / tx / ty explicitly so their animated styles
 * re-run on zoom and scroll; pageOrigin should not depend on other shared values.
 *
 * The selection overlay (P27, NB-43 / NB-47): everything the lasso tool draws above the page.
 * - The lasso polygon while it is drawn (dashed accent, accent fill at 0.06).
 * - For ANY selection, whatever the tool: SelectionHandles (dashed frame, 8 handles, rotate handle,
 *   size chip while moving or resizing) and, when no handle is held, the SelectionMenu placed above
 *   the selection and shifted away from the writing hand. A tap on the selection hides / shows it.
 * - The 'لصق' card where the student tapped or long-pressed empty space with the clipboard filled.
 * - The live drag preview: while a handle is held the canvas skips selection.hidden, and DragPreview
 *   draws those items under selection.drag (a Skia picture of the selection, recorded when it
 *   changes), so the canvas itself never has to draw the dragged items.
 *
 * Commits (JS, each ONE undo step): a handle release applies core/ink/transform applyMatrixToItems
 * with the handle's options and calls session.updateItems; a move dropped over another page removes the
 * items there and adds them on the target page inside one beginGroup / endGroup. Recolor, presets and
 * delete are single updateItems / removeItems calls. Copy and cut go through the store clipboard
 * (assets staged at that moment, so a paste works in another notebook after this one closes); cut
 * removes the items only after the copy succeeded.
 *
 * The module stores the lasso tool writes (lassoStore, pasteMenuStore) are defined here, so the tool
 * hook and this overlay never import each other in a cycle.
 */
import { Canvas, Group, Picture, Skia, type SkPicture } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useAnimatedReaction, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { getLang, tr } from '@/lib/i18n';
import { useOverlay } from '@/notebook/canvas/overlayContext';
import { getSelection, useSelection } from '@/notebook/canvas/selection';
import { inflateBounds } from '@/notebook/core/ink/bounds';
import { matIsIdentity, matMultiply } from '@/notebook/core/ink/matrix';
import { applyMatrixToItems } from '@/notebook/core/ink/transform';
import type { Hex, Id, Page, PageItem } from '@/notebook/core/model';
import {
  assetImageDecoder,
  assetImageKey,
  disposeLater,
  loadImage,
  paintInkLayer,
  paintUnderLayer,
  peekImage,
  useNotebookFonts,
  type PaintContext,
} from '@/notebook/ink';
import type { NotebookSession } from '@/notebook/core/session/types';
import {
  handleKind,
  isHighlighterSelection,
  pageToPageMatrix,
  pasteOffset,
  presetScale,
  recolorItems,
  selectionBounds,
  selectionColor,
  selectionFrame,
  sizeChipText,
  transformFrame,
  transformOptionsFor,
  type HandleId,
  type SelFrame,
} from '@/notebook/core/tools/selection';
import { notebookClipboard, useNotebookClipboard, usePage } from '@/notebook/store/hooks';
import { nbColors } from '@/notebook/theme';
import { showToast } from '@/notebook/ui';

import { requestImageCrop } from '../image/useImageTool';
import { fitTextBox } from '../text/useTextTool';
import { ROTATE_DISTANCE, SelectionHandles, frameOf, liveScreenFrame } from './SelectionHandles';
import { FloatingMenu, PasteMenu, SelectionMenu } from './SelectionMenu';

// ===== module stores written by the lasso tool (useSelectionTool)

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (next === value) return;
      value = next;
      for (const cb of [...listeners]) cb();
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

export interface LassoPath {
  pageId: Id;
  /** Flat x, y page points. */
  pts: number[];
}

/** The lasso being drawn (null when none). A new object per change. */
export const lassoStore = createStore<LassoPath | null>(null);

export interface PasteMenuAt {
  pageId: Id;
  x: number;
  y: number;
}

/** Where the 'لصق' menu is open (null when closed). */
export const pasteMenuStore = createStore<PasteMenuAt | null>(null);

export function useLassoPath(): LassoPath | null {
  return useSyncExternalStore(lassoStore.subscribe, lassoStore.get, lassoStore.get);
}

export function usePasteMenu(): PasteMenuAt | null {
  return useSyncExternalStore(pasteMenuStore.subscribe, pasteMenuStore.get, pasteMenuStore.get);
}

export function closePasteMenu(): void {
  pasteMenuStore.set(null);
}

// ===== live drag preview

/** A 3x3 row-major matrix that puts the preview far off screen (it is also transparent then). */
const OFF_MATRIX = [1, 0, -100000, 0, 1, -100000, 0, 0, 1];

/**
 * The selected items recorded as ONE picture in page points, drawn in the page's order (images, the
 * highlighter group at its alpha, then ink). JS only; the caller disposes it with disposeLater.
 */
function recordSelection(session: NotebookSession, page: Page, items: PageItem[], fonts: PaintContext['fonts']): SkPicture | null {
  const b = selectionBounds(items);
  if (!b) return null;
  const r = inflateBounds(b, 64);
  const ctx: PaintContext = {
    image: (fileId) => peekImage(assetImageKey(session.id, fileId)),
    pdfPreview: () => null,
    fonts,
  };
  const sub: Page = { ...page, items };
  const rec = Skia.PictureRecorder();
  try {
    const c = rec.beginRecording(Skia.XYWHRect(r[0], r[1], Math.max(1, r[2] - r[0]), Math.max(1, r[3] - r[1])));
    paintUnderLayer(c, sub, ctx);
    paintInkLayer(c, sub, ctx);
    return rec.finishRecordingAsPicture();
  } catch {
    return null;
  } finally {
    rec.dispose();
  }
}

/**
 * While a handle is held, the canvas skips the selected ids (selection.hidden) and this draws them
 * under selection.drag instead, on the UI thread, so they follow the finger at 60 Hz. The picture is
 * recorded when the selection changes (not at the start of a drag), so the first dragged frame
 * already has it; it is transparent whenever no handle is held.
 */
function DragPreview({ session, page, items }: { session: NotebookSession; page: Page; items: PageItem[] }) {
  const { scale, tx, ty, pageOrigin } = useOverlay();
  const { drag } = getSelection();
  const fonts = useNotebookFonts();
  /** Bumped when a selected image finished decoding, so the picture is recorded again with it. */
  const [imagesReady, setImagesReady] = useState(0);

  // A selected image that is not decoded yet (a photo inserted a moment ago) would be a grey
  // placeholder in the preview: load it through the budget, then record again.
  useEffect(() => {
    let alive = true;
    const missing = new Set<Id>();
    for (const it of items) {
      if (it.kind === 'image' && !peekImage(assetImageKey(session.id, it.fileId))) missing.add(it.fileId);
    }
    if (!missing.size) return;
    Promise.all(
      [...missing].map((fileId) => loadImage(assetImageKey(session.id, fileId), 'asset', assetImageDecoder(session, fileId)).catch(() => null)),
    ).then((imgs) => {
      if (alive && imgs.some((i) => !!i)) setImagesReady((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [session, items]);

  const picture = useMemo(
    () => (imagesReady >= 0 ? recordSelection(session, page, items, fonts) : null),
    [session, page, items, fonts, imagesReady],
  );
  useEffect(() => () => disposeLater(picture), [picture]);
  const pageId = page.id;

  const matrix = useDerivedValue(() => {
    scale.get();
    tx.get();
    ty.get();
    const d = drag.get();
    const o = pageOrigin(pageId);
    if (!o || d.length !== 6) return OFF_MATRIX;
    const k = o.k;
    // screen = T(origin) · S(k) · drag, as Skia's row-major 3x3.
    return [k * d[0], k * d[2], k * d[4] + o.x, k * d[1], k * d[3], k * d[5] + o.y, 0, 0, 1];
  }, [pageId, pageOrigin]);
  const opacity = useDerivedValue(() => (drag.get().length === 6 ? 1 : 0));

  if (!picture) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Group matrix={matrix} opacity={opacity}>
          <Picture picture={picture} />
        </Group>
      </Canvas>
    </View>
  );
}

// ===== helpers

const frameArr = (f: SelFrame | null): number[] => (f ? [f.cx, f.cy, f.w, f.h, f.rot] : []);

const LABELS: Record<string, string> = { move: 'move', corner: 'resize', edge: 'resize', rotate: 'rotate' };

/** The rect the menu avoids: the frame on screen plus the rotate handle and the size chip. */
const MENU_MARGIN = ROTATE_DISTANCE + 14;

export interface SelectionOverlayProps {
  session: NotebookSession;
  hand: 'right' | 'left';
}

export function SelectionOverlay({ session, hand }: SelectionOverlayProps) {
  const sel = useSelection();
  const { scale, tx, ty, pageOrigin, toScreen, toPage } = useOverlay();
  const { drag, hidden } = getSelection();
  const clipboard = useNotebookClipboard();
  const lasso = useLassoPath();
  const paste = usePasteMenu();

  const pageId = sel.pageId && session.notebook.pageIds.includes(sel.pageId) ? sel.pageId : null;
  const page = usePage(session, pageId);
  const ids = sel.ids;
  const items = useMemo(() => {
    if (!page || !ids.length) return [] as PageItem[];
    const set = new Set(ids);
    return page.items.filter((i) => set.has(i.id));
  }, [page, ids]);
  const frame = useMemo(() => selectionFrame(items), [items]);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState<HandleId | null>(null);
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);
  /** The selection version whose menu the student hid with a tap. */
  const [menuHiddenFor, setMenuHiddenFor] = useState(-1);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<ComponentRef<typeof View>>(null);

  // Shared copies for the UI thread. Rendering writes them only when they change.
  const frameSV = useSharedValue<number[]>([]);
  const pageSV = useSharedValue('');
  const origin = useSharedValue<number[]>([0, 0]);
  // Follow the selection (a held handle keeps its start frame; its commit sets the new one).
  useEffect(() => {
    if (drag.get().length === 6) return;
    frameSV.set(frameArr(frame));
    pageSV.set(pageId ?? '');
  }, [frame, pageId, drag, frameSV, pageSV]);

  // The rotate handle turns window touch points into overlay px with this origin. onLayout only
  // fires when the overlay changes inside its parent, so measure again for every new selection (the
  // editor's bars or a docked panel may have moved the canvas meanwhile).
  const hasFrame = !!frame;
  useEffect(() => {
    if (!hasFrame) return;
    rootRef.current?.measureInWindow((x, y) => {
      if (Number.isFinite(x) && Number.isFinite(y)) origin.set([x, y]);
    });
  }, [hasFrame, sel.version, origin]);

  // Live size for the chip while a handle is held.
  useAnimatedReaction(
    () => {
      const d = drag.get();
      const f = frameOf(frameSV.get());
      if (!f || d.length !== 6) return '';
      const t = transformFrame(f, d);
      return `${Math.round(t.w)}:${Math.round(t.h)}`;
    },
    (key, prev) => {
      if (key === prev || !key) return;
      const parts = key.split(':');
      scheduleOnRN(setLive, { w: Number(parts[0]), h: Number(parts[1]) });
    },
  );

  // Where the menu goes: the frame's screen bounds with room for the rotate handle and the chip.
  const selAnchor = useDerivedValue(() => {
    scale.get();
    tx.get();
    ty.get();
    const s = liveScreenFrame(frameSV, pageSV, drag, pageOrigin);
    if (!s) return [];
    const c = Math.abs(Math.cos(s[4]));
    const sn = Math.abs(Math.sin(s[4]));
    const hw = (s[2] * c + s[3] * sn) / 2;
    const hh = (s[2] * sn + s[3] * c) / 2;
    return [s[0] - hw - 8, s[1] - hh - MENU_MARGIN, hw * 2 + 16, hh * 2 + MENU_MARGIN * 2];
  });

  const pasteAt = paste;
  const pasteAnchor = useDerivedValue(() => {
    scale.get();
    tx.get();
    ty.get();
    if (!pasteAt) return [];
    const p = toScreen(pasteAt.pageId, pasteAt.x, pasteAt.y);
    return p ? [p.x - 1, p.y - 1, 2, 2] : [];
  }, [pasteAt, toScreen]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    rootRef.current?.measureInWindow((x, y) => origin.set([x, y]));
  };

  // ----- commits

  const resetDrag = () => {
    drag.set([]);
    hidden.set([]);
    setActive(null);
    setLive(null);
  };

  /**
   * Text boxes after a resize get box.h from the Skia layout (NB-46): an edge handle changes only the
   * width and the text rewraps, so the box grows or shrinks in height to fit its lines (P28 fitTextBox,
   * top-left corner kept). A preset or corner scale changes the font size, so the height is refitted too.
   */
  const fitTextItems = (items: PageItem[]): PageItem[] => items.map((i) => (i.kind === 'text' ? fitTextBox(i) : i));

  const selectedNow = (pid: Id): PageItem[] => {
    const pg = session.getPage(pid);
    if (!pg) return [];
    const set = new Set(getSelection().ids);
    return pg.items.filter((i) => set.has(i.id));
  };

  /** A move dropped over another page: remove here, add there, one undo step. */
  const moveAcross = (pid: Id, cur: PageItem[], m: number[]): boolean => {
    const f = selectionFrame(cur);
    const o = pageOrigin(pid);
    if (!f || !o) return false;
    const moved = transformFrame(f, m);
    const target = toPage(o.x + o.k * moved.cx, o.y + o.k * moved.cy);
    if (!target || target.pageId === pid || !session.notebook.pageIds.includes(target.pageId)) return false;
    const tPage = session.getPage(target.pageId);
    const to = pageOrigin(target.pageId);
    if (!tPage || !to) return false;
    const next = applyMatrixToItems(cur, matMultiply(pageToPageMatrix(o, to), m));
    const idsNow = cur.map((i) => i.id);
    session.beginGroup('move');
    try {
      session.removeItems(pid, idsNow, 'move');
      session.addItems(target.pageId, next, 'move');
    } finally {
      session.endGroup();
    }
    frameSV.set(frameArr(selectionFrame(next)));
    pageSV.set(target.pageId);
    getSelection().select(target.pageId, idsNow);
    return true;
  };

  const onCommit = (handle: HandleId, m: number[]) => {
    try {
      const pid = pageSV.get() || pageId;
      if (!pid || session.readOnly || m.length !== 6 || matIsIdentity(m, 1e-6)) return;
      const cur = selectedNow(pid);
      if (!cur.length) return;
      if (handle === 'move' && moveAcross(pid, cur, m)) return;
      const next = fitTextItems(applyMatrixToItems(cur, m, transformOptionsFor(handle)));
      session.updateItems(pid, next, LABELS[handleKind(handle)] ?? 'transform');
      frameSV.set(frameArr(selectionFrame(next)));
    } finally {
      resetDrag();
    }
  };

  const onStart = (handle: HandleId) => {
    setActive(handle);
    closePasteMenu();
  };

  const onBodyTap = () => {
    const v = getSelection().version;
    setMenuHiddenFor((h) => (h === v ? -1 : v));
  };

  const copyItems = async (): Promise<boolean> => {
    const cur = pageId ? selectedNow(pageId) : [];
    if (!cur.length) return false;
    setBusy(true);
    try {
      await notebookClipboard.copy(session, cur);
      return true;
    } catch {
      showToast({ text: tr('تعذّر النسخ', 'Could not copy'), tone: 'warn' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onCopy = () => {
    copyItems().then((ok) => {
      if (ok) showToast({ text: tr('تم النسخ', 'Copied'), tone: 'ok', durationMs: 2000 });
    });
  };

  const onCut = () => {
    const pid = pageId;
    const idsAtStart = [...ids];
    copyItems().then((ok) => {
      if (!ok || !pid || session.readOnly) return;
      try {
        // Only the cut items that are still on the page (an undo may have removed some meanwhile).
        const present = new Set((session.getPage(pid)?.items ?? []).map((i) => i.id));
        const gone = idsAtStart.filter((id) => present.has(id));
        if (gone.length) session.removeItems(pid, gone, 'cut');
        getSelection().clear();
      } catch {
        showToast({ text: tr('تعذّر القص', 'Could not cut'), tone: 'warn' });
      }
    });
  };

  const onColor = (c: Hex) => {
    if (!pageId) return;
    const changed = recolorItems(selectedNow(pageId), c);
    if (changed.length) session.updateItems(pageId, changed, 'color');
  };

  const onResize = (pct: number) => {
    if (!pageId) return;
    const cur = selectedNow(pageId);
    const b = selectionBounds(cur);
    if (!b) return;
    const next = fitTextItems(applyMatrixToItems(cur, presetScale(b, pct)));
    session.updateItems(pageId, next, 'resize');
  };

  const onDelete = () => {
    if (!pageId) return;
    session.removeItems(pageId, [...ids], 'delete');
    getSelection().clear();
  };

  const onCrop = () => {
    const it = items[0];
    if (!pageId || !it || it.kind !== 'image') return;
    requestImageCrop({ pageId, itemId: it.id });
  };

  const onPaste = async () => {
    const at = pasteMenuStore.get();
    closePasteMenu();
    const data = notebookClipboard.get();
    if (!at || !data || session.readOnly) return;
    setBusy(true);
    try {
      const pg = session.getPage(at.pageId) ?? (await session.loadPage(at.pageId));
      const off = pasteOffset(selectionBounds(data.items), { x: at.x, y: at.y }, pg.size);
      const newIds = await notebookClipboard.paste(session, at.pageId, off);
      if (newIds.length) getSelection().select(at.pageId, newIds);
    } catch {
      showToast({ text: tr('تعذّر اللصق', 'Could not paste'), tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  // ----- render

  const lassoD = (() => {
    if (!lasso || lasso.pts.length < 4) return null;
    const o = pageOrigin(lasso.pageId);
    if (!o) return null;
    let d = '';
    for (let i = 0; i + 1 < lasso.pts.length; i += 2) {
      const x = o.x + o.k * lasso.pts[i];
      const y = o.y + o.k * lasso.pts[i + 1];
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return `${d}Z`;
  })();

  const kind = active ? handleKind(active) : null;
  const chipSize = live ?? (frame ? { w: frame.w, h: frame.h } : null);
  const chipText = kind && kind !== 'rotate' && chipSize ? sizeChipText(chipSize, getLang()) : null;
  const showMenu = !!frame && !active && !lasso && menuHiddenFor !== sel.version && size.width > 0;
  const showPaste = !!paste && !frame && !!clipboard && size.width > 0;
  const single = items.length === 1 ? items[0] : null;

  return (
    <View ref={rootRef} collapsable={false} pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {lassoD ? (
        <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Path d={lassoD} fill={nbColors.accent} fillOpacity={0.06} stroke={nbColors.accent} strokeWidth={1.5} strokeDasharray="6 5" strokeLinejoin="round" />
        </Svg>
      ) : null}
      {frame && page && !session.readOnly ? <DragPreview session={session} page={page} items={items} /> : null}
      {frame ? (
        <SelectionHandles
          frame={frameSV}
          pageId={pageSV}
          origin={origin}
          ids={ids}
          readOnly={session.readOnly}
          fixedHeight={single?.kind === 'text'}
          chipText={chipText}
          onStart={onStart}
          onCommit={onCommit}
          onCancel={resetDrag}
          onBodyTap={onBodyTap}
        />
      ) : null}
      {showMenu ? (
        <FloatingMenu anchor={selAnchor} screen={size} hand={hand} accessibilityLabel={tr('خيارات التحديد', 'Selection options')}>
          <SelectionMenu
            key={sel.version}
            color={selectionColor(items)}
            highlighter={isHighlighterSelection(items)}
            singleImage={single?.kind === 'image'}
            readOnly={session.readOnly}
            busy={busy}
            onCopy={onCopy}
            onCut={onCut}
            onColor={onColor}
            onResize={onResize}
            onDelete={onDelete}
            onCrop={onCrop}
          />
        </FloatingMenu>
      ) : null}
      {showPaste ? (
        <FloatingMenu anchor={pasteAnchor} screen={size} hand={hand}>
          <PasteMenu onPaste={onPaste} busy={busy} />
        </FloatingMenu>
      ) : null}
    </View>
  );
}
