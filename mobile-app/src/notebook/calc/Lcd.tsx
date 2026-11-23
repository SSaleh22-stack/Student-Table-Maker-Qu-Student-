/**
 * The calculator LCD (NB-47a), as the design's lcd(): a dark frame around green-grey glass, the
 * status line at the top, the input, and the result at the end side. Draws every P19 view:
 * - calc: the input (natural display through LcdMath), then the result: SOLVE and Pol/Rec lines,
 *   the exact natural form (fractions, surds, π) or the result text, right-aligned;
 * - menu: the question, the numbered items (two per line where the menu has two columns; CONST and
 *   CONV with their Arabic or English names), the prompt line;
 * - error and message: the message and its hint lines;
 * - prompt (CALC/SOLVE 'X?'): the current value, or the entry with its caret;
 * - screen (EQN, MATRIX, VECTOR, STAT, TABLE, INEQ, RATIO): title, a window of the grid around the
 *   selected cell (inverted), the entry or the selected value, results and lines.
 *
 * LCD units (LCD_METRICS) are scaled to pt; the input scrolls in core (layoutDisplay width) and is
 * shrunk to fit its band when it is taller. A tap on the input places the caret (P19 pathAt).
 * The glass content is always left to right, in Arabic too.
 */
import { useEffect, useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { LCD_METRICS, layoutDisplay, pathAt, type KeyDisplayModel } from '@/notebook/core/calc/keys/display';
import type { KeyState } from '@/notebook/core/calc/keys/machine';
import type { LcdBox } from '@/notebook/core/calc/types';
import { CALC_COLORS, nbRadius } from '@/notebook/theme';
import { tr } from '@/lib/i18n';
import { fonts } from '@/lib/theme';

import { LCD_FONT, LcdMath, boxText, caretKind, lcdFontSize } from './LcdMath';
import { StatusLine } from './StatusLine';

const FRAME_PAD = 5;
/** Grid text size on mode screens, relative to the normal LCD text. */
const GRID_SIZE = 0.72;
/** Units per normal text line (ascent + descent). */
const LINE = LCD_METRICS.normal.ascent + LCD_METRICS.normal.descent;

// ===== colors

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** SETUP ◀CONT▶ 1..9: 5 is the design's colors; lower is fainter, higher darker. */
export function lcdColors(contrast: number): { glass: string; ink: string } {
  const c = Number.isFinite(contrast) ? Math.max(1, Math.min(9, Math.round(contrast))) : 5;
  if (c <= 5) return { glass: CALC_COLORS.lcd, ink: mix(CALC_COLORS.lcd, CALC_COLORS.lcdText, 0.35 + (c - 1) * 0.1625) };
  return { glass: mix(CALC_COLORS.lcd, '#9FB09A', (c - 5) * 0.12), ink: mix(CALC_COLORS.lcdText, '#000000', (c - 5) * 0.25) };
}

// ===== caret

function Caret({ x, y, h, kind, color }: { x: number; y: number; h: number; kind: '|' | '_'; color: string }) {
  const on = useSharedValue(1);
  useEffect(() => {
    on.set(1);
    on.set(withRepeat(withSequence(withDelay(530, withTiming(0, { duration: 0 })), withDelay(530, withTiming(1, { duration: 0 }))), -1));
    return () => cancelAnimation(on);
  }, [x, y, h, on]);
  const style = useAnimatedStyle(() => ({ opacity: on.get() }));
  const box = kind === '_' ? { left: x, top: y + h - 2, width: Math.max(6, h * 0.5), height: 2 } : { left: x - 0.75, top: y, width: 1.5, height: h };
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', backgroundColor: color }, box, style]} />;
}

// ===== pieces

interface Geo {
  /** pt per LCD unit. */
  k: number;
  /** Glass content width in LCD units. */
  units: number;
  ink: string;
}

/** A laid-out box drawn with SVG at a fit scale, in a band of the given size (units). */
function MathBand({ box, geo, height, align, fitMax = 1 }: { box: LcdBox; geo: Geo; height: number; align: 'start' | 'end'; fitMax?: number }) {
  const fit = Math.min(fitMax, height / Math.max(1, box.h), align === 'end' ? geo.units / Math.max(1, box.w) : fitMax);
  const w = geo.units;
  const ox = align === 'end' ? (w - box.w * fit) / fit - box.x : 0;
  const oy = Math.max(0, (height - box.h * fit) / 2) / fit;
  return (
    <View style={{ width: w * geo.k, height: height * geo.k, overflow: 'hidden' }}>
      <Svg width={w * geo.k} height={height * geo.k} viewBox={`0 0 ${w / fit} ${height / fit}`}>
        <LcdMath box={box} x={ox} y={oy} color={geo.ink} />
      </Svg>
    </View>
  );
}

function LcdText({ children, geo, size = 1, align = 'left', lines = 1, arabic = false }: { children: string; geo: Geo; size?: number; align?: 'left' | 'right' | 'center'; lines?: number; arabic?: boolean }) {
  const fontSize = lcdFontSize(false) * geo.k * size;
  return (
    <Text
      allowFontScaling={false}
      numberOfLines={lines}
      adjustsFontSizeToFit={lines === 1}
      minimumFontScale={0.5}
      style={{
        fontFamily: arabic ? fonts.medium : LCD_FONT,
        fontSize: arabic ? fontSize * 0.72 : fontSize,
        lineHeight: Math.round(fontSize * 1.2),
        color: geo.ink,
        textAlign: align,
        writingDirection: arabic ? 'auto' : 'ltr',
        includeFontPadding: false,
      }}>
      {children}
    </Text>
  );
}

/** 'X=1.5' as the label at the left and the value at the right. */
function SplitLine({ text, geo, size = 1 }: { text: string; geo: Geo; size?: number }) {
  const i = text.indexOf('=');
  if (i < 0) return <LcdText geo={geo} size={size} align="right">{text}</LcdText>;
  return (
    <View style={styles.ltrRow}>
      <LcdText geo={geo} size={size}>{text.slice(0, i + 1)}</LcdText>
      <View style={{ flex: 1 }}>
        <LcdText geo={geo} size={size} align="right">{text.slice(i + 1)}</LcdText>
      </View>
    </View>
  );
}

/** The grid of a mode screen: a window of rows around the selected one, the selected cell inverted. */
function GridView({ d, geo, rows: maxRows }: { d: KeyDisplayModel; geo: Geo; rows: number }) {
  const grid = d.grid ?? [];
  const sel = d.selected;
  const n = grid.length;
  const visible = Math.max(1, Math.min(maxRows, n));
  const start = sel ? Math.max(0, Math.min(sel.row - Math.floor(visible / 2), n - visible)) : 0;
  const cols = Math.max(1, ...grid.map((r) => r.length), d.header?.length ?? 0);
  const size = GRID_SIZE;
  const lineHeight = Math.round(lcdFontSize(false) * geo.k * size * 1.25);
  const labelW = d.rowLabels ? 2.6 * LCD_METRICS.small.charW * geo.k : 0;
  const cell = (text: string, key: string, inverted: boolean) => (
    <View key={key} style={[styles.cell, inverted ? { backgroundColor: geo.ink } : null]}>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        style={{ fontFamily: LCD_FONT, fontSize: lcdFontSize(false) * geo.k * size, lineHeight, color: inverted ? CALC_COLORS.lcd : geo.ink, textAlign: 'right', writingDirection: 'ltr', includeFontPadding: false }}>
        {text}
      </Text>
    </View>
  );
  return (
    <View>
      {d.header ? (
        <View style={styles.ltrRow}>
          {d.rowLabels ? <View style={{ width: labelW }} /> : null}
          {Array.from({ length: cols }, (_, c) => cell(d.header?.[c] ?? '', `h${c}`, false))}
        </View>
      ) : null}
      {grid.slice(start, start + visible).map((r, i) => {
        const rowIndex = start + i;
        return (
          <View key={rowIndex} style={styles.ltrRow}>
            {d.rowLabels ? (
              <View style={{ width: labelW }}>
                <Text allowFontScaling={false} style={{ fontFamily: LCD_FONT, fontSize: lcdFontSize(true) * geo.k, lineHeight, color: geo.ink, writingDirection: 'ltr', includeFontPadding: false }}>
                  {d.rowLabels[rowIndex] ?? ''}
                </Text>
              </View>
            ) : null}
            {Array.from({ length: cols }, (_, c) => cell(r[c] ?? '', `${rowIndex}-${c}`, !!sel && sel.row === rowIndex && sel.col === c))}
          </View>
        );
      })}
    </View>
  );
}

// ===== the LCD

export interface LcdProps {
  machine: KeyState;
  /** Frame width in pt. */
  width: number;
  /** Shorter glass for tight layouts (phones). */
  dense?: boolean;
  /** Tap on the calculation input: the caret path (P19 pathAt). */
  onTapInput?(path: number[]): void;
}

/** Sizes of the LCD for a frame width (pt). Every view has the same fixed height. */
export function lcdGeometry(width: number, dense: boolean = false) {
  const s = Math.max(0.8, Math.min(1.5, width / 312));
  const padX = Math.round(12 * s);
  const padY = Math.round(8 * s);
  const glassW = Math.max(40, width - 2 * FRAME_PAD - 2 * padX);
  const k = Math.min(glassW / LCD_METRICS.width, 1.4 * s);
  const inputBand = dense ? 34 : 42;
  const resultBand = dense ? 28 : 34;
  const statusSize = Math.round(10 * s);
  const statusH = Math.round(statusSize * 1.3);
  const height = 2 * FRAME_PAD + 2 * padY + statusH + (inputBand + resultBand) * k;
  return { s, padX, padY, glassW, k, units: glassW / k, inputBand, resultBand, statusSize, height };
}

export function Lcd({ machine, width, dense = false, onTapInput }: LcdProps) {
  const { padX, padY, glassW, k, units, inputBand, resultBand, statusSize } = lcdGeometry(width, dense);
  const d = useMemo(() => layoutDisplay(machine, { width: units }), [machine, units]);
  const { glass, ink } = lcdColors(d.contrast);
  const geo: Geo = { k, units, ink };

  const caret = d.cursor ? { ...d.cursor, kind: caretKind(d.input) ?? '|' } : null;

  /** The input band with an optional caret and tap-to-caret. */
  const inputArea = (tappable: boolean, band: number = inputBand) => {
    const fit = Math.min(1, band / Math.max(1, d.input.h));
    const oy = Math.max(0, (band - d.input.h * fit) / 2) / fit;
    const onPress = (e: GestureResponderEvent) => {
      if (!onTapInput) return;
      const ux = e.nativeEvent.locationX / (k * fit);
      const uy = e.nativeEvent.locationY / (k * fit) - oy;
      const path = pathAt(d.input, ux, uy);
      if (path) onTapInput(path);
    };
    // pointerEvents none: the touch lands on the Pressable itself, so locationX and locationY are
    // measured from the band's origin (they are relative to the touched view, which could otherwise
    // be an SVG text node inside it).
    const body = (
      <View pointerEvents="none" style={{ width: glassW, height: band * k, overflow: 'hidden' }}>
        <Svg width={glassW} height={band * k} viewBox={`0 0 ${units / fit} ${band / fit}`}>
          <LcdMath box={d.input} x={0} y={oy} color={ink} />
        </Svg>
        {caret ? <Caret x={caret.x * k * fit} y={(caret.y + oy) * k * fit} h={caret.h * k * fit} kind={caret.kind} color={ink} /> : null}
      </View>
    );
    if (!tappable || !onTapInput) return body;
    return (
      <Pressable onPress={onPress} accessible={false}>
        {body}
      </Pressable>
    );
  };

  let content: ReactNode;
  switch (d.view) {
    case 'calc': {
      let result: ReactNode = <View style={{ height: resultBand * k }} />;
      if (d.lines && d.lines.length) {
        result = (
          <View style={{ height: resultBand * k, justifyContent: 'flex-end' }}>
            {d.lines.slice(0, 2).map((l, i) => (
              <SplitLine key={i} text={l} geo={geo} size={d.lines && d.lines.length > 1 ? 0.8 : 1.15} />
            ))}
          </View>
        );
      } else if (d.grid && d.grid.length) {
        result = (
          <View style={{ height: resultBand * k, justifyContent: 'flex-end' }}>
            <GridView d={d} geo={geo} rows={2} />
          </View>
        );
      } else if (d.result?.exact) {
        result = <MathBand box={d.result.exact} geo={geo} height={resultBand} align="end" fitMax={1.2} />;
      } else if (d.result) {
        result = (
          <View style={{ height: resultBand * k, justifyContent: 'flex-end' }}>
            <LcdText geo={geo} size={1.3} align="right">{d.result.text}</LcdText>
          </View>
        );
      }
      content = (
        <>
          {inputArea(true)}
          {result}
        </>
      );
      break;
    }
    case 'error':
    case 'message': {
      content = (
        <View style={{ height: (inputBand + resultBand) * k, justifyContent: 'center' }}>
          <LcdText geo={geo} size={d.view === 'error' ? 1.05 : 1} align={d.view === 'error' ? 'center' : 'left'}>{boxText(d.input)}</LcdText>
          {(d.lines ?? []).map((l, i) => (
            <LcdText key={i} geo={geo} size={d.view === 'error' ? 0.75 : 1} align={d.view === 'error' ? 'center' : 'right'}>{l}</LcdText>
          ))}
        </View>
      );
      break;
    }
    case 'menu': {
      const rowsH = (inputBand + resultBand) * k;
      const lineH = lcdFontSize(false) * k * 1.2;
      const extra = (d.title ? 1 : 0) + (d.lines?.length ?? 0);
      // Items in grid order, each with its long name (CONST, CONV).
      const items = (d.grid ?? []).flat().map((label, i) => ({ label, hint: d.hints?.[i] ?? null }));
      let perLine = Math.max(1, ...(d.grid ?? []).map((r) => r.length));
      let size = Math.min(1, rowsH / Math.max(1, Math.ceil(items.length / perLine) + extra) / lineH);
      // A long one-column list (CONST, CONV: 8 per page) reads better in two columns than tiny.
      if (perLine === 1 && size < 0.7 && items.length > 4) {
        perLine = 2;
        size = Math.min(1, rowsH / (Math.ceil(items.length / 2) + extra) / lineH);
      }
      size = Math.max(0.45, size);
      const lines: (typeof items)[] = [];
      for (let i = 0; i < items.length; i += perLine) lines.push(items.slice(i, i + perLine));
      content = (
        <View style={{ height: rowsH, justifyContent: 'center' }}>
          {d.title ? <LcdText geo={geo} size={size}>{d.title}</LcdText> : null}
          {lines.map((r, i) => (
            <View key={i} style={styles.ltrRow}>
              {r.map((it, j) => (
                <View key={j} style={[styles.ltrRow, { flex: 1, gap: 4, alignItems: 'center' }]}>
                  <LcdText geo={geo} size={size}>{it.label}</LcdText>
                  {it.hint ? (
                    <View style={{ flex: 1, paddingEnd: 4 }}>
                      <LcdText geo={geo} size={size} align={perLine === 1 ? 'right' : 'left'} arabic>{tr(it.hint.ar, it.hint.en)}</LcdText>
                    </View>
                  ) : null}
                </View>
              ))}
              {r.length < perLine ? <View style={{ flex: perLine - r.length }} /> : null}
            </View>
          ))}
          {(d.lines ?? []).map((l, i) => (
            <LcdText key={`l${i}`} geo={geo} size={size} align="center">{l}</LcdText>
          ))}
        </View>
      );
      break;
    }
    case 'prompt': {
      const typing = d.input.w > 0;
      content = (
        <View style={{ height: (inputBand + resultBand) * k, justifyContent: 'space-between' }}>
          <LcdText geo={geo}>{d.title ?? ''}</LcdText>
          {inputArea(false, LINE * 1.6)}
          {typing ? <View style={{ height: LINE * k }} /> : <LcdText geo={geo} size={1.15} align="right">{d.lines?.[0] ?? ''}</LcdText>}
        </View>
      );
      break;
    }
    case 'screen': {
      const entry = !!d.cursor;
      const bottom = entry ? (
        inputArea(false, LINE * 1.3)
      ) : boxText(d.input) !== '' ? (
        <LcdText geo={geo} size={0.85} align="right">{boxText(d.input)}</LcdText>
      ) : null;
      const hasGrid = !!d.grid && d.grid.length > 0;
      const titleLine = lcdFontSize(false) * k * 0.85 * 1.2;
      const cellLine = Math.round(lcdFontSize(false) * k * GRID_SIZE * 1.25);
      const used = (d.title ? titleLine : 0) + (bottom ? (entry ? LINE * 1.3 * k : titleLine) : 0) + (d.header ? cellLine : 0) + (d.result ? lcdFontSize(false) * k * 1.3 * 1.2 : 0);
      const gridRows = Math.max(1, Math.floor(((inputBand + resultBand) * k - used) / cellLine));
      content = (
        <View style={{ height: (inputBand + resultBand) * k, justifyContent: 'space-between' }}>
          {d.title ? <LcdText geo={geo} size={0.85}>{d.title}</LcdText> : null}
          {hasGrid ? <GridView d={d} geo={geo} rows={gridRows} /> : null}
          {d.lines && d.lines.length ? (
            <View>
              {d.lines.slice(0, 4).map((l, i) => (
                <LcdText key={i} geo={geo} size={d.lines && d.lines.length > 2 ? 0.75 : 1} align="center">{l}</LcdText>
              ))}
            </View>
          ) : null}
          {d.result ? <LcdText geo={geo} size={1.3} align="right">{d.result.text}</LcdText> : null}
          {!hasGrid && entry ? (
            <View style={{ flex: 1, justifyContent: 'center' }}>{inputArea(false)}</View>
          ) : (
            bottom
          )}
        </View>
      );
      break;
    }
  }

  const spoken = [d.view === 'calc' ? boxText(d.input) : d.title ?? boxText(d.input), d.result?.text ?? '', ...(d.lines ?? [])].filter(Boolean).join('، ');
  return (
    <View style={[styles.frame, { width, padding: FRAME_PAD }]}>
      <View
        style={[styles.glass, { backgroundColor: glass, paddingHorizontal: padX, paddingVertical: padY }]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={spoken || tr('الشاشة فارغة', 'Display empty')}
        accessibilityLiveRegion="polite">
        <StatusLine flags={d.status} more={d.more} color={ink} size={statusSize} />
        {content}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: CALC_COLORS.lcdEdge, borderRadius: nbRadius.thumb },
  glass: { borderRadius: nbRadius.lcd, direction: 'ltr', overflow: 'hidden' },
  ltrRow: { flexDirection: 'row', direction: 'ltr' },
  cell: { flex: 1, paddingHorizontal: 3, borderRadius: 2 },
});
