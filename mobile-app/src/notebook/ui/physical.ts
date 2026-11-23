/**
 * Physical placement: put a box at the screen's real left or right edge, whatever the language.
 *
 * WHY THIS EXISTS. React Native swaps `left` and `right` in a native right-to-left build
 * (I18nManager.isRTL with doLeftAndRightSwapInRTL, the default), the same swap src/lib/rtl.ts notes
 * for text alignment ("React Native swaps left/right in native RTL") and src/lib/insets.ts undoes for
 * the safe-area insets. Release builds force native RTL (expo-localization forcesRTL) while Expo Go and
 * the web preview stay LTR, so a plain `{ left: 12 }` lands on the physical left in Expo Go and on the
 * physical RIGHT in a release build. `fromStart`/`fromEnd` in src/lib/rtl.ts follow the READING side;
 * the notebook also needs PHYSICAL sides, because the canvas never mirrors:
 * - overlays drawn over the page (lasso handles, text boxes, ruler, snap ring): page coordinates map to
 *   physical screen x through OverlayContext.toScreen
 * - popovers and tour cards anchored to a measured rect (measureInWindow is physical)
 * - toolbar drop zones and toolbar frames (left/right toolbar positions are physical)
 * - the docked calculator (physical left in Arabic, physical right in English; ruling (f))
 *
 * RULE: every physical placement in the notebook uses physicalLeft / physicalRight (or the helpers
 * below), or a translateX from a physicalLeft(0) origin (transforms are never swapped). Never write a
 * bare `left:` or `right:` for these. Swapping is decided once: I18nManager.isRTL is fixed for the
 * app's lifetime (a language switch remounts the screens but never changes the native direction).
 *
 * Every helper is a worklet, so it can be used inside useAnimatedStyle.
 */
import { I18nManager, type ViewStyle } from 'react-native';

/** True when React Native swaps left and right (native RTL build with the default swap). */
export const PHYSICAL_SWAP: boolean = !!I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL !== false;

/** Offset from the screen's physical LEFT edge. */
export function physicalLeft(x: number): ViewStyle {
  'worklet';
  return PHYSICAL_SWAP ? { right: x } : { left: x };
}

/** Offset from the screen's physical RIGHT edge. */
export function physicalRight(x: number): ViewStyle {
  'worklet';
  return PHYSICAL_SWAP ? { left: x } : { right: x };
}

/** Both physical edges at once (e.g. a bar inset 12 from the left and 80 from the right). */
export function physicalSides(left: number, right: number): ViewStyle {
  'worklet';
  return PHYSICAL_SWAP ? { left: right, right: left } : { left, right };
}

/** Padding on the physical left and right. */
export function physicalPadding(left: number, right: number): ViewStyle {
  'worklet';
  return PHYSICAL_SWAP ? { paddingLeft: right, paddingRight: left } : { paddingLeft: left, paddingRight: right };
}

/** Margin on the physical left and right. */
export function physicalMargin(left: number, right: number): ViewStyle {
  'worklet';
  return PHYSICAL_SWAP ? { marginLeft: right, marginRight: left } : { marginLeft: left, marginRight: right };
}

/** An absolutely positioned box at physical (x, y) with a size, in the parent's coordinates. */
export function physicalBox(x: number, y: number, width: number, height?: number): ViewStyle {
  'worklet';
  const side = PHYSICAL_SWAP ? { right: x } : { left: x };
  return height === undefined
    ? { position: 'absolute', top: y, width, ...side }
    : { position: 'absolute', top: y, width, height, ...side };
}

/** The edge on which a box placed with physicalLeft(0) starts, for translateX math (always 0). */
export const PHYSICAL_ORIGIN: ViewStyle = PHYSICAL_SWAP ? { right: 0 } : { left: 0 };
