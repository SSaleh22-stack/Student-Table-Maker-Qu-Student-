import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';

export interface ToastData {
  /** Changes for every new message, so a new toast starts from the middle again */
  id: number;
  text: string;
  /** Second line, e.g. "تتعارض مع MATH201 · 03" */
  detail?: string;
  tone: 'ok' | 'warn';
  undo?: () => void;
}

/**
 * A short message with an undo button. Swipe it sideways, or toward its edge (up at the top,
 * down at the bottom), to dismiss it.
 * - `position`: "top" on phones, so it never covers the course cards being tapped; it is
 *   placed from the top of the screen, so render it outside any safe-area padding.
 * - `inset`: gap to each side (bigger on iPad, so the message stays a readable width).
 */
export function Toast({
  toast,
  onDismiss,
  inset = 16,
  position = 'bottom',
}: {
  toast: ToastData;
  onDismiss: () => void;
  inset?: number;
  position?: 'top' | 'bottom';
}) {
  const insets = useSafeAreaInsets();
  const atTop = position === 'top';
  const x = useSharedValue(0);
  const y = useSharedValue(0);

  useEffect(() => {
    x.set(0);
    y.set(0);
  }, [toast.id, x, y]);

  const pan = usePanGesture({
    minDistance: 6,
    onUpdate: (e) => {
      'worklet';
      x.set(e.translationX);
      // Only toward the edge it sits on.
      y.set(atTop ? Math.min(0, e.translationY) : Math.max(0, e.translationY));
    },
    onDeactivate: (e) => {
      'worklet';
      const sideways = Math.abs(e.translationX) > 80 || Math.abs(e.velocityX) > 700;
      const toEdge = atTop ? e.translationY < -30 || e.velocityY < -500 : e.translationY > 40 || e.velocityY > 600;
      if (!sideways && !toEdge) {
        x.set(withSpring(0));
        y.set(withSpring(0));
        return;
      }
      const done = (finished?: boolean) => {
        'worklet';
        if (finished) scheduleOnRN(onDismiss);
      };
      if (sideways) x.set(withTiming(e.translationX > 0 ? 500 : -500, { duration: 160 }, done));
      else y.set(withTiming(atTop ? -160 : 140, { duration: 160 }, done));
    },
  });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }],
    opacity: 1 - Math.min(0.8, Math.abs(x.get()) / 300 + Math.abs(y.get()) / 160),
  }));

  const warn = toast.tone === 'warn';

  // Two layers: the outer one places the message and fades it in; the inner one follows the
  // finger. (One view can't take both a layout animation and an animated transform.)
  return (
    <Animated.View
      key={toast.id}
      entering={(atTop ? FadeInUp : FadeInDown).duration(180)}
      style={[styles.place, { left: inset, right: inset }, atTop ? { top: insets.top + 6 } : { bottom: 12 }]}>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.toast, { flexDirection: row }, style]}
          accessibilityLiveRegion="polite"
          accessibilityHint={tr('اسحب الرسالة لإخفائها', 'Swipe the message to hide it')}>
          <Icon name={warn ? 'alert' : 'check'} size={18} color={warn ? '#F5B467' : colors.accentLight} />
          <View style={{ flex: 1 }}>
            <AppText size={13} color="#FFFFFF" numberOfLines={1}>
              {toast.text}
            </AppText>
            {toast.detail ? (
              <AppText size={12} color="#F5B467" numberOfLines={1}>
                {toast.detail}
              </AppText>
            ) : null}
          </View>
          {toast.undo ? (
            <Pressable
              onPress={() => {
                toast.undo?.();
                onDismiss();
              }}
              accessibilityRole="button"
              hitSlop={8}
              style={[styles.undo, { flexDirection: row }]}>
              <Icon name="undo" size={15} color={colors.accentLight} />
              <AppText size={13} weight="bold" color={colors.accentLight}>
                {tr('تراجع', 'Undo')}
              </AppText>
            </Pressable>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  place: { position: 'absolute' },
  toast: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.ink,
  },
  undo: { alignItems: 'center', gap: 4, paddingVertical: 4 },
});
