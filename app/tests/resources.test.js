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

// =============================================================================
//  DMA requests — the state AGENT-3's DMA Settings tab writes to (round-3 C2/P2)
// =============================================================================

test('the part offers its own requests, and says which channel each is wired to', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const all = e.dmaAllRequests();
  assert.equal(all.length, 23, 'CH32V006 has 23 DMA requests');
  assert.deepEqual(e.dmaLegalChannels('ADC1'), ['1']);
  assert.deepEqual(e.dmaLegalChannels('USART1_RX'), ['5']);
  assert.deepEqual(e.dmaLegalChannels('NOPE'), [], 'a request this part does not have');
  // Every request on this part is wired to exactly one channel, so the channel is not
  // a choice the user gets to make - a one-entry list means the control is not shown.
  for (const r of all) {
    assert.equal(e.dmaLegalChannels(r.request).length, 1, `${r.request} is wired to one channel`);
  }
});

test('adding a request takes its channel from the hardware, not from the caller', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.deepEqual(e.dmaRequests(), [], 'nothing configured to start with');
  e.addDmaRequest('USART1_TX');
  const rows = e.dmaRequests();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'USART1_TX', 'the request name is its identity');
  assert.equal(rows[0].channel, '4', 'RM Table 8-2: USART1_TX is on channel 4');
  assert.equal(rows[0].owner, 'USART1');
  assert.deepEqual(rows[0].legalChannels, ['4']);
});

test('the starting values come from dma.request_defaults, not from a guess', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.addDmaRequest('ADC1');
  const r = e.dmaRequests()[0];
  // AGENT-1's data: an ADC data register is 16 bits wide and a sampling run repeats,
  // so these are what the hardware needs rather than preferences.
  assert.equal(r.params.dir, 'Peripheral to memory');
  assert.equal(r.params.psize, 'Half Word');
  assert.equal(r.params.msize, 'Half Word');
  assert.equal(r.params.mode, 'Circular');
  assert.equal(r.params.minc, true, 'and the definition default where the seed says nothing');

  e.addDmaRequest('USART1_TX');
  const u = e.dmaRequests().find(x => x.id === 'USART1_TX');
  assert.equal(u.params.dir, 'Memory to peripheral');
  assert.equal(u.params.psize, 'Byte', 'a USART data register is 8 bits, so the default stands');
});

test('a request the part does not have is refused, and so is adding one twice', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.throws(() => e.addDmaRequest('SDIO_TX'), /has no DMA request "SDIO_TX"/);
  e.addDmaRequest('SPI1_TX');
  assert.throws(() => e.addDmaRequest('SPI1_TX'), /already on DMA channel 3/);
  assert.equal(e.dmaRequests().length, 1, 'and the second attempt changed nothing');
  assert.throws(() => e.setDmaRequest('SPI1_TX', { channel: 6 }), /cannot use channel 6 — it is wired to 3/);
  assert.throws(() => e.removeDmaRequest('NOPE'), /No DMA request "NOPE"/);
});

test('DMA parameters validate exactly like peripheral parameters', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.addDmaRequest('SPI1_RX');
  assert.ok(e.dmaParamDefs().length, 'channel_params is the same schema as params:');
  e.setDmaParam('SPI1_RX', 'priority', 'Very high');
  assert.equal(e.dmaParamValue('SPI1_RX', 'priority'), 'Very high');
  assert.equal(e.dmaParamRegisterValue('SPI1_RX', 'priority'), 3, 'RM 8.3.3 PL[13:12]');
  assert.throws(() => e.setDmaParam('SPI1_RX', 'priority', 'Urgent'), /is not one of Low, Medium, High, Very high/);
  assert.throws(() => e.setDmaParam('SPI1_RX', 'nosuch', 1), /DMA has no parameter "nosuch"/);
  assert.throws(() => e.setDmaParam('NOPE', 'priority', 'Low'), /No DMA request "NOPE"/);
  assert.equal(e.dmaParamValue('SPI1_RX', 'priority'), 'Very high', 'no rejected write stuck');
  e.setDmaParam('SPI1_RX', 'minc', 'false');
  assert.equal(e.dmaParamValue('SPI1_RX', 'minc'), false, 'a bool coerces the way setParam does');
});

