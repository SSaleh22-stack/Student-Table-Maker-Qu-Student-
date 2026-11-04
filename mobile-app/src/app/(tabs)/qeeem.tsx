import { useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { WebFrame, type WebFrameHandle, type WebFrameNavState } from '@/components/WebFrame';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { useAppData } from '@/store/AppData';

const QEEEM_URL = 'https://qeeem.com/qu';

/**
 * Pages that stay inside the app: Qeeem itself, and Cloudflare's security check, which Qeeem
 * shows before the site on some visits.
 */
const allowQeeem = (url: string) => {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      (u.hostname === 'qeeem.com' || u.hostname.endsWith('.qeeem.com') || u.hostname === 'challenges.cloudflare.com')
    );
  } catch {
    return url === 'about:blank';
  }
};

/** Portal placeholders for a section with no lecturer yet ("لم يحدد من الكلية"). */
const isUnassigned = (name: string) => /لم\s*يحدد|غير\s*محدد|^tba$|^-+$/i.test(name.trim());

/**
 * The words Qeeem should search for. Qeeem matches every word, in any order, against its own
 * (usually shorter) names, so: no titles, no "بن", and only the first and family names.
 * "د. محمد بن فهد بن زايد الحصان" → "محمد الحصان"
 */
const searchName = (name: string) => {
  const words = name
    .replace(/^\s*(أ\.?\s*د\.?|د\.?|دكتور|الدكتور|الدكتورة|أ\.?|أستاذ|الأستاذ|Dr\.?)\s+/i, '')
    .split(/\s+/)
    .filter((w) => w && !/^(بن|بنت|ابن)$/.test(w));
  // Names written as two words: "عبد الله", "آل سعود", "أبو زيد"
  const joined = /^(عبد|أبو|ابو)$/;
  const firstLen = words.length > 2 && joined.test(words[0]) ? 2 : 1;
  const familyLen = words.length - firstLen > 1 && /^(آل|ال|أبو|ابو|أبا|ابا|عبد)$/.test(words[words.length - 2]) ? 2 : 1;
  if (words.length <= firstLen + familyLen) return words.join(' ');
  return [...words.slice(0, firstLen), ...words.slice(-familyLen)].join(' ');
};

/** Qeeem's own search results page (what its search box opens). */
const searchUrl = (name: string) => `https://qeeem.com/qu/search?name=${encodeURIComponent(searchName(name))}`;

/** "qeeem.com" from a full address */
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

