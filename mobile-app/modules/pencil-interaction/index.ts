/**
 * Apple Pencil double tap and squeeze for the notebook (PRD NB-52: by default they switch between
 * the current tool and the eraser; notebook settings can make them "switch to last tool" or do
 * nothing). This module only reports the gesture: the canvas (src/notebook/canvas/pencil.ts) maps
 * it to an action from settings.pencilDoubleTap / settings.pencilSqueeze.
 *
 * iOS only, through one UIPencilInteraction on the key window. Elsewhere, and in builds without
 * the native module (Expo Go, older builds), everything is a no-op: enable() resolves false, no
 * events arrive, prefersPencilOnlyDrawing() resolves false.
 *
 * - Double tap: Apple Pencil (2nd generation) and Apple Pencil Pro, any supported iOS.
 * - Squeeze: Apple Pencil Pro on iOS 17.5+. Every phase is reported; usePencilInteraction passes
 *   only 'ended' (a completed squeeze) to its handler.
 * - preferredAction is the student's choice in Settings > Apple Pencil, for reference only: the
 *   notebook follows its own setting.
 *
 * DEVICE CHECKLIST (dev build on an iPad with Apple Pencil 2 or Pro; Swift first compiled there):
 * 1. Editor open: one double tap gives exactly ONE 'tap' event (no duplicate on iOS 17.5+).
 * 2. Leaving and re-entering the editor, or a JS reload (r in Metro), never doubles the events:
 *    still one per double tap.
 * 3. Two screens using usePencilInteraction at once (editor + a sheet): closing one keeps taps
 *    working in the other (reference count).
 * 4. Pencil Pro on iOS 17.5+: a squeeze gives began, then ended; usePencilInteraction calls the
 *    handler once, on ended. Hover pose x/y match the tip position (window points) when it is near.
 * 5. With enabled=false (setting 'off', or no editor open), taps and squeezes change nothing
 *    in the app; isEnabled() resolves false.
 * 6. prefersPencilOnlyDrawing() follows Settings > Apple Pencil > Only Draw with Apple Pencil.
 * 7. Split View / Stage Manager: after moving focus to another app and back, taps still arrive.
 */
import { useEffect, useEffectEvent } from 'react';
import { requireOptionalNativeModule, type EventEmitter, type EventSubscription } from 'expo';
import { Platform } from 'react-native';

export type PencilPreferredAction =
  | 'ignore'
  | 'switchEraser'
  | 'switchPrevious'
  | 'showColorPalette'
  | 'showInkAttributes'
  | 'showContextualPalette'
  | 'runSystemShortcut'
  | 'unknown';

export type PencilPhase = 'began' | 'changed' | 'ended' | 'cancelled' | 'unknown';

/** Where the tip was during the gesture (iOS 17.5+, tip near the screen). x and y are window points. */
export type PencilHoverPose = {
  x: number;
  y: number;
  zOffset: number;
  altitudeAngle: number;
  azimuthAngle: number;
  rollAngle: number;
};

export type PencilTapEvent = {
  kind: 'tap';
  preferredAction: PencilPreferredAction;
  /** Seconds on the system uptime clock. */
  timestamp: number;
  hoverPose?: PencilHoverPose;
};

export type PencilSqueezeEvent = {
  kind: 'squeeze';
  phase: PencilPhase;
  preferredAction: PencilPreferredAction;
  /** Seconds on the system uptime clock. */
  timestamp: number;
  hoverPose?: PencilHoverPose;
};

export type PencilEvent = PencilTapEvent | PencilSqueezeEvent;

type PencilEvents = {
  tap: (event: PencilTapEvent) => void;
  squeeze: (event: PencilSqueezeEvent) => void;
};

type NativePencilInteraction = EventEmitter<PencilEvents> & {
  enable(): Promise<boolean>;
  disable(): Promise<void>;
  isEnabled(): Promise<boolean>;
  prefersPencilOnlyDrawing(): Promise<boolean>;
  preferredActions(): Promise<{ tap: PencilPreferredAction; squeeze: PencilPreferredAction }>;
};

const native =
  Platform.OS === 'ios' ? requireOptionalNativeModule<NativePencilInteraction>('PencilInteraction') : null;

/** True when this build has the native module (iOS build made after it was added). */
export const pencilInteractionSupported = native !== null;

/**
 * Attaches the interaction to the key window (a second call is a no-op). Resolves false off iOS or
 * when there is no window yet. Low level: screens should use usePencilInteraction, which counts
 * users so one screen cannot switch it off under another.
 */
export async function enable(): Promise<boolean> {
  return native ? native.enable() : false;
}

/** Removes the interaction. Low level: see enable(). */
export async function disable(): Promise<void> {
  if (native) await native.disable();
}

/** The student's "Only Draw with Apple Pencil" setting (Settings > Apple Pencil). False off iOS. */
export async function prefersPencilOnlyDrawing(): Promise<boolean> {
  return native ? native.prefersPencilOnlyDrawing() : false;
}

/** What the student set for double tap and squeeze in Settings > Apple Pencil, for reference. */
export async function preferredActions(): Promise<{ tap: PencilPreferredAction; squeeze: PencilPreferredAction }> {
  return native ? native.preferredActions() : { tap: 'ignore', squeeze: 'ignore' };
}

/** Every tap and every squeeze phase. Remember to remove() the subscription. */
export function addPencilListener(listener: (event: PencilEvent) => void): EventSubscription {
  if (!native) return { remove() {} };
  const tap = native.addListener('tap', listener);
  const squeeze = native.addListener('squeeze', listener);
  return {
    remove() {
      tap.remove();
      squeeze.remove();
    },
  };
}

let users = 0;

function acquire(): void {
  users += 1;
  if (users === 1 && native) {
    // A failure only means no Pencil events; drawing still works.
    native.enable().catch(() => {});
  }
}

function release(): void {
  users = Math.max(0, users - 1);
  if (users === 0 && native) {
    native.disable().catch(() => {});
  }
}

/**
 * While `enabled` is true (and the component is mounted), calls `handler` for each double tap and
 * each COMPLETED squeeze (phase 'ended'). The interaction stays attached as long as any screen uses
 * this hook with enabled true. The latest `handler` is always used, so it need not be memoized.
 */
export function usePencilInteraction(
  handler: (event: PencilTapEvent | PencilSqueezeEvent) => void,
  enabled: boolean = true,
): void {
  const onEvent = useEffectEvent((event: PencilEvent) => {
    if (event.kind === 'squeeze' && event.phase !== 'ended') return;
    handler(event);
  });

  useEffect(() => {
    if (!enabled || !native) return;
    acquire();
    const subscription = addPencilListener((event) => onEvent(event));
    return () => {
      subscription.remove();
      release();
    };
  }, [enabled]);
}
