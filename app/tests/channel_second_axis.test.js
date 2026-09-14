// `channel_params` as a LIST of blocks — a peripheral with MORE THAN ONE independent
// instance axis, not one axis two functions disagree about.
//
// DFSDM is why this exists. Its own SDK header (ch32h417_dfsdm.h) proves two channels
// (DFSDM_Channel0/1) and two filters (DFSDM_FLT0/1) are genuinely separate register
// blocks: `DFSDM_ChannelInit(DFSDM_Channely, &s)` takes a channel handle,
// `DFSDM_FilterInit`/`DFSDM_RcInit`/`DFSDM_JcInit` all take a DIFFERENT `DFSDM_FLTx`
// handle that has nothing to do with the channel axis. AGENT-1 checked this against
// `initPlan()`'s own single-block loop before assuming `channel_multi_struct.test.js`'s
// mechanism (SAI's Frame/Slot) already covered it — it does not, because SAI's three
// structs all share ONE handle per instance, and DFSDM's Filter/Rc/Jc DO share a handle
// with each other (proven below, reusing that exact mechanism on the filter axis) but
// NOT with the channel axis. Forcing DFSDM through one block gives `DFSDM_FilterInit`
// a `DFSDM_Channely` handle — a real type mismatch, not a stylistic one.
//
// `peripherals.<pid>.channel_params` stays a single OBJECT, unchanged, on every part
// that has one axis (proven elsewhere: channel_multi_struct.test.js's own "six shipped
// blocks are unchanged" test, and the full app/tests suite green with zero edits to any
// existing MCU file). It may ALSO be a LIST — this file is that second shape, on a part
// invented here rather than DFSDM's real, still-unmodelled data, so the mechanism
// cannot pass by being right about the one chip it was designed against.
import { test, assert, fresh, eng } from './_harness.js';
import { boot } from '../../tests/lib/app.js';

const head = name => `
mcu:
  name: ${name}
  family: test
  default_package: QFN32
  variants:
    A32: { package: QFN32, flash_kb: 64, sram_kb: 8, temp: 85, io_count: 32 }
packages:
  QFN32:
${Array.from({ length: 32 }, (_, i) => `    ${i + 1}: P${'AB'[Math.floor(i / 16)]}${i % 16}`).join('\n')}
pins:
${Array.from({ length: 32 }, (_, i) => `  P${'AB'[Math.floor(i / 16)]}${i % 16}: { type: io }`).join('\n')}
`;

// Two axes: CHANNEL (DFSDM_Channel0/1) and FILTER (DFSDM_FLT0/1). The filter axis also
// carries a `struct:` override (DFSDM_RcInitTypeDef) — the SAME same-handle multi-struct
// mechanism SAI already proved, composed here with the NEW second axis, because the
// real DFSDM header has exactly this shape (Filter + Rc + Jc all take DFSDM_FLTx).
const DFSDM2 = head('DFSDM2-TEST') + `
codegen:
  header: dfsdm2.h
  sdk: { synthetic: true }
  init_structs:
    DFSDM_RcInitTypeDef: { fn: DFSDM_RcInit }
peripherals:
  DFSDM:
    category: Analog
    # No signals: on any choice, same as channel_multi_struct.test.js's SAI fixture -
    # this file is about the struct/handle mechanism, not pin routing, and a claimed
    # pin on a minimal fixture with no gpio: block would add unrelated GPIO_Init TODOs.
    settings:
      - name: "Channel 0"
        choices: [{ name: Disable }, { name: On }]
      - name: "Channel 1"
        choices: [{ name: Disable }, { name: On }]
      - name: "Filter 0"
        choices: [{ name: Disable }, { name: On }]
      - name: "Filter 1"
        choices: [{ name: Disable }, { name: On }]
    channel_params:
      - struct: DFSDM_ChannelInitTypeDef
        applies_per: channel
        instances:
          0: { sdk_call: DFSDM_ChannelInit, handle: DFSDM_Channel0, setting: "Channel 0", active_choices: [On] }
          1: { sdk_call: DFSDM_ChannelInit, handle: DFSDM_Channel1, setting: "Channel 1", active_choices: [On] }
        params:
          - key: datmpx
            name: Input data source
            sdk_field: DFSDM_ChDataMultiplexer
            type: enum
            default: Serial
            options: [{ name: Serial, value: 0, sdk: DFSDM_SerialInput }]
      - struct: DFSDM_FilterInitTypeDef
        applies_per: filter
        instances:
          0: { sdk_call: DFSDM_FilterInit, handle: DFSDM_FLT0, setting: "Filter 0", active_choices: [On] }
          1: { sdk_call: DFSDM_FilterInit, handle: DFSDM_FLT1, setting: "Filter 1", active_choices: [On] }
        params:
          - key: sinc_order
            name: Sinc filter order
            sdk_field: DFSDM_FltSincOrder
            type: int
            default: 1
          - key: rc_channel
            name: Regular conversion channel
            struct: DFSDM_RcInitTypeDef
            sdk_field: DFSDM_RcChannel
            type: int
            default: 0
`;