test('every DMA mutation is one undo step', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.addDmaRequest('I2C1_TX');
  e.setDmaParam('I2C1_TX', 'priority', 'High');
  assert.equal(e.dmaParamValue('I2C1_TX', 'priority'), 'High');
  e.undo();
  assert.equal(e.dmaParamValue('I2C1_TX', 'priority'), 'Low', 'back to the starting value');
  e.undo();
  assert.deepEqual(e.dmaRequests(), [], 'and the request itself is gone');
  e.redo();
  assert.equal(e.dmaRequests().length, 1, 'redo brings it back');
  assert.equal(e.undoLabel(), 'Add DMA I2C1_TX', 'the label says what it was');
});

test('two requests on one channel is a hard conflict that names the owners', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  // channel 6 serves I2C1_TX, TIM1_CH3 and USART2_TX, and can drive one of them
  e.addDmaRequest('I2C1_TX');
  e.addDmaRequest('USART2_TX');
  const c = e.dmaConflicts();
  assert.equal(c.length, 1);
  assert.equal(c[0].channel, '6');
  assert.deepEqual(c[0].ids.sort(), ['I2C1_TX', 'USART2_TX']);
  assert.deepEqual(c[0].owners.sort(), ['I2C1', 'USART2']);
  assert.match(c[0].text, /channel 6 is configured for I2C1_TX and USART2_TX/);

  e.compute();
  const issue = e.E.resources.issues.find(i => i.kind === 'dma' && i.severity === 'conflict');
  assert.ok(issue, 'it reaches E.resources.issues as a conflict, not a warning');
  assert.ok(issue.owners.includes('DMA1'), 'and the controller carries it too, so its tree node shows it');

  e.removeDmaRequest('USART2_TX');
  assert.deepEqual(e.dmaConflicts(), [], 'removing one clears it');
});

test('requests come back in channel order however they were added', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  for (const r of ['USART2_RX', 'ADC1', 'SPI1_TX']) e.addDmaRequest(r);
  assert.deepEqual(e.dmaRequests().map(r => r.id), ['ADC1', 'SPI1_TX', 'USART2_RX']);
  assert.deepEqual(e.dmaRequests().map(r => r.channel), ['1', '3', '7'],
    'stable order is what makes regeneration byte-identical');
});

test('the Add control only offers what is not already configured', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.equal(e.dmaAddableRequests().length, 23);
  e.addDmaRequest('ADC1');
  const left = e.dmaAddableRequests();
  assert.equal(left.length, 22);
  assert.equal(left.some(r => r.request === 'ADC1'), false);
});

