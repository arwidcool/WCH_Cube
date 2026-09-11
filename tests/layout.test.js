// Layout regression against agents/reference/cubemx.png.
//
// Structural, not pixel: jsdom has no layout engine and Playwright will not install on
// this box, so instead of diffing images this locks in the SHAPE the reference shows -
// menu bar, breadcrumb, four navy tabs, then three columns (peripheral tree, mode and
// configuration, chip with its zoom bar). That is what actually regresses when someone
// reorganises the markup, and it is checked at both required viewport sizes.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { suite, test, assert } from './lib/harness.js';
import { boot, ROOT } from './lib/app.js';
import { yaml as yamlDep } from './lib/deps.js';

suite('layout');

const CLI = path.join(ROOT, 'tools', 'wchcube_cli.js');

const SIZES = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);

test('the frame is menu bar, breadcrumb, tab bar, views - in that order', () => {
  const a = boot();
  try {
    const top = [...a.document.querySelector('.app').children].map(el => el.className.split(' ')[0]);
    assert.deep(top.slice(0, 3), ['menubar', 'crumbs', 'tabs'], 'the chrome above the views is in the wrong order');
    assert.ok(top.includes('view'), 'no view panel');
  } finally { a.close(); }
});

test('the four CubeMX tabs are present, in order, with the first one active', () => {
  const a = boot();
  try {
    const tabs = [...a.document.querySelectorAll('.tabs .tab')];
    assert.deep(tabs.map(text), ['Pinout & Configuration', 'Clock Configuration', 'Project Manager', 'Tools']);
    assert.ok(tabs[0].classList.contains('active'), 'Pinout & Configuration should be the tab you land on');
  } finally { a.close(); }
});

test('the breadcrumb reads Home / part / project, with Generate Project on the right', () => {
  const a = boot();
  try {
    const crumbs = [...a.document.querySelectorAll('.crumbs .crumb')].map(text);
    assert.equal(crumbs[0], 'Home');
    assert.equal(crumbs[1], a.M.mcu.name, 'the second crumb should be the part');
    assert.match(crumbs[2], /\.wchproj/, 'the third crumb should be the project file');
    const gen = a.document.querySelector('.crumbs .gen');
    assert.ok(gen, 'the GENERATE PROJECT button is missing');
    assert.match(text(gen), /generate/i);
  } finally { a.close(); }
});

test('the pinout view is three columns: tree, centre, chip', () => {
  const a = boot();
  try {
    const cols = [...a.document.querySelector('#view-pinout').children]
      .map(el => el.className.split(' ')[0])
      .filter(c => c !== 'subbar');
    assert.deep(cols, ['tree', 'centre', 'chipwrap'], 'the three columns are missing or out of order');

    assert.ok(a.document.querySelector('.tree .search'), 'the peripheral search box is missing');
    assert.ok(a.document.getElementById('cats'), 'the category tree is missing');
    assert.ok(a.document.getElementById('ptitle'), 'the centre panel has no title');
    assert.ok(a.document.getElementById('mode'), 'the Mode panel is missing');
    assert.ok(a.document.querySelector('.centre .config'), 'the Configuration panel is missing');
    assert.ok(a.document.getElementById('canvas'), 'the chip canvas is missing');
    assert.ok(a.document.querySelector('.chipwrap .chipbar'), 'the zoom bar under the chip is missing');
    assert.ok(a.document.getElementById('svg'), 'the chip SVG is missing');
  } finally { a.close(); }
});

test('the peripheral tree is grouped under CubeMX-style category headings', () => {
  const a = boot();
  try {
    const cats = [...a.document.querySelectorAll('#cats .cat > button')].map(text);
    assert.ok(cats.length >= 3, `expected several categories, got ${cats.length}`);
    assert.includes(cats, 'System Core', 'CubeMX always leads with System Core');
    // every peripheral in the tree sits under a heading and shows a status marker
    const items = [...a.document.querySelectorAll('#cats .item')];
    assert.ok(items.length > 5, `expected the peripherals under the headings, got ${items.length}`);
    const noStatus = items.filter(el => !el.querySelector('.st')).map(el => el.dataset.p);
    assert.empty(noStatus, 'peripherals with no status marker');
  } finally { a.close(); }
});

