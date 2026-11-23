/**
 * Microphone turned off for the app (NB-64): shown when start() returns 'blocked' (the system will
 * not ask again). Explains where the switch is and opens the app's page in Settings.
 */
import { Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { nbColors } from '@/notebook/theme';
import { NbSheet } from '@/notebook/ui/NbSheet';
import { PillButton } from '@/notebook/ui/CircleButton';

import { openMicSettings } from './permissions';

export interface RecordPermissionSheetProps {
  visible: boolean;
  onClose: () => void;
}

/** Where the microphone switch is, for this platform. */
export function micSettingsSteps(): string {
  return Platform.OS === 'android'
    ? tr('افتح الإعدادات، ثم «الأذونات»، ثم «الميكروفون»، واختر «السماح».', 'Open Settings, then Permissions, then Microphone, and choose Allow.')
    : tr('افتح الإعدادات، ثم فعّل «الميكروفون» لتطبيق QU Student.', 'Open Settings, then turn on Microphone for QU Student.');
}

export function RecordPermissionSheet({ visible, onClose }: RecordPermissionSheetProps) {
  const open = () => {
    onClose();
    void openMicSettings();
  };
  return (
    <NbSheet
      visible={visible}
      title={tr('الميكروفون غير مسموح', 'Microphone is off')}
      onClose={onClose}
      footer={<PillButton label={tr('فتح الإعدادات', 'Open Settings')} onPress={open} block />}>
      <View style={styles.body}>
        <View style={styles.tile}>
          <Icon name="mic" size={26} color={nbColors.danger} />
        </View>
        <AppText size={15} color={nbColors.text} style={styles.para}>
          {tr(
            'لتسجيل المحاضرة أثناء الكتابة يحتاج QU Student إلى الميكروفون، وقد رُفض الإذن من قبل.',
            'QU Student needs the microphone to record the lecture while you write, and access was turned down before.',
          )}
        </AppText>
        <AppText size={15} weight="semibold" color={nbColors.text} style={styles.para}>
          {micSettingsSteps()}
        </AppText>
        <AppText size={14} color={nbColors.faint} style={styles.para}>
          {tr('ثم ارجع إلى المذكرة واضغط زر التسجيل مرة أخرى.', 'Then come back to the notebook and tap the record button again.')}
        </AppText>
      </View>
    </NbSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10, paddingBottom: 8 },
  tile: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: nbColors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 4,
  },
  para: { alignSelf: 'stretch' },
});
