// One init struct, applied once PER INSTANCE — and the two halves that can vary.
//
// `channel_params` was written for `TIM_OCInitTypeDef`: a timer has one time base and up
// to four independent compare units, so the struct is filled once per CHANNEL and applied
// by one of FOUR functions — `TIM_OC1Init` … `TIM_OC4Init` — each taking the peripheral's
// own handle. CH32H417's LTDC is the same problem with the two halves swapped: ONE
// function applies the struct, `LTDC_LayerInit(LTDC_Layer_TypeDef*, LTDC_Layer_InitTypeDef*)`
// (`data/sources/H417/Evt/EXAM/SRC/Peripheral/inc/ch32h417_ltdc.h:225`), and what changes
// per instance is the HANDLE it is given — `LTDC_Layer1` / `LTDC_Layer2`, which are
// `((LTDC_Layer_TypeDef *) LTDC_L1_BASE)` and `LTDC_L2_BASE` at `ch32h417.h:1770-1771`.
//
// `codegen.init_structs` maps a struct to ONE function and `codegen.periph_handle` maps a
// peripheral to ONE handle, so neither can express either case. The function and the
// handle vary independently, so `instances:` names both per instance; and because that
// subsumes `sdk_calls:` + `channels:`, this is the OLD mechanism generalised rather than a
// second one beside it. The regression half — the old spelling still reads — is at the
// bottom of this file and matters more than the new half.
//
// The parts here are invented rather than taken from data/mcus/, so the mechanism cannot
// pass by being right about the one chip it was designed against.
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

const tail = `
codegen:
  header: inst.h
  sdk: { synthetic: true }
  periph_handle:
    DISPLAY: DISPLAY
    COUNTER: COUNTER
  init_structs:
    GPIO_InitTypeDef: { fn: GPIO_Init }
gpio:
  modes:
    - { name: Output Push Pull, macro: GPIO_Mode_Out_PP }
  input_modes:
    - { name: No pull, macro: GPIO_Mode_IN_FLOATING }
`;

// ONE function, a DIFFERENT handle per instance — the LTDC layer shape.
const LAYERS = head('INST-LAYERS') + `
peripherals:
  DISPLAY:
    category: Multimedia
    settings:
      - name: Layer 1
        choices: [{ name: 'Off' }, { name: 'On' }]
      - name: Layer 2
        choices: [{ name: 'Off' }, { name: 'On' }]
    channel_params:
      struct: LTDC_Layer_InitTypeDef
      applies_per: layer
      instances:
        1: { sdk_call: LTDC_LayerInit, handle: LTDC_Layer1, setting: Layer 1, active_choices: ['On'] }
        2: { sdk_call: LTDC_LayerInit, handle: LTDC_Layer2, setting: Layer 2, active_choices: ['On'] }
      params:
        - key: pf
          name: Pixel format
          sdk_field: LTDC_PixelFormat
          type: enum
          default: RGB565
          options:
            - { name: ARGB8888, value: 0, sdk: LTDC_Pixelformat_ARGB8888 }
            - { name: RGB565,   value: 2, sdk: LTDC_Pixelformat_RGB565 }
            - { name: L8,       value: 5, sdk: LTDC_Pixelformat_L8 }
        - key: alpha
          name: Constant alpha
          sdk_field: LTDC_ConstantAlpha
          type: int
          default: 255
` + tail;

// A DIFFERENT function per instance, the PERIPHERAL's handle — the timer channel shape,
// written in the new spelling. Both shapes through one mechanism is the whole claim.
const CHANNELS = head('INST-CHANNELS') + `
peripherals:
  COUNTER:
    category: Timers
    settings:
      - name: Channel1
        choices: [{ name: Disabled }, { name: PWM }, { name: Capture }]
      - name: Channel2
        choices: [{ name: Disabled }, { name: PWM }, { name: Capture }]
    channel_params:
      struct: OC_InitTypeDef
      applies_per: channel
      instances:
        1: { sdk_call: OC1Init, setting: Channel1, active_choices: [PWM] }
        2: { sdk_call: OC2Init, setting: Channel2, active_choices: [PWM] }
      params:
        - key: mode
          name: Output mode
          sdk_field: OCMode
          type: enum
          default: PWM1
          options: [{ name: PWM1, value: 6, sdk: OCMode_PWM1 }]
` + tail;

const load = src => { fresh('CH32V006'); eng.loadMcu(src); };

// ---- the four questions the shape has to answer -------------------------------

