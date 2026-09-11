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
  assert.ok(c.includes('RCC_PB2PeriphClockCmd(RCC_PB2Periph_GPIOC | RCC_PB2Periph_GPIOD | RCC_PB2Periph_AFIO, ENABLE);'));
  assert.ok(c.includes('GPIO_InitStructure.GPIO_Pin = GPIO_Pin_0 | GPIO_Pin_1;'), 'same mode and speed share one call');
  assert.ok(c.includes('GPIO_InitStructure.GPIO_Mode = GPIO_Mode_Out_PP;'));
  assert.ok(c.includes('GPIO_InitStructure.GPIO_Speed = GPIO_Speed_2MHz;'));
  assert.ok(c.includes('GPIO_Init(GPIOC, &GPIO_InitStructure);'));
  assert.ok(c.includes('/* PC0 "LED" — GPIO_Output */'), 'user labels reach the code');
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
  assert.equal(w.mask, 0x7fffff & ~(0 << 0) & 0x7fffff, 'every declared field is in the mask');
  assert.equal(w.mask, (0x7 << 0) | (0x7 << 3) | (0xf << 6) | (0xf << 10) | (0x3 << 14) | (0x1 << 16) | (0x7 << 20));
  const c = e.cSource();
  assert.ok(c.includes('AFIO->PCFR1 = (AFIO->PCFR1 & ~0x0077FFFFU) | 0x000000D0U;'), c.split('\n').filter(l => l.includes('PCFR1')).join('\n'));
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

test('without a codegen block the register sections are an honest TODO', () => {
  const e = fresh();                        // plain CH32V006, no codegen: yet
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setRemap('USART1', 3);
  e.compute();
  const c = e.cSource();
  assert.equal(e.remapWord(), null);
  assert.equal(e.rccWord(), null);
  assert.ok(c.includes('TODO: alternate function remap'));
  assert.ok(c.includes('USART1: index 3 — 0011'), 'it still says what was chosen');
  assert.ok(c.includes('TODO: enable the port clocks for GPIOC, GPIOD'));
  assert.ok(c.includes('TODO: the MCU file has no codegen.rcc block'));
  assert.ok(c.includes('GPIO_Init(GPIOC, &GPIO_InitStructure);'), 'the GPIO half is generated regardless');
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
      if (!s || s.startsWith('#') || s.endsWith('{') || s.endsWith('}') || s.endsWith(';')) continue;
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
