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
  // WWDG carries no params: in the data file; if that ever changes, pick another.
  const bare = Object.keys(e.M.peripherals).find(pid => !(e.M.peripherals[pid].params || []).length);
  assert.ok(bare, 'every peripheral now has params - this test needs a new subject');
  assert.deepEqual(e.paramDefs(bare), []);
  assert.deepEqual(e.getParams(bare), []);
  assert.throws(() => e.setParam(bare, 'baud', 9600), /has no parameter "baud" \(it has none\)/);
});

test('getParams hands the UI everything it needs, in file order', () => {
  const e = withParams();
  const p = e.getParams('USART1');
  assert.deepEqual(p.map(x => x.key), ['baud', 'parity', 'invert', 'trim'],
    "a child params: list replaces the parent's wholesale, it never merges");
  assert.equal(p[0].unit, 'Bd');
  assert.equal(p[0].min, 110);
  // options normalise to { name, value } whether the file writes strings or objects
  assert.deepEqual(p[1].options.map(o => o.name), ['None', 'Even', 'Odd']);
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

// ---------------------------------------------------------------- the shipped data
// These run against data/mcus/CH32V006.yaml itself, so a schema drift in the data
// file fails here instead of quietly emptying the Parameter Settings tab.

test('the shipped CH32V006 exposes its parameters through the engine', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const withParams = Object.keys(e.M.peripherals).filter(pid => e.getParams(pid).length);
  assert.ok(withParams.length >= 5, `only ${withParams.length} peripherals expose params`);

  for (const pid of withParams) {
    for (const p of e.getParams(pid)) {
      assert.ok(p.key, `${pid}: a parameter with no key`);
      assert.ok(['int', 'number', 'enum', 'bool'].includes(p.type), `${pid}.${p.key}: odd type ${p.type}`);
      assert.notEqual(p.value, undefined, `${pid}.${p.key} has no value`);
      if (p.type === 'enum') {
        assert.ok(p.options && p.options.length, `${pid}.${p.key} is an enum with no options`);
        assert.ok(p.options.some(o => String(o.name) === String(p.value)),
          `${pid}.${p.key} defaults to "${p.value}", which is not one of its options`);
      }
      if (p.type === 'int' || p.type === 'number') {
        if (p.min !== undefined) assert.ok(p.value >= p.min, `${pid}.${p.key} default is below its own minimum`);
        if (p.max !== undefined) assert.ok(p.value <= p.max, `${pid}.${p.key} default is above its own maximum`);
      }
    }
  }
});

test('the shipped USART carries a baud rate the readout can use', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.notEqual(e.paramValue('USART1', 'baud'), undefined, 'USART1 should have a baud parameter');
  const b = e.usartBaud('USART1');
  assert.ok(b, 'usartBaud should return a readout for the shipped part');
  assert.equal(b.clockMhz, 24);
  assert.ok(b.brr > 0);
  assert.ok(Math.abs(b.errorPct) < 1, `115200 on 24 MHz should be close, got ${b.errorPct}%`);
});

test('every shipped parameter survives a project round trip', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setParam('USART1', 'baud', 9600);
  e.setParam('SPI1', 'prescaler', '64');
  const before = JSON.parse(JSON.stringify(Object.fromEntries(
    Object.keys(e.M.peripherals).map(pid => [pid, e.S.periph[pid].params]))));
  const yaml = e.projectSerialize();
  e.loadMcu('CH32V006');
  e.projectApply(yaml);
  const after = Object.fromEntries(Object.keys(e.M.peripherals).map(pid => [pid, e.S.periph[pid].params]));
  assert.deepEqual(after, before);
  assert.deepEqual(e.PROJECT.warnings, []);
});

// ---------------------------------------------------------------- direct API surface
// The pieces above exercise these through setParam/projectApply; these call them by
// name, so the coverage check can see them and a signature change breaks a test.

