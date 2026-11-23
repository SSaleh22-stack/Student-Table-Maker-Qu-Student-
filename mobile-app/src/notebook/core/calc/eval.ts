/**
 * The evaluator: a Pratt parser over MathRow (templates parsed recursively) into a small AST, then
 * evaluation. Precedence, tightest first (the reference order):
 *   1. atoms: numbers, variables, Ans, π, e, i, Ran#, CONST, statistics variables, Mat/Vct,
 *      bracketed functions and every template (fraction, √, ʸ√x, log_b, ∫, d/dx, Σ)
 *   2. postfix on the value before: ! % ⁻¹ ² ³ ° ʳ ᵍ ▶t, xⁿ, ° ' " entry
 *   3. prefix negation (−) and the BASE-N prefixes d h b o
 *   4. CONV and the estimated values x̂ x̂1 x̂2 ŷ (postfix)
 *   5. implicit multiplication (2π, 3sin 30, 2(1+2)) — tighter than × and ÷, so 1÷2π = 1/(2π)
 *   6. nPr, nCr, ∠        7. · (dot product)        8. × ÷        9. + −
 *  10. and                11. or xor xnor
 * Statements are separated by ':'; 'V=expr' assigns; ▶r∠θ, ▶a+bi, ▶Dec … apply to a whole statement.
 *
 * Real and complex arithmetic is done here; everything else (matrices, vectors, BASE-N, statistics,
 * CONV, CONST) goes through the registry's ModeOps (null = not mine = Math ERROR).
 */
import type {
  BasePrefix, BinOp, CalcContext, CalcError, CalcValue, Digit, EvalOptions, EvalResult, FnName, MathNode, MathRow, MemName, PostOp,
  Radix, RealValue, SolveResult, StatVar, SymName, VarName,
} from './types.ts';
import { FN_NAMES, STAT_POSTFIX_VARS, STAT_VARS, VAR_NAMES } from './types.ts';
import { CalcFail, unwrap } from './errors.ts';
import { getModeOps, constByCode } from './registry.ts';
import { exPi, exQ, exRational, fromMixed } from './exact.ts';
import { ZERO, arith, checkValue, complex, floatOnly, isNumeric, negate, real, realQ } from './num/value.ts';
import { q, qFromDecimal, qInt, qToNumber } from './num/rational.ts';
import { applyFn, applyPost, binaryFn, nthRoot, power } from './functions.ts';
import { derivative, findRoot, integrate, makeDeadline, sumSeries, type Deadline } from './numeric.ts';
import { dmsRational, fromDms } from './dms.ts';
import { ranHash } from './random.ts';
import { withAns, withVar } from './context.ts';

// ===== tokens

type Tok =
  | { k: 'num'; text: string; exp: number; base: Radix | null; at: number }
  | { k: 'node'; node: MathNode; at: number };

const SUFFIX_OPS: readonly PostOp[] = ['▶r∠θ', '▶a+bi', '▶Dec', '▶Hex', '▶Bin', '▶Oct'];
const UNIT_POST: readonly PostOp[] = ['!', '%', '⁻¹', '²', '³', '°', 'ʳ', 'ᵍ', '▶t'];
const PREFIX_RADIX: Record<'d' | 'h' | 'b' | 'o', Radix> = { d: 10, h: 16, b: 2, o: 8 };
const MAX_DEPTH = 60;
/** Evaluation recursion limit (a left-deep chain like 1+1+…+1 nests one level per operator). */
const EVAL_MAX_DEPTH = 500;

function isDigit(n: MathNode, baseN: boolean): boolean {
  if (n.k !== 'digit') return false;
  if (baseN) return n.d !== '.';
  return n.d === '.' || (n.d >= '0' && n.d <= '9');
}

/** Groups digit nodes into number tokens (with ×10ˣ exponents and BASE-N prefixes). */
function lex(row: MathRow, baseN: boolean, parentAt: number | null): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const at = (j: number) => (parentAt === null ? j : parentAt);
  while (i < row.length) {
    const n = row[i];
    let prefix: Radix | null = null;
    let start = i;
    if (n.k === 'baseprefix') {
      if (!baseN) throw new CalcFail('Syntax ERROR', at(i));
      prefix = PREFIX_RADIX[n.base];
      i++;
      start = i;
      if (i >= row.length || !isDigit(row[i], true)) throw new CalcFail('Syntax ERROR', at(i - 1));
    }
    const cur = row[i];
    const isE = !baseN && cur.k === 'post' && cur.op === 'E';
    if (isDigit(cur, baseN) || isE || (cur.k === 'digit' && !baseN)) {
      let text = '';
      while (i < row.length && row[i].k === 'digit') {
        const d = row[i] as Extract<MathNode, { k: 'digit' }>;
        if (!isDigit(d, baseN)) throw new CalcFail('Syntax ERROR', at(i));
        text += d.d;
        i++;
      }
      let exp = 0;
      const en = row[i];
      if (!baseN && en && en.k === 'post' && en.op === 'E') {
        const eAt = i;
        i++;
        if (text === '') text = '1';
        let sign = 1;
        const s = row[i];
        if (s && (s.k === 'neg' || (s.k === 'op' && (s.op === '-' || s.op === '+')))) {
          if (s.k === 'neg' || (s.k === 'op' && s.op === '-')) sign = -1;
          i++;
        }
        let digits = '';
        while (i < row.length && row[i].k === 'digit') {
          const d = (row[i] as Extract<MathNode, { k: 'digit' }>).d;
          if (d < '0' || d > '9') throw new CalcFail('Syntax ERROR', at(i));
          digits += d;
          i++;
        }
        if (digits === '' || digits.length > 3) throw new CalcFail('Syntax ERROR', at(eAt));
        exp = sign * Number(digits);
      }
      if (!baseN && ((text.match(/\./g)?.length ?? 0) > 1 || text === '.')) throw new CalcFail('Syntax ERROR', at(start));
      out.push({ k: 'num', text, exp, base: prefix, at: at(start) });
      continue;
    }
    out.push({ k: 'node', node: cur, at: at(i) });
    i++;
  }
  return out;
}

