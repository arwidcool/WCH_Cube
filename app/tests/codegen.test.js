// codegen.js — C initialisation code.
//
// The register encodings below are read from the CH32V00X Reference Manual V1.4
// (RCC_CFGR0 in 3.4.2, AFIO_PCFR1 in 7.3.2.2) and carried here on a child MCU
// file, so these tests prove the full path without editing AGENT-1's data file.
// Once the same block lands in CH32V006.yaml the generator needs no change.
import { test, assert, fresh, eng, mcuNames } from './_harness.js';

// AFIO_PCFR1: SPI1_RM[2:0] at 0, I2C1_RM[2:0] at 3, USART1_RM[3:0] at 6,
// TIM1_RM[3:0] at 10, TIM2_RM[1:0] at 14 with TIM2_RM[2] away at bit 16,
// USART2_RM[2:0] at 20.  RCC_CFGR0: SW[1:0] at 0, HPRE[3:0] at 4,
// ADCPRE[4:0] at 11, PLLSRC at 16.
const CODEGEN_BLOCK = `
mcu:
  name: CH32V006-CODEGEN
  inherits: CH32V006
codegen:
  header: ch32v00x.h
  gpio_clock: { fn: RCC_PB2PeriphClockCmd, port: RCC_PB2Periph_GPIO$PORT, afio: RCC_PB2Periph_AFIO }
  speeds: { Low: GPIO_Speed_2MHz, Medium: GPIO_Speed_10MHz, High: GPIO_Speed_50MHz }
  remap:
    register: "AFIO->PCFR1"
    fields:
      SPI1:   [{ lsb: 0,  bits: 3 }]
      I2C1:   [{ lsb: 3,  bits: 3 }]
      USART1: [{ lsb: 6,  bits: 4 }]
      TIM1:   [{ lsb: 10, bits: 4 }]
      TIM2:   [{ lsb: 14, bits: 2 }, { lsb: 16, bits: 1, from: 2 }]
      USART2: [{ lsb: 20, bits: 3 }]
  analog_signals:
    ADC1: [IN0, IN1, IN2, IN3, IN4, IN5, IN6, IN7]
  rcc:
    register: "RCC->CFGR0"
    sw:     { lsb: 0,  bits: 2, values: { HSI: 0, HSE: 1, PLLCLK: 2 } }
    pllsrc: { lsb: 16, bits: 1, values: { HSI: 0, HSE: 1 } }
    prescalers:
      HB:  { lsb: 4,  bits: 4, values: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 16: 11, 32: 12, 64: 13, 128: 14, 256: 15 } }
      ADC: { lsb: 11, bits: 5, values: { 1: 0, 2: 0, 4: 4, 6: 8, 8: 12, 12: 20, 16: 28, 24: 21, 32: 29, 48: 22, 64: 30, 96: 23, 128: 31 } }
`;

const withCodegen = () => {
  const e = fresh();
  e.registerMcuFile(CODEGEN_BLOCK);
  e.loadMcu('CH32V006-CODEGEN');
  return e;
};

// Parts that deliberately state LESS than CH32V006, defined here rather than pointing at
// WCH-DUMMY32-C8 so these tests keep testing the generator while AGENT-1 fills that part
// in (round-3 C7). `mcu.remove` runs against the parent, so each of these is exactly the
// reference part minus one thing.
const NO_CODEGEN = `
mcu:
  name: WCH-DUMMY32-NOCODEGEN
  inherits: CH32V006
  fixture: true
  remove: [codegen, gpio]
`;
const NO_SPEEDS = `
mcu:
  name: CH32V006-NOSPEEDS
  inherits: CH32V006
  remove: [gpio.speeds, codegen.speeds]
`;
const withFile = (text, name) => { const e = fresh(); e.registerMcuFile(text); e.loadMcu(name); return e; };

test('the plan names the pin the signal really uses, even on a shorted pair', () => {
  const e = fresh();
  e.assignSignal('PA4', { gpio: 'GPIO_Output' });   // PA4 and PD7 are one pin
  e.resetPin('PD7');                                 // clear SYS_RST off it first
  e.assignSignal('PA4', { gpio: 'GPIO_Output' });
  e.compute();
  const row = e.gpioPlan().find(p => p.pin === 'PA4');
  assert.ok(row, 'the plan configures PA4');
  assert.equal(row.port, 'A');
  assert.equal(row.bit, 4);
  assert.equal(e.gpioPlan().some(p => p.pin === 'PD7'), false, 'not the canonical name');
});

test('modes come from the GPIO table, and sensible defaults otherwise', () => {
  const e = fresh();
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.assignSignal('PC1', { gpio: 'GPIO_Input' });
  e.setGpioField('PC1', 'pull', 'Pull-up');
  e.assignSignal('PC2', { gpio: 'GPIO_Analog' });
  e.assignSignal('PC4', { periph: 'SPI1', signal: 'NSS', remap: 2 });
  e.compute();
  const by = Object.fromEntries(e.gpioPlan().map(p => [p.pin, p]));
  assert.equal(by.PC0.macro, 'GPIO_Mode_Out_PP');
  assert.equal(by.PC1.macro, 'GPIO_Mode_IPU');
  assert.equal(by.PC2.macro, 'GPIO_Mode_AIN');
  assert.equal(by.PC4.macro, 'GPIO_Mode_AF_PP', 'a peripheral signal defaults to alternate function');
});

test('the generated GPIO code is grouped by port, mode and speed', () => {
  const e = withCodegen();
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.assignSignal('PC1', { gpio: 'GPIO_Output' });
  e.setGpioField('PC0', 'label', 'LED');
  e.compute();
  const c = e.cSource();
  assert.ok(c.includes('GPIO_InitTypeDef GPIO_InitStructure = {0};'));
  assert.ok(c.includes('RCC_PB2PeriphClockCmd(RCC_PB2Periph_GPIOC | RCC_PB2Periph_AFIO, ENABLE);'));
  assert.ok(c.includes('GPIO_InitStructure.GPIO_Pin = GPIO_Pin_0 | GPIO_Pin_1;'), 'same mode and speed share one call');
  assert.ok(c.includes('GPIO_InitStructure.GPIO_Mode = GPIO_Mode_Out_PP;'));
  // The part's one speed, from `gpio.speeds` on CH32V006, which this fixture inherits.
  // NOT the legacy Low/Medium/High map in codegen.speeds above: that map exists only to
  // translate a name a .wchproj saved earlier, and it never decides what is emitted.
  assert.ok(c.includes('GPIO_InitStructure.GPIO_Speed = GPIO_Speed_30MHz;'));
  assert.equal(/GPIO_Speed_(2|10|50)MHz/.test(c), false, 'no macro this part does not have');
  assert.ok(c.includes('GPIO_Init(GPIOC, &GPIO_InitStructure);'));
  assert.ok(c.includes('/* PC0 "LED" — GPIO_Output */'), 'user labels reach the code');
});

// Round-3 P0b. The defect the round opened with: codegen emitted GPIO_Speed_50MHz on a
// part whose GPIOSpeed_TypeDef has exactly one member, GPIO_Speed_30MHz
// (data/sources/V006/Evt/EXAM/SRC/Peripheral/inc/ch32v00X_gpio.h lines 22-26).
test('a one-speed part emits its one macro, whatever the GPIO table stored', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.deepEqual(e.gpioSpeeds(), [{ name: '30 MHz', macro: 'GPIO_Speed_30MHz' }]);
  assert.equal(e.gpioSpeedIsChoice(), false, 'one speed means the control is not shown');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  // a stored speed from before the fix, and one that never existed anywhere
  for (const stored of ['High', 'Low', 'GPIO_Speed_50MHz', undefined]) {
    e.S.gpio.PC0 = Object.assign(e.S.gpio.PC0 || {}, { speed: stored });
    e.compute();
    const c = e.cSource();
    assert.ok(c.includes('GPIO_Speed = GPIO_Speed_30MHz;'), `stored ${stored}`);
    assert.equal(/GPIO_Speed_(2|10|50)MHz/.test(c), false, `stored ${stored}: no invented macro`);
    assert.equal(e.gpioPlan().find(p => p.pin === 'PC0').speed, '30 MHz', 'the plan normalises it too');
  }
});

