/**
 * The tour dim with a rounded hole around the highlighted area and a light ring on the hole
 * (Figma spotlight(): #1B2533 at 62 %, ring accentLight 3 pt).
 *
 * One SVG covering the overlay: the window rect plus the hole, filled with fillRule evenodd so the
 * hole stays clear. SVG content is never mirrored, and the hole comes from measureInWindow, so its
 * coordinates are physical (from the window's physical left) as they are.
 */
import { Platform, StyleSheet } from 'react-native';
import Svg, { Path, Rect as SvgRect } from 'react-native-svg';

import { colors } from '@/lib/theme';
import { holePath, holeRadius, isValidRect, type Rect } from '@/notebook/core/tours/placement';

export const SPOTLIGHT_DIM = '#1B2533';
export const SPOTLIGHT_DIM_OPACITY = 0.62;
const RING = 3;
/** Native only: on web the SVG element would get them as unknown DOM attributes. */
const HIDDEN_FROM_READERS =
  Platform.OS === 'web' ? {} : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };

export interface SpotlightProps {
  /** Overlay size (the window). */
  width: number;
  height: number;
  /** The hole (already padded), or null for a plain dim. */
  hole: Rect | null;
  /** Corner radius of the hole (999 = pill). */
  radius: number;
  /** Dim opacity (the welcome card uses the lighter modal overlay). */
  opacity?: number;
}

export function Spotlight({ width, height, hole, radius, opacity = SPOTLIGHT_DIM_OPACITY }: SpotlightProps) {
  const valid = isValidRect(hole) ? hole : null;
  const r = valid ? holeRadius(valid, radius) : 0;
  return (
    <Svg
      width={width}
      height={height}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      {...HIDDEN_FROM_READERS}>
      <Path d={holePath({ width, height }, valid ?? { x: 0, y: 0, width: 0, height: 0 }, r)} fill={SPOTLIGHT_DIM} fillOpacity={opacity} fillRule="evenodd" />
      {valid ? (
        <SvgRect
          x={valid.x}
          y={valid.y}
          width={valid.width}
          height={valid.height}
          rx={r}
          ry={r}
          fill="none"
          stroke={colors.accentLight}
          strokeWidth={RING}
        />
      ) : null}
    </Svg>
  );
}
