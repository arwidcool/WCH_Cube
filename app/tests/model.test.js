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

test('every bundled MCU file loads on every one of its packages', () => {
  const e = fresh();
  for (const name of Object.keys(e.MCU_FILES)) {
    e.loadMcu(e.MCU_FILES[name]);
    for (const pkg of Object.keys(e.M.packages)) {
      e.setPackage(pkg);
      assert.ok(Object.keys(e.pkgPins()).length > 0, `${name} ${pkg} has pins`);
      for (const [num, names] of Object.entries(e.pkgPins())) {
        for (const n of names) assert.equal(e.pinNum(n), num, `${name} ${pkg}: ${n} maps back to pin ${num}`);
      }
    }
  }
});

test('a file without the required top-level keys is rejected', () => {
  const e = fresh();
  assert.throws(() => e.loadMcu('mcu:\n  name: X\n'), /Not an MCU file/);
});
