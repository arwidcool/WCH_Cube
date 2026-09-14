// resources.js — the conflicts that are not about pins: EXTI lines and DMA
// channels. Data from AGENT-1's `exti:` and `dma:` blocks (RM Table 6-2 and 8-2).
import { test, assert, fresh, eng } from './_harness.js';

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

// ---- Multiple controllers + the DMAMUX crossbar (CH32H417's proven need) --------
// main's P0: `M.dma` was a single object everywhere in the engine (`resources.js:76`
// read `M.dma.controller` as a bare string), and every existing `dma.requests:` block
// encodes a FIXED hardware table - channel N takes only its own small, silicon-wired
// set. CH32H417 has TWO real controllers (DMA1, DMA2) and a true 16-channel DMAMUX
// crossbar: any of 123 named requests onto ANY channel via `DMA_MuxChannelConfig`, a
// register write no existing part's codegen has ever made. Forcing the crossbar into
// the old fixed-table shape would misrepresent one shared mux as separate identical
// tables - the exact "ships as done but isn't" failure this repo exists to prevent
// (AGENT-1's finding, board 2026-09-14). `dma:` may now be a LIST of controllers, each
// optionally `mux:`-shaped instead of `requests:`-shaped - additive, the single-object
// shape every existing part uses is completely unchanged (see every test above, all
// still green with zero changes).
const DMA_MUX_PART = `
mcu:
  name: CH32V006-DMA-MUX
  inherits: CH32V006
  remove: [dma]
dma:
  - controller: DMA1
    init_struct: DMA_InitTypeDef
    register: { channel_macro: "DMA1_Channel$CH" }
    mux:
      base: 0
      count: 2
      sdk_call: DMA_MuxChannelConfig
      requests: { ADC1: 5, SPI1_TX: 7 }
    channel_params:
      - key: dir
        name: Direction
        type: enum
        sdk_field: DMA_DIR
        default: Peripheral to memory
        options:
          - { name: Peripheral to memory, value: 0, sdk: DMA_DIR_PeripheralSRC }
          - { name: Memory to peripheral, value: 1, sdk: DMA_DIR_PeripheralDST }
  - controller: DMA2
    init_struct: DMA_InitTypeDef
    register: { channel_macro: "DMA2_Channel$CH" }
    mux:
      base: 2
      count: 2
      sdk_call: DMA_MuxChannelConfig
      requests: { ADC1: 5, SPI1_TX: 7 }
    channel_params:
      - key: dir
        name: Direction
        type: enum
        sdk_field: DMA_DIR
        default: Peripheral to memory
        options:
          - { name: Peripheral to memory, value: 0, sdk: DMA_DIR_PeripheralSRC }
          - { name: Memory to peripheral, value: 1, sdk: DMA_DIR_PeripheralDST }
`;
const withDmaMux = () => {
  const e = fresh();
  e.registerMcuFile(DMA_MUX_PART);
  e.loadMcu('CH32V006-DMA-MUX');
  return e;
};

test('dmaControllers() normalises a LIST, and dmaControllerFor() resolves a GLOBAL channel to the right one', () => {
  const e = withDmaMux();
  assert.equal(e.dmaControllers().length, 2);
  assert.deepEqual(e.dmaControllers().map(c => c.controller), ['DMA1', 'DMA2']);
  assert.equal(e.dmaControllerFor('1').controller, 'DMA1');
  assert.equal(e.dmaControllerFor('2').controller, 'DMA1');
  assert.equal(e.dmaControllerFor('3').controller, 'DMA2', 'DMA1 has 2 channels (base 0, count 2) - global 3 is DMA2\'s own channel 1');
  assert.equal(e.dmaControllerFor('4').controller, 'DMA2');
  assert.equal(e.dmaControllerFor('5'), null, 'past both controllers\' ranges');
});

