/**
 * Notebook settings (Figma 15; NB-4, NB-50, NB-52, NB-85, NB-86b, NB-87, NB-T1):
 *
 *   (back)  إعدادات المذكرات / تُحفظ على جهازك
 *   النسخ الاحتياطي        P20 BackupSection: the switch (its 'on' path runs useEnableBackupFlow,
 *                          which checks for an existing backup and offers 'استعادة الآن'; a 'restore'
 *                          answer opens the restore screen), last backup, Wi-Fi only, restore, …
 *   الكتابة                WritingSection (input, Apple Pencil double tap / squeeze, finger drawing, hand)
 *   الورق وشريط الأدوات    default paper and toolbar position
 *   التخزين                StorageSection (total, free space, bar and legend)
 *   (rows)                 المحذوفة مؤخراً (count) · إعادة عرض الجولة التعريفية · أرسل ملاحظاتك عن المذكرات
 *
 * 'إعادة عرض الجولة التعريفية' marks the library tour, the first-time setup and the notebook tour
 * unseen again (P15 resetTours) and says 'ستظهر الجولة في المرة القادمة'.
 *
 * This screen does NOT mount useBackupAutoRun: the automatic backup is started only by
 * NotebookServices (P30). It renders under NotebooksProvider (root layout).
 */
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { SafeAreaView } from '@/components/SafeAreaView';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { BackupSection } from '@/notebook/backup/BackupSection';
import { goBackOr, openDeleted, openLibrary, openNotebookFeedback, openRestore } from '@/notebook/nav';
import { useNotebooks } from '@/notebook/store/hooks';
import { resetTours } from '@/notebook/tours/tourState';
import { CircleButton } from '@/notebook/ui/CircleButton';
import { Group } from '@/notebook/ui/Group';
import { useWidthClass } from '@/notebook/ui/layout';
import { ListRow } from '@/notebook/ui/ListRow';
import { showToast } from '@/notebook/ui/toast';

import { StorageSection } from './StorageSection';
import { WritingSection } from './WritingSection';

const back = () => goBackOr(openLibrary);

/** Figma navBar: a 44 pt back button, then the title (28 bold) and its subtitle, at the reading start. */
function Header({ title, subtitle }: { title: string; subtitle: string }) {
  const compact = useWidthClass() === 'compact';
  return (
    <View style={[styles.header, { flexDirection: row }]}>
      <CircleButton icon="back" label={tr('رجوع', 'Back')} onPress={back} size={compact ? 40 : 44} />
      <View style={styles.headerTexts}>
        <AppText size={compact ? 24 : 28} weight="bold" numberOfLines={1} accessibilityRole="header">
          {title}
        </AppText>
        <AppText size={14} color={colors.faint} numberOfLines={1}>
          {subtitle}
        </AppText>
      </View>
    </View>
  );
}

function replayTours() {
  resetTours();
  showToast({ text: tr('ستظهر الجولة في المرة القادمة', 'The tour will show next time'), tone: 'ok', id: 'nb-replay-tours' });
}

export default function SettingsScreen() {
  const store = useNotebooks();
  const compact = useWidthClass() === 'compact';
  const insets = useSafeAreaInsets();
  const deleted = store.list('deleted', 'updated').length;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: compact ? 16 : 32, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          <Header title={tr('إعدادات المذكرات', 'Notebook settings')} subtitle={tr('تُحفظ على جهازك', 'Saved on your device')} />

          <BackupSection onOpenRestore={openRestore} />

          <WritingSection />

          <StorageSection />

          <Group>
            <ListRow
              key="deleted"
              icon="trash"
              title={tr('المحذوفة مؤخراً', 'Recently deleted')}
              value={deleted > 0 ? String(deleted) : undefined}
              chevron
              onPress={openDeleted}
            />
            <ListRow
              key="tour"
              icon="play"
              title={tr('إعادة عرض الجولة التعريفية', 'Show the tour again')}
              chevron
              onPress={replayTours}
              accessibilityHint={tr('تظهر الجولة في المرة القادمة التي تفتح فيها المذكرات', 'The tour shows the next time you open your notebooks')}
            />
            <ListRow
              key="feedback"
              icon="message"
              title={tr('أرسل ملاحظاتك عن المذكرات', 'Send feedback about notebooks')}
              subtitle={tr('ميزة تجريبية — رأيك يهمنا', 'Beta feature — your opinion matters')}
              chevron
              onPress={openNotebookFeedback}
            />
          </Group>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingTop: 12 },
  inner: { width: '100%', maxWidth: 820, alignSelf: 'center', gap: 22 },
  header: { alignItems: 'center', gap: 14, marginBottom: 2 },
  headerTexts: { flex: 1, gap: 2 },
});