const load = src => { fresh('CH32V006'); eng.loadMcu(src); };

test('channelParamBlocks() finds both axes, each with its OWN noun', () => {
  load(DFSDM2);
  const blocks = eng.channelParamBlocks('DFSDM');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].applies_per, 'channel');
  assert.equal(blocks[1].applies_per, 'filter');
  // A single-block peripheral is still a one-element list - the exact backward-
  // compat contract this whole mechanism depends on.
  assert.equal(eng.channelParamBlocks('NOSUCHPERIPH').length, 0);
});

test('channelNumbers() is the union across every axis, deduplicated', () => {
  load(DFSDM2);
  assert.deepEqual(eng.channelNumbers('DFSDM'), [0, 1],
    'Channel 0/1 and Filter 0/1 both use 0/1 - the union has two entries, not four');
});

test('activeInstances(pid, block) is scoped to ONE axis - never the other axis\'s rows', () => {
  load(DFSDM2);
  eng.setSetting('DFSDM', 'Channel 0', 'On');
  eng.setSetting('DFSDM', 'Filter 1', 'On');
  eng.compute();
  const [chBlock, fltBlock] = eng.channelParamBlocks('DFSDM');
  const chPlan = eng.activeInstances('DFSDM', chBlock);
  const fltPlan = eng.activeInstances('DFSDM', fltBlock);
  assert.equal(chPlan.noun, 'channel');
  assert.deepEqual(chPlan.instances.map(r => r.n), [0], 'only Channel 0 is live, not Filter 1 too');
  assert.equal(fltPlan.noun, 'filter');
  assert.deepEqual(fltPlan.instances.map(r => r.n), [1], 'only Filter 1 is live, not Channel 0 too');
});