test('a part with a real choice still maps each name to its own macro', () => {
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-TWOSPEED
  inherits: CH32V006
gpio:
  speeds:
    - { name: "10 MHz", macro: GPIO_Speed_10MHz }
    - { name: "30 MHz", macro: GPIO_Speed_30MHz }
`);
  e.loadMcu('CH32V006-TWOSPEED');
  assert.equal(e.gpioSpeedIsChoice(), true, 'two entries means a real selector');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.assignSignal('PC1', { gpio: 'GPIO_Output' });
  e.setGpioField('PC0', 'speed', '10 MHz');
  e.setGpioField('PC1', 'speed', '30 MHz');
  e.compute();
  const c = e.cSource();
  assert.ok(c.includes('GPIO_Speed = GPIO_Speed_10MHz;'), 'the slow pin');
  assert.ok(c.includes('GPIO_Speed = GPIO_Speed_30MHz;'), 'the fast pin');
  assert.ok(!c.includes('GPIO_Pin_0 | GPIO_Pin_1'), 'and two speeds are two GPIO_Init calls');
});

test('a part that states no speed at all gets a TODO, not a guessed macro', () => {
  const e = withFile(NO_SPEEDS, 'CH32V006-NOSPEEDS');
  assert.deepEqual(e.gpioSpeeds(), [], 'this part states neither gpio.speeds nor codegen.speeds');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.compute();
  const c = e.cSource();
  assert.equal(/GPIO_InitStructure.GPIO_Speed =/.test(c), false, 'nothing is invented');
  assert.match(c, /TODO: no SPL macro for output speed/);
  assert.ok(e.cComplaints().some(x => x.kind === 'todo' && /output speed/.test(x.text)));
});

test('the AFIO word is built from the remap indices', () => {
  const e = withCodegen();
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setRemap('USART1', 3);                     // USART1_RM = 0011 at bit 6 -> 0x0C0
  e.setSetting('I2C1', 'Mode', 'I2C');
  e.setRemap('I2C1', 2);                       // I2C1_RM = 010 at bit 3 -> 0x010
  e.compute();
  const w = e.remapWord();
  assert.equal(w.register, 'AFIO->PCFR1');
  assert.equal(w.value, 0x0d0);
  // bits 17-19 (PA1PA2_RM, ADC_ETRGINJ_RM, ADC_ETRGREG_RM) are not declared as
  // remap fields, so the mask must leave them alone
  assert.equal(w.mask, (0x7 << 0) | (0x7 << 3) | (0xf << 6) | (0xf << 10) | (0x3 << 14) | (0x1 << 16) | (0x7 << 20));
  assert.equal(w.mask, 0x0071ffff);
  const c = e.cSource();
  assert.ok(c.includes('AFIO->PCFR1 = (AFIO->PCFR1 & ~0x0071FFFFU) | 0x000000D0U;'), c.split('\n').filter(l => l.includes('PCFR1')).join('\n'));
  assert.ok(c.includes('/*   USART1_RM = 0011'));
});

test('a split field puts each slice where it belongs (TIM2_RM[2] at bit 16)', () => {
  const e = withCodegen();
  const tim2 = e.M.peripherals.TIM2.remaps.length;
  assert.ok(tim2 > 4, `TIM2 has ${tim2} remaps, so index 4 exists and needs bit 16`);
  e.setRemap('TIM2', 4);                        // 100b: [1:0] = 00 at bit 14, [2] = 1 at bit 16
  const w = e.remapWord();
  assert.equal(w.value & (1 << 16), 1 << 16);
  assert.equal((w.value >> 14) & 0x3, 0);
  e.setRemap('TIM2', 3);                        // 011b: [1:0] = 11, [2] = 0
  const w2 = e.remapWord();
  assert.equal(w2.value & (1 << 16), 0);
  assert.equal((w2.value >> 14) & 0x3, 3);
});

test('the RCC word encodes the mux and the prescalers', () => {
  const e = withCodegen();
  e.setClock({ sys: 'PLLCLK', pllIn: 1, pre: { HB: 4, ADC: 4 } });
  const w = e.rccWord();
  assert.equal(w.register, 'RCC->CFGR0');
  assert.equal(w.value & 0x3, 2, 'SW = 10b, PLL as system clock');
  assert.equal((w.value >> 4) & 0xf, 3, 'HPRE = 0011b, divide by 4');
  assert.equal((w.value >> 11) & 0x1f, 4, 'ADCPRE = 00100b, divide by 4');
  assert.equal((w.value >> 16) & 0x1, 1, 'PLLSRC = HSE');
  const c = e.cSource();
  assert.ok(c.includes('RCC->CFGR0 = (RCC->CFGR0 & ~'), 'the write is emitted');
  assert.ok(c.includes('/* SYSCLK source = 10 (bits 1:0) */'));
});

test('an out-of-spec clock is called out in the generated comments', () => {
  const e = withCodegen();
  e.setClock({ sys: 'PLLCLK', pre: { ADC: 8 } });        // 48 / 8 = 6 MHz, below the 16 MHz floor
  const c = e.cSource();
  assert.ok(c.includes('WARNING: out of specification: ADC'));
});

test('unresolved conflicts make the file refuse to compile', () => {
  const e = withCodegen();
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setRemap('USART1', 4);                 // TX lands on PD1, where SYS_SWIO already is
  e.compute();
  const c = e.cSource();
  assert.ok(c.startsWith('/*'), 'still a readable file');
  assert.ok(/#error "WCHCube: 1 unresolved pin conflict/.test(c), 'a conflicted design must not silently generate');
  assert.ok(c.includes('*** CONFLICT ***'), 'and the pin is marked in place');
});

// CH32V006 carries a real codegen: block now, so the "no block" cases need a part that
// genuinely lacks one. Deriving it with inherits + remove keeps the fixture honest: it is
// the shipped part minus exactly the thing under test.
const withoutCodegen = (paths = ['codegen'], name = 'CH32V006-NOCODEGEN') => {
  const e = fresh();
  e.registerMcuFile(`mcu:\n  name: ${name}\n  inherits: CH32V006\n  remove: [${paths.join(', ')}]\n`);
  e.loadMcu(name);
  return e;
};

test('a real part with no codegen: block refuses to compile, and says what is missing', () => {
  const e = withoutCodegen();
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setRemap('USART1', 3);
  e.compute();
  const c = e.cSource();
  assert.equal(e.remapWord(), null);
  assert.equal(e.rccWord(), null);
  assert.equal(e.isFixture(), false, 'a derived CH32V006 is a real part, not a fixture');
  assert.ok(c.includes('#error "WCHCube: CH32V006-NOCODEGEN has no codegen: block'),
    'a real part must not silently produce an init that does nothing');
  assert.ok(c.includes('TODO: alternate function remap'), 'and the sections still say what is missing');
  assert.ok(c.includes('USART1: index 3 — 0011'), 'it still says what was chosen');
  assert.ok(c.includes('TODO: enable the port clocks for GPIOC'));
  assert.ok(c.includes('TODO: the MCU file has no codegen.rcc block'));
  assert.ok(c.includes('GPIO_Init(GPIOC, &GPIO_InitStructure);'), 'the GPIO half is generated regardless');
});

test('a fixture part with no codegen: block explains itself without refusing to compile', () => {
  const e = withFile(NO_CODEGEN, 'WCH-DUMMY32-NOCODEGEN');
  e.compute();
  assert.equal(e.isFixture(), true, 'mcu.fixture marks it, and so does the name');
  const c = e.cSource();
  assert.ok(c.includes('TODO'), 'it should still say what a real part would need');
  assert.equal(c.includes('has no codegen: block'), false,
    'a fixture exists to exercise the tool; #error would just break its own tests');
  assert.equal(fresh('WCH-DUMMY32-C8').isFixture(), true, 'and the bundled dummy part is one too');
});

test('the header declares exactly what the source defines', () => {
  const e = withCodegen();
  const h = e.cHeader();
  assert.ok(h.includes('#ifndef WCHCUBE_INIT_H'));
  assert.ok(h.includes('#include "ch32v00x.h"'));
  for (const fn of ['WCHCube_RCC_Init', 'WCHCube_GPIO_Init', 'WCHCube_Init']) {
    assert.ok(h.includes(`void ${fn}(void);`), `${fn} declared`);
    assert.ok(e.cSource().includes(`void ${fn}(void)\n{`), `${fn} defined`);
  }
});

test('the generated C is structurally sound: balanced braces, every statement closed', () => {
  const e = withCodegen();
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.assignSignal('PC6', { periph: 'SPI1', signal: 'MOSI', remap: 0 });
  e.setClock({ sys: 'PLLCLK' });
  e.compute();
  for (const [name, text] of Object.entries(e.cFiles())) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '');          // strip comments
    let depth = 0;
    for (const ch of code) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; assert.ok(depth >= 0, `${name}: unbalanced closing brace`); }
    }
    assert.equal(depth, 0, `${name}: ${depth} unclosed brace(s)`);
    assert.equal((code.match(/\/\*/g) || []).length, 0, `${name}: unterminated comment`);
    for (const line of code.split('\n')) {
      const s = line.trim();
      // a statement ends in ';'; a signature or a continued expression does not
      if (!s || s.startsWith('#') || /[{};,)|]$/.test(s)) continue;
      assert.fail(`${name}: statement without a semicolon: ${s}`);
    }
  }
});

test('generateAll ships the reports and the C files together', () => {
  const e = withCodegen();
  const files = e.generateAll().map(f => f.name);
  assert.ok(files.includes('wchcube_init.c'));
  assert.ok(files.includes('wchcube_init.h'));
  assert.ok(files.some(f => f.endsWith('_pinout.md')));
  assert.ok(files.some(f => f.endsWith('_pinout.csv')));
  assert.ok(files.some(f => f.endsWith('_clocks.md')));
});

test('the file names the part, package and project it came from', () => {
  const e = withCodegen();
  e.setProject({ name: 'Blinky', variant: 'CH32V006F8P7' });
  const c = e.cSource();
  assert.ok(c.includes('Project : Blinky (CH32V006F8P7)'));
  assert.ok(c.includes('Part    : CH32V006-CODEGEN  TSSOP20'));
  assert.ok(c.includes('Do not edit by hand'));
});

test('every bundled part and package generates without throwing', () => {
  const e = fresh();
  for (const name of Object.keys(e.MCU_FILES)) {
    e.loadMcu(e.MCU_FILES[name]);
    for (const pkg of Object.keys(e.M.packages)) {
      e.setPackage(pkg);
      e.compute();
      const files = e.cFiles();
      assert.ok(files['wchcube_init.c'].length > 200, `${name} ${pkg} produced a source file`);
    }
  }
});

test('a bonding remap table is not an AFIO remap table, so it is not asked for a macro', () => {
  // A DEFAULT configuration emits an empty GPIO function and never reaches the remap
  // section, so it proves nothing about it. With one pin assigned it does - and there
  // CH32X035 on TSSOP20 and QSOP28 used to emit a spurious TODO naming the reset pin:
  // its RST is bonded to PC3 on those packages (`remap_by_package`, index 1), SYS's
  // remap table carries no `macro:` on either index because it is not an AFIO remap at
  // all, and the filter only asked "is a remap selected". Every CH32X035 TSSOP20
  // configuration therefore failed --strict for a rule that does not exist.
  const e = fresh();
  for (const name of Object.keys(e.MCU_FILES)) {
    e.loadMcu(e.MCU_FILES[name]);
    for (const pkg of Object.keys(e.M.packages)) {
      e.setPackage(pkg);
      e.compute();
      // a pin nothing has claimed and no constraint restricts, so neither can be what
      // complains - this check is about the remap section and nothing else
      const free = Object.keys(e.M.pins).find(p => e.pinExists(p) && e.pinType(p) === 'io'
        && !e.E.pins[e.canon(p)] && !e.E.constraintIssues.some(c => c.pin === p));
      assert.ok(free, `${name} ${pkg}: no unclaimed I/O pin, so this check cannot run`);
      e.assignSignal(free, { gpio: 'GPIO_Output' });
      e.compute();
      assert.deepEqual(e.cComplaints(e.cFiles()), [], `${name} ${pkg}, ${free} assigned`);
    }
  }
});

test('the debug interface and the reset pin are never set up as GPIOs', () => {
  const e = withCodegen();
  e.compute();
  assert.equal(e.E.pins.PD1.label, 'SYS_SWIO', 'they are claimed out of reset');
  assert.equal(e.E.pins.PD7.label, 'SYS_RST');
  assert.equal(e.gpioPlan().some(p => p.pin === 'PD1' || p.pin === 'PD7'), false,
    'driving the reset pin as an output would brick the board until the next power cycle');
  assert.deepEqual(e.skippedPins().map(s => s.signal).sort(), ['SYS_RST', 'SYS_SWIO']);
  const c = e.cSource();
  assert.ok(c.includes('Not configured here, by design: PD1 (SYS_SWIO), PD7 (SYS_RST)'));
  assert.equal(c.includes('GPIO_Pin_7 | '), false, 'PD7 is not in any port D mask');
});

test('an ADC channel is an analog input, not an alternate function', () => {
  const e = withCodegen();
  e.toggleSetting('ADC1', 'Channels', 'IN4', true);      // ADC1_IN4 is on PD3
  e.compute();
  const row = e.gpioPlan().find(p => p.pin === 'PD3');
  assert.equal(row.macro, 'GPIO_Mode_AIN');
  assert.equal(row.inferred, false, 'codegen.analog_signals said so outright');
  assert.ok(e.cSource().includes('GPIO_InitStructure.GPIO_Mode = GPIO_Mode_AIN;'));
});

test('an ADC trigger pin stays digital, which only the data can tell us', () => {
  const e = withCodegen();
  // RETR0 shares PD3 with the IN4 channel, and is a digital trigger input
  e.setSetting('ADC1', 'Regular group external trigger', 'External pin PD3 (ETRGREG_RM=0)');
  e.compute();
  const row = e.gpioPlan().find(p => p.pin === 'PD3');
  assert.equal(row.signal, 'ADC1_RETR0');
  assert.equal(row.macro, 'GPIO_Mode_AF_PP', 'a trigger input is not an analog pin');
});

test('without analog_signals the analog mode is a guess, and says so', () => {
  const e = withoutCodegen(['codegen.analog_signals'], 'CH32V006-NOANALOG');
  e.toggleSetting('ADC1', 'Channels', 'IN4', true);
  e.compute();
  const row = e.gpioPlan().find(p => p.pin === 'PD3');
  assert.equal(row.macro, 'GPIO_Mode_AIN');
  assert.equal(row.inferred, true);
  assert.ok(e.cSource().includes('analog mode inferred — add codegen.analog_signals to be certain'));
});

test('an explicit mode in the GPIO table always wins', () => {
  const e = withCodegen();
  e.toggleSetting('ADC1', 'Channels', 'IN4', true);
  e.setGpioField('PD3', 'mode', 'Output Open Drain');
  e.compute();
  const row = e.gpioPlan().find(p => p.pin === 'PD3');
  assert.equal(row.macro, 'GPIO_Mode_Out_OD');
  assert.equal(row.inferred, false);
});

// A divider whose bits are not contiguous: ADCPRE[4:0] at bit 11 plus ADC_CLK_MODE
// at bit 31, with PLLSRC and MCO in between. AGENT-1 asked for this at 11:12Z.
const MULTI_SLICE = `
mcu: { name: CH32V006-RCCMULTI, inherits: CH32V006 }
codegen:
  rcc:
    register: RCC->CFGR0
    sw: { lsb: 0, bits: 2, values: { HSI: 0, HSE: 1, PLLCLK: 2 } }
    prescalers:
      HB: { lsb: 4, bits: 4, values: { 1: 0, 2: 1 } }
      ADC:
        - { lsb: 11, bits: 5, values: { 2: 0, 4: 4 } }
        - { lsb: 31, bits: 1, values: { 1: 1 }, default: 0 }
`;

const multiSlice = () => {
  const e = fresh();
  e.registerMcuFile(MULTI_SLICE);
  e.loadMcu('CH32V006-RCCMULTI');
  return e;
};

test('a prescaler can put its bits in two places at once', () => {
  const e = multiSlice();
  const adc = () => e.rccWord().parts.find(p => /ADC/.test(p.what));

  e.setClock({ pre: { ADC: 4 } });
  assert.equal(e.rccWord().value & 0xf800, 4 << 11, 'ADCPRE carries the divider');
  assert.equal(e.rccWord().value >>> 31, 0, 'and ADC_CLK_MODE stays clear');
  assert.deepEqual(adc().lsb, [11, 31]);
  assert.equal(adc().slices, 2);

  e.setClock({ pre: { ADC: 1 } });
  assert.equal(e.rccWord().value >>> 31, 1, '/1 is the ADC_CLK_MODE bit, not an ADCPRE code');
  assert.equal(e.rccWord().value & 0xf800, 0, 'and ADCPRE goes to zero');

  e.setClock({ pre: { ADC: 2 } });
  assert.equal(e.rccWord().value >>> 31, 0);
  assert.equal(e.rccWord().value & 0xf800, 0);
});

test('the mask covers every slice, so no neighbouring field is clobbered', () => {
  const e = multiSlice();
  e.setClock({ pre: { ADC: 4 } });
  const m = e.rccWord().mask >>> 0;
  assert.equal(m >>> 31, 1, 'bit 31 is written');
  assert.equal((m >> 11) & 0x1f, 0x1f, 'the five ADCPRE bits are written');
  assert.equal((m >> 24) & 7, 0, 'MCO at 24-26 is left alone');
  // bits 12..30 other than PLLSRC at 16, which this block legitimately writes
  // ADCPRE is bits 11..15 and PLLSRC is 16; bits 17..30 belong to nobody here
  assert.equal(m & 0x7ffe0000, 0, 'nothing between PLLSRC and bit 31 is touched');
});

test('a divider with no encoding is reported, not half written', () => {
  const e = multiSlice();
  e.setClock({ pre: { ADC: 16 } });            // no entry in either slice
  const adc = e.rccWord().parts.find(p => /ADC/.test(p.what));
  assert.match(adc.note, /no encoding for 16/);
  assert.equal(e.rccWord().value >>> 31, 0, 'nothing was written for it');
  assert.equal((e.rccWord().mask >> 11) & 0x1f, 0, 'and the field is not even masked');
});

// =============================================================================
//  Round-3 P2 — everything the user can set has to reach the C
// =============================================================================
//  Every SDK name asserted below is quoted from the MCU file, never from this test:
//  the point of `struct:` / `sdk_field:` / `sdk:` is that the generator does not
//  infer the mapping, and a test that hardcodes one is the same class of bug as
//  data that does.

test('params reach an init struct, in the MCU file order, with the file names', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setParam('USART1', 'baud', 9600);
  e.setParam('USART1', 'parity', 'Even');
  e.setParam('USART1', 'stop', '2');
  e.compute();
  const c = e.cSource();
  assert.ok(c.includes('void WCHCube_Periph_Init(void)'));
  assert.ok(c.includes('USART_InitTypeDef USART_InitStructure = {0};'));
  assert.ok(c.includes('USART_InitStructure.USART_BaudRate = 9600;'), 'a number goes in as itself');
  assert.ok(c.includes('USART_InitStructure.USART_Parity = USART_Parity_Even;'), "the option's own sdk: macro");
  assert.ok(c.includes('USART_InitStructure.USART_StopBits = USART_StopBits_2;'));
  // the file's order, which is register order
  const at = n => c.indexOf(n);
  assert.ok(at('USART_BaudRate') < at('USART_WordLength'), 'and in the order the data lists them');
  assert.ok(at('USART_WordLength') < at('USART_Parity'));

  // the clock enable comes from codegen.periph_clock, not from the peripheral's name
  assert.ok(c.includes('RCC_PB2PeriphClockCmd(RCC_PB2Periph_USART1, ENABLE);'));
});

test('a peripheral that is off is not initialised', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.compute();
  const c = e.cSource();
  assert.equal(c.includes('USART_InitTypeDef'), false, 'nothing is enabled at boot');
  assert.ok(c.includes('/* No peripheral is switched on. */'));
});

test('every value emitted for an enum is a macro the MCU file gives, never a number', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setSetting('SPI1', 'Mode', 'Full-Duplex Master');
  e.setSetting('I2C1', 'Mode', 'I2C');
  e.toggleSetting('ADC1', 'Channels', 'IN0', true);      // ADC1 has no Mode; a channel switches it on
  e.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
  e.compute();
  const c = e.cSource();
  // The peripheral, DMA and interrupt blocks only. GPIO_Mode_* and GPIO_Pin_* have their
  // own tests and the compile gate. Anchored on the Peripherals BANNER, not on
  // WCHCube_Periph_Init - that is the dispatcher and it comes after the bodies now.
  const from = c.indexOf(' * Peripherals');
  const data = JSON.stringify(e.M);
  let checked = 0;
  for (const line of c.slice(from).split(/\r?\n/)) {
    const m = /^\s+\w+Structure\.(\w+) = ([^;]+);/.exec(line);
    if (!m) continue;
    const [, member, value] = m;
    if (/^-?\d+$/.test(value)) continue;                // a plain number is fine
    assert.match(value, /^[A-Za-z_]\w*$/, `${member} = ${value} is neither a number nor a macro`);
    // and the macro really came from the data, not from this generator's imagination
    assert.ok(data.includes(value), `${value} is in the generated C but not in the MCU file`);
    checked++;
  }
  assert.ok(checked > 10, `only ${checked} assignments checked - the sweep stopped working`);
});

test('a parameter that is not an init-struct member is handled as the data says', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.toggleSetting('ADC1', 'Channels', 'IN2', true);
  e.setParam('ADC1', 'sample', '55.5 cycles');
  e.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
  e.setParam('TIM1', 'arpe', true);
  e.compute();
  const c = e.cSource();

  // sdk_call + sdk_args: a real call, with the arguments the data lists, in its order.
  // TIM_TimeBaseInitTypeDef has no auto-reload-preload member (ch32v00X_tim.h:468).
  assert.ok(c.includes('TIM_ARRPreloadConfig(TIM1, ENABLE);'));
  assert.equal(/TIM_TimeBaseInitStructure\.\w*Preload/.test(c), false,
    'and it is NOT invented as a struct member, which would not compile');

  // sdk_repeat: channels — one call per ticked channel, with its macro and its rank.
  // Sample time is a per-CHANNEL argument of ADC_RegularChannelConfig, not a property
  // of the peripheral (ch32v00X_adc.h:165).
  assert.ok(c.includes('ADC_RegularChannelConfig(ADC1, ADC_Channel_2, 1, ADC_SampleTime_CyclesMode5);'));

  // sdk_none: stated, with the reason, and no code at all
  assert.match(c, /Low power mode[\s\S]{0,80}the SDK exposes nothing for it/);
  assert.equal(/ADC_LowPowerCmd/.test(c), false, 'the note says outright: do not invent one');
});

test('sdk_repeat emits one call per ticked channel, in rank order', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  for (const ch of ['IN0', 'IN3', 'IN5']) e.toggleSetting('ADC1', 'Channels', ch, true);
  e.setParam('ADC1', 'sample', '3.5 cycles');
  e.compute();
  const calls = [...e.cSource().matchAll(/ADC_RegularChannelConfig\((.*?)\);/g)].map(m => m[1]);
  assert.deepEqual(calls, [
    'ADC1, ADC_Channel_0, 1, ADC_SampleTime_CyclesMode0',
    'ADC1, ADC_Channel_3, 2, ADC_SampleTime_CyclesMode0',
    'ADC1, ADC_Channel_5, 3, ADC_SampleTime_CyclesMode0',
  ], 'rank is the position in the sequence, and every macro comes from codegen.channel_macros');

  e.toggleSetting('ADC1', 'Channels', 'IN3', false);
  e.compute();
  const after = [...e.cSource().matchAll(/ADC_RegularChannelConfig\((.*?)\);/g)].map(m => m[1]);
  assert.equal(after.length, 2, 'unticking one drops its call');
  assert.match(after[1], /ADC_Channel_5, 2,/, 'and the ranks close up');
});

test('a single-instance peripheral gets the call shape the data states', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const spec = (e.M.codegen.init_structs || {}).OPA_InitTypeDef;
  if (!spec) return;                     // only asserted where the data makes the claim
  assert.equal(spec.no_handle, true, 'OPA_Init takes the struct alone (ch32v00X_opa.h)');
  // and the generator honours it rather than emitting OPA_Init(OPA, &s)
  e.setSetting('OPA1', 'Positive input (PSEL)', 'P0 — PA2');
  e.compute();
  const c = e.cSource();
  if (c.includes('OPA_Init(')) {
    assert.ok(c.includes('OPA_Init(&OPA_InitStructure);'), 'no handle argument');
    assert.equal(/OPA_Init\(OPA,/.test(c), false);
  }
});

test('a parameter that does not apply under the current settings is not emitted', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
  e.compute();
  const plan = e.initPlan('TIM1');
  const emitted = plan.structs.flatMap(b => b.fields.map(f => f.name));
  for (const d of e.paramDefs('TIM1')) {
    if (d.readonly || !d.struct) continue;
    if (e.paramApplies('TIM1', d)) continue;
    assert.equal(emitted.includes(d.name), false, `${d.name} does not apply and must not be emitted`);
  }
});

test('two structs on one peripheral are two blocks, because they are two SDK calls', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
  e.compute();
  const plan = e.initPlan('TIM1');
  const names = plan.structs.map(b => b.struct);
  assert.ok(names.includes('TIM_TimeBaseInitTypeDef'));
  assert.ok(names.includes('TIM_BDTRInitTypeDef'),
    'dead time lives in a DIFFERENT struct; putting it in the time base would not compile');
  const c = e.cSource();
  assert.ok(c.includes('TIM_BDTRInitTypeDef TIM_BDTRInitStructure = {0};'));
  assert.equal(/TIM_TimeBaseInitStructure\.TIM_DeadTime/.test(c), false);
});

test('an applying function is never derived from a struct name', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.compute();
  const c = e.cSource();
  // As of this commit the MCU file carries no codegen.init_structs, so the generator
  // must say what is missing rather than write USART_Init(USART1, &s) from a guess.
  // When AGENT-1 lands the key this TODO disappears and the call appears; the rule
  // the test is pinning is that one of those two is always true and never both.
  const hasCall = /USART_Init\(/.test(c);
  const hasTodo = /codegen\.init_structs\.USART_InitTypeDef\.fn/.test(c);
  assert.ok(hasCall !== hasTodo, 'either the data names the function, or the C says so');
  if (hasTodo) {
    assert.match(c, /does not derive a function name from a struct name/);
    assert.ok(e.cComplaints().some(x => x.kind === 'todo'), 'and --strict sees it');
  }
});

test('DMA requests reach DMA_InitTypeDef with the data channel and the data macros', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.toggleSetting('ADC1', 'Channels', 'IN0', true);
  e.addDmaRequest('ADC1');
  e.setDmaParam('ADC1', 'priority', 'Very high');
  e.compute();
  const c = e.cSource();
  assert.ok(c.includes('void WCHCube_DMA_Init(void)'));
  assert.ok(c.includes('RCC_HBPeriphClockCmd(RCC_HBPeriph_DMA1, ENABLE);'), 'the controller clock');
  assert.ok(c.includes('DMA_InitTypeDef DMA_InitStructure = {0};'));
  assert.ok(c.includes('DMA_InitStructure.DMA_Priority = DMA_Priority_VeryHigh;'));
  assert.ok(c.includes('DMA_InitStructure.DMA_PeripheralDataSize = DMA_PeripheralDataSize_HalfWord;'),
    'the ADC seed from dma.request_defaults, not a default');
  assert.ok(c.includes('DMA_InitStructure.DMA_Mode = DMA_Mode_Circular;'));
  assert.match(c, /ADC1 on DMA1 channel 1/, 'the channel comes from the hardware map');
  assert.match(c, /the application owns the addresses and the length/,
    'the buffer is not a configuration choice and the file says so');
});

test('a double-booked DMA channel refuses to compile instead of generating both', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.addDmaRequest('I2C1_TX');
  e.addDmaRequest('USART2_TX');        // channel 6 as well
  e.compute();
  const c = e.cSource();
  assert.match(c, /#error "WCHCube: DMA1 channel 6 is configured for I2C1_TX and USART2_TX/);
  assert.match(c, /Remove one of them in DMA Settings/);
  const bad = e.cComplaints().filter(x => x.kind === 'error');
  assert.equal(bad.length, 1, 'and --strict fails on it');

  e.removeDmaRequest('USART2_TX');
  e.compute();
  assert.equal(/#error/.test(e.cSource()), false, 'removing one clears it');
});

test('NVIC emits the enabled vectors with their PFIC priorities, and claims no nesting register', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setNvicVector('USART1', { enabled: true, preempt: 1, sub: 1 });
  e.compute();
  const c = e.cSource();
  assert.ok(c.includes('void WCHCube_NVIC_Init(void)'));
  // the IRQn spelling, not the handler spelling — they are different symbols
  assert.match(c, /USART1_IRQn/);
  assert.match(c, /USART1_IRQHandler/, 'and the ISR name the user has to define');
  assert.match(c, /preempt 1, sub 1|NVIC_IRQChannelPreemptionPriority = 1/);
  assert.match(c, /Priority grouping: 2 levels of nesting/);
  assert.match(c, /not in this part's reference manual/,
    'RM 6.5.2.6 is only KEYCODE and RSTSYS; no register write may be claimed for the grouping');
  // nothing was invented for the grouping switch
  assert.equal(/PFIC_CFGR\s*=/.test(c), false);
});

test('a vector that is enabled but cannot fire is a warning, and the C still builds', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setNvicVector('SPI1', { enabled: true });      // SPI1 is off
  e.compute();
  assert.ok(e.E.resources.issues.some(i => i.kind === 'nvic'));
  assert.equal(/#error/.test(e.cSource()), false, 'a warning is not a refusal to compile');
});

test('nothing configured means empty functions, not missing ones', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.compute();
  const c = e.cSource();
  for (const fn of ['WCHCube_Periph_Init', 'WCHCube_DMA_Init', 'WCHCube_NVIC_Init']) {
    assert.ok(c.includes(`void ${fn}(void)`), `${fn} is always defined`);
    assert.ok(e.cHeader().includes(`void ${fn}(void)`), `${fn} is always declared`);
  }
  assert.ok(c.includes('/* No DMA request is configured. */'));
  assert.ok(c.includes('/* No interrupt vector is enabled. */'));
});

test('WCHCube_Init calls all five, clocks first and interrupts last', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.compute();
  const c = e.cSource();
  const body = c.slice(c.indexOf('void WCHCube_Init(void)'));
  const order = ['WCHCube_RCC_Init();', 'WCHCube_GPIO_Init();', 'WCHCube_Periph_Init();',
    'WCHCube_DMA_Init();', 'WCHCube_NVIC_Init();'];
  let at = -1;
  for (const call of order) {
    const i = body.indexOf(call);
    assert.ok(i > at, `${call} is called, after the one before it`);
    at = i;
  }
});

test('the header declares every function the source defines, still', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.addDmaRequest('USART1_TX');
  e.setNvicVector('USART1', { enabled: true });
  e.compute();
  const defined = [...e.cSource().matchAll(/^void (\w+)\(void\)$/gm)].map(m => m[1]).sort();
  const declared = [...e.cHeader().matchAll(/^void (\w+)\(void\);/gm)].map(m => m[1]).sort();
  assert.deepEqual(declared, defined);
});

test('every bundled part and package still generates without throwing, with DMA and NVIC on', () => {
  for (const name of Object.keys(eng.MCU_FILES)) {
    const e = fresh();
    e.loadMcu(name);
    for (const pkg of Object.keys(e.M.packages)) {
      e.setPackage(pkg);
      for (const r of e.dmaAddableRequests().slice(0, 3)) e.addDmaRequest(r.request);
      for (const v of e.nvicVectors().filter(x => !x.fixed).slice(0, 3)) {
        e.setNvicVector(v.name, { enabled: true });
      }
      e.compute();
      const c = e.cSource();
      assert.ok(c.length > 100, `${name} ${pkg} generated nothing`);
      assert.ok(c.includes('void WCHCube_Init(void)'), `${name} ${pkg}`);
      // braces balance, which is the cheapest proof it is not half-written
      assert.equal((c.match(/\{/g) || []).length, (c.match(/\}/g) || []).length, `${name} ${pkg} braces`);
    }
  }
});

// AGENT-1, board 16:02Z: "your enum-macro test currently passes only because those
// macros also appear in my file, not because the generator reads it." Fair, and this is
// the version that cannot pass for that reason - the part below spells every mode macro
// differently from anything in the SDK, so the only way the right string reaches the C
// is if the generator read `gpio.modes`.
const RENAMED_MODES = `
mcu:
  name: CH32V006-RENAMED-MODES
  inherits: CH32V006
  remove: [gpio.modes, gpio.input_modes]
gpio:
  modes:
    - { name: Output Push Pull,              macro: XX_Mode_Out_PP }
    - { name: Output Open Drain,             macro: XX_Mode_Out_OD }
    - { name: Alternate Function Push Pull,  macro: XX_Mode_AF_PP }
    - { name: Alternate Function Open Drain, macro: XX_Mode_AF_OD }
    - { name: Analog,                        macro: XX_Mode_AIN }
  input_modes:
    - { name: No pull,   macro: XX_Mode_IN_FLOATING }
    - { name: Pull-up,   macro: XX_Mode_IPU }
    - { name: Pull-down, macro: XX_Mode_IPD }
`;

test('the GPIO mode macro comes from gpio.modes, not from a table in the generator', () => {
  const e = withFile(RENAMED_MODES, 'CH32V006-RENAMED-MODES');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.assignSignal('PC1', { gpio: 'GPIO_Input' });
  e.setGpioField('PC1', 'pull', 'Pull-down');
  e.assignSignal('PC2', { gpio: 'GPIO_Analog' });
  e.compute();
  const c = e.cSource();
  assert.ok(c.includes('GPIO_Mode = XX_Mode_Out_PP;'), 'the data name, not GPIO_Mode_Out_PP');
  assert.ok(c.includes('GPIO_Mode = XX_Mode_IPD;'), 'Input folds the PULL into the mode');
  assert.ok(c.includes('GPIO_Mode = XX_Mode_AIN;'));
  assert.equal(/GPIO_Mode = GPIO_Mode_/.test(c), false, 'nothing came from a hardcoded table');
});

test('every mode and pull the GPIO table offers has a macro in the data', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const modes = e.gpioModes();
  const pulls = e.gpioInputModes();
  assert.ok(modes.length && pulls.length, 'CH32V006 states both');
  assert.ok(modes.every(m => m.macro), 'a mode without a macro is a mode the C cannot express');
  assert.ok(pulls.every(m => m.macro));
  // and every one of them really reaches the C
  for (const m of modes) {
    const g = fresh('CH32V006', 'TSSOP20');
    g.assignSignal('PC0', { gpio: 'GPIO_Output' });
    g.setGpioField('PC0', 'mode', m.name);
    g.compute();
    assert.ok(g.cSource().includes(`GPIO_Mode = ${m.macro};`), `${m.name} -> ${m.macro}`);
  }
  for (const pull of pulls) {
    const g = fresh('CH32V006', 'TSSOP20');
    g.assignSignal('PC0', { gpio: 'GPIO_Input' });
    g.setGpioField('PC0', 'pull', pull.name);
    g.compute();
    assert.ok(g.cSource().includes(`GPIO_Mode = ${pull.macro};`), `Input + ${pull.name} -> ${pull.macro}`);
  }
});

test('a part that states no gpio.modes gets a TODO, not a guessed mode macro', () => {
  const e = withFile(`
mcu:
  name: CH32V006-NOMODES
  inherits: CH32V006
  remove: [gpio.modes, gpio.input_modes]
`, 'CH32V006-NOMODES');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.compute();
  const c = e.cSource();
  assert.equal(/GPIO_InitStructure.GPIO_Mode =/.test(c), false, 'nothing is invented');
  assert.match(c, /TODO: no SPL macro for GPIO mode "Output Push Pull"/);
  assert.match(c, /GPIOMode_TypeDef is per family/);
  assert.ok(e.cComplaints().some(x => x.kind === 'todo' && /GPIO mode/.test(x.text)), '--strict sees it');
});

// data/FORMAT.md documents five sdk_args placeholders and AGENT-1's verify_sdk_names
// rejects any other spelling, so all five have to resolve here. $INDEX is the only one
// no MCU file uses yet, which is exactly why it is worth a test: a documented
// placeholder the generator does not know becomes a TODO in somebody's build.
test('every sdk_args placeholder FORMAT.md documents actually resolves', () => {
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-PLACEHOLDERS
  inherits: CH32V006
peripherals:
  ADC1:
    params:
      - key: sample
        name: Sampling time
        sdk_call: My_ChannelConfig
        sdk_args: [$HANDLE, $CHANNEL, $RANK, $INDEX, $VALUE, 0]
        sdk_repeat: channels
        type: enum
        default: fast
        options:
          - { name: fast, value: 0, sdk: MY_FAST }
`);
  e.loadMcu('CH32V006-PLACEHOLDERS');
  e.toggleSetting('ADC1', 'Channels', 'IN0', true);
  e.toggleSetting('ADC1', 'Channels', 'IN4', true);
  e.compute();
  const calls = [...e.cSource().matchAll(/My_ChannelConfig\((.*?)\);/g)].map(m => m[1]);
  assert.deepEqual(calls, [
    'ADC1, ADC_Channel_0, 1, 0, MY_FAST, 0',
    'ADC1, ADC_Channel_4, 2, 1, MY_FAST, 0',
  ], '$RANK is 1-based, $INDEX is 0-based, and a non-placeholder is passed through literally');
});

