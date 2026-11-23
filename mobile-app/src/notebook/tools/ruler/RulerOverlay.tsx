/**
 * Coordinates (checked by P30 against P22 gestures.ts and useCanvasApi.ts): the ruler store
 * (canvas/ruler.ts) keeps cx, cy in "screen px", which are the OverlayHost's own coordinates (the
 * canvas view's, the space of OverlayContext.toScreen / toPage and of RulerApi.hitTest, which P22
 * calls with the touch's view-relative x / y). This overlay's root is an absolute-fill child of
 * OverlayHost. RNGH touch points carry window coordinates
 * (absoluteX / absoluteY), so the gesture measures the root's window origin (Reanimated measure on the
 * UI runtime) and subtracts it.
 *
 * The on-screen ruler (P28, NB-45, Figma 09).
 *
 * Look (Figma 09): a 600 x 60 bar (RULER_LENGTH x RULER_WIDTH) filled #F1F5F9 at 0.9, 8 pt corners, a
 * 1 pt border and a small shadow. Ticks run along its top edge: a short tick every unit, a middle tick
 * every 5 and a long tick with a centimetre label every 10. The scale follows the page: one unit is
 * one millimetre of the page under the ruler at the current zoom (OverlayContext pageOrigin k), thinned
 * to 2, 5 or 10 mm when millimetres would be too dense. Before the page scale is known, 10 px per unit.
 *
 * Gesture (ruling (p)): ONE manual gesture that moves and rotates the ruler with two fingers at once.
 * - onTouchesDown: with fewer than two pointers it waits. With two, it FAILS unless both are inside
 *   ruler.hitTest (one finger on the ruler and one on the page never moves it). Otherwise it claims the
 *   overlay (claimOverlay: canvas gestures fail meanwhile) and activates.
 * - onTouchesMove: rigid two-finger transform: the ruler turns by the change of the fingers' angle
 *   (snapped to multiples of 45 degrees within 1.5 degrees, core/ink/ruler.ts snapRulerAngle) about
 *   their midpoint and follows it. The centre stays inside the view.
 * - A finger lifting ends it; onFinalize releases the overlay (also after a cancel).
 * - While it runs, the angle pill ('8°', angleLabel) shows next to the ruler.
 *
 * First use (settings.rulerHintShown false): the info pill 'اضغط مطولاً في نهاية الخط ليصبح شكلاً
 * مستقيماً' shows at the top of the canvas for HINT_MS, and rulerHintShown is saved at once.
 */
import { useEffect, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, GestureStateManager, useManualGesture } from 'react-native-gesture-handler';
import Animated, { measure, useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { fonts, shadow } from '@/lib/theme';
import { claimOverlay, releaseOverlay, useOverlay } from '@/notebook/canvas/overlayContext';
import { markRulerPlaced, placeRuler, RULER_LENGTH, RULER_WIDTH, useRuler } from '@/notebook/canvas/ruler';
import { angleLabel, snapRulerAngle } from '@/notebook/core/ink/ruler';
import { getSettings, setSettings } from '@/notebook/store/settingsStore';
import { nbColors } from '@/notebook/theme';
import { PHYSICAL_ORIGIN, physicalLeft } from '@/notebook/ui/physical';

/** How long the first-use hint stays (ms). */
export const RULER_HINT_MS = 5000;

/** Page points per millimetre. */
const PT_PER_MM = 72 / 25.4;
/** Closest two ticks may get (screen px). */
const MIN_TICK_GAP = 6;
/** Where the scale starts from the ruler's physical left end (px), as in Figma 09. */
const SCALE_START = 10;
/** Tick lengths (px): unit, 5 units, 10 units (Figma 09: 9, 15, 22). */
const TICK = { short: 9, mid: 15, long: 22 } as const;

// ===== first-use hint (a tiny store, so the effect that starts it sets no React state)

let hintVisible = false;
let hintTimer: ReturnType<typeof setTimeout> | null = null;
const hintListeners = new Set<() => void>();

function setHint(v: boolean): void {
  if (hintVisible === v) return;
  hintVisible = v;
  for (const cb of [...hintListeners]) cb();
}

function subscribeHint(cb: () => void): () => void {
  hintListeners.add(cb);
  return () => {
    hintListeners.delete(cb);
  };
}

const getHint = (): boolean => hintVisible;

/** Shows the first-use hint once (when the ruler shows and the hint was never shown). */
function maybeShowRulerHint(): void {
  if (getSettings().rulerHintShown) return;
  setSettings({ rulerHintShown: true });
  setHint(true);
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hintTimer = null;
    setHint(false);
  }, RULER_HINT_MS);
}