// ===== AST

type Ast =
  | { t: 'num'; text: string; exp: number; base: Radix | null; at: number }
  | { t: 'var'; name: VarName; at: number }
  | { t: 'ans'; at: number }
  | { t: 'sym'; name: SymName; at: number }
  | { t: 'const'; index: number; at: number }
  | { t: 'statvar'; name: StatVar; arg: Ast | null; at: number }
  | { t: 'mem'; kind: 'mat' | 'vct'; name: MemName; at: number }
  | { t: 'bin'; op: BinOp | 'imul'; a: Ast; b: Ast; at: number }
  | { t: 'neg'; a: Ast; at: number }
  | { t: 'post'; op: PostOp; a: Ast; at: number }
  | { t: 'pow'; a: Ast; e: Ast; at: number }
  | { t: 'root'; n: Ast; x: Ast; at: number }
  | { t: 'fn'; name: FnName; args: Ast[]; at: number }
  | { t: 'frac'; n: Ast; d: Ast; at: number }
  | { t: 'mixed'; w: Ast; n: Ast; d: Ast; at: number }
  | { t: 'logb'; b: Ast; x: Ast; at: number }
  | { t: 'integral'; f: Ast; a: Ast; b: Ast; at: number }
  | { t: 'deriv'; f: Ast; x: Ast; at: number }
  | { t: 'sum'; f: Ast; a: Ast; b: Ast; at: number }
  | { t: 'conv'; index: number; a: Ast; at: number }
  | { t: 'dms'; d: Ast; m: Ast | null; s: Ast | null; at: number };

interface Statement {
  assign: VarName | null;
  expr: Ast;
  /** SOLVE: right side of '='. */
  right: Ast | null;
  suffix: PostOp[];
  at: number;
}

const INFIX_BP: Record<BinOp, number> = {
  or: 10, xor: 10, xnor: 10, and: 20, '+': 30, '-': 30, '×': 40, '÷': 40, '·': 50, nPr: 60, nCr: 60, '∠': 60,
};
const BP_LEVEL5 = 75;
const BP_IMPLICIT = 70;

const ARITY: Partial<Record<FnName, number[]>> = { Pol: [2], Rec: [2], 'RanInt#': [2], Dot: [2], log: [1, 2] };

class Parser {
  toks: Tok[];
  pos = 0;
  depth = 0;
  baseN: boolean;
  parentAt: number | null;
  rowLen: number;

  constructor(row: MathRow, baseN: boolean, parentAt: number | null) {
    this.toks = lex(row, baseN, parentAt);
    this.baseN = baseN;
    this.parentAt = parentAt;
    this.rowLen = row.length;
  }

  peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  endAt(): number {
    return this.parentAt ?? this.rowLen;
  }

  fail(at?: number): never {
    throw new CalcFail('Syntax ERROR', at ?? this.peek()?.at ?? this.endAt());
  }

  isNode<K extends MathNode['k']>(t: Tok | undefined, k: K): t is { k: 'node'; node: Extract<MathNode, { k: K }>; at: number } {
    return !!t && t.k === 'node' && t.node.k === k;
  }

  sub(row: MathRow, at: number): Ast {
    if (row.length === 0) throw new CalcFail('Syntax ERROR', at);
    const p = new Parser(row, this.baseN, this.parentAt ?? at);
    p.depth = this.depth + 1;
    if (p.depth > MAX_DEPTH) throw new CalcFail('Stack ERROR', at);
    const e = p.expr(0);
    if (p.peek()) p.fail();
    return e;
  }

  /** Statements split at ':' (top level only). */
  statements(equation: boolean): Statement[] {
    const out: Statement[] = [];
    for (;;) {
      out.push(this.statement(equation));
      const t = this.peek();
      if (!t) break;
      if (this.isNode(t, 'colon')) {
        this.pos++;
        if (!this.peek()) this.fail();
        continue;
      }
      this.fail(t.at);
    }
    return out;
  }

  statement(equation: boolean): Statement {
    const first = this.peek();
    if (!first || this.isNode(first, 'colon')) this.fail();
    let assign: VarName | null = null;
    const second = this.toks[this.pos + 1];
    if (!equation && this.isNode(first, 'var') && this.isNode(second, 'eq')) {
      assign = first.node.name;
      this.pos += 2;
      if (!this.peek()) this.fail();
    }
    const expr = this.expr(0);
    let right: Ast | null = null;
    if (this.isNode(this.peek(), 'eq')) {
      if (!equation) this.fail();
      this.pos++;
      if (!this.peek()) this.fail();
      right = this.expr(0);
    }
    const suffix: PostOp[] = [];
    for (let t = this.peek(); this.isNode(t, 'post') && t.node.op !== 'E' && SUFFIX_OPS.includes(t.node.op); t = this.peek()) {
      suffix.push(t.node.op as PostOp);
      this.pos++;
    }
    return { assign, expr, right, suffix, at: first.at };
  }

