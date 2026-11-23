/**
 * Crop an image (P27, NB-47): a full-screen sheet with the whole image, a crop area with 8 handles
 * (4 corners, 4 edges) that can also be dragged, and the aspect chips 'حر' · '1:1' · '4:3' · '3:4' ·
 * '16:9'. 'إعادة ضبط' goes back to the whole image, 'إلغاء' closes without a change, 'تم' writes
 * item.crop (normalized 0..1 of the image; null for the whole image) as ONE undo step. The visible part
 * keeps its scale and place on the page (core applyCrop), so the box shrinks around it.
 *
 * The crop rect is kept normalized in a shared value and drawn over the image fitted (contain) in
 * the free area; the handles are RNGH v3 pans running core dragCropRect on the UI thread. The sheet
 * is a Modal, so it has its own GestureHandlerRootView (Android needs one per Modal). Placement uses
 * PHYSICAL_ORIGIN and translations, so the handles land on the physical corners in RTL too.
 */
import { Image as ExpoImage } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import type { Id, ImageItem } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import {
  CROP_ASPECTS,
  FULL_CROP,
  RESIZE_HANDLES,
  applyCrop,
  dragCropRect,
  fitAspect,
  fitContain,
  normalizeCrop,
  type CropRect,
  type HandleId,
} from '@/notebook/core/tools/selection';
import { usePage } from '@/notebook/store/hooks';
import { nbColors } from '@/notebook/theme';
import { ChipGroup, MODAL_ORIENTATIONS, PHYSICAL_ORIGIN, physicalBox } from '@/notebook/ui';

type AspectKey = (typeof CROP_ASPECTS)[number]['key'];

/** Space around the fitted image (room for the handles). */
const MARGIN = 28;
/** Smallest crop side on screen. */
const MIN_PX = 40;
const TOUCH = 44;
const CORNER = 18;
const BACKDROP = '#0F1722';
const DIM = 'rgba(0, 0, 0, 0.55)';

export interface ImageCropSheetProps {
  session: NotebookSession;
  request: { pageId: Id; itemId: Id };
  onClose(): void;
}

function sameCrop(a: CropRect | null, b: CropRect | null): boolean {
  if (!a || !b) return a === b;
  const e = 1e-4;
  return Math.abs(a.x - b.x) < e && Math.abs(a.y - b.y) < e && Math.abs(a.w - b.w) < e && Math.abs(a.h - b.h) < e;
}

/** The full image's aspect from the item (box / crop), when the file's size is not known yet. */
function aspectFromItem(it: ImageItem): { w: number; h: number } {
  const c = it.crop ?? FULL_CROP;
  const w = c.w > 0 ? it.box.w / c.w : it.box.w;
  const h = c.h > 0 ? it.box.h / c.h : it.box.h;
  return w > 0 && h > 0 ? { w, h } : { w: 4, h: 3 };
}

interface CropPartProps {
  handle: HandleId;
  norm: SharedValue<number[]>;
  disp: SharedValue<number[]>;
  ratio: SharedValue<number>;
}

