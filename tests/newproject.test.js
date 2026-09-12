// New Project — the MCU selector, in a REAL browser.
//
// The dialog had no test at all before this file, which is how it stayed a
// two-step `<select>`-then-list for four rounds: nothing measured it, so nothing
// said it would stop working at fifty parts.
//
// It runs in Chrome/Edge rather than jsdom for the same reason `clock_ui.test.js`
// does: half of what matters here is layout — does the dialog fit the viewport,
// does the list scroll rather than clip, is the table wide enough for a part
// number — and jsdom has no layout engine, so every such assertion there would be
// a statement about nothing.
//
// What it locks in:
//   - the catalogue is complete: EVERY part number in EVERY MCU file has a row
//   - search and the facets actually narrow it, and "clear" restores it
//   - the facet counts are taken with that facet's own filter lifted
//   - a part with no PlatformIO board says so, rather than being hidden or faked
//   - creating a project loads the part AND the package that were selected
//   - nothing is clipped or painted outside the viewport, at three sizes
import fs from 'node:fs';
import path from 'node:path';
import { suite, test, assert, skip } from './lib/harness.js';
import { withPage, browserAvailable, ROOT } from './lib/browser.js';
import { withMutantDist } from './lib/mutant.js';
import { yaml } from './lib/deps.js';

suite('new project selector (real browser)');

const NO_BROWSER = 'no Chrome or Edge on this machine — real-browser checks skipped';

/** Open the dialog on a clean size, with no remembered size from another test. */
async function openDialog(page) {
  await page.eval(`
    try { localStorage.removeItem('wchcube.newproj.size'); } catch (e) {}
    if (document.getElementById('newproj').classList.contains('show')) npClose();
    NP.resized = false;
    openNewProject();
    return 1;`);
  await page.waitFor(`document.getElementById('newproj').classList.contains('show')`);
}

/** What the MCU files say, read independently of the app. */
function expectedParts() {
  const dir = path.join(ROOT, 'data', 'mcus');
  const out = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yaml'))) {
    const y = yaml().load(fs.readFileSync(path.join(dir, f), 'utf8'));
    const m = y.mcu || {};
    const variants = m.variants || {};
    if (Object.keys(variants).length) {
      for (const [part, info] of Object.entries(variants)) out.push(`${part}/${info.package}`);
    } else {
      // `inherits:` parts get their variants from the parent, which this reader does
      // not resolve; they are covered by the app-side count in the same test.
      for (const pk of Object.keys(y.packages || {})) out.push(`${m.name}/${pk}`);
    }
  }
  return out;
}

test('planted break: a part renamed in the bundle drops out of the catalogue, and the check names it', async () => {
  // Round 6, deliverable B. The catalogue check below compares the New Project rows against
  // data/mcus/. Rename ONE part inside a COPY of dist/index.html (the bundled YAML carries
  // `name: CH32V003` once) and open the dialog on that copy: the real CH32V003 must then be
  // absent from the rows while data/mcus/ still expects it - the check's own `missing`
  // condition, seen true. The tree is untouched; `withMutantDist` refuses a moved anchor.
  // The catalogue is keyed by PART NUMBER (the variant key), not by the MCU's name - the
  // first version of this plant renamed `mcu.name` and changed nothing the check compares.
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  const m = withMutantDist('CH32V003F4P6: {', 'CH32V003F4P6_PLANTED: {');
  assert.notOk(m.error, m.error || '');
  await withPage(async page => {
    await openDialog(page);
    const got = await page.eval(`return NP.rows.map(r => r.part + '/' + r.pkg)`);
    assert.ok(!got.some(g => g.startsWith('CH32V003F4P6/')), 'the renamed variant is still listed under its real part number, so the plant did not take');
    assert.ok(got.some(g => g.startsWith('CH32V003F4P6_PLANTED/')), `the planted part number is not in the catalogue either - the mutation broke the bundle:\n${got.slice(0, 12).join(', ')}`);
    const missing = expectedParts().filter(p => !got.includes(p));
    assert.ok(missing.includes('CH32V003F4P6/TSSOP20'), `the check's missing-list does not name the dropped variant: ${JSON.stringify(missing)}`);
    console.log(`      planted refusal (catalogue): parts in data/mcus/ the New Project list does not offer - ${missing.join(', ')}`);
  }, { url: m.file });
});

