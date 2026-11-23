import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { backoffMs, BACKOFF_MAX_MS, DEBOUNCE_MS, isOnline, isUnmetered, shouldRun } from '../../../src/notebook/core/backup/policy.ts';
import type { PolicyInput } from '../../../src/notebook/core/backup/policy.ts';

const NOW = 1_800_000_000_000;
const WIFI = { type: 'WIFI', isConnected: true, isInternetReachable: true };
const CELL = { type: 'CELLULAR', isConnected: true, isInternetReachable: true };

function input(o: Partial<PolicyInput> = {}): PolicyInput {
  return { enabled: true, wifiOnly: true, network: WIFI, running: false, trigger: 'change', now: NOW, lastRunAt: NOW - 3_600_000, lastChangeAt: NOW - DEBOUNCE_MS, ...o };
}

describe('shouldRun', () => {
  test('off until the student turns it on', () => {
    assert.deepEqual(shouldRun(input({ enabled: false, trigger: 'manual' })), { run: false, reason: 'off', phase: 'off' });
  });

  test('no overlap', () => {
    assert.equal(shouldRun(input({ running: true, trigger: 'manual' })).run, false);
  });

  test('Wi-Fi only holds on mobile data, even for a manual run', () => {
    for (const trigger of ['change', 'manual', 'enabled'] as const) {
      assert.deepEqual(shouldRun(input({ network: CELL, trigger })), { run: false, reason: 'waiting-wifi', phase: 'waiting-wifi' });
    }
    assert.equal(shouldRun(input({ network: { type: 'vpn', isConnected: true } })).run, false);
    assert.equal(shouldRun(input({ network: { type: 'unknown', isConnected: true } })).run, false);
  });

  test('mobile data is fine when the switch allows it; ethernet counts as Wi-Fi', () => {
    assert.equal(shouldRun(input({ network: CELL, wifiOnly: false })).run, true);
    assert.equal(shouldRun(input({ network: { type: 'ETHERNET', isConnected: true } })).run, true);
  });

  test('offline waits', () => {
    assert.equal(shouldRun(input({ network: null })).run, false);
    assert.deepEqual(shouldRun(input({ network: { type: 'WIFI', isConnected: true, isInternetReachable: false }, wifiOnly: false })), { run: false, reason: 'offline', phase: 'idle' });
    assert.equal(shouldRun(input({ network: { type: 'WIFI', isConnected: false } })).run, false);
  });

  test('2-minute debounce after the last change', () => {
    const d = shouldRun(input({ lastChangeAt: NOW - 30_000 }));
    assert.deepEqual(d, { run: false, reason: 'debounce', phase: 'idle', retryAt: NOW - 30_000 + DEBOUNCE_MS });
    assert.equal(shouldRun(input({ lastChangeAt: NOW - DEBOUNCE_MS })).run, true);
    assert.equal(shouldRun(input({ lastChangeAt: NOW - 30_000, trigger: 'manual' })).run, true);
  });

  test('nothing changed since the last run: no run; never ran: run', () => {
    assert.equal(shouldRun(input({ lastChangeAt: NOW - 7_200_000 })).run, false);
    assert.equal(shouldRun(input({ lastChangeAt: null, trigger: 'foreground' })).run, false);
    assert.equal(shouldRun(input({ lastRunAt: null, lastChangeAt: null, trigger: 'network' })).run, true);
  });

  test('failures back off exponentially, then retry without a new change', () => {
    const d = shouldRun(input({ failures: 3, lastFailureAt: NOW - 60_000, lastError: 'network' }));
    assert.deepEqual(d, { run: false, reason: 'backoff', phase: 'error', retryAt: NOW - 60_000 + 4 * 60_000 });
    assert.equal(shouldRun(input({ failures: 3, lastFailureAt: NOW - 5 * 60_000, lastChangeAt: null })).run, true);
    // A temporary sign-out is retried the same way (not final).
    assert.equal(shouldRun(input({ failures: 1, lastFailureAt: NOW - 61_000, lastError: 'signed-out' })).run, true);
  });

  test('revoked is final until the student signs in again', () => {
    assert.deepEqual(shouldRun(input({ lastError: 'revoked', trigger: 'manual' })), { run: false, reason: 'needs-sign-in', phase: 'error' });
  });

  test('helpers', () => {
    assert.equal(isUnmetered({ type: 'wifi' }), true);
    assert.equal(isUnmetered(null), false);
    assert.equal(isOnline({ isConnected: true, isInternetReachable: null }), true);
    assert.equal(backoffMs(0), 0);
    assert.equal(backoffMs(1), 60_000);
    assert.equal(backoffMs(100), BACKOFF_MAX_MS);
  });
});
