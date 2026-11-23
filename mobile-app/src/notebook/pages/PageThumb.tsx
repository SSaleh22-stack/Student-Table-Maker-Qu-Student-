/**
 * One page of the pages grid (Figma 13): the page's PNG thumbnail, its number underneath and the
 * 'الحالية' pill on the current page.
 *
 * - The image is the cached PNG from pageThumb(session, pageId, widthPx) (P16 ink/pageThumbs.ts),
 *   shown with expo-image. There is NO Skia canvas per cell: the PNG is rendered offscreen once per
 *   page version and width, and cached under Paths.cache/nb-thumbs.
 * - `version` is session.pageVersion(pageId) as the grid read it. Every edit gives the page a new
 *   version (the grid re-renders on every session change), so the thumbnail is requested again and
 *   the new PNG replaces the old one when it is ready. The old image stays until then. A version
 *   that matches the shown PNG is not requested again (so pages the session's 12-page LRU dropped
 *   are not reloaded, which would give them a new version and a needless render).
 * - While the first PNG loads, a paper-pattern placeholder (PaperTileArt) or the PDF placeholder
 *   fill shows. The placeholder is unmounted once the image has loaded.
 * - The page keeps its own shape: a landscape page is a landscape thumbnail, centered in the A4
 *   portrait box every cell has.
 * - The current page has a 3 pt accent border (1 pt border otherwise). In select mode a selected page
 *   has the accent border and a check at the top reading-start corner.
 */