test('a placeholder the generator does not know is named, not written as text', () => {
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-BADPLACEHOLDER
  inherits: CH32V006
peripherals:
  SPI1:
    params:
      - key: crc
        name: CRC calculation
        sdk_call: SPI_CalculateCRC
        sdk_args: [$HANDEL, $VALUE]
        sdk_enabled: ENABLE
        sdk_disabled: DISABLE
        type: bool
        default: false
`);
  e.loadMcu('CH32V006-BADPLACEHOLDER');
  e.setSetting('SPI1', 'Mode', 'Full-Duplex Master');
  e.compute();
  const c = e.cSource();
  assert.equal(/$HANDEL/.test(c), false, 'a typo must never reach generated C as text');
  assert.match(c, /is not a placeholder this generator knows/);
});

// =============================================================================
//  The per-peripheral file split — the option is offered because it is honoured
// =============================================================================

test('each configured peripheral gets its own init function, in either layout', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setSetting('I2C1', 'Mode', 'I2C');
  e.compute();
  const c = e.cSource();
  assert.ok(c.includes('void WCHCube_USART1_Init(void)'));
  assert.ok(c.includes('void WCHCube_I2C1_Init(void)'));
  // and the dispatcher calls them rather than repeating their bodies
  assert.ok(c.includes('    WCHCube_USART1_Init();'));
  assert.ok(c.includes('    WCHCube_I2C1_Init();'));
  assert.equal((c.match(/USART_Init\(USART1/g) || []).length, 1, 'the body exists exactly once');
  // declared in the header, because they are defined here
  assert.ok(e.cHeader().includes('void WCHCube_USART1_Init(void);'));
});

test('split mode puts each peripheral in its own pair and declares it once', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setSetting('I2C1', 'Mode', 'I2C');
  e.setGeneratorOption('split_peripherals', true);
  e.compute();
  const files = e.cFiles();
  assert.deepEqual(Object.keys(files), [
    'wchcube_init.h', 'wchcube_init.c',
    'wchcube_i2c1.h', 'wchcube_i2c1.c',
    'wchcube_usart1.h', 'wchcube_usart1.c',
  ], 'sorted, so two runs of one configuration produce the same files in the same order');

  // the body moved out of wchcube_init.c entirely
  assert.equal(/USART_Init\(USART1/.test(files['wchcube_init.c']), false);
  assert.ok(files['wchcube_usart1.c'].includes('USART_Init(USART1, &USART_InitStructure);'));
  assert.ok(files['wchcube_usart1.c'].includes('#include "wchcube_usart1.h"'));
  assert.ok(files['wchcube_usart1.h'].includes('void WCHCube_USART1_Init(void);'));
  assert.ok(files['wchcube_usart1.h'].includes('#ifndef WCHCUBE_USART1_H'));

  // declared once, not in two places that can drift
  assert.equal(files['wchcube_init.h'].includes('void WCHCube_USART1_Init(void);'), false);
  assert.ok(files['wchcube_init.c'].includes('#include "wchcube_usart1.h"'), 'so the call resolves');
  assert.ok(files['wchcube_init.c'].includes('    WCHCube_USART1_Init();'));
});

test('the split changes where the code lives, not what it says', () => {
  // fresh() hands back the ONE engine singleton, so each configuration has to be read
  // out before the next one starts - holding two "engines" at once holds one twice.
  const configure = e => {
    e.setSetting('USART1', 'Mode', 'Asynchronous');
    e.setParam('USART1', 'baud', 9600);
    e.toggleSetting('ADC1', 'Channels', 'IN2', true);
    e.assignSignal('PC0', { gpio: 'GPIO_Output' });
    e.compute();
  };
  const bodyOf = (text, name) => {
    const at = text.indexOf(`void ${name}(void)`);
    return at < 0 ? null : text.slice(at, text.indexOf('\n}', at));
  };

  const one = fresh('CH32V006', 'TSSOP20');
  configure(one);
  const singleBody = bodyOf(one.cSource(), 'WCHCube_USART1_Init');

  const many = fresh('CH32V006', 'TSSOP20');
  many.setGeneratorOption('split_peripherals', true);
  configure(many);
  const splitFiles = many.cFiles();
  const splitBody = bodyOf(splitFiles['wchcube_usart1.c'], 'WCHCube_USART1_Init');

  assert.ok(singleBody, 'the function exists in one-file mode');
  assert.ok(splitBody, 'and in its own file in split mode');
  assert.equal(splitBody, singleBody, 'the same function, character for character');

  // and the clocks, pins, DMA and interrupts stay in wchcube_init.c either way
  for (const fn of ['WCHCube_RCC_Init', 'WCHCube_GPIO_Init', 'WCHCube_DMA_Init',
    'WCHCube_NVIC_Init', 'WCHCube_Init', 'WCHCube_Periph_Init']) {
    assert.ok(splitFiles['wchcube_init.c'].includes(`void ${fn}(void)`), fn);
  }
});

test('split mode regenerates byte-identically after save, close and open', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setGeneratorOption('split_peripherals', true);
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setSetting('SPI1', 'Mode', 'Full-Duplex Master');
  e.compute();
  const before = e.cFiles();
  const text = e.projectSerialize();

  e.loadMcu(e.MCU_FILES.CH32V005);
  e.projectApply(text);
  e.compute();
  assert.equal(e.generatorOption('split_peripherals'), true, 'the option round-tripped');
  const after = e.cFiles();
  assert.deepEqual(Object.keys(after), Object.keys(before));
  for (const name of Object.keys(before)) assert.equal(after[name], before[name], name);
});

test('a peripheral file name is a C-safe identifier, not the tree id as typed', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.equal(e.periphInitName('USART1'), 'WCHCube_USART1_Init');
  assert.equal(e.periphInitName('WCH-ODD.1'), 'WCHCube_WCH_ODD_1_Init',
    'anything that is not a C identifier character becomes an underscore');
});

test('complaints in a split file are reported against that file', () => {
  const e = withFile(NO_SPEEDS, 'CH32V006-NOSPEEDS');
  e.setGeneratorOption('split_peripherals', true);
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.compute();
  const list = e.cComplaints(e.cFiles());
  assert.ok(list.length, 'the speed TODO is still found');
  for (const c of list) {
    assert.ok(Object.keys(e.cFiles()).includes(c.file), `${c.file} is one of the generated files`);
    assert.ok(c.line > 0);
  }
});

// =============================================================================
//  Parts whose shape is not CH32V006's
// =============================================================================
//  AGENT-1, board 16:10Z: "a 24-bit port breaks anything assuming 16 pins - a pin-name
//  regex, a bit mask, a package table - and a port that is not a contiguous range
//  breaks anything that iterates one." Both are true of CH32X035 and of no part that
//  existed before it, so both get a test rather than a hope.

test('a port wider than 16 bits generates the pin macros it really has', () => {
  const e = fresh();
  if (!eng.MCU_FILES.CH32X035) return;            // the part is not bundled in this build
  e.loadMcu('CH32X035');
  e.setPackage('LQFP64M');
  e.compute();

  const wide = Object.keys(e.M.pins).filter(p => /^P[A-Z](1[6-9]|2[0-3])$/.test(p) && e.pinExists(p));
  assert.ok(wide.length, 'CH32X035 ports are 24 bits wide (ch32x035.h GPIO_Pin_16..23)');

  for (const pin of wide.slice(0, 3)) {
    e.compute();
    if (e.E.pins[e.canon(pin)]) continue;         // already claimed by a reset-default signal
    e.assignSignal(pin, { gpio: 'GPIO_Output' });
  }
  e.compute();
  const rows = e.gpioPlan().filter(r => r.bit > 15);
  assert.ok(rows.length, 'the plan reaches pins above 15');
  const c = e.cSource();
  for (const r of rows) {
    assert.ok(c.includes(`GPIO_Pin_${r.bit}`), `GPIO_Pin_${r.bit} is emitted for ${r.pin}`);
  }
  assert.deepEqual(e.cComplaints(), [], 'and nothing about this part is missing from the data');
});

test('a port with a hole in it is not iterated as a range', () => {
  const e = fresh();
  if (!eng.MCU_FILES.CH32X035) return;
  e.loadMcu('CH32X035');
  const bits = Object.keys(e.M.pins)
    .filter(p => /^PC\d+$/.test(p)).map(p => +p.slice(2)).sort((a, b) => a - b);
  assert.ok(bits.length, 'PC exists');
  // DS Fig 1-1: PC0-PC7 then PC14-PC19. If anything treated a port as 0..n-1 it would
  // invent the pins in the gap, so assert the gap is really there and really absent.
  const gap = [8, 9, 12, 13].filter(n => bits.includes(n));
  assert.deepEqual(gap, [], 'the pins the datasheet does not give PC must not exist');
  for (const n of bits) assert.ok(e.M.pins[`PC${n}`], `PC${n} is in the model`);
});

test('every bundled part generates only names its own MCU file carries', () => {
  for (const name of Object.keys(eng.MCU_FILES)) {
    const e = fresh();
    e.loadMcu(name);
    e.compute();
    // switch on whatever this part has, without naming a peripheral
    for (const [pid, P] of Object.entries(e.M.peripherals)) {
      const s = (P.settings || [])[0];
      if (!s) continue;
      const c = (s.choices || []).find(x => x.signals && x.signals.length);
      if (!c) continue;
      try {
        if (s.type === 'checkboxes') e.toggleSetting(pid, s.name, c.name, true);
        else e.setSetting(pid, s.name, c.name);
      } catch (err) { /* a conflict with an earlier one is fine; this is a sweep */ }
    }
    e.compute();
    const c = e.cSource();
    const data = JSON.stringify(e.M);
    // Every identifier assigned into an init struct has to come from the data. The GPIO
    // ones have their own tests; these are the SPL names the MCU file is responsible for.
    const from = c.indexOf(' * Peripherals');
    if (from < 0) continue;
    for (const line of c.slice(from).split(/\r?\n/)) {
      const m = /^\s+\w+Structure\.(\w+) = ([^;]+);/.exec(line);
      if (!m) continue;
      const [, member, value] = m;
      if (/^-?\d+$/.test(value)) continue;
      assert.ok(data.includes(member), `${name}: member ${member} is not in the MCU file`);
      assert.ok(data.includes(value), `${name}: value ${value} is not in the MCU file`);
    }
  }
});

test('a part the engine has never seen needs no engine change to generate', () => {
  // The claim the architecture makes: DATA adds a part, ENGINE adds nothing. CH32X035
  // is the first part since the engine was written whose ports, clock-enable spelling
  // and GPIO speed all differ from CH32V006's, so it is the test of that claim.
  const e = fresh();
  if (!eng.MCU_FILES.CH32X035) return;
  e.loadMcu('CH32X035');
  e.setPackage('LQFP64M');
  e.compute();
  const c = e.cSource();
  // every one of these is a per-series fact, and every one comes from the data
  assert.ok(/RCC_APB2PeriphClockCmd/.test(c) || !/PeriphClockCmd/.test(c),
    'X035 uses the APB2 spelling, not the V00x PB2 spelling');
  assert.equal(/RCC_PB2PeriphClockCmd/.test(c), false, 'and never the other family\'s');
  assert.deepEqual(e.gpioSpeeds().map(s => s.macro), ['GPIO_Speed_50MHz'],
    'one speed, and it is 50 MHz here rather than 30');
  assert.ok(e.cHeader().includes(`#include "${e.M.codegen.header}"`),
    'its own SPL header, from its own file - and in the .h, where the application sees it too');
});

