/**
 * An empty screen (Figma 17 'لا توجد مذكرات بعد'): an icon in a white circle inside an accent-soft
 * ring, a large title, a centered body and up to two pill buttons, the primary one at the reading
 * start. Smaller on compact windows, where the buttons stack.
 */
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';

import { PillButton } from './CircleButton';
import { useWidthClass } from './layout';

export interface EmptyStateAction {
  label: string;
  icon?: IconName;
  onPress: () => void;
  hint?: string;
}

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
  primary?: EmptyStateAction;
  secondary?: EmptyStateAction;
  style?: StyleProp<ViewStyle>;
}

const INNER_SHADOW = Platform.select({
  ios: { shadowColor: '#1B2533', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  android: { elevation: 2 },
  default: { boxShadow: '0 3px 10px rgba(27, 37, 51, 0.08)' },
}) as object;

export function EmptyState({ icon = 'notebookPen', title, body, primary, secondary, style }: EmptyStateProps) {
  const compact = useWidthClass() === 'compact';
  const ring = compact ? 140 : 180;
  const inner = compact ? 96 : 120;
  return (
    <View style={[styles.wrap, style]}>
      <View
        style={{ width: ring, height: ring, borderRadius: ring / 2, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden>
        <View
          style={[
            { width: inner, height: inner, borderRadius: inner / 2, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
            INNER_SHADOW,
          ]}>
          <Icon name={icon} size={compact ? 44 : 54} color={colors.accent} />
        </View>
      </View>
      <AppText size={compact ? 22 : 26} weight="bold" align="center" accessibilityRole="header">
        {title}
      </AppText>
      {body ? (
        <AppText size={compact ? 15 : 16} color={colors.faint} align="center" style={{ lineHeight: compact ? 24 : 26 }}>
          {body}
        </AppText>
      ) : null}
      {primary || secondary ? (
        <View style={[styles.actions, compact ? styles.actionsCompact : { flexDirection: row }]}>
          {primary ? (
            <PillButton label={primary.label} icon={primary.icon} onPress={primary.onPress} hint={primary.hint} block={compact} />
          ) : null}
          {secondary ? (
            <PillButton
              label={secondary.label}
              icon={secondary.icon}
              onPress={secondary.onPress}
              hint={secondary.hint}
              variant="secondary"
              block={compact}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 18, paddingHorizontal: 24, maxWidth: 560, alignSelf: 'center', width: '100%' },
  actions: { gap: 12, justifyContent: 'center' },
  actionsCompact: { alignSelf: 'stretch' },
});
