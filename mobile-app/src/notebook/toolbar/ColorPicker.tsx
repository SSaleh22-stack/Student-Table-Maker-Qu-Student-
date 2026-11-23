/**
 * Custom color picker (P13, NB-40 / NB-41 "plus a color picker for any other color"):
 * - ColorPicker: an HSV square (saturation across, brightness down), a hue bar and a hex field, with
 *   a preview of the new color beside the current one.
 * - ColorPickerSheet: the picker in an NbSheet with a 'حفظ' button. Saving adds the color to the
 *   saved custom colors (settings.customColors: newest first, no duplicates, capped) and calls onSave.
 *
 * The square and the bar are drawn with react-native-svg and never mirror: saturation grows toward the
 * physical right in both languages, like every color picker. Touch positions (locationX) are physical
 * too, and the knobs are placed with physicalLeft. Dragging keeps the touch (the sheet's scroll view
 * cannot take it over). The hex field is the screen-reader friendly way to type an exact color; the
 * square and the bar are also adjustable (swipe up / down).
 */
import { useId, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors, fonts } from '@/lib/theme';
import type { Hex } from '@/notebook/core/model';
import { addCustomColor, hexToHsv, hsvToHex, hueColor, normalizeHex, type Hsv } from '@/notebook/core/toolbar/colors';
import { settingsStore } from '@/notebook/store/settingsStore';
import { nbRadius } from '@/notebook/theme';
import { NbSheet, PillButton, physicalLeft } from '@/notebook/ui';

