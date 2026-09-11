// Headless smoke test — the "does it actually run" gate.
//
// For every MCU x every package: load it, switch to the package, click five pins,
// assign something, and assert the console stayed completely silent.  This is the
// check behind the DONE.md line "zero console errors/warnings on load for every
// MCU x every package".
const { suite, test, assert } = require('./lib/harness');
const { boot } = require('./lib/app');

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
function walk(mcuName, onProblem) {
  const a = boot();
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
