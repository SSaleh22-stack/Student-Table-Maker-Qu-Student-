/**
 * The share and export sheet (Figma 14 'مشاركة وتصدير', NB-70, NB-71, NB-72, NB-74).
 *
 * An NbModal: the 620 pt card on tablets, a full-height bottom sheet with a sticky footer on phones.
 * Three radio cards, in the Figma order:
 * - 'ملف PDF مع الكتابة' (exportPdf): the ink as vectors on the pages, the original PDF text stays
 *   selectable. Its pages: chips 'كل الصفحات', 'الصفحة الحالية' and 'نطاق'. Choosing 'نطاق' shows
 *   two steppers 'من' and 'إلى' over 1..N (from <= to is kept by core/export/pageRange) and the chip
 *   reads 'نطاق: 2 – 5'.
 * - 'الصفحة كصورة PNG' (exportPagePng): the page on screen at 3x.
 * - 'ملف المذكرة القابل للتعديل' (exportQunote). When the notebook has recordings the card shows the
 *   'تضمين التسجيلات' switch with both sizes ('مع التسجيلات 48.6 ميجابايت · بدونها 6.2 ميجابايت'),
 *   from estimateQunoteSize over the page files on disk (estimateQunoteForSession).
 *
 * 'مشاركة' prepares the file with a progress bar and an 'إلغاء' button, then opens the system share
 * sheet (shareFile, P04U, which deletes the cache file afterwards) anchored at the button on iPad,
 * and closes the sheet when the share sheet is done. Cancel aborts a PDF export between pages; a PNG
 * or .qunote that is already being written is discarded when it arrives. Errors are shown inline
 * (a toast would sit under the modal).
 *
 * Mounted by the editor (P29) with the open session and the page on screen; JS runtime only.
 */
import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { tr, useLang } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { QUNOTE_MIME, QUNOTE_UTI, type PageRange } from '@/notebook/contracts/export';
import {
  canStepRange,
  clampSpan,
  rangeChipLabel,
  rangeCount,
  stepRange,
  type PageSpan,
  type RangeEnd,
} from '@/notebook/core/export/pageRange';
import type { NotebookSession } from '@/notebook/core/session/types';
import { bytesLabel, countLabel } from '@/notebook/core/text/labels';
import { estimateQunoteForSession, exportQunote, isQunoteError } from '@/notebook/qunote';
import { useSessionSnapshot } from '@/notebook/store/hooks';
import { CircleButton, InfoBanner, NbChip, NbModal, PillButton, ProgressBar, Toggle, shareFile, useWidthClass, type AnchorRect } from '@/notebook/ui';

import { ExportError, discardExportFile, exportPdf, isExportError } from './pdfExport';
import { exportPagePng } from './pngExport';

export type ExportKind = 'pdf' | 'png' | 'qunote';
type RangeChoice = 'all' | 'current' | 'span';

export interface ExportSheetProps {
  visible: boolean;
  session: NotebookSession | null;
  /** 0-based index of the page on screen ('الصفحة الحالية' and the PNG page). */
  currentIndex: number;
  onClose: () => void;
  /** The card chosen when the sheet opens (default: the last one used in this app run, else PDF). */
  initialKind?: ExportKind;
  /** iPad share-sheet anchor in window coordinates; default: the 'مشاركة' button itself. */
  anchor?: AnchorRect | null;
}

type Phase =
  | { k: 'idle' }
  | { k: 'working'; done: number; total: number }
  | { k: 'sharing' };

/** The card picked last (kept for the next time the sheet opens in this app run). */
let lastKind: ExportKind = 'pdf';