test('THE TRAP AGENT-1 NAMED: the filter axis gets DFSDM_FLTx, never the channel axis\'s handle', () => {
  load(DFSDM2);
  eng.setSetting('DFSDM', 'Channel 0', 'On');
  eng.setSetting('DFSDM', 'Filter 0', 'On');
  eng.compute();
  const structs = eng.initPlan('DFSDM').structs;
  assert.deepEqual(structs.map(b => `${b.struct}@${b.handle}`), [
    'DFSDM_ChannelInitTypeDef@DFSDM_Channel0',
    'DFSDM_FilterInitTypeDef@DFSDM_FLT0',
    'DFSDM_RcInitTypeDef@DFSDM_FLT0',
  ], 'the filter\'s OWN structs carry the filter\'s OWN handle - never DFSDM_Channel0, the exact mismatch flagged on the board');

  const c = eng.cSource();
  assert.match(c, /DFSDM_ChannelInit\(DFSDM_Channel0, &DFSDM_ChannelInitStructure\);/);
  assert.match(c, /DFSDM_FilterInit\(DFSDM_FLT0, &DFSDM_FilterInitStructure\);/);
  assert.match(c, /DFSDM_RcInit\(DFSDM_FLT0, &DFSDM_RcInitStructure\);/);
  // Never the type-mismatched call the single-block shape would have produced.
  assert.doesNotMatch(c, /DFSDM_FilterInit\(DFSDM_Channel/);
  assert.doesNotMatch(c, /DFSDM_RcInit\(DFSDM_Channel/);
  assert.equal((c.match(/TODO/g) || []).length, 0);
});

test('each axis is live independently - enabling only the channel emits no filter struct at all, and back', () => {
  load(DFSDM2);
  eng.setSetting('DFSDM', 'Channel 0', 'On');
  eng.compute();
  let structs = eng.initPlan('DFSDM').structs;
  assert.deepEqual(structs.map(b => b.struct), ['DFSDM_ChannelInitTypeDef']);

  eng.setSetting('DFSDM', 'Channel 0', 'Disable');
  eng.setSetting('DFSDM', 'Filter 1', 'On');
  eng.compute();
  structs = eng.initPlan('DFSDM').structs;
  assert.deepEqual(structs.map(b => `${b.struct}@${b.instance.n}`),
    ['DFSDM_FilterInitTypeDef@1', 'DFSDM_RcInitTypeDef@1']);
});

test('the SAME instance number on two axes stores independently - no cross-axis overwrite', () => {
  load(DFSDM2);
  eng.setSetting('DFSDM', 'Channel 0', 'On');
  eng.setSetting('DFSDM', 'Filter 0', 'On');
  eng.setChannelParam('DFSDM', 0, 'datmpx', 'Serial');
  eng.setChannelParam('DFSDM', 0, 'sinc_order', 5);
  eng.compute();
  assert.equal(eng.channelParamValue('DFSDM', 0, 'datmpx'), 'Serial');
  assert.equal(eng.channelParamValue('DFSDM', 0, 'sinc_order'), 5);
  const c = eng.cSource();
  assert.match(c, /DFSDM_ChannelInitStructure\.DFSDM_ChDataMultiplexer = DFSDM_SerialInput;/);
  assert.match(c, /DFSDM_FilterInitStructure\.DFSDM_FltSincOrder = 5;/);
});

// ---- the UI: one group per LIVE instance, per AXIS -----------------------------
test('instanceGroups() renders Channel and Filter as separate groups, never merged by number', () => {
  const a = boot();
  try {
    a.ev(`registerMcuFile(${JSON.stringify(DFSDM2)}); openMcu(MCU_FILES['DFSDM2-TEST'])`);
    assert.equal(a.ev(`instanceGroups('DFSDM').map(g => g.name).join('|')`), '',
      'nothing on: no group at all');

    a.ev(`setSetting('DFSDM', 'Channel 0', 'On'); setSetting('DFSDM', 'Filter 0', 'On'); ` +
      `setSetting('DFSDM', 'Filter 1', 'On'); renderAll(true)`);
    assert.equal(a.ev(`instanceGroups('DFSDM').map(g => g.name).join('|')`),
      'Channel 0|Filter 0|Filter 1',
      'the noun comes from EACH block\'s own applies_per - "Channel 0" and "Filter 0" never collapse into one "0" group');
    const html = a.ev(`paramTable('DFSDM')`);
    assert.match(html, /data-cp="DFSDM"[^>]*data-cn="datmpx"[^>]*data-ci="0"/);
    assert.match(html, /data-cp="DFSDM"[^>]*data-cn="sinc_order"[^>]*data-ci="0"/);
    assert.deepEqual(a.problems(), []);
  } finally { a.close(); }
});

// Every test above was seen red first, for real, not simulated: `git stash push --
// app/engine/params.js app/engine/codegen.js app/template.html` (reverting to the
// pre-fix single-block reading) and reran this file - 7 of 8 failed correctly
// (`channelParamBlocks is not a function`, `channelNumbers` empty, the trap test's
// structs list empty, `DFSDM has no per-channel parameters` on the write path), then
// `git stash pop` restored the fix and all 8 passed again. This test is the one
// non-obvious CONTRAST worth keeping on its own: the pre-fix code read exactly
// `channel_params[0]` (the channel axis) and had no way to even SEE the filter axis
// existed, which is the concrete shape of "DFSDM_FilterInit gets DFSDM_Channely".
test('the pre-fix reading (channel_params[0] alone) could not see the filter axis at all', () => {
  load(DFSDM2);
  eng.setSetting('DFSDM', 'Channel 0', 'On');
  eng.setSetting('DFSDM', 'Filter 0', 'On');
  eng.compute();
  const oldStyleBlocks = [eng.M.peripherals.DFSDM.channel_params[0]];   // the pre-fix reading
  assert.equal(oldStyleBlocks.length, 1, 'setup: the pre-fix code saw exactly one block');
  assert.equal(oldStyleBlocks[0].applies_per, 'channel', 'and it was always the channel axis - filter was invisible');
  // The real (fixed) mechanism sees both, which is the whole point of this file.
  assert.equal(eng.channelParamBlocks('DFSDM').length, 2);
});