for (const size of SIZES) {
  test(`at ${size.name} the chip is fitted inside its canvas`, () => {
    const a = boot({ viewport: size });
    try {
      const problems = [];
      for (const name of a.mcuNames) {
        a.loadMcu(name);
        for (const pkg of a.packages) {
          a.setPackage(pkg);
          a.window.fitChip();
          const { zoom, panX, panY } = a.S;
          const geom = a.ev('geom');
          const where = `${name} ${pkg}`;

          if (!Number.isFinite(zoom) || zoom <= 0) { problems.push(`${where}: zoom is ${zoom}`); continue; }
          const w = geom.W * zoom, h = geom.H * zoom;
          const slack = 1;
          if (w > size.width + slack) problems.push(`${where}: ${w.toFixed(0)}px wide in a ${size.width}px canvas`);
          if (h > size.height + slack) problems.push(`${where}: ${h.toFixed(0)}px tall in a ${size.height}px canvas`);
          if (panX < -slack || panY < -slack) problems.push(`${where}: not centred (pan ${panX.toFixed(0)},${panY.toFixed(0)})`);
        }
      }
      assert.empty(problems, `chip does not fit at ${size.name}`);
    } finally { a.close(); }
  });
}

test('nothing is drawn outside the chip drawing from the smallest package up to the largest', () => {
  const a = boot();
  const problems = [];
  let swept = 0;
  try {
    for (const name of a.mcuNames) {
      a.loadMcu(name);
      for (const pkg of a.packages) {
        a.setPackage(pkg);
        swept++;
        const geom = a.ev('geom');
        const where = `${name} ${pkg} (${a.pinEls().length} pins)`;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const r of a.document.querySelectorAll('#svg rect')) {
          const x = +r.getAttribute('x'), y = +r.getAttribute('y');
          const w = +r.getAttribute('width') || 0, h = +r.getAttribute('height') || 0;
          if (!Number.isFinite(x) || !Number.isFinite(y)) { problems.push(`${where}: a rect has no position`); continue; }
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
        }
        if (!Number.isFinite(minX)) { problems.push(`${where}: nothing drawn`); continue; }

        // Labels live in the LABEL margin the geometry already reserves on each side.
        if (minX < -1) problems.push(`${where}: drawing starts at x=${minX.toFixed(0)}, left of the canvas`);
        if (minY < -1) problems.push(`${where}: drawing starts at y=${minY.toFixed(0)}, above the canvas`);
        if (maxX > geom.W + 1) problems.push(`${where}: drawing reaches x=${maxX.toFixed(0)}, past width ${geom.W}`);
        if (maxY > geom.H + 1) problems.push(`${where}: drawing reaches y=${maxY.toFixed(0)}, past height ${geom.H}`);

        for (const t of a.document.querySelectorAll('#svg text')) {
          const x = t.getAttribute('x');
          if (x !== null && (+x < -1 || +x > geom.W + 1)) {
            problems.push(`${where}: label "${text(t).slice(0, 14)}" sits at x=${x}, outside 0..${geom.W}`);
            break;
          }
        }
      }
    }
  } finally { a.close(); }
  // Coverage, asserted rather than assumed — round-5 E5. This sweep walks
  // whatever `#mcusel`/`#pkgsel` happen to offer, so a part that stopped
  // registering, or a package dropped from a part's table, would silently shrink
  // it to the easy cases and still report green. `wchcube_cli.js --list` reads the
  // same data files by a different path, so the two counts must agree.
  const listed = spawnSync(process.execPath, [CLI, '--list'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(listed.status, 0, `wchcube_cli.js --list failed:\n${listed.stderr || listed.stdout}`);
  const expected = (listed.stdout.match(/^\s+packages\s+\S.*$/gm) || [])
    .reduce((n, line) => n + line.replace(/^\s+packages\s+/, '').split(',').length, 0);
  assert.ok(expected > 0, 'no packages came back from --list, so this check proves nothing');
  assert.equal(swept, expected,
    `the sweep covered ${swept} part/package combinations but the app ships ${expected}. `
    + 'A sweep that skips a part or a package reports green over the thing it did not look at');
  assert.empty(problems, 'chip drawing overflows');
});

test('every pin drawn carries the data the click handlers need', () => {
  const a = boot();
  const problems = [];
  try {
    for (const name of a.mcuNames) {
      a.loadMcu(name);
      for (const pkg of a.packages) {
        a.setPackage(pkg);
        for (const el of a.pinEls()) {
          if (!el.dataset.pin) problems.push(`${name} ${pkg}: a pin group has no data-pin`);
          else if (!el.dataset.num) problems.push(`${name} ${pkg}: ${el.dataset.pin} has no data-num`);
        }
      }
    }
  } finally { a.close(); }
  assert.empty(problems, 'pins missing their identity');
});

// =============================================================================
//  A 128-pin QFN, before anything depends on it.
//
//  `data/packages/packages.yaml` gained QFN128 (12.3x12.3mm, 0.35mm pitch, 32 pins a
//  side) for CH32H417, and **no part used it and no case had ever drawn one** — every
//  large-package claim in this file was LQFP144-shaped. AGENT-4 flagged it (BOARD
//  2026-09-11T23:14Z, TASKS "Draw a 128-pin QFN") as worth a spike BEFORE the data
//  work, because if 128 pins cannot be drawn legibly at 1280x720 then the UI job
//  changes. This is that spike, kept as a permanent case rather than thrown away.
//
//  The package is SYNTHESISED into the layout fixture at runtime from the first 128
//  rows of its own LQFP144 table, so no 128-line table is copied into a fixture that
//  exists to be a size stress test. The geometry under test is the real one from
//  `packages.yaml` — that is the half that could go wrong.
//
//  The assertion is a COMPARISON, not an absolute, and that is deliberate: there is no
//  agreed legibility threshold to assert against, and inventing one would be the
//  "lower a threshold to make it pass" mistake in reverse. LQFP144 is already covered
//  and green, so "no worse than LQFP144 at the same viewport" is a claim with a
//  baseline behind it. What the numbers say (2026-09-12): QFN128 is BETTER on every
//  metric at both sizes — 32 pins a side against 36, so its labels are further apart
//  and drawn larger.
// =============================================================================
const QFN128_VIEWPORTS = [{ name: '1280x720', width: 1280, height: 720 }, { name: '1920x1080', width: 1920, height: 1080 }];

/** The layout fixture with QFN128 added, built from its own LQFP144 pin order. */
function fixtureWithQfn128() {
  const dep = yamlDep();
  const doc = dep.load(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'mcus', 'WCH-DUMMY32-C8.yaml'), 'utf8'));
  const order = Object.entries(doc.packages.LQFP144)
    .map(([n, name]) => [Number(n), name]).sort((a, b) => a[0] - b[0]).map(([, name]) => name);
  assert.ok(order.length >= 128, `the fixture's LQFP144 has only ${order.length} pins, so QFN128 cannot be built from it`);
  doc.packages.QFN128 = Object.fromEntries(order.slice(0, 128).map((name, i) => [i + 1, name]));
  return dep.dump(doc, { lineWidth: -1 });
}

