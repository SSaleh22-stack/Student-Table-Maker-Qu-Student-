/**
 * The editor's error states (P29): the notebook could not be opened.
 *
 * - 'missing' (no such notebook, a bad link, a notebook purged on another screen):
 *   'لم نعثر على هذه المذكرة' with 'العودة إلى المكتبة'.
 * - 'unreadable' (every saved copy failed to read; the bad files were moved to quarantine/, so nothing
 *   is overwritten): 'تعذّرت قراءة هذه المذكرة. حفظنا نسخة منها جانباً.' with the same button.
 *
 * No notebook data is touched here; the student goes back to the library.
 */
import { StyleSheet, View } from 'react-native';

import { tr } from '@/lib/i18n';
import { useScreenInsets } from '@/lib/insets';
import { goBackOr, openLibrary } from '@/notebook/nav';
import { nbColors } from '@/notebook/theme';
import { EmptyState } from '@/notebook/ui/EmptyState';

export type EditorErrorKind = 'missing' | 'unreadable';

export function editorErrorText(kind: EditorErrorKind): { title: string; body?: string } {
  if (kind === 'missing') return { title: tr('لم نعثر على هذه المذكرة', "We couldn't find this notebook") };
  return {
    title: tr('تعذّرت قراءة هذه المذكرة. حفظنا نسخة منها جانباً.', "This notebook couldn't be read. We kept a copy of it aside."),
  };
}

export interface EditorErrorProps {
  kind: EditorErrorKind;
  /** Default: back to the screen below (the library), or open the library. */
  onBack?: () => void;
}

export function EditorError({ kind, onBack }: EditorErrorProps) {
  const insets = useScreenInsets();
  const text = editorErrorText(kind);
  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <EmptyState
        icon={kind === 'missing' ? 'notebookPen' : 'alert'}
        title={text.title}
        body={text.body}
        primary={{
          label: tr('العودة إلى المكتبة', 'Back to the library'),
          icon: 'back',
          onPress: onBack ?? (() => goBackOr(openLibrary)),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: nbColors.bg, justifyContent: 'center', paddingHorizontal: 24 },
});
