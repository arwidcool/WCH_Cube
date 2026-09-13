// `sdk_manual:` — a parameter the SDK CAN set, but not safely from this generator's
// one-shot init function, so firmware sets it some other way (a getter/setter called
// later, a mode switched at runtime, …). `sdk_none:` already covers "the SDK exposes
// NOTHING for this parameter", and both produce a NOTE rather than a struct field, but
// they say opposite things about whether the SDK has a setter at all. Before this key
// existed, the only way to suppress a struct field for a parameter the SDK DOES expose
// was `sdk_none: true` with an `sdk_note:` explaining the real situation — which prints
// "the SDK exposes nothing for it: <the note explaining that it does>", a self-
// contradicting sentence a reader takes as documentation. Live case: CH32H417's UHSIF
// five params (`data/mcus/CH32H417.yaml` ~5839-5975) are `sdk_none: true` with an
// `sdk_note:` saying the SDK's `UHSIF_GPIO_Init` very much exists — the generator's
// `sdk_args` just cannot assemble a 5-argument call from 5 separate data rows yet.
//
// AGENT-2's own STATUS.md P2, closed this cycle: manager-assigned.
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
codegen:
  header: manual.h
  sdk: { synthetic: true }
peripherals:
  DISP:
    category: Multimedia
    settings:
      - name: Mode
        choices: [{ name: Disabled }, { name: On, default: true }]
`;

const load = params => { fresh('CH32V006'); eng.loadMcu(head('MANUAL-TEST') + `    params:\n${params}`); };

test('sdk_manual: says the true thing — the SDK has a setter, firmware calls it, not this generator', () => {
  load(
    `      - key: pf
        name: Pixel format
        sdk_manual: true
        sdk_note: "LTDC_SetPixelFormat() is unsafe before the layer is otherwise configured"
        type: enum
        default: RGB565
        options: [{ name: RGB565 }, { name: ARGB8888 }]
`);
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /Pixel format = RGB565 — set by firmware: LTDC_SetPixelFormat\(\) is unsafe/);
  // The opposite of the bug being fixed: never say the SDK has nothing when it does.
  assert.doesNotMatch(c, /exposes nothing for it/);
  assert.equal((c.match(/TODO/g) || []).length, 0, 'a manual parameter is not a gap');
});

test('sdk_none: still says its own, different, true thing — the two are not the same key', () => {
  load(
    `      - key: lp
        name: Low power mode
        sdk_none: true
        sdk_note: "ch32v00X_adc.h has neither a member nor a function for ADC_CTLR1.ADC_LP"
        type: bool
        default: false
`);
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /Low power mode = false — the SDK exposes nothing for it: ch32v00X_adc\.h/);
  assert.doesNotMatch(c, /set by firmware/);
});

test('sdk_manual: with no sdk_note is still a note, not a struct field or a TODO', () => {
  load(
    `      - key: pf
        name: Pixel format
        sdk_manual: true
        type: enum
        default: RGB565
        options: [{ name: RGB565 }]
`);
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /Pixel format = RGB565 — set by firmware \*\//);
  assert.equal((c.match(/TODO/g) || []).length, 0);
});

test('WHY sdk_manual exists: the pre-existing workaround still reads self-contradicting', () => {
  // Same parameter, same intent, written the way it HAD to be before this key: sdk_none
  // plus a correcting note. This is not a hypothetical — it is byte-for-byte the shape
  // CH32H417's five UHSIF params are in today (data/mcus/CH32H417.yaml ~5839-5975,
  // agents/BOARD.md 2026-09-13T02:00Z). sdk_none: is not removed and this spelling still
  // compiles — the fix is a BETTER key to reach for, not a refusal of the old one — but
  // it still reads as "the SDK exposes nothing for it" directly contradicted by its own
  // note. sdk_manual: says the true thing for exactly this shape (test above).
  load(
    `      - key: pf
        name: Pixel format
        sdk_none: true
        sdk_note: "the SDK exposes LTDC_SetPixelFormat() perfectly well; it is unsafe at init"
        type: enum
        default: RGB565
        options: [{ name: RGB565 }]
`);
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /Pixel format = RGB565 — the SDK exposes nothing for it: the SDK exposes LTDC_SetPixelFormat/,
    '"exposes nothing" directly contradicted by the note twelve words later');
});