test('the data says which instances exist, and it is not read off a display name', () => {
  load(LAYERS);
  assert.deepEqual(eng.paramInstances('DISPLAY').map(r => r.n), [1, 2]);
  assert.equal(eng.instanceNoun('DISPLAY'), 'layer', 'the noun comes from applies_per');
  assert.equal(eng.instanceNoun('COUNTER'), 'channel', 'and defaults to channel');
});

test('which SETTING decides an instance is stated, so a live one is knowable', () => {
  load(LAYERS);
  // Neither layer on: nothing is emitted, and that is not a gap.
  assert.deepEqual(eng.activeInstances('DISPLAY').instances, []);
  assert.equal(eng.activeInstances('DISPLAY').missing, null);
  assert.equal(eng.activeInstances('DISPLAY').note, null,
    'a block that DOES name its settings has nothing to report');

  eng.setSetting('DISPLAY', 'Layer 2', 'On');
  assert.deepEqual(eng.activeInstances('DISPLAY').instances.map(r => r.n), [2],
    'only the layer whose setting is on');
});

test('each instance passes its OWN handle, and one function serves them all', () => {
  load(LAYERS);
  eng.setSetting('DISPLAY', 'Layer 1', 'On');
  eng.setSetting('DISPLAY', 'Layer 2', 'On');
  eng.compute();
  const blocks = eng.initPlan('DISPLAY').structs;
  assert.equal(blocks.length, 2, 'one block per live layer');
  assert.deepEqual(blocks.map(b => [b.fn, b.handle]),
    [['LTDC_LayerInit', 'LTDC_Layer1'], ['LTDC_LayerInit', 'LTDC_Layer2']]);
  // The peripheral's own handle is DISPLAY; neither block used it. That is the half
  // `codegen.periph_handle` could not express.
  assert.equal(eng.initPlan('DISPLAY').handle, 'DISPLAY');
});

test('the emitted C is one LTDC_LayerInit per layer, with the layer as the argument', () => {
  load(LAYERS);
  eng.setSetting('DISPLAY', 'Layer 1', 'On');
  eng.setSetting('DISPLAY', 'Layer 2', 'On');
  eng.setChannelParam('DISPLAY', 2, 'pf', 'L8');
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /LTDC_Layer_InitTypeDef LTDC_Layer_InitStructure = \{0\};/);
  assert.match(c, /LTDC_LayerInit\(LTDC_Layer1, &LTDC_Layer_InitStructure\);/);
  assert.match(c, /LTDC_LayerInit\(LTDC_Layer2, &LTDC_Layer_InitStructure\);/);
  // Per-instance VALUES, not one struct copied twice - layer 2 was given a different
  // pixel format and it is layer 2's line that changed.
  assert.match(c, /LTDC_Layer_InitStructure\.LTDC_PixelFormat = LTDC_Pixelformat_RGB565;/);
  assert.match(c, /LTDC_Layer_InitStructure\.LTDC_PixelFormat = LTDC_Pixelformat_L8;/);
  assert.match(c, /LTDC_Layer_InitStructure\.LTDC_ConstantAlpha = 255;/);
  // Two identical-looking scopes need to say which is which.
  assert.match(c, /\/\* DISPLAY layer 1 \*\//);
  assert.match(c, /\/\* DISPLAY layer 2 \*\//);
  assert.equal((c.match(/TODO/g) || []).length, 0, 'and nothing is missing');
});

test('the other half of the same mechanism: a function per instance, one handle', () => {
  load(CHANNELS);
  eng.setSetting('COUNTER', 'Channel1', 'PWM');
  eng.setSetting('COUNTER', 'Channel2', 'Capture');   // not an output compare
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /OC1Init\(COUNTER, &OC_InitStructure\);/,
    'the function varies and the PERIPHERAL handle is used, because no instance names one');
  assert.doesNotMatch(c, /OC2Init/, 'an input-capture channel is not an output compare');
  assert.equal((c.match(/TODO/g) || []).length, 0);
});

// ---- what it refuses to guess -------------------------------------------------

test('an instance with no sdk_call is a TODO, not a function name pasted from a number', () => {
  // `OC3Init` is exactly what a pattern would produce and it may not exist. Deriving a
  // function name from a number is the same class of guess as deriving one from a struct
  // name, which this generator already refuses to make (data/FORMAT.md).
  load(CHANNELS.replace("        2: { sdk_call: OC2Init, setting: Channel2, active_choices: [PWM] }",
    "        2: { setting: Channel2, active_choices: [PWM] }"));
  eng.setSetting('COUNTER', 'Channel2', 'PWM');
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /TODO: channel_params names no sdk_call for channel 2/);
  assert.match(c, /does not paste a function name together from a number/);
  assert.doesNotMatch(c, /OC2Init/);
});

