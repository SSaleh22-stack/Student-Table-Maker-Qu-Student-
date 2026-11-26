/**
 * The backup service (NB-85, NB-86, NB-86a, NB-86b, S6): one app-wide singleton.
 *
 * Provider: Google Drive on Android (driveProvider.ts); on iPhone and iPad the student picks iCloud
 * Drive (icloudProvider.ts, the default) or Google Drive (settings.backup.provider, setProvider, only
 * while backup is off); none on web (every call answers 'unavailable'). Switching provider clears
 * this device's backup bookkeeping (folder ids, what was uploaded), so the new place gets a full first
 * backup and nothing is ever deleted from either place.
 *
 * RULES
 * - Backup is OFF until the student turns it on (settings.backup.enabled, default false). Nothing
 *   listens, reads or uploads while it is off.
 * - Enabling: availability (iCloud on / sign-in configured and Play services), then Google sign-in
 *   on Android, then enabled. The enable flow (useEnableBackupFlow) first checks the remote for an
 *   existing backup and offers restore (prepareEnable + checkRemote).
 * - Deletes: only the planner decides (core/backup/plan.ts) and only for purged tombstones; the
 *   snapshot passes only purged ids this device uploaded or restored before. A fresh device, the
 *   first run, a notebook missing locally: never a delete.
 * - Revocation: a 'revoked' failure (silent sign-in SIGN_IN_REQUIRED or invalid_grant) turns backup
 *   off with lastError 'revoked' (shown as 'تم إيقاف النسخ الاحتياطي لأن الوصول إلى Google Drive
 *   أُلغي'). A temporary 401 is refreshed inside the Drive client; 'signed-out' and every other error
 *   keep backup on and are retried with backoff (1 min doubling, at most 6 h).
 * - Wi-Fi only (the default) holds every run, the 'Back up now' button too, until the device is on
 *   Wi-Fi or Ethernet (core/backup/policy.ts). A run that started on Wi-Fi stops when the device
 *   moves to mobile data (it resumes from the last checkpoint on Wi-Fi). The network state is read
 *   fresh unless the expo-network listener keeps it current.
 * - Triggers while on (and while useBackupAutoRun is mounted, NotebookServices only): a notebook
 *   saved (events.onSaved), a library change (events.onLibraryChanged), the app coming to the
 *   foreground, a network change, plus retry timers. Changes are debounced by 2 minutes.
 * - Runs never overlap; a restore waits for (cancels) a running backup and blocks new ones.
 * - Settings: this file writes only settings.backup { enabled, wifiOnly, lastBackupAt, lastError,
 *   lastCount, lastBytes, account } through the deep-merging setSettings. lastError holds a
 *   BackupError code ('' when none); backupErrorMessage() gives the text.
 *
 * ONE RUN
 *   availability -> (Drive) silent sign-in -> ensureRoot -> (iCloud) quota check -> read
 *   manifest.json (newer: stop; unreadable: keep a manifest.corrupt-<epoch>.json copy, then treat as
 *   missing) -> snapshot -> planBackup -> steps in order:
 *   uploads (JSON through writeText, read as saved; assets/audio through upload), checkpoint and
 *   final manifest writes (each saves lastUploaded; the final one the conflicts and libraryUploaded),
 *   library.json = merge(remote library.json, local), deletes (to the Drive trash on Android).
 *   Then the readable PDF copies in QU Student/PDF (pdfCopies.ts): one PDF per notebook, made again
 *   when it changed; restore never reads them.
 *   An OPEN notebook's JSON files are copied to a staging folder inside session.withWriteLock (which
 *   flushes first) before they are uploaded, so the upload sees one consistent save and saves are
 *   held only for the disk copy.
 */
import * as Device from 'expo-device';
import { AppState, Platform, type NativeEventSubscription } from 'react-native';

import { tr } from '@/lib/i18n';
import { backupErrorOf, BackupAbortError, DriveError, isAbortError } from '@/notebook/core/backup/drive';
import {
  LIBRARY_NAME,
  MANIFEST_NAME,
  NOTEBOOK_FILE,
  mergeLibraryData,
  parseManifest,
  rebaseManifest,
  remoteNotebooks,
  serializeManifest,
  summarizeManifest,
  type BackupManifest,
  type LibraryData,
  type ManifestEntry,
} from '@/notebook/core/backup/manifest';
import { copyTitle, planBackup, planRestore, RESTORE_SUFFIX, type BackupPlan, type RestoreAction } from '@/notebook/core/backup/plan';
import { backoffMs, DEBOUNCE_MS, isUnmetered, shouldRun, type NetworkInfo, type RunTrigger } from '@/notebook/core/backup/policy';
import {
  isBackupError,
  type AbortSignalLike,
  type BackupError,
  type BackupProviderKind,
  type BackupService,
  type BackupStatus,
  type CloudProvider,
  type RemoteCheck,
  type RemoteNotebook,
} from '@/notebook/core/contracts/backup';
import { readJsonRecovering, writeJsonAtomic } from '@/notebook/core/fs/journal';
import { safeExt } from '@/notebook/core/fs/layout';
import {
  isSafeId,
  makeLibraryFile,
  makeNotebookFile,
  newId,
  notebookOf,
  readLibraryFile,
  readNotebookFile,
  readPageFile,
  type Folder,
  type Id,
  type IsoDate,
  type LocationKey,
  type Notebook,
} from '@/notebook/core/model';
import { appVersion, nbFs } from '@/notebook/store/deps';
import { getNotebooksStore, notebookEvents, notebookRegistry } from '@/notebook/store/hooks';
import { indexStore } from '@/notebook/store/indexStore';
import { settingsStore } from '@/notebook/store/settingsStore';

import { getBackupState, loadBackupState, updateBackupState } from './backupStore';
import { createDriveProvider } from './driveProvider';
import { createIcloudProvider, icloudHelp } from './icloudProvider';
import { createOneDriveProvider } from './oneDriveProvider';
import { lastNetwork, readNetwork, subscribeNetwork } from './network';
import { resetPdfCopies, syncPdfCopies } from './pdfCopies';
import { buildSnapshot, localFilePath, readUploadText } from './snapshot';

