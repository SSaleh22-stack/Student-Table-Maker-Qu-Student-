import Svg, { Path, Rect } from 'react-native-svg';

/**
 * Qu Student "Calendar Q" mark (same artwork as the extension's Logo.tsx).
 * `onDark` draws it in white on a see-through tile, for teal or dark backgrounds.
 */
export function Logo({ size = 40, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 128 128" accessibilityLabel="Qu Student">
      <Rect width={128} height={128} rx={30} fill={onDark ? '#FFFFFF' : '#0E7490'} fillOpacity={onDark ? 0.14 : 1} />
      <Rect x={26} y={34} width={72} height={62} rx={14} fill="none" stroke="#FFFFFF" strokeWidth={9} />
      <Path d="M46 24v16M78 24v16" fill="none" stroke="#FFFFFF" strokeWidth={9} strokeLinecap="round" />
      <Path d="M26 56h72" fill="none" stroke="#FFFFFF" strokeWidth={7} />
      <Rect x={37} y={66} width={22} height={18} rx={5} fill="#7FD3E3" />
      {onDark ? null : <Path d="M80 78l24 24" fill="none" stroke="#0E7490" strokeWidth={21} strokeLinecap="round" />}
      <Path d="M80 78l24 24" fill="none" stroke="#FFFFFF" strokeWidth={11} strokeLinecap="round" />
    </Svg>
  );
}
