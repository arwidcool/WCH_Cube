// codegen.js — C initialisation code.
//
// The register encodings below are read from the CH32V00X Reference Manual V1.4
// (RCC_CFGR0 in 3.4.2, AFIO_PCFR1 in 7.3.2.2) and carried here on a child MCU
// file, so these tests prove the full path without editing AGENT-1's data file.
// Once the same block lands in CH32V006.yaml the generator needs no change.
import { test, assert, fresh, eng } from './_harness.js';

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
  const files = Object.keys(e.generateAll());
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
  // The peripheral, DMA and interrupt blocks only. GPIO_Mode_* and GPIO_Pin_* are the
  // generator's own table and mask - covered by their own tests and by the compile gate.
  const from = c.indexOf('void WCHCube_Periph_Init');
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