  startsOperand(t: Tok): boolean {
    if (t.k === 'num') return true;
    const n = t.node;
    switch (n.k) {
      case 'var': case 'ans': case 'sym': case 'const': case 'mat': case 'vct': case 'fn': case 'lpar':
      case 'frac': case 'mixed': case 'root': case 'logb': case 'integral': case 'deriv': case 'sum': case 'neg':
        return true;
      case 'statvar':
        return !(STAT_POSTFIX_VARS as readonly string[]).includes(n.name);
      default:
        return false;
    }
  }

  expr(minBp: number): Ast {
    if (++this.depth > MAX_DEPTH) throw new CalcFail('Stack ERROR', this.peek()?.at ?? this.endAt());
    let left = this.prefix();
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.k === 'node' && t.node.k === 'op') {
        const op = t.node.op;
        const bp = INFIX_BP[op];
        if (bp < minBp) break;
        this.pos++;
        if (!this.peek()) this.fail();
        const right = this.expr(bp + 1);
        left = { t: 'bin', op, a: left, b: right, at: t.at };
        continue;
      }
      if (t.k === 'node' && t.node.k === 'conv') {
        if (BP_LEVEL5 < minBp) break;
        this.pos++;
        left = { t: 'conv', index: t.node.index, a: left, at: t.at };
        continue;
      }
      if (t.k === 'node' && t.node.k === 'statvar' && (STAT_POSTFIX_VARS as readonly string[]).includes(t.node.name)) {
        if (BP_LEVEL5 < minBp) break;
        this.pos++;
        left = { t: 'statvar', name: t.node.name, arg: left, at: t.at };
        continue;
      }
      if (this.startsOperand(t)) {
        if (BP_IMPLICIT < minBp) break;
        const right = this.expr(BP_IMPLICIT + 1);
        left = { t: 'bin', op: 'imul', a: left, b: right, at: t.at };
        continue;
      }
      break;
    }
    this.depth--;
    return left;
  }

  prefix(): Ast {
    const t = this.peek();
    if (!t) this.fail();
    if (t.k === 'node' && (t.node.k === 'neg' || (t.node.k === 'op' && (t.node.op === '-' || t.node.op === '+')))) {
      this.pos++;
      if (!this.peek()) this.fail();
      const a = this.prefix();
      if (t.node.k === 'op' && t.node.op === '+') return a;
      return { t: 'neg', a, at: t.at };
    }
    return this.unit();
  }

  unit(): Ast {
    let a = this.atom();
    for (;;) {
      const t = this.peek();
      if (!t || t.k !== 'node') break;
      const n = t.node;
      if (n.k === 'post' && n.op !== 'E' && UNIT_POST.includes(n.op)) {
        this.pos++;
        a = { t: 'post', op: n.op, a, at: t.at };
        continue;
      }
      if (n.k === 'pow') {
        this.pos++;
        a = { t: 'pow', a, e: this.sub(n.exp, t.at), at: t.at };
        continue;
      }
      if (n.k === 'dms') {
        this.pos++;
        a = this.dmsTail(a, t.at);
        continue;
      }
      break;
    }
    return a;
  }

  /** After 'd°': optional 'm°' and 's°' number parts. */
  dmsTail(d: Ast, at: number): Ast {
    const part = (): Ast | null => {
      const n = this.peek();
      const after = this.toks[this.pos + 1];
      if (n && n.k === 'num' && this.isNode(after, 'dms')) {
        this.pos += 2;
        return { t: 'num', text: n.text, exp: n.exp, base: null, at: n.at };
      }
      return null;
    };
    const m = part();
    const s = m ? part() : null;
    return { t: 'dms', d, m, s, at };
  }

  closeParen(): void {
    const t = this.peek();
    if (this.isNode(t, 'rpar')) this.pos++;
    else if (t && !this.isNode(t, 'colon') && !this.isNode(t, 'eq')) this.fail(t.at);
  }

  atom(): Ast {
    const t = this.peek();
    if (!t) this.fail();
    this.pos++;
    if (t.k === 'num') return { t: 'num', text: t.text, exp: t.exp, base: t.base, at: t.at };
    const n = t.node;
    const at = t.at;
    switch (n.k) {
      case 'var':
        return { t: 'var', name: n.name, at };
      case 'ans':
        return { t: 'ans', at };
      case 'sym':
        return { t: 'sym', name: n.name, at };
      case 'const':
        return { t: 'const', index: n.index, at };
      case 'statvar':
        if ((STAT_POSTFIX_VARS as readonly string[]).includes(n.name)) this.fail(at);
        return { t: 'statvar', name: n.name, arg: null, at };
      case 'mat':
      case 'vct':
        return { t: 'mem', kind: n.k, name: n.name, at };
      case 'lpar': {
        if (!this.peek()) this.fail();
        const e = this.expr(0);
        this.closeParen();
        return e;
      }
      case 'fn': {
        if (n.args.length > 0) {
          const args = n.args.map((r) => this.sub(r, at));
          this.checkArity(n.name, args.length, at);
          return { t: 'fn', name: n.name, args, at };
        }
        const args: Ast[] = [];
        if (!this.peek()) this.fail();
        args.push(this.expr(0));
        while (this.isNode(this.peek(), 'comma')) {
          this.pos++;
          if (!this.peek()) this.fail();
          args.push(this.expr(0));
        }
        this.closeParen();
        this.checkArity(n.name, args.length, at);
        return { t: 'fn', name: n.name, args, at };
      }
      case 'frac':
        return { t: 'frac', n: this.sub(n.num, at), d: this.sub(n.den, at), at };
      case 'mixed':
        return { t: 'mixed', w: this.sub(n.whole, at), n: this.sub(n.num, at), d: this.sub(n.den, at), at };
      case 'root':
        return { t: 'root', n: this.sub(n.index, at), x: this.sub(n.radicand, at), at };
      case 'logb':
        return { t: 'logb', b: this.sub(n.base, at), x: this.sub(n.arg, at), at };
      case 'integral':
        return { t: 'integral', f: this.sub(n.f, at), a: this.sub(n.a, at), b: this.sub(n.b, at), at };
      case 'deriv':
        return { t: 'deriv', f: this.sub(n.f, at), x: this.sub(n.at, at), at };
      case 'sum':
        return { t: 'sum', f: this.sub(n.f, at), a: this.sub(n.a, at), b: this.sub(n.b, at), at };
      default:
        this.fail(at);
    }
  }

  checkArity(name: FnName, count: number, at: number): void {
    const allowed = ARITY[name] ?? [1];
    if (!allowed.includes(count)) throw new CalcFail('Syntax ERROR', at);
  }
}