test('a crossbar request can legally go on EVERY channel of a controller whose catalogue names it - not one fixed channel', () => {
  const e = withDmaMux();
  // Both controllers' mux.requests name ADC1, so it can go anywhere across all 4
  // global channels - the actual hardware fact a true crossbar states, not a guess.
  assert.deepEqual(e.dmaLegalChannels('ADC1'), ['1', '2', '3', '4']);
});

// The UI bug this closes, found while smoke-testing the real render, not guessed at:
// both fixture controllers' catalogues name ADC1, and dmaAllRequests()/
// dmaAddableRequests() used to return it TWICE - the "Add" dropdown showed two
// identical "ADC1" options with no way to tell them apart.
test('dmaAllRequests() lists a name ONE catalogue names twice (two mux controllers sharing it) only once', () => {
  const e = withDmaMux();
  const adc1Rows = e.dmaAllRequests().filter(r => r.request === 'ADC1');
  assert.equal(adc1Rows.length, 1, 'ADC1 is in both DMA1 and DMA2 mux.requests, but is ONE addable option, not two');
  assert.equal(e.dmaAddableRequests().filter(r => r.request === 'ADC1').length, 1);
});

test('adding a crossbar request onto the SECOND controller resolves its own LOCAL channel macro, not the global number', () => {
  const e = withDmaMux();
  e.addDmaRequest('ADC1', '3');   // global channel 3 = DMA2's own channel 1
  e.compute();
  const c = e.cSource();
  assert.match(c, /DMA_MuxChannelConfig\(3, 5\)/, 'routes ADC1 (mux id 5) onto GLOBAL channel 3');
  assert.match(c, /DMA2_Channel1\b/, 'the channel HANDLE is DMA2\'s own local numbering, not "DMA2_Channel3"');
  assert.doesNotMatch(c, /DMA1_Channel/, 'this request never touches DMA1 at all');
});

// The bare GLOBAL number above is numerically correct but not how any real EVT
// example spells it - CH32H417's own `ch32h417_dma.h:246-261` names 16
// `DMA_MuxChannel1`..`DMA_MuxChannel16` macros, and real code
// (`Evt/EXAM/USART/USART_DMA/Common/hardware.c:188`) calls
// `DMA_MuxChannelConfig(DMA_MuxChannel7, 87)`, never a bare `7`. `mux.channel_macro`
// is the data's way to say so, using the SAME `$CH`-substitution `dma.register.
// channel_macro` already uses one level up.
test('mux.channel_macro, when the data gives one, is used verbatim instead of a bare number', () => {
  const e = fresh();
  e.registerMcuFile(DMA_MUX_PART.replaceAll(
    'sdk_call: DMA_MuxChannelConfig',
    'sdk_call: DMA_MuxChannelConfig\n      channel_macro: "DMA_MuxChannel$CH"'));
  e.loadMcu('CH32V006-DMA-MUX');
  e.addDmaRequest('ADC1', '3');
  e.compute();
  const c = e.cSource();
  assert.match(c, /DMA_MuxChannelConfig\(DMA_MuxChannel3, 5\)/,
    'the macro name carries the GLOBAL channel number, exactly as the real SDK header spells it');
  assert.doesNotMatch(c, /DMA_MuxChannelConfig\(3,/, 'never falls back to the bare number once the data names a macro');
});

test('each controller that owns a live request gets its OWN clock enabled once - never doubled, never the wrong one', () => {
  const e = withDmaMux();
  e.addDmaRequest('ADC1', '1');     // DMA1
  e.addDmaRequest('SPI1_TX', '2');  // DMA1 again - same controller, must not double the RCC call
  e.compute();
  const c = e.cSource();
  const hb = c.match(/RCC_HBPeriphClockCmd\(RCC_HBPeriph_DMA1, ENABLE\);/g) || [];
  assert.equal(hb.length, 1, 'DMA1 enabled exactly once, however many requests it carries');
  // DMA2 is not configured at all here, so it must not appear.
  assert.doesNotMatch(c, /DMA2/);
});

test('DMA2 (no codegen.periph_clock bit on this synthetic part) gets a NAMED TODO, not a silently wrong or missing clock enable', () => {
  const e = withDmaMux();
  e.addDmaRequest('ADC1', '3');   // DMA2
  e.compute();
  const c = e.cSource();
  assert.match(c, /TODO: DMA2 has no clock enable bit in codegen\.periph_clock/);
});

test('two requests on one GLOBAL channel is a hard conflict naming the right controller, even across two of them', () => {
  const e = withDmaMux();
  e.addDmaRequest('ADC1', '3');
  // setDmaRequest moves the SAME channel a second request already occupies -
  // exercised through the public API precisely like features.test.js's UI would.
  e.addDmaRequest('SPI1_TX', '4');
  e.setDmaRequest('SPI1_TX', { channel: '3' });
  const conflicts = e.dmaConflicts();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].channel, '3');
  assert.match(conflicts[0].text, /^DMA2 channel 3 is configured for/, 'names DMA2, not DMA1 or a bare "DMA"');
});

