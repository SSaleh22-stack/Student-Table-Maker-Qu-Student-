/**
 * When a backup run may start (P09). Pure: the service (P20) passes the current settings, network
 * state and its own timestamps, and gets a decision plus the status phase to show.
 *
 * Rules, in order:
 *  1. backup off (the default, NB-85)                       -> 'off'
 *  2. a run is already going                                -> 'running'
 *  3. the token was revoked (final; P20 also turns it off)  -> 'needs-sign-in'
 *  4. no connection / internet not reachable                -> 'offline'
 *  5. Wi-Fi only (the default, NB-86b) on a metered network -> 'waiting-wifi' (manual runs too: the
 *     switch is about mobile data cost, so the 'Back up now' button waits for Wi-Fi as well)
 *  6. manual run or just enabled                            -> run
 *  7. after failures: exponential backoff (1 min doubling, at most 6 h); a temporary 'signed-out'
 *     is retried this way too
 *  8. otherwise run only when something changed since the last good run, 2 minutes after the last
 *     change (debounce); a device that never ran runs now.
 * Wi-Fi and Ethernet count as unmetered. Cellular, Bluetooth, VPN (its carrier is unknown), other and
 * unknown types count as metered.
 */
import type { BackupError, BackupStatus } from '../contracts/backup.ts';

export const DEBOUNCE_MS = 2 * 60 * 1000;
export const BACKOFF_BASE_MS = 60 * 1000;
export const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

export type RunTrigger = 'change' | 'manual' | 'enabled' | 'foreground' | 'network' | 'timer';

export interface NetworkInfo {
  /** expo-network NetworkStateType value ('WIFI', 'CELLULAR', …); case does not matter. */
  type?: string | null;
  isConnected?: boolean | null;
  /** false means no internet; null or undefined means unknown (treated as reachable). */
  isInternetReachable?: boolean | null;
}

export interface PolicyInput {
  enabled: boolean;
  wifiOnly: boolean;
  /** null when the network state is not known yet. */
  network: NetworkInfo | null;
  running: boolean;
  trigger: RunTrigger;
  now: number;
  /** Time of the last local change (a notebook saved, library changed); null = none recorded. */
  lastChangeAt?: number | null;
  /**
   * START (snapshot time) of the last successful run; null = never. Not its end: a change saved while
   * the run was uploading came after the snapshot and must still count as unbacked.
   */
  lastRunAt?: number | null;
  /** Consecutive failed runs since the last good one. */
  failures?: number;
  lastFailureAt?: number | null;
  lastError?: BackupError | null;
  debounceMs?: number;
}

export type SkipReason = 'off' | 'running' | 'needs-sign-in' | 'offline' | 'waiting-wifi' | 'backoff' | 'debounce' | 'unchanged';

export type PolicyDecision =
  | { run: true; phase: 'running' }
  | { run: false; reason: SkipReason; phase: BackupStatus['phase']; /** When to ask again (backoff, debounce). */ retryAt?: number };

const UNMETERED = new Set(['WIFI', 'ETHERNET']);

export function isOnline(n: NetworkInfo | null): boolean {
  if (!n || n.isConnected !== true) return false;
  return n.isInternetReachable !== false;
}

export function isUnmetered(n: NetworkInfo | null): boolean {
  return !!n && typeof n.type === 'string' && UNMETERED.has(n.type.toUpperCase());
}

/** Delay before retry number `failures` (1 -> 1 min, 2 -> 2 min, … capped at 6 h). */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 20));
}

export function shouldRun(i: PolicyInput): PolicyDecision {
  if (!i.enabled) return { run: false, reason: 'off', phase: 'off' };
  if (i.running) return { run: false, reason: 'running', phase: 'running' };
  if (i.lastError === 'revoked') return { run: false, reason: 'needs-sign-in', phase: 'error' };
  if (!isOnline(i.network)) return { run: false, reason: 'offline', phase: i.wifiOnly ? 'waiting-wifi' : 'idle' };
  if (i.wifiOnly && !isUnmetered(i.network)) return { run: false, reason: 'waiting-wifi', phase: 'waiting-wifi' };
  if (i.trigger === 'manual' || i.trigger === 'enabled') return { run: true, phase: 'running' };

  const failures = i.failures ?? 0;
  const failedPhase: BackupStatus['phase'] = failures > 0 ? 'error' : 'idle';
  if (failures > 0 && i.lastFailureAt != null) {
    const retryAt = i.lastFailureAt + backoffMs(failures);
    if (i.now < retryAt) return { run: false, reason: 'backoff', phase: failedPhase, retryAt };
    // A failed run left work undone: retry even without a new change.
    return { run: true, phase: 'running' };
  }

  if (i.lastRunAt == null) return { run: true, phase: 'running' };
  if (i.lastChangeAt == null || i.lastChangeAt <= i.lastRunAt) return { run: false, reason: 'unchanged', phase: 'idle' };
  const retryAt = i.lastChangeAt + (i.debounceMs ?? DEBOUNCE_MS);
  if (i.now < retryAt) return { run: false, reason: 'debounce', phase: 'idle', retryAt };
  return { run: true, phase: 'running' };
}
