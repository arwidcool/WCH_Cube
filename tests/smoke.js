// Headless smoke test — the "does it actually run" gate.
//
// For every MCU x every package: load it, switch to the package, click five pins,
// assign something, and assert the console stayed completely silent.  This is the
// check behind the DONE.md line "zero console errors/warnings on load for every
// MCU x every package".
import { suite, test, assert } from './lib/harness.js';
import { boot } from './lib/app.js';

suite('smoke (every MCU x every package)');

// Deterministic "random" so a failure is reproducible from the seed alone.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PINS_PER_PACKAGE = 5;

// One jsdom window per MCU (booting is the slow part), every package inside it.
function walk(mcuName, onProblem, html) {
  // `html`: an alternative page to boot - used ONLY by the planted break below, which hands
  // in a mutated copy of dist/index.html so the sweep can be seen refusing a broken page.
  const a = boot(html ? { html } : undefined);
  try {
    a.loadMcu(mcuName);
    const packages = a.packages;
    for (const pkg of packages) {
      const where = `${mcuName} / ${pkg}`;
      a.clearProblems();
      try {
        a.setPackage(pkg);
      } catch (e) {
        onProblem(`${where}: package switch threw — ${e.message}`);
        continue;
      }

      const drawn = a.pinEls().length;
      const expected = Object.keys(a.M.packages[pkg]).filter(n => n !== '0').length;
      if (drawn === 0) onProblem(`${where}: nothing drawn (0 pins)`);
      else if (drawn !== expected) onProblem(`${where}: drew ${drawn} pins, package map has ${expected}`);

      for (const p of a.problems()) onProblem(`${where} [on switch]: ${p}`);
      a.clearProblems();

      // click five pins, take an option where the picker offers one
      const names = a.pinNames();
      const rnd = rng(0xC0FFEE + pkg.length * 31 + mcuName.length);
      for (let i = 0; i < PINS_PER_PACKAGE && names.length; i++) {
        const pin = names[Math.floor(rnd() * names.length)];
        try {
          a.clickPin(pin);
          const opts = a.pickerOptions();
          if (opts.length) {
            const usable = opts.filter(o => !o.data.reset && !o.na);
            if (usable.length) a.pick(usable[Math.floor(rnd() * usable.length)]);
          }
          a.key('Escape');
        } catch (e) {
          onProblem(`${where}: clicking ${pin} threw — ${e.message}`);
        }
        for (const p of a.problems()) onProblem(`${where} [pin ${pin}]: ${p}`);
        a.clearProblems();
      }

      // the engine must still be coherent after all that poking
      try {
        a.window.renderAll();
      } catch (e) {
        onProblem(`${where}: renderAll() threw after edits — ${e.message}`);
      }
      for (const p of a.problems()) onProblem(`${where} [after edits]: ${p}`);
      a.clearProblems();
    }
  } finally {
    a.close();
  }
}

// Discover the MCU list from a throwaway window, then give each its own test.
// ---------------------------------------------------------------------------------------
//  Planted break - round 6, deliverable B. The sweep below reports a package that draws no
//  pins. Hand `walk()` a copy of the built page whose renderer emits the pin class under a
//  different name - the page still boots and still draws, but `#svg .pin` matches nothing -
//  and every package of one part must come back as "nothing drawn (0 pins)"; then the real
//  page must walk clean. (The first version of this plant renamed the chip CONTAINER instead,
//  and the app threw at boot - `innerHTML` on null - which escapes walk() before the check
//  it was meant to trip. A plant has to break the thing the check measures, not the page.)
//  Dynamic imports so this file's own import list is not touched; the tree is not touched
//  either - `withMutantDist` writes the copy to a temp folder.
// ---------------------------------------------------------------------------------------
test('planted break: a page that draws no chip is reported by the sweep for every package', async () => {
  const { withMutantDist } = await import('./lib/mutant.js');
  const fs = await import('node:fs');
  const m = withMutantDist("let cls = 'pin ' + (t === 'io' ? 'io' : t);", "let cls = 'pinx ' + (t === 'io' ? 'io' : t);");
  assert.notOk(m.error, m.error || '');
  const part = 'CH32V006';
  const problems = [];
  walk(part, p => problems.push(p), fs.readFileSync(m.file, 'utf8'));
  const drewNothing = problems.filter(p => /nothing drawn \(0 pins\)/.test(p));
  assert.ok(drewNothing.length >= 1, `the sweep did not report the empty chip; problems were:\n${problems.join('\n') || '(none)'}`);
  console.log(`      planted refusal (smoke sweep): ${drewNothing[0]}`);
  const clean = [];
  walk(part, p => clean.push(p));
  assert.empty(clean, 'the real page walks with problems, so the plant could not be attributed');
});

const MCUS = (() => {
  const a = boot();
  try { return a.mcuNames; } finally { a.close(); }
})();

test('app boots with a silent console', () => {
  const a = boot();
  try {
    assert.empty(a.problems(), 'console output on first load');
    assert.ok(a.M, 'an MCU is loaded at startup');
    assert.ok(a.pinEls().length > 0, 'pins are drawn at startup');
  } finally { a.close(); }
});

for (const name of MCUS) {
  test(`${name}: every package loads, draws and survives clicking`, () => {
    const problems = [];
    walk(name, p => problems.push(p));
    assert.empty(problems, `${name} produced problems`);
  });
}
