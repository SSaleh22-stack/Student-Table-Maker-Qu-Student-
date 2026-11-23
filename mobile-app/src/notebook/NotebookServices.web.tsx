/**
 * Web: the notebook does not run on the web (NB-2), so there are no notebook services. This file
 * keeps the native services (Skia cover worker, expo-audio recorder, PDF crash journal) out of the
 * web bundle. Metro picks it over NotebookServices.tsx for the web platform.
 */
export function NotebookServices() {
  return null;
}

export default NotebookServices;