// ===== evaluation

interface Env {
  ctx: CalcContext;
  exact: boolean;
  deadline: Deadline;
  depth: number;
}

function ok(v: CalcValue | CalcError | null, at: number, fallback: CalcError = 'Math ERROR'): CalcValue {
  if (v === null) throw new CalcFail(fallback, at);
  const c = unwrap(v, at);
  return unwrap(checkValue(c), at);
}

function realNum(v: CalcValue, at: number): RealValue {
  if (v.t === 'real') return v;
  if (v.t === 'cplx' && v.im === 0) return real(v.re, v.exact ? exQ(v.exact.re) : null);
  throw new CalcFail('Math ERROR', at);
}

function binary(op: BinOp | 'imul', a: CalcValue, b: CalcValue, env: Env, at: number): CalcValue {
  const ops = getModeOps();
  const ctx = env.ctx;
  switch (op) {
    case 'imul':
    case '×':
    case '+':
    case '-':
    case '÷': {
      const o = op === 'imul' ? '×' : op;
      const r = arith(o, a, b, env.exact);
      if (r !== null) return ok(r, at);
      return ok(ops ? ops.binary(o, a, b, ctx) : null, at);
    }
    case '·':
      return ok(ops ? ops.binary('·', a, b, ctx) : null, at);
    case 'and':
    case 'or':
    case 'xor':
    case 'xnor':
      if (ctx.mode !== 'BASE-N') throw new CalcFail('Syntax ERROR', at);
      return ok(ops ? ops.binary(op, a, b, ctx) : null, at);
    case 'nPr':
    case 'nCr':
    case '∠':
      return ok(binaryFn(op, a, b, ctx, env.exact), at);
  }
}

function unaryViaOps(name: FnName | PostOp, a: CalcValue, env: Env, at: number): CalcValue {
  const ops = getModeOps();
  return ok(ops ? ops.unary(name, a, env.ctx) : null, at);
}

function fitsCurrentRadix(n: number, r: Radix): boolean {
  if (!Number.isInteger(n)) return false;
  if (r === 2) return n >= -32768 && n <= 32767;
  return n >= -2147483648 && n <= 2147483647;
}

function numberValue(ast: Extract<Ast, { t: 'num' }>, env: Env): CalcValue {
  if (env.ctx.mode === 'BASE-N') {
    const ops = getModeOps();
    if (!ops) throw new CalcFail('Math ERROR', ast.at);
    const v = ok(ops.parseBase(ast.text, ast.base ?? env.ctx.base), ast.at);
    // A prefixed literal (d40000 in BIN) must also fit the current radix: BIN holds 16 signed
    // bits (−32768..32767), the others 32. Out of range is Math ERROR, not a masked value.
    if (v.t === 'base' && !fitsCurrentRadix(v.n, env.ctx.base)) throw new CalcFail('Math ERROR', ast.at);
    return v;
  }
  if (Math.abs(ast.exp) > 999) throw new CalcFail('Math ERROR', ast.at);
  const r = qFromDecimal(ast.text, ast.exp);
  if (!r) throw new CalcFail('Syntax ERROR', ast.at);
  const x = qToNumber(r);
  if (!Number.isFinite(x) || Math.abs(x) >= 1e100) throw new CalcFail('Math ERROR', ast.at);
  // A literal below the range (2×10⁻¹⁰⁰) reads as 0, like any other underflow.
  return ok(env.exact ? realQ(r) : real(x), ast.at);
}

function floatFn(f: Ast, env: Env): (x: number) => number | CalcError {
  return (x: number) => {
    const inner: Env = { ctx: withVar(env.ctx, 'X', real(x)), exact: false, deadline: env.deadline, depth: env.depth + 1 };
    try {
      const v = evalAst(f, inner);
      if (v.t === 'real') return v.x;
      if (v.t === 'cplx' && v.im === 0) return v.re;
      return 'Math ERROR';
    } catch (e) {
      if (e instanceof CalcFail) return e.calc;
      throw e;
    }
  };
}