const SQUARE_H = 190;
const HUE_H = 28;
const KNOB = 22;
const HUE_STOPS = ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export interface ColorPickerProps {
  value: Hex;
  onChange: (hex: Hex) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [width, setWidth] = useState(300);
  const [hexText, setHexText] = useState(value.slice(0, 7).toUpperCase());
  const hex = useMemo(() => hsvToHex(hsv), [hsv]);

  const apply = (next: Hsv) => {
    setHsv(next);
    const h = hsvToHex(next);
    setHexText(h);
    onChange(h);
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== width) setWidth(w);
  };

  const squareAt = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    apply({ h: hsv.h, s: clamp01(locationX / width), v: clamp01(1 - locationY / SQUARE_H) });
  };
  const hueAt = (e: GestureResponderEvent) => {
    const h = clamp01(e.nativeEvent.locationX / width) * 360;
    // Keep a little color when the student picks a hue on a grey: a hue on pure grey shows nothing.
    apply({ h: Math.min(359.9, h), s: hsv.s < 0.05 ? 1 : hsv.s, v: hsv.v < 0.05 ? 1 : hsv.v });
  };

  const responder = (at: (e: GestureResponderEvent) => void) => ({
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: at,
    onResponderMove: at,
  });

  const onHexChange = (t: string) => {
    setHexText(t);
    const n = normalizeHex(t);
    if (n && (t.replace('#', '').length === 6 || t.replace('#', '').length === 3)) {
      const next = hexToHsv(n);
      setHsv(next);
      onChange(n);
    }
  };

  const percent = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <View style={styles.wrap}>
      <View
        onLayout={onLayout}
        style={[styles.square, { height: SQUARE_H }]}
        {...responder(squareAt)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={tr('درجة اللون وسطوعه', 'Saturation and brightness')}
        accessibilityValue={{ text: `${tr('التشبع', 'Saturation')} ${percent(hsv.s)}، ${tr('السطوع', 'Brightness')} ${percent(hsv.v)}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const step = e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1;
          apply({ ...hsv, v: clamp01(hsv.v + step) });
        }}>
        <Svg width={width} height={SQUARE_H} pointerEvents="none">
          <Defs>
            <LinearGradient id={`sat${id}`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="1" />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </LinearGradient>
            <LinearGradient id={`val${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity="0" />
              <Stop offset="1" stopColor="#000000" stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={SQUARE_H} rx={nbRadius.thumb} fill={hueColor(hsv.h)} />
          <Rect x={0} y={0} width={width} height={SQUARE_H} rx={nbRadius.thumb} fill={`url(#sat${id})`} />
          <Rect x={0} y={0} width={width} height={SQUARE_H} rx={nbRadius.thumb} fill={`url(#val${id})`} />
        </Svg>
        <View
          pointerEvents="none"
          style={[styles.knob, { top: (1 - hsv.v) * SQUARE_H - KNOB / 2, backgroundColor: hex }, physicalLeft(hsv.s * width - KNOB / 2)]}
        />
      </View>

      <View
        style={[styles.hue, { height: HUE_H }]}
        {...responder(hueAt)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={tr('اللون', 'Hue')}
        accessibilityValue={{ min: 0, max: 360, now: Math.round(hsv.h) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const step = e.nativeEvent.actionName === 'increment' ? 15 : -15;
          apply({ ...hsv, h: (hsv.h + step + 360) % 360 });
        }}>
        <Svg width={width} height={HUE_H} pointerEvents="none">
          <Defs>
            <LinearGradient id={`hue${id}`} x1="0" y1="0" x2="1" y2="0">
              {HUE_STOPS.map((c, i) => (
                <Stop key={i} offset={String(i / (HUE_STOPS.length - 1))} stopColor={c} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={HUE_H} rx={HUE_H / 2} fill={`url(#hue${id})`} />
        </Svg>
        <View
          pointerEvents="none"
          style={[
            styles.hueKnob,
            { top: (HUE_H - KNOB - 4) / 2, backgroundColor: hueColor(hsv.h) },
            physicalLeft((hsv.h / 360) * width - (KNOB + 4) / 2),
          ]}
        />
      </View>

      <View style={[styles.hexRow, { flexDirection: row }]}>
        <View style={[styles.preview, { backgroundColor: hex }]} accessibilityElementsHidden importantForAccessibility="no" />
        <View style={styles.hexField}>
          <AppText size={13} weight="semibold" color={colors.muted}>
            {tr('رمز اللون', 'Color code')}
          </AppText>
          <TextInput
            value={hexText}
            onChangeText={onHexChange}
            onEndEditing={() => setHexText(hex)}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            accessibilityLabel={tr('رمز اللون', 'Color code')}
            placeholder="#0E7490"
            placeholderTextColor={colors.placeholder}
            style={styles.hexInput}
          />
        </View>
      </View>
    </View>
  );
}

export interface ColorPickerSheetProps {
  visible: boolean;
  /** The color the picker starts from (the tool's current color). */
  initial: Hex;
  title?: string;
  /** Called with the saved color after it was added to the custom colors. */
  onSave: (hex: Hex) => void;
  onClose: () => void;
}

function SheetBody({ initial, onSave, onClose }: Omit<ColorPickerSheetProps, 'visible' | 'title'>) {
  const [hex, setHex] = useState<Hex>(normalizeHex(initial) ?? '#0E7490');
  return (
    <View style={styles.body}>
      <ColorPicker value={hex} onChange={setHex} />
      <PillButton
        label={tr('حفظ', 'Save')}
        block
        onPress={() => {
          settingsStore.set((s) => ({ customColors: addCustomColor(s.customColors, hex) }));
          onSave(hex);
          onClose();
        }}
      />
    </View>
  );
}

export function ColorPickerSheet({ visible, initial, title, onSave, onClose }: ColorPickerSheetProps) {
  return (
    <NbSheet visible={visible} title={title ?? tr('لون مخصص', 'Custom color')} onClose={onClose} width={420}>
      {visible ? <SheetBody initial={initial} onSave={onSave} onClose={onClose} /> : null}
    </NbSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  body: { gap: 20, paddingBottom: 4 },
  square: { borderRadius: nbRadius.thumb, overflow: 'visible' },
  knob: {
    position: 'absolute',
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  hue: { justifyContent: 'center' },
  hueKnob: {
    position: 'absolute',
    width: KNOB + 4,
    height: KNOB + 4,
    borderRadius: (KNOB + 4) / 2,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  hexRow: { alignItems: 'center', gap: 14 },
  preview: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: colors.borderStrong },
  hexField: { flex: 1, gap: 6 },
  hexInput: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: nbRadius.input,
    paddingHorizontal: 16,
    paddingVertical: 12,
    writingDirection: 'ltr',
  },
});
