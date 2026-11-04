import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { ReactNode } from 'react';
import { Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Button, ScreenHeader } from '@/components/ui';
import { isEnglish, tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { useAppData } from '@/store/AppData';

const SITE_URL = 'https://qustudent.net';
const PRIVACY_URL = `${SITE_URL}/privacy.html`;

const formatDate = (iso?: string) => {
  if (!iso) return tr('لم تستورد بعد', 'Not imported yet');
  try {
    const when = new Date(iso).toLocaleString(isEnglish() ? 'en-GB' : 'ar-SA', { dateStyle: 'medium', timeStyle: 'short' });
    return tr(`آخر استيراد: ${when}`, `Last import: ${when}`);
  } catch {
    return tr('آخر استيراد: —', 'Last import: —');
  }
};

export default function MoreScreen() {
  const { importedAt, clearAll, settings, setSettings } = useAppData();

  const confirmClear = () => {
    const run = () => clearAll();
    if (Platform.OS === 'web') {
      // Alert buttons aren't supported on web
      if (
        typeof window !== 'undefined' &&
        window.confirm(
          tr(
            'حذف كل البيانات؟ سيُحذف جدولك ودرجاتك وغيابك من هذا الجهاز.',
            'Delete all data? Your timetable, grades and absences will be removed from this device.',
          ),
        )
      )
        run();
      return;
    }
    Alert.alert(
      tr('حذف كل البيانات؟', 'Delete all data?'),
      tr('سيُحذف جدولك ودرجاتك وغيابك من هذا الجهاز.', 'Your timetable, grades and absences will be removed from this device.'),
      [
      { text: tr('إلغاء', 'Cancel'), style: 'cancel' },
      { text: tr('حذف', 'Delete'), style: 'destructive', onPress: run },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title={tr('المزيد', 'More')} />

        <View style={[styles.card, { flexDirection: row, alignItems: 'center', gap: 12, padding: 12 }]}>
          <Logo size={44} />
          <View style={{ flex: 1 }}>
            <AppText weight="bold" size={15}>
              {tr('بيانات البوابة', 'Portal data')}
            </AppText>
            <AppText size={12} color={colors.muted}>
              {formatDate(importedAt)}
            </AppText>
          </View>
          <Button label={tr('تحديث', 'Refresh')} icon="refresh" variant="soft" size="sm" onPress={() => router.push('/import')} />
        </View>

        <Group title={tr('أدوات', 'Tools')}>
          <Item
            icon="fileText"
            title={tr('ملخص الجدول', 'Timetable summary')}
            subtitle={tr('المقررات وفترات الاختبارات', 'Courses and exam periods')}
            onPress={() => router.push('/summary')}
          />
          <Item
            icon="calendarDays"
            title={tr('التقويم الأكاديمي', 'Academic calendar')}
            subtitle={tr('مواعيد الفصل والإجازات والاختبارات', 'Term dates, holidays and exams')}
            onPress={() => router.push('/calendar')}
          />
          <Item
            icon="share"
            title={tr('تصدير الجدول', 'Export timetable')}
            subtitle={tr('صورة، PDF، Excel، تقويم', 'Image, PDF, Excel, calendar')}
            onPress={() => router.push('/export')}
          />
          <Item
            icon="calculator"
            title={tr('حاسبة المعدل', 'GPA calculator')}
            subtitle={tr('معدلك الفصلي والتراكمي', 'Your term and cumulative GPA')}
            onPress={() => router.push('/gpa')}
          />
          <Item
            icon="userMinus"
            title={tr('حاسبة الغياب', 'Absence calculator')}
            subtitle={tr('نسبة غيابك قبل الحرمان', 'Your absence before the limit')}
            onPress={() => router.push('/absence')}
          />
          <Item
            icon="clipboardCheck"
            title={tr('تقييم المقررات', 'Course evaluations')}
            subtitle={tr('املأ استبيانات تقييم المقررات بضغطة', 'Fill in course evaluation surveys in one tap')}
            onPress={() => router.push('/reviews')}
          />
        </Group>

        <Group title={tr('الإعدادات', 'Settings')}>
          <ToggleItem
            icon="sun"
            title={tr('بطاقة المحاضرة القادمة', 'Next class card')}
            subtitle={tr('تظهر في أعلى الصفحة الرئيسية', 'Shows at the top of the home screen')}
            value={settings.showTodayCard}
            onChange={(on) => setSettings({ showTodayCard: on })}
          />
        </Group>

        <Group title={tr('المساعدة', 'Help')}>
          <Item
            icon="play"
            title={tr('مقاطع شرح الاستخدام', 'How-to videos')}
            subtitle={tr('شاهد طريقة الاستخدام', 'See how to use the app')}
            onPress={() => router.push('/tutorials')} />
          <Item
            icon="mail"
            title={tr('تواصل معنا', 'Contact us')}
            subtitle={tr('واتساب، تيليجرام، البريد الإلكتروني', 'WhatsApp, Telegram, email')}
            onPress={() => router.push('/contact')}
          />
          <Item
            icon="share"
            title={tr('شارك التطبيق مع زملائك', 'Share the app with classmates')}
            onPress={() =>
              Share.share({
                message: `Qu Student — ${tr('ابنِ جدولك الدراسي في دقائق', 'Build your class timetable in minutes')}\n${SITE_URL}`,
              }).catch(() => {})
            }
          />
          <Item
            icon="lock"
            title={tr('سياسة الخصوصية', 'Privacy policy')}
            subtitle={tr('بياناتك تبقى على جهازك', 'Your data stays on your device')}
            onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL).catch(() => {})}
          />
        </Group>

        <Group title={tr('البيانات', 'Data')}>
          <Item icon="trash" title={tr('حذف كل البيانات', 'Delete all data')} danger onPress={confirmClear} />
        </Group>

        <AppText size={12} color={colors.faint} align="center">
          Qu Student · v{Constants.expoConfig?.version ?? '1.0.0'}
        </AppText>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <AppText size={12.5} weight="semibold" color={colors.muted} style={{ paddingHorizontal: 6 }}>
        {title}
      </AppText>
      <View style={[styles.card, { overflow: 'hidden' }]}>{children}</View>
    </View>
  );
}

/** A settings row with an on/off switch; tapping anywhere on the row flips it. */
function ToggleItem({
  icon,
  title,
  subtitle,
  value,
  onChange,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.item,
        { flexDirection: row },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}>
      <View style={styles.itemIcon}>
        <Icon name={icon} size={18} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText size={14} weight="semibold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText size={12} color={colors.muted}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: '#CBD5E1' }}
        thumbColor="#FFFFFF"
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

function Item({
  icon,
  title,
  subtitle,
  onPress,
  danger,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.item,
        { flexDirection: row },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}>
      <View style={[styles.itemIcon, danger && { backgroundColor: colors.dangerSoft }]}>
        <Icon name={icon} size={18} color={danger ? colors.danger : colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText size={14} weight="semibold" color={danger ? colors.danger : colors.text}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText size={12} color={colors.muted}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {!danger ? <Icon name="forward" size={16} color="#8A94A3" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  card: { backgroundColor: colors.surface, borderRadius: 20 },
  item: { alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
