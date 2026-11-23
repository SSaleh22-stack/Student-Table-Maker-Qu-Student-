/**
 * The overlay layer above the page canvas (P22, ruling (p)): selection handles and menu (P27), the
 * ruler, the text editor and the snap hint (P28) are rendered here as SIBLING views of the canvas,
 * inside the OverlayContext provider.
 *
 * - The host is an absolute-fill view in the same box as the canvas, so its coordinates are the
 *   canvas view's own (screen px in contracts/canvas.ts): an overlay places itself with the context's
 *   pageOrigin / toScreen and follows zoom through scale / tx / ty.
 * - pointerEvents 'box-none': the host itself never takes a touch. Only the overlays' real hit areas
 *   (handles, buttons, the ruler body) do; every other touch falls through to the canvas gestures.
 * - Overlay gestures call claimOverlay() in onBegin and releaseOverlay() in onFinalize, and the canvas
 *   gestures fail while overlayBusy > 0.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { OverlayContextValue } from '@/notebook/contracts/canvas';
import { OverlayContext } from '@/notebook/canvas/overlayContext';

export interface OverlayHostProps {
  value: OverlayContextValue;
  children?: ReactNode;
}

export function OverlayHost({ value, children }: OverlayHostProps) {
  return (
    <OverlayContext.Provider value={value}>
      <View style={styles.host} collapsable={false}>
        {children}
      </View>
    </OverlayContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'box-none' },
});