/** What a package looks like once the app has drawn it. */
function drawn(a, pkg, viewport) {
  a.setPackage(pkg);
  a.window.fitChip();
  const zoom = a.S.zoom;
  const geom = a.ev('geom');
  const pins = a.pinEls();
  const texts = Array.from(a.document.getElementById('svg').querySelectorAll('text'));
  const sizes = texts
    .map(t => (parseFloat(t.style.fontSize) || parseFloat(t.getAttribute('font-size')) || 9.5) * zoom)
    .filter(n => Number.isFinite(n) && n > 0);
  const ys = pins.map(el => {
    const r = el.querySelector('rect');
    return r ? +r.getAttribute('y') : NaN;
  }).filter(Number.isFinite).sort((p, q) => p - q);
  const gaps = ys.slice(1).map((y, i) => Math.abs(y - ys[i])).filter(g => g > 0.001);
  const xs = texts.map(t => +t.getAttribute('x')).filter(Number.isFinite);
  const allY = texts.map(t => +t.getAttribute('y')).filter(Number.isFinite);
  return {
    viewport, zoom, geom,
    drawnW: geom.W * zoom, drawnH: geom.H * zoom,
    pins: pins.length, texts: texts.length,
    labelMinPx: sizes.length ? Math.min(...sizes) : NaN,
    gapPx: gaps.length ? Math.min(...gaps) * zoom : NaN,
    // Nothing may be painted outside the drawing the app fitted to the canvas.
    outside: xs.some(x => x < -1 || x > geom.W + 1) || allY.some(y => y < -1 || y > geom.H + 1),
  };
}