test('a user action is not a generator complaint, so DMA does not fail --strict for ever', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.addDmaRequest('USART1_TX');
  e.compute();
  const c = e.cSource();
  // The buffer address is not missing from the DATA - it is not a configuration choice
  // at all. Marked TODO it would make every project that uses DMA fail --strict, over
  // something no MCU file could ever supply.
  assert.match(c, /USER ACTION: the application owns the addresses and the length/);
  assert.equal(/TODO[^\n]*DMA_PeripheralBaseAddr/.test(c), false);
  assert.deepEqual(e.cComplaints().filter(x => /BaseAddr|BufferSize/.test(x.text)), [],
    'and cComplaints does not count it');

  // it is still impossible to miss, which is the point of putting it there.
  // `DMA_Init(` also matches inside `WCHCube_DMA_Init(`, so anchor on the real call.
  const call = c.indexOf('        DMA_Init(');
  assert.ok(call > 0, 'setup: the DMA_Init call is generated');
  assert.ok(c.indexOf('USER ACTION') < call, 'it sits above the call that uses those fields');
});

// =============================================================================
//  Round-6 P0 — a second init struct that only some of the settings ask for
// =============================================================================
//  The mechanism already worked: a struct whose params are ALL gated by a `when:`
//  is emitted when the gate opens and not emitted when it closes. What had no test
//  is the failure mode, because `paramApplies()` treats an unresolvable dependency
//  as applicable so that a typo cannot hide a FIELD - and that same choice makes a
//  typo turn a conditional STRUCT into an unconditional one, or into no struct at
//  all, with nothing said either way. The shape below is the CH32V003 USART's, cut
//  down to the two structs that matter and carried on a derived part so the test
//  reads the same whichever MCU files ship.
const TWO_STRUCTS = when => `
mcu:
  name: CH32V006-TWOSTRUCTS
  inherits: CH32V006
codegen:
  init_structs:
    USART_ClockInitTypeDef: { fn: USART_ClockInit }
  periph_handle:
    USART9: USART9
peripherals:
  USART9:
    category: Connectivity
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: Asynchronous, signals: [TX9, RX9] }
          - { name: Synchronous,  signals: [TX9, RX9] }
    remaps:
      - name: Default
        pins: { TX9: PA9, RX9: PA10 }
    params:
      - key: baud
        name: Baud rate
        struct: USART_InitTypeDef
        sdk_field: USART_BaudRate
        type: int
        default: 115200
      - key: clock
        name: Clock output
        struct: USART_ClockInitTypeDef
        sdk_field: USART_Clock
        type: enum
        default: Disable
        options:
          - { name: Disable, value: 0, sdk: USART_Clock_Disable }
          - { name: Enable,  value: 1, sdk: USART_Clock_Enable }
        when: ${when}
`;

