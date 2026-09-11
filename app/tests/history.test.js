// history.js — undo/redo, and the state writers that feed it.
import { test, assert, fresh, snapshot, eng } from './_harness.js';

// Undo restores the configuration, never the view (selection, zoom, pan).
const config = S => {
  const s = snapshot(S);
  for (const k of ['sel', 'selPin', 'zoom', 'panX', 'panY']) delete s[k];
  return s;
};

test('a new part starts with an empty history', () => {
  const e = fresh();
  assert.equal(e.canUndo(), false);
  assert.equal(e.canRedo(), false);
  assert.equal(e.undoLabel(), null);
  assert.equal(e.undo(), null);
  assert.equal(e.redo(), null);
});

test('undo puts a pin back, redo takes it away again', () => {
  const e = fresh();
  const before = config(e.S);
  e.assignSignal('PC0', { periph: 'USART1', signal: 'TX', remap: 3 });
  e.compute();
  assert.equal(e.E.pins.PC0.label, 'USART1_TX');
  assert.equal(e.canUndo(), true);

  assert.equal(e.undo(), 'USART1_TX on PC0');
  e.compute();
  assert.equal(e.E.pins.PC0, undefined);
  assert.deepEqual(config(e.S), before);

  assert.equal(e.redo(), 'USART1_TX on PC0');
  e.compute();
  assert.equal(e.E.pins.PC0.label, 'USART1_TX');
  assert.equal(e.canRedo(), false);
});

test('undo walks back through several steps in order', () => {
  const e = fresh();
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.assignSignal('PC1', { gpio: 'GPIO_Input' });
  e.assignSignal('PC2', { gpio: 'GPIO_Analog' });
  assert.deepEqual(e.historyDepth(), { undo: 3, redo: 0 });
  e.undo(); e.undo();
  assert.deepEqual(Object.keys(e.S.manual), ['PC0']);
  assert.deepEqual(e.historyDepth(), { undo: 1, redo: 2 });
  e.redo();
  assert.deepEqual(Object.keys(e.S.manual).sort(), ['PC0', 'PC1']);
});

test('a new action after an undo drops the redo branch', () => {
  const e = fresh();
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.assignSignal('PC1', { gpio: 'GPIO_Output' });
  e.undo();
  assert.equal(e.canRedo(), true);
  e.assignSignal('PC2', { gpio: 'GPIO_Output' });
  assert.equal(e.canRedo(), false);
  assert.deepEqual(Object.keys(e.S.manual).sort(), ['PC0', 'PC2']);
});

test('undo restores checkbox settings as real Sets, not arrays', () => {
  const e = fresh();
  e.toggleSetting('ADC1', 'Channels', 'IN2', true);
  e.toggleSetting('ADC1', 'Channels', 'IN3', true);
  assert.deepEqual([...e.S.periph.ADC1.settings.Channels], ['IN2', 'IN3']);
  e.undo();
  assert.ok(e.S.periph.ADC1.settings.Channels instanceof Set, 'still a Set after undo');
  assert.deepEqual([...e.S.periph.ADC1.settings.Channels], ['IN2']);
  e.compute();
  assert.equal(e.E.pins.PC4.label, 'ADC1_IN2');
});

test('undo covers a package switch, including the pins it dropped', () => {
  const e = fresh();
  e.assignSignal('PC5', { gpio: 'GPIO_Output' });
  e.setPackage('QFN12');                       // PC5 is not bonded there
  e.compute();
  assert.equal(e.pinExists('PC5'), false);
  assert.equal(e.undo(), 'Package QFN12');
  e.compute();
  assert.equal(e.S.pkg, 'TSSOP20');
  assert.equal(e.E.pins.PC5.label, 'GPIO_Output');
});

test('undo does not move the selection, the zoom or the pan', () => {
  const e = fresh();
  e.assignSignal('PC0', { periph: 'USART1', signal: 'TX', remap: 3 });
  e.S.zoom = 2.5; e.S.panX = 40; e.S.selPin = 'PC0';
  e.S.sel = 'SPI1';            // selection lives in the UI, not the engine
  e.undo();
  assert.equal(e.S.zoom, 2.5);
  assert.equal(e.S.panX, 40);
  assert.equal(e.S.selPin, 'PC0');
  assert.equal(e.S.sel, 'SPI1', 'selection is view state, never undone');
});

test('resetPin is one undo step', () => {
  const e = fresh();
  assert.equal(e.E.pins.PD7.label, 'SYS_RST');
  e.resetPin('PD7');
  e.compute();
  assert.equal(e.E.pins.PD7, undefined);
  assert.equal(e.undo(), 'Reset PD7/PA4');
  e.compute();
  assert.equal(e.E.pins.PD7.label, 'SYS_RST');
});

