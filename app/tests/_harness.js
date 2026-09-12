// Tiny zero-dependency test harness. Node's own assert does the checking; this
// only collects tests and loads fixtures. Run everything with `node tests/run.js`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as eng from '../engine/index.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export { eng };
export { default as assert } from 'node:assert/strict';

// The vendored js-yaml is a UMD bundle; load it as CommonJS without a bundler.
function loadVendorYaml() {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'vendor', 'js-yaml.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
}
export const jsyaml = loadVendorYaml();
eng.setYaml(jsyaml);

export const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Every MCU file the engine tests can load: the real parts the app ships, plus the
 * synthetic fixture that only the tests use.
 *
 * `WCH-DUMMY32-C8` lives in `tests/fixtures/mcus/` rather than `data/mcus/` on purpose.
 * It is not silicon and it must never appear in the app's part list or in the built
 * bundle — but it is the only fixture that reaches LQFP100/LQFP144, that has THREE GPIO
 * speeds, that uses a different NVIC priority scheme, and that spells the HSE pins
 * `OSC_IN`/`OSC_OUT` instead of `XI`/`XO`, which is what proves the HSE coupling is read
 * from the data rather than hardcoded. Deleting it would delete all four of those.
 */
const MCU_DIRS = ['data/mcus', 'tests/fixtures/mcus'];
const mcuDirOf = name => MCU_DIRS.find(d => fs.existsSync(path.join(ROOT, d, `${name}.yaml`))) || MCU_DIRS[0];
export const mcuFiles = () => MCU_DIRS.flatMap(d => {
  const dir = path.join(ROOT, d);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).map(f => path.join(d, f));
});

/**
 * The name of every part these tests can load, from the FILES rather than from the
 * engine's registry.
 *
 * `eng.MCU_FILES` is process-wide and `registerMcuFile()` only ever adds to it, so a
 * test that registers a synthetic part (every `withFile`-style helper here does) leaves
 * it there for every later test. A loop over `Object.keys(eng.MCU_FILES)` therefore
 * depends on which tests ran before it, and `fresh('CH32V006-TWOSTRUCTS')` throws ENOENT
 * on a part that was never a file - measured, in this suite, on 2026-09-12. Use this.
 */
export const mcuNames = () => mcuFiles().map(f => path.basename(f, '.yaml'));

let packagesLoaded = false;
// Fresh engine state: real package library, real MCU file, optional package.
// MCU_FILES is a process-wide registry, so clear it first — otherwise a test
// that registers a synthetic part leaks it into every later test.
export function fresh(mcu = 'CH32V006', pkg) {
  if (!packagesLoaded) { eng.loadPackages(read('data/packages/packages.yaml')); packagesLoaded = true; }
  for (const k of Object.keys(eng.MCU_FILES)) delete eng.MCU_FILES[k];
  for (const f of mcuFiles()) eng.registerMcuFile(read(f));
  eng.loadMcu(read(path.join(mcuDirOf(mcu), `${mcu}.yaml`)));
  if (pkg) eng.setPackage(pkg);
  // THE PROJECT IS STATE TOO, AND `fresh` DID NOT RESET IT. Reloading the MCU clears pins,
  // settings and the engine result, so `fresh()` reads as "a clean slate" - but the PROJECT
  // (its chosen variant, its generator options) lives beside the MCU and survived, which made
  // one test's leftover everybody else's starting condition.
  //
  // Neither half was hypothetical, and both showed the same worst-case symptom: GREEN under
  // the file's own filter, RED in the full run, on both CI runners, with nothing in the
  // failure naming the cause.
  //
  //   variant  an earlier test picks a CH32X035 part number; `fresh('CH32V006')` reloads the
  //            MCU and leaves it, so `projectFiles()` throws `"CH32X035F7P6" is not a part
  //            number of CH32V006` inside a test about BoardPins.h.
  //   options  `export.test.js` sets `pin_map: false` and never puts it back; files run in
  //            alphabetical order, so `pinmap.test.js` then finds no BoardPins.h in the
  //            project it had just asked for.
  //
  // Resetting both is cheaper than auditing who restores what, and it is what "fresh" already
  // claimed to mean. The history is cleared LAST because these resets are ordinary mutators
  // that record undo steps - without that, `a new part starts with an empty history` fails,
  // which is how the first version of this fix announced itself.
  eng.setProject({ variant: null });
  // Options are CLEARED rather than set to their defaults. `generatorOption()` falls back to
  // the declared default when a key is absent, and `projectSerialize()` writes only the keys
  // that are present - so setting them explicitly produces a state that does not survive its
  // own round-trip, and `a project round-trips through YAML with no loss` fails with
  // `options: {}` against `options: {…}`. Absent IS the default; that is the clean slate.
  const opts = (eng.S.project || {}).options;
  if (opts) for (const k of Object.keys(opts)) delete opts[k];
  eng.compute();
  eng.clearHistory();
  return eng;
}

// Deterministic PRNG so a failing fuzz case can be replayed from its seed.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// Sets are not JSON; make the whole state comparable.
export function snapshot(S) {
  return JSON.parse(JSON.stringify(S, (k, v) => (v instanceof Set ? [...v].sort() : v)));
}

const registry = [];
export function test(name, fn) { registry.push({ name, fn }); }
export function collected() { return registry; }
export function currentFile(url) { return path.relative(ROOT, fileURLToPath(url)).replace(/\\/g, '/'); }
