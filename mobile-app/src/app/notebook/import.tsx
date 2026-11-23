/**
 * /notebook/import?source=pdf|scan|photos|camera&loc=<encodeLoc>: a new notebook from a PDF, a
 * scan, photos or a camera photo (Figma 04 tiles; nav.openImport).
 */
import { useLocalSearchParams } from 'expo-router';

import { ImportScreen } from '@/notebook/import/ImportScreen';

export default function ImportRoute() {
  const { source, loc } = useLocalSearchParams<{ source?: string; loc?: string }>();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <ImportScreen source={one(source)} loc={one(loc)} />;
}
