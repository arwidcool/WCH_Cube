// The nested-struct shape: a member that is a POINTER to a SECOND struct no SDK
// function takes alone. `ch32h417_fmc.h:113-115`:
//
//     typedef struct {
//       uint32_t FMC_Bank; ...
//       FMC_NORSRAMTimingInitTypeDef* FMC_ReadWriteTimingStruct;   /* unconditional */
//       FMC_NORSRAMTimingInitTypeDef* FMC_WriteTimingStruct;       /* only if ExtendedMode */
//     } FMC_NORSRAMInitTypeDef;
//     void FMC_NORSRAMInit(FMC_NORSRAMInitTypeDef *FMC_NORSRAMInitStruct);
//
// `initPlan()` used to group struct blocks by `struct:` name alone, so the two pointer
// members - both `FMC_NORSRAMTimingInitTypeDef*` - could not be told apart, and the
// inner struct had no `fn:` of its own (nothing calls it alone), so it fell into
// "TODO: nothing applies this struct". Blocked on this: FMC, ETH, ECDC, FMC_NAND,
// FMC_SDRAM (agents/STATUS.md §3, 09-12T19:33Z).
//
// THE TRAP, recorded by AGENT-1: shipping the OUTER struct alone is worse than nothing -
// `FMC_NORSRAMInit()` dereferences `FMC_ReadWriteTimingStruct` unconditionally, so a
// zeroed struct is a null read at init. So the mechanism must make the inner struct's
// ADDRESS actually reach the outer struct's member, not merely silence the TODO.
//
// The shape: a param carries `embed: <key>` beside its `struct:`, and
// `codegen.init_structs.<inner-struct>.embed.<key>` names the outer struct and the
// pointer member that receives `&<the inner struct's own variable>`. Two params naming
// the SAME struct but a DIFFERENT `embed:` key become two separate blocks - one per
// pointer member - each with its own, disambiguated C variable name.
//
// The part here is invented, exactly shaped like ch32h417_fmc.h, so the mechanism
// cannot pass by being right about the one chip it was designed against.
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

// codegen.init_structs.FMC_NORSRAMTimingInitTypeDef.embed says which pointer member of
// FMC_NORSRAMInitTypeDef each embed key fills. `rw` has no `when:` on its params, so it
// is unconditional - exactly like FMC_ReadWriteTimingStruct. `wr` is gated on Extended
// Mode - exactly like FMC_WriteTimingStruct, which the SDK only reads under it.
const FMC = head('NEST-FMC') + `
codegen:
  header: nest.h
  sdk: { synthetic: true }
  init_structs:
    FMC_NORSRAMInitTypeDef:
      fn: FMC_NORSRAMInit
      no_handle: true
    FMC_NORSRAMTimingInitTypeDef:
      embed:
        rw: { into: FMC_NORSRAMInitTypeDef, member: FMC_ReadWriteTimingStruct }
        wr: { into: FMC_NORSRAMInitTypeDef, member: FMC_WriteTimingStruct }
peripherals:
  FMC:
    category: Memories
    settings:
      - name: Mode
        choices: [{ name: Disabled }, { name: NOR/PSRAM/SRAM, default: true }]
      - name: Extended Mode
        choices: [{ name: Disable }, { name: Enable }]
    params:
      - key: bank
        name: Bank
        struct: FMC_NORSRAMInitTypeDef
        sdk_field: FMC_Bank
        type: enum
        default: Bank1
        options: [{ name: Bank1, value: 0, sdk: FMC_Bank1_NORSRAM1 }]
      - key: rw_addrset
        name: RW Address Setup Time
        struct: FMC_NORSRAMTimingInitTypeDef
        embed: rw
        sdk_field: FMC_AddressSetupTime
        type: int
        default: 2
      - key: wr_addrset
        name: WR Address Setup Time
        struct: FMC_NORSRAMTimingInitTypeDef
        embed: wr
        sdk_field: FMC_AddressSetupTime
        type: int
        default: 5
        when: { Extended Mode: Enable }
`;

const load = src => { fresh('CH32V006'); eng.loadMcu(src); };

// ---- the shape works: the address reaches the outer struct's member ------------

