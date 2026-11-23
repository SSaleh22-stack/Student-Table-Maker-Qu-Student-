/**
 * PHASE 0 SPIKE (development builds only; /notebook/spike redirects in release). The owner runs it on
 * the reference iPad (Apple Pencil) and the Android tablet (S Pen) and reports the results checklist
 * at the bottom (shared plan TESTING 7: G-INK, G-MEM, G-PDF, G-AUDIO, G-RTL). Nothing here is shown
 * to students.
 *
 * (a) INK INPUT (G-INK): a Skia canvas under a manual gesture (useManualGesture) with NO maxPointers
 *     that locks to the FIRST pointer, the way the editor's draw gesture (P22) will. Every touch event
 *     is logged with its pointerType and the active pointer count; a simultaneous pan gesture logs
 *     stylusData (pressure, tilt), which manual gestures do not carry. Scripted cases: palm first,
 *     pen first, palm during a stroke. Pass/fail is judged by the owner.
 * (b) LATENCY: the wet ink runs on the UI thread with core/ink/wetOutline.ts (frozen path + tail),
 *     a frame-time overlay (useFrameCallback) and the time of each wet step; a synthetic
 *     4000-point stroke checks the O(window) step cost and the WET_MAX_POINTS split. Committed
 *     strokes are drawn by the real painter (ink/ appendStrokePicture, on the JS runtime).
 *     The wet paths are the ONE place Skia objects are made in a worklet (small SkPaths, exactly as
 *     P22's wet ink will); images, pictures and paragraphs stay on the JS runtime.
 * (c) PDF (G-MEM, G-PDF): pick a PDF; preview + tiles at 400 % through the imageBudget; 20
 *     renderRegion calls plus one renderPage at once; a scroll test over up to 100 pages (visible
 *     page +-1 pinned, tiles on each page) with a live readout of the budget total and its peak.
 * (d) AUDIO (G-AUDIO): record with VOICE (m4a) or its ADTS twin, then kill the app with a swipe from
 *     the app switcher (JS cannot crash the native process on purpose: there is no process.exit),
 *     reopen this screen and probe the file of the killed recording (playable? length? seeks?).
 * (e) RTL (G-RTL): two boxes placed with physicalLeft(0) and physicalLeft(100); measureInWindow
 *     checks they land 0 and 100 pt from the PHYSICAL left edge in this build.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Canvas, Fill, Image as SkiaImage, Path, Picture, Skia, type SkImage, type SkPath, type SkPicture } from '@shopify/react-native-skia';
import { createAudioPlayer, setAudioModeAsync, useAudioRecorder, type RecordingOptions } from 'expo-audio';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { Alert, I18nManager, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, GestureStateManager, useManualGesture, usePanGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { AppText } from '@/components/AppText';
import { tr } from '@/lib/i18n';
import { ensureMicPermission } from '@/notebook/audio/permissions';
import { VOICE } from '@/notebook/audio/presets';
import { probeAudio } from '@/notebook/audio/recovery';
import { isPdfError, type PdfPageSize } from '@/notebook/core/contracts/pdf';
import { getStroke, strokeOptions } from '@/notebook/core/ink/freehand';
import { outlineToCommands } from '@/notebook/core/ink/outline';
import { WET_MAX_POINTS, wetCarry, wetCreate, wetReset, wetShouldSplit, wetStep } from '@/notebook/core/ink/wetOutline';
import { newId, type StrokeItem } from '@/notebook/core/model';
import { regionOf, tilesFor, type TileSpec } from '@/notebook/core/pdf/tiles';
import {
  EMPTY_PAINT_CONTEXT,
  IMAGE_BUDGET_BYTES,
  MAX_LIVE_TILES,
  appendStrokePicture,
  budgetStats,
  disposeLater,
  holdImage,
  loadImage,
  pdfPreviewDecoder,
  pdfPreviewKey,
  pdfPreviewWidth,
  pdfTileDecoder,
  pdfTileKey,
  recordPicture,
  resetBudgetPeak,
  subscribeBudget,
  subscribeImage,
  withPdf,
} from '@/notebook/ink';
import { goBackOr } from '@/notebook/nav';
import { nbColors } from '@/notebook/theme';
import { PHYSICAL_SWAP, physicalLeft } from '@/notebook/ui/physical';

// ===== shared bits

type ResultKey =
  | 'ink.palmFirst'
  | 'ink.penFirst'
  | 'ink.palmDuring'
  | 'ink.latency'
  | 'ink.4000'
  | 'pdf.tiles400'
  | 'pdf.concurrent'
  | 'mem.scroll'
  | 'audio.stop'
  | 'audio.kill'
  | 'rtl';

type Report = (key: ResultKey, value: string) => void;

const RESULT_ROWS: { gate: string; key: ResultKey; label: string }[] = [
  { gate: 'G-INK', key: 'ink.palmFirst', label: 'palm first' },
  { gate: 'G-INK', key: 'ink.penFirst', label: 'pen first' },
  { gate: 'G-INK', key: 'ink.palmDuring', label: 'palm during a stroke' },
  { gate: 'G-INK', key: 'ink.latency', label: 'frame time / wet step' },
  { gate: 'G-INK', key: 'ink.4000', label: '4000-point stroke' },
  { gate: 'G-PDF', key: 'pdf.tiles400', label: 'preview + tiles at 400 %' },
  { gate: 'G-PDF', key: 'pdf.concurrent', label: '20 concurrent renders' },
  { gate: 'G-MEM', key: 'mem.scroll', label: 'scroll test, budget peak' },
  { gate: 'G-AUDIO', key: 'audio.stop', label: 'normal stop' },
  { gate: 'G-AUDIO', key: 'audio.kill', label: 'killed recording' },
  { gate: 'G-RTL', key: 'rtl', label: 'physicalLeft 0 / 100' },
];

const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function nowMs(): number {
  'worklet';
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

const POINTER_NAMES = ['touch', 'stylus', 'mouse', 'key', 'other'];

function pointerName(t: number): string {
  'worklet';
  return POINTER_NAMES[t] ?? `type${t}`;
}

function Button({ label, onPress, tone = 'accent', disabled }: { label: string; onPress: () => void; tone?: 'accent' | 'plain' | 'danger'; disabled?: boolean }) {
  const bg = tone === 'accent' ? nbColors.accent : tone === 'danger' ? nbColors.dangerSoft : nbColors.surfaceMuted;
  const fg = tone === 'accent' ? nbColors.white : tone === 'danger' ? nbColors.danger : nbColors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}
    >
      <AppText size={14} weight="medium" color={fg}>
        {label}
      </AppText>
    </Pressable>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText size={17} weight="bold">
        {title}
      </AppText>
      <AppText size={13} color={nbColors.muted}>
        {subtitle}
      </AppText>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <AppText style={styles.mono}>{children}</AppText>;
}

function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function PassFail({ k, report }: { k: ResultKey; report: Report }) {
  return (
    <Row>
      <Button label={tr('نجح', 'Pass')} tone="plain" onPress={() => report(k, 'PASS')} />
      <Button label={tr('فشل', 'Fail')} tone="danger" onPress={() => report(k, 'FAIL')} />
    </Row>
  );
}

// ===== (a) + (b) ink

const INK_HEIGHT = 380;
const PEN_STYLE: Pick<StrokeItem, 'tool' | 'width' | 'pressure'> = { tool: 'pen', width: 3, pressure: true };
const WET_OPTS = strokeOptions(PEN_STYLE, false);
const INK_COLOR = '#1B2533';
const LOG_MAX = 120;

type InkCase = 'ink.palmFirst' | 'ink.penFirst' | 'ink.palmDuring';

const INK_CASES: { key: InkCase; title: string; steps: string }[] = [
  {
    key: 'ink.palmFirst',
    title: tr('الكف أولاً', 'Palm first'),
    steps: tr(
      'ضع كفك على اللوحة أولاً، ثم اكتب بالقلم دون رفع الكف. المطلوب: الحبر يتبع القلم لا الكف.',
      'Rest your palm on the canvas first, then write with the pen without lifting the palm. Expected: ink follows the pen, not the palm.',
    ),
  },
  {
    key: 'ink.penFirst',
    title: tr('القلم أولاً', 'Pen first'),
    steps: tr('ابدأ بالقلم، ثم ضع الكف أثناء الكتابة. المطلوب: خط واحد متصل بالقلم.', 'Start with the pen, then rest your palm while writing. Expected: one continuous pen line.'),
  },
  {
    key: 'ink.palmDuring',
    title: tr('الكف أثناء الخط', 'Palm during a stroke'),
    steps: tr(
      'اكتب خطاً طويلاً، وحرك الكف على اللوحة في منتصفه. المطلوب: الخط لا ينقطع ولا يظهر حبر من الكف.',
      'Draw a long stroke and drag your palm on the canvas halfway through. Expected: the stroke does not break and the palm leaves no ink.',
    ),
  },
];

function InkSection({ report }: { report: Report }) {
  const [width, setWidth] = useState(0);
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const pictureRef = useRef<SkPicture | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [caseKey, setCaseKey] = useState<InkCase>('ink.palmFirst');
  const [stats, setStats] = useState('');
  const [synthetic, setSynthetic] = useState('');

  const locked = useSharedValue(-1);
  const lockedType = useSharedValue(-1);
  const active = useSharedValue(0);
  const moves = useSharedValue(0);
  const seq = useSharedValue(0);
  const pressure = useSharedValue(0.5);
  const pts = useSharedValue<number[]>([]);
  const wet = useSharedValue<number[]>(wetCreate());
  // Lazy initial paths: useSharedValue(Skia.Path.Make()) would make (and drop) two paths per render.
  const [initialFrozen] = useState(() => Skia.Path.Make());
  const [initialTail] = useState(() => Skia.Path.Make());
  const frozen = useSharedValue<SkPath>(initialFrozen);
  const tail = useSharedValue<SkPath>(initialTail);
  const stepLast = useSharedValue(0);
  const stepMax = useSharedValue(0);
  const workMax = useSharedValue(0);
  const frames = useSharedValue(0);
  const frameSum = useSharedValue(0);
  const frameMax = useSharedValue(0);
  const slowFrames = useSharedValue(0);

  useFrameCallback((f) => {
    'worklet';
    const dt = f.timeSincePreviousFrame;
    if (dt === null || dt <= 0 || dt > 1000) return;
    frames.set(frames.get() + 1);
    frameSum.set(frameSum.get() + dt);
    if (dt > frameMax.get()) frameMax.set(dt);
    if (dt > 20) slowFrames.set(slowFrames.get() + 1);
  });

  useEffect(() => {
    const id = setInterval(() => {
      const n = frames.get();
      const avg = n > 0 ? frameSum.get() / n : 0;
      setStats(
        `frames ${n} · avg ${avg.toFixed(1)} ms · max ${frameMax.get().toFixed(1)} ms · >20 ms ${slowFrames.get()} · wet step ${stepLast.get().toFixed(2)} ms (max ${stepMax.get().toFixed(2)}) · work max ${workMax.get()}`,
      );
    }, 500);
    return () => clearInterval(id);
  }, [frames, frameSum, frameMax, slowFrames, stepLast, stepMax, workMax]);

  // The committed strokes picture is the painter's (JS runtime); replaced pictures are disposed later.
  const setCommitted = useCallback((next: SkPicture | null) => {
    const prev = pictureRef.current;
    pictureRef.current = next;
    setPicture(next);
    disposeLater(prev);
  }, []);
  useEffect(() => () => setCommitted(null), [setCommitted]);

  const pushLog = useCallback((line: string) => {
    setLog((l) => {
      const next = l.length >= LOG_MAX ? l.slice(l.length - LOG_MAX + 1) : l.slice();
      next.push(line);
      return next;
    });
  }, []);

  const clearWet = useCallback(
    (strokeSeq: number) => {
      'worklet';
      if (seq.get() !== strokeSeq || locked.get() >= 0) return;
      frozen.set(Skia.Path.Make());
      tail.set(Skia.Path.Make());
    },
    [seq, locked, frozen, tail],
  );

  const commitStroke = useCallback(
    (raw: number[], strokeSeq: number, keepWet: boolean) => {
      if (raw.length < 3) return;
      const item: StrokeItem = { id: newId(), kind: 'stroke', tool: 'pen', color: INK_COLOR, width: PEN_STYLE.width, pressure: true, pts: raw };
      const size = { w: Math.max(1, width), h: INK_HEIGHT };
      const prev = pictureRef.current ?? recordPicture(size.w, size.h, () => undefined);
      const next = appendStrokePicture(prev, item, EMPTY_PAINT_CONTEXT, { size });
      if (!pictureRef.current) disposeLater(prev);
      setCommitted(next);
      // Drop the wet paths only after the committed picture had a frame to show.
      if (!keepWet) requestAnimationFrame(() => requestAnimationFrame(() => scheduleOnUI(clearWet, strokeSeq)));
    },
    [width, setCommitted, clearWet],
  );

  const stepWet = useCallback(() => {
    'worklet';
    const t0 = nowMs();
    const p = pts.get();
    wet.modify((st) => {
      'worklet';
      const r = wetStep(st, p, WET_OPTS);
      if (r.frozenOutlineAppend.length > 0) {
        const patch = Skia.Path.MakeFromCmds(outlineToCommands(r.frozenOutlineAppend, true));
        if (patch) {
          const b = Skia.PathBuilder.MakeFromPath(frozen.get());
          b.addPath(patch);
          frozen.set(b.build());
        }
      }
      const t = Skia.Path.MakeFromCmds(outlineToCommands(r.tail, true));
      if (t) tail.set(t);
      if (r.work > workMax.get()) workMax.set(r.work);
      return st;
    }, false);
    const dt = nowMs() - t0;
    stepLast.set(dt);
    if (dt > stepMax.get()) stepMax.set(dt);
  }, [pts, wet, frozen, tail, workMax, stepLast, stepMax]);

  const draw = useManualGesture({
    onTouchesDown: (e) => {
      'worklet';
      active.set(e.numberOfTouches);
      const ids = e.changedTouches.map((t) => t.id).join(',');
      scheduleOnRN(pushLog, `down ${pointerName(e.pointerType)} ids=${ids} active=${e.numberOfTouches} locked=${locked.get()}`);
      if (locked.get() >= 0 || e.changedTouches.length === 0) return;
      const t = e.changedTouches[0];
      locked.set(t.id);
      lockedType.set(e.pointerType);
      seq.set(seq.get() + 1);
      GestureStateManager.activate(e.handlerTag);
      scheduleOnRN(pushLog, `LOCK id=${t.id} (${pointerName(e.pointerType)})`);
      pts.set([t.x, t.y, pressure.get()]);
      wet.modify((st) => {
        'worklet';
        wetReset(st);
        return st;
      }, false);
      frozen.set(Skia.Path.Make());
      stepWet();
    },
    onTouchesMove: (e) => {
      'worklet';
      active.set(e.numberOfTouches);
      moves.set(moves.get() + 1);
      if (moves.get() % 10 === 0) scheduleOnRN(pushLog, `move ${pointerName(e.pointerType)} active=${e.numberOfTouches}`);
      if (locked.get() < 0) return;
      const t = e.allTouches.find((x) => x.id === locked.get());
      if (!t) return;
      const pr = pressure.get();
      pts.modify((a) => {
        'worklet';
        a.push(t.x, t.y, pr);
        return a;
      }, false);
      if (wetShouldSplit(pts.get())) {
        // WET_MAX_POINTS reached: commit this part and continue from its last point.
        scheduleOnRN(commitStroke, pts.get().slice(), seq.get(), true);
        pts.set(wetCarry(pts.get()));
        wet.modify((st) => {
          'worklet';
          wetReset(st);
          return st;
        }, false);
        frozen.set(Skia.Path.Make());
        scheduleOnRN(pushLog, `split at ${WET_MAX_POINTS} points`);
      }
      stepWet();
    },
    onTouchesUp: (e) => {
      'worklet';
      active.set(Math.max(0, e.numberOfTouches - e.changedTouches.length));
      const ids = e.changedTouches.map((t) => t.id).join(',');
      scheduleOnRN(pushLog, `up ${pointerName(e.pointerType)} ids=${ids} active=${e.numberOfTouches}`);
      if (locked.get() >= 0 && e.changedTouches.some((t) => t.id === locked.get())) {
        scheduleOnRN(pushLog, `RELEASE id=${locked.get()} (${pointerName(lockedType.get())}) points=${pts.get().length / 3}`);
        locked.set(-1);
        scheduleOnRN(commitStroke, pts.get().slice(), seq.get(), false);
      }
      if (e.numberOfTouches <= e.changedTouches.length) GestureStateManager.deactivate(e.handlerTag);
    },
    onTouchesCancel: (e) => {
      'worklet';
      scheduleOnRN(pushLog, `cancel ${pointerName(e.pointerType)} active=${e.numberOfTouches}`);
      if (locked.get() >= 0 && e.changedTouches.some((t) => t.id === locked.get())) {
        locked.set(-1);
        scheduleOnRN(commitStroke, pts.get().slice(), seq.get(), false);
      }
    },
  });

  // Manual gestures carry no stylusData: a simultaneous pan logs it (pressure feeds the wet ink).
  const stylus = usePanGesture({
    minDistance: 0,
    onUpdate: (e) => {
      'worklet';
      const sd = (e as { stylusData?: { pressure: number; tiltX: number; tiltY: number } }).stylusData;
      if (sd && Number.isFinite(sd.pressure) && sd.pressure > 0) pressure.set(Math.min(1, sd.pressure));
      if (moves.get() % 10 === 0 && sd) scheduleOnRN(pushLog, `stylus p=${sd.pressure.toFixed(2)} tilt=${sd.tiltX.toFixed(0)},${sd.tiltY.toFixed(0)} ptr=${pointerName(e.pointerType)}`);
    },
  });
  const gesture = useSimultaneousGestures(draw, stylus);

  const resetStats = () => {
    frames.set(0);
    frameSum.set(0);
    frameMax.set(0);
    slowFrames.set(0);
    stepMax.set(0);
    workMax.set(0);
  };

  const clearCanvas = () => {
    setCommitted(null);
    frozen.set(Skia.Path.Make());
    tail.set(Skia.Path.Make());
    setLog([]);
  };

  const runSynthetic = async () => {
    const w = Math.max(200, width);
    setSynthetic(tr('يعمل…', 'Running…'));
    const result = await new Promise<{ total: number; max: number; work: number; split: boolean; pts: number[] }>((resolve) => {
      scheduleOnUI(
        (cw: number, ch: number) => {
          'worklet';
          const state = wetCreate();
          const raw: number[] = [];
          let total = 0;
          let max = 0;
          let work = 0;
          let last: number[] = [];
          for (let i = 0; i < WET_MAX_POINTS; i++) {
            const a = i * 0.02;
            const r = 20 + (i / WET_MAX_POINTS) * (Math.min(cw, ch) / 2 - 30);
            raw.push(cw / 2 + Math.cos(a) * r, ch / 2 + Math.sin(a) * r, 0.5 + 0.4 * Math.sin(i * 0.05));
            const t0 = nowMs();
            const s = wetStep(state, raw, WET_OPTS);
            const dt = nowMs() - t0;
            total += dt;
            if (dt > max) max = dt;
            if (s.work > work) work = s.work;
            last = s.tail;
          }
          frozen.set(Skia.Path.Make());
          const t = Skia.Path.MakeFromCmds(outlineToCommands(last, true));
          if (t) tail.set(t);
          scheduleOnRN(resolve, { total, max, work, split: wetShouldSplit(raw), pts: raw });
        },
        w,
        INK_HEIGHT,
      );
    });
    const t0 = Date.now();
    const outline = getStroke(result.pts, strokeOptions(PEN_STYLE, true));
    const fullMs = Date.now() - t0;
    commitStroke(result.pts, seq.get(), false);
    const line = `${WET_MAX_POINTS} pts · wet total ${result.total.toFixed(1)} ms · step avg ${(result.total / WET_MAX_POINTS).toFixed(3)} ms · step max ${result.max.toFixed(2)} ms · work max ${result.work} · split ${result.split ? 'yes' : 'NO'} · full getStroke (JS) ${fullMs} ms, ${outline.length / 2} outline pts`;
    setSynthetic(line);
    report('ink.4000', line);
  };

  const current = INK_CASES.find((c) => c.key === caseKey) ?? INK_CASES[0];

  return (
    <Section
      title={tr('أ وب. الحبر وزمن الاستجابة (G-INK)', '(a)+(b) Ink input and latency (G-INK)')}
      subtitle={tr('إيماءة يدوية بلا حد للمؤشرات، تقفل أول مؤشر. السجل يعرض نوع كل مؤشر.', 'Manual gesture, no maxPointers, locked to the first pointer. The log shows each pointer type.')}
    >
      <Row>
        {INK_CASES.map((c) => (
          <Button key={c.key} label={c.title} tone={c.key === caseKey ? 'accent' : 'plain'} onPress={() => setCaseKey(c.key)} />
        ))}
      </Row>
      <AppText size={13}>{current.steps}</AppText>
      <PassFail k={current.key} report={report} />
      <GestureDetector gesture={gesture}>
        <View style={styles.inkBox} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
          {width > 0 ? (
            <Canvas style={{ width, height: INK_HEIGHT }} opaque>
              <Fill color="#FFFFFF" />
              {picture ? <Picture picture={picture} /> : null}
              <Path path={frozen} color={INK_COLOR} />
              <Path path={tail} color={INK_COLOR} />
            </Canvas>
          ) : null}
        </View>
      </GestureDetector>
      <Mono>{stats}</Mono>
      <Row>
        <Button label={tr('تصفير القياس', 'Reset stats')} tone="plain" onPress={resetStats} />
        <Button label={tr('حفظ القياس', 'Save stats')} tone="plain" onPress={() => report('ink.latency', stats)} />
        <Button label={tr('خط من 4000 نقطة', '4000-point stroke')} onPress={() => void runSynthetic()} />
        <Button label={tr('مسح', 'Clear')} tone="danger" onPress={clearCanvas} />
      </Row>
      {synthetic ? <Mono>{synthetic}</Mono> : null}
      <View style={styles.logBox}>
        <ScrollView nestedScrollEnabled>
          <Mono>{log.slice().reverse().join('\n')}</Mono>
        </ScrollView>
      </View>
    </Section>
  );
}

// ===== (c) PDF and memory

interface PickedPdf {
  path: string;
  name: string;
  pageCount: number;
  sizes: PdfPageSize[];
}

const BUDGET_SNAPSHOT = () => budgetStats();

function useHeldImages() {
  const [images, setImages] = useState<Map<string, SkImage>>(() => new Map());
  const offs = useRef<(() => void)[]>([]);
  const clear = useCallback(() => {
    for (const off of offs.current) off();
    offs.current = [];
    setImages(new Map());
  }, []);
  const track = useCallback((key: string, kind: 'preview' | 'tile', decode: () => Promise<SkImage | null>, onFirst?: (img: SkImage | null) => void) => {
    let first = true;
    const off = subscribeImage(key, kind, decode, (img) => {
      if (first) {
        first = false;
        onFirst?.(img);
      }
      setImages((m) => {
        const next = new Map(m);
        if (img) next.set(key, img);
        else next.delete(key);
        return next;
      });
    });
    offs.current.push(off);
  }, []);
  useEffect(() => () => clear(), [clear]);
  return { images, track, clear };
}

function PdfSection({ report }: { report: Report }) {
  const { width, height } = useWindowDimensions();
  const dpr = PixelRatio.get();
  const [pdf, setPdf] = useState<PickedPdf | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [scroll, setScroll] = useState('');
  const abortRef = useRef(false);
  const runRef = useRef(0);
  const held = useHeldImages();
  const [shown, setShown] = useState<{ preview: string | null; tiles: string[] }>({ preview: null, tiles: [] });
  const stats = useSyncExternalStore(subscribeBudget, BUDGET_SNAPSHOT, BUDGET_SNAPSHOT);

  const say = (l: string) => setLines((x) => [...x.slice(-30), l]);

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    try {
      const info = await withPdf(a.uri, async (h) => {
        const sizes: PdfPageSize[] = [];
        const n = Math.min(h.pageCount, 100);
        for (let from = 0; from < n; from += 20) sizes.push(...(await h.pageSizes(from, Math.min(20, n - from))));
        return { pageCount: h.pageCount, sizes };
      });
      setPdf({ path: a.uri, name: a.name, pageCount: info.pageCount, sizes: info.sizes });
      say(`opened ${a.name}: ${info.pageCount} pages, page 1 ${info.sizes[0]?.w.toFixed(1)} x ${info.sizes[0]?.h.toFixed(1)} pt`);
    } catch (e) {
      say(`open failed: ${isPdfError(e) ? e.code : String(e)}`);
    }
  };

  const fitScale = (size: PdfPageSize) => (width * dpr) / size.w;

  const tiles400 = (pageIndex: number, size: PdfPageSize, maxTiles: number | undefined, marginTiles = 0): TileSpec[] => {
    const viewH = height / (width / size.w);
    return tilesFor({
      page: pageIndex,
      size,
      pxPerPt: fitScale(size) * 4,
      visible: { x: 0, y: 0, w: size.w / 4, h: viewH / 4 },
      maxTiles,
      marginTiles,
    }).tiles;
  };

  const previewAndTiles = async () => {
    if (!pdf || !pdf.sizes[0]) return;
    setBusy(true);
    held.clear();
    const size = pdf.sizes[0];
    const pw = pdfPreviewWidth(size, Math.max(width, height) * dpr);
    const pKey = pdfPreviewKey(pdf.path, 0, pw);
    const t0 = Date.now();
    await new Promise<void>((resolve) => held.track(pKey, 'preview', pdfPreviewDecoder(pdf.path, 0, pw), () => resolve()));
    const previewMs = Date.now() - t0;
    const tiles = tiles400(0, size, MAX_LIVE_TILES);
    const t1 = Date.now();
    let ok = 0;
    for (const t of tiles) {
      await new Promise<void>((resolve) =>
        held.track(pdfTileKey(pdf.path, t), 'tile', pdfTileDecoder(pdf.path, t), (img) => {
          if (img) ok += 1;
          resolve();
        }),
      );
    }
    const tilesMs = Date.now() - t1;
    setShown({ preview: pKey, tiles: tiles.slice(0, 4).map((t) => pdfTileKey(pdf.path, t)) });
    const s = budgetStats();
    const line = `preview ${pw}px in ${previewMs} ms · ${ok}/${tiles.length} tiles (level ${tiles[0]?.level ?? '-'}, ${tiles[0]?.scale.toFixed(2) ?? '-'} px/pt) in ${tilesMs} ms · budget ${mb(s.bytes)}, ${s.tiles} live tiles`;
    say(line);
    report('pdf.tiles400', line);
    setBusy(false);
  };

  const concurrent = async () => {
    if (!pdf || !pdf.sizes[0]) return;
    setBusy(true);
    runRef.current += 1;
    // A small offset per run gives new cache keys, so every run really renders.
    const nonce = runRef.current * 0.01;
    const size = pdf.sizes[0];
    let tiles = tiles400(0, size, undefined, 2);
    if (tiles.length < 20) tiles = [...tiles, ...tiles400(0, size, undefined, 6)].slice(0, 20);
    tiles = tiles.slice(0, 20);
    const t0 = Date.now();
    try {
      const results = await withPdf(pdf.path, (h) =>
        Promise.allSettled([
          ...tiles.map((t) => {
            const r = regionOf(t);
            return h.renderRegion({ ...r, x: r.x + nonce });
          }),
          h.renderPage(Math.min(1, h.pageCount - 1), 800 + runRef.current),
        ]),
      );
      const ms = Date.now() - t0;
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      const codes = failed.map((f) => (isPdfError(f.reason) ? f.reason.code : String(f.reason))).join(', ');
      const line = `${results.length - failed.length}/${results.length} ok in ${ms} ms${failed.length ? ` · failed: ${codes}` : ''}`;
      say(`concurrent: ${line}`);
      report('pdf.concurrent', line);
    } catch (e) {
      const line = `open failed: ${isPdfError(e) ? e.code : String(e)}`;
      say(`concurrent: ${line}`);
      report('pdf.concurrent', line);
    } finally {
      setBusy(false);
    }
  };

  const scrollTest = async () => {
    if (!pdf) return;
    setBusy(true);
    abortRef.current = false;
    held.clear();
    setShown({ preview: null, tiles: [] });
    resetBudgetPeak();
    const n = Math.min(pdf.sizes.length, 100);
    const screenLong = Math.max(width, height) * dpr;
    let previewHolds = new Map<string, () => void>();
    let tileHolds: (() => void)[] = [];
    const t0 = Date.now();
    try {
      for (let i = 0; i < n && !abortRef.current; i++) {
        const want = [i - 1, i, i + 1].filter((k) => k >= 0 && k < n);
        const keys = new Map(want.map((k) => [pdfPreviewKey(pdf.path, k, pdfPreviewWidth(pdf.sizes[k], screenLong)), k] as const));
        const nextHolds = new Map<string, () => void>();
        for (const [key] of keys) nextHolds.set(key, previewHolds.get(key) ?? holdImage(key));
        for (const [key, rel] of previewHolds) if (!nextHolds.has(key)) rel();
        previewHolds = nextHolds;
        for (const [key, k] of keys) await loadImage(key, 'preview', pdfPreviewDecoder(pdf.path, k, pdfPreviewWidth(pdf.sizes[k], screenLong)));
        for (const rel of tileHolds) rel();
        tileHolds = [];
        for (const t of tiles400(i, pdf.sizes[i], MAX_LIVE_TILES)) {
          const key = pdfTileKey(pdf.path, t);
          tileHolds.push(holdImage(key));
          await loadImage(key, 'tile', pdfTileDecoder(pdf.path, t));
        }
        const s = budgetStats();
        setScroll(`page ${i + 1}/${n} · now ${mb(s.bytes)} · peak ${mb(s.peakBytes)} · refused ${s.refused}`);
      }
    } finally {
      for (const rel of previewHolds.values()) rel();
      for (const rel of tileHolds) rel();
    }
    const s = budgetStats();
    const ok = s.peakBytes <= IMAGE_BUDGET_BYTES;
    const line = `${n} pages in ${((Date.now() - t0) / 1000).toFixed(1)} s · peak ${mb(s.peakBytes)} of ${mb(IMAGE_BUDGET_BYTES)} ${ok ? '(ok)' : '(OVER)'} · refused ${s.refused}${abortRef.current ? ' · stopped' : ''}`;
    setScroll(line);
    report('mem.scroll', line);
    setBusy(false);
  };

  const preview = shown.preview ? (held.images.get(shown.preview) ?? null) : null;
  const tileImages = shown.tiles.map((k) => held.images.get(k)).filter((x): x is SkImage => !!x);
  const boxW = Math.min(width - 64, 320);
  const previewH = preview ? (boxW * preview.height()) / Math.max(1, preview.width()) : 0;
  const tileW = Math.floor(boxW / 2);

  return (
    <Section
      title={tr('ج. ملفات PDF والذاكرة (G-PDF، G-MEM)', '(c) PDF and memory (G-PDF, G-MEM)')}
      subtitle={tr('معاينة وبلاطات بتكبير 400٪، 20 طلباً متزامناً، واختبار تمرير حتى 100 صفحة.', 'Preview and tiles at 400 %, 20 concurrent renders, and a scroll test over up to 100 pages.')}
    >
      <Mono>{`budget ${mb(stats.bytes)} / ${mb(stats.budget)} · peak ${mb(stats.peakBytes)} · ${stats.count} images · ${stats.tiles} tiles · ${stats.pinned} pinned · refused ${stats.refused}`}</Mono>
      <Row>
        <Button label={tr('اختيار ملف PDF', 'Pick a PDF')} onPress={() => void pick()} disabled={busy} />
        <Button label={tr('معاينة + بلاطات 400٪', 'Preview + 400 % tiles')} tone="plain" onPress={() => void previewAndTiles()} disabled={busy || !pdf} />
        <Button label={tr('20 طلباً معاً', '20 at once')} tone="plain" onPress={() => void concurrent()} disabled={busy || !pdf} />
        <Button label={tr('اختبار التمرير', 'Scroll test')} tone="plain" onPress={() => void scrollTest()} disabled={busy || !pdf} />
        <Button label={tr('إيقاف', 'Stop')} tone="danger" onPress={() => (abortRef.current = true)} disabled={!busy} />
      </Row>
      {pdf ? <Mono>{`${pdf.name} · ${pdf.pageCount} pages`}</Mono> : null}
      {scroll ? <Mono>{scroll}</Mono> : null}
      {preview ? (
        <Canvas style={{ width: boxW, height: previewH }}>
          <SkiaImage image={preview} x={0} y={0} width={boxW} height={previewH} fit="fill" />
        </Canvas>
      ) : null}
      {tileImages.length > 0 ? (
        <Canvas style={{ width: boxW, height: tileW * 2 }}>
          {tileImages.map((img, i) => (
            <SkiaImage key={i} image={img} x={(i % 2) * tileW} y={Math.floor(i / 2) * tileW} width={tileW} height={tileW} fit="contain" />
          ))}
        </Canvas>
      ) : null}
      <Mono>{lines.join('\n')}</Mono>
    </Section>
  );
}

// ===== (d) audio

const SPIKE_AUDIO_KEY = 'qu-student:notebooks:spike-audio:v1';

type AudioVariant = 'm4a' | 'adts';

const SPIKE_M4A: RecordingOptions = {
  ...VOICE,
  extension: '.m4a',
  android: { ...VOICE.android, extension: '.m4a', outputFormat: 'mpeg4' },
  ios: { ...VOICE.ios, extension: '.m4a' },
};

const SPIKE_ADTS: RecordingOptions = {
  ...VOICE,
  extension: '.aac',
  android: { ...VOICE.android, extension: '.aac', outputFormat: 'aac_adts' },
  // iOS writes raw ADTS for MPEG4AAC with the .aac extension.
  ios: { ...VOICE.ios, extension: '.aac' },
};

interface PendingAudio {
  uri: string;
  variant: AudioVariant;
  at: number;
}

/** Probes uri, then (when it plays) seeks to the middle and reports where the player landed. */
async function probeAndSeek(uri: string): Promise<string> {
  const p = await probeAudio(uri);
  let size = '?';
  try {
    const f = new File(uri);
    size = f.exists ? `${(f.size / 1024).toFixed(0)} KB` : 'missing';
  } catch {
    size = 'unreadable';
  }
  if (!p) return `undecided (no answer in 5 s) · ${size}`;
  if (!p.playable) return `NOT playable · ${size}`;
  const dur = p.durationMs ?? 0;
  let seek = 'seek not tried';
  if (dur > 2000) {
    const player = createAudioPlayer({ uri });
    try {
      await new Promise((r) => setTimeout(r, 400));
      const target = dur / 2000;
      await player.seekTo(target);
      await new Promise((r) => setTimeout(r, 400));
      const at = player.currentTime;
      seek = `seek to ${target.toFixed(1)} s landed at ${at.toFixed(1)} s${Math.abs(at - target) < 1.5 ? ' (ok)' : ' (OFF)'}`;
    } catch (e) {
      seek = `seek failed: ${String(e)}`;
    } finally {
      player.remove();
    }
  }
  return `playable ${(dur / 1000).toFixed(1)} s · ${size} · ${seek}`;
}

