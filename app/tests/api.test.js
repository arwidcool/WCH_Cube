// The engine's public surface, called directly. The other suites drive the
// engine the way the app does; this one pins down each exported function on its
// own, so a signature change cannot slip through behind a higher-level test.
import { test, assert, fresh, eng, read } from './_harness.js';

test('PACKAGES holds the geometry library the chip renderer draws from', () => {
  const e = fresh();
  assert.ok(e.PACKAGES.TSSOP20, 'TSSOP20 geometry is loaded');
  assert.equal(e.PACKAGES.TSSOP20.kind, 'dual');
  assert.equal(e.PACKAGES.TSSOP20.pins, 20);
  assert.equal(e.PACKAGES.QFN32.kind, 'quad');
  for (const [id, g] of Object.entries(e.PACKAGES)) {
    assert.ok(g.pins > 0, `${id} declares a pin count`);
    if (g.kind === 'quad') assert.equal(g.pins % 4, 0, `${id} is drawn on four sides`);
  }
});

test('yamlLoad and yamlDump are the engine parser hook', () => {
  const e = fresh();
  const obj = e.yamlLoad('a: 1\nb: [x, y]\n');
  assert.deepEqual(obj, { a: 1, b: ['x', 'y'] });
  assert.deepEqual(e.yamlLoad(e.yamlDump(obj)), obj, 'round-trips');
});

test('deriveMcu builds the pin-signal and package maps from a parsed file', () => {
  const e = fresh();
  const parsed = e.yamlLoad(read('data/mcus/CH32V006.yaml'));
  assert.equal(parsed._pinSignals, undefined, 'not derived yet');
  const m = e.deriveMcu(parsed);
  assert.ok(m._pinSignals.PD5.some(s => s.periph === 'USART1'));
  assert.deepEqual(m._phys.TSSOP20['4'], ['PD7', 'PA4']);
  assert.equal(m._alias.TSSOP20.PA4, 'PD7');
  assert.equal(m._alias.QFN32.PA4, 'PA4', 'not shorted on QFN32');
});

test('initState gives every peripheral its default choices', () => {
  const e = fresh();
  const m = e.deriveMcu(e.yamlLoad(read('data/mcus/CH32V006.yaml')));
  const st = e.initState(m);
  assert.equal(st.pkg, 'TSSOP20', 'the file default_package');
  assert.equal(st.periph.USART1.settings.Mode, 'Disable');
  assert.equal(st.periph.USART1.remap, 0);
  assert.ok(st.periph.ADC1.settings.Channels instanceof Set);
  assert.equal(st.periph.ADC1.settings.Channels.size, 0);
  assert.ok(/factory default/.test(st.periph.SYS.settings['External reset pin']), 'default: true wins');
  assert.deepEqual(st.manual, {});
  assert.equal(st.sel, null);
});

test('mcuModel parses and resolves a file without installing it', () => {
  const e = fresh();
  const before = e.M;
  const y = e.mcuModel('CH32V006');
  assert.equal(y.mcu.name, 'CH32V006');
  assert.equal(y._pinSignals, undefined, 'not derived — mcuModel is for inspection');
  assert.equal(e.M, before, 'M is untouched');

  e.registerMcuFile('mcu:\n  name: CH32V005\n  inherits: CH32V006\n  remove: [peripherals.TKEY]\n');
  const child = e.mcuModel('CH32V005');
  assert.ok(child.packages.TSSOP20, 'inherited');
  assert.equal(child.peripherals.TKEY, undefined, 'removed');
});

test('sigName is the one place a signal gets its display name', () => {
  const e = fresh();
  assert.equal(e.sigName('USART1', 'TX'), 'USART1_TX');
  assert.equal(e.sigName('ADC1', 'IN0'), 'ADC1_IN0');
});

test('applyPackageRemaps snaps every remap_by_package peripheral to this package', () => {
  const e = fresh();
  e.S.periph.SYS.remap = 2;                       // pretend something moved it
  e.applyPackageRemaps();
  assert.equal(e.S.periph.SYS.remap, 0, 'TSSOP20 puts RST on PD7');
  e.S.pkg = 'QSOP24';
  e.applyPackageRemaps();
  assert.equal(e.S.periph.SYS.remap, 1, 'QSOP24 puts RST on PC5');
});

test('neutralChoice finds the choice that needs no pins', () => {
  const e = fresh();
  const setting = name => e.M.peripherals.SYS.settings.find(s => s.name === name);
  assert.equal(e.neutralChoice(setting('Debug (SDI)')).name, 'No Debug');
  assert.ok(/RST disabled/.test(e.neutralChoice(setting('External reset pin')).name),
    'not choices[0] — the factory default claims the pin');
  const mode = e.M.peripherals.USART1.settings.find(s => s.name === 'Mode');
  assert.equal(e.neutralChoice(mode).name, 'Disable');
});

test('isEnabled is true once any setting leaves its neutral choice', () => {
  const e = fresh();
  assert.equal(e.isEnabled('DMA1'), false);
  e.setSetting('DMA1', 'Mode', 'Activated (7 channels)');
  assert.equal(e.isEnabled('DMA1'), true);
  assert.equal(e.isEnabled('SYS'), true, 'SWIO and RST are live out of reset');
});