const SHARE_TYPES: Record<ExportKind, { mimeType: string; UTI: string }> = {
  pdf: { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' },
  png: { mimeType: 'image/png', UTI: 'public.png' },
  qunote: { mimeType: QUNOTE_MIME, UTI: QUNOTE_UTI },
};

/** The message shown when preparing or sharing the file failed. */
function errorText(e: unknown): string {
  if (isExportError(e)) {
    if (e.code === 'no-space') return tr('لا توجد مساحة كافية على الجهاز لتجهيز الملف.', 'There is not enough space on the device to prepare the file.');
    if (e.code === 'empty') return tr('لا توجد صفحات لتصديرها.', 'There are no pages to export.');
    if (e.code === 'unsupported') return tr('التصدير غير متاح على هذا الجهاز.', 'Export is not available on this device.');
  }
  if (isQunoteError(e)) {
    if (e.code === 'no-space') return tr('لا توجد مساحة كافية على الجهاز لتجهيز الملف.', 'There is not enough space on the device to prepare the file.');
    if (e.code === 'too-large') return tr('المذكرة أكبر من 4 جيجابايت، فلا يمكن مشاركتها كملف واحد.', 'The notebook is larger than 4 GB, so it cannot be shared as one file.');
    if (e.code === 'read-only')
      return tr('أُنشئت هذه المذكرة بإصدار أحدث من التطبيق. حدّث التطبيق لمشاركتها.', 'This notebook was made with a newer version of the app. Update the app to share it.');
  }
  if (e instanceof Error && e.message === 'sharing-unavailable') return tr('المشاركة غير متاحة على هذا الجهاز.', 'Sharing is not available on this device.');
  return tr('تعذّر تجهيز الملف. حاول مرة أخرى.', 'The file could not be prepared. Please try again.');
}

function isAbort(e: unknown): boolean {
  return isExportError(e) && e.code === 'aborted';
}

// ===== parts

interface OptionCardProps {
  icon: IconName;
  title: string;
  subtitle: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  children?: ReactNode;
}

/** A Figma 14 option card: icon tile, title and subtitle, the radio ring at the end; extra content under it while selected. */
function OptionCard({ icon, title, subtitle, selected, disabled, onPress, children }: OptionCardProps) {
  return (
    <View style={[styles.card, selected ? styles.cardOn : null, disabled && !selected ? styles.dim : null]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="radio"
        accessibilityLabel={`${title}، ${subtitle}`}
        accessibilityState={{ checked: selected, selected, disabled }}
        style={({ pressed }) => [styles.cardLine, { flexDirection: row }, pressed && !selected ? styles.pressed : null]}>
        <View style={[styles.tile, { backgroundColor: selected ? colors.accent : colors.accentTint }]}>
          <Icon name={icon} size={22} color={selected ? '#FFFFFF' : colors.accent} />
        </View>
        <View style={styles.cardText}>
          <AppText size={17} weight="bold">
            {title}
          </AppText>
          <AppText size={13} color={colors.faint}>
            {subtitle}
          </AppText>
        </View>
        <View style={[styles.ring, { borderColor: selected ? colors.accent : colors.borderStrong }]}>
          {selected ? <View style={styles.dot} /> : null}
        </View>
      </Pressable>
      {selected && children ? <View style={styles.cardExtra}>{children}</View> : null}
    </View>
  );
}

interface StepperProps {
  label: string;
  value: number;
  canDown: boolean;
  canUp: boolean;
  disabled: boolean;
  onStep: (delta: number) => void;
}

/** 'من' / 'إلى': minus, the page number, plus (mirrored in Arabic like the system stepper). */
function Stepper({ label, value, canDown, canUp, disabled, onStep }: StepperProps) {
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment' && canUp) onStep(1);
    if (e.nativeEvent.actionName === 'decrement' && canDown) onStep(-1);
  };
  return (
    <View
      style={[styles.stepper, { flexDirection: row }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: String(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAction}>
      <AppText size={14} weight="semibold" color={colors.muted} style={styles.stepLabel}>
        {label}
      </AppText>
      <View style={[styles.stepControls, { flexDirection: row }]}>
        <CircleButton icon="minus" label={tr(`${label}: صفحة أقل`, `${label}: previous page`)} size={36} iconSize={16} tone="muted" disabled={disabled || !canDown} onPress={() => onStep(-1)} />
        <AppText size={17} weight="bold" align="center" style={styles.stepValue}>
          {String(value)}
        </AppText>
        <CircleButton icon="plus" label={tr(`${label}: صفحة أكثر`, `${label}: next page`)} size={36} iconSize={16} tone="muted" disabled={disabled || !canUp} onPress={() => onStep(1)} />
      </View>
    </View>
  );
}

// ===== the sheet

export function ExportSheet({ visible, session, currentIndex, onClose, initialKind, anchor }: ExportSheetProps) {
  const lang = useLang();
  const compact = useWidthClass() === 'compact';
  const snap = useSessionSnapshot(visible ? session : null);
  // While the modal fades out (visible false, no subscription) it keeps showing the last notebook,
  // so the title and the recordings row do not vanish mid-animation.
  const [held, setHeld] = useState<{ session: NotebookSession; nb: NonNullable<typeof snap>['notebook'] } | null>(null);
  if (snap && session && (held?.nb !== snap.notebook || held.session !== session)) setHeld({ session, nb: snap.notebook });
  const nb = snap?.notebook ?? (held && held.session === session ? held.nb : null);
  const pageCount = nb?.pageIds.length ?? 0;
  const current = Math.min(Math.max(0, pageCount - 1), Math.max(0, Math.round(currentIndex) || 0));
  const hasRecordings = (nb?.recordings.length ?? 0) > 0;

  const [kind, setKind] = useState<ExportKind>(initialKind ?? lastKind);
  const [rangeChoice, setRangeChoice] = useState<RangeChoice>('all');
  const [rawSpan, setSpan] = useState<PageSpan>({ from: 1, to: 1 });
  const [includeRecordings, setIncludeRecordings] = useState(true);
  const [sizes, setSizes] = useState<{ session: NotebookSession; withRecordings: number; withoutRecordings: number } | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [openSeen, setOpenSeen] = useState(false);

  // Fresh state each time the sheet opens (adjusted while rendering, not in an effect). The range
  // starts at the page on screen and runs to the end; later page turns do not move it.
  if (visible !== openSeen) {
    setOpenSeen(visible);
    if (visible) {
      setKind(initialKind ?? lastKind);
      setRangeChoice('all');
      setSpan(clampSpan({ from: current + 1, to: Math.max(1, pageCount) }, pageCount));
      setPhase({ k: 'idle' });
      setError(null);
      setIncludeRecordings(true);
    }
  }
  // Always inside 1..N, also when pages are added or deleted while the sheet is open.
  const span = clampSpan(rawSpan, pageCount);

  /** Bumped by every start, cancel and close: a result from an older run is discarded. */
  const runRef = useRef(0);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const shareBtnRef = useRef<ComponentRef<typeof View>>(null);

  // Closing the sheet drops whatever is still being prepared.
  useEffect(() => {
    if (visible) return;
    runRef.current += 1;
    abortRef.current.aborted = true;
  }, [visible]);

  // NB-74: both sizes, only when there are recordings (re-read when the recordings change).
  const recCount = nb?.recordings.length ?? 0;
  useEffect(() => {
    if (!visible || !session || recCount === 0) return;
    let live = true;
    estimateQunoteForSession(session).then(
      (r) => {
        if (live) setSizes({ session, ...r });
      },
      () => {
        if (live) setSizes(null);
      },
    );
    return () => {
      live = false;
    };
  }, [visible, session, recCount]);
  const shownSizes = hasRecordings && sizes && sizes.session === session ? sizes : null;

  // Leaving the editor mid-export: stop and drop the result.
  useEffect(
    () => () => {
      runRef.current += 1;
      abortRef.current.aborted = true;
    },
    [],
  );

  const busy = phase.k !== 'idle';

  const pickKind = useCallback((k: ExportKind) => {
    lastKind = k;
    setKind(k);
    setError(null);
  }, []);

  const step = useCallback(
    (end: RangeEnd, delta: number) => setSpan((s) => stepRange(s, end, delta, pageCount)),
    [pageCount],
  );

  const range: PageRange = rangeChoice === 'span' ? { from: span.from, to: span.to } : rangeChoice;
  const pdfPages = rangeCount(range, pageCount, current);

  const measureAnchor = (): Promise<AnchorRect | undefined> =>
    new Promise((resolve) => {
      if (anchor) {
        resolve(anchor);
        return;
      }
      const node = shareBtnRef.current;
      if (!node) {
        resolve(undefined);
        return;
      }
      const timer = setTimeout(() => resolve(undefined), 600);
      node.measureInWindow((x, y, width, height) => {
        clearTimeout(timer);
        resolve(width > 0 && height > 0 ? { x, y, width, height } : undefined);
      });
    });

  const start = async () => {
    if (!session || busy || pageCount === 0) return;
    const run = ++runRef.current;
    const stale = () => run !== runRef.current;
    // The iPad popover anchor: measured now, while the 'مشاركة' button is still on screen. A second
    // tap meanwhile makes this run stale, so only one export starts.
    const at = await measureAnchor();
    if (stale()) return;
    const signal = { aborted: false };
    abortRef.current = signal;
    const chosen = kind;
    setError(null);
    setPhase({ k: 'working', done: 0, total: 0 });
    const progress = (done: number, total: number) => {
      if (!stale()) setPhase({ k: 'working', done, total });
    };

    let uri: string;
    try {
      if (chosen === 'pdf') {
        uri = await exportPdf(session, { range, currentIndex: current, onProgress: progress, signal });
      } else if (chosen === 'png') {
        const pageId = session.notebook.pageIds[current];
        if (!pageId) throw new ExportError('empty');
        uri = await exportPagePng(session, pageId);
      } else {
        uri = (await exportQunote(session, { includeRecordings: hasRecordings && includeRecordings, onProgress: progress })).uri;
      }
    } catch (e) {
      if (stale() || isAbort(e)) return;
      if (__DEV__) console.warn('[ExportSheet] export failed', e);
      setPhase({ k: 'idle' });
      setError(errorText(e));
      return;
    }

    if (stale()) {
      discardExportFile(uri);
      return;
    }
    setPhase({ k: 'sharing' });
    try {
      await shareFile(uri, { ...SHARE_TYPES[chosen], dialogTitle: tr('مشاركة', 'Share'), anchor: at });
    } catch (e) {
      if (stale()) return;
      setPhase({ k: 'idle' });
      setError(errorText(e));
      return;
    }
    if (stale()) return;
    setPhase({ k: 'idle' });
    onClose();
  };

  const cancel = () => {
    runRef.current += 1;
    abortRef.current.aborted = true;
    setPhase({ k: 'idle' });
  };

  // ===== labels

  const sizeLine = shownSizes
    ? tr(
        `مع التسجيلات ${bytesLabel(shownSizes.withRecordings, 'ar')} · بدونها ${bytesLabel(shownSizes.withoutRecordings, 'ar')}`,
        `With recordings ${bytesLabel(shownSizes.withRecordings, 'en')} · without ${bytesLabel(shownSizes.withoutRecordings, 'en')}`,
      )
    : null;

  const spanChip = rangeChoice === 'span' ? rangeChipLabel(span, lang) : tr('نطاق', 'Range');

  const progressLabel = ((): string => {
    if (phase.k === 'sharing') return tr('جارٍ فتح المشاركة…', 'Opening the share sheet…');
    if (phase.k !== 'working') return '';
    if (kind === 'pdf') {
      const pages = Math.max(0, phase.total - 1);
      if (pages === 0) return tr('جارٍ التصدير…', 'Exporting…');
      if (phase.done < pages) return tr(`جارٍ التصدير… ${phase.done} من ${pages} صفحة`, `Exporting… ${phase.done} of ${pages} pages`);
      return tr('جارٍ حفظ الملف…', 'Saving the file…');
    }
    if (kind === 'png') return tr('جارٍ تجهيز الصورة…', 'Preparing the image…');
    return tr('جارٍ تجهيز ملف المذكرة…', 'Preparing the notebook file…');
  })();

  const fraction = phase.k === 'working' && phase.total > 0 ? Math.min(1, phase.done / phase.total) : phase.k === 'sharing' ? 1 : 0;
  const percent = phase.k === 'working' && phase.total > 0 ? `${Math.round(fraction * 100)}%` : null;

  const footer = busy ? (
    <View style={styles.progressBox}>
      <View style={[styles.progressHead, { flexDirection: row }]}>
        <AppText size={14} weight="semibold" color={colors.accentDark} style={styles.flex} accessibilityLiveRegion="polite">
          {progressLabel}
        </AppText>
        {percent ? (
          <AppText size={14} weight="bold" color={colors.accentDark}>
            {percent}
          </AppText>
        ) : null}
      </View>
      <ProgressBar value={fraction} label={progressLabel} />
      {phase.k === 'working' ? <PillButton label={tr('إلغاء', 'Cancel')} variant="neutral" block onPress={cancel} /> : null}
    </View>
  ) : (
    <View ref={shareBtnRef} collapsable={false}>
      <PillButton label={tr('مشاركة', 'Share')} icon="share" block disabled={!session || pageCount === 0} onPress={() => void start()} />
    </View>
  );

  return (
    <NbModal
      visible={visible}
      title={tr('مشاركة وتصدير', 'Share and export')}
      subtitle={nb?.title || undefined}
      onClose={onClose}
      dismissable={!busy}
      footer={footer}>
      <View style={[styles.cards, compact ? styles.cardsCompact : null]} accessibilityRole="radiogroup" accessibilityLabel={tr('نوع الملف', 'File type')}>
        <OptionCard
          icon="fileText"
          title={tr('ملف PDF مع الكتابة', 'PDF with your writing')}
          subtitle={tr('الكتابة تُرسم على الصفحات، ونص ملفات PDF الأصلية يبقى قابلاً للتحديد', 'Your writing is drawn on the pages, and the text of the original PDFs stays selectable')}
          selected={kind === 'pdf'}
          disabled={busy}
          onPress={() => pickKind('pdf')}
        />
        <OptionCard
          icon="image"
          title={tr('الصفحة كصورة PNG', 'Page as a PNG image')}
          subtitle={tr('الصفحة الحالية بدقة عالية', 'The current page in high resolution')}
          selected={kind === 'png'}
          disabled={busy}
          onPress={() => pickKind('png')}
        />
        <OptionCard
          icon="notebookPen"
          title={tr('ملف المذكرة القابل للتعديل', 'Editable notebook file')}
          subtitle={tr('بصيغة qunote — يفتحه زميلك في تطبيق QU Student ويكمل الكتابة', 'A .qunote file — a classmate opens it in QU Student and keeps writing')}
          selected={kind === 'qunote'}
          disabled={busy}
          onPress={() => pickKind('qunote')}>
          {hasRecordings ? (
            <>
              <View style={styles.divider} />
              <Pressable
                onPress={() => setIncludeRecordings((v) => !v)}
                disabled={busy}
                accessibilityRole="switch"
                accessibilityLabel={sizeLine ? `${tr('تضمين التسجيلات', 'Include recordings')}، ${sizeLine}` : tr('تضمين التسجيلات', 'Include recordings')}
                accessibilityState={{ checked: includeRecordings, disabled: busy }}
                style={[styles.recRow, { flexDirection: row }]}>
                <View style={styles.flex}>
                  <AppText size={15} weight="semibold">
                    {tr('تضمين التسجيلات', 'Include recordings')}
                  </AppText>
                  {sizeLine ? (
                    <AppText size={13} color={colors.faint}>
                      {sizeLine}
                    </AppText>
                  ) : null}
                </View>
                <Toggle value={includeRecordings} disabled={busy} />
              </Pressable>
            </>
          ) : null}
        </OptionCard>
      </View>

      {kind === 'pdf' ? (
        <View style={styles.pages}>
          <AppText size={14} weight="semibold" color={colors.muted}>
            {tr('الصفحات', 'Pages')}
          </AppText>
          <View style={[styles.chips, { flexDirection: row }]} accessibilityRole="radiogroup" accessibilityLabel={tr('الصفحات', 'Pages')}>
            <NbChip label={tr('كل الصفحات', 'All pages')} selected={rangeChoice === 'all'} disabled={busy} onPress={() => setRangeChoice('all')} />
            <NbChip label={tr('الصفحة الحالية', 'Current page')} selected={rangeChoice === 'current'} disabled={busy} onPress={() => setRangeChoice('current')} />
            <NbChip label={spanChip} selected={rangeChoice === 'span'} disabled={busy || pageCount === 0} onPress={() => setRangeChoice('span')} />
          </View>
          {rangeChoice === 'span' ? (
            <View style={[styles.steppers, { flexDirection: row }]}>
              <Stepper
                label={tr('من', 'From')}
                value={span.from}
                canDown={canStepRange(span, 'from', -1, pageCount)}
                canUp={canStepRange(span, 'from', 1, pageCount)}
                disabled={busy}
                onStep={(d) => step('from', d)}
              />
              <Stepper
                label={tr('إلى', 'To')}
                value={span.to}
                canDown={canStepRange(span, 'to', -1, pageCount)}
                canUp={canStepRange(span, 'to', 1, pageCount)}
                disabled={busy}
                onStep={(d) => step('to', d)}
              />
            </View>
          ) : null}
          {pageCount > 1 && rangeChoice !== 'all' ? (
            <AppText size={13} color={colors.faint}>
              {countLabel(pdfPages, 'page', lang)}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {error ? <InfoBanner tone="warn" icon="alert" text={error} onClose={() => setError(null)} /> : null}
    </NbModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Figma 14: the cards sit 20 pt apart, like every block of the modal (18 pt in the compact sheet).
  cards: { gap: 20 },
  cardsCompact: { gap: 18 },
  card: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  cardOn: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentTint },
  dim: { opacity: 0.5 },
  pressed: { backgroundColor: colors.surfaceMuted },
  cardLine: { alignItems: 'center', gap: 12, padding: 16 },
  tile: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 2 },
  ring: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent },
  // 12 pt under the card's main line (Figma gap 12), which already has 16 pt of padding.
  cardExtra: { marginTop: -4, paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  divider: { height: 1, backgroundColor: colors.divider },
  recRow: { alignItems: 'center', gap: 12, minHeight: 44 },
  pages: { gap: 8 },
  chips: { flexWrap: 'wrap', gap: 8 },
  steppers: { flexWrap: 'wrap', gap: 12, marginTop: 4 },
  stepper: {
    flexGrow: 1,
    flexBasis: 200,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stepLabel: { minWidth: 28 },
  stepControls: { alignItems: 'center', gap: 8 },
  stepValue: { minWidth: 36 },
  progressBox: { gap: 10 },
  progressHead: { alignItems: 'center', gap: 8 },
});
