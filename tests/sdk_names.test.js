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
//
//  A part the tool resolved to no header exits 0 too. That is a report saying "not
//  checked", not a pass, so each shipped part is its own test here: the ones with an
//  SDK behind them are asserted green, and the ones without become a counted SKIP
//  naming the part and the reason. Round-5 E3 — a check that did not run must reach
//  the run summary the way every other skip does, not hide behind exit code 0.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
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

// The tool is honest about a part it cannot check: it prints NOT CHECKED with the
// reason and still exits 0. Exiting 0 is right for a report and WRONG for a gate —
// a green tick over a file nobody checked is the exact failure this repo keeps
// finding (round 3 asserted "the generated C compiles" for a whole round while
// nothing compiled it). So this gate reads the report, not just the exit code, and
// any part that was not actually resolved against a header becomes a counted SKIP.
// Read the report's own wording, not a loose phrase: the failure message for an
// unchecked part also contains the words "checked against a header", so a bare
// /checked against / would read its own explanation as a pass.
const CHECKED = /codegen\.sdk: checked against /;
const NOT_CHECKED = /NOT CHECKED|NOTHING in this file was checked/i;

/** The first line that explains why a part was not checked, trimmed for a summary. */
function whyNotChecked(out) {
  const line = (out.split('\n').find(l => NOT_CHECKED.test(l)) || out.split('\n')[0] || '').trim();
  return (`verify_sdk_names.py did NOT check this part, so this gate has nothing to say about it: `
    + line.replace(/^\s*(warn|info)\s+/, '')).trim();
}

/** One test per shipped part, so the summary names which file went unchecked. */
const MCU_DIR = path.join(ROOT, 'data', 'mcus');
const SHIPPED = fs.existsSync(MCU_DIR)
  ? fs.readdirSync(MCU_DIR).filter(n => n.endsWith('.yaml')).sort()
  : [];

for (const file of SHIPPED) {
  test(`${file}: every SPL name it claims exists in its SDK`, () => {
    if (!fs.existsSync(TOOL)) skip(`${path.relative(ROOT, TOOL)} does not exist yet (AGENT-1's P0)`);
    const rel = path.posix.join('data', 'mcus', file);
    const res = runPy(TOOL, [rel, '--quiet']);
    if (res.missing) skip(`no python interpreter on PATH (tried: ${res.tried.join(', ')})`);
    if (/PyYAML is required/.test(res.out)) skip('PyYAML is not installed — pip install pyyaml');

    assert.ok(res.status === 0 || res.status === 1,
      `verify_sdk_names.py exited ${res.status}, which is neither 0 (clean) nor 1 (findings). `
      + `The checker itself failed, so this proves nothing:\n${res.out}`);
    assert.equal(res.status, 0,
      `verify_sdk_names.py found names that do not exist in ${file}'s SDK:\n${res.out}`);

    // Green exit code AND a real header behind it, or it did not run.
    if (!CHECKED.test(res.out)) skip(whyNotChecked(res.out));
  });
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
  // The per-part tests above turn a NOT CHECKED file into a counted skip. If this
  // whole run resolved nothing at all, the green tick would be reporting silence.
  if (!CHECKED.test(res.out)) skip(whyNotChecked(res.out));
});

