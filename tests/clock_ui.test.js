// Clock Configuration, in a REAL browser.  (AGENT-4, round-2 P0.)
//
// The human reported "I cannot choose HSI vs HSE as the system clock source" and
// round-1's jsdom suite was green throughout, because jsdom has no layout engine:
// renderClock() bails at `if (!wrap.offsetParent)` there and never binds a handler,
// so every clock assertion in jsdom is really a statement about nothing.  These
// checks therefore run in Chrome/Edge over the DevTools protocol (tests/lib/browser.js).
//
// What they lock in, from agents_round2/00_PROJECT.md item 1 and WALKTHROUGH §4:
//   - every source in the data is offered by the mux, and NONE of them is disabled
//   - the muxes are actually reachable by a mouse (nothing painted over them)
//   - picking one changes the engine state and the numbers, not just the <select>
//   - picking HSE turns the RCC crystal on and claims XI/XO on the chip
//   - switching back to HSI leaves the crystal on, the way CubeMX does
import { suite, test, assert } from './lib/harness.js';
import { withPage, browserAvailable } from './lib/browser.js';

suite('clock configuration (real browser)');

const NO_BROWSER = 'no Chrome or Edge on this machine — real-browser checks skipped';

/** Open the app, switch to the clock tab, and let the deferred layout happen. */
async function onClockTab(page, mcu) {
  if (mcu) {
    await page.eval(`openMcu(MCU_FILES[${JSON.stringify(mcu)}]); return 1;`);
  }
  await page.click('[data-view="clock"]');
  await page.waitFor(`document.getElementById('ctreewrap') && document.getElementById('ctreewrap').offsetParent`);
  // the tree lays out from a MutationObserver, one tick after the tab turns active
  await page.waitFor(`!U.clockPending`);
  return page;
}

// Real parts only — and deliberately FOUR different clock SHAPES, because this sweep is
// the only thing that proves the clock tab is data-driven rather than CH32V006-driven:
//
//   CH32V006 / CH32V005  HSE plus a PLL. The original pair.
//   CH32X035             neither. One 48 MHz RC, SYSCLK divided down — the shape that
//                        catches code assuming `M.clock.pll` exists.
//   CH32L103             HSI/HSE/LSI/LSE with a PLL, the second family.
//   CH32H417             the richest clock tree in the repo and the opposite failure
//                        mode from CH32X035: FOUR oscillators, a six-source SYS PLL whose
//                        `inputs:` spell out 32 (source, divider) PAIRS, 32 multipliers
//                        including half steps (8.5, 9.5 …), a 400 MHz ceiling and a
//                        prescaler run with a HOLE in it (HPRE has no /32). Nothing swept
//                        this part until 2026-09-12; a tab that renders the three small
//                        parts correctly proves nothing about the one whose muxes are
//                        long enough to lay out wrongly.
//
// Adding a part here is the cheap half of QA and it is where the dead-control defects have
// come from every round. If one of these goes red, the defect is in `app/` and belongs to
// AGENT-2 on the board — it is not fixed by shrinking this list.
const MCUS = ['CH32V006', 'CH32V005', 'CH32X035', 'CH32L103', 'CH32H417'];

for (const mcu of MCUS) {
  test(`${mcu}: the SYSCLK mux offers every source in the data, none disabled`, async () => {
    if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
    await withPage(async page => {
      await onClockTab(page, mcu);
      const r = await page.eval(`
        const sel = document.getElementById('ck-sys');
        if (!sel) return { missing: true };
        return {
          data: M.clock.sysclk.sources.slice(),
          offered: Array.from(sel.options).map(o => o.value),
          disabled: Array.from(sel.options).filter(o => o.disabled).map(o => o.value),
          selectDisabled: !!sel.disabled,
        };`);
      assert.notOk(r.missing, 'the clock tab has no #ck-sys system-clock mux');
      assert.deep(r.offered, r.data, 'the mux does not offer exactly what clock.sysclk.sources lists');
      assert.empty(r.disabled, `${mcu}: SYSCLK options are disabled — greying is for branches that do not FEED sysclk, never for sources the user may not pick`);
      assert.notOk(r.selectDisabled, 'the SYSCLK mux itself is disabled');
    });
  });

  test(`${mcu}: the PLL source mux offers every input in the data, none disabled`, async () => {
    if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
    await withPage(async page => {
      await onClockTab(page, mcu);
      const r = await page.eval(`
        const sel = document.getElementById('ck-pllin');
        if (!M.clock.pll) return { noPll: true };
        if (!sel) return { missing: true };
        return {
          inputs: M.clock.pll.inputs.length,
          offered: Array.from(sel.options).length,
          disabled: Array.from(sel.options).filter(o => o.disabled).map(o => o.textContent.trim()),
          selectDisabled: !!sel.disabled,
        };`);
      if (r.noPll) return assert.ok(true, `${mcu} has no PLL in its clock block`);
      assert.notOk(r.missing, 'the clock tab has no #ck-pllin PLL source mux');
      assert.equal(r.offered, r.inputs, 'the PLL mux does not offer every clock.pll.inputs entry');
      assert.empty(r.disabled, `${mcu}: PLL source options are disabled`);
      assert.notOk(r.selectDisabled, 'the PLL source mux itself is disabled');
    });
  });
}

