/**
 * Public types of the notebook session engine and the library engine (P03). Pure types only.
 *
 * Contract extensions (accepted in P30 integration; every consumer codes against this file): beyond
 * the shared contract, this file adds
 * - NotebookSession.setLibraryFields (title, location and deletedAt written by library ops while a
 *   session is open; no history), deleteRecording/release returning a Promise (they load or write
 *   files first), and the optional SessionDeps tuning fields (lruSize, debounceMs, historyLimit,
 *   historyMaxBytes);
 * - the full LibraryOps / LibraryOpsDeps / CreateFromPages / Sections / ClipboardData shapes that
 *   the contract only names.
 */
import type { FsAdapter } from '../fs/adapter.ts';
import type {
  Asset,
  AssetKind,
  CourseFolder,
  Folder,
  Id,
  IndexEntry,
  IndexFile,
  IsoDate,
  LocationKey,
  Notebook,
  Page,
  PageBackground,
  PageItem,
  PaperSpec,
  PendingImport,
  Recording,
  Size,
} from '../model/index.ts';

// ===== session

export interface SessionDeps {
  fs: FsAdapter;
  /** The notebooks root (Paths.document/notebooks on device). */
  root: string;
  now(): number;
  newId(): Id;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(h: unknown): void;
  appVersion: string;
  /**
   * Called after every completed save (and at open for a read-only notebook, with readOnly true)
   * with the index entry built from the notebook. thumbRev is 0 and needsThumb/bytes/importing are
   * not set: merge with upsertEntry() (core/library/derive.ts), which keeps the store-owned fields.
   */
  onIndexEntry(e: IndexEntry): void;
  onSaved(id: Id, info: { contentRev: number; firstPageChanged: boolean }): void;
  /** Pages kept in memory besides dirty and undo-referenced pages (default 12). */
  lruSize?: number;
  /** Autosave debounce (default 1000 ms). */
  debounceMs?: number;
  historyLimit?: number;
  historyMaxBytes?: number;
}

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

/** CACHED: getSnapshot() returns the same object until version changes. */
export interface SessionSnapshot {
  notebook: Notebook;
  version: number;
  canUndo: boolean;
  canRedo: boolean;
  saveState: SaveState;
}

/** Fields library ops may change on an open notebook (explicit undefined clears a field). */
export type LibraryFields = Partial<Pick<Notebook, 'title' | 'folderId' | 'courseCode' | 'deletedAt'>>;

export interface AddAssetOptions {
  /** Move the source instead of copying it (staging files). */
  move?: boolean;
  name?: string;
  pageCount?: number;
  /** Use this id; when the notebook already has an asset with it, that asset is returned unchanged. */
  id?: Id;
}

export interface NotebookSession {
  readonly id: Id;
  /** Saved by a newer app version: nothing is ever written, every edit is ignored. */
  readonly readOnly: boolean;
  readonly notebook: Notebook;

  subscribe(cb: () => void): () => void;
  getSnapshot(): SessionSnapshot;
  subscribePage(pageId: Id, cb: () => void): () => void;
  /** The page when it is in memory (no disk access). */
  getPage(pageId: Id): Page | undefined;
  /** Loads a page (deduplicated). A missing or unreadable file reads as a blank page with the notebook defaults. */
  loadPage(pageId: Id): Promise<Page>;
  /**
   * Changes whenever the page changes. Values are unique across sessions (they start at the clock
   * value of the open), so they can key on-disk caches. 0 for a page never loaded.
   */
  pageVersion(pageId: Id): number;

  /** Item edits return the history entry id ('' when nothing changed or the page is not loaded). */
  addItems(pageId: Id, items: PageItem[], label?: string): Id;
  updateItems(pageId: Id, items: PageItem[], label?: string): Id;
  removeItems(pageId: Id, ids: Id[], label?: string): Id;
  replaceItems(pageId: Id, removeIds: Id[], add: PageItem[], label: string): Id;

  addPage(after: Id | 'end', init?: Partial<Pick<Page, 'size' | 'background'>>): Id;
  insertPages(at: number, pages: Page[], o?: { history?: boolean }): void;
  duplicatePages(ids: Id[]): Id[];
  deletePages(ids: Id[]): void;
  movePage(id: Id, toIndex: number): void;
  /** Pages not in memory are loaded first, so the change may land a moment later. */
  setPageBackground(ids: Id[], bg: PageBackground | ((p: Page) => PageBackground | null), size?: Size, o?: { history?: boolean }): void;
  setDefaults(p: PaperSpec): void;
  setMeta(p: Partial<Pick<Notebook, 'title'>>): void;
  /** No history. Writes notebook.json right away and resolves when it is saved. */
  setLibraryFields(p: LibraryFields): Promise<void>;

  setPending(p: PendingImport | undefined): void;
  /** enqueueFront of the notebook.json write, awaited. */
  flushPendingNow(): Promise<void>;

  addAsset(srcPath: string, kind: AssetKind, ext: string, o?: AddAssetOptions): Promise<Asset>;
  assetPath(fileId: Id): string;

  /** No history. */
  addRecording(r: Recording): void;
  /** No history. */
  updateRecording(id: Id, patch: Partial<Recording>): void;
  /** ONE history entry: the recording plus its marks on every page (pages are loaded first). */
  deleteRecording(id: Id): Promise<void>;

  beginGroup(label: string): void;
  endGroup(): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  topEntryId(): Id | null;
  /** Undoes only when the top entry still has this id. */
  undoIfTop(entryId: Id): boolean;

  requestJump(pageId: Id): void;
  onJump(cb: (pageId: Id) => void): () => void;

