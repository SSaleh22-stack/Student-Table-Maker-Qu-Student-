/**
 * The worklets Babel plugin turns a top-level worklet function into a NON-hoisted constant that
 * captures what it uses when the module loads. A worklet that calls a function (or reads a const)
 * declared LATER in the same file therefore captures `undefined` on the device, even on the JS thread
 * ("undefined is not a function", e.g. flatEntry -> strokeXY). Node runs these files without the
 * plugin, so the unit tests cannot see it: this test checks the declaration order instead.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..', 'src', 'notebook');
const DECL = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]|^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\b/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat(m.split('\n').length - 1)).replace(/\/\/[^\n]*/g, '');
}

const escape = (s: string) => s.replace(/[$]/g, '\\$');

test('top-level worklets only use what is declared above them', () => {
  const problems: string[] = [];
  for (const file of files(ROOT)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    if (!text.includes("'worklet'")) continue;
    const lines = text.split('\n');
    const decls: { line: number; name: string }[] = [];
    lines.forEach((l, i) => {
      const m = DECL.exec(l);
      if (m) decls.push({ line: i, name: m[1] ?? m[2] });
    });
    decls.forEach((d, k) => {
      const end = k + 1 < decls.length ? decls[k + 1].line : lines.length;
      const body = lines.slice(d.line, end);
      // A worklet function: the 'worklet' directive is its first statement.
      if (!body.slice(0, 10).some((l) => l.trim() === "'worklet';" || l.trim() === "'worklet'")) return;
      // Components hold inline worklets that are created at render time, after the module loaded.
      if (/^[A-Z]/.test(d.name)) return;
      const src = body.join('\n');
      for (const other of decls) {
        if (other.line <= d.line || other.name === d.name) continue;
        if (new RegExp(`(?<![\\w$.])${escape(other.name)}(?![\\w$])`).test(src)) {
          problems.push(`${relative(ROOT, file)}:${d.line + 1} ${d.name} uses ${other.name}, declared below it (line ${other.line + 1})`);
        }
      }
    });
  }
  assert.deepEqual(problems, []);
});
