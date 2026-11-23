/**
 * The writing options of the notebook settings (Figma 15 'الكتابة'; NB-50, NB-51, NB-52, NB-T2):
 *
 *   [tablet]    طريقة الكتابة                         بالقلم ›        (InputSheet below)
 *   [pencilTip] النقر المزدوج على Apple Pencil         التبديل إلى الممحاة ›   (iPad only)
 *   [pencilTip] الضغط على Apple Pencil Pro             التبديل إلى الممحاة ›   (iPad only)
 *   [hand]      الرسم بالإصبع / عند توصيل قلم، الإصبع للتمرير فقط       [switch]
 *   [hand]      اليد التي تكتب بها                     اليمنى ›
 *
 * and a second group 'الورق وشريط الأدوات': the default paper (style, color and size, for new
 * notebooks) and the toolbar position chips (top / bottom / right / left).
 *
 * Every control writes only its own settings field through the store's deep merge
 * (setSettings({ hand })). The one exception is 'طريقة الكتابة', which writes input together with
 * fingerDraws (true for 'بالإصبع', false for 'بالقلم'), exactly as the first-time setup does, so the
 * two never disagree ('بالإصبع' with finger drawing off would leave no way to draw).
 */
import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { tr } from '@/lib/i18n';
import { colors } from '@/lib/theme';
import type { NotebookSettings, PaperSpec } from '@/notebook/core/model';
import { useNotebookSettings } from '@/notebook/store/hooks';
import { Group } from '@/notebook/ui/Group';
import { ListRow } from '@/notebook/ui/ListRow';
import { ChipGroup } from '@/notebook/ui/LocationChips';
import { NbSheet } from '@/notebook/ui/NbSheet';
import { PaperPicker } from '@/notebook/ui/PaperPicker';
import { RadioGroup } from '@/notebook/ui/RadioRow';
import { ToggleRow } from '@/notebook/ui/ToggleRow';

import { HandSheet, handLabel } from './HandSheet';
import { PencilActionSheet, pencilActionLabel, pencilGestureTitle, type PencilGesture } from './PencilActionSheet';

type Input = NotebookSettings['input'];
type ToolbarPos = NotebookSettings['toolbarPos'];
type Sheet = 'input' | 'hand' | PencilGesture | null;

/** Apple Pencil works only with an iPad, so its rows show only there. */
const HAS_APPLE_PENCIL = Platform.OS === 'ios' && Platform.isPad;

function inputLabel(i: Input): string {
  return i === 'pen' ? tr('بالقلم', 'With a pen') : tr('بالإصبع', 'With your finger');
}

