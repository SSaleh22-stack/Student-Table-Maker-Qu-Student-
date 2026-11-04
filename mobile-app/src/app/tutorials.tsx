import * as Device from 'expo-device';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Card, Chip, IconButton, ScreenHeader } from '@/components/ui';
import { VideoPlayer } from '@/components/VideoPlayer';
import { tr } from '@/lib/i18n';
import { goBack } from '@/lib/nav';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';

interface Tutorial {
  title: string;
  /** e.g. "2:30" */
  duration?: string;
  /** YouTube video id (the part after /shorts/ or ?v=) */
  youtubeId: string;
  /** width / height of the video: 9/16 for Shorts, 16/9 for normal videos */
  aspectRatio?: number;
}

type Platform = 'phone' | 'ipad';

const platforms = (): { key: Platform; label: string }[] => [
  { key: 'phone', label: tr('الجوال', 'Phone') },
  { key: 'ipad', label: tr('الآيباد', 'iPad') },
];

/** How-to videos for each device. Add entries here as they are recorded. */
const tutorials = (): Record<Platform, Tutorial[]> => ({
  phone: [
    {
      title: tr('شرح استخدام التطبيق على الجوال', 'Using the app on a phone'),
      youtubeId: 'EIm0nSZxu2I',
      aspectRatio: 9 / 16,
    },
  ],
  ipad: [],
});

/** "مقاطع شرح الاستخدام": short videos on how to use the app, played inside the app. */
export default function TutorialsScreen() {
  // Tablets open on the iPad videos; everything else on the phone ones.
  const [platform, setPlatform] = useState<Platform>(
    Device.deviceType === Device.DeviceType.TABLET ? 'ipad' : 'phone',
  );
  const list = tutorials()[platform];

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          title={tr('مقاطع شرح الاستخدام', 'How-to videos')}
          subtitle={tr('شرح مختصر لكل ميزة في التطبيق', 'A short guide to every feature in the app')}
          leading={<IconButton icon="back" label={tr('رجوع', 'Back')} onPress={goBack} />}
        />

        <View style={[styles.tabs, { flexDirection: row }]}>
          {platforms().map((p) => (
            <Chip key={p.key} label={p.label} selected={platform === p.key} onPress={() => setPlatform(p.key)} />
          ))}
        </View>

        {list.length === 0 ? (
          <Card style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Icon name="play" size={28} color={colors.accent} />
            </View>
            <AppText size={16} weight="bold" align="center">
              {tr('المقاطع قادمة قريباً', 'Videos coming soon')}
            </AppText>
            <AppText size={13} color={colors.muted} align="center">
              {platform === 'ipad'
                ? tr('نجهّز مقطعاً يشرح استخدام التطبيق على الآيباد.', 'We’re preparing a video on using the app on an iPad.')
                : tr(
                    'نجهّز مقاطع قصيرة تشرح الاستيراد من البوابة، وبناء الجدول، والتصدير، وحاسبتي المعدل والغياب.',
                    'We’re preparing short videos on importing from the portal, building the timetable, exporting, and the GPA and absence calculators.',
                  )}
            </AppText>
          </Card>
        ) : (
          list.map((t) => (
            <Card key={t.youtubeId} style={styles.item}>
              <View style={styles.heading}>
                <AppText size={15} weight="semibold">
                  {t.title}
                </AppText>
                {t.duration ? (
                  <AppText size={12} color={colors.muted}>
                    {t.duration}
                  </AppText>
                ) : null}
              </View>
              {/* Vertical Shorts get a phone-sized frame instead of filling a wide screen. */}
              <View style={[styles.player, (t.aspectRatio ?? 9 / 16) < 1 && styles.playerTall]}>
                <VideoPlayer youtubeId={t.youtubeId} aspectRatio={t.aspectRatio} />
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 32, paddingHorizontal: 20 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  tabs: { gap: 8 },
  item: { gap: 12, padding: 12 },
  heading: { gap: 2, paddingHorizontal: 4 },
  player: { width: '100%', alignSelf: 'center' },
  playerTall: { maxWidth: 340 },
});
