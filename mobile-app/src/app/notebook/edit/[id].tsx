/**
 * /notebook/edit/<id>: the notebook editor (Figma 06-12, 14, 18-23, 29-37). The screen lives in
 * src/notebook/editor/EditorScreen.tsx; this route only reads the id.
 */
import { useLocalSearchParams } from 'expo-router';

import { EditorScreen } from '@/notebook/editor/EditorScreen';

export default function EditRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const notebookId = (Array.isArray(id) ? id[0] : id) || null;
  return <EditorScreen notebookId={notebookId} />;
}
