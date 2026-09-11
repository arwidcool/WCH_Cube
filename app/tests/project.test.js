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
  // '30 MHz' because that is the only speed CH32V006 has (gpio.speeds). A project
  // storing a speed the part does not have is a migration case, tested on its own below.
  e.S.gpio.PC4 = { mode: 'Output Open Drain', pull: 'Pull-up', speed: '30 MHz', label: 'LED_STATUS' };
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

// Round-3 P0b. Before the one-speed fix the GPIO table offered Low / Medium / High,
// none of which this silicon has, and projects saved then are on people's disks.
test('opening a project saved with a speed this part never had rewrites it, and says so', () => {
  const e = fresh();
  configure(e);
  const text = e.projectSerialize().replace("speed: 30 MHz", "speed: High");
  assert.match(text, /speed: High/, 'setup: the file really says High');

  e.projectApply(text);
  assert.equal(e.S.gpio.PC4.speed, '30 MHz', 'S must not carry a speed the part cannot express');
  assert.ok(e.PROJECT.warnings.some(w => /PC4/.test(w) && /"High"/.test(w) && /"30 MHz"/.test(w)),
    'and the user is told, rather than the change happening behind their back: ' + JSON.stringify(e.PROJECT.warnings));
  // everything else about the project survived the rewrite
  assert.equal(e.S.gpio.PC4.label, 'LED_STATUS');
  assert.equal(e.S.gpio.PC4.mode, 'Output Open Drain');
  assert.equal(e.S.pkg, 'QFN20');
  assert.ok(e.cSource().includes('GPIO_Speed_30MHz'), 'and it generates a macro that exists');
});

test('setGpioField refuses a speed a multi-speed part does not offer', () => {
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-TWOSPEED-P
  inherits: CH32V006
gpio:
  speeds:
    - { name: "10 MHz", macro: GPIO_Speed_10MHz }
    - { name: "30 MHz", macro: GPIO_Speed_30MHz }
`);
  e.loadMcu('CH32V006-TWOSPEED-P');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  assert.throws(() => e.setGpioField('PC0', 'speed', 'High'), /has no output speed "High".*10 MHz, 30 MHz/);
  assert.equal(e.S.gpio.PC0.speed, '10 MHz', 'the rejected write left the assign-time default alone');
  assert.equal(e.canUndo(), true, 'the assignment itself is still undoable');
  e.setGpioField('PC0', 'speed', '10 MHz');
  assert.equal(e.S.gpio.PC0.speed, '10 MHz');
});

test('a one-speed part quietly stores its own speed whatever the caller passes', () => {
  const e = fresh();
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.setGpioField('PC0', 'speed', 'High');
  assert.equal(e.S.gpio.PC0.speed, '30 MHz',
    'there is no choice to get wrong here, so a stale caller is corrected rather than broken');
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

// ---------------------------------------------------------------- format versioning

test('a saved project carries the format number the build understands', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const obj = e.projectObject();
  assert.equal(obj.wchproj, e.PROJECT_FORMAT);
  assert.equal(typeof e.PROJECT_FORMAT, 'number');
});

test('a project from a newer WCHCube is refused by name, not half applied', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const obj = e.projectObject();
  obj.wchproj = e.PROJECT_FORMAT + 3;
  assert.throws(() => e.projectApply(obj), /saved in format \d+ by a newer WCHCube/);
  assert.throws(() => e.projectApply({ name: 'no version' }), /no `wchproj:` version key/);
  assert.throws(() => e.projectApply({ wchproj: 'x' }), /Not a WCHCube project file/);
});

test('migrateProject walks an old file forward one step at a time', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const current = e.PROJECT_FORMAT;
  // Pretend this build is one format ahead, with a migration for the step.
  const older = { ...e.projectObject(), wchproj: current, legacy_name: 'from the old days' };
  e.MIGRATIONS[current] = obj => ({ ...obj, wchproj: current + 1, name: obj.legacy_name || obj.name });
  try {
    // migrateProject stops at PROJECT_FORMAT, so with no bump it must NOT run the step
    assert.equal(e.migrateProject(older).wchproj, current, 'a current file is left alone');
    // and a file one behind a bumped format is carried forward
    const ancient = { ...older, wchproj: current - 1 };
    if (current > 1) {
      e.MIGRATIONS[current - 1] = obj => ({ ...obj, wchproj: current });
      assert.equal(e.migrateProject(ancient).wchproj, current);
    }
  } finally {
    delete e.MIGRATIONS[current];
    delete e.MIGRATIONS[current - 1];
  }
});

test('an unmigratable old file says so instead of loading wrong', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const obj = { ...e.projectObject(), wchproj: 0 };
  assert.throws(() => e.migrateProject(obj), /Not a WCHCube project file/);
});
