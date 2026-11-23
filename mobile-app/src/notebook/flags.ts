/**
 * Notebook (المذكرات) feature flags.
 *
 * The notebook is in beta: the Home cell (and its announcement slide) stays hidden in store builds
 * until NOTEBOOK_HOME_FLAG is set to true and a new native build ships. Development builds always
 * show it. The web app never shows it, because the notebook needs native modules (NB-2).
 */
import { Platform } from 'react-native';

/** Turn on to show the notebook on Home in store builds (needs a native build, not an OTA update). */
export const NOTEBOOK_HOME_FLAG = false;

/** Use the contingent native ink-input module (P22N) instead of gesture-handler for drawing. */
export const USE_NATIVE_INK_INPUT = false;

/** The notebook runs only in the iOS and Android apps. */
export const notebookSupported: boolean = Platform.OS !== 'web';

/** Whether Home shows the notebook cell and the notebook announcement slide. */
export function showNotebookOnHome(): boolean {
  return notebookSupported && (NOTEBOOK_HOME_FLAG || __DEV__);
}
