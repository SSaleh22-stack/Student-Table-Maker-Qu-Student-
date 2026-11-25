/**
 * Coordinates (checked by P30 against P22 useCanvasApi.ts): pageOrigin is in the canvas view's own
 * coordinates, which are also the OverlayHost's. This overlay's root (an absolute-fill child of
 * OverlayHost) shares them, as P27's selection overlay does.
 *
 * The text box editor (P28, NB-46, Figma 09) and the editing store the text tool (useTextTool) drives.
 *
 * EDITOR: an RN TextInput laid over the box, so the student types with the system keyboard (Arabic or
 * English, autocorrect, dictation). It must look exactly like the drawn box, so the text never jumps
 * when editing ends:
 * - fontFamily NB_TEXT_FONTS.regular.rn or bold.rn: the same IBM Plex Sans Arabic 500 / 700 files the
 *   Skia painter registers (contracts/fonts.ts). No fontWeight is set: the family carries it.
 * - fontSize = item.size x k and width = box.w x k, where k is the page's screen px per point
 *   (OverlayContext pageOrigin). NO scale transform: the text is laid out natively at screen size, so
 *   it wraps where Skia wraps box.w at item.size.
 * - Placed through pageOrigin from PHYSICAL_ORIGIN with a translate and the box rotation; its top-left
 *   corner sits on the box's top-left corner on the page.
 * - writingDirection from core/text/bidi.ts paragraphDirection (first strong character, 'rtl' when
 *   there is none, like the painter's TEXT_FALLBACK_DIR), with the text aligned to that side.
 * - While it has the focus it holds the overlay (claimOverlay), so the canvas does not pan, zoom or
 *   draw under it; a tap anywhere else on the canvas (a transparent backdrop) ends editing.
 * - The TextFormatBar sits above the box, aligned with its physical right edge (Figma 09), or below it
 *   when there is no room above.
 * - A round move handle beside the box's top-left corner drags the box on the page, before or while
 *   typing (moveTextDraft; the box stays on the page).
 *
 * STORE (textEditStore, module-wide: one box is edited at a time). Editing works on a draft and writes
 * the page ONCE when it ends (commitTextEdit): an empty text removes the box (or drops a new one), a new
 * box is added, an existing box is updated when something changed, each as one undo step, with box.h
 * recomputed from the Skia layout (fitTextBox). An existing box is hidden from the canvas through
 * selection.hidden while it is edited.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { AppState, Keyboard, Pressable, StyleSheet, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useAnimatedReaction } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { useOverlay } from '@/notebook/canvas/overlayContext';
import { getSelection } from '@/notebook/canvas/selection';
import { nbTextFont } from '@/notebook/contracts/fonts';
import type { Id, TextItem } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { paragraphDirection } from '@/notebook/core/text/bidi';
import { getNotebookFonts, measureTextHeight, useNotebookFonts } from '@/notebook/ink';
import { nbColors } from '@/notebook/theme';
import { PHYSICAL_ORIGIN, PHYSICAL_SWAP } from '@/notebook/ui/physical';

import { TEXT_MAX_SIZE, TEXT_MIN_SIZE, TextFormatBar } from './TextFormatBar';

/** History label of every text change. */
export const TEXT_HISTORY_LABEL = 'text';
/** Longest text a box keeps (the page reader's limit). */
export const TEXT_MAX_LENGTH = 20000;
/** Line height estimate before anything is measured (per point of font size). */
export const TEXT_LINE_FACTOR = 1.35;

/** Space between the text and the editing frame, and the frame's width (screen px). */
const PAD = 6;
const BORDER = 1.5;
/** Distance of the format bar from the box and from the screen edges (px). */
const BAR_GAP = 10;
const BAR_MARGIN = 8;
/** The move handle beside the box (px) and its gap from the frame. */
const MOVE_HANDLE = 34;
const MOVE_GAP = 6;

// ===== geometry

