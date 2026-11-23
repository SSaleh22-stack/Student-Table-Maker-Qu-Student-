/**
 * The notebook clipboard (NB-43): ONE ClipboardData in memory for the whole app, so items copied in
 * one notebook paste into another.
 *
 * copy() stages the items' assets right away (core stageClipboard, call it BEFORE a cut removes the
 * items) and discards the previous clipboard's staged files. When two copies overlap, the one
 * started last wins. paste() adds the items as one history entry (core pasteClipboard).
 */
import { discardClipboard, pasteClipboard, stageClipboard } from '@/notebook/core/library/clipboard';
import type { Id, PageItem } from '@/notebook/core/model';
import type { ClipboardData, NotebookSession } from '@/notebook/core/session/types';
import { notebookSupported } from '@/notebook/flags';

import { nbFs, nbNewId, nbRoot } from './deps';

export interface NotebookClipboard {
  /** The current clipboard, or null when nothing was copied. */
  get(): ClipboardData | null;
  copy(s: NotebookSession, items: PageItem[]): Promise<void>;
  /** The new item ids ([] when the clipboard is empty or nothing could be pasted). */
  paste(s: NotebookSession, pageId: Id, at: { dx: number; dy: number }): Promise<Id[]>;
  /** Empties the clipboard and deletes its staged files. */
  clear(): Promise<void>;
  subscribe(cb: () => void): () => void;
}

let current: ClipboardData | null = null;
/** The latest copy started, and the one current holds. */
let started = 0;
let applied = 0;
const listeners = new Set<() => void>();
/** Pastes still reading a clipboard's staged files, per clipId: its files are deleted after them. */
const pasting = new Map<Id, Set<Promise<unknown>>>();

/** Deletes a replaced or cleared clipboard's staged files once no paste is still reading them. */
async function discard(data: ClipboardData | null): Promise<void> {
  if (!data) return;
  const busy = pasting.get(data.clipId);
  if (busy) await Promise.allSettled([...busy]);
  await discardClipboard(nbFs, nbRoot(), data);
}

function notify(): void {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      // A listener failing never stops the others.
    }
  }
}

const unsupported = () => new Error('The notebook is not available on this platform');

export const notebookClipboard: NotebookClipboard = {
  get: () => current,

  async copy(s, items) {
    if (!notebookSupported) throw unsupported();
    const seq = ++started;
    const root = nbRoot();
    const data = await stageClipboard(nbFs, root, s, items, nbNewId);
    if (seq < applied) {
      // A later copy already finished: this one is stale.
      await discard(data);
      return;
    }
    const prev = current;
    current = data;
    applied = seq;
    notify();
    await discard(prev);
  },

  async paste(s, pageId, at) {
    if (!notebookSupported) throw unsupported();
    const data = current;
    if (!data) return [];
    const run = pasteClipboard(s, pageId, data, at, nbNewId);
    let set = pasting.get(data.clipId);
    if (!set) {
      set = new Set();
      pasting.set(data.clipId, set);
    }
    set.add(run);
    try {
      return await run;
    } finally {
      set.delete(run);
      if (!set.size && pasting.get(data.clipId) === set) pasting.delete(data.clipId);
    }
  },

  async clear() {
    // Copies still staging were started before the clear: they are stale.
    applied = started + 1;
    const prev = current;
    if (!prev) return;
    current = null;
    notify();
    if (notebookSupported) await discard(prev);
  },

  subscribe(cb) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};
