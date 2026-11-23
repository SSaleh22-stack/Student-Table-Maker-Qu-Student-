#!/usr/bin/env node
/**
 * Notebook build gate (no dependencies, Node 22).
 *
 *   node scripts/notebook-gate.mjs --pkg P05   gate one package: its own files and tests only
 *   node scripts/notebook-gate.mjs --all       repo-wide: every diagnostic, all lint, all tests
 *
 * Steps:
 *   1. tsc --noEmit (tsconfig.json, the app)            -> diagnostics filtered to the package's files
 *   2. tsc -p tsconfig.core.json (core, tests, plugins) -> diagnostics filtered to the package's files
 *   3. eslint on the package's .ts/.tsx/.js/.mjs/.cjs files (errors fail, warnings are shown)
 *   4. node --experimental-strip-types --test on the package's test files
 *
 * The owned files come from scripts/notebook-owners.json: { [id]: { files: string[], tests: string[] } }.
 * Paths are relative to mobile-app/. Entries with * or ? are globs (fs.globSync); every other entry is
 * a literal path, so route files such as src/app/notebook/edit/[id].tsx are matched exactly.
 * A sibling's half-written file never fails another package, because diagnostics are filtered.
 * Diagnostics without a file (a broken tsconfig) fail every package.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNERS = path.join(root, 'scripts', 'notebook-owners.json');
const LINTABLE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

const bin = {
  tsc: path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  eslint: path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'),
};

const toPosix = (p) => p.split(path.sep).join('/');
/** Project-relative posix path; paths outside the project keep their ../ prefix. */
const rel = (abs) => toPosix(path.relative(root, path.resolve(root, abs)));

function usage(message) {
  if (message) console.error(`notebook-gate: ${message}`);
  console.error('Usage: node scripts/notebook-gate.mjs --pkg <ID> | --all');
  process.exit(2);
}

function parseArgs(argv) {
  const i = argv.indexOf('--pkg');
  if (argv.includes('--all')) return { all: true, pkg: null };
  if (i === -1 || !argv[i + 1]) usage('missing --pkg <ID> or --all');
  return { all: false, pkg: argv[i + 1] };
}

