// The "extra scalar argument" shape, and the "unmodellable, not merely unmodelled"
// shape. CH32H417 ETH is the case that forced both, and neither existed before this
// (agents/BOARD.md, main's P0 after the pin-planning priority flip):
//
//     uint32_t ETH_RegInit(ETH_InitTypeDef* ETH_InitStruct, uint16_t PHYAddress);
//
// found only in EXAMPLE driver code (Evt/EXAM/ETH/.../ETH_Driver/eth_driver_100M.c:482,
// byte-identical in the RGMII variant) - there is no ETH_Init() in Peripheral/src at all.
// PHYAddress is not a member of ETH_InitTypeDef anywhere: it is the board's own PHY chip's
// MDIO address, a real per-project choice, and the struct's apply call needs it BESIDE
// the struct pointer. `call_arg: true` says a param is exactly that: an ordinary,
// editable, validated params: row whose value becomes an extra call argument, not a
// struct member.
//
// Separately: ETH_RegInit reads only 26 of the struct's 47 fields (confirmed identical
// in both driver variants); the other 21 are set only by ETH_StructInit()'s defaults,
// which nothing ever reads back. Modelling one would compile, render as an ordinary
// control, and change nothing on the board. `codegen.init_structs.<struct>.dead_fields`
// names those members so a `params:` row for one is refused with a TODO - loudly, on
// every gate - rather than silently accepted the day someone reads the header and adds
// a plausible-looking row for a field that does nothing.
//
// The part here is invented, not ETH-shaped verbatim, so the mechanism cannot pass by
// being right about the one chip it was designed against - same discipline
// nested_structs.test.js uses for `embed:`.
import { test, assert, fresh, eng } from './_harness.js';

const head = name => `
mcu:
  name: ${name}
  family: test
  default_package: QFN8
  variants:
    A8: { package: QFN8, flash_kb: 64, sram_kb: 8, temp: 85, io_count: 8 }
packages:
  QFN8:
    1: PA0
pins:
  PA0: { type: io }
`;

// NET claims no pin at all (no `signals:` on either choice) - exactly FMC's shape in
// nested_structs.test.js - so this test stays about the struct/call mechanism alone,
// with no GPIO/AF machinery from an unrelated part of the engine able to add a TODO
// this test did not plant.
const PART = head('CALLARG-TEST') + `
codegen:
  header: callarg.h
  sdk: { synthetic: true }
  init_structs:
    NET_InitTypeDef:
      fn: NET_RegInit
      no_handle: true
      dead_fields: [DeadA, DeadB]
peripherals:
  NET:
    category: Connectivity
    settings:
      - name: Mode
        choices: [{ name: Disabled }, { name: Enabled, default: true }]
    params:
      - key: live
        name: Live field
        struct: NET_InitTypeDef
        sdk_field: NET_LiveField
        type: enum
        default: fast
        options: [{ name: fast, value: 0, sdk: MY_FAST }]
      - key: addr
        name: PHY address
        struct: NET_InitTypeDef
        call_arg: true
        type: int
        default: 3
        min: 0
        max: 31
`;

const load = src => { fresh('CH32V006'); eng.loadMcu(src); };

test('call_arg: true appends the param as an extra argument, not a struct member', () => {
  load(PART);
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /NET_InitTypeDef NET_InitStructure = \{0\};/);
  assert.match(c, /NET_InitStructure\.NET_LiveField = MY_FAST;/);
  // the extra arg is a LITERAL after the struct pointer, not a struct field
  assert.equal(/NET_InitStructure\.addr/.test(c), false, 'addr must never become a struct member');
  assert.match(c, /NET_RegInit\(&NET_InitStructure, 3\);/, 'PHY address 3 lands as the second argument');
  assert.equal((c.match(/TODO/g) || []).length, 0, 'a fully resolved config has nothing to complain about:\n' + c);
});

test('an unresolvable call_arg is a TODO on the struct block, not a crash or silence', () => {
  // no `default:` clash needed - swap to an enum with a default naming no option, so
  // paramLiteral() reports it missing the ordinary way (no options: match), the same
  // path an ordinary struct-member param already goes through.
  const broken = PART.replace(
    `      - key: addr
        name: PHY address
        struct: NET_InitTypeDef
        call_arg: true
        type: int
        default: 3
        min: 0
        max: 31`,
    `      - key: addr
        name: PHY address
        struct: NET_InitTypeDef
        call_arg: true
        type: enum
        default: nope
        options: [{ name: known, value: 1, sdk: X }]`,
  );
  load(broken);
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /TODO: extra call argument: PHY address: option "nope" has no sdk: macro/);
  // A wrong-argument-count call is a build failure with nothing explaining it - worse
  // than a struct member left at zero - so the call is withheld entirely, not emitted
  // one argument short.
  assert.equal(/NET_RegInit\(/.test(c), false,
    'an unresolved call argument must not produce a call with the wrong argument count');
  assert.match(c, /is not written: see the TODO above/);
  assert.ok(eng.cComplaints().some(x => x.kind === 'todo' && /extra call argument/.test(x.text)));
});

test('a params: row naming a dead_fields member is refused with a TODO, not silently accepted', () => {
  const withDead = PART.replace(
    `      - key: addr`,
    `      - key: dead
        name: Dead setting
        struct: NET_InitTypeDef
        sdk_field: DeadA
        type: bool
        default: false
      - key: addr`,
  );
  load(withDead);
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /TODO: Dead setting: struct: NET_InitTypeDef\.DeadA is in codegen\.init_structs\.NET_InitTypeDef\.dead_fields/);
  assert.equal(/NET_InitStructure\.DeadA/.test(c), false, 'the dead field must never be assigned, TODO or not');
  assert.ok(eng.cComplaints().some(x => x.kind === 'todo' && /DeadA/.test(x.text)),
    '--strict must catch it: unmodellable, not merely unmodelled');
  // the live field and the call itself are unaffected - one refused row must not take
  // down the rest of the block
  assert.match(c, /NET_InitStructure\.NET_LiveField = MY_FAST;/);
  assert.match(c, /NET_RegInit\(&NET_InitStructure, 3\);/);
});

test('dead_fields only refuses the LISTED member - a sibling field on the same struct is untouched', () => {
  load(PART);   // PART's own `live` field (NET_LiveField) is not in dead_fields: [DeadA, DeadB]
  eng.compute();
  const c = eng.cSource();
  assert.equal(/TODO/.test(c), false, 'NET_LiveField is not a dead field and must generate cleanly:\n' + c);
});