// ===== provider type

/** CloudProvider plus the extras this service uses. */
export interface BackupProvider extends CloudProvider {
  /** interactive: the student is turning backup on (Play services may offer its update dialog). */
  availability(o?: { interactive?: boolean }): Promise<'ok' | BackupError>;
  /** bytes: the expected size (progress for providers that report percent). */
  download(rel: string, localPath: string, o?: { onProgress?(got: number): void; bytes?: number }): Promise<void>;
  /** A problem left by an earlier run (iCloud: the account is full). */
  problem?(): Promise<BackupError | null>;
  /** Sign in (Drive). interactive false = silent only. */
  signIn?(interactive: boolean): Promise<{ ok: true; account: string } | { ok: false; error: BackupError | 'cancelled' }>;
  signOut?(): Promise<void>;
  account?(): Promise<string | null>;
  /** Forget cached tokens and ids. */
  reset?(): void;
}

/** BackupStatus plus a detail for the one error that has no BackupError code of its own. */
export interface ServiceStatus extends BackupStatus {
  /** 'newer': the backup was written by a newer app version (update the app). */
  detail?: 'newer';
  /** A restore is running. */
  restoring: boolean;
  /** settings.backup.wifiOnly (NB-86b, default true). */
  wifiOnly: boolean;
}

export interface RestoreReport {
  /** Local ids created or replaced, in order. */
  restored: Id[];
  /** Remote ids that could not be restored. */
  failed: { id: Id; error: BackupError | 'no-space' | 'damaged' | 'newer' }[];
  /** Remote ids already on this device unchanged (or no longer in the backup). */
  skipped: Id[];
}

export interface BackupServiceImpl extends BackupService {
  status: ServiceStatus;
  /** Enable flow, step 1: availability, interactive sign-in (Android), then the remote check. */
  prepareEnable(): Promise<RemoteCheck | BackupError | 'cancelled'>;
  /** setEnabled(true) without the immediate first run (the student chose to restore first). */
  enableDeferred(): Promise<'ok' | 'cancelled' | BackupError>;
  restoreDetailed(ids: Id[], onProgress?: (done: number, total: number) => void): Promise<RestoreReport>;
  /** Signs in again after a 'signed-out' error (Android) and retries. */
  signInAgain(): Promise<'ok' | 'cancelled' | BackupError>;
  /** Stops the running backup (the next trigger starts over, resuming from the last checkpoint). */
  cancel(): void;
  /** Ref-counted auto-run (useBackupAutoRun). Returns the release. */
  startAutoRun(): () => void;
  /** iPhone / iPad: where backups go. Only while backup is off ('busy' otherwise). */
  setProvider(kind: BackupProviderKind): Promise<'ok' | 'busy' | 'unavailable'>;
}

/** Thrown by restore for local problems (no BackupError code fits). */
class RestoreError extends Error {
  code: 'no-space' | 'damaged' | 'newer';
  constructor(code: RestoreError['code'], message?: string) {
    super(message ?? code);
    this.name = 'RestoreError';
    this.code = code;
  }
}

// ===== messages

/** The text for a backup error (BackupSection, RestoreScreen). */
export function backupErrorMessage(code: BackupError, detail?: 'newer'): string {
  if (detail === 'newer') {
    return tr('هذه النسخة الاحتياطية من إصدار أحدث من التطبيق. حدّث التطبيق لمتابعة النسخ.', 'This backup was made by a newer version of the app. Update the app to continue.');
  }
  const kind = providerKindNow();
  const cloud = kind === 'onedrive' ? 'OneDrive' : 'Google Drive';
  const account = kind === 'onedrive' ? 'Microsoft' : 'Google';
  switch (code) {
    case 'icloud-off':
      return icloudHelp();
    case 'revoked':
      return tr(`تم إيقاف النسخ الاحتياطي لأن الوصول إلى ${cloud} أُلغي`, `Backup was turned off because access to ${cloud} was revoked`);
    case 'signed-out':
      return tr(`سجّل الدخول إلى ${account} لمتابعة النسخ الاحتياطي`, `Sign in to ${account} to continue the backup`);
    case 'no-play-services':
      return tr('خدمات Google Play غير متوفرة على هذا الجهاز', 'Google Play services are not available on this device');
    case 'unavailable':
      return tr('النسخ الاحتياطي غير متاح في هذا الإصدار من التطبيق', 'Backup is not available in this version of the app');
    case 'quota':
      return kind === 'icloud'
        ? tr('مساحة iCloud ممتلئة. أفرغ بعض المساحة لمتابعة النسخ.', 'Your iCloud storage is full. Free up space to continue the backup.')
        : tr(`مساحة ${cloud} ممتلئة. أفرغ بعض المساحة لمتابعة النسخ.`, `Your ${cloud} is full. Free up space to continue the backup.`);
    case 'network':
      return tr('تعذّر الاتصال بالإنترنت. ستُعاد المحاولة تلقائياً.', "Couldn't connect. It will try again automatically.");
    default:
      return tr('تعذّر إكمال النسخ الاحتياطي. ستُعاد المحاولة لاحقاً.', "Couldn't finish the backup. It will try again later.");
  }
}

// ===== provider

/** Where backups can go on this device, the default first. */
export const providerChoices: readonly BackupProviderKind[] =
  Platform.OS === 'ios' ? ['icloud', 'gdrive', 'onedrive'] : Platform.OS === 'android' ? ['gdrive', 'onedrive'] : [];

/** The student can choose where backups go (iOS and Android). */
export const canChooseProvider = providerChoices.length > 1;

/** Where backups go now: the saved choice when this device offers it, else the default. */
function providerKindNow(): BackupProviderKind {
  const saved = backupSettings().provider;
  if (saved && providerChoices.includes(saved)) return saved;
  return providerChoices[0] ?? 'icloud';
}

