// resources.js — the conflicts that are not about pins: EXTI lines and DMA
// channels. Data from AGENT-1's `exti:` and `dma:` blocks (RM Table 6-2 and 8-2).
import { test, assert, fresh } from './_harness.js';

const issuesOf = (e, kind) => e.E.resourceIssues.filter(i => i.kind === kind);

test('a clean configuration has no resource issues', () => {
  const e = fresh();
  assert.deepEqual(e.E.resourceIssues, []);
  assert.ok(e.E.resources.exti, 'CH32V006 has an EXTI map');
  assert.ok(e.E.resources.dma, 'and a DMA map');
});

test('each pin knows which EXTI line it can drive', () => {
  const e = fresh();
  assert.deepEqual(e.extiLineOf('PC3'), { line: 'EXTI3', value: '10' });
  assert.deepEqual(e.extiLineOf('PD3'), { line: 'EXTI3', value: '11' });
  assert.deepEqual(e.extiLineOf('PA0'), { line: 'EXTI0', value: '00' });
  assert.equal(e.extiLineOf('VDD'), null);
});

test('one external interrupt per pin number is fine', () => {
  const e = fresh();
  e.assignSignal('PC3', { gpio: 'GPIO_EXTI' });
  e.assignSignal('PC6', { gpio: 'GPIO_EXTI' });
  e.compute();
  assert.deepEqual(e.E.resourceIssues, []);
  assert.deepEqual(Object.keys(e.E.resources.exti.lines).sort(), ['EXTI3', 'EXTI6']);
});

test('two ports on one EXTI line is a conflict — AFIO_EXTICR picks only one', () => {
  const e = fresh();
  e.assignSignal('PC3', { gpio: 'GPIO_EXTI' });
  e.assignSignal('PD3', { gpio: 'GPIO_EXTI' });
  e.compute();
  const [issue] = issuesOf(e, 'exti');
  assert.ok(issue, 'expected an EXTI conflict');
  assert.equal(issue.severity, 'conflict');
  assert.equal(issue.line, 'EXTI3');
  assert.deepEqual(issue.pins.sort(), ['PC3', 'PD3']);
  assert.ok(issue.text.includes('both need EXTI3'));
  assert.ok(issue.text.includes('AFIO_EXTICR'), 'the message names the register to look at');
});

test('an EXTI conflict is not a pin conflict — the pins themselves are fine', () => {
  const e = fresh();
  e.assignSignal('PC3', { gpio: 'GPIO_EXTI' });
  e.assignSignal('PD3', { gpio: 'GPIO_EXTI' });
  e.compute();
  assert.deepEqual(e.E.conflicts, [], 'neither pin is claimed twice');
  assert.equal(e.E.pins.PC3.state, 'set');
  assert.equal(e.E.pins.PD3.state, 'set');
  assert.equal(e.E.resourceIssues.length, 1);
});

test('the conflict clears when one of the two stops being an interrupt', () => {
  const e = fresh();
  e.assignSignal('PC3', { gpio: 'GPIO_EXTI' });
  e.assignSignal('PD3', { gpio: 'GPIO_EXTI' });
  e.compute();
  assert.equal(issuesOf(e, 'exti').length, 1);
  e.assignSignal('PD3', { gpio: 'GPIO_Output' });
  e.compute();
  assert.deepEqual(e.E.resourceIssues, []);
});

test('a pin with no EXTICR selector cannot be an external interrupt', () => {
  const e = fresh();
  e.registerMcuFile('mcu:\n  name: NO-EXTI7\n  inherits: CH32V006\n  remove: [exti.lines.EXTI7]\n');
  e.loadMcu('NO-EXTI7');
  e.assignSignal('PC7', { gpio: 'GPIO_EXTI' });
  e.compute();
  const [issue] = issuesOf(e, 'exti');
  assert.equal(issue.severity, 'conflict');
  assert.deepEqual(issue.pins, ['PC7']);
  assert.ok(issue.text.includes('no AFIO_EXTICR selector routes it'));
});

test('pins that are not bonded on this package are not counted', () => {
  const e = fresh();
  e.assignSignal('PC3', { gpio: 'GPIO_EXTI' });
  e.assignSignal('PD3', { gpio: 'GPIO_EXTI' });
  e.setPackage('QFN12');                 // QFN12 has PC3 but no PD3
  e.compute();
  assert.deepEqual(e.E.resourceIssues, [], 'the clash went away with the package');
});

test('DMA says nothing until the controller is switched on', () => {
  const e = fresh();
  e.toggleSetting('ADC1', 'Channels', 'IN1', true);
  e.setSetting('TIM2', 'Channel3', 'PWM Generation CH3');   // both live on channel 1
  e.compute();
  assert.equal(e.E.resources.dma.enabled, false);
  assert.deepEqual(issuesOf(e, 'dma'), []);
});

