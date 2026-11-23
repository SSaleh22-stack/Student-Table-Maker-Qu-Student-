/**
 * Eraser options popover (P13, NB-42): whole-stroke eraser (default) or pixel eraser, the pixel
 * eraser's size, and 'مسح التظليل فقط' (erase highlighter strokes only). Placed away from the hand.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { ERASER_SIZE_MAX, ERASER_SIZE_MIN } from '@/notebook/core/model';
import type { ToolbarPos } from '@/notebook/core/toolbar/dock';
import type { Hand } from '@/notebook/core/toolbar/hand';
import { nbRadius } from '@/notebook/theme';
import { ChipGroup, type AnchorRect } from '@/notebook/ui';

import { Divider, FieldLabel, OptionSwitch, PanelHeader } from './PenOptions';
import { panelTitle } from './toolMeta';
import { useToolState } from './toolState';
import { OptionsPopover } from './ToolButton';

/** Pixel-eraser sizes offered (page points), inside ERASER_SIZE_MIN … ERASER_SIZE_MAX. */
export const ERASER_SIZES = [8, 16, 28, 44].map((s) => Math.min(ERASER_SIZE_MAX, Math.max(ERASER_SIZE_MIN, s)));

export interface EraserOptionsProps {
  visible: boolean;
  anchor: AnchorRect | null;
  barPos: ToolbarPos;
  hand: Hand;
  onClose: () => void;
}

export function EraserOptions({ visible, anchor, barPos, hand, onClose }: EraserOptionsProps) {
  return (
    <OptionsPopover
      visible={visible}
      anchor={anchor}
      barPos={barPos}
      hand={hand}
      onClose={onClose}
      width={340}
      accessibilityLabel={tr('خيارات الممحاة', 'Eraser options')}>
      {visible ? <EraserBody /> : null}
    </OptionsPopover>
  );
}

function nearest(list: readonly number[], v: number): number {
  return list.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), list[0]);
}

function EraserBody() {
  const { state, actions } = useToolState();
  const e = state.eraser;
  const selectedSize = nearest(ERASER_SIZES, e.size);

  return (
    <View style={styles.body}>
      <PanelHeader title={panelTitle.eraser()} />
      <View style={styles.block}>
        <FieldLabel>{tr('طريقة المسح', 'Erase')}</FieldLabel>
        <ChipGroup
          label={tr('طريقة المسح', 'Erase')}
          value={e.mode}
          onChange={(mode) => actions.setEraser({ mode })}
          options={[
            { value: 'stroke', label: tr('الخط كاملاً', 'Whole stroke') },
            { value: 'pixel', label: tr('جزء من الخط', 'Part of a stroke') },
          ]}
        />
      </View>
      {e.mode === 'pixel' ? (
        <View style={styles.block}>
          <FieldLabel>{tr('حجم الممحاة', 'Eraser size')}</FieldLabel>
          <View
            style={[styles.sizes, { flexDirection: row }]}
            accessibilityRole="radiogroup"
            accessibilityLabel={tr('حجم الممحاة', 'Eraser size')}>
            {ERASER_SIZES.map((s, i) => {
              const on = s === selectedSize;
              const d = 8 + i * 6;
              return (
                <Pressable
                  key={s}
                  onPress={() => actions.setEraser({ size: s })}
                  accessibilityRole="radio"
                  accessibilityLabel={tr(`الحجم ${i + 1} من ${ERASER_SIZES.length}`, `Size ${i + 1} of ${ERASER_SIZES.length}`)}
                  accessibilityState={{ selected: on, checked: on }}
                  style={({ pressed }) => [styles.sizeTile, on ? styles.sizeOn : styles.sizeOff, pressed && !on && { opacity: 0.75 }]}>
                  <View style={{ width: d, height: d, borderRadius: d / 2, borderWidth: 1.5, borderColor: colors.text }} />
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      <Divider />
      <OptionSwitch
        title={tr('مسح التظليل فقط', 'Erase highlighter only')}
        subtitle={tr('تبقى الكتابة كما هي', 'Your writing stays as it is')}
        value={e.highlighterOnly}
        onChange={(v) => actions.setEraser({ highlighterOnly: v })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 16 },
  block: { gap: 8 },
  sizes: { gap: 8 },
  sizeTile: { width: 52, height: 44, borderRadius: nbRadius.tool, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  sizeOn: { backgroundColor: colors.accentTint, borderColor: colors.accent },
  sizeOff: { backgroundColor: colors.surfaceMuted, borderColor: 'transparent' },
});
