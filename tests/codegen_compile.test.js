// =============================================================================
//  tests/codegen_compile.test.js — THE COMPILE GATE.
//
//  Round 3's rule is "a name nobody compiled is a guess". This is the test that
//  compiles. It takes a checked-in `.wchproj` that actually configures the part,
//  runs the real CLI over it exactly as a user would, drops the result into
//  `data/firmware/lib/wchcube_generated/` and builds it with the WCH RISC-V
//  toolchain for the matching board.
//
//  Two defects (`ch32v00x.h` for a part whose header is `ch32v00X.h`, and
//  `GPIO_Speed_50MHz` on a part whose GPIOSpeed_TypeDef has one member) shipped
//  through a whole round of browser testing and 267 green tests, because nothing
//  ever fed the generated C to a compiler. That is what this closes.
//
//  Rules this test holds itself to:
//    * The fixtures ASSIGN PINS. A default configuration generates an empty
//      WCHCube_GPIO_Init() and proves nothing — the round-3 setup pass made
//      exactly that mistake and said so.
//    * If PlatformIO is absent the checks SKIP WITH A PRINTED REASON and the
//      runner's summary counts them. A silent skip is worse than a failure.
//    * The drop zone is restored afterwards: a test must not leave generated
//      files where the next build picks them up.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { suite, test, assert, skip } from './lib/harness.js';
import { FIXTURES } from './fixtures/make_fixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FW = path.join(ROOT, 'data', 'firmware');
const DROP = path.join(FW, 'lib', 'wchcube_generated');
const CLI = path.join(ROOT, 'tools', 'wchcube_cli.js');

suite('codegen compile gate');

// ---------------------------------------------------------------- environment
/** PlatformIO, or the reason there isn't one. Resolved once. */
const pio = (() => {
  if (!fs.existsSync(path.join(FW, 'platformio.ini'))) {
    return { ok: false, why: `no PlatformIO project at ${path.relative(ROOT, FW)} — nothing to build the generated C with` };
  }
  // `pio` is an executable on PATH on this box; elsewhere it is only reachable
  // as a Python module. Try each before giving up, and report what was tried.
  // Deliberately NOT via `shell: true`: that concatenates arguments instead of
  // escaping them, and Node 24 warns about it on every call.
  const tried = [];
  const candidates = [['pio'], ['platformio'], [process.env.PYTHON || 'python', '-m', 'platformio']];
  if (process.platform === 'win32') candidates.unshift(['pio.exe'], ['platformio.exe']);
  for (const cmd of candidates) {
    tried.push(cmd.join(' '));
    const r = spawnSync(cmd[0], [...cmd.slice(1), '--version'], { encoding: 'utf8' });
    if (r.status === 0) return { ok: true, cmd, version: (r.stdout || '').trim() };
  }
  return { ok: false, why: `PlatformIO is not installed or not on PATH (tried: ${tried.join(', ')}). Install it to run the compile gate: pip install platformio` };
})();

// ---------------------------------------------------------------- drop zone
/**
 * Save whatever is in the drop zone, so a developer's own generated files come
 * back afterwards. The folder is .gitignore'd, so its contents are not ours to
 * throw away.
 */
function saveDropZone() {
  const saved = [];
  for (const sub of ['src', 'include']) {
    const dir = path.join(DROP, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isFile()) saved.push({ p, text: fs.readFileSync(p) });
    }
  }
  return saved;
}

function clearDropZone() {
  for (const sub of ['src', 'include']) {
    const dir = path.join(DROP, sub);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isFile() && /\.(c|h)$/.test(f)) fs.unlinkSync(p);
    }
  }
}

/**
 * Put the drop zone back. BEST EFFORT, deliberately.
 *
 * This runs in a `finally`, and four agents share this tree: another one
 * regenerating into `lib/wchcube_generated/` at the same moment makes a file
 * operation here throw, and a throw in a `finally` REPLACES the test's real
 * result. That turned a passing compile into a red line twice before it was
 * understood. Cleanup is not an assertion: if it fails, say so and let the
 * test's own verdict stand.
 */
