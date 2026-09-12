// model.js — parsing, derived maps, shorted pins, package switching.
import { test, assert, fresh, eng } from './_harness.js';

test('loads CH32V006 and defaults to its TSSOP20 package', () => {
  const e = fresh();
  assert.equal(e.M.mcu.name, 'CH32V006');
  assert.equal(e.S.pkg, 'TSSOP20');
  assert.deepEqual(Object.keys(e.M.packages).sort(), ['QFN12', 'QFN20', 'QFN32', 'QSOP24', 'TSSOP20']);
});

test('alternate functions are derived from the remap tables, not listed per pin', () => {
  const e = fresh();
  const onPD5 = e.M._pinSignals.PD5;
  assert.ok(onPD5.some(s => s.periph === 'USART1' && s.signal === 'TX' && s.remap === 0),
    'USART1_TX remap 0 should be derived onto PD5');
  assert.ok(onPD5.some(s => s.periph === 'ADC1' && s.signal === 'IN5'), 'ADC1_IN5 is also on PD5');
});

test('shorted pins are one physical pin (PD7/PA4 on TSSOP20)', () => {
  const e = fresh();
  assert.deepEqual(e.groupOf('PA4'), ['PD7', 'PA4']);
  assert.equal(e.canon('PA4'), 'PD7');
  assert.equal(e.canon('PD7'), 'PD7');
  assert.equal(e.pinLabel('PA4'), 'PD7/PA4');
  assert.equal(e.pinNum('PA4'), '4');
});

test('QSOP24 shorts a different pair (PA1/PA6) and QFN32 shorts none', () => {
  const e = fresh('CH32V006', 'QSOP24');
  assert.deepEqual(e.groupOf('PA6'), ['PA1', 'PA6']);
  e.setPackage('QFN32');
  assert.deepEqual(e.groupOf('PA6'), ['PA6']);
  assert.deepEqual(e.groupOf('PA1'), ['PA1']);
});

test('pin existence is per package', () => {
  const e = fresh();
  assert.equal(e.pinExists('PB3'), false, 'PB3 is not bonded on TSSOP20');
  e.setPackage('QFN32');
  assert.equal(e.pinExists('PB3'), true);
  e.setPackage('QFN12');
  assert.equal(e.pinExists('PC5'), false);
  assert.equal(e.pinExists('PD1'), true);
});

test('pin types come from the pins: block, unknown names default to io', () => {
  const e = fresh();
  assert.equal(e.pinType('VDD'), 'power');
  assert.equal(e.pinType('VSS'), 'ground');
  assert.equal(e.pinType('PC0'), 'io');
  assert.equal(e.pinType('NOSUCHPIN'), 'io');
});

test('exposed pad is pin 0 and is not counted as an I/O', () => {
  const e = fresh('CH32V006', 'QFN20');
  assert.deepEqual(e.M._phys.QFN20['0'], ['VSS']);
  assert.equal(e.pinType(e.M._phys.QFN20['0'][0]), 'ground');
});

test('remap_by_package moves the reset pin with the package', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const rst = () => e.M.peripherals.SYS.remaps[e.S.periph.SYS.remap].pins.RST;
  assert.equal(rst(), 'PD7');
  e.setPackage('QSOP24'); assert.equal(rst(), 'PC5');
  e.setPackage('QFN32'); assert.equal(rst(), 'PA7');
  e.setPackage('QFN12'); assert.equal(rst(), 'PD7');
});

test('setPackage reports manual pins that are no longer bonded', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.assignSignal('PC5', { gpio: 'GPIO_Output' });
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  const dropped = e.setPackage('QFN12');          // QFN12 has PC0 but no PC5
  assert.deepEqual(dropped, ['PC5']);
  assert.equal(e.pinExists('PC0'), true);
});

test('setPackage rejects a package the MCU does not have', () => {
  const e = fresh();
  assert.throws(() => e.setPackage('LQFP144'), /No such package/);
});

test('requiredSignals follows the current settings, including checkbox sets', () => {
  const e = fresh();
  e.S.periph.USART1.settings.Mode = 'Asynchronous';
  assert.deepEqual([...e.requiredSignals('USART1')].sort(), ['RX', 'TX']);
  e.S.periph.USART1.settings['Hardware Flow Control'] = 'CTS/RTS';
  assert.deepEqual([...e.requiredSignals('USART1')].sort(), ['CTS', 'RTS', 'RX', 'TX']);
  e.S.periph.ADC1.settings.Channels.add('IN2');
  e.S.periph.ADC1.settings.Channels.add('IN3');
  assert.deepEqual([...e.requiredSignals('ADC1')].sort(), ['IN2', 'IN3']);
});