test('paramKey, paramDefaults and paramsObject are the identity and default helpers', () => {
  const e = withParams();
  assert.equal(e.paramKey({ key: 'baud', name: 'Baud rate' }), 'baud', 'an explicit key wins');
  assert.equal(e.paramKey({ name: 'Baud rate' }), 'Baud rate', 'otherwise the display name is the identity');
  assert.deepEqual(e.paramDefaults(e.M.peripherals.TIM1), { prescaler: 0, period: 999 });
  assert.deepEqual(e.paramDefaults({}), {}, 'a peripheral with no params has no defaults');

  e.setParam('TIM1', 'period', 42);
  assert.deepEqual(e.paramsObject('TIM1'), { prescaler: 0, period: 42 });
});

test('validateParam is the single gate every value passes', () => {
  const e = withParams();
  const [baud, parity, invert] = e.paramDefs('USART1');
  assert.equal(e.validateParam(baud, '9600'), 9600);
  assert.equal(e.validateParam(parity, 'Even'), 'Even');
  assert.equal(e.validateParam(invert, 'yes'), true);
  assert.throws(() => e.validateParam(baud, 1), /below the minimum/);
  assert.throws(() => e.validateParam(invert, 'maybe'), /expected true or false/);
});

test('paramApplies answers the dependency question on its own', () => {
  const e = withParams();
  const baud = e.paramDefs('USART1').find(d => d.key === 'baud');
  assert.equal(e.paramApplies('USART1', baud), false, 'USART1 is disabled out of reset');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  assert.equal(e.paramApplies('USART1', baud), true);
});

// A `when:` is a lookup keyed by a setting's NAME with one of its CHOICES as the value,
// and both halves are free text the data author types. `paramApplies()` deliberately
// treats an unresolvable dependency as applicable, so a typo cannot hide a field - which
// leaves the typo silent in the other direction: the field appears when it must not, or
// never appears at all. `depProblems()` is the check with no failure mode of its own, and
// it is fed through the real file so the parse and the check are tested together.
const WHEN = when => `
mcu:
  name: CH32V006-WHEN
  inherits: CH32V006
peripherals:
  USART1:
    params:
      - { key: baud, name: Baud rate, type: int, default: 115200, when: ${when} }
`;
const withWhen = when => {
  const e = fresh();
  e.registerMcuFile(WHEN(when));
  e.loadMcu('CH32V006-WHEN');
  e.compute();
  return e;
};
const probsOf = e => e.depProblems('USART1', e.paramDefs('USART1')[0]);

test('depProblems is silent for a when: that resolves', () => {
  assert.deepEqual(probsOf(withWhen('{ Mode: Asynchronous }')), []);
  // and for the parameter form, which is spelled with depends_on rather than when
  const e = withWhen('{ Mode: Asynchronous }');
  const d = e.paramDefs('USART1')[0];
  assert.deepEqual(e.depProblems('USART1', { ...d, when: undefined, deps: [{ kind: 'param', name: 'baud', op: 'equals', value: 115200 }] }), []);
});

test('depProblems names a when: that points at a setting that does not exist', () => {
  // This is the one that emits a struct the user's choices do not ask for: the gate
  // never closes, so the field is always applicable.
  const [p] = probsOf(withWhen('{ Modee: Asynchronous }'));
  assert.match(p, /Modee/);
  assert.match(p, /neither a setting nor a parameter/);
});

test('depProblems names a when: whose value is not one of the choices', () => {
  // This is the one that emits nothing when something was required.
  const [p] = probsOf(withWhen('{ Mode: Asynchrnous }'));
  assert.match(p, /Asynchrnous/);
  assert.match(p, /not one of its choices/);
  assert.match(p, /Asynchronous/, 'and it lists the choices that do exist');
});

// The prose-shaped `when: { setting: X, is: Y }` reads correctly and is not the schema.
// It shipped once, so it is pinned: both keys are reported, by name.
test('depProblems catches a when: written as prose', () => {
  const found = probsOf(withWhen('{ setting: Mode, is: Asynchronous }'));
  assert.equal(found.length, 2);
  assert.ok(found.some(p => /"setting"/.test(p)));
  assert.ok(found.some(p => /"is"/.test(p)));
});

