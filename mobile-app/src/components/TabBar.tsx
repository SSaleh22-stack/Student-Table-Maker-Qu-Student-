import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';

const ICONS: Record<string, IconName> = {
  index: 'home',
  timetable: 'calendar',
  gpa: 'calculator',
  absence: 'userMinus',
  qeeem: 'star',
  more: 'menu',
};

/**
 * Bottom tab bar: the active tab's icon and label turn blue (no background box).
 * On a phone held sideways it gets slim: icon and label side by side.
 */
export function TabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const slim = width > height && height < 500;

  return (
    <View
      style={[
        styles.bar,
        { flexDirection: row },
        slim && styles.barSlim,
        {
          paddingBottom: slim ? Math.max(insets.bottom, 4) : Math.max(insets.bottom, 10),
          paddingLeft: Math.max(insets.left, 6),
          paddingRight: Math.max(insets.right, 6),
        },
      ]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const { options } = descriptors[route.key];
        const label = typeof options.title === 'string' ? options.title : route.name;
        const color = focused ? colors.accent : colors.muted;

        const onPress = () => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            style={[styles.tab, slim && [styles.tabSlim, { flexDirection: row }]]}>
            {route.name === 'index' ? (
              // Home shows the Qu Student logo (same as the website); dimmed while another tab is open
              <View style={{ opacity: focused ? 1 : 0.55 }}>
                <Logo size={slim ? 20 : 24} />
              </View>
            ) : (
              <Icon
                name={ICONS[route.name] ?? 'menu'}
                size={slim ? 20 : 24}
                color={color}
                strokeWidth={focused ? 2.4 : 2}
              />
            )}
            <AppText size={slim ? 12 : 11} weight={focused ? 'bold' : 'medium'} color={color} align="center">
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  barSlim: { paddingTop: 4 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 48 },
  tabSlim: { gap: 6, minHeight: 36 },
});
