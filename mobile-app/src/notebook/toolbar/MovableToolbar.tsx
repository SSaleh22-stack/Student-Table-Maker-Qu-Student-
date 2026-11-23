/**
 * The movable toolbar (P13, NB-39, Figma 18): the Toolbar in its editorFrames slot, plus drag-to-dock.
 *
 * - A 350 ms long press anywhere on the bar (the grip included) lifts it: scale 1.03, rotate -2°, a
 *   deeper shadow and a haptic tap. The page dims (#1B2533 at 0.35), the drop zones appear at the
 *   edges (DropZones) and the hint pill 'اضغط مطولاً على الشريط، ثم اسحبه وأفلته عند أي حافة' shows.
 * - The bar follows the finger; the zone nearest the finger lights up (dock.ts zoneAt).
 * - On release the position is saved (setSettings({ toolbarPos }), remembered for all notebooks) and
 *   the bar springs from where it was dropped into its new slot. Dropping on its own edge springs back.
 * - Screen readers move the bar with the grip's actions ('نقل الشريط إلى الأعلى' …).
 *
 * Gestures: one RNGH v3 usePanGesture with activateAfterLongPress (lib/typescript/v3/hooks/gestures/pan):
 * a short tap never activates it, so the buttons keep working; once active it cancels their touch.
 * Worklets never call JS directly: every hop is scheduleOnRN with a plain payload.
 *
 * Compact: the bar uses the phone layout when `compact` is set OR the full bar does not fit its slot
 * (dock.ts fitsInline), and the buttons shrink (fitButtonSize) unless `buttonSize` is given. When even
 * the smallest compact bar is longer than its slot (a vertical bar on a landscape phone), the bar
 * scrolls along its axis inside the slot, so every button stays reachable and nothing covers the
 * header or the page counter.
 *
 * Layout: render it as an absolute-fill child of the editor container (the same coordinates as
 * editorFrames' screen). The root passes touches through (box-none); only the bar takes them. The
 * slot is placed with physicalLeft, and the drag uses transforms (never swapped in RTL).
 */
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import {
  allowedPositions,
  barLength,
  dropZones,
  fitButtonSize,
  fitsInline,
  isVertical,
  posIndex,
  zoneAt,
  type DockSpec,
  type Insets,
  type Rect,
  type ToolbarPos,
} from '@/notebook/core/toolbar/dock';
import { settingsStore } from '@/notebook/store/settingsStore';
import { nbRadius } from '@/notebook/theme';
import { physicalLeft } from '@/notebook/ui';

import { DropZones } from './DropZones';
import { dragHintText } from './toolMeta';
import { Toolbar, type ToolbarProps } from './Toolbar';
import type { ViewNode } from './ToolButton';

/** Long-press time before the bar lifts. */
export const LIFT_MS = 350;
const DIM = '#1B2533';
const DIM_OPACITY = 0.35;
const SPRING = { damping: 18, stiffness: 220, mass: 0.9 } as const;

export interface MovableToolbarProps extends Omit<ToolbarProps, 'onMoveTo' | 'positions' | 'style'> {
  /** The toolbar slot (editorFrames().toolbar), physical, in the editor container's coordinates. */
  frame: Rect;
  /** Size of the editor container (editorFrames' screen). */
  screen: { width: number; height: number };
  /** Safe-area insets (physical), the same ones given to editorFrames. */
  insets: Insets;
  /** The docked calculator, if any (its side's zone starts at the dock's inner edge). */
  dock?: DockSpec | null;
  /** Saves a new position. Default: setSettings({ toolbarPos }). */
  onPosChange?: (pos: ToolbarPos) => void;
  /** Told when the bar is lifted (true) and dropped (false), e.g. to pause canvas input. */
  onLiftChange?: (lifted: boolean) => void;
}

