// Per-pin alternate-function muxing — the THIRD pin-mux shape, beside `remaps:` with
// an AFIO field (CH32V003/V005/V006) and `remaps:` with a macro (CH32X035).
//
// The shape under test is `data/FORMAT.md` `## signal_pins` — a peripheral key
// `signal_pins: { <signal>: [{ pin, af }, ...] }` plus `codegen.remap.style: af`.
// Each signal picks its OWN pin; there is no index that moves them together.
//
// The part is invented here rather than taken from `data/mcus/`, for the same reason
// `constraint.test.js` invents one: the mechanism must be part-agnostic, and a test
// written against the only part that has the feature cannot tell "it works" from
// "it works on that part". `tests/afmux.test.js` audits the shipped data instead.
//
// THE REGRESSION HALF IS IN HERE TOO, and it is the more important half: a part with
// no `signal_pins:` must behave exactly as it did before the key existed.
import { test, assert, fresh, eng } from './_harness.js';

// Two peripherals share PA0 and PA1 so a collision is reachable, and USART1_TX lists
// three pins while USART1_RX lists two — the asymmetry is the point, because a
// `remaps:` list cannot express two signals with different numbers of options.
const PART = `
mcu:
  name: AFMUX-TEST
  family: test
  default_package: QFN32
  variants:
    A32: { package: QFN32, flash_kb: 64, sram_kb: 8, temp: 85, io_count: 32 }
    A20: { package: QFN20, flash_kb: 64, sram_kb: 8, temp: 85, io_count: 20 }

packages:
  QFN32:
${Array.from({ length: 32 }, (_, i) => `    ${i + 1}: P${'AB'[Math.floor(i / 16)]}${i % 16}`).join('\n')}
  # QFN20 drops PB4..PB15, so USART1_TX's third option and SPI1_MOSI's only option
  # fall off the package. That is what makes the "default to a BONDED pin" rule and
  # isAvailable() testable without the engine knowing a package name.
  QFN20:
${Array.from({ length: 20 }, (_, i) => `    ${i + 1}: P${'AB'[Math.floor(i / 16)]}${i % 16}`).join('\n')}

pins:
${Array.from({ length: 32 }, (_, i) => `  P${'AB'[Math.floor(i / 16)]}${i % 16}: { type: io }`).join('\n')}

peripherals:
  USART1:
    category: Connectivity
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: Asynchronous, signals: [TX, RX] }
          - { name: Transmit only, signals: [TX] }
    signal_pins:
      TX: [{ pin: PA0, af: 7 }, { pin: PA9, af: 7 }, { pin: PB6, af: 4 }]
      RX: [{ pin: PA1, af: 7 }, { pin: PA10, af: 7 }]
  SPI1:
    category: Connectivity
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: Full-Duplex Master, signals: [SCK, MOSI] }
    signal_pins:
      SCK: [{ pin: PA0, af: 5 }, { pin: PA5, af: 5 }]
      # No af: key at all, deliberately: codegen must refuse to guess one.
      MOSI: [{ pin: PB7 }]

codegen:
  header: aftest.h
  sdk: { synthetic: true }
  gpio_clock: { fn: RCC_APB2PeriphClockCmd, port: RCC_APB2Periph_GPIO$PORT }
  speeds: { "50 MHz": GPIO_Speed_50MHz }
  remap:
    style: af
    fn: GPIO_PinAFConfig
    macro: GPIO_AF$AF
  init_structs:
    GPIO_InitTypeDef: { fn: GPIO_Init }

gpio:
  speeds:
    - { name: "50 MHz", macro: GPIO_Speed_50MHz }
  modes:
    - { name: Output Push Pull, macro: GPIO_Mode_Out_PP, class: out }
    - { name: Alternate Function Push Pull, macro: GPIO_Mode_AF_PP, class: out }
    - { name: Analog, macro: GPIO_Mode_AIN, class: analog }
  input_modes:
    - { name: No pull, macro: GPIO_Mode_IN_FLOATING }
`;

const load = (pkg = 'QFN32') => { fresh('CH32V006'); eng.loadMcu(PART); if (pkg !== 'QFN32') eng.setPackage(pkg); };

// ---- the data reaches the model ----------------------------------------------

test('signal_pins is read as a per-signal option list, not a remap', () => {
  load();
  assert.equal(eng.isAfMuxed('USART1'), true);
  assert.equal(eng.isAfMuxed('SPI1'), true);
  assert.deepEqual(eng.signalPinOptions('USART1', 'TX'),
    [{ pin: 'PA0', af: 7 }, { pin: 'PA9', af: 7 }, { pin: 'PB6', af: 4 }]);
  // Two signals of one peripheral with DIFFERENT numbers of options is the case a
  // `remaps:` list cannot hold: every remap must offer the same signal keys.
  assert.equal(eng.signalPinOptions('USART1', 'RX').length, 2);
  assert.equal(eng.signalPinDefs('USART1').TX.length, 3);
  assert.equal(eng.signalPinDefs('SPI1').MOSI[0].af, undefined);
  assert.equal(eng.signalAf('USART1', 'TX', 'PB6'), 4);
  assert.equal(eng.signalAf('SPI1', 'MOSI', 'PB7'), null, 'no af: in the data means null, not a guess');
});