// PLANTED BREAK: the mechanism must fall back to a named TODO, never a call with a
// missing/garbage argument, when the data names a request's numeric mux ID but not
// the SDK function that would consume it - the same discipline every other codegen
// gap in this file already follows (a name nobody compiled is a guess).
test('a crossbar controller missing mux.sdk_call gets a named TODO, never a call to nothing', () => {
  const e = fresh();
  e.registerMcuFile(DMA_MUX_PART.replace(
    'mux:\n      base: 0\n      count: 2\n      sdk_call: DMA_MuxChannelConfig\n      requests: { ADC1: 5, SPI1_TX: 7 }',
    'mux:\n      base: 0\n      count: 2\n      requests: { ADC1: 5, SPI1_TX: 7 }'));  // DMA1's own sdk_call: dropped
  e.loadMcu('CH32V006-DMA-MUX');
  e.addDmaRequest('ADC1', '1');   // still legal - the catalogue entry is untouched
  e.compute();
  const c = e.cSource();
  assert.doesNotMatch(c, /DMA_MuxChannelConfig/, 'no call is emitted with a hole in it');
  assert.match(c, /TODO: ADC1 is on a DMAMUX controller, but dma\.mux is missing/);
  assert.match(c, /mux\.sdk_call — nothing routes this channel/);
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

// Round-3 P2 is "configuration must reach the C", and this is the one way it silently
// did not. Found by running the round-3 walkthrough §8.4 through the engine: it says
// "TIM1: prescaler and period set to something that is not the default" without
// switching TIM1 on, and those values went nowhere with nothing said.
test('parameters set on a switched-off peripheral are a warning, not silence', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.compute();
  assert.deepEqual(e.E.resources.issues.filter(i => i.kind === 'params'), [],
    'a peripheral at its defaults says nothing');

  e.setParam('TIM1', 'prescaler', 47);
  e.setParam('TIM1', 'period', 999);
  e.compute();
  const w = e.E.resources.issues.filter(i => i.kind === 'params');
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].owners, ['TIM1'], 'so the UI can link to the peripheral');
  assert.equal(w[0].severity, 'warning', 'nothing is wrong with the silicon; the user is not finished');
  assert.match(w[0].text, /Prescaler \(PSC\)/);
  assert.match(w[0].text, /switched off/);
  assert.equal(e.cSource().includes('TIM_TimeBaseInitStructure'), false, 'and it really does not reach the C');

  e.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
  e.compute();
  assert.deepEqual(e.E.resources.issues.filter(i => i.kind === 'params'), [],
    'switching it on clears the warning');
  assert.ok(e.cSource().includes('TIM_TimeBaseInitStructure.TIM_Prescaler = 47;'), 'and the value arrives');
});

test('a per-channel value on a switched-off peripheral is warned about too', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setChannelParam('TIM1', 2, 'pulse', 100);
  e.compute();
  const w = e.E.resources.issues.filter(i => i.kind === 'params');
  assert.equal(w.length, 1);
  assert.match(w[0].text, /channel 2/);
});