test('a part with no dma block answers with empty lists rather than throwing', () => {
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-NODMA
  inherits: CH32V006
  remove: [dma]
`);
  e.loadMcu('CH32V006-NODMA');
  assert.deepEqual(e.dmaRequests(), []);
  assert.deepEqual(e.dmaAllRequests(), []);
  assert.deepEqual(e.dmaParamDefs(), []);
  assert.deepEqual(e.dmaConflicts(), []);
  assert.throws(() => e.addDmaRequest('ADC1'), /has no DMA request "ADC1"/);
  e.compute();
  assert.equal(e.E.resources.dma, null);
});

// =============================================================================
//  NVIC — the PFIC, which is not the Cortex-M scheme
// =============================================================================

test('the vectors carry BOTH SDK names, because the vendor uses two', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const v = e.nvicVectors();
  assert.equal(v.length, 29, 'RM Table 6-1');
  const adc = v.find(x => x.name === 'ADC');
  // vector 29 is ADC_IRQn in the enum but ADC1_IRQHandler in the startup table, and
  // they are NOT interchangeable: one goes in NVIC_IRQChannel, the other is the
  // symbol the user's ISR has to be called to be linked in.
  assert.equal(adc.irqn, 'ADC_IRQn');
  assert.equal(adc.handler, 'ADC1_IRQHandler');
  assert.equal(adc.peripheral, 'ADC1');
  const nmi = v.find(x => x.name === 'NMI');
  assert.equal(nmi.irqn, 'NonMaskableInt_IRQn');
  assert.equal(nmi.handler, 'NMI_Handler');
  assert.ok(v.every(x => x.irqn && x.handler), 'every vector has both, or codegen has to guess one');
});

test('a vector is available only while something can raise it', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const of = name => e.nvicVectors().find(v => v.name === name);
  assert.equal(of('USART1').available, false, 'USART1 is off at boot');
  assert.equal(of('SysTick').available, true, 'a system vector is always available');
  assert.equal(of('NMI').fixed, true);
  assert.equal(of('NMI').enabled, true, 'and it cannot be switched off');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  assert.equal(of('USART1').available, true);
});

test('priorities are checked against the ACTIVE group, not against 0-15', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const groups = e.nvicGroups();
  assert.equal(groups.length, 2);
  assert.equal(e.S.nvic.group, 0, 'the group the data marks default: true');
  // group 0: one preemption bit and one sub bit, so both are 0-1. The PFIC implements
  // TWO priority bits, not the Cortex-M four (RM 6.5.2.21).
  e.setNvicVector('USART1', { enabled: true, preempt: 1, sub: 1 });
  const v = e.nvicVectors().find(x => x.name === 'USART1');
  assert.equal(v.enabled, true);
  assert.equal(v.preempt, 1);
  assert.equal(v.sub, 1);
  assert.throws(() => e.setNvicVector('USART1', { preempt: 2 }), /preempt priority 2 is outside 0-1/);
  assert.throws(() => e.setNvicVector('USART1', { sub: 3 }), /sub priority 3 is outside 0-1/);
  assert.equal(e.nvicVectors().find(x => x.name === 'USART1').preempt, 1, 'nothing stuck');

  // group 1 has no preemption at all and a 2-bit sub-priority
  e.setNvicGroup(1);
  assert.throws(() => e.setNvicVector('USART1', { preempt: 1 }), /preempt priority 1 is outside 0-0/);
  e.setNvicVector('USART1', { sub: 3 });
  assert.equal(e.nvicVectors().find(x => x.name === 'USART1').sub, 3);
});

test('changing the group clamps priorities that no longer fit', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setNvicGroup(1);
  e.setNvicVector('TIM2', { enabled: true, sub: 3 });
  e.setNvicGroup(0);                       // sub is one bit here
  assert.equal(e.nvicVectors().find(v => v.name === 'TIM2').sub, 1,
    'a 1-bit field cannot hold 3, and leaving it there would generate a wrong byte');
  assert.equal(e.nvicVectors().find(v => v.name === 'TIM2').enabled, true, 'the enable survives');
  assert.throws(() => e.setNvicGroup(7), /has no interrupt priority grouping 7 \(it has 2\)/);
});

test('a vector this part does not have is refused by name', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  // RM Table 6-1 has no TIM3 vector although this part has a TIM3; both EVT sources
  // agree. Nothing was invented, so nothing can be enabled.
  assert.equal(e.nvicVectors().some(v => v.name === 'TIM3'), false);
  assert.throws(() => e.setNvicVector('TIM3', { enabled: true }), /has no interrupt vector "TIM3"/);
  assert.throws(() => e.setNvicVector('NMI', { enabled: false }), /NMI cannot be disabled/);
});

test('enabling a vector nothing can raise is a warning, not a silent nothing', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setNvicVector('SPI1', { enabled: true });
  e.compute();
  const issue = e.E.resources.issues.find(i => i.kind === 'nvic');
  assert.ok(issue, 'SPI1 is off, so its vector will never fire');
  assert.match(issue.text, /SPI1 is enabled but SPI1 is switched off/);
  assert.equal(issue.severity, 'warning', 'it is a mistake, not an impossibility');

  e.setSetting('SPI1', 'Mode', 'Full-Duplex Master');
  e.compute();
  assert.equal(e.E.resources.issues.some(i => i.kind === 'nvic'), false, 'switching it on clears it');
});

test('NVIC changes are undoable like everything else', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setNvicVector('SysTick', { enabled: true, preempt: 1 });
  assert.equal(e.nvicVectors().find(v => v.name === 'SysTick').preempt, 1);
  e.undo();
  assert.equal(e.nvicVectors().find(v => v.name === 'SysTick').enabled, false);
  e.redo();
  assert.equal(e.nvicVectors().find(v => v.name === 'SysTick').enabled, true);
});

test('a part with no nvic block answers with empty lists rather than throwing', () => {
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-NONVIC
  inherits: CH32V006
  remove: [nvic]
`);
  e.loadMcu('CH32V006-NONVIC');
  assert.deepEqual(e.nvicVectors(), []);
  assert.deepEqual(e.nvicGroups(), []);
  assert.equal(e.nvicState(), null);
  assert.throws(() => e.setNvicVector('USART1', { enabled: true }), /has no interrupt vector "USART1"/);
  e.compute();
  assert.equal(e.E.resources.nvic, null);
});

// =============================================================================
//  Round trip — both halves through .wchproj, which is the whole point of putting
//  them in S rather than in the UI.
// =============================================================================