export function MovableToolbar({ frame, screen, insets, dock = null, onPosChange, onLiftChange, ...toolbar }: MovableToolbarProps) {
  const pos = toolbar.pos;
  // Phone rules also apply when the full bar does not fit its slot (a docked calculator, a landscape
  // iPad's vertical bar): compact layout, and buttons shrunk to fit when even that is too long.
  const room = isVertical(pos) ? frame.height : frame.width;
  const compact = toolbar.compact || !fitsInline(room);
  const buttonSize = toolbar.buttonSize ?? fitButtonSize(room, compact ? 'compact' : 'full');
  const vertical = isVertical(pos);
  // Smallest buttons and still too long: scroll inside the slot instead of spilling out of it.
  const overflows = room > 0 && barLength(compact ? 'compact' : 'full', { button: buttonSize }) > room;
  const allowed = useMemo(() => allowedPositions(screen), [screen]);
  const zones = useMemo(() => dropZones(screen, insets, { dock, allowed }), [screen, insets, dock, allowed]);
  const [lifted, setLifted] = useState(false);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lift = useSharedValue(0);
  const hover = useSharedValue(-1);
  const active = useSharedValue(false);
  /** Window position of this view's origin (the editor container may not start at the window origin). */
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const rootRef = useRef<ViewNode>(null);

  /** Center of the slot the bar is shown in (the bar is centered in its slot). */
  const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const pending = useRef<{ from: { x: number; y: number }; to: ToolbarPos; timer: ReturnType<typeof setTimeout> } | null>(null);

  const commit = useCallback(
    (p: ToolbarPos) => {
      if (onPosChange) onPosChange(p);
      else settingsStore.set({ toolbarPos: p });
    },
    [onPosChange],
  );

  const settle = useCallback(() => {
    tx.set(withSpring(0, SPRING));
    ty.set(withSpring(0, SPRING));
    lift.set(withTiming(0, { duration: 180 }));
  }, [tx, ty, lift]);

  // FLIP: after the new slot arrives, start the bar where it was dropped and spring it into place.
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    tx.set(p.from.x - (frame.x + frame.width / 2));
    ty.set(p.from.y - (frame.y + frame.height / 2));
    settle();
  }, [frame.x, frame.y, frame.width, frame.height, tx, ty, settle]);

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer);
    },
    [],
  );

  const measureOrigin = useCallback(() => {
    rootRef.current?.measureInWindow((x, y) => {
      originX.set(x);
      originY.set(y);
    });
  }, [originX, originY]);

  const onLifted = useCallback(() => {
    // The editor container may have moved since its last layout (keyboard, split view).
    measureOrigin();
    setLifted(true);
    onLiftChange?.(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [onLiftChange, measureOrigin]);

  const onDropped = useCallback(
    (target: ToolbarPos, dx: number, dy: number) => {
      setLifted(false);
      onLiftChange?.(false);
      if (target === pos) {
        settle();
        return;
      }
      if (pending.current) clearTimeout(pending.current.timer);
      // If the editor keeps the same slot (e.g. a fallback position), spring back after a moment.
      const timer = setTimeout(() => {
        if (pending.current?.timer === timer) {
          pending.current = null;
          settle();
        }
      }, 400);
      pending.current = { from: { x: center.x + dx, y: center.y + dy }, to: target, timer };
      commit(target);
    },
    [pos, settle, commit, onLiftChange, center.x, center.y],
  );

  const onCancelled = useCallback(() => {
    setLifted(false);
    onLiftChange?.(false);
    settle();
  }, [onLiftChange, settle]);

  const pan = usePanGesture({
    activateAfterLongPress: LIFT_MS,
    onActivate: () => {
      'worklet';
      active.set(true);
      hover.set(-1);
      lift.set(withSpring(1, SPRING));
      scheduleOnRN(onLifted);
    },
    onUpdate: (e) => {
      'worklet';
      if (!active.get()) return;
      tx.set(e.translationX);
      ty.set(e.translationY);
      hover.set(posIndex(zoneAt({ x: e.absoluteX - originX.get(), y: e.absoluteY - originY.get() }, zones, pos)));
    },
    onDeactivate: (e) => {
      'worklet';
      if (!active.get()) return;
      active.set(false);
      hover.set(-1);
      if (e.canceled) {
        scheduleOnRN(onCancelled);
        return;
      }
      const target = zoneAt({ x: e.absoluteX - originX.get(), y: e.absoluteY - originY.get() }, zones, pos);
      scheduleOnRN(onDropped, target, e.translationX, e.translationY);
    },
    onFinalize: () => {
      'worklet';
      if (!active.get()) return;
      // Cancelled while lifted (another gesture, the app went to the background).
      active.set(false);
      hover.set(-1);
      scheduleOnRN(onCancelled);
    },
  });

  const barStyle = useAnimatedStyle(() => {
    const l = lift.get();
    return {
      transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: 1 + 0.03 * l }, { rotate: `${-2 * l}deg` }],
      ...(Platform.OS === 'android'
        ? { elevation: 6 + 18 * l }
        : {
            shadowColor: '#1B2533',
            shadowOpacity: 0.1 + 0.18 * l,
            shadowRadius: 24 + 20 * l,
            shadowOffset: { width: 0, height: 8 + 12 * l },
          }),
    };
  });
  const dimStyle = useAnimatedStyle(() => ({ opacity: DIM_OPACITY * lift.get() }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: lift.get() }));

  const bar = (
    <Toolbar {...toolbar} compact={compact} buttonSize={buttonSize} onMoveTo={commit} positions={allowed} style={styles.noShadow} />
  );

  const hintTop = (zones.top ? zones.top.y + zones.top.height : insets.top + 60) + 22;

  return (
    <View ref={rootRef} collapsable={false} pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={measureOrigin}>
      {lifted ? (
        <>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: DIM }, dimStyle]} />
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, overlayStyle]}>
            <DropZones zones={zones} hover={hover} />
            <View pointerEvents="none" style={[styles.hintRow, { top: hintTop }, physicalLeft(0), { width: screen.width }]}>
              <View style={[styles.hint, { flexDirection: row }]} accessibilityLiveRegion="polite">
                <Icon name="info" size={16} color="#FFFFFF" />
                <AppText size={14} weight="medium" color="#FFFFFF">
                  {dragHintText()}
                </AppText>
              </View>
            </View>
          </Animated.View>
        </>
      ) : null}
      <View
        pointerEvents="box-none"
        style={[styles.slot, { top: frame.y, width: frame.width, height: frame.height }, physicalLeft(frame.x)]}>
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.lifter, barStyle]}>
            {overflows ? (
              <ScrollView
                horizontal={!vertical}
                style={[styles.scroller, vertical ? { maxHeight: room } : { maxWidth: room }]}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                bounces={false}
                overScrollMode="never">
                {bar}
              </ScrollView>
            ) : (
              bar
            )}
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  // The lifter carries the bar's shadow (an opaque, same-shape view, so Android elevation works too).
  lifter: { borderRadius: nbRadius.card, backgroundColor: colors.surface },
  noShadow: { shadowOpacity: 0, elevation: 0 },
  scroller: { flexGrow: 0, borderRadius: nbRadius.card },
  hintRow: { position: 'absolute', alignItems: 'center' },
  hint: {
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.text,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    maxWidth: '92%',
  },
});
