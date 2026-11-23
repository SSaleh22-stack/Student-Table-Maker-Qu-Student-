/**
 * Notebook toasts: a one-slot module store, shown by <NbToastHost/> (mounted once in
 * src/app/notebook/_layout.tsx). Callable from anywhere on the JS thread, including non-React code
 * (the recorder's 'حُفظ التسجيل', shape snap's undo).
 *
 * - showToast(o) shows o right away and returns hide(), which hides THIS toast only (a no-op once a
 *   newer toast replaced it).
 * - One toast is visible at a time; a new one replaces the current one. With an `id`, a later toast
 *   with the same id replaces it in place (no new entrance animation; its timer restarts).
 * - It hides itself after durationMs (4 s, or 6 s with an action). durationMs 0 keeps it until hide().
 *   The timer lives here, not in the host, so a toast shown while no NbToastHost is mounted (the
 *   recorder's 'حُفظ التسجيل' after the student left the notebook) still expires instead of
 *   popping up, stale, the next time a notebook screen opens.
 * - The action button is the shared Toast's undo button (it reads 'تراجع' / 'Undo').
 *
 * JS only: from a worklet use scheduleOnRN(showToast, {...}).
 */
import { useSyncExternalStore } from 'react';

export type NbToastTone = 'ok' | 'warn' | 'info';

export interface ShowToastOptions {
  text: string;
  /** Second line (e.g. a file name). */
  detail?: string;
  /** Button text for onAction; the shared Toast falls back to 'تراجع' / 'Undo'. */
  actionLabel?: string;
  onAction?: () => void;
  /** 'ok' (default) and 'info' show a check, 'warn' an alert. */
  tone?: NbToastTone;
  /** A toast with the same id replaces the one showing in place. */
  id?: string;
  /** Milliseconds before it hides itself; 0 = never. Default 4000, or 6000 with an action. */
  durationMs?: number;
  /** Default 'bottom'. */
  position?: 'top' | 'bottom';
  /** Extra distance from the bottom safe area (e.g. to clear a bottom toolbar). */
  bottomOffset?: number;
}

export interface NbToastEntry {
  /** Unique per showToast call. */
  key: number;
  /** Changes only when a toast starts fresh (a same-id replace keeps it), drives the entrance. */
  showId: number;
  id?: string;
  text: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone: NbToastTone;
  durationMs: number;
  position: 'top' | 'bottom';
  bottomOffset: number;
}

let current: NbToastEntry | null = null;
let nextKey = 1;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function clearHideTimer(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function emit(): void {
  for (const cb of [...listeners]) cb();
}

export function showToast(o: ShowToastOptions): () => void {
  const key = nextKey++;
  const sameSlot = o.id !== undefined && current !== null && current.id === o.id;
  current = {
    key,
    showId: sameSlot && current ? current.showId : key,
    id: o.id,
    text: o.text,
    detail: o.detail,
    actionLabel: o.actionLabel,
    onAction: o.onAction,
    tone: o.tone ?? 'ok',
    durationMs: o.durationMs ?? (o.onAction ? 6000 : 4000),
    position: o.position ?? 'bottom',
    bottomOffset: o.bottomOffset ?? 0,
  };
  clearHideTimer();
  const ms = current.durationMs;
  if (ms > 0) hideTimer = setTimeout(() => hideToastKey(key), ms);
  emit();
  return () => hideToastKey(key);
}

/** Hides the toast with this showToast key (internal; NbToastHost uses it for swipes). */
export function hideToastKey(key: number): void {
  if (!current || current.key !== key) return;
  clearHideTimer();
  current = null;
  emit();
}

/** Hides the visible toast, or only the one with this id. */
export function hideToast(id?: string): void {
  if (!current) return;
  if (id !== undefined && current.id !== id) return;
  clearHideTimer();
  current = null;
  emit();
}

export function getToast(): NbToastEntry | null {
  return current;
}

export function subscribeToast(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The visible toast (null when none); re-renders on change. */
export function useToast(): NbToastEntry | null {
  return useSyncExternalStore(subscribeToast, getToast, getToast);
}
