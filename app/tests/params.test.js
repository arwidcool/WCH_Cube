// params.js — peripheral parameter settings, and the numbers they imply.
//
// No shipped MCU file carries `params:` yet (AGENT-1 has the schema in
// app/assets/params.stub.yaml), so these derive a part that does. Deriving with
// inherits keeps the fixture honest: it is CH32V006 plus exactly the block under test.
import { test, assert, fresh, eng } from './_harness.js';

const PARAMS = `
mcu:
  name: CH32V006-PARAMS
  inherits: CH32V006
peripherals:
  USART1:
    params:
      - { key: baud, name: Baud rate, type: int, default: 115200, min: 110, max: 4500000, unit: Bd, when: { Mode: Asynchronous } }
      - { key: parity, name: Parity, type: enum, default: None, options: [None, Even, Odd] }
      - { key: invert, name: Invert TX, type: bool, default: false }
      - { key: trim, name: Fine trim, type: number, default: 1.5, min: 0, max: 3 }
  TIM1:
    params:
      - { key: prescaler, name: Prescaler, type: int, default: 0, min: 0, max: 65535 }
      - { key: period, name: Period, type: int, default: 999, min: 0, max: 65535 }
`;

const withParams = () => {
  const e = fresh();
  e.registerMcuFile(PARAMS);
  e.loadMcu('CH32V006-PARAMS');
  e.compute();
  return e;
};

test('a fresh part starts at the defaults from its file', () => {
  const e = withParams();
  assert.deepEqual(e.S.periph.USART1.params, { baud: 115200, parity: 'None', invert: false, trim: 1.5 });
  assert.equal(e.paramValue('USART1', 'baud'), 115200);
});

test('a peripheral with no params block simply has none', () => {
  const e = withParams();
  assert.deepEqual(e.paramDefs('SPI1'), []);
  assert.deepEqual(e.getParams('SPI1'), []);
  assert.throws(() => e.setParam('SPI1', 'baud', 9600), /SPI1 has no parameter "baud" \(it has none\)/);
});

test('getParams hands the UI everything it needs, in file order', () => {
  const e = withParams();
  const p = e.getParams('USART1');
  assert.deepEqual(p.map(x => x.key), ['baud', 'parity', 'invert', 'trim']);
  assert.equal(p[0].unit, 'Bd');
  assert.equal(p[0].min, 110);
  assert.deepEqual(p[1].options, ['None', 'Even', 'Odd']);
  assert.equal(p[2].type, 'bool');
});

test('`when` marks a parameter inapplicable instead of hiding it', () => {
  const e = withParams();
  assert.equal(e.getParams('USART1')[0].applicable, false, 'USART1 starts disabled, so baud does not apply');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  assert.equal(e.getParams('USART1')[0].applicable, true);
  assert.equal(e.getParams('USART1')[1].applicable, true, 'a param with no `when` always applies');
});

test('values are coerced and range-checked, with a sentence a user can act on', () => {
  const e = withParams();
  assert.equal(e.setParam('USART1', 'baud', '9600'), 9600, 'a numeric string is accepted as a number');
  assert.equal(e.setParam('USART1', 'invert', 'true'), true);
  assert.equal(e.setParam('USART1', 'trim', 2.25), 2.25, 'type number allows fractions');

  assert.throws(() => e.setParam('USART1', 'baud', 5), /below the minimum 110 Bd/);
  assert.throws(() => e.setParam('USART1', 'baud', 9e9), /above the maximum/);
  assert.throws(() => e.setParam('USART1', 'baud', 1.5), /must be a whole number/);
  assert.throws(() => e.setParam('USART1', 'baud', 'fast'), /is not a number/);
  assert.throws(() => e.setParam('USART1', 'parity', 'Mark'), /is not one of None, Even, Odd/);
  assert.throws(() => e.setParam('USART1', 'nope', 1), /has no parameter "nope" \(has: baud, parity, invert, trim\)/);
  assert.throws(() => e.setParam('NOSUCH', 'baud', 1), /No such peripheral/);

  assert.equal(e.paramValue('USART1', 'baud'), 9600, 'a rejected write leaves the old value alone');
});

test('one parameter change is one undo step', () => {
  const e = withParams();
  e.setParam('USART1', 'baud', 9600);
  e.setParam('USART1', 'parity', 'Even');
  assert.equal(e.undoLabel(), 'USART1 Parity');
  e.undo();
  assert.equal(e.paramValue('USART1', 'parity'), 'None');
  assert.equal(e.paramValue('USART1', 'baud'), 9600, 'only the last step came back');
  e.undo();
  assert.equal(e.paramValue('USART1', 'baud'), 115200);
  e.redo();
  assert.equal(e.paramValue('USART1', 'baud'), 9600);
});

test('resetParams puts the whole block back in one step', () => {
  const e = withParams();
  e.setParam('USART1', 'baud', 9600);
  e.setParam('USART1', 'parity', 'Odd');
  e.resetParams('USART1');
  assert.deepEqual(e.S.periph.USART1.params, { baud: 115200, parity: 'None', invert: false, trim: 1.5 });
  e.undo();
  assert.equal(e.paramValue('USART1', 'parity'), 'Odd', 'the reset was a single step');
});

