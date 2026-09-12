// clockmux_ui.test.js — the clock TAB's half of the second PLL and the source mux,
// in a REAL browser.
//
// jsdom has no layout engine, so `renderClock()` bails at `if (!wrap.offsetParent)`
// and binds no handler: every clock assertion made in jsdom is a statement about
// nothing (round 2's P0, and the reason `tests/clock_ui.test.js` exists at all).
// These run in Chrome/Edge over the DevTools protocol, on the same synthetic part
// `clockmux.test.js` uses — the schema must not name a part, so the tab is proved on
// the SHAPE of CH32H417's RM 3.4.13 rather than on CH32H417.
//
// What they lock in:
//   - a second PLL gets a box, with its own source (and multiplier) controls
//   - a tap whose `source:` is a LIST gets a <select>, reachable by a real mouse
//   - picking one changes the ENGINE and the number in the box, not just the control
//   - the number is the reference manual's: USBHS_PLL 480 / 10 = 48 MHz for USBFS
import { test, assert } from './_harness.js';
import { withPage, browserAvailable } from '../../tests/lib/browser.js';

const NO_BROWSER = 'no Chrome or Edge on this machine — real-browser checks skipped';

// Same file as clockmux.test.js. Kept here as its own copy rather than exported from
// there, because a test that imports its fixture from another test file goes stale in
// exactly one direction: silently.
const PLLS = `
mcu:
  name: CH32V006-PLLS-UI
  inherits: CH32V006
clock:
  plls:
    USBHS_PLL:
      label: USB HS PLL
      output: USBHS_PLL_CLK
      output_mhz: 480
      inputs:
        - { name: HSE, source: HSE, div: 1 }
        - { name: HSI, source: HSI, div: 1 }
    SERDES_PLL:
      output: SERDES_PLL_CLK
      inputs:
        - { name: HSE, source: HSE, div: 1 }
      multipliers: [25, 28, 30]
      dividers: [1, 2]
  sysclk: { sources: [HSI, HSE, PLLCLK, SERDES_PLL_CLK], max_mhz: 48 }
  prescalers:
    USBFS:
      label: USBFS 48 MHz clock
      source: [USBHS_PLL_CLK, PLLCLK]
      options: [1, 2, 5, 10]
      default: 10
      target_mhz: 48
`;

/** Open the app on the synthetic part, switch to the clock tab, let the layout happen. */
async function onClockTab(page) {
  await page.eval(`registerMcuFile(${JSON.stringify(PLLS)}); openMcu(MCU_FILES['CH32V006-PLLS-UI']); return 1;`);
  await page.click('[data-view="clock"]');
  await page.waitFor(`document.getElementById('ctreewrap') && document.getElementById('ctreewrap').offsetParent`);
  await page.waitFor(`!U.clockPending`);
  return page;
}

test('the clock tab draws a box per PLL, and the USBFS tap reads 48 MHz from the RM’s own numbers', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    await onClockTab(page);
    const r = await page.eval(`
      const box = id => document.querySelector('.cnode[data-id="' + id + '"]');
      const val = id => { const b = box(id); return b ? b.querySelector('.val').textContent.trim() : null; };
      return {
        pll:     !!box('PLL'),
        usbhs:   !!box('pll:USBHS_PLL'),
        serdes:  !!box('pll:SERDES_PLL'),
        usbhsVal: val('pll:USBHS_PLL'),
        usbfsVal: val('pre:USBFS'),
        title:   box('pll:USBHS_PLL').querySelector('h5').textContent,
        mux:     !!document.querySelector('select[data-presrc="USBFS"]'),
        muxOptions: Array.from(document.querySelectorAll('select[data-presrc="USBFS"] option')).map(o => o.value),
        pllinOptions: Array.from(document.querySelectorAll('select[data-pllin="USBHS_PLL"] option')).map(o => o.textContent),
        serdesMul: !!document.querySelector('select[data-pllmul="SERDES_PLL"]'),
        serdesDiv: !!document.querySelector('select[data-plldiv="SERDES_PLL"]'),
        usbhsMul: !!document.querySelector('select[data-pllmul="USBHS_PLL"]'),
        engineUsbfs: clockCalc().USBFS,
      };
    `);
    assert.ok(r.pll && r.usbhs && r.serdes, 'every PLL in the data has a box');
    assert.equal(r.title, 'USB HS PLL', 'a PLL is titled by its `label:`');
    assert.match(r.usbhsVal, /^480/, 'a fixed-output PLL shows its output');
    assert.match(r.usbfsVal, /^48/, '480 / 10 = 48 MHz — CH32H417RM:4048 USBFSSRC=1, :4055-4067 USBFSDIV=0111');
    assert.equal(r.engineUsbfs, 48, 'and the box is not painting a different number from the engine');
    assert.ok(r.mux, 'a tap whose source: is a list gets a <select>');
    assert.deepEqual(r.muxOptions, ['USBHS_PLL_CLK', 'PLLCLK'], 'the whole list, in the file’s order');
    assert.deepEqual(r.pllinOptions, ['HSE', 'HSI'], 'a second PLL offers its own inputs');
    assert.ok(r.serdesMul && r.serdesDiv, 'a multiplied PLL gets a multiplier and a divider');
    assert.ok(!r.usbhsMul, 'a fixed-output PLL offers no multiplier it has not got');
    assert.deepEqual(page.problems(), [], 'no console noise');
  });
});

