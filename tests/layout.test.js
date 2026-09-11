// Layout regression against agents/reference/cubemx.png.
//
// Structural, not pixel: jsdom has no layout engine and Playwright will not install on
// this box, so instead of diffing images this locks in the SHAPE the reference shows -
// menu bar, breadcrumb, four navy tabs, then three columns (peripheral tree, mode and
// configuration, chip with its zoom bar). That is what actually regresses when someone
// reorganises the markup, and it is checked at both required viewport sizes.
import { suite, test, assert } from './lib/harness.js';
import { boot } from './lib/app.js';

suite('layout');

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
  try {
    for (const name of a.mcuNames) {
      a.loadMcu(name);
      for (const pkg of a.packages) {
        a.setPackage(pkg);
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

test('the clock tab is a drawn tree, not an empty panel', () => {
  const a = boot();
  try {
    const wrap = a.document.getElementById('ctreewrap');
    assert.ok(wrap, 'the clock tree container is missing');
    assert.ok(wrap.querySelector('svg, .cbox, .cnode'), 'the clock tab draws nothing');
  } finally { a.close(); }
});