let providerInstance: BackupProvider | null = null;
let providerInstanceKind: BackupStatus['provider'] | null = null;

function provider(): BackupProvider | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  const kind = providerKindNow();
  if (!providerInstance || providerInstanceKind !== kind) {
    providerInstance = kind === 'gdrive' ? createDriveProvider() : kind === 'onedrive' ? createOneDriveProvider() : createIcloudProvider();
    providerInstanceKind = kind;
  }
  return providerInstance;
}

function deviceName(): string {
  const name = Device.deviceName || Device.modelName || (Platform.OS === 'ios' ? 'iPhone' : 'Android');
  return String(name).slice(0, 100);
}

const nowIso = (): string => new Date().toISOString();

const errorOf = (e: unknown): BackupError => (e instanceof DriveError ? e.code : 'unknown');

function fail(code: BackupError, message: string): never {
  throw new DriveError(code, message);
}

// ===== runtime state

const statusListeners = new Set<() => void>();
let running: { abort: AbortController; promise: Promise<void> } | null = null;
let restoring = false;
let progress: { done: number; total: number } | undefined;
let waitingWifi = false;
let detail: 'newer' | undefined;
let failures = 0;
let lastFailureAt: number | null = null;
let lastChangeAt: number | null = null;
let lastRunAt: number | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAt = 0;
let wired = false;
let autoUsers = 0;
let detachTriggers: (() => void) | null = null;
/** 'Back up now' was pressed while the policy held the run (Wi-Fi only): run as manual when allowed. */
let pendingManual = false;
/** The library is still loading: no run (and no failure) before this time. */
let notReadyUntil = 0;
/** Enabled with 'restore first': automatic runs wait for the restore (at most HOLD_MS). */
let heldUntil = 0;
const HOLD_MS = 10 * 60 * 1000;

const backupSettings = () => settingsStore.get().backup;

function setBackupSettings(patch: Partial<ReturnType<typeof backupSettings>>): void {
  settingsStore.set({ backup: patch });
}

/** The error saved in settings (a BackupError code), or undefined. */
function savedError(): BackupError | undefined {
  const e = backupSettings().lastError;
  return e && isBackupError(e) ? e : e ? 'unknown' : undefined;
}

let statusCache: ServiceStatus | null = null;
let statusKey = '';

function computeStatus(): ServiceStatus {
  const b = backupSettings();
  const error = savedError();
  const phase: BackupStatus['phase'] = !b.enabled ? 'off' : running ? 'running' : waitingWifi ? 'waiting-wifi' : error ? 'error' : 'idle';
  const conflicts = getBackupState()?.conflicts ?? [];
  const s: ServiceStatus = { enabled: b.enabled, provider: providerKindNow(), phase, conflicts, restoring, wifiOnly: b.wifiOnly };
  if (b.lastBackupAt) s.lastBackupAt = b.lastBackupAt;
  if (b.lastCount !== undefined) s.lastCount = b.lastCount;
  if (b.lastBytes !== undefined) s.lastBytes = b.lastBytes;
  if (error) s.error = error;
  if (detail && error) s.detail = detail;
  if (running && progress) s.progress = { done: progress.done, total: progress.total };
  if (b.account) s.account = b.account;
  const key = JSON.stringify(s);
  if (statusCache && key === statusKey) return statusCache;
  statusKey = key;
  statusCache = s;
  return s;
}

function notify(): void {
  computeStatus();
  for (const cb of [...statusListeners]) {
    try {
      cb();
    } catch {
      // A listener failing never stops the others.
    }
  }
}

let lastRunSeeded = false;

/**
 * lastRunAt starts from settings.backup.lastBackupAt once the settings are read (before that they
 * are the defaults, and a missing lastRunAt would mean a run at every app start).
 */
function seedLastRun(): void {
  if (lastRunSeeded || !settingsStore.isLoaded()) return;
  lastRunSeeded = true;
  // The conflict note of the last run (kept in the backup state) shows before the next run.
  if (backupSettings().enabled && !getBackupState()) void loadBackupState().then(() => notify(), () => {});
  if (lastRunAt !== null) return;
  const b = backupSettings();
  const t = b.lastBackupAt ? Date.parse(b.lastBackupAt) : NaN;
  lastRunAt = Number.isFinite(t) ? t : null;
}

/** Settings are watched once (status, and the auto-run listeners follow enabled). */
function wire(): void {
  if (wired) return;
  wired = true;
  settingsStore.subscribe(() => {
    seedLastRun();
    syncTriggers();
    notify();
  });
  seedLastRun();
}

/**
 * Wi-Fi only (NB-86b): a run that started on Wi-Fi stops when the device moves to mobile data (or
 * loses the connection). It is not a failure; the next run resumes from the last checkpoint.
 */
function stopIfMetered(n: NetworkInfo | null): void {
  if (!running || restoring || !n || !backupSettings().wifiOnly) return;
  if (!isUnmetered(n)) running.abort.abort();
}

// ===== scheduling

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryAt = 0;
}

function scheduleAt(t: number): void {
  if (retryTimer && retryAt <= t) return;
  clearRetry();
  retryAt = t;
  retryTimer = setTimeout(
    () => {
      retryTimer = null;
      retryAt = 0;
      void evaluate('timer');
    },
    Math.max(1000, t - Date.now()),
  );
}

/** Asks the policy whether to run now, and starts the run (or a timer). */
async function evaluate(trigger: RunTrigger): Promise<void> {
  wire();
  if (!provider()) return;
  if (Date.now() < notReadyUntil) {
    scheduleAt(notReadyUntil);
    return;
  }
  if (trigger !== 'manual' && Date.now() < heldUntil) {
    scheduleAt(heldUntil);
    return;
  }
  const network = lastNetwork() ?? (await readNetwork());
  const b = backupSettings();
  if (trigger === 'manual') pendingManual = true;
  if (pendingManual && trigger !== 'manual') trigger = 'manual';
  const d = shouldRun({
    enabled: b.enabled,
    wifiOnly: b.wifiOnly,
    network,
    running: !!running || restoring,
    trigger,
    now: Date.now(),
    lastChangeAt,
    lastRunAt,
    failures,
    lastFailureAt,
    lastError: savedError() ?? null,
  });
  const wasWaiting = waitingWifi;
  if (!b.enabled) pendingManual = false;
  if (d.run) {
    waitingWifi = false;
    pendingManual = false;
    startRun();
  } else {
    if (d.reason !== 'running') waitingWifi = d.reason === 'waiting-wifi';
    if (d.retryAt) scheduleAt(d.retryAt);
  }
  if (wasWaiting !== waitingWifi) notify();
}

