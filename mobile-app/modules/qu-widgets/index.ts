import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/**
 * The bridge between the app and its home-screen / lock-screen widgets (الجدول، مهامي، المحاضرة
 * القادمة). The app writes one JSON snapshot that every widget reads (iOS: the App Group
 * "group.net.qustudent.app"; Android: SharedPreferences "qu_widgets"), and reads back the tasks
 * ticked or unticked on a widget while the app was in the background.
 */
type QuWidgetsModule = {
  /** Saves the snapshot and redraws every widget. */
  setSnapshot(json: string): void;
  /** The ticks made on widgets since the last call (a JSON array), and forgets them. */
  takePendingToggles(): string;
};

// Missing on web, in Expo Go and in builds made before the widgets were added.
const native = Platform.OS === 'web' ? null : requireOptionalNativeModule<QuWidgetsModule>('QuWidgets');

/** A tick made on a widget: the task, whether it was marked done, the date it had then, and when. */
export interface WidgetToggle {
  id: string;
  done: boolean;
  /** The task's date ('YYYY-MM-DD') when it was ticked; null for a task without a date. */
  date: string | null;
  /** When it was ticked (ISO time); null if missing or unreadable. */
  at: string | null;
}

export const widgetsAvailable = (): boolean => native !== null;

export function setWidgetSnapshot(json: string): void {
  try {
    native?.setSnapshot(json);
  } catch {
    // A widget failing to update must never break the app.
  }
}

export function takeWidgetToggles(): WidgetToggle[] {
  if (!native) return [];
  try {
    const list: unknown = JSON.parse(native.takePendingToggles() || '[]');
    if (!Array.isArray(list)) return [];
    return list.flatMap((raw): WidgetToggle[] => {
      if (!raw || typeof raw !== 'object') return [];
      const r = raw as { id?: unknown; done?: unknown; date?: unknown; at?: unknown };
      if (typeof r.id !== 'string' || typeof r.done !== 'boolean') return [];
      const at = typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) ? r.at : null;
      return [{ id: r.id, done: r.done, date: typeof r.date === 'string' && r.date ? r.date : null, at }];
    });
  } catch {
    return [];
  }
}
