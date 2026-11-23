/**
 * Scientific calculator (NB-47a): the COMPLETE type contract.
 *
 * Single source of calculator names; P18 and P19 must not invent strings. Every function, postfix
 * operator, statistics variable, key, menu, error and mode screen name the calculator uses is
 * declared here. Code that needs one of these names imports the constant or the type from this file.
 *
 * Who implements what:
 * - P07 (this folder): the engine. evaluate/solve/varsIn (eval.ts), formatValue (format.ts),
 *   setModeOps/setConstTable (registry.ts), contexts (context.ts), errors (errors.ts).
 * - P18 (calc/modes/*): installModes() registers a ModeOps through setModeOps; modeHooks: ModeHooks.
 * - P19 (calc/keys/*): setModeHooks(h), initialMachine(saved?), press(s, k), persist(s),
 *   encodePersist/decodePersist, layoutDisplay(s): DisplayModel.
 * - P24 (calc/installCalc.ts): installModes(); setModeHooks(modeHooks) (once).
 *
 * Values never hold functions, so a MachineState is plain data. Its only non-JSON parts are the
 * bigints inside Rational (num/rational.ts); P19's encodePersist turns them into decimal strings.
 */

// ===== modes and setup

export type CalcMode = 'COMP' | 'CMPLX' | 'STAT' | 'BASE-N' | 'EQN' | 'MATRIX' | 'TABLE' | 'VECTOR' | 'INEQ' | 'RATIO';
/** MODE menu order (MODE 1 to 10 on the reference). */
export const CALC_MODES = ['COMP', 'CMPLX', 'STAT', 'BASE-N', 'EQN', 'MATRIX', 'TABLE', 'VECTOR', 'INEQ', 'RATIO'] as const satisfies readonly CalcMode[];

/** The status-line letters are D, R and G. */
export type AngleUnit = 'Deg' | 'Rad' | 'Gra';

/**
 * Display format (SETUP 6 Fix, 7 Sci, 8 Norm).
 * - Norm 1: ×10ⁿ below 10⁻² or from 10¹⁰. Norm 2: below 10⁻⁹ or from 10¹⁰.
 * - Fix n: n decimals (0..9).
 * - Sci n: n significant digits, where n = 0 means 10 (as on the reference).
 */
export type DispFormat = { mode: 'Norm'; n: 1 | 2 } | { mode: 'Fix'; n: number } | { mode: 'Sci'; n: number };

export interface CalcSetup {
  /** SETUP 1 MthIO (natural display) or 2 LineIO. */
  io: 'MthIO' | 'LineIO';
  angle: AngleUnit;
  disp: DispFormat;
  /** SETUP page 2, 1 ab/c (mixed) or 2 d/c (improper). */
  frac: 'ab/c' | 'd/c';
  /** SETUP page 2, 3 CMPLX result form. */
  cmplx: 'a+bi' | 'r∠θ';
  /** SETUP page 2, 4 STAT: the FREQ column on or off. */
  statFreq: boolean;
  /** TABLE: f(x) only, or f(x) and g(x). */
  table: 'f(x)' | 'f(x),g(x)';
  /** SETUP page 2, 5 Disp: decimal mark. */
  decimal: 'Dot' | 'Comma';
  /** SETUP page 2, 6 ◀CONT▶: LCD contrast step 1..9. */
  contrast: number;
}

/** Memory variables: A to F, X, Y and the independent memory M (M+ / M−). */
export type VarName = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'X' | 'Y' | 'M';
export const VAR_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y', 'M'] as const satisfies readonly VarName[];

/** Matrix and vector memories (MatA..MatC, MatAns; VctA..VctC, VctAns). */
export type MemName = 'A' | 'B' | 'C' | 'Ans';
export const MEM_NAMES = ['A', 'B', 'C', 'Ans'] as const satisfies readonly MemName[];

/** BASE-N radix. */
export type Radix = 2 | 8 | 10 | 16;

// ===== numbers