function startRun(): Promise<void> {
  if (running) return running.promise;
  clearRetry();
  const abort = new AbortController();
  progress = undefined;
  const promise = (async () => {
    const startedAt = Date.now();
    try {
      await runBackup(abort.signal as AbortSignalLike);
      failures = 0;
      lastFailureAt = null;
      lastRunAt = startedAt;
      detail = undefined;
    } catch (e) {
      if (isAbortError(e) || abort.signal.aborted) return;
      if (e instanceof NotReadyError) {
        notReadyUntil = Date.now() + NOT_READY_RETRY_MS;
        return;
      }
      onRunFailed(e);
    }
  })().finally(() => {
    running = null;
    progress = undefined;
    notify();
    // Changes made during the run (or a retry) are picked up now.
    void evaluate('timer');
  });
  running = { abort, promise };
  notify();
  return promise;
}

function onRunFailed(e: unknown): void {
  const code = errorOf(e);
  if (code === 'revoked') {
    // Final: access is gone. Turn backup off with the message (NB-86a).
    provider()?.reset?.();
    failures = 0;
    lastFailureAt = null;
    setBackupSettings({ enabled: false, lastError: 'revoked', account: '' });
    return;
  }
  failures++;
  lastFailureAt = Date.now();
  setBackupSettings({ lastError: code });
  scheduleAt(lastFailureAt + backoffMs(failures));
}

// ===== triggers (only while backup is on and the auto-run is mounted)

function latestLocalChange(): number | null {
  let t = 0;
  const f = indexStore.get();
  for (const e of f.entries) {
    t = Math.max(t, Date.parse(e.updatedAt) || 0, e.deletedAt ? Date.parse(e.deletedAt) || 0 : 0);
  }
  for (const p of f.purged) t = Math.max(t, Date.parse(p.at) || 0);
  return t > 0 ? t : null;
}

function attachTriggers(): () => void {
  const changed = () => {
    lastChangeAt = Date.now();
    void evaluate('change');
  };
  const offSaved = notebookEvents.onSaved(changed);
  const offLibrary = notebookEvents.onLibraryChanged(changed);
  const app: NativeEventSubscription = AppState.addEventListener('change', (s) => {
    if (s === 'active') void evaluate('foreground');
  });
  const offNetwork = subscribeNetwork((n) => {
    stopIfMetered(n);
    void evaluate('network');
  });
  // Anything changed since the last good run (the app may have been closed during the debounce).
  const local = latestLocalChange();
  if (local !== null && (lastChangeAt === null || local > lastChangeAt)) lastChangeAt = local;
  void evaluate('foreground');
  return () => {
    offSaved();
    offLibrary();
    app.remove();
    offNetwork();
  };
}

function syncTriggers(): void {
  const on = autoUsers > 0 && backupSettings().enabled && !!provider();
  if (on && !detachTriggers) detachTriggers = attachTriggers();
  else if (!on && detachTriggers) {
    detachTriggers();
    detachTriggers = null;
    clearRetry();
    if (waitingWifi) {
      waitingWifi = false;
      notify();
    }
  }
}

// ===== remote reads

async function connect(interactive: boolean): Promise<BackupProvider> {
  const p = provider();
  if (!p) fail('unavailable', 'no backup provider on this platform');
  const a = await p.availability({ interactive });
  if (a !== 'ok') fail(a, `provider ${a}`);
  if (p.signIn) {
    const r = await p.signIn(interactive);
    if (!r.ok) {
      if (r.error === 'cancelled') throw new CancelledError();
      fail(r.error, `sign-in ${r.error}`);
    }
    if (r.account && r.account !== backupSettings().account && backupSettings().enabled) setBackupSettings({ account: r.account });
  }
  await p.ensureRoot();
  return p;
}

class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

/** The remote manifest: null when there is none (or it was unreadable and was kept aside). */
async function readRemoteManifest(p: BackupProvider, keepCorrupt: boolean): Promise<BackupManifest | null> {
  return manifestFromText(p, await p.readText(MANIFEST_NAME), keepCorrupt);
}

async function manifestFromText(p: BackupProvider, text: string | null, keepCorrupt: boolean): Promise<BackupManifest | null> {
  const parsed = parseManifest(text);
  if (parsed.ok) return parsed.manifest;
  if (parsed.reason === 'newer') {
    detail = 'newer';
    fail('unknown', 'manifest written by a newer app');
  }
  if (parsed.reason === 'invalid' && text !== null && keepCorrupt) {
    // Keep a copy so no other device's entry list is lost for good, then start a new manifest.
    await p.writeText(`manifest.corrupt-${Date.now()}.json`, text);
  }
  return null;
}

/** The remote library.json (null when missing or unreadable; an unreadable one is kept aside). */
async function readRemoteLibrary(p: BackupProvider, keepCorrupt: boolean): Promise<LibraryData | null> {
  const text = await p.readText(LIBRARY_NAME);
  if (text === null) return null;
  try {
    const f = readLibraryFile(JSON.parse(text));
    if (f) return { folders: f.folders, courseNames: f.courseNames };
  } catch {
    // Unreadable: below.
  }
  if (keepCorrupt) await p.writeText(`library.corrupt-${Date.now()}.json`, text);
  return null;
}

// ===== one backup run

interface Staging {
  id: Id;
  dir: string;
  notebooks: Set<Id>;
}