test('every clock control is reachable by a mouse, not covered by the connector layer', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    await onClockTab(page, 'CH32V006');
    const bad = [];
    for (const sel of ['#ck-sys', '#ck-pllin', '#ck-pllmul', '#ck-hse', 'select[data-pre]']) {
      const h = await page.hitTest(sel);
      if (h.missing) { bad.push(`${sel}: not rendered at all`); continue; }
      if (h.zeroSized) { bad.push(`${sel}: zero-sized box`); continue; }
      if (h.disabled) bad.push(`${sel}: disabled`);
      if (!h.reachable) bad.push(`${sel}: a click at its centre lands on ${h.covering}`);
      if (h.pointerEvents === 'none') bad.push(`${sel}: pointer-events:none`);
      if (h.visibility === 'hidden') bad.push(`${sel}: visibility:hidden`);
    }
    assert.empty(bad, 'clock controls a user cannot actually click');
  });
});

test('picking HSE reaches the engine: state, SYSCLK and the project dirty flag', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    await onClockTab(page, 'CH32V006');
    const before = await page.eval(`return { sys: S.clock.sys, dirty: PROJECT.dirty }`);
    assert.equal(before.sys, 'HSI', 'CH32V006 should start on HSI');

    await page.setValue('#ck-sys', 'HSE');
    const afterMux = await page.eval(`return {
      sys: S.clock.sys,
      shown: document.getElementById('ck-sys').value,
      dirty: PROJECT.dirty,
    }`);
    assert.equal(afterMux.sys, 'HSE', 'choosing HSE did not reach S.clock.sys — the mux is a dead control');
    assert.equal(afterMux.shown, 'HSE', 'the mux shows a different source than the engine holds');
    assert.ok(afterMux.dirty, 'a clock change must mark the project dirty');

    // a different crystal must move the numbers, or "selecting HSE" proves nothing
    // on this part: its default HSE is 24 MHz, exactly the HSI rate.
    await page.setValue('#ck-hse', '8');
    const at8 = await page.eval(`return { hse: S.clock.hse, sysclk: clockCalc().SYSCLK, hclk: clockCalc().HCLK }`);
    assert.equal(at8.hse, 8, 'the HSE crystal frequency input is not wired to the engine');
    assert.equal(at8.sysclk, 8, 'SYSCLK did not follow the HSE crystal');

    // Out of datasheet range -> flagged, not silently accepted. The limit comes from
    // the MCU file, never from a number written here: the DS ceiling on this part was
    // corrected from 25 to 32 MHz mid-round, and QA must not red-light over that.
    const tooFast = await page.eval(`return M.clock.sources.HSE.max_mhz + 8`);
    await page.setValue('#ck-hse', String(tooFast));
    const over = await page.eval(`return {
      max: M.clock.sources.HSE.max_mhz,
      over: clockCalc().over,
      cls: document.querySelector('.cnode[data-id=HSE]').className,
    }`);
    assert.includes(over.over, 'HSE', `${tooFast} MHz is past the datasheet maximum of ${over.max} and must be reported out of spec`);
    assert.includes(over.cls, 'over', 'the HSE box must be drawn red when the crystal is out of spec');
  });
});

test('choosing HSE switches the RCC crystal on and claims XI/XO (CubeMX coupling)', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    await onClockTab(page, 'CH32V006');
    await page.setValue('#ck-sys', 'HSE');
    const r = await page.eval(`
      const hse = Object.keys(S.periph.RCC.settings).find(n => /HSE/i.test(n));
      return {
        setting: hse ? S.periph.RCC.settings[hse] : null,
        PA1: E.pins.PA1 ? E.pins.PA1.label : null,
        PA2: E.pins.PA2 ? E.pins.PA2.label : null,
      };`);
    assert.notEqual(r.setting, 'Disable',
      'SYSCLK is running from HSE while RCC still says the crystal is disabled — selecting HSE must enable it');
    assert.equal(r.PA1, 'RCC_XI', 'PA1 must carry RCC_XI once the crystal is on');
    assert.equal(r.PA2, 'RCC_XO', 'PA2 must carry RCC_XO once the crystal is on');
  });
});

