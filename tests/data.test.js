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


// =============================================================================
//  DUPLICATE KEYS — the gate hole where three green Python checks stood in front of a
//  file the app could not open at all.
//
//  Found 2026-09-12 while reshaping CH32H417's FMC block. A generator bug emitted
//  `settings:` TWICE in one peripheral. What happened next is the whole point:
//
//    python tools/validate_mcu.py      -> 0 error(s), 99 warning(s)
//    python tools/verify_sdk_names.py  -> 0 error(s), 0 warning(s)
//    python tools/coverage.py --gate   -> coverage gate: 6 of 6 part(s) meet their status
//    the app                           -> duplicated mapping key (1958:5)
//
//  PyYAML's `safe_load` resolves a duplicate key silently by keeping the LAST one, so every
//  Python gate read a coherent document and passed. js-yaml, which is what the configurator
//  and the code generator actually use, throws. So the data gates can be unanimously green
//  over a part nobody can open — and the failure is not subtle when it arrives, it is the
//  whole app blank.
//
//  The silent half is worse than the throw. Where the duplicate keys hold DIFFERENT content
//  — one `settings:` block replacing another — Python's gates validate the second and the
//  app would have used the second too, so a reviewer comparing them sees agreement. The
//  discrepancy only appears when a reader expects the first.
//
//  This check reads the raw text rather than a parse, because a parse is exactly the thing
//  that hides the problem.
// =============================================================================

/**
 * Duplicate sibling keys in a YAML document, found on the token stream.
 *
 * Indentation-scoped and deliberately conservative: it only looks at plain `key:` lines,
 * tracks the block path by indent, and skips everything inside a block scalar (`|` / `>`),
 * inside a flow collection, and after a `#`. A `- ` item opens a new scope, so two list
 * entries with the same key are not a duplicate.
 */
function duplicateKeys(text) {
  const lines = text.split(/\r?\n/);
  const seen = [];            // stack of { indent, keys:Set }
  const dups = [];
  let blockIndent = null;     // inside a `|`/`>` scalar: skip until indent drops
  let flow = 0;               // unclosed `{`/`[` carried over from previous lines

  /** Net flow-collection depth a line opens, ignoring quoted text and comments. */
  const flowDelta = (s) => {
    const bare = s
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^']|'')*'/g, "''")
      .replace(/#.*$/, '');
    let d = 0;
    for (const ch of bare) {
      if (ch === '{' || ch === '[') d++;
      else if (ch === '}' || ch === ']') d--;
    }
    return d;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = raw.match(/^\s*/)[0].length;
    if (blockIndent !== null) {
      if (indent > blockIndent) continue;
      blockIndent = null;
    }
    // A flow collection left open on an earlier line swallows this one. `signals:` inside
    // a multi-line `- { name: ..., \n signals: [...] }` is a FLOW pair, not a block key,
    // and treating it as one reported three duplicates in a perfectly legal CH32H417 FMC
    // block on 2026-09-12. Depth is tracked across lines rather than per line, because the
    // opening brace and the key that follows it are on different lines by definition.
    //
    // The depth MUST be updated before any `continue` below, or a line that opens a brace
    // and matches no key never records it — which was this check's own first bug, caught by
    // its planted-break test rather than by the tree.
    const startedInFlow = flow > 0;
    flow += flowDelta(raw);
    if (flow < 0) flow = 0;
    if (startedInFlow) continue;
    // `key:` at the start of the line's content, or `- key:` (which opens a new item scope)
    const m = raw.match(/^(\s*)(-\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*:(\s|$)/);
    if (!m) continue;
    const isItem = !!m[2];
    const keyIndent = indent + (isItem ? m[2].length : 0);
    const key = m[3];
    while (seen.length && seen[seen.length - 1].indent > keyIndent) seen.pop();
    if (isItem || !seen.length || seen[seen.length - 1].indent < keyIndent) {
      seen.push({ indent: keyIndent, keys: new Set() });
    }
    const scope = seen[seen.length - 1];
    if (scope.keys.has(key)) dups.push(`line ${i + 1}: \`${key}:\` appears twice at the same level`);
    else scope.keys.add(key);
    // A block scalar swallows everything more-indented that follows it.
    if (/:\s*[|>][-+]?\d*\s*$/.test(raw)) blockIndent = keyIndent;
  }
  return dups;
}

test('no MCU or package YAML has a duplicate key', () => {
  // js-yaml throws on these and PyYAML does not, so the Python gates cannot be the ones
  // that catch it. Read the header of this section before relaxing anything here.
  const bad = [];
  const files = [...mcuFiles, path.join(ROOT, 'data', 'packages', 'packages.yaml')];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    for (const d of duplicateKeys(fs.readFileSync(f, 'utf8'))) {
      bad.push(`${path.relative(ROOT, f).replace(/\\/g, '/')} ${d}`);
    }
  }
  assert.empty(bad, 'duplicate YAML keys — PyYAML keeps the last silently, js-yaml refuses '
    + 'the file, so validate_mcu.py can be green while the app will not open the part');
});

