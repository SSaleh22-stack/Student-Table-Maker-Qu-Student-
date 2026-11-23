/**
 * Natural-display math on the LCD (NB-47a): draws a P19 LcdBox tree (display.ts layoutInput /
 * layoutMath) as SVG, in LCD units. Fractions get their bar, √ ∛ ʸ√x their radical, |x| its bars,
 * empty template slots a small box, stretched brackets a curve; ∫ and Σ are drawn larger. Text uses a
 * monospaced face sized to LCD_METRICS (10 units per normal character, 7 per small one), so the
 * caret and tap positions computed in core match what is drawn.
 *
 * The caret box (kind 'cursor') is not drawn here: Lcd draws a blinking caret on top.
 */
import { Platform } from 'react-native';
import { G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { LCD_METRICS } from '@/notebook/core/calc/keys/display';
import type { LcdBox } from '@/notebook/core/calc/types';

/** The LCD's monospaced face. */
export const LCD_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string;
/** Monospace advance is about 0.6 em: the font size that gives LCD_METRICS character widths. */
export const LCD_EM = 0.6;
export const lcdFontSize = (small: boolean): number => (small ? LCD_METRICS.small.charW : LCD_METRICS.normal.charW) / LCD_EM;

interface DrawProps {
  box: LcdBox;
  /** Origin of the box's parent, in LCD units. */
  ox: number;
  oy: number;
  color: string;
  /** Kind of the parent box (brackets of a 'paren' box and the ∫ Σ signs are drawn specially). */
  parent?: LcdBox['kind'];
}

function Bracket({ x, y, w, h, open, color }: { x: number; y: number; w: number; h: number; open: boolean; color: string }) {
  const top = y + 1;
  const bottom = y + h - 1;
  const outer = open ? x + w * 0.75 : x + w * 0.25;
  const inner = open ? x + w * 0.2 : x + w * 0.8;
  return <Path d={`M${outer} ${top} Q${inner} ${(top + bottom) / 2} ${outer} ${bottom}`} stroke={color} strokeWidth={1.1} fill="none" strokeLinecap="round" />;
}

function Draw({ box: b, ox, oy, color, parent }: DrawProps) {
  const x = ox + b.x;
  const y = oy + b.y;
  switch (b.kind) {
    case 'cursor':
      return null;
    case 'text': {
      const text = b.text ?? '';
      if (text === '') return null;
      const small = !!b.small;
      const m = small ? LCD_METRICS.small : LCD_METRICS.normal;
      if (parent === 'paren' && (text === '(' || text === ')')) {
        return <Bracket x={x} y={y} w={b.w} h={b.h} open={text === '('} color={color} />;
      }
      const big = (parent === 'integral' && text === '∫') || (parent === 'sum' && text === 'Σ');
      const fontSize = lcdFontSize(small) * (big ? 1.6 : 1);
      const baseline = y + b.baseline + (big ? m.ascent * 0.3 : 0);
      return (
        <SvgText
          x={big ? x + b.w / 2 : x}
          y={baseline}
          fontSize={fontSize}
          fontFamily={LCD_FONT}
          fill={color}
          textAnchor={big ? 'middle' : 'start'}>
          {text}
        </SvgText>
      );
    }
    case 'bar':
      return <Rect x={x} y={y} width={b.w} height={Math.max(0.8, b.h)} fill={color} />;
    case 'slot': {
      const kids = b.children.map((c, i) => <Draw key={i} box={c} ox={x} oy={y} color={color} parent={b.kind} />);
      return (
        <G>
          <Rect x={x + 1} y={y + 2} width={Math.max(1, b.w - 2)} height={Math.max(1, b.h - 4)} fill="none" stroke={color} strokeWidth={0.8} strokeDasharray="1.5 1.2" />
          {kids}
        </G>
      );
    }
    case 'sqrt': {
      const content = b.children[0];
      const sign = content ? content.x : Math.round(LCD_METRICS.normal.charW * 0.9);
      const top = y + 1;
      const bottom = y + b.h - 1;
      const d = `M${x} ${y + b.h * 0.6} L${x + sign * 0.3} ${y + b.h * 0.52} L${x + sign * 0.6} ${bottom} L${x + sign * 0.95} ${top} L${x + b.w} ${top}`;
      return (
        <G>
          <Path d={d} stroke={color} strokeWidth={1} fill="none" strokeLinejoin="round" />
          {b.children.map((c, i) => (
            <Draw key={i} box={c} ox={x} oy={y} color={color} parent={b.kind} />
          ))}
        </G>
      );
    }
    case 'abs':
      return (
        <G>
          <Rect x={x + 0.5} y={y + 1} width={0.9} height={Math.max(1, b.h - 2)} fill={color} />
          <Rect x={x + b.w - 1.4} y={y + 1} width={0.9} height={Math.max(1, b.h - 2)} fill={color} />
          {b.children.map((c, i) => (
            <Draw key={i} box={c} ox={x} oy={y} color={color} parent={b.kind} />
          ))}
        </G>
      );
    default:
      return (
        <G>
          {b.children.map((c, i) => (
            <Draw key={i} box={c} ox={x} oy={y} color={color} parent={b.kind} />
          ))}
        </G>
      );
  }
}

export interface LcdMathProps {
  box: LcdBox;
  /** Where the box's parent origin is, in LCD units (the box's own x and y are added). */
  x: number;
  y: number;
  color: string;
}

/** An LcdBox tree as SVG elements (place inside an <Svg> whose viewBox is in LCD units). */
export function LcdMath({ box, x, y, color }: LcdMathProps) {
  return <Draw box={box} ox={x} oy={y} color={color} />;
}

/** The caret box's text ('|' insert, '_' LineIO overwrite), or null when the tree has no caret. */
export function caretKind(b: LcdBox): '|' | '_' | null {
  if (b.kind === 'cursor') return b.text === '_' ? '_' : '|';
  for (const c of b.children) {
    const k = caretKind(c);
    if (k) return k;
  }
  return null;
}

/** The linear text of a laid-out row (LineIO layouts read left to right), e.g. for the history. */
export function boxText(b: LcdBox): string {
  if (b.kind === 'cursor') return '';
  if (b.kind === 'text') return b.text ?? '';
  return b.children.map(boxText).join('');
}
