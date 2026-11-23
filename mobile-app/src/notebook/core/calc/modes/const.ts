/**
 * CONST (SHIFT 7): the 40 scientific constants, in the reference calculator's order (01 to 40),
 * with CODATA 2018 values (SI units). installModes() registers the table through setConstTable, so
 * the engine reads CONST n from it; constValue is the ModeOps fallback.
 */
import type { CalcError, ConstEntry } from '../types.ts';

export const CONST_TABLE: ConstEntry[] = [
  { code: 1, symbol: 'mp', ar: 'كتلة البروتون', en: 'proton mass', value: 1.67262192369e-27 },
  { code: 2, symbol: 'mn', ar: 'كتلة النيوترون', en: 'neutron mass', value: 1.67492749804e-27 },
  { code: 3, symbol: 'me', ar: 'كتلة الإلكترون', en: 'electron mass', value: 9.1093837015e-31 },
  { code: 4, symbol: 'mμ', ar: 'كتلة الميون', en: 'muon mass', value: 1.883531627e-28 },
  { code: 5, symbol: 'a0', ar: 'نصف قطر بور', en: 'Bohr radius', value: 5.29177210903e-11 },
  { code: 6, symbol: 'h', ar: 'ثابت بلانك', en: 'Planck constant', value: 6.62607015e-34 },
  { code: 7, symbol: 'μN', ar: 'المغنطون النووي', en: 'nuclear magneton', value: 5.0507837461e-27 },
  { code: 8, symbol: 'μB', ar: 'مغنطون بور', en: 'Bohr magneton', value: 9.2740100783e-24 },
  { code: 9, symbol: 'ħ', ar: 'ثابت بلانك المختزل', en: 'reduced Planck constant', value: 1.054571817e-34 },
  { code: 10, symbol: 'α', ar: 'ثابت البنية الدقيقة', en: 'fine-structure constant', value: 7.2973525693e-3 },
  { code: 11, symbol: 're', ar: 'نصف القطر الكلاسيكي للإلكترون', en: 'classical electron radius', value: 2.8179403262e-15 },
  { code: 12, symbol: 'λC', ar: 'طول موجة كومبتون', en: 'Compton wavelength', value: 2.42631023867e-12 },
  { code: 13, symbol: 'γp', ar: 'النسبة الجيرومغناطيسية للبروتون', en: 'proton gyromagnetic ratio', value: 2.6752218744e8 },
  { code: 14, symbol: 'λCp', ar: 'طول موجة كومبتون للبروتون', en: 'proton Compton wavelength', value: 1.32140985539e-15 },
  { code: 15, symbol: 'λCn', ar: 'طول موجة كومبتون للنيوترون', en: 'neutron Compton wavelength', value: 1.31959090581e-15 },
  { code: 16, symbol: 'R∞', ar: 'ثابت ريدبرغ', en: 'Rydberg constant', value: 10973731.56816 },
  { code: 17, symbol: 'u', ar: 'وحدة الكتل الذرية', en: 'atomic mass unit', value: 1.6605390666e-27 },
  { code: 18, symbol: 'μp', ar: 'العزم المغناطيسي للبروتون', en: 'proton magnetic moment', value: 1.41060679736e-26 },
  { code: 19, symbol: 'μe', ar: 'العزم المغناطيسي للإلكترون', en: 'electron magnetic moment', value: -9.2847647043e-24 },
  { code: 20, symbol: 'μn', ar: 'العزم المغناطيسي للنيوترون', en: 'neutron magnetic moment', value: -9.6623651e-27 },
  { code: 21, symbol: 'μμ', ar: 'العزم المغناطيسي للميون', en: 'muon magnetic moment', value: -4.4904483e-26 },
  { code: 22, symbol: 'F', ar: 'ثابت فاراداي', en: 'Faraday constant', value: 96485.33212 },
  { code: 23, symbol: 'e', ar: 'الشحنة الأولية', en: 'elementary charge', value: 1.602176634e-19 },
  { code: 24, symbol: 'NA', ar: 'عدد أفوجادرو', en: 'Avogadro constant', value: 6.02214076e23 },
  { code: 25, symbol: 'k', ar: 'ثابت بولتزمان', en: 'Boltzmann constant', value: 1.380649e-23 },
  { code: 26, symbol: 'Vm', ar: 'الحجم المولي للغاز المثالي (273.15 K، 100 kPa)', en: 'molar volume of ideal gas (273.15 K, 100 kPa)', value: 22.71095464e-3 },
  { code: 27, symbol: 'R', ar: 'ثابت الغازات المولي', en: 'molar gas constant', value: 8.314462618 },
  { code: 28, symbol: 'C0', ar: 'سرعة الضوء في الفراغ', en: 'speed of light in vacuum', value: 299792458 },
  { code: 29, symbol: 'C1', ar: 'ثابت الإشعاع الأول', en: 'first radiation constant', value: 3.741771852e-16 },
  { code: 30, symbol: 'C2', ar: 'ثابت الإشعاع الثاني', en: 'second radiation constant', value: 1.438776877e-2 },
  { code: 31, symbol: 'σ', ar: 'ثابت ستيفان-بولتزمان', en: 'Stefan-Boltzmann constant', value: 5.670374419e-8 },
  { code: 32, symbol: 'ε0', ar: 'السماحية الكهربائية للفراغ', en: 'electric constant', value: 8.8541878128e-12 },
  { code: 33, symbol: 'μ0', ar: 'النفاذية المغناطيسية للفراغ', en: 'magnetic constant', value: 1.25663706212e-6 },
  { code: 34, symbol: 'Φ0', ar: 'كم الفيض المغناطيسي', en: 'magnetic flux quantum', value: 2.067833848e-15 },
  { code: 35, symbol: 'g', ar: 'تسارع الجاذبية القياسي', en: 'standard acceleration of gravity', value: 9.80665 },
  { code: 36, symbol: 'G0', ar: 'كم الموصلية', en: 'conductance quantum', value: 7.748091729e-5 },
  { code: 37, symbol: 'Z0', ar: 'الممانعة المميزة للفراغ', en: 'characteristic impedance of vacuum', value: 376.730313668 },
  { code: 38, symbol: 't', ar: 'درجة حرارة سلسيوس', en: 'Celsius temperature', value: 273.15 },
  { code: 39, symbol: 'G', ar: 'ثابت الجذب العام', en: 'Newtonian constant of gravitation', value: 6.6743e-11 },
  { code: 40, symbol: 'atm', ar: 'الضغط الجوي القياسي', en: 'standard atmosphere', value: 101325 },
];

/** ModeOps.constValue: the value of CONST n (1..40), else Math ERROR. */
export function constValue(index: number): number | CalcError {
  const e = CONST_TABLE.find((c) => c.code === index);
  return e ? e.value : 'Math ERROR';
}