// ---- what the FILE does not say ----------------------------------------------
// The Tools tab prints these two and nothing else derives them. Both are facts about the
// MCU file rather than about the silicon, so they are read from the model and unit-tested
// here rather than worked out in the page.

test('openPadPeripherals lists the coverage ledger queue, with the owner from the file', () => {
  const e = fresh('CH32V006');
  // every shipped part declares this: routing, or `none` with a source, or `open`
  const found = e.openPadPeripherals();
  assert.ok(Array.isArray(found));
  for (const o of found) {
    assert.equal(o.pid in e.M.peripherals, true, `${o.pid} is a real peripheral`);
    assert.equal(e.M.peripherals[o.pid].pins.open, true);
    assert.ok(o.owner, 'an open declaration names its owner - the row is printed with it');
    assert.ok(o.task, 'and the TASKS.md line');
  }
  // it is a READER of the declaration, not a second opinion about it: a peripheral with
  // `none` (the silicon gives it no pad) is NOT in the list, however pinless it looks
  const none = Object.entries(e.M.peripherals).filter(([, P]) => (P.pins || {}).none).map(([p]) => p);
  assert.ok(none.length, 'setup: this part has pinless peripherals');
  for (const pid of none) assert.equal(found.some(o => o.pid === pid), false);
});

test('unclaimableSignals is empty for every shipped part, and catches a dead row', () => {
  for (const name of Object.keys(eng.MCU_FILES)) {
    const e = fresh(name);
    assert.deepEqual(e.unclaimableSignals(), [],
      `${name}: a routed signal no setting names cannot be assigned, and validate_mcu makes it an ERROR`);
  }
  // Planted break, run every time: the check is a set difference, and a set difference
  // that silently matched nothing would pass on exactly the data it exists to reject.
  // CH32V006 moves whole peripherals with a `remaps:` index, so the per-pin map this
  // question is about has to be written here - which is also why the shipped-part loop
  // above reads empty for it.
  const e = fresh('CH32V006');
  e.M.peripherals.USART1.signal_pins = {
    TX: [{ pin: 'PD5' }], RX: [{ pin: 'PD6' }], GHOST: [{ pin: 'PA11' }],
  };
  assert.deepEqual(e.unclaimableSignals(), [{ pid: 'USART1', signal: 'GHOST' }],
    'a routed signal no choice names is reported, and the claimed ones are not');
  // and the exemption is a rule: a peripheral codegen must keep away from is not asked
  e.M.codegen.skip_signals = { ...(e.M.codegen.skip_signals || {}), USART1: true };
  assert.deepEqual(e.unclaimableSignals(), [], 'skip_signals is exempt, by design');
});

// ---- `peripherals.<pid>.pins` is a DECLARATION, not a routing ------------------
// FORMAT.md: a peripheral with neither `remaps:` nor `signal_pins:` must say WHY it
// claims nothing - `pins: { none: true, source: }` when the silicon gives it no pad,
// `pins: { open: true, owner:, task: }` when nobody has extracted it yet. The routing is
// `remaps:` (the whole peripheral moves as one) or `signal_pins:` (per pin, with an `af:`
// code); `pins:` answers "why is there no routing", and reading it AS one would invent
// pads out of a sentence. The synthetic fixture carries three of them, on IWDG, WWDG and
// DMA1, so the question can be asked against a real file rather than a hand-made object.

const declaredPins = e => Object.entries(e.M.peripherals)
  .filter(([, P]) => P.pins && !P.remaps && !P.signal_pins);

