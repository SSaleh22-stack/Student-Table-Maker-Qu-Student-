/**
 * Figma 12: back in the app after a leave or an interruption paused the recording (NB-65).
 * 'متابعة التسجيل' continues the SAME recording (onContinue: recorder.resume()), 'إنهاء' ends it
 * (onFinish: recorder.stop()). It renders only while the recorder is 'pausedByLeave', so the editor
 * can mount it unconditionally; the subtitle is the recording title and its length so far.
 */
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { ltr, row } from '@/lib/rtl';
import type { Id } from '@/notebook/core/model';
import { durationLabel } from '@/notebook/core/text/labels';
import { nbColors } from '@/notebook/theme';
import { PillButton } from '@/notebook/ui/CircleButton';
import { useIsCompact } from '@/notebook/ui/layout';

import { useRecordingSnapshot } from './useRecording';

export interface ContinueRecordingBannerProps {
  onContinue: () => void | Promise<void>;
  onFinish: () => void | Promise<void>;
  /**
   * Optional: the notebook this editor shows. When given, the banner shows only for that notebook's
   * recording (a recording of another notebook waiting for its grace stop is not offered here).
   */
  notebookId?: Id;
  style?: StyleProp<ViewStyle>;
}

/** 'تسجيل 1 · 31:08 — يُكمل في نفس التسجيل' */
export function continueSubtitle(title: string, elapsedMs: number): string {
  const time = ltr(durationLabel(elapsedMs));
  return tr(`${title} · ${time} — يُكمل في نفس التسجيل`, `${title} · ${time} — continues in the same recording`);
}

export function ContinueRecordingBanner({ onContinue, onFinish, notebookId, style }: ContinueRecordingBannerProps) {
  const snap = useRecordingSnapshot();
  const compact = useIsCompact();
  const [busy, setBusy] = useState<'continue' | 'finish' | null>(null);
  if (notebookId !== undefined && snap.notebookId !== notebookId) return null;
  if (snap.state !== 'pausedByLeave' && busy === null) return null;

  const run = async (which: 'continue' | 'finish') => {
    if (busy) return;
    setBusy(which);
    try {
      await (which === 'continue' ? onContinue() : onFinish());
    } catch {
      // The recorder stays paused: the banner is still there to try again.
    } finally {
      setBusy(null);
    }
  };

  const title = snap.title ?? tr('التسجيل', 'Recording');
  const buttons = (
    <View style={[styles.buttons, { flexDirection: row }]}>
      <PillButton
        label={tr('متابعة التسجيل', 'Continue recording')}
        icon="mic"
        size="sm"
        loading={busy === 'continue'}
        disabled={busy === 'finish'}
        onPress={() => void run('continue')}
      />
      <PillButton
        label={tr('إنهاء', 'Finish')}
        variant="neutral"
        size="sm"
        loading={busy === 'finish'}
        disabled={busy === 'continue'}
        onPress={() => void run('finish')}
      />
    </View>
  );

  return (
    <View style={[styles.card, compact && styles.cardCompact, style]} accessibilityLiveRegion="polite">
      <View style={[styles.main, { flexDirection: row }]}>
        <View style={styles.tile}>
          <Icon name="pause" size={20} color={nbColors.white} filled />
        </View>
        <View style={styles.text}>
          <AppText size={16} weight="bold" color={nbColors.text}>
            {tr('توقف التسجيل مؤقتاً عند مغادرة التطبيق', 'Recording paused when you left the app')}
          </AppText>
          <AppText size={13} color={nbColors.faint} numberOfLines={2}>
            {continueSubtitle(title, snap.elapsedMs)}
          </AppText>
        </View>
        {compact ? null : buttons}
      </View>
      {compact ? buttons : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: nbColors.warningSoft,
    borderColor: nbColors.warningBorder,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    shadowColor: '#1B2533',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardCompact: { paddingHorizontal: 14 },
  main: { alignItems: 'center', gap: 12 },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: nbColors.warningBar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  buttons: { alignItems: 'center', gap: 10, flexWrap: 'wrap' },
});
