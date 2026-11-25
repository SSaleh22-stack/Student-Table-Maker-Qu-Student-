/**
 * Notebook data model (المذكرات). Pure types only.
 *
 * Page space is in PDF points, origin top-left, y down. The canvas never mirrors, in Arabic or English.
 * Other packages import these types ONLY from core/model/index.ts (the barrel).
 */

export type Id = string;
export type IsoDate = string;
/** '#RRGGBB' or '#RRGGBBAA'. */
export type Hex = string;

// ===== paper

export type PaperStyle = 'blank' | 'lined' | 'grid' | 'dotted';
export type PaperColor = 'white' | 'cream' | 'dark';
export type PageSizeKey = 'a4' | 'a4-landscape' | 'letter' | 'wide';

export interface PaperSpec {
  style: PaperStyle;
  color: PaperColor;
  size: PageSizeKey;
}

export interface Size {
  w: number;
  h: number;
}

/** Geometry of a paper background, from core/paper/pattern.ts (the only implementation). */
export interface PaperPattern {
  fill: Hex;
  /** Rules of lined paper, or the grid lines. Stroke width is lineWidth. */
  lines: { x1: number; y1: number; x2: number; y2: number }[];
  dots: { x: number; y: number; r: number }[];
  lineColor: Hex;
  lineWidth: number;
  /** Lined paper only: the vertical margin line, drawn from y 0 to the page height. */
  margin?: { x: number; color: Hex; width: number };
}

// ===== pages and items

export type PageBackground =
  | { kind: 'paper'; paper: PaperSpec }
  | { kind: 'pdf'; fileId: Id; pageIndex: number; rotation: 0 | 90 | 180 | 270; damaged?: boolean }
  | { kind: 'image'; fileId: Id; paper: PaperSpec };

/** When an item was made during a recording (NB-61). */
export interface RecMark {
  recordingId: Id;
  ms: number;
}

export interface ItemBase {
  id: Id;
  rec?: RecMark;
  /** Creation time (epoch ms), when known. */
  at?: number;
}

/** rot is in radians about the box center. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
}

export interface StrokeItem extends ItemBase {
  kind: 'stroke';
  tool: 'pen' | 'highlighter';
  color: Hex;
  width: number;
  pressure: boolean;
  /** Flat x, y, p triples. p is 0..1. */
  pts: number[];
}

export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'triangle' | 'polygon';

export interface ShapeItem extends ItemBase {
  kind: 'shape';
  shape: ShapeKind;
  color: Hex;
  width: number;
  fill: Hex | null;
  highlighter?: boolean;
  /** Flat x, y pairs (line, arrow, polygon). */
  pts?: number[];
  box?: Box;
}

export interface TextItem extends ItemBase {
  kind: 'text';
  /** w = wrap width; h is recomputed from the Skia Paragraph after every commit. */
  box: Box;
  text: string;
  size: number;
  color: Hex;
  bold: boolean;
}

export interface ImageItem extends ItemBase {
  kind: 'image';
  fileId: Id;
  box: Box;
  crop: { x: number; y: number; w: number; h: number } | null;
}

export type PageItem = StrokeItem | ShapeItem | TextItem | ImageItem;

/**
 * DRAW ORDER (screen, thumbnails, export): 1 background; 2 images; 3 the HIGHLIGHTER GROUP
 * (highlighter strokes and shapes with highlighter true), drawn opaque into ONE layer composited at
 * alpha 0.35; 4 every other item (pen strokes, other shapes, text) in array order.
 */
export interface Page {
  id: Id;
  size: Size;
  background: PageBackground;
  items: PageItem[];
}

// ===== recordings, assets, notebook

export interface RecSegment {
  fileId: Id;
  startMs: number;
  durationMs: number;
  state: 'recording' | 'done' | 'recovered' | 'lost';
  pendingPath?: string;
}