/** One crop handle, or the crop area itself ('move'). */
function CropPart({ handle, norm, disp, ratio }: CropPartProps) {
  const start = useSharedValue<number[]>([0, 0, 1, 1]);
  const pan = usePanGesture({
    minDistance: 0,
    maxPointers: 1,
    onBegin: () => {
      'worklet';
      start.set(norm.get());
    },
    onUpdate: (e) => {
      'worklet';
      const d = disp.get();
      if (!(d[0] > 0) || !(d[1] > 0)) return;
      const s = start.get();
      const r = ratio.get();
      const next = dragCropRect(
        { x: s[0] * d[0], y: s[1] * d[1], w: s[2] * d[0], h: s[3] * d[1] },
        handle,
        e.translationX,
        e.translationY,
        { w: d[0], h: d[1] },
        r > 0 ? r : null,
        MIN_PX,
      );
      norm.set([next.x / d[0], next.y / d[1], next.w / d[0], next.h / d[1]]);
    },
  });

  const style = useAnimatedStyle(() => {
    const d = disp.get();
    const n = norm.get();
    const x = n[0] * d[0];
    const y = n[1] * d[1];
    const w = n[2] * d[0];
    const h = n[3] * d[1];
    if (handle === 'move') return { width: w, height: h, transform: [{ translateX: x }, { translateY: y }] };
    const fx = handle === 'tl' || handle === 'l' || handle === 'bl' ? 0 : handle === 't' || handle === 'b' ? 0.5 : 1;
    const fy = handle === 'tl' || handle === 't' || handle === 'tr' ? 0 : handle === 'l' || handle === 'r' ? 0.5 : 1;
    return { width: TOUCH, height: TOUCH, transform: [{ translateX: x + fx * w - TOUCH / 2 }, { translateY: y + fy * h - TOUCH / 2 }] };
  });

  const corner = handle.length === 2;
  const vertical = handle === 'l' || handle === 'r';
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.abs, PHYSICAL_ORIGIN, handle === 'move' ? null : styles.center, style]}>
        {handle === 'move' ? null : corner ? (
          <View style={styles.corner} />
        ) : (
          <View style={vertical ? styles.barV : styles.barH} />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

/** The dimmed parts outside the crop area. */
function Dims({ norm, disp }: { norm: SharedValue<number[]>; disp: SharedValue<number[]> }) {
  const top = useAnimatedStyle(() => {
    const d = disp.get();
    const n = norm.get();
    return { width: d[0], height: n[1] * d[1], transform: [{ translateX: 0 }, { translateY: 0 }] };
  });
  const bottom = useAnimatedStyle(() => {
    const d = disp.get();
    const n = norm.get();
    const y = (n[1] + n[3]) * d[1];
    return { width: d[0], height: Math.max(0, d[1] - y), transform: [{ translateX: 0 }, { translateY: y }] };
  });
  const left = useAnimatedStyle(() => {
    const d = disp.get();
    const n = norm.get();
    return { width: n[0] * d[0], height: n[3] * d[1], transform: [{ translateX: 0 }, { translateY: n[1] * d[1] }] };
  });
  const right = useAnimatedStyle(() => {
    const d = disp.get();
    const n = norm.get();
    const x = (n[0] + n[2]) * d[0];
    return { width: Math.max(0, d[0] - x), height: n[3] * d[1], transform: [{ translateX: x }, { translateY: n[1] * d[1] }] };
  });
  const frame = useAnimatedStyle(() => {
    const d = disp.get();
    const n = norm.get();
    return { width: n[2] * d[0], height: n[3] * d[1], transform: [{ translateX: n[0] * d[0] }, { translateY: n[1] * d[1] }] };
  });
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.abs, PHYSICAL_ORIGIN, styles.dim, top]} />
      <Animated.View pointerEvents="none" style={[styles.abs, PHYSICAL_ORIGIN, styles.dim, bottom]} />
      <Animated.View pointerEvents="none" style={[styles.abs, PHYSICAL_ORIGIN, styles.dim, left]} />
      <Animated.View pointerEvents="none" style={[styles.abs, PHYSICAL_ORIGIN, styles.dim, right]} />
      <Animated.View pointerEvents="none" style={[styles.abs, PHYSICAL_ORIGIN, styles.cropFrame, frame]}>
        <View style={[styles.third, styles.thirdV, { left: '33.33%' }]} />
        <View style={[styles.third, styles.thirdV, { left: '66.66%' }]} />
        <View style={[styles.third, styles.thirdH, { top: '33.33%' }]} />
        <View style={[styles.third, styles.thirdH, { top: '66.66%' }]} />
      </Animated.View>
    </>
  );
}

