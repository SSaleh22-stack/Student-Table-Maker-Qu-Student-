/**
 * The toolbar's record control (NB-60, Figma 06 and 10).
 *
 * - Idle: a mic in a dangerSoft circle.
 * - Recording this notebook: a red pill with a white dot, the timer, pause and stop (Figma 10).
 *   Paused: the dot dims and pause becomes resume.
 * - start() results: 'low-storage' shows LowStorageWarning (kind 'record') and 'متابعة' retries with
 *   ignoreLowStorage; 'blocked' shows RecordPermissionSheet; the rest show a toast. A successful
 *   start shows 'الشاشة تبقى مضاءة أثناء التسجيل' (Figma 10).
 * No tour target here: the editor wraps this control in its 'ed.record' target.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { ltr, row } from '@/lib/rtl';
import type { StartResult } from '@/notebook/contracts/audio';
import type { NotebookSession } from '@/notebook/core/session/types';
import { durationLabel } from '@/notebook/core/text/labels';
import { nbColors } from '@/notebook/theme';
import { useIsCompact } from '@/notebook/ui/layout';
import { LowStorageWarning } from '@/notebook/ui/LowStorageWarning';
import { showToast } from '@/notebook/ui/toast';

import { RecordPermissionSheet } from './RecordPermissionSheet';
import { useRecording } from './useRecording';

export interface RecordButtonProps {
  session: NotebookSession;
  style?: StyleProp<ViewStyle>;
}

/** The toast after start(): the keep-awake note on success, a short reason on failure (the low-storage and blocked results open dialogs instead). */
function reportStart(r: StartResult): void {
  if (r.ok) {
    showToast({ text: tr('الشاشة تبقى مضاءة أثناء التسجيل', 'The screen stays on while recording'), tone: 'info', id: 'nb-recording-awake' });
    return;
  }
  if (r.reason === 'low-storage' || r.reason === 'blocked') return;
  const text =
    r.reason === 'denied'
      ? tr('لم يُسمح باستخدام الميكروفون', 'Microphone access was not allowed')
      : r.reason === 'busy'
        ? tr('يجري تسجيل في مذكرة أخرى', 'Another notebook is recording')
        : tr('تعذّر بدء التسجيل', 'Could not start recording');
  showToast({ text, tone: 'warn', id: 'nb-recording-error' });
}

export function RecordButton({ session, style }: RecordButtonProps) {
  const rec = useRecording();
  const compact = useIsCompact();
  const [lowFree, setLowFree] = useState<number | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  const mine = rec.notebookId === session.id;
  const st = mine ? rec.state : 'idle';
  const live = st === 'recording' || st === 'paused' || st === 'pausedByLeave' || st === 'stopping';
  const waiting = busy || st === 'starting';

  const start = async (ignoreLowStorage: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await rec.start(session, { ignoreLowStorage });
      if (!r.ok && r.reason === 'low-storage') setLowFree(r.freeBytes);
      else if (!r.ok && r.reason === 'blocked') setBlocked(true);
      reportStart(r);
    } catch {
      reportStart({ ok: false, reason: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    try {
      await rec.stop();
      showToast({ text: tr('حُفظ التسجيل', 'Recording saved'), tone: 'ok', id: 'nb-recording-saved' });
    } catch {
      showToast({ text: tr('تعذّر إنهاء التسجيل', 'Could not stop the recording'), tone: 'warn', id: 'nb-recording-error' });
    }
  };

  const dialogs = (
    <>
      {lowFree !== null ? (
        <LowStorageWarning
          freeBytes={lowFree}
          kind="record"
          onCancel={() => setLowFree(null)}
          onContinue={() => {
            setLowFree(null);
            void start(true);
          }}
        />
      ) : null}
      <RecordPermissionSheet visible={blocked} onClose={() => setBlocked(false)} />
    </>
  );

  if (!live) {
    const d = compact ? 36 : 40;
    return (
      <View style={style}>
        <Pressable
          onPress={() => void start(false)}
          disabled={waiting}
          hitSlop={(44 - d) / 2}
          accessibilityRole="button"
          accessibilityLabel={tr('بدء تسجيل المحاضرة', 'Record the lecture')}
          accessibilityState={{ disabled: waiting, busy: waiting }}
          style={({ pressed }) => [styles.mic, { width: d, height: d, borderRadius: d / 2 }, pressed && styles.pressed]}>
          {waiting ? <ActivityIndicator size="small" color={nbColors.danger} /> : <Icon name="mic" size={compact ? 18 : 20} color={nbColors.danger} />}
        </Pressable>
        {dialogs}
      </View>
    );
  }

  const paused = st === 'paused' || st === 'pausedByLeave';
  const time = durationLabel(rec.elapsedMs);
  return (
    <View style={style}>
      <View style={[styles.pill, { flexDirection: row }]}>
        <View style={[styles.dot, paused && styles.dotPaused]} />
        <AppText
          size={14}
          weight="bold"
          color={nbColors.white}
          style={styles.time}
          accessibilityLabel={(paused ? tr('التسجيل متوقف مؤقتاً، ', 'Recording paused, ') : tr('يجري التسجيل، ', 'Recording, ')) + time}>
          {ltr(time)}
        </AppText>
        <Pressable
          onPress={() => (paused ? void rec.resume().catch(() => {}) : rec.pause())}
          disabled={st === 'stopping'}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={paused ? tr('متابعة التسجيل', 'Continue recording') : tr('إيقاف التسجيل مؤقتاً', 'Pause recording')}
          style={({ pressed }) => [styles.small, pressed && styles.pressed]}>
          <Icon name={paused ? 'playSolid' : 'pause'} size={14} color={nbColors.white} filled />
        </Pressable>
        <Pressable
          onPress={() => void stop()}
          disabled={st === 'stopping'}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={tr('إنهاء التسجيل', 'Stop recording')}
          style={({ pressed }) => [styles.small, pressed && styles.pressed]}>
          {st === 'stopping' ? <ActivityIndicator size="small" color={nbColors.white} /> : <Icon name="stop" size={14} color={nbColors.white} filled />}
        </Pressable>
      </View>
      {dialogs}
    </View>
  );
}

const styles = StyleSheet.create({
  mic: { backgroundColor: nbColors.dangerSoft, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.75 },
  pill: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 40,
    borderRadius: 999,
    backgroundColor: nbColors.danger,
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: nbColors.white },
  dotPaused: { opacity: 0.45 },
  time: { fontVariant: ['tabular-nums'], minWidth: 40 },
  small: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
});