const NOT_READY_RETRY_MS = 5000;

/** The library or the settings are not read yet: try again shortly, not a failure. */
class NotReadyError extends Error {
  constructor() {
    super('not ready');
    this.name = 'NotReadyError';
  }
}

async function runBackup(signal: AbortSignalLike): Promise<void> {
  if (!indexStore.isReadOk() || !settingsStore.isReadOk()) {
    // The library is still loading (or could not be read): never plan from an empty index.
    throw new NotReadyError();
  }
  const state = await loadBackupState();
  if (!state) fail('unknown', 'backup state unreadable');
  const p = await connect(false);
  if (p.problem) {
    const prob = await p.problem();
    if (prob) fail(prob, `provider problem ${prob}`);
  }
  if (signal.aborted) throw new BackupAbortError();
  const remoteText = await p.readText(MANIFEST_NAME);
  const remote = await manifestFromText(p, remoteText, true);
  const { snapshot, library } = await buildSnapshot(state, signal);
  if (signal.aborted) throw new BackupAbortError();
  const now = nowIso();
  const plan = planBackup(snapshot, remote, deviceName(), { now });
  progress = { done: 0, total: plan.totalBytes };
  notify();

  const staging: { current: Staging | null } = { current: null };
  let written: BackupManifest = plan.manifest;
  try {
    written = (await runSteps(p, plan, remote, remoteText, snapshot.deviceId, library, snapshot.libraryRev, signal, staging)) ?? plan.manifest;
  } finally {
    if (staging.current) await getNotebooksStore()?.endStagingJob(staging.current.id).catch(() => {});
  }

  if (!plan.changed) {
    await updateBackupState((s) => ({ ...s, conflicts: plan.skippedConflicts }));
  }
  let count = 0;
  let bytes = 0;
  for (const id of Object.keys(written.notebooks)) {
    const e = written.notebooks[id];
    if (e.deletedAt) continue;
    count++;
    bytes += e.bytes;
  }
  setBackupSettings({ lastBackupAt: now, lastError: '', lastCount: count, lastBytes: bytes });

  // The readable PDF copies beside the backup (QU Student/PDF). Never fails the backup run.
  await syncPdfCopies(providerKindNow(), signal);
}

/**
 * Runs the plan's steps. Returns the manifest written last (null when none was written).
 * remote is the manifest the plan was made from (remoteText its raw text): each manifest write re-reads manifest.json and, when
 * another device wrote it meanwhile, rebases this run's entries onto it (no lost update).
 */
async function runSteps(
  p: BackupProvider,
  plan: BackupPlan,
  remote: BackupManifest | null,
  remoteText: string | null,
  deviceId: string,
  library: LibraryData,
  libraryRev: number,
  signal: AbortSignalLike,
  staging: { current: Staging | null },
): Promise<BackupManifest | null> {
  let done = 0;
  let written: BackupManifest | null = null;
  // Ids another device changed while this run was uploading (theirs kept, ours not written).
  const raced = new Set<Id>();
  const report = (n: number) => {
    progress = { done: Math.min(plan.totalBytes, n), total: plan.totalBytes };
    notify();
  };
  for (const step of plan.steps) {
    if (signal.aborted) throw new BackupAbortError();
    switch (step.op) {
      case 'upload': {
        const it = step.item;
        if (it.kind === 'page' || it.kind === 'notebook') {
          const text = await jsonText(plan, it.notebookId, it.file, staging);
          if (text === null) {
            // notebook.json is required; a page that vanished reads as blank on restore.
            if (it.kind === 'notebook') fail('unknown', `unreadable ${it.rel}`);
          } else {
            await p.writeText(it.rel, text);
          }
        } else {
          const base = done;
          await p.upload(localFilePath(it.notebookId, it.file), it.rel, {
            mime: it.mime,
            bytes: it.bytes,
            signal,
            onProgress: (sent) => report(base + sent),
          });
        }
        done += it.bytes;
        report(done);
        break;
      }
      case 'library': {
        const remoteLib = await readRemoteLibrary(p, true);
        const merged = mergeLibraryData(remoteLib, library);
        const file = makeLibraryFile(merged, { rev: step.libraryRev, savedAt: nowIso() });
        await p.writeText(step.rel, JSON.stringify(file));
        break;
      }
      case 'delete':
        await p.remove(step.rel);
        break;
      case 'manifest': {
        // Read manifest.json again just before writing: another device may have written it meanwhile.
        const freshText = await p.readText(step.rel);
        const parsed = parseManifest(freshText);
        if (!parsed.ok && parsed.reason === 'newer') {
          detail = 'newer';
          fail('unknown', 'manifest written by a newer app');
        }
        // The unreadable manifest this run started from was kept aside and is replaced; any other
        // unreadable one appeared during the run: stop rather than overwrite it.
        if (!parsed.ok && parsed.reason === 'invalid' && !(remote === null && freshText === remoteText)) {
          fail('unknown', 'manifest became unreadable during the run');
        }
        const fresh = parsed.ok ? parsed.manifest : null;
        const sameAsPlanned = fresh === null ? remote === null : remote !== null && serializeManifest(fresh) === serializeManifest(remote);
        let text = step.text;
        let manifest = step.manifest;
        let conflicts: Id[] = [];
        if (!sameAsPlanned) {
          const rebased = rebaseManifest(remote, fresh, step.mine, deviceId, deviceName());
          manifest = rebased.manifest;
          text = serializeManifest(manifest);
          conflicts = rebased.conflicts;
        }
        if (signal.aborted) throw new BackupAbortError();
        await p.writeText(step.rel, text);
        written = manifest;
        for (const id of conflicts) raced.add(id);
        const final = step.final;
        await updateBackupState((s) => {
          const lastUploaded = { ...step.lastUploaded };
          for (const id of conflicts) {
            // Not written: keep the rev this device last uploaded for it, so the next run plans it again.
            if (Object.prototype.hasOwnProperty.call(s.lastUploaded, id)) lastUploaded[id] = s.lastUploaded[id];
            else delete lastUploaded[id];
          }
          const next = { ...s, lastUploaded };
          const ids = new Set<Id>(final ? plan.skippedConflicts : s.conflicts);
          for (const id of raced) ids.add(id);
          next.conflicts = [...ids].sort();
          if (final && plan.uploadLibrary) next.libraryUploaded = libraryRev;
          return next;
        });
        break;
      }
    }
  }
  return written;
}