test('batch() collapses several changes into one undo step', () => {
  const e = fresh();
  e.batch('Set up UART', () => {
    e.setSetting('USART1', 'Mode', 'Asynchronous');
    e.setRemap('USART1', 3);
    e.setGpioField('PC0', 'label', 'DEBUG_TX');
  });
  assert.deepEqual(e.historyDepth(), { undo: 1, redo: 0 });
  assert.equal(e.undo(), 'Set up UART');
  assert.equal(e.S.periph.USART1.settings.Mode, 'Disable');
  assert.equal(e.S.periph.USART1.remap, 0);
  assert.equal(e.userLabel('PC0'), '');
});

test('loading another part or opening a project clears the history', () => {
  const e = fresh();
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  assert.equal(e.canUndo(), true);
  e.loadMcu('WCH-DUMMY32-C8');
  assert.equal(e.canUndo(), false);

  e.loadMcu('CH32V006');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  const text = e.projectSerialize();
  e.assignSignal('PC1', { gpio: 'GPIO_Output' });
  e.projectApply(text);
  assert.equal(e.canUndo(), false);
  assert.equal(e.canRedo(), false);
});

test('the stack is capped and keeps the most recent steps', () => {
  const e = fresh();
  for (let i = 0; i < 140; i++) e.setGpioField('PC0', 'label', `L${i}`);
  assert.equal(e.historyDepth().undo, 100);
  e.undo();
  assert.equal(e.userLabel('PC0'), 'L138');
});

test('the state writers validate what they are given', () => {
  const e = fresh();
  assert.throws(() => e.setSetting('USART1', 'No Such Setting', 'x'), /has no setting/);
  assert.throws(() => e.setSetting('USART1', 'Mode', 'No Such Mode'), /has no choice/);
  assert.throws(() => e.toggleSetting('USART1', 'Mode', 'Asynchronous', true), /not a checkbox setting/);
  assert.throws(() => e.setRemap('USART1', 99), /has no remap 99/);
  assert.equal(e.canUndo(), false, 'a rejected change must not leave an undo step');
});

test('toggleSetting flips when no explicit on/off is given', () => {
  const e = fresh();
  e.toggleSetting('ADC1', 'Channels', 'IN4');
  assert.ok(e.S.periph.ADC1.settings.Channels.has('IN4'));
  e.toggleSetting('ADC1', 'Channels', 'IN4');
  assert.equal(e.S.periph.ADC1.settings.Channels.has('IN4'), false);
});

test('setClock merges a partial patch and is undoable', () => {
  const e = fresh();
  e.setClock({ sys: 'PLLCLK', pre: { ADC: 2 } });
  assert.equal(e.S.clock.sys, 'PLLCLK');
  assert.equal(e.S.clock.pre.ADC, 2);
  assert.equal(e.S.clock.pre.HB, 1, 'untouched prescalers survive');
  assert.equal(e.clockCalc().SYSCLK, 48);
  e.undo();
  assert.equal(e.S.clock.sys, 'HSI');
  assert.equal(e.S.clock.pre.ADC, 1);
});

test('pinModified and userLabel report what the UI filters on', () => {
  const e = fresh();
  assert.equal(e.pinModified('PC0'), false);
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.compute();
  assert.equal(e.pinModified('PC0'), true);
  assert.equal(e.pinModified('PD7'), true, 'SYS_RST claims it out of reset');
  e.setGpioField('PC0', 'label', 'LED');
  assert.equal(e.userLabel('PC0'), 'LED');
});

test('redoLabel names the step that redo would replay', () => {
  const e = fresh();
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  assert.equal(e.redoLabel(), null);
  assert.equal(e.undoLabel(), 'GPIO_Output on PC0');
  e.undo();
  assert.equal(e.redoLabel(), 'GPIO_Output on PC0');
  assert.equal(e.undoLabel(), null);
});

test('deepClone copies Sets, Maps and nesting without structuredClone', () => {
  const src = { a: [1, { b: new Set(['x', 'y']) }], m: new Map([['k', { deep: true }]]), n: null, s: 'str' };
  const out = eng.deepClone(src);
  assert.deepEqual(out, src);
  assert.ok(out.a[1].b instanceof Set);
  assert.ok(out.m instanceof Map);
  out.a[1].b.add('z');
  out.m.get('k').deep = false;
  assert.equal(src.a[1].b.has('z'), false, 'the copy is independent');
  assert.equal(src.m.get('k').deep, true);
});
