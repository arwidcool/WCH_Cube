// inherit.js — `mcu.inherits:` lets a derived part (CH32V005 = CH32V006 minus
// TouchKey and TIM3) name its parent instead of copying it.
import { test, assert, fresh, eng } from './_harness.js';

// The shape AGENT-1 will write for CH32V005.
const CHILD = `
mcu:
  name: CH32V005
  inherits: CH32V006
  flash_kb: 16
  sram_kb: 2
  remove: [peripherals.TKEY, peripherals.TIM3]
  variants:
    CH32V005D6U6: { package: QFN12, flash_kb: 16, sram_kb: 2, temp: 85 }
    CH32V005F6P6: { package: TSSOP20, flash_kb: 16, sram_kb: 2, temp: 85 }
`;

const withChild = (text = CHILD) => {
  const e = fresh();
  e.registerMcuFile(text);
  return e;
};

test('a child inherits its parent packages, pins and peripherals', () => {
  const e = withChild();
  e.loadMcu('CH32V005');
  assert.equal(e.M.mcu.name, 'CH32V005');
  assert.equal(e.M.mcu.inherited_from, 'CH32V006');
  assert.deepEqual(Object.keys(e.M.packages).sort(), ['QFN12', 'QFN20', 'QFN32', 'QSOP24', 'TSSOP20']);
  assert.ok(e.M.peripherals.USART1, 'USART1 comes from the parent');
  assert.equal(e.M.pins.PD7.type, 'io');
  assert.ok(e.M.clock.sources.HSI, 'the clock tree is inherited too');
});

test('child scalars win over the parent', () => {
  const e = withChild();
  e.loadMcu('CH32V005');
  assert.equal(e.M.mcu.flash_kb, 16);
  assert.equal(e.M.mcu.sram_kb, 2);
  assert.equal(e.M.mcu.core, 'QingKe RISC-V2A (RV32EmC)', 'unstated keys come from the parent');
  assert.equal(e.M.mcu.max_sysclk_mhz, 48);
});

test('mcu.remove drops what the derived part does not have', () => {
  const e = withChild();
  assert.ok(e.M.peripherals.TKEY, 'the parent does have TouchKey');
  e.loadMcu('CH32V005');
  assert.equal(e.M.peripherals.TKEY, undefined);
  assert.equal(e.M.peripherals.TIM3, undefined);
  assert.ok(e.M.peripherals.TIM1 && e.M.peripherals.TIM2, 'the other timers survive');
  e.compute();
  assert.equal(e.E.status.TKEY, undefined);
});

test('a remove path that matches nothing is an error, not a silent no-op', () => {
  const e = withChild(CHILD.replace('peripherals.TKEY', 'peripherals.TKEY_TYPO'));
  assert.throws(() => e.loadMcu('CH32V005'), /matched nothing in CH32V006/);
});

// Round-3 C4. `remove` used to run on the MERGED document, so a child that removed a
// path and redefined it lost its own version as well. That is how CH32V005 shipped
// with no DMA request map and dead channel-clash detection.
test('a path the child removes AND redefines keeps the CHILD version', () => {
  const e = withChild(CHILD.replace(
    'remove: [peripherals.TKEY, peripherals.TIM3]',
    'remove: [peripherals.TKEY, peripherals.TIM3, dma.requests]') + `
dma:
  requests:
    1: [ADC1]
    2: [SPI1_RX]
`);
  e.loadMcu('CH32V005');
  assert.ok(e.M.dma && e.M.dma.requests, 'the child redefined dma.requests; removing must not delete it');
  assert.deepEqual(Object.keys(e.M.dma.requests).sort(), ['1', '2']);
  assert.deepEqual(e.M.dma.requests[1], ['ADC1'], "the parent's channel 1 was dropped, not merged into");
});

test('remove drops the parent key even when the child says nothing about it', () => {
  const e = withChild();
  e.loadMcu('CH32V005');
  assert.equal(e.M.peripherals.TKEY, undefined);
  assert.ok(e.M.peripherals.USART1, 'unrelated siblings survive');
});

// The flip side of applying `remove` to the parent: it now matches against the parent
// only. Removing something only the CHILD has is a stale removal and says so, which is
// what catches a parent rename.
test('removing a path only the child defines is an error', () => {
  const e = withChild(CHILD.replace(
    'remove: [peripherals.TKEY, peripherals.TIM3]',
    'remove: [peripherals.TKEY, peripherals.TIM3, peripherals.MYOWN]') + `
peripherals:
  MYOWN:
    category: Test
`);
  assert.throws(() => e.loadMcu('CH32V005'), /mcu\.remove path "peripherals\.MYOWN" matched nothing in CH32V006/);
});