test('a peripherals.<pid>.pins declaration routes nothing and claims nothing', () => {
  const e = fresh('WCH-DUMMY32-C8');
  const declared = declaredPins(e);
  assert.equal(declared.length, 3, 'setup: the fixture carries three of these');
  assert.deepEqual(declared.map(([pid]) => pid).sort(), ['DMA1', 'IWDG', 'WWDG']);
  for (const [pid, P] of declared) {
    // Every entry point the engine has into a routing, checked one at a time, because
    // each of the three is a different route to the same defect and a plant in any one
    // of them has to be caught here.
    assert.equal(e.signalPinDefs(pid), null,
      `${pid}: no per-pin map may be derived from the declaration`);
    assert.deepEqual(e.signalPins(pid).pins, {},
      `${pid}: and the routing lookup must come back empty, not holding a sentence`);
    assert.deepEqual([...e.requiredSignals(pid)], [],
      `${pid}: and it must claim no signal, however the declaration reads`);
    assert.deepEqual(e.unclaimableSignals().filter(u => u.pid === pid), [],
      `${pid}: a declaration is not a routed signal either`);
    assert.equal(P.pins.source, 'synthetic layout fixture - not silicon; it has no datasheet and claims no pad');
  }
});

test('deleting the declaration changes not one byte of the app output', () => {
  // Same part, same state, the only difference being the declaration - so this is a
  // whole-model byte comparison rather than a list of the places I thought to look. What
  // it does NOT prove on its own is that the routing queries ignore it: these three
  // peripherals route nothing at all, so `afPlan()` skips them before it asks, and a
  // leak would have nowhere to land. The test above is the one that catches that, one
  // entry point at a time; this one is the backstop for everything else.
  const snap = e => JSON.stringify({
    c: e.cSource(),
    conflicts: e.E.conflictList,
    issues: e.E.issues,
    pins: Object.fromEntries(Object.entries(e.E.pins).map(([p, v]) => [p, {
      state: v.state, claims: (v.claims || []).map(c => `${c.who}:${c.sig}`).sort(),
    }])),
  });
  const e = fresh('WCH-DUMMY32-C8');
  e.toggleSetting('ADC1', 'Channels', 'IN0', true);
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  // the declared peripherals are switched ON too, so their init blocks are generated
  for (const pid of ['IWDG', 'WWDG', 'DMA1']) e.setSetting(pid, 'Mode', 'Activated');
  e.compute();
  const before = snap(e);
  assert.ok((e.E.pins.PA0.claims || []).length, 'setup: a channel claims a pad, so the grid has state');
  assert.ok(before.includes('void WCHCube_DMA1_Init(void)'), 'setup: a declared peripheral is generated');
  for (const [, P] of declaredPins(e)) delete P.pins;
  e.compute();
  assert.equal(snap(e), before);
});

test('a project round-trip neither writes nor needs the declaration', () => {
  const e = fresh('WCH-DUMMY32-C8');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.compute();
  const text = e.projectSerialize();
  const obj = e.projectObject();
  // a .wchproj carries what the USER chose. `pins:` is a fact about the MCU file, so
  // writing it would put one file's claim inside a project that can be opened on another.
  for (const pid of ['IWDG', 'WWDG', 'DMA1']) {
    assert.equal('pins' in Object(obj.peripherals[pid] || {}), false, `${pid}.pins is not saved`);
    assert.deepEqual(Object.keys(obj.peripherals[pid]).sort(), ['remap', 'settings'],
      `${pid}: a peripheral state is its settings and its remap index, nothing else`);
  }
  assert.equal(/^\s*pins:/m.test(text), false, 'and the serialized YAML has no such key');

  const e2 = fresh('WCH-DUMMY32-C8');
  e2.projectApply(e.yamlLoad(text));
  e2.compute();
  assert.equal(e2.cSource(), e.cSource(), 'and reopening it reproduces the same C');
});

test('every bundled MCU file loads on every one of its packages', () => {
  const e = fresh();
  for (const name of Object.keys(e.MCU_FILES)) {
    e.loadMcu(e.MCU_FILES[name]);
    for (const pkg of Object.keys(e.M.packages)) {
      e.setPackage(pkg);
      assert.ok(Object.keys(e.pkgPins()).length > 0, `${name} ${pkg} has pins`);
      for (const [num, names] of Object.entries(e.pkgPins())) {
        // power and ground names repeat across pins; I/O names must not
        for (const n of names) {
          if (e.pinType(n) !== 'io') continue;
          assert.equal(e.pinNum(n), num, `${name} ${pkg}: ${n} maps back to pin ${num}`);
        }
      }
    }
  }
});

test('a file without the required top-level keys is rejected', () => {
  const e = fresh();
  assert.throws(() => e.loadMcu('mcu:\n  name: X\n'), /Not an MCU file/);
});
