/**
 * The short history under the docked calculator (NB-47a, design calcPanel 'history'): the title
 * 'السجل' with the history icon, a divider, then the latest calculations, newest first. Each row
 * shows the result at the reading start and the expression (one line, as LineIO writes it) at the
 * end. A tap puts that expression back into the calculator.
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { layoutInput } from '@/notebook/core/calc/keys/display';
import type { CalcSetup, MathRow } from '@/notebook/core/calc/types';
import { nbColors } from '@/notebook/theme';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { fonts } from '@/lib/theme';

import { boxText } from './LcdMath';

/** One line of the expression, as LineIO writes it ('cos(60)', '2⌟3+1'). */
export function expressionText(input: MathRow, setup: CalcSetup): string {
  return boxText(layoutInput(input, { ...setup, io: 'LineIO' }, null));
}

export interface CalcHistoryProps {
  history: readonly { input: MathRow; result: string }[];
  setup: CalcSetup;
  onRecall(index: number): void;
  /** Rows shown (newest first). */
  max?: number;
}

export function CalcHistory({ history, setup, onRecall, max = 5 }: CalcHistoryProps) {
  const rows = useMemo(() => {
    const out: { index: number; expr: string; result: string }[] = [];
    for (let i = history.length - 1; i >= 0 && out.length < max; i--) {
      out.push({ index: i, expr: expressionText(history[i].input, setup), result: history[i].result });
    }
    return out;
  }, [history, setup, max]);

  return (
    <View style={styles.wrap}>
      <View style={[styles.title, { flexDirection: row }]}>
        <Icon name="history" size={16} color={nbColors.faint} />
        <AppText size={14} weight="semibold" color={nbColors.faint}>
          {tr('السجل', 'History')}
        </AppText>
      </View>
      <View style={styles.divider} />
      {rows.length === 0 ? (
        <AppText size={13} color={nbColors.placeholder} style={styles.empty}>
          {tr('لا توجد عمليات بعد', 'No calculations yet')}
        </AppText>
      ) : (
        rows.map((r) => (
          <Pressable
            key={r.index}
            onPress={() => onRecall(r.index)}
            accessibilityRole="button"
            accessibilityLabel={`${r.expr} = ${r.result}`}
            accessibilityHint={tr('يعيد العملية إلى الحاسبة', 'Puts the calculation back in the calculator')}
            style={({ pressed }) => [styles.row, { flexDirection: row }, pressed ? styles.pressed : null]}>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.result}>
              {r.result}
            </Text>
            <View style={styles.spacer} />
            <Text allowFontScaling={false} numberOfLines={1} style={styles.expr}>
              {r.expr}
            </Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  title: { alignItems: 'center', gap: 6 },
  divider: { height: 1, backgroundColor: nbColors.divider },
  empty: { paddingHorizontal: 4 },
  row: { alignItems: 'center', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 8, gap: 8 },
  pressed: { backgroundColor: nbColors.surfaceMuted },
  spacer: { flex: 1 },
  result: { fontFamily: fonts.semibold, fontSize: 15, color: nbColors.text, writingDirection: 'ltr', flexShrink: 0, maxWidth: '50%' },
  expr: { fontFamily: fonts.regular, fontSize: 14, color: nbColors.faint, writingDirection: 'ltr', flexShrink: 1 },
});
