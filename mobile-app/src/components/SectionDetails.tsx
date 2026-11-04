import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { Button, CodeBadge, IconButton, Tag } from '@/components/ui';
import { tr } from '@/lib/i18n';
import {
  activityLabel,
  creditHours,
  formatDays,
  formatExam,
  formatTimeRange,
  getCourseTheme,
  hoursLabel,
  slotsOf,
} from '@/lib/courses';
import { row } from '@/lib/rtl';
import { sectionsClash } from '@/lib/schedule';
import { colors, shadow } from '@/lib/theme';
import type { Course } from '@/lib/types';

interface SectionDetailsProps {
  /** The section to show; kept while the card fades out. */
  section: Course | null;
  visible: boolean;
  /** Chosen sections, to list what this one clashes with. */
  chosen: Course[];
  onClose: () => void;
  onRemove: (section: Course) => void;
}

/** Everything about one section of the timetable, opened by tapping its block. */
export function SectionDetails({ section, visible, chosen, onClose, onRemove }: SectionDetailsProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible && !!section} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={tr('إغلاق التفاصيل', 'Close the details')} />
        {section ? (
          <View style={[styles.card, shadow, { paddingBottom: Math.max(16, insets.bottom + 8) }]} accessibilityViewIsModal>
            <Details section={section} chosen={chosen} onClose={onClose} onRemove={onRemove} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function Details({
  section,
  chosen,
  onClose,
  onRemove,
}: {
  section: Course;
  chosen: Course[];
  onClose: () => void;
  onRemove: (section: Course) => void;
}) {
  const theme = getCourseTheme(section.code);
  const activity = activityLabel(section);
  const slots = slotsOf(section);
  const hours = creditHours(section);
  const exam = formatExam(section.finalExam);
  const clashes = chosen.filter((c) => c.id !== section.id && sectionsClash(section, c));
  // Rooms: one per time slot when the portal gives them, otherwise the section's room.
  const rooms = [...new Set(slots.map((s) => s.location ?? section.location).filter((r): r is string => !!r))];
  if (rooms.length === 0 && section.location) rooms.push(section.location);

  return (
    <>
      <View style={styles.grab} />
      <View style={[styles.head, { flexDirection: row }]}>
        <CodeBadge code={section.code} bg={theme.bg} fg={theme.text} />
        <AppText weight="bold" size={17} style={{ flex: 1 }} numberOfLines={2} accessibilityRole="header">
          {section.name}
        </AppText>
        <IconButton icon="x" label={tr('إغلاق', 'Close')} onPress={onClose} size={36} />
      </View>

      <View style={[styles.tags, { flexDirection: row }]}>
        <Tag label={tr(`الشعبة ${section.section}`, `Section ${section.section}`)} tone="accent" />
        {activity ? <Tag label={activity} tone="muted" /> : null}
        {section.status ? (
          <Tag label={section.status === 'closed' ? tr('مغلقة', 'Closed') : tr('مفتوحة', 'Open')} tone={section.status === 'closed' ? 'danger' : 'ok'} />
        ) : null}
        {hours ? <Tag label={hoursLabel(hours)} tone="muted" /> : null}
      </View>

      {clashes.length > 0 ? (
        <View style={[styles.clash, { flexDirection: row }]}>
          <Icon name="alert" size={16} color={colors.clash} />
          <AppText size={13} weight="semibold" color={colors.clash} style={{ flex: 1 }}>
            {tr('تتعارض مع', 'Clashes with')} {clashes.map((c) => `${c.code} · ${tr('الشعبة', 'section')} ${c.section}`).join(tr('، ', ', '))}
          </AppText>
        </View>
      ) : null}

      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 4 }}>
        <InfoRow icon="clock" label={tr('المواعيد', 'Times')}>
          {slots.length > 0 ? (
            slots.map((s, i) => (
              <AppText key={i} size={14} weight="medium">
                {formatDays(s.days)} · {formatTimeRange(s.startTime, s.endTime)}
              </AppText>
            ))
          ) : (
            <AppText size={14} color={colors.muted}>
              {tr('بدون وقت محدد', 'No set time')}
            </AppText>
          )}
        </InfoRow>
        <InfoRow icon="mapPin" label={tr('القاعة', 'Room')}>
          <AppText size={14} color={rooms.length ? colors.text : colors.muted}>
            {rooms.length ? rooms.join(tr('، ', ', ')) : tr('غير محددة', 'Not set')}
          </AppText>
        </InfoRow>
        <InfoRow icon="user" label={tr('المدرّس', 'Instructor')}>
          <AppText size={14} color={section.instructor ? colors.text : colors.muted}>
            {section.instructor || tr('غير محدد', 'Not set')}
          </AppText>
        </InfoRow>
        <InfoRow icon="fileText" label={tr('فترة الاختبار', 'Exam period')}>
          <AppText size={14} color={exam ? colors.text : colors.muted}>
            {exam ?? tr('غير محددة', 'Not set')}
          </AppText>
        </InfoRow>
        {section.campus ? (
          <InfoRow icon="info" label={tr('المقر', 'Campus')}>
            <AppText size={14}>{section.campus}</AppText>
          </InfoRow>
        ) : null}
      </ScrollView>

      <View style={[styles.actions, { flexDirection: row }]}>
        <Button
          label={tr('إزالة من الجدول', 'Remove from timetable')}
          icon="trash"
          variant="danger"
          onPress={() => onRemove(section)}
          style={{ flex: 1 }}
        />
        <Button label={tr('إغلاق', 'Close')} variant="outline" onPress={onClose} style={{ flex: 1 }} />
      </View>
    </>
  );
}

function InfoRow({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <View style={[styles.info, { flexDirection: row }]}>
      <View style={styles.infoIcon}>
        <Icon name={icon} size={17} color={colors.accentDark} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText size={12} color={colors.muted}>
          {label}
        </AppText>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.35)' },
  card: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '85%',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    gap: 12,
  },
  grab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#CBD5E1', marginTop: 10 },
  head: { alignItems: 'center', gap: 10 },
  tags: { flexWrap: 'wrap', gap: 6 },
  clash: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.clashSoft,
    borderWidth: 1,
    borderColor: colors.clashBorder,
  },
  info: { alignItems: 'flex-start', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  infoIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { gap: 10 },
});
