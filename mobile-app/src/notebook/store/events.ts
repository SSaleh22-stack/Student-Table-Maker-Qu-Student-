/**
 * Notebook store events (module singletons, JS only).
 *
 * - onSaved: a session finished a save (pages, notebook.json, index entry), with the new contentRev
 *   and whether the first page changed (the cover thumbnail worker listens).
 * - onLibraryChanged: a library op changed the index (create, rename, move, trash, folders, boot…).
 * - onThumbRequested: store.requestThumb(id) marked a notebook as needing a new cover.
 *
 * A listener that throws never stops the others.
 */
import type { Id } from '@/notebook/core/model';

export interface SavedInfo {
  contentRev: number;
  firstPageChanged: boolean;
}

function createEmitter<A extends unknown[]>() {
  const listeners = new Set<(...args: A) => void>();
  return {
    on(cb: (...args: A) => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    emit(...args: A): void {
      for (const cb of [...listeners]) {
        try {
          cb(...args);
        } catch {
          // One listener failing never stops the others.
        }
      }
    },
  };
}

const saved = createEmitter<[Id, SavedInfo]>();
const libraryChanged = createEmitter<[]>();
const thumbRequested = createEmitter<[Id]>();

export interface NotebookEvents {
  onSaved(cb: (id: Id, info: SavedInfo) => void): () => void;
  onLibraryChanged(cb: () => void): () => void;
  onThumbRequested(cb: (id: Id) => void): () => void;
}

export const notebookEvents: NotebookEvents = {
  onSaved: saved.on,
  onLibraryChanged: libraryChanged.on,
  onThumbRequested: thumbRequested.on,
};

export const emitSaved = (id: Id, info: SavedInfo): void => saved.emit(id, { contentRev: info.contentRev, firstPageChanged: info.firstPageChanged });
export const emitLibraryChanged = (): void => libraryChanged.emit();
export const emitThumbRequested = (id: Id): void => thumbRequested.emit(id);
