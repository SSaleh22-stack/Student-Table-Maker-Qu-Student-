/**
 * The four drop zones shown while the toolbar is lifted (P13, Figma 18): dashed rounded bands at the
 * top, bottom, left and right edges with a label pill ('أعلى', 'أسفل', 'يسار', 'يمين'). The zone under
 * the finger lights up (accent fill and border, white-on-accent pill).
 *
 * Zones come from core/toolbar/dock.ts dropZones (physical rects) and are placed with physicalLeft,
 * so 'يسار' is always on the physical left, whatever the language. Portrait phones get only the top
 * and bottom zones. The zones never take touches (the drag is handled by MovableToolbar).
 */
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { colors } from '@/lib/theme';
import { posIndex, TOOLBAR_POSITIONS, type DropZoneRects, type Rect, type ToolbarPos } from '@/notebook/core/toolbar/dock';
import { nbRadius } from '@/notebook/theme';
import { physicalLeft } from '@/notebook/ui';

import { positionLabel } from './toolMeta';

const OFF_FILL = 'rgba(127, 211, 227, 0.12)';
const ON_FILL = 'rgba(14, 116, 144, 0.20)';

function Zone({ pos, rect, hover }: { pos: ToolbarPos; rect: Rect; hover: SharedValue<number> }) {
  const index = posIndex(pos);
  const zoneStyle = useAnimatedStyle(() => {
    const on = hover.get() === index;
    return { backgroundColor: on ? ON_FILL : OFF_FILL, borderWidth: on ? 2.5 : 1.5 };
  });
  const onPill = useAnimatedStyle(() => ({ opacity: hover.get() === index ? 1 : 0 }));
  const tall = rect.height > 200;
  const label = positionLabel(pos);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.zone,
        { top: rect.y, width: rect.width, height: rect.height, justifyContent: tall ? 'flex-start' : 'center', paddingTop: tall ? 24 : 0 },
        physicalLeft(rect.x),
        zoneStyle,
      ]}>
      <View>
        <View style={[styles.pill, styles.pillOff]}>
          <AppText size={13} weight="semibold" color={colors.accentDark}>
            {label}
          </AppText>
        </View>
        <Animated.View style={[styles.pill, styles.pillOn, StyleSheet.absoluteFill, onPill]}>
          <AppText size={13} weight="semibold" color="#FFFFFF">
            {label}
          </AppText>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

export interface DropZonesProps {
  zones: DropZoneRects;
  /** posIndex of the zone under the finger, -1 for none (UI thread). */
  hover: SharedValue<number>;
}

export function DropZones({ zones, hover }: DropZonesProps) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {TOOLBAR_POSITIONS.map((p) => {
        const r = zones[p];
        return r ? <Zone key={p} pos={p} rect={r} hover={hover} /> : null;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  zone: {
    position: 'absolute',
    borderRadius: nbRadius.folder,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    alignItems: 'center',
  },
  pill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, alignItems: 'center', justifyContent: 'center' },
  pillOff: { backgroundColor: colors.surface },
  pillOn: { backgroundColor: colors.accent },
});