// A `when:` key that names a parameter looks like it gates the field and does not: the
// lookup is against the settings store, so the field is applicable for ever. The two
// repairs differ, so the message has to say which case it is.
test('depProblems points a parameter-shaped when: at depends_on', () => {
  const [p] = probsOf(withWhen('{ baud: 115200 }'));
  assert.match(p, /"baud"/);
  assert.match(p, /is a parameter of USART1, not a setting/);
  assert.match(p, /depends_on: \{ param: baud \}/);
});

test('depProblems does not guess at an equality against something unenumerated', () => {
  // A numeric parameter has no list of choices to be a member of, so a value that is
  // out of range is a job for validateParam, not for this check.
  const e = withWhen('{ Mode: Asynchronous }');
  const d = e.paramDefs('USART1')[0];
  const dep = { kind: 'param', name: 'baud', op: 'equals', value: 999999 };
  assert.deepEqual(e.depProblems('USART1', { ...d, when: undefined, deps: [dep] }), []);
});

test('paramRegisterValue hands codegen the encoding behind the choice', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const sample = e.getParams('ADC1').find(p => p.type === 'enum');
  assert.ok(sample, 'ADC1 should have an enum parameter');
  const encoded = e.paramRegisterValue('ADC1', sample.key);
  assert.notEqual(encoded, undefined);
  // plain-string options encode as themselves; { name, value } options give the number
  const opt = sample.options.find(o => String(o.name) === String(sample.value));
  assert.equal(String(encoded), String(opt.value));
});

test('applyParams reports rather than throws when a stored value no longer fits', () => {
  const e = withParams();
  const dropped = e.applyParams('USART1', { baud: 19200, parity: 'Mark', ghost: 1 });
  assert.equal(e.paramValue('USART1', 'baud'), 19200);
  assert.equal(dropped.length, 2);
  assert.deepEqual(e.applyParams('USART1', null), [], 'nothing to apply is not an error');
});

// ---------------------------------------------------------------- comparisons
// AGENT-1, 11:20Z: I2C fast-mode duty only matters above 100 kHz, which equality
// cannot express.

const COMPARE = `
mcu: { name: CH32V006-CMP, inherits: CH32V006 }
peripherals:
  I2C1:
    params:
      - { key: speed, name: Clock speed, type: int, default: 100000, min: 1000, max: 400000 }
      - key: duty
        name: Fast-mode duty
        type: enum
        default: "2:1"
        options: ["2:1", "16:9"]
        depends_on: { param: speed, gt: 100000 }
      - key: slow
        name: Only below 50 kHz
        type: bool
        default: false
        depends_on: { param: speed, lt: 50000 }
      - key: listed
        name: Only at a listed speed
        type: bool
        default: false
        depends_on: { param: speed, in: [100000, 400000] }
      - key: notstandard
        name: Not at 100 kHz
        type: bool
        default: false
        depends_on: { param: speed, ne: 100000 }
`;

const compare = () => {
  const e = fresh();
  e.registerMcuFile(COMPARE);
  e.loadMcu('CH32V006-CMP');
  return e;
};
const applies = (e, key) => e.getParams('I2C1').find(p => p.key === key).applicable;

test('a dependency can compare numerically, not just match', () => {
  const e = compare();
  assert.equal(applies(e, 'duty'), false, '100 kHz is not ABOVE 100 kHz');
  e.setParam('I2C1', 'speed', 100001);
  assert.equal(applies(e, 'duty'), true);
  e.setParam('I2C1', 'speed', 400000);
  assert.equal(applies(e, 'duty'), true);
});