function hideRulerHint(): void {
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = null;
  setHint(false);
}

// ===== scale

interface RulerScale {
  /** Ticks path (react-native-svg, ruler-local px). */
  d: string;
  labels: { x: number; text: string }[];
}

/**
 * Ticks and labels for a scale of `pxPerMm` screen px per page millimetre. Ticks every unit (1, 2, 5
 * or 10 mm, the first at least MIN_TICK_GAP px apart): long with a label on whole centimetres, middle
 * on half centimetres. A scale that is not known yet (<= 0) draws Figma 09's static look: a tick every
 * 10 px and a long tick every 100 px.
 */
export function rulerScale(pxPerMm: number, length: number = RULER_LENGTH): RulerScale {
  const perMm = Number.isFinite(pxPerMm) && pxPerMm > 0 ? pxPerMm : 10;
  let unitMm = 1;
  for (const u of [1, 2, 5, 10, 20, 50]) {
    unitMm = u;
    if (u * perMm >= MIN_TICK_GAP) break;
  }
  // Labels every centimetre, or every 2, 5, 10... cm when they would crowd (28 px apart at least).
  const cmPx = 10 * perMm;
  let labelCm = 1;
  for (const c of [1, 2, 5, 10, 20, 50]) {
    labelCm = c;
    if (c * cmPx >= 28) break;
  }
  let d = '';
  const labels: { x: number; text: string }[] = [];
  const end = length - 6;
  for (let mm = 0; ; mm += unitMm) {
    const x = SCALE_START + mm * perMm;
    if (x > end) break;
    const long = mm % 10 === 0;
    const mid = !long && mm % 5 === 0;
    const h = long ? TICK.long : mid ? TICK.mid : TICK.short;
    d += `M${x.toFixed(2)} 0V${h}`;
    if (long && (mm / 10) % labelCm === 0) labels.push({ x, text: String(mm / 10) });
  }
  return { d, labels };
}

// ===== overlay

export interface RulerOverlayProps {
  /** toolState.rulerOn. */
  visible: boolean;
  /** Distance of the first-use hint from the top of the canvas area (px). */
  hintTop?: number;
}