// =============================================================================
//  Round 4 P0b 7 and 9 — two families, two spellings, and the DATA says which
// =============================================================================

test('a remap with a macro is applied by the SDK call, not by a register word', () => {
  const e = fresh();
  if (!eng.MCU_FILES.CH32X035) return;
  e.loadMcu('CH32X035');
  e.setPackage('LQFP64M');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  const withMacro = e.M.peripherals.USART1.remaps.findIndex(r => r.macro);
  assert.ok(withMacro > 0, 'setup: this part gives its remaps macros');
  e.setRemap('USART1', withMacro);
  e.compute();

  const c = e.cSource();
  const macro = e.M.peripherals.USART1.remaps[withMacro].macro;
  assert.ok(c.includes(`${e.M.codegen.remap.fn}(${macro}, ${e.M.codegen.remap.enable});`),
    `the call the data names, with the macro the data names (${macro})`);
  assert.equal(/AFIO->PCFR1/.test(c), false,
    'and no hand-built mask: the macro packs the position and the value already');
});

test('the default mapping emits nothing, because there is no macro for it', () => {
  const e = fresh();
  if (!eng.MCU_FILES.CH32X035) return;
  e.loadMcu('CH32X035');
  e.setPackage('LQFP64M');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setRemap('USART1', 0);
  e.compute();
  assert.equal(e.M.peripherals.USART1.remaps[0].macro, undefined,
    'setup: ch32x035_gpio.h has no macro for the default mapping');
  const c = e.cSource();
  assert.equal(/GPIO_PinRemapConfig/.test(c), false, 'so nothing is applied, and no TODO either');
  assert.deepEqual(e.cComplaints(), []);
});

test('a peripheral that is switched off is not remapped', () => {
  const e = fresh();
  if (!eng.MCU_FILES.CH32X035) return;
  e.loadMcu('CH32X035');
  e.setPackage('LQFP64M');
  const i = e.M.peripherals.USART1.remaps.findIndex(r => r.macro);
  e.setRemap('USART1', i);                    // selected, but USART1 is off
  // a real IO pin elsewhere, so the GPIO section is generated at all
  const free = Object.keys(e.M.pins).find(p =>
    e.pinExists(p) && e.pinType(p) === 'io' && !e.compute().pins[e.canon(p)]);
  assert.ok(free, 'setup: found a free IO pin');
  e.assignSignal(free, { gpio: 'GPIO_Output' });
  e.compute();
  const c = e.cSource();
  assert.equal(/GPIO_PinRemapConfig\(/.test(c), false, 'no call for a peripheral nothing uses');
  assert.match(c, /USART1 selects .* but is switched off/, 'and the file says why');
});

test('the register-word family is untouched by any of this', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setRemap('USART1', 3);
  e.compute();
  const c = e.cSource();
  assert.match(c, /AFIO->PCFR1 = \(AFIO->PCFR1 & ~0x[0-9A-F]+U\) \| 0x[0-9A-F]+U;/);
  assert.equal(/GPIO_PinRemapConfig/.test(c), false, 'this part has no macros and needs none');
  assert.deepEqual(e.cComplaints(), []);
});

