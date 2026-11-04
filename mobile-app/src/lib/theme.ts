/**
 * Design tokens for the "Teal Planner" look (same palette as the extension's theme.css).
 */
import { Platform } from 'react-native';

export const colors = {
  bg: '#EEF3F8',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F6F9',
  inputBg: '#F7F9FB',
  border: '#E3E9F0',
  borderStrong: '#DCE4EC',
  divider: '#EEF2F6',

  text: '#1B2533',
  muted: '#4A5668',
  faint: '#5B6676',
  placeholder: '#6B7686',

  accent: '#0E7490',
  accentDark: '#155E75',
  accentSoft: '#DDF0F4',
  accentTint: '#E9F6F9',
  accentLight: '#7FD3E3',
  accentBorder: '#9ED3DF',

  success: '#166534',
  successSoft: '#E3F5EA',
  successBar: '#22A06B',

  warning: '#92400E',
  warningSoft: '#FEF3C7',
  warningBar: '#F59E0B',

  clash: '#9A4A0A',
  clashSoft: '#FFF1E2',
  clashBorder: '#F0BE8A',

  danger: '#B42318',
  dangerSoft: '#FDECEA',
  dangerBar: '#E5484D',
  dangerBorder: '#F3C2BE',

  ink: '#1B2533',
  overlay: 'rgba(27, 37, 51, 0.42)',
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  xxl: 26,
  pill: 999,
} as const;

/** IBM Plex Sans Arabic, loaded with useFonts in the root layout. */
export const fonts = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
} as const;

export type FontWeightName = keyof typeof fonts;

export const shadow = Platform.select({
  ios: {
    shadowColor: '#1B2533',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  android: { elevation: 4 },
  default: { boxShadow: '0 8px 24px rgba(27, 37, 51, 0.10)' },
}) as object;
