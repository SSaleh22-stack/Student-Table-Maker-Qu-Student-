/**
 * A notebook's cover in the library cards (NB-14, Figma notebookCard): thumbs/cover.png of its first
 * page (written only by the thumbnail worker, P23), keyed by the index entry's thumbRev so a new
 * cover replaces the cached one.
 *
 * Until a cover exists (a new notebook, a failed read, needsThumb on an old entry) a placeholder is
 * drawn from the entry's cover kind: paper pages use core/paper/pattern.ts patternFor (the same
 * geometry as the pages and the PDF export) on a virtual page about 2.5x the tile, like the Figma
 * thumbnails; PDF and image covers get a small drawing of their kind.
 *
 * Badges sit in the top corner at the reading end: 'PDF' when the notebook holds a PDF, and the red
 * microphone when it has recordings (NB-14). A background import shows its progress over the
 * bottom of the cover (NB-36).
 */
import { Image } from 'expo-image';
import { memo, useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { fromEnd, ltr, row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { nbLayout } from '@/notebook/core/fs/layout';
import { DEFAULT_PAPER, patternFor, type IndexEntry, type PaperSpec } from '@/notebook/core/model';
import { notebookSupported } from '@/notebook/flags';
import { nbRoot } from '@/notebook/store/deps';
import { nbColors, nbRadius } from '@/notebook/theme';
import { ProgressBar } from '@/notebook/ui/ProgressBar';

/** Figma notebookCard thumbnail: 168 x 214. */
export const THUMB_ASPECT = 168 / 214;

/** The virtual page the placeholder pattern is drawn on (about 2.5x a phone-sized tile). */
const VW = 420;
const VH = Math.round(VW / THUMB_ASPECT);

/** The cover file of a notebook, or null when it cannot be resolved (web). */
function coverUri(id: string): string | null {
  if (!notebookSupported) return null;
  try {
    return nbLayout(nbRoot()).notebook(id).cover;
  } catch {
    return null;
  }
}

/**
 * Memoized on the paper fields: a dotted or grid placeholder is hundreds of SVG nodes, and every
 * card re-renders on each index write and each minute tick of useNow.
 */
const PaperArt = memo(function PaperArt({ style, color, size }: PaperSpec) {
  const p = useMemo(() => patternFor({ style, color, size }, { w: VW, h: VH }), [style, color, size]);
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMin slice">
      <Rect x={0} y={0} width={VW} height={VH} fill={p.fill} />
      {p.lines.map((l, i) => (
        <Line key={`l${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={p.lineColor} strokeWidth={2.2} />
      ))}
      {p.dots.map((d, i) => (
        <Circle key={`d${i}`} cx={d.x} cy={d.y} r={2.6} fill={p.lineColor} />
      ))}
      {p.margin ? <Line x1={p.margin.x} y1={0} x2={p.margin.x} y2={VH} stroke={p.margin.color} strokeWidth={3} /> : null}
    </Svg>
  );
});

/** Figma notebookCard pdf: a tinted 'PDF' strip and grey text lines. */
function PdfArt() {
  return (
    <View style={[StyleSheet.absoluteFill, styles.kindArt]}>
      <View style={styles.pdfStrip}>
        <AppText size={11} weight="bold" color={colors.accentDark}>
          PDF
        </AppText>
      </View>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={[styles.textLine, { width: `${70 - (i % 3) * 14}%` }]} />
      ))}
    </View>
  );
}

function ImageArt() {
  return (
    <View style={[StyleSheet.absoluteFill, styles.kindArt, styles.center]}>
      <Icon name="image" size={34} color={colors.placeholder} />
    </View>
  );
}

export interface ThumbProps {
  entry: IndexEntry;
  /** Hide the badges and the import overlay (e.g. Recently deleted). */
  plain?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Thumb({ entry, plain, style }: ThumbProps) {
  /** The thumbRev whose cover failed to load (a new rev tries again). */
  const [failedRev, setFailedRev] = useState<number | null>(null);
  const uri = entry.thumbRev > 0 && failedRev !== entry.thumbRev ? coverUri(entry.id) : null;
  const cover = entry.cover;

  let art;
  if (cover.kind === 'pdf') art = <PdfArt />;
  else if (cover.kind === 'image') art = <ImageArt />;
  else {
    const paper = cover.paper ?? DEFAULT_PAPER;
    art = <PaperArt style={paper.style} color={paper.color} size={paper.size} />;
  }

  const importing = !plain && entry.importing && entry.importing.total > 0 ? entry.importing : null;
  const dark = cover.kind === 'paper' && cover.paper.color === 'dark';

  return (
    <View
      style={[styles.box, { aspectRatio: THUMB_ASPECT, backgroundColor: dark ? nbColors.dark : colors.surface }, style]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden>
      {art}
      {uri ? (
        <Image
          source={{ uri, cacheKey: `nb-cover:${entry.id}:${entry.thumbRev}` }}
          recyclingKey={entry.id}
          cachePolicy="memory"
          contentFit="cover"
          contentPosition="top"
          transition={120}
          style={StyleSheet.absoluteFill}
          onError={() => setFailedRev(entry.thumbRev)}
        />
      ) : null}
      {!plain && (entry.hasPdf || entry.recordingCount > 0) ? (
        <View style={[styles.badges, { flexDirection: row }, fromEnd(8)]}>
          {entry.hasPdf ? (
            <View style={styles.pdfBadge}>
              <AppText size={10} weight="bold" color={colors.accentDark}>
                PDF
              </AppText>
            </View>
          ) : null}
          {entry.recordingCount > 0 ? (
            <View style={styles.micBadge}>
              <Icon name="mic" size={12} color={colors.surface} />
            </View>
          ) : null}
        </View>
      ) : null}
      {importing ? (
        <View style={styles.importing}>
          <AppText size={11} weight="semibold" color={colors.accentDark} numberOfLines={1}>
            {tr('جارٍ الاستيراد… ', 'Importing… ') +
              ltr(`${Math.min(importing.done, importing.total)}/${importing.total}`)}
          </AppText>
          <ProgressBar value={importing.done / importing.total} height={5} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: '100%',
    borderRadius: nbRadius.thumb,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  kindArt: { backgroundColor: colors.surface, padding: '8%', gap: 7 },
  center: { alignItems: 'center', justifyContent: 'center' },
  pdfStrip: {
    backgroundColor: colors.accentSoft,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 8,
  },
  textLine: { height: 5, borderRadius: 3, backgroundColor: '#CBD5E1' },
  badges: { position: 'absolute', top: 8, gap: 4, alignItems: 'center' },
  pdfBadge: { backgroundColor: colors.accentSoft, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  micBadge: { backgroundColor: colors.danger, borderRadius: 999, padding: 5 },
  importing: {
    // Full width from the bottom edge (no physical left/right needed).
    position: 'absolute',
    bottom: 0,
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
});
