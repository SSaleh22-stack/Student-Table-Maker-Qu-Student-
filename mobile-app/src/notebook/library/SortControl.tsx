/**
 * Sorting the library (NB-15): last edited, name, or date created. The choice is one setting
 * (settings.sort, written with setSettings({ sort })) shared by the library and every section.
 *
 * - SortChips: the Figma 03 chips ('آخر تعديل' first at the reading start, 'الاسم', 'تاريخ الإنشاء').
 * - SortSheet: the same choice as radio rows in a sheet, for the library header's sort button.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { tr } from '@/lib/i18n';
import type { SortKey } from '@/notebook/core/model';
import { ChipGroup } from '@/notebook/ui/LocationChips';
import { NbSheet } from '@/notebook/ui/NbSheet';
import { RadioGroup } from '@/notebook/ui/RadioRow';

export const SORT_KEYS: readonly SortKey[] = ['updated', 'name', 'created'];

export function sortLabel(k: SortKey): string {
  switch (k) {
    case 'updated':
      return tr('آخر تعديل', 'Last edited');
    case 'name':
      return tr('الاسم', 'Name');
    case 'created':
      return tr('تاريخ الإنشاء', 'Date created');
  }
}

/** 'ترتيب حسب'. */
export function sortTitle(): string {
  return tr('ترتيب حسب', 'Sort by');
}

export interface SortChipsProps {
  value: SortKey;
  onChange: (k: SortKey) => void;
  style?: StyleProp<ViewStyle>;
}

export function SortChips({ value, onChange, style }: SortChipsProps) {
  return (
    <ChipGroup
      options={SORT_KEYS.map((k) => ({ value: k, label: sortLabel(k) }))}
      value={value}
      onChange={onChange}
      label={sortTitle()}
      style={style}
    />
  );
}

export interface SortSheetProps {
  visible: boolean;
  value: SortKey;
  onChange: (k: SortKey) => void;
  onClose: () => void;
}

export function SortSheet({ visible, value, onChange, onClose }: SortSheetProps) {
  return (
    <NbSheet visible={visible} title={sortTitle()} onClose={onClose} cancelLabel={tr('إغلاق', 'Close')}>
      <View style={styles.body}>
        <RadioGroup
          options={SORT_KEYS.map((k) => ({ value: k, label: sortLabel(k) }))}
          value={value}
          label={sortTitle()}
          onChange={(k) => {
            onChange(k);
            onClose();
          }}
        />
      </View>
    </NbSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingVertical: 8 },
});