test('CH32V005 as shipped keeps its own DMA request map', () => {
  const e = fresh();
  e.loadMcu('CH32V005');
  assert.ok(e.M.dma && e.M.dma.requests, 'the real file, not a fixture');
  assert.deepEqual(Object.keys(e.M.dma.requests).sort(), ['1', '2', '3', '4', '5', '6', '7']);
  const all = Object.values(e.M.dma.requests).flat();
  assert.ok(!all.some(r => String(r).startsWith('TIM3')), 'and no TIM3 request on a part with no TIM3');
  assert.equal(e.M.dma.request_defaults.TIM3_CH3, undefined, 'the removed defaults are still removed');
  assert.ok(e.M.dma.request_defaults.ADC1, 'while the rest of the defaults survive');
});

test('variants are replaced, never merged — a derived part has its own part numbers', () => {
  const e = withChild();
  e.loadMcu('CH32V005');
  assert.deepEqual(Object.keys(e.M.mcu.variants).sort(), ['CH32V005D6U6', 'CH32V005F6P6']);
});

test('lists replace wholesale, because a remap index is a register field value', () => {
  const e = withChild(CHILD + `
peripherals:
  I2C1:
    remaps:
      - { name: "000 Default", pins: { SCL: PC2, SDA: PC1 } }
      - { name: "001",         pins: { SCL: PD1, SDA: PD0 } }
`);
  e.loadMcu('CH32V005');
  assert.equal(e.M.peripherals.I2C1.remaps.length, 2, 'the parent had 5; the child list wins outright');
  assert.equal(e.M.peripherals.I2C1.remaps[1].pins.SCL, 'PD1');
  assert.ok(e.M.peripherals.I2C1.settings, 'sibling keys of the overridden list still come from the parent');
});

test('a child may override one nested key without restating the rest', () => {
  const e = withChild(CHILD + `
clock:
  sysclk: { max_mhz: 24 }
`);
  e.loadMcu('CH32V005');
  assert.equal(e.M.clock.sysclk.max_mhz, 24);
  assert.deepEqual(e.M.clock.sysclk.sources, ['HSI', 'HSE', 'PLLCLK'], 'inherited from the parent');
  e.S.clock.sys = 'PLLCLK';
  assert.ok(e.clockCalc().over.includes('SYSCLK'), '48 MHz PLL now breaks the 24 MHz limit');
});

test('the parent must be loaded, and the message says which one', () => {
  const e = fresh();
  e.registerMcuFile(CHILD.replace('inherits: CH32V006', 'inherits: CH32V999'));
  assert.throws(() => e.loadMcu('CH32V005'), /inherits from "CH32V999", which is not loaded/);
});

test('inheritance chains work and loops are rejected', () => {
  const e = withChild();
  e.registerMcuFile('mcu:\n  name: CH32V005X\n  inherits: CH32V005\n  sram_kb: 1\n');
  e.loadMcu('CH32V005X');
  assert.equal(e.M.mcu.sram_kb, 1);
  assert.equal(e.M.mcu.flash_kb, 16, 'through CH32V005');
  assert.ok(e.M.peripherals.USART1, 'through to CH32V006');
  assert.equal(e.M.peripherals.TKEY, undefined, 'the middle link removed it');

  const loop = fresh();
  loop.registerMcuFile('mcu:\n  name: A\n  inherits: B\n');
  loop.registerMcuFile('mcu:\n  name: B\n  inherits: A\n');
  assert.throws(() => loop.loadMcu('A'), /loop/);
});

test('a derived part behaves like any other in the engine', () => {
  const e = withChild();
  e.loadMcu('CH32V005');
  e.setPackage('TSSOP20');
  e.assignSignal('PC0', { periph: 'USART1', signal: 'TX', remap: 3 });
  e.compute();
  assert.equal(e.E.pins.PC0.label, 'USART1_TX');
  assert.deepEqual(e.E.conflicts, []);
  const text = e.projectSerialize();
  e.loadMcu('CH32V006');
  e.projectApply(text);
  assert.equal(e.M.mcu.name, 'CH32V005', 'the project reopens on the derived part');
  assert.equal(e.compute().pins.PC0.label, 'USART1_TX');
});

test('deepMerge and removePath on their own', () => {
  const { deepMerge, removePath } = eng;
  assert.deepEqual(deepMerge({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 4, e: 5 } }), { a: 1, b: { c: 2, d: 4, e: 5 } });
  assert.deepEqual(deepMerge({ a: [1, 2, 3] }, { a: [9] }), { a: [9] });
  assert.deepEqual(deepMerge({ a: { b: 1 } }, { a: 'scalar' }), { a: 'scalar' });
  const o = { x: { y: { z: 1 }, keep: 2 } };
  assert.equal(removePath(o, 'x.y.z'), true);
  assert.deepEqual(o, { x: { y: {}, keep: 2 } });
  assert.equal(removePath(o, 'x.nope'), false);
  assert.equal(removePath(o, 'a.b.c'), false);
});
