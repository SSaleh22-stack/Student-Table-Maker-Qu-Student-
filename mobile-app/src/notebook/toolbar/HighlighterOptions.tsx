/**
 * Highlighter options popover (P13, NB-41): the 4 highlighter colors, the saved custom colors and '+'
 * (ColorPicker), 5 widths, and 'خط مستقيم عند التوقف' ('أبقِ القلم ثابتاً في نهاية الخط ليصبح
 * مستقيماً'). That switch turns on hold-to-straighten (P22: holding still at the end of a stroke makes
 * it straight); it never makes every stroke straight. Placed away from the writing hand.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { tr } from '@/lib/i18n';
import { HL_WIDTHS, type Hex } from '@/notebook/core/model';
import { HL_PALETTE } from '@/notebook/core/toolbar/colors';
import type { ToolbarPos } from '@/notebook/core/toolbar/dock';
import type { Hand } from '@/notebook/core/toolbar/hand';
import { useNotebookSettings } from '@/notebook/store/hooks';
import type { AnchorRect } from '@/notebook/ui';

import { ColorPickerSheet } from './ColorPicker';
import { CUSTOM_SHOWN, Divider, FieldLabel, OptionSwitch, PanelHeader, SwatchRow, WidthRow } from './PenOptions';
import { panelTitle } from './toolMeta';
import { useToolState } from './toolState';
import { OptionsPopover } from './ToolButton';

export interface HighlighterOptionsProps {
  visible: boolean;
  anchor: AnchorRect | null;
  barPos: ToolbarPos;
  hand: Hand;
  onClose: () => void;
}

export function HighlighterOptions({ visible, anchor, barPos, hand, onClose }: HighlighterOptionsProps) {
  return (
    <OptionsPopover
      visible={visible}
      anchor={anchor}
      barPos={barPos}
      hand={hand}
      onClose={onClose}
      accessibilityLabel={tr('خيارات التظليل', 'Highlighter options')}>
      {visible ? <HighlighterBody /> : null}
    </OptionsPopover>
  );
}

function HighlighterBody() {
  const { state, actions } = useToolState();
  const [settings] = useNotebookSettings();
  const [picking, setPicking] = useState(false);
  const shown: Hex[] = [...HL_PALETTE, ...settings.customColors.slice(0, CUSTOM_SHOWN)];

  return (
    <View style={styles.body}>
      <PanelHeader title={panelTitle.highlighter()} />
      <View style={styles.block}>
        <FieldLabel>{tr('اللون', 'Color')}</FieldLabel>
        <SwatchRow
          shown={shown}
          selected={state.highlighter.color}
          onPick={(c) => actions.setHighlighter({ color: c })}
          onAdd={() => setPicking(true)}
        />
      </View>
      <View style={styles.block}>
        <FieldLabel>{tr('السُمك', 'Width')}</FieldLabel>
        <WidthRow
          widths={HL_WIDTHS}
          selected={state.highlighter.width}
          onPick={(w) => actions.setHighlighter({ width: w })}
          color={state.highlighter.color}
          opacity={0.6}
          barFor={(w) => Math.round(Math.min(26, w * 0.8))}
        />
      </View>
      <Divider />
      <OptionSwitch
        title={tr('خط مستقيم عند التوقف', 'Straight line when you hold')}
        subtitle={tr('أبقِ القلم ثابتاً في نهاية الخط ليصبح مستقيماً', 'Hold the pen still at the end of the line to straighten it')}
        value={state.highlighter.straight}
        onChange={(v) => actions.setHighlighter({ straight: v })}
      />
      <ColorPickerSheet
        visible={picking}
        initial={state.highlighter.color}
        onClose={() => setPicking(false)}
        onSave={(hex) => actions.setHighlighter({ color: hex })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 16 },
  block: { gap: 8 },
});
