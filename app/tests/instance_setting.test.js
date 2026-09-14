// `depends_on: { instance_setting: "...", equals: ... }` — a `channel_params:` field
// gated on a setting whose NAME differs per instance, not one setting several
// instances could share. CH32H417 OPA is the proven case (agents/BOARD.md, AGENT-1's
// finding): `OPA_InitTypeDef.PSEL` is derived from "OPA1 positive input" / "OPA2
// positive input" / "OPA3 positive input" - three DIFFERENT settings on ONE shared
// peripheral. Before this, `channel_params`'s `paramApplies()` checked every row
// against the PERIPHERAL's settings once, with no idea which instance's block it was
// filling - so a `depends_on:` naming instance 1's setting would have applied
// instance 1's choice to instance 2 and 3 alike: a number that compiles and
// configures the WRONG op-amp, the same defect class `CMP_NUM` already cost a round to
// find (right for instance 1 by accident, wrong for the rest).
//
// The part here is invented, not OPA-shaped verbatim, so the mechanism cannot pass by
// being right about the one chip it was designed against — same discipline
// nested_structs.test.js and struct_call_arg.test.js use.
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
    2: PA1
pins:
  PA0: { type: io }
  PA1: { type: io }
`;

// AMP1 and AMP2 each have their OWN "positive input" setting, exactly like OPA1/OPA2's
// settings do on the real part - two settings with different names, not one setting
// two instances share.
// BOTH instances have a P1 choice too (matching real OPA's own `active_choices: [P0,
// P1]`), so instance 2 can be genuinely ACTIVE - its block really is emitted, AMP_Init
// really is called for it - while its OWN "positive input" is P1, not P0. That is the
// scenario that actually exercises cross-instance leakage: a block that legitimately
// exists but whose OWN dependency must read false. Leaving instance 2 on "Disable"
// would let it emit no block at all, which cannot tell a real per-instance check
// apart from one that merely resolved to "unresolvable, so applicable" by accident -
// exactly the false-negative plant this test exists to not be.
const AMP = head('INSTSET-TEST') + `
codegen:
  header: amp.h
  sdk: { synthetic: true }
peripherals:
  AMP:
    category: Analog
    settings:
      - name: "AMP1 positive input"
        choices: [{ name: Disable }, { name: P0, signals: [P01] }, { name: P1, signals: [P11] }]
      - name: "AMP2 positive input"
        choices: [{ name: Disable }, { name: P0, signals: [P02] }, { name: P1, signals: [P12] }]
    signal_pins:
      P01: [{ pin: PA0 }]
      P11: [{ pin: PA1 }]
      P02: [{ pin: PA0 }]
      P12: [{ pin: PA1 }]
    channel_params:
      struct: AMP_InitTypeDef
      applies_per: channel
      instances:
        1: { sdk_call: AMP_Init, handle: AMP1, setting: "AMP1 positive input", active_choices: [P0, P1] }
        2: { sdk_call: AMP_Init, handle: AMP2, setting: "AMP2 positive input", active_choices: [P0, P1] }
      params:
        - key: psel
          name: Positive input select
          sdk_field: AMP_PSEL
          type: enum
          default: P0_pin
          options: [{ name: P0_pin, value: 0, sdk: PSEL_P0 }]
          depends_on: { instance_setting: "AMP{n} positive input", equals: P0 }
`;

const load = () => { fresh('CH32V006'); eng.loadMcu(AMP); };

test('an instance_setting dependency is checked against THAT instance, not the peripheral', () => {
  load();
  eng.setSetting('AMP', 'AMP1 positive input', 'P0');
  eng.setSetting('AMP', 'AMP2 positive input', 'P1');   // active, but NOT P0
  eng.compute();
  const structs = eng.initPlan('AMP').structs;
  const b1 = structs.find(b => b.instance && b.instance.n === 1);
  const b2 = structs.find(b => b.instance && b.instance.n === 2);
  assert.ok(b1, 'instance 1 emits a block');
  assert.ok(b2, 'instance 2 emits a block too - it IS active, just not on P0');
  assert.ok(b1.fields.some(f => f.member === 'AMP_PSEL'), 'PSEL applies to instance 1 - its OWN setting is P0');
  // THIS is the defect being fixed: before this mechanism, instance 1's "P0" would
  // have leaked into instance 2's block regardless of instance 2's own setting.
  assert.equal(b2.fields.some(f => f.member === 'AMP_PSEL'), false,
    "PSEL must not leak into instance 2's block - its OWN setting (AMP2 positive input) is P1, not P0");
});

test('the SAME dependency resolves independently and correctly for EVERY instance', () => {
  load();
  eng.setSetting('AMP', 'AMP1 positive input', 'P0');
  eng.setSetting('AMP', 'AMP2 positive input', 'P0');
  eng.compute();
  const structs = eng.initPlan('AMP').structs;
  for (const n of [1, 2]) {
    const b = structs.find(x => x.instance && x.instance.n === n);
    assert.ok(b, `instance ${n} emits a block`);
    assert.ok(b.fields.some(f => f.member === 'AMP_PSEL'), `PSEL applies to instance ${n} once ITS OWN setting is P0`);
  }
});

test('neither instance gets PSEL when both are active but on P1, not P0', () => {
  load();
  eng.setSetting('AMP', 'AMP1 positive input', 'P1');
  eng.setSetting('AMP', 'AMP2 positive input', 'P1');
  eng.compute();
  const structs = eng.initPlan('AMP').structs;
  assert.equal(structs.length, 2, 'setup: both instances are genuinely active');
  for (const b of structs) {
    assert.equal((b.fields || []).some(f => f.member === 'AMP_PSEL'), false,
      `instance ${b.instance && b.instance.n}: PSEL must not apply while its OWN setting is P1, not P0`);
  }
});

test('getChannelParams() resolves the SAME per-instance dependency for the UI, not only for codegen', () => {
  load();
  eng.setSetting('AMP', 'AMP1 positive input', 'P0');
  eng.setSetting('AMP', 'AMP2 positive input', 'P1');   // active, but NOT P0
  eng.compute();
  const p1 = eng.getChannelParams('AMP', 1).find(d => d.key === 'psel');
  const p2 = eng.getChannelParams('AMP', 2).find(d => d.key === 'psel');
  assert.equal(p1.applicable, true, "instance 1's picker must show PSEL - its own setting is P0");
  assert.equal(p2.applicable, false, "instance 2's picker must NOT show PSEL - its own setting is P1, not P0");
});
