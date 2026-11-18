import type { ReactNode } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { padSides, useScreenInsets } from '@/lib/insets';

const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

/**
 * Keeps a screen clear of the notch, status bar and system buttons, like the library's SafeAreaView.
 * The padding comes from the insets hook instead of the native view: on Android the native view
 * kept its landscape padding after the phone was turned back to portrait, so the page looked cut
 * until it was scrolled.
 *
 * Keep 'left' and 'right' in `edges` on every screen: on iPhone Duo (unfolded) the status bar can
 * sit in a side bar, which comes in as a left or right inset even in portrait.
 */
export function SafeAreaView({
  edges = ALL_EDGES,
  style,
  children,
}: {
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const insets = useScreenInsets();
  const left = edges.includes('left') ? insets.left : 0;
  const right = edges.includes('right') ? insets.right : 0;
  return (
    <View
      style={[
        style,
        {
          paddingTop: edges.includes('top') ? insets.top : 0,
          paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
          ...padSides(left, right),
        },
      ]}>
      {children}
    </View>
  );
}