function AudioSection({ report }: { report: Report }) {
  const m4a = useAudioRecorder(SPIKE_M4A);
  const adts = useAudioRecorder(SPIKE_ADTS);
  const [variant, setVariant] = useState<AudioVariant>('m4a');
  const [recording, setRecording] = useState<AudioVariant | null>(null);
  const [pending, setPending] = useState<PendingAudio | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let alive = true;
    void AsyncStorage.getItem(SPIKE_AUDIO_KEY).then((raw) => {
      if (!alive || !raw) return;
      try {
        const v = JSON.parse(raw) as PendingAudio;
        if (v && typeof v.uri === 'string') setPending(v);
      } catch {
        // Ignore a damaged entry.
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const start = async () => {
    const perm = await ensureMicPermission();
    if (perm !== 'granted') {
      setStatus(`microphone: ${perm}`);
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false, allowsBackgroundRecording: false });
      const rec = variant === 'm4a' ? m4a : adts;
      await rec.prepareToRecordAsync({ ...(variant === 'm4a' ? SPIKE_M4A : SPIKE_ADTS), fileName: `spike-${Date.now()}` });
      rec.record();
      const uri = rec.uri;
      if (uri) await AsyncStorage.setItem(SPIKE_AUDIO_KEY, JSON.stringify({ uri, variant, at: Date.now() } satisfies PendingAudio));
      setRecording(variant);
      setStatus(`recording ${variant}: ${uri ?? '(no uri)'}`);
    } catch (e) {
      setStatus(`start failed: ${String(e)}`);
    }
  };

  const stop = async () => {
    const v = recording;
    if (!v) return;
    const rec = v === 'm4a' ? m4a : adts;
    try {
      await rec.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false, allowsBackgroundRecording: false });
    } catch (e) {
      setStatus(`stop failed: ${String(e)}`);
    }
    setRecording(null);
    await AsyncStorage.removeItem(SPIKE_AUDIO_KEY);
    const uri = rec.uri;
    if (!uri) return;
    setStatus(tr('يفحص الملف…', 'Probing…'));
    const r = await probeAndSeek(uri);
    const line = `${v} normal stop: ${r}`;
    setStatus(line);
    report('audio.stop', line);
  };

  const killNow = () => {
    Alert.alert(
      tr('أغلق التطبيق الآن', 'Kill the app now'),
      tr(
        'لا يمكن إنهاء التطبيق برمجياً. افتح مبدّل التطبيقات واسحب QU Student للأعلى أثناء التسجيل، ثم افتح هذه الشاشة من جديد واضغط «فحص الملف».',
        'The app cannot kill itself from JavaScript. Open the app switcher and swipe QU Student away while it records, then reopen this screen and tap "Probe file".',
      ),
    );
  };

  const probePending = async () => {
    if (!pending) return;
    setStatus(tr('يفحص الملف…', 'Probing…'));
    const r = await probeAndSeek(pending.uri);
    const line = `${pending.variant} after kill: ${r}`;
    setStatus(line);
    report('audio.kill', line);
  };

  const forget = async () => {
    await AsyncStorage.removeItem(SPIKE_AUDIO_KEY);
    setPending(null);
  };

  return (
    <Section
      title={tr('د. التسجيل بعد الإنهاء المفاجئ (G-AUDIO)', '(d) Recording after a kill (G-AUDIO)')}
      subtitle={tr('سجّل، ثم أنهِ التطبيق بالسحب، ثم افحص الملف: m4a مقابل ADTS.', 'Record, swipe-kill the app, then probe the file: m4a versus ADTS.')}
    >
      <Row>
        <Button label="m4a (VOICE)" tone={variant === 'm4a' ? 'accent' : 'plain'} onPress={() => setVariant('m4a')} disabled={!!recording} />
        <Button label="ADTS (.aac)" tone={variant === 'adts' ? 'accent' : 'plain'} onPress={() => setVariant('adts')} disabled={!!recording} />
      </Row>
      <Row>
        <Button label={tr('ابدأ التسجيل', 'Start recording')} onPress={() => void start()} disabled={!!recording} />
        <Button label={tr('إيقاف عادي', 'Normal stop')} tone="plain" onPress={() => void stop()} disabled={!recording} />
        <Button label={tr('إنهاء الآن', 'Kill now')} tone="danger" onPress={killNow} disabled={!recording} />
      </Row>
      {pending && !recording ? (
        <>
          <Mono>{`${tr('ملف من تشغيل سابق', 'File from an earlier run')}: ${pending.variant} · ${new Date(pending.at).toLocaleTimeString()}\n${pending.uri}`}</Mono>
          <Row>
            <Button label={tr('فحص الملف', 'Probe file')} onPress={() => void probePending()} />
            <Button label={tr('تجاهل', 'Forget')} tone="plain" onPress={() => void forget()} />
          </Row>
        </>
      ) : null}
      {status ? <Mono>{status}</Mono> : null}
    </Section>
  );
}

