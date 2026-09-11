// Data QA: the MCU and package YAML must be valid, drawable and self-consistent.
// The heavy lifting is tools/validate_mcu.py, which AGENT-1 also runs by hand while
// extracting a part; this suite makes it a merge gate and adds the checks that are
// easier to express against the loaded app.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { suite, test, assert, skip } from './lib/harness.js';
import { yaml } from './lib/deps.js';
import { boot, ROOT } from './lib/app.js';

suite('data');

const MCU_DIR = path.join(ROOT, 'data', 'mcus');
const mcuFiles = fs.readdirSync(MCU_DIR).filter(f => f.endsWith('.yaml')).map(f => path.join(MCU_DIR, f));
const loadYaml = p => yaml().load(fs.readFileSync(p, 'utf8'));

// python3 does not exist on Windows; python does. Try both and report honestly.
function runValidator(args) {
  for (const exe of ['python', 'python3']) {
    const res = spawnSync(exe, [path.join(ROOT, 'tools', 'validate_mcu.py'), ...args], {
      cwd: ROOT, encoding: 'utf8',
    });
    if (!res.error) return res;
  }
  return null;
}

test('every MCU file passes tools/validate_mcu.py', () => {
  const res = runValidator(['--quiet']);
  // A real skip now: the runner counts these and lists them above the verdict,
  // which a console.log and a bare `return` never did — that read as a pass.
  if (!res) skip('no python interpreter on PATH (tried: python, python3)');
  const out = ((res.stdout || '') + (res.stderr || '')).trim();
  if (/PyYAML is required/.test(out)) skip('PyYAML is not installed — pip install pyyaml');
  assert.equal(res.status, 0, 'validate_mcu.py reported errors:\n' + out);
});

test('package geometries are well formed and unique', () => {
  const doc = loadYaml(path.join(ROOT, 'data', 'packages', 'packages.yaml'));
  const problems = [];
  const seen = new Set();
  for (const p of doc.packages) {
    const id = p.id;
    if (!id) { problems.push(`a package has no id: ${JSON.stringify(p)}`); continue; }
    if (seen.has(id)) problems.push(`${id}: declared twice`);
    seen.add(id);
    if (!['dual', 'quad'].includes(p.kind)) problems.push(`${id}: kind must be dual or quad, got ${p.kind}`);
    if (!Number.isInteger(p.pins) || p.pins <= 0) problems.push(`${id}: pins must be a positive integer`);
    else if (p.kind === 'quad' && p.pins % 4) problems.push(`${id}: quad package with ${p.pins} pins is not divisible by 4`);
    else if (p.kind === 'dual' && p.pins % 2) problems.push(`${id}: dual package with ${p.pins} pins is not divisible by 2`);
    if (p.pitch !== undefined && !(p.pitch > 0)) problems.push(`${id}: pitch must be positive`);
  }
  assert.empty(problems, 'package geometry problems');
});

test('the shipped parts are real silicon, never a fixture', () => {
  // `data/mcus/` is what the app offers the user. A synthetic part there shows up in the
  // part selector and in the built bundle, and a user can pick it and generate a project
  // for a chip that does not exist. The layout fixture lives in `tests/fixtures/mcus/`
  // and is registered by the test harnesses that want it. A part declares itself either
  // way — by `codegen.sdk.synthetic` or by `mcu.fixture` — so this reads the file's own
  // statement rather than matching a name.
  const offenders = [];
  for (const f of mcuFiles) {
    const m = (loadYaml(f) || {}).mcu || {};
    const synthetic = !!((m.codegen || {}).sdk || {}).synthetic;
    if (synthetic || m.fixture === true) offenders.push(path.basename(f));
  }
  assert.empty(offenders, 'synthetic fixtures in data/mcus/ — they belong in tests/fixtures/mcus/');
});

test('every package an MCU uses has a geometry to draw it with', () => {
  const geo = new Set(loadYaml(path.join(ROOT, 'data', 'packages', 'packages.yaml')).packages.map(p => p.id));
  const problems = [];
  for (const f of mcuFiles) {
    const doc = loadYaml(f);
    for (const pkg of Object.keys(doc.packages || {})) {
      if (!geo.has(pkg)) problems.push(`${path.basename(f)}: package ${pkg} has no geometry`);
    }
  }
  assert.empty(problems, 'packages without a drawing');
});

test('the pin count in each package table matches its geometry', () => {
  const geo = {};
  for (const p of loadYaml(path.join(ROOT, 'data', 'packages', 'packages.yaml')).packages) geo[p.id] = p;
  const problems = [];
  for (const f of mcuFiles) {
    const doc = loadYaml(f);
    for (const [pkg, table] of Object.entries(doc.packages || {})) {
      if (!geo[pkg]) continue;
      // pin 0 is the exposed pad, not one of the numbered pins
      const count = Object.keys(table).filter(n => String(n) !== '0').length;
      if (count !== geo[pkg].pins) {
        problems.push(`${path.basename(f)} ${pkg}: table has ${count} pins, geometry says ${geo[pkg].pins}`);
      }
    }
  }
  assert.empty(problems, 'pin count mismatches');
});

test('every remap routes to a pin that the file declares', () => {
  const problems = [];
  for (const f of mcuFiles) {
    const doc = loadYaml(f);
    const known = new Set(Object.keys(doc.pins || {}));
    for (const [pid, P] of Object.entries(doc.peripherals || {})) {
      (P.remaps || []).forEach((r, i) => {
        for (const [sig, pin] of Object.entries(r.pins || {})) {
          if (!known.has(pin)) problems.push(`${path.basename(f)} ${pid}.remaps[${i}] ${sig} -> ${pin} (undeclared)`);
        }
      });
    }
  }
  assert.empty(problems, 'remaps pointing at undeclared pins');
});

test('the app can load every bundled MCU on every one of its packages', () => {
  const a = boot();
  const problems = [];
  try {
    for (const name of a.mcuNames) {
      a.loadMcu(name);
      for (const pkg of a.packages) {
        a.clearProblems();
        try {
          a.setPackage(pkg);
          if (!a.pinEls().length) problems.push(`${name} ${pkg}: no pins drawn`);
        } catch (e) {
          problems.push(`${name} ${pkg}: ${e.message}`);
        }
        for (const p of a.problems()) problems.push(`${name} ${pkg}: ${p}`);
      }
    }
  } finally { a.close(); }
  assert.empty(problems, 'MCU/package load problems');
});