function restoreDropZone(saved) {
  try {
    clearDropZone();
    for (const { p, text } of saved) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
    }
  } catch (e) {
    process.stdout.write(`        (could not restore the generated-code drop zone: ${e.message};`
      + ' another agent is probably generating into it right now — harmless)\n');
  }
}

// ---------------------------------------------------------------- the steps
/**
 * Run the CLI over a fixture and place the result in the firmware project.
 *
 * The CLI writes both files into one `--out` directory (AGENT-2 is adding
 * `--pio` for exactly this), so generation happens in a scratch directory and
 * each file is then copied where the build expects it. Doing it that way rather
 * than writing into `src/` and moving the header afterwards is not fussiness:
 * scons records an implicit dependency at the path where it FIRST saw the
 * header, so a header that sits in `src/` even for a moment poisons that
 * environment's dependency cache with a path that will never exist again. That
 * cost a build here, which is why it is written down.
 */
function generate(fixture) {
  const proj = path.join(HERE, 'fixtures', fixture.file);
  assert.ok(fs.existsSync(proj), `fixture missing: ${path.relative(ROOT, proj)} — run: node tests/fixtures/make_fixtures.js`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-gate-'));
  try {
    const r = spawnSync(process.execPath,
      [CLI, '--project', proj, '--format', 'c', '--out', scratch, '--quiet'],
      { encoding: 'utf8' });
    assert.equal(r.status, 0, `wchcube_cli.js failed on ${fixture.file}:\n${r.stderr || r.stdout}`);
    const cSrc = path.join(scratch, 'wchcube_init.c');
    const hSrc = path.join(scratch, 'wchcube_init.h');
    assert.ok(fs.existsSync(cSrc), `no wchcube_init.c was generated for ${fixture.file}`);
    assert.ok(fs.existsSync(hSrc), `no wchcube_init.h was generated for ${fixture.file}`);
    clearDropZone();
    fs.copyFileSync(cSrc, path.join(DROP, 'src', 'wchcube_init.c'));
    fs.copyFileSync(hSrc, path.join(DROP, 'include', 'wchcube_init.h'));
    return { c: fs.readFileSync(cSrc, 'utf8'), h: fs.readFileSync(hSrc, 'utf8') };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The gate's own scons build tree, kept out of `.pio/build`.
 *
 * Four agents share one working tree, and any of them may have `pio run` going
 * in `data/firmware` while this suite runs. Two builds in one build directory
 * produce failures that belong to neither — this cost one spurious red here
 * before it was isolated. A STABLE directory rather than a fresh one, so the
 * gate still builds incrementally and stays a couple of seconds per environment.
 */
const GATE_BUILD_DIR = path.join(FW, '.pio', 'gate');

/** `pio run -e <env>` in data/firmware. Returns the combined output. */
function build(env) {
  const r = spawnSync(pio.cmd[0], [...pio.cmd.slice(1), 'run', '-e', env], {
    cwd: FW,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PLATFORMIO_BUILD_DIR: GATE_BUILD_DIR },
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/**
 * What actually went wrong, rather than the last N lines.
 *
 * A failing build's tail is often nothing but "Compiling ..." lines — scons
 * keeps going after an error — so a plain tail can report a failure while
 * showing none of it. Pull the diagnostic lines out first, then the tail.
 */
function whyItFailed(out) {
  const lines = out.split(/\r?\n/);
  const diag = lines.filter(l => /\b(error|Error|ERROR|undeclared|undefined reference|No such file|FAILED)\b/.test(l));
  return (diag.length ? `--- the errors ---\n${diag.slice(0, 30).join('\n')}\n\n` : '')
    + `--- last lines of the build ---\n${lines.slice(-25).join('\n')}`;
}

/**
 * The object file the generated source becomes, if the build produced one.
 *
 * Grepping the build log for "Compiling … wchcube_init.o" only works on a cold
 * build: scons says nothing about a file it did not need to recompile, so on the
 * second run of a green suite the line is absent and an assertion on it would
 * fail for no reason. Looking on disk is the same question asked correctly.
 */
function generatedObject(env) {
  const buildDir = path.join(GATE_BUILD_DIR, env);
  if (!fs.existsSync(buildDir)) return null;
  const stack = [buildDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === 'wchcube_init.o') return p;
    }
  }
  return null;
}

// ---------------------------------------------------------------- the gate
/** What is in the drop zone right now, as one string. Cheap identity check. */
function dropZoneState() {
  const parts = [];
  for (const p of [path.join(DROP, 'src', 'wchcube_init.c'), path.join(DROP, 'include', 'wchcube_init.h')]) {
    try { parts.push(fs.readFileSync(p, 'utf8')); } catch { parts.push('(absent)'); }
  }
  return parts.join('\x00');
}

for (const fixture of FIXTURES) {
  test(`${fixture.mcu} ${fixture.pkg}: a configured project generates C that compiles for ${fixture.env}`, () => {
    if (!pio.ok) skip(pio.why);
    const saved = saveDropZone();
    try {
      // Four agents share this tree and the drop zone is one directory, so
      // another agent running the CLI mid-build swaps the source out from under
      // the compiler. That produced three red lines that were green on a re-run
      // with nothing changed — the worst kind of test, one that lies both ways.
      // So: generate, build, and check the source is still OURS. If it is not,
      // retry once; if it still is not, SKIP with the reason. "Somebody else
      // overwrote the thing I was compiling" is not a pass and not a failure —
      // it is a check that did not get to run, and the runner counts those.
      let attempt = 0, r, c, h, before;
      for (;;) {
        ({ c, h } = generate(fixture));
        before = dropZoneState();

        // Before spending a compiler on it: is this actually a configuration, or
        // is it the empty one that proved nothing last time?
        const inits = (c.match(/GPIO_Init\(GPIO[A-Z],/g) || []).length;
        assert.ok(inits >= 3,
          `${fixture.file} generated only ${inits} GPIO_Init() call(s). A fixture that assigns no pins `
          + 'compiles trivially and proves nothing — regenerate it with node tests/fixtures/make_fixtures.js');

        r = build(fixture.env);
        if (dropZoneState() === before) break;
        if (++attempt >= 2) {
          skip(`another agent rewrote data/firmware/lib/wchcube_generated/ while ${fixture.env} was `
            + 'building, twice. The compile did not run on the code this test generated, so it '
            + 'proves nothing either way. Re-run when the tree is quiet.');
        }
      }

      assert.equal(r.status, 0,
        `pio run -e ${fixture.env} failed on ${fixture.file}.\n`
        + 'This is the gate working: the generated C does not compile against the real SDK.\n'
        + whyItFailed(r.out));
      assert.match(r.out, /SUCCESS/, `pio reported no SUCCESS for ${fixture.env}:\n${whyItFailed(r.out)}`);
      // A build that never compiled the generated file would "succeed" while
      // proving nothing, which is the failure mode this whole test exists for.
      const obj = generatedObject(fixture.env);
      assert.ok(obj, `pio succeeded but produced no wchcube_init.o for ${fixture.env} — `
        + 'the generated source was not part of the build');
      assert.ok(fs.statSync(obj).size > 0, `wchcube_init.o for ${fixture.env} is empty`);
      assert.includes(h, '#ifndef WCHCUBE_INIT_H', 'the generated header lost its include guard');
    } finally {
      restoreDropZone(saved);
    }
  });
}

// ---------------------------------------------------------------- regressions
// The two round-3 P0 defects, as tests rather than as a fixed line of YAML. Both
// are checked against the SDK that is actually installed, so they stay true when
// the EVT drop replaces it.
const SDK = path.join(process.env.USERPROFILE || process.env.HOME || '', '.platformio', 'packages', 'framework-wch-noneos-sdk');

/**
 * The SPL headers for one part, and where they were read from.
 *
 * Precedence is `data/sources/README.md`'s: **EVT package → the installed
 * framework-wch-noneos-sdk**. The EVT drop is what WCH shipped for this exact
 * part; the PlatformIO package is the same library at whatever version the
 * platform happens to pin, and they are NOT identical — the V006 drop carries
 * StdPeriph sub-version 0x05 against the package's 0x04 and corrects two macro
 * values. Checking names against the lower authority when the higher one is on
 * disk would be the round's own rule broken by its own gate.
 *
 * Returns { files: {name -> text}, from: '<a path>' } or null if neither exists.
 */
function splHeaders(part) {
  const series = { CH32V005: 'ch32v00Xx', CH32V006: 'ch32v00Xx', CH32X035: 'ch32x035' }[part];
  const evtPart = { CH32V005: 'V006', CH32V006: 'V006', CH32X035: 'X035' }[part];
  const places = [];
  if (evtPart) places.push(path.join(ROOT, 'data', 'sources', evtPart, 'Evt', 'EXAM', 'SRC', 'Peripheral', 'inc'));
  if (series) places.push(path.join(SDK, 'Peripheral', series, 'inc'));
  for (const inc of places) {
    if (!fs.existsSync(inc)) continue;
    const files = {};
    for (const f of fs.readdirSync(inc)) {
      if (f.endsWith('.h')) files[f] = fs.readFileSync(path.join(inc, f), 'utf8');
    }
    if (Object.keys(files).length) return { files, from: path.relative(ROOT, inc).replace(/\\/g, '/') };
  }
  return null;
}

test('the header the generated C includes is a file that exists in the SPL for that part', () => {
  const bad = [], saved = saveDropZone();
  let checked = 0;
  try {
    for (const fixture of FIXTURES) {
      const spl = splHeaders(fixture.mcu);
      if (!spl) continue;
      checked++;
      const { h } = generate(fixture);
      const m = h.match(/#include\s+"([^"]+\.h)"/);
      assert.ok(m, `${fixture.file}: the generated header includes no SPL header at all`);
      // Case matters: `ch32v00x.h` is the CH32V003 header and `ch32v00X.h` is
      // this one. NTFS hides the difference and the build passes anyway — which
      // is precisely why this check exists next to the build and not instead of
      // it. A Linux CI job fails outright on the wrong case.
      const names = Object.keys(spl.files);
      if (!names.includes(m[1])) {
        const near = names.filter(n => n.toLowerCase() === m[1].toLowerCase());
        bad.push(`${fixture.mcu}: includes "${m[1]}", which is not a file in ${spl.from}`
          + (near.length ? ` — did you mean "${near[0]}"? The difference is case, and Linux cares.` : ''));
      }
    }
  } finally {
    restoreDropZone(saved);
  }
  if (!checked) skip(`no SPL headers found for any fixture part — neither data/sources/<PART>/Evt/ nor ${SDK}`);
  assert.empty(bad, 'generated C includes a header this part does not have');
});

/**
 * The two GPIO enums, checked by one loop rather than by two copies.
 *
 * `GPIOSpeed_TypeDef` gave round 3 its second P0 — `GPIO_Speed_50MHz` on a part
 * whose only member is 30 MHz. CH32X035 then turned out to have the identical
 * problem one field over: its `GPIOMode_TypeDef` has SIX members and **no
 * open-drain at all**, so `GPIO_Mode_Out_OD` and `GPIO_Mode_AF_OD` do not exist
 * on it. Writing this as a table rather than as a second copy of the speed check
 * is the difference between fixing an instance and fixing the class.
 */
const GPIO_ENUMS = [
  { prefix: 'GPIO_Speed_', enumName: 'GPIOSpeed_TypeDef' },
  { prefix: 'GPIO_Mode_', enumName: 'GPIOMode_TypeDef' },
];

test('every GPIO_Speed_* and GPIO_Mode_* the generated C names exists in that part\'s enums', () => {
  const bad = [], saved = saveDropZone();
  let checked = 0;
  try {
    for (const fixture of FIXTURES) {
      const spl = splHeaders(fixture.mcu);
      if (!spl) continue;
      const gpioH = Object.entries(spl.files).find(([n]) => /_gpio\.h$/.test(n));
      if (!gpioH) { bad.push(`${fixture.mcu}: no *_gpio.h in ${spl.from}`); continue; }
      const { c } = generate(fixture);
      for (const { prefix, enumName } of GPIO_ENUMS) {
        const re = new RegExp(prefix + '\\w+', 'g');
        // Members read out of the header rather than remembered. Taken from the
        // whole file rather than from inside the enum block, because the SDK
        // also spells some of these as #defines — a name that appears anywhere
        // in the part's own gpio header is a name that will compile.
        const known = new Set(gpioH[1].match(re) || []);
        if (!known.size) {
          bad.push(`${fixture.mcu}: no ${prefix}* members at all in ${spl.from}/${gpioH[0]} (${enumName})`);
          continue;
        }
        checked++;
        for (const used of new Set(c.match(re) || [])) {
          if (!known.has(used)) {
            bad.push(`${fixture.mcu}: generated C names ${used}, which is not in ${enumName}. `
              + `${spl.from}/${gpioH[0]} declares only ${[...known].sort().join(', ')}`);
          }
        }
      }
    }
  } finally {
    restoreDropZone(saved);
  }
  if (!checked && !bad.length) skip(`no SPL headers found for any fixture part — neither data/sources/<PART>/Evt/ nor ${SDK}`);
  assert.empty(bad, 'generated C names a GPIO mode or speed this part does not have');
});

test('the compile gate builds each fixture for the part it claims, not a family default', () => {
  if (!pio.ok) skip(pio.why);
  // `ch32v00X.h` selects the part from a `#if !defined(...)` block whose FIRST
  // branch is CH32V002. If the build did not define the part, everything would
  // still compile — as a different chip, with a different peripheral set. "It
  // compiles" has to mean "it compiles for this part".
  const bad = [];
  for (const fixture of FIXTURES) {
    const r = spawnSync(pio.cmd[0], [...pio.cmd.slice(1), 'run', '-e', fixture.env, '-t', 'idedata'], {
      cwd: FW, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, PLATFORMIO_BUILD_DIR: GATE_BUILD_DIR },
    });
    if (r.status !== 0) { bad.push(`${fixture.env}: pio run -t idedata failed`); continue; }
    const json = (r.stdout || '').slice((r.stdout || '').indexOf('{'), (r.stdout || '').lastIndexOf('}') + 1);
    let defines = [];
    try { defines = JSON.parse(json).defines || []; }
    catch { bad.push(`${fixture.env}: could not read the build's defines from idedata`); continue; }
    if (!defines.includes(fixture.mcu)) {
      bad.push(`${fixture.env} compiles without -D${fixture.mcu}; the SPL header would fall back to `
        + `its first branch (CH32V002). Defines seen: ${defines.filter(d => /CH32/.test(d)).join(', ') || '(none)'}`);
    }
  }
  assert.empty(bad, 'a compile-gate environment does not define the part it is supposed to be');
});

// ---------------------------------------------------------------- the fixtures
test('the checked-in fixtures still match what the engine produces', () => {
  const r = spawnSync(process.execPath, [path.join(HERE, 'fixtures', 'make_fixtures.js'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0,
    'the compile-gate fixtures are stale — the MCU data or the engine moved under them.\n'
    + 'Regenerate and review the diff:  node tests/fixtures/make_fixtures.js\n' + (r.stdout || '') + (r.stderr || ''));
});

test('every fixture configures something a default project would not', () => {
  const bad = [];
  for (const f of FIXTURES) {
    const text = fs.readFileSync(path.join(HERE, 'fixtures', f.file), 'utf8');
    const pins = (text.match(/^ {2}P[A-D]\d+: GPIO_/gm) || []).length;
    if (pins < 3) bad.push(`${f.file}: ${pins} manual GPIO pin(s); a fixture with no pins generates an empty init`);
    if (!/^ +params:$/m.test(text)) bad.push(`${f.file}: no params: block, so no *_InitTypeDef field is exercised`);
    if (!f.env) bad.push(`${f.file}: names no PlatformIO environment, so it can never be compiled`);
  }
  assert.empty(bad, 'a compile-gate fixture does not exercise enough to be worth compiling');
});

// ---------------------------------------------------------------- TODO / #error
/**
 * TODO kinds that are a known DATA gap someone owns, with the backlog line.
 *
 * codegen deliberately emits an explicit TODO rather than plausible-looking
 * register code when the MCU file lacks an encoding — `PROGRESS.md` §8 records
 * that as a decision, and it is the right one: wrong bits are worse than absent
 * bits. So a TODO is not a codegen bug, it is a data gap that has reached the
 * user's output, and it belongs to whoever owns the data.
 *
 * A TODO matching one of these prints and does not fail. **Anything else fails**,
 * which is the point: a new KIND of TODO is a new gap nobody has looked at, and
 * that is exactly what this gate is for. Each entry is checked against TASKS.md,
 * so a kind cannot stay excused after its backlog line is closed or deleted.
 */
const TRACKED_TODOS = [
  {
    match: /no sdk_enabled\/sdk_disabled macro/,
    owner: 'AGENT-1',
    task: '`params:` carry `struct:` and `field:` so codegen does not infer the SDK mapping',
    why: 'a bool parameter needs the two macros the SDK spells it with; the MCU file gives neither',
  },
  {
    match: /nothing applies this struct/,
    owner: 'AGENT-1',
    task: '`params:` carry `struct:` and `field:` so codegen does not infer the SDK mapping',
    why: 'the init struct is filled but the MCU file names no `*_Init()` to hand it to',
  },
  {
    match: /has no channels: map/,
    owner: 'AGENT-1',
    task: '`peripherals.<TIM>.channel_params` needs a `channels:` map',
    why: 'TIM_OCInitTypeDef is filled per CHANNEL and codegen cannot work out which channels a '
      + 'configuration uses from the settings alone, so it declines to guess. Found by this gate '
      + 'minutes after the emitter landed',
  },
  {
    match: /is applied by \w+\(\), not by an init struct/,
    owner: 'AGENT-1',
    task: '`params:` carry `struct:` and `field:` so codegen does not infer the SDK mapping',
    why: 'the parameter is set by a call rather than a struct field, and the MCU file does not say which call',
  },
];

test('generated C contains no TODO or #error that is not a tracked data gap', async () => {
  // `agents/DONE.md` has asked for zero TODOs since round 1, and round 3 repeats
  // it. cComplaints() reads back what the generator just wrote, in the two
  // spellings it writes: `#error "..."` at the start of a line, and `/* TODO: `.
  const eng = await import('../app/engine/index.js');
  const yamlSrc = fs.readFileSync(path.join(ROOT, 'app', 'vendor', 'js-yaml.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', yamlSrc)(mod, mod.exports);
  eng.setYaml(mod.exports);
  eng.loadPackages(eng.yamlLoad(fs.readFileSync(path.join(ROOT, 'data', 'packages', 'packages.yaml'), 'utf8')));
  const dir = path.join(ROOT, 'data', 'mcus');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yaml')).sort()) {
    eng.registerMcuFile(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  if (typeof eng.cComplaints !== 'function') skip('app/engine/codegen.js exports no cComplaints() yet');

  const tasks = fs.readFileSync(path.join(ROOT, 'TASKS.md'), 'utf8');
  const untracked = [], tracked = new Map(), stale = [];

  for (const fixture of FIXTURES) {
    eng.projectApply(fs.readFileSync(path.join(HERE, 'fixtures', fixture.file), 'utf8'));
    eng.compute();
    for (const c of eng.cComplaints()) {
      const where = `${fixture.file} → ${c.file}:${c.line}`;
      // An `#error` is never excused: it is codegen refusing to emit at all, and
      // it does not compile. Only a TODO can be a tracked gap.
      const hit = c.kind === 'todo' && TRACKED_TODOS.find(t => t.match.test(c.text));
      if (!hit) { untracked.push(`${where} ${c.kind.toUpperCase()}: ${c.text}`); continue; }
      if (!tasks.includes(hit.task)) {
        stale.push(`${where}: excused by ${hit.owner}'s task "${hit.task}", which is no longer in TASKS.md`);
        continue;
      }
      const key = `${hit.owner}: ${hit.task} — ${hit.why}`;
      tracked.set(key, (tracked.get(key) || 0) + 1);
    }
  }

  if (tracked.size) {
    process.stdout.write(`        ${[...tracked.values()].reduce((a, b) => a + b, 0)} TODO(s) in generated C, all tracked data gaps:\n`);
    for (const [k, n] of [...tracked].sort()) process.stdout.write(`          - ${n}x  ${k}\n`);
  }
  assert.empty(stale, 'TODOs excused by a backlog line that no longer exists');
  assert.empty(untracked,
    'generated C explains what it could not do instead of doing it, and this KIND of gap is not '
    + 'tracked by anyone. Either fix the data or add it to TRACKED_TODOS with its TASKS.md line');
});

test('the GPIO enum check can actually catch a macro this part does not have', () => {
  // The check above is green, and it is worth being precise about WHY: the
  // CH32X035 fixture does not select an open-drain mode, so `GPIO_Mode_Out_OD`
  // never reaches the generated C even though `gpio.modes` currently offers it.
  // That is the honest limit of an output-side check — it only sees macros a
  // configuration actually uses — and it is exactly why `verify_sdk_names.py`
  // checks the DATA as well, whether or not anything emits it yet.
  //
  // So rather than leave "it passed" ambiguous, plant the macro and insist the
  // comparison bites. Same argument as the wrong-case header: a check that
  // cannot go red is not a pass.
  const spl = splHeaders('CH32X035') || splHeaders('CH32V006');
  if (!spl) skip('no SPL headers on this machine, so the comparison cannot be exercised');
  const gpioH = Object.entries(spl.files).find(([n]) => /_gpio\.h$/.test(n));
  assert.ok(gpioH, `no *_gpio.h in ${spl.from}`);

  const known = new Set(gpioH[1].match(/GPIO_Mode_\w+/g) || []);
  assert.ok(known.size >= 4, `only ${known.size} GPIO_Mode_* in ${gpioH[0]} — the header format changed`);

  const planted = 'GPIO_Mode_Out_NONSENSE_OD';
  assert.notOk(known.has(planted), 'the planted macro is somehow real, so this test proves nothing');
  const fakeC = `GPIO_InitStructure.GPIO_Mode = ${planted};\n`;
  const caught = [...new Set(fakeC.match(/GPIO_Mode_\w+/g) || [])].filter(u => !known.has(u));
  assert.deep(caught, [planted], 'the comparison did not flag a macro absent from the header');

  // And the inverse: a macro that IS in the header must not be flagged.
  const real = [...known][0];
  const falsePositives = [...new Set(`x = ${real};`.match(/GPIO_Mode_\w+/g) || [])].filter(u => !known.has(u));
  assert.deep(falsePositives, [], `${real} is in ${gpioH[0]} but the comparison flagged it`);
});