/**
 * An exact rational. Invariant (num/rational.ts keeps it): d > 0n, gcd(|n|, d) = 1, zero is 0/1.
 * Persisted as RationalJson { n: string; d: string } by P19's encodePersist.
 */
export interface Rational {
  n: bigint;
  d: bigint;
}

/** One term c·√r of a surd form. r is square-free and at least 1 (r = 1n is the rational part). */
export interface SurdTerm {
  c: Rational;
  r: bigint;
}

/**
 * An exact value the engine tracks next to the float, for the natural display and S⇔D.
 * - q: a rational.
 * - surd: a sum of SurdTerm (sorted by r, no zero terms, at most 4 terms; the display shows at most 2).
 * - pi: q·π.
 */
export type Exact = { k: 'q'; q: Rational } | { k: 'surd'; terms: SurdTerm[] } | { k: 'pi'; q: Rational };

/**
 * A calculator value.
 * - real: x is always the float value. exact, when present, is the same number exactly.
 * - cplx: rectangular parts. exact holds the parts when both are rational. polar = shown as r∠θ
 *   (set by ▶r∠θ; ▶a+bi clears it; otherwise the SETUP cmplx form decides).
 * - mat: rows × cols (1..3 each), row-major. vct: 2 or 3 elements.
 * - base: a BASE-N integer, a signed 32-bit value (P18 keeps it in range).
 * - pair: the two results of Pol (r, θ) or Rec (x, y). They are also stored in X and Y.
 */
export type CalcValue =
  | { t: 'real'; x: number; exact?: Exact }
  | { t: 'cplx'; re: number; im: number; exact?: { re: Rational; im: Rational }; polar?: boolean }
  | { t: 'mat'; m: number[][] }
  | { t: 'vct'; v: number[] }
  | { t: 'base'; n: number }
  | { t: 'pair'; kind: 'pol' | 'rec'; a: number; b: number };

export type RealValue = Extract<CalcValue, { t: 'real' }>;
export type CplxValue = Extract<CalcValue, { t: 'cplx' }>;
export type MatValue = Extract<CalcValue, { t: 'mat' }>;
export type VctValue = Extract<CalcValue, { t: 'vct' }>;
export type BaseValue = Extract<CalcValue, { t: 'base' }>;
export type PairValue = Extract<CalcValue, { t: 'pair' }>;

// ===== errors

/**
 * The LCD error messages, exactly as shown. 'Infinite Sol' and 'No Solution' are EQN results, not
 * errors (ModeHooks.eqnSolve returns them separately). A CalcError is a string and a CalcValue is an
 * object, so `typeof r === 'string'` tells them apart in every `CalcValue | CalcError` result.
 */
export const CALC_ERRORS = [
  'Math ERROR',
  'Stack ERROR',
  'Syntax ERROR',
  'Argument ERROR',
  'Dimension ERROR',
  'Variable ERROR',
  "Can't Solve",
  'Time Out',
  'Insufficient MEM',
] as const;
export type CalcError = (typeof CALC_ERRORS)[number];

// ===== names (functions, postfix operators, statistics variables)

/** Every prefix function. 'P(', 'Q(' and 'R(' are the normal-distribution functions (STAT). */
export const FN_NAMES = [
  'sin', 'cos', 'tan', 'sin⁻¹', 'cos⁻¹', 'tan⁻¹', 'sinh', 'cosh', 'tanh', 'sinh⁻¹', 'cosh⁻¹', 'tanh⁻¹',
  'log', 'ln', '10^', 'e^', '√', '∛', 'Abs', 'Pol', 'Rec', 'Rnd', 'RanInt#', 'Int', 'Intg', 'arg', 'Conjg',
  'det', 'Trn', 'Dot', 'Not', 'Neg', 'P(', 'Q(', 'R(',
] as const;
export type FnName = (typeof FN_NAMES)[number];

