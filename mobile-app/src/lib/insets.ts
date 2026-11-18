import { useVerticalBarEdgeIOS } from 'expo-status-bar';
import { I18nManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * In a right-to-left build React Native swaps left/right padding and offsets, but safe-area
 * insets are physical sides. Use `sides()` to put each inset on its real side.
 */
export const flipSides = I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL;

/** `left`/`right` style values for physical left and right amounts, swapped back in native RTL. */
export const sides = (left: number, right: number) =>
  flipSides ? { left: right, right: left } : { left, right };

/** Padding on the physical left and right sides, swapped back in native RTL. */
export const padSides = (left: number, right: number) =>
  flipSides ? { paddingLeft: right, paddingRight: left } : { paddingLeft: left, paddingRight: right };

/**
 * When iPhone Duo (unfolded) moves the status bar into a side bar, the top inset becomes 0, but
 * UIKit still keeps bars this far from the top edge (the same value expo-router uses).
 */
const VERTICAL_BAR_TOP = 24;

/**
 * Safe-area insets for drawing our own bars. Same as `useSafeAreaInsets()`, except that the top
 * keeps a small gap when the status bar sits in the side bar, so headers don't touch the edge.
 * The side bar itself comes in as a left or right inset.
 */
export function useScreenInsets() {
  const insets = useSafeAreaInsets();
  const verticalBar = useVerticalBarEdgeIOS();
  const top = insets.top === 0 && verticalBar != null ? VERTICAL_BAR_TOP : insets.top;
  return { ...insets, top };
}
