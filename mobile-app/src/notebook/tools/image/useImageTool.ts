/**
 * The image action (P27, NB-47). Images are not a tool (ToolId has no 'image'): the toolbar's image
 * button calls openSource(), which shows ImageSourceSheet; the picked photo is inserted at the visible
 * center and selected (insertImage), so it is then moved, resized, rotated and deleted with the
 * selection handles and menu. 'قص الصورة' in the selection menu opens ImageCropSheet through
 * requestImageCrop().
 *
 * useImageTool(ctx) returns ToolPlugin & { openSource, sheets }:
 * - tool is 'lasso' (the selection it hands images to). It has NO handler and NO overlay: do not
 *   register it as the lasso's pointer handler (useSelectionTool's plugin is the lasso).
 * - sheets must be rendered by the editor (the source sheet and the crop sheet).
 */
import { createElement, Fragment, useCallback, useEffect, useEffectEvent, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { tr } from '@/lib/i18n';
import type { ToolContext, ToolPlugin, UseImageTool } from '@/notebook/contracts/tools';
import type { Id } from '@/notebook/core/model';
import { showToast } from '@/notebook/ui';

import { ImageCropSheet } from './ImageCropSheet';
import { ImageSourceSheet } from './ImageSourceSheet';
import { insertImage, pickImage, recoverPendingImage, type ImageSource } from './insertImage';

export interface CropRequest {
  pageId: Id;
  itemId: Id;
}

let cropRequest: CropRequest | null = null;
const cropListeners = new Set<() => void>();

function setCrop(r: CropRequest | null): void {
  if (r === cropRequest) return;
  cropRequest = r;
  for (const cb of [...cropListeners]) cb();
}

const subscribeCrop = (cb: () => void) => {
  cropListeners.add(cb);
  return () => {
    cropListeners.delete(cb);
  };
};
const getCrop = () => cropRequest;

/** Opens the crop sheet for an image item (the selection menu's 'قص الصورة'). */
export function requestImageCrop(r: CropRequest): void {
  setCrop({ pageId: r.pageId, itemId: r.itemId });
}

export function closeImageCrop(): void {
  setCrop(null);
}

/** Time for the source sheet's modal to go away before the picker opens. */
const PICKER_DELAY_MS = Platform.OS === 'ios' ? 450 : 80;
/** Android: time for the canvas to lay out before a recovered photo is placed at its visible center. */
const RECOVER_DELAY_MS = 700;

export const useImageTool: UseImageTool = (ctx: ToolContext) => {
  const { session } = ctx;
  const [sourceOpen, setSourceOpen] = useState(false);
  /** The source picked in the sheet, waiting for the sheet's modal to go away. */
  const [pending, setPending] = useState<{ source: ImageSource } | null>(null);
  const crop = useSyncExternalStore(subscribeCrop, getCrop, getCrop);

  useEffect(() => closeImageCrop, []);

  const openSource = useCallback(() => {
    if (session.readOnly) return;
    setSourceOpen(true);
  }, [session]);

  const onPick = useCallback((source: ImageSource) => {
    setSourceOpen(false);
    setPending({ source });
  }, []);

  const onCloseSource = useCallback(() => setSourceOpen(false), []);

  // Reads the latest ctx (canvas center, recording mark) when the picker returns.
  const pickAndInsert = useEffectEvent(async (source: ImageSource, alive: () => boolean) => {
    const failed = () => showToast({ text: tr('تعذّرت إضافة الصورة', 'Could not add the image'), tone: 'warn' });
    try {
      const r = await pickImage(source);
      if (!alive()) return;
      if (!r.ok) {
        if (r.reason === 'denied') {
          showToast({ text: tr('اسمح باستخدام الكاميرا من الإعدادات لالتقاط صورة', 'Allow camera access in Settings to take a photo'), tone: 'warn' });
        }
        return;
      }
      const id = await insertImage(ctx, r.image);
      if (!id && alive()) failed();
    } catch {
      if (alive()) failed();
    }
  });

  // Android: a photo picked just before the system killed the activity comes back once; it goes into
  // the notebook that opens next (where the student was adding it).
  const insertRecovered = useEffectEvent(async (alive: () => boolean) => {
    try {
      const img = await recoverPendingImage();
      if (!img || !alive() || session.readOnly) return;
      const id = await insertImage(ctx, img);
      if (!id && alive()) showToast({ text: tr('تعذّرت إضافة الصورة', 'Could not add the image'), tone: 'warn' });
    } catch {
      // Nothing to recover.
    }
  });

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let alive = true;
    const t = setTimeout(() => {
      void insertRecovered(() => alive);
    }, RECOVER_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    let alive = true;
    const t = setTimeout(() => {
      pickAndInsert(pending.source, () => alive).finally(() => {
        if (alive) setPending(null);
      });
    }, PICKER_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [pending]);

  const sheets = useMemo(
    () =>
      createElement(
        Fragment,
        null,
        createElement(ImageSourceSheet, { visible: sourceOpen, onPick, onClose: onCloseSource }),
        crop ? createElement(ImageCropSheet, { key: `${crop.pageId}:${crop.itemId}`, session, request: crop, onClose: closeImageCrop }) : null,
      ),
    [sourceOpen, onPick, onCloseSource, crop, session],
  );

  return useMemo<ToolPlugin & { openSource(): void; sheets: ReactNode }>(() => ({ tool: 'lasso', openSource, sheets }), [openSource, sheets]);
};
