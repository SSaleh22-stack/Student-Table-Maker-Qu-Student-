/**
 * One page of the canvas (P22), drawn inside the canvas's view transform. Mounted ONLY for the visible
 * pages +-1 (PageCanvas), so the image hooks below pin at most those pages' images (P16 budget).
 *
 * DRAW ORDER (core/model/types.ts), in page points under the page transform (content px = page pt x k):
 *   1 background   paper / photo: a picture of paintBackground. PDF: white, the budgeted preview,
 *                  then sharp tiles once the view settled (usePdfTiles), all under
 *                  pdfRotationTransform. A damaged PDF page (or one still loading) shows the
 *                  placeholder fill.
 *   2-3 under      the P16 'under' picture: images, then the highlighter group at 0.35
 *   4 ink          the P16 'ink' picture: pen strokes, shapes and text, in array order
 *   pixel eraser   the live eraser path with blendMode dstOut, inside a layer that holds only the
 *                  under and ink pictures, so the preview removes ink and never the paper.
 *
 * PICTURES are built on the JS runtime (never in a worklet, #4339) by a small per-page store, so no
 * state is set inside an effect:
 * - a new stroke, shape or text APPENDED to the page is added to the ink picture with
 *   appendStrokePicture (exact; rebuilt after MAX_APPEND_DEPTH appends);
 * - any other change (undo, erase, move, a highlighter or image added, playback dimming, the hidden
 *   ids, a decoded image, the fonts) rebuilds both pictures with buildPagePictures;
 * - replaced pictures go through disposeLater.
 * Hidden ids (selection.hidden: dragged items, items erased live, the text being edited) are skipped.
 * The canvas never draws the items under selection.drag: P27's DragPreview does, while a handle is
 * held. A hidden item that its owner just committed (changed object, or newly on this page) is drawn
 * in the same rebuild as the page change, before the cleared hidden set arrives (createPicStore).
 * Once a picture of page version v is on screen, onShown(pageId, v) lets the canvas drop the wet ink
 * of the strokes it now contains.
 */
