/**
 * /notebook/spike: the Phase 0 device diagnostics (P16 SpikeScreen). Development builds only: in a
 * release build the route redirects to the timetable, so students can never reach it.
 */
import { Redirect } from 'expo-router';

import { SpikeScreen } from '@/notebook/spike/SpikeScreen';

export default function SpikeRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <SpikeScreen />;
}