test('HSE through the PLL enables the crystal too', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    await onClockTab(page, 'CH32V006');
    const hseIndex = await page.eval(`return M.clock.pll.inputs.findIndex(i => i.source === 'HSE')`);
    assert.notEqual(hseIndex, -1, 'CH32V006 PLL should accept HSE as an input');
    await page.setValue('#ck-pllin', String(hseIndex));
    await page.setValue('#ck-sys', 'PLLCLK');
    const r = await page.eval(`
      const hse = Object.keys(S.periph.RCC.settings).find(n => /HSE/i.test(n));
      return {
        pllIn: S.clock.pllIn, sys: S.clock.sys,
        pllclk: clockCalc().PLLCLK, sysclk: clockCalc().SYSCLK,
        setting: hse ? S.periph.RCC.settings[hse] : null,
        PA1: E.pins.PA1 ? E.pins.PA1.label : null,
      };`);
    assert.equal(r.pllIn, hseIndex, 'the PLL source mux is a dead control');
    assert.equal(r.sys, 'PLLCLK', 'the SYSCLK mux would not take PLLCLK');
    assert.equal(r.sysclk, r.pllclk, 'SYSCLK should equal PLLCLK once the mux points at the PLL');
    assert.notEqual(r.setting, 'Disable', 'the PLL is fed from HSE, so the crystal must be enabled');
    assert.equal(r.PA1, 'RCC_XI', 'PA1 must carry RCC_XI when the PLL runs from HSE');
  });
});

test('switching back to HSI leaves the RCC crystal exactly as the user left it', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    await onClockTab(page, 'CH32V006');
    await page.setValue('#ck-sys', 'HSE');
    const on = await page.eval(`
      const n = Object.keys(S.periph.RCC.settings).find(x => /HSE/i.test(x));
      return S.periph.RCC.settings[n];`);
    await page.setValue('#ck-sys', 'HSI');
    const after = await page.eval(`
      const n = Object.keys(S.periph.RCC.settings).find(x => /HSE/i.test(x));
      return { setting: S.periph.RCC.settings[n], sys: S.clock.sys, PA1: E.pins.PA1 ? E.pins.PA1.label : null };`);
    assert.equal(after.sys, 'HSI', 'the mux would not go back to HSI');
    assert.equal(after.setting, on,
      'moving the mux away from HSE must not switch the crystal off — that is the user\'s setting, not ours');
    assert.equal(after.PA1, 'RCC_XI', 'PA1 stays RCC_XI until the user disables the crystal in RCC');
  });
});

test('the clock tab never shows a value the engine does not hold', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    await onClockTab(page, 'CH32V006');
    await page.setValue('#ck-sys', 'PLLCLK');
    await page.setValue('#ck-hse', '12');
    // leave the tab and come back, the way a user does
    await page.click('[data-view="pinout"]');
    await page.click('[data-view="clock"]');
    const r = await page.eval(`return {
      stateSys: S.clock.sys, shownSys: document.getElementById('ck-sys').value,
      stateHse: String(S.clock.hse), shownHse: document.getElementById('ck-hse').value,
      statePll: String(S.clock.pllIn), shownPll: document.getElementById('ck-pllin').value,
    }`);
    const drift = [];
    if (r.stateSys !== r.shownSys) drift.push(`SYSCLK mux shows ${r.shownSys}, engine holds ${r.stateSys}`);
    if (r.stateHse !== r.shownHse) drift.push(`HSE input shows ${r.shownHse}, engine holds ${r.stateHse}`);
    if (r.statePll !== r.shownPll) drift.push(`PLL mux shows ${r.shownPll}, engine holds ${r.statePll}`);
    assert.empty(drift, 'the clock controls and the engine disagree');
  });
});

