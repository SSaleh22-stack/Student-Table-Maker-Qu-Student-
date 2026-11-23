/**
 * Text box fonts (NB-46): IBM Plex Sans Arabic like the rest of the app, in two weights only, so the
 * TextInput editor (RN fonts loaded by the root layout) and the Skia painter (P16 ink/fonts.ts, a
 * TypefaceFontProvider) set the same glyphs and the text never changes weight or wrap after editing.
 *
 * - rn: the font family name the root layout registers with expo-font (TextInput fontFamily)
 * - weight: the weight P16 registers the TTF under in the Skia font provider (family NB_TEXT_FAMILY)
 * - ttf: path of the TTF inside NB_TEXT_FONT_PACKAGE
 * - source: the font asset module (require result), for Skia's useFonts / Skia.Data.fromURI
 */
import { IBMPlexSansArabic_500Medium, IBMPlexSansArabic_700Bold } from '@expo-google-fonts/ibm-plex-sans-arabic';

export const NB_TEXT_FONT_PACKAGE = '@expo-google-fonts/ibm-plex-sans-arabic';

/** The Skia font family name for text boxes. */
export const NB_TEXT_FAMILY = 'IBMPlexSansArabic';

export interface NbTextFont {
  rn: string;
  weight: 500 | 700;
  ttf: string;
  source: number;
}

export const NB_TEXT_FONTS: { readonly regular: NbTextFont; readonly bold: NbTextFont } = {
  regular: { rn: 'IBMPlexSansArabic_500Medium', weight: 500, ttf: '500Medium/IBMPlexSansArabic_500Medium.ttf', source: IBMPlexSansArabic_500Medium },
  bold: { rn: 'IBMPlexSansArabic_700Bold', weight: 700, ttf: '700Bold/IBMPlexSansArabic_700Bold.ttf', source: IBMPlexSansArabic_700Bold },
};

/** The font for a TextItem's bold flag. */
export function nbTextFont(bold: boolean): NbTextFont {
  return bold ? NB_TEXT_FONTS.bold : NB_TEXT_FONTS.regular;
}
