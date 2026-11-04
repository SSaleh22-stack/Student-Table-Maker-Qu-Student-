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

/** "تواصل معنا": WhatsApp, Telegram and email, and the supported universities. */
export default function ContactScreen() {
  const tablet = useIsTablet();
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.content, tablet && styles.contentTablet]}>
        <ScreenHeader title={tr('تواصل معنا', 'Contact us')} leading={<IconButton icon="back" label={tr('رجوع', 'Back')} onPress={goBack} />} />

        <AppText size={14} color={colors.muted}>
          {tr('في حال وجود استفسارات أو مشاكل تقنية أو اقتراحات، تواصل معنا عبر:', 'For questions, technical problems or suggestions, reach us through:')}
        </AppText>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {channels().map((c, i) => (
            <Pressable
              key={c.icon}
              onPress={() => Linking.openURL(c.url).catch(() => {})}
              accessibilityRole="link"
              accessibilityLabel={`${c.title}: ${c.value}`}
              style={({ pressed }) => [
                styles.channel,
                { flexDirection: row },
                i > 0 && styles.divider,
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}>
              <View style={[styles.channelIcon, { backgroundColor: c.tint }]}>
                <Icon name={c.icon} size={22} color={c.color} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText size={15} weight="semibold">
                  {c.title}
                </AppText>
                <AppText size={13.5} color={colors.muted}>
                  {ltr(c.value)}
                </AppText>
              </View>
              <Icon name="forward" size={16} color={colors.faint} />
            </Pressable>
          ))}
        </Card>

        <AppText size={16} weight="bold" style={{ marginTop: 8 }}>
          {tr('الجامعات المدعومة', 'Supported universities')}
        </AppText>
        <Card style={{ gap: 12 }}>
          {universities().map((u) => (
            <View key={u} style={[styles.university, { flexDirection: row }]}>
              <View style={styles.universityIcon}>
                <Icon name="university" size={22} color={colors.accentDark} />
              </View>
              <AppText size={15} weight="semibold" style={{ flex: 1 }}>
                {u}
              </AppText>
              <View style={[styles.supported, { flexDirection: row }]}>
                <Icon name="check" size={13} color={colors.success} strokeWidth={2.5} />
                <AppText size={12} weight="semibold" color={colors.success}>
                  {tr('مدعومة', 'Supported')}
                </AppText>
              </View>
            </View>
          ))}
          <View style={[styles.addNote, { flexDirection: row }]}>
            <Icon name="info" size={16} color={colors.accentDark} />
            <AppText size={13} color={colors.text} style={{ flex: 1 }}>
              {tr('إذا كنت تريد إضافة جامعتك، يرجى التواصل معنا.', 'Want your university added? Get in touch with us.')}
            </AppText>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  contentTablet: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: 24 },
  channel: { alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: colors.divider },
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