/** A titled block inside a group, with its control under the labels (paper, toolbar position). */
function FieldBlock({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <View style={styles.blockLabels}>
        <AppText size={16} weight="medium" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? (
          <AppText size={13} color={colors.faint}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function InputSheet({ visible, value, onChange, onClose }: { visible: boolean; value: Input; onChange: (i: Input) => void; onClose: () => void }) {
  const title = tr('طريقة الكتابة', 'How you write');
  return (
    <NbSheet visible={visible} title={title} subtitle={tr('كيف تكتب في المذكرات؟', 'How do you write in your notebooks?')} onClose={onClose}>
      <View style={styles.sheetBody}>
        <RadioGroup<Input>
          label={title}
          options={[
            {
              value: 'pen',
              label: tr('بالقلم', 'With a pen'),
              subtitle: tr(
                'تكتب بقلم آبل أو قلم سامسونج، والإصبع للتمرير والتكبير فقط.',
                'You write with an Apple Pencil or an S Pen; your finger only scrolls and zooms.',
              ),
              icon: 'pencilTip',
            },
            {
              value: 'finger',
              label: tr('بالإصبع', 'With your finger'),
              subtitle: tr(
                'إذا لم يكن معك قلم. اكتب بإصبع واحد وحرّك الصفحة بإصبعين.',
                'If you have no pen. Write with one finger and move the page with two.',
              ),
              icon: 'hand',
            },
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

export function WritingSection() {
  const [settings, setSettings] = useNotebookSettings();
  const [sheet, setSheet] = useState<Sheet>(null);
  const close = () => setSheet(null);

  return (
    <>
      <Group title={tr('الكتابة', 'Writing')}>
        <ListRow
          key="input"
          icon="tablet"
          title={tr('طريقة الكتابة', 'How you write')}
          value={inputLabel(settings.input)}
          chevron
          onPress={() => setSheet('input')}
        />
        {HAS_APPLE_PENCIL ? (
          <ListRow
            key="doubleTap"
            icon="pencilTip"
            title={pencilGestureTitle('doubleTap')}
            value={pencilActionLabel(settings.pencilDoubleTap)}
            chevron
            onPress={() => setSheet('doubleTap')}
          />
        ) : null}
        {HAS_APPLE_PENCIL ? (
          <ListRow
            key="squeeze"
            icon="pencilTip"
            title={pencilGestureTitle('squeeze')}
            value={pencilActionLabel(settings.pencilSqueeze)}
            chevron
            onPress={() => setSheet('squeeze')}
          />
        ) : null}
        <ToggleRow
          key="finger"
          icon="hand"
          title={tr('الرسم بالإصبع', 'Draw with finger')}
          subtitle={tr('عند توصيل قلم، الإصبع للتمرير فقط', 'With a pen connected, your finger only scrolls')}
          value={settings.fingerDraws}
          onChange={(v) => setSettings({ fingerDraws: v })}
        />
        <ListRow
          key="hand"
          icon="hand"
          title={tr('اليد التي تكتب بها', 'Your writing hand')}
          value={handLabel(settings.hand)}
          chevron
          onPress={() => setSheet('hand')}
        />
      </Group>

      <Group title={tr('الورق وشريط الأدوات', 'Paper and toolbar')}>
        <FieldBlock
          key="paper"
          title={tr('الورق الافتراضي', 'Default paper')}
          subtitle={tr('للمذكرات الجديدة، وتستطيع تغييره لكل مذكرة.', 'For new notebooks. You can change it for each notebook.')}>
          <PaperPicker
            value={settings.defaultPaper}
            small
            onChange={(p: PaperSpec) => setSettings({ defaultPaper: { style: p.style, color: p.color, size: p.size } })}
          />
        </FieldBlock>
        <FieldBlock
          key="toolbar"
          title={tr('مكان شريط الأدوات', 'Toolbar position')}
          subtitle={tr('تستطيع نقله لاحقاً بالضغط المطوّل عليه.', 'You can move it later by pressing and holding it.')}>
          <ChipGroup<ToolbarPos>
            label={tr('مكان شريط الأدوات', 'Toolbar position')}
            options={[
              { value: 'top', label: tr('أعلى', 'Top') },
              { value: 'bottom', label: tr('أسفل', 'Bottom') },
              { value: 'right', label: tr('يمين', 'Right') },
              { value: 'left', label: tr('يسار', 'Left') },
            ]}
            value={settings.toolbarPos}
            onChange={(v) => {
              if (v !== settings.toolbarPos) setSettings({ toolbarPos: v });
            }}
          />
        </FieldBlock>
      </Group>

      <InputSheet
        visible={sheet === 'input'}
        value={settings.input}
        onChange={(v) => setSettings({ input: v, fingerDraws: v === 'finger' })}
        onClose={close}
      />
      <PencilActionSheet
        visible={sheet === 'doubleTap'}
        gesture="doubleTap"
        value={settings.pencilDoubleTap}
        onChange={(v) => setSettings({ pencilDoubleTap: v })}
        onClose={close}
      />
      <PencilActionSheet
        visible={sheet === 'squeeze'}
        gesture="squeeze"
        value={settings.pencilSqueeze}
        onChange={(v) => setSettings({ pencilSqueeze: v })}
        onClose={close}
      />
      <HandSheet visible={sheet === 'hand'} value={settings.hand} onChange={(v) => setSettings({ hand: v })} onClose={close} />
    </>
  );
}

const styles = StyleSheet.create({
  block: { paddingHorizontal: 20, paddingVertical: 16, gap: 14 },
  blockLabels: { gap: 2 },
  sheetBody: { paddingVertical: 8 },
});
