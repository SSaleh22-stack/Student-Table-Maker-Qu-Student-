/**
 * 'تغيير الورق' for the pages view (NB-23): the paper picker (type, color, size) for the target
 * pages, then 'تطبيق'. The switch 'تطبيق على الصفحات الجديدة' also makes the chosen paper the
 * notebook's default for new pages (setDefaults); the screen applies both as ONE undo step.
 *
 * PDF pages are never changed: when some targets are PDF pages, the sheet says so
 * ('لا يمكن تغيير ورق صفحات PDF'). An image page keeps its image and its size; the paper shows around it.
 *
 * The picker starts from `initial` when the component mounts: give it a new `key` for every opening,
 * so each opening starts from the targets' paper with the switch off.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { getLang, tr } from '@/lib/i18n';
import type { PaperSpec } from '@/notebook/core/model';
import { countLabel } from '@/notebook/core/text/labels';
import { PillButton } from '@/notebook/ui/CircleButton';
import { InfoBanner } from '@/notebook/ui/InfoBanner';
import { NbSheet } from '@/notebook/ui/NbSheet';
import { PaperPicker } from '@/notebook/ui/PaperPicker';
import { ToggleRow } from '@/notebook/ui/ToggleRow';

export function pdfPaperSkippedText(): string {
  return tr('لا يمكن تغيير ورق صفحات PDF', 'The paper of PDF pages cannot be changed');
}

export interface PagePaperSheetProps {
  visible: boolean;
  /** The paper the picker opens with. */
  initial: PaperSpec;
  /** Pages that will change. */
  count: number;
  /** PDF pages among the targets (left as they are). */
  skippedPdf: number;
  onApply: (paper: PaperSpec, applyToNew: boolean) => void;
  onClose: () => void;
}

export function PagePaperSheet({ visible, initial, count, skippedPdf, onApply, onClose }: PagePaperSheetProps) {
  const [paper, setPaper] = useState<PaperSpec>(initial);
  const [applyToNew, setApplyToNew] = useState(false);

  return (
    <NbSheet
      visible={visible}
      title={tr('تغيير الورق', 'Change paper')}
      subtitle={countLabel(count, 'page', getLang())}
      onClose={onClose}
      width={560}
      footer={
        <PillButton label={tr('تطبيق', 'Apply')} icon="check" block onPress={() => onApply(paper, applyToNew)} disabled={count === 0} />
      }>
      <View style={styles.body}>
        {skippedPdf > 0 ? <InfoBanner tone="info" icon="info" text={pdfPaperSkippedText()} /> : null}
        <PaperPicker value={paper} onChange={setPaper} />
        <ToggleRow
          title={tr('تطبيق على الصفحات الجديدة', 'Use for new pages')}
          subtitle={tr('تأخذ الصفحات التي تضيفها لاحقاً هذا الورق', 'Pages you add later get this paper')}
          icon="layers"
          value={applyToNew}
          onChange={setApplyToNew}
        />
      </View>
    </NbSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 18 },
});