import { Image } from 'expo-image';
import { memo, useEffect, useMemo, useState } from 'react';
import { PixelRatio, Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { fromStart, ltr, row } from '@/lib/rtl';
import { sizeOf, type Id, type PageBackground, type PaperSpec, type Size } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { PDF_PLACEHOLDER_FILL, pageThumb } from '@/notebook/ink';
import { nbColors } from '@/notebook/theme';
import { PaperTileArt } from '@/notebook/ui/PaperPicker';

/** Requested widths are rounded up to this step, so small layout changes reuse the cached PNG. */
const WIDTH_STEP = 64;
const RADIUS = 8;

export interface PageThumbProps {
  session: NotebookSession;
  pageId: Id;
  /** 0-based position (the label shows index + 1). */
  index: number;
  /** The cell's thumbnail box (the page is fitted inside it). */
  boxW: number;
  boxH: number;
  /** session.pageVersion(pageId) as last read; a change requests a new thumbnail. */
  version: number;
  /** Notebook default paper, for the placeholder of a page that is not loaded yet. */
  defaults: PaperSpec;
  current?: boolean;
  /** Select mode is on (shows the empty check circle). */
  selectMode?: boolean;
  selected?: boolean;
  /** The lifted copy while dragging: a deeper shadow, no label changes. */
  lifted?: boolean;
  /** Label row height (the grid's labelH). */
  labelH: number;
}

/** The pixel width to request for a box width: device pixels, rounded up to WIDTH_STEP. */
export function thumbRequestWidth(boxW: number): number {
  const px = Math.max(16, boxW * PixelRatio.get());
  return Math.min(2048, Math.ceil(px / WIDTH_STEP) * WIDTH_STEP);
}

/** The page fitted inside the box (contain), never larger than the box. */
function fitPage(size: Size, boxW: number, boxH: number): { w: number; h: number } {
  if (!(size.w > 0) || !(size.h > 0)) return { w: boxW, h: boxH };
  const k = Math.min(boxW / size.w, boxH / size.h);
  return { w: Math.max(8, Math.round(size.w * k)), h: Math.max(8, Math.round(size.h * k)) };
}

interface Known {
  size: Size;
  background: PageBackground | null;
}

function knownOf(session: NotebookSession, pageId: Id, defaults: PaperSpec): Known {
  const p = session.getPage(pageId);
  if (p) return { size: p.size, background: p.background };
  return { size: sizeOf(defaults), background: null };
}

function PageThumbImpl({
  session,
  pageId,
  index,
  boxW,
  boxH,
  version,
  defaults,
  current,
  selectMode,
  selected,
  lifted,
  labelH,
}: PageThumbProps) {
  const widthPx = thumbRequestWidth(boxW);
  /**
   * The shown PNG: the page version it was rendered for, the `version` prop it was requested for
   * (0 for a page that was not loaded yet) and the width.
   */
  const [shown, setShown] = useState<{ uri: string; version: number; forVersion: number; widthPx: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [known, setKnown] = useState<Known>(() => knownOf(session, pageId, defaults));
  const uri = shown?.uri ?? null;

  useEffect(() => {
    // Already showing this version at this width. This also keeps a page the session's LRU dropped
    // from being reloaded (a reload gives it a new version) and rendered again for nothing.
    if (shown && shown.widthPx === widthPx && (shown.version === version || shown.forVersion === version)) return;
    let alive = true;
    pageThumb(session, pageId, widthPx).then(
      (u) => {
        if (!alive) return;
        // pageThumb loaded the page: take its real size and background for the frame.
        const p = session.getPage(pageId);
        if (p) {
          setKnown((prev) => (prev.size === p.size && prev.background === p.background ? prev : { size: p.size, background: p.background }));
        }
        // The version the PNG belongs to (pageThumb read it after loading the page).
        const v = session.pageVersion(pageId);
        setShown((prev) =>
          prev && prev.uri === u && prev.version === v && prev.forVersion === version && prev.widthPx === widthPx
            ? prev
            : { uri: u, version: v, forVersion: version, widthPx },
        );
      },
      () => {
        // The page could not be rendered: the placeholder stays. A later edit retries.
      },
    );
    return () => {
      alive = false;
    };
  }, [session, pageId, widthPx, version, shown]);

  const fit = useMemo(() => fitPage(known.size, boxW, boxH), [known.size, boxW, boxH]);
  const bg = known.background;
  const paper: PaperSpec = bg && bg.kind !== 'pdf' ? bg.paper : defaults;
  const damaged = bg?.kind === 'pdf' && bg.damaged === true;
  const accent = !!current || (!!selectMode && !!selected);

  const placeholder = loaded ? null : bg?.kind === 'pdf' ? (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: PDF_PLACEHOLDER_FILL }]} />
  ) : (
    <View style={StyleSheet.absoluteFill}>
      <PaperTileArt style={paper.style} color={paper.color} width={fit.w} height={fit.h} zoom={2} />
    </View>
  );

  return (
    <View style={{ width: boxW }} pointerEvents="none">
      <View style={[styles.box, { width: boxW, height: boxH }]}>
        <View style={[styles.page, { width: fit.w, height: fit.h }, lifted ? styles.liftedShadow : styles.shadow]}>
          <View style={[StyleSheet.absoluteFill, styles.clip]}>
            {placeholder}
            {uri ? (
              <Image
                source={{ uri }}
                style={StyleSheet.absoluteFill}
                contentFit="fill"
                transition={loaded ? 0 : 120}
                cachePolicy="memory"
                recyclingKey={pageId}
                onLoad={() => setLoaded(true)}
                accessible={false}
              />
            ) : null}
            {damaged ? (
              <View style={styles.damaged}>
                <Icon name="alert" size={Math.min(28, fit.w / 4)} color={nbColors.warning} />
              </View>
            ) : null}
          </View>
          <View
            style={[
              StyleSheet.absoluteFill,
              styles.border,
              { borderWidth: accent ? 3 : 1, borderColor: accent ? nbColors.accent : nbColors.border },
            ]}
          />
          {selectMode ? (
            <View style={[styles.check, fromStart(6), selected ? styles.checkOn : styles.checkOff]}>
              {selected ? <Icon name="check" size={14} color={nbColors.white} strokeWidth={3} /> : null}
            </View>
          ) : null}
        </View>
      </View>
      <View style={[styles.label, { height: labelH, flexDirection: row }]}>
        {current ? (
          <View style={styles.pill}>
            <AppText size={11} weight="semibold" color={nbColors.white}>
              {tr('الحالية', 'Current')}
            </AppText>
          </View>
        ) : null}
        <AppText size={14} weight="semibold" color={nbColors.muted}>
          {ltr(index + 1)}
        </AppText>
      </View>
    </View>
  );
}

export const PageThumb = memo(PageThumbImpl);

const SHADOW_SM = Platform.select({
  ios: { shadowColor: '#1B2533', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  android: { elevation: 1 },
  default: {},
}) as object;

const SHADOW_LIFT = Platform.select({
  ios: { shadowColor: '#1B2533', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } },
  android: { elevation: 12 },
  default: {},
}) as object;

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  page: { borderRadius: RADIUS, backgroundColor: nbColors.white },
  clip: { borderRadius: RADIUS, overflow: 'hidden' },
  border: { borderRadius: RADIUS },
  shadow: SHADOW_SM,
  liftedShadow: SHADOW_LIFT,
  damaged: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  check: {
    position: 'absolute',
    top: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: nbColors.accent, borderWidth: 2, borderColor: nbColors.white },
  checkOff: { backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 2, borderColor: nbColors.borderStrong },
  label: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 6 },
  pill: { backgroundColor: nbColors.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 1 },
});
