// project.js — .wchproj must round-trip 100% of the state, or a saved project
// silently loses work.
import { test, assert, fresh, snapshot, jsyaml } from './_harness.js';

// A project with something switched on in every part of the state.
function configure(e) {
  e.setPackage('QFN20');
  e.S.periph.USART1.settings.Mode = 'Asynchronous';
  e.S.periph.USART1.settings['Hardware Flow Control'] = 'CTS/RTS';
  e.S.periph.USART1.remap = 2;
  e.S.periph.ADC1.settings.Channels.add('IN2');
  e.S.periph.ADC1.settings.Channels.add('IN5');
  e.S.periph.SYS.settings['External reset pin'] = 'RST disabled — pin is GPIO (RST_MODE=11)';
  e.assignSignal('PC4', { gpio: 'GPIO_Output' });
  e.S.gpio.PC4 = { mode: 'Output Open Drain', pull: 'Pull-up', speed: 'High', label: 'LED_STATUS' };
  e.S.clock.sys = 'PLLCLK';
  e.S.clock.pre.HB = 2;
  e.S.clock.hse = 12;
  e.setProject({ name: 'Blinky', variant: 'CH32V006F8U7' });
  e.compute();
}

test('a project round-trips through YAML with no loss', () => {
  const e = fresh();
  configure(e);
  const before = snapshot(e.S);
  const beforeProject = { ...e.PROJECT };
  const text = e.projectSerialize();

  e.loadMcu(e.MCU_FILES.CH32V006);                 // wipe everything
  e.setProject({ name: 'Untitled', variant: null, dirty: true });
  assert.notDeepEqual(snapshot(e.S), before);

  e.projectApply(text);
  assert.deepEqual(snapshot(e.S), before);
  assert.equal(e.PROJECT.name, beforeProject.name);
  assert.equal(e.PROJECT.variant, beforeProject.variant);
  assert.equal(e.PROJECT.dirty, false);
});

test('the saved file is readable YAML with the fields a human would expect', () => {
  const e = fresh();
  configure(e);
  const obj = jsyaml.load(e.projectSerialize());
  assert.equal(obj.wchproj, 1);
  assert.equal(obj.mcu, 'CH32V006');
  assert.equal(obj.package, 'QFN20');
  assert.equal(obj.variant, 'CH32V006F8U7');
  assert.equal(obj.name, 'Blinky');
  assert.deepEqual(obj.peripherals.ADC1.settings.Channels, ['IN2', 'IN5']);   // Sets become lists
  assert.equal(obj.peripherals.USART1.remap, 2);
  assert.equal(obj.gpio_manual.PC4, 'GPIO_Output');
  assert.equal(obj.gpio_settings.PC4.label, 'LED_STATUS');
  assert.equal(obj.clock.sys, 'PLLCLK');
  assert.ok(!/\*ref_|&ref_/.test(e.projectSerialize()), 'no YAML anchors — the file must stay readable');
});

test('the engine result is identical after reopening', () => {
  const e = fresh();
  configure(e);
  const before = JSON.stringify(e.compute().pins);
  const text = e.projectSerialize();
  e.loadMcu(e.MCU_FILES.CH32V006);
  e.projectApply(text);
  assert.equal(JSON.stringify(e.compute().pins), before);
});

test('opening a project for an MCU that is not loaded says which one', () => {
  const e = fresh();
  const text = e.projectSerialize().replace('mcu: CH32V006', 'mcu: CH32V999');
  assert.throws(() => e.projectApply(text), /CH32V999.*not loaded/s);
});

test('a file that is not a project is rejected', () => {
  const e = fresh();
  assert.throws(() => e.projectApply('hello: world\n'), /Not a WCHCube project file/);
});

test('unknown peripherals, settings and remap indices in a project are ignored, not fatal', () => {
  const e = fresh();
  configure(e);
  const obj = jsyaml.load(e.projectSerialize());
  obj.peripherals.NOSUCHPERIPH = { settings: { Mode: 'On' }, remap: 3 };
  obj.peripherals.USART1.settings['No Such Setting'] = 'x';
  obj.peripherals.USART1.settings.Mode = 'No Such Mode';
  obj.peripherals.I2C1.remap = 99;
  e.projectApply(obj);
  assert.equal(e.S.periph.USART1.settings.Mode, 'Disable', 'an unknown choice falls back to the default');
  assert.equal(e.S.periph.I2C1.remap, 0, 'an out-of-range remap index is ignored');
  assert.equal(e.S.periph.NOSUCHPERIPH, undefined);
});

test('a project saved for a package the MCU does not have keeps the default package', () => {
  const e = fresh();
  configure(e);
  const obj = jsyaml.load(e.projectSerialize());
  obj.package = 'LQFP144';
  e.projectApply(obj);
  assert.equal(e.S.pkg, 'TSSOP20');
});