test('a peripheral applied by a macro is left out of the register word', () => {
  // A part could in principle carry both. Writing the same field twice - once by the
  // call and once in the word - is the bug this guards.
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-BOTHREMAPS
  inherits: CH32V006
codegen:
  remap:
    fn: GPIO_PinRemapConfig
    enable: ENABLE
peripherals:
  USART1:
    remaps:
      - { name: "000 Default", pins: { TX: PD5, RX: PD6 } }
      - { name: "001", macro: GPIO_Remap_USART1_Test, pins: { TX: PD0, RX: PD1 } }
`);
  e.loadMcu('CH32V006-BOTHREMAPS');
  e.setPackage('TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setRemap('USART1', 1);
  e.compute();
  const c = e.cSource();
  assert.ok(c.includes('GPIO_PinRemapConfig(GPIO_Remap_USART1_Test, ENABLE);'), 'the call is made');
  const word = /AFIO->PCFR1 = \(AFIO->PCFR1 & ~(0x[0-9A-F]+)U\)/.exec(c);
  if (word) {
    // USART1_RM is [9:6] on this part; the mask must not claim those bits any more
    assert.equal((parseInt(word[1], 16) >>> 6) & 0xF, 0,
      'the macro applies USART1, so the word must not write its field as well');
  }
});

test('a remap the data cannot apply is a TODO naming both ways of fixing it', () => {
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-NOREMAPWAY
  inherits: CH32V006
  remove: [codegen.remap]
`);
  e.loadMcu('CH32V006-NOREMAPWAY');
  e.setPackage('TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setRemap('USART1', 3);
  e.compute();
  const c = e.cSource();
  assert.match(c, /TODO: alternate function remap/);
  assert.match(c, /neither a `macro:` on the/);
  assert.match(c, /USART1: index 3/);
  assert.ok(e.cComplaints().some(x => x.kind === 'todo'));
});

// `remap_unwritable:` — main's P0, forced by SDMMC on CH32H417: a remap that is a REAL
// silicon choice (offered for planning) but that this part's generator has no way to
// write, permanently — not a gap "add a macro or a fields entry" can close. The generic
// TODO above gives exactly that (wrong, for this case) advice; this key replaces it with
// the actual citation instead of silence.
test('a remap the data says is permanently unwritable gets its own cited TODO, not the generic advice', () => {
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-UNWRITABLE-REMAP
  inherits: CH32V006
peripherals:
  TESTPERIPH:
    category: Connectivity
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: On, signals: [SIG] }
    remaps:
      - { name: "00 Default", pins: { SIG: PD5 } }
      - { name: "01", pins: { SIG: PD6 } }
    remap_unwritable: "AFIO_PCFR1.TESTPERIPH_RM[1:0] (RM 9.9.9) - codegen.remap.style: af has no per-peripheral field to write it on this part"
`);
  e.loadMcu('CH32V006-UNWRITABLE-REMAP');
  e.setPackage('TSSOP20');
  e.setSetting('TESTPERIPH', 'Mode', 'On');
  e.setRemap('TESTPERIPH', 1);
  e.compute();
  const c = e.cSource();
  assert.match(c, /TODO: alternate function remap\. Selected for pin planning/);
  assert.match(c, /not a gap to/);
  assert.match(c, /TESTPERIPH: index 1 — 01\. AFIO_PCFR1\.TESTPERIPH_RM\[1:0\] \(RM 9\.9\.9\)/,
    'the citation must reach the generated C verbatim, not be summarised away');
  assert.equal(/neither a `macro:` on the/.test(c), false,
    'the generic "add one or the other" advice must NOT also appear - it would be wrong advice here');
  assert.ok(e.cComplaints().some(x => x.kind === 'todo' && /alternate function remap\. Selected for pin planning/.test(x.text)),
    '--strict must see it: not invisible, and not an unexplained warning either');

  // Pin planning is untouched by any of this: the choice is a real, exportable pin -
  // the whole point of the P0 is that this and the C-generation gap are independent.
  assert.equal(e.compute().pins.PD6.label, 'TESTPERIPH_SIG', 'the chosen pin is claimed exactly like any other remap choice');
});

test('index 0 of an unwritable remap needs no citation - nothing to write, so no TODO', () => {
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-UNWRITABLE-REMAP-DEFAULT
  inherits: CH32V006
peripherals:
  TESTPERIPH:
    category: Connectivity
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: On, signals: [SIG] }
    remaps:
      - { name: "00 Default", pins: { SIG: PD5 } }
      - { name: "01", pins: { SIG: PD6 } }
    remap_unwritable: "AFIO_PCFR1.TESTPERIPH_RM[1:0] - not writable on this part"
`);
  e.loadMcu('CH32V006-UNWRITABLE-REMAP-DEFAULT');
  e.setPackage('TSSOP20');
  e.setSetting('TESTPERIPH', 'Mode', 'On');
  // remap stays at its default, index 0 - the reset value, nothing to write
  e.compute();
  const c = e.cSource();
  assert.equal(/TODO: alternate function remap/.test(c), false,
    'the default mapping needs no register write and must not manufacture a TODO for one');
  assert.equal(e.cComplaints().some(x => x.kind === 'todo' && /alternate function remap/.test(x.text)), false);
});

