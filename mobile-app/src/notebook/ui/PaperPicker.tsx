/**
 * Paper picker (Figma 04 'نوع الورق' / 'لون الورق' / 'حجم الصفحة', Figma 30 small tiles; NB-20,
 * NB-21, NB-22): paper-style tiles drawn from core/paper/pattern.ts patternFor (the same geometry as
 * the pages, the thumbnails and the PDF export), paper-color swatches and page-size chips.
 *
 * The tiles draw the pattern of a virtual page 3x the tile size (4x on compact), so the rules and
 * dots keep the spacing of the Figma tiles instead of turning into a grey blur. They show the chosen
 * paper color. `fields` limits the picker to some of the three parts (Figma 30 shows style only).
 */
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import {
  PAGE_SIZE_KEYS,
  PAPER_COLORS,
  PAPER_FILL,
  patternFor,
  type PageSizeKey,
  type PaperColor,
  type PaperSpec,
  type PaperStyle,
} from '@/notebook/core/model';

import { useWidthClass } from './layout';
import { ChipGroup, NbChip } from './LocationChips';

export type PaperField = 'style' | 'color' | 'size';

/** Figma order: lined first (at the reading start), then blank, grid, dotted. */
export const PAPER_STYLE_ORDER: readonly PaperStyle[] = ['lined', 'blank', 'grid', 'dotted'];

export function paperStyleLabel(s: PaperStyle): string {
  switch (s) {
    case 'lined':
      return tr('مسطر', 'Lined');
    case 'blank':
      return tr('فارغ', 'Blank');
    case 'grid':
      return tr('مربعات', 'Grid');
    case 'dotted':
      return tr('نقاط', 'Dotted');
  }
}

export function paperColorLabel(c: PaperColor): string {
  switch (c) {
    case 'white':
      return tr('أبيض', 'White');
    case 'cream':
      return tr('كريمي', 'Cream');
    case 'dark':
      return tr('داكن', 'Dark');
  }
}

export function pageSizeLabel(s: PageSizeKey): string {
  switch (s) {
    case 'a4':
      return tr('A4 عمودي', 'A4 portrait');
    case 'a4-landscape':
      return tr('A4 أفقي', 'A4 landscape');
    case 'letter':
      return 'Letter';
    case 'wide':
      return tr('عريض 16:9', 'Wide 16:9');
  }
}

/** A small drawing of the paper (exported for other pickers, e.g. per-page paper). */
export function PaperTileArt({
  style,
  color,
  width,
  height,
  zoom,
  selected,
}: {
  style: PaperStyle;
  color: PaperColor;
  width: number;
  height: number;
  /** Virtual page = tile size x zoom. */
  zoom: number;
  selected?: boolean;
}) {
  const p = patternFor({ style, color, size: 'a4' }, { w: width * zoom, h: height * zoom });
  const k = 1 / zoom;
  const r = Math.round(width / 12);
  return (
    <View
      style={{
        width,
        height,
        borderRadius: r,
        overflow: 'hidden',
        borderWidth: selected ? 2.5 : 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: p.fill,
      }}>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill={p.fill} />
        {p.lines.map((l, i) => (
          <Line key={`l${i}`} x1={l.x1 * k} y1={l.y1 * k} x2={l.x2 * k} y2={l.y2 * k} stroke={p.lineColor} strokeWidth={1} />
        ))}
        {p.dots.map((d, i) => (
          <Circle key={`d${i}`} cx={d.x * k} cy={d.y * k} r={1.1} fill={p.lineColor} />
        ))}
        {p.margin ? <Line x1={p.margin.x * k} y1={0} x2={p.margin.x * k} y2={height} stroke={p.margin.color} strokeWidth={1} /> : null}
      </Svg>
    </View>
  );
}

function FieldLabel({ text }: { text: string }) {
  return (
    <AppText size={14} weight="semibold" color={colors.muted}>
      {text}
    </AppText>
  );
}

