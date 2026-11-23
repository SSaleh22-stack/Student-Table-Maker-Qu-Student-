/**
 * The selection frame and its handles (P27, NB-43, Figma 37), drawn over the page and following zoom
 * through OverlayContext:
 * - a dashed accent rectangle 8 px outside the frame (accent fill at 0.06), which is also the MOVE area;
 * - 8 handles (13 px white dots with a 2 px accent ring, 40 px touch areas): 4 corners scale
 *   uniformly, 4 edges stretch one axis (a single text box has no top / bottom edge handles: its
 *   height follows its text, so only its width reflows);
 * - the rotate handle (24 px, 'restore' icon) on a 26 px stem above the top edge;
 * - the size chip 'عرض 330 · ارتفاع 210' / 'W 330 · H 210' centered 18 px below the box while it is moved
 *   or resized.
 *
 * Every handle is its own RNGH v3 pan: claimOverlay() in onBegin and releaseOverlay() in onFinalize,
 * so canvas gestures fail while one is held (ruling (p)). Updates run on the UI thread: the core
 * handleTransform gives a page-space matrix that is written to selection.drag, and the selected ids go
 * to selection.hidden; the canvas skips them and SelectionOverlay's DragPreview draws them under that
 * matrix. The release hops to JS with the
 * matrix (scheduleOnRN), where SelectionOverlay commits it as one undo step and resets drag / hidden.
 * A short touch on the move area that never becomes a drag reports onBodyTap (toggles the menu).
 *
 * Placement: the frame is a container rotated with the frame, placed from PHYSICAL_ORIGIN with
 * translations (never swapped in RTL); its children are placed the same way, so 'tl' is always the
 * page's top-left whatever the language.
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { colors } from '@/lib/theme';
import { getSelection } from '@/notebook/canvas/selection';
import { useOverlay } from '@/notebook/canvas/overlayContext';
import { RESIZE_HANDLES, handleKind, handleTransform, transformFrame, type HandleId, type SelFrame } from '@/notebook/core/tools/selection';
import { nbColors } from '@/notebook/theme';
import { PHYSICAL_ORIGIN } from '@/notebook/ui';

/** Room around the frame inside the rotated container (handles and the rotate handle fit in it). */
const PAD = 76;
/** Visible handle dot and its touch area. */
const DOT = 13;
const TOUCH = 40;
/** Dashed rectangle outside the frame. */
const OUTSET = 8;
/** The rotate handle: diameter, and its center's distance above the frame's top edge (Figma 37: y - 58 + 12). */
const ROT_SIZE = 24;
export const ROTATE_DISTANCE = 46;
/** Stem from the top edge's dashed line up to the rotate handle. */
const STEM_TOP = 34;
const STEM_LEN = 26;
/** Edge handles hide when that side is shorter than this on screen. */
const EDGE_MIN = 48;
/** The size chip's slot (the chip is centered in it) and its gap below the box. */
const CHIP_W = 240;
const CHIP_GAP = 18;
const OFF = -100000;
/** A touch on the move area shorter than this that never dragged is a tap. */
const TAP_MS = 350;

/** [cx, cy, w, h, rot] (page points) as a SelFrame; null for []. */
export function frameOf(f: readonly number[]): SelFrame | null {
  'worklet';
  if (f.length !== 5) return null;
  return { cx: f[0], cy: f[1], w: f[2], h: f[3], rot: f[4] };
}

/** The frame on screen right now: [sx, sy, W, H, rot, k] (overlay px), or null. */
export function liveScreenFrame(
  frame: SharedValue<number[]>,
  pageId: SharedValue<string>,
  drag: SharedValue<number[]>,
  pageOrigin: (pageId: string) => { x: number; y: number; k: number } | null,
): number[] | null {
  'worklet';
  let f = frameOf(frame.get());
  const pid = pageId.get();
  if (!f || !pid) return null;
  const o = pageOrigin(pid);
  if (!o) return null;
  const d = drag.get();
  if (d.length === 6) f = transformFrame(f, d);
  return [o.x + o.k * f.cx, o.y + o.k * f.cy, o.k * f.w, o.k * f.h, f.rot, o.k];
}

export interface SelectionHandlesProps {
  /** [cx, cy, w, h, rot] in page points ([] = nothing selected). */
  frame: SharedValue<number[]>;
  pageId: SharedValue<string>;
  /** The overlay root's window origin (to turn absolute touch points into overlay px). */
  origin: SharedValue<number[]>;
  /** The selected ids (written to selection.hidden while a handle is held). */
  ids: readonly string[];
  readOnly: boolean;
  /**
   * The height follows the content (a single text box: its height comes from the text layout), so
   * the top and bottom edge handles are left out; corners still scale it.
   */
  fixedHeight?: boolean;
  /** The size chip text while moving or resizing (null: hidden). */
  chipText: string | null;
  onStart(handle: HandleId): void;
  onCommit(handle: HandleId, m: number[]): void;
  onCancel(): void;
  onBodyTap(): void;
}

