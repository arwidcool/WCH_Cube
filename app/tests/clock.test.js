// clock.js — the clock tree maths (CH32V006: single HB domain, HSI 24 MHz, PLL x2).
import { test, assert, fresh } from './_harness.js';

test('defaults come from the file: HSI 24 MHz straight through', () => {
  const e = fresh();
  const k = e.S.clock;
  assert.equal(k.sys, 'HSI');
  assert.equal(k.hse, 24);
  assert.equal(k.pllMul, 2);
  assert.deepEqual(k.pre, { HB: 1, ADC: 1 });
  const r = e.clockCalc();
  assert.equal(r.SYSCLK, 24);
  assert.equal(r.HCLK, 24);
  assert.equal(r.ADC, 24);
  assert.deepEqual(r.over, []);
});

test('the root prescaler is the one with no source (HB on V00x)', () => {
  const e = fresh();
  assert.equal(e.firstPre(e.M.clock), 'HB');
});

test('PLL x2 off HSI gives the full 48 MHz', () => {
  const e = fresh();
  e.S.clock.sys = 'PLLCLK';
  const r = e.clockCalc();
  assert.equal(r.pllIn, 24);
  assert.equal(r.PLLCLK, 48);
  assert.equal(r.SYSCLK, 48);
  assert.equal(r.HCLK, 48);
  assert.deepEqual(r.over, []);
});

test('PLL off HSE follows the crystal box', () => {
  const e = fresh();
  e.S.clock.pllIn = 1; e.S.clock.hse = 8; e.S.clock.sys = 'PLLCLK';
  const r = e.clockCalc();
  assert.equal(r.PLLCLK, 16);
  assert.equal(r.SYSCLK, 16);
});

test('SYSCLK over the datasheet maximum is flagged', () => {
  const e = fresh();
  e.S.clock.sys = 'HSE'; e.S.clock.hse = 25;          // legal crystal, legal SYSCLK
  assert.deepEqual(e.clockCalc().over, []);
  e.S.clock.pllIn = 1; e.S.clock.sys = 'PLLCLK';      // 25 x 2 = 50 MHz > 48
  const r = e.clockCalc();
  assert.equal(r.SYSCLK, 50);
  assert.ok(r.over.includes('SYSCLK'));
});

test('a crystal outside the HSE range is flagged', () => {
  const e = fresh();
  e.S.clock.hse = 30;
  assert.ok(e.clockCalc().over.includes('HSE'));
  e.S.clock.hse = 2;
  assert.ok(e.clockCalc().over.includes('HSE'));
  e.S.clock.hse = 3;
  assert.equal(e.clockCalc().over.includes('HSE'), false);
});

test('the HB prescaler divides SYSCLK into HCLK', () => {
  const e = fresh();
  e.S.clock.sys = 'PLLCLK'; e.S.clock.pre.HB = 4;
  const r = e.clockCalc();
  assert.equal(r.HCLK, 12);
  assert.equal(r.ADC, 12);
});

test('the ADC prescaler hangs off HB and has a minimum as well as a maximum', () => {
  const e = fresh();
  e.S.clock.sys = 'PLLCLK'; e.S.clock.pre.ADC = 4;    // 48 / 4 = 12 MHz, below the 16 MHz floor
  const r = e.clockCalc();
  assert.equal(r.ADC, 12);
  assert.ok(r.over.includes('ADC'));
  e.S.clock.pre.ADC = 2;                              // 24 MHz, in range
  assert.deepEqual(e.clockCalc().over, []);
});

test('derived taps are informational divisions of HCLK', () => {
  const e = fresh();
  e.S.clock.sys = 'PLLCLK';
  const r = e.clockCalc();
  assert.equal(r['Core SysTick'], 6);
  assert.equal(r['Flash time base'], 16);
});

test('every bundled MCU has a clock tree that computes without NaN', () => {
  const e = fresh();
  for (const name of Object.keys(e.MCU_FILES)) {
    e.loadMcu(e.MCU_FILES[name]);
    if (!e.M.clock) continue;
    for (const sys of e.M.clock.sysclk.sources) {
      e.S.clock.sys = sys;
      const r = e.clockCalc();
      assert.ok(Number.isFinite(r.SYSCLK), `${name} ${sys} SYSCLK is ${r.SYSCLK}`);
      assert.ok(Number.isFinite(r.HCLK), `${name} ${sys} HCLK is ${r.HCLK}`);
    }
  }
});

test('adcConversionUs turns the sampling parameter into a real conversion time', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  // 11.5 sampling + 11 SAR cycles at 24 MHz = 0.938 us
  const fast = e.adcConversionUs('ADC1');
  assert.ok(fast, 'CH32V006 ADC1 has a sampling-time parameter');
  assert.equal(fast.clockMhz, 24, 'the ADC prescaler output feeds it, not SYSCLK');
  assert.equal(fast.samplingCycles, 11.5);
  assert.equal(fast.totalCycles, 22.5);
  assert.equal(fast.us, 0.938);

  e.setParam('ADC1', 'sample', '239.5 cycles');
  const slow = e.adcConversionUs('ADC1');
  assert.equal(slow.totalCycles, 250.5);
  assert.equal(slow.us, 10.438);
  assert.ok(slow.ksps < fast.ksps, 'a longer sample means fewer samples per second');
});

test('the ADC conversion time follows the ADC prescaler, not the core clock', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const before = e.adcConversionUs('ADC1');
  e.setClock({ pre: { ADC: 2 } });
  const after = e.adcConversionUs('ADC1');
  assert.equal(after.clockMhz, before.clockMhz / 2);
  assert.ok(after.us > before.us, 'half the clock, twice the time');
});

test('a peripheral without a sampling parameter has no conversion time', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.equal(e.adcConversionUs('USART1'), null);
});
