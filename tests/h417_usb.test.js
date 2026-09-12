// =============================================================================
//  tests/h417_usb.test.js — CH32H417 has FOUR USB controllers, and picking a mode on
//  any of them must claim the pads the datasheet gives it.
//
//  WHY THIS EXISTS. Until 2026-09-12 three of the four were empty shells. USBFS, USBHS
//  and USBSS each offered `Mode: [Disable, Device, Host]` with no signal behind any
//  choice, routed nothing, and carried the note "This peripheral holds no pin on any
//  package; it is configured through its own registers and the clock tree only." That
//  sentence was false for all three, and the datasheet says so plainly:
//
//      Table 2-2-18 USBFS : OTG_DP PA12, OTG_DM PA11, OTG_VBUS PA9, OTG_ID PA10
//      Table 2-2-19 USBHS : USBHS_DP PB8, USBHS_DM PB9
//      Table 2-1-1  USBSS : SSTXB, SSTXA, SSRXB, SSRXA — pin type `USB3.0`, bonded on
//                           all three packages (QFN68 1/2/4/5, QFN88 84/85/87/88,
//                           QFN128 123/124/126/127)
//
//  So a user picked "Device (FS)" and the chip drawing lit up nothing. That is the
//  offered-but-impossible defect this round is named after, in its plainest form: the
//  app offered a mode the configuration could not express.
//
//  WHAT IS ASSERTED, and each half matters:
//    1. every mode of every USB controller claims EXACTLY the datasheet's pads — not
//       "some pin", the right ones, on all three packages;
//    2. USBFS's two OTG pads are reachable, since they are a separate row: a Mode row
//       alone would leave VBUS and ID unclaimable, which is the same defect one level
//       down;
//    3. USBHS on PB8/PB9 CONFLICTS with the 2-wire debug port, because those are the
//       SWCLK and SWIO/SWDIO pads. A file that hid this would be lying in the other
//       direction;
//    4. the generated C carries no TODO and no `#error` for any of them, names the pads
//       as deliberately unconfigured, and still emits each controller's clock enable.
//       The vendor's own driver is the authority for not configuring them:
//       `ch32h417_usbfs_device.c:54-70` enables `RCC_HBPeriph_OTG_FS` and the GPIOA
//       clock and configures no pin; `ch32h417_usbhs_device.c` has no GPIO call at all.
//
//  The expectations below are written from the datasheet, not read from the MCU file, so
//  deleting a `signal_pins:` entry or a choice's `signals:` turns this red by name.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { suite, test, assert } from './lib/harness.js';
import { ROOT } from './lib/app.js';
import * as eng from '../app/engine/index.js';
import { withMutantMcu } from './lib/mutant.js';

suite('CH32H417 USB');

const PART = 'CH32H417';

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

/** Load the part on a package with nothing configured. */
function fresh(pkg) {
  eng.loadMcu(eng.MCU_FILES[PART]);
  eng.setPackage(pkg);
}

/** `{ signal: pin }` for every pad this peripheral currently holds. */
function held(pid) {
  eng.compute();
  const out = {};
  for (const r of eng.pinRows()) {
    for (const part of String(r.signal || '').split(' / ')) {
      if (part.startsWith(pid + '_')) out[part.slice(pid.length + 1)] = r.name;
    }
  }
  return out;
}

const PACKAGES = ['QFN68', 'QFN88', 'QFN128'];

// --- 1. every mode claims the datasheet's pads ------------------------------------
const MODES = [
  ['USBFS', 'Device (FS)',        { DP: 'PA12', DM: 'PA11' }],
  ['USBFS', 'Host (FS)',          { DP: 'PA12', DM: 'PA11' }],
  ['USBFS', 'Dual-role (OTG FS)', { DP: 'PA12', DM: 'PA11' }],
  ['USBHS', 'Device (HS)',        { DP: 'PB8', DM: 'PB9' }],
  ['USBHS', 'Host (HS)',          { DP: 'PB8', DM: 'PB9' }],
  ['USBSS', 'Device (SS)',        { TXA: 'SSTXA', TXB: 'SSTXB', RXA: 'SSRXA', RXB: 'SSRXB' }],
  ['USBSS', 'Host (SS)',          { TXA: 'SSTXA', TXB: 'SSTXB', RXA: 'SSRXA', RXB: 'SSRXB' }],
  ['USBPD', 'Source',             { CC1: 'PB3', CC2: 'PB4' }],
  ['USBPD', 'Sink',               { CC1: 'PB3', CC2: 'PB4' }],
  ['USBPD', 'DRP',                { CC1: 'PB3', CC2: 'PB4' }],
];

