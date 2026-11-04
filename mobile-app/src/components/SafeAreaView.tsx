import type { ReactNode } from 'react';
import { I18nManager, type StyleProp, View, type ViewStyle } from 'react-native';
import { type Edge, useSafeAreaInsets } from 'react-native-safe-area-context';

const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

/** In a right-to-left build React Native flips left/right padding, but the insets are physical sides. */
const flipSides = I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL;

/**
 * Keeps a screen clear of the notch, status bar and system buttons, like the library's SafeAreaView.
 * The padding comes from the insets hook instead of the native view: on Android the native view
 * kept its landscape padding after the phone was turned back to portrait, so the page looked cut
 * until it was scrolled.
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
  const insets = useSafeAreaInsets();
  const left = edges.includes('left') ? insets.left : 0;
  const right = edges.includes('right') ? insets.right : 0;
  return (
    <View
      style={[
        style,
        {
          paddingTop: edges.includes('top') ? insets.top : 0,
          paddingRight: flipSides ? left : right,
          paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
          paddingLeft: flipSides ? right : left,
        },
      ]}>
      {children}
    </View>
  );
}
