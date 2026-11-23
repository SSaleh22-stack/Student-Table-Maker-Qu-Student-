/**
 * React hooks over the notebook store. Every hook is built on useSyncExternalStore with a cached
 * getSnapshot, and every hook that takes a session or an id accepts null (returning null or
 * undefined), so callers never call hooks conditionally.
 *
 * - useNotebooks(): the NotebooksStore snapshot (re-renders when the index, the settings, the chosen
 *   courses or the loaded flag change). getNotebooksStore(): the same outside React, null until
 *   NotebooksProvider is mounted.
 * - useNotebookSettings(): [settings, setSettings] (deep merge against the latest settings).
 * - useNotebookSession(id | null): acquires the session from the registry and releases it on
 *   unmount or when id changes (the registry keeps it 5 s, so a remount gets the same object).
 * - useSessionSnapshot(s | null), usePage(s | null, pageId | null): the session's cached snapshot
 *   and one page (usePage loads the page when it is not in memory).
 * - useNotebookClipboard(): the current ClipboardData or null.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { Id, NotebookSettings, Page } from '@/notebook/core/model';
import type { ClipboardData, NotebookSession, SessionSnapshot } from '@/notebook/core/session/types';
import { notebookSupported } from '@/notebook/flags';

import { notebookClipboard } from './clipboard';
import { getStoreSnapshot, isStoreMounted, subscribeStore, type NotebooksStore } from './library';
import { notebookRegistry } from './sessions';
import { settingsStore } from './settingsStore';

export type { ChosenCourse, NotebooksStore } from './library';
export type { NotebookClipboard } from './clipboard';
export type { NotebookEvents, SavedInfo } from './events';
export type { SettingsPatch } from './settingsStore';
export type {
  ClipboardData,
  CreateFromPages,
  NotebookSession,
  Sections,
  SessionSnapshot,
  StorageUsage,
} from '@/notebook/core/session/types';
export { notebookRegistry, flushNotebooks } from './sessions';
export { notebookEvents } from './events';
export { notebookClipboard } from './clipboard';

const noopUnsubscribe = () => {};
const noopSubscribe = () => noopUnsubscribe;

export function useNotebooks(): NotebooksStore {
  return useSyncExternalStore(subscribeStore, getStoreSnapshot, getStoreSnapshot);
}

/** The store outside React; null until NotebooksProvider is mounted. */
export function getNotebooksStore(): NotebooksStore | null {
  return isStoreMounted() ? getStoreSnapshot() : null;
}

export function useNotebookSettings(): [NotebookSettings, NotebooksStore['setSettings']] {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot, settingsStore.getSnapshot);
  return [settings, settingsStore.set];
}

type SessionState = { id: Id; session: NotebookSession | null; error?: 'missing' | 'unreadable' };

export function useNotebookSession(id: Id | null): { session: NotebookSession | null; error?: 'missing' | 'unreadable' } {
  const [state, setState] = useState<SessionState | null>(null);

  useEffect(() => {
    if (!id || !notebookSupported) return;
    let alive = true;
    let acquired = false;
    const registry = notebookRegistry();
    registry.acquire(id).then(
      (r) => {
        if ('session' in r) {
          acquired = true;
          if (!alive) {
            registry.release(id);
            return;
          }
          setState({ id, session: r.session });
        } else if (alive) {
          // A failed open holds no reference: nothing to release.
          setState({ id, session: null, error: r.error });
        }
      },
      () => {
        if (alive) setState({ id, session: null, error: 'unreadable' });
      },
    );
    return () => {
      alive = false;
      if (acquired) registry.release(id);
      // The reference is dropped: never hand this session out again (id -> null -> the same id
      // after the 5 s grace would otherwise show the released session until the new one opens).
      setState(null);
    };
  }, [id]);

  const current = state && id && state.id === id ? state : null;
  const session = current?.session ?? null;
  const error = current?.error;
  return useMemo(() => (error ? { session, error } : { session }), [session, error]);
}

export function useSessionSnapshot(s: NotebookSession | null): SessionSnapshot | null {
  const subscribe = useCallback((cb: () => void) => (s ? s.subscribe(cb) : noopUnsubscribe), [s]);
  const get = useCallback(() => (s ? s.getSnapshot() : null), [s]);
  return useSyncExternalStore(subscribe, get, get);
}

export function usePage(s: NotebookSession | null, pageId: Id | null): Page | undefined {
  const subscribe = useCallback((cb: () => void) => (s && pageId ? s.subscribePage(pageId, cb) : noopUnsubscribe), [s, pageId]);
  const get = useCallback(() => (s && pageId ? s.getPage(pageId) : undefined), [s, pageId]);
  const page = useSyncExternalStore(subscribe, get, get);
  useEffect(() => {
    // loadPage notifies the page's listeners when it lands.
    if (s && pageId && !s.getPage(pageId)) s.loadPage(pageId).catch(() => {});
  }, [s, pageId, page]);
  return page;
}

export function useNotebookClipboard(): ClipboardData | null {
  return useSyncExternalStore(notebookSupported ? notebookClipboard.subscribe : noopSubscribe, notebookClipboard.get, notebookClipboard.get);
}