/**
 * Postfix operators. '°', 'ʳ', 'ᵍ' are the DRG suffixes (convert from that unit to the current one).
 * '▶r∠θ', '▶a+bi', '▶Dec', '▶Hex', '▶Bin', '▶Oct' convert the whole statement and must come last.
 * '▶t' is the STAT normalized variate. 'E' (only inside MathNode post) is the ×10ˣ key.
 */
export const POST_OPS = ['!', '%', '⁻¹', '²', '³', '°', 'ʳ', 'ᵍ', '▶r∠θ', '▶a+bi', '▶t', '▶Dec', '▶Hex', '▶Bin', '▶Oct'] as const;
export type PostOp = (typeof POST_OPS)[number];

export const STAT_VARS = [
  'n', 'x̄', 'σx', 'sx', 'ȳ', 'σy', 'sy', 'Σx', 'Σx²', 'Σy', 'Σy²', 'Σxy', 'Σx³', 'Σx²y', 'Σx⁴',
  'minX', 'maxX', 'minY', 'maxY', 'Q1', 'med', 'Q3', 'A', 'B', 'C', 'r', 'x̂', 'x̂1', 'x̂2', 'ŷ',
] as const;
export type StatVar = (typeof STAT_VARS)[number];
/** Estimated values: postfix on the value before them ('5ŷ' = ŷ at x = 5). ModeOps.statVar gets it as arg. */
export const STAT_POSTFIX_VARS = ['x̂', 'x̂1', 'x̂2', 'ŷ'] as const satisfies readonly StatVar[];

/** Infix operators of MathNode 'op' (ModeOps.binary gets the arithmetic and logic ones). */
export const BIN_OPS = ['+', '-', '×', '÷', 'nPr', 'nCr', '∠', '·', 'and', 'or', 'xor', 'xnor'] as const;
export type BinOp = (typeof BIN_OPS)[number];
/** The operators ModeOps.binary is asked about. */
export type ModeBinOp = '+' | '-' | '×' | '÷' | 'and' | 'or' | 'xor' | 'xnor' | '·';

/** BASE-N prefixes d, h, b, o (decimal, hex, binary, octal) written before a literal. */
export type BasePrefix = 'd' | 'h' | 'b' | 'o';

export type StatKind = '1-VAR' | 'A+BX' | '_+CX²' | 'ln X' | 'e^X' | 'A•B^X' | 'A•X^B' | '1/X';
/** STAT type menu order. */
export const STAT_KINDS = ['1-VAR', 'A+BX', '_+CX²', 'ln X', 'e^X', 'A•B^X', 'A•X^B', '1/X'] as const satisfies readonly StatKind[];

/** STAT editor data. x, y and freq have the same length; y is unused for 1-VAR; freq is all 1 when FREQ is off. */
export interface StatData {
  kind: StatKind;
  x: number[];
  y: number[];
  freq: number[];
}

// ===== the expression tree (what the editor builds and evaluate reads)

/** Digits. 'A'..'F' are hex digits and appear only in BASE-N. */
export type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** Symbols: π, e, the imaginary unit i (CMPLX) and Ran# (a random 0.000..0.999). */
export type SymName = 'π' | 'e' | 'i' | 'Ran#';

/**
 * One node of an input row. Templates carry their slots as rows; everything else is a flat token.
 * - fn with args: [] is the linear token form ('sin(' on the LCD): its arguments follow in the row,
 *   separated by comma nodes, up to the matching rpar (closing brackets may be left out at the end).
 *   fn with args filled is the template form (√, ∛, Abs, 10^, e^ in MthIO): one row per slot.
 * - post 'E' is ×10ˣ: the exponent digits (optionally after neg or '-') follow in the row.
 * - dms is the ° ' " key: '2°30°15°' reads as 2 + 30/60 + 15/3600.
 * - pow is xⁿ: a superscript slot on the value before it. root is ʸ√x.
 * - colon separates statements, eq is '=' (CALC assignment 'Y=…' and SOLVE equations).
 */
