/**
 * Calculator glue (NB-47a): wires P18's modes into the engine and P19's key machine, once.
 *
 * installCalc() = installModes() (registers ModeOps and the CONST table with the engine) and
 * setModeHooks(modeHooks) (EQN, INEQ, TABLE, RATIO, STAT, CONST and CONV for the key machine). Call
 * it before the first press or evaluate; calcStore and useCalculator do.
 *
 * The persisted form also lives here, because it is pure: encodeMachine(s) is the JSON string saved
 * under 'qu-student:notebooks:calc:v1' (bigints as decimal strings, through P19's encodePersist), and
 * decodeMachine(json) restores a machine from it (P19's decodePersist never throws; garbage gives a
 * fresh machine).
 *
 * This file stays free of React Native and of '@/' imports (relative imports with .ts extensions), so
 * the real-modes integration test (tests/notebook/calc/integration) runs it in plain Node.
 */
import { installModes, modeHooks } from '../core/calc/modes/index.ts';
import { decodePersist, encodePersist, initialMachine, persist, setModeHooks, type KeyState } from '../core/calc/keys/machine.ts';
import type { MachineState } from '../core/calc/types.ts';

let installed = false;

/** Registers the calculator modes and mode hooks. Safe to call any number of times. */
export function installCalc(): void {
  if (installed) return;
  installModes();
  setModeHooks(modeHooks);
  installed = true;
}

/** The saved form of a machine: JSON.stringify(encodePersist(persist(s))). */
export function encodeMachine(s: MachineState): string {
  return JSON.stringify(encodePersist(persist(s)));
}

/** What decodeMachine found in a saved string. */
export interface DecodedMachine {
  machine: KeyState;
  /** The string was present but not a version-1 calculator save (kept aside by the caller). */
  unreadable: boolean;
}

/**
 * Restores a machine from a saved string (null = nothing saved: a fresh machine). Never throws:
 * unparseable or foreign data gives a fresh machine with unreadable set; partly damaged data keeps
 * every part that is still valid.
 */
export function decodeMachine(json: string | null): DecodedMachine {
  installCalc();
  if (json === null || json === '') return { machine: initialMachine(), unreadable: false };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { machine: initialMachine(), unreadable: true };
  }
  const readable = typeof raw === 'object' && raw !== null && (raw as { v?: unknown }).v === 1;
  if (!readable) return { machine: initialMachine(), unreadable: true };
  return { machine: initialMachine(decodePersist(raw)), unreadable: false };
}