test('QFN128 draws, fits its canvas, and is no worse than LQFP144 at both sizes', () => {
  const part = fixtureWithQfn128();
  for (const vp of QFN128_VIEWPORTS) {
    let big, ref;
    const a = boot({ viewport: vp });
    try {
      a.window.eval(`registerMcuFile(${JSON.stringify(part)})`);
      a.loadMcu('WCH-DUMMY32-C8');
      assert.includes(a.packages, 'QFN128', 'the synthesised package did not reach the package list');
      big = drawn(a, 'QFN128', vp);
      ref = drawn(a, 'LQFP144', vp);
    } finally { a.close(); }

    // It exists, at the pin count the geometry claims, and it is not silently empty.
    assert.equal(big.pins, 128,
      `QFN128 drew ${big.pins} pin groups, not 128 — the package or the geometry is broken`);
    assert.ok(big.texts >= 128,
      `QFN128 drew only ${big.texts} text element(s) for 128 pins, so most labels are missing`);

    // Fits the required viewport, which is the claim `layout.test.js` exists for.
    assert.ok(Number.isFinite(big.zoom) && big.zoom > 0,
      `QFN128 at ${vp.name}: zoom is ${big.zoom}, so nothing was laid out`);
    assert.ok(big.drawnW <= vp.width + 1 && big.drawnH <= vp.height + 1,
      `QFN128 at ${vp.name}: the drawing is ${big.drawnW.toFixed(1)}x${big.drawnH.toFixed(1)}, `
      + `which does not fit ${vp.width}x${vp.height}`);
    assert.notOk(big.outside,
      `QFN128 at ${vp.name}: a label is painted outside the fitted drawing`);

    // The comparison that gives the numbers meaning. LQFP144 is already covered and
    // green, so it is the baseline; "no worse" is checkable where "good enough" is not.
    assert.ok(big.gapPx >= ref.gapPx - 0.5,
      `QFN128 at ${vp.name} puts labels ${big.gapPx.toFixed(2)}px apart against LQFP144's `
      + `${ref.gapPx.toFixed(2)}px. LQFP144 is the case this suite already accepted, so a tighter `
      + 'QFN is a new problem rather than the same one');
    assert.ok(big.labelMinPx >= ref.labelMinPx - 0.2,
      `QFN128 at ${vp.name} draws its smallest label at ${big.labelMinPx.toFixed(2)}px against `
      + `LQFP144's ${ref.labelMinPx.toFixed(2)}px — the smaller body is costing label size`);
  }
});

test('the QFN128 case can fail: a package that disagrees with its geometry is caught', () => {
  // Planted break, run every time. The check above asserts `pins === 128`; that is only
  // worth asserting if a wrong map cannot also produce 128. Measured, rather than
  // assumed: the app accepts a map that disagrees with its geometry and reports
  // NOTHING — 127 entries draws 127 pin groups and 130 entries draws 128, both with an
  // empty console and the geometry still sized for 128. So the assertion bites, and
  // this proves it. (`tests/data.test.js`'s "the pin count in each package table
  // matches its geometry" is the gate that holds real parts to this; this is the
  // runtime half, where the app is merely quiet rather than wrong.)
  const dep = yamlDep();
  const short = dep.load(fixtureWithQfn128());
  const keys = Object.keys(short.packages.QFN128);
  delete short.packages.QFN128[keys[keys.length - 1]];
  assert.equal(Object.keys(short.packages.QFN128).length, 127, 'setup: the map was not shortened');

  const a = boot({ viewport: QFN128_VIEWPORTS[0] });
  let pins;
  try {
    a.window.eval(`registerMcuFile(${JSON.stringify(dep.dump(short, { lineWidth: -1 }))})`);
    a.loadMcu('WCH-DUMMY32-C8');
    a.setPackage('QFN128');
    a.window.fitChip();
    pins = a.pinEls().length;
    assert.empty(a.problems(),
      'the app logged a problem for a mismatched package map — that would be an improvement, and this '
      + 'note should be deleted rather than the check relaxed');
  } finally { a.close(); }

  assert.notEqual(pins, 128,
    'a 127-entry map drew 128 pin groups, so `pins === 128` in the test above cannot distinguish a '
    + 'correct package from a wrong one and proves nothing');
  assert.equal(pins, 127,
    `a 127-entry map drew ${pins} pin groups. The app is expected to draw exactly what the map says, `
    + 'silently — see the note above');
});

test('the clock tab is a drawn tree, not an empty panel', () => {
  const a = boot();
  try {
    const wrap = a.document.getElementById('ctreewrap');
    assert.ok(wrap, 'the clock tree container is missing');
    assert.ok(wrap.querySelector('svg, .cbox, .cnode'), 'the clock tab draws nothing');
  } finally { a.close(); }
});
