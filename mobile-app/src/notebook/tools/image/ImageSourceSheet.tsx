/**
 * Where the image comes from (P27, NB-47): 'من الصور' (photo library) or 'الكاميرا'. Opened by the
 * toolbar's image action (Toolbar.onImage -> useImageTool().openSource()). The sheet closes first; the
 * caller opens the picker once it is gone (iOS cannot present the picker over a closing modal).
 */
import { tr } from '@/lib/i18n';
import { Group, ListRow, NbSheet } from '@/notebook/ui';

import type { ImageSource } from './insertImage';

export interface ImageSourceSheetProps {
  visible: boolean;
  onPick(source: ImageSource): void;
  onClose(): void;
}

export function ImageSourceSheet({ visible, onPick, onClose }: ImageSourceSheetProps) {
  return (
    <NbSheet visible={visible} title={tr('إضافة صورة', 'Add image')} onClose={onClose}>
      <Group>
        <ListRow icon="image" title={tr('من الصور', 'From Photos')} onPress={() => onPick('library')} />
        <ListRow icon="camera" title={tr('الكاميرا', 'Camera')} onPress={() => onPick('camera')} />
      </Group>
    </NbSheet>
  );
}
