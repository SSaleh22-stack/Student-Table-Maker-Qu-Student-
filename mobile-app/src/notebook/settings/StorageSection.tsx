/**
 * Notebook storage (Figma 15 'التخزين'; NB-87):
 *
 *   1.4 جيجابايت                                 متاح على الجهاز: 38 جيجابايت
 *   [====== PDF ======][==== التسجيلات ====][= الكتابة والصور =]
 *   ● ملفات PDF 590 MB   ● التسجيلات 420 MB   ● الكتابة والصور 110 MB   (● أخرى …)
 *
 * The usage is read with store.usage() (core computeUsage: reads only, never repairs) each time the
 * screen gains focus, and again shortly after a library change (create, trash, purge, import) while
 * it stays open. A newer read always wins over an older one that finishes late.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { tr, useLang } from '@/lib/i18n';
import { pushToEnd, row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { bytesLabel } from '@/notebook/core/text/labels';
import { useNotebooks, type StorageUsage } from '@/notebook/store/hooks';
import { PillButton } from '@/notebook/ui/CircleButton';
import { Group } from '@/notebook/ui/Group';
import { useWidthClass } from '@/notebook/ui/layout';

import { StorageBar, StorageLegend, storageSegments, storageTotal } from './StorageBar';

type UsageState = { kind: 'loading' } | { kind: 'ready'; usage: StorageUsage } | { kind: 'failed' };

/** Library changes come in bursts (an import adds pages one by one): read once they settle. */
const CHANGE_DEBOUNCE_MS = 600;

function useStorageUsage(): { state: UsageState; reload: () => void } {
  const store = useNotebooks();
  const usage = store.usage;
  const onLibraryChanged = store.events.onLibraryChanged;
  const [state, setState] = useState<UsageState>({ kind: 'loading' });
  const seq = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    usage().then(
      (u) => {
        if (alive.current && mine === seq.current) setState({ kind: 'ready', usage: u });
      },
      () => {
        if (alive.current && mine === seq.current) setState((s) => (s.kind === 'ready' ? s : { kind: 'failed' }));
      },
    );
  }, [usage]);

  useFocusEffect(
    useCallback(() => {
      reload();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const off = onLibraryChanged(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          reload();
        }, CHANGE_DEBOUNCE_MS);
      });
      return () => {
        off();
        if (timer) clearTimeout(timer);
      };
    }, [reload, onLibraryChanged]),
  );

  return { state, reload };
}

export function StorageSection() {
  const lang = useLang();
  const compact = useWidthClass() === 'compact';
  const { state, reload } = useStorageUsage();

  let body;
  if (state.kind === 'ready') {
    const u = state.usage;
    const segments = storageSegments(u);
    const total = storageTotal(u);
    const free = u.free > 0 ? u.free : 0;
    body = (
      <>
        <View style={[styles.head, { flexDirection: row }]}>
          <AppText
            size={22}
            weight="bold"
            accessibilityLabel={tr(`تستخدم المذكرات ${bytesLabel(total, 'ar')}`, `Notebooks use ${bytesLabel(total, 'en')}`)}
            style={styles.total}>
            {bytesLabel(total, lang)}
          </AppText>
          {free > 0 ? (
            <AppText size={13} color={colors.faint} style={[styles.free, pushToEnd]}>
              {tr(`متاح على الجهاز: ${bytesLabel(free, 'ar')}`, `Available on device: ${bytesLabel(free, 'en')}`)}
            </AppText>
          ) : null}
        </View>
        <StorageBar segments={segments} />
        <StorageLegend segments={segments} gap={compact ? 16 : 22} />
      </>
    );
  } else if (state.kind === 'loading') {
    body = (
      <View style={[styles.status, { flexDirection: row }]} accessible accessibilityLabel={tr('جارٍ حساب المساحة…', 'Working out the space used…')}>
        <ActivityIndicator color={colors.accent} />
        <AppText size={14} color={colors.faint}>
          {tr('جارٍ حساب المساحة…', 'Working out the space used…')}
        </AppText>
      </View>
    );
  } else {
    body = (
      <View style={[styles.status, { flexDirection: row }]}>
        <AppText size={14} color={colors.faint} style={styles.shrink}>
          {tr('تعذّر حساب المساحة المستخدمة.', "Couldn't work out the space used.")}
        </AppText>
        <PillButton label={tr('إعادة المحاولة', 'Try again')} variant="link" size="sm" onPress={reload} />
      </View>
    );
  }

  return (
    <Group title={tr('التخزين', 'Storage')}>
      <View key="storage" style={[styles.card, compact && styles.cardCompact]}>
        {body}
      </View>
    </Group>
  );
}

const styles = StyleSheet.create({
  card: { padding: 20, gap: 14 },
  cardCompact: { padding: 16, gap: 12 },
  head: { alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  total: { flexShrink: 0 },
  free: { flexShrink: 1 },
  status: { alignItems: 'center', gap: 10, minHeight: 40 },
  shrink: { flex: 1 },
});
