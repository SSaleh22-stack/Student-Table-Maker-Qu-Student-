import { type Href, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { useIsTablet } from '@/lib/layout';
import { row } from '@/lib/rtl';

/** Dark teal card: light text and see-through white boxes on it. */
const DARK = {
  bg: '#0A4A5C',
  title: '#FFFFFF',
  text: '#CFEAF0',
  soft: 'rgba(255, 255, 255, 0.12)',
  dot: 'rgba(255, 255, 255, 0.3)',
  link: '#7FD3E3',
  ok: '#86EFAC',
  okBg: 'rgba(134, 239, 172, 0.16)',
};

interface Slide {
  id: string;
  icon: IconName;
  title: string;
  text: string;
  /** Small green tag next to the text */
  tag?: string;
  /** Tapping the slide opens this page */
  href?: Href;
  /** Label of the link at the end of the slide */
  cta?: string;
}

const slides = (): Slide[] => [
  {
    id: 'universities',
    icon: 'university',
    title: tr('الجامعات المدعومة', 'Supported universities'),
    text: tr('جامعة القصيم', 'Qassim University'),
    tag: tr('مدعومة', 'Supported'),
  },
  {
    id: 'add-university',
    icon: 'message',
    title: tr('أضف جامعتك', 'Add your university'),
    text: tr('إذا كنت تريد إضافة جامعتك، يرجى التواصل معنا.', 'Want your university added? Get in touch with us.'),
    href: '/contact',
    cta: tr('تواصل معنا', 'Contact us'),
  },
];

/** Time each announcement stays before moving to the next. */
const SLIDE_MS = 4000;

/** "إعلانات" on the home page: announcements that move to the next one by themselves. */
export function Announcements() {
  const tablet = useIsTablet();
  const [index, setIndex] = useState(0);
  const SLIDES = slides();

  // A fresh timer for every slide, so tapping a dot also restarts the count.
  useEffect(() => {
    if (SLIDES.length < 2) return;
    const id = setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), SLIDE_MS);
    return () => clearTimeout(id);
  }, [index, SLIDES.length]);

  const slide = SLIDES[index];
  const open = slide.href ? () => router.push(slide.href as Href) : undefined;

  return (
    <View style={[styles.card, tablet && styles.cardTablet]} accessibilityRole="summary">
      <View style={[styles.head, { flexDirection: row }]}>
        <Icon name="bell" size={tablet ? 17 : 15} color={DARK.text} />
        <AppText size={tablet ? 14 : 12.5} weight="semibold" color={DARK.text} style={{ flex: 1 }}>
          {tr('إعلانات', 'Announcements')}
        </AppText>
        <View style={[styles.dots, { flexDirection: row }]}>
          {SLIDES.map((s, i) => (
            <Pressable
              key={s.id}
              onPress={() => setIndex(i)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={tr(`الإعلان ${i + 1} من ${SLIDES.length}`, `Announcement ${i + 1} of ${SLIDES.length}`)}
              accessibilityState={{ selected: i === index }}>
              <View style={[styles.dot, i === index && styles.dotOn]} />
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.stage, tablet && styles.stageTablet]}>
        <Animated.View
          key={slide.id}
          entering={FadeIn.duration(300)}
          exiting={FadeOut.duration(200)}
          style={StyleSheet.absoluteFill}
          accessibilityLiveRegion="polite">
          <Pressable
            onPress={open}
            disabled={!open}
            accessibilityRole={open ? 'link' : undefined}
            style={({ pressed }) => [styles.slide, { flexDirection: row }, pressed && { opacity: 0.85 }]}>
            <View style={[styles.icon, tablet && styles.iconTablet]}>
              <Icon name={slide.icon} size={tablet ? 26 : 22} color={DARK.title} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText size={tablet ? 17 : 15} weight="bold" color={DARK.title}>
                {slide.title}
              </AppText>
              <View style={{ flexDirection: row, alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <AppText size={tablet ? 15 : 13} color={DARK.text}>
                  {slide.text}
                </AppText>
                {slide.tag ? (
                  <View style={[styles.tag, { flexDirection: row }]}>
                    <Icon name="check" size={12} color={DARK.ok} strokeWidth={2.5} />
                    <AppText size={11.5} weight="semibold" color={DARK.ok}>
                      {slide.tag}
                    </AppText>
                  </View>
                ) : null}
              </View>
              {slide.cta ? (
                <AppText size={tablet ? 14 : 12.5} weight="bold" color={DARK.link}>
                  {slide.cta}
                </AppText>
              ) : null}
            </View>
            {open ? <Icon name="forward" size={16} color={DARK.text} /> : null}
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: DARK.bg, borderRadius: 20, padding: 14, gap: 8 },
  cardTablet: { borderRadius: 24, padding: 20, gap: 12 },
  head: { alignItems: 'center', gap: 6 },
  dots: { alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: DARK.dot },
  dotOn: { width: 18, backgroundColor: DARK.title },
  // Fixed height so the page doesn't jump when the slides change
  stage: { height: 76 },
  stageTablet: { height: 92 },
  slide: { flex: 1, alignItems: 'center', gap: 12 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: DARK.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTablet: { width: 58, height: 58, borderRadius: 17 },
  tag: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: DARK.okBg,
  },
});