// The skip above is only worth having if it actually fires. Plant the condition —
// a file with no `codegen.sdk` block at all — and insist this gate notices that
// nothing was checked instead of reading the tool's exit 0 as a pass.
test('the gate notices a part that was not checked, instead of passing it', () => {
  if (!fs.existsSync(TOOL)) skip(`${path.relative(ROOT, TOOL)} does not exist yet (AGENT-1's P0)`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-nosdk-'));
  try {
    const yaml = path.join(dir, 'nosdk.yaml');
    // No `codegen:` block, so there is no SDK to resolve. Written outside data/mcus/
    // on purpose: this is a planted break, not a part the app ships.
    fs.writeFileSync(yaml, 'mcu:\n  name: NOSDK-CHECK\npins: {}\n', 'utf8');
    const res = runPy(TOOL, [yaml, '--quiet']);
    if (res.missing) skip(`no python interpreter on PATH (tried: ${res.tried.join(', ')})`);
    assert.equal(res.status, 0,
      `a file with no SDK is reported, not failed — that is the tool's contract:\n${res.out}`);
    assert.notOk(CHECKED.test(res.out),
      `the tool reported a header check for a file that declares no SDK:\n${res.out}`);
    assert.ok(NOT_CHECKED.test(res.out),
      `nothing in the output says this file went unchecked, so the skip above could never fire:\n${res.out}`);
    assert.match(whyNotChecked(res.out), /did NOT check this part/,
      'the reason has to say what happened, because it is the whole text of the skip');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The per-part checks above walk `data/mcus/*.yaml` off disk, so a part DATA lands is
// covered the moment the file exists. Assert that this is the same set the app ships:
// a file the CLI does not know about would be checked by nothing, and a part the CLI
// ships with no file would be a hole in both.
test('the gate covers every part the app ships, not a remembered list', () => {
  const cli = path.join(ROOT, 'tools', 'wchcube_cli.js');
  if (!fs.existsSync(cli)) skip('tools/wchcube_cli.js does not exist');
  const res = spawnSync(process.execPath, [cli, '--list'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 0, `wchcube_cli.js --list failed:\n${res.stderr || res.stdout}`);
  const shipped = res.stdout.split('\n')
    .filter(l => l && !/^\s/.test(l)).map(l => l.trim()).filter(Boolean).sort();
  assert.deep(SHIPPED.map(n => n.replace(/\.yaml$/, '')).sort(), shipped,
    'the MCU files on disk and the parts the CLI ships have drifted apart');
  assert.ok(shipped.length >= 3,
    `only ${shipped.length} part(s) listed — the per-part checks above would be nearly vacuous`);
});

test('the SDK-name checker catches its own planted breaks', () => {
  // The gate above is only worth its green tick if the thing behind it can go
  // red. AGENT-1 ships the negative test; this makes it part of the run rather
  // than something that gets executed by hand once.
  if (!fs.existsSync(SELFTEST)) skip(`${path.relative(ROOT, SELFTEST)} does not exist`);
  const res = runPy(SELFTEST);
  if (res.missing) skip(`no python interpreter on PATH (tried: ${res.tried.join(', ')})`);
  if (/PyYAML is required/.test(res.out)) skip('PyYAML is not installed — pip install pyyaml');

  // The status assertion comes AFTER the tally is classified, below - the self-test exits 1 on
  // ANY miss, including one it could not possibly exercise here, and asserting on the exit code
  // first made this test red on CI's `test` job for a reason that says nothing about the checker.
  // "0 planted breaks, 0 caught" would exit 0 and mean nothing. Insist it bit.
  const m = /(\d+)\s+planted break\(s\),\s*(\d+)\s+caught,\s*(\d+)\s+missed/.exec(res.out);
  assert.ok(m, `could not read a planted-break tally out of the self-test output:\n${res.out}`);
  const [, planted, caught, missed] = m.map(Number);
  assert.ok(planted > 0, 'the self-test planted no breaks at all, so it proves nothing');

  // A MISSED break has two very different causes and they must not be added together.
  //
  //   (a) the checker RAN and did not catch it   -> a hole in the checker. Always a failure.
  //   (b) the checker could not run HERE         -> the tool it needs is not installed, it
  //                                                 reports NOT CHECKED, and the planted break
  //                                                 sails past for a reason that says nothing
  //                                                 about the checker's quality.
  //
  // (b) is real and reproducible: one of the breaks is a `pio_board` naming a board the ch32v
  // PlatformIO platform does not ship, and catching it requires that platform on disk. On CI's
  // `test` job there is deliberately no PlatformIO, so this test was RED there and GREEN on the
  // `firmware` job, with nothing between them but the tool. Reproduced locally by pointing HOME
  // at an empty directory: 35 planted, 34 caught, 1 missed, and the missed one says NOT CHECKED.
  //
  // So: (a) is still zero-tolerance. (b) is reported the way every other unrunnable check in
  // this repository is - named, counted, and run for real in the job that HAS the tool. A skip
  // is not a pass, and this is why the `firmware` job runs the whole suite a second time.
  const missedBlocks = res.out.split(/^\s*MISSED\s+/m).slice(1);
  const unrunnable = missedBlocks.filter(b => /NOT CHECKED/.test(b));
  const realHoles = missedBlocks.filter(b => !/NOT CHECKED/.test(b));

  assert.empty(realHoles.map(b => b.split('\n')[0].trim()),
    `planted break(s) the checker RAN over and did not catch - a hole in the checker:\n${res.out}`);

  if (unrunnable.length) {
    process.stdout.write(`        ${unrunnable.length} planted break(s) could not be exercised here, `
      + 'because the checker they target reports NOT CHECKED without its tool:\n');
    for (const b of unrunnable) process.stdout.write(`          - ${b.split('\n')[0].trim()}\n`);
    process.stdout.write('        They run for real in CI\'s `firmware` job, which installs PlatformIO.\n');
  }
  assert.equal(caught + unrunnable.length, planted,
    `${planted} planted, ${caught} caught, ${unrunnable.length} unrunnable here - the three do not add up:\n${res.out}`);
  assert.equal(missed, unrunnable.length,
    `${missed} missed but ${unrunnable.length} explained by a missing tool:\n${res.out}`);

  // Nothing excuses a non-zero exit when every break WAS exercisable here: that is either a
  // hole the classification above failed to see, or the self-test itself falling over.
  if (!unrunnable.length) {
    assert.equal(res.status, 0, `the checker's own self-test failed:\n${res.out}`);
  }
});
