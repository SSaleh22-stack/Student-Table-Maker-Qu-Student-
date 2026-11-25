/**
 * The editor's 'more' menu (the ⋮ button of the header pill, NB-49a): a popover card under the
 * button with
 * - 'إضافة صفحة' (NB-24): a new page after the one on screen, with the notebook's default paper;
 * - 'إعدادات المذكرات': the notebook settings screen.
 * A read-only notebook (made by a newer app version) gets no 'إضافة صفحة'. The recordings are not in
 * this menu: they open from the button beside the mic in the toolbar (RecordingsButton).
 *
 * The card is an RN Modal (Popover). Each row closes it first and runs its action once the Modal has
 * gone, because iOS cannot present or push while a Modal is still being dismissed.
 */
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { tr } from '@/lib/i18n';
import { ListRow } from '@/notebook/ui/ListRow';
import { Popover, type AnchorRect } from '@/notebook/ui/Popover';

/** Time for the popover's Modal to go away before the chosen action runs. */
const AFTER_CLOSE_MS = Platform.OS === 'ios' ? 350 : 60;
const MENU_W = 280;

export type EditorMoreAction = 'addPage' | 'settings';

export interface EditorMoreMenuProps {
  visible: boolean;
  anchor: AnchorRect | null;
  onClose: () => void;
  onAction: (a: EditorMoreAction) => void;
  readOnly: boolean;
}

export function EditorMoreMenu({ visible, anchor, onClose, onAction, readOnly }: EditorMoreMenuProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const pick = (a: EditorMoreAction) => {
    onClose();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      onAction(a);
    }, AFTER_CLOSE_MS);
  };

  return (
    <Popover
      visible={visible}
      anchor={anchor}
      onClose={onClose}
      prefer="below"
      width={MENU_W}
      padding={8}
      gap={8}
      accessibilityLabel={tr('المزيد', 'More')}>
      <View style={styles.list}>
        {readOnly ? null : (
          <ListRow icon="plus" title={tr('إضافة صفحة', 'Add page')} chevron={false} onPress={() => pick('addPage')} />
        )}
        <ListRow icon="sliders" title={tr('إعدادات المذكرات', 'Notebook settings')} chevron={false} onPress={() => pick('settings')} />
      </View>
    </Popover>
  );
}

const styles = StyleSheet.create({
  list: { gap: 2 },
});
