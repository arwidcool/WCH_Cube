// =============================================================================
//  tests/generated_project.test.js — round 4's new gate. Deliverable B.
//
//  Round 3's rule was "a name nobody compiled is a guess". Round 4's is its
//  sibling: **a part nobody generated a project for is a part nobody has
//  actually used.** The gap between "the C compiles" and "I can open this folder
//  and press Upload" is where the remaining unknowns live, and this is what
//  closes it.
//
//  It generates a WHOLE PROJECT to a scratch directory outside the repository
//  and builds it standalone. Not `data/firmware` with files dropped into it —
//  that project already has a platformio.ini, a main.c and a lib/ layout, so
//  building there proves the generated init code compiles and nothing about
//  whether the generator can produce a project. The whole claim is that a user
//  can move the folder anywhere and it still builds.
//
//  Written BEFORE `projectFiles()` exists, on purpose: a gate written against
//  the contract tells the person implementing it what it has to do, and runs the
//  moment they land it. Until then every case here SKIPS with a printed reason
//  the runner counts — never silently.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { suite, test, assert, skip } from './lib/harness.js';
import { FIXTURES } from './fixtures/make_fixtures.js';
import * as eng from '../app/engine/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

suite('generated project');

// ---------------------------------------------------------------- environment
function boot() {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'vendor', 'js-yaml.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  eng.setYaml(mod.exports);
  eng.loadPackages(eng.yamlLoad(fs.readFileSync(path.join(ROOT, 'data', 'packages', 'packages.yaml'), 'utf8')));
  const dir = path.join(ROOT, 'data', 'mcus');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yaml')).sort()) {
    eng.registerMcuFile(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}
boot();

/**
 * The seam this gate is built on.
 *
 * `projectFiles()` belongs in `app/engine/` rather than in the page, and that is
 * not a style preference: the page's copy can only be reached through a browser,
 * so a CLI, a CI job and this test would each need their own way in. One
 * function in the engine is what makes "generate a project" scriptable at all.
 * `app/template.html` already guards on `typeof projectFiles === 'function'` and
 * hides the button until it exists — absent rather than present and broken.
 */
const generator = typeof eng.projectFiles === 'function' ? eng.projectFiles : null;
const NO_GENERATOR = 'app/engine/ exports no projectFiles() yet (AGENT-2, round-4 deliverable B). '
  + 'This gate is written against the contract and runs the moment it lands.';

const pio = (() => {
  const tried = [];
  const candidates = process.platform === 'win32'
    ? [['pio.exe'], ['platformio.exe'], ['pio'], ['platformio']]
    : [['pio'], ['platformio'], [process.env.PYTHON || 'python3', '-m', 'platformio']];
  for (const cmd of candidates) {
    tried.push(cmd.join(' '));
    const r = spawnSync(cmd[0], [...cmd.slice(1), '--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return { ok: true, cmd };
  }
  return { ok: false, why: `PlatformIO is not on PATH (tried: ${tried.join(', ')}), so a generated project cannot be built` };
})();

// ---------------------------------------------------------------- helpers
/** Load a fixture into the engine and return its file list. */
function filesFor(fixture) {
  eng.projectApply(fs.readFileSync(path.join(HERE, 'fixtures', fixture.file), 'utf8'));
  eng.compute();
  return generator();
}

/** Write a `[{ path, text }]` list into a fresh scratch directory. Returns its root. */
function writeTo(files, name) {
  // Deliberately in the SYSTEM temp directory, never in the repo: a generated
  // project that builds because it happens to sit next to data/firmware would
  // pass this gate while failing the only thing it claims.
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-proj-')), name);
  for (const f of files) {
    const dest = path.join(root, f.path);
    assert.ok(path.resolve(dest).startsWith(path.resolve(root)),
      `${f.path} escapes the project root — the generator must emit relative paths only`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.text);
  }
  return root;
}

const rmrf = p => { try { fs.rmSync(path.dirname(p), { recursive: true, force: true }); } catch { /* best effort */ } };

/** Which variants of the loaded part can and cannot produce a project. */
function variantBoards() {
  const out = { withBoard: [], without: [] };
  for (const [name, v] of Object.entries((eng.M.mcu || {}).variants || {})) {
    (v && v.pio_board ? out.withBoard : out.without).push(name);
  }
  return out;
}

// ---------------------------------------------------------------- the gate
for (const fixture of FIXTURES) {
  test(`${fixture.mcu} ${fixture.pkg}: a generated project builds standalone`, () => {
    if (!generator) skip(NO_GENERATOR);
    if (!pio.ok) skip(pio.why);

    const files = filesFor(fixture);
    assert.ok(files && files.length, `projectFiles() produced nothing for ${fixture.file}`);
    const root = writeTo(files, `${fixture.mcu}_Demo`);
    try {
      const r = spawnSync(pio.cmd[0], [...pio.cmd.slice(1), 'run'],
        { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      const out = (r.stdout || '') + (r.stderr || '');
      const diag = out.split(/\r?\n/).filter(l => /\b(error|Error|ERROR|undeclared|No such file|FAILED)\b/.test(l));
      assert.equal(r.status, 0,
        `pio run failed in a generated project for ${fixture.mcu}.\n`
        + 'A user who pressed Generate and opened this folder would see exactly this.\n'
        + (diag.length ? `--- the errors ---\n${diag.slice(0, 25).join('\n')}\n\n` : '')
        + `--- last lines ---\n${out.split(/\r?\n/).slice(-25).join('\n')}`);
      assert.match(out, /SUCCESS/, `pio reported no SUCCESS:\n${out.split(/\r?\n/).slice(-20).join('\n')}`);
    } finally {
      rmrf(root);
    }
  });
}

test('a generated project is self-contained', () => {
  if (!generator) skip(NO_GENERATOR);
  const required = [
    'platformio.ini',
    'README.md',
    'src/main.c',
    'lib/wchcube_generated/include/wchcube_init.h',
    'lib/wchcube_generated/src/wchcube_init.c',
  ];
  const problems = [];
  for (const fixture of FIXTURES) {
    const files = filesFor(fixture);
    const paths = files.map(f => f.path.replace(/\\/g, '/'));
    for (const need of required) {
      if (!paths.includes(need)) problems.push(`${fixture.mcu}: no ${need} in the generated project`);
    }
    for (const f of files) {
      const p = f.path.replace(/\\/g, '/');
      if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.split('/').includes('..')) {
        problems.push(`${fixture.mcu}: ${f.path} is not a path inside the project`);
      }
      // The whole claim is that the folder can be moved anywhere. A relative
      // reference climbing out of it is the one thing that would quietly break
      // that while still building here, next to the repo it escaped into.
      if (/\.\.[\\/]/.test(String(f.text)) && /\.(ini|c|h|md)$/.test(p)) {
        const lines = String(f.text).split(/\r?\n/)
          .filter(l => /\.\.[\\/]/.test(l) && !/^\s*(\*|\/\/|#)/.test(l));
        for (const l of lines) problems.push(`${fixture.mcu}: ${p} refers outside the project — ${l.trim().slice(0, 80)}`);
      }
    }
  }
  assert.empty(problems, 'the generated project is not self-contained');
});

test('platformio.ini names the board from the MCU file, not from the part number', () => {
  if (!generator) skip(NO_GENERATOR);
  const problems = [];
  for (const fixture of FIXTURES) {
    const files = filesFor(fixture);
    const ini = files.find(f => f.path.replace(/\\/g, '/') === 'platformio.ini');
    if (!ini) { problems.push(`${fixture.mcu}: no platformio.ini`); continue; }
    const boards = Object.values((eng.M.mcu || {}).variants || {}).map(v => v && v.pio_board).filter(Boolean);
    const named = /^\s*board\s*=\s*(\S+)/m.exec(ini.text);
    if (!named) { problems.push(`${fixture.mcu}: platformio.ini names no board`); continue; }
    if (!boards.includes(named[1])) {
      problems.push(`${fixture.mcu}: platformio.ini says board = ${named[1]}, which is not any variant's `
        + `pio_board (${boards.join(', ') || 'none'}) — it must come from the data, not from the part number`);
    }
    // The platform is pinned by GIT URL, and this is the guard for it. The registry has no
    // `ch32v` platform at all - `pio pkg search ch32v` finds nothing and the registry API
    // answers 404 - so `platform = ch32v` only ever resolved on a machine where it had
    // been installed by hand. A generated project saying that cannot build on a clean
    // machine, which is the same defect that made the CI firmware job fail in two
    // seconds. Asserted as the exact URL so a half-fix (a name that still resolves
    // nowhere) fails here rather than in a user's terminal.
    if (!/^\s*platform\s*=\s*https:\/\/github\.com\/Community-PIO-CH32V\/platform-ch32v\.git\s*$/m
        .test(ini.text)) {
      problems.push(`${fixture.mcu}: platform is not the Community-PIO-CH32V git URL — `
        + '`platform = ch32v` does not resolve from the registry');
    }
    if (/^\s*platform\s*=\s*ch32v\s*$/m.test(ini.text)) {
      problems.push(`${fixture.mcu}: platform is the bare registry name ch32v, which resolves `
        + 'nowhere — this project cannot build on a clean machine');
    }
    if (!/^\s*framework\s*=\s*noneos-sdk\s*$/m.test(ini.text)) problems.push(`${fixture.mcu}: framework is not noneos-sdk`);
  }
  assert.empty(problems, 'a generated platformio.ini does not come from the MCU data');
});

test('a variant with no pio_board is refused by name, with the usable ones listed', () => {
  if (!generator) skip(NO_GENERATOR);
  // Three variants are already in this position and say so by omission:
  // CH32V006F4U6 and CH32V006D8U7, and CH32X035D8U6. Substituting the nearest
  // board would LIE about the part — F4U6 is 16 KB of flash against F8U6's 62 KB
  // — so the refusal is the correct behaviour and has to be tested as such.
  const problems = [];
  for (const part of ['CH32V006', 'CH32X035']) {
    if (!eng.MCU_FILES[part]) continue;
    eng.loadMcu(eng.MCU_FILES[part]);
    const { withBoard, without } = variantBoards();
    if (!without.length) continue;
    assert.ok(withBoard.length, `${part}: no variant has a pio_board at all`);
    for (const variant of without) {
      let refused = false, message = '';
      try {
        eng.setProject({ name: 'Demo', variant });
        const files = generator();
        const ini = (files || []).find(f => f.path.replace(/\\/g, '/') === 'platformio.ini');
        // Not throwing is acceptable ONLY if nothing was produced for it.
        if (ini) message = `generated a platformio.ini anyway: ${/board\s*=.*/.exec(ini.text)}`;
        else refused = true;
      } catch (e) { refused = true; message = e.message; }
      if (!refused) problems.push(`${part} ${variant} has no pio_board but was not refused — ${message}`);
      else if (message && !message.includes(variant)) {
        problems.push(`${part} ${variant} was refused, but the message does not name the variant: ${message}`);
      }
    }
  }
  assert.empty(problems, 'a variant with no pio_board must be refused by name, never given a neighbour\'s board');
});

test('main.c blinks a pin only when the user configured an output', () => {
  if (!generator) skip(NO_GENERATOR);
  // "A blink on a pin nobody configured" is the class of invention this project
  // bans, and it is easy to write by accident because a blink makes a better
  // demo. Both directions are asserted: a project WITH an output pin names that
  // pin, and a project without one says so instead of toggling something.
  const problems = [];
  for (const fixture of FIXTURES) {
    const files = filesFor(fixture);
    const main = files.find(f => f.path.replace(/\\/g, '/') === 'src/main.c');
    if (!main) { problems.push(`${fixture.mcu}: no src/main.c`); continue; }
    // pinRows() rows carry `name` (the pin, or "PD7/PA4" for a shorted pair), not `pin`.
    // With `r.pin` this filter was always empty and the test blamed main.c for toggling
    // a pin the user really had configured — AGENT-2's 18:05Z finding.
    const outputs = eng.pinRows().filter(r => (eng.S.manual || {})[r.name] === 'GPIO_Output');
    if (outputs.length) {
      // A shorted pair's row is named "PD7/PA4"; main.c toggles ONE of the two, so either
      // half counts. Match on a word boundary so PA1 does not pass on the strength of PA10.
      const named = outputs.some(o => o.name.split('/').some(n => new RegExp(`\\b${n}\\b`).test(main.text)));
      if (!named) problems.push(`${fixture.mcu}: ${outputs.length} output pin(s) configured but main.c names none of them`);
    } else if (/GPIO_WriteBit|GPIO_SetBits|GPIO_ResetBits/.test(main.text)) {
      problems.push(`${fixture.mcu}: no output GPIO is configured, but main.c toggles one anyway`);
    }
  }
  assert.empty(problems, 'main.c invents hardware, or ignores the hardware the user configured');
});

test('the generated README explains the two-clock-owners behaviour', () => {
  if (!generator) skip(NO_GENERATOR);
  // A project configured for 24 MHz boots at 48 and drops to 24, because the
  // board file's SYSCLK_FREQ_* macro reaches SystemInit() before main() runs and
  // WCHCube_RCC_Init() then wins. That is fine and it is what CubeMX does too —
  // but a user watching the banner print two different numbers deserves one
  // sentence rather than a puzzle.
  const problems = [];
  for (const fixture of FIXTURES) {
    const files = filesFor(fixture);
    const readme = files.find(f => f.path.replace(/\\/g, '/') === 'README.md');
    if (!readme) { problems.push(`${fixture.mcu}: no README.md`); continue; }
    if (!/SystemInit|SystemCoreClock|before .*main|two clock/i.test(readme.text)) {
      problems.push(`${fixture.mcu}: README.md does not mention the clock the SDK applies before main()`);
    }
  }
  assert.empty(problems, 'the generated README does not explain why the banner prints two clock numbers');
});
