/**
 * Import progress and the import dialogs.
 *
 * - <ImportProgress info /> (Figma 05): 'جارٍ الاستيراد… 6 من 24 صفحة' with the percent at the end,
 *   the bar (fills from the reading side) and 'يمكنك البدء بالكتابة على الصفحة الأولى الآن، والباقي
 *   يكتمل في الخلفية.'. While the file is still being copied or opened it reads 'جارٍ تجهيز الملف…'.
 * - useImportUi(): the ImportUi an import function needs (askPassword, confirmLowStorage,
 *   onProgress) plus `dialogs` to render (PasswordPrompt, LowStorageWarning) and the latest
 *   progress. For the pages view (P25) and the editor (P29):
 *     const imp = useImportUi();
 *     ... await insertPdfInto(session, at, imp.ui) ...
 *     return <>{...}{imp.dialogs}</>;
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { getLang, tr } from '@/lib/i18n';
import { ltr, row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import type { AskPassword } from '@/notebook/core/contracts/importing';
import { progressPercent } from '@/notebook/core/importing/plan';
import { bytesLabel } from '@/notebook/core/text/labels';
import { LowStorageWarning } from '@/notebook/ui/LowStorageWarning';
import { ProgressBar } from '@/notebook/ui/ProgressBar';

import type { ImportProgressInfo, ImportUi } from './importPdf';
import { PasswordPrompt } from './PasswordPrompt';

/** 'جارٍ الاستيراد… 6 من 24 صفحة'. */
export function importingPagesText(done: number, total: number): string {
  return tr(`جارٍ الاستيراد… ${done} من ${total} صفحة`, `Importing… ${done} of ${total} pages`);
}

export function preparingText(): string {
  return tr('جارٍ تجهيز الملف…', 'Preparing the file…');
}

export function backgroundHintText(): string {
  return tr('يمكنك البدء بالكتابة على الصفحة الأولى الآن، والباقي يكتمل في الخلفية.', 'You can start writing on the first page now; the rest finishes in the background.');
}

export interface ImportProgressProps {
  info: ImportProgressInfo;
  /** Show the 'start writing now' hint under the bar (PDF imports). Default true for page progress. */
  hint?: boolean;
}

export function ImportProgress({ info, hint }: ImportProgressProps) {
  let label: string;
  let value: number;
  let pct: number | null = null;
  if (info.phase === 'pages') {
    label = importingPagesText(info.done, info.total);
    pct = progressPercent(info.done, info.total);
    value = pct / 100;
  } else if (info.phase === 'copying' && info.total) {
    label = preparingText();
    pct = progressPercent(info.bytes, info.total);
    value = pct / 100;
  } else {
    label = preparingText();
    value = 0;
  }
  const showHint = hint ?? info.phase === 'pages';
  const sub = info.phase === 'copying' && info.bytes > 0 ? bytesLabel(info.bytes, getLang()) : null;
  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <View style={[styles.line, { flexDirection: row }]}>
        <AppText size={14} weight="semibold" color={colors.accentDark} style={styles.flex}>
          {label}
        </AppText>
        {pct !== null ? (
          <AppText size={14} weight="bold" color={colors.accentDark}>
            {ltr(`${pct}%`)}
          </AppText>
        ) : null}
      </View>
      <ProgressBar value={value} label={label} />
      {showHint ? (
        <AppText size={13} color={colors.faint}>
          {backgroundHintText()}
        </AppText>
      ) : sub ? (
        <AppText size={13} color={colors.faint}>
          {sub}
        </AppText>
      ) : null}
    </View>
  );
}

// ===== useImportUi

interface PasswordAsk {
  name: string;
  wrong: boolean;
  /** Counts the asks, so each one starts with an empty field. */
  attempt: number;
  resolve: (pw: string | null) => void;
}

/** What the prompt shows: an open ask, or the last typed password being checked. */
interface PasswordView {
  name: string;
  wrong: boolean;
  attempt: number;
  checking: boolean;
}