test('lt, ne and in all work the same way', () => {
  const e = compare();
  assert.equal(applies(e, 'slow'), false);
  assert.equal(applies(e, 'listed'), true, '100000 is in the list');
  assert.equal(applies(e, 'notstandard'), false, 'it is exactly 100 kHz');

  e.setParam('I2C1', 'speed', 40000);
  assert.equal(applies(e, 'slow'), true);
  assert.equal(applies(e, 'listed'), false);
  assert.equal(applies(e, 'notstandard'), true);
});

test('equality stays the default, so files written before this keep their meaning', () => {
  const e = withParams();
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  const baud = e.paramDefs('USART1').find(d => d.key === 'baud');
  assert.deepEqual(baud.deps, [{ kind: 'setting', name: 'Mode', op: 'equals', value: 'Asynchronous' }]);
  assert.equal(e.paramApplies('USART1', baud), true);
});

// =============================================================================
//  Per-channel parameters — TIM_OCInitTypeDef is filled once per CHANNEL
// =============================================================================

test('a peripheral with channel_params exposes its definitions like any other params', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const defs = e.channelParamDefs('TIM1');
  assert.ok(defs.length, 'TIM1 has a per-channel struct');
  assert.deepEqual(e.channelNumbers('TIM1'), [1, 2, 3, 4]);
  assert.ok(defs.every(d => d.key && d.name), 'the same normalised shape as params:');
  const oc = defs.find(d => d.key === 'ocmode');
  assert.ok(oc && oc.options.some(o => o.sdk === 'TIM_OCMode_PWM1'), 'options carry their sdk macro');
  // TIM2 has six members, TIM1 eight: the Idle-state members are TIM1-only in the header
  assert.ok(e.channelParamDefs('TIM1').length > e.channelParamDefs('TIM2').length,
    'a member the peripheral does not have is absent, not offered');
  assert.deepEqual(e.channelParamDefs('USART1'), [], 'a peripheral without the block has none');
});

test('per-channel values are stored per channel, validated and undoable', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
  e.setChannelParam('TIM1', 1, 'pulse', 1000);
  e.setChannelParam('TIM1', 2, 'pulse', 2000);
  assert.equal(e.channelParamValue('TIM1', 1, 'pulse'), 1000);
  assert.equal(e.channelParamValue('TIM1', 2, 'pulse'), 2000, 'channels do not share a value');
  assert.equal(e.channelParamValue('TIM1', 3, 'pulse'), 0, 'and an untouched one is the default');

  e.setChannelParam('TIM1', 1, 'ocmode', 'PWM mode 2');
  assert.equal(e.channelParamRegisterValue('TIM1', 1, 'ocmode'), 7, 'TIMx_CHCTLRn OCxM');
  e.undo();
  assert.equal(e.channelParamValue('TIM1', 1, 'ocmode'), 'PWM mode 1', 'one undo step');
});

test('a channel or a parameter the part does not have is refused by name', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.throws(() => e.setChannelParam('TIM1', 5, 'pulse', 1), /has no channel 5 \(it has 1, 2, 3, 4\)/);
  assert.throws(() => e.setChannelParam('TIM1', 1, 'nope', 1), /channel 1 has no parameter "nope"/);
  assert.throws(() => e.setChannelParam('TIM1', 1, 'pulse', 70000), /above the maximum 65535/);
  assert.throws(() => e.setChannelParam('USART1', 1, 'pulse', 1), /USART1 has no per-channel parameters/);
  assert.throws(() => e.setChannelParam('NOPE1', 1, 'pulse', 1), /No such peripheral: NOPE1/);
  assert.equal(e.channelParamValue('TIM1', 1, 'pulse'), 0, 'no rejected write stuck');
});