interface HandleViewProps extends Omit<SelectionHandlesProps, 'chipText' | 'readOnly' | 'fixedHeight'> {
  handle: HandleId;
  hiddenIds: string[];
  enabled: boolean;
}

/** One handle (or the move area) with its own pan gesture. */
function HandleView({ handle, frame, pageId, origin, hiddenIds, enabled, onStart, onCommit, onCancel, onBodyTap }: HandleViewProps) {
  const { scale, tx, ty, pageOrigin, claimOverlay, releaseOverlay } = useOverlay();
  const { drag, hidden } = getSelection();
  const kind = handleKind(handle);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startFrame = useSharedValue<number[]>([]);
  const startK = useSharedValue(1);
  /** Screen center of the frame at the start (rotate). */
  const startCenter = useSharedValue<number[]>([0, 0]);
  const active = useSharedValue(false);
  /** The pan activated during this touch (a drag, so never a tap). */
  const dragged = useSharedValue(false);
  const beganAt = useSharedValue(0);

  const pan = usePanGesture({
    enabled,
    minDistance: kind === 'move' ? 6 : 2,
    maxPointers: 1,
    onBegin: (e) => {
      'worklet';
      claimOverlay();
      active.set(false);
      dragged.set(false);
      beganAt.set(Date.now());
      startX.set(e.absoluteX);
      startY.set(e.absoluteY);
      startFrame.set(frame.get());
      const s = liveScreenFrame(frame, pageId, drag, pageOrigin);
      startK.set(s ? s[5] : 1);
      if (s) startCenter.set([s[0], s[1]]);
    },
    onActivate: () => {
      'worklet';
      dragged.set(true);
      if (startFrame.get().length !== 5) return;
      active.set(true);
      hidden.set(hiddenIds);
      scheduleOnRN(onStart, handle);
    },
    onUpdate: (e) => {
      'worklet';
      if (!active.get()) return;
      const f = frameOf(startFrame.get());
      if (!f) return;
      const k = startK.get() > 0 ? startK.get() : 1;
      let dx = (e.absoluteX - startX.get()) / k;
      let dy = (e.absoluteY - startY.get()) / k;
      const off = ROTATE_DISTANCE / k;
      if (kind === 'rotate') {
        // Turn by the angle the finger swept around the center (exact, whatever the touch offset).
        const o = origin.get();
        const c = startCenter.get();
        const a0 = Math.atan2(startY.get() - o[1] - c[1], startX.get() - o[0] - c[0]);
        const a1 = Math.atan2(e.absoluteY - o[1] - c[1], e.absoluteX - o[0] - c[0]);
        const r = f.h / 2 + off;
        const base = f.rot - Math.PI / 2;
        dx = r * (Math.cos(base + a1 - a0) - Math.cos(base));
        dy = r * (Math.sin(base + a1 - a0) - Math.sin(base));
      }
      drag.set(handleTransform(f, handle, dx, dy, { rotateOffset: off }));
    },
    onDeactivate: (e) => {
      'worklet';
      if (!active.get()) return;
      active.set(false);
      const m = drag.get();
      if (e.canceled || m.length !== 6) {
        scheduleOnRN(onCancel);
        return;
      }
      scheduleOnRN(onCommit, handle, m);
    },
    onFinalize: () => {
      'worklet';
      releaseOverlay();
      if (active.get()) {
        // Cancelled while held (another gesture took over, the app went to the background).
        active.set(false);
        scheduleOnRN(onCancel);
        return;
      }
      // A short touch that never became a drag (a failed pan reports canceled, so time it instead).
      if (kind === 'move' && !dragged.get() && Date.now() - beganAt.get() < TAP_MS) scheduleOnRN(onBodyTap);
    },
  });

  const style = useAnimatedStyle(() => {
    // Read the view transform so the handle follows zoom and scroll.
    scale.get();
    tx.get();
    ty.get();
    const s = liveScreenFrame(frame, pageId, drag, pageOrigin);
    if (!s) return { opacity: 0, transform: [{ translateX: OFF }, { translateY: 0 }] };
    const W = s[2];
    const H = s[3];
    if (kind === 'move') {
      return {
        opacity: 1,
        width: W + OUTSET * 2,
        height: H + OUTSET * 2,
        transform: [{ translateX: PAD - OUTSET }, { translateY: PAD - OUTSET }],
      };
    }
    if (kind === 'rotate') {
      return {
        opacity: 1,
        width: TOUCH,
        height: TOUCH,
        transform: [{ translateX: PAD + W / 2 - TOUCH / 2 }, { translateY: PAD - ROTATE_DISTANCE - TOUCH / 2 }],
      };
    }
    const l = handleLocalXY(handle);
    const tooShort = (l[0] === 0 && W < EDGE_MIN) || (l[1] === 0 && H < EDGE_MIN);
    if (kind === 'edge' && tooShort) return { opacity: 0, width: TOUCH, height: TOUCH, transform: [{ translateX: OFF }, { translateY: 0 }] };
    return {
      opacity: 1,
      width: TOUCH,
      height: TOUCH,
      transform: [{ translateX: PAD + ((l[0] + 1) / 2) * W - TOUCH / 2 }, { translateY: PAD + ((l[1] + 1) / 2) * H - TOUCH / 2 }],
    };
  });

  const content =
    kind === 'move' ? (
      <View style={styles.dashed} />
    ) : kind === 'rotate' ? (
      <View style={styles.rotate}>
        <Icon name="restore" size={14} color={colors.accent} />
      </View>
    ) : (
      <View style={styles.dot} />
    );

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.abs, PHYSICAL_ORIGIN, kind === 'move' ? null : styles.center, style]}>{content}</Animated.View>
    </GestureDetector>
  );
}