export interface PaperPickerProps {
  value: PaperSpec;
  onChange: (p: PaperSpec) => void;
  /** Which parts to show (default all three). */
  fields?: readonly PaperField[];
  /** Force the small tiles (Figma 30) even on regular windows. */
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function PaperPicker({ value, onChange, fields = ['style', 'color', 'size'], small, style }: PaperPickerProps) {
  const compact = useWidthClass() === 'compact';
  const smallTiles = small || compact;
  const tileW = smallTiles ? 64 : 96;
  const tileH = smallTiles ? 82 : 124;
  const zoom = smallTiles ? 4 : 3;
  const show = (f: PaperField) => fields.includes(f);
  const set = (patch: Partial<PaperSpec>) => onChange({ ...value, ...patch });

  const styleSection = show('style') ? (
    <View style={styles.section}>
      <FieldLabel text={tr('نوع الورق', 'Paper type')} />
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={tr('نوع الورق', 'Paper type')}
        style={[styles.wrapRow, { flexDirection: row, gap: smallTiles ? 14 : 18 }]}>
        {PAPER_STYLE_ORDER.map((s) => {
          const on = value.style === s;
          return (
            <Pressable
              key={s}
              onPress={() => set({ style: s })}
              accessibilityRole="radio"
              accessibilityLabel={paperStyleLabel(s)}
              accessibilityState={{ checked: on }}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
              <PaperTileArt style={s} color={value.color} width={tileW} height={tileH} zoom={zoom} selected={on} />
              <AppText size={smallTiles ? 13 : 14} weight={on ? 'bold' : 'medium'} color={on ? colors.accent : colors.muted} align="center">
                {paperStyleLabel(s)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  ) : null;

  const colorSection = show('color') ? (
    <View style={styles.section}>
      <FieldLabel text={tr('لون الورق', 'Paper color')} />
      <View accessibilityRole="radiogroup" accessibilityLabel={tr('لون الورق', 'Paper color')} style={[styles.wrapRow, { flexDirection: row, gap: 14 }]}>
        {PAPER_COLORS.map((c) => {
          const on = value.color === c;
          return (
            <Pressable
              key={c}
              onPress={() => set({ color: c })}
              accessibilityRole="radio"
              accessibilityLabel={paperColorLabel(c)}
              accessibilityState={{ checked: on }}
              hitSlop={4}
              style={({ pressed }) => [styles.swatch, pressed && styles.pressed]}>
              <View
                style={[
                  styles.swatchDot,
                  { backgroundColor: PAPER_FILL[c], borderWidth: on ? 3 : 1, borderColor: on ? colors.accent : colors.borderStrong },
                ]}
              />
              <AppText size={13} weight={on ? 'bold' : 'medium'} color={on ? colors.accent : colors.muted} align="center">
                {paperColorLabel(c)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  ) : null;

  const sizeSection = show('size') ? (
    <View style={[styles.section, !compact && show('color') ? styles.sizeBeside : null]}>
      <FieldLabel text={tr('حجم الصفحة', 'Page size')} />
      {compact ? (
        <ChipGroup
          options={PAGE_SIZE_KEYS.map((k) => ({ value: k, label: pageSizeLabel(k) }))}
          value={value.size}
          onChange={(k) => set({ size: k })}
          label={tr('حجم الصفحة', 'Page size')}
          size={13}
          gap={6}
        />
      ) : (
        // Figma 04: two rows of two chips beside the color swatches.
        <View accessibilityRole="radiogroup" accessibilityLabel={tr('حجم الصفحة', 'Page size')} style={styles.sizeRows}>
          {[PAGE_SIZE_KEYS.slice(0, 2), PAGE_SIZE_KEYS.slice(2)].map((keys, i) => (
            <View key={i} style={[styles.sizeRow, { flexDirection: row }]}>
              {keys.map((k) => (
                <NbChip key={k} label={pageSizeLabel(k)} size={13} selected={value.size === k} onPress={() => set({ size: k })} />
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  ) : null;

  return (
    <View style={[styles.root, style]}>
      {styleSection}
      {compact ? (
        <>
          {colorSection}
          {sizeSection}
        </>
      ) : colorSection || sizeSection ? (
        <View style={[styles.split, { flexDirection: row }]}>
          {colorSection}
          {sizeSection}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 20 },
  section: { gap: 10 },
  wrapRow: { flexWrap: 'wrap' },
  tile: { alignItems: 'center', gap: 8 },
  swatch: { alignItems: 'center', gap: 6 },
  swatchDot: { width: 40, height: 40, borderRadius: 20 },
  split: { justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 },
  sizeBeside: { flexShrink: 1 },
  sizeRows: { gap: 6 },
  sizeRow: { gap: 6, flexWrap: 'wrap' },
  pressed: { opacity: 0.8 },
});