/** The top-left corner of a (rotated) box on the page. */
function topLeft(b: TextItem['box']): [number, number] {
  const rot = b.rot || 0;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return [cx - (b.w / 2) * c + (b.h / 2) * s, cy - (b.w / 2) * s - (b.h / 2) * c];
}

/** The box of width w and height h whose top-left corner is (tlx, tly), turned by rot. */
function boxFromTopLeft(tlx: number, tly: number, w: number, h: number, rot: number): TextItem['box'] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const cx = tlx + (w / 2) * c - (h / 2) * s;
  const cy = tly + (w / 2) * s + (h / 2) * c;
  return { x: cx - w / 2, y: cy - h / 2, w, h, rot };
}

/**
 * The item with box.h set to its laid-out height (Skia, the painter's own layout). The top-left corner
 * stays where it is on the page, rotation included. The same item when the height already matches.
 */
export function fitTextBox(item: TextItem, fonts = getNotebookFonts()): TextItem {
  const h = measureTextHeight(item, fonts);
  const b = item.box;
  if (!(h > 0) || Math.abs(h - b.h) < 0.01) return item;
  const rot = b.rot || 0;
  if (!rot) return { ...item, box: { ...b, h } };
  const [tlx, tly] = topLeft(b);
  return { ...item, box: boxFromTopLeft(tlx, tly, b.w, h, rot) };
}

/**
 * A text box resized to wrap width w with the font size unchanged (P27's resize handles), its height
 * recomputed. The top-left corner stays, so the box grows toward its own right and bottom edges.
 */
export function reflowTextItem(item: TextItem, w: number, fonts = getNotebookFonts()): TextItem {
  const b = item.box;
  const width = Number.isFinite(w) && w > 1 ? w : b.w;
  if (width === b.w) return fitTextBox(item, fonts);
  const [tlx, tly] = topLeft(b);
  return fitTextBox({ ...item, box: boxFromTopLeft(tlx, tly, width, b.h, b.rot || 0) }, fonts);
}

function sameItem(a: TextItem, b: TextItem): boolean {
  return (
    a.text === b.text &&
    a.size === b.size &&
    a.color === b.color &&
    a.bold === b.bold &&
    a.box.x === b.box.x &&
    a.box.y === b.box.y &&
    a.box.w === b.box.w &&
    a.box.h === b.box.h &&
    a.box.rot === b.box.rot
  );
}

// ===== editing store

export interface TextEditState {
  /** New for every opened box; an input commits only its own box. */
  key: number;
  session: NotebookSession;
  pageId: Id;
  draft: TextItem;
  /** The box as it is on the page; null for a new box. */
  original: TextItem | null;
}

let edit: TextEditState | null = null;
let nextKey = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of [...listeners]) cb();
}

function hideOnCanvas(id: Id): void {
  const h = getSelection().hidden;
  const cur = h.get();
  if (!cur.includes(id)) h.set([...cur, id]);
}

function showOnCanvas(id: Id): void {
  const h = getSelection().hidden;
  const cur = h.get();
  if (cur.includes(id)) h.set(cur.filter((x) => x !== id));
}

export const textEditStore = {
  get: (): TextEditState | null => edit,
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};

/**
 * Ends editing and writes the box to the page (one undo step). With `key`, only when that box is the
 * open one. Safe to call when nothing is open.
 */
export function commitTextEdit(key?: number): void {
  if (!edit || (key !== undefined && edit.key !== key)) return;
  const { session, pageId, draft, original } = edit;
  edit = null;
  emit();
  if (original) showOnCanvas(original.id);
  if (session.readOnly) return;
  if (!draft.text.trim()) {
    if (original) session.removeItems(pageId, [original.id], TEXT_HISTORY_LABEL);
    return;
  }
  const item = fitTextBox(draft);
  if (!original) session.addItems(pageId, [item], TEXT_HISTORY_LABEL);
  else if (!sameItem(item, original)) session.updateItems(pageId, [item], TEXT_HISTORY_LABEL);
}

