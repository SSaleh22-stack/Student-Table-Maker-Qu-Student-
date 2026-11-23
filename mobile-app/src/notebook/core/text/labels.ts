/**
 * Counted and formatted labels for the notebook UI (P04). Pure: the language is passed in, because
 * core cannot call tr(); app code passes getLang() (or useLang()).
 *
 * Strings follow the Figma plugin (design-options/notebook-figma-plugin/code.js) and use Western
 * digits like the rest of the app:
 * - countLabel: 'لا توجد مذكرات', 'مذكرة واحدة', 'مذكرتان', '3 مذكرات', '11 مذكرة', '100 مذكرة'
 * - relativeTime: 'اليوم 10:32 ص', 'أمس', '19 نوفمبر', '19 نوفمبر 2025'
 * - bytesLabel: '48.6 ميجابايت', '1.4 جيجابايت', '900 ميجابايت' (1 KB = 1024 bytes)
 * - durationLabel: '08:14', '47:32', '1:02:05'
 * - daysLeft: 'يتبقى 27 يوماً', 'يتبقى يومان' (Recently deleted, 30 days, NB-13)
 */

export type LabelLang = 'ar' | 'en';

export type CountKind = 'notebook' | 'page' | 'folder' | 'recording';

interface ArForms {
  /** 0 */
  none: string;
  /** 1 */
  one: string;
  /** 2 */
  two: string;
  /** after 3..10 (and n % 100 in 3..10) */
  plural: string;
  /** after 11..99 (and n % 100 in 11..99): the accusative singular ('11 مجلداً') */
  many: string;
  /** after 100, 101, 102, 200, ...: the genitive singular ('100 مجلد') */
  single: string;
}

const AR: Record<CountKind, ArForms> = {
  notebook: { none: 'لا توجد مذكرات', one: 'مذكرة واحدة', two: 'مذكرتان', plural: 'مذكرات', many: 'مذكرة', single: 'مذكرة' },
  page: { none: 'لا توجد صفحات', one: 'صفحة واحدة', two: 'صفحتان', plural: 'صفحات', many: 'صفحة', single: 'صفحة' },
  folder: { none: 'لا توجد مجلدات', one: 'مجلد واحد', two: 'مجلدان', plural: 'مجلدات', many: 'مجلداً', single: 'مجلد' },
  recording: { none: 'لا توجد تسجيلات', one: 'تسجيل واحد', two: 'تسجيلان', plural: 'تسجيلات', many: 'تسجيلاً', single: 'تسجيل' },
};

const EN: Record<CountKind, { none: string; one: string; many: string }> = {
  notebook: { none: 'No notebooks', one: 'notebook', many: 'notebooks' },
  page: { none: 'No pages', one: 'page', many: 'pages' },
  folder: { none: 'No folders', one: 'folder', many: 'folders' },
  recording: { none: 'No recordings', one: 'recording', many: 'recordings' },
};

const count = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * Arabic number agreement (CLDR plural classes): 0, 1 and 2 have their own words; n % 100 in 3..10
 * takes the plural ('3 مذكرات', '103 مذكرات'); n % 100 in 11..99 takes the accusative singular
 * ('11 مذكرة', '11 مجلداً', '24 تسجيلاً'); the rest (100, 101, 102, 200, ...) the genitive singular
 * ('100 مذكرة', '100 مجلد'), like 'يتبقى 27 يوماً' in daysLeft. Negative, NaN and fractional counts are
 * floored to a whole count >= 0.
 */
export function countLabel(n: number, kind: CountKind, lang: LabelLang): string {
  const c = count(n);
  if (lang === 'en') {
    const f = EN[kind];
    if (c === 0) return f.none;
    return `${c} ${c === 1 ? f.one : f.many}`;
  }
  const f = AR[kind];
  if (c === 0) return f.none;
  if (c === 1) return f.one;
  if (c === 2) return f.two;
  const r = c % 100;
  return `${c} ${r >= 3 && r <= 10 ? f.plural : r >= 11 ? f.many : f.single}`;
}

// ===== dates and times

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

export interface TimeOptions {
  /**
   * Minutes to add to UTC to get local time (Qatar: 180). Default: the device's offset at that
   * instant. Tests pass it so they do not depend on the machine's time zone.
   */
  tzOffsetMin?: number;
  /** Show the clock time for today ('اليوم 10:32 ص'). Default true; false gives just 'اليوم'. */
  time?: boolean;
}

const toMs = (at: string | number | Date): number => (typeof at === 'number' ? at : at instanceof Date ? at.getTime() : Date.parse(at));

const offsetAt = (ms: number, o?: TimeOptions): number => (o?.tzOffsetMin ?? -new Date(ms).getTimezoneOffset());

/** Local calendar fields of an instant, through UTC getters after shifting by the offset. */
function local(ms: number, o?: TimeOptions): { y: number; m: number; d: number; h: number; min: number; day: number } {
  const t = new Date(ms + offsetAt(ms, o) * 60_000);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const d = t.getUTCDate();
  return { y, m, d, h: t.getUTCHours(), min: t.getUTCMinutes(), day: Math.floor(Date.UTC(y, m, d) / DAY_MS) };
}

