/**
 * Figma 05 'استلام ملف PDF' (NB-31, NB-73): a file shared into the app or opened with it.
 *
 * Flow:
 *  1. The stashed files (incoming.ts) are checked against free space (LowStorageWarning,
 *     'متابعة' goes on), then copied into a staging job. ONLY THEN is finishIncoming() called (the
 *     Android share payload is cleared, the iOS Inbox copy deleted). Cancel calls it too.
 *  2. The staged copy is sniffed and inspected: a PDF (pdfEngine.inspect for the page count), a
 *     .qunote (inspectQunote) or images.
 *  3. The card shows the name, the pages and the size (no source app: the system does not say which
 *     app shared the file, see the PRD deviation note). The student chooses 'مذكرة جديدة' (with
 *     LocationChips) or 'إضافة إلى مذكرة موجودة' (NotebookPickerSheet; pages go at the end). A
 *     .qunote is always imported as a copy at a location (NB-73).
 *  4. 'فتح والبدء بالكتابة' imports (progress 'جارٍ الاستيراد… 6 من 24 صفحة') and opens the
 *     notebook in place of this screen; a PDF keeps importing in the background.
 *
 * NbModal: the 620 pt card on tablets, a full sheet on phones. The password prompt and the
 * low-storage dialog render inside it (nested modals).
 */