import { Group, Image as SkiaImage, Path, Picture, Rect, Skia, type SkImage, type SkPath, type SkPicture, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { appendedItems } from '@/notebook/core/canvas/eraseMirror';
import type { PdfError } from '@/notebook/core/contracts/pdf';
import { PAPER_FILL, type Id, type Page, type PaperColor, type RecMark, type Size } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import {
  MAX_APPEND_DEPTH,
  PDF_PLACEHOLDER_FILL,
  appendDepth,
  appendStrokePicture,
  assetImageDecoder,
  assetImageKey,
  buildPagePictures,
  disposeLater,
  disposeUnseen,
  isHighlighterItem,
  paintBackground,
  pdfRotationTransform,
  recordPicture,
  subscribeImage,
  usePdfPreview,
  usePdfTiles,
  type PaintContext,
  type PdfRotation,
} from '@/notebook/ink';
import { usePage } from '@/notebook/store/hooks';

import { dimSignature } from './playback';
import { previewSpec, tileOptionsFor, type SettledView } from './tiles';

const PDF_PLACEHOLDER_BORDER = '#DCE4EC';
const EMPTY_IMAGES: ReadonlyMap<string, SkImage> = new Map();

// ===== decoded image assets of the page (budgeted, pinned while mounted)

interface AssetImages {
  map: ReadonlyMap<string, SkImage>;
  /** Changes whenever an image arrives, is evicted or is replaced. */
  key: string;
}

function useAssetImages(session: NotebookSession, idsKey: string): AssetImages {
  const [state, setState] = useState<{ ids: string; ver: number; map: ReadonlyMap<string, SkImage> }>({ ids: '', ver: 0, map: EMPTY_IMAGES });
  useEffect(() => {
    if (!idsKey) return undefined;
    let alive = true;
    let ver = 0;
    const map = new Map<string, SkImage>();
    const offs = idsKey.split('|').map((fileId) =>
      subscribeImage(assetImageKey(session.id, fileId), 'asset', assetImageDecoder(session, fileId), (img) => {
        if (!alive) return;
        if (img) map.set(fileId, img);
        else map.delete(fileId);
        ver += 1;
        setState({ ids: idsKey, ver, map: new Map(map) });
      }),
    );
    return () => {
      alive = false;
      for (const off of offs) off();
    };
  }, [session, idsKey]);
  if (!idsKey || state.ids !== idsKey) return { map: EMPTY_IMAGES, key: '' };
  return { map: state.map, key: `${idsKey}#${state.ver}` };
}

// ===== the page's pictures

interface PicInputs {
  page: Page;
  version: number;
  ctx: PaintContext;
  dimAfter: RecMark | null;
  dimKey: string;
  skip: ReadonlySet<Id> | null;
  skipKey: string;
  imagesKey: string;
  fontsOn: boolean;
}

export interface PagePics {
  /** Paper / photo background (null for PDF pages: the canvas draws those). */
  bg: SkPicture | null;
  under: SkPicture;
  ink: SkPicture;
  /** session.pageVersion of the page these pictures show. */
  version: number;
  page: Page;
  key: string;
  bgKey: string;
}

interface PicStore {
  get(): PagePics | null;
  subscribe(cb: () => void): () => void;
  update(i: PicInputs): void;
  dispose(): void;
}

/**
 * How long a RELEASED hidden id (see createPicStore) is drawn before the hidden set as last seen on JS
 * rules again, in case selection.hidden did not change after all.
 */
const RELEASE_RECHECK_MS = 300;

function createPicStore(): PicStore {
  let cur: PagePics | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const cb of [...listeners]) cb();
  };

  // RELEASED ids. A handle release (P27) or the end of a text edit (P28) writes the page (updateItems)
  // and then clears selection.hidden. The page reaches React at once, but the cleared hidden set only
  // arrives through the UI runtime (one or two frames later). A hidden item whose object changed in
  // this page update (or that just arrived on this page) has therefore been committed by its owner:
  // it is drawn at once, in the same rebuild as the new items, so the committed items neither flash
  // at their old place nor vanish for a frame. Released ids last until the hidden set changes, or
  // RELEASE_RECHECK_MS at most.
  let released: ReadonlySet<Id> = new Set();
  let releasedFor = '';
  let recheck: ReturnType<typeof setTimeout> | null = null;
  let last: PicInputs | null = null;

  const clearRecheck = () => {
    if (recheck !== null) clearTimeout(recheck);
    recheck = null;
  };

  const effectiveSkip = (i: PicInputs): { skip: ReadonlySet<Id> | null; skipKey: string } => {
    if (i.skipKey !== releasedFor) {
      released = new Set();
      releasedFor = i.skipKey;
      clearRecheck();
    }
    const prevPage = cur && cur.page.id === i.page.id ? cur.page : null;
    if (i.skip && prevPage && prevPage !== i.page) {
      const before = new Map<Id, unknown>();
      for (const it of prevPage.items) if (i.skip.has(it.id)) before.set(it.id, it);
      let more: Set<Id> | null = null;
      for (const it of i.page.items) {
        if (!i.skip.has(it.id) || released.has(it.id) || before.get(it.id) === it) continue;
        (more ??= new Set(released)).add(it.id);
      }
      if (more) {
        released = more;
        clearRecheck();
        recheck = setTimeout(() => {
          recheck = null;
          if (released.size === 0) return;
          released = new Set();
          if (last) update(last);
        }, RELEASE_RECHECK_MS);
      }
    }
    if (!i.skip || released.size === 0) return { skip: i.skip, skipKey: i.skipKey };
    const kept = [...i.skip].filter((id) => !released.has(id));
    return kept.length ? { skip: new Set(kept), skipKey: kept.join('|') } : { skip: null, skipKey: '' };
  };

  const update = (input: PicInputs): void => {
    last = input;
    const i: PicInputs = { ...input, ...effectiveSkip(input) };
    const key = `${i.dimKey}#${i.skipKey}#${i.imagesKey}#${i.fontsOn ? 1 : 0}`;
    const prev = cur;
    if (prev && prev.page === i.page && prev.key === key) {
      if (prev.version !== i.version) {
        cur = { ...prev, version: i.version };
        emit();
      }
      return;
    }
    const page = i.page;
    const size = page.size;
    const sameSize = !!prev && prev.page.size.w === size.w && prev.page.size.h === size.h;
    const bgKey = page.background.kind === 'image' ? i.imagesKey : '';

    let bg: SkPicture | null = null;
    if (page.background.kind !== 'pdf') {
      const reuse = prev && prev.bg && sameSize && prev.page.background === page.background && prev.bgKey === bgKey;
      bg = reuse && prev ? prev.bg : recordPicture(size.w, size.h, (c) => paintBackground(c, page, i.ctx));
    }

    let under: SkPicture;
    let ink: SkPicture;
    const opts = { dimAfter: i.dimAfter, skipIds: i.skip };
    const added = prev && prev.key === key && sameSize ? appendedItems(prev.page.items, page.items) : null;
    const appendable =
      !!prev && !!added && added.length > 0 && added.every((it) => it.kind !== 'image' && !isHighlighterItem(it)) && appendDepth(prev.ink) + added.length <= MAX_APPEND_DEPTH;
    if (prev && added && appendable) {
      under = prev.under;
      ink = prev.ink;
      for (const it of added) {
        const next = appendStrokePicture(ink, it, i.ctx, { ...opts, size });
        // An in-between picture of a multi-item append was never drawn.
        if (ink !== prev.ink) disposeUnseen(ink);
        ink = next;
      }
    } else {
      const built = buildPagePictures(page, i.ctx, opts);
      under = built.under;
      ink = built.ink;
    }

    cur = { bg, under, ink, version: i.version, page, key, bgKey };
    emit();
    if (prev) {
      if (prev.bg && prev.bg !== bg) disposeLater(prev.bg);
      if (prev.under !== under) disposeLater(prev.under);
      if (prev.ink !== ink) disposeLater(prev.ink);
    }
  };

  return {
    get: () => cur,
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    update,
    // Releases the pictures (unmount; a StrictMode remount simply builds them again).
    dispose() {
      clearRecheck();
      last = null;
      released = new Set();
      releasedFor = '';
      const c = cur;
      cur = null;
      if (c) {
        disposeLater(c.bg);
        disposeLater(c.under);
        disposeLater(c.ink);
      }
      emit();
    },
  };
}