// ---- grouped NVIC vectors ----------------------------------------------------

test('many EXTI lines map to one vector, and the lookup goes line -> vector', () => {
  const e = fresh();
  const part = Object.keys(eng.MCU_FILES).find(n => {
    const g = fresh(); g.loadMcu(n);
    return g.nvicVectors().some(v => v.lines);
  });
  if (!part) return;                          // no bundled part groups its vectors yet
  e.loadMcu(part);
  const grouped = e.nvicVectors().filter(v => v.lines);
  assert.ok(grouped.length, `${part} groups its EXTI vectors`);
  for (const v of grouped) {
    assert.equal(v.lines.length, 2, 'lines: [first, last], inclusive');
    assert.ok(v.lines[0] <= v.lines[1]);
    assert.equal(e.nvicVectorForLine(v.lines[0]).name, v.name, `line ${v.lines[0]} -> ${v.name}`);
    assert.equal(e.nvicVectorForLine(v.lines[1]).name, v.name, `line ${v.lines[1]} -> ${v.name}`);
  }
  // the groups do not overlap, or a line would have two vectors
  for (let i = 0; i < grouped.length; i++) {
    for (let j = i + 1; j < grouped.length; j++) {
      const a = grouped[i].lines, b = grouped[j].lines;
      assert.ok(a[1] < b[0] || b[1] < a[0],
        `${grouped[i].name} and ${grouped[j].name} both claim a line`);
    }
  }
  const past = Math.max(...grouped.map(v => v.lines[1])) + 1;
  assert.equal(e.nvicVectorForLine(past), null, 'a line no group covers has no vector');
  assert.equal(e.nvicVectorForLine('nonsense'), null);
});

test('a part whose vectors are not grouped answers cleanly rather than throwing', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.assignSignal('PC3', { gpio: 'GPIO_EXTI' });
  e.compute();
  // CH32V006's EXTI7_0 covers eight lines but the data does not say so yet. Nothing is
  // inferred from the NAME, so the answer is "no grouping stated", not a guess.
  assert.deepEqual(e.extiVectorsNeeded(), []);
  assert.equal(e.nvicVectorForLine(3), null);
  assert.deepEqual(e.E.resources.issues.filter(i => i.kind === 'nvic'), []);
});