/** Opens a box for editing: an existing one (isNew false), or a new draft not on the page yet. */
export function openTextEditor(session: NotebookSession, pageId: Id, item: TextItem, isNew: boolean): void {
  commitTextEdit();
  if (session.readOnly) return;
  const sel = getSelection();
  if (sel.ids.includes(item.id)) sel.clear();
  if (!isNew) hideOnCanvas(item.id);
  edit = { key: nextKey++, session, pageId, draft: { ...item, box: { ...item.box } }, original: isNew ? null : item };
  emit();
}

/** Changes the open draft (text, size, color, bold). Ignored when `key` is not the open box. */
export function updateTextDraft(key: number, patch: Partial<Pick<TextItem, 'text' | 'size' | 'color' | 'bold'>>): void {
  if (!edit || edit.key !== key) return;
  const size = patch.size === undefined ? edit.draft.size : Math.min(TEXT_MAX_SIZE, Math.max(TEXT_MIN_SIZE, patch.size));
  edit = { ...edit, draft: { ...edit.draft, ...patch, size } };
  emit();
}

/**
 * Moves the open draft so its box's x / y is (x, y) on the page (the move handle), kept on the page.
 * Ignored when `key` is not the open box.
 */
export function moveTextDraft(key: number, x: number, y: number): void {
  if (!edit || edit.key !== key) return;
  const b = edit.draft.box;
  const page = edit.session.getPage(edit.pageId);
  let nx = x;
  let ny = y;
  if (page) {
    nx = Math.min(Math.max(0, nx), Math.max(0, page.size.w - b.w));
    ny = Math.min(Math.max(0, ny), Math.max(0, page.size.h - b.h));
  }
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || (nx === b.x && ny === b.y)) return;
  edit = { ...edit, draft: { ...edit.draft, box: { ...b, x: nx, y: ny } } };
  emit();
}

/** Ends editing and deletes the box (the format bar's trash). A new box is just dropped. */
export function deleteTextEdit(key: number): void {
  if (!edit || edit.key !== key) return;
  const { session, pageId, original } = edit;
  edit = null;
  emit();
  if (!original) return;
  showOnCanvas(original.id);
  if (!session.readOnly) session.removeItems(pageId, [original.id], TEXT_HISTORY_LABEL);
}

// ===== overlay

export interface TextEditorOverlayProps {
  session: NotebookSession;
}

/** Renders the editor while a box of this session is open. */
export function TextEditorOverlay({ session }: TextEditorOverlayProps) {
  const state = useSyncExternalStore(textEditStore.subscribe, textEditStore.get, textEditStore.get);
  if (!state || state.session !== session) return null;
  return <TextEditor key={state.key} state={state} />;
}

type Origin = [number, number, number];