// ===== (e) RTL

interface Measured {
  x: number;
  w: number;
}

function RtlSection({ report }: { report: Report }) {
  const box = useRef<ComponentRef<typeof View>>(null);
  const a = useRef<ComponentRef<typeof View>>(null);
  const b = useRef<ComponentRef<typeof View>>(null);
  const [result, setResult] = useState('');

  const measure = (r: RefObject<ComponentRef<typeof View> | null>) =>
    new Promise<Measured | null>((resolve) => {
      if (!r.current) {
        resolve(null);
        return;
      }
      r.current.measureInWindow((x, _y, w) => resolve({ x, w }));
    });

  const check = async () => {
    const [c, ma, mb2] = await Promise.all([measure(box), measure(a), measure(b)]);
    if (!c || !ma || !mb2) {
      setResult('not measured');
      return;
    }
    const da = ma.x - c.x;
    const db = mb2.x - c.x;
    const ok = Math.abs(da) < 1 && Math.abs(db - 100) < 1;
    const line = `${ok ? 'PASS' : 'FAIL'} · A at ${da.toFixed(1)} pt, B at ${db.toFixed(1)} pt from the physical left · isRTL ${I18nManager.isRTL} · swap ${PHYSICAL_SWAP} · ${Platform.OS}`;
    setResult(line);
    report('rtl', line);
  };

  return (
    <Section
      title={tr('هـ. الاتجاه الفعلي (G-RTL)', '(e) Physical placement (G-RTL)')}
      subtitle={tr('المربع A عند physicalLeft(0) والمربع B عند physicalLeft(100): يجب أن يكونا من الحافة اليسرى الفعلية.', 'Box A at physicalLeft(0) and box B at physicalLeft(100): both must measure from the physical left edge.')}
    >
      <View ref={box} style={styles.rtlBox} collapsable={false}>
        <View ref={a} collapsable={false} style={[styles.rtlA, physicalLeft(0)]}>
          <AppText size={12} color={nbColors.white}>
            A
          </AppText>
        </View>
        <View ref={b} collapsable={false} style={[styles.rtlB, physicalLeft(100)]}>
          <AppText size={12} color={nbColors.white}>
            B
          </AppText>
        </View>
      </View>
      <Button label={tr('قياس', 'Measure')} onPress={() => void check()} />
      {result ? <Mono>{result}</Mono> : null}
    </Section>
  );
}

