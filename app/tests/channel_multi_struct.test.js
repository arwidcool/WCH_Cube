// `channel_params` filling MORE THAN ONE struct per instance. SAI's own EVT example
// calls `SAI_Init`, `SAI_FrameInit` and `SAI_SlotInit` for a single block
// (`SAI1_Block_A` / `SAI1_Block_B`, `ch32h417.h:1775-1776`) - three struct types, each
// taken directly by its own SDK function, sharing one instance's handle. SERDES has the
// same two-block shape (AGENT-1, `agents/BOARD.md`, manager relay 2026-09-13).
//
// This is NOT `embed:` (codegen.js, above `initPlan()`): `embed:` is for a struct
// reached ONLY through a pointer inside another struct, with no function of its own.
// Here all three structs stand on their own, each with its own `*_Init()` call — they
// simply share which block they belong to.
//
// No new schema: a `channel_params.params:` ROW may carry `struct:` exactly like an
// ordinary `params:` row can (TIM1's deadtime → `TIM_BDTRInitTypeDef`, one level up).
// A row naming a struct OTHER than the block's own gets its own block, applied by
// `codegen.init_structs.<that struct>.fn` — the SAME global table every non-channel
// struct already uses — because unlike the primary struct's function (which may vary
// PER INSTANCE, `TIM_OC1Init`..`TIM_OC4Init`), a secondary struct's function does not:
// `SAI_FrameInit` is `SAI_FrameInit` on Block A and on Block B, only the HANDLE varies,
// and that is resolved the exact same way the primary struct's already is.
import { test, assert, fresh, eng } from './_harness.js';

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

// The shape: ONE primary struct (SAI_InitTypeDef, applied via the instance's own
// sdk_call — unchanged mechanism), TWO extra structs reached by giving their params
// `struct:` and giving THAT struct an `fn:` in codegen.init_structs.
const SAI = head('SAI-MULTI') + `
codegen:
  header: sai.h
  sdk: { synthetic: true }
  init_structs:
    SAI_FrameInitTypeDef: { fn: SAI_FrameInit }
    SAI_SlotInitTypeDef: { fn: SAI_SlotInit }
peripherals:
  SAI:
    category: Multimedia
    settings:
      - name: Block A
        choices: [{ name: Disabled }, { name: Enabled }]
      - name: Block B
        choices: [{ name: Disabled }, { name: Enabled }]
    channel_params:
      struct: SAI_InitTypeDef
      applies_per: block
      instances:
        1: { sdk_call: SAI_Init, handle: SAI1_Block_A, setting: Block A, active_choices: [Enabled] }
        2: { sdk_call: SAI_Init, handle: SAI1_Block_B, setting: Block B, active_choices: [Enabled] }
      params:
        - key: mode
          name: Audio mode
          sdk_field: SAI_AudioMode
          type: enum
          default: Master TX
          options: [{ name: Master TX, value: 0, sdk: SAI_Mode_MasterTx }]
        - key: frame_length
          name: Frame length
          struct: SAI_FrameInitTypeDef
          sdk_field: SAI_FrameLength
          type: int
          default: 64
        - key: slot_size
          name: Slot size
          struct: SAI_SlotInitTypeDef
          sdk_field: SAI_SlotSize
          type: int
          default: 32
`;

const load = src => { fresh('CH32V006'); eng.loadMcu(src); };

test('one instance produces THREE blocks: the primary struct and two struct: overrides', () => {
  load(SAI);
  eng.setSetting('SAI', 'Block A', 'Enabled');
  eng.compute();
  const structs = eng.initPlan('SAI').structs;
  assert.deepEqual(structs.map(b => b.struct),
    ['SAI_InitTypeDef', 'SAI_FrameInitTypeDef', 'SAI_SlotInitTypeDef']);
  assert.ok(structs.every(b => b.instance && b.instance.n === 1), 'all three belong to block 1');
  assert.deepEqual(structs.map(b => b.fn), ['SAI_Init', 'SAI_FrameInit', 'SAI_SlotInit']);
  // The primary struct's fn came from the instance's own sdk_call (unchanged mechanism);
  // the two extras came from codegen.init_structs - a DIFFERENT lookup, same result shape.
  assert.deepEqual(structs.map(b => b.handle), ['SAI1_Block_A', 'SAI1_Block_A', 'SAI1_Block_A'],
    'the same per-instance handle reaches every struct, not only the primary one');
});