test('per-channel values round-trip through .wchproj', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
  e.setChannelParam('TIM1', 1, 'pulse', 1234);
  e.setChannelParam('TIM1', 1, 'ocmode', 'Toggle');
  e.setChannelParam('TIM1', 3, 'pulse', 99);
  const text = e.projectSerialize();
  assert.match(text, /channel_params:/);

  e.loadMcu(e.MCU_FILES.CH32V006);
  assert.equal(e.channelParamValue('TIM1', 1, 'pulse'), 0, 'setup: wiped');
  e.projectApply(text);
  assert.deepEqual(e.PROJECT.warnings, []);
  assert.equal(e.channelParamValue('TIM1', 1, 'pulse'), 1234);
  assert.equal(e.channelParamValue('TIM1', 1, 'ocmode'), 'Toggle');
  assert.equal(e.channelParamValue('TIM1', 3, 'pulse'), 99);
});

test('a saved channel value the part no longer has is dropped and reported', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setChannelParam('TIM1', 1, 'pulse', 5);
  const text = e.projectSerialize().replace('pulse: 5', 'pulse: 5\n        gone_key: 7');
  e.projectApply(text);
  assert.equal(e.channelParamValue('TIM1', 1, 'pulse'), 5, 'what still exists still applies');
  assert.ok(e.PROJECT.warnings.some(w => /gone_key/.test(w)),
    'and the rest is said out loud: ' + JSON.stringify(e.PROJECT.warnings));
});

test('the channels a peripheral actually has configured, or why that is not knowable', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
  e.compute();
  const { channels, missing } = e.activeChannels('TIM1');
  if (missing) {
    // No `channels:` map in the data yet (requested on the board 16:44Z). The only other
    // way to link channel 1 to the setting called "Channel1" is to read the display name
    // and take the digit, which is deriving structure from a label.
    assert.deepEqual(channels, []);
    assert.match(missing, /channel_params has no channels: map/);
  } else {
    assert.ok(channels.includes(1), 'the map landed, so channel 1 is live');
  }
  assert.deepEqual(e.activeChannels('USART1'), { channels: [], missing: null },
    'a peripheral with no per-channel struct has nothing to say either way');
});

// The shape proposed to AGENT-1 on the board at 16:44Z, proved before they commit to it.
const TIM_WITH_CHANNELS = `
mcu:
  name: CH32V006-TIMCHAN
  inherits: CH32V006
peripherals:
  TIM1:
    channel_params:
      struct: TIM_OCInitTypeDef
      applies_per: channel
      sdk_calls: { 1: TIM_OC1Init, 2: TIM_OC2Init, 3: TIM_OC3Init, 4: TIM_OC4Init }
      channels:
        1: { setting: Channel1, output_choices: [PWM Generation CH1, PWM Generation CH1 CH1N] }
        2: { setting: Channel2, output_choices: [PWM Generation CH2] }
        3: { setting: Channel3, output_choices: [PWM Generation CH3] }
        4: { setting: Channel4, output_choices: [PWM Generation CH4] }
      params:
        - key: ocmode
          name: Output compare mode
          sdk_field: TIM_OCMode
          type: enum
          default: PWM mode 1
          options:
            - { name: PWM mode 1, value: 6, sdk: TIM_OCMode_PWM1 }
            - { name: Toggle,     value: 3, sdk: TIM_OCMode_Toggle }
`;

test('with a channels: map, only the configured output-compare channels are live', () => {
  const e = fresh();
  e.registerMcuFile(TIM_WITH_CHANNELS);
  e.loadMcu('CH32V006-TIMCHAN');
  e.setPackage('TSSOP20');
  e.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
  e.setSetting('TIM1', 'Channel3', 'PWM Generation CH3');
  e.compute();
  assert.deepEqual(e.activeChannels('TIM1'), { channels: [1, 3], missing: null });
});

test('input capture is not an output compare, so its channel is not live', () => {
  const e = fresh();
  e.registerMcuFile(TIM_WITH_CHANNELS);
  e.loadMcu('CH32V006-TIMCHAN');
  e.setPackage('TSSOP20');
  e.setSetting('TIM1', 'Channel1', 'Input Capture');
  e.compute();
  assert.deepEqual(e.activeChannels('TIM1').channels, [],
    'Input Capture fills TIM_ICInitTypeDef, a different struct, so treating it as an '
    + 'output compare would configure the wrong unit');
});
