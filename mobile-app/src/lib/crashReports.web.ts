/** The web build sends no crash reports (Crashlytics is native only; see crashReports.ts). */
import type { Lang } from '@/lib/i18n';

export function startCrashReports(): void {}

export function setCrashReportLanguage(_lang: Lang): void {}
