/**
 * The library's low-storage notice (Figma 17, NB-36): 'مساحة الجهاز منخفضة' with 'متاح 900 ميجابايت
 * فقط. قد لا يكتمل استيراد ملفات PDF الكبيرة أو التسجيلات الطويلة.' and 'عرض التخزين', which opens the
 * notebook settings (the storage section, NB-87).
 *
 * The free space is read when the library comes into focus (store.isLowStorage: low means under
 * 1 GB). Nothing shows when the space is fine or cannot be read. The drawing is the kit's
 * LowStorageBanner (ui/LowStorageWarning.tsx).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { openNotebookSettings } from '@/notebook/nav';
import { getNotebooksStore } from '@/notebook/store/hooks';
import { LowStorageBanner } from '@/notebook/ui/LowStorageWarning';

/** The free bytes when storage is low, else null. Re-read each time the screen gains focus. */
export function useLowStorage(): number | null {
  const [free, setFree] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      // Read on the next tick: the store's free-space call is synchronous native work.
      const t = setTimeout(() => {
        const r = getNotebooksStore()?.isLowStorage();
        setFree(r && r.low && r.freeBytes > 0 ? r.freeBytes : null);
      }, 0);
      return () => clearTimeout(t);
    }, []),
  );
  return free;
}

export function LibraryLowStorageBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const free = useLowStorage();
  if (free === null) return null;
  return <LowStorageBanner freeBytes={free} onShowStorage={openNotebookSettings} style={style} />;
}
