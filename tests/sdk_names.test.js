// =============================================================================
//  tests/sdk_names.test.js — AGENT-1's `tools/verify_sdk_names.py`, as a gate.
//
//  Round 3's rule is "a name nobody compiled is a guess". The compile gate
//  (`tests/codegen_compile.test.js`) catches the names that reach generated C.
//  This catches the rest: every SPL macro, function, struct field and enum member
//  an MCU file CLAIMS, in `codegen:` / `params:` / `dma:` / `nvic:`, checked
//  against that part's own headers — whether or not today's generator happens to
//  emit it. A `params:` enum option nobody has wired up yet is still a name, and
//  it is still wrong if the SDK does not have it.
//
//  It has already earned that: it found `ADC1_IRQn` in the vector table, which
//  exists in NEITHER the IRQn enum nor the startup file. Generated NVIC code
//  naming it would not have compiled, and no test in this repo would have said so
//  until someone enabled that interrupt.
//
//  Exit codes, as the tool documents them and as this gate reads them:
//      0   clean
//      1   at least one ERROR (or a WARN under --strict)
//  Anything else is treated as the tool failing rather than the data failing, and
//  is reported as such — a crashed checker must never read as a pass.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { suite, test, assert, skip } from './lib/harness.js';
import { ROOT } from './lib/app.js';

suite('sdk names');

const TOOL = path.join(ROOT, 'tools', 'verify_sdk_names.py');
const SELFTEST = path.join(ROOT, 'tools', 'verify_sdk_names_selftest.py');

/** `python` on Windows, `python3` elsewhere. Try both, report which failed. */
function runPy(script, args = []) {
  const tried = [];
  for (const exe of ['python', 'python3']) {
    tried.push(exe);
    const res = spawnSync(exe, [script, ...args], { cwd: ROOT, encoding: 'utf8' });
    if (!res.error) return { ...res, exe, out: ((res.stdout || '') + (res.stderr || '')).trim() };
  }
  return { missing: true, tried };
}

test('every SPL name an MCU file claims exists in that part\'s headers', () => {
  if (!fs.existsSync(TOOL)) skip(`${path.relative(ROOT, TOOL)} does not exist yet (AGENT-1's P0)`);
  const res = runPy(TOOL, ['--quiet']);
  if (res.missing) skip(`no python interpreter on PATH (tried: ${res.tried.join(', ')})`);
  if (/PyYAML is required/.test(res.out)) skip('PyYAML is not installed — pip install pyyaml');

  assert.ok(res.status === 0 || res.status === 1,
    `verify_sdk_names.py exited ${res.status}, which is neither 0 (clean) nor 1 (findings). `
    + `The checker itself failed, so this proves nothing:\n${res.out}`);
  assert.equal(res.status, 0, `verify_sdk_names.py found names that do not exist in the SDK:\n${res.out}`);
});

test('the SDK-name checker catches its own planted breaks', () => {
  // The gate above is only worth its green tick if the thing behind it can go
  // red. AGENT-1 ships the negative test; this makes it part of the run rather
  // than something that gets executed by hand once.
  if (!fs.existsSync(SELFTEST)) skip(`${path.relative(ROOT, SELFTEST)} does not exist`);
  const res = runPy(SELFTEST);
  if (res.missing) skip(`no python interpreter on PATH (tried: ${res.tried.join(', ')})`);
  if (/PyYAML is required/.test(res.out)) skip('PyYAML is not installed — pip install pyyaml');

  assert.equal(res.status, 0, `the checker's own self-test failed:\n${res.out}`);
  // "0 planted breaks, 0 caught" would exit 0 and mean nothing. Insist it bit.
  const m = /(\d+)\s+planted break\(s\),\s*(\d+)\s+caught,\s*(\d+)\s+missed/.exec(res.out);
  assert.ok(m, `could not read a planted-break tally out of the self-test output:\n${res.out}`);
  const [, planted, caught, missed] = m.map(Number);
  assert.ok(planted > 0, 'the self-test planted no breaks at all, so it proves nothing');
  assert.equal(missed, 0, `${missed} planted break(s) went uncaught:\n${res.out}`);
  assert.equal(caught, planted, `${planted} planted, ${caught} caught:\n${res.out}`);
});
