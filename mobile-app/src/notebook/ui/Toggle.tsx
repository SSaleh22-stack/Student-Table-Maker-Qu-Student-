/**
 * The Figma switch: 52 x 32, accent when on, #CBD5E1 when off, a 26 pt white knob. The knob sits at
 * the reading END when on (the physical left in Arabic, as in Figma; the right in English).
 *
 * With onChange it is its own accessible switch (role 'switch', needs `label`). Without onChange it is
 * a drawing only, hidden from screen readers, for rows that are the switch themselves (ToggleRow).
 */
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { isRTL } from '@/lib/rtl';
import { colors } from '@/lib/theme';

import { PHYSICAL_ORIGIN } from './physical';

const W = 52;
const H = 32;
const KNOB = 26;
const GAP = 3;
const OFF_COLOR = '#CBD5E1';

/** Figma SHADOW_SM on the knob. */
const KNOB_SHADOW = Platform.select({
  ios: { shadowColor: '#1B2533', shadowOpacity: 0.16, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  android: { elevation: 2 },
  default: { boxShadow: '0 1px 4px rgba(27, 37, 51, 0.16)' },
}) as object;

/** The knob's distance from the physical left edge. */
function knobX(on: boolean): number {
  const atLeft = on === isRTL;
  return atLeft ? GAP : W - KNOB - GAP;
}

/** With onChange the switch is its own control, so its screen-reader name (label) is required. */
export type ToggleProps = { value: boolean; hint?: string; disabled?: boolean } & (
  | { onChange: (next: boolean) => void; label: string }
  | { onChange?: undefined; label?: string }
);

export function Toggle({ value, onChange, label, hint, disabled }: ToggleProps) {
  const x = useSharedValue(knobX(value));
  useEffect(() => {
    x.set(withTiming(knobX(value), { duration: 160 }));
  }, [value, x]);
  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  const track = (
    <View style={[styles.track, { backgroundColor: value ? colors.accent : OFF_COLOR }, disabled && styles.disabled]}>
      <Animated.View style={[styles.knob, PHYSICAL_ORIGIN, KNOB_SHADOW, knobStyle]} />
    </View>
  );

  if (!onChange) {
    return (
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {track}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value, disabled: !!disabled }}>
      {track}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: W, height: H, borderRadius: H / 2 },
  knob: {
    position: 'absolute',
    top: GAP,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: '#FFFFFF',
  },
  disabled: { opacity: 0.5 },
});
