/**
 * Text box fonts for the Skia painter (NB-46): IBM Plex Sans Arabic 500 (regular boxes) and 700
 * (bold boxes), the same two TTFs the TextInput editor uses through expo-font (contracts/fonts.ts
 * NB_TEXT_FONTS), so a box never changes weight or wrap between editing and drawing.
 *
 * Both files (@expo-google-fonts/ibm-plex-sans-arabic 500Medium/IBMPlexSansArabic_500Medium.ttf and
 * 700Bold/IBMPlexSansArabic_700Bold.ttf, bundled as assets through NB_TEXT_FONTS[*].source) are
 * loaded ONCE per app run into one TypefaceFontProvider under the family NB_TEXT_FAMILY. Skia picks
 * the face by the weight asked for in the text style (500 or 700), from the weight stored in each TTF.
 * Loading runs on the JS runtime; the provider lives for the whole app run (never disposed).
 */
import { Skia, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import { useSyncExternalStore } from 'react';
import { Image } from 'react-native';

import { NB_TEXT_FAMILY, NB_TEXT_FONTS } from '@/notebook/contracts/fonts';

import { disposeUnseen } from './imageBudget';

let provider: SkTypefaceFontProvider | null = null;
let loading: Promise<SkTypefaceFontProvider | null> | null = null;
const listeners = new Set<() => void>();

function assetUri(source: number): string | null {
  try {
    return Image.resolveAssetSource(source)?.uri ?? null;
  } catch {
    return null;
  }
}

async function loadAll(): Promise<SkTypefaceFontProvider | null> {
  const fonts = [NB_TEXT_FONTS.regular, NB_TEXT_FONTS.bold];
  const p = Skia.TypefaceFontProvider.Make();
  try {
    for (const f of fonts) {
      const uri = assetUri(f.source);
      if (!uri) throw new Error(`No asset URI for ${f.ttf}`);
      const data = await Skia.Data.fromURI(uri);
      try {
        const tf = Skia.Typeface.MakeFreeTypeFaceFromData(data);
        if (!tf) throw new Error(`Cannot read ${f.ttf}`);
        p.registerFont(tf, NB_TEXT_FAMILY);
      } finally {
        disposeUnseen(data);
      }
    }
    return p;
  } catch (e) {
    // Half a provider (one weight) is never used: a later call loads both again.
    disposeUnseen(p);
    throw e;
  }
}

/**
 * The provider with both weights, loading it on the first call. Resolves null when the fonts cannot
 * be loaded (a later call tries again). Never rejects.
 */
export function loadNotebookFonts(): Promise<SkTypefaceFontProvider | null> {
  if (provider) return Promise.resolve(provider);
  if (loading) return loading;
  loading = loadAll()
    .then((p) => {
      provider = p;
      for (const cb of [...listeners]) {
        try {
          cb();
        } catch {
          // A subscriber's failure never makes the loaded fonts look failed.
        }
      }
      return p;
    })
    .catch((e: unknown) => {
      if (__DEV__) console.warn('[ink/fonts] text fonts failed to load', e);
      return null;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The provider when it is loaded, else null (no loading started). */
export function getNotebookFonts(): SkTypefaceFontProvider | null {
  return provider;
}

function subscribeFonts(cb: () => void): () => void {
  listeners.add(cb);
  if (!provider) void loadNotebookFonts();
  return () => {
    listeners.delete(cb);
  };
}

const fontsSnapshot = (): SkTypefaceFontProvider | null => provider;

/** The text box font provider (500 and 700 as NB_TEXT_FAMILY), or null until it is loaded. */
export function useNotebookFonts(): SkTypefaceFontProvider | null {
  return useSyncExternalStore(subscribeFonts, fontsSnapshot, fontsSnapshot);
}
