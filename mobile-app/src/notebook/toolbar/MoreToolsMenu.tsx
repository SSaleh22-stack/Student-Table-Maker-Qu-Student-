/**
 * The 'أدوات أخرى' menu of the compact (phone) bar (P13, NB-51: phones get the full toolbar, the
 * less-used tools go into a "more" menu): shapes (with the 5 shape kinds inline), ruler, text, image
 * and calculator. Every tool of the tablet bar stays reachable. Placed away from the writing hand.
 *
 * Picking the image action closes the menu first and calls onImage only after the menu is gone
 * (OptionsPopover.onDismiss), so the image source sheet can open on iOS.
 */
import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import type { ToolbarPos } from '@/notebook/core/toolbar/dock';
import type { Hand } from '@/notebook/core/toolbar/hand';
import { nbRadius } from '@/notebook/theme';
import { Toggle, type AnchorRect } from '@/notebook/ui';

import { SHAPE_KINDS, panelTitle, shapeKindMeta, toolMeta, type ToolbarItemId } from './toolMeta';
import { useToolState } from './toolState';
import { OptionsPopover } from './ToolButton';

export interface MoreToolsMenuProps {
  visible: boolean;
  anchor: AnchorRect | null;
  barPos: ToolbarPos;
  hand: Hand;
  onClose: () => void;
  calcOpen: boolean;
  onToggleCalc: () => void;
  onImage: () => void;
}

export function MoreToolsMenu({ visible, anchor, barPos, hand, onClose, calcOpen, onToggleCalc, onImage }: MoreToolsMenuProps) {
  const after = useRef<(() => void) | null>(null);
  return (
    <OptionsPopover
      visible={visible}
      anchor={anchor}
      barPos={barPos}
      hand={hand}
      onClose={onClose}
      width={320}
      padding={14}
      accessibilityLabel={panelTitle.more()}
      onDismiss={() => {
        const fn = after.current;
        after.current = null;
        fn?.();
      }}>
      {visible ? (
        <MenuBody
          calcOpen={calcOpen}
          onToggleCalc={() => {
            onToggleCalc();
            onClose();
          }}
          onImage={() => {
            after.current = onImage;
            onClose();
          }}
          onClose={onClose}
        />
      ) : null}
    </OptionsPopover>
  );
}

function MenuRow({
  id,
  active,
  onPress,
  toggle,
}: {
  id: ToolbarItemId;
  active?: boolean;
  onPress: () => void;
  /** Shows a switch (ruler, calculator) with this value. */
  toggle?: boolean;
}) {
  const m = toolMeta(id);
  const isToggle = toggle !== undefined;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={isToggle ? 'switch' : 'button'}
      accessibilityLabel={m.label}
      accessibilityHint={m.hint}
      accessibilityState={isToggle ? { checked: toggle } : { selected: !!active }}
      style={({ pressed }) => [
        styles.row,
        { flexDirection: row },
        (pressed || active) && { backgroundColor: active ? colors.accentTint : colors.surfaceMuted },
      ]}>
      <View style={[styles.tile, active && { backgroundColor: colors.accent }]}>
        <Icon name={m.icon} size={20} color={active ? '#FFFFFF' : colors.text} />
      </View>
      <View style={styles.label}>
        <AppText size={16} weight="medium">
          {m.label}
        </AppText>
      </View>
      {isToggle ? <Toggle value={!!toggle} /> : null}
    </Pressable>
  );
}

function MenuBody({
  calcOpen,
  onToggleCalc,
  onImage,
  onClose,
}: {
  calcOpen: boolean;
  onToggleCalc: () => void;
  onImage: () => void;
  onClose: () => void;
}) {
  const { state, actions } = useToolState();
  const shapesOn = state.tool === 'shapes';
  return (
    <View style={styles.body}>
      <View style={[styles.shapes, shapesOn && styles.shapesOn]}>
        <View style={[styles.shapesHead, { flexDirection: row }]}>
          <Icon name="shapes" size={18} color={shapesOn ? colors.accent : colors.muted} />
          <AppText size={14} weight="semibold" color={shapesOn ? colors.accentDark : colors.muted}>
            {toolMeta('shapes').label}
          </AppText>
        </View>
        <View style={[styles.kinds, { flexDirection: row }]} accessibilityRole="radiogroup" accessibilityLabel={toolMeta('shapes').label}>
          {SHAPE_KINDS.map((k) => {
            const m = shapeKindMeta(k);
            const on = shapesOn && state.shapeKind === k;
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
                style={({ pressed }) => [styles.kind, on && styles.kindOn, pressed && !on && { opacity: 0.7 }]}>
                <Icon name={m.icon} size={20} color={on ? '#FFFFFF' : colors.text} />
              </Pressable>
            );
          })}
        </View>
      </View>
      <MenuRow
        id="ruler"
        toggle={state.rulerOn}
        onPress={() => {
          actions.toggleRuler();
          onClose();
        }}
      />
      <MenuRow
        id="text"
        active={state.tool === 'text'}
        onPress={() => {
          actions.setTool('text');
          onClose();
        }}
      />
      <MenuRow id="image" onPress={onImage} />
      <MenuRow id="calculator" toggle={calcOpen} onPress={onToggleCalc} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 4 },
  shapes: { borderRadius: nbRadius.tile, padding: 10, gap: 8, marginBottom: 4 },
  shapesOn: { backgroundColor: colors.accentTint },
  shapesHead: { alignItems: 'center', gap: 6 },
  kinds: { gap: 6, flexWrap: 'wrap' },
  kind: {
    width: 44,
    height: 44,
    borderRadius: nbRadius.tool,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  kindOn: { backgroundColor: colors.accent },
  row: { alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: nbRadius.tile, minHeight: 52 },
  tile: {
    width: 36,
    height: 36,
    borderRadius: nbRadius.tool,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  label: { flex: 1 },
});