function loadOwners() {
  try {
    return JSON.parse(fs.readFileSync(OWNERS, 'utf8'));
  } catch (e) {
    usage(`cannot read ${rel(OWNERS)}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const isGlob = (p) => /[*?]/.test(p);

/** Expands owned entries into existing project-relative files, plus the list of missing literals. */
function expand(entries) {
  const found = new Set();
  const missing = [];
  for (const entry of entries) {
    if (isGlob(entry)) {
      const matches = fs.globSync(entry, { cwd: root });
      for (const m of matches) {
        const abs = path.resolve(root, m);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) found.add(rel(abs));
      }
    } else if (fs.existsSync(path.resolve(root, entry))) {
      found.add(rel(entry));
    } else {
      missing.push(entry);
    }
  }
  return { files: [...found].sort(), missing };
}

function run(label, args, opts = {}) {
  const res = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    ...opts,
  });
  if (res.error) {
    console.error(`[${label}] could not start: ${res.error.message}`);
    return { status: 1, out: '' };
  }
  return { status: res.status ?? 1, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

/**
 * Parses `tsc --pretty false` output into diagnostics. A diagnostic starts with
 * "file(line,col): error TS…" or "error TS…" (no file); indented lines continue it.
 */
function parseTsc(out) {
  const diags = [];
  for (const line of out.split(/\r?\n/)) {
    const withFile = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): /.exec(line);
    if (withFile) {
      diags.push({ file: rel(withFile[1]), text: line });
    } else if (/^(error|warning) TS\d+: /.test(line)) {
      diags.push({ file: null, text: line });
    } else if (line.trim() && diags.length && /^\s/.test(line)) {
      diags[diags.length - 1].text += `\n${line}`;
    }
  }
  return diags;
}

function tscStep(label, args, owned) {
  const { status, out } = run(label, [bin.tsc, ...args, '--pretty', 'false']);
  const diags = parseTsc(out);
  if (status !== 0 && diags.length === 0) {
    console.log(`[${label}] FAIL (tsc exited ${status} without diagnostics)\n${out.trim()}`);
    return false;
  }
  const kept = owned ? diags.filter((d) => d.file === null || owned.has(d.file)) : diags;
  const hidden = diags.length - kept.length;
  if (kept.length) {
    console.log(`[${label}] FAIL: ${kept.length} diagnostic(s)${hidden ? ` (+${hidden} in other packages' files, ignored)` : ''}`);
    for (const d of kept) console.log(d.text);
    return false;
  }
  console.log(`[${label}] ok${hidden ? ` (${hidden} diagnostic(s) in other packages' files ignored)` : ''}`);
  return true;
}

function eslintStep(files) {
  const label = 'eslint';
  if (files && files.length === 0) {
    console.log(`[${label}] ok (no lintable files)`);
    return true;
  }
  const targets = files ?? ['.'];
  const { status, out } = run(label, [bin.eslint, '--no-warn-ignored', ...targets]);
  const text = out.trim();
  if (status !== 0) {
    console.log(`[${label}] FAIL\n${text}`);
    return false;
  }
  console.log(`[${label}] ok${text ? `\n${text}` : ''}`);
  return true;
}

function testStep(tests) {
  const label = 'node --test';
  if (tests && tests.length === 0) {
    console.log(`[${label}] ok (no tests)`);
    return true;
  }
  const targets = tests ?? ['tests/**/*.test.ts'];
  const { status, out } = run(label, ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', '--test', ...targets]);
  const text = out.trim();
  if (status !== 0) {
    console.log(`[${label}] FAIL\n${text}`);
    return false;
  }
  const summary = text
    .split(/\r?\n/)
    .filter((l) => /^(ℹ|#) (tests|pass|fail|skipped|todo|cancelled) \d+$/.test(l))
    .map((l) => l.slice(2))
    .join(', ');
  console.log(`[${label}] ok${summary ? ` (${summary})` : ''}`);
  return true;
}

function main() {
  const { all, pkg } = parseArgs(process.argv.slice(2));
  let owned = null;
  let lintFiles = null;
  let testFiles = null;
  let ok = true;

  if (!all) {
    const owners = loadOwners();
    const entry = owners[pkg];
    if (!entry) usage(`unknown package "${pkg}". Known: ${Object.keys(owners).join(', ')}`);
    const { files, missing } = expand(entry.files ?? []);
    const tests = expand(entry.tests ?? []);
    owned = new Set(files);
    lintFiles = files.filter((f) => LINTABLE.test(f) && !f.startsWith('../'));
    testFiles = tests.files;
    console.log(`notebook-gate --pkg ${pkg}: ${files.length} file(s) present, ${testFiles.length} test file(s)`);
    const outside = files.filter((f) => f.startsWith('../'));
    if (outside.length) console.log(`  outside mobile-app (not type-checked or linted here): ${outside.join(', ')}`);
    if (missing.length) console.log(`  not present (skipped): ${missing.join(', ')}`);
    if (tests.missing.length) {
      console.log(`[tests] FAIL: owned test file(s) missing: ${tests.missing.join(', ')}`);
      ok = false;
    }
  } else {
    console.log('notebook-gate --all');
  }

  ok = tscStep('tsc app', ['--noEmit'], owned) && ok;
  ok = tscStep('tsc core', ['-p', 'tsconfig.core.json'], owned) && ok;
  ok = eslintStep(lintFiles) && ok;
  ok = testStep(testFiles) && ok;

  console.log(ok ? '\nGATE PASSED' : '\nGATE FAILED');
  process.exit(ok ? 0 : 1);
}

main();