interface StorageAsk {
  free: number;
  resolve: (go: boolean) => void;
}

export interface ImportUiHandle {
  /** Stable: pass it to importFromSource / insertPdfInto / importPdfFile. */
  ui: ImportUi;
  /** Render these (inside the screen's modal, if it has one). */
  dialogs: ReactNode;
  /** The latest progress, or null before an import reported any. */
  progress: ImportProgressInfo | null;
  /** Clears the progress (after an import ended). */
  resetProgress: () => void;
}

export function useImportUi(): ImportUiHandle {
  const [password, setPassword] = useState<PasswordView | null>(null);
  const [storage, setStorage] = useState<StorageAsk | null>(null);
  const [progress, setProgress] = useState<ImportProgressInfo | null>(null);
  const passwordRef = useRef<PasswordAsk | null>(null);
  const attemptRef = useRef(0);
  const storageRef = useRef<StorageAsk | null>(null);

  const askPassword: AskPassword = useCallback(
    (o) =>
      new Promise<string | null>((resolve) => {
        // A previous ask still open is answered as cancelled.
        passwordRef.current?.resolve(null);
        attemptRef.current += 1;
        const ask: PasswordAsk = { name: o.name, wrong: o.wrong, attempt: attemptRef.current, resolve };
        passwordRef.current = ask;
        // A wrong password updates the open prompt in place (no close and re-present).
        setPassword({ name: ask.name, wrong: ask.wrong, attempt: ask.attempt, checking: false });
      }),
    [],
  );

  // The password step ended: close the prompt (unless a new ask is already waiting).
  const passwordDone = useCallback(() => {
    if (passwordRef.current) return;
    setPassword(null);
  }, []);

  const confirmLowStorage = useCallback(
    (free: number) =>
      new Promise<boolean>((resolve) => {
        storageRef.current?.resolve(false);
        const ask: StorageAsk = { free, resolve };
        storageRef.current = ask;
        setStorage(ask);
      }),
    [],
  );

  // An import still waiting on a dialog when the screen goes away ends as cancelled.
  useEffect(
    () => () => {
      passwordRef.current?.resolve(null);
      passwordRef.current = null;
      storageRef.current?.resolve(false);
      storageRef.current = null;
    },
    [],
  );

  const onProgress = useCallback(
    (p: ImportProgressInfo) => {
      setProgress(p);
      // The import moved on to its pages: the password (if any) worked.
      if (p.phase === 'pages') passwordDone();
    },
    [passwordDone],
  );
  const ui = useMemo<ImportUi>(() => ({ askPassword, confirmLowStorage, onProgress, passwordDone }), [askPassword, confirmLowStorage, onProgress, passwordDone]);

  const answerPassword = (pw: string | null) => {
    const ask = passwordRef.current;
    passwordRef.current = null;
    // A typed password keeps the prompt open (busy) while it is checked; a cancel closes it.
    if (pw === null || !ask) setPassword(null);
    else setPassword({ name: ask.name, wrong: ask.wrong, attempt: ask.attempt, checking: true });
    ask?.resolve(pw);
  };
  const answerStorage = (go: boolean) => {
    const ask = storageRef.current;
    storageRef.current = null;
    setStorage(null);
    ask?.resolve(go);
  };

  const dialogs = (
    <>
      <PasswordPrompt
        visible={!!password}
        name={password?.name}
        wrong={!!password?.wrong}
        attempt={password?.attempt ?? 0}
        checking={!!password?.checking}
        onSubmit={(pw) => answerPassword(pw)}
        onCancel={() => answerPassword(null)}
      />
      {storage ? (
        <LowStorageWarning freeBytes={storage.free} kind="import" onContinue={() => answerStorage(true)} onCancel={() => answerStorage(false)} />
      ) : null}
    </>
  );

  const resetProgress = useCallback(() => setProgress(null), []);
  return { ui, dialogs, progress, resetProgress };
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  line: { alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
});