/** Every pin name this package brings out, shorted names counted separately. */
function bondedPins(pkg) {
  const out = new Set();
  for (const v of Object.values(eng.M.packages[pkg] || {})) {
    for (const n of [].concat(v)) out.add(String(n));
  }
  return out;
}

for (const pkg of PACKAGES) {
  test(`${pkg}: every USB mode claims the pads the datasheet gives it`, () => {
    const bad = [];
    for (const [pid, choice, want] of MODES) {
      fresh(pkg);
      // The debug port holds PB8/PB9 from reset, so USBHS is measured with it off —
      // the conflict that causes is asserted on its own below, not smuggled in here.
      if (pid === 'USBHS') eng.setSetting('SYS', 'Debug', 'No Debug');
      const bonded = bondedPins(pkg);
      const reachable = Object.entries(want).filter(([, pin]) => bonded.has(pin));

      // A package that brings out NONE of a controller's pads cannot host it, and that
      // is real silicon rather than a gap: the 68-pin part bonds no PA9–PA12 and no
      // PB3/PB4, so USBFS and USBPD are genuinely unusable there. The app must say so —
      // `isAvailable` false puts a ⊘ on the tree entry — instead of offering a mode that
      // claims nothing, which is the very defect this file exists to stop.
      if (!reachable.length) {
        if (eng.isAvailable(pid)) {
          bad.push(`${pid} bonds none of its pads on ${pkg}, so it should read as UNAVAILABLE, `
            + 'not be offered with nothing behind it');
        }
        continue;
      }
      eng.setSetting(pid, 'Mode', choice);
      const got = held(pid);
      for (const [sig, pin] of reachable) {
        if (got[sig] !== pin) {
          bad.push(`${pid} "${choice}" should hold ${sig} on ${pin}, holds ${got[sig] || 'NOTHING'}`);
        }
      }
      if (!Object.keys(got).length) bad.push(`${pid} "${choice}" claims NO PIN AT ALL`);
    }
    assert.empty(bad, `USB modes that do not claim their datasheet pads on ${pkg}`);
  });
}

test('QFN68 brings out no USBFS or USBPD pad at all, and both read as unavailable', () => {
  // The other half of the rule above, stated for the one package it bites on, so that a
  // future change which quietly bonds those pads — or which makes `isAvailable` lenient —
  // is named here rather than noticed on a board.
  fresh('QFN68');
  const bonded = bondedPins('QFN68');
  for (const pin of ['PA9', 'PA10', 'PA11', 'PA12', 'PB3', 'PB4']) {
    assert.notOk(bonded.has(pin), `QFN68 should not bond ${pin} (DS Table 2-1-1 has a dash in that column)`);
  }
  assert.notOk(eng.isAvailable('USBFS'), 'USBFS should be unavailable on QFN68');
  assert.notOk(eng.isAvailable('USBPD'), 'USBPD should be unavailable on QFN68');
  // ...while the two whose pads ARE bonded stay usable on the same package.
  assert.ok(eng.isAvailable('USBHS'), 'USBHS should be available on QFN68 (PB8/PB9 are bonded)');
  assert.ok(eng.isAvailable('USBSS'), 'USBSS should be available on QFN68 (the four SuperSpeed pads are bonded)');
});

test('USBFS\'s two OTG pads are reachable, not stranded behind the Mode row', () => {
  // DS Table 2-2-18 lists four pins and neither it nor RM ch.26 says which ROLE needs
  // VBUS or ID, so they are a separate checkbox row. If they were folded into Mode,
  // one of the two would be unclaimable — the same defect one level down.
  fresh('QFN128');
  eng.setSetting('USBFS', 'Mode', 'Dual-role (OTG FS)');
  eng.toggleSetting('USBFS', 'OTG pins', 'VBUS (bus voltage sense)', true);
  eng.toggleSetting('USBFS', 'OTG pins', 'ID (role detect)', true);
  const got = held('USBFS');
  assert.deep([got.DP, got.DM, got.VBUS, got.ID], ['PA12', 'PA11', 'PA9', 'PA10'],
    'USBFS with both OTG pads ticked should hold PA12/PA11/PA9/PA10');
});

