// `signal_groups:` — a NAMED SUBSET of an `af`-muxed peripheral's signals that the
// silicon moves TOGETHER under one shared field, inside a peripheral whose OTHER
// signals genuinely pick their own pin independently (agents/BOARD.md, main's P0: the
// pin-planning defect that closed SDMMC's `remaps:` restore AND UHSIF's mapping
// incoherence at once).
//
// CH32H417 UHSIF is the proven case, per AGENT-3's verification (62/62 pin candidates
// confirmed against DS Table 2-1-1, zero phantoms, zero misses — the DATA is right,
// only the MODEL was wrong): `UHSIF_PORT_RM` moves PORT0-7's eight signals as ONE
// atomic, register-valued choice — structurally identical to `SDMMC_RM`, the exact
// shape `remaps:` exists for. But `remaps:` cannot be used for the WHOLE peripheral:
// `UHSIF_CLK`'s four options are a genuinely INDEPENDENT choice (a lone signal has
// nothing else to disagree with), and PORT8-47 have exactly one candidate each (no
// choice, nothing to couple) — forcing either shape on the whole peripheral would be
// wrong for the signals that do not need it. `signal_groups:` names just the coupled
// subset; every other signal keeps ordinary independent `signal_pins:` choice,
// unchanged.
//
// The part here is invented, not UHSIF-shaped verbatim, so the mechanism cannot pass
// by being right about the one chip it was designed against — same discipline
// nested_structs.test.js and struct_call_arg.test.js use.
import { test, assert, fresh, eng } from './_harness.js';

const PART = `
mcu:
  name: SIGGRP-TEST
  family: test
  default_package: QFN8
  variants:
    A8: { package: QFN8, flash_kb: 64, sram_kb: 8, temp: 85, io_count: 8 }
packages:
  QFN8:
    1: PA0
    2: PA1
    3: PA2
    4: PA3
    5: PA4
    6: PA5
pins:
  PA0: { type: io }
  PA1: { type: io }
  PA2: { type: io }
  PA3: { type: io }
  PA4: { type: io }
  PA5: { type: io }
codegen:
  header: siggrp.h
  sdk: { synthetic: true }
  remap:
    style: af
    fn: GPIO_PinAFConfig
    macro: GPIO_AF$AF
peripherals:
  U:
    category: Connectivity
    settings:
      - name: Mode
        choices: [{ name: Disable }, { name: Enabled, signals: [P0, P1, CLK] }]
    signal_pins:
      P0: [{ pin: PA0, af: 1 }, { pin: PA2, af: 2 }]
      P1: [{ pin: PA1, af: 1 }, { pin: PA3, af: 2 }]
      CLK: [{ pin: PA4, af: 1 }, { pin: PA5, af: 1 }]
    signal_groups:
      - signals: [P0, P1]
`;

const load = () => { fresh('CH32V006'); eng.loadMcu(PART); eng.setSetting('U', 'Mode', 'Enabled'); };

test('a grouped signal defaults to index 0, uniformly across the group', () => {
  load();
  eng.compute();
  const pins = eng.signalPins('U').pins;
  assert.equal(pins.P0, 'PA0', 'P0 index 0');
  assert.equal(pins.P1, 'PA1', 'P1 index 0 - the matching index, not "first bonded" computed alone');
  assert.equal(pins.CLK, 'PA4', 'CLK is independent - unaffected by the group entirely');
});

test('setSignalPin on ONE grouped signal moves every sibling to the SAME index', () => {
  load();
  eng.compute();
  eng.setSignalPin('U', 'P0', 'PA2');   // index 1 in P0's own candidate list
  const pins = eng.signalPins('U').pins;
  assert.equal(pins.P0, 'PA2', 'P0 moved to what was asked');
  assert.equal(pins.P1, 'PA3', 'P1 followed to ITS OWN index-1 pin - the atomic move');
  assert.equal(pins.CLK, 'PA4', 'CLK is independent - a group move must not touch it');
});

test('setSignalPin on the SIBLING moves the group the other way too - it is symmetric', () => {
  load();
  eng.compute();
  eng.setSignalPin('U', 'P1', 'PA3');   // index 1, via the OTHER member this time
  const pins = eng.signalPins('U').pins;
  assert.equal(pins.P0, 'PA2', 'P0 followed P1 to index 1');
  assert.equal(pins.P1, 'PA3');
});

test('moving a grouped signal back to index 0 moves the group back too', () => {
  load();
  eng.compute();
  eng.setSignalPin('U', 'P0', 'PA2');
  eng.setSignalPin('U', 'P0', 'PA0');
  const pins = eng.signalPins('U').pins;
  assert.equal(pins.P0, 'PA0');
  assert.equal(pins.P1, 'PA1', 'back to index 0 together, not stuck at the old index');
});

test('an independent signal (CLK) never disagrees with the group and moves entirely on its own', () => {
  load();
  eng.compute();
  eng.setSignalPin('U', 'CLK', 'PA5');
  eng.setSignalPin('U', 'P0', 'PA2');
  const pins = eng.signalPins('U').pins;
  assert.equal(pins.CLK, 'PA5', 'CLK keeps its own independent choice');
  assert.equal(pins.P0, 'PA2');
  assert.equal(pins.P1, 'PA3');
});

test('the group can never be read as a combination the silicon cannot produce, even mid-sequence', () => {
  // The whole point: at no time may P0 and P1 disagree about which index they are on.
  load();
  eng.compute();
  for (const pin of ['PA2', 'PA0', 'PA2', 'PA0']) {
    eng.setSignalPin('U', 'P0', pin);
    const pins = eng.signalPins('U').pins;
    const idxOf = p => (p === 'PA0' || p === 'PA1' ? 0 : 1);
    assert.equal(idxOf(pins.P0), idxOf(pins.P1),
      `P0=${pins.P0} P1=${pins.P1} must be the SAME index at every step`);
  }
});

test('previewAssign catches a collision through a SIBLING, not only on the clicked pin', () => {
  // PA3 (P1's index-1 pin) is claimed by a manual GPIO output. Clicking P0 onto PA2
  // (its OWN index-1 pin, itself free) must still warn, because choosing it drags P1
  // onto PA3 in the same move - the exact "no sibling to drag along" assumption this
  // mechanism is the one exception to.
  load();
  eng.assignSignal('PA3', { gpio: 'GPIO_Output' });
  eng.compute();
  const warn = eng.previewAssign('PA2', { periph: 'U', signal: 'P0' });
  assert.match(warn, /remap collides on PA3/, `expected a collision warning, got: "${warn}"`);
});

test('previewAssign stays silent when the sibling pin the move implies is genuinely free', () => {
  load();
  eng.compute();
  const warn = eng.previewAssign('PA2', { periph: 'U', signal: 'P0' });
  assert.equal(warn, '', `expected no warning, got: "${warn}"`);
});

test('the conflict engine sees the moved pins for real - the freed pin is free, the new one is claimed', () => {
  load();
  eng.compute();
  eng.setSignalPin('U', 'P0', 'PA2');
  const r = eng.compute();
  assert.equal(r.pins.PA2.claims.some(c => c.who === 'U'), true, 'PA2 is genuinely claimed now');
  assert.equal(((r.pins.PA0 || {}).claims || []).some(c => c.who === 'U'), false, 'PA0 is genuinely freed, not double-claimed');
});
