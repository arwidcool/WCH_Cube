// The System-Core "every channel at once" DMA overview table, generalised to a
// multi-controller crossbar part - held (agents/STATUS.md, main's decision
// 2026-09-14) until AGENT-1's real two-controller DMA data landed, so this is checked
// against CH32H417's REAL shipped data, not only a synthetic fixture (main's explicit
// instruction) - a mechanism proven only on an invented part cannot tell "it works" from
// "it works on data nobody has to get right".
//
// The honest-default fact this table exists to surface: DMAMUX's CHANNELx_MUX field is
// 0-INDEXED (RM:13209-13228, "0000000: DMA request input 1"; ch32h417_dma.c:625 writes
// `DMA_Requestx - 1`), so an UNCONFIGURED channel's register reads its reset value, 0 -
// which decodes to request ID 1, not "no request routed". CH32H417's own catalogue
// (data/mcus/CH32H417.yaml) gives ID 1 to TIM1_CH1, so every unconfigured channel on
// EITHER controller (DMA1 and DMA2 share one catalogue, RM ch.10) reads as TIM1_CH1 -
// live, if TIM1 happens to be switched on, exactly the window AGENT-1's ordering
// analysis (board 2026-09-14) already found dangerous on the vendor's own EVT examples.
import { test, assert, fresh, eng } from './_harness.js';
import { boot } from '../../tests/lib/app.js';

test('dmaMuxChannels() on the real CH32H417 data: every unconfigured channel reads the crossbar\'s honest reset default', () => {
  const e = fresh('CH32H417', 'QFN128');
  e.compute();
  const [dma1, dma2] = e.dmaControllers();
  assert.equal(dma1.controller, 'DMA1');
  assert.equal(dma2.controller, 'DMA2');

  const ch1 = e.dmaMuxChannels(dma1);
  assert.equal(ch1.length, 8, 'DMA1 owns global channels 1-8');
  assert.deepEqual(ch1.map(r => r.channel), ['1', '2', '3', '4', '5', '6', '7', '8']);
  for (const r of ch1) {
    assert.deepEqual(r.configured, [], 'setup: nothing configured yet');
    assert.equal(r.resetRequest, 'TIM1_CH1', 'RM Table 10-2 request ID 1');
    assert.equal(r.resetOwner, 'TIM1');
    assert.equal(r.resetLive, false, 'TIM1 is off by default');
  }

  const ch2 = e.dmaMuxChannels(dma2);
  assert.equal(ch2.length, 8, 'DMA2 owns global channels 9-16');
  assert.deepEqual(ch2.map(r => r.channel), ['9', '10', '11', '12', '13', '14', '15', '16']);
  // The SAME catalogue, not a per-controller one - the RM states one shared request
  // list for the whole crossbar (CH32H417.yaml's own comment on the mux: block).
  assert.equal(ch2[0].resetRequest, 'TIM1_CH1', 'DMA2\'s channels reset to the SAME request ID 1 as DMA1\'s');
});

test('resetLive turns on when TIM1_CH1\'s own owner is actually switched on - the live, unconfigured-route hazard', () => {
  const e = fresh('CH32H417', 'QFN128');
  e.compute();
  assert.equal(e.dmaMuxChannels(e.dmaControllers()[0])[0].resetLive, false);

  e.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
  e.compute();
  assert.equal(e.isEnabled('TIM1'), true, 'setup: TIM1 is now on');
  assert.equal(e.dmaMuxChannels(e.dmaControllers()[0])[0].resetLive, true,
    'channel 1 is unconfigured AND its reset default\'s owner is live - the exact honest fact main asked to see, not hidden as an empty cell');
  // Every OTHER unconfigured channel on this controller shares the same fact - it is
  // not special to channel 1.
  assert.ok(e.dmaMuxChannels(e.dmaControllers()[0]).every(r => r.resetLive === true));
});

test('configuring a real request on a channel replaces the reset-default reading with what is actually there', () => {
  const e = fresh('CH32H417', 'QFN128');
  e.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');   // resetOwner live, to prove configuring still wins
  e.addDmaRequest('USART1_TX', '1');
  e.compute();
  const row = e.dmaMuxChannels(e.dmaControllers()[0]).find(r => r.channel === '1');
  assert.equal(row.configured.length, 1);
  assert.equal(row.configured[0].request, 'USART1_TX');
  assert.equal(row.configured[0].owner, 'USART1');
  // resetRequest/resetOwner/resetLive are still reported (the row carries both facts),
  // but the UI (below) must show the CONFIGURED request, never both at once as if the
  // channel carried two things.
  assert.equal(row.resetRequest, 'TIM1_CH1');
});

test('a part with a single, fixed-table DMA controller is untouched: dmaMuxChannels() returns nothing for it', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.compute();
  assert.deepEqual(e.dmaMuxChannels(e.dmaControllers()[0]), [],
    'CH32V006\'s one controller has requests:, not mux: - the crossbar function has nothing to say about it');
});

// ---- the UI: real browser (jsdom), real data, both controllers ------------------
test('the DMA overview renders honestly for BOTH real controllers, and updates live', () => {
  const a = boot();
  try {
    a.ev(`openMcu(MCU_FILES['CH32H417']); setPackage('QFN128')`);
    a.ev(`selectPeripheral('DMA1'); renderAll(true)`);
    let html = a.ev(`dmaChannelTable(dmaControllers().find(d => d.controller === 'DMA1'))`);
    assert.match(html, /DMA1 channels/);
    assert.match(html, /TIM1_CH1/, 'the reset default is named, not left blank');
    assert.match(html, /reset default/, 'and labelled as a default, not as a configured route');
    assert.doesNotMatch(html, /class="dreq unrouted on"/, 'TIM1 is off: no channel is falsely flagged live');

    a.ev(`setSetting('TIM1', 'Channel1', 'PWM Generation CH1'); renderAll(true)`);
    html = a.ev(`dmaChannelTable(dmaControllers().find(d => d.controller === 'DMA1'))`);
    assert.match(html, /reset default, LIVE/, 'now TIM1 is on: the unconfigured channel says so honestly');

    // DMA2 is a SEPARATE controller with its own page and its own table - not a copy
    // of DMA1's, and not merged into one combined table.
    a.ev(`selectPeripheral('DMA2'); renderAll(true)`);
    const html2 = a.ev(`dmaChannelTable(dmaControllers().find(d => d.controller === 'DMA2'))`);
    assert.match(html2, /DMA2 channels/);
    assert.match(html2, /<td>9<\/td>/, 'DMA2 starts at global channel 9, not 1 again');

    // Configuring a real request makes it the shown route, not the default.
    a.ev(`addDmaRequest('USART1_TX', '1')`);
    a.ev(`selectPeripheral('DMA1'); renderAll(true)`);
    const html3 = a.ev(`dmaChannelTable(dmaControllers().find(d => d.controller === 'DMA1'))`);
    assert.match(html3, /<td>1<\/td><td><span class="dreq used"[^]*USART1_TX/);
    assert.deepEqual(a.problems(), []);
  } finally { a.close(); }
});