test('the emitted C: three real calls, one block, no TODO', () => {
  load(SAI);
  eng.setSetting('SAI', 'Block A', 'Enabled');
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /SAI_InitTypeDef SAI_InitStructure = \{0\};/);
  assert.match(c, /SAI_InitStructure\.SAI_AudioMode = SAI_Mode_MasterTx;/);
  assert.match(c, /SAI_Init\(SAI1_Block_A, &SAI_InitStructure\);/);

  assert.match(c, /SAI_FrameInitTypeDef SAI_FrameInitStructure = \{0\};/);
  assert.match(c, /SAI_FrameInitStructure\.SAI_FrameLength = 64;/);
  assert.match(c, /SAI_FrameInit\(SAI1_Block_A, &SAI_FrameInitStructure\);/);

  assert.match(c, /SAI_SlotInitTypeDef SAI_SlotInitStructure = \{0\};/);
  assert.match(c, /SAI_SlotInitStructure\.SAI_SlotSize = 32;/);
  assert.match(c, /SAI_SlotInit\(SAI1_Block_A, &SAI_SlotInitStructure\);/);

  assert.equal((c.match(/TODO/g) || []).length, 0);
});

test('both blocks live: SIX blocks, each struct getting its OWN copy per block', () => {
  load(SAI);
  eng.setSetting('SAI', 'Block A', 'Enabled');
  eng.setSetting('SAI', 'Block B', 'Enabled');
  eng.setChannelParam('SAI', 2, 'frame_length', 32);   // block B configured differently
  eng.compute();
  const structs = eng.initPlan('SAI').structs;
  assert.equal(structs.length, 6, 'three structs x two live blocks');
  assert.deepEqual(structs.filter(b => b.instance.n === 2).map(b => b.struct),
    ['SAI_InitTypeDef', 'SAI_FrameInitTypeDef', 'SAI_SlotInitTypeDef']);

  const c = eng.cSource();
  assert.match(c, /SAI_Init\(SAI1_Block_A, &SAI_InitStructure\);/);
  assert.match(c, /SAI_Init\(SAI1_Block_B, &SAI_InitStructure\);/);
  // Per-instance VALUES, not one struct's fields copied twice.
  assert.match(c, /SAI_FrameInitStructure\.SAI_FrameLength = 64;[^]*SAI_FrameInit\(SAI1_Block_A,/);
  assert.match(c, /SAI_FrameInitStructure\.SAI_FrameLength = 32;[^]*SAI_FrameInit\(SAI1_Block_B,/);
  assert.equal((c.match(/TODO/g) || []).length, 0);
});

test('PLANTED BREAK: a struct: override with no codegen.init_structs entry is a named TODO, not a dropped call', () => {
  const broken = SAI.replace('    SAI_FrameInitTypeDef: { fn: SAI_FrameInit }\n', '');
  load(broken);
  eng.setSetting('SAI', 'Block A', 'Enabled');
  eng.compute();
  const c = eng.cSource();
  // The struct is still declared and filled - the VALUE is known and useful - only the
  // call is withheld, exactly like every other "nothing applies this struct" case.
  assert.match(c, /SAI_FrameInitTypeDef SAI_FrameInitStructure = \{0\};/);
  assert.match(c, /SAI_FrameInitStructure\.SAI_FrameLength = 64;/);
  assert.doesNotMatch(c, /SAI_FrameInit\(/, 'RED, if it were checked: no fn: means no call, ever');
  assert.match(c, /TODO: nothing applies this struct/);
  assert.match(c, /codegen\.init_structs\.SAI_FrameInitTypeDef\.fn — the SDK function that takes a SAI_FrameInitTypeDef/);
  // The OTHER two structs are entirely unaffected - one missing entry does not take
  // down its siblings.
  assert.match(c, /SAI_Init\(SAI1_Block_A, &SAI_InitStructure\);/);
  assert.match(c, /SAI_SlotInit\(SAI1_Block_A, &SAI_SlotInitStructure\);/);
});

test('a channel_params block with no struct: overrides is untouched (the six shipped blocks)', () => {
  // Every param names only the primary struct - the OLD, still-live shape - and the
  // loop must produce exactly ONE block per instance, byte-identical to before this
  // mechanism existed.
  for (const [part, pid] of [['CH32V006', 'TIM1'], ['CH32H417', 'LTDC']]) {
    const e = fresh(part, part === 'CH32H417' ? 'QFN128' : 'TSSOP20');
    if (!e.channelParamBlock(pid)) continue;
    if (pid === 'TIM1') e.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
    else { e.setSetting('LTDC', 'Layer 1', 'Enabled'); }
    e.compute();
    const structs = e.initPlan(pid).structs.filter(b => b.instance);
    const byInstance = new Map();
    for (const b of structs) (byInstance.get(b.instance.n) || byInstance.set(b.instance.n, []).get(b.instance.n)).push(b);
    for (const [, bs] of byInstance) assert.equal(bs.length, 1, `${part}.${pid}: one block per live instance, not per struct`);
  }
});
