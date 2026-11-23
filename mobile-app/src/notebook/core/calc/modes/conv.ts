/**
 * CONV (SHIFT 8): the 40 unit conversions, in the reference calculator's order (01 to 40), as 20
 * pairs (odd code = forward, even code = back). Written after a value: '5 in▶cm'.
 * Factors follow NIST SP 811; J▶cal uses the 15 °C calorie, as the reference does.
 */
import type { CalcError, ConvEntry } from '../types.ts';

interface Pair {
  from: string;
  to: string;
  ar: [string, string];
  en: [string, string];
  /** to = from × factor (linear pairs). */
  factor?: number;
  /** to = from ÷ div (linear pairs whose factor is a reciprocal, kept exact). */
  div?: number;
  /** Non-linear pair (temperature): forward and back. */
  fwd?: (x: number) => number;
  back?: (x: number) => number;
}

const PAIRS: Pair[] = [
  { from: 'in', to: 'cm', ar: ['بوصة', 'سنتيمتر'], en: ['inch', 'centimetre'], factor: 2.54 },
  { from: 'ft', to: 'm', ar: ['قدم', 'متر'], en: ['foot', 'metre'], factor: 0.3048 },
  { from: 'yd', to: 'm', ar: ['ياردة', 'متر'], en: ['yard', 'metre'], factor: 0.9144 },
  { from: 'mile', to: 'km', ar: ['ميل', 'كيلومتر'], en: ['mile', 'kilometre'], factor: 1.609344 },
  { from: 'n mile', to: 'm', ar: ['ميل بحري', 'متر'], en: ['nautical mile', 'metre'], factor: 1852 },
  { from: 'acre', to: 'm²', ar: ['فدان', 'متر مربع'], en: ['acre', 'square metre'], factor: 4046.8564224 },
  { from: 'gal(US)', to: 'ℓ', ar: ['جالون أمريكي', 'لتر'], en: ['US gallon', 'litre'], factor: 3.785411784 },
  { from: 'gal(UK)', to: 'ℓ', ar: ['جالون بريطاني', 'لتر'], en: ['UK gallon', 'litre'], factor: 4.54609 },
  { from: 'pc', to: 'km', ar: ['فرسخ فلكي', 'كيلومتر'], en: ['parsec', 'kilometre'], factor: 3.0856775814913673e13 },
  { from: 'km/h', to: 'm/s', ar: ['كيلومتر/ساعة', 'متر/ثانية'], en: ['kilometre per hour', 'metre per second'], div: 3.6 },
  { from: 'oz', to: 'g', ar: ['أونصة', 'غرام'], en: ['ounce', 'gram'], factor: 28.349523125 },
  { from: 'lb', to: 'kg', ar: ['رطل', 'كيلوغرام'], en: ['pound', 'kilogram'], factor: 0.45359237 },
  { from: 'atm', to: 'Pa', ar: ['ضغط جوي', 'باسكال'], en: ['atmosphere', 'pascal'], factor: 101325 },
  { from: 'mmHg', to: 'Pa', ar: ['مليمتر زئبق', 'باسكال'], en: ['millimetre of mercury', 'pascal'], factor: 133.322387415 },
  { from: 'hp', to: 'kW', ar: ['حصان', 'كيلوواط'], en: ['horsepower', 'kilowatt'], factor: 0.745699871582270 },
  { from: 'kgf/cm²', to: 'Pa', ar: ['كيلوغرام ثقلي/سم²', 'باسكال'], en: ['kilogram-force per cm²', 'pascal'], factor: 98066.5 },
  { from: 'kgf•m', to: 'J', ar: ['كيلوغرام ثقلي·متر', 'جول'], en: ['kilogram-force metre', 'joule'], factor: 9.80665 },
  { from: 'lbf/in²', to: 'kPa', ar: ['رطل ثقلي/بوصة²', 'كيلوباسكال'], en: ['pound-force per square inch', 'kilopascal'], factor: 6.894757293168361 },
  {
    from: '°F',
    to: '°C',
    ar: ['فهرنهايت', 'سلسيوس'],
    en: ['Fahrenheit', 'Celsius'],
    fwd: (x) => (x - 32) / 1.8,
    back: (x) => x * 1.8 + 32,
  },
  { from: 'J', to: 'cal', ar: ['جول', 'سعر حراري'], en: ['joule', 'calorie'], div: 4.1858 },
];

/** The CONV list: code, the unit names on the key ('in▶cm'), and the Arabic and English names. */
export const CONV_TABLE: ConvEntry[] = PAIRS.flatMap((p, i) => [
  { code: 2 * i + 1, from: p.from, to: p.to, ar: `${p.ar[0]} إلى ${p.ar[1]}`, en: `${p.en[0]} to ${p.en[1]}` },
  { code: 2 * i + 2, from: p.to, to: p.from, ar: `${p.ar[1]} إلى ${p.ar[0]}`, en: `${p.en[1]} to ${p.en[0]}` },
]);

/** The label of CONV n as on the list ('in▶cm'), or '' for an unknown code. */
export function convLabel(code: number): string {
  const e = CONV_TABLE.find((c) => c.code === code);
  return e ? `${e.from}▶${e.to}` : '';
}

/** ModeOps.conv: converts v with CONV index (1..40). */
export function conv(index: number, v: number): number | CalcError {
  if (!Number.isInteger(index) || index < 1 || index > PAIRS.length * 2) return 'Math ERROR';
  if (!Number.isFinite(v)) return 'Math ERROR';
  const p = PAIRS[Math.floor((index - 1) / 2)];
  const forward = index % 2 === 1;
  let r: number;
  if (p.factor !== undefined) {
    // Divide on the way back so in▶cm▶in returns the same number.
    r = forward ? v * p.factor : v / p.factor;
  } else if (p.div !== undefined) {
    r = forward ? v / p.div : v * p.div;
  } else if (p.fwd && p.back) {
    r = forward ? p.fwd(v) : p.back(v);
  } else return 'Math ERROR';
  if (!Number.isFinite(r) || Math.abs(r) >= 1e100) return 'Math ERROR';
  return Math.abs(r) < 1e-99 ? 0 : r;
}
