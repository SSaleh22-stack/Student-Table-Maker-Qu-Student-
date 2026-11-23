/**
 * The notebook (المذكرات) route group: a nested Stack with no headers, plus the notebook toast host.
 *
 * Options are chosen by route name in screenOptions, so this layout declares no Stack.Screen and works
 * before the routes exist (they land in later packages: index/section/deleted P21, edit P29, pages
 * P25, settings P26, restore P20, receive/import P17, spike P16):
 * - 'edit/[id]': no back swipe (it would fight the pen), the canvas grey behind the page, and a fade
 *   on iOS / no animation on Android (the opaque Skia canvas is a SurfaceView, which tears during a
 *   slide).
 * - 'receive' and 'import': transparent modals over the screen below, fading in.
 */
import { Stack, type NativeStackNavigationOptions } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { nbColors } from '@/notebook/theme';
import { NbToastHost } from '@/notebook/ui/NbToastHost';

function screenOptions({ route }: { route: { name: string } }): NativeStackNavigationOptions {
  switch (route.name) {
    case 'edit/[id]':
      return {
        headerShown: false,
        gestureEnabled: false,
        contentStyle: { backgroundColor: nbColors.canvas },
        animation: Platform.OS === 'ios' ? 'fade' : 'none',
      };
    case 'receive':
    case 'import':
      return {
        headerShown: false,
        presentation: 'transparentModal',
        animation: 'fade',
        contentStyle: { backgroundColor: 'transparent' },
      };
    default:
      return { headerShown: false, contentStyle: { backgroundColor: nbColors.bg } };
  }
}

export default function NotebookLayout() {
  return (
    <View style={styles.root}>
      <Stack screenOptions={screenOptions} />
      <NbToastHost />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