// The gate is on EVERY param of the second struct. On one of them it would not close:
// a single ungated field is enough to emit the block, which is a rule about the data
// rather than about this generator, so it is not asserted here.
const twoStructs = (when = '{ Mode: Synchronous }') => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.registerMcuFile(TWO_STRUCTS(when));
  e.loadMcu('CH32V006-TWOSTRUCTS');
  e.compute();
  return e;
};
const structsOf = e => e.initPlan('USART9').structs.map(b => b.struct);
const todosOf = e => e.cSource().split('\n').filter(l => l.includes('TODO')).map(l => l.trim());

test('a second init struct is emitted for one choice and not for another', () => {
  const e = twoStructs();
  e.setSetting('USART9', 'Mode', 'Asynchronous');
  e.compute();
  assert.deepEqual(structsOf(e), ['USART_InitTypeDef'],
    'the clock struct is not needed in asynchronous mode');
  const async = e.cSource();
  assert.equal(async.includes('USART_ClockInitTypeDef'), false);
  assert.equal(async.includes('USART_ClockInit('), false,
    'nor is the call that would apply it');
  assert.deepEqual(todosOf(e), [],
    'and its absence is silence, not a TODO: a struct the choices do not ask for is not a defect');

  e.setSetting('USART9', 'Mode', 'Synchronous');
  e.compute();
  assert.deepEqual(structsOf(e), ['USART_InitTypeDef', 'USART_ClockInitTypeDef']);
  const sync = e.cSource();
  assert.ok(sync.includes('USART_ClockInitTypeDef USART_ClockInitStructure = {0};'));
  assert.ok(sync.includes('USART_ClockInitStructure.USART_Clock = USART_Clock_Disable;'),
    "the field carries the option's own sdk: macro, and the data's default");
  assert.ok(sync.includes('USART_ClockInit(USART9, &USART_ClockInitStructure);'),
    'the handle comes from codegen.periph_handle, so this struct takes one');
  assert.deepEqual(todosOf(e), [], 'and with the gate read correctly there is nothing to say');
});