// --- 2. the hardware fact that must NOT be hidden ---------------------------------
test('USBHS and the 2-wire debug port collide on PB8/PB9, and the engine says so', () => {
  // DS Table 2-1-1 spells PB8 `SWCLK/USBHS_DP/...` and PB9 `SWIO/SWDIO/USBHS_DM/...`.
  // One pad, two owners: a real choice the user has to make on the board.
  fresh('QFN128');
  eng.setSetting('SYS', 'Debug', '2-wire (SWIO + SWCLK)');
  eng.setSetting('USBHS', 'Mode', 'Device (HS)');
  const E = eng.compute();
  const pins = E.conflictList.map(c => c.pin).sort();
  assert.deep(pins, ['PB8', 'PB9'], 'USBHS with the debug port on should conflict on exactly PB8 and PB9');

  // ...and with the debug port off it is clean. Both halves, because a file that
  // conflicted either way would pass a one-sided check.
  fresh('QFN128');
  eng.setSetting('SYS', 'Debug', 'No Debug');
  eng.setSetting('USBHS', 'Mode', 'Device (HS)');
  assert.equal(eng.compute().conflictList.length, 0, 'USBHS alone should not conflict with anything');
});

// --- 3. what reaches the generated C ----------------------------------------------
const CLOCK_MACRO = {
  USBFS: 'RCC_HBPeriph_OTG_FS',   // the SPL spells this bit OTG_FS, not USBFS
  USBHS: 'RCC_HBPeriph_USBHS',
  USBSS: 'RCC_HBPeriph_USBSS',
};

test('each USB controller reaches the generated C with its clock enable and no TODO', () => {
  const bad = [];
  for (const [pid, macro] of Object.entries(CLOCK_MACRO)) {
    fresh('QFN128');
    if (pid === 'USBHS') eng.setSetting('SYS', 'Debug', 'No Debug');
    eng.setSetting(pid, 'Mode', pid === 'USBFS' ? 'Device (FS)' : pid === 'USBHS' ? 'Device (HS)' : 'Device (SS)');
    eng.compute();
    const c = eng.cFiles()['wchcube_init.c'] || '';
    if (!c.includes(macro)) bad.push(`${pid}: the generated C does not enable its clock (${macro})`);
    if (/TODO/.test(c)) bad.push(`${pid}: the generated C carries a TODO:\n        ${(c.match(/.*TODO.*/) || [''])[0].trim()}`);
    if (/#error/.test(c)) bad.push(`${pid}: the generated C carries an #error`);
    // The pads are claimed but never driven — `codegen.skip_signals` — and the generator
    // says which, in the same line it uses for the debug pins.
    if (!/Not configured here, by design/.test(c)) {
      bad.push(`${pid}: nothing in the generated C says the USB pads are deliberately not configured`);
    }
  }
  assert.empty(bad, 'USB controllers whose generated C is wrong');
});

test('planted break: a USB controller re-declared as pinless is caught', () => {
  // Round 6, deliverable B. The literal regression this file guards - `pins: { none: true }`
  // on a controller the datasheet gives pads - planted on a re-registered COPY of the part's
  // text (tests/lib/mutant.js), and the check below must name USBFS. Restore is proved.
  const pinless = () => {
    eng.loadMcu(eng.MCU_FILES['CH32H417']);
    const bad = [];
    for (const pid of ['USBFS', 'USBHS', 'USBSS', 'USBPD']) {
      const p = (eng.M.peripherals[pid] || {}).pins || {};
      if (p.none || p.open) bad.push(`${pid}: pins.${p.none ? 'none' : 'open'}`);
    }
    return bad;
  };
  assert.empty(pinless(), 'the baseline already has a pinless USB controller, so the plant could not be attributed');
  const bad = withMutantMcu(eng, 'CH32H417',
    src => src.replace('  USBFS:\n    category: Connectivity', '  USBFS:\n    category: Connectivity\n    pins: { none: true, source: planted }'),
    pinless);
  assert.deep(bad, ['USBFS: pins.none'], `expected exactly the planted USBFS, got: ${JSON.stringify(bad)}`);
  console.log(`      planted refusal (pinless USB): ${bad[0]}`);
  assert.empty(pinless(), 'the original part was not restored after the plant');
});

test('no USB controller claims to hold no pin', () => {
  // The literal regression. `pins: { none: true }` or `pins: { open: true }` on any of
  // them, or an empty `signal_pins:`, is the shape this file exists to stop coming back.
  eng.loadMcu(eng.MCU_FILES[PART]);
  const bad = [];
  for (const pid of ['USBFS', 'USBHS', 'USBSS', 'USBPD']) {
    const P = eng.M.peripherals[pid];
    if (!P) { bad.push(`${pid} is not a peripheral of this part any more`); continue; }
    if (P.pins) bad.push(`${pid} declares \`pins: ${JSON.stringify(P.pins)}\`, but the datasheet gives it pads`);
    const n = Object.keys(P.signal_pins || {}).length;
    if (!n) bad.push(`${pid} routes no signal to any pin`);
    if (/holds no pin/i.test(P.notes || '')) bad.push(`${pid}'s notes still say it holds no pin`);
  }
  assert.empty(bad, 'USB controllers modelled as pinless');
});