test('a HALF-described map is a TODO — the instance it left out never initialises', () => {
  // The failure mode this catches is invisible by construction: the generated file is
  // full of inits for the siblings, so the count looks right and one instance is simply
  // absent. No shipped part is in this state.
  load(LAYERS.replace("        2: { sdk_call: LTDC_LayerInit, handle: LTDC_Layer2, setting: Layer 2, active_choices: ['On'] }",
    "        2: { sdk_call: LTDC_LayerInit, handle: LTDC_Layer2 }"));
  eng.setSetting('DISPLAY', 'Layer 1', 'On');
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /TODO: DISPLAY\.channel_params names no setting for layer 2/);
  assert.match(c, /while its siblings are/);
  assert.match(c, /LTDC_LayerInit\(LTDC_Layer1, /, 'and layer 1 is still emitted');
});

test('a member with no sdk_field is named, not dropped', () => {
  load(LAYERS.replace('          sdk_field: LTDC_ConstantAlpha\n', ''));
  eng.setSetting('DISPLAY', 'Layer 1', 'On');
  eng.compute();
  assert.match(eng.cSource(), /TODO: Constant alpha: channel_params gives no sdk_field:/);
});

// ---- the regression half, and it is the one that matters ----------------------

test('the OLD spelling still reads, and the six shipped blocks are unchanged', () => {
  // `sdk_calls: { n: fn }` beside `channels: { n: { setting, output_choices } }` must
  // normalise to exactly the rows `instances:` produces. Every shipped channel_params
  // block is in the old spelling, so this is what keeps them working.
  // Standalone rather than `inherits: CH32V006`: a child MERGES the parent's
  // `channel_params`, so inheriting would fold the parent's channels 3 and 4 in and this
  // test would be measuring the inheritance rather than the spelling. (That merge is
  // correct, and it is what makes the half-described case above reachable from real data.)
  fresh('CH32V006');
  eng.loadMcu(head('INST-OLDSPELLING') + `
peripherals:
  TIM1:
    category: Timers
    settings:
      - name: Channel1
        choices: [{ name: Disabled }, { name: PWM Generation CH1 }]
      - name: Channel2
        choices: [{ name: Disabled }, { name: PWM Generation CH2 }]
    channel_params:
      struct: TIM_OCInitTypeDef
      applies_per: channel
      sdk_calls: { 1: TIM_OC1Init, 2: TIM_OC2Init }
      channels:
        1: { setting: Channel1, output_choices: [PWM Generation CH1] }
        2: { setting: Channel2, output_choices: [PWM Generation CH2] }
      params:
        - { key: ocmode, name: Mode, sdk_field: TIM_OCMode, type: enum, default: PWM1,
            options: [{ name: PWM1, value: 6, sdk: TIM_OCMode_PWM1 }] }
` + tail.replace('    DISPLAY: DISPLAY', '    TIM1: TIM1'));
  assert.deepEqual(eng.paramInstances('TIM1'), [
    { n: 1, fn: 'TIM_OC1Init', handle: null, setting: 'Channel1', activeChoices: ['PWM Generation CH1'] },
    { n: 2, fn: 'TIM_OC2Init', handle: null, setting: 'Channel2', activeChoices: ['PWM Generation CH2'] },
  ], 'two parallel maps normalise into the rows the one map produces');
  eng.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
  eng.compute();
  assert.deepEqual(eng.activeChannels('TIM1'), { channels: [1], missing: null },
    'activeChannels keeps its old contract on top of the new rows');
  assert.match(eng.cSource(), /TIM_OC1Init\(TIM1, &TIM_OCInitStructure\);/);
});

test('a part whose blocks name no setting at all is UNCHANGED, and says why in a note', () => {
  // Every shipped `channel_params` is in this state (E2). Before the per-instance
  // emitter existed the generated C said nothing whatever about these structs, so the
  // report is a note rather than a TODO - spelling it TODO would turn a pre-existing,
  // already-tracked data gap into four red fixtures on another agent's gate.
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
  e.compute();
  const plan = e.activeInstances('TIM1');
  assert.deepEqual(plan.instances, []);
  assert.equal(plan.missing, null, 'not a TODO');
  assert.match(plan.note, /names no setting for any channel/);
  assert.match(plan.note, /TASKS\.md E2/);
  const c = e.cSource();
  assert.doesNotMatch(c, /TIM_OC1Init/, 'nothing is emitted for a channel nobody can identify');
  assert.equal((c.match(/TODO/g) || []).length, 0, 'and the strict gate stays clean');
});

