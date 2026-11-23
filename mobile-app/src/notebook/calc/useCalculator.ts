/**
 * React access to the calculator (NB-47a): the machine, its LCD model and the actions.
 *
 * useCalculator() installs the modes, starts reading the saved state (calcStore.loadCalc) and
 * re-renders on every key. The LCD model (P19 layoutDisplay) is built by Lcd, which knows its width.
 */
import { useEffect, useSyncExternalStore } from 'react';

import type { KeyState } from '@/notebook/core/calc/keys/machine';
import type { KeyId } from '@/notebook/core/calc/types';

import { getCalcSnapshot, loadCalc, pressCalc, recallCalcHistory, setCalcCursor, subscribeCalc } from './calcStore';

export interface CalculatorApi {
  machine: KeyState;
  loaded: boolean;
  press(k: KeyId): void;
  /** Caret to an editor path (LCD tap). */
  setCursor(path: number[]): void;
  /** History row back into the editor. */
  recall(index: number): void;
}

export function useCalculator(): CalculatorApi {
  const snap = useSyncExternalStore(subscribeCalc, getCalcSnapshot, getCalcSnapshot);
  useEffect(() => {
    void loadCalc();
  }, []);
  return {
    machine: snap.machine,
    loaded: snap.loaded,
    press: pressCalc,
    setCursor: setCalcCursor,
    recall: recallCalcHistory,
  };
}
