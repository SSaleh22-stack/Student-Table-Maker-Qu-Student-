/**
 * The calculator in the editor (NB-47a, Figma 22 docked, 23 floating). P24's CalculatorPanel draws it;
 * this file places it and owns settings.calc.open / settings.calc.docked:
 * - docked: the panel fills `frame`, the dock rect from editorFrames (tablets: CALC_DOCK_WIDTH on the
 *   physical left in every language, the full height of the editor), or the bottom
 *   CALC_PHONE_DOCK_FRACTION of the editor on compact windows. The safe-area
 *   room the panel must keep clear comes in as padding.
 * - floating: the panel's own overlay fills the editor (absolute fill, box-none), above the toolbar.
 * - 'عائمة' / 'تثبيت' writes setSettings({ calc: { docked } }); close writes { calc: { open: false } }.
 * The keys and memories live in calcStore (one machine for the app), so switching between
 * docked and floating keeps the expression.
 */
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { CalculatorPanel, type CalcPanelMode } from '@/notebook/calc/CalculatorPanel';
import type { Rect } from '@/notebook/core/toolbar/dock';
import { useNotebookSettings } from '@/notebook/store/hooks';
import { nbColors } from '@/notebook/theme';
import { physicalBox, physicalPadding } from '@/notebook/ui/physical';

export interface CalculatorDockProps {
  /** Where the docked panel goes (physical, editor container coordinates); null when floating. */
  frame: Rect | null;
  /** Safe-area room inside the docked frame (physical). */
  pad?: { top?: number; bottom?: number; left?: number; right?: number };
}

export function CalculatorDock({ frame, pad }: CalculatorDockProps) {
  const [settings, setSettings] = useNotebookSettings();
  const { open, docked } = settings.calc;

  const onModeChange = useCallback((mode: CalcPanelMode) => setSettings({ calc: { docked: mode === 'docked' } }), [setSettings]);
  const onClose = useCallback(() => setSettings({ calc: { open: false } }), [setSettings]);

  if (!open) return null;

  if (docked && frame) {
    return (
      <View
        style={[
          styles.dock,
          physicalBox(frame.x, frame.y, frame.width, frame.height),
          { paddingTop: pad?.top ?? 0, paddingBottom: pad?.bottom ?? 0 },
          physicalPadding(pad?.left ?? 0, pad?.right ?? 0),
        ]}>
        <CalculatorPanel mode="docked" onModeChange={onModeChange} onClose={onClose} />
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <CalculatorPanel mode="floating" onModeChange={onModeChange} onClose={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', backgroundColor: nbColors.surface },
});