test('every part number in every MCU file has a row', async () => {
  if (!browserAvailable()) skip(NO_BROWSER);
  await withPage(async page => {
    await openDialog(page);
    const got = await page.eval(`return NP.rows.map(r => r.part + '/' + r.pkg)`);
    // A part the files list but the catalogue does not is the failure that matters:
    // it is a chip the user cannot reach. (The reverse — a row for a part this
    // reader could not see — is `inherits:`, which the app resolves and it does not.)
    const missing = expectedParts().filter(p => !got.includes(p));
    assert.empty(missing, 'parts in data/mcus/ that the New Project list does not offer');
    assert.ok(got.length >= expectedParts().length, `catalogue has ${got.length} rows`);
  });
});

test('search narrows by part number, family and package, and clears', async () => {
  if (!browserAvailable()) skip(NO_BROWSER);
  await withPage(async page => {
    await openDialog(page);
    const r = await page.eval(`
      const q = document.getElementById('np-q'), type = v => { q.value = v; q.dispatchEvent(new Event('input')); };
      const all = NP.view.length;
      // a package term: every surviving row must be in a package whose name matches
      type('qfn');
      const byPkg = NP.view.every(r => r.pkg.toLowerCase().includes('qfn'));
      // two terms: both must match, on possibly different fields
      const first = NP.rows[0];
      type(first.pkg + ' ' + first.family);
      const twoTerms = NP.view.length > 0 && NP.view.every(r => r.pkg === first.pkg && r.family === first.family);
      // no match: an explanation, not an empty box
      type('zzzz-no-such-part');
      const none = { n: NP.view.length, empty: !!document.querySelector('.np-empty'), pick: NP.pick };
      type('');
      return { all, byPkg, twoTerms, none, restored: NP.view.length };
    `);
    assert.ok(r.byPkg, 'a package search returned rows in other packages');
    assert.ok(r.twoTerms, 'a two-term search did not require both terms');
    assert.equal(r.none.n, 0, 'a nonsense search still matched something');
    assert.ok(r.none.empty, 'no-matches showed an empty box with no explanation');
    assert.equal(r.none.pick, null, 'a filtered-out part stayed selected');
    assert.equal(r.restored, r.all, 'clearing the search did not restore every part');
  });
});

test('a facet filters, its count is taken with itself lifted, and Clear restores', async () => {
  if (!browserAvailable()) skip(NO_BROWSER);
  await withPage(async page => {
    await openDialog(page);
    const r = await page.eval(`
      const boxes = [...document.querySelectorAll('#np-facets input[data-f="pkg"]')];
      if (boxes.length < 2) return { skip: true };
      const all = NP.view.length;
      const a = boxes[0], b = boxes[1];
      a.checked = true; a.onchange();
      const afterOne = NP.view.length, onlyA = NP.view.every(r => r.pkg === a.value);
      // The COUNT beside the second package must still be its full count, not 0:
      // a facet's own group is lifted when counting, so ticking it ADDS rows.
      const b2 = [...document.querySelectorAll('#np-facets input[data-f="pkg"]')].find(x => x.value === b.value);
      const shown = +b2.parentElement.querySelector('.np-n').textContent;
      b2.checked = true; b2.onchange();
      const afterTwo = NP.view.length;
      document.getElementById('np-clear').onclick();
      return { skip: false, all, afterOne, onlyA, shown, afterTwo, cleared: NP.view.length,
               clearDisabled: document.getElementById('np-clear').disabled };
    `);
    if (r.skip) skip('fewer than two packages in the catalogue — nothing to filter');
    assert.ok(r.afterOne < r.all, 'ticking a package did not narrow the list');
    assert.ok(r.onlyA, 'a package filter left rows from other packages');
    assert.ok(r.shown > 0, "a second package showed a count of 0 — its own facet was not lifted when counting");
    assert.equal(r.afterTwo, r.afterOne + r.shown, 'ticking a second package did not add exactly its own count');
    assert.equal(r.cleared, r.all, 'Clear filters did not restore every part');
    assert.ok(r.clearDisabled, 'Clear filters stayed enabled with nothing to clear');
  });
});

