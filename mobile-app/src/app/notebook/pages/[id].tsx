/**
 * /notebook/pages/<id>?current=<pageId>: the pages view of an open notebook (Figma 13; NB-23, NB-24,
 * NB-25, NB-49a). The screen lives in src/notebook/pages/PagesScreen.tsx.
 *
 * `current` is the editor's current page id (it gets the accent border and 'الحالية', and the action
 * bar works on it). Without it the first page counts as current.
 */
import { useLocalSearchParams } from 'expo-router';

import { PagesScreen } from '@/notebook/pages/PagesScreen';

export default function PagesRoute() {
  const { id, current } = useLocalSearchParams<{ id?: string | string[]; current?: string | string[] }>();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;
  return <PagesScreen notebookId={one(id)} currentPageId={one(current)} />;
}