test('every pin an AF signal can reach offers it in the picker', () => {
  load();
  const on = pin => (eng.M._pinSignals[pin] || []).map(s => `${s.periph}_${s.signal}`);
  assert.deepEqual(on('PB6'), ['USART1_TX']);
  assert.deepEqual(on('PA10'), ['USART1_RX']);
  // PA0 carries two different peripherals' signals — the collision this test needs.
  assert.deepEqual(on('PA0').sort(), ['SPI1_SCK', 'USART1_TX']);
  assert.equal((eng.M._pinSignals['PA0'] || [])[0].remap, undefined, 'an AF entry carries af, not a remap index');
});

// ---- signals move independently ----------------------------------------------

test('moving one signal leaves its siblings where they were', () => {
  load();
  eng.setSetting('USART1', 'Mode', 'Asynchronous');
  assert.deepEqual(eng.signalPins('USART1').pins, { TX: 'PA0', RX: 'PA1' });

  eng.setSignalPin('USART1', 'TX', 'PB6');
  assert.deepEqual(eng.signalPins('USART1').pins, { TX: 'PB6', RX: 'PA1' },
    'RX must not follow TX — that is the whole difference from a remap');

  eng.setSignalPin('USART1', 'RX', 'PA10');
  assert.deepEqual(eng.signalPins('USART1').pins, { TX: 'PB6', RX: 'PA10' });
});

test('a pin the data does not list for that signal is refused by name', () => {
  load();
  assert.throws(() => eng.setSignalPin('USART1', 'TX', 'PA5'), /PA5.*PA0, PA9, PB6/);
  assert.throws(() => eng.setSignalPin('USART1', 'CTS', 'PA0'), /no signal_pins entry/);
});

test('clicking a pin in the picker moves only that signal', () => {
  load();
  eng.setSetting('USART1', 'Mode', 'Asynchronous');
  eng.assignSignal('PA9', { periph: 'USART1', signal: 'TX' });
  assert.deepEqual(eng.signalPins('USART1').pins, { TX: 'PA9', RX: 'PA1' });
});

test('the conflict engine sees an AF collision and both owners are named', () => {
  load();
  eng.setSetting('USART1', 'Mode', 'Transmit only');   // TX defaults to PA0
  eng.setSetting('SPI1', 'Mode', 'Full-Duplex Master'); // SCK defaults to PA0 too
  const e = eng.compute();
  assert.equal(e.pins['PA0'].state, 'conflict');
  assert.ok(e.issues['USART1'].some(t => /PA0/.test(t)), 'USART1 is told');
  assert.ok(e.issues['SPI1'].some(t => /PA0/.test(t)), 'SPI1 is told');

  // ...and moving ONE signal clears it, without touching the other peripheral.
  eng.setSignalPin('SPI1', 'SCK', 'PA5');
  const e2 = eng.compute();
  assert.equal(e2.pins['PA0'].state, 'set');
  assert.equal(e2.pins['PA5'].state, 'set');
  assert.equal(e2.conflictList.length, 0);
});

test('previewAssign warns about the clicked pin only', () => {
  load();
  eng.setSetting('SPI1', 'Mode', 'Full-Duplex Master');   // SCK on PA0
  eng.compute();
  assert.equal(eng.previewAssign('PA0', { periph: 'USART1', signal: 'TX' }), 'pin in use');
  // A remap part would answer "remap collides on ..." here because the siblings move
  // with it. An AF signal moves alone, so a free pin is simply free.
  assert.equal(eng.previewAssign('PA9', { periph: 'USART1', signal: 'TX' }), '');
});

// ---- packages -----------------------------------------------------------------

test('a signal defaults to a BONDED pin, and availability is per signal', () => {
  load('QFN20');                      // PB4..PB15 are gone
  eng.setSetting('USART1', 'Mode', 'Asynchronous');
  assert.deepEqual(eng.signalPins('USART1').pins, { TX: 'PA0', RX: 'PA1' });
  assert.equal(eng.isAvailable('USART1'), true, 'TX and RX both still have bonded pins');
  // SPI1_MOSI has exactly one pin and it is not bonded here, so the peripheral is not
  // usable — but USART1 above still is, which a remap-shaped test could not separate.
  assert.equal(eng.isAvailable('SPI1'), false);
});

test('a pin that falls off the package is reported, not silently kept', () => {
  load();
  eng.setSetting('USART1', 'Mode', 'Transmit only');
  eng.setSignalPin('USART1', 'TX', 'PB6');
  eng.setPackage('QFN20');
  const e = eng.compute();
  assert.ok((e.issues['USART1'] || []).some(t => /PB6.*not bonded/.test(t)),
    'the chosen pin is gone and the engine says so');
});

// ---- codegen ------------------------------------------------------------------