/** fx, fy of a resize handle (worklet copy of core handleLocal, kept local for the style worklet). */
function handleLocalXY(h: HandleId): number[] {
  'worklet';
  const fx = h === 'tl' || h === 'l' || h === 'bl' ? -1 : h === 'tr' || h === 'r' || h === 'br' ? 1 : 0;
  const fy = h === 'tl' || h === 't' || h === 'tr' ? -1 : h === 'bl' || h === 'b' || h === 'br' ? 1 : 0;
  return [fx, fy];
}

export function SelectionHandles({ frame, pageId, origin, ids, readOnly, fixedHeight, chipText, onStart, onCommit, onCancel, onBodyTap }: SelectionHandlesProps) {
  const { scale, tx, ty, pageOrigin } = useOverlay();
  const { drag } = getSelection();
  const hiddenIds = useMemo(() => [...ids], [ids]);

  const container = useAnimatedStyle(() => {
    scale.get();
    tx.get();
    ty.get();
    const s = liveScreenFrame(frame, pageId, drag, pageOrigin);
    if (!s) return { width: 0, height: 0, transform: [{ translateX: OFF }, { translateY: 0 }, { rotate: '0rad' }] };
    return {
      width: s[2] + PAD * 2,
      height: s[3] + PAD * 2,
      transform: [{ translateX: s[0] - s[2] / 2 - PAD }, { translateY: s[1] - s[3] / 2 - PAD }, { rotate: `${s[4]}rad` }],
    };
  });

  const stem = useAnimatedStyle(() => {
    scale.get();
    const s = liveScreenFrame(frame, pageId, drag, pageOrigin);
    if (!s) return { transform: [{ translateX: OFF }, { translateY: 0 }] };
    return { transform: [{ translateX: PAD + s[2] / 2 - 0.75 }, { translateY: PAD - STEM_TOP }] };
  });

  // The size chip stays upright: under the lowest corner of the (rotated) frame.
  const chip = useAnimatedStyle(() => {
    scale.get();
    tx.get();
    ty.get();
    const s = liveScreenFrame(frame, pageId, drag, pageOrigin);
    if (!s) return { opacity: 0, transform: [{ translateX: OFF }, { translateY: 0 }] };
    const c = Math.abs(Math.cos(s[4]));
    const sn = Math.abs(Math.sin(s[4]));
    const halfH = (s[2] * sn + s[3] * c) / 2;
    return { opacity: 1, transform: [{ translateX: s[0] - CHIP_W / 2 }, { translateY: s[1] + halfH + CHIP_GAP }] };
  });

  const common = { frame, pageId, origin, hiddenIds, onStart, onCommit, onCancel, onBodyTap, ids };
  return (
    <>
      <Animated.View pointerEvents="box-none" style={[styles.abs, PHYSICAL_ORIGIN, container]}>
        <HandleView {...common} handle="move" enabled={!readOnly} />
        {readOnly ? null : (
          <>
            <Animated.View pointerEvents="none" style={[styles.abs, PHYSICAL_ORIGIN, styles.stem, stem]} />
            {RESIZE_HANDLES.filter((h) => !(fixedHeight && (h === 't' || h === 'b'))).map((h) => (
              <HandleView key={h} {...common} handle={h} enabled />
            ))}
            <HandleView {...common} handle="rotate" enabled />
          </>
        )}
      </Animated.View>
      {chipText ? (
        <Animated.View pointerEvents="none" style={[styles.abs, PHYSICAL_ORIGIN, styles.chipSlot, chip]}>
          <View style={styles.chip}>
            <AppText size={12} weight="medium" color="#FFFFFF" accessibilityLiveRegion="polite">
              {chipText}
            </AppText>
          </View>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  abs: {
    position: 'absolute',
    top: 0,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashed: {
    flex: 1,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: nbColors.accent,
    borderRadius: 4,
    backgroundColor: 'rgba(14, 116, 144, 0.06)',
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: nbColors.accent,
  },
  rotate: {
    width: ROT_SIZE,
    height: ROT_SIZE,
    borderRadius: ROT_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: nbColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stem: {
    width: 1.5,
    height: STEM_LEN,
    backgroundColor: nbColors.accent,
  },
  chipSlot: {
    width: CHIP_W,
    alignItems: 'center',
  },
  chip: {
    backgroundColor: nbColors.text,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
