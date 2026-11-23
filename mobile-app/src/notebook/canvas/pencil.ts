/**
 * Apple Pencil double tap and squeeze (P22, NB-52), through the P11 pencil-interaction module (a no-op
 * off iOS and in builds without the module).
 *
 * The notebook follows its own settings (pencilDoubleTap, pencilSqueeze: 'eraser' | 'lastTool' |
 * 'off'), not the iOS Settings preference: each tap and each COMPLETED squeeze is mapped to
 * onPencilAction('eraser' | 'lastTool'); 'off' ignores it. The interaction is detached when both are
 * off.
 *
 * usePencilOnlyPreference(cb) reports the iOS "Only Draw with Apple Pencil" preference, which the canvas
 * treats like "a stylus was already seen" (fingers scroll).
 */
import { useEffect, useEffectEvent } from 'react';

import { prefersPencilOnlyDrawing, usePencilInteraction, type PencilSqueezeEvent, type PencilTapEvent } from '../../../modules/pencil-interaction';

export type PencilSetting = 'eraser' | 'lastTool' | 'off';

/** The action for a Pencil event under the given settings, or null to ignore it. */
export function pencilActionFor(event: PencilTapEvent | PencilSqueezeEvent, doubleTap: PencilSetting, squeeze: PencilSetting): 'eraser' | 'lastTool' | null {
  const setting = event.kind === 'tap' ? doubleTap : squeeze;
  return setting === 'off' ? null : setting;
}

export function usePencilActions(doubleTap: PencilSetting, squeeze: PencilSetting, onPencilAction: ((a: 'eraser' | 'lastTool') => void) | undefined): void {
  const enabled = !!onPencilAction && !(doubleTap === 'off' && squeeze === 'off');
  usePencilInteraction((event) => {
    const a = pencilActionFor(event, doubleTap, squeeze);
    if (a && onPencilAction) onPencilAction(a);
  }, enabled);
}

/** Calls cb(true) once when iOS is set to "Only Draw with Apple Pencil". */
export function usePencilOnlyPreference(cb: (pencilOnly: boolean) => void): void {
  const report = useEffectEvent((v: boolean) => cb(v));
  useEffect(() => {
    let alive = true;
    prefersPencilOnlyDrawing()
      .then((v) => {
        if (alive && v) report(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
}