test('codegen emits one GPIO_PinAFConfig per signal, and refuses to guess a missing AF', () => {
  load();
  eng.setSetting('USART1', 'Mode', 'Asynchronous');
  eng.setSignalPin('USART1', 'TX', 'PB6');
  const plan = eng.afPlan();
  assert.equal(plan.style, 'af');
  assert.deepEqual(plan.calls.map(c => `${c.pin}:AF${c.af}`), ['PA1:AF7', 'PB6:AF4']);

  eng.compute();                       // cSource() reads the last compute(), as the UI does
  const c = eng.cSource();
  assert.match(c, /GPIO_PinAFConfig\(GPIOB, GPIO_PinSource6, GPIO_AF4\);\s+\/\* PB6 — USART1_TX \*\//);
  assert.match(c, /GPIO_PinAFConfig\(GPIOA, GPIO_PinSource1, GPIO_AF7\);\s+\/\* PA1 — USART1_RX \*\//);
  assert.ok(!/AFIO->PCFR1/.test(c), 'an AF part writes no AFIO remap word');

  // SPI1_MOSI lists a pin but no `af:`. That must become a named TODO rather than a
  // plausible number — the same rule that stops the generator inventing a mode macro.
  eng.setSetting('SPI1', 'Mode', 'Full-Duplex Master');
  eng.compute();
  const c2 = eng.cSource();
  assert.equal(eng.afPlan().missing.map(m => m.pin).join(), 'PB7');
  assert.match(c2, /TODO: alternate function select[\s\S]*states no `af:`[\s\S]*PB7: SPI1_MOSI/);
});

test('the project round-trips a chosen pin and drops one the part no longer lists', () => {
  load();
  eng.setSetting('USART1', 'Mode', 'Asynchronous');
  eng.setSignalPin('USART1', 'TX', 'PA9');
  const saved = eng.projectSerialize();
  assert.match(saved, /af_pins:/);
  assert.ok(!/SPI1:[\s\S]{0,120}af_pins/.test(saved), 'a signal nobody moved is not written');

  load();
  const opened = eng.projectApply(saved);
  assert.deepEqual(eng.signalPins('USART1').pins, { TX: 'PA9', RX: 'PA1' });
  assert.deepEqual(opened.warnings, []);

  // A file naming a pin the data does not list opens WITHOUT a console error and says
  // what it dropped — the same contract gpioSpeedFor() applies to a stale speed.
  load();
  const drops = eng.projectApply(saved.replace('TX: PA9', 'TX: PA3')).warnings;
  assert.equal(drops.length, 1, 'exactly one thing was dropped');
  assert.match(drops[0], /USART1_TX: PA3 is not one of PA0, PA9, PB6/);
  assert.equal(eng.signalPins('USART1').pins.TX, 'PA0', 'and falls back to the default');
});

// ---- the regression half ------------------------------------------------------

test('a part with no signal_pins is untouched by any of this', () => {
  for (const name of ['CH32V003', 'CH32V005', 'CH32V006', 'CH32X035']) {
    fresh(name);
    for (const pid of Object.keys(eng.M.peripherals)) {
      assert.equal(eng.isAfMuxed(pid), false, `${name}.${pid} must not look AF-muxed`);
      assert.equal(eng.signalPinDefs(pid), null);
      assert.deepEqual(eng.signalPinOptions(pid, 'TX'), []);
      // signalPins() must return the SAME object the old code read directly, so every
      // downstream reader sees byte-identical input.
      const P = eng.M.peripherals[pid];
      const sel = (P.remaps || [])[eng.S.periph[pid].remap];
      // Identity, not deep equality: a remap part must get back the very object the
      // old code read, so nothing downstream can see a copy that drifted.
      if (sel) assert.equal(eng.signalPins(pid), sel, `${name}.${pid}: not the same remap object`);
      else assert.deepEqual(eng.signalPins(pid), { pins: {} }, `${name}.${pid}: no remaps means no pins`);
    }
    assert.deepEqual(eng.afPlan(), { style: null, fn: null, calls: [], missing: [] },
      `${name} must produce no AF plan at all`);
    assert.ok(!/GPIO_PinAFConfig/.test(eng.cSource()), `${name} must emit no AF call`);
  }
});

test('the AF path can fail: take signal_pins away and the mechanism goes quiet', () => {
  fresh('CH32V006');
  eng.loadMcu(PART.replace(/    style: af\n/, '    style: register\n'));
  eng.setSetting('USART1', 'Mode', 'Asynchronous');
  // The pins still resolve — signal_pins is still there — but nothing is EMITTED,
  // because `style: af` is what turns the emitter on. Without this assertion the
  // codegen test above would pass for a part that never declared the style.
  assert.deepEqual(eng.signalPins('USART1').pins, { TX: 'PA0', RX: 'PA1' });
  assert.equal(eng.afPlan().calls.length, 0);
  eng.compute();
  assert.ok(!/GPIO_PinAFConfig/.test(eng.cSource()));
});