function evalAst(ast: Ast, env: Env): CalcValue {
  if (env.depth > EVAL_MAX_DEPTH) throw new CalcFail('Stack ERROR', ast.at);
  const at = ast.at;
  const sub = (a: Ast): CalcValue => {
    env.depth++;
    try {
      return evalAst(a, env);
    } finally {
      env.depth--;
    }
  };
  const ctx = env.ctx;
  switch (ast.t) {
    case 'num':
      return numberValue(ast, env);
    case 'var':
      return ctx.vars[ast.name];
    case 'ans':
      return ctx.ans;
    case 'sym': {
      if (ast.name === 'π') return real(Math.PI, env.exact ? exPi(q(1n)) : null);
      if (ast.name === 'e') return real(Math.E);
      if (ast.name === 'i') {
        if (ctx.mode !== 'CMPLX') throw new CalcFail('Syntax ERROR', at);
        return complex(0, 1, env.exact ? { re: q(0n), im: q(1n) } : null);
      }
      const r = ranHash(ctx.seed);
      env.ctx = { ...env.ctx, seed: r.seed };
      return realQ(q(BigInt(r.thousandths), 1000n));
    }
    case 'const': {
      const entry = constByCode(ast.index);
      if (entry) return real(entry.value);
      const ops = getModeOps();
      const v = ops ? ops.constValue(ast.index) : 'Math ERROR';
      return real(unwrap(v, at));
    }
    case 'statvar': {
      const ops = getModeOps();
      if (!ops) throw new CalcFail('Math ERROR', at);
      let arg: number | undefined;
      if (ast.arg) arg = realNum(sub(ast.arg), at).x;
      return ok(ops.statVar(ast.name, env.ctx, arg), at);
    }
    case 'mem': {
      const v = ast.kind === 'mat' ? ctx.mats[ast.name] : ctx.vcts[ast.name];
      if (!v) throw new CalcFail('Dimension ERROR', at);
      return v;
    }
    case 'bin': {
      const a = sub(ast.a);
      const b = sub(ast.b);
      return binary(ast.op, a, b, env, at);
    }
    case 'neg': {
      const a = sub(ast.a);
      const n = negate(a);
      if (n) return ok(n, at);
      if (a.t === 'base') return unaryViaOps('Neg', a, env, at);
      const ops = getModeOps();
      return ok(ops ? ops.binary('×', real(-1, exQ(qInt(-1))), a, env.ctx) : null, at);
    }
    case 'post': {
      const a = sub(ast.a);
      const r = applyPost(ast.op, a, env.ctx, env.exact);
      if (r !== null) return ok(r, at);
      return unaryViaOps(ast.op, a, env, at);
    }
    case 'pow': {
      const a = sub(ast.a);
      const e = sub(ast.e);
      const r = power(a, e, env.exact);
      if (r !== null) return ok(r, at);
      const k = e.t === 'real' ? e.x : null;
      if (k === 2 || k === 3 || k === -1) return unaryViaOps(k === 2 ? '²' : k === 3 ? '³' : '⁻¹', a, env, at);
      throw new CalcFail('Math ERROR', at);
    }
    case 'root': {
      const n = realNum(sub(ast.n), at);
      const x = realNum(sub(ast.x), at);
      if (Number.isInteger(n.x)) return ok(nthRoot(x, n.x, env.exact), at);
      if (n.x === 0) throw new CalcFail('Math ERROR', at);
      const inv = arith('÷', real(1, exQ(qInt(1))), n, env.exact);
      return ok(power(x, ok(inv, at), env.exact), at);
    }
    case 'fn': {
      const args = ast.args.map((a) => sub(a));
      const r = applyFn(ast.name, args, env.ctx, env.exact);
      if (r !== null && typeof r === 'object' && r.t === 'withCtx') {
        env.ctx = r.ctx;
        return ok(r.value, at);
      }
      if (r !== null) return ok(r, at);
      if (ast.name === 'Dot') {
        const ops = getModeOps();
        return ok(ops ? ops.binary('·', args[0], args[1], env.ctx) : null, at);
      }
      if (args.length !== 1) throw new CalcFail('Math ERROR', at);
      return unaryViaOps(ast.name, args[0], env, at);
    }
    case 'frac': {
      const n = sub(ast.n);
      const d = sub(ast.d);
      return binary('÷', n, d, env, at);
    }
    case 'mixed': {
      const w = realNum(sub(ast.w), at);
      const n = realNum(sub(ast.n), at);
      const d = realNum(sub(ast.d), at);
      if (d.x === 0) throw new CalcFail('Math ERROR', at);
      const wq = w.exact ? exRational(w.exact) : null;
      const nq = n.exact ? exRational(n.exact) : null;
      const dq = d.exact ? exRational(d.exact) : null;
      if (env.exact && wq && nq && dq) {
        const r = fromMixed(wq, nq, dq);
        if (r) return ok(realQ(r), at);
      }
      const f = n.x / d.x;
      return ok(real(w.x < 0 ? w.x - f : w.x + f), at);
    }
    case 'logb': {
      const b = sub(ast.b);
      const x = sub(ast.x);
      const r = applyFn('log', [b, x], env.ctx, env.exact);
      if (r === null || (typeof r === 'object' && r.t === 'withCtx')) throw new CalcFail('Math ERROR', at);
      return ok(r, at);
    }
    case 'integral': {
      const a = realNum(sub(ast.a), at).x;
      const b = realNum(sub(ast.b), at).x;
      return ok(real(unwrap(integrate(floatFn(ast.f, env), a, b, env.deadline), at)), at);
    }
    case 'deriv': {
      const x = realNum(sub(ast.x), at).x;
      return ok(real(unwrap(derivative(floatFn(ast.f, env), x, env.deadline), at)), at);
    }
    case 'sum': {
      const a = realNum(sub(ast.a), at);
      const b = realNum(sub(ast.b), at);
      if (!Number.isInteger(a.x) || !Number.isInteger(b.x) || b.x < a.x) throw new CalcFail('Math ERROR', at);
      if (env.exact && b.x - a.x < 1000) {
        // Exact sum term by term (Σ(1/x, 1, 10) = 7381/2520).
        let acc: CalcValue = ZERO;
        for (let k = a.x; k <= b.x; k++) {
          const inner: Env = { ctx: withVar(env.ctx, 'X', realQ(qInt(k))), exact: true, deadline: env.deadline, depth: env.depth + 1 };
          const term = evalAst(ast.f, inner);
          if (!isNumeric(term)) throw new CalcFail('Math ERROR', at);
          acc = ok(arith('+', acc, term, true), at);
          if ((k - a.x) % 64 === 63 && env.deadline.now() > env.deadline.until) throw new CalcFail('Time Out', at);
        }
        return acc;
      }
      return ok(real(unwrap(sumSeries(floatFn(ast.f, env), a.x, b.x, env.deadline), at)), at);
    }
    case 'conv': {
      const a = realNum(sub(ast.a), at);
      const ops = getModeOps();
      if (!ops) throw new CalcFail('Math ERROR', at);
      return ok(real(unwrap(ops.conv(ast.index, a.x), at)), at);
    }
    case 'dms': {
      const d = realNum(sub(ast.d), at);
      const m = ast.m ? realNum(sub(ast.m), at) : real(0, exQ(qInt(0)));
      const s = ast.s ? realNum(sub(ast.s), at) : real(0, exQ(qInt(0)));
      const dq = d.exact ? exRational(d.exact) : null;
      const mq = m.exact ? exRational(m.exact) : null;
      const sq = s.exact ? exRational(s.exact) : null;
      if (env.exact && dq && mq && sq) return ok(realQ(dmsRational(dq, mq, sq)), at);
      return ok(real(fromDms(d.x, m.x, s.x)), at);
    }
  }
}

