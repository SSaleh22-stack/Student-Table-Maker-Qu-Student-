import { useImperativeHandle } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { colors } from '@/lib/theme';

import type { WebFrameProps } from './WebFrame';

export type { WebFrameHandle, WebFrameNavState } from './WebFrame';

/**
 * Web preview stand-in: in-app websites need the phone app (react-native-webview has no web
 * version), so the browser preview shows a short note instead.
 */
export function WebFrame({ ref, uri }: WebFrameProps) {
  useImperativeHandle(ref, () => ({
    inject: () => {},
    reload: () => {},
    goBack: () => {},
    goForward: () => {},
    load: () => {},
  }));

  let host = uri;
  try {
    host = new URL(uri).hostname;
  } catch {}

  return (
    <View style={styles.box}>
      <Icon name="external" size={28} color={colors.accent} />
      <AppText weight="semibold" size={15} align="center">
        {tr('يُعرض الموقع هنا داخل تطبيق الجوال', 'This website opens here in the phone app')}
      </AppText>
      <AppText size={13} color={colors.muted} align="center">
        {host} — {tr('المعاينة على المتصفح لا تدعم عرض المواقع داخل التطبيق.', 'The browser preview cannot show websites inside the app.')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, backgroundColor: colors.surface },
});
