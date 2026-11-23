/**
 * The 'تجريبي' / 'Beta' pill (Figma betaPill): warning-soft fill, warning text. 12 pt by default;
 * the library title uses 13.
 */
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { tr } from '@/lib/i18n';
import { colors } from '@/lib/theme';

export function BetaBadge({ size = 12 }: { size?: number }) {
  const label = tr('تجريبي', 'Beta');
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={tr('ميزة تجريبية', 'Beta feature')}
      style={{
        backgroundColor: colors.warningSoft,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 3,
        alignSelf: 'center',
      }}>
      <AppText size={size} weight="semibold" color={colors.warning}>
        {label}
      </AppText>
    </View>
  );
}