// ===== screen

export function SpikeScreen() {
  const insets = useSafeAreaInsets();
  const [results, setResults] = useState<Partial<Record<ResultKey, string>>>({});
  const report = useCallback<Report>((key, value) => setResults((r) => ({ ...r, [key]: value })), []);

  const checklist = [
    `QU Student notebook Phase 0 · ${Platform.OS} ${String(Platform.Version)} · ${new Date().toISOString()}`,
    ...RESULT_ROWS.map((r) => `[${r.gate}] ${r.label}: ${results[r.key] ?? '—'}`),
  ].join('\n');

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Button label={tr('رجوع', 'Back')} tone="plain" onPress={() => goBackOr(() => router.replace('/'))} />
        <AppText size={18} weight="bold">
          {tr('تجربة المرحلة 0 (للمطوّر)', 'Phase 0 spike (developer)')}
        </AppText>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <InkSection report={report} />
        <PdfSection report={report} />
        <AudioSection report={report} />
        <RtlSection report={report} />
        <Section title={tr('قائمة النتائج', 'Results checklist')} subtitle={tr('انسخها وأرسلها مع تقرير المرحلة 0.', 'Copy it into the Phase 0 report.')}>
          <Mono>{checklist}</Mono>
          <Button label={tr('نسخ النتائج', 'Copy results')} onPress={() => void Clipboard.setStringAsync(checklist)} />
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: nbColors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  content: { padding: 16, gap: 16 },
  section: { backgroundColor: nbColors.surface, borderRadius: 14, borderWidth: 1, borderColor: nbColors.border, padding: 14, gap: 6 },
  sectionBody: { gap: 10, marginTop: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 11, color: nbColors.text, writingDirection: 'ltr', textAlign: 'left' },
  inkBox: { height: INK_HEIGHT, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: nbColors.borderStrong, backgroundColor: '#FFFFFF' },
  logBox: { height: 160, borderRadius: 8, backgroundColor: nbColors.surfaceMuted, padding: 8 },
  rtlBox: { height: 70, borderRadius: 8, backgroundColor: nbColors.surfaceMuted, position: 'relative' },
  rtlA: { position: 'absolute', top: 10, width: 80, height: 50, borderRadius: 6, backgroundColor: nbColors.accent, alignItems: 'center', justifyContent: 'center' },
  rtlB: { position: 'absolute', top: 10, width: 80, height: 50, borderRadius: 6, backgroundColor: nbColors.inkRed, alignItems: 'center', justifyContent: 'center' },
});
