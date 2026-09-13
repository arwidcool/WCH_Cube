// engine.js — the conflict engine. This is the feature the whole app exists for,
// so every branch of compute() has a case here.
import { test, assert, fresh, rng } from './_harness.js';

const pinsOf = (e, pid) => Object.entries(e.E.pins)
  .filter(([, v]) => v.claims.some(c => c.who === pid)).map(([k]) => k).sort();

test('a freshly opened part has no conflicts', () => {
  const e = fresh();
  assert.deepEqual(e.E.conflicts, []);
  assert.deepEqual(e.E.conflictList, []);
});

test('reset-default SYS signals claim their pins (SWIO on PD1, RST on PD7)', () => {
  const e = fresh();
  assert.equal(e.E.pins.PD1.label, 'SYS_SWIO');
  assert.equal(e.E.pins.PD7.label, 'SYS_RST');
  assert.equal(e.E.pins.PD7.state, 'set');
});

test('two peripherals on one pin is a conflict on both', () => {
  const e = fresh();
  e.S.periph.USART1.settings.Mode = 'Asynchronous';
  e.S.periph.USART1.remap = 4;                       // 0100: TX PD1, RX PB3
  e.compute();
  const pd1 = e.E.pins.PD1;
  assert.equal(pd1.state, 'conflict');
  assert.deepEqual([...new Set(pd1.claims.map(c => c.who))].sort(), ['SYS', 'USART1']);
  assert.equal(e.E.conflictList.length, 1);
  assert.equal(e.E.conflictList[0].pin, 'PD1');
  assert.equal(e.E.conflictList[0].shorted, false);
  assert.ok(e.E.issues.USART1.some(m => /conflicts with/.test(m)));
  assert.ok(e.E.issues.SYS.some(m => /conflicts with/.test(m)));
  assert.equal(e.E.status.USART1, 'warn');
});

test('a signal routed to a pin the package does not bond is reported, not claimed', () => {
  const e = fresh();                                  // TSSOP20 has no PB3
  e.S.periph.USART1.settings.Mode = 'Asynchronous';
  e.S.periph.USART1.remap = 4;                        // RX -> PB3
  e.compute();
  assert.ok(e.E.issues.USART1.some(m => m.includes('RX needs PB3') && m.includes('TSSOP20')));
  assert.equal(e.E.pins.PB3, undefined);
});

test('a signal missing from the selected remap is reported', () => {
  const e = fresh();
  e.S.periph.SPI1.settings.Mode = 'Full-Duplex Master';
  e.S.periph.SPI1.settings['Hardware NSS Signal'] = 'Hardware NSS Output';
  e.S.periph.SPI1.remap = 0;
  e.M.peripherals.SPI1.remaps[0].pins.NSS = undefined;   // simulate an unrouted signal
  delete e.M.peripherals.SPI1.remaps[0].pins.NSS;
  e.compute();
  assert.ok(e.E.issues.SPI1.some(m => m.startsWith('NSS: not routed in')));
});

test('one peripheral using one pin twice is not a conflict', () => {
  const e = fresh();
  e.S.periph.ADC1.settings.Channels.add('IN0');                                  // IN0 -> PA2
  e.S.periph.ADC1.settings['Injected group external trigger'] = 'External pin PA2 (ETRGINJ_RM=1)'; // IETR1 -> PA2
  e.compute();
  const pa2 = e.E.pins.PA2;
  assert.equal(pa2.claims.length, 2);
  assert.equal(pa2.state, 'set');
  assert.equal(pa2.label, 'ADC1_IN0 / ADC1_IETR1');
  assert.deepEqual(e.E.conflicts, []);
});

test('shorted pins collide with each other and say so', () => {
  const e = fresh();                                   // PD7 already carries SYS_RST
  e.assignSignal('PA4', { gpio: 'GPIO_Output' });       // PA4 is the same physical pin
  e.compute();
  const c = e.E.conflictList.find(x => x.pin === 'PD7');
  assert.ok(c, 'expected a conflict on the PD7/PA4 pin');
  assert.equal(c.shorted, true);
  assert.equal(c.label, 'PD7/PA4');
  assert.deepEqual(c.owners.sort(), ['GPIO', 'SYS']);
  assert.ok(e.E.issues.SYS.some(m => m.includes('shorted inside the package')));
});

test('the same pin under its other name is still one claim', () => {
  const e = fresh();
  e.assignSignal('PD7', { gpio: 'GPIO_Output' });
  e.assignSignal('PA4', { gpio: 'GPIO_Input' });        // must replace, not stack
  e.compute();
  assert.equal(e.S.manual.PD7, undefined);
  assert.equal(e.S.manual.PA4, 'GPIO_Input');
  assert.equal(e.E.pins.PD7.claims.filter(c => c.who === 'GPIO').length, 1);
});

test('assignSignal turns the peripheral on and selects the remap that routes the pin', () => {
  const e = fresh();
  e.assignSignal('PC0', { periph: 'USART1', signal: 'TX', remap: 3 });   // 0011: TX PC0, RX PC1
  e.compute();
  assert.equal(e.S.periph.USART1.remap, 3);
  assert.equal(e.S.periph.USART1.settings.Mode, 'Asynchronous');
  assert.deepEqual(pinsOf(e, 'USART1'), ['PC0', 'PC1']);
  assert.equal(e.S.sel, 'USART1');
});