export type MathNode =
  | { k: 'digit'; d: Digit }
  | { k: 'op'; op: BinOp }
  | { k: 'neg' }
  | { k: 'lpar' }
  | { k: 'rpar' }
  | { k: 'comma' }
  | { k: 'colon' }
  | { k: 'eq' }
  | { k: 'var'; name: VarName }
  | { k: 'ans' }
  | { k: 'sym'; name: SymName }
  | { k: 'const'; index: number /* CONST 1..40 */ }
  | { k: 'statvar'; name: StatVar }
  | { k: 'conv'; index: number /* CONV 1..40, postfix */ }
  | { k: 'baseprefix'; base: BasePrefix }
  | { k: 'mat'; name: MemName }
  | { k: 'vct'; name: MemName }
  | { k: 'fn'; name: FnName; args: MathRow[] }
  | { k: 'post'; op: PostOp | 'E' }
  | { k: 'dms' }
  | { k: 'frac'; num: MathRow; den: MathRow }
  | { k: 'mixed'; whole: MathRow; num: MathRow; den: MathRow }
  | { k: 'pow'; exp: MathRow }
  | { k: 'root'; index: MathRow; radicand: MathRow }
  | { k: 'logb'; base: MathRow; arg: MathRow }
  | { k: 'integral'; f: MathRow; a: MathRow; b: MathRow }
  | { k: 'deriv'; f: MathRow; at: MathRow }
  | { k: 'sum'; f: MathRow; a: MathRow; b: MathRow };
export type MathRow = MathNode[];
export type MathNodeKind = MathNode['k'];

// ===== evaluation context

/**
 * Everything evaluation reads and may change. Plain data (bigints aside), so it persists.
 * mode and setup are authoritative here; MachineState.mode and .setup mirror them (P19 keeps them equal).
 */
export interface CalcContext {
  mode: CalcMode;
  setup: CalcSetup;
  vars: Record<VarName, CalcValue>;
  ans: CalcValue;
  /** BASE-N current radix (DEC/HEX/BIN/OCT keys). */
  base: Radix;
  /** Matrix memories; null = not defined (using it is Dimension ERROR). 'Ans' is MatAns. */
  mats: Record<MemName, MatValue | null>;
  vcts: Record<MemName, VctValue | null>;
  stat: StatData;
  /** PRNG state (uint32) for Ran# and RanInt#. Advanced by evaluation (random.ts). */
  seed: number;
}

// ===== results for display

export type DisplayForm = 'dec' | 'frac' | 'mixed' | 'surd' | 'pi' | 'dms' | 'cplx' | 'pair' | 'base' | 'mat' | 'vct';

/** A formatted result (format.ts formatValue). */
export interface DisplayValue {
  form: DisplayForm;
  /**
   * Linear text as on the LCD, in the SETUP decimal mark. Minus is '−' (U+2212); exponents use
   * '×10' plus superscript digits ('1.5×10⁻⁷'); LineIO fractions use '⌟' ('2⌟3', '1⌟1⌟2').
   */
  text: string;
  /** Natural form (MthIO) of frac, mixed, surd, pi and exact complex results, for the LCD layout. */
  math?: MathRow;
  /** Set when the decimal is shown as mantissa ×10^exp (Sci, Norm out of range, ENG). */
  sci?: { mantissa: string; exp: number };
  /** pair (Pol/Rec): 'r=…', 'θ=…' or 'X=…', 'Y=…'. */
  lines?: string[];
  /** mat rows, or a vct as one row, each cell formatted. */
  grid?: string[][];
  /** True when S⇔D would show another form. */
  canSD: boolean;
}

/** What P19 persists (MachinePersistJson replaces every Rational by RationalJson). */
export interface MachinePersist {
  v: 1;
  mode: CalcMode;
  setup: CalcSetup;
  ctx: CalcContext;
  history: { input: MathRow; result: string }[];
}

// ===== mode extension points (P18)

