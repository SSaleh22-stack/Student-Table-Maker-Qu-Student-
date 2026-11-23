/**
 * usePlayback(): the player singleton, re-rendering the caller whenever its snapshot changes (at
 * most every 250 ms of position, plus play / pause / load / rate). The canvas should read
 * player.ms on the UI runtime instead of the position for per-frame work.
 */
import { useSyncExternalStore } from 'react';

import type { UsePlayback } from '@/notebook/contracts/audio';

import { player, type PlayerController, type PlayerSnapshot } from './player';

const getSnapshot = (): PlayerSnapshot => player.getSnapshot();

export const usePlayback: UsePlayback = (): PlayerController => {
  useSyncExternalStore(player.subscribe, getSnapshot, getSnapshot);
  return player;
};

/** The player's snapshot itself (title, ticks and playFromCount included). */
export function usePlaybackSnapshot(): PlayerSnapshot {
  return useSyncExternalStore(player.subscribe, getSnapshot, getSnapshot);
}