test('previewAssign warns before the click', () => {
  const e = fresh();
  // PD1 carries SYS_SWIO out of reset
  assert.equal(e.previewAssign('PD1', { periph: 'USART1', signal: 'TX', remap: 4 }), 'pin in use');
  assert.equal(e.previewAssign('PD1', { gpio: 'GPIO_Output' }), 'pin in use');
  assert.equal(e.previewAssign('PC0', { periph: 'USART1', signal: 'TX', remap: 3 }), '');
});

test('previewAssign warns when the remap switch would drag other signals onto taken pins', () => {
  const e = fresh();
  e.assignSignal('PC0', { periph: 'USART1', signal: 'TX', remap: 3 });   // USART1 on PC0/PC1
  e.assignSignal('PD6', { gpio: 'GPIO_Output' });
  e.compute();
  // remap 0 puts TX on PD5 and RX on PD6 — PD6 is taken by the GPIO
  const warn = e.previewAssign('PD5', { periph: 'USART1', signal: 'TX', remap: 0 });
  assert.equal(warn, 'remap collides on PD6');
});

test('resetPin frees the pin and switches the owning choice off', () => {
  const e = fresh();
  e.assignSignal('PC0', { periph: 'USART1', signal: 'TX', remap: 3 });
  e.compute();
  assert.equal(e.E.pins.PC0.label, 'USART1_TX');
  e.resetPin('PC0');
  e.compute();
  assert.equal(e.E.pins.PC0, undefined);
  assert.equal(e.S.periph.USART1.settings.Mode, 'Disable');
});

test('resetPin frees a pin whose owning choice is the reset default (RST on PD7)', () => {
  const e = fresh();
  assert.equal(e.E.pins.PD7.label, 'SYS_RST');
  e.resetPin('PD7');                                    // = option byte RST_MODE=11, pin is GPIO
  e.compute();
  assert.equal(e.E.pins.PD7, undefined, 'PD7 must be free after a reset');
  assert.ok(/RST disabled/.test(e.S.periph.SYS.settings['External reset pin']));
});

test('resetPin clears both names of a shorted pin', () => {
  const e = fresh();
  e.assignSignal('PA4', { gpio: 'GPIO_Output' });
  e.compute();
  e.resetPin('PD7');
  e.compute();
  assert.equal(e.S.manual.PA4, undefined);
  assert.equal(e.S.gpio.PA4, undefined);
  assert.equal(e.E.pins.PD7, undefined);
});

test('resetPin clears one checkbox choice without touching the others', () => {
  const e = fresh();
  e.S.periph.ADC1.settings.Channels.add('IN5');         // PD5
  e.S.periph.ADC1.settings.Channels.add('IN6');         // PD6
  e.compute();
  e.resetPin('PD5');
  e.compute();
  assert.deepEqual([...e.S.periph.ADC1.settings.Channels], ['IN6']);
  assert.equal(e.E.pins.PD6.label, 'ADC1_IN6');
});

test('switching package re-checks everything', () => {
  const e = fresh();
  e.assignSignal('PD5', { periph: 'USART1', signal: 'TX', remap: 0 });  // TX PD5, RX PD6
  e.compute();
  assert.deepEqual(e.E.issues.USART1, undefined);
  e.setPackage('QFN12');                                                // no PD5, no PD6
  e.compute();
  assert.equal(e.E.issues.USART1.length, 2);
  assert.ok(e.E.issues.USART1.every(m => /not bonded on QFN12/.test(m)));
  assert.equal(e.E.status.USART1, 'warn');
});

test('a peripheral with no usable mapping on the package reports na', () => {
  const e = fresh('CH32V006', 'QFN12');
  assert.equal(e.isAvailable('USART1'), true, 'USART1 reaches PD0/PD1 on QFN12');
  assert.equal(e.isAvailable('I2C1'), true, 'I2C1 reaches PD0/PD1 on QFN12');
  // TKEY channels are all on pins QFN12 does not bond
  const na = Object.keys(e.M.peripherals).filter(p => !e.isAvailable(p));
  for (const p of na) assert.equal(e.E.status[p], 'na');
});

test('peripherals with no remap table are always available', () => {
  const e = fresh();
  assert.equal(e.isAvailable('DMA1'), true);
  assert.equal(e.isAvailable('IWDG'), true);
});

test('status is ok / warn / na / empty and issueCount agrees with issues', () => {
  const e = fresh();
  e.S.periph.USART1.settings.Mode = 'Asynchronous';
  e.S.periph.USART1.remap = 4;
  e.compute();
  for (const [pid, n] of Object.entries(e.E.issueCount)) {
    assert.equal(n, (e.E.issues[pid] || []).length, `${pid} issueCount`);
  }
  assert.equal(e.E.status.DMA1, '');
  e.S.periph.DMA1.settings.Mode = 'Activated (7 channels)';
  e.compute();
  assert.equal(e.E.status.DMA1, 'ok');
});

