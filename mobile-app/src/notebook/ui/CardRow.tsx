/**
 * The library's card rows (NB-10a): at most 4 cards, the first at the reading-start edge.
 * - regular windows: one row of 4 equal columns (Figma 02)
 * - compact windows (< 600 pt): 2 per row, at most 2 rows (still at most 4 cards)
 * A short last row keeps the column width (empty cells fill the end), so cards line up across
 * sections. Extra children past `max` are dropped; the section title's 'عرض الكل (n)' shows the rest.
 */
import { Children, isValidElement, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { row } from '@/lib/rtl';

import { useWidthClass, type WidthClass } from './layout';

export const CARD_ROW_MAX = 4;

/** Cards per row for a width class: 4 on regular, 2 on compact. */
export function cardsPerRow(c: WidthClass): number {
  return c === 'compact' ? 2 : 4;
}

/** Splits items into rows of `perRow`, keeping at most `max` items. */
export function chunkCards<T>(items: readonly T[], perRow: number, max: number = CARD_ROW_MAX): T[][] {
  const kept = items.slice(0, Math.max(0, max));
  const rows: T[][] = [];
  for (let i = 0; i < kept.length; i += perRow) rows.push(kept.slice(i, i + perRow));
  return rows;
}

export interface CardRowProps {
  children: ReactNode;
  /** Default 4 (NB-10a). */
  max?: number;
  /** Gap between cards (default 15 regular, 12 compact). */
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

export function CardRow({ children, max = CARD_ROW_MAX, gap, style }: CardRowProps) {
  const cls = useWidthClass();
  const perRow = cardsPerRow(cls);
  const g = gap ?? (cls === 'compact' ? 12 : 15);
  const items = Children.toArray(children).filter(isValidElement);
  const rows = chunkCards(items, perRow, max);
  return (
    <View style={[{ gap: g }, style]}>
      {rows.map((cells, r) => (
        <View key={r} style={[styles.row, { flexDirection: row, gap: g }]}>
          {cells.map((c, i) => (
            <View key={c.key ?? i} style={styles.cell}>
              {c}
            </View>
          ))}
          {Array.from({ length: perRow - cells.length }, (_, i) => (
            <View key={`pad-${i}`} style={styles.cell} importantForAccessibility="no" accessibilityElementsHidden />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'stretch' },
  cell: { flex: 1, minWidth: 0 },
});