function applySuffix(op: PostOp, v: CalcValue, env: Env, at: number): CalcValue {
  const r = applyPost(op, v, env.ctx, env.exact);
  if (r !== null) return ok(r, at);
  return unaryViaOps(op, v, env, at);
}

function makeEnv(ctx: CalcContext, o: EvalOptions): Env {
  const now = o.now ?? (() => Date.now());
  return { ctx, exact: o.exact ?? true, deadline: makeDeadline(now, o.timeLimitMs ?? 3000), depth: 0 };
}

function parseRow(row: MathRow, ctx: CalcContext, equation: boolean): Statement[] {
  if (row.length === 0) throw new CalcFail('Syntax ERROR', 0);
  const p = new Parser(row, ctx.mode === 'BASE-N', null);
  return p.statements(equation);
}

function fail(e: unknown): { ok: false; error: CalcError; at?: number } {
  if (e instanceof CalcFail) return e.at === undefined ? { ok: false, error: e.calc } : { ok: false, error: e.calc, at: e.at };
  if (e instanceof RangeError) return { ok: false, error: 'Stack ERROR' };
  // Anything else is a bug (here or in a registered ModeOps). The calculator must never take the
  // app down, so it shows as Math ERROR.
  return { ok: false, error: 'Math ERROR' };
}

/**
 * Evaluates a row (one or more ':' statements). Each statement's result goes to Ans (matrices also
 * to MatAns, vectors to VctAns), 'V=expr' also stores V, and Pol/Rec store X and Y, all in the
 * returned ctx. values holds every statement's result; value is the last one.
 */
export function evaluate(row: MathRow, ctx: CalcContext, o: EvalOptions = {}): EvalResult {
  try {
    const statements = parseRow(row, ctx, false);
    const env = makeEnv(ctx, o);
    const values: CalcValue[] = [];
    for (const st of statements) {
      let v = evalAst(st.expr, env);
      for (const s of st.suffix) v = applySuffix(s, v, env, st.at);
      if (st.assign) env.ctx = withVar(env.ctx, st.assign, v);
      // A Pol/Rec pair is not a value later keys can use: Ans takes its first part (r or x, already
      // in X with its exact form), so 'Ans' after Pol( keeps working.
      env.ctx = withAns(env.ctx, v.t === 'pair' ? env.ctx.vars.X : v);
      values.push(v);
    }
    return { ok: true, value: values[values.length - 1], values, ctx: env.ctx };
  } catch (e) {
    return fail(e);
  }
}

/**
 * SOLVE: finds varName so that left = right (or the expression = 0 when there is no '='), starting
 * from guess. The solution is stored in varName in the returned ctx; lr is left − right there.
 */
export function solve(row: MathRow, varName: VarName, guess: number, ctx: CalcContext, o: EvalOptions = {}): SolveResult {
  try {
    const statements = parseRow(row, ctx, true);
    if (statements.length !== 1) throw new CalcFail('Syntax ERROR', statements[1]?.at ?? 0);
    const st = statements[0];
    // As on the reference: the solution variable must appear in the equation.
    if (!varsIn(row).includes(varName)) throw new CalcFail('Variable ERROR');
    const env = makeEnv(ctx, { ...o, exact: false });
    const f = (x: number): number | CalcError => {
      const inner: Env = { ctx: withVar(env.ctx, varName, real(x)), exact: false, deadline: env.deadline, depth: 0 };
      try {
        const l = realNum(evalAst(st.expr, inner), st.at).x;
        const r = st.right ? realNum(evalAst(st.right, inner), st.at).x : 0;
        return l - r;
      } catch (e) {
        if (e instanceof CalcFail) return e.calc;
        throw e;
      }
    };
    // Structural errors (not domain errors) surface at once.
    const probe = f(guess);
    if (typeof probe === 'string' && probe !== 'Math ERROR') throw new CalcFail(probe, st.at);
    const r = findRoot(f, guess, env.deadline);
    if (typeof r === 'string') return { ok: false, error: r };
    return { ok: true, x: r.x, lr: r.lr, ctx: withVar(ctx, varName, floatOnly(real(r.x))) };
  } catch (e) {
    return fail(e);
  }
}