test('parameters round-trip through a .wchproj', () => {
  const e = withParams();
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setParam('USART1', 'baud', 19200);
  e.setParam('USART1', 'parity', 'Even');
  e.setParam('TIM1', 'period', 1234);
  const yaml = e.projectSerialize();
  assert.match(yaml, /baud: 19200/);

  e.loadMcu('CH32V006-PARAMS');                 // wipe back to defaults
  assert.equal(e.paramValue('USART1', 'baud'), 115200);
  e.projectApply(yaml);
  assert.equal(e.paramValue('USART1', 'baud'), 19200);
  assert.equal(e.paramValue('USART1', 'parity'), 'Even');
  assert.equal(e.paramValue('TIM1', 'period'), 1234);
  assert.deepEqual(e.PROJECT.warnings, [], 'nothing should have been dropped');
});

test('a project written against an older file drops what no longer fits, and says so', () => {
  const e = withParams();
  const obj = e.projectObject();
  obj.peripherals.USART1.params = { baud: 19200, gone: 42, parity: 'Mark' };
  const yaml = e.yamlDump(obj);
  e.projectApply(yaml);
  assert.equal(e.paramValue('USART1', 'baud'), 19200, 'the valid one still applies');
  assert.equal(e.paramValue('USART1', 'parity'), 'None', 'the invalid one is left at its default');
  assert.equal(e.PROJECT.warnings.length, 2);
  assert.match(e.PROJECT.warnings.join('\n'), /no such parameter any more/);
  assert.match(e.PROJECT.warnings.join('\n'), /is not one of/);
});

// ---------------------------------------------------------------- derived numbers

test('periphClockMhz finds the bus the MCU file puts the peripheral on', () => {
  const e = withParams();
  // CH32V006 has a single HB domain; HCLK is 24 MHz from HSI out of reset
  assert.equal(e.periphClockMhz('USART1'), 24);
  assert.equal(e.periphClockMhz('TIM1'), 24);
});

test('the USART baud readout is BRR = round(fCK / baud), with the real error', () => {
  const e = withParams();
  e.setSetting('USART1', 'Mode', 'Asynchronous');

  // 24 MHz / 115200 = 208.33 -> 208 -> 115384.6 Bd, +0.16%
  const b = e.usartBaud('USART1');
  assert.equal(b.clockMhz, 24);
  assert.equal(b.brr, 208);
  assert.equal(b.actual, 115384.62);
  assert.ok(Math.abs(b.errorPct - 0.16) < 0.005, `error was ${b.errorPct}`);
  assert.equal(b.mantissa, 13);
  assert.equal(b.fraction, 0);
  assert.equal(b.note, '', '0.16% needs no warning');

  // 9600 divides exactly
  e.setParam('USART1', 'baud', 9600);
  const exact = e.usartBaud('USART1');
  assert.equal(exact.brr, 2500);
  assert.equal(exact.actual, 9600);
  assert.equal(exact.errorPct, 0);
});

test('a baud rate the clock cannot reach is called out, not silently rounded', () => {
  const e = withParams();
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setParam('USART1', 'baud', 4000000);        // 24 MHz / 4 MBd = 6
  const b = e.usartBaud('USART1');
  assert.equal(b.brr, 6);
  assert.equal(b.actual, 4000000);

  e.setParam('USART1', 'baud', 4400000);        // 24/4.4 = 5.45 -> 5 -> 4.8 MBd, +9.1%
  const off = e.usartBaud('USART1');
  assert.equal(off.brr, 5);
  assert.equal(off.actual, 4800000);
  assert.ok(Math.abs(off.errorPct) > 2.5, `expected a big error, got ${off.errorPct}`);
  assert.match(off.note, /most receivers need better than 2\.5%/);

  // a value a stale project could carry: faster than the clock can divide to at all
  e.S.periph.USART1.params.baud = 60000000;     // 24/60 = 0.4 -> BRR 0
  const impossible = e.usartBaud('USART1');
  assert.equal(impossible.brr, null);
  assert.equal(impossible.actual, null);
  assert.match(impossible.note, /faster than this clock can divide down to/);
});

test('the baud readout follows the clock tree', () => {
  const e = withParams();
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setClock({ sys: 'PLLCLK' });                 // 48 MHz
  assert.equal(e.periphClockMhz('USART1'), 48);
  const b = e.usartBaud('USART1');
  assert.equal(b.clockMhz, 48);
  assert.equal(b.brr, Math.round(48e6 / 115200));
});

test('a peripheral with no baud parameter has no baud readout', () => {
  const e = withParams();
  assert.equal(e.usartBaud('SPI1'), null);
  assert.equal(e.timerFrequency('SPI1'), null);
});

test('timerFrequency turns prescaler and period into a real frequency', () => {
  const e = withParams();
  e.setParam('TIM1', 'prescaler', 23);           // 24 MHz / 24 = 1 MHz
  e.setParam('TIM1', 'period', 999);             // / 1000 = 1 kHz
  const t = e.timerFrequency('TIM1');
  assert.equal(t.hz, 1000);
  assert.equal(t.periodUs, 1000);
});
