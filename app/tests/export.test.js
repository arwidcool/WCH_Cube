// export.js — the pin table and clock summary behind the Generate button.
import { test, assert, fresh } from './_harness.js';

test('the pin table has one row per physical pin, in pin-number order', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const rows = e.pinRows();
  assert.equal(rows.length, 20);
  assert.deepEqual(rows.map(r => r.num), Array.from({ length: 20 }, (_, i) => String(i + 1)));
  assert.equal(rows[0].name, 'PD4');
  assert.equal(rows[3].name, 'PD7/PA4');
  assert.equal(rows[3].shorted, true);
});

test('the exposed pad sorts last and power pins keep their type', () => {
  const e = fresh('CH32V006', 'QFN20');
  const rows = e.pinRows();
  assert.equal(rows.length, 21);                 // 20 pins + the pad
  assert.equal(rows[rows.length - 1].num, '');
  assert.equal(rows[rows.length - 1].name, 'VSS');
  assert.equal(rows.find(r => r.name === 'VDD').type, 'power');
});

test('assigned pins carry their signal, mode and user label', () => {
  const e = fresh();
  e.assignSignal('PC0', { periph: 'USART1', signal: 'TX', remap: 3 });
  e.S.gpio.PC0 = { mode: 'Alternate Function Push Pull', pull: 'Pull-up', speed: 'High', label: 'DEBUG_TX' };
  e.compute();
  const row = e.pinRows().find(r => r.name === 'PC0');
  assert.equal(row.signal, 'USART1_TX');
  assert.equal(row.mode, 'Alternate Function Push Pull');
  assert.equal(row.pull, 'Pull-up');
  assert.equal(row.label, 'DEBUG_TX');
  assert.equal(row.conflict, false);
});

test('conflicts are marked in the markdown table and listed under it', () => {
  const e = fresh();
  e.S.periph.USART1.settings.Mode = 'Asynchronous';
  e.S.periph.USART1.remap = 4;                   // TX collides with SYS_SWIO on PD1
  e.compute();
  const md = e.pinTableMarkdown();
  assert.ok(md.includes('# CH32V006 — pinout (TSSOP20)'));
  assert.ok(/\| 18 \| PD1 \|.*CONFLICT/.test(md), 'the PD1 row is marked');
  assert.ok(md.includes('**1 pin conflict:**'));
  assert.ok(md.includes('PD1: SYS_SWIO / USART1_TX'));
});

test('a clean configuration says so instead of listing conflicts', () => {
  const e = fresh();
  assert.ok(e.pinTableMarkdown().includes('No pin conflicts.'));
});

test('the CSV has a header plus one line per pin and quotes what it must', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.S.gpio.PC0 = { mode: 'Output Push Pull', pull: 'No pull', speed: 'Low', label: 'A,B "quoted"' };
  e.compute();
  const lines = e.pinTableCsv().trim().split('\n');
  assert.equal(lines.length, 21);
  assert.equal(lines[0], 'Pin,Name,Signal,Mode,Pull,Speed,User label,Note');
  const pc0 = lines.find(l => l.startsWith('10,PC0,'));
  assert.ok(pc0.includes('"A,B ""quoted"""'), `CSV quoting: ${pc0}`);
});

test('the clock summary reports every node and the out-of-spec ones', () => {
  const e = fresh();
  e.S.clock.sys = 'PLLCLK';
  let md = e.clockSummaryMarkdown();
  assert.ok(md.includes('| SYSCLK | source PLLCLK | 48 MHz |'));
  assert.ok(md.includes('| HCLK | HB /1 | 48 MHz |'));
  assert.ok(md.includes('| ADC | /1 from HB | 48 MHz |'));
  assert.ok(md.includes('| Core SysTick | HCLK /8 | 6 MHz |'));
  assert.ok(md.includes('All clocks within specification.'));
  e.S.clock.pre.ADC = 8;
  md = e.clockSummaryMarkdown();
  assert.ok(md.includes('**Out of specification: ADC**'));
});

test('generateAll names its files after the part and package', () => {
  const e = fresh('CH32V006', 'QFN32');
  const out = e.generateAll();
  assert.deepEqual(Object.keys(out).sort(), [
    'CH32V006_QFN32_clocks.md', 'CH32V006_QFN32_pinout.csv', 'CH32V006_QFN32_pinout.md',
    'wchcube_init.c', 'wchcube_init.h',
  ], 'the reports are named after the part; the C files keep fixed include names');
  for (const [name, text] of Object.entries(out)) assert.ok(text.length > 100, `${name} has content`);
});
