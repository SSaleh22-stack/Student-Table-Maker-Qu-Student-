/**
 * /notebook/receive: a file shared into the app or opened with it (Figma 05). +native-intent.tsx
 * stashes the files and routes here; a newer share while this screen is open remounts it.
 */
import { useSyncExternalStore } from 'react';

import { incomingGeneration, subscribeIncoming } from '@/notebook/import/incoming';
import { ReceiveScreen } from '@/notebook/import/ReceiveScreen';

export default function ReceiveRoute() {
  const generation = useSyncExternalStore(subscribeIncoming, incomingGeneration, incomingGeneration);
  return <ReceiveScreen key={generation} />;
}
