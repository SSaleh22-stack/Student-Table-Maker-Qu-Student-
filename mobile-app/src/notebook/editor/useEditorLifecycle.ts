/**
 * The editor's lifecycle (P29): what happens when a notebook opens, while it is open and when the
 * editor goes away. It mounts NO services and NO toast host (NotebookServices and the notebook
 * layout own those).
 *
 * Opening (the route's notebook id, before the session has even loaded):
 * - recorder.cancelPendingStop(id): this editor is back (a language switch remounts every screen, and
 *   the old editor's grace stop must not end the recording);
 * - resetToolSession(): the pen is the tool again and the ruler is off (P13);
 * - resetOverlayBusy(): no overlay gesture survives a previous editor.
 * When the session is there: recoverRecordings(session) (P12, idempotent, leaves the live segment
 * alone) and resumePendingImport(session) (P17, idempotent per notebook and job).
 *
 * While open (NB-81, saving is automatic):
 * - the notebook is flushed when the screen loses focus (pages, settings or export pushed on top),
 *   when the app goes to the background, and when the page on screen changes (notePage);
 * - session.onJump (the pages view's tap) scrolls the canvas to that page.
 *
 * Closing (ruling (o)): recorder.stopIfNotebook(id, { graceMs: 5000 }) stops this notebook's recording
 * after the grace, with the 'حُفظ التسجيل' toast (P12). Pushing another screen over the editor does
 * not unmount it, so the recording goes on. The tool state, the calculator and the notebook are
 * flushed. The session itself is released by useNotebookSession (with its own 5 s grace).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { recorder, STOP_GRACE_MS } from '@/notebook/audio/recorder';
import { recoverRecordings } from '@/notebook/audio/recovery';
import { flushCalc } from '@/notebook/calc/calcStore';
import { resetOverlayBusy } from '@/notebook/canvas/overlayContext';
import type { PageCanvasHandle } from '@/notebook/contracts/canvas';
import type { Id } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { resumePendingImport } from '@/notebook/import/jobs';
import { flushToolState, resetToolSession } from '@/notebook/toolbar/toolState';

function flushQuietly(session: NotebookSession): void {
  session.flush().catch(() => {
    // The session keeps the change pending and its saveState says 'error'; the next flush retries.
  });
}

export interface EditorLifecycle {
  /** Call from PageCanvas onPageChange: leaving a page saves (NB-81). */
  notePage(pageId: Id): void;
  /** Saves now (the back button). */
  flushNow(): void;
}

export function useEditorLifecycle(
  notebookId: Id | null,
  session: NotebookSession | null,
  canvas: () => PageCanvasHandle | null,
): EditorLifecycle {
  // The route's notebook: cancel a pending grace stop, fresh tools and overlays.
  useEffect(() => {
    if (!notebookId) return;
    recorder.cancelPendingStop(notebookId);
    resetOverlayBusy();
    resetToolSession();
    return () => {
      recorder.stopIfNotebook(notebookId, { graceMs: STOP_GRACE_MS });
      flushToolState();
      flushCalc();
    };
  }, [notebookId]);

  // The open session: recover recordings, resume a PDF import, flush when it goes.
  useEffect(() => {
    if (!session) return;
    void recoverRecordings(session).catch(() => {
      // Recovery is retried the next time the notebook opens.
    });
    if (session.notebook.pending) {
      resumePendingImport(session).catch(() => {
        // The job keeps its pending slot; it resumes the next time the notebook opens.
      });
    }
    return () => flushQuietly(session);
  }, [session]);

  // Blur: another screen was pushed over the editor (or the editor is leaving).
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      return () => flushQuietly(session);
    }, [session]),
  );

  // The app goes to the background. (The store's own AppState flush covers every open session too;
  // this one keeps the editor's promise in one place.)
  useEffect(() => {
    if (!session) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') flushQuietly(session);
    });
    return () => sub.remove();
  }, [session]);

  // The pages view asks for a page: scroll there (it pops back to this editor right after).
  const canvasRef = useRef(canvas);
  useEffect(() => {
    canvasRef.current = canvas;
  });
  useEffect(() => {
    if (!session) return;
    return session.onJump((pageId) => {
      const index = session.notebook.pageIds.indexOf(pageId);
      if (index >= 0) canvasRef.current()?.scrollToPage(index, false);
    });
  }, [session]);

  const lastPage = useRef<Id | null>(null);
  const notePage = useCallback(
    (pageId: Id) => {
      const prev = lastPage.current;
      lastPage.current = pageId;
      if (session && prev !== null && prev !== pageId) flushQuietly(session);
    },
    [session],
  );

  const flushNow = useCallback(() => {
    if (session) flushQuietly(session);
  }, [session]);

  return { notePage, flushNow };
}
