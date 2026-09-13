// Every part x every package x 4 rotations x mirrored, at three window widths.
// Landed 2026-09-13 (AGENT-3): written as a proposal for AGENT-4, who no longer
// exists, and sat in `agents/proposals/` unrun ("a proposed test nobody owns is
// a check that reads as done and is not" - STATUS.md §7). `git mv`d into tests/
// - the harness and driver it was written against (`tests/lib/harness.js`,
// `tests/lib/app.js`) are still exactly this shape - and run for the first
// time, which is where the ONE real edit came from:
//
// `a.mcuNames` is `Object.keys(MCU_FILES)` inside a booted REAL `dist/index.html`,
// which never contains the synthetic `WCH-DUMMY32-C8` - it "must never appear in
// the app's part list or in the built bundle" (`app/tests/_harness.js`). So as
// written, this test's own "covers the whole QFN12..LQFP144 range" claim was
// false: it iterated only the SIX SHIPPED PARTS' packages, none of which reaches
// past ~129 pins, and the file's own sanity check (below) caught that the first
// time it ran - "the largest bundled package has 129 pins; the DONE line asks
// for 144". Some earlier harness this was written against must have registered
// the fixture into `boot()` automatically; today's does not, on purpose. Fixed
// by registering the fixture's own YAML text into the booted page before
// reading `a.mcuNames` - the same `registerMcuFile()` pattern `tests/layout.test.js`
// already uses for its QFN128 synthesis - so the dummy's LQFP64/100/144 (and
// QFN12-class TSSOP20/QFN20) packages are actually exercised, not merely named
// in a comment.
//
// It closes the old DONE.md line "No layout overflow on any package from QFN12
// to LQFP144", which only became checkable once AGENT-1 added LQFP64/100/144 to
// WCH-DUMMY32-C8, and it covers the rotate/mirror shipped in round 3 - the new
// way for the drawing to fall off the canvas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, test, assert } from './lib/harness.js';
import { boot } from './lib/app.js';

suite('layout orientation');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DUMMY_YAML = fs.readFileSync(
  path.join(ROOT, 'tests', 'fixtures', 'mcus', 'WCH-DUMMY32-C8.yaml'), 'utf8');

/** Register the size-stress fixture into a freshly booted page, so `a.mcuNames`
 *  covers it alongside the six shipped parts - it never ships in `dist/index.html`. */
function withDummyRegistered(a) {
  a.window.eval(`registerMcuFile(${JSON.stringify(DUMMY_YAML)})`);
  return a;
}

const SIZES = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1440', width: 2560, height: 1440 },
];

// Labels on one side of the package must not land on top of each other. 18px is
// the smallest gap the 10.5px label font stays readable at.
const MIN_LABEL_GAP = 18;

// Everything the check needs, measured inside the page in one go.
const MEASURE = `(() => {
  const b = rootBox();
  const bySide = {};
  for (const p of geom.pins) (bySide[p.side] ||= []).push(p);
  let tooClose = 0;
  for (const list of Object.values(bySide)) {
    const vert = list[0].side === 1 || list[0].side === 3;
    const at = list.map(p => (vert ? p.x : p.y)).sort((x, y) => x - y);
    for (let i = 1; i < at.length; i++) if (at[i] - at[i - 1] < ${MIN_LABEL_GAP}) tooClose++;
  }
  return {
    width: Math.round(b.width), height: Math.round(b.height),
    pins: geom.pins.length,
    drawn: document.querySelectorAll('#svg .pin').length,
    zoom: +S.zoom.toFixed(3),
    tooClose,
  };
})()`;

for (const size of SIZES) {
  test(`every package draws whole at ${size.name}, in all four rotations and mirrored`, () => {
    const a = withDummyRegistered(boot({ viewport: size }));
    const bad = [];
    try {
      for (const mcu of a.mcuNames) {
        a.ev(`openMcu(MCU_FILES[${JSON.stringify(mcu)}])`);
        for (const pkg of a.packages) {
          a.ev(`setPackage(${JSON.stringify(pkg)}); syncMcuUi(); renderAll(true);`);
          for (const rot of [0, 1, 2, 3]) {
            for (const flip of [false, true]) {
              a.ev(`setOrientation({ rot: ${rot}, flip: ${flip} })`);
              const r = a.ev(MEASURE);
              const where = `${mcu} ${pkg} rot${rot * 90}${flip ? '+mirrored' : ''}`;
              if (r.drawn !== r.pins) bad.push(`${where}: drew ${r.drawn} of ${r.pins} pins`);
              if (r.tooClose) bad.push(`${where}: ${r.tooClose} label pair(s) under ${MIN_LABEL_GAP}px apart`);
              if (!(r.zoom > 0.02)) bad.push(`${where}: fit collapsed the zoom to ${r.zoom}`);
              if (!(r.width > 0 && r.height > 0)) bad.push(`${where}: drawing measured ${r.width}x${r.height}`);
            }
          }
        }
      }
      assert.empty(bad, `layout problems at ${size.name}`);
      assert.empty(a.errors.map(e => `${e.level}: ${e.text}`), `console output at ${size.name}`);
    } finally {
      a.close();
    }
  });
}

test('the big packages really are in the fixture, so this test means something', () => {
  const a = withDummyRegistered(boot());
  try {
    const seen = new Set();
    for (const mcu of a.mcuNames) {
      a.ev(`openMcu(MCU_FILES[${JSON.stringify(mcu)}])`);
      for (const pkg of a.packages) seen.add(a.ev(`Object.keys(M._phys[${JSON.stringify(pkg)}]).length`));
    }
    const biggest = Math.max(...seen);
    assert.ok(biggest >= 144, `the largest bundled package has ${biggest} pins; the DONE line asks for 144`);
  } finally {
    a.close();
  }
});