/**
 * Mode arithmetic the engine does not do itself, registered by P18 through registry.setModeOps.
 * The engine handles real and complex arithmetic and every FnName / PostOp it can on real and complex
 * values; it asks ModeOps for everything else (matrices, vectors, BASE-N values and logic, det, Trn,
 * Dot, Not, Neg, ▶t, ▶Dec/▶Hex/▶Bin/▶Oct, statistics variables, CONV and CONST). null = not mine,
 * which the engine reports as Math ERROR.
 */
export interface ModeOps {
  binary(op: ModeBinOp, a: CalcValue, b: CalcValue, ctx: CalcContext): CalcValue | CalcError | null /* null = not mine */;
  unary(name: FnName | PostOp, a: CalcValue, ctx: CalcContext): CalcValue | CalcError | null;
  statVar(name: StatVar, ctx: CalcContext, arg?: number): CalcValue | CalcError;
  conv(index: number, v: number): number | CalcError;
  constValue(index: number): number | CalcError;
  parseBase(digits: string, base: Radix): CalcValue | CalcError;
}

export type EqnKind = 'lin2' | 'lin3' | 'poly2' | 'poly3';
export const EQN_KINDS = ['lin2', 'lin3', 'poly2', 'poly3'] as const satisfies readonly EqnKind[];
export type IneqRel = '>' | '<' | '≥' | '≤';
export type RatioKind = 'A:B=X:D' | 'A:B=C:X';
export interface ConstEntry { code: number; symbol: string; ar: string; en: string; value: number }
export interface ConvEntry { code: number; from: string; to: string; ar: string; en: string }

/** Mode solvers and tables (P18 modes/hooks.ts exports modeHooks; P19 keeps it via setModeHooks). */
export interface ModeHooks {
  eqnSolve(kind: EqnKind, coef: number[]): { roots: CalcValue[] } | 'Infinite Sol' | 'No Solution' | CalcError;
  /** setup (optional) sets the decimal mark and number format of the result text; default setup when absent. */
  ineqSolve(deg: 2 | 3, coef: number[], rel: IneqRel, setup?: CalcSetup): { text: string[] } | CalcError;
  tableBuild(f: MathRow, g: MathRow | null, start: number, end: number, step: number, ctx: CalcContext): { rows: number[][] } | CalcError;
  ratioSolve(kind: RatioKind, a: number, b: number, c: number): number | CalcError;
  statCompute(data: StatData): Record<StatVar, number | null>;
  constTable: ConstEntry[];
  convTable: ConvEntry[];
  matDims: { min: 1; max: 3 };
  vctDims: { min: 2; max: 3 };
}

// ===== keys (P19 keymap.ts resolves SHIFT and ALPHA meanings)

export type KeyId =
  | 'SHIFT' | 'ALPHA' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'MODE' | 'ON' | 'CALC' | 'INTEG' | 'INV' | 'LOGB'
  | 'FRAC' | 'SQRT' | 'SQR' | 'POW' | 'LOG' | 'LN' | 'NEG' | 'DMS' | 'HYP' | 'SIN' | 'COS' | 'TAN' | 'RCL'
  | 'ENG' | 'LPAR' | 'RPAR' | 'SD' | 'MPLUS'
  | 'D0' | 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8' | 'D9' | 'DOT' | 'EXP' | 'ANS' | 'EQ' | 'DEL'
  | 'AC' | 'MUL' | 'DIV' | 'ADD' | 'SUB';
export const KEY_IDS = [
  'SHIFT', 'ALPHA', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'MODE', 'ON', 'CALC', 'INTEG', 'INV', 'LOGB',
  'FRAC', 'SQRT', 'SQR', 'POW', 'LOG', 'LN', 'NEG', 'DMS', 'HYP', 'SIN', 'COS', 'TAN', 'RCL',
  'ENG', 'LPAR', 'RPAR', 'SD', 'MPLUS',
  'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'DOT', 'EXP', 'ANS', 'EQ', 'DEL',
  'AC', 'MUL', 'DIV', 'ADD', 'SUB',
] as const satisfies readonly KeyId[];

