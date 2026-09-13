// tests/hostile.test.js — a fixture built to be HOSTILE, not merely big.
//
// `WCH-DUMMY32-C8` is a SIZE stress test: every package up to LQFP144, three GPIO
// speeds, a different NVIC scheme — all well-formed, all things the app should
// handle gracefully because they are things a real part could ask for. Nothing in
// the suite has ever fed the engine a part designed to break it: a physically
// shorted pair claimed under two different names, a peripheral whose only pad does
// not exist on the package it is running under, a clock the file's own numbers say
// cannot run, a constraint that refuses the one mode a peripheral claim always
// resolves to. AGENT-2's own rule is "every choice the app offers must be one the
// silicon can honour" — this is the half of that rule nothing tested: the REFUSING.
//
// Five properties, five independent peripherals/pins, so a failure in one can never
// mask or be masked by another. Each test asserts what the engine SHOULD do —
// refuse, warn, or degrade — never merely that `compute()` did not throw; a check
// that only proves "no crash" would pass on a part that silently generated wrong C
// just as readily as on one that refused correctly, which is not a distinction this
// repository is willing to lose.
//
// Registered with registerMcuFile() inside each test and never written to
// tests/fixtures/mcus/: a file there is swept by every "every shipped part" test in
// the suite (glossary.test.js, power.test.js, model.test.js, smoke.js, data.test.js…)
// and this part is deliberately not well-formed by their standards — it has no
// vendor datasheet, no coverage entry, one setting per peripheral and nothing else.
// `fresh()` clears the MCU registry and reloads only real DISK files before each
// test, so this synthetic part never leaks into another file's sweep, the same way
// `afmux.test.js`/`clockmux.test.js`/`analog.test.js` already keep their own
// synthetic parts invisible to everything but themselves.
import { test, assert, fresh } from '../app/tests/_harness.js';

// ---- the five hostile properties, one peripheral/pin/pair each -------------------
//
//   HOSTILE_SHORT_1 / HOSTILE_SHORT_2   PA2 and PB0 are the SAME physical pad (pin 3
//                                       lists both names, exactly how CH32V006 shorts
//                                       PD7/PA4) — enabling both must conflict, not
//                                       silently let the second claim win.
//   VSS_PAD                             pin "0", type ground, on every package,
//                                       claimed by nothing — the exposed-pad shape.
//   HOSTILE_NOMAP                       its one signal's only pad (PA3) exists on BIG
//                                       and not on SMALL — selecting SMALL must refuse
//                                       it, not claim a pin that is not bonded.
//   clock.sysclk.max_mhz: 48            below the FIXED (non-editable) HSI's 64 MHz —
//                                       there is no configuration that avoids this, so
//                                       the engine must say so unconditionally.
//   HOSTILE_CONSTRAINED                 its one signal claims PA1, which any
//                                       peripheral claim resolves to "Alternate
//                                       Function Push Pull" for (gpioEffectiveMode()) —
//                                       and a constraint refuses exactly that mode on
//                                       exactly that pin.
const HOSTILE = `
mcu:
  name: WCH-HOSTILE-X1
  vendor: WCH (test fixture, invented for tests/hostile.test.js)
  family: HOSTILE
  default_package: BIG
packages:
  BIG:
    0: VSS_PAD
    1: PA0
    2: PA1
    3: [PA2, PB0]
    4: PA3
  SMALL:
    0: VSS_PAD
    1: PA0
    2: PA1
    3: [PA2, PB0]
pins:
  VSS_PAD: { type: ground }
  PA0: { type: io }
  PA1: { type: io }
  PA2: { type: io }
  PB0: { type: io }
  PA3: { type: io }
gpio:
  modes:
    - { name: Output Push Pull,             macro: GPIO_Mode_Out_PP }
    - { name: Alternate Function Push Pull, macro: GPIO_Mode_AF_PP }
    - { name: Analog,                       macro: GPIO_Mode_AIN }
  input_modes:
    - { name: No pull,   macro: GPIO_Mode_IN_FLOATING }
    - { name: Pull-up,   macro: GPIO_Mode_IPU }
    - { name: Pull-down, macro: GPIO_Mode_IPD }
clock:
  sources:
    HSI: { mhz: 64, fixed: true }
  sysclk:
    sources: [HSI]
    max_mhz: 48
constraints:
  - id: no-af-on-pa1
    option: gpio.mode
    choices: [Alternate Function Push Pull]
    not_on: [PA1]
    reason: "PA1 must never be an alternate-function pin (test fixture)."
    source: "hostile fixture, invented for tests/hostile.test.js"
peripherals:
  HOSTILE_SHORT_1:
    category: Test
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: Enabled, signals: [SIG] }
    signal_pins:
      SIG: [{ pin: PA2 }]
  HOSTILE_SHORT_2:
    category: Test
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: Enabled, signals: [SIG] }
    signal_pins:
      SIG: [{ pin: PB0 }]
  HOSTILE_NOMAP:
    category: Test
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: Enabled, signals: [SIG] }
    signal_pins:
      SIG: [{ pin: PA3 }]
  HOSTILE_CONSTRAINED:
    category: Test
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: Enabled, signals: [SIG] }
    signal_pins:
      SIG: [{ pin: PA1 }]
`;

