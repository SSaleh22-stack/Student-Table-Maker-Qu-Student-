/**
 * What an Apple Pencil gesture does (NB-52), for the notebook settings (Figma 15 'الكتابة'):
 *
 *   kind 'doubleTap' -> 'النقر المزدوج على Apple Pencil' (settings.pencilDoubleTap)
 *   kind 'squeeze'   -> 'الضغط على Apple Pencil Pro'      (settings.pencilSqueeze)
 *
 * Three choices: 'التبديل إلى الممحاة' (the default), 'التبديل إلى آخر أداة' and 'لا شيء'. Picking one
 * calls onChange and closes the sheet; the caller writes only its own settings field.
 */
import { StyleSheet, View } from 'react-native';

import { tr } from '@/lib/i18n';
import type { NotebookSettings } from '@/notebook/core/model';
import { NbSheet } from '@/notebook/ui/NbSheet';
import { RadioGroup, type RadioOption } from '@/notebook/ui/RadioRow';

export type PencilAction = NotebookSettings['pencilDoubleTap'];
export type PencilGesture = 'doubleTap' | 'squeeze';

/** The short value shown at the end of the settings row (Figma 15: 'التبديل إلى الممحاة'). */
export function pencilActionLabel(a: PencilAction): string {
  switch (a) {
    case 'eraser':
      return tr('التبديل إلى الممحاة', 'Switch to the eraser');
    case 'lastTool':
      return tr('التبديل إلى آخر أداة', 'Switch to the last tool');
    case 'off':
      return tr('لا شيء', 'Nothing');
  }
}

/** The row and sheet title for a gesture. */
export function pencilGestureTitle(g: PencilGesture): string {
  return g === 'doubleTap'
    ? tr('النقر المزدوج على Apple Pencil', 'Double-tap on Apple Pencil')
    : tr('الضغط على Apple Pencil Pro', 'Squeeze on Apple Pencil Pro');
}

function options(g: PencilGesture): RadioOption<PencilAction>[] {
  return [
    {
      value: 'eraser',
      label: pencilActionLabel('eraser'),
      subtitle: tr('ومرة أخرى للعودة إلى الأداة التي كنت تستخدمها', 'Do it again to go back to the tool you were using'),
      icon: 'eraser',
    },
    {
      value: 'lastTool',
      label: pencilActionLabel('lastTool'),
      subtitle: tr('بين الأداة الحالية والأداة التي استخدمتها قبلها', 'Between the current tool and the one you used before it'),
      icon: 'history',
    },
    {
      value: 'off',
      label: pencilActionLabel('off'),
      subtitle:
        g === 'doubleTap'
          ? tr('لا يحدث شيء عند النقر مرتين على القلم', 'Nothing happens when you double-tap the pencil')
          : tr('لا يحدث شيء عند الضغط على القلم', 'Nothing happens when you squeeze the pencil'),
      icon: 'x',
    },
  ];
}

export interface PencilActionSheetProps {
  visible: boolean;
  gesture: PencilGesture;
  value: PencilAction;
  onChange: (a: PencilAction) => void;
  onClose: () => void;
}

export function PencilActionSheet({ visible, gesture, value, onChange, onClose }: PencilActionSheetProps) {
  const title = pencilGestureTitle(gesture);
  return (
    <NbSheet
      visible={visible}
      title={title}
      subtitle={
        gesture === 'doubleTap'
          ? tr('ماذا يحدث عند النقر مرتين على Apple Pencil؟', 'What happens when you double-tap the Apple Pencil?')
          : tr('ماذا يحدث عند الضغط على Apple Pencil Pro؟', 'What happens when you squeeze the Apple Pencil Pro?')
      }
      onClose={onClose}>
      <View style={styles.body}>
        <RadioGroup<PencilAction>
          label={title}
          options={options(gesture)}
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
