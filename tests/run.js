#!/usr/bin/env node
// WCHCube test runner —  node tests/run.js [filter]
//
// Discovers every *.test.js under app/tests/ (engine units, AGENT-2) and tests/
// (QA suites, AGENT-4), plus tests/smoke.js, and runs them in one process.
// The two areas use different harnesses, so results are collected from both
// registries: app/tests/_harness.js (collected()) and tests/lib/harness.js (REG).
//
// Exit 0 = green. Anything else = do not merge.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const filter = (process.argv[2] || '').toLowerCase();

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const C = tty
  ? { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, d: s => `\x1b[90m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m` }
  : { g: s => s, r: s => s, y: s => s, d: s => s, b: s => s };

const list = (dir, extra = []) => {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter(f => f.endsWith('.test.js') || extra.includes(f)).sort().map(f => path.join(dir, f));
};

// smoke.js last: it is the slowest and the most likely to be noisy.
const FILES = [
  ...list(path.join(ROOT, 'app', 'tests')),
  ...list(path.join(ROOT, 'tests')),
  ...list(path.join(ROOT, 'tests'), ['smoke.js']).filter(f => path.basename(f) === 'smoke.js'),
];
if (!FILES.length) { console.error('no tests found under app/tests/ or tests/'); process.exit(2); }

const imp = f => import(pathToFileURL(f).href);

// Engine harness is optional: it only exists while AGENT-2 keeps app/tests/.
let collected = () => [];
const enginePath = path.join(ROOT, 'app', 'tests', '_harness.js');
if (fs.existsSync(enginePath)) {
  try { ({ collected } = await imp(enginePath)); }
  catch (e) { console.error(C.y('warning: app/tests/_harness.js failed to load — engine units skipped')); console.error('  ' + (e.message || e)); }
}
const { REG, AssertionError } = await imp(path.join(ROOT, 'tests', 'lib', 'harness.js'));

// Four agents write this tree at once. If dist/index.html is rebuilt while the suite
// is running, tests read two different apps and fail for reasons nobody introduced.
// Stamp it so the report can say that instead of blaming the code.
const DIST = path.join(ROOT, 'dist', 'index.html');
const stampDist = () => {
  try { const s = fs.statSync(DIST); return `${s.size}:${s.mtimeMs}`; } catch { return 'missing'; }
};
const distAtStart = stampDist();

const t0 = Date.now();
let pass = 0, filtered = 0;
const failures = [];

for (const file of FILES) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const before = { engine: collected().length, qa: REG.length };
  try {
    await imp(file);
  } catch (e) {
    console.log('\n' + C.b(rel));
    console.log('  ' + C.r('LOAD FAIL') + ' ' + (e.stack || e));
    failures.push({ where: rel, name: '(module load)', error: e });
    continue;
  }
  const found = [...collected().slice(before.engine), ...REG.slice(before.qa)];
  if (!found.length) continue;

  let header = false;
  for (const t of found) {
    const label = t.suite ? `${t.suite} › ${t.name}` : t.name;
    if (filter && !(`${rel} ${label}`.toLowerCase().includes(filter))) { filtered++; continue; }
    if (!header) { console.log('\n' + C.b(rel)); header = true; }
    const start = Date.now();
    try {
      await t.fn();
      const ms = Date.now() - start;
      pass++;
      console.log(`  ${C.g('ok')}    ${label}${ms > 250 ? C.d(`  [${ms} ms]`) : ''}`);
    } catch (e) {
      console.log(`  ${C.r('FAIL')}  ${label}`);
      const body = (e instanceof AssertionError || e.name === 'AssertionError')
        ? (e.message || String(e))
        : (e.stack || String(e));
      console.log(body.split('\n').slice(0, 45).map(l => '        ' + l).join('\n'));
      failures.push({ where: rel, name: label, error: e });
    }
  }
}

// Real-browser suites share one headless Chrome for the whole run (tests/lib/browser.js).
// Shut it down here: an open socket and a live child process would otherwise keep the
// event loop alive and the runner would never exit on a green run.
try { await (await imp(path.join(ROOT, 'tests', 'lib', 'browser.js'))).closeBrowser(); } catch { /* no browser suite ran */ }

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log('\n' + '-'.repeat(64));
if (failures.length) {
  console.log(C.r(`${failures.length} FAILED`) + `, ${pass} passed` + (filtered ? `, ${filtered} filtered out` : '') + `  (${secs}s)`);
  for (const f of failures) console.log('  ' + C.r('x') + ` ${f.where}  ${f.name}`);
  if (stampDist() !== distAtStart) {
    console.log('\n' + C.y('NOTE: dist/index.html was rebuilt while these tests ran.'));
    console.log(C.y('      Tests before and after the rebuild ran against different apps, so some of'));
    console.log(C.y('      these failures may not be real. Re-run when the tree is quiet:  npm test'));
  }
  process.exit(1);
}
console.log(C.g('ALL GREEN') + ` — ${pass} tests` + (filtered ? `, ${filtered} filtered out` : '') + `  (${secs}s)`);
