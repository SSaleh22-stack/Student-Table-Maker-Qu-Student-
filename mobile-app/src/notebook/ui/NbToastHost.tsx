/**
 * Shows the notebook toast (ui/toast.ts) with the app's shared Toast (src/components/Toast.tsx:
 * swipe to dismiss, undo button). Mounted once, after the Stack in src/app/notebook/_layout.tsx, so it
 * sits above every notebook screen. It covers the screen with pointerEvents 'box-none', so only the
 * toast itself takes touches.
 */
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Toast, type ToastData } from '@/components/Toast';

import { widthClassOf } from './layout';
import { hideToastKey, useToast } from './toast';

/** Widest a toast gets on a tablet, so the message stays readable. */
const MAX_TOAST_WIDTH = 560;

export function NbToastHost() {
  const entry = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // The auto-hide timer lives in toast.ts (it runs even while no host is mounted).

  if (!entry) return null;

  const inset = widthClassOf(width) === 'compact' ? 16 : Math.max(24, Math.round((width - MAX_TOAST_WIDTH) / 2));
  const data: ToastData = {
    id: entry.showId,
    text: entry.text,
    detail: entry.detail,
    tone: entry.tone === 'warn' ? 'warn' : 'ok',
    undo: entry.onAction,
    actionLabel: entry.actionLabel,
  };
  const atTop = entry.position === 'top';

  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, atTop ? null : { bottom: insets.bottom + entry.bottomOffset }]}>
      <Toast toast={data} inset={inset} position={entry.position} onDismiss={() => hideToastKey(entry.key)} />
    </View>
  );
}