// `saved:` is a wall clock, so two serialisations of the same state differ by it and
// only by it. Everything else about a .wchproj has to be reproducible, and the
// GENERATED C has to be byte-identical with nothing excused - that is a round-3 DONE
// line and the reason S.dma is a sorted list rather than a map.
const stripSaved = t => t.replace(/^saved: .*$/m, 'saved: -');

test('DMA and NVIC survive save, close and open', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.addDmaRequest('USART1_TX');
  e.setDmaParam('USART1_TX', 'priority', 'High');
  e.setDmaParam('USART1_TX', 'mode', 'Circular');
  e.addDmaRequest('ADC1');
  e.setNvicGroup(1);
  e.setNvicVector('USART1', { enabled: true, sub: 2 });
  e.compute();
  const text = e.projectSerialize();

  e.loadMcu(e.MCU_FILES.CH32V006);
  assert.deepEqual(e.dmaRequests(), [], 'setup: really wiped');

  e.projectApply(text);
  assert.deepEqual(e.PROJECT.warnings, [], 'nothing was dropped on the way back in');
  const rows = e.dmaRequests();
  assert.deepEqual(rows.map(r => r.id), ['ADC1', 'USART1_TX']);
  assert.equal(e.dmaParamValue('USART1_TX', 'priority'), 'High');
  assert.equal(e.dmaParamValue('USART1_TX', 'mode'), 'Circular');
  assert.equal(e.dmaParamValue('ADC1', 'psize'), 'Half Word', 'seeded values round-trip too');
  assert.equal(e.S.nvic.group, 1);
  const v = e.nvicVectors().find(x => x.name === 'USART1');
  assert.equal(v.enabled, true);
  assert.equal(v.sub, 2);
  assert.equal(stripSaved(e.projectSerialize()), stripSaved(text), 'and saving again produces the same bytes');
});

test('regenerating after save, close and open produces byte-identical C', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.setGpioField('PC0', 'label', 'LED');
  // added in an order that is not the channel order, so a map-iteration bug would show
  e.addDmaRequest('USART2_RX');
  e.addDmaRequest('ADC1');
  e.addDmaRequest('USART1_TX');
  e.setDmaParam('USART1_TX', 'priority', 'High');
  e.setNvicVector('USART1', { enabled: true, preempt: 1 });
  e.compute();
  const before = e.cFiles();
  const text = e.projectSerialize();

  e.loadMcu(e.MCU_FILES.CH32V005);        // somewhere else entirely
  e.projectApply(text);
  e.compute();
  const after = e.cFiles();
  assert.deepEqual(Object.keys(after), Object.keys(before));
  for (const name of Object.keys(before)) {
    assert.equal(after[name], before[name], `${name} differs after a save/open cycle`);
  }
});

test('a project with neither block still round-trips byte-identically', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  const text = e.projectSerialize();
  assert.equal(/^dma:/m.test(text), false, 'an untouched DMA writes no key at all');
  assert.equal(/^nvic:/m.test(text), false);
  e.projectApply(text);
  assert.equal(stripSaved(e.projectSerialize()), stripSaved(text));
});

test('a saved request the part no longer has is dropped and reported, not applied', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.addDmaRequest('TIM3_CH3');                 // CH32V006 has TIM3; CH32V005 does not
  e.setNvicVector('TIM2', { enabled: true, preempt: 1 });
  const text = e.projectSerialize().replace('mcu: CH32V006', 'mcu: CH32V005');

  e.projectApply(text);
  assert.equal(e.M.mcu.name, 'CH32V005');
  assert.deepEqual(e.dmaRequests(), [], 'CH32V005 has no TIM3 and therefore no TIM3_CH3 request');
  assert.ok(e.PROJECT.warnings.some(w => /TIM3_CH3/.test(w)), 'and it says so: ' + JSON.stringify(e.PROJECT.warnings));
  assert.equal(e.nvicVectors().find(v => v.name === 'TIM2').enabled, true, 'what still exists still applies');
});

test('a saved priority that no longer fits loses the priority, not the enable', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setNvicGroup(1);
  e.setNvicVector('TIM2', { enabled: true, sub: 3 });
  // hand-edit the saved group back to the narrow one, as a stale file would have it
  const text = e.projectSerialize().replace(/group: 1/, 'group: 0');
  e.projectApply(text);
  const v = e.nvicVectors().find(x => x.name === 'TIM2');
  assert.equal(v.enabled, true, 'the interrupt the user asked for is still on');
  assert.ok(v.sub <= 1, 'and its priority is inside the grouping that is actually active');
  assert.ok(e.PROJECT.warnings.some(w => /TIM2/.test(w)), 'reported rather than silent');
});
