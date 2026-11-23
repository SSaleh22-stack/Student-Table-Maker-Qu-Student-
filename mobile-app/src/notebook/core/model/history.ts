/**
 * Undo history: at most `limit` entries (200) AND `maxBytes` (8 MB) over the undo and redo stacks
 * together; the oldest undo entries are dropped first. NB-48 asks for at least 50 steps.
 *
 * Groups: between beginGroup(label) and the matching endGroup(), every pushed entry is merged into ONE
 * entry (the id and time of the first pushed entry, the group's label). Groups nest; only the
 * outermost one counts. An empty group adds nothing. undo() or redo() closes an open group first.
 */
import { patchBytes } from './patches.ts';
import type { HistoryEntry, Id } from './types.ts';

export const HISTORY_LIMIT = 200;
export const HISTORY_MAX_BYTES = 8 * 1024 * 1024;

export interface History {
  push(e: HistoryEntry): void;
  undo(): HistoryEntry | null;
  redo(): HistoryEntry | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** The entry undo() would return next, or null. */
  top(): HistoryEntry | null;
  clear(): void;
  beginGroup(label: string): void;
  endGroup(): void;
  inGroup(): boolean;
  /** Undo-stack size, redo-stack size and total bytes (for tests and diagnostics). */
  stats(): { undo: number; redo: number; bytes: number };
  /** Drops every entry (undo and redo) for which pred returns true, e.g. after a page file is purged. */
  dropWhere(pred: (e: HistoryEntry) => boolean): void;
  /** True when the entry with this id is the top of the undo stack. */
  isTop(id: Id): boolean;
}

function bytesOf(e: HistoryEntry): number {
  // A positive size is trusted; a missing, broken or zero size (with patches) is measured, so a
  // caller that forgets bytes cannot slip past the 8 MB cap.
  if (Number.isFinite(e.bytes) && (e.bytes > 0 || e.patches.length === 0)) return Math.max(0, e.bytes);
  let n = 0;
  for (const p of e.patches) n += patchBytes(p);
  return n;
}

export function createHistory(o?: { limit?: number; maxBytes?: number }): History {
  const limit = Math.max(1, Math.floor(o?.limit ?? HISTORY_LIMIT));
  const maxBytes = Math.max(0, o?.maxBytes ?? HISTORY_MAX_BYTES);
  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];
  let total = 0;
  let depth = 0;
  // The merged entry of the open group, once something was pushed into it (it is the undo top).
  let groupEntry: HistoryEntry | null = null;
  let groupLabel = '';

  const recount = () => {
    total = 0;
    for (const e of undoStack) total += e.bytes;
    for (const e of redoStack) total += e.bytes;
  };

  /** Drops the oldest undo entries over the limits; the newest undo entry is always kept. */
  const enforce = () => {
    let drop = 0;
    let bytes = total;
    while (undoStack.length - drop > 1 && (undoStack.length - drop > limit || bytes > maxBytes)) {
      bytes -= undoStack[drop].bytes;
      drop++;
    }
    if (drop) {
      undoStack = undoStack.slice(drop);
      total = bytes;
    }
    // If one entry is bigger than the cap on its own, the redo stack goes first.
    if (total > maxBytes && redoStack.length) {
      redoStack = [];
      recount();
    }
  };

  const closeGroup = () => {
    depth = 0;
    groupEntry = null;
    groupLabel = '';
  };

  return {
    push(e) {
      const entry: HistoryEntry = { id: e.id, label: e.label, patches: e.patches.slice(), at: e.at, bytes: bytesOf(e) };
      if (redoStack.length) {
        redoStack = [];
        recount();
      }
      if (depth > 0 && groupEntry && undoStack[undoStack.length - 1] === groupEntry) {
        const merged: HistoryEntry = {
          id: groupEntry.id,
          label: groupEntry.label,
          patches: [...groupEntry.patches, ...entry.patches],
          at: groupEntry.at,
          bytes: groupEntry.bytes + entry.bytes,
        };
        undoStack[undoStack.length - 1] = merged;
        groupEntry = merged;
        total += entry.bytes;
      } else {
        if (depth > 0) {
          entry.label = groupLabel || entry.label;
          groupEntry = entry;
        }
        undoStack.push(entry);
        total += entry.bytes;
      }
      enforce();
      if (groupEntry && !undoStack.includes(groupEntry)) groupEntry = null;
    },
    undo() {
      if (depth > 0) closeGroup();
      const e = undoStack.pop();
      if (!e) return null;
      redoStack.push(e);
      return e;
    },
    redo() {
      if (depth > 0) closeGroup();
      const e = redoStack.pop();
      if (!e) return null;
      undoStack.push(e);
      return e;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    top: () => undoStack[undoStack.length - 1] ?? null,
    clear() {
      undoStack = [];
      redoStack = [];
      total = 0;
      closeGroup();
    },
    beginGroup(label) {
      if (depth === 0) {
        groupLabel = label;
        groupEntry = null;
      }
      depth++;
    },
    endGroup() {
      if (depth === 0) return;
      depth--;
      if (depth === 0) closeGroup();
    },
    inGroup: () => depth > 0,
    stats: () => ({ undo: undoStack.length, redo: redoStack.length, bytes: total }),
    dropWhere(pred) {
      const keep = (e: HistoryEntry) => !pred(e);
      undoStack = undoStack.filter(keep);
      redoStack = redoStack.filter(keep);
      if (groupEntry && !undoStack.includes(groupEntry)) groupEntry = null;
      recount();
    },
    isTop: (id) => {
      const t = undoStack[undoStack.length - 1];
      return !!t && t.id === id;
    },
  };
}