// A. the setting NAME is a typo. The gate can never close, so the struct that only
//    synchronous mode needs is emitted in asynchronous mode - and it used to be emitted
//    with no comment of any kind, which is the defect class this round is about.
test('a gate that names a setting that does not exist is loud, not silently open', () => {
  const e = twoStructs('{ Modee: Synchronous }');
  e.setSetting('USART9', 'Mode', 'Asynchronous');
  e.compute();
  assert.ok(structsOf(e).includes('USART_ClockInitTypeDef'),
    'setup: the typo opens the gate, which is why it needs saying');
  const todos = todosOf(e);
  assert.equal(todos.length, 1);
  assert.match(todos[0], /Modee/);
  assert.match(todos[0], /neither a setting nor a parameter/);
  assert.equal(e.cComplaints().length > 0, true, 'and --strict sees it too');
});

// C. the choice VALUE is a typo. The gate can never open, so synchronous mode gets no
//    clock struct at all while the user has asked for one - also previously silent.
test('a gate that names a choice that does not exist is loud, not silently shut', () => {
  const e = twoStructs('{ Mode: Synchrounous }');
  e.setSetting('USART9', 'Mode', 'Synchronous');
  e.compute();
  assert.deepEqual(structsOf(e), ['USART_InitTypeDef'],
    'setup: the typo shuts the gate for good');
  const todos = todosOf(e);
  assert.equal(todos.length, 1);
  assert.match(todos[0], /Synchrounous/);
  assert.match(todos[0], /Asynchronous/, 'and the message lists the choices that do exist');
});

