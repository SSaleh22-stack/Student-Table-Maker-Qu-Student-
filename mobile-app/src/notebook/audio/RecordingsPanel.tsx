/**
 * The notebook's recordings (NB-63, Figma 11 'التسجيلات'): a card with the count, one row per
 * recording ('تسجيل 1' over 'اليوم 10:02 ص · 47:32'), the loaded one highlighted.
 *
 * - Tap a row: onLoad(recordingId) (the editor loads it into the player).
 * - The row's ⋮ menu: rename and delete (RecordingOptions, shared with the PlayerBar's ⋮).
 * - The recording in progress shows 'يُسجَّل الآن' and can be neither loaded nor deleted.
 * Placement (the reading-end side of the editor on tablets, a sheet area on phones) is the editor's.
 */
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { getLang, tr } from '@/lib/i18n';
import { ltr, row } from '@/lib/rtl';
import type { Id, Recording } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { durationLabel, relativeTime } from '@/notebook/core/text/labels';
import { useSessionSnapshot } from '@/notebook/store/hooks';
import { nbColors } from '@/notebook/theme';
import { CircleButton } from '@/notebook/ui/CircleButton';
import { useIsCompact } from '@/notebook/ui/layout';
import type { AnchorRect } from '@/notebook/ui/Popover';

import { RecordingOptions } from './RecordingOptions';
import { usePlaybackSnapshot } from './usePlayback';
import { useRecordingSnapshot } from './useRecording';

export interface RecordingsPanelProps {
  session: NotebookSession;
  onLoad: (recordingId: Id) => void;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
}

const PANEL_W = 264;

/** 'اليوم 10:02 ص · 47:32' */
export function recordingSubtitle(r: Pick<Recording, 'startedAt' | 'durationMs'>, now: number): string {
  const when = relativeTime(r.startedAt, now, getLang());
  return `${when} · ${ltr(durationLabel(r.durationMs))}`;
}

interface RowProps {
  rec: Recording;
  loaded: boolean;
  live: boolean;
  liveMs: number;
  now: number;
  onPress: () => void;
  onMenu: (anchor: AnchorRect) => void;
}

function RecordingRow({ rec, loaded, live, liveMs, now, onPress, onMenu }: RowProps) {
  const moreRef = useRef<ComponentRef<typeof View>>(null);
  const openMenu = () => {
    const node = moreRef.current;
    if (!node) return;
    node.measureInWindow((x, y, width, height) => onMenu({ x, y, width, height }));
  };
  const subtitle = live ? `${tr('يُسجَّل الآن', 'Recording now')} · ${ltr(durationLabel(liveMs))}` : recordingSubtitle(rec, now);
  return (
    <View style={[styles.row, loaded && styles.rowOn, { flexDirection: row }]}>
      <Pressable
        onPress={onPress}
        disabled={live}
        accessibilityRole="button"
        accessibilityLabel={rec.title + tr("، ", ", ") + subtitle}
        accessibilityState={{ selected: loaded, disabled: live }}
        style={({ pressed }) => [styles.rowMain, { flexDirection: row }, pressed && { opacity: 0.7 }]}>
        {live ? <View style={styles.liveDot} /> : null}
        <View style={styles.rowText}>
          <AppText size={15} weight={loaded ? 'bold' : 'medium'} color={loaded ? nbColors.accent : nbColors.text} numberOfLines={1}>
            {rec.title}
          </AppText>
          <AppText size={12} color={live ? nbColors.danger : nbColors.faint} numberOfLines={1}>
            {subtitle}
          </AppText>
        </View>
      </Pressable>
      <View ref={moreRef} collapsable={false}>
        <CircleButton icon="moreV" tone="clear" size={32} iconSize={18} color={nbColors.placeholder} label={tr('خيارات التسجيل', 'Recording options')} onPress={openMenu} />
      </View>
    </View>
  );
}

export function RecordingsPanel({ session, onLoad, onClose, style }: RecordingsPanelProps) {
  const snap = useSessionSnapshot(session);
  const rec = useRecordingSnapshot();
  const play = usePlaybackSnapshot();
  const compact = useIsCompact();

  const [menu, setMenu] = useState<{ id: Id; anchor: AnchorRect } | null>(null);

  const list = snap?.notebook.recordings ?? session.notebook.recordings;
  const liveId = rec.notebookId === session.id && rec.state !== 'idle' ? rec.recordingId : null;
  // The clock for 'اليوم' / 'أمس', read once per mount (the panel is short-lived).
  const [now] = useState(Date.now);

  return (
    <View style={[styles.panel, compact ? styles.panelCompact : { width: PANEL_W }, style]}>
      <View style={[styles.header, { flexDirection: row }]}>
        <AppText size={17} weight="bold" color={nbColors.text} accessibilityRole="header">
          {tr('التسجيلات', 'Recordings')}
        </AppText>
        <View style={styles.spacer} />
        <View style={styles.count}>
          <AppText size={12} weight="semibold" color={nbColors.accentDark}>
            {String(list.length)}
          </AppText>
        </View>
        <CircleButton icon="x" tone="clear" size={32} iconSize={18} label={tr('إغلاق', 'Close')} onPress={onClose} />
      </View>

      {list.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="mic" size={22} color={nbColors.placeholder} />
          <AppText size={14} weight="medium" color={nbColors.muted} align="center">
            {tr('لا توجد تسجيلات بعد', 'No recordings yet')}
          </AppText>
          <AppText size={12} color={nbColors.faint} align="center">
            {tr('اضغط زر الميكروفون في شريط الأدوات لتسجيل المحاضرة أثناء الكتابة.', 'Tap the microphone in the toolbar to record the lecture while you write.')}
          </AppText>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {list.map((r) => (
            <RecordingRow
              key={r.id}
              rec={r}
              loaded={play.recordingId === r.id}
              live={liveId === r.id}
              liveMs={rec.elapsedMs}
              now={now}
              onPress={() => onLoad(r.id)}
              onMenu={(anchor) => setMenu({ id: r.id, anchor })}
            />
          ))}
        </ScrollView>
      )}

      <RecordingOptions session={session} target={menu} onClose={() => setMenu(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: nbColors.surface,
    borderRadius: 22,
    padding: 14,
    gap: 6,
    maxHeight: 460,
    shadowColor: '#1B2533',
    shadowOpacity: 0.1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  panelCompact: { alignSelf: 'stretch' },
  header: { alignItems: 'center', gap: 8, paddingBottom: 4 },
  count: { backgroundColor: nbColors.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  spacer: { flex: 1 },
  list: { flexGrow: 0 },
  listContent: { gap: 6 },
  row: { alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14 },
  rowOn: { backgroundColor: nbColors.accentTint },
  rowMain: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 4 },
  rowText: { flex: 1, gap: 2 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: nbColors.danger },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 18, paddingHorizontal: 8 },
});