/** A fresh engine with the hostile part loaded and, optionally, a package chosen. */
function withHostile(pkg) {
  const e = fresh();                    // real registry cleared, real packages loaded
  e.registerMcuFile(HOSTILE);
  e.loadMcu('WCH-HOSTILE-X1');
  if (pkg) e.setPackage(pkg);
  e.compute();
  return e;
}

test('shorted pins: two peripherals on the two names of one physical pad conflict, not "last write wins"', () => {
  const e = withHostile('BIG');
  e.setSetting('HOSTILE_SHORT_1', 'Mode', 'Enabled');
  e.setSetting('HOSTILE_SHORT_2', 'Mode', 'Enabled');
  e.compute();
  // PA2 is the canonical name for the shorted pair (names[0] of the pin-3 list).
  const pin = e.E.pins.PA2;
  assert.ok(pin, 'the shorted pad PA2/PB0 has no entry in E.pins at all');
  assert.equal(pin.state, 'conflict',
    `PA2/PB0 (one physical pad under two names) did not conflict: ${JSON.stringify(pin)}`);
  const who = [...new Set(pin.claims.map(c => c.who))].sort();
  assert.deepEqual(who, ['HOSTILE_SHORT_1', 'HOSTILE_SHORT_2']);
  assert.equal(e.E.status.HOSTILE_SHORT_1, 'warn');
  assert.equal(e.E.status.HOSTILE_SHORT_2, 'warn');
});

test('exposed pad: pin "0" is typed ground, claims nothing, and sorts last in the pin table', () => {
  const e = withHostile('BIG');
  assert.equal(e.pinType('VSS_PAD'), 'ground');
  assert.ok(!Object.values(e.E.pins.VSS_PAD || {}).length || !(e.E.pins.VSS_PAD || {}).claims?.length,
    'the exposed pad must start with no claims');
  const rows = e.pinRows();
  const last = rows[rows.length - 1];
  assert.equal(last.name, 'VSS_PAD',
    `the exposed pad did not sort last: ${JSON.stringify(rows.map(r => r.name))}`);
  assert.equal(last.num, '', 'the exposed pad must print no pin number, the same as a real QFN pad');
});

test('no usable mapping: a peripheral whose only pad is missing from the selected package is refused, not silently claimed', () => {
  const e = withHostile('SMALL');
  e.setSetting('HOSTILE_NOMAP', 'Mode', 'Enabled');
  e.compute();
  const issues = e.E.issues.HOSTILE_NOMAP || [];
  assert.ok(issues.some(m => /not bonded on/.test(m)),
    `expected a "not bonded" issue for HOSTILE_NOMAP, got: ${JSON.stringify(issues)}`);
  // 'na', not 'warn': isAvailable() (model.js) checks whether ANY choice's signals can
  // ALL be bonded on this package before compute() ever runs, and correctly says no -
  // a MORE precise classification than a generic warning, since this peripheral cannot
  // be made to work on SMALL by any setting the user could choose, not just the default.
  assert.equal(e.E.status.HOSTILE_NOMAP, 'na');
  const claimedAnywhere = Object.values(e.E.pins).some(p => p.claims.some(c => c.who === 'HOSTILE_NOMAP'));
  assert.ok(!claimedAnywhere,
    'HOSTILE_NOMAP must not hold a claim on a package where its only pad does not exist');
});

test('out-of-spec clock: a FIXED oscillator above sysclk.max_mhz is reported OVER unconditionally', () => {
  const e = withHostile('BIG');
  const c = e.clockCalc();
  assert.ok(c.over.includes('SYSCLK'),
    `expected SYSCLK in the over-specification list, got: ${JSON.stringify(c.over)}`);
  assert.equal(c.SYSCLK, 64, 'HSI is fixed, so SYSCLK must compute to exactly what the file states');
  // There is no user choice that fixes this - HSI is the only source and it is fixed:true -
  // so the file itself is the thing that must be flagged, which `over` does unconditionally.
});

test('a constraint that excludes a pin a peripheral claim requires is reported, not silently overridden', () => {
  const e = withHostile('BIG');
  e.setSetting('HOSTILE_CONSTRAINED', 'Mode', 'Enabled');
  e.compute();
  const issues = e.E.issues.HOSTILE_CONSTRAINED || [];
  assert.ok(issues.some(m => /PA1 must never be an alternate-function pin/.test(m)),
    `expected the constraint's own reason in HOSTILE_CONSTRAINED's issues, got: ${JSON.stringify(issues)}`);
  assert.equal(e.E.status.HOSTILE_CONSTRAINED, 'warn');
  // Same rule enforced where a user overriding the pin manually would meet it: the GPIO
  // table's own mode column must not OFFER a mode the constraint refuses on this pin.
  assert.ok(!e.gpioFieldOptions('PA1', 'mode').includes('Alternate Function Push Pull'),
    'the GPIO mode column on PA1 still offers a mode the constraint refuses');
});
