import { useWindowDimensions } from 'react-native';

/** Screens at least this wide on their short side are tablets (iPad), held either way up. */
export const TABLET_MIN = 600;

/** True on a tablet-sized screen, so pages can use bigger cards and text there. */
export const useIsTablet = () => {
  const { width, height } = useWindowDimensions();
  return Math.min(width, height) >= TABLET_MIN;
};
