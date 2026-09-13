// tests/perf.test.js — a perf suite, because there was not one.
//
// A per-test budget already exists (tests/run.js prints `[NNNN ms]` on anything over
// 250ms), but that is a DISPLAY, not a gate: nobody fails a build over it, and nobody
// would notice `compute()` or a render creeping up 5% a cycle until it was already
// slow enough to complain about. This file is the actual gate: `compute()` and a full
// `renderAll()` on the LARGEST REAL package, timed for real, with the numbers stated
// rather than only pass/fail — round 4's own defect is a threshold nobody could
// reproduce, and repeating that mistake here would be the same defect one file over.
//
// "Largest real package" is derived, not hardcoded: the biggest `_phys[pkg]` across
// every part in `data/mcus/` (never the `WCH-DUMMY32-C8` size-stress fixture — this
// suite asks what a real user's machine actually has to do, and nobody ships that
// part). Today that is CH32H417 / QFN128, 129 pads; if a bigger part lands, this
// suite re-targets itself rather than going stale silently.
//
// Two measurements, two different honesty limits:
//   - `compute()` is timed in Node, headless, exactly what runs on every setSetting()/
//     assignSignal() a user makes. The number is real.
//   - `renderAll()` is timed inside jsdom (`tests/lib/app.js`'s `boot()`), which has
//     NO LAYOUT ENGINE — `getBoundingClientRect()` is faked (see boot()'s own
//     comment), so this is the cost of building the DOM/SVG tree and NOTHING about
//     paint or real layout. It is still the dominant, measurable cost the engine
//     controls, and it is the honest number to report: a REAL browser's paint time is
//     real-browser-suite territory (`tests/lib/browser.js`), not this file's job, and
//     claiming a jsdom number represents that would be exactly the false precision
//     this comment is here to refuse.
//
// Both measurements: several iterations, sorted, MEDIAN asserted (not max — a single
// GC pause spiking the max is not a regression, and a suite that asserts on max noise
// is the next round's "threshold nobody could reproduce"). min/p50/p95/max all printed
// either way, so a real regression shows up in the log before the threshold catches it.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { test, assert, fresh, eng, ROOT } from '../app/tests/_harness.js';
import { boot } from './lib/app.js';

const COMPUTE_BUDGET_MS = 5;
const RENDER_BUDGET_MS = 100;

/** Every real, shipped part's largest package — `WCH-DUMMY32-C8` excluded, the
 *  same filter `glossary.test.js`/`power.test.js` use for "a real part". */
function largestRealPackage() {
  let best = { mcu: null, pkg: null, pins: 0 };
  for (const f of fs.readdirSync(path.join(ROOT, 'data', 'mcus'))) {
    if (!f.endsWith('.yaml')) continue;
    const name = f.replace(/\.yaml$/, '');
    eng.loadMcu(name);
    for (const pkg of Object.keys(eng.M.packages)) {
      const n = Object.keys(eng.M._phys[pkg]).length;
      if (n > best.pins) best = { mcu: name, pkg, pins: n };
    }
  }
  return best;
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    min: sorted[0], p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted[sorted.length - 1],
  };
}

const fmt = s => `min ${s.min.toFixed(2)}ms  p50 ${s.p50.toFixed(2)}ms  p95 ${s.p95.toFixed(2)}ms  max ${s.max.toFixed(2)}ms`;

function machineLine() {
  const cpu = os.cpus()[0] || {};
  return `${cpu.model || 'unknown CPU'} x${os.cpus().length}, node ${process.version}, ${process.platform}/${process.arch}`;
}

test('compute() on the largest real package stays well under budget', () => {
  const e = fresh();
  const { mcu, pkg, pins } = largestRealPackage();
  assert.ok(mcu, 'no real part found under data/mcus/ - largestRealPackage() found nothing to measure');
  e.loadMcu(mcu);
  e.setPackage(pkg);

  for (let i = 0; i < 50; i++) e.compute();               // JIT warm-up, discarded
  const N = 200;
  const times = [];
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    e.compute();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const s = stats(times);
  console.log(`      machine: ${machineLine()}`);
  console.log(`      compute() on ${mcu} / ${pkg} (${pins} pads), ${N} runs: ${fmt(s)}`);
  assert.ok(s.p50 < COMPUTE_BUDGET_MS,
    `compute() median ${s.p50.toFixed(2)}ms exceeds the ${COMPUTE_BUDGET_MS}ms budget on ${mcu}/${pkg} (${fmt(s)})`);
});

test('a full render (jsdom, no layout engine) on the largest real package stays well under budget', () => {
  const { mcu, pkg, pins } = largestRealPackage();
  assert.ok(mcu, 'no real part found under data/mcus/ - largestRealPackage() found nothing to measure');

  const a = boot({ viewport: { width: 1920, height: 1080 } });
  try {
    a.loadMcu(mcu);
    a.setPackage(pkg);
    for (let i = 0; i < 5; i++) a.ev('renderAll(true)');   // warm-up, discarded

    const N = 30;
    const times = [];
    for (let i = 0; i < N; i++) {
      const t0 = process.hrtime.bigint();
      a.ev('renderAll(true)');
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    const s = stats(times);
    console.log(`      renderAll(true) on ${mcu} / ${pkg} (${pins} pads), jsdom, ${N} runs: ${fmt(s)}`);
    assert.deepEqual(a.problems(), [], 'renderAll() logged a console problem while being timed');
    assert.ok(s.p50 < RENDER_BUDGET_MS,
      `renderAll() median ${s.p50.toFixed(2)}ms exceeds the ${RENDER_BUDGET_MS}ms budget on ${mcu}/${pkg} (${fmt(s)}) - jsdom, not a real browser`);
  } finally {
    a.close();
  }
});
