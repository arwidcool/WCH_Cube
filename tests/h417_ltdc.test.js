// =============================================================================
//  tests/h417_ltdc.test.js — the display controller's output width is a WIRING choice,
//  and the lines it does not claim must come back.
//
//  WHY THIS EXISTS. Most people do not wire a 24-bit panel. They wire 16-bit (RGB565) or
//  18-bit (RGB666) and expect the leftover colour lines to be ordinary pins they can use
//  for something else. That works on this silicon, and the reason is worth stating
//  because it is not obvious from the peripheral list:
//
//    * RM 43.4.5 — the global control register `R32_LTDC_GCR` has four polarity bits and
//      an enable, and bits [27:1] are RESERVED. There is no field that narrows the bus.
//      The controller always drives 24-bit parallel RGB at the pad.
//    * So a narrower panel is wired to the HIGH bits of each channel, and the low lines
//      are simply not connected. Nothing in the silicon reserves them: each is an
//      ordinary pin that carries LTDC only while its AFR field selects LTDC's AF.
//
//  A SECOND THING THIS FILE GUARDS, and it was a live defect until 2026-09-12: the
//  per-signal DEFAULT pins collided with each other. `defaultSignalPin()` takes the first
//  option bonded on the package, and four pads were the first option for two different
//  LTDC signals at once — PA8 was R6 *and* B3, PA15 was R3 *and* CLK, PA6 was G2 *and*
//  HSYNC, PA10 was B1 *and* B4. The conflict engine said nothing, because it only reports
//  a pad whose claims have different OWNERS and both of those are LTDC. One pad drives one
//  bit, so simply switching the controller on produced a configuration the silicon cannot
//  honour. The pin lists are now ordered so every default is distinct on every package.
//
//  The third guard is smaller and concrete: no default may land on the debug pads. B7's
//  first option used to be PB9, which is SWIO/SWDIO, so enabling the display collided with
//  the debug port before the user had touched anything.
//
//  NOT ASSERTED HERE, deliberately: the layer pixel format (L8 / AL44 / AL88 — the
//  eight-bit-per-pixel FRAME BUFFER formats of RM 43.4.18). Those save memory and free no
//  pin, and the generator cannot fill a per-layer init struct yet. TASKS.md owns it.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { suite, test, assert } from './lib/harness.js';
import { ROOT } from './lib/app.js';
import * as eng from '../app/engine/index.js';

suite('CH32H417 LTDC');

const PART = 'CH32H417';
const PACKAGES = ['QFN68', 'QFN88', 'QFN128'];

