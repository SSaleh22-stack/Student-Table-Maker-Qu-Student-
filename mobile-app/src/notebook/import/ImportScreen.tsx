/**
 * /notebook/import?source=pdf|scan|photos|camera&loc=<encodeLoc> (Figma 04 tiles): opens the
 * picker, the scanner or the camera right away, imports into a new notebook at `loc` (default
 * 'بدون مجلد') and opens it in place of this screen. A transparent modal route: until there is
 * progress to show, only the system picker is visible.
 *
 * The password prompt, the low-storage warning and an error dialog render here (useImportUi).
 */
import { router, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tr } from '@/lib/i18n';
import { colors, shadow } from '@/lib/theme';
import { isImportSource, type ImportSource } from '@/notebook/core/contracts/importing';
import { decodeLoc, type LocationKey } from '@/notebook/core/model';
import { openNotebook } from '@/notebook/nav';
import { nbRadius } from '@/notebook/theme';
import { useNotebooks } from '@/notebook/store/hooks';
import { DialogFrame } from '@/notebook/ui/ConfirmDialog';
import { PillButton } from '@/notebook/ui/CircleButton';

import { importFromSource } from './importFromSource';
import { importFailureText } from './importPdf';
import { ImportProgress, useImportUi } from './ImportProgress';

const LIBRARY = '/notebook' as Href;

function leave(): void {
  if (router.canGoBack()) router.back();
  else router.replace(LIBRARY);
}

export interface ImportScreenProps {
  source: string | undefined;
  /** An encodeLoc string. */
  loc: string | undefined;
}

export function ImportScreen({ source, loc }: ImportScreenProps) {
  const store = useNotebooks();
  const imp = useImportUi();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const started = useRef(false);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  useEffect(() => {
    if (started.current || !store.loaded) return;
    started.current = true;
    if (!isImportSource(source)) {
      leave();
      return;
    }
    const location: LocationKey = (loc ? decodeLoc(loc) : null) ?? { kind: 'unfiled' };
    const src: ImportSource = source;
    void importFromSource(src, { location }, imp.ui).then((r) => {
      if (!alive.current) return;
      setRunning(false);
      if (r.ok) {
        openNotebook(r.notebookId, { replace: true });
        return;
      }
      const text = importFailureText(r.reason, src === 'pdf' ? 'pdf' : 'image');
      if (text) setError(text);
      else leave();
    });
    // imp.ui is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.loaded, source, loc]);

  const progress = running ? imp.progress : null;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {progress ? (
        <View style={[StyleSheet.absoluteFill, styles.backdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
          <View style={[styles.card, shadow]}>
            <ImportProgress info={progress} hint={false} />
          </View>
        </View>
      ) : null}
      {imp.dialogs}
      <DialogFrame
        visible={!!error}
        title={tr('تعذّر الاستيراد', 'Import failed')}
        message={error ?? undefined}
        icon="alert"
        tone="warn"
        onDismiss={leave}
        actions={<PillButton label={tr('حسناً', 'OK')} onPress={leave} block />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  backdrop: { backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: { width: '100%', maxWidth: 440, backgroundColor: colors.surface, borderRadius: nbRadius.modal, padding: 24 },
});