test('fuzz: random assignments never throw and keep E consistent', () => {
  const e = fresh();
  const rand = rng(20260911);
  for (const mcu of Object.keys(e.MCU_FILES)) {
    e.loadMcu(e.MCU_FILES[mcu]);
    for (const pkg of Object.keys(e.M.packages)) {
      e.setPackage(pkg);
      const pins = Object.values(e.pkgPins()).map(g => g[0]).filter(n => e.pinType(n) === 'io');
      for (let i = 0; i < 200; i++) {
        const pin = pins[Math.floor(rand() * pins.length)];
        const opts = (e.M._pinSignals[pin] || []).map(s => ({ periph: s.periph, signal: s.signal, remap: s.remap }));
        const r = rand();
        if (r < 0.25 || !opts.length) e.assignSignal(pin, { gpio: e.GPIO_SIGS[Math.floor(rand() * 4)] });
        else if (r < 0.85) e.assignSignal(pin, opts[Math.floor(rand() * opts.length)]);
        else { e.compute(); e.resetPin(pin); }
        const E = e.compute();
        for (const [p, v] of Object.entries(E.pins)) {
          const owners = new Set(v.claims.map(c => c.who));
          if (v.state === 'conflict') assert.ok(owners.size >= 2, `${mcu} ${pkg} ${p}: conflict with ${owners.size} owner(s)`);
          else assert.equal(owners.size, 1, `${mcu} ${pkg} ${p}: set pin with ${owners.size} owners`);
          assert.equal(e.canon(p), p, `${mcu} ${pkg}: ${p} is not a canonical pin name`);
        }
      }
    }
  }
});

test('compute() stays under 5 ms on the biggest bundled package', () => {
  const e = fresh();
  let worst = 0, worstWhere = '';
  for (const mcu of Object.keys(e.MCU_FILES)) {
    e.loadMcu(e.MCU_FILES[mcu]);
    const biggest = Object.keys(e.M.packages).sort((a, b) => Object.keys(e.M._phys[b]).length - Object.keys(e.M._phys[a]).length)[0];
    e.setPackage(biggest);
    for (const pid of Object.keys(e.M.peripherals)) {            // switch everything on
      for (const s of e.M.peripherals[pid].settings || []) {
        const c = s.choices[s.choices.length - 1];
        if (s.type === 'checkboxes') for (const ch of s.choices) e.S.periph[pid].settings[s.name].add(ch.name);
        else e.S.periph[pid].settings[s.name] = c.name;
      }
    }
    e.compute();
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) e.compute();
    const per = (performance.now() - t0) / 20;
    if (per > worst) { worst = per; worstWhere = `${mcu} ${biggest}`; }
  }
  assert.ok(worst < 5, `compute() took ${worst.toFixed(2)} ms on ${worstWhere} (budget 5 ms)`);
});

// A 144-pin part does not exist in data/ yet (the largest bundled package is 48
// pins), so the performance budget in agents/STATUS.md (AGENT-2's block) is checked
// against a synthetic one built here: 9 ports of 16 pins, 24 peripherals, 6 remaps
// each. (It cited AGENT_2_ENGINE.md, then AGENT_2_APP.md; ENGINE and UI merged into
// APP in round 5, and the eight-file pack became three in round 6.)
function bigPart() {
  const ports = 'ABCDEFGHI'.split('');
  const names = ports.flatMap(p => Array.from({ length: 16 }, (_, i) => `P${p}${i}`));
  const pins = Object.fromEntries(names.map(n => [n, { type: 'io' }]));
  const packages = { LQFP144: Object.fromEntries(names.map((n, i) => [i + 1, n])) };
  const peripherals = {};
  for (let k = 0; k < 24; k++) {
    const sigs = ['A', 'B', 'C', 'D'];
    peripherals[`P${k}`] = {
      category: 'Timers',
      settings: [{
        name: 'Mode',
        choices: [{ name: 'Disable' }, { name: 'On', signals: sigs }],
      }],
      remaps: Array.from({ length: 6 }, (_, r) => ({
        name: `remap ${r}`,
        pins: Object.fromEntries(sigs.map((s, si) => [s, names[(k * 7 + r * 37 + si * 13) % names.length]])),
      })),
    };
  }
  return { mcu: { name: 'BIG144', default_package: 'LQFP144' }, packages, pins, peripherals };
}

test('compute() stays under 5 ms on a 144-pin part with everything switched on', () => {
  const e = fresh();
  e.loadMcu(bigPart());
  assert.equal(Object.keys(e.pkgPins()).length, 144);
  for (const pid of Object.keys(e.M.peripherals)) e.S.periph[pid].settings.Mode = 'On';
  const E = e.compute();
  assert.ok(Object.keys(E.pins).length > 50, 'the part is actually loaded up');
  assert.ok(E.conflicts.length > 0, 'and contended, which is the expensive path');

  for (let i = 0; i < 5; i++) e.compute();                 // warm up
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) e.compute();
  const per = (performance.now() - t0) / 50;
  assert.ok(per < 5, `compute() took ${per.toFixed(2)} ms on a 144-pin part (budget 5 ms)`);
});