test('unconditional half: one embedded block, and the outer struct gets its address', () => {
  load(FMC);
  eng.compute();
  const structs = eng.initPlan('FMC').structs;
  assert.equal(structs.length, 2, 'the inner (rw) block and the outer block - wr never applies, so no block for it');
  const inner = structs.find(b => b.embed === 'rw');
  const outer = structs.find(b => b.struct === 'FMC_NORSRAMInitTypeDef');
  assert.ok(inner, 'the rw block exists');
  assert.ok(outer, 'the outer block exists');
  assert.equal(inner.embedInto, outer, 'the inner block is resolved INTO the outer block, by object identity');
  const ptr = outer.fields.find(f => f.member === 'FMC_ReadWriteTimingStruct');
  assert.ok(ptr, 'the outer struct was given a field for the pointer member');
  assert.equal(ptr.text, '&FMC_NORSRAMTimingInitStructure_rw', 'the address of the INNER struct\'s own variable');
});

test('the emitted C: the inner struct is declared, filled, and its address reaches the outer member', () => {
  load(FMC);
  eng.compute();
  const c = eng.cSource();
  // Declared and filled.
  assert.match(c, /FMC_NORSRAMTimingInitTypeDef FMC_NORSRAMTimingInitStructure_rw = \{0\};/);
  assert.match(c, /FMC_NORSRAMTimingInitStructure_rw\.FMC_AddressSetupTime = 2;/);
  // The address reaches the outer struct's pointer member - THE TRAP: not a zeroed
  // pointer that FMC_NORSRAMInit() would dereference unconditionally.
  assert.match(c, /FMC_NORSRAMInitStructure\.FMC_ReadWriteTimingStruct = &FMC_NORSRAMTimingInitStructure_rw;/);
  // The inner struct is NEVER applied by itself - nothing calls it alone.
  assert.doesNotMatch(c, /FMC_NORSRAMTimingInit\(/);
  // The outer struct IS applied, with no handle (FMC_NORSRAMInit takes the struct alone).
  assert.match(c, /FMC_NORSRAMInit\(&FMC_NORSRAMInitStructure\);/);
  // Extended Mode is off: no WriteTimingStruct member, no wr variable, and the pointer
  // that the SDK does not read under this mode is correctly left unset (zeroed by {0}),
  // which is safe because FMC_NORSRAMInit() only reads it when ExtendedMode is on.
  assert.doesNotMatch(c, /FMC_WriteTimingStruct/);
  assert.doesNotMatch(c, /_wr/);
  assert.equal((c.match(/TODO/g) || []).length, 0, 'nothing is missing');
});

test('the conditional half: Extended Mode on brings in a SECOND, DISTINCT inner block', () => {
  load(FMC);
  eng.setSetting('FMC', 'Extended Mode', 'Enable');
  eng.compute();
  const structs = eng.initPlan('FMC').structs;
  assert.equal(structs.length, 3, 'rw, wr, and the outer struct');
  const rw = structs.find(b => b.embed === 'rw');
  const wr = structs.find(b => b.embed === 'wr');
  assert.ok(rw && wr, 'both embedded blocks exist');
  assert.notEqual(rw, wr, 'and they are TWO blocks, not one merged block - the whole point');
  const outer = structs.find(b => b.struct === 'FMC_NORSRAMInitTypeDef');
  assert.equal(rw.embedInto, outer);
  assert.equal(wr.embedInto, outer);
  assert.deepEqual(outer.fields.map(f => f.member).filter(m => m.endsWith('TimingStruct')),
    ['FMC_ReadWriteTimingStruct', 'FMC_WriteTimingStruct']);

  const c = eng.cSource();
  assert.match(c, /FMC_NORSRAMTimingInitTypeDef FMC_NORSRAMTimingInitStructure_rw = \{0\};/);
  assert.match(c, /FMC_NORSRAMTimingInitTypeDef FMC_NORSRAMTimingInitStructure_wr = \{0\};/);
  assert.match(c, /FMC_NORSRAMTimingInitStructure_wr\.FMC_AddressSetupTime = 5;/);
  assert.match(c, /FMC_NORSRAMInitStructure\.FMC_ReadWriteTimingStruct = &FMC_NORSRAMTimingInitStructure_rw;/);
  assert.match(c, /FMC_NORSRAMInitStructure\.FMC_WriteTimingStruct = &FMC_NORSRAMTimingInitStructure_wr;/);
  assert.equal((c.match(/TODO/g) || []).length, 0);
});

test('the two inner variables share ONE C scope with the outer, so the address stays valid', () => {
  // Every ordinary struct block gets its own `{ ... }` scope, which is fine because
  // nothing outside that scope ever reads its variable. An embedded block is different:
  // `&FMC_NORSRAMTimingInitStructure_rw` has to still be IN SCOPE at the point
  // `FMC_NORSRAMInit(&FMC_NORSRAMInitStructure)` reads it, so the family (both inner
  // blocks and the outer block) must share one scope, in declaration order.
  load(FMC);
  eng.setSetting('FMC', 'Extended Mode', 'Enable');
  eng.compute();
  const c = eng.cSource();
  const start = c.indexOf('FMC_NORSRAMTimingInitStructure_rw = {0};');
  const end = c.indexOf('FMC_NORSRAMInit(&FMC_NORSRAMInitStructure);');
  assert.ok(start > -1 && end > start, 'setup: both present, inner before the call');
  const between = c.slice(start, end);
  // No closing brace at column-matching depth between the inner declaration and the
  // call that needs it still alive - a cheap but real proxy: the family's own scope
  // opens once and does not close until after the call.
  assert.doesNotMatch(between, /^ {4}\}\s*$/m, 'the shared scope does not close between them');
});

