import { router } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Card, IconButton, ScreenHeader } from '@/components/ui';
import { tr } from '@/lib/i18n';
import { useIsTablet } from '@/lib/layout';
import { goBack } from '@/lib/nav';
import { ltr, row } from '@/lib/rtl';
import { colors } from '@/lib/theme';

interface Channel {
  icon: IconName;
  title: string;
  /** Shown left-to-right, e.g. the phone number */
  value: string;
  url: string;
  color: string;
  tint: string;
}

const channels = (): Channel[] => [
  {
    icon: 'whatsapp',
    title: tr('واتساب', 'WhatsApp'),
    value: '+966 56 150 2678',
    url: 'https://wa.me/966561502678',
    color: '#128C4B',
    tint: '#E3F7EA',
  },
  {
    icon: 'telegram',
    title: tr('تيليجرام', 'Telegram'),
    value: '@qu4611',
    url: 'https://t.me/qu4611',
    color: '#1D8FCB',
    tint: '#E2F2FB',
  },
  {
    icon: 'x_logo',
    title: tr('إكس (تويتر)', 'X (Twitter)'),
    value: '@QUStud',
    url: 'https://x.com/QUStud',
    color: '#14171A',
    tint: '#EDEFF2',
  },
  {
    icon: 'mail',
    title: tr('البريد الإلكتروني', 'Email'),
    value: 'qu4611@gmail.com',
    url: 'mailto:qu4611@gmail.com',
    color: colors.accentDark,
    tint: colors.accentTint,
  },
];

/** Universities the app works with today. */
const universities = () => [tr('جامعة القصيم', 'Qassim University')];

/** "تواصل معنا": WhatsApp, Telegram, X and email, and the supported universities. */
export default function ContactScreen() {
  // Tablets get bigger text and use the width: the channels and universities sit side by side.
  const tablet = useIsTablet();
  const t = (phone: number, tab: number) => (tablet ? tab : phone);
  const iconBox = { width: t(44, 56), height: t(44, 56), borderRadius: t(14, 18) };

  const channelList = (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {channels().map((c, i) => (
        <Pressable
          key={c.icon}
          onPress={() => Linking.openURL(c.url).catch(() => {})}
          accessibilityRole="link"
          accessibilityLabel={`${c.title}: ${c.value}`}
          style={({ pressed }) => [
            styles.channel,
            tablet && styles.channelTablet,
            { flexDirection: row },
            i > 0 && styles.divider,
            pressed && { backgroundColor: colors.surfaceMuted },
          ]}>
          <View style={[styles.channelIcon, iconBox, { backgroundColor: c.tint }]}>
            <Icon name={c.icon} size={t(22, 28)} color={c.color} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText size={t(15, 18)} weight="semibold">
              {c.title}
            </AppText>
            <AppText size={t(13.5, 16)} color={colors.muted}>
              {ltr(c.value)}
            </AppText>
          </View>
          <Icon name="forward" size={t(16, 20)} color={colors.faint} />
        </Pressable>
      ))}
    </Card>
  );

  const universityList = (
    <Card style={[{ gap: 12 }, tablet && { padding: 20, gap: 16 }]}>
      {universities().map((u) => (
        <View key={u} style={[styles.university, { flexDirection: row }]}>
          <View style={[styles.universityIcon, iconBox]}>
            <Icon name="university" size={t(22, 28)} color={colors.accentDark} />
          </View>
          <AppText size={t(15, 18)} weight="semibold" style={{ flex: 1 }}>
            {u}
          </AppText>
          <View style={[styles.supported, { flexDirection: row }]}>
            <Icon name="check" size={t(13, 15)} color={colors.success} strokeWidth={2.5} />
            <AppText size={t(12, 14)} weight="semibold" color={colors.success}>
              {tr('مدعومة', 'Supported')}
            </AppText>
          </View>
        </View>
      ))}
      <View style={[styles.addNote, tablet && { padding: 14 }, { flexDirection: row }]}>
        <Icon name="info" size={t(16, 19)} color={colors.accentDark} />
        <AppText size={t(13, 15.5)} color={colors.text} style={{ flex: 1 }}>
          {tr('إذا كنت تريد إضافة جامعتك، يرجى التواصل معنا.', 'Want your university added? Get in touch with us.')}
        </AppText>
      </View>
    </Card>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.content, tablet && styles.contentTablet]}>
        <ScreenHeader title={tr('تواصل معنا', 'Contact us')} leading={<IconButton icon="back" label={tr('رجوع', 'Back')} onPress={goBack} />} />

        <Pressable
          onPress={() => router.push('/feedback')}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.feedback,
            tablet && styles.feedbackTablet,
            { flexDirection: row },
            pressed && { opacity: 0.9 },
          ]}>
          <View style={[styles.feedbackIcon, iconBox]}>
            <Icon name="message" size={t(22, 28)} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <AppText size={t(15, 19)} weight="bold" color="#FFFFFF">
              {tr('أرسل مشكلة أو اقتراح', 'Report a problem or suggest')}
            </AppText>
            <AppText size={t(12.5, 15)} color="#DDF0F4">
              {tr('اكتب رسالتك هنا وتصلنا مباشرة', 'Write it here and it reaches us directly')}
            </AppText>
          </View>
          <Icon name="forward" size={t(16, 20)} color="#FFFFFF" />
        </Pressable>

        {tablet ? (
          <View style={[styles.columns, { flexDirection: row }]}>
            <View style={styles.column}>
              <AppText size={18} weight="bold">
                {tr('أو تواصل معنا عبر', 'Or reach us through')}
              </AppText>
              {channelList}
            </View>
            <View style={styles.column}>
              <AppText size={18} weight="bold">
                {tr('الجامعات المدعومة', 'Supported universities')}
              </AppText>
              {universityList}
            </View>
          </View>
        ) : (
          <>
            <AppText size={14} color={colors.muted}>
              {tr('أو تواصل معنا عبر:', 'Or reach us through:')}
            </AppText>
            {channelList}
            <AppText size={16} weight="bold" style={{ marginTop: 8 }}>
              {tr('الجامعات المدعومة', 'Supported universities')}
            </AppText>
            {universityList}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  contentTablet: { width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 32, paddingTop: 24, gap: 20 },
  columns: { gap: 20, alignItems: 'flex-start' },
  column: { flex: 1, gap: 12 },
  channel: { alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  channelTablet: { gap: 16, paddingHorizontal: 20, paddingVertical: 18 },
  divider: { borderTopWidth: 1, borderTopColor: colors.divider },
  feedback: { alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, backgroundColor: colors.accent },
  feedbackTablet: { gap: 16, padding: 22, borderRadius: 24 },
  feedbackIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  university: { alignItems: 'center', gap: 12 },
  universityIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supported: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.successSoft,
  },
  addNote: {
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
  },
});