test('an external interrupt whose group vector is off is a warning, not silence', () => {
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-GROUPED
  inherits: CH32V006
nvic:
  vectors:
    - { name: EXTI7_0, vector: 20, irqn: EXTI7_0_IRQn, handler: EXTI7_0_IRQHandler, peripheral: EXTI, lines: [0, 7] }
`);
  e.loadMcu('CH32V006-GROUPED');
  e.setPackage('TSSOP20');
  e.assignSignal('PC3', { gpio: 'GPIO_EXTI' });
  e.compute();

  const need = e.extiVectorsNeeded();
  assert.equal(need.length, 1, 'one vector, however many lines');
  assert.equal(need[0].vector.name, 'EXTI7_0');
  assert.deepEqual(need[0].pins, ['PC3']);

  const w = e.E.resources.issues.filter(i => i.kind === 'nvic');
  assert.equal(w.length, 1);
  assert.match(w[0].text, /PC3 is an external interrupt but EXTI7_0 is not enabled/);
  assert.match(w[0].text, /enabling it once covers all of them/);

  // a second line in the same group is still one vector and still one warning
  e.assignSignal('PC5', { gpio: 'GPIO_EXTI' });
  e.compute();
  assert.equal(e.extiVectorsNeeded().length, 1, 'the group is already on the list');
  assert.equal(e.E.resources.issues.filter(i => i.kind === 'nvic').length, 1);

  e.setNvicVector('EXTI7_0', { enabled: true });
  e.compute();
  assert.deepEqual(e.E.resources.issues.filter(i => i.kind === 'nvic'), [],
    'enabling the group once clears it for every line in it');
});

// ---------------------------------------------------------------------------
//  "The user changed it" must mean a parameter the user could reach
//
//  `paramReachWarnings()` asks `paramValue() !== d.default`, and that question is only
//  meaningful for a row Parameter Settings actually draws. Two kinds are never drawn
//  and both answered "changed" until 2026-09-12 (AGENT-1, BOARD 20:49Z): a `const:`
//  member, whose `paramValue()` is `d.const` while `d.default` is `undefined`; and the
//  inapplicable half of a mutually-exclusive pair, counted once per alternative. On
//  CH32H417 that produced `ADC1 has Dual-ADC mode set` on a DISABLED ADC1 and
//  `SWPMI has 2 settings changed (Loopback, Loopback)` for one field - and `--strict`
//  exits 2 on a warning, so it failed the gate rather than merely reading oddly.
//
//  Both halves are here: the two kinds say nothing, and a parameter the user really did
//  change still warns, so the fix cannot be "stop warning".
const UNREACHABLE = `
mcu:
  name: CH32V006-REACH
  inherits: CH32V006
peripherals:
  OPAR:
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
      - { key: num, name: Which one, const: OPAR_2, struct: OPA_InitTypeDef, sdk_field: OPA_NUM }
      - key: gain
        name: Gain
        type: enum
        default: x1
        options: [{ name: x1 }, { name: x4 }]
      - key: loop_int
        name: Loopback
        type: enum
        default: "off"
        when: { Mode: Enabled }
        options: [{ name: "off" }, { name: "on" }]
`;

const reach = e => e.E.resources.issues.filter(i => i.kind === 'params');

test('a const: member of a switched-off peripheral is not "changed" - it cannot be', () => {
  const e = fresh('CH32V006');
  e.registerMcuFile(UNREACHABLE);
  e.loadMcu('CH32V006-REACH');
  e.compute();
  assert.equal(e.paramValue('OPAR', 'num'), 'OPAR_2', 'setup: paramValue returns the constant');
  assert.equal(e.paramDefs('OPAR').find(d => d.key === 'num').default, undefined,
    'setup: and the definition has no default, which is what compared unequal');
  assert.deepEqual(reach(e), [], 'a peripheral whose only non-default value is a constant says nothing');

  // the half that proves it did not just stop warning
  e.setParam('OPAR', 'gain', 'x4');
  e.compute();
  const w = reach(e);
  assert.equal(w.length, 1);
  assert.match(w[0].text, /Gain/);
  assert.doesNotMatch(w[0].text, /Which one/, 'and the constant is still not in the list');
});

test('the inapplicable half of a dependent pair is counted once, not once per alternative', () => {
  const e = fresh('CH32V006');
  e.registerMcuFile(UNREACHABLE);
  e.loadMcu('CH32V006-REACH');
  // `Loopback` only applies at Mode: Enabled, and this peripheral is at Mode: Disable -
  // so a value sitting in it is not a setting the user can see, let alone one they chose.
  e.S.periph.OPAR.params.loop_int = 'on';
  e.compute();
  assert.deepEqual(reach(e), [], 'a parameter whose dependency is unmet is not offered, so it is not "changed"');
  assert.equal(e.paramApplies('OPAR', e.paramDefs('OPAR').find(d => d.key === 'loop_int')), false,
    'setup: and paramApplies agrees it is not offered');
});