test('the new controls are reachable by a real mouse, not painted over', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    await onClockTab(page);
    const bad = [];
    for (const sel of ['select[data-presrc="USBFS"]', 'select[data-pllin="USBHS_PLL"]',
                       'select[data-pllmul="SERDES_PLL"]', 'select[data-plldiv="SERDES_PLL"]']) {
      const h = await page.hitTest(sel);
      if (h.missing) { bad.push(`${sel}: not rendered at all`); continue; }
      if (h.zeroSized) { bad.push(`${sel}: zero-sized box`); continue; }
      if (h.disabled) bad.push(`${sel}: disabled`);
      if (!h.reachable) bad.push(`${sel}: a click at its centre lands on ${h.covering}`);
      if (h.pointerEvents === 'none') bad.push(`${sel}: pointer-events:none`);
      if (h.visibility === 'hidden') bad.push(`${sel}: visibility:hidden`);
    }
    assert.deepEqual(bad, [], 'clock controls a user cannot actually click');
  });
});

test('picking a different source moves the engine and every number with it', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    await onClockTab(page);
    await page.setValue('select[data-presrc="USBFS"]', 'PLLCLK');
    let r = await page.eval(`return {
      state: S.clock.preSrc.USBFS,
      shown: document.querySelector('select[data-presrc="USBFS"]').value,
      usbfs: clockCalc().USBFS,
      box: document.querySelector('.cnode[data-id="pre:USBFS"] .val').textContent.trim(),
      red: document.querySelector('.cnode[data-id="pre:USBFS"]').classList.contains('over'),
    };`);
    assert.equal(r.state, 'PLLCLK', 'the engine took the change');
    assert.equal(r.shown, 'PLLCLK', 'and the control shows what the engine holds');
    assert.equal(r.usbfs, 4.8, 'SYS PLL 48 MHz / 10');
    assert.match(r.box, /^4\.8/);
    assert.ok(r.red, '4.8 MHz is not the 48 MHz the tap must be: out of specification');

    // …and back, through the divider this time: 48 / 1 off the SYS PLL is also 48.
    await page.setValue('select[data-pre="USBFS"]', '1');
    r = await page.eval(`return {
      usbfs: clockCalc().USBFS,
      red: document.querySelector('.cnode[data-id="pre:USBFS"]').classList.contains('over'),
    };`);
    assert.equal(r.usbfs, 48);
    assert.ok(!r.red, 'on target again');
    assert.deepEqual(page.problems(), []);
  });
});

test('a second PLL’s multiplier recomputes it, and SYSCLK can be driven from its output', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    await onClockTab(page);
    await page.setValue('select[data-pllmul="SERDES_PLL"]', '30');
    await page.setValue('select[data-plldiv="SERDES_PLL"]', '2');
    let r = await page.eval(`return {
      mul: S.clock.plls.SERDES_PLL.mul, div: S.clock.plls.SERDES_PLL.div,
      out: clockCalc().SERDES_PLL_CLK,
      box: document.querySelector('.cnode[data-id="pll:SERDES_PLL"] .val').textContent.trim(),
      sysOptions: Array.from(document.getElementById('ck-sys').options).map(o => o.value),
    };`);
    assert.equal(r.mul, 30);
    assert.equal(r.div, 2);
    assert.equal(r.out, 360, 'HSE 24 MHz x 30 / 2');
    assert.match(r.box, /^360/);
    assert.ok(r.sysOptions.includes('SERDES_PLL_CLK'), 'sysclk.sources may name a secondary PLL');

    await page.setValue('#ck-sys', 'SERDES_PLL_CLK');
    r = await page.eval(`return {
      sys: S.clock.sys, sysclk: clockCalc().SYSCLK,
      red: document.querySelector('.cnode[data-id="SYSCLK"]').classList.contains('over'),
      issues: (document.querySelector('.issues') || {}).textContent || '',
    };`);
    assert.equal(r.sys, 'SERDES_PLL_CLK');
    assert.equal(r.sysclk, 360);
    assert.ok(r.red, '360 MHz is far over this part’s 48 MHz ceiling');
    assert.match(r.issues, /SYSCLK \(above maximum\)/);
    assert.deepEqual(page.problems(), []);
  });
});

test('the tab a part with ONE PLL draws is unchanged — no empty column, no stray control', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    await page.eval(`openMcu(MCU_FILES['CH32V006']); return 1;`);
    await page.click('[data-view="clock"]');
    await page.waitFor(`document.getElementById('ctreewrap') && document.getElementById('ctreewrap').offsetParent`);
    await page.waitFor(`!U.clockPending`);
    const r = await page.eval(`
      const wrap = document.getElementById('ctreewrap');
      return {
        extraPll: document.querySelectorAll('.cnode[data-id^="pll:"]').length,
        muxes: document.querySelectorAll('select[data-presrc]').length,
        pllControls: document.querySelectorAll('select[data-pllin], select[data-pllmul], select[data-plldiv]').length,
        cols: [...new Set(Array.from(wrap.querySelectorAll('.cnode')).map(d => d.style.left))].length,
        sysclk: clockCalc().SYSCLK,
      };
    `);
    assert.equal(r.extraPll, 0, 'a part with one PLL grows no second PLL box');
    assert.equal(r.muxes, 0, 'and no source mux: every tap has one source');
    assert.equal(r.pllControls, 0, 'the SYS PLL keeps its own #ck-pllin / #ck-pllmul ids');
    assert.equal(r.cols, 5, 'five occupied columns, as before: the empty one takes no room');
    assert.equal(r.sysclk, 24);
    assert.deepEqual(page.problems(), []);
  });
});