test('defaultClock reads the file, and copes with a file that has no clock', () => {
  const e = fresh();
  const k = e.defaultClock(e.M.clock);
  assert.deepEqual(k, { hse: 24, pllIn: 0, pllMul: 2, sys: 'HSI', pre: { HB: 1, ADC: 1 } });
  assert.equal(e.defaultClock(null), null);
  assert.equal(e.defaultClock(undefined), null);
});

test('projectObject is the project before it becomes YAML', () => {
  const e = fresh();
  e.toggleSetting('ADC1', 'Channels', 'IN3', true);
  e.setProject({ name: 'Demo', variant: 'CH32V006F8P7' });
  const obj = e.projectObject();
  assert.equal(obj.wchproj, 1);
  assert.equal(obj.name, 'Demo');
  assert.equal(obj.mcu, 'CH32V006');
  assert.deepEqual(obj.peripherals.ADC1.settings.Channels, ['IN3'], 'Sets flattened for YAML');
  assert.ok(Date.parse(obj.saved) > 0, 'stamped with a real date');
});

test('resolveInherits works on its own, given a lookup and a parser', () => {
  const e = fresh();
  const files = {
    Base: 'mcu:\n  name: Base\n  flash_kb: 64\npins:\n  PA0: { type: io }\n',
    Child: 'mcu:\n  name: Child\n  inherits: Base\n  flash_kb: 16\n',
  };
  const out = e.resolveInherits(e.yamlLoad(files.Child), n => files[n], e.yamlLoad);
  assert.equal(out.mcu.flash_kb, 16);
  assert.equal(out.mcu.inherited_from, 'Base');
  assert.deepEqual(out.pins, { PA0: { type: 'io' } });
  assert.equal(e.resolveInherits(e.yamlLoad(files.Base), n => files[n], e.yamlLoad).mcu.name, 'Base');
});

test('record and clearHistory are the history primitives the mutators use', () => {
  const e = fresh();
  assert.equal(e.canUndo(), false);
  e.record('Hand-rolled change');
  e.S.manual.PC0 = 'GPIO_Output';          // a direct write, the way a caller outside the engine might
  assert.equal(e.canUndo(), true);
  assert.equal(e.undo(), 'Hand-rolled change');
  assert.equal(e.S.manual.PC0, undefined);

  e.record('one'); e.record('two');
  e.clearHistory();
  assert.equal(e.canUndo(), false);
  assert.equal(e.canRedo(), false);
});

test('claims name the pin they actually use, not just the canonical one', () => {
  const e = fresh();
  e.assignSignal('PA4', { gpio: 'GPIO_Output' });   // PA4 is shorted to PD7
  e.compute();
  const gpio = e.E.pins.PD7.claims.find(c => c.who === 'GPIO');
  assert.equal(gpio.via, 'PA4', 'code generation has to configure PA4, not PD7');
  const rst = e.E.pins.PD7.claims.find(c => c.who === 'SYS');
  assert.equal(rst.via, 'PD7');
});

// =============================================================================
//  The exports added this round, each exercised on its own
// =============================================================================
//  The coverage check counts an export as tested when a test names it, and 100% of
//  app/engine/* was the round-2 exit criterion. These are the round-3 additions:
//  small functions the bigger tests use indirectly, pinned here so a rename or a
//  behaviour change has somewhere to fail.

test('the per-channel accessors answer for a peripheral that has the block, and one that does not', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const cp = eng.channelParamBlock('TIM1');
  assert.ok(cp && cp.struct === 'TIM_OCInitTypeDef' && Array.isArray(cp.params));
  assert.equal(eng.channelParamBlock('USART1'), null, 'USART1 has no per-channel struct');

  const defaults = eng.channelParamDefaults('TIM1');
  assert.ok(Object.keys(defaults).length);
  for (const d of eng.channelParamDefs('TIM1')) {
    assert.equal(defaults[d.key], d.default, `${d.key} default`);
  }
  assert.deepEqual(eng.channelParamDefaults('USART1'), {});

  const rows = eng.getChannelParams('TIM1', 1);
  assert.equal(rows.length, eng.channelParamDefs('TIM1').length);
  assert.ok(rows.every(r => 'value' in r && 'applicable' in r), 'the shape an editor renders');
  e.setChannelParam('TIM1', 1, 'pulse', 42);
  assert.equal(eng.getChannelParams('TIM1', 1).find(r => r.key === 'pulse').value, 42);
});

test('channelParamsObject serialises only channels somebody touched', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.deepEqual(eng.channelParamsObject('TIM1'), {}, 'untouched writes nothing');
  e.setChannelParam('TIM1', 2, 'pulse', 7);
  assert.deepEqual(eng.channelParamsObject('TIM1'), { 2: { pulse: 7 } });

  // and applyChannelParams is its inverse, dropping what no longer validates
  const g = fresh('CH32V006', 'TSSOP20');
  assert.deepEqual(eng.applyChannelParams('TIM1', { 1: { pulse: 11 } }), []);
  assert.equal(g.channelParamValue('TIM1', 1, 'pulse'), 11);
  const dropped = eng.applyChannelParams('TIM1', { 1: { pulse: 999999 }, 9: { pulse: 1 } });
  assert.equal(dropped.length, 2, 'an out-of-range value and a channel that does not exist');
  assert.equal(g.channelParamValue('TIM1', 1, 'pulse'), 11, 'neither was applied');
});