/** '9:12 ص' / '9:12 AM' (12-hour clock, minutes padded). */
export function clockLabel(at: string | number | Date, lang: LabelLang, o?: TimeOptions): string {
  const ms = toMs(at);
  if (!Number.isFinite(ms)) return '';
  const { h, min } = local(ms, o);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const clock = `${h12}:${String(min).padStart(2, '0')}`;
  if (lang === 'en') return `${clock} ${h < 12 ? 'AM' : 'PM'}`;
  return `${clock} ${h < 12 ? 'ص' : 'م'}`;
}

/**
 * When something happened, as the library cards show it:
 * - today: 'اليوم 10:32 ص' / 'Today 10:32 AM' (or 'اليوم' / 'Today' with time: false)
 * - yesterday: 'أمس' / 'Yesterday'
 * - this year: '19 نوفمبر' / 'Nov 19'
 * - other years: '19 نوفمبر 2025' / 'Nov 19, 2025'
 * A time slightly in the future (clock skew) on today's date still reads as today. An unparsable
 * date gives ''.
 */
export function relativeTime(at: string | number | Date, now: number, lang: LabelLang, o?: TimeOptions): string {
  const ms = toMs(at);
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return '';
  const a = local(ms, o);
  const n = local(now, o);
  const diff = n.day - a.day;
  if (diff === 0) {
    const today = lang === 'en' ? 'Today' : 'اليوم';
    return o?.time === false ? today : `${today} ${clockLabel(ms, lang, o)}`;
  }
  if (diff === 1) return lang === 'en' ? 'Yesterday' : 'أمس';
  if (lang === 'en') return a.y === n.y ? `${EN_MONTHS[a.m]} ${a.d}` : `${EN_MONTHS[a.m]} ${a.d}, ${a.y}`;
  return a.y === n.y ? `${a.d} ${AR_MONTHS[a.m]}` : `${a.d} ${AR_MONTHS[a.m]} ${a.y}`;
}

// ===== sizes and durations

const AR_UNITS = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت', 'تيرابايت'];
const EN_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** One decimal below 100 ('48.6', '1.4'), whole numbers from 100 ('900'); a trailing '.0' is dropped. */
function amount(v: number): string {
  if (v >= 100) return String(Math.round(v));
  const s = (Math.round(v * 10) / 10).toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/**
 * A byte count with 1024-based units: '512 بايت', '48.6 ميجابايت', '1.4 جيجابايت' /
 * '48.6 MB'. A value that would read 1000 or more moves to the next unit ('1 جيجابايت', not
 * '1010 ميجابايت'). Negative and NaN count as 0.
 */
export function bytesLabel(bytes: number, lang: LabelLang): string {
  let v = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let unit = 0;
  if (v >= 1000) {
    v /= 1024;
    unit = 1;
    while (unit < AR_UNITS.length - 1 && Math.round(v * 10) / 10 >= 1000) {
      v /= 1024;
      unit += 1;
    }
  }
  const text = unit === 0 ? String(Math.round(v)) : amount(v);
  return `${text} ${(lang === 'en' ? EN_UNITS : AR_UNITS)[unit]}`;
}

/** A recording length: 'mm:ss' under an hour ('08:14', '47:32'), else 'h:mm:ss' ('1:02:05'). */
export function durationLabel(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ===== recently deleted

/** Days a deleted notebook stays in Recently deleted (NB-13). */
export const TRASH_DAYS = 30;

/** Whole days until a notebook deleted at deletedAt is purged (rounded up, never below 0). */
export function daysLeftCount(deletedAt: string | number | Date, now: number, retentionDays: number = TRASH_DAYS): number {
  const ms = toMs(deletedAt);
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return 0;
  const left = Math.ceil((ms + retentionDays * DAY_MS - now) / DAY_MS);
  return Math.max(0, Math.min(retentionDays, left));
}

/**
 * The card subtitle in Recently deleted: 'يتبقى 27 يوماً', 'يتبقى 5 أيام', 'يتبقى يومان',
 * 'يتبقى يوم واحد', and 'يُحذف اليوم' on the last day / '27 days left', '1 day left', 'Deleted today'.
 */
export function daysLeft(deletedAt: string | number | Date, now: number, lang: LabelLang, retentionDays: number = TRASH_DAYS): string {
  const n = daysLeftCount(deletedAt, now, retentionDays);
  if (lang === 'en') {
    if (n === 0) return 'Deleted today';
    return n === 1 ? '1 day left' : `${n} days left`;
  }
  if (n === 0) return 'يُحذف اليوم';
  if (n === 1) return 'يتبقى يوم واحد';
  if (n === 2) return 'يتبقى يومان';
  const r = n % 100;
  return r >= 3 && r <= 10 ? `يتبقى ${n} أيام` : `يتبقى ${n} يوماً`;
}