function HeaderButton({ label, onPress, strong }: { label: string; onPress: () => void; strong?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={10} style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}>
      <AppText size={16} weight={strong ? 'bold' : 'medium'} color={strong ? nbColors.accentLight : '#FFFFFF'}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function ImageCropSheet({ session, request, onClose }: ImageCropSheetProps) {
  const insets = useSafeAreaInsets();
  const page = usePage(session, request.pageId);
  const found = page?.items.find((i) => i.id === request.itemId);
  const item = found && found.kind === 'image' ? found : null;
  const uri = item ? session.assetPath(item.fileId) : null;

  const [natural, setNatural] = useState<{ uri: string; w: number; h: number } | null>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [aspect, setAspect] = useState<AspectKey>('free');

  const initial = item?.crop ?? FULL_CROP;
  const norm = useSharedValue<number[]>([initial.x, initial.y, initial.w, initial.h]);
  const disp = useSharedValue<number[]>([0, 0]);
  const ratio = useSharedValue(0);
  const inited = useSharedValue(!!item);

  // The page was still loading on the first render: start from the item's crop once it is there.
  useEffect(() => {
    if (!item || inited.get()) return;
    inited.set(true);
    const c = item.crop ?? FULL_CROP;
    norm.set([c.x, c.y, c.w, c.h]);
  }, [item, inited, norm]);

  // The item vanished (undo, deleted elsewhere) once its page is loaded: nothing to crop.
  const missing = !!page && !item;
  useEffect(() => {
    if (missing) onClose();
  }, [missing, onClose]);

  useEffect(() => {
    if (!uri) return;
    let alive = true;
    Image.getSize(uri).then(
      (s) => {
        if (alive && s.width > 0 && s.height > 0) setNatural({ uri, w: s.width, h: s.height });
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [uri]);

  const size = natural && natural.uri === uri ? natural : item ? aspectFromItem(item) : null;
  const fit = useMemo(() => {
    if (!size || !(area.w > 0) || !(area.h > 0)) return null;
    const f = fitContain(size.w, size.h, area.w - MARGIN * 2, area.h - MARGIN * 2);
    return { x: f.x + MARGIN, y: f.y + MARGIN, w: f.w, h: f.h };
  }, [size, area.w, area.h]);

  useEffect(() => {
    disp.set(fit ? [fit.w, fit.h] : [0, 0]);
  }, [fit, disp]);

  const onAreaLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea((a) => (a.w === width && a.h === height ? a : { w: width, h: height }));
  };

  const chooseAspect = (key: AspectKey) => {
    setAspect(key);
    const r = CROP_ASPECTS.find((a) => a.key === key)?.ratio ?? null;
    ratio.set(r ?? 0);
    const d = disp.get();
    if (r === null || !(d[0] > 0) || !(d[1] > 0)) return;
    const n = norm.get();
    const next = fitAspect({ x: n[0] * d[0], y: n[1] * d[1], w: n[2] * d[0], h: n[3] * d[1] }, r, { w: d[0], h: d[1] });
    norm.set([next.x / d[0], next.y / d[1], next.w / d[0], next.h / d[1]]);
  };

  const onReset = () => {
    setAspect('free');
    ratio.set(0);
    norm.set([0, 0, 1, 1]);
  };

  const onDone = () => {
    const n = norm.get();
    const crop = normalizeCrop({ x: n[0], y: n[1], w: n[2], h: n[3] });
    const cur = session.getPage(request.pageId)?.items.find((i) => i.id === request.itemId);
    if (cur && cur.kind === 'image' && !session.readOnly && !sameCrop(cur.crop, crop)) {
      session.updateItems(request.pageId, [applyCrop(cur, crop)], 'crop');
    }
    onClose();
  };

  const options = CROP_ASPECTS.map((a) => ({ value: a.key, label: a.key === 'free' ? tr('حر', 'Free') : a.key }));

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      supportedOrientations={MODAL_ORIENTATIONS}
      statusBarTranslucent
      onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + 8, flexDirection: row }]}>
          <HeaderButton label={tr('إلغاء', 'Cancel')} onPress={onClose} />
          <View style={[styles.title, { flexDirection: row }]}>
            <Icon name="crop" size={18} color="#FFFFFF" />
            <AppText size={17} weight="bold" color="#FFFFFF">
              {tr('قص الصورة', 'Crop image')}
            </AppText>
          </View>
          <HeaderButton label={tr('تم', 'Done')} onPress={onDone} strong />
        </View>

        <View style={styles.area} onLayout={onAreaLayout}>
          {fit && uri ? (
            <View style={physicalBox(fit.x, fit.y, fit.w, fit.h)}>
              <ExpoImage source={{ uri }} style={{ width: fit.w, height: fit.h }} contentFit="fill" accessibilityIgnoresInvertColors />
              <Dims norm={norm} disp={disp} />
              <CropPart handle="move" norm={norm} disp={disp} ratio={ratio} />
              {RESIZE_HANDLES.map((h) => (
                <CropPart key={h} handle={h} norm={norm} disp={disp} ratio={ratio} />
              ))}
            </View>
          ) : null}
        </View>

        <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
          <ChipGroup options={options} value={aspect} onChange={chooseAspect} label={tr('نسبة القص', 'Crop ratio')} style={styles.chips} />
          <Pressable
            onPress={onReset}
            accessibilityRole="button"
            accessibilityLabel={tr('إعادة ضبط', 'Reset')}
            style={({ pressed }) => [styles.reset, { flexDirection: row }, pressed && styles.resetPressed]}>
            <Icon name="restore" size={18} color={nbColors.accent} />
            <AppText size={15} weight="semibold" color={nbColors.accent}>
              {tr('إعادة ضبط', 'Reset')}
            </AppText>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BACKDROP,
  },
  header: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  title: {
    alignItems: 'center',
    gap: 8,
  },
  headerBtn: {
    minWidth: 64,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  pressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  area: {
    flex: 1,
  },
  abs: {
    position: 'absolute',
    top: 0,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: {
    backgroundColor: DIM,
  },
  cropFrame: {
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  third: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  thirdV: {
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  thirdH: {
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  corner: {
    width: CORNER,
    height: CORNER,
    borderRadius: CORNER / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: nbColors.accent,
  },
  barH: {
    width: 26,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  barV: {
    width: 6,
    height: 26,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  panel: {
    backgroundColor: nbColors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 20,
    gap: 12,
    alignItems: 'center',
  },
  chips: {
    justifyContent: 'center',
  },
  reset: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  resetPressed: {
    backgroundColor: nbColors.accentTint,
  },
});
