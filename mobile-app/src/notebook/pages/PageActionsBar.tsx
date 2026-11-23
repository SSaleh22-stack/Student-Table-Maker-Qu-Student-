/**
 * The pages view action bar (Figma 13 'page-actions'): a white 24 pt-radius bar with five icon +
 * label buttons in reading order: 'إضافة صفحة', 'تكرار', 'تغيير الورق', 'إدراج PDF' and 'حذف' (red).
 *
 * The bar only draws: PagesScreen decides the targets and what each action does
 * (core/pages/pageSelection.ts). A long press on 'إضافة صفحة' reports the button's window rect, so
 * the screen can offer 'في النهاية' next to it; screen readers get the same choice as an action.
 */
import { useRef, type ComponentRef } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { PAGE_ACTIONS, type ActionState, type PageActionId } from '@/notebook/core/pages/pageSelection';
import { nbColors, nbRadius } from '@/notebook/theme';
import type { AnchorRect } from '@/notebook/ui/Popover';

export function pageActionLabel(id: PageActionId): string {
  switch (id) {
    case 'add':
      return tr('إضافة صفحة', 'Add page');
    case 'duplicate':
      return tr('تكرار', 'Duplicate');
    case 'paper':
      return tr('تغيير الورق', 'Change paper');
    case 'insertPdf':
      return tr('إدراج PDF', 'Insert PDF');
    case 'delete':
      return tr('حذف', 'Delete');
  }
}

const ICONS: Record<PageActionId, IconName> = {
  add: 'plus',
  duplicate: 'copy',
  paper: 'fileText',
  insertPdf: 'fileText',
  delete: 'trash',
};

export interface PageActionsBarProps {
  states: Record<PageActionId, ActionState>;
  onAction: (id: PageActionId) => void;
  /** Long press on 'إضافة صفحة' (anchor in window coordinates, null when it could not be measured). */
  onAddLongPress: (anchor: AnchorRect | null) => void;
  compact: boolean;
  /** Spoken with each action, e.g. 'الصفحة الحالية' or '3 صفحات'. */
  targetsLabel?: string;
}

interface Measurable {
  measureInWindow(cb: (x: number, y: number, w: number, h: number) => void): void;
}

export function PageActionsBar({ states, onAction, onAddLongPress, compact, targetsLabel }: PageActionsBarProps) {
  const addRef = useRef<ComponentRef<typeof View>>(null);

  const longPressAdd = () => {
    const node = addRef.current as unknown as Measurable | null;
    if (!node) {
      onAddLongPress(null);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      onAddLongPress(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  };

  return (
    <View style={[styles.bar, compact ? styles.barCompact : styles.barRegular, { flexDirection: row }]} accessibilityRole="toolbar">
      {PAGE_ACTIONS.map((id) => {
        const enabled = states[id].enabled;
        const danger = id === 'delete';
        const tint = danger ? nbColors.danger : nbColors.text;
        const labelColor = danger ? nbColors.danger : nbColors.muted;
        const isAdd = id === 'add';
        return (
          <Pressable
            key={id}
            ref={isAdd ? addRef : undefined}
            collapsable={false}
            onPress={() => onAction(id)}
            onLongPress={isAdd ? longPressAdd : undefined}
            delayLongPress={400}
            disabled={!enabled}
            accessibilityRole="button"
            accessibilityLabel={pageActionLabel(id)}
            accessibilityHint={targetsLabel}
            accessibilityState={{ disabled: !enabled }}
            accessibilityActions={isAdd && enabled ? [{ name: 'longpress', label: tr('في النهاية', 'At the end') }] : undefined}
            onAccessibilityAction={isAdd ? (e) => e.nativeEvent.actionName === 'longpress' && longPressAdd() : undefined}
            hitSlop={4}
            style={({ pressed }) => [styles.action, { opacity: !enabled ? 0.35 : pressed ? 0.55 : 1 }]}>
            <Icon name={ICONS[id]} size={compact ? 20 : 22} color={tint} />
            <AppText size={compact ? 12 : 13} weight="medium" color={labelColor} align="center" numberOfLines={1}>
              {pageActionLabel(id)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const SHADOW = Platform.select({
  ios: { shadowColor: '#1B2533', shadowOpacity: 0.1, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
  android: { elevation: 8 },
  default: {},
}) as object;

const styles = StyleSheet.create({
  bar: {
    backgroundColor: nbColors.surface,
    borderRadius: nbRadius.bar,
    justifyContent: 'space-between',
    alignItems: 'center',
    ...SHADOW,
  },
  barRegular: { paddingHorizontal: 20, paddingVertical: 14 },
  barCompact: { paddingHorizontal: 8, paddingVertical: 10 },
  action: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 2, minHeight: 48, justifyContent: 'center' },
});
