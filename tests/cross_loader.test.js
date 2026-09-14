// =============================================================================
//  tests/cross_loader.test.js — the DATA<->APP contract, checked where it actually
//  lives: TWO PARSERS, not two readings of the one thing.
//
//  Every Python gate in this repository — `validate_mcu.py`, `coverage.py`,
//  `verify_sdk_names.py`, every `*_selftest.py` — reads `data/mcus/*.yaml` and
//  `data/packages/packages.yaml` with `yaml.safe_load` (PyYAML, YAML 1.1, forever).
//  `dist/index.html` reads the SAME bytes (`build.py`'s `yaml_block()` embeds them
//  verbatim) with the vendored `js-yaml`'s default schema (YAML 1.2). 1.1's implicit
//  typing is wider than 1.2's: `On`/`Off`/`Yes`/`No`/`y`/`n` resolve to booleans in 1.1
//  and stay plain strings in 1.2; a bare `HH:MM` scalar resolves to a sexagesimal
//  NUMBER in 1.1 and stays a string in 1.2. Every green Python gate this repository has
//  ever run has been validating the 1.1 reading. The product ships the 1.2 reading.
//  AGENT-1 found and reproduced this on OPA's `fb`/`pgadif`/`hs` rows and deliberately
//  did NOT patch the instance — it is self-consistent within each language today, which
//  is exactly why it stays invisible until it is not. This file is the gate one layer
//  below every other one: it does not ask whether the data is internally consistent, it
//  asks whether the two LANGUAGES agree about what the data IS.
//
//  The checker itself is `tools/cross_loader_check.mjs` (AGENT-1 can run it directly:
//  `node tools/cross_loader_check.mjs`) — this file is its CI gate. No On/Off
//  special-casing anywhere in the checker: it tags every scalar with the category the
//  app's own `typeof` would give it and diffs the whole structure, so whatever a part
//  actually contains is what gets reported, not a fixed trap list.
//
//  TWO KNOWN, NAMED divergences exist today (`KNOWN_DIVERGENCES` below) — the same
//  `KNOWN_NARROWED`/`SILICON_FORCED_DOCUMENTED` shape used elsewhere in this suite: an
//  exemption is a citation, not a blank check, and an entry nothing reproduces this run
//  is itself a failure (stale, not a free pass — the "unused exception" discipline every
//  guard in this round has needed). ANY divergence not on that list is new and fails the
//  gate outright; this is the regression catcher the manager asked for, not a report.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { suite, test, assert, skip } from './lib/harness.js';
import { ROOT } from './lib/app.js';
import { runCheck, defaultFiles } from '../tools/cross_loader_check.mjs';

suite('cross-loader (yaml.safe_load vs js-yaml)');

/**
 * Every divergence this gate currently tolerates, named exactly — file, path, and BOTH
 * values, not "loaders disagree". EMPTY as of 2026-09-14: AGENT-1 fixed both real
 * entries this list ever carried — CH32H417's OPA `fb`/`pgadif`/`hs` (through the
 * generator) and CH32V006's `PWR.awu_prescaler` (edited in place, that part's gates
 * re-run) — and verified the fix through `node tools/cross_loader_check.mjs` directly
 * (all 7 files clean) rather than editing this file. The list going empty is what
 * "fixed" looks like here; it is not evidence the check stopped mattering. **Keep the
 * staleness half of the test below even at zero entries** — an exemption list with no
 * live entries and a working staleness check is a better artifact than a deleted file,
 * and it is what will catch the NEXT entry the moment someone adds one that has already
 * been fixed, or forgets to remove one that has not.
 */
const KNOWN_DIVERGENCES = [];
const knownId = d => `${d.file}::${d.path}`;

// One run of the real gate, shared by every test below.
let gate = null;
function gateReport() {
  if (gate) return gate;
  const rep = runCheck(ROOT);
  return (gate = rep);
}

test('the default file set is exactly what build.py embeds into dist/index.html', () => {
  const files = defaultFiles(ROOT).map(f => path.relative(ROOT, f).replace(/\\/g, '/'));
  assert.ok(files.includes('data/packages/packages.yaml'), `packages.yaml missing: ${JSON.stringify(files)}`);
  const mcus = files.filter(f => f.startsWith('data/mcus/'));
  assert.ok(mcus.length >= 6, `expected at least 6 MCU files, got ${mcus.length}: ${JSON.stringify(mcus)}`);
  assert.equal(files.length, 1 + mcus.length, 'defaultFiles() returned something other than packages.yaml + data/mcus/*.yaml');
});

