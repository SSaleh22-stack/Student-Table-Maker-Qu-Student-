import { type Href, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { useIsTablet } from '@/lib/layout';
import { ltr, row } from '@/lib/rtl';

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
  /** Or this website (opened outside the app) */
  url?: string;
  /** Label of the link at the end of the slide */
  cta?: string;
}

/** What tapping a slide does: open its page or website, or nothing. */
const openerFor = (s: Slide) =>
  s.href ? () => router.push(s.href as Href) : s.url ? () => Linking.openURL(s.url as string).catch(() => {}) : undefined;

const slides = (tablet: boolean): Slide[] => [
  // Promotes the X account. Keep it until the owner says to take it down.
  {
    id: 'follow-x',
    icon: 'x_logo',
    title: tr('تابعنا على إكس', 'Follow us on X'),
    text: tr('آخر الأخبار والتحديثات أولاً بأول', 'News and updates as they happen'),
    url: 'https://x.com/QUStud',
    cta: ltr('@QUStud'),
  },
  // Phones only: the timetable and the other pages have more room on a tablet.
  ...(tablet
    ? []
    : [
        {
          id: 'use-tablet',
          icon: 'tablet' as IconName,
          title: tr('لتجربة أفضل', 'For a better experience'),
          text: tr('ننصح باستخدام جهاز لوحي', 'We recommend using a tablet'),
        },
      ]),
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

/**
 * "إعلانات" on the home page: announcements that move to the next one by themselves.
 * `list` (iPad home) shows every announcement at once as rows instead, filling the height it
 * is given.
 */
export function Announcements({ list = false }: { list?: boolean }) {
  const tablet = useIsTablet();
  const [index, setIndex] = useState(0);
  const SLIDES = slides(tablet);

  // A fresh timer for every slide, so tapping a dot also restarts the count.
  useEffect(() => {
    if (list || SLIDES.length < 2) return;
    const id = setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), SLIDE_MS);
    return () => clearTimeout(id);
  }, [list, index, SLIDES.length]);

  if (list) return <AnnouncementList slides={SLIDES} />;

  const slide = SLIDES[index];
  const open = openerFor(slide);

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

/** iPad home: every announcement as a row, with a closing line under the last one. */
function AnnouncementList({ slides: items }: { slides: Slide[] }) {
  return (
    <View style={[styles.card, styles.cardList]} accessibilityRole="summary">
      <View style={[styles.head, { flexDirection: row, marginBottom: 4 }]}>
        <Icon name="bell" size={18} color={DARK.title} />
        <AppText size={15.5} weight="bold" color={DARK.title} style={{ flex: 1 }}>
          {tr('إعلانات', 'Announcements')}
        </AppText>
        <AppText size={13.5} weight="semibold" color={DARK.text}>
          {items.length}
        </AppText>
      </View>

      {items.map((s, i) => {
        const open = openerFor(s);
        return (
          <Pressable
            key={s.id}
            onPress={open}
            disabled={!open}
            accessibilityRole={open ? 'link' : undefined}
            style={({ pressed }) => [
              styles.listRow,
              { flexDirection: row },
              i > 0 && styles.listDivider,
              pressed && { opacity: 0.85 },
            ]}>
            <View style={styles.listIcon}>
              <Icon name={s.icon} size={25} color={DARK.title} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText size={17} weight="bold" color={DARK.title}>
                {s.title}
              </AppText>
              <View style={{ flexDirection: row, alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <AppText size={14.5} color={DARK.text}>
                  {s.text}
                </AppText>
                {s.tag ? (
                  <View style={[styles.tag, { flexDirection: row }]}>
                    <Icon name="check" size={12} color={DARK.ok} strokeWidth={2.5} />
                    <AppText size={12} weight="semibold" color={DARK.ok}>
                      {s.tag}
                    </AppText>
                  </View>
                ) : null}
              </View>
            </View>
            {open ? <Icon name="forward" size={18} color={DARK.text} /> : null}
          </Pressable>
        );
      })}

      <View style={[styles.listEnd, { flexDirection: row }]}>
        <Icon name="check" size={15} color={DARK.text} strokeWidth={2.2} />
        <AppText size={13.5} color={DARK.text}>
          {tr('لا توجد إعلانات أخرى', 'No other announcements')}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: DARK.bg, borderRadius: 20, padding: 14, gap: 8 },
  cardTablet: { borderRadius: 24, padding: 20, gap: 12 },
  cardList: { flex: 1, borderRadius: 28, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 10, gap: 0 },
  listRow: { alignItems: 'center', gap: 14, paddingVertical: 16 },
  listDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.12)' },
  listIcon: {
    width: 50,
    height: 50,
    borderRadius: 15,
    backgroundColor: DARK.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listEnd: {
    marginTop: 'auto',
    alignItems: 'center',
    gap: 8,
    paddingTop: 14,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
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