const stagedName = (file: string) => file.replace(/\//g, '__');

/**
 * The text of a notebook JSON file to upload. An open notebook's planned JSON files are first
 * copied to staging inside its write lock (one consistent save); a closed one is read directly.
 */
async function jsonText(plan: BackupPlan, notebookId: Id, file: string, staging: { current: Staging | null }): Promise<string | null> {
  const st = staging.current;
  if (st && st.notebooks.has(notebookId)) return nbFs.readText(nbFs.join(st.dir, notebookId, stagedName(file)));
  let session = null;
  try {
    session = notebookRegistry().get(notebookId);
  } catch {
    session = null;
  }
  if (!session) return readUploadText(notebookId, file);
  const store = getNotebooksStore();
  if (!store) return session.withWriteLock(() => readUploadText(notebookId, file));
  if (!staging.current) {
    const job = await store.stagingJob();
    staging.current = { id: job.id, dir: job.dir, notebooks: new Set() };
  }
  const cur = staging.current;
  const dir = nbFs.join(cur.dir, notebookId);
  const files = plan.uploads.filter((u) => u.notebookId === notebookId && (u.kind === 'page' || u.kind === 'notebook')).map((u) => u.file);
  await session.withWriteLock(async () => {
    await nbFs.mkdirp(dir);
    for (const f of files) {
      const text = await readUploadText(notebookId, f);
      const path = nbFs.join(dir, stagedName(f));
      if (text === null) await nbFs.remove(path);
      else await nbFs.writeText(path, text);
    }
  });
  cur.notebooks.add(notebookId);
  return nbFs.readText(nbFs.join(dir, stagedName(file)));
}

// ===== restore

function locationOf(entry: ManifestEntry, folders: readonly Folder[]): LocationKey {
  if (entry.folderId && folders.some((f) => f.id === entry.folderId)) return { kind: 'folder', id: entry.folderId };
  if (entry.courseCode) return { kind: 'course', code: entry.courseCode };
  return { kind: 'unfiled' };
}

/** Puts back folders and course names this device does not have (S6: a new phone). */
async function restoreLibrary(p: BackupProvider): Promise<void> {
  if (!indexStore.isReadOk()) return;
  const lib = await readRemoteLibrary(p, false);
  if (!lib) return;
  indexStore.update((f) => {
    const have = new Set(f.folders.map((x) => x.id));
    const missing = lib.folders.filter((x) => isSafeId(x.id) && !have.has(x.id));
    const names = { ...f.courseNames };
    let namesChanged = false;
    for (const code of Object.keys(lib.courseNames)) {
      if (code === '__proto__' || Object.prototype.hasOwnProperty.call(names, code)) continue;
      names[code] = lib.courseNames[code];
      namesChanged = true;
    }
    if (missing.length === 0 && !namesChanged) return f;
    let order = f.folders.reduce((m, x) => Math.max(m, x.order), -1);
    const added = [...missing].sort((a, b) => a.order - b.order).map((x) => ({ ...x, order: ++order }));
    return { ...f, folders: [...f.folders, ...added], courseNames: names };
  });
}

function referencedFiles(nb: Notebook): Set<string> {
  const out = new Set<string>();
  for (const pid of nb.pageIds) out.add(`pages/${pid}.json`);
  for (const aid of Object.keys(nb.assets)) {
    const a = nb.assets[aid];
    out.add(`${a.kind === 'audio' ? 'audio' : 'assets'}/${a.id}.${safeExt(a.ext)}`);
  }
  return out;
}

const isOpen = (id: Id): boolean => {
  try {
    return notebookRegistry().get(id) !== null;
  } catch {
    return false;
  }
};

function freshId(taken: (id: Id) => boolean): Id {
  for (let i = 0; i < 100; i++) {
    const id = newId();
    if (!taken(id)) return id;
  }
  throw new Error('newId keeps colliding');
}

type Doable = Exclude<RestoreAction, { action: 'skip' }>;

async function restoreOne(p: BackupProvider, action: Doable, suffix: string, taken: Set<Id>, report: (n: number) => void): Promise<Id> {
  const store = getNotebooksStore();
  if (!store) throw new RestoreError('damaged', 'store not mounted');
  let act: Doable = action;
  // Never replace a notebook that is open (the editor may hold it): keep both instead.
  if (act.action === 'replace' && isOpen(act.targetId)) {
    const targetId = freshId((id) => taken.has(id) || store.entries.some((e) => e.id === id));
    taken.add(targetId);
    act = { action: 'copy', id: act.id, entry: act.entry, files: act.files, targetId, title: copyTitle(act.entry.title, suffix) };
  }
  const entry = act.entry;
  const job = await store.stagingJob();
  try {
    const dir = nbFs.join(job.dir, 'nb');
    await nbFs.mkdirp(dir);
    const nbPath = nbFs.join(dir, NOTEBOOK_FILE);
    await p.download(`${act.id}/${NOTEBOOK_FILE}`, nbPath, { bytes: entry.files[NOTEBOOK_FILE]?.bytes });
    const r = await readJsonRecovering(nbFs, nbPath, readNotebookFile, nbFs.join(dir, 'quarantine'), { repair: false });
    if (!r.ok || r.value.id !== act.id) throw new RestoreError('damaged', 'notebook.json');
    const nbFile = r.value;
    const nb = notebookOf(nbFile);

    // Only what this notebook.json uses (the backup keeps files of older saves too).
    const wanted = referencedFiles(nb);
    const files = act.files.filter((f) => f !== NOTEBOOK_FILE && wanted.has(f) && Object.prototype.hasOwnProperty.call(entry.files, f));
    let need = 0;
    for (const f of files) need += entry.files[f].bytes;
    const free = store.isLowStorage(need).freeBytes;
    if (free > 0 && free < need + 64 * 1024 * 1024) throw new RestoreError('no-space');

    for (const sub of ['pages', 'assets', 'audio']) await nbFs.mkdirp(nbFs.join(dir, sub));
    let got = entry.files[NOTEBOOK_FILE]?.bytes ?? 0;
    report(got);
    for (const f of files) {
      const path = nbFs.join(dir, ...f.split('/'));
      const expected = entry.files[f].bytes;
      const base = got;
      const isPage = f.startsWith('pages/');
      try {
        await p.download(`${act.id}/${f}`, path, { bytes: expected, onProgress: (n) => report(base + n) });
      } catch (e) {
        if (isAbortError(e)) throw e;
        // A page missing from the backup reads as a blank page; anything else stops this notebook.
        if (isPage && e instanceof DriveError && e.status === 404) {
          got += expected;
          continue;
        }
        throw e;
      }
      if (isPage) {
        let ok = false;
        try {
          ok = readPageFile(JSON.parse((await nbFs.readText(path)) ?? '')) !== null;
        } catch {
          ok = false;
        }
        if (!ok) await nbFs.remove(path);
      } else if (expected > 0 && (await nbFs.size(path)) !== expected) {
        throw new RestoreError('damaged', `size of ${f}`);
      }
      got = base + expected;
      report(got);
    }

    // notebook.json: the manifest carries the latest title (renames only touch the index), the
    // notebook comes back out of the trash, and a copy gets its new id and title.
    const copy = act.action === 'copy';
    const out: Notebook = { ...nb, removedPageIds: [] };
    delete out.deletedAt;
    if (copy) {
      out.id = act.targetId;
      out.title = act.title;
      out.origin = { kind: 'restore', name: entry.title };
    } else if (act.title) {
      out.title = act.title;
    }
    const needsWrite = copy || nb.deletedAt !== undefined || nb.removedPageIds.length > 0 || out.title !== nb.title;
    if (r.readOnly) {
      // Saved by a newer app: it cannot be rewritten (a copy needs a new id inside it).
      if (copy) throw new RestoreError('newer');
    } else if (needsWrite) {
      await writeJsonAtomic(nbFs, nbPath, makeNotebookFile(out, { rev: nbFile.rev + 1, savedAt: nowIso(), app: appVersion }));
    }

    const location = locationOf(entry, indexStore.get().folders);
    if (act.action === 'replace') {
      const targetId = act.targetId;
      // Forget our upload record first: if the app dies between the purge and the adopt, the purged
      // tombstone must not delete the backup (only ids in lastUploaded are ever deleted).
      await updateBackupState((s) => {
        if (!Object.prototype.hasOwnProperty.call(s.lastUploaded, targetId)) return s;
        const lastUploaded = { ...s.lastUploaded };
        delete lastUploaded[targetId];
        return { ...s, lastUploaded };
      });
      await store.purgeNotebook(targetId);
    }
    const id = await store.adoptFolder(dir, location);
    if (act.action === 'restore' || act.action === 'replace') {
      const rev = act.lastUploaded;
      await updateBackupState((s) => ({ ...s, lastUploaded: { ...s.lastUploaded, [id]: rev } }));
    }
    store.requestThumb(id);
    return id;
  } finally {
    await store.endStagingJob(job.id).catch(() => {});
  }
}

async function restoreDetailed(ids: Id[], onProgress?: (done: number, total: number) => void): Promise<RestoreReport> {
  if (restoring) fail('unknown', 'a restore is already running');
  restoring = true;
  heldUntil = 0;
  notify();
  const report: RestoreReport = { restored: [], failed: [], skipped: [] };
  try {
    if (running) {
      running.abort.abort();
      await running.promise.catch(() => {});
    }
    const store = getNotebooksStore();
    if (!store || !indexStore.isReadOk()) fail('unknown', 'library not loaded');
    const state = await loadBackupState();
    if (!state) fail('unknown', 'backup state unreadable');
    const p = await connect(false);
    const remote = await readRemoteManifest(p, false);
    await restoreLibrary(p);
    const suffix = tr(RESTORE_SUFFIX, ' (backup)');
    const local = store.entries.map((e) => ({ id: e.id, updatedAt: e.updatedAt, contentRev: e.contentRev }));
    const actions = planRestore(remote, local, ids, { suffix, lastUploaded: state.lastUploaded, newId: () => newId() });
    const taken = new Set<Id>([...local.map((e) => e.id), ...Object.keys(remote?.notebooks ?? {})]);
    for (const a of actions) if (a.action !== 'skip') taken.add(a.targetId);
    let total = 0;
    for (const a of actions) if (a.action !== 'skip') for (const k of Object.keys(a.entry.files)) total += a.entry.files[k].bytes;
    let done = 0;
    onProgress?.(0, total);
    for (const a of actions) {
      if (a.action === 'skip') {
        report.skipped.push(a.id);
        continue;
      }
      let size = 0;
      for (const k of Object.keys(a.entry.files)) size += a.entry.files[k].bytes;
      const base = done;
      try {
        const id = await restoreOne(p, a, suffix, taken, (n) => onProgress?.(Math.min(total, base + n), total));
        report.restored.push(id);
      } catch (e) {
        const error = e instanceof RestoreError ? e.code : errorOf(e);
        report.failed.push({ id: a.id, error });
        // Access problems stop the whole restore; the next notebooks would fail the same way.
        if (error === 'revoked' || error === 'signed-out' || error === 'icloud-off' || error === 'unavailable') {
          for (const rest of actions.slice(actions.indexOf(a) + 1)) {
            if (rest.action === 'skip') report.skipped.push(rest.id);
            else report.failed.push({ id: rest.id, error });
          }
          break;
        }
      }
      done = base + size;
      onProgress?.(Math.min(total, done), total);
    }
    return report;
  } finally {
    restoring = false;
    lastChangeAt = Date.now();
    notify();
    void evaluate('timer');
  }
}

// ===== enable, sign-in

async function remoteCheck(interactive: boolean): Promise<RemoteCheck | BackupError | 'cancelled'> {
  wire();
  try {
    const state = await loadBackupState();
    if (!state) return 'unknown';
    const p = await connect(interactive);
    detail = undefined;
    const m = await readRemoteManifest(p, false);
    return summarizeManifest(m, state.deviceId);
  } catch (e) {
    if (e instanceof CancelledError) return 'cancelled';
    notify();
    return errorOf(e);
  }
}

async function enable(deferRun: boolean): Promise<'ok' | 'cancelled' | BackupError> {
  wire();
  const p = provider();
  if (!p) return 'unavailable';
  const a = await p.availability({ interactive: true });
  if (a !== 'ok') return a;
  let account: string | undefined;
  if (p.signIn) {
    const r = await p.signIn(true);
    if (!r.ok) return r.error;
    account = r.account;
  }
  const state = await loadBackupState();
  if (!state) return 'unknown';
  failures = 0;
  lastFailureAt = null;
  detail = undefined;
  // The first run after enabling happens as soon as the policy allows (on Wi-Fi), change or not.
  lastRunAt = null;
  heldUntil = deferRun ? Date.now() + HOLD_MS : 0;
  setBackupSettings(account ? { enabled: true, lastError: '', account } : { enabled: true, lastError: '' });
  syncTriggers();
  if (!deferRun) void evaluate('enabled');
  return 'ok';
}

async function disable(): Promise<'ok'> {
  wire();
  heldUntil = 0;
  running?.abort.abort();
  clearRetry();
  failures = 0;
  lastFailureAt = null;
  detail = undefined;
  // An old error ('network', 'quota'…) means nothing once backup is off.
  setBackupSettings({ enabled: false, lastError: '' });
  syncTriggers();
  return 'ok';
}

// ===== the service object

function subscribe(cb: () => void): () => void {
  wire();
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

export const backupService: BackupServiceImpl = {
  get status(): ServiceStatus {
    wire();
    return computeStatus();
  },
  subscribe,

  async checkRemote() {
    const r = await remoteCheck(false);
    return r === 'cancelled' ? 'signed-out' : r;
  },

  prepareEnable: () => remoteCheck(true),

  setEnabled: (on) => (on ? enable(false) : disable()),

  enableDeferred: () => enable(true),

  setWifiOnly(on) {
    wire();
    setBackupSettings({ wifiOnly: on });
    if (on && running) void readNetwork().then(stopIfMetered);
    void evaluate('network');
  },

  async runNow() {
    wire();
    await evaluate('manual');
    if (running) await running.promise;
  },

  async listRemote(): Promise<RemoteNotebook[]> {
    wire();
    const p = await connect(false);
    detail = undefined;
    const m = await readRemoteManifest(p, false);
    const store = getNotebooksStore();
    return remoteNotebooks(m, (store?.entries ?? []).map((e) => e.id));
  },

  async restore(ids, onProgress) {
    const r = await restoreDetailed(ids, onProgress);
    return r.restored;
  },

  restoreDetailed,

  async signOut() {
    wire();
    running?.abort.abort();
    clearRetry();
    await provider()?.signOut?.();
    // The next account starts its PDF folder from scratch.
    await resetPdfCopies();
    failures = 0;
    lastFailureAt = null;
    // Signing out turns backup off (NB-86a); the files in Drive stay.
    setBackupSettings({ enabled: false, account: '', lastError: '' });
    syncTriggers();
  },

  async signInAgain() {
    wire();
    const p = provider();
    if (!p) return 'unavailable';
    if (!p.signIn) return 'ok';
    const r = await p.signIn(true);
    if (!r.ok) return r.error;
    failures = 0;
    lastFailureAt = null;
    // While backup is off (the restore screen signs in too) nothing changes: turning it on is the
    // enable flow's job, and a 'revoked' message stays true until then.
    if (backupSettings().enabled) {
      setBackupSettings({ account: r.account, lastError: '' });
      void evaluate('manual');
    }
    return 'ok';
  },

  cancel() {
    if (!running) return;
    // Automatic runs wait a while (otherwise the next evaluation would start over at once).
    heldUntil = Math.max(heldUntil, Date.now() + DEBOUNCE_MS);
    running.abort.abort();
  },

  async setProvider(kind) {
    wire();
    if (!providerChoices.includes(kind)) return 'unavailable';
    if (providerKindNow() === kind) return 'ok';
    if (backupSettings().enabled || running || restoring) return 'busy';
    // Sign the old account out (iCloud has nothing to sign out of).
    if (providerKindNow() !== 'icloud') await provider()?.signOut?.().catch(() => {});
    provider()?.reset?.();
    failures = 0;
    lastFailureAt = null;
    detail = undefined;
    // What this device uploaded belongs to the old place: the new one starts with a full backup.
    await loadBackupState().catch(() => null);
    await updateBackupState((st) => ({ deviceId: st.deviceId, lastUploaded: {}, conflicts: [] }));
    // The last-backup line belongs to the old place too ('' reads as no backup yet; the merge keeps
    // keys a patch leaves undefined, so it is cleared with an empty value).
    setBackupSettings({ provider: kind, lastError: '', account: '', lastBackupAt: '' as IsoDate });
    notify();
    return 'ok';
  },

  startAutoRun() {
    wire();
    autoUsers++;
    syncTriggers();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      autoUsers = Math.max(0, autoUsers - 1);
      syncTriggers();
    };
  },
};

/** For a caller holding a thrown error (listRemote, restore): its BackupError code. */
export function backupErrorFrom(e: unknown): BackupError {
  return backupErrorOf(e);
}

/** The extra detail of the current error ('newer' manifest), if any. */
export function backupErrorDetail(): 'newer' | undefined {
  return detail;
}