/** Checks a row for syntax only (no evaluation). null when it parses. */
export function checkSyntax(row: MathRow, ctx: CalcContext, equation: boolean = false): { error: CalcError; at?: number } | null {
  try {
    parseRow(row, ctx, equation);
    return null;
  } catch (e) {
    const f = fail(e);
    return f.at === undefined ? { error: f.error } : { error: f.error, at: f.at };
  }
}

/**
 * Variables a row reads, in order of first appearance (template slots included), for the CALC
 * prompts. skipAssigned leaves out a statement's assignment target ('Y' in 'Y=X+1').
 */
export function varsIn(row: MathRow, o: { skipAssigned?: boolean } = {}): VarName[] {
  const seen: VarName[] = [];
  const walk = (r: MathRow, top: boolean) => {
    r.forEach((n, i) => {
      if (n.k === 'var') {
        const next = r[i + 1];
        const prev = r[i - 1];
        const isTarget = top && next?.k === 'eq' && (i === 0 || prev?.k === 'colon');
        if (o.skipAssigned && isTarget) return;
        if (!seen.includes(n.name)) seen.push(n.name);
        return;
      }
      switch (n.k) {
        case 'fn': n.args.forEach((a) => walk(a, false)); break;
        case 'frac': walk(n.num, false); walk(n.den, false); break;
        case 'mixed': walk(n.whole, false); walk(n.num, false); walk(n.den, false); break;
        case 'pow': walk(n.exp, false); break;
        case 'root': walk(n.index, false); walk(n.radicand, false); break;
        case 'logb': walk(n.base, false); walk(n.arg, false); break;
        case 'integral': walk(n.f, false); walk(n.a, false); walk(n.b, false); break;
        case 'deriv': walk(n.f, false); walk(n.at, false); break;
        case 'sum': walk(n.f, false); walk(n.a, false); walk(n.b, false); break;
        default: break;
      }
    });
  };
  walk(row, true);
  return seen;
}

// ===== linear text -> MathRow (tests, tools)

const TEXT_FNS: readonly FnName[] = [...FN_NAMES].sort((a, b) => b.length - a.length);
const TEXT_TEMPLATES = ['frac', 'mixed', 'pow', 'root', 'logb', 'int', 'deriv', 'sum', 'sqrt', 'cbrt', 'abs', 'tenpow', 'epow'] as const;
const TEXT_SLOTS: Record<(typeof TEXT_TEMPLATES)[number], number> = {
  frac: 2, mixed: 3, pow: 1, root: 2, logb: 2, int: 3, deriv: 2, sum: 3, sqrt: 1, cbrt: 1, abs: 1, tenpow: 1, epow: 1,
};
const TEXT_OPS: [string, BinOp][] = [
  ['xnor', 'xnor'], ['xor', 'xor'], ['and', 'and'], ['or', 'or'], ['nPr', 'nPr'], ['nCr', 'nCr'],
  ['+', '+'], ['-', '-'], ['−', '-'], ['×', '×'], ['*', '×'], ['÷', '÷'], ['/', '÷'], ['∠', '∠'], ['·', '·'],
];
const TEXT_POST: [string, PostOp | 'E'][] = [
  ['▶r∠θ', '▶r∠θ'], ['▶a+bi', '▶a+bi'], ['▶Dec', '▶Dec'], ['▶Hex', '▶Hex'], ['▶Bin', '▶Bin'], ['▶Oct', '▶Oct'],
  ['▶t', '▶t'], ['⁻¹', '⁻¹'], ['²', '²'], ['³', '³'], ['!', '!'], ['%', '%'], ['@°', '°'], ['ʳ', 'ʳ'], ['ᵍ', 'ᵍ'], ['ᴇ', 'E'],
];
const STAT_BY_LENGTH: readonly StatVar[] = [...STAT_VARS].sort((a, b) => b.length - a.length);

type TemplateName = (typeof TEXT_TEMPLATES)[number];

function templateNode(tpl: TemplateName, slots: MathRow[]): MathNode {
  const [a, b, c] = slots;
  switch (tpl) {
    case 'frac': return { k: 'frac', num: a, den: b };
    case 'mixed': return { k: 'mixed', whole: a, num: b, den: c };
    case 'pow': return { k: 'pow', exp: a };
    case 'root': return { k: 'root', index: a, radicand: b };
    case 'logb': return { k: 'logb', base: a, arg: b };
    case 'int': return { k: 'integral', f: a, a: b, b: c };
    case 'deriv': return { k: 'deriv', f: a, at: b };
    case 'sum': return { k: 'sum', f: a, a: b, b: c };
    case 'sqrt': return { k: 'fn', name: '√', args: [a] };
    case 'cbrt': return { k: 'fn', name: '∛', args: [a] };
    case 'abs': return { k: 'fn', name: 'Abs', args: [a] };
    case 'tenpow': return { k: 'fn', name: '10^', args: [a] };
    case 'epow': return { k: 'fn', name: 'e^', args: [a] };
  }
}