function paperColorOf(page: Page | undefined, fallback: PaperColor): PaperColor {
  if (!page) return fallback;
  const bg = page.background;
  return bg.kind === 'pdf' ? 'white' : bg.paper.color;
}

// ===== component

export interface PageLayerProps {
  session: NotebookSession;
  pageId: Id;
  index: number;
  /** The page rectangle in content px (layout.ts) and the fit scale (content px per page point). */
  x: number;
  y: number;
  k: number;
  /** Size and paper to show before the page is loaded. */
  fallbackSize: Size;
  fallbackPaper: PaperColor;
  fonts: SkTypefaceFontProvider | null;
  dimAfter: RecMark | null;
  /** selection.hidden as last seen on JS. */
  hiddenIds: readonly string[];
  settled: SettledView | null;
  isCurrent: boolean;
  /** The screen's long side in device px (PDF preview size). */
  screenLongPx: number;
  /** The pixel eraser is the tool: the ink pictures go into a layer the preview can cut. */
  pixelEraser: boolean;
  /** Pixel eraser diameter (page points). */
  eraserWidth: number;
  eraserPath: SharedValue<SkPath>;
  eraserPage: SharedValue<number>;
  onShown(pageId: Id, version: number): void;
}

export function PageLayer(props: PageLayerProps) {
  const { session, pageId, index, x, y, k, fonts, dimAfter, hiddenIds, settled, isCurrent, screenLongPx, pixelEraser, eraserWidth, eraserPath, eraserPage, onShown } = props;
  const page = usePage(session, pageId);
  const size = page ? page.size : props.fallbackSize;

  // Background: PDF preview and tiles (hooks always run; a null file id makes them idle).
  const bg = page ? page.background : null;
  const pdf = bg && bg.kind === 'pdf' && !bg.damaged ? bg : null;
  const rotation: PdfRotation = bg && bg.kind === 'pdf' ? bg.rotation : 0;
  const spec = previewSpec(size, rotation, screenLongPx);
  const onPdfError = (e: PdfError) => {
    if (e.code !== 'renderer-crashed' && e.code !== 'damaged') return;
    // The page shows the placeholder from now on (and the student is never locked out).
    session.setPageBackground([pageId], (p) => (p.background.kind === 'pdf' && !p.background.damaged ? { ...p.background, damaged: true } : null), undefined, { history: false });
  };
  const preview = usePdfPreview(session, pdf ? pdf.fileId : null, pdf ? pdf.pageIndex : 0, spec.widthPx, onPdfError);
  const tiles = usePdfTiles(session, pdf ? pdf.fileId : null, pdf ? pdf.pageIndex : 0, tileOptionsFor(settled, index, size, rotation, spec.pxPerPt, isCurrent), onPdfError);

  // Image assets: image items and a photo background.
  const idsKey = useMemo(() => {
    if (!page) return '';
    const ids = new Set<string>();
    if (page.background.kind === 'image') ids.add(page.background.fileId);
    for (const it of page.items) if (it.kind === 'image') ids.add(it.fileId);
    return [...ids].sort().join('|');
  }, [page]);
  const images = useAssetImages(session, idsKey);

  // Hidden and dimmed items, as keys that change exactly when the drawn set changes.
  const skipList = useMemo(() => {
    if (!page || hiddenIds.length === 0) return [] as string[];
    const hidden = new Set(hiddenIds);
    return page.items.filter((it) => hidden.has(it.id)).map((it) => it.id);
  }, [page, hiddenIds]);
  const skipKey = skipList.join('|');
  const dimKey = page ? dimSignature(page.items, dimAfter) : '';

  const [store] = useState(createPicStore);
  const pics = useSyncExternalStore(store.subscribe, store.get, store.get);

  // A layout effect: the new pictures are in the same commit (and frame) as the page change.
  useLayoutEffect(() => {
    if (!page) return;
    const imgs = images.map;
    const ctx: PaintContext = { image: (fid) => imgs.get(fid) ?? null, pdfPreview: () => null, fonts };
    store.update({
      page,
      version: session.pageVersion(pageId),
      ctx,
      dimAfter: dimKey ? dimAfter : null,
      dimKey,
      skip: skipKey ? new Set(skipKey.split('|')) : null,
      skipKey,
      imagesKey: images.key,
      fontsOn: !!fonts,
    });
  }, [store, session, pageId, page, images.map, images.key, fonts, dimKey, dimAfter, skipKey]);

  useLayoutEffect(() => () => store.dispose(), [store]);

  useEffect(() => {
    if (pics) onShown(pageId, pics.version);
  }, [pics, pageId, onShown]);

  const transform = useMemo(() => [{ translateX: x }, { translateY: y }, { scale: k }], [x, y, k]);
  const clip = useMemo(() => Skia.XYWHRect(0, 0, size.w, size.h), [size.w, size.h]);
  const pdfTransform = useMemo(() => pdfRotationTransform(size, rotation), [size, rotation]);
  const eraserOpacity = useDerivedValue(() => (eraserPage.get() === index ? 1 : 0));

  const paper = paperColorOf(page, props.fallbackPaper);
  let background;
  if (!page || !bg) {
    background = <Rect x={0} y={0} width={size.w} height={size.h} color={PAPER_FILL[paper]} />;
  } else if (bg.kind === 'pdf') {
    if (pdf && preview) {
      const w = rotation === 90 || rotation === 270 ? size.h : size.w;
      const h = rotation === 90 || rotation === 270 ? size.w : size.h;
      background = (
        <>
          <Rect x={0} y={0} width={size.w} height={size.h} color="#FFFFFF" />
          <Group transform={pdfTransform}>
            <SkiaImage image={preview} x={0} y={0} width={w} height={h} fit="fill" />
            {tiles.map((t) => (
              <SkiaImage key={t.key} image={t.image} x={t.rect.x} y={t.rect.y} width={t.rect.width} height={t.rect.height} fit="fill" />
            ))}
          </Group>
        </>
      );
    } else {
      background = (
        <>
          <Rect x={0} y={0} width={size.w} height={size.h} color={PDF_PLACEHOLDER_FILL} />
          <Rect x={0.5} y={0.5} width={Math.max(0, size.w - 1)} height={Math.max(0, size.h - 1)} color={PDF_PLACEHOLDER_BORDER} style="stroke" strokeWidth={1} />
        </>
      );
    }
  } else {
    // The paper fill at once (open time: background first), then the full paper picture.
    background = (
      <>
        <Rect x={0} y={0} width={size.w} height={size.h} color={PAPER_FILL[paper]} />
        {pics && pics.bg ? <Picture picture={pics.bg} /> : null}
      </>
    );
  }

  const showPics = !!pics && !!page && pics.page.id === page.id;
  return (
    <Group transform={transform} clip={clip}>
      {background}
      <Group layer={pixelEraser}>
        {showPics && pics ? <Picture picture={pics.under} /> : null}
        {showPics && pics ? <Picture picture={pics.ink} /> : null}
        {pixelEraser ? (
          <Path path={eraserPath} style="stroke" strokeWidth={eraserWidth} strokeCap="round" strokeJoin="round" blendMode="dstOut" color="#000000" opacity={eraserOpacity} />
        ) : null}
      </Group>
    </Group>
  );
}