export default function QeeemScreen() {
  const { chosen } = useAppData();
  const frame = useRef<WebFrameHandle>(null);
  const [nav, setNav] = useState<WebFrameNavState>({ url: QEEEM_URL, canGoBack: false, canGoForward: false, loading: true });
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [hint, setHint] = useState(true);
  /** A link outside Qeeem that the page tried to open (offered, never opened by itself) */
  const [blocked, setBlocked] = useState<string | null>(null);

  const instructors = useMemo(() => {
    const seen = new Set<string>();
    return chosen
      .filter((c) => c.instructor && !isUnassigned(c.instructor) && !seen.has(c.instructor) && seen.add(c.instructor))
      .map((c) => ({ name: c.instructor as string, code: c.code }));
  }, [chosen]);

  const path = useMemo(() => {
    try {
      const u = new URL(nav.url);
      return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
    } catch {
      return 'qeeem.com/qu';
    }
  }, [nav.url]);

  /** Opens Qeeem's search results for this lecturer. */
  const search = (name: string) => {
    setActive(name);
    setBlocked(null);
    frame.current?.load(searchUrl(name));
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.top}>
        <View style={{ flexDirection: row, alignItems: 'center', gap: 10 }}>
          <View style={styles.titleIcon}>
            <Icon name="star" size={21} color={colors.accent} />
          </View>
          <View>
            <AppText weight="bold" size={19}>
              {tr('موقع قيم', 'Qeeem website')}
            </AppText>
            <AppText size={12} color={colors.muted}>
              {tr('تقييم الدكاترة من الطلاب · داخل التطبيق', 'Students rate their professors · in the app')}
            </AppText>
          </View>
        </View>

        <View style={{ flexDirection: row, alignItems: 'center', gap: 6, marginTop: 10 }}>
          <NavButton icon="back" label={tr('رجوع', 'Back')} disabled={!nav.canGoBack} onPress={() => frame.current?.goBack()} />
          <NavButton icon="forward" label={tr('تقدم', 'Forward')} disabled={!nav.canGoForward} onPress={() => frame.current?.goForward()} />
          <View style={[styles.url, { flexDirection: row }]}>
            <Icon name="lock" size={12} color={colors.muted} />
            <AppText size={13} color="#3D4A5C" numberOfLines={1}>
              {path}
            </AppText>
          </View>
          <NavButton icon="refresh" label={tr('إعادة تحميل', 'Reload')} onPress={() => frame.current?.reload()} />
        </View>

        {instructors.length > 0 ? (
          <>
            <AppText size={12} weight="semibold" color={colors.muted} style={{ marginTop: 10 }}>
              {tr('ابحث عن دكاترتك هذا الفصل', 'Look up your professors this term')}
            </AppText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6, paddingVertical: 6, flexDirection: row }}>
              {instructors.map((p) => {
                const on = active === p.name;
                return (
                  <Pressable
                    key={p.name}
                    onPress={() => search(p.name)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[styles.chip, { flexDirection: row }, on && styles.chipOn]}>
                    <AppText size={12.5} weight="medium" color={on ? '#FFFFFF' : colors.text}>
                      {p.name}
                    </AppText>
                    <AppText size={11} weight="semibold" color={on ? '#CFF1F7' : colors.muted}>
                      {p.code}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}
      </View>

      <View style={{ flex: 1 }}>
        {nav.loading && progress < 1 ? (
          <View style={styles.progress}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
        <WebFrame
          ref={frame}
          uri={QEEEM_URL}
          allowUrl={allowQeeem}
          onBlocked={setBlocked}
          onNavigation={setNav}
          onProgress={setProgress}
        />
        {blocked ? (
          <View style={[styles.hint, { flexDirection: row }]} accessibilityLiveRegion="polite">
            <Icon name="external" size={18} color={colors.accentLight} />
            <AppText size={12.5} color="#FFFFFF" style={{ flex: 1 }} numberOfLines={2}>
              {tr('الصفحة تحاول فتح موقع آخر:', 'The page is trying to open another site:')} {hostOf(blocked)}
            </AppText>
            <Pressable
              onPress={() => {
                Linking.openURL(blocked).catch(() => {});
                setBlocked(null);
              }}
              accessibilityRole="button"
              hitSlop={6}>
              <AppText size={13} weight="bold" color={colors.accentLight}>
                {tr('فتح', 'Open')}
              </AppText>
            </Pressable>
            <Pressable onPress={() => setBlocked(null)} accessibilityRole="button" accessibilityLabel={tr('إغلاق', 'Close')} hitSlop={6}>
              <Icon name="x" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : null}
        {hint && !blocked ? (
          <View style={[styles.hint, { flexDirection: row }]}>
            <Icon name="info" size={18} color={colors.accentLight} />
            <AppText size={12.5} color="#FFFFFF" style={{ flex: 1 }}>
              {tr('الموقع يُفتح هنا داخل التطبيق، ويبقى في مكانه عند التنقل بين التبويبات.', 'The site opens here in the app and stays where you left it when you switch tabs.')}
            </AppText>
            <Pressable onPress={() => setHint(false)} accessibilityRole="button">
              <AppText size={13} weight="bold" color={colors.accentLight}>
                {tr('حسناً', 'OK')}
              </AppText>
            </Pressable>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function NavButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: 'back' | 'forward' | 'refresh';
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={styles.navBtn}>
      <Icon name={icon} size={17} color={disabled ? '#A9B2BE' : colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  top: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  titleIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  url: {
    flex: 1,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 8,
  },
  navBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  chip: {
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  progress: { height: 3, backgroundColor: colors.border },
  progressFill: { height: 3, backgroundColor: colors.accent },
  hint: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.ink,
  },
});
