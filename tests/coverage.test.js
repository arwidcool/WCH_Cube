// =============================================================================
//  tests/coverage.test.js — the coverage ledger, as a gate. (docs/COVERAGE.md)
//
//  Every other data gate in this repository asks whether what an MCU file SAYS holds
//  together. This one asks whether what the SOURCES say has all been said: every
//  function the datasheet puts on a pin, every reference-manual chapter, every SPL
//  instance, joined to the file by `tools/coverage.py`. A row is modelled, or absent
//  with a citation, or OPEN - and an open row is what the 207 dead pads on CH32H417 and
//  the ten unselectable ADC channels on CH32L103 looked like before this existed.
//
//  What is asserted, per part, against the status its coverage file declares:
//      complete        0 open rows
//      in_extraction   the open count is EXACTLY what `open_rows:` records (so it cannot
//                      drift up unnoticed and must be lowered as rows close), and the
//                      `task:` phrase exists in TASKS.md (so the gap has an owner)
//  Plus: every real part has a coverage file; the self-test catches every planted break
//  (a check nobody has seen go red is not a check); and the written inventory under
//  data/coverage/ledger/ is current.
//
//  Exit codes, as the tool documents them: 0 clean, 1 open/failed, 2 a source or a
//  coverage file could not be read. 2 is reported as the tool failing, never as data.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { suite, test, assert, skip } from './lib/harness.js';
import { ROOT } from './lib/app.js';

suite('coverage ledger');

const TOOL = path.join(ROOT, 'tools', 'coverage.py');
const LEDGER = path.join(ROOT, 'tools', 'ledger.py');
const SELFTEST = path.join(ROOT, 'tools', 'coverage_selftest.py');