function TextEditor({ state }: { state: TextEditState }) {
  const { key, pageId, draft } = state;
  const { scale, tx, ty, pageOrigin, claimOverlay, releaseOverlay } = useOverlay();
  // Starts loading the Skia fonts, so the height measured at commit uses the real metrics.
  useNotebookFonts();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [screen, setScreen] = useState({ w: 0, h: 0 });
  const [inputH, setInputH] = useState(0);
  const [bar, setBar] = useState({ w: 0, h: 0 });
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const claimedRef = useRef(false);
  // The move handle: drags the box on the page. k (screen px per point) is kept from the last origin.
  const kRef = useRef(1);
  const dragStart = useRef<[number, number] | null>(null);
  useEffect(() => {
    if (origin && origin[2] > 0) kRef.current = origin[2];
  }, [origin]);
  const moveStart = () => {
    const cur = textEditStore.get();
    dragStart.current = cur && cur.key === key ? [cur.draft.box.x, cur.draft.box.y] : null;
  };
  const moveBy = (dx: number, dy: number) => {
    const s0 = dragStart.current;
    if (s0) moveTextDraft(key, s0[0] + dx / kRef.current, s0[1] + dy / kRef.current);
  };
  const moveEnd = () => {
    dragStart.current = null;
  };
  const moveGesture = usePanGesture({
    minDistance: 0,
    onBegin: () => {
      'worklet';
      scheduleOnRN(moveStart);
    },
    onUpdate: (e) => {
      'worklet';
      scheduleOnRN(moveBy, e.translationX, e.translationY);
    },
    onFinalize: () => {
      'worklet';
      scheduleOnRN(moveEnd);
    },
  });

  // Where the page is on screen (the canvas is frozen while the input has the focus).
  useAnimatedReaction(
    () => {
      scale.get();
      tx.get();
      ty.get();
      const o = pageOrigin(pageId);
      return o ? [o.x, o.y, o.k] : null;
    },
    (cur, prev) => {
      if (!cur) return;
      if (prev && Math.abs(cur[0] - prev[0]) < 0.25 && Math.abs(cur[1] - prev[1]) < 0.25 && Math.abs(cur[2] - prev[2]) < 1e-4) return;
      scheduleOnRN(setOrigin, [cur[0], cur[1], cur[2]] as Origin);
    },
    [pageId],
  );

  const release = () => {
    if (!claimedRef.current) return;
    claimedRef.current = false;
    releaseOverlay();
  };

  useEffect(
    () => () => {
      if (claimedRef.current) {
        claimedRef.current = false;
        releaseOverlay();
      }
    },
    [releaseOverlay],
  );

  // The draft is only on the page once editing ends: going to the background ends it, so a system kill
  // of the backgrounded app never loses what was typed (autosave then writes it like any edit).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') commitTextEdit(key);
    });
    return () => sub.remove();
  }, [key]);

  // autoFocus is not reliable on every Android keyboard: ask once more after the first layout.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  const finish = () => {
    Keyboard.dismiss();
    release();
    commitTextEdit(key);
  };

  const onRootLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setScreen((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
  };

  const backdrop = (
    <Pressable style={StyleSheet.absoluteFill} onPress={finish} accessible={false} importantForAccessibility="no" />
  );

  if (!origin) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onRootLayout}>
        {backdrop}
      </View>
    );
  }

  const [ox, oy, k] = origin;
  const b = draft.box;
  const rot = b.rot || 0;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const width = Math.max(1, b.w * k);
  const fontSize = draft.size * k;
  const textH = Math.max(inputH, fontSize * TEXT_LINE_FACTOR);
  const inset = PAD + BORDER;
  const frameW = width + inset * 2;
  const frameH = textH + inset * 2;
  // The frame turns about its own centre; translate it so the text's top-left lands on the box's.
  const [tlx, tly] = topLeft(b);
  const tlsx = ox + k * tlx;
  const tlsy = oy + k * tly;
  const hx = inset - frameW / 2;
  const hy = inset - frameH / 2;
  const frameX = tlsx - frameW / 2 - (hx * c - hy * s);
  const frameY = tlsy - frameH / 2 - (hx * s + hy * c);

  // The frame's bounds on screen, for the format bar.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [lx, ly] of [
    [0, 0],
    [frameW, 0],
    [frameW, frameH],
    [0, frameH],
  ]) {
    const dx = lx - frameW / 2;
    const dy = ly - frameH / 2;
    const x = frameX + frameW / 2 + dx * c - dy * s;
    const y = frameY + frameH / 2 + dx * s + dy * c;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  let barY = minY - bar.h - BAR_GAP;
  const below = barY < BAR_MARGIN;
  if (below) barY = maxY + BAR_GAP;
  const maxBarX = screen.w > 0 ? screen.w - bar.w - BAR_MARGIN : maxX;
  const barX = Math.max(BAR_MARGIN, Math.min(maxBarX, maxX - bar.w));
  // The move handle sits beside the frame's top-left corner (inside it when there is no room).
  const handleX = minX - MOVE_HANDLE - MOVE_GAP >= BAR_MARGIN ? minX - MOVE_HANDLE - MOVE_GAP : minX;
  const handleY = minX - MOVE_HANDLE - MOVE_GAP >= BAR_MARGIN ? minY : Math.max(BAR_MARGIN, minY - MOVE_HANDLE - MOVE_GAP);

  const dir = paragraphDirection(draft.text, 'rtl');
  // React Native swaps left and right text alignment in a native RTL build: align to the PHYSICAL side.
  const physicalRightAlign = PHYSICAL_SWAP ? 'left' : 'right';
  const physicalLeftAlign = PHYSICAL_SWAP ? 'right' : 'left';

  const onFocus = () => {
    if (claimedRef.current) return;
    claimedRef.current = true;
    claimOverlay();
  };
  const onBlur = () => {
    release();
    commitTextEdit(key);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onRootLayout}>
      {backdrop}
      <View
        style={[
          styles.frame,
          PHYSICAL_ORIGIN,
          { width: frameW, transform: [{ translateX: frameX }, { translateY: frameY }, { rotate: `${rot}rad` }] },
        ]}>
        <TextInput
          ref={inputRef}
          value={draft.text}
          onChangeText={(text) => updateTextDraft(key, { text })}
          onFocus={onFocus}
          onBlur={onBlur}
          onLayout={(e) => setInputH(e.nativeEvent.layout.height)}
          autoFocus
          multiline
          scrollEnabled={false}
          maxLength={TEXT_MAX_LENGTH}
          underlineColorAndroid="transparent"
          selectionColor={nbColors.accent}
          cursorColor={nbColors.accent}
          accessibilityLabel={tr('مربع نص', 'Text box')}
          style={[
            styles.input,
            {
              width,
              minHeight: fontSize * TEXT_LINE_FACTOR,
              fontFamily: nbTextFont(draft.bold).rn,
              fontSize,
              color: draft.color,
              writingDirection: dir,
              textAlign: dir === 'rtl' ? physicalRightAlign : physicalLeftAlign,
            },
          ]}
        />
      </View>
      <GestureDetector gesture={moveGesture}>
        <View
          accessibilityLabel={tr('تحريك مربع النص', 'Move the text box')}
          hitSlop={8}
          style={[styles.move, PHYSICAL_ORIGIN, { transform: [{ translateX: handleX }, { translateY: handleY }] }]}>
          <Icon name="grip" size={18} color={nbColors.white} />
        </View>
      </GestureDetector>
      <View
        onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout;
          setBar((p) => (p.w === w && p.h === h ? p : { w, h }));
        }}
        style={[styles.bar, PHYSICAL_ORIGIN, { opacity: bar.w > 0 ? 1 : 0, transform: [{ translateX: barX }, { translateY: barY }] }]}>
        <TextFormatBar
          size={draft.size}
          color={draft.color}
          bold={draft.bold}
          panelBelow={below}
          onSize={(size) => updateTextDraft(key, { size })}
          onColor={(color) => updateTextDraft(key, { color })}
          onToggleBold={() => updateTextDraft(key, { bold: !draft.bold })}
          onDelete={() => {
            Keyboard.dismiss();
            release();
            deleteTextEdit(key);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    top: 0,
    padding: PAD,
    borderWidth: BORDER,
    borderColor: nbColors.accent,
    borderRadius: 6,
  },
  input: {
    padding: 0,
    paddingTop: 0,
    paddingBottom: 0,
    margin: 0,
    textAlignVertical: 'top',
    includeFontPadding: false,
    backgroundColor: 'transparent',
  },
  bar: {
    position: 'absolute',
    top: 0,
  },
  move: {
    position: 'absolute',
    top: 0,
    width: MOVE_HANDLE,
    height: MOVE_HANDLE,
    borderRadius: MOVE_HANDLE / 2,
    backgroundColor: nbColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