import { router, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { tr, useLang } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import type { IncomingFile } from '@/notebook/core/contracts/importing';
import { toPdfError } from '@/notebook/core/contracts/pdf';
import { joinPath } from '@/notebook/core/fs/adapter';
import { safeExt } from '@/notebook/core/fs/layout';
import { SNIFF_BYTES, extOfName, sniffKind, titleFromName, type IncomingKind } from '@/notebook/core/importing/sniff';
import type { IndexEntry, LocationKey } from '@/notebook/core/model';
import { bytesLabel, countLabel } from '@/notebook/core/text/labels';
import { openNotebook } from '@/notebook/nav';
import { pdfEngine } from '@/notebook/pdf/engine';
import { importQunote, inspectQunote, isQunoteError } from '@/notebook/qunote';
import { nbFs } from '@/notebook/store/deps';
import { useNotebooks, type NotebooksStore } from '@/notebook/store/hooks';
import { PillButton } from '@/notebook/ui/CircleButton';
import { InfoBanner } from '@/notebook/ui/InfoBanner';
import { LocationChips } from '@/notebook/ui/LocationChips';
import { LowStorageWarning } from '@/notebook/ui/LowStorageWarning';
import { NbModal } from '@/notebook/ui/NbModal';
import { RadioRow } from '@/notebook/ui/RadioRow';
import { useWidthClass } from '@/notebook/ui/layout';

import { defaultImagesTitle, importImages } from './importImages';
import { importFailureText, importStagedPdf, qunoteFailureText, type ImportProgressInfo } from './importPdf';
import { ImportProgress, preparingText, useImportUi } from './ImportProgress';
import { finishIncomingIf, incomingGeneration, takeIncoming } from './incoming';
import { NotebookPickerSheet, pickableNotebooks } from './NotebookPickerSheet';
import type { PickedImage } from './pickPhotos';
import { imageSize } from './scan';

interface Staged {
  path: string;
  name: string;
  size: number;
  mimeType?: string;
  kind: IncomingKind;
}

type Subject =
  | { kind: 'pdf'; file: Staged; pages: number | null }
  | { kind: 'qunote'; file: Staged; title: string; pages: number; bytes: number }
  | { kind: 'images'; files: Staged[] };

type Phase =
  | { k: 'waiting' }
  | { k: 'low-storage'; free: number }
  | { k: 'copying'; bytes: number; total?: number }
  | { k: 'checking' }
  | { k: 'ready' }
  | { k: 'importing' }
  | { k: 'failed'; text: string };

const LIBRARY = '/notebook' as Href;

/** Leaves the screen: back to where the student was, or the library on a cold start. */
function leave(): void {
  if (router.canGoBack()) router.back();
  else router.replace(LIBRARY);
}

function defaultLocation(store: NotebooksStore): LocationKey {
  const course = store.courseFolders.find((c) => c.inTimetable);
  return course ? { kind: 'course', code: course.code } : { kind: 'unfiled' };
}

/** The first PDF or .qunote wins; otherwise every image becomes a page. */
function pickSubject(staged: Staged[]): Subject | null {
  const doc = staged.find((f) => f.kind === 'pdf' || f.kind === 'qunote');
  if (doc?.kind === 'pdf') return { kind: 'pdf', file: doc, pages: null };
  if (doc?.kind === 'qunote') return { kind: 'qunote', file: doc, title: titleFromName(doc.name), pages: 0, bytes: doc.size };
  const images = staged.filter((f) => f.kind === 'image');
  return images.length ? { kind: 'images', files: images } : null;
}

function FieldLabel({ text }: { text: string }) {
  return (
    <AppText size={14} weight="semibold" color={colors.muted}>
      {text}
    </AppText>
  );
}

function FileCard({ subject, lang }: { subject: Subject | null; lang: 'ar' | 'en' }) {
  let icon: IconName = 'fileText';
  let tint: { fg: string; bg: string } = { fg: colors.danger, bg: colors.dangerSoft };
  let name = '';
  const parts: string[] = [];
  if (subject?.kind === 'pdf') {
    name = subject.file.name;
    if (subject.pages) parts.push(countLabel(subject.pages, 'page', lang));
    parts.push(bytesLabel(subject.file.size, lang));
  } else if (subject?.kind === 'qunote') {
    icon = 'notebookPen';
    tint = { fg: colors.accent, bg: colors.accentTint };
    name = subject.title || subject.file.name;
    parts.push(countLabel(subject.pages, 'page', lang));
    parts.push(bytesLabel(subject.bytes, lang));
  } else if (subject?.kind === 'images') {
    icon = 'image';
    tint = { fg: colors.accent, bg: colors.accentTint };
    name = subject.files.length === 1 ? subject.files[0].name : tr('صور', 'Photos');
    parts.push(countLabel(subject.files.length, 'page', lang));
    parts.push(bytesLabel(subject.files.reduce((n, f) => n + f.size, 0), lang));
  } else {
    name = preparingText();
  }
  return (
    <View style={[styles.card, { flexDirection: row }]} accessible accessibilityLabel={[name, ...parts].join('، ')}>
      <View style={[styles.cardIcon, { backgroundColor: tint.bg }]}>
        <Icon name={icon} size={26} color={tint.fg} />
      </View>
      <View style={styles.cardText}>
        <AppText size={16} weight="bold" numberOfLines={2}>
          {name}
        </AppText>
        {parts.length ? (
          <AppText size={13} color={colors.faint}>
            {parts.join(' · ')}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

export function ReceiveScreen() {
  const store = useNotebooks();
  const lang = useLang();
  const compact = useWidthClass() === 'compact';
  const imp = useImportUi();

  // The stash this screen handles (read once; a newer share remounts the route).
  const [files] = useState<IncomingFile[] | null>(() => takeIncoming());
  const genRef = useRef(incomingGeneration());
  const jobRef = useRef<{ id: string; dir: string } | null>(null);
  const finishedRef = useRef(false);
  const leftRef = useRef(false);

  const [phase, setPhase] = useState<Phase>({ k: 'waiting' });
  const [subject, setSubject] = useState<Subject | null>(null);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [location, setLocation] = useState<LocationKey | null>(null);
  const [target, setTarget] = useState<IndexEntry | null>(null);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const finishOnce = async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    await finishIncomingIf(genRef.current).catch(() => {});
  };

  // Nothing to receive (a stale link, a remount after the stash was used): go to the library.
  useEffect(() => {
    if (!files || files.length === 0) router.replace(LIBRARY);
  }, [files]);

  // Leaving by any route (back gesture, Android back, a navigation) ends the staging job and, if
  // the copy never happened, finishes the incoming files the way a cancel would.
  useEffect(
    () => () => {
      // A copy still running stops at its next step and ends a staging job it creates late.
      leftRef.current = true;
      const job = jobRef.current;
      jobRef.current = null;
      if (job) void store.endStagingJob(job.id).catch(() => {});
      if (!finishedRef.current) {
        finishedRef.current = true;
        void finishIncomingIf(genRef.current).catch(() => {});
      }
    },
    // The store's methods are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Step 2: copy into staging, finish the incoming files, then look at what was received.
  const copyAll = async () => {
    if (!files) return;
    const total = files.reduce((n, f) => n + (f.size ?? 0), 0) || undefined;
    setPhase({ k: 'copying', bytes: 0, total });
    let job: { id: string; dir: string };
    try {
      job = await store.stagingJob();
    } catch {
      // Nothing was copied: the incoming files stay until the student cancels (or leaves).
      setPhase({ k: 'failed', text: importFailureText('io') ?? '' });
      return;
    }
    if (leftRef.current) {
      await store.endStagingJob(job.id).catch(() => {});
      return;
    }
    jobRef.current = job;
    const staged: Staged[] = [];
    let base = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ext = safeExt(extOfName(f.name) || 'bin');
      const dest = joinPath(job.dir, `in-${i}.${ext}`);
      try {
        await nbFs.copy(f.uri, dest, (n) => setPhase({ k: 'copying', bytes: base + n, total }));
        const size = await nbFs.size(dest);
        base += size;
        let head: Uint8Array = new Uint8Array(0);
        try {
          head = await nbFs.readBytes(dest, 0, SNIFF_BYTES);
        } catch {
          // Sniffed by name.
        }
        staged.push({ path: dest, name: f.name || `${tr('ملف', 'File')}.${ext}`, size, ...(f.mimeType ? { mimeType: f.mimeType } : {}), kind: sniffKind(head, f.name, f.mimeType) });
      } catch {
        // This file could not be read; the others may still be fine.
      }
      if (leftRef.current) return;
    }
    if (!staged.length) {
      // No copy succeeded: the incoming files stay until the student cancels (or leaves).
      setPhase({ k: 'failed', text: importFailureText('io') ?? '' });
      return;
    }
    // The copies are safe in staging: only now may the share payload and the Inbox copy go.
    await finishOnce();
    const s = pickSubject(staged);
    if (!s) {
      setPhase({ k: 'failed', text: importFailureText('not-pdf') ?? '' });
      return;
    }
    setPhase({ k: 'checking' });
    await inspect(s);
  };

  const inspect = async (s: Subject) => {
    if (s.kind === 'pdf') {
      if (!pdfEngine.available) {
        setSubject(s);
        setPhase({ k: 'failed', text: importFailureText('no-native') ?? '' });
        return;
      }
      try {
        const info = await pdfEngine.inspect(s.file.path);
        setSubject({ ...s, pages: info.needsPassword ? null : info.pageCount || null });
        if (!info.needsPassword && info.pageCount <= 0) {
          setPhase({ k: 'failed', text: importFailureText('damaged') ?? '' });
          return;
        }
      } catch (e) {
        setSubject(s);
        setPhase({ k: 'failed', text: importFailureText(toPdfError(e, 'damaged').code) ?? '' });
        return;
      }
      setPhase({ k: 'ready' });
      return;
    }
    if (s.kind === 'qunote') {
      try {
        const info = await inspectQunote(s.file.path);
        if ('error' in info) {
          setSubject(s);
          setPhase({ k: 'failed', text: qunoteFailureText(info.error) });
          return;
        }
        setSubject({ ...s, title: info.title, pages: info.pageCount, bytes: info.bytes });
      } catch {
        setSubject(s);
        setPhase({ k: 'failed', text: qunoteFailureText('damaged') });
        return;
      }
      setPhase({ k: 'ready' });
      return;
    }
    // Images: the bytes must be an image the app can decode.
    const ok = s.files.filter((f) => f.kind === 'image');
    setSubject({ kind: 'images', files: ok });
    setPhase(ok.length ? { k: 'ready' } : { k: 'failed', text: importFailureText('not-pdf', 'image') ?? '' });
  };

  // Step 1: free space, once the store is loaded.
  const begin = async () => {
    if (!files?.length) return;
    const total = files.reduce((n, f) => n + (f.size ?? 0), 0);
    const low = store.isLowStorage(total);
    if (low.low) setPhase({ k: 'low-storage', free: low.freeBytes });
    else await copyAll();
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !files?.length || !store.loaded) return;
    started.current = true;
    void begin();
    // begin reads the latest state; it runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.loaded, files]);

  const cancel = () => {
    if (phase.k === 'importing') return;
    leftRef.current = true;
    const job = jobRef.current;
    jobRef.current = null;
    if (job) void store.endStagingJob(job.id).catch(() => {});
    void finishOnce();
    leave();
  };

  const done = (id: string) => {
    leftRef.current = true;
    const job = jobRef.current;
    jobRef.current = null;
    if (job) void store.endStagingJob(job.id).catch(() => {});
    openNotebook(id, { replace: true });
  };

  const onProgress = (p: ImportProgressInfo) => imp.ui.onProgress?.(p);

  // An unexpected throw must never leave the sheet stuck in 'importing' (it cannot be closed then).
  const start = () =>
    runImport().catch(() => {
      if (leftRef.current) return;
      setNotice(importFailureText('io'));
      setPhase({ k: 'ready' });
    });

  const runImport = async () => {
    const job = jobRef.current;
    if (!subject || !job || phase.k !== 'ready') return;
    const loc = location ?? defaultLocation(store);
    if (mode === 'existing' && !target && subject.kind !== 'qunote') {
      setPicking(true);
      return;
    }
    setNotice(null);
    imp.resetProgress();
    setPhase({ k: 'importing' });

    if (subject.kind === 'qunote') {
      try {
        const id = await importQunote(subject.file.path, { location: loc, mode: 'copy' });
        done(id);
      } catch (e) {
        if (isQunoteError(e)) setPhase({ k: 'failed', text: qunoteFailureText(e.code) });
        else {
          setNotice(importFailureText('io'));
          setPhase({ k: 'ready' });
        }
      }
      return;
    }

    const toExisting = mode === 'existing' && target;
    let session = null;
    if (toExisting) {
      try {
        session = await store.openSession(target.id);
      } catch {
        setNotice(tr('تعذّر فتح المذكرة المختارة', 'The chosen notebook could not be opened'));
        setPhase({ k: 'ready' });
        return;
      }
    }
    try {
      const at = session ? session.notebook.pageIds.length : 0;
      const tgt = session ? { session, at } : { location: loc };
      let r;
      if (subject.kind === 'pdf') {
        r = await importStagedPdf(subject.file.path, job.dir, {
          name: subject.file.name,
          target: tgt,
          askPassword: imp.ui.askPassword,
          passwordDone: imp.ui.passwordDone,
          onProgress,
        });
      } else {
        const images: PickedImage[] = [];
        for (const f of subject.files) {
          const s = await imageSize(f.path);
          images.push({ uri: f.path, width: s.width, height: s.height, name: f.name, size: f.size, ...(f.mimeType ? { mimeType: f.mimeType } : {}) });
        }
        const first = subject.files.length === 1 ? titleFromName(subject.files[0].name) : '';
        r = await importImages(images, tgt, { origin: 'photos', move: true, title: first || defaultImagesTitle('photos'), onProgress });
      }
      if (r.ok) {
        done(r.notebookId);
        return;
      }
      if (r.reason === 'cancelled') {
        setPhase({ k: 'ready' });
        return;
      }
      const text = importFailureText(r.reason, subject.kind === 'images' ? 'image' : 'pdf') ?? '';
      if (r.reason === 'io') {
        setNotice(text);
        setPhase({ k: 'ready' });
      } else {
        setPhase({ k: 'failed', text });
      }
    } finally {
      if (session) store.releaseSession(session.id);
    }
  };

  const busy = phase.k === 'importing';
  const ready = phase.k === 'ready';
  const canAddToExisting = subject?.kind !== 'qunote' && pickableNotebooks(store.list('all', 'updated')).length > 0;
  const title =
    subject?.kind === 'qunote'
      ? tr('استلام مذكرة', 'Receive a notebook')
      : subject?.kind === 'images'
        ? tr('استلام صور', 'Receive photos')
        : tr('استلام ملف PDF', 'Receive a PDF');

  let progress: ImportProgressInfo | null = null;
  if (phase.k === 'copying') progress = { phase: 'copying', bytes: phase.bytes, total: phase.total };
  else if (phase.k === 'checking') progress = { phase: 'opening' };
  else if (phase.k === 'importing') progress = imp.progress ?? { phase: 'opening' };

  const footer = (
    <View style={[styles.footer, { flexDirection: row }]}>
      <PillButton label={tr('إلغاء', 'Cancel')} variant="neutral" onPress={cancel} disabled={busy} style={compact ? styles.flex : styles.cancelBtn} />
      {phase.k === 'failed' ? null : (
        <PillButton
          label={tr('فتح والبدء بالكتابة', 'Open and start writing')}
          icon="pen"
          onPress={() => void start()}
          disabled={!ready}
          loading={busy}
          style={styles.flex}
        />
      )}
    </View>
  );

  if (!files?.length) return null;

  return (
    <NbModal visible title={title} subtitle={tr('اختر أين تريد حفظه', 'Choose where to save it')} onClose={cancel} dismissable={!busy} footer={footer}>
      <FileCard subject={subject} lang={lang} />

      {phase.k === 'failed' ? <InfoBanner tone="warn" icon="alert" text={phase.text} /> : null}

      {phase.k !== 'failed' && subject && subject.kind !== 'qunote' ? (
        <View style={styles.group} accessibilityRole="radiogroup">
          <RadioRow
            label={tr('مذكرة جديدة', 'New notebook')}
            subtitle={subject.kind === 'images' ? tr('تُنشأ مذكرة جديدة من الصور', 'A new notebook is made from the photos') : tr('تُنشأ مذكرة باسم الملف', 'A notebook is made with the file name')}
            selected={mode === 'new'}
            disabled={busy}
            onPress={() => setMode('new')}
          />
          <RadioRow
            label={tr('إضافة إلى مذكرة موجودة', 'Add to an existing notebook')}
            subtitle={mode === 'existing' && target ? target.title : tr('تُضاف الصفحات في نهاية المذكرة', 'The pages are added at the end of the notebook')}
            selected={mode === 'existing'}
            disabled={busy || !canAddToExisting}
            onPress={() => {
              setMode('existing');
              setPicking(true);
            }}>
            {target ? (
              <PillButton label={tr('اختيار مذكرة أخرى', 'Choose another notebook')} variant="link" size="sm" onPress={() => setPicking(true)} disabled={busy} />
            ) : null}
          </RadioRow>
        </View>
      ) : null}

      {phase.k !== 'failed' && store.loaded && (mode === 'new' || subject?.kind === 'qunote') ? (
        <View style={styles.group}>
          <FieldLabel text={tr('الحفظ في', 'Save in')} />
          <LocationChips value={location ?? defaultLocation(store)} onChange={setLocation} />
        </View>
      ) : null}

      {notice ? <InfoBanner tone="warn" icon="alert" text={notice} /> : null}
      {progress ? <ImportProgress info={progress} hint={phase.k === 'importing' && subject?.kind === 'pdf' && progress.phase === 'pages'} /> : null}

      <NotebookPickerSheet
        visible={picking}
        selectedId={target?.id ?? null}
        onPick={(e) => {
          setTarget(e);
          setMode('existing');
          setPicking(false);
        }}
        onClose={() => {
          setPicking(false);
          if (!target) setMode('new');
        }}
      />
      {imp.dialogs}
      {phase.k === 'low-storage' ? (
        <LowStorageWarning
          freeBytes={phase.free}
          kind="import"
          onContinue={() => void copyAll()}
          onCancel={cancel}
        />
      ) : null}
    </NbModal>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: 12, backgroundColor: colors.surfaceMuted, borderRadius: 18, padding: 14 },
  cardIcon: { borderRadius: 14, padding: 12 },
  cardText: { flex: 1, gap: 2 },
  group: { gap: 10 },
  footer: { alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  cancelBtn: { width: 170 },
});
