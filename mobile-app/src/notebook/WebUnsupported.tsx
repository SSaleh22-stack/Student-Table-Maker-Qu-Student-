/**
 * The notebook needs native modules, so on web every notebook route renders this and sends the
 * student back to the timetable (NB-2). Each route's .web.tsx file re-exports it:
 *   export { default } from '@/notebook/WebUnsupported';
 */
import { Redirect } from 'expo-router';

export default function WebUnsupported() {
  return <Redirect href="/" />;
}