// The spellings in the shipped MCU files, pinned here so the shape cannot drift back.
test('a prose-shaped or mis-targeted when: is reported rather than obeyed', () => {
  const prose = twoStructs('{ setting: Mode, is: Synchronous }');
  prose.setSetting('USART9', 'Mode', 'Synchronous');
  prose.compute();
  assert.equal(todosOf(prose).length, 2, 'both keys of {setting, is} are named');

  const param = twoStructs('{ baud: 115200 }');
  param.setSetting('USART9', 'Mode', 'Synchronous');
  param.compute();
  const [t] = todosOf(param);
  assert.match(t, /is a parameter of USART9, not a setting/);
  assert.match(t, /depends_on/);
});

// =============================================================================
//  Round-6 P3 — `const:` reaches the struct as a literal
// =============================================================================
//  `params.js` owns the model half (never drawn, never stored, never settable); this is
//  the half that matters for silicon: the member is IN the struct. OPA and CMP begin
//  their init struct with a `*_NUM` and the SDK branches on it, so a struct that leaves
//  it unset configures whichever instance the uninitialised field happens to name.

const CONST_STRUCT = `
mcu:
  name: CH32V006-CONSTCODE
  inherits: CH32V006
codegen:
  init_structs:
    OPA_InitTypeDef: { fn: OPA_Init, no_handle: true }
peripherals:
  OPA9:
    category: Analog
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: Enabled, signals: [PSEL] }
    remaps:
      - name: Default
        pins: { PSEL: PA2 }
    params:
      - { key: num, name: Which one, const: OPA9, struct: OPA_InitTypeDef, sdk_field: OPA_NUM }
      - key: psel
        name: Positive input
        struct: OPA_InitTypeDef
        sdk_field: OPA_PSEL
        type: enum
        default: P0
        options:
          - { name: P0, value: 0, sdk: OPA_PSEL_P0 }
`;
const withConstStruct = () => {
  const e = fresh('CH32V006');
  e.registerMcuFile(CONST_STRUCT);
  e.loadMcu('CH32V006-CONSTCODE');
  e.setSetting('OPA9', 'Mode', 'Enabled');
  e.compute();
  return e;
};

