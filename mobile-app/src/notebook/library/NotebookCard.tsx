/**
 * A notebook card (Figma notebookCard, NB-14): the cover (Thumb), the title, and under it the last
 * edit and the page count ('اليوم 11:05 ص · 8 صفحات', Figma 03). A tap opens the notebook; the small
 * 'more' button opens the card actions (NotebookActionsSheet). A long press starts selecting several
 * notebooks (NotebookSelection.tsx) where the screen supports it, else it opens the actions too.
 * While selecting, a tap selects or unselects, the cover shows a round check, and 'more' is hidden.
 *
 * Also the grid the section screens and Recently deleted share (CardGrid: rows that start at the
 * reading side, so the first card sits at the right edge in Arabic, NB-10a), its column rule
 * (gridColumns: 2 on compact windows, 3 under 1000 pt, else 4) and useNow (a clock for the
 * relative times that ticks once a minute).
 */
import { Children, isValidElement, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr, type Lang } from '@/lib/i18n';
import { fromStart, row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import type { IndexEntry } from '@/notebook/core/model';
import { countLabel, relativeTime } from '@/notebook/core/text/labels';
import type { AnchorRect } from '@/notebook/ui/Popover';
import { widthClassOf } from '@/notebook/ui/layout';

import { Thumb } from './Thumb';

/** Columns of the section and Recently deleted grids. */
export function gridColumns(windowWidth: number): number {
  if (widthClassOf(windowWidth) === 'compact') return 2;
  return windowWidth < 1000 ? 3 : 4;
}

/** Date.now(), refreshed every minute (relative times such as 'اليوم 10:32 ص'). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export interface CardGridProps {
  children: ReactNode;
  columns: number;
  /** Gap between cards (default 16). */
  gap?: number;
  rowGap?: number;
  style?: StyleProp<ViewStyle>;
}

/** Equal columns, first card at the reading start; a short last row keeps the column width. */
export function CardGrid({ children, columns, gap = 16, rowGap = 24, style }: CardGridProps) {
  const items = Children.toArray(children).filter(isValidElement);
  const cols = Math.max(1, Math.floor(columns));
  const rows: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return (
    <View style={[{ gap: rowGap }, style]}>
      {rows.map((cells, r) => (
        <View key={r} style={[styles.gridRow, { flexDirection: row, gap }]}>
          {cells.map((c, i) => (
            <View key={c.key ?? i} style={styles.cell}>
              {c}
            </View>
          ))}
          {Array.from({ length: cols - cells.length }, (_, i) => (
            <View key={`pad-${i}`} style={styles.cell} importantForAccessibility="no" accessibilityElementsHidden />
          ))}
        </View>
      ))}
    </View>
  );
}

/** 'اليوم 11:05 ص · 8 صفحات'. */
export function cardSubtitle(e: IndexEntry, now: number, lang: Lang): string {
  return [relativeTime(e.updatedAt, now, lang), countLabel(e.pageCount, 'page', lang)].filter(Boolean).join(' · ');
}

/** The title shown for a notebook (an empty title reads 'مذكرة بدون عنوان'). */
export function notebookTitle(e: Pick<IndexEntry, 'title'>): string {
  return e.title.trim() || tr('مذكرة بدون عنوان', 'Untitled notebook');
}

export interface NotebookCardProps {
  entry: IndexEntry;
  now: number;
  lang: Lang;
  onOpen: (e: IndexEntry) => void;
  /** Opens the card actions; anchor is the card in window coordinates (iPad share popover). */
  onActions?: (e: IndexEntry, anchor: AnchorRect | null) => void;
  /** Starts selecting with this notebook (long press). Without it a long press opens the actions. */
  onSelectStart?: (e: IndexEntry) => void;
  /** Selects or unselects it while selecting. */
  onSelect?: (e: IndexEntry) => void;
  selecting?: boolean;
  selected?: boolean;
}

/** The round check on a card's cover while selecting. */
function SelectMark({ selected }: { selected: boolean }) {
  return (
    <View style={[styles.mark, fromStart(8), selected ? styles.markOn : styles.markOff]} pointerEvents="none">
      {selected ? <Icon name="check" size={16} color="#FFFFFF" strokeWidth={3} /> : null}
    </View>
  );
}

