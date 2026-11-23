/**
 * The notebook storage bar and its legend (Figma 15 'storage-bar'; NB-87).
 *
 * storageSegments(usage) splits the notebooks' total into PDFs ('ملفات PDF', accent), recordings
 * ('التسجيلات', amber), writing and images ('الكتابة والصور', violet) and the rest ('أخرى', grey:
 * notebook files, covers, staging). The four parts always add up to the total shown above the bar
 * (core computeUsage keeps total = pdf + audio + inkAndImages + other), so the bar is full whenever
 * notebooks use any space, and empty (just the track) when they use none.
 *
 * The bar fills from the reading side: PDFs first at the right in Arabic, at the left in English
 * (a `row` from src/lib/rtl.ts). Empty parts get no segment and no legend entry ('أخرى' only shows
 * when it is not zero; the three Figma parts always show, so '0 B' tells the student there is none).
 */
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { tr, useLang } from '@/lib/i18n';
import { ltr, row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { bytesLabel } from '@/notebook/core/text/labels';
import type { StorageUsage } from '@/notebook/store/hooks';
import { nbColors } from '@/notebook/theme';

export type StoragePart = 'pdf' | 'audio' | 'inkAndImages' | 'other';

export interface StorageSegment {
  key: StoragePart;
  bytes: number;
  /** Share of the total, 0..1. The fractions of all segments add up to 1 (or all are 0). */
  fraction: number;
  color: string;
  label: string;
}

/** Figma 15 colors: accent, warningBar and violet; grey for the rest. */
export const STORAGE_COLORS: Record<StoragePart, string> = {
  pdf: nbColors.accent,
  audio: nbColors.warningBar,
  inkAndImages: '#8B5CF6',
  other: '#CBD5E1',
};

function partLabel(k: StoragePart): string {
  switch (k) {
    case 'pdf':
      return tr('ملفات PDF', 'PDF files');
    case 'audio':
      return tr('التسجيلات', 'Recordings');
    case 'inkAndImages':
      return tr('الكتابة والصور', 'Writing and images');
    case 'other':
      return tr('أخرى', 'Other');
  }
}

const clean = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** The total the bar is drawn against: the reported total, never less than the sum of the parts. */
export function storageTotal(u: Pick<StorageUsage, 'total' | 'pdf' | 'audio' | 'inkAndImages' | 'other'>): number {
  const parts = clean(u.pdf) + clean(u.audio) + clean(u.inkAndImages) + clean(u.other);
  return Math.max(clean(u.total), parts);
}

/**
 * The four parts in reading order, with fractions of storageTotal(u). Any gap between the reported
 * total and the parts (there is none from computeUsage) is counted as 'other', so the parts always
 * add up to the total.
 */
export function storageSegments(u: Pick<StorageUsage, 'total' | 'pdf' | 'audio' | 'inkAndImages' | 'other'>): StorageSegment[] {
  const total = storageTotal(u);
  const pdf = clean(u.pdf);
  const audio = clean(u.audio);
  const ink = clean(u.inkAndImages);
  const other = total - pdf - audio - ink;
  const bytes: Record<StoragePart, number> = { pdf, audio, inkAndImages: ink, other: Math.max(0, other) };
  const order: StoragePart[] = ['pdf', 'audio', 'inkAndImages', 'other'];
  return order.map((key) => ({
    key,
    bytes: bytes[key],
    fraction: total > 0 ? bytes[key] / total : 0,
    color: STORAGE_COLORS[key],
    label: partLabel(key),
  }));
}

export interface StorageBarProps {
  segments: readonly StorageSegment[];
  height?: number;
}

/** The bar alone (a 14 pt rounded track). Hidden from screen readers: the legend says the same. */
export function StorageBar({ segments, height = 14 }: StorageBarProps) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.track, { height, borderRadius: height / 2, flexDirection: row }]}>
      {segments
        .filter((s) => s.fraction > 0)
        .map((s) => (
          <View key={s.key} style={{ width: `${Math.min(100, s.fraction * 100)}%`, backgroundColor: s.color }} />
        ))}
    </View>
  );
}

/** The legend under the bar: a dot, the part's name and its size ('ملفات PDF 590 MB'). */
export function StorageLegend({ segments, gap = 22 }: { segments: readonly StorageSegment[]; gap?: number }) {
  const lang = useLang();
  const shown = segments.filter((s) => s.key !== 'other' || s.bytes > 0);
  return (
    <View style={[styles.legend, { flexDirection: row, columnGap: gap }]}>
      {shown.map((s) => {
        // Figma 15 shows the sizes in Latin units ('590 MB') in both languages.
        const size = bytesLabel(s.bytes, 'en');
        return (
          <View
            key={s.key}
            accessible
            accessibilityLabel={`${s.label}${tr('، ', ', ')}${bytesLabel(s.bytes, lang)}`}
            style={[styles.legendItem, { flexDirection: row }]}>
            <View style={[styles.dot, { backgroundColor: s.color }]} />
            <AppText size={14} weight="medium">
              {s.label}
            </AppText>
            <AppText size={14} color={colors.faint}>
              {ltr(size)}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  legend: { flexWrap: 'wrap', rowGap: 8 },
  legendItem: { alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