export function RulerOverlay({ visible, hintTop = 12 }: RulerOverlayProps) {
  const ruler = useRuler();
  const { cx, cy, angle, hitTest } = ruler;
  const { scale, tx, ty, toPage, pageOrigin } = useOverlay();
  const rootRef = useAnimatedRef<ComponentRef<typeof Animated.View>>();
  const viewW = useSharedValue(0);
  const viewH = useSharedValue(0);
  const claimed = useSharedValue(false);
  const rotating = useSharedValue(false);
  const ids = useSharedValue<number[]>([-1, -1]);
  /** [midX, midY, fingerAngle, cx0, cy0, angle0, originX, originY] at the start. */
  const start = useSharedValue<number[]>([0, 0, 0, 0, 0, 0, 0, 0]);
  const pillW = useSharedValue(0);
  const pillH = useSharedValue(0);
  const [pxPerMm, setPxPerMm] = useState(0);
  const [degrees, setDegrees] = useState(() => angleLabel(0));
  const hint = useSyncExternalStore(subscribeHint, getHint, getHint);

  useEffect(() => {
    if (visible) maybeShowRulerHint();
    else hideRulerHint();
  }, [visible]);

  // A ruler that disappears in the middle of a gesture (hidden from the toolbar, or the editor closing)
  // must still give the overlay back: hiding it unmounts the GestureDetector, which may never
  // finalize, and a claim left behind would freeze every canvas gesture.
  useEffect(() => {
    if (!visible) return undefined;
    return () => {
      if (claimed.get()) {
        claimed.set(false);
        rotating.set(false);
        ids.set([-1, -1]);
        releaseOverlay();
      }
    };
  }, [visible, claimed, rotating, ids]);

  // The page scale under the ruler's centre (screen px per page point).
  useAnimatedReaction(
    () => {
      scale.get();
      tx.get();
      ty.get();
      const p = toPage(cx.get(), cy.get());
      if (!p) return -1;
      const o = pageOrigin(p.pageId);
      return o && o.k > 0 ? Math.round(o.k * PT_PER_MM * 100) / 100 : -1;
    },
    (cur, prev) => {
      if (cur > 0 && cur !== prev) scheduleOnRN(setPxPerMm, cur);
    },
  );

  // The angle label, only when the whole degree changes.
  useAnimatedReaction(
    () => angleLabel(angle.get()),
    (cur, prev) => {
      if (cur !== prev) scheduleOnRN(setDegrees, cur);
    },
  );

  const gesture = useManualGesture({
    onTouchesDown: (e) => {
      'worklet';
      if (claimed.get()) return;
      const all = e.allTouches;
      if (all.length < 2) return;
      const m = measure(rootRef);
      const ox = m ? m.pageX : 0;
      const oy = m ? m.pageY : 0;
      const a = all[0];
      const b = all[1];
      const x1 = a.absoluteX - ox;
      const y1 = a.absoluteY - oy;
      const x2 = b.absoluteX - ox;
      const y2 = b.absoluteY - oy;
      if (!hitTest(x1, y1) || !hitTest(x2, y2)) {
        GestureStateManager.fail(e.handlerTag);
        return;
      }
      claimOverlay();
      claimed.set(true);
      ids.set([a.id, b.id]);
      start.set([(x1 + x2) / 2, (y1 + y2) / 2, Math.atan2(y2 - y1, x2 - x1), cx.get(), cy.get(), angle.get(), ox, oy]);
      rotating.set(true);
      GestureStateManager.activate(e.handlerTag);
    },
    onTouchesMove: (e) => {
      'worklet';
      if (!claimed.get()) return;
      const [ia, ib] = ids.get();
      const all = e.allTouches;
      const a = all.find((t) => t.id === ia);
      const b = all.find((t) => t.id === ib);
      if (!a || !b) return;
      const s = start.get();
      const x1 = a.absoluteX - s[6];
      const y1 = a.absoluteY - s[7];
      const x2 = b.absoluteX - s[6];
      const y2 = b.absoluteY - s[7];
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      let turn = Math.atan2(y2 - y1, x2 - x1) - s[2];
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn <= -Math.PI) turn += Math.PI * 2;
      let next = s[5] + turn;
      while (next > Math.PI) next -= Math.PI * 2;
      while (next <= -Math.PI) next += Math.PI * 2;
      next = snapRulerAngle(next);
      const d = next - s[5];
      const c = Math.cos(d);
      const sn = Math.sin(d);
      const vx = s[3] - s[0];
      const vy = s[4] - s[1];
      let ncx = mx + vx * c - vy * sn;
      let ncy = my + vx * sn + vy * c;
      const w = viewW.get();
      const h = viewH.get();
      if (w > 0) ncx = Math.min(w, Math.max(0, ncx));
      if (h > 0) ncy = Math.min(h, Math.max(0, ncy));
      cx.set(ncx);
      cy.set(ncy);
      angle.set(next);
    },
    onTouchesUp: (e) => {
      'worklet';
      if (claimed.get()) {
        const [ia, ib] = ids.get();
        if (e.changedTouches.some((t) => t.id === ia || t.id === ib)) GestureStateManager.deactivate(e.handlerTag);
        return;
      }
      if (e.numberOfTouches <= e.changedTouches.length) GestureStateManager.fail(e.handlerTag);
    },
    onFinalize: () => {
      'worklet';
      if (claimed.get()) {
        claimed.set(false);
        releaseOverlay();
        markRulerPlaced();
      }
      rotating.set(false);
      ids.set([-1, -1]);
    },
  });

  const rulerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: cx.get() - RULER_LENGTH / 2 },
      { translateY: cy.get() - RULER_WIDTH / 2 },
      { rotate: `${angle.get()}rad` },
    ],
  }));

  const pillStyle = useAnimatedStyle(() => {
    const a = angle.get();
    // Beside the ruler on its lower side, upright.
    let nx = -Math.sin(a);
    let ny = Math.cos(a);
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const off = RULER_WIDTH / 2 + 22;
    const show = rotating.get() && pillW.get() > 0;
    return {
      opacity: show ? 1 : 0,
      transform: [{ translateX: cx.get() + nx * off - pillW.get() / 2 }, { translateY: cy.get() + ny * off - pillH.get() / 2 }],
    };
  });

  if (!visible) return null;

  const { d, labels } = rulerScale(pxPerMm);

  const onRootLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    viewW.set(width);
    viewH.set(height);
    if (width > 0 && height > 0) placeRuler(width, height);
  };
  const onPillLayout = (e: LayoutChangeEvent) => {
    pillW.set(e.nativeEvent.layout.width);
    pillH.set(e.nativeEvent.layout.height);
  };

  return (
    <Animated.View ref={rootRef} collapsable={false} pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={onRootLayout}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessible
          accessibilityLabel={tr('المسطرة', 'Ruler')}
          accessibilityHint={tr('حرّكها وأدرها بإصبعين', 'Move and turn it with two fingers')}
          style={[styles.ruler, PHYSICAL_ORIGIN, rulerStyle]}>
          <Svg width={RULER_LENGTH} height={RULER_WIDTH} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Path d={d} stroke={nbColors.muted} strokeWidth={1.2} />
          </Svg>
          {labels.map((l) => (
            <Text key={l.x} style={[styles.label, physicalLeft(l.x - 3)]} pointerEvents="none">
              {l.text}
            </Text>
          ))}
        </Animated.View>
      </GestureDetector>

      <Animated.View pointerEvents="none" onLayout={onPillLayout} style={[styles.pill, PHYSICAL_ORIGIN, pillStyle]}>
        <Text style={styles.pillText}>{degrees}</Text>
      </Animated.View>

      {hint ? (
        <View pointerEvents="none" style={[styles.hintRow, { top: hintTop }]}>
          <View style={[styles.hint, { flexDirection: row }]} accessibilityLiveRegion="polite">
            <Icon name="info" size={16} color={nbColors.accentDark} />
            <Text style={styles.hintText}>{tr('اضغط مطولاً في نهاية الخط ليصبح شكلاً مستقيماً', 'Hold at the end of a line to make it straight')}</Text>
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ruler: {
    position: 'absolute',
    top: 0,
    width: RULER_LENGTH,
    height: RULER_WIDTH,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: nbColors.borderStrong,
    backgroundColor: 'rgba(241, 245, 249, 0.9)',
    ...shadow,
  },
  label: {
    position: 'absolute',
    top: 25,
    fontFamily: fonts.regular,
    fontSize: 11,
    color: nbColors.muted,
  },
  pill: {
    position: 'absolute',
    top: 0,
    backgroundColor: nbColors.text,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: nbColors.white,
  },
  hintRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hint: {
    alignItems: 'center',
    gap: 6,
    backgroundColor: nbColors.accentTint,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '92%',
  },
  hintText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: nbColors.accentDark,
    flexShrink: 1,
  },
});
