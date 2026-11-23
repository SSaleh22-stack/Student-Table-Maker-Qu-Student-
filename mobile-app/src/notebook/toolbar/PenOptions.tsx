/**
 * Pen options popover (P13, Figma 07, NB-40, NB-44):
 * - header 'القلم' with an 'تعديل' link ('تم' while editing)
 * - 'أقلامي المحفوظة': 3 named presets (default names 'أزرق ناعم', 'أسود', 'أحمر عريض'). A tap applies
 *   the preset. In edit mode a tap overwrites the preset with the current color and width, and the
 *   pencil on each preset renames it (TextPromptDialog).
 * - 'اللون': the 5 pen colors (on dark paper the black swatch shows the light ink it draws), the saved
 *   custom colors and '+' (ColorPicker)
 * - 'السُمك': 5 widths
 * - switches: 'حساسية الضغط', 'الرسم بالإصبع' and 'تحويل الأشكال عند التوقف' ('أبقِ القلم ثابتاً في
 *   نهاية الشكل')
 *
 * On the compact (phone) bar the colors are not on the bar, so the color row comes first
 * (colorsFirst). Placement goes through OptionsPopover (core/toolbar/hand.ts: away from the hand).
 *
 * Also exports the pieces HighlighterOptions and EraserOptions share: PanelHeader, FieldLabel,
 * SwatchRow, WidthRow and OptionSwitch.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { getLang, tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import {
  PEN_PRESET_DEFAULT_NAMES,
  PEN_PRESET_NAME_MAX,
  PEN_WIDTHS,
  type Hex,
  type PaperColor,
  type PenPreset,
} from '@/notebook/core/model';
import { PEN_PALETTE, colorName, effectivePenColor, penPalette, sameColor } from '@/notebook/core/toolbar/colors';
import type { ToolbarPos } from '@/notebook/core/toolbar/dock';
import type { Hand } from '@/notebook/core/toolbar/hand';
import { useNotebookSettings } from '@/notebook/store/hooks';
import { nbRadius } from '@/notebook/theme';
import { ColorDot, ToggleRow, physicalRight, type AnchorRect } from '@/notebook/ui';
import { TextPromptDialog } from '@/notebook/ui/TextPromptDialog';

import { ColorPickerSheet } from './ColorPicker';
import { panelTitle } from './toolMeta';
import { useToolState } from './toolState';
import { OptionsPopover } from './ToolButton';

/** Custom colors shown in an options row (the rest stay saved). */
export const CUSTOM_SHOWN = 6;

