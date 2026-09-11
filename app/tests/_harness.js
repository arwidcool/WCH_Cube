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
export const mcuFiles = () => fs.readdirSync(path.join(ROOT, 'data', 'mcus'))
  .filter(f => f.endsWith('.yaml'))
  .map(f => path.join('data', 'mcus', f));

let packagesLoaded = false;
// Fresh engine state: real package library, real MCU file, optional package.
// MCU_FILES is a process-wide registry, so clear it first — otherwise a test
// that registers a synthetic part leaks it into every later test.
export function fresh(mcu = 'CH32V006', pkg) {
  if (!packagesLoaded) { eng.loadPackages(read('data/packages/packages.yaml')); packagesLoaded = true; }
  for (const k of Object.keys(eng.MCU_FILES)) delete eng.MCU_FILES[k];
  for (const f of mcuFiles()) eng.registerMcuFile(read(f));
  eng.loadMcu(read(`data/mcus/${mcu}.yaml`));
  if (pkg) eng.setPackage(pkg);
  eng.compute();
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