/** `python` on Windows, `python3` elsewhere. Try both, report which failed. */
function runPy(script, args = []) {
  const tried = [];
  for (const exe of ['python', 'python3']) {
    tried.push(exe);
    const res = spawnSync(exe, [script, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
    if (!res.error) return { ...res, exe, out: ((res.stdout || '') + (res.stderr || '')).trim() };
  }
  return { missing: true, tried };
}

const MCU_DIR = path.join(ROOT, 'data', 'mcus');
const SHIPPED = fs.existsSync(MCU_DIR)
  ? fs.readdirSync(MCU_DIR).filter(n => n.endsWith('.yaml')).map(n => n.replace(/\.yaml$/, '')).sort()
  : [];

// One run of the gate, shared by the per-part tests so the summary can name each part.
let gate = null;
function gateReport() {
  if (gate) return gate;
  if (!fs.existsSync(TOOL)) return (gate = { missing: 'tool' });
  const r = runPy(TOOL, ['--gate', '--json']);
  if (r.missing) return (gate = { missing: `no python interpreter on PATH (tried: ${r.tried.join(', ')})` });
  if (/PyYAML is required/.test(r.out)) return (gate = { missing: 'PyYAML is not installed - pip install pyyaml' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* reported below */ }
  return (gate = { status: r.status, out: r.out, json });
}

test('every real part has a coverage file and its sources can be read', () => {
  const g = gateReport();
  if (g.missing === 'tool') skip('tools/coverage.py does not exist');
  if (g.missing) skip(g.missing);
  assert.ok(g.json, 'coverage.py --gate --json did not print JSON:\n' + g.out.slice(0, 2000));
  const errors = Object.entries(g.json.errors || {}).map(([p, e]) => `${p}: ${e}`);
  assert.empty(errors, 'parts the ledger could not read (a missing coverage file, a source path, a table bound)');
  const covered = new Set(Object.keys(g.json.parts || {}));
  const uncovered = SHIPPED.filter(p => !covered.has(p));
  assert.empty(uncovered, 'shipped parts with no data/coverage/<PART>.yaml');
});

for (const part of SHIPPED) {
  test(`${part}: meets the coverage status its ledger declares`, () => {
    const g = gateReport();
    if (g.missing === 'tool') skip('tools/coverage.py does not exist');
    if (g.missing) skip(g.missing);
    const p = g.json && g.json.parts && g.json.parts[part];
    if (!p) skip(`${part} is not in the gate report (reported by the test above)`);
    const opens = (p.rows || []).filter(r => r.status === 'open').slice(0, 12)
      .map(r => `${r.kind} ${r.key}: ${r.detail}`);
    assert.ok(p.gate_ok, `${part} (${p.status}${p.owner ? ', ' + p.owner : ''}): ${p.gate_message}\n`
      + (opens.length ? '      first open rows:\n' + opens.map(s => '        - ' + s).join('\n') + '\n' : '')
      + `      run: python tools/coverage.py ${part}`);
  });
}

test('tools/coverage_selftest.py catches every planted break', () => {
  // The self-test plants a break in each validator check and each ledger row kind on a
  // deep copy of CH32V006, after proving the unmutated part is clean - a self-test that
  // fires on everything fails its own clean run.
  if (!fs.existsSync(SELFTEST)) skip('tools/coverage_selftest.py does not exist');
  const r = runPy(SELFTEST);
  if (r.missing) skip(`no python interpreter on PATH (tried: ${r.tried.join(', ')})`);
  if (/PyYAML is required/.test(r.out)) skip('PyYAML is not installed - pip install pyyaml');
  assert.equal(r.status, 0, 'coverage_selftest.py did not catch every planted break:\n' + r.out);
  assert.match(r.out, /(\d+)\/\1 planted breaks caught/, 'the self-test did not report an all-caught count:\n' + r.out);
});

test('the written inventory under data/coverage/ledger/ is current', () => {
  // The inventory is GENERATED; a stale copy would send a reader to the wrong line.
  if (!fs.existsSync(LEDGER)) skip('tools/ledger.py does not exist');
  const r = runPy(LEDGER, ['--check']);
  if (r.missing) skip(`no python interpreter on PATH (tried: ${r.tried.join(', ')})`);
  if (/PyYAML is required/.test(r.out)) skip('PyYAML is not installed - pip install pyyaml');
  assert.equal(r.status, 0, 'the written inventory is stale - run `python tools/ledger.py --write`:\n' + r.out);
});

// ---------------------------------------------------------------- the ratchet has a history
//
// P0.1 of the round-5 coverage brief is: "read `git log -p -- data/coverage/` since your last
// cycle. A diff that RAISES any `open_rows:` is a defect." Every word of that assumes the ledger
// is in git, and on 2026-09-12 it was not - six coverage files and six generated ledgers existed
// only on disk, untracked and not ignored.
//
// The consequence was not subtle. `open_rows:` could be raised by anyone with no diff to review,
// which is precisely the thing P0 exists to prevent; the review instruction was unrunnable; and a
// fresh `git clone` had no `data/coverage/` at all, so the CI step "Coverage ledger - every part
// meets its declared status" ran `coverage.py --gate` against nothing and exited 2.
//
// The tool handles a missing coverage file correctly (exit 2, part named, never a green tick -
// `tests/evidence/round5/2026-09-12-ledger-untracked.md` has the run). What it cannot see is the
// case this test covers: the files are present HERE, so every other test in this file passes, and
// the ledger is still absent from the repository everyone else builds from.

/** Files on disk that git is not tracking. Pure, so the plant below can prove it bites. */
function untracked(filesOnDisk, trackedFromGit) {
  const tracked = new Set(trackedFromGit);
  return filesOnDisk.filter(f => !tracked.has(f));
}

/** `git ls-files <pathspec>`, or null when git cannot answer. */
function gitLsFiles(pathspec) {
  const res = spawnSync('git', ['ls-files', pathspec], { cwd: ROOT, encoding: 'utf8' });
  if (res.error) return null;
  return (res.stdout || '').replace(/\r\n?/g, '\n').split('\n').filter(Boolean);
}

test('every coverage file and ledger is TRACKED by git', () => {
  // Without this, the ratchet has no history: the count can rise and nothing records it.
  const dir = path.join(ROOT, 'data', 'coverage');
  if (!fs.existsSync(dir)) skip('data/coverage/ does not exist - the test above reports that');
  if (spawnSync('git', ['--version'], { cwd: ROOT, encoding: 'utf8' }).error) {
    skip('git is not on PATH, so tracking cannot be checked');
  }

  // Everything that must be in the repository: each part's coverage file, each generated
  // ledger, and the directory's own README.
  const want = [
    ...SHIPPED.map(p => `data/coverage/${p}.yaml`),
    ...SHIPPED.map(p => `data/coverage/ledger/${p}.yaml`),
    'data/coverage/README.md',
  ].filter(p => fs.existsSync(path.join(ROOT, p)));

  const trackedCo = gitLsFiles('data/coverage');
  assert.ok(trackedCo, 'git ls-files data/coverage failed');
  const missing = untracked(want, trackedCo);

  assert.empty(missing,
    'coverage ledger file(s) exist on disk but are NOT tracked by git, so the ratchet has no '
    + 'history and a fresh clone has no ledger at all:\n'
    + missing.map(p => `        ${p}`).join('\n')
    + '\n      Fix: git add data/coverage/  (the files are data, not a build artefact)');

  // A ledger that IS tracked but also ignored would be a contradiction worth naming, because
  // `git add` would silently refuse it.
  const ignored = spawnSync('git', ['check-ignore', ...want], { cwd: ROOT, encoding: 'utf8' });
  const ignoredList = ((ignored.stdout || '') + (ignored.stderr || ''))
    .replace(/\r\n?/g, '\n').split('\n').filter(Boolean)
    .filter(l => !/^fatal:|^usage:/i.test(l));
  assert.empty(ignoredList, 'the coverage ledger is gitignored, so it can never be committed');
});

test('the tracking check can fail: an untracked ledger file is caught', () => {
  // Planted break, run every time. The check above is a set difference, and the failure it
  // exists to catch is "the file is on disk and not in git" - which is exactly the state that
  // shipped. A set difference that silently matched nothing would pass on it.
  const onDisk = [
    'data/coverage/CH32V006.yaml',
    'data/coverage/ledger/CH32V006.yaml',
    'data/coverage/README.md',
  ];
  // The real state on 2026-09-12: everything present, nothing tracked.
  assert.deep(untracked(onDisk, []), onDisk, 'an empty tracked set must report every file');
  // A half fix, which is the likelier mistake: the coverage file committed, the generated
  // ledger forgotten. They are separate files with separate gitignore risks.
  assert.deep(untracked(onDisk, ['data/coverage/CH32V006.yaml']),
    ['data/coverage/ledger/CH32V006.yaml', 'data/coverage/README.md'],
    'a partially tracked ledger must report the files that are missing');
  // …and a fully tracked one reports nothing, or the check fails on correct data.
  assert.empty(untracked(onDisk, onDisk), 'a fully tracked ledger must pass');
});
