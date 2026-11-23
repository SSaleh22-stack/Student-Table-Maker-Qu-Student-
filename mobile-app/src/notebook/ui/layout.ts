/**
 * Phone (compact) versus tablet (regular) layout for the notebook UI kit.
 *
 * The class depends on the WINDOW width (not the screen's short side, as `useIsTablet` does), so an
 * iPad in Split View or Slide Over gets the phone layouts too, and a phone in landscape stays compact
 * only while its window is narrower than 600 pt.
 *
 * Width-class table (window width in pt -> class -> what switches):
 *
 *   | window width                         | class    | NbModal / NbSheet           | CardRow       | CircleButton |
 *   |--------------------------------------|----------|-----------------------------|---------------|--------------|
 *   | 320 (iPhone SE 1, iPad Slide Over)   | compact  | full-height / bottom sheet  | 2 per row x 2 | 36           |
 *   | 375 / 393 / 430 (iPhones portrait)   | compact  | full-height / bottom sheet  | 2 per row x 2 | 36           |
 *   | 507 (iPad 11" half Split View)       | compact  | full-height / bottom sheet  | 2 per row x 2 | 36           |
 *   | 599                                  | compact  | full-height / bottom sheet  | 2 per row x 2 | 36           |
 *   | 600                                  | regular  | 620 pt centered card        | 1 row of 4    | 40           |
 *   | 744 / 834 / 1024 (iPads portrait)    | regular  | 620 pt centered card        | 1 row of 4    | 40           |
 *   | 844 / 932 (iPhones landscape)        | regular  | 620 pt centered card        | 1 row of 4    | 40           |
 *
 * RadioGroup (row direction), the choice cards and the chip groups wrap on compact.
 */
import { useWindowDimensions, type ModalProps } from 'react-native';

export type WidthClass = 'compact' | 'regular';

/**
 * supportedOrientations for every kit Modal. React Native's default on iPhone is portrait only
 * (RCTModalHostViewComponentView: an empty mask means portrait unless the device is an iPad), so a
 * modal opened on a landscape phone would rotate the whole app to portrait. The app allows every
 * orientation (app.json "orientation": "default"); the Info.plist mask still applies on top.
 */
export const MODAL_ORIENTATIONS: NonNullable<ModalProps['supportedOrientations']> = ['portrait', 'landscape'];

/** Windows narrower than this are compact (phone layouts). */
export const COMPACT_BELOW = 600;

/**
 * Every notebook screen's header matches the editor's: buttons NB_EDGE from the screen edge, centered
 * in an NB_HEADER_BAND band under the top safe area, NB_HEADER_BUTTON (compact: 36) wide.
 */
export const NB_EDGE = 16;
export const NB_HEADER_BAND = 60;
export const NB_HEADER_BUTTON = 40;
export const NB_HEADER_BUTTON_COMPACT = 36;

/** Pure form of useWidthClass, for code that already has the width. */
export function widthClassOf(windowWidth: number): WidthClass {
  return windowWidth < COMPACT_BELOW ? 'compact' : 'regular';
}

/** 'compact' below 600 pt window width, else 'regular'. Re-renders on rotation and window resizes. */
export function useWidthClass(): WidthClass {
  const { width } = useWindowDimensions();
  return widthClassOf(width);
}

/** Shorthand: true when the window is compact. */
export function useIsCompact(): boolean {
  return useWidthClass() === 'compact';
}
