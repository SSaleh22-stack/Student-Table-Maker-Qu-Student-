/**
 * 'إضافة إلى مذكرة موجودة' (NB-31): picks the notebook a received file is added to. Every notebook
 * that is not deleted (and not read-only), most recently edited first (store.list('all', 'updated')),
 * with the library search (titles and course names). The pages go at the end of the chosen notebook.
 */
import { useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr, useLang } from '@/lib/i18n';
import { inputDir, row } from '@/lib/rtl';
import { colors, fonts } from '@/lib/theme';
import type { Id, IndexEntry } from '@/notebook/core/model';
import { countLabel, relativeTime } from '@/notebook/core/text/labels';
import { useNotebooks } from '@/notebook/store/hooks';
import { ListRow } from '@/notebook/ui/ListRow';
import { NbSheet } from '@/notebook/ui/NbSheet';

export interface NotebookPickerSheetProps {
  visible: boolean;
  /** The notebook picked before (shown with a check). */
  selectedId?: Id | null;
  onPick: (entry: IndexEntry) => void;
  onClose: () => void;
}

/** The notebooks a file can be added to, for the query. */
export function pickableNotebooks(list: IndexEntry[]): IndexEntry[] {
  return list.filter((e) => !e.deletedAt && !e.readOnly);
}

function Body({ selectedId, onPick }: Pick<NotebookPickerSheetProps, 'selectedId' | 'onPick'>) {
  const store = useNotebooks();
  const lang = useLang();
  const [query, setQuery] = useState('');
  const items = pickableNotebooks(store.list('all', 'updated', query));
  const [now] = useState(() => Date.now());
  return (
    <View style={styles.body}>
      <View style={[styles.search, { flexDirection: row }]}>
        <Icon name="search" size={18} color={colors.placeholder} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={tr('ابحث في المذكرات', 'Search notebooks')}
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel={tr('ابحث في المذكرات', 'Search notebooks')}
          style={[styles.input, inputDir()]}
        />
      </View>
      <FlatList
        data={items}
        keyExtractor={(e) => e.id}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <AppText size={14} color={colors.faint} align="center" style={styles.empty}>
            {query.trim() ? tr('لا توجد نتائج', 'No results') : tr('لا توجد مذكرات بعد', 'No notebooks yet')}
          </AppText>
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.title}
            subtitle={`${countLabel(item.pageCount, 'page', lang)} · ${relativeTime(item.updatedAt, now, lang)}`}
            icon={item.hasPdf ? 'fileText' : 'notebookPen'}
            trailing={item.id === selectedId ? <Icon name="check" size={20} color={colors.accent} /> : undefined}
            chevron={false}
            onPress={() => onPick(item)}
          />
        )}
      />
    </View>
  );
}

export function NotebookPickerSheet({ visible, selectedId, onPick, onClose }: NotebookPickerSheetProps) {
  return (
    <NbSheet visible={visible} title={tr('اختر مذكرة', 'Choose a notebook')} subtitle={tr('تُضاف الصفحات في نهاية المذكرة', 'The pages are added at the end')} onClose={onClose} scroll={false} width={520}>
      <Body selectedId={selectedId} onPick={onPick} />
    </NbSheet>
  );
}

const styles = StyleSheet.create({
  body: { flexShrink: 1, gap: 12, paddingBottom: 8 },
  search: {
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.text, paddingVertical: 10 },
  list: { flexShrink: 1, minHeight: 120 },
  sep: { height: 1, backgroundColor: colors.divider },
  empty: { paddingVertical: 24 },
});
