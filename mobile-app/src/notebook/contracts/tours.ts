/**
 * Tours contract (P04): tour target ids and the tour components' props (Figma 24-35).
 *
 * Implementers:
 * - P04U src/notebook/ui/tourTargets.ts: `useTourTarget: UseTourTarget` (ref callback into a module
 *   registry) and `measureTarget: MeasureTarget`
 * - P15 src/notebook/tours/LibraryTour.tsx `LibraryTour`, EditorTour.tsx `EditorTour`, SetupModal.tsx
 *   `SetupModal`, tourState.ts `resetTours: ResetTours`
 *
 * Every TOUR_TARGETS id is attached exactly once on its screen (P30 checks). A step may union several
 * targets (lib.search + lib.headerActions). Core (core/tours) cannot import this file; it takes the id
 * strings as data.
 */
import type { EnableBackupResult } from '@/notebook/core/contracts/backup';

export const TOUR_TARGETS = {
  libCourses: 'lib.courses',
  libFolders: 'lib.folders',
  libNew: 'lib.new',
  libSearch: 'lib.search',
  libHeaderActions: 'lib.headerActions',
  edToolbar: 'ed.toolbar',
  edGrip: 'ed.grip',
  edUndo: 'ed.undo',
  edRecord: 'ed.record',
  edActions: 'ed.actions',
  // The app's own tours (src/components/AppTours.tsx), outside the notebook.
  appImport: 'app.import',
  appTimetable: 'app.timetable',
  tasksSummary: 'tasks.summary',
  tasksFilters: 'tasks.filters',
  tasksNew: 'tasks.new',
} as const;

export type TourTargetId = (typeof TOUR_TARGETS)[keyof typeof TOUR_TARGETS];

/** A measured target in window coordinates (px). */
export interface TourRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Anything with measureInWindow (a View instance). */
export interface MeasurableNode {
  measureInWindow(cb: (x: number, y: number, width: number, height: number) => void): void;
  /** Views have it too; Android tours measure with it (pageX / pageY), see ui/tourTargets.ts. */
  measure?(cb: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void): void;
}

/** Returns a stable ref callback for the element that is the target. */
export type UseTourTarget = (id: TourTargetId) => (node: MeasurableNode | null) => void;
/** null when the target is not mounted or has no size. */
export type MeasureTarget = (id: TourTargetId) => Promise<TourRect | null>;
/** Marks every tour 'unseen' again (notebook settings: replay tours). */
export type ResetTours = () => void;

export interface LibraryTourProps {
  /** Called when the tour ends (done or skipped). */
  onDone?(): void;
}

export interface EditorTourProps {
  onDone(): void;
}

export interface SetupModalProps {
  onDone(): void;
  /** Runs the backup enable flow (P20 useEnableBackupFlow().start). */
  enableBackup(): Promise<EnableBackupResult>;
  isTablet: boolean;
}