export function PanelHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void; hint?: string } }) {
  return (
    <View style={[styles.header, { flexDirection: row }]}>
      <AppText size={18} weight="bold" accessibilityRole="header">
        {title}
      </AppText>
      {action ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityHint={action.hint}>
          <AppText size={14} weight="semibold" color={colors.accent}>
            {action.label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function FieldLabel({ children }: { children: string }) {
  return (
    <AppText size={14} weight="semibold" color={colors.muted}>
      {children}
    </AppText>
  );
}

export interface SwatchRowProps {
  /** Colors as shown. */
  shown: readonly Hex[];
  /** Colors stored when tapped (same length as shown; defaults to shown). */
  stored?: readonly Hex[];
  /** The tool's stored color. */
  selected: Hex;
  onPick: (hex: Hex) => void;
  onAdd: () => void;
}

/** Color swatches followed by the dashed '+' (Figma 07). Wraps when the custom colors do not fit. */
export function SwatchRow({ shown, stored, selected, onPick, onAdd }: SwatchRowProps) {
  const lang = getLang();
  const values = stored ?? shown;
  return (
    <View style={[styles.swatches, { flexDirection: row }]} accessibilityRole="radiogroup" accessibilityLabel={tr('اللون', 'Color')}>
      {shown.map((c, i) => (
        <ColorDot
          key={`${c}-${i}`}
          color={c}
          selected={sameColor(values[i], selected)}
          onPress={() => onPick(values[i])}
          label={colorName(c, lang)}
        />
      ))}
      <Pressable
        onPress={onAdd}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={tr('لون آخر', 'Another color')}
        accessibilityHint={tr('يفتح منتقي الألوان', 'Opens the color picker')}
        style={({ pressed }) => [styles.addOuter, pressed && { opacity: 0.7 }]}>
        <View style={styles.add}>
          <Icon name="plus" size={16} color={colors.muted} />
        </View>
      </Pressable>
    </View>
  );
}

export interface WidthRowProps {
  widths: readonly number[];
  selected: number;
  onPick: (w: number) => void;
  /** Color of the sample bars (default the text color). */
  color?: string;
  /** Opacity of the sample bars (the highlighter shows see-through bars). */
  opacity?: number;
  /** Drawn bar thickness for a width (default the width itself). */
  barFor?: (w: number) => number;
}

/** The 5 width tiles (Figma 07: 52 x 40, radius 12, the selected one tinted with an accent border). */
export function WidthRow({ widths, selected, onPick, color = colors.text, opacity = 1, barFor }: WidthRowProps) {
  return (
    <View style={[styles.widths, { flexDirection: row }]} accessibilityRole="radiogroup" accessibilityLabel={tr('السُمك', 'Width')}>
      {widths.map((w, i) => {
        const on = w === selected;
        const h = barFor ? barFor(w) : w;
        return (
          <Pressable
            key={w}
            onPress={() => onPick(w)}
            accessibilityRole="radio"
            accessibilityLabel={tr(`السُمك ${i + 1} من ${widths.length}`, `Width ${i + 1} of ${widths.length}`)}
            accessibilityState={{ selected: on, checked: on }}
            style={({ pressed }) => [styles.widthTile, on ? styles.widthOn : styles.widthOff, pressed && !on && { opacity: 0.75 }]}>
            <View style={{ width: 36, height: h, borderRadius: h / 2, backgroundColor: color, opacity }} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function OptionSwitch({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return <ToggleRow title={title} subtitle={subtitle} value={value} onChange={onChange} style={styles.switchRow} />;
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** Name shown for a preset: its own name or the localized default for its slot. */
export function presetName(p: PenPreset, i: number): string {
  if (p.name && p.name.trim()) return p.name;
  const d = PEN_PRESET_DEFAULT_NAMES[i] ?? PEN_PRESET_DEFAULT_NAMES[0];
  return tr(d.ar, d.en);
}

const presetDot = (w: number) => Math.round(Math.min(28, Math.max(10, 8 + w * 2.2)));

export interface PenOptionsProps {
  visible: boolean;
  anchor: AnchorRect | null;
  barPos: ToolbarPos;
  hand: Hand;
  paperColor: PaperColor;
  onClose: () => void;
  /** Compact bar: the color row comes first (the 5 colors are not on the bar). */
  colorsFirst?: boolean;
}

export function PenOptions({ visible, anchor, barPos, hand, paperColor, onClose, colorsFirst }: PenOptionsProps) {
  return (
    <OptionsPopover
      visible={visible}
      anchor={anchor}
      barPos={barPos}
      hand={hand}
      onClose={onClose}
      accessibilityLabel={tr('خيارات القلم', 'Pen options')}>
      {visible ? <PenOptionsBody paperColor={paperColor} colorsFirst={colorsFirst} /> : null}
    </OptionsPopover>
  );
}

function PenOptionsBody({ paperColor, colorsFirst }: { paperColor: PaperColor; colorsFirst?: boolean }) {
  const { state, actions } = useToolState();
  const [settings, setSettings] = useNotebookSettings();
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const presets = settings.pen.presets;

  const writePresets = (fn: (list: PenPreset[]) => PenPreset[]) => {
    setSettings((s) => {
      const next = fn(s.pen.presets.map((p) => ({ ...p })));
      return { pen: { presets: [next[0], next[1], next[2]] } };
    });
  };

  const onPreset = (i: number) => {
    const p = presets[i];
    if (editing) {
      writePresets((list) => {
        list[i] = { ...list[i], color: state.pen.color, width: state.pen.width };
        return list;
      });
      actions.setPen({ presetIndex: i });
      return;
    }
    actions.setPen({ color: p.color, width: p.width, presetIndex: i });
  };

  const custom = settings.customColors.slice(0, CUSTOM_SHOWN);
  const shown = [...penPalette(paperColor), ...custom.map((c) => effectivePenColor(c, paperColor))];
  const stored = [...PEN_PALETTE, ...custom];

  const colorBlock = (
    <View style={styles.block}>
      <FieldLabel>{tr('اللون', 'Color')}</FieldLabel>
      <SwatchRow
        shown={shown}
        stored={stored}
        selected={state.pen.color}
        onPick={(c) => actions.setPen({ color: c })}
        onAdd={() => setPicking(true)}
      />
    </View>
  );

  return (
    <View style={styles.body}>
      <PanelHeader
        title={panelTitle.pen()}
        action={{
          label: editing ? tr('تم', 'Done') : tr('تعديل', 'Edit'),
          hint: editing
            ? undefined
            : tr('لحفظ القلم الحالي في أحد الأقلام أو إعادة تسميته', 'Save the current pen into a preset or rename it'),
          onPress: () => setEditing((e) => !e),
        }}
      />
      {colorsFirst ? colorBlock : null}
      <View style={styles.block}>
        <FieldLabel>{tr('أقلامي المحفوظة', 'My pens')}</FieldLabel>
        {editing ? (
          <AppText size={12} color={colors.faint}>
            {tr('اضغط على قلم لحفظ اللون والسُمك الحاليين فيه', 'Tap a pen to save the current color and width into it')}
          </AppText>
        ) : null}
        <View style={[styles.presets, { flexDirection: row }]}>
          {presets.map((p, i) => {
            const on = state.pen.presetIndex === i;
            const name = presetName(p, i);
            const d = presetDot(p.width);
            return (
              <View key={i} style={styles.presetWrap}>
                <Pressable
                  onPress={() => onPreset(i)}
                  accessibilityRole="button"
                  accessibilityLabel={name}
                  accessibilityHint={
                    editing
                      ? tr('يحفظ اللون والسُمك الحاليين في هذا القلم', 'Saves the current color and width into this pen')
                      : tr('يستخدم هذا القلم', 'Uses this pen')
                  }
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [
                    styles.preset,
                    on && styles.presetOn,
                    editing && !on && styles.presetEditing,
                    pressed && { opacity: 0.8 },
                  ]}>
                  <View style={[styles.presetDotBox]}>
                    <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: effectivePenColor(p.color, paperColor) }} />
                  </View>
                  <AppText size={12} color={colors.muted} align="center" numberOfLines={1}>
                    {name}
                  </AppText>
                </Pressable>
                {editing ? (
                  <Pressable
                    onPress={() => setRenaming(i)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={tr(`إعادة تسمية ${name}`, `Rename ${name}`)}
                    style={[styles.rename, physicalRight(-4)]}>
                    <Icon name="pencilTip" size={13} color={colors.accent} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
      {colorsFirst ? null : colorBlock}
      <View style={styles.block}>
        <FieldLabel>{tr('السُمك', 'Width')}</FieldLabel>
        <WidthRow widths={PEN_WIDTHS} selected={state.pen.width} onPick={(w) => actions.setPen({ width: w })} />
      </View>
      <Divider />
      <View>
        <OptionSwitch title={tr('حساسية الضغط', 'Pressure')} value={settings.pressure} onChange={(v) => setSettings({ pressure: v })} />
        <OptionSwitch
          title={tr('الرسم بالإصبع', 'Draw with finger')}
          value={settings.fingerDraws}
          onChange={(v) => setSettings({ fingerDraws: v })}
        />
        <OptionSwitch
          title={tr('تحويل الأشكال عند التوقف', 'Snap shapes when you hold')}
          subtitle={tr('أبقِ القلم ثابتاً في نهاية الشكل', 'Hold the pen still at the end of the shape')}
          value={state.shapeSnap}
          onChange={actions.setShapeSnap}
        />
      </View>

      <TextPromptDialog
        visible={renaming !== null}
        title={tr('اسم القلم', 'Pen name')}
        fieldLabel={tr('الاسم', 'Name')}
        initialValue={renaming !== null ? presetName(presets[renaming], renaming) : ''}
        maxLength={PEN_PRESET_NAME_MAX}
        onCancel={() => setRenaming(null)}
        onSubmit={(name) => {
          const i = renaming;
          setRenaming(null);
          if (i === null) return;
          writePresets((list) => {
            // Typing the slot's default name back keeps it unnamed, so it follows the language again.
            const d = PEN_PRESET_DEFAULT_NAMES[i];
            const isDefault = !!d && (name === d.ar || name === d.en);
            const { name: _old, ...rest } = list[i];
            void _old;
            list[i] = isDefault ? rest : { ...rest, name };
            return list;
          });
        }}
      />
      <ColorPickerSheet
        visible={picking}
        initial={state.pen.color}
        onClose={() => setPicking(false)}
        onSave={(hex) => actions.setPen({ color: hex })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 16 },
  header: { alignItems: 'center', justifyContent: 'space-between' },
  block: { gap: 8 },
  swatches: { flexWrap: 'wrap', alignItems: 'center', gap: 9 },
  addOuter: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  add: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  widths: { gap: 8, flexWrap: 'wrap' },
  widthTile: { width: 52, height: 40, borderRadius: nbRadius.tool, alignItems: 'center', justifyContent: 'center' },
  widthOn: { backgroundColor: colors.accentTint, borderWidth: 1.5, borderColor: colors.accent },
  widthOff: { backgroundColor: colors.surfaceMuted, borderWidth: 1.5, borderColor: 'transparent' },
  presets: { gap: 8 },
  presetWrap: { position: 'relative' },
  preset: {
    width: 86,
    paddingVertical: 10,
    paddingHorizontal: 6,
    gap: 6,
    borderRadius: nbRadius.tile,
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  presetOn: { backgroundColor: colors.accentTint, borderColor: colors.accentBorder },
  presetEditing: { borderColor: colors.borderStrong, borderStyle: 'dashed' },
  presetDotBox: { height: 28, alignItems: 'center', justifyContent: 'flex-end' },
  rename: {
    position: 'absolute',
    top: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { height: 1, backgroundColor: colors.divider },
  switchRow: { paddingHorizontal: 0, paddingVertical: 6, minHeight: 48 },
});