test('a part with no PlatformIO board is listed and says so', async () => {
  if (!browserAvailable()) skip(NO_BROWSER);
  await withPage(async page => {
    await openDialog(page);
    const r = await page.eval(`
      const none = NP.rows.filter(r => !r.board);
      if (!none.length) return { skip: true };
      npSelect(none[0]); npRenderTable(); npRenderDetail();
      return { skip: false, part: none[0].part,
               listed: [...document.querySelectorAll('#np-table tbody tr')].some(tr => tr.textContent.includes(none[0].part)),
               detail: document.getElementById('np-detail').textContent };
    `);
    if (r.skip) skip('every part in the catalogue has a PlatformIO board');
    // Round 4's rule: a variant with no board is refused BY NAME, never given a
    // neighbour's. The selector's job is to say so before the user picks it.
    assert.ok(r.listed, `${r.part} has no PlatformIO board and was hidden from the list`);
    assert.match(r.detail, /no PlatformIO board/i,
      `${r.part} has no PlatformIO board and the detail line does not say so`);
  });
});

test('creating a project loads the selected part on the selected package', async () => {
  if (!browserAvailable()) skip(NO_BROWSER);
  await withPage(async page => {
    await openDialog(page);
    const r = await page.eval(`
      // Pick a row that is NOT the one already loaded, so "it worked" cannot be
      // the app simply having been on that part all along.
      const other = NP.view.find(r => r.mcu !== M.mcu.name) || NP.view.find(r => r.pkg !== S.pkg);
      npSelect(other); npRenderTable(); npRenderDetail();
      const autoName = document.getElementById('np-name').value;
      npCreate();
      return { want: other, autoName, mcu: M.mcu.name, pkg: S.pkg,
               project: PROJECT.name, variant: PROJECT.variant,
               open: document.getElementById('newproj').classList.contains('show') };
    `);
    assert.equal(r.mcu, r.want.mcu, 'the selected MCU was not loaded');
    assert.equal(r.pkg, r.want.pkg, 'the selected package was not applied');
    assert.equal(r.variant, r.want.variant, 'the part number did not reach PROJECT.variant');
    assert.includes(r.autoName, r.want.part, 'the suggested project name does not name the part');
    assert.ok(!r.open, 'the dialog stayed open after creating');
    assert.empty(page.problems(), 'creating a project from the dialog logged problems');
  });
});

for (const size of [{ w: 1280, h: 720, z: 1 }, { w: 1280, h: 720, z: 1.25 }, { w: 1920, h: 1080, z: 1 }]) {
  test(`at ${size.w}x${size.h} zoom ${size.z * 100}% the dialog fits and the list scrolls`, async () => {
    if (!browserAvailable()) skip(NO_BROWSER);
    await withPage(async page => {
      await page.viewport(size.w, size.h, size.z);
      await openDialog(page);
      const r = await page.eval(`
        const d = document.getElementById('np-dlg').getBoundingClientRect();
        const wrap = document.getElementById('np-tablewrap');
        const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
        const bad = [];
        for (const el of document.querySelectorAll('#newproj *')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4 || !(el.textContent || '').trim()) continue;
          const nm = el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0];
          // 'auto'/'scroll' give the user a way to see the rest; only hidden/clip cut text off.
          if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1)
            bad.push(nm + ': ' + el.scrollWidth + 'px of text in ' + el.clientWidth + 'px');
          if ((cs.overflowY === 'hidden' || cs.overflowY === 'clip') && el.scrollHeight > el.clientHeight + 1)
            bad.push(nm + ': ' + el.scrollHeight + 'px tall in ' + el.clientHeight + 'px');
          if (r.right > vw + 1) bad.push(nm + ': right edge ' + Math.round(r.right) + ' past ' + vw);
        }
        return { fits: d.left >= -1 && d.top >= -1 && d.right <= vw + 1 && d.bottom <= vh + 1,
                 box: Math.round(d.width) + 'x' + Math.round(d.height) + ' in ' + vw + 'x' + vh,
                 scrollable: wrap.scrollHeight <= wrap.clientHeight || getComputedStyle(wrap).overflowY === 'auto',
                 bad };
      `);
      assert.ok(r.fits, `the dialog does not fit the viewport: ${r.box}`);
      assert.ok(r.scrollable, 'the part list is taller than its box and does not scroll');
      assert.empty(r.bad, 'text clipped or painted outside the viewport in the New Project dialog');
    });
    await withPage(async page => { await page.viewport(1280, 720, 1); });
  });
}
