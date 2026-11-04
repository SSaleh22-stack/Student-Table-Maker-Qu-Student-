import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { isRTL } from '@/lib/rtl';
import { colors } from '@/lib/theme';

type Shape =
  { d: string } | { cx: number; cy: number; r: number } | { x: number; y: number; w: number; h: number; rx?: number };

/** Stroke icons on a 24×24 grid (same drawings as the extension's Icon set). */
const ICONS = {
  calendar: [{ x: 3, y: 4, w: 18, h: 18, rx: 2 }, { d: 'M16 2v4M8 2v4M3 10h18' }],
  calendarPlus: [{ x: 3, y: 4, w: 18, h: 18, rx: 2 }, { d: 'M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4' }],
  calculator: [
    { x: 4, y: 2, w: 16, h: 20, rx: 2 },
    { d: 'M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8' },
  ],
  userMinus: [{ cx: 15, cy: 7, r: 4 }, { d: 'M21 21v-2a4 4 0 0 0-4-4h-4a4 4 0 0 0-4 4v2M8 11H2' }],
  star: [{ d: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z' }],
  menu: [{ d: 'M4 6h16M4 12h16M4 18h16' }],
  download: [{ d: 'M12 3v12M7 10l5 5 5-5M5 21h14' }],
  share: [{ d: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13' }],
  search: [{ cx: 11, cy: 11, r: 7 }, { d: 'M21 21l-4.3-4.3' }],
  check: [{ d: 'M20 6L9 17l-5-5' }],
  x: [{ d: 'M18 6L6 18M6 6l12 12' }],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  minus: [{ d: 'M5 12h14' }],
  chevronDown: [{ d: 'M6 9l6 6 6-6' }],
  chevronUp: [{ d: 'M18 15l-6-6-6 6' }],
  /** Points right: "back" in a right-to-left app. */
  back: [{ d: 'M9 18l6-6-6-6' }],
  /** Points left: "forward / open" in a right-to-left app. */
  forward: [{ d: 'M15 18l-6-6 6-6' }],
  clock: [{ cx: 12, cy: 12, r: 10 }, { d: 'M12 6v6l4 2' }],
  mapPin: [{ d: 'M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z' }, { cx: 12, cy: 10, r: 2.5 }],
  user: [{ cx: 12, cy: 8, r: 4 }, { d: 'M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1' }],
  fileText: [{ d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }, { d: 'M14 2v6h6M8 13h8M8 17h5' }],
  alert: [{ d: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01' }],
  lock: [{ x: 4, y: 11, w: 16, h: 10, rx: 2 }, { d: 'M8 11V7a4 4 0 0 1 8 0v4' }],
  eye: [{ d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }, { cx: 12, cy: 12, r: 3 }],
  refresh: [{ d: 'M21 12a9 9 0 1 1-2.6-6.4L21 8' }, { d: 'M21 3v5h-5' }],
  undo: [{ d: 'M9 14L4 9l5-5' }, { d: 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11' }],
  grid: [
    { x: 3, y: 3, w: 7, h: 7, rx: 1.5 },
    { x: 14, y: 3, w: 7, h: 7, rx: 1.5 },
    { x: 3, y: 14, w: 7, h: 7, rx: 1.5 },
    { x: 14, y: 14, w: 7, h: 7, rx: 1.5 },
  ],
  list: [{ d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' }],
  trash: [{ d: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }],
  info: [{ cx: 12, cy: 12, r: 10 }, { d: 'M12 16v-4M12 8h.01' }],
  clipboardCheck: [{ d: 'M9 11l3 3L22 4' }, { d: 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' }],
  mail: [{ x: 2, y: 4, w: 20, h: 16, rx: 2 }, { d: 'M22 6l-10 7L2 6' }],
  help: [{ cx: 12, cy: 12, r: 10 }, { d: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01' }],
  sliders: [{ d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' }],
  external: [{ d: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
  image: [{ x: 3, y: 3, w: 18, h: 18, rx: 2 }, { cx: 8.5, cy: 8.5, r: 1.5 }, { d: 'M21 15l-5-5L5 21' }],
  globe: [{ cx: 12, cy: 12, r: 10 }, { d: 'M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' }],
  play: [{ cx: 12, cy: 12, r: 10 }, { d: 'M10 8.5v7l6-3.5z' }],
  home: [{ d: 'M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' }],
  calendarDays: [
    { x: 3, y: 4, w: 18, h: 18, rx: 2 },
    { d: 'M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01' },
  ],
  sun: [
    { cx: 12, cy: 12, r: 4 },
    { d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' },
  ],
  table: [{ x: 3, y: 3, w: 18, h: 18, rx: 2 }, { d: 'M3 9h18M3 15h18M9 3v18' }],
  printer: [
    { d: 'M6 9V2h12v7' },
    { d: 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2' },
    { x: 6, y: 14, w: 12, h: 8 },
  ],
  copy: [{ x: 9, y: 9, w: 13, h: 13, rx: 2 }, { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
  message: [{ d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }],
  hash: [{ d: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18' }],
  bell: [{ d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }, { d: 'M13.73 21a2 2 0 0 1-3.46 0' }],
  /** Chat bubble with a phone handset (WhatsApp). */
  whatsapp: [
    { d: 'M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9z' },
    { d: 'M9.2 8.6c-.4 2.6 2.6 5.8 5.2 5.4l.9-1.3-1.8-1-.9.8a3 3 0 0 1-1.8-1.8l.8-.9-1-1.8z' },
  ],
  /** Paper plane (Telegram). */
  telegram: [{ d: 'M22 3L2 10.5l7 2.5 2.5 7L22 3z' }, { d: 'M9 13l5-4' }],
  /** Columned building (a university). */
  university: [{ d: 'M12 2.5l9 5H3z' }, { d: 'M5 10.5v7M9.7 10.5v7M14.3 10.5v7M19 10.5v7M3 21h18' }],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  filled?: boolean;
}

export function Icon({ name, size = 20, color = colors.text, strokeWidth = 2, filled = false }: IconProps) {
  const common = {
    stroke: filled ? 'none' : color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: filled ? color : 'none',
  };
  // "back" and "forward" point the other way in left-to-right (English) layout.
  const shapes = !isRTL && name === 'back' ? ICONS.forward : !isRTL && name === 'forward' ? ICONS.back : ICONS[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {(shapes as Shape[]).map((shape, i) => {
        if ('d' in shape) return <Path key={i} d={shape.d} {...common} />;
        if ('r' in shape) return <Circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} {...common} />;
        return <Rect key={i} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx ?? 0} {...common} />;
      })}
    </Svg>
  );
}