  /** Writes everything that changed: pages, then notebook.json, then the index entry, then onSaved. */
  flush(): Promise<void>;
  /** flush(), then fn while the write queue is held (nothing is written while fn runs). fn must not await this session's writes. */
  withWriteLock<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * FINAL release (the registry calls it after the grace period): flush, drop the undo history, then
   * GC tombstoned page files and unreferenced assets. Edits after this still save but are not undoable.
   */
  release(): Promise<void>;
}

export type OpenResult = { session: NotebookSession } | { error: 'missing' | 'unreadable' };

export interface Registry {
  /** Opens (or reuses) the session and adds a reference. A remount within the grace gets the same object. */
  acquire(id: Id): Promise<OpenResult>;
  /** Drops a reference; at zero the session is released after graceMs. */
  release(id: Id): void;
  /** The open session (also during the grace period), or null. */
  get(id: Id): NotebookSession | null;
  /** Every open session. */
  sessions(): NotebookSession[];
  flushAll(): Promise<void>;
  /** Releases a session now, whatever its reference count (purge, restore over it). */
  evict(id: Id): Promise<void>;
}

// ===== library

export interface IndexAccess {
  get(): IndexFile;
  update(fn: (f: IndexFile) => IndexFile): void;
}

export interface LibraryOpsDeps {
  fs: FsAdapter;
  root: string;
  now(): number;
  newId(): Id;
  index: IndexAccess;
  appVersion: string;
  /** The session registry, so ops on an open notebook go through its session. */
  sessions?: Pick<Registry, 'get' | 'evict'>;
  /** Course codes in the timetable now (AppData.chosen). Those folders cannot be renamed, converted or deleted (NB-12). */
  chosenCodes?(): string[];
  /** Title of a duplicate (the store passes a tr() based one). Default: the same title. */
  copyTitle?(title: string): string;
  /** Called after every op that changed the index. */
  onChanged?(): void;
}

export interface AssetSource {
  srcPath: string;
  kind: AssetKind;
  ext: string;
  /** The id the pages use for this asset. */
  id: Id;
  name?: string;
  pageCount?: number;
  /** Move instead of copy (staging files). */
  move?: boolean;
}

export interface CreateFromPages {
  title: string;
  location: LocationKey;
  /** At least one page; an empty list gets one blank page. */
  pages: Page[];
  assets?: AssetSource[];
  origin: Notebook['origin'];
  defaults?: PaperSpec;
  pending?: PendingImport;
  /** Use this notebook id (default: a new one). */
  id?: Id;
}

export interface BootReport {
  stagingRemoved: number;
  inboxRemoved: number;
  purged: Id[];
  added: Id[];
  removed: Id[];
  updated: Id[];
  deletedDirs: Id[];
}

export interface LibraryOps {
  create(i: { title: string; location: LocationKey; paper: PaperSpec }): Promise<Id>;
  /** Writes assets, then pages, then notebook.json, then the index entry. */
  createFromPages(i: CreateFromPages): Promise<Id>;
  /** Moves a prepared notebook folder (a notebook.json inside) into the library. location null keeps its own. */
  adoptFolder(dir: string, location: LocationKey | null): Promise<Id>;
  rename(id: Id, title: string): Promise<void>;
  duplicate(id: Id): Promise<Id>;
  move(id: Id, to: LocationKey): Promise<void>;
  trash(id: Id): Promise<void>;
  restore(id: Id): Promise<void>;
  /** Deletes the notebook folder for good and records a purged tombstone {id, at}. */
  purge(id: Id): Promise<void>;
  emptyTrash(): Promise<void>;
  createFolder(name: string): Folder;
  renameFolder(id: Id, name: string): void;
  deleteFolder(id: Id, nb: 'unfile' | 'trash'): Promise<void>;
  /** An ORPHAN course folder becomes a user folder: its notebooks move in, the courseNames entry goes. */
  convertCourseFolder(code: string, newName: string): Promise<Folder>;
  /** Deletes an orphan course folder: its notebooks are unfiled or trashed. */
  deleteCourseFolder(code: string, nb: 'unfile' | 'trash'): Promise<void>;
  /** Records the chosen courses' names (updateCourseNames) and mirrors them to library.json. */
  syncCourseNames(chosen: { code: string; name: string }[]): void;
  /** A staging work folder that boot() will not wipe while it is in use. */
  stagingJob(): Promise<{ id: Id; dir: string }>;
  /** Deletes a staging work folder. */
  endStagingJob(id: Id): Promise<void>;
  /** Wipe .staging, clean .inbox, purge expired trash, reconcile the index with the disk. */
  boot(): Promise<BootReport>;
  /** Resolves when library.json holds the latest folders and courseNames. */
  libraryWritten(): Promise<void>;
}

export interface SectionSlice<T> {
  /** At most SECTION_LIMIT (4) items. */
  items: T[];
  total: number;
}

export interface FolderInfo extends Folder {
  /** Non-deleted notebooks in the folder. */
  count: number;
  /** The latest updatedAt of those notebooks. */
  lastUpdatedAt?: IsoDate;
}

export interface Sections {
  courses: SectionSlice<CourseFolder>;
  mine: SectionSlice<FolderInfo>;
  unfiled: SectionSlice<IndexEntry>;
  /** The trimmed query ('' when none). */
  query: string;
  /** Every non-deleted notebook that matches the query (sorted), [] when there is no query. */
  results: IndexEntry[];
}

export interface ClipboardData {
  clipId: Id;
  sourceNotebookId: Id;
  items: PageItem[];
  assets: { asset: Asset; stagedPath: string }[];
}

export interface StorageUsage {
  total: number;
  pdf: number;
  audio: number;
  inkAndImages: number;
  other: number;
  free: number;
}