export interface Recording {
  id: Id;
  /** Default tr('تسجيل n'). */
  title: string;
  startedAt: IsoDate;
  durationMs: number;
  segments: RecSegment[];
}

export type AssetKind = 'pdf' | 'image' | 'audio';

export interface Asset {
  id: Id;
  kind: AssetKind;
  ext: string;
  bytes: number;
  name?: string;
  pageCount?: number;
  addedAt: IsoDate;
}

export interface PendingImport {
  jobId: Id;
  fileId: Id;
  kind: 'pdf-pages';
  firstPageIndex: number;
  insertAt: number;
  nextPage: number;
  total: number;
  probing?: number;
  damagedPages?: number[];
}

export type NotebookOriginKind = 'blank' | 'pdf' | 'scan' | 'photos' | 'qunote' | 'restore' | 'duplicate';

export interface Notebook {
  id: Id;
  title: string;
  folderId?: Id;
  courseCode?: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  deletedAt?: IsoDate;
  defaults: PaperSpec;
  pageIds: Id[];
  /** Tombstoned page files, kept on disk until GC at final release (undo of a page delete reloads them). */
  removedPageIds: Id[];
  recordings: Recording[];
  assets: Record<Id, Asset>;
  pending?: PendingImport;
  origin: { kind: NotebookOriginKind; name?: string };
  contentRev: number;
}

// ===== file envelopes (readers.ts). Key order fixed, sentinel last.

export interface NotebookFile extends Notebook {
  format: 'qu-notebook';
  version: 1;
  rev: number;
  savedAt: IsoDate;
  app: string;
  $: 'end';
}

/** A stroke on disk: d10 = x,y int deltas of round(v*10), p = round(p*100). Raw floats are also accepted. */
export type EncodedStroke = Omit<StrokeItem, 'pts'> & { enc?: 'd10'; pts: number[] };
export type EncodedItem = Exclude<PageItem, StrokeItem> | EncodedStroke;

export interface EncodedPage {
  id: Id;
  size: Size;
  background: PageBackground;
  items: EncodedItem[];
}

export interface PageFile {
  format: 'qu-page';
  version: 1;
  rev: number;
  savedAt: IsoDate;
  page: EncodedPage;
  $: 'end';
}

export interface Folder {
  id: Id;
  name: string;
  createdAt: IsoDate;
  order: number;
}

export interface LibraryFile {
  format: 'qu-library';
  version: 1;
  rev: number;
  savedAt: IsoDate;
  folders: Folder[];
  courseNames: Record<string, string>;
  $: 'end';
}

// ===== AsyncStorage index ('qu-student:notebooks:v1')

export type IndexCover = { kind: 'paper'; paper: PaperSpec } | { kind: 'pdf' } | { kind: 'image' };

export interface IndexEntry {
  id: Id;
  title: string;
  folderId?: Id;
  courseCode?: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  deletedAt?: IsoDate;
  pageCount: number;
  recordingCount: number;
  hasPdf: boolean;
  cover: IndexCover;
  thumbRev: number;
  needsThumb?: boolean;
  contentRev: number;
  bytes?: number;
  readOnly?: boolean;
  importing?: { done: number; total: number };
}

export interface PurgedTombstone {
  id: Id;
  at: IsoDate;
}

export interface IndexFile {
  version: 1;
  entries: IndexEntry[];
  folders: Folder[];
  /** Written whenever a course code is seen in AppData.chosen. */
  courseNames: Record<string, string>;
  /** Permanently deleted notebooks: capped at 2000, kept 400 days. Read by the backup planner. */
  purged: PurgedTombstone[];
}

// ===== library locations

export type LocationKey = { kind: 'course'; code: string } | { kind: 'folder'; id: Id } | { kind: 'unfiled' };
export type SectionKey = 'courses' | 'mine' | 'unfiled' | `course:${string}` | `folder:${string}`;
export type SortKey = 'updated' | 'name' | 'created';