test('every yaml.safe_load vs js-yaml divergence across all six parts is on the named, cited list', () => {
  const rep = gateReport();
  if (rep.missing) return skip(rep.missing);
  const found = [];
  for (const r of rep.results) {
    if (r.ok) continue;
    if (r.error) { found.push(`${r.relPath}: LOADER REFUSED — ${r.error}`); continue; }
    for (const d of r.diffs) found.push({ file: path.basename(r.relPath), path: d.path, py: d.py, js: d.js });
  }
  const refusals = found.filter(f => typeof f === 'string');
  assert.empty(refusals, 'a loader refused a real, shipped file outright — this is not a divergence, it is worse');

  const diffs = found.filter(f => typeof f !== 'string');
  const knownIds = new Set(KNOWN_DIVERGENCES.map(knownId));
  const unexpected = diffs.filter(d => !knownIds.has(knownId(d)))
    .map(d => `${d.file}${d.path}: py ${d.py} vs js ${d.js}  <-- NOT on KNOWN_DIVERGENCES, add a citation or this is a new bug`);
  assert.empty(unexpected, 'cross-loader divergence(s) not on the named exemption list');

  // The other direction: every named exemption must still actually reproduce. An entry
  // nothing exercises this run is stale — AGENT-1 fixed it and the list was not
  // updated, or the file changed shape under it — and a check that carries dead
  // exemptions forever is not checking anything, the same shape as an unused
  // SILICON_FORCED_DOCUMENTED or KNOWN_NARROWED entry.
  const foundIds = new Set(diffs.map(knownId));
  const stale = KNOWN_DIVERGENCES.filter(k => !foundIds.has(knownId(k)))
    .map(k => `${knownId(k)} — listed in KNOWN_DIVERGENCES but did not reproduce this run; delete the entry (fixed) or find out why it stopped firing`);
  assert.empty(stale, 'stale KNOWN_DIVERGENCES entries');
});

// ---- planted breaks: both directions, watched before trusted -------------------------

function scratchYaml(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-loader-plant-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf8');
  return { dir, path: p };
}
function cleanup(s) { try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch { /* best effort */ } }

test('planted break: a value that differs between loaders is caught and named exactly', () => {
  const s = scratchYaml('plant_value.yaml', 'top:\n  a_setting: Yes\n  untouched: hello\n  sexagesimal: 1:30\n');
  try {
    const rep = runCheck(ROOT, [s.path]);
    if (rep.missing) return skip(rep.missing);
    const r = rep.results[0];
    assert.notOk(r.ok, 'expected the planted Yes/No + sexagesimal file to be caught, got ok:true');
    assert.ok(r.diffs && r.diffs.length, 'expected diffs, got none');
    const byPath = Object.fromEntries(r.diffs.map(d => [d.path, d]));
    assert.ok(byPath['.top.a_setting'], `expected a diff at .top.a_setting, got paths: ${r.diffs.map(d => d.path).join(', ')}`);
    assert.equal(byPath['.top.a_setting'].py, 'bool true', 'python side of the planted Yes divergence');
    assert.equal(byPath['.top.a_setting'].js, 'string "Yes"', 'js side of the planted Yes divergence');
    assert.ok(byPath['.top.sexagesimal'], 'expected the bare 1:30 scalar to be caught as a sexagesimal-number divergence too — not special-casing On/Off only');
    assert.equal(byPath['.top.sexagesimal'].py, 'number 90', 'YAML 1.1 sexagesimal: 1:30 -> 1*60+30 = 90');
    assert.equal(byPath['.top.sexagesimal'].js, 'string "1:30"', 'YAML 1.2 leaves 1:30 as a plain string');
    assert.notOk(byPath['.top.untouched'], 'an unrelated, unambiguous string was reported as differing — false positive');
  } finally { cleanup(s); }
});

test('planted break: a file that parses identically under both loaders passes clean', () => {
  const s = scratchYaml('plant_clean.yaml',
    'peripheral:\n  name: "Example"\n  enabled: true\n  count: 5\n  ratio: 5.5\n  tags: [a, b, c]\n  nested:\n    inner: "value"\n    off_by_quoting: "Off"\n');
  try {
    const rep = runCheck(ROOT, [s.path]);
    if (rep.missing) return skip(rep.missing);
    const r = rep.results[0];
    assert.ok(r.ok, `expected a clean parse, got: ${JSON.stringify(r.diffs || r.error)}`);
  } finally { cleanup(s); }
});

test('planted break: a file the JS loader refuses is a hard, named failure — not a skip, not silently absent', () => {
  // js-yaml's default schema throws on a duplicate mapping key; yaml.safe_load allows
  // it (last value wins, silently). This is the exact shape STATUS.md's round-6
  // preamble names: three green Python gates over a file js-yaml rejected outright.
  const s = scratchYaml('plant_refused.yaml', 'a: 1\na: 2\n');
  try {
    const rep = runCheck(ROOT, [s.path]);
    if (rep.missing) return skip(rep.missing);
    assert.equal(rep.results.length, 1, 'the refused file must still produce exactly one named result, not be dropped from the report');
    const r = rep.results[0];
    assert.notOk(r.ok, 'expected the JS-refused file to be reported as a failure');
    assert.ok(r.error, 'expected a distinct .error (loader refusal), not folded into .diffs (loaders disagree) - the two are different failure modes');
    assert.notOk(r.diffs, 'a refusal must not also carry a .diffs list');
    assert.match(r.error, /js-yaml/, 'the error must name WHICH loader refused');
    assert.match(r.error, /duplicat/i, 'the error must carry js-yaml\'s own reason, not a generic "parse failed"');
  } finally { cleanup(s); }
});