function boot() {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'vendor', 'js-yaml.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  eng.setYaml(mod.exports);
  eng.loadPackages(eng.yamlLoad(fs.readFileSync(path.join(ROOT, 'data', 'packages', 'packages.yaml'), 'utf8')));
  const dir = path.join(ROOT, 'data', 'mcus');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yaml')).sort()) {
    eng.registerMcuFile(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}
boot();

const load = pkg => { eng.loadMcu(eng.MCU_FILES[PART]); eng.setPackage(pkg); };
const display = depth => {
  eng.setSetting('LTDC', 'Colour depth', depth);
  eng.setSetting('LTDC', 'Sync and clock', 'Enabled');
};
/** Every pad LTDC currently holds. */
function ltdcPads() {
  eng.compute();
  const out = new Set();
  for (const r of eng.pinRows()) {
    for (const p of String(r.signal || '').split(' / ')) if (p.startsWith('LTDC_')) out.add(r.name);
  }
  return out;
}
const defaultPin = sig => eng.M.peripherals.LTDC.signal_pins[sig][0].pin;

// The standard panel wiring: the panel's most significant bit goes to the controller's,
// so a narrower bus drops the LOW lines of each channel. 24 / 18 / 16 lines plus the four
// timing signals (CLK, HSYNC, VSYNC, DE) on every one.
const DEPTHS = [
  ['RGB888', 24, []],
  ['RGB666', 18, ['R0', 'R1', 'G0', 'G1', 'B0', 'B1']],
  ['RGB565', 16, ['R0', 'R1', 'R2', 'G0', 'G1', 'B0', 'B1', 'B2']],
];

for (const pkg of PACKAGES) {
  test(`${pkg}: no two LTDC signals share a default pad`, () => {
    // The defect this file was written for. It has to hold per package, because the
    // default is "the first option BONDED here" and the three packages bond differently.
    load(pkg);
    const bonded = new Set();
    for (const v of Object.values(eng.M.packages[pkg])) for (const n of [].concat(v)) bonded.add(String(n));
    const seen = new Map();
    const clashes = [];
    for (const [sig, opts] of Object.entries(eng.M.peripherals.LTDC.signal_pins)) {
      const pin = (opts.find(o => bonded.has(String(o.pin))) || opts[0]).pin;
      if (seen.has(pin)) clashes.push(`${pin} is the default for both LTDC_${seen.get(pin)} and LTDC_${sig}`);
      seen.set(pin, sig);
    }
    assert.empty(clashes, `LTDC signals sharing one default pad on ${pkg} — one pad drives one bit`);
  });

  test(`${pkg}: switching the display on conflicts with nothing`, () => {
    // Including the debug port: no LTDC default may land on SWCLK/SWIO (PB8/PB9).
    for (const [depth] of DEPTHS) {
      load(pkg);
      display(depth);
      const E = eng.compute();
      assert.equal(E.conflictList.length, 0,
        `LTDC ${depth} on ${pkg} should be conflict-free out of the box, got: `
        + E.conflictList.map(c => c.text).join(' | '));
    }
  });
}

test('each colour depth claims the right number of lines', () => {
  const bad = [];
  for (const [depth, colourLines] of DEPTHS) {
    load('QFN128');
    display(depth);
    const pads = ltdcPads();
    // colour lines + CLK/HSYNC/VSYNC/DE, each on its own pad now that defaults are distinct
    if (pads.size !== colourLines + 4) {
      bad.push(`${depth} should hold ${colourLines + 4} pads (${colourLines} colour + 4 timing), holds ${pads.size}`);
    }
  }
  assert.empty(bad, 'colour depths claiming the wrong number of pads');
});

test('a narrower panel releases its low colour lines, and they can be used', () => {
  // THE POINT OF THE WHOLE ROW. Pick 16-bit, get eight pins back, and put them to work.
  const bad = [];
  for (const [depth, , freed] of DEPTHS) {
    load('QFN128');
    display(depth);
    const pads = ltdcPads();
    for (const sig of freed) {
      if (pads.has(defaultPin(sig))) bad.push(`${depth} should release LTDC_${sig} (${defaultPin(sig)}), but it is still claimed`);
    }
  }
  assert.empty(bad, 'colour lines a narrower panel should have released');

  // ...and the released pads really are free: take all eight with manual GPIO.
  load('QFN128');
  display('RGB565');
  for (const sig of ['R0', 'R1', 'R2', 'G0', 'G1', 'B0', 'B1', 'B2']) {
    eng.assignSignal(defaultPin(sig), { gpio: 'GPIO_Output' });
  }
  const E = eng.compute();
  assert.equal(E.conflictList.length, 0,
    'the eight lines RGB565 does not wire should be assignable to something else, got: '
    + E.conflictList.map(c => c.text).join(' | '));

  const c = eng.cFiles()['wchcube_init.c'] || '';
  assert.notOk(/TODO/.test(c), 'the generated C should carry no TODO for a 16-bit panel plus eight reused pins');
  assert.notOk(/#error/.test(c), 'the generated C should carry no #error');
});

test('the file says the output width is wiring, not a register', () => {
  // The user-visible half. `notes:` is what the configurator shows next to the
  // peripheral, and it is where the "your spare pins are free" fact has to live — the
  // question this file answers is one a person asks of the app, not of the source tree.
  eng.loadMcu(eng.MCU_FILES[PART]);
  const notes = String(eng.M.peripherals.LTDC.notes || '');
  assert.ok(notes.length > 200, 'LTDC should carry a notes: paragraph explaining the width');
  for (const re of [/24 bits? wide/i, /wired/i, /assigned to another peripheral/i]) {
    assert.match(notes, re, `LTDC notes should say something matching ${re}`);
  }
  // ...and it must not repeat the claim that an 8-bit format frees pins, because it does not.
  assert.match(notes, /frame buffer|memory/i,
    'LTDC notes should say that an 8-bit format is a frame-buffer format, not a pin count');
});
