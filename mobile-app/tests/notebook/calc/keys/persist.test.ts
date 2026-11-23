import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  HISTORY_MAX, decodeMathRow, decodePersist, decodeRational, decodeValue, defaultPersist, encodePersist, encodeValue, persist,
} from '../../../../src/notebook/core/calc/keys/history.ts';
import { initialMachine, press, pressAll } from '../../../../src/notebook/core/calc/keys/machine.ts';
import { createContext, defaultSetup } from '../../../../src/notebook/core/calc/context.ts';
import { q } from '../../../../src/notebook/core/calc/num/rational.ts';
import { parseLinear } from '../../../../src/notebook/core/calc/eval.ts';
import type { CalcValue, Exact, MachinePersist, Rational } from '../../../../src/notebook/core/calc/types.ts';
import { answer, installStubs, resetStubs, run, seq } from './stubHooks.ts';

before(installStubs);
after(resetStubs);

const viaJson = (p: MachinePersist): MachinePersist => decodePersist(JSON.parse(JSON.stringify(encodePersist(p))));

/** Deterministic PRNG (mulberry32) for the property test. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBig(r: () => number): bigint {
  const digits = 1 + Math.floor(r() * (r() < 0.2 ? 120 : 12));
  let s = String(1 + Math.floor(r() * 9));
  for (let i = 1; i < digits; i++) s += String(Math.floor(r() * 10));
  return BigInt(s) * (r() < 0.5 ? -1n : 1n);
}
function randomQ(r: () => number): Rational {
  const d = randomBig(r);
  return q(randomBig(r), d < 0n ? -d : d);
}
function randomExact(r: () => number): Exact {
  const k = r();
  if (k < 0.4) return { k: 'q', q: randomQ(r) };
  if (k < 0.7) return { k: 'pi', q: randomQ(r) };
  const n = 1 + Math.floor(r() * 4);
  return { k: 'surd', terms: Array.from({ length: n }, (_, i) => ({ c: randomQ(r), r: BigInt(i === 0 ? 1 : 2 + Math.floor(r() * 1e6)) })) };
}
const num = (r: () => number) => (r() < 0.1 ? 0 : (r() - 0.5) * 10 ** Math.floor(r() * 40 - 20));
function randomValue(r: () => number): CalcValue {
  const k = Math.floor(r() * 6);
  switch (k) {
    case 0: return r() < 0.7 ? { t: 'real', x: num(r), exact: randomExact(r) } : { t: 'real', x: num(r) };
    case 1: {
      const v: CalcValue = { t: 'cplx', re: num(r), im: num(r) || 1 };
      if (r() < 0.6) v.exact = { re: randomQ(r), im: randomQ(r) };
      if (r() < 0.3) v.polar = true;
      return v;
    }
    case 2: {
      const rows = 1 + Math.floor(r() * 3);
      const cols = 1 + Math.floor(r() * 3);
      return { t: 'mat', m: Array.from({ length: rows }, () => Array.from({ length: cols }, () => num(r))) };
    }
    case 3: return { t: 'vct', v: Array.from({ length: 2 + Math.floor(r() * 2) }, () => num(r)) };
    case 4: return { t: 'base', n: (Math.floor(r() * 2 ** 32) | 0) };
    default: return { t: 'pair', kind: r() < 0.5 ? 'pol' : 'rec', a: num(r), b: num(r) };
  }
}

describe('persist', () => {
  test('round trip: a fraction in Ans and a surd in A survive JSON', () => {
    const s = pressAll(initialMachine(), seq('SQRT 8 SHIFT RCL NEG FRAC 1 DOWN 3 EQ'));
    assert.equal(s.ctx.ans.t === 'real' && s.ctx.ans.exact?.k, 'q');
    assert.equal(s.ctx.vars.A.t === 'real' && s.ctx.vars.A.exact?.k, 'surd');
    const p = persist(s);
    assert.throws(() => JSON.stringify(p), TypeError, 'raw bigints are not JSON');
    const text = JSON.stringify(encodePersist(p));
    const back = decodePersist(JSON.parse(text));
    assert.deepEqual(back.ctx.ans, s.ctx.ans);
    assert.deepEqual(back.ctx.vars.A, s.ctx.vars.A);
    assert.deepEqual(back.history, s.history);
    // the restored machine keeps computing exactly
    const t = pressAll(initialMachine(back), seq('ANS ADD ALPHA NEG EQ'));
    assert.equal(answer(t), '1/3+2√2');
  });

  test('RationalJson uses decimal strings', () => {
    const p = persist(run('FRAC 1 DOWN 3 EQ'));
    const json = encodePersist(p);
    assert.deepEqual(json.ctx.ans, { t: 'real', x: 1 / 3, exact: { k: 'q', q: { n: '1', d: '3' } } });
  });

  test('JSON.stringify(encodePersist(...)) never throws (200 random values) and decodes back', () => {
    const r = prng(1234);
    for (let i = 0; i < 200; i++) {
      const v = randomValue(r);
      const ctx = createContext();
      const p: MachinePersist = {
        v: 1, mode: 'COMP', setup: defaultSetup(),
        ctx: { ...ctx, vars: { ...ctx.vars, A: v }, ans: v, mats: { ...ctx.mats, A: v.t === 'mat' ? v : null }, vcts: { ...ctx.vcts, B: v.t === 'vct' ? v : null } },
        history: [{ input: parseLinear('1+2'), result: '3' }],
      };
      let text = '';
      assert.doesNotThrow(() => {
        text = JSON.stringify(encodePersist(p));
      }, `value ${i}`);
      const back = decodePersist(JSON.parse(text));
      if (v.t !== 'pair') {
        assert.deepEqual(back.ctx.vars.A, v, `value ${i}`);
        assert.deepEqual(back.ctx.ans, v, `value ${i}`);
      }
      assert.deepEqual(decodeValue(JSON.parse(JSON.stringify(encodeValue(v)))), v, `value ${i}`);
      if (v.t === 'mat') assert.deepEqual(back.ctx.mats.A, v);
      if (v.t === 'vct') assert.deepEqual(back.ctx.vcts.B, v);
    }
  });

  test('persist keeps the last 30 history entries', () => {
    let s = initialMachine();
    for (let i = 0; i < 40; i++) s = pressAll(s, seq(`${i} EQ`));
    const p = persist({ ...s, history: [...s.history, ...s.history] });
    assert.equal(p.history.length, HISTORY_MAX);
  });

  test('garbage gives a fresh machine and never throws', () => {
    for (const raw of [null, undefined, 42, 'x', [], {}, { v: 2 }, { v: 1, ctx: 'no' }, { v: 1, history: 'no' }]) {
      const p = decodePersist(raw);
      assert.equal(p.v, 1);
      assert.equal(p.mode, 'COMP');
    }
    const cyclic: Record<string, unknown> = { v: 1 };
    cyclic.ctx = cyclic;
    assert.doesNotThrow(() => decodePersist(cyclic));
    const getter = { v: 1, get mode(): string { throw new Error('boom'); } };
    assert.deepEqual(decodePersist(getter), defaultPersist());
  });

  test('invalid parts fall back to defaults', () => {
    const good = encodePersist(persist(run('MODE 2 SHIFT MODE 4 FRAC 1 DOWN 3 EQ')));
    const raw = JSON.parse(JSON.stringify(good));
    raw.ctx.vars.B = { t: 'real', x: 'nope' };
    raw.ctx.vars.C = { t: 'real', x: 2, exact: { k: 'q', q: { n: '1', d: '0' } } };
    raw.ctx.vars.D = { t: 'real', x: 2, exact: { k: 'q', q: { n: '1e5', d: '3' } } };
    raw.ctx.mats.A = { t: 'mat', m: [[1, 2], [3]] };
    raw.ctx.base = 7;
    raw.ctx.seed = -1;
    raw.setup.angle = 'Turns';
    raw.setup.disp = { mode: 'Fix', n: 12 };
    raw.history.push({ input: [{ k: 'bogus' }], result: '1' });
    raw.history.push({ input: [], result: '1' });
    const p = decodePersist(raw);
    assert.equal(p.mode, 'CMPLX');
    assert.equal(p.setup.angle, 'Deg');
    assert.deepEqual(p.setup.disp, { mode: 'Norm', n: 1 });
    assert.deepEqual(p.ctx.vars.B, { t: 'real', x: 0, exact: { k: 'q', q: { n: 0n, d: 1n } } });
    assert.deepEqual(p.ctx.vars.C, { t: 'real', x: 2 });
    assert.deepEqual(p.ctx.vars.D, { t: 'real', x: 2 });
    assert.equal(p.ctx.mats.A, null);
    assert.equal(p.ctx.base, 10);
    assert.equal(p.history.length, 1);
    assert.deepEqual(p.ctx.ans, { t: 'real', x: 1 / 3, exact: { k: 'q', q: { n: 1n, d: 3n } } });
  });

  test('rationals are normalized and validated', () => {
    assert.deepEqual(decodeRational({ n: '2', d: '-4' }), { n: -1n, d: 2n });
    assert.deepEqual(decodeRational({ n: '0', d: '9' }), { n: 0n, d: 1n });
    assert.equal(decodeRational({ n: '1', d: '0' }), null);
    assert.equal(decodeRational({ n: '1'.repeat(401), d: '1' }), null);
    assert.equal(decodeRational({ n: 1.5, d: '1' }), null);
  });

  test('history rows are validated node by node', () => {
    const row = parseLinear('int{X}{0}{1}+sin(30)+MatA+$x̄+const3');
    assert.deepEqual(decodeMathRow(JSON.parse(JSON.stringify(row))), row);
    assert.equal(decodeMathRow([{ k: 'digit', d: 'Z' }]), null);
    assert.equal(decodeMathRow([{ k: 'frac', num: [] }]), null);
    let deep: unknown = [];
    for (let i = 0; i < 40; i++) deep = [{ k: 'pow', exp: deep }];
    assert.equal(decodeMathRow(deep), null, 'too deep');
  });

  test('restore reopens the mode home and keeps the history', () => {
    const eqn = initialMachine(viaJson(persist(run('MODE 5 1'))));
    assert.equal(eqn.mode, 'EQN');
    assert.equal(eqn.menu[0]?.id, 'EQN_TYPE');
    const table = initialMachine(viaJson(persist(run('MODE 7'))));
    assert.equal(table.screen?.kind, 'table-edit');
    const s = initialMachine(viaJson(persist(run('1 ADD 1 EQ 5 EQ'))));
    assert.equal(s.history.length, 2);
    assert.equal(answer(press(s, 'UP')), '5');
    const st = initialMachine(viaJson(persist(run('MODE 3 1 4 EQ 6 EQ AC'))));
    assert.deepEqual(st.ctx.stat.x, [4, 6]);
    assert.equal(answer(pressAll(st, seq('SHIFT 1 4 2 EQ'))), '5');
  });
});