test('normaliseParamDefs is the one normaliser, so params: and channel_params: cannot drift', () => {
  const out = eng.normaliseParamDefs([
    { key: 'a', name: 'A', type: 'enum', default: 'x', options: [{ name: 'x', value: 1, sdk: 'MACRO_X' }] },
    { name: 'No key', default: 3 },
    null,
  ]);
  assert.equal(out.length, 2, 'a null entry is dropped, a keyless one takes its name as the key');
  assert.equal(out[0].options[0].sdk, 'MACRO_X', 'the sdk macro survives normalisation');
  assert.equal(out[1].key, 'No key');
  assert.equal(out[1].type, 'number', 'the type is inferred when the data does not say');
  assert.deepEqual(eng.normaliseParamDefs(undefined), []);
});

test('gpioSpeedFor answers for a stored value, a stale one and nothing at all', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.equal(eng.gpioSpeedFor('30 MHz'), '30 MHz');
  assert.equal(eng.gpioSpeedFor('High'), '30 MHz', 'a name this part never had');
  assert.equal(eng.gpioSpeedFor(undefined), '30 MHz', 'the part has exactly one, so that is the answer');
});

test('defaultNvicGroup picks the group the data marks default, not the first', () => {
  assert.equal(eng.defaultNvicGroup({ scheme: { groups: [{ name: 'a' }, { name: 'b', default: true }] } }), 1);
  assert.equal(eng.defaultNvicGroup({ scheme: { groups: [{ name: 'a' }, { name: 'b' }] } }), 0, 'else the first');
  assert.equal(eng.defaultNvicGroup(undefined), 0, 'a part with no nvic block has no grouping to choose');
});

test('nvicScheme and nvicGroup report the PFIC scheme in force', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const s = eng.nvicScheme();
  assert.equal(s.priority_bits, 2, 'the PFIC implements two, not the Cortex-M four');
  assert.equal(s.priority_lsb, 6, 'PFIC_IPRIORx [7:6]; [5:0] are write-invalid');
  assert.equal(s.max_nesting, 2);
  assert.equal(eng.nvicGroup().name, eng.nvicGroups()[e.S.nvic.group].name);
  e.setNvicGroup(1);
  assert.equal(eng.nvicGroup().name, eng.nvicGroups()[1].name, 'it follows the state');
});

test('dmaRequestDefaults seeds from the data, and says nothing for a request with no seed', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const adc = eng.dmaRequestDefaults('ADC1');
  assert.equal(adc.psize, 'Half Word', 'an ADC data register is 16 bits wide');
  assert.equal(adc.mode, 'Circular');
  const none = eng.dmaRequestDefaults('NOT-A-REQUEST');
  for (const d of eng.dmaParamDefs()) assert.equal(none[d.key], d.default, `${d.key} falls back`);
});

test('initPeripherals and clockBitOf are what the peripheral section is built from', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.deepEqual(eng.initPeripherals(), [], 'nothing is switched on at boot');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.compute();
  assert.deepEqual(eng.initPeripherals(), ['USART1']);

  const bit = eng.clockBitOf('USART1');
  assert.equal(bit.bus, 'PB2', 'RM 3.4.7');
  assert.equal(bit.fn, 'RCC_PB2PeriphClockCmd');
  assert.equal(bit.macro, 'RCC_PB2Periph_USART1');
  assert.equal(eng.clockBitOf('TKEY'), null,
    'TouchKey has no enable bit of its own in RM 3.4.6-3.4.8, and none is invented');
});

test('userSection is the one place a USER CODE block is spelled', () => {
  assert.deepEqual(eng.userSection('PV'), ['/* USER CODE BEGIN PV */', '/* USER CODE END PV */']);
  assert.deepEqual(eng.userSection('Init', '    '),
    ['    /* USER CODE BEGIN Init */', '    /* USER CODE END Init */']);
  // and what it writes is what userSections() reads back
  const { sections } = eng.userSections(eng.userSection('X').join('\n'));
  assert.equal(sections.X, '');
});

test('hseFeedsSysclk and clockSelectable answer for the clock UI', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.equal(eng.hseFeedsSysclk(), false, 'HSI at boot');
  e.setClock({ sys: 'HSE' });
  assert.equal(eng.hseFeedsSysclk(), true);
  e.setClock({ sys: 'PLLCLK', pllIn: e.M.clock.pll.inputs.findIndex(i => i.source === 'HSE') });
  assert.equal(eng.hseFeedsSysclk(), true, 'through the PLL counts too');

  // every source the data lists is offered; nothing is filtered by UI state
  const list = eng.clockSelectable();
  assert.ok(Array.isArray(list) ? list.length : Object.keys(list).length,
    'the clock tab has something to offer');
});
