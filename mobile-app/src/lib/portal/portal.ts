/**
 * Student portal import: scripts injected into the portal WebView and the messages they send back.
 *
 * The page is a third-party site, so every message is treated as untrusted input and
 * checked before it reaches the app's data.
 */
import type { ClassStatus, ClassType, Course, Exam, TimeSlot } from '@/lib/types';

import { EXTRACTOR_BUNDLE } from './extractor.generated';

export const PORTAL_HOST = 'stu-gate.qu.edu.sa';
export const OFFERED_COURSES_URL =
  'https://stu-gate.qu.edu.sa/qu/ui/student/offeredCourses/index/offeredCoursesIndex.faces';

/** MyQU, the university's unified login (username + password, or Nafath). */
export const MYQU_LOGIN_URL = 'https://myqu.qu.edu.sa/login';

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
};

const isUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/**
 * Pages allowed inside the import frame: the university's own sites (MyQU, stu-gate) and
 * Nafath (iam.gov.sa), which MyQU can use to sign in. Anything else opens outside the app.
 */
export const allowImportFrame = (url: string): boolean => {
  if (url === 'about:blank') return true;
  const host = hostOf(url);
  return !!host && (isUnder(host, 'qu.edu.sa') || isUnder(host, 'iam.gov.sa'));
};

/** True while the student is still signing in (MyQU login pages or Nafath). */
export const isLoginPage = (url: string): boolean => {
  const host = hostOf(url);
  if (!host) return false;
  if (isUnder(host, 'iam.gov.sa')) return true;
  let path = '';
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {}
  if (host === 'myqu.qu.edu.sa') return path === '/' || /^\/(login|forget-password|auth|otp|nafath)/.test(path);
  return /login|logon|signin|sso/i.test(path);
};

const POST_FN = `function __quPost(m){try{window.ReactNativeWebView.postMessage(JSON.stringify(m));}catch(e){}}`;

/** The course scripts only ever look at stu-gate pages, never at login pages. */
const ON_PORTAL = `location.hostname === ${JSON.stringify(PORTAL_HOST)}`;

/**
 * Runs after every page load. Reports how many sections the current page has, and keeps
 * reporting while the page changes (the portal loads tables without full reloads).
 */
export const SCAN_SCRIPT = `(function(){
  ${POST_FN}
  if (!(${ON_PORTAL})) { __quPost({ type: 'scan', count: 0, url: location.href }); return; }
  if (window.__quScanInstalled) { return; }
  window.__quScanInstalled = true;
  ;${EXTRACTOR_BUNDLE};
  var timer = null;
  function scan(){
    var count = 0;
    try { count = window.__quExtract(document).length; } catch (e) { count = 0; }
    __quPost({ type: 'scan', count: count, url: location.href });
  }
  scan();
  try {
    new MutationObserver(function(){ clearTimeout(timer); timer = setTimeout(scan, 700); })
      .observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})(); true;`;

/** Runs when the student taps "extract": sends every section on the page. */
export const EXTRACT_SCRIPT = `(function(){
  ${POST_FN}
  if (!(${ON_PORTAL})) { __quPost({ type: 'courses', courses: [] }); return; }
  try {
    if (!window.__quExtract) { ;${EXTRACTOR_BUNDLE}; }
    __quPost({ type: 'courses', courses: window.__quExtract(document) });
  } catch (e) {
    __quPost({ type: 'error', message: String((e && e.message) || e) });
  }
})(); true;`;

export type PortalMessage =
  | { type: 'scan'; count: number; url: string }
  | { type: 'courses'; courses: Course[] }
  | { type: 'error'; message: string };

const MAX_COURSES = 2000;

const str = (v: unknown, max = 200): string | undefined =>
  typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : undefined;

const DAYS = new Set(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const TIME = /^\d{1,2}:\d{2}$/;

const days = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string' && DAYS.has(d)) : [];

const time = (v: unknown): string => {
  const s = str(v, 5) ?? '';
  return TIME.test(s) ? s.padStart(5, '0') : '';
};

const slot = (v: unknown): TimeSlot | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return { days: days(o.days), startTime: time(o.startTime), endTime: time(o.endTime), location: str(o.location) };
};

/** Keeps only the fields the app uses, with the expected types. */
const toCourse = (v: unknown): Course | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 120);
  const code = str(o.code, 30);
  const name = str(o.name);
  if (!id || !code || !name) return null;

  const exam = o.finalExam && typeof o.finalExam === 'object' ? (o.finalExam as Record<string, unknown>) : null;
  const finalExam: Exam | undefined = exam
    ? { day: str(exam.day, 10) ?? '', date: str(exam.date, 20), startTime: time(exam.startTime), endTime: time(exam.endTime) }
    : undefined;

  const status = o.status === 'open' || o.status === 'closed' ? (o.status as ClassStatus) : undefined;
  const classType =
    o.classType === 'practical' || o.classType === 'theoretical' || o.classType === 'exercise'
      ? (o.classType as ClassType)
      : undefined;

  const timeSlots = Array.isArray(o.timeSlots)
    ? o.timeSlots.map(slot).filter((s): s is TimeSlot => !!s)
    : undefined;

  return {
    id,
    code,
    name,
    section: str(o.section, 20) ?? '',
    campus: str(o.campus),
    hours: str(o.hours, 10),
    days: days(o.days),
    startTime: time(o.startTime),
    endTime: time(o.endTime),
    location: str(o.location),
    timeSlots: timeSlots && timeSlots.length > 0 ? timeSlots : undefined,
    instructor: str(o.instructor),
    finalExam,
    status,
    classType,
    activity: str(o.activity, 30) || undefined,
    order: typeof o.__originalIndex === 'number' && Number.isFinite(o.__originalIndex) ? o.__originalIndex : undefined,
  };
};

/** Sorts sections by their row on the portal page (same as the extension), keeping ties in place. */
const inPortalOrder = (courses: Course[]): Course[] =>
  courses
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.order ?? Infinity) - (b.c.order ?? Infinity) || a.i - b.i)
    .map((x) => x.c);

/** Parses a WebView message; returns null for anything unexpected. */
export const parsePortalMessage = (data: string): PortalMessage | null => {
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;

  if (m.type === 'scan') {
    const count = typeof m.count === 'number' && Number.isFinite(m.count) ? Math.max(0, Math.floor(m.count)) : 0;
    return { type: 'scan', count, url: str(m.url, 500) ?? '' };
  }
  if (m.type === 'courses' && Array.isArray(m.courses)) {
    const courses = m.courses.slice(0, MAX_COURSES).map(toCourse).filter((c): c is Course => !!c);
    return { type: 'courses', courses: inPortalOrder(courses) };
  }
  if (m.type === 'error') {
    return { type: 'error', message: str(m.message, 300) ?? '' };
  }
  return null;
};
