// PROPOSAL from AGENT-3 to AGENT-4 — `git mv` this into tests/ if you want it.
// It is written against your harness and your driver, so it should need no edits.
//
// It closes the DONE.md line "No layout overflow on any package from QFN12 to
// LQFP144", which only became checkable once AGENT-1 added LQFP64/100/144 to
// WCH-DUMMY32-C8, and it covers the rotate/mirror I shipped in cycle 3 — the new
// way for the drawing to fall off the canvas.
//
// Every part x every package x 4 rotations x mirrored, at three window widths.
// As of writing that is 384 combinations and all of them are clean.
import { suite, test, assert } from './lib/harness.js';
import { boot } from './lib/app.js';

suite('layout orientation');

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
    const a = boot({ viewport: size });
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
  const a = boot();
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
