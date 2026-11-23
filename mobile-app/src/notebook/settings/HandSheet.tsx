/**
 * The writing hand (Figma 15 'اليد التي تكتب بها'), for the notebook settings. The hand is used for
 * palm rejection and to keep the toolbar, menus and hints away from the writing hand. Picking a side
 * calls onChange and closes the sheet; the caller writes only settings.hand.
 */
import { StyleSheet, View } from 'react-native';

import { tr } from '@/lib/i18n';
import type { NotebookSettings } from '@/notebook/core/model';
import { NbSheet } from '@/notebook/ui/NbSheet';
import { RadioGroup } from '@/notebook/ui/RadioRow';

export type Hand = NotebookSettings['hand'];

/** The short value at the end of the settings row (Figma 15: 'اليمنى'). */
export function handLabel(h: Hand): string {
  return h === 'right' ? tr('اليمنى', 'Right') : tr('اليسرى', 'Left');
}

export interface HandSheetProps {
  visible: boolean;
  value: Hand;
  onChange: (h: Hand) => void;
  onClose: () => void;
}

export function HandSheet({ visible, value, onChange, onClose }: HandSheetProps) {
  const title = tr('اليد التي تكتب بها', 'Your writing hand');
  return (
    <NbSheet
      visible={visible}
      title={title}
      subtitle={tr(
        'نستخدمها لتجاهل راحة يدك على الشاشة، ولإبعاد شريط الأدوات عن يدك.',
        'We use it to ignore your palm on the screen and to keep the toolbar away from your hand.',
      )}
      onClose={onClose}>
      <View style={styles.body}>
        <RadioGroup<Hand>
          label={title}
          options={[
            { value: 'right', label: tr('اليد اليمنى', 'Right hand'), icon: 'hand' },
            { value: 'left', label: tr('اليد اليسرى', 'Left hand'), icon: 'hand' },
          ]}
          value={value}
          onChange={(v) => {
            if (v !== value) onChange(v);
            onClose();
          }}
        />
      </View>
    </NbSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingVertical: 8 },
});