test('every MCU file loads under the parser the APP uses, not just under PyYAML', () => {
  // The direct statement of the same thing, and the one that would have caught the FMC
  // regression on its own: js-yaml is what dist/index.html and wchcube_cli.js run.
  const bad = [];
  for (const f of mcuFiles) {
    try { yaml().load(fs.readFileSync(f, 'utf8')); }
    catch (e) { bad.push(`${path.basename(f)}: ${String(e.message || e).split('\n')[0]}`); }
  }
  assert.empty(bad, 'MCU files the app\'s YAML parser refuses');
});

test('the duplicate-key check can actually fail', () => {
  // Planted breaks, because a detector nobody has seen fire is not a detector — and this
  // one is hand-rolled, so it is more likely to be wrong than most.
  const caught = s => duplicateKeys(s).length;

  // The real shape: two `settings:` under one peripheral, 100 lines apart.
  assert.ok(caught('peripherals:\n  FMC:\n    category: Memory\n    settings:\n      - name: A\n    signal_pins:\n      D0: []\n    settings:\n      - name: B\n') > 0,
    'the FMC regression itself is not caught');
  assert.ok(caught('a:\n  b: 1\n  b: 2\n') > 0, 'a plain sibling duplicate is not caught');

  // ...and the false positives that would make it useless. Each of these is LEGAL YAML.
  const clean = [
    ['same key in two different parents', 'a:\n  name: x\nb:\n  name: y\n'],
    ['same key in two list items', 'xs:\n  - name: a\n    v: 1\n  - name: b\n    v: 2\n'],
    ['a key repeated inside a block scalar', 'notes: |\n  name: not a key\n  name: still not a key\nname: real\n'],
    ['a folded scalar', 'notes: >\n  settings: text\n  settings: more text\nsettings: real\n'],
    ['a commented-out key', 'a: 1\n# a: 2\n'],
    ['flow mapping on one line', 'x: { name: a, v: 1 }\ny: { name: b, v: 2 }\n'],
    // THE ONE THAT ACTUALLY BIT. A flow mapping WRAPPED over two lines: `signals:` on
    // the continuation line is a flow pair, not a block key, and reading it as one
    // reported three duplicates in a perfectly legal CH32H417 FMC block. The detector
    // now tracks flow depth ACROSS lines, which is the only way to see this.
    ['flow mapping wrapped over two lines',
     'choices:\n  - { name: "a",\n      signals: [X] }\n  - { name: "b",\n      signals: [Y] }\n'],
    ['a wrapped flow sequence', 'xs: [\n  1,\n  2,\n]\nname: real\n'],
    ['braces inside a quoted string', 'a: "{ name: x"\nb: 2\n'],
  ];
  const wrong = clean.filter(([, s]) => caught(s) > 0).map(([why]) => why);
  assert.empty(wrong, 'legal YAML the duplicate-key check wrongly flags');
});
