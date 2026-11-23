/**
 * Coordinates (checked by P30 against P22 gestures.ts, which writes them from the touch's view-relative
 * x / y): holdSignal.sx / sy are "screen px", in the OverlayHost's own coordinates (the same space
 * as OverlayContext.toScreen). This hint's root, an absolute-fill child of OverlayHost, shares them.
 *
 * The hold-to-snap hint (NB-44, Figma 36): 'ثبّت القلم لحظة… سيصبح مستطيلاً' above the pen point while
 * the pen is held still at the end of a stroke.
 *
 * - Shown only for the first SNAP_HINT_LIMIT (3) snaps: settings.snapHintsShown counts them (P28
 *   useShapeSnap increments it after each snap). After that only the ring and the preview appear.
 * - Visible while holdSignal.active is true and a candidate is set (P22 writes both). The canvas clears
 *   them on snap and on lift, so the hint goes away at those moments.
 * - Placed above the pen point and shifted toward awayFromHand(hand) (core/toolbar/hand.ts
 *   placeNearPoint), so the writing hand never covers it. It falls back below the point when there is no
 *   room above. Positioned from PHYSICAL_ORIGIN with a translate (transforms are never mirrored).
 * - Never takes touches (pointerEvents 'none').
 */
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { fonts } from '@/lib/theme';
import { holdSignal, useCandidate } from '@/notebook/canvas/holdSignal';
import { hintText } from '@/notebook/core/shapes/names';
import { placeNearPoint, type Hand } from '@/notebook/core/toolbar/hand';
import { useNotebookSettings } from '@/notebook/store/hooks';
import { nbColors } from '@/notebook/theme';
import { PHYSICAL_ORIGIN } from '@/notebook/ui/physical';

/** The hint shows for this many snaps, then never again. */
export const SNAP_HINT_LIMIT = 3;

/**
 * Distance between the pen point and the hint (screen px). The pencil itself covers the area just
 * above its tip (Figma 36 puts the hint about 60 px above the tip), so the gap is larger than a menu's.
 */
export const SNAP_HINT_GAP = 56;

export interface SnapHintProps {
  /** The writing hand (settings.hand): the hint is shifted to the other side. */
  hand: Hand;
}

export function SnapHint({ hand }: SnapHintProps) {
  const candidate = useCandidate();
  const [settings] = useNotebookSettings();
  // The shared values are destructured outside the worklet: holdSignal also holds JS functions.
  const { active, sx, sy } = holdSignal;
  const screenW = useSharedValue(0);
  const screenH = useSharedValue(0);
  const hintW = useSharedValue(0);
  const hintH = useSharedValue(0);

  const style = useAnimatedStyle(() => {
    const w = hintW.get();
    const h = hintH.get();
    const sw = screenW.get();
    const sh = screenH.get();
    if (!active.get() || w <= 0 || sw <= 0) return { opacity: 0, transform: [{ translateX: -10000 }, { translateY: 0 }] };
    const p = placeNearPoint({ x: sx.get(), y: sy.get() }, { width: w, height: h }, { width: sw, height: sh }, hand, {
      prefer: 'above',
      gap: SNAP_HINT_GAP,
      margin: 8,
    });
    return { opacity: 1, transform: [{ translateX: p.x }, { translateY: p.y }] };
  });

  if (!candidate || settings.snapHintsShown >= SNAP_HINT_LIMIT) return null;
  const text = hintText(candidate);

  const onRootLayout = (e: LayoutChangeEvent) => {
    screenW.set(e.nativeEvent.layout.width);
    screenH.set(e.nativeEvent.layout.height);
  };
  const onHintLayout = (e: LayoutChangeEvent) => {
    hintW.set(e.nativeEvent.layout.width);
    hintH.set(e.nativeEvent.layout.height);
  };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onRootLayout}>
      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
        onLayout={onHintLayout}
        style={[styles.hint, PHYSICAL_ORIGIN, { flexDirection: row }, style]}>
        <Icon name="clock" size={16} color={nbColors.white} />
        <Text style={styles.text} numberOfLines={1}>
          {tr(text.ar, text.en)}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    gap: 8,
    backgroundColor: nbColors.text,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    maxWidth: 420,
  },
  text: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: nbColors.white,
  },
});
