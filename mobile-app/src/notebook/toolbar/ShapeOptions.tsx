/**
 * Shape tool options popover (P13, NB-44 "a shape tool for drawing shapes directly"): line, arrow,
 * rectangle, ellipse and triangle. Picking one selects the shape tool with that shape and closes the
 * card. Shapes use the pen's color and width. Placed away from the writing hand.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import type { ToolbarPos } from '@/notebook/core/toolbar/dock';
import type { Hand } from '@/notebook/core/toolbar/hand';
import { nbRadius } from '@/notebook/theme';
import type { AnchorRect } from '@/notebook/ui';

import { PanelHeader } from './PenOptions';
import { SHAPE_KINDS, panelTitle, shapeKindMeta } from './toolMeta';
import { useToolState } from './toolState';
import { OptionsPopover } from './ToolButton';

export interface ShapeOptionsProps {
  visible: boolean;
  anchor: AnchorRect | null;
  barPos: ToolbarPos;
  hand: Hand;
  onClose: () => void;
}

export function ShapeOptions({ visible, anchor, barPos, hand, onClose }: ShapeOptionsProps) {
  return (
    <OptionsPopover
      visible={visible}
      anchor={anchor}
      barPos={barPos}
      hand={hand}
      onClose={onClose}
      width={340}
      accessibilityLabel={tr('خيارات الأشكال', 'Shape options')}>
      {visible ? <ShapeBody onClose={onClose} /> : null}
    </OptionsPopover>
  );
}

function ShapeBody({ onClose }: { onClose: () => void }) {
  const { state, actions } = useToolState();
  return (
    <View style={styles.body}>
      <PanelHeader title={panelTitle.shapes()} />
      <View style={[styles.grid, { flexDirection: row }]} accessibilityRole="radiogroup" accessibilityLabel={panelTitle.shapes()}>
        {SHAPE_KINDS.map((k) => {
          const m = shapeKindMeta(k);
          const on = state.shapeKind === k;
          return (
            <Pressable
              key={k}
              onPress={() => {
                actions.setShapeKind(k);
                actions.setTool('shapes');
                onClose();
              }}
              accessibilityRole="radio"
              accessibilityLabel={m.label}
              accessibilityState={{ selected: on, checked: on }}
              style={({ pressed }) => [styles.tile, on ? styles.tileOn : styles.tileOff, pressed && !on && { opacity: 0.75 }]}>
              <Icon name={m.icon} size={24} color={on ? colors.accent : colors.text} />
              <AppText size={12} weight="medium" color={on ? colors.accentDark : colors.muted} align="center" numberOfLines={1}>
                {m.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <AppText size={13} color={colors.faint}>
        {tr('يُرسم الشكل بلون القلم وسُمكه', 'Shapes use the pen color and width')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14 },
  grid: { flexWrap: 'wrap', gap: 8 },
  tile: {
    width: 92,
    paddingVertical: 10,
    gap: 6,
    borderRadius: nbRadius.tile,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  tileOn: { backgroundColor: colors.accentTint, borderColor: colors.accent },
  tileOff: { backgroundColor: colors.surfaceMuted, borderColor: 'transparent' },
});