test('two peripherals on one DMA channel is a warning, not a conflict', () => {
  const e = fresh();
  e.setSetting('DMA1', 'Mode', 'Activated (7 channels)');
  e.toggleSetting('ADC1', 'Channels', 'IN1', true);
  e.setSetting('TIM2', 'Channel3', 'PWM Generation CH3');
  e.compute();
  const [issue] = issuesOf(e, 'dma');
  assert.ok(issue, 'expected a DMA warning');
  assert.equal(issue.severity, 'warning');
  assert.equal(issue.channel, '1');
  assert.ok(issue.text.includes('channel 1 is shared by ADC1, TIM2_CH3'));
  assert.deepEqual(issue.owners.sort(), ['ADC1', 'DMA1', 'TIM2']);
});

test('the warning reaches every peripheral it concerns, including the controller', () => {
  const e = fresh();
  e.setSetting('DMA1', 'Mode', 'Activated (7 channels)');
  e.toggleSetting('ADC1', 'Channels', 'IN1', true);
  e.setSetting('TIM2', 'Channel3', 'PWM Generation CH3');
  e.compute();
  for (const pid of ['DMA1', 'ADC1', 'TIM2']) {
    assert.ok((e.E.issues[pid] || []).some(m => m.includes('channel 1 is shared')), `${pid} shows it`);
    assert.equal(e.E.status[pid], 'warn', `${pid} is flagged in the tree`);
  }
});

test('several events of one peripheral on a channel is not a clash', () => {
  const e = fresh();
  e.setSetting('DMA1', 'Mode', 'Activated (7 channels)');
  e.setSetting('TIM2', 'Channel2', 'PWM Generation CH2');    // TIM2_CH2 and TIM2_CH4
  e.setSetting('TIM2', 'Channel4', 'PWM Generation CH4');     // both on channel 7
  e.compute();
  assert.equal(e.E.resources.dma.channels['7'].live.length >= 2, true, 'two requests, one owner');
  assert.deepEqual(issuesOf(e, 'dma'), []);
});

test('the channel table says what each channel can serve and what is live', () => {
  const e = fresh();
  e.setSetting('DMA1', 'Mode', 'Activated (7 channels)');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.compute();
  const ch = e.E.resources.dma.channels;
  assert.deepEqual(ch['4'].requests, ['USART1_TX', 'TIM1_TRIG', 'TIM1_COM', 'TIM1_CH4', 'TIM3_CH4']);
  assert.deepEqual(ch['4'].live, ['USART1_TX']);
  assert.deepEqual(ch['2'].live, [], 'SPI1 is off');
  assert.equal(Object.keys(ch).length, 7);
});

// The absence has to be tested on a part built for it, not on whichever bundled part
// happens to be incomplete this week: WCH-DUMMY32-C8 is getting `dma:` and `nvic:`
// (round-3 C7), and the engine's "simply has none" path must still be covered after
// that. `mcu.remove` runs against the parent, so this is CH32V006 minus two blocks.
test('a part with no exti or dma block simply has none', () => {
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-NO-EXTI-DMA
  inherits: CH32V006
  remove: [exti, dma]
`);
  e.loadMcu('CH32V006-NO-EXTI-DMA');
  e.compute();
  assert.equal(e.E.resources.exti, null);
  assert.equal(e.E.resources.dma, null);
  assert.deepEqual(e.E.resourceIssues, []);
  assert.equal(e.extiLineOf('PA0'), null);
  // and the app still works on it: assigning an EXTI pin is not an error, it just
  // has no line to report
  e.assignSignal('PC3', { gpio: 'GPIO_EXTI' });
  e.compute();
  assert.deepEqual(e.E.resourceIssues, []);
});

test('resource issues survive a project round-trip', () => {
  const e = fresh();
  e.assignSignal('PC3', { gpio: 'GPIO_EXTI' });
  e.assignSignal('PD3', { gpio: 'GPIO_EXTI' });
  e.compute();
  const text = e.projectSerialize();
  e.loadMcu('CH32V006');
  e.projectApply(text);
  e.compute();
  assert.equal(issuesOf(e, 'exti').length, 1);
});

test('extiState, dmaState and resourceState are the three views of shared resources', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const exti = e.extiState();
  const dma = e.dmaState();
  const all = e.resourceState();
  assert.ok(exti && exti.lines, 'CH32V006 declares exti lines');
  assert.ok(dma && dma.channels, 'CH32V006 declares dma requests');
  assert.deepEqual(all.issues, [...exti.issues, ...dma.issues],
    'resourceState is exactly the two of them, concatenated');
  assert.deepEqual(all.issues, [], 'a default configuration shares nothing yet');
});
