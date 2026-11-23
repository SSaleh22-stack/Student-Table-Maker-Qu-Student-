/**
 * Tour flags (settings.tours) and the one-tour-at-a-time guard.
 *
 * - resetTours(): marks the library tour, the first-time setup and the notebook tour 'unseen' again
 *   (notebook settings: 'Show the tour again'). Each shows the next time its screen opens.
 * - setTourFlag(which, flag): 'done' after the last step, 'skipped' after 'تخطي الجولة', 'لاحقاً' or
 *   'تخطي الإعداد'. A skipped tour never shows again on its own (NB-T1..T3).
 * - claimTour / releaseTour / subscribeTourSlot: only one tour overlay runs at a time, even if a
 *   screen mounts its tour twice (a pushed copy of the library) or both tours mount at once. A tour
 *   that finds the slot taken waits for it to be released.
 *
 * Settings writes go through the store's deep merge, so only settings.tours.<which> changes.
 */
import type { NotebookSettings, TourFlag } from '@/notebook/core/model';
import { setSettings } from '@/notebook/store/settingsStore';

export type TourName = keyof NotebookSettings['tours'];

/** Marks every tour 'unseen' again. */
export function resetTours(): void {
  setSettings({ tours: { library: 'unseen', setup: 'unseen', editor: 'unseen' } });
}

export function setTourFlag(which: TourName, flag: TourFlag): void {
  const tours: Partial<NotebookSettings['tours']> = {};
  tours[which] = flag;
  setSettings({ tours });
}

let owner: object | null = null;
const slotListeners = new Set<() => void>();

/** Takes the tour slot for `who` (any object, e.g. a ref); false while someone else holds it. */
export function claimTour(who: object): boolean {
  if (owner && owner !== who) return false;
  owner = who;
  return true;
}

export function releaseTour(who: object): void {
  if (owner !== who) return;
  owner = null;
  // A tour that is waiting for the slot (claimTour returned false) tries again now.
  for (const cb of [...slotListeners]) {
    try {
      cb();
    } catch {
      // One listener failing never stops the others.
    }
  }
}

/** Called whenever the slot is released. Returns the unsubscribe. */
export function subscribeTourSlot(cb: () => void): () => void {
  slotListeners.add(cb);
  return () => {
    slotListeners.delete(cb);
  };
}

/** Whether a tour overlay is showing right now. */
export function isTourActive(): boolean {
  return owner !== null;
}