test('a peripheral with no channel_params is untouched by any of this', () => {
  // The rule the whole mechanism has to obey: inert on data that does not use it.
  for (const name of ['CH32V005', 'CH32V006']) {
    const e = fresh(name);
    assert.deepEqual(e.paramInstances('USART1'), []);
    assert.deepEqual(e.activeInstances('USART1'), { instances: [], missing: null, noun: 'channel' });
    assert.deepEqual(e.activeChannels('USART1'), { channels: [], missing: null });
    e.compute();
    assert.deepEqual(e.initPlan('USART1').structs.filter(b => b.instance), [],
      `${name}: USART1 has no per-instance block`);
  }
});

test('a per-instance value survives save -> close -> open', () => {
  // `.wchproj` already carried `channel_params` per peripheral, so this is a check that
  // the new spelling did not move the STORE - the round-trip is a standing DONE line and
  // a mechanism whose values do not survive a save is not finished.
  load(LAYERS);
  eng.setSetting('DISPLAY', 'Layer 1', 'On');
  eng.setSetting('DISPLAY', 'Layer 2', 'On');
  eng.setChannelParam('DISPLAY', 2, 'pf', 'L8');
  eng.compute();
  const saved = eng.projectObject();
  const before = eng.cSource();

  load(LAYERS);                                   // a fresh engine, nothing configured
  assert.deepEqual(eng.activeInstances('DISPLAY').instances, [], 'setup: really fresh');
  eng.projectApply(saved);
  eng.compute();
  assert.equal(eng.channelParamValue('DISPLAY', 2, 'pf'), 'L8');
  assert.equal(eng.channelParamValue('DISPLAY', 1, 'pf'), 'RGB565');
  assert.equal(eng.cSource(), before, 'and regenerating is byte-identical');
});

// ---- the editors, in the page -------------------------------------------------

test('the Parameter Settings tab grows one band per LIVE instance, named from the data', () => {
  const a = boot();
  try {
    a.ev(`registerMcuFile(${JSON.stringify(LAYERS)}); openMcu(MCU_FILES['INST-LAYERS'])`);
    // Nothing on: no band, because an instance with no struct emitted has no editor.
    // `.join()` inside the page, not deepEqual across it: an array that crosses the
    // jsdom realm boundary is a different Array constructor and assert/strict rejects it.
    assert.equal(a.ev(`instanceGroups('DISPLAY').map(g => g.name).join('|')`), '');

    a.ev(`setSetting('DISPLAY', 'Layer 1', 'On'); setSetting('DISPLAY', 'Layer 2', 'On'); renderAll(true)`);
    assert.equal(a.ev(`instanceGroups('DISPLAY').map(g => g.name).join('|')`), 'Layer 1|Layer 2',
      'the noun comes from applies_per - "Channel 1" would be wrong for a layer');
    const html = a.ev(`paramTable('DISPLAY')`);
    assert.match(html, /data-cp="DISPLAY"[^>]*data-cn="pf"[^>]*data-ci="1"/);
    assert.match(html, /data-ci="2"/);
    assert.deepEqual(a.problems(), []);
  } finally { a.close(); }
});

test('driving a per-instance editor changes that instance and only that instance', () => {
  const a = boot();
  try {
    a.ev(`registerMcuFile(${JSON.stringify(LAYERS)}); openMcu(MCU_FILES['INST-LAYERS'])`);
    a.ev(`setSetting('DISPLAY', 'Layer 1', 'On'); setSetting('DISPLAY', 'Layer 2', 'On')`);
    a.ev(`selectPeripheral('DISPLAY'); renderAll(true)`);
    const changed = a.ev(`(() => {
      const tab = document.querySelector('[data-ctab="param"]'); if (tab) tab.click();
      const s = document.querySelector('#cbody select[data-cp="DISPLAY"][data-ci="2"]');
      if (!s) return 'no editor';
      s.value = 'L8'; s.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    assert.equal(changed, 'ok', 'the editor is in the page, not only in the returned HTML');
    assert.equal(a.ev(`channelParamValue('DISPLAY', 2, 'pf')`), 'L8');
    assert.equal(a.ev(`channelParamValue('DISPLAY', 1, 'pf')`), 'RGB565', 'layer 1 untouched');
    const c = a.ev('cSource()');
    assert.match(c, /LTDC_Pixelformat_L8;[^]*LTDC_LayerInit\(LTDC_Layer2,/);
    assert.deepEqual(a.problems(), []);
  } finally { a.close(); }
});