// ===== menus

/**
 * Every menu the key machine can open. P19 menus.ts builds the option lines for each id and page.
 * SETUP has 2 pages; CONST and CONV are paged lists of 40 entries.
 */
export type MenuId =
  | 'MODE'
  | 'SETUP' | 'SETUP_FIX' | 'SETUP_SCI' | 'SETUP_NORM' | 'SETUP_FRAC' | 'SETUP_CMPLX' | 'SETUP_STAT' | 'SETUP_TABLE' | 'SETUP_DISP' | 'SETUP_CONT'
  | 'CLR' | 'CLR_CONFIRM'
  | 'CONST' | 'CONV' | 'DRG' | 'HYP'
  | 'STAT_TYPE' | 'STAT' | 'STAT_SUM' | 'STAT_VAR' | 'STAT_REG' | 'STAT_MINMAX' | 'STAT_DISTR'
  | 'MATRIX' | 'MATRIX_SELECT' | 'MATRIX_DIM'
  | 'VECTOR' | 'VECTOR_SELECT' | 'VECTOR_DIM'
  | 'CMPLX' | 'BASE' | 'BASE_LOGIC' | 'BASE_PREFIX'
  | 'EQN_TYPE' | 'INEQ_TYPE' | 'INEQ_REL' | 'RATIO_TYPE';
export const MENU_IDS = [
  'MODE',
  'SETUP', 'SETUP_FIX', 'SETUP_SCI', 'SETUP_NORM', 'SETUP_FRAC', 'SETUP_CMPLX', 'SETUP_STAT', 'SETUP_TABLE', 'SETUP_DISP', 'SETUP_CONT',
  'CLR', 'CLR_CONFIRM',
  'CONST', 'CONV', 'DRG', 'HYP',
  'STAT_TYPE', 'STAT', 'STAT_SUM', 'STAT_VAR', 'STAT_REG', 'STAT_MINMAX', 'STAT_DISTR',
  'MATRIX', 'MATRIX_SELECT', 'MATRIX_DIM',
  'VECTOR', 'VECTOR_SELECT', 'VECTOR_DIM',
  'CMPLX', 'BASE', 'BASE_LOGIC', 'BASE_PREFIX',
  'EQN_TYPE', 'INEQ_TYPE', 'INEQ_REL', 'RATIO_TYPE',
] as const satisfies readonly MenuId[];

/**
 * One open menu. Menus stack (MachineState.menu, top last). page is 0-based.
 * target names what the menu acts on when it matters: the matrix or vector being dimensioned
 * ('A' | 'B' | 'C'), or the CLR choice awaiting confirmation ('Setup' | 'Memory' | 'All').
 */
export interface MenuFrame {
  id: MenuId;
  page: number;
  target?: MemName | 'Setup' | 'Memory' | 'All';
}

// ===== mode screens (editors and results that replace the normal input/result LCD)

/** A cell being typed: the expression and its cursor path (same path rules as the main editor). */
export interface CellEntry {
  row: MathRow;
  cursor: number[];
}

export type TableField = 'f' | 'g' | 'start' | 'end' | 'step';