const SINGLE: Record<string, MathNode> = {
  '(': { k: 'lpar' }, ')': { k: 'rpar' }, ',': { k: 'comma' }, ':': { k: 'colon' }, '=': { k: 'eq' }, '~': { k: 'neg' },
  '°': { k: 'dms' }, 'π': { k: 'sym', name: 'π' }, e: { k: 'sym', name: 'e' }, i: { k: 'sym', name: 'i' },
};

/**
 * Builds a MathRow from linear text, for tests and tools (not used by the keypad).
 * - Numbers '12.5', variables A–F X Y M, 'Ans', 'π', 'e', 'i', 'Ran#'; '~' is the (−) key; 'ᴇ' is ×10ˣ.
 * - Operators + - − × * ÷ / ∠ · nPr nCr and or xor xnor; ',' ':' '=' '(' ')'.
 * - Functions by FN_NAMES ('sin(' style: the name followed by '(' gives the linear token form).
 * - Postfix ⁻¹ ² ³ ! % ʳ ᵍ ▶t ▶r∠θ ▶a+bi ▶Dec…; '@°' is the DRG degree suffix; '°' is the ° ' " key.
 * - Templates with brace slots: frac{1}{3} mixed{1}{1}{2} pow{3} root{3}{8} logb{2}{8} int{X}{0}{1}
 *   deriv{X²}{3} sum{X}{1}{10} sqrt{2} cbrt{8} abs{-2} tenpow{2} epow{1}.
 * - '$name' is a statistics variable ($x̄, $σx, $ŷ), 'const12' and 'conv5' are CONST and CONV,
 *   MatA / VctB / MatAns are memories, '#h' '#d' '#b' '#o' are BASE-N prefixes.
 * - o.baseN: letters A to F are hex digits.
 * Throws an Error for text it cannot read.
 */
export function parseLinear(text: string, o: { baseN?: boolean } = {}): MathRow {
  const s = text.replace(/\s+/g, '');
  let i = 0;
  const err = (msg: string): never => {
    throw new Error(`parseLinear: ${msg} at ${i} in "${text}"`);
  };
  const read = (closer: string | null): MathRow => {
    const out: MathRow = [];
    while (i < s.length) {
      if (closer !== null && s[i] === closer) {
        i++;
        return out;
      }
      const rest = s.slice(i);
      const c = s[i];
      if (/[0-9.]/.test(c) || (o.baseN === true && /[A-F]/.test(c))) {
        out.push({ k: 'digit', d: c as Digit });
        i++;
        continue;
      }
      const tpl = TEXT_TEMPLATES.find((t) => rest.startsWith(`${t}{`));
      if (tpl) {
        i += tpl.length;
        const slots: MathRow[] = [];
        for (let k = 0; k < TEXT_SLOTS[tpl]; k++) {
          if (s[i] !== '{') err('expected {');
          i++;
          slots.push(read('}'));
        }
        out.push(templateNode(tpl, slots));
        continue;
      }
      const mem = /^(Mat|Vct)(Ans|A|B|C)/.exec(rest);
      if (mem) {
        out.push({ k: mem[1] === 'Mat' ? 'mat' : 'vct', name: mem[2] as MemName });
        i += mem[0].length;
        continue;
      }
      const cc = /^(const|conv)(\d+)/.exec(rest);
      if (cc) {
        out.push(cc[1] === 'const' ? { k: 'const', index: Number(cc[2]) } : { k: 'conv', index: Number(cc[2]) });
        i += cc[0].length;
        continue;
      }
      if (c === '#') {
        const b = s[i + 1];
        if (b !== 'd' && b !== 'h' && b !== 'b' && b !== 'o') err('bad base prefix');
        out.push({ k: 'baseprefix', base: b as BasePrefix });
        i += 2;
        continue;
      }
      if (c === '$') {
        const name = STAT_BY_LENGTH.find((n) => s.startsWith(n, i + 1));
        if (name === undefined) return err('unknown stat variable');
        out.push({ k: 'statvar', name });
        i += 1 + name.length;
        continue;
      }
      if (rest.startsWith('Ans')) {
        out.push({ k: 'ans' });
        i += 3;
        continue;
      }
      if (rest.startsWith('Ran#')) {
        out.push({ k: 'sym', name: 'Ran#' });
        i += 4;
        continue;
      }
      const fn = TEXT_FNS.find((f) => rest.startsWith(f.endsWith('(') ? f : `${f}(`));
      if (fn) {
        out.push({ k: 'fn', name: fn, args: [] });
        i += fn.endsWith('(') ? fn.length : fn.length + 1;
        continue;
      }
      const post = TEXT_POST.find(([t]) => rest.startsWith(t));
      if (post) {
        out.push({ k: 'post', op: post[1] });
        i += post[0].length;
        continue;
      }
      const op = TEXT_OPS.find(([t]) => rest.startsWith(t));
      if (op) {
        out.push({ k: 'op', op: op[1] });
        i += op[0].length;
        continue;
      }
      const single = SINGLE[c];
      if (single) {
        out.push(single);
        i++;
        continue;
      }
      if ((VAR_NAMES as readonly string[]).includes(c)) {
        out.push({ k: 'var', name: c as VarName });
        i++;
        continue;
      }
      err(`unknown character '${c}'`);
    }
    if (closer !== null) err(`missing ${closer}`);
    return out;
  };
  return read(null);
}