export interface CourseFolder {
  code: string;
  /** Chosen name, else courseNames[code], else code. */
  name: string;
  inTimetable: boolean;
  count: number;
}

// ===== settings ('qu-student:notebooks:settings:v1')

export type TourFlag = 'unseen' | 'done' | 'skipped';

export interface PenPreset {
  color: Hex;
  width: number;
  /** Up to 40 characters. undefined -> localized default by index: 'أزرق ناعم', 'أسود', 'أحمر عريض'. */
  name?: string;
}

export type PencilAction = 'eraser' | 'lastTool' | 'off';
export type ToolbarPos = 'top' | 'bottom' | 'left' | 'right';

export interface NotebookSettings {
  version: 1;
  input: 'pen' | 'finger';
  fingerDraws: boolean;
  hand: 'right' | 'left';
  pencilDoubleTap: PencilAction;
  pencilSqueeze: PencilAction;
  pressure: boolean;
  defaultPaper: PaperSpec;
  toolbarPos: ToolbarPos;
  shapeSnap: boolean;
  snapHintsShown: number;
  rulerHintShown: boolean;
  /** The pages strip stays docked beside the page while writing (pinned from the pages sidebar). */
  pagesPinned: boolean;
  /** widthIndex indexes PEN_WIDTHS [2, 3, 5, 7, 10]. */
  pen: { presets: [PenPreset, PenPreset, PenPreset]; color: Hex; widthIndex: number };
  /** widthIndex indexes HL_WIDTHS [10, 14, 18, 24, 30]. straight true = a hold at the stroke end straightens it. */
  highlighter: { color: Hex; widthIndex: number; straight: boolean };
  eraser: { mode: 'stroke' | 'pixel'; highlighterOnly: boolean; size: number };
  customColors: Hex[];
  sort: SortKey;
  backup: {
    enabled: boolean;
    wifiOnly: boolean;
    lastBackupAt?: IsoDate;
    lastError?: string;
    account?: string;
    lastCount?: number;
    lastBytes?: number;
    /**
     * Where backups go (undefined = the platform default: iCloud Drive on iOS, Google Drive on
     * Android). iOS offers all three, Android Google Drive and OneDrive. Changed only while backup is off.
     */
    provider?: 'icloud' | 'gdrive' | 'onedrive';
  };
  tours: { library: TourFlag; setup: TourFlag; editor: TourFlag };
  calc: { open: boolean; docked: boolean; float: { x: number; y: number } };
}

// ===== undo (patches.ts, history.ts)

export type PageGeometry = Pick<Page, 'size' | 'background'>;
export type MetaFields = Partial<Pick<Notebook, 'title' | 'defaults' | 'recordings'>>;

export interface ItemsPatch {
  t: 'items';
  pageId: Id;
  /** Items removed or changed, at their index in the old list. */
  before: { index: number; item: PageItem }[];
  /** Items added or changed, at their index in the new list. */
  after: { index: number; item: PageItem }[];
}

/** Created or deleted pages live as files (tombstones in removedPageIds), reloaded on undo; no in-memory copies. */
export interface PagesPatch {
  t: 'pages';
  before: Id[];
  after: Id[];
}

export interface PagePatch {
  t: 'page';
  pageId: Id;
  before: PageGeometry;
  after: PageGeometry;
}

export interface MetaPatch {
  t: 'meta';
  before: MetaFields;
  after: MetaFields;
}

export type Patch = ItemsPatch | PagesPatch | PagePatch | MetaPatch;

/** History keeps at most 200 entries AND 8 MB (oldest dropped). */
export interface HistoryEntry {
  id: Id;
  label: string;
  patches: Patch[];
  at: number;
  bytes: number;
}

/** pages is a CACHE of loaded pages (it may also hold tombstoned pages). Iterate notebook.pageIds, not the map. */
export interface DocState {
  notebook: Notebook;
  pages: Map<Id, Page>;
}