test('clock selections survive undo and redo', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    await onClockTab(page, 'CH32V006');
    await page.setValue('#ck-sys', 'HSE');
    const afterPick = await page.eval(`return S.clock.sys`);
    assert.equal(afterPick, 'HSE', 'nothing to undo — the mux never reached the engine');
    await page.eval(`runHistory(false); renderAll(); return 1;`);
    assert.equal(await page.eval(`return S.clock.sys`), 'HSI', 'undo did not take the clock change back');
    await page.eval(`runHistory(true); renderAll(); return 1;`);
    assert.equal(await page.eval(`return S.clock.sys`), 'HSE', 'redo did not put the clock change back');
  });
});

test('the clock tab is silent: no console errors or warnings while configuring it', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    for (const mcu of MCUS) {
      await onClockTab(page, mcu);
      await page.eval(`
        const sys = document.getElementById('ck-sys');
        for (const o of sys.options) { sys.value = o.value; sys.dispatchEvent(new Event('change', { bubbles: true })); }
        document.querySelectorAll('select[data-pre]').forEach(s => {
          for (const o of s.options) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        return 1;`);
    }
    assert.empty(page.problems(), 'the clock tab wrote to the console');
  });
});

// =============================================================================
//  THE PLANTED BREAK — the sweep above is green, and green is a claim about the app
//  that is worth exactly as much as the proof that it could have been red.
//
//  CH32H417 is why this is not ceremony. Its `#ck-pllin` carries 32 (source, divider)
//  pairs and its `#ck-sys` three sources; a renderer that quietly truncated either would
//  look completely normal on CH32V006 (2 PLL inputs, 3 sysclk sources) and on CH32X035
//  (no PLL at all). The two mutations below are that defect, applied to a COPY of
//  dist/index.html so nothing in the tree is touched, and each must be caught ON THE PART
//  WITH THE LONG LISTS. If a mutation ever stops being caught, the sweep has gone blind
//  and adding another part to MCUS will not bring it back.
//
//  This is the same shape as tools/coverage_selftest.py and tests/source_order.test.js:
//  mutate, watch it go red, restore. Here "restore" is free — the mutant is a temp file.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIST } from './lib/browser.js';

/** Write a one-string mutation of dist/index.html to a temp file and return its path. */
function mutantOf(find, replace) {
  const src = fs.readFileSync(DIST, 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) return { error: `the anchor ${JSON.stringify(find)} appears ${n} times in dist/index.html, expected 1 — the app moved and this planted break no longer plants anything` };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-clockbreak-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, src.replace(find, replace));
  return { file };
}

// [anchor in dist/index.html, the truncation, which mux it cripples, what the sweep says]
const BREAKS = [
  ['sel.pllIn.map(i2 =>', 'sel.pllIn.slice(0, 8).map(i2 =>', 'ck-pllin',
   'the PLL source mux offers 8 of the 32 (source, divider) pairs CH32H417 has'],
  ['sel.sys.map(s =>', 'sel.sys.slice(0, 1).map(s =>', 'ck-sys',
   'the SYSCLK mux offers 1 of the 3 sources CH32H417 has'],
];

for (const [find, replace, id, what] of BREAKS) {
  test(`planted break: a truncated #${id} is caught on CH32H417 (${what})`, async () => {
    if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
    const m = mutantOf(find, replace);
    assert.notOk(m.error, m.error || '');
    await withPage(async page => {
      await onClockTab(page, 'CH32H417');
      // Exactly the comparison the sweep makes, run against the crippled app.
      const r = await page.eval(`
        const sys = document.getElementById('ck-sys'), pll = document.getElementById('ck-pllin');
        return {
          sysData: M.clock.sysclk.sources.length,
          sysOffered: sys ? sys.options.length : -1,
          pllData: M.clock.pll.inputs.length,
          pllOffered: pll ? pll.options.length : -1,
        };`);
      const short = id === 'ck-sys'
        ? { data: r.sysData, offered: r.sysOffered }
        : { data: r.pllData, offered: r.pllOffered };
      assert.ok(short.offered < short.data,
        `the mutation did not take: #${id} still offers ${short.offered} of ${short.data} — `
        + `the anchor ${JSON.stringify(find)} is no longer the code that builds this mux, `
        + 'so the sweep above is no longer known to be able to fail');
      // ...and the OTHER mux is untouched, so a break that blanks the whole tab does not
      // read as a pass here.
      const other = id === 'ck-sys'
        ? { data: r.pllData, offered: r.pllOffered, name: 'ck-pllin' }
        : { data: r.sysData, offered: r.sysOffered, name: 'ck-sys' };
      assert.equal(other.offered, other.data,
        `#${other.name} should be unaffected by this mutation, but offers ${other.offered} of ${other.data}`);
    }, { url: m.file });
  });
}