// ---- what it refuses to guess: the exact trap AGENT-1 recorded -----------------

test('PLANTED BREAK: an embed key the data does not resolve is a TODO, not a silent null pointer', () => {
  // Break exactly the fact this whole mechanism exists to get right: rename the embed
  // key in codegen.init_structs so `embed: rw` on the params no longer resolves. Before
  // this mechanism existed, the only two ways to fail were "ship the pointer unset" (the
  // null-deref trap) or "silently drop the field" (a claimed pad that reaches no code).
  // Neither is acceptable, so this must become a named TODO that fails --strict.
  const broken = FMC.replace('        rw: { into: FMC_NORSRAMInitTypeDef, member: FMC_ReadWriteTimingStruct }',
    '        rw_TYPO: { into: FMC_NORSRAMInitTypeDef, member: FMC_ReadWriteTimingStruct }');
  load(broken);
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /TODO: codegen\.init_structs\.FMC_NORSRAMTimingInitTypeDef\.embed\.rw does not name/,
    'RED: the break is caught, named, and points at the exact key that is wrong');
  // And critically: the inner struct is NOT silently folded into the outer as a bare
  // struct-with-no-application (the pre-mechanism failure mode) - it stays its own
  // block, visibly unresolved.
  assert.doesNotMatch(c, /FMC_ReadWriteTimingStruct = &/, 'the outer member was never assigned - visible, not silent');
});

test('RESTORED: the same file with the key spelled right is clean again', () => {
  // The other half of a planted break: prove the check does not ALWAYS fire.
  load(FMC);
  eng.compute();
  assert.equal((eng.cSource().match(/TODO/g) || []).length, 0);
});

test('PLANTED BREAK: a peripheral with only embedded params still gets the outer struct built and applied', () => {
  // If the data described NOTHING but the two timing pointers (no direct FMC_Bank-style
  // param), the outer struct block would never be created by the ordinary defs loop.
  // The mechanism must synthesise it rather than drop the embed on the floor.
  const onlyEmbedded = FMC.replace(
    `      - key: bank
        name: Bank
        struct: FMC_NORSRAMInitTypeDef
        sdk_field: FMC_Bank
        type: enum
        default: Bank1
        options: [{ name: Bank1, value: 0, sdk: FMC_Bank1_NORSRAM1 }]
`, '');
  load(onlyEmbedded);
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /FMC_NORSRAMInitTypeDef FMC_NORSRAMInitStructure = \{0\};/, 'the outer struct exists with no direct fields of its own');
  assert.match(c, /FMC_NORSRAMInitStructure\.FMC_ReadWriteTimingStruct = &FMC_NORSRAMTimingInitStructure_rw;/);
  assert.match(c, /FMC_NORSRAMInit\(&FMC_NORSRAMInitStructure\);/, 'and it is still applied - no_handle: true honoured');
  assert.equal((c.match(/TODO/g) || []).length, 0);
});

// ---- inert on data that does not use it -----------------------------------------

test('a peripheral with no embed: params is untouched by any of this', () => {
  for (const name of ['CH32V005', 'CH32V006']) {
    const e = fresh(name);
    e.compute();
    const blocks = e.initPlan('USART1').structs;
    assert.deepEqual(blocks.filter(b => b.embed || b.embedInto), [],
      `${name}: USART1 has no embedded blocks`);
  }
});