export type ModeScreen =
  | { kind: 'eqn-edit'; eqn: EqnKind; coef: number[]; index: number; entry: CellEntry | null }
  | { kind: 'eqn-result'; eqn: EqnKind; roots: CalcValue[]; index: number }
  | { kind: 'eqn-message'; eqn: EqnKind; message: 'Infinite Sol' | 'No Solution' }
  | { kind: 'mat-edit'; name: 'A' | 'B' | 'C'; rows: number; cols: number; cells: number[][]; row: number; col: number; entry: CellEntry | null }
  | { kind: 'mat-result'; value: MatValue; row: number; col: number }
  | { kind: 'vct-edit'; name: 'A' | 'B' | 'C'; dim: number; cells: number[]; index: number; entry: CellEntry | null }
  | { kind: 'vct-result'; value: VctValue; index: number }
  | { kind: 'stat-edit'; data: StatData; row: number; col: number; entry: CellEntry | null }
  | { kind: 'table-edit'; field: TableField; f: MathRow; g: MathRow | null; start: MathRow; end: MathRow; step: MathRow; cursor: number[] }
  | { kind: 'table-result'; rows: number[][]; hasG: boolean; row: number; col: number }
  | { kind: 'ineq-edit'; deg: 2 | 3; rel: IneqRel; coef: number[]; index: number; entry: CellEntry | null }
  | { kind: 'ineq-result'; deg: 2 | 3; rel: IneqRel; text: string[] }
  | { kind: 'ratio-edit'; ratio: RatioKind; values: number[]; index: number; entry: CellEntry | null }
  | { kind: 'ratio-result'; ratio: RatioKind; value: number };
export type ModeScreenKind = ModeScreen['kind'];

// ===== LCD layout (P19 display.ts builds it, P24 Lcd/LcdMath draws it)

export type LcdBoxKind =
  | 'row' | 'text' | 'frac' | 'bar' | 'sqrt' | 'root' | 'sup' | 'sub' | 'paren'
  | 'integral' | 'sum' | 'deriv' | 'logb' | 'abs' | 'slot' | 'cursor';

/** A laid-out box. x and y are relative to the parent box; baseline is measured from the box top. */
export interface LcdBox {
  kind: LcdBoxKind;
  text?: string;
  small?: boolean;
  children: LcdBox[];
  x: number;
  y: number;
  w: number;
  h: number;
  baseline: number;
  /** Editor path of the node this box draws (for tap-to-place-cursor). */
  path?: number[];
}

// ===== key machine state (P19)

export interface MachineState {
  mode: CalcMode;
  setup: CalcSetup;
  shift: boolean;
  alpha: boolean;
  pending: 'sto' | 'rcl' | null;
  editor: { row: MathRow; cursor: number[] /* path */; insert: boolean };
  result: { value: CalcValue; display: DisplayValue; sd: boolean; eng: number } | null;
  error: { kind: CalcError; at?: number } | null;
  menu: MenuFrame[];
  screen: ModeScreen | null;
  ctx: CalcContext;
  history: { input: MathRow; result: string }[];
  prompt: { kind: 'calc' | 'solve'; varName: VarName } | null;
}

export interface DisplayModel {
  status: string[];
  input: LcdBox;
  result: { text: string; align: 'end'; exact?: LcdBox } | null;
  grid?: string[][];
  cursor?: { x: number; y: number; h: number };
}

// ===== engine API shapes (eval.ts, format.ts)

export interface EvalOptions {
  /** Clock for the ∫, d/dx, Σ and SOLVE deadline. Default Date.now. */
  now?: () => number;
  /** Time budget in ms for one evaluate or solve call. Default 3000 (then Time Out). */
  timeLimitMs?: number;
  /** Track exact values (fractions, surds, π). Default true. */
  exact?: boolean;
}

export type EvalResult =
  | { ok: true; value: CalcValue; values: CalcValue[]; ctx: CalcContext }
  | { ok: false; error: CalcError; at?: number };

export type SolveResult =
  | { ok: true; x: number; lr: number; ctx: CalcContext }
  | { ok: false; error: CalcError; at?: number };

export interface FormatOptions {
  /** S⇔D pressed (an odd number of times): show the other form. */
  sd?: boolean;
  /** ENG steps: k > 0 = ENG pressed k times, k < 0 = ←ENG pressed -k times, 0 = off. */
  eng?: number;
  /** ° ' " pressed on a result: show it in degrees, minutes and seconds. */
  dms?: boolean;
  /** BASE-N radix for base values (default 10). */
  base?: Radix;
  /** Override SETUP frac (SHIFT S⇔D, a b/c ⇔ d/c). */
  frac?: 'ab/c' | 'd/c';
}