export function NotebookCard({ entry, now, lang, onOpen, onActions, onSelectStart, onSelect, selecting, selected }: NotebookCardProps) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const title = notebookTitle(entry);
  const sub = cardSubtitle(entry, now, lang);
  const press = () => (selecting && onSelect ? onSelect(entry) : onOpen(entry));

  const actions = () => {
    if (!onActions) return;
    const node = ref.current;
    if (!node) {
      onActions(entry, null);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      onActions(entry, width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  };

  const spoken = [
    title,
    sub,
    entry.recordingCount > 0 ? tr('فيها تسجيلات', 'has recordings') : '',
    entry.hasPdf ? 'PDF' : '',
    entry.importing ? tr('جارٍ الاستيراد', 'importing') : '',
  ]
    .filter(Boolean)
    .join('، ');

  const longPress = selecting && onSelect ? () => onSelect(entry) : onSelectStart ? () => onSelectStart(entry) : onActions ? actions : undefined;
  const a11yActions = selecting
    ? undefined
    : [
        { name: 'activate' as const },
        ...(onSelectStart ? [{ name: 'select', label: tr('تحديد عدة مذكرات', 'Select several notebooks') }] : []),
        ...(onActions ? [{ name: 'longpress' as const, label: tr('خيارات المذكرة', 'Notebook options') }] : []),
      ];

  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <Pressable
        onPress={press}
        onLongPress={longPress}
        delayLongPress={400}
        accessibilityRole={selecting ? 'checkbox' : 'button'}
        accessibilityLabel={spoken}
        accessibilityHint={selecting ? tr('تحديد المذكرة', 'Selects the notebook') : tr('يفتح المذكرة', 'Opens the notebook')}
        accessibilityState={selecting ? { checked: !!selected } : undefined}
        accessibilityActions={a11yActions}
        onAccessibilityAction={(ev) => {
          const name = ev.nativeEvent.actionName;
          if (name === 'longpress') actions();
          else if (name === 'select') onSelectStart?.(entry);
          else press();
        }}
        style={({ pressed }) => [styles.press, pressed && styles.pressed]}>
        <Thumb entry={entry} />
        {selecting ? (
          <>
            {selected ? <View style={styles.selectedRing} pointerEvents="none" /> : null}
            <SelectMark selected={!!selected} />
          </>
        ) : null}
      </Pressable>
      <View style={[styles.meta, { flexDirection: row }]}>
        {/* The title opens the notebook too; screen readers use the cover button, which says it all. */}
        <Pressable
          onPress={press}
          onLongPress={longPress}
          delayLongPress={400}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={styles.texts}>
          <AppText size={15} weight="semibold" numberOfLines={2}>
            {title}
          </AppText>
          {sub ? (
            <AppText size={12} color={colors.faint} numberOfLines={1}>
              {sub}
            </AppText>
          ) : null}
        </Pressable>
        {onActions && !selecting ? (
          <Pressable
            onPress={actions}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={tr(`خيارات ${title}`, `Options for ${title}`)}
            style={({ pressed }) => [styles.more, pressed && styles.pressed]}>
            <Icon name="moreV" size={18} color={colors.faint} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gridRow: { alignItems: 'flex-start' },
  cell: { flex: 1, minWidth: 0 },
  card: { gap: 8 },
  press: { borderRadius: 10 },
  selectedRing: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    left: -3,
    right: -3,
    borderRadius: 13,
    borderWidth: 3,
    borderColor: colors.accent,
  },
  mark: {
    position: 'absolute',
    top: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  markOn: { backgroundColor: colors.accent, borderColor: '#FFFFFF' },
  markOff: { backgroundColor: 'rgba(255,255,255,0.92)', borderColor: colors.borderStrong },
  pressed: { opacity: 0.8 },
  meta: { alignItems: 'flex-start', gap: 4 },
  texts: { flex: 1, minWidth: 0 },
  more: { paddingTop: 2 },
});