test('a const: member is written into its struct as the literal the file names', () => {
  const e = withConstStruct();
  const c = e.cSource();
  assert.ok(c.includes('OPA_InitStructure.OPA_NUM = OPA9;'),
    'the member is assigned, not skipped - this is the line an unset OPA_NUM would lose');
  assert.match(c, /OPA_NUM = OPA9;\s+\/\* Which one: OPA9 \*\//,
    'and the comment shows the value, so the file reads the same as for a chosen field');
  assert.ok(c.includes('OPA_Init(&OPA_InitStructure);'), 'no_handle still applies the struct alone');
  assert.deepEqual(e.initPlan('OPA9').structs[0].fields.map(f => f.member), ['OPA_NUM', 'OPA_PSEL'],
    'in file order, member names from the data');
  assert.deepEqual(e.initPlan('OPA9').problems, [], 'and a const: param is not a dependency problem');
});

test('a struct whose only param is a const: member is still emitted', () => {
  // The rule is "a struct is emitted when at least one of its params applies", and a
  // const: param has no `when:` to close it - so it is always applicable and the struct
  // can never be dropped. Worth pinning: an empty OPA_Init(&s) is the defect, and the
  // plausible way to write the filter wrong is to exclude non-editable params.
  const e = fresh('CH32V006');
  e.registerMcuFile(CONST_STRUCT.replace(/^ {6}- key: psel[\s\S]*?sdk: OPA_PSEL_P0[^\n]*\n/m, ''));
  e.loadMcu('CH32V006-CONSTCODE');
  assert.deepEqual(e.paramDefs('OPA9').map(d => d.key), ['num'], 'setup: only the const member is left');
  e.setSetting('OPA9', 'Mode', 'Enabled');
  e.compute();
  const c = e.cSource();
  assert.ok(c.includes('OPA_InitStructure.OPA_NUM = OPA9;'), 'the struct is emitted and filled');
  assert.ok(c.includes('OPA_Init(&OPA_InitStructure);'));
  assert.deepEqual(e.getParams('OPA9'), [], 'and the Parameters tab has nothing to draw for it');
});

// =============================================================================
//  Round-6 P3 — the clock word must not go quiet about a field it does not write
// =============================================================================
//  Every part with a PLL but no `codegen.rcc.pllsrc` used to emit a word covering SW
//  and the prescalers and NOTHING about the input, while the header comment named the
//  input the configuration had asked for. On the one part that is true of today that is
//  32 different asked-for clock rates, in a file that reads as complete.

test('a PLL input the clock word cannot write is named, on every part with a PLL', () => {
  for (const name of mcuNames()) {
    const e = fresh(name);
    const pll = (e.M.clock || {}).pll;
    if (!pll || !pll.inputs || !pll.inputs.length) continue;
    const idx = pll.inputs.length > 1 ? 1 : 0;
    e.setClock({ sys: 'PLLCLK', pllIn: idx, pllMul: pll.multipliers[0] });
    e.compute();
    const part = (e.rccWord().parts || []).find(p => p.what === 'PLL input');
    assert.ok(part, `${name}: the word must account for the PLL input, one way or the other`);
    if (part.field !== undefined) continue;            // it states the encoding and writes it
    assert.match(part.note, /pllsrc/, `${name}: and say which key is missing`);
    assert.ok(part.note.includes(pll.inputs[idx].name),
      `${name}: the note names the input the user actually chose`);
    assert.ok(e.cSource().includes(part.note), `${name}: and it reaches the generated C`);
  }
});

// The plant, and it is the test that matters: whether a part states `pllsrc` is DATA, so a
// list of part names here would go red the moment somebody fixes the data - which is
// exactly what a test must not do. This asks the mechanism directly instead, on a part
// that states it, by taking it away.
test('the PLL input note is absent when the part can write the field, and appears when it cannot', () => {
  const e = fresh('CH32V006');
  const pll = e.M.clock.pll;
  e.setClock({ sys: 'PLLCLK', pllIn: 1, pllMul: pll.multipliers[0] });
  e.compute();
  assert.ok(e.cSource().includes('/* PLL input = '), 'the field is written');
  assert.equal(/PLL input: no codegen/.test(e.cSource()), false, 'and nothing is said about a note');
  assert.equal((e.rccWord().parts.find(p => p.what === 'PLL input') || {}).field !== undefined, true);

  // take the encoding away, exactly as a part without one has it
  const saved = e.M.codegen.rcc.pllsrc;
  delete e.M.codegen.rcc.pllsrc;
  e.compute();
  const part = (e.rccWord().parts || []).find(p => p.what === 'PLL input');
  assert.ok(part && part.field === undefined, 'now there is nothing to write');
  assert.match(part.note, /pllsrc/);
  assert.ok(part.note.includes(pll.inputs[1].name), 'the note names the chosen input');
  assert.ok(e.cSource().includes(part.note), 'and it reaches the generated C, beside the write');

  // and it is conditional on the PLL being asked for: a configuration that does not use
  // the PLL must not be lectured about a field it does not care about
  e.setClock({ sys: 'HSI' });
  e.compute();
  assert.equal(e.cSource().includes('PLL input'), false, 'no PLL, no note');
  e.M.codegen.rcc.pllsrc = saved;
});
