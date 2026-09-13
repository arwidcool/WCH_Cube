// A mux LEG that carries its own divider — CH32H417's LTDC choice 01, "SERDES_PLL
// clock divided by 2" (CH32H417RM.md:4085-4089). Round 6's D deliverable's other
// remaining muxes (RNG, I2S2, I2S3, UHSIF, HSADC, ETH1G) need the same shape - four of
// the seven, per STATUS §2 D.
//
// Before this, a tap's `source:` LIST was always a list of BARE clock-signal names -
// `tapSource()` returned the string directly and every consumer (the frequency
// arithmetic, the RCC register encoder, the tree's edge drawing) treated it as one. A
// mux leg that divides its source has nowhere to say so: encoding it as a bare source
// name would print a number the silicon does not produce - the same defect class
// AGENT-1 refused to ship for USBHS_PLL's REFSEL problem, and "every choice the app
// offers must be one the silicon can honour" the same rule, one mux over.
//
// The shape: a `source:` list entry may be an OBJECT `{ name, source, div }` — the
// SAME shape a PLL's own `inputs:` entries already use — instead of a bare string. A
// plain string is still `{ name: s, source: s, div: 1 }`, so every existing mux
// (USBFS) is provably unaffected; that is the regression half at the bottom.
import { test, assert, fresh, eng } from './_harness.js';

// SERDES_PLL runs at HSE x 25 (whatever the default HSE is). LTDC's mux: PLLCLK
// (bare), or "SERDES_PLL /2" - a leg that divides its source, exactly RM 4085-4089's
// shape.
// No separate `options:` on LTDC at all: the mux IS the only divider, which is legal
// (clockCalc()'s divOf() already falls back to 1 when a tap declares none).
const MUXDIV = `
mcu:
  name: CH32V006-MUXDIV
  inherits: CH32V006
clock:
  plls:
    SERDES_PLL:
      label: SerDes PLL
      output: SERDES_PLL_CLK
      inputs:
        - { name: HSE, source: HSE, div: 1 }
      multipliers: [25]
  prescalers:
    LTDC:
      label: LTDC clock
      source:
        - PLLCLK
        - { name: "SERDES_PLL /2", source: SERDES_PLL_CLK, div: 2 }
      default_source: PLLCLK
`;

const withMuxDiv = () => { const e = fresh(); e.registerMcuFile(MUXDIV); e.loadMcu('CH32V006-MUXDIV'); e.compute(); return e; };

test('a bare-source leg (index 0) behaves exactly as before: no division beyond the base', () => {
  const e = withMuxDiv();
  const r = e.clockCalc();
  assert.equal(e.S.clock.preSrc.LTDC, 'PLLCLK', 'setup: default_source picked the bare leg');
  assert.equal(r.LTDC, r.PLLCLK, 'LTDC == PLLCLK exactly - no mux divider on this leg, no options: either');
});

test('a leg that carries its own divider actually divides — RM 4085-4089\'s shape', () => {
  const e = withMuxDiv();
  e.setClock({ preSrc: { LTDC: 'SERDES_PLL /2' } });
  const r = e.clockCalc();
  assert.ok(r.SERDES_PLL_CLK > 0, 'setup: SERDES_PLL is running (HSE x 25)');
  assert.equal(r.LTDC, r.SERDES_PLL_CLK / 2, 'LTDC = SERDES_PLL_CLK / 2, the LEG\'s own divider');
  assert.notEqual(r.LTDC, r.SERDES_PLL_CLK, 'and it really is divided, not just relabelled');
});

test('setClock refuses a preSrc value the mux does not offer, same as every other mux', () => {
  const e = withMuxDiv();
  assert.throws(() => e.setClock({ preSrc: { LTDC: 'NOT_A_LEG' } }));
});

test('the tree draws the mux select (two legs) and NO separate divider select (no options:)', () => {
  const sel = eng.clockSelectable(withMuxDiv().M);
  assert.deepEqual(sel.preSrc.LTDC, ['PLLCLK', 'SERDES_PLL /2'], 'the display names, one per leg');
  assert.deepEqual(sel.preSrcEntries.LTDC, [
    { name: 'PLLCLK', source: 'PLLCLK', div: 1 },
    { name: 'SERDES_PLL /2', source: 'SERDES_PLL_CLK', div: 2 },
  ]);
  assert.deepEqual(sel.pre.LTDC, [], 'no options: on this tap - the mux IS the only divider');
});

test('the RCC word can tell the two legs apart even when this fixture only needs one to', () => {
  const e = fresh();
  e.registerMcuFile(MUXDIV + `
codegen:
  rcc:
    extra:
      - register: "RCC->CFGR2"
        sources:
          LTDC: { lsb: 0, bits: 1, values: { PLLCLK: 0, "SERDES_PLL /2": 1 } }
`);
  e.loadMcu('CH32V006-MUXDIV');
  e.setClock({ preSrc: { LTDC: 'SERDES_PLL /2' } });
  e.compute();
  const words = e.rccWords();
  const cfgr2 = words.find(w => w.register === 'RCC->CFGR2');
  assert.ok(cfgr2, 'the second register is written');
  assert.equal(cfgr2.value & 1, 1, 'LTDC field carries the CHOSEN LEG\'s own code, 1 - not the bare source\'s');
  const c = e.cSource();
  assert.doesNotMatch(c, /TODO/);
});

// ---- the regression half: every existing (bare-string) mux is provably unaffected --
test('an ordinary bare-source mux (USBFS-style) is untouched by any of this', () => {
  const PLLS = `
mcu:
  name: CH32V006-PLLS-DIV-REGRESSION
  inherits: CH32V006
clock:
  plls:
    USBHS_PLL:
      output: USBHS_PLL_CLK
      output_mhz: 480
      inputs: [{ name: HSI, source: HSI, div: 1 }]
  prescalers:
    USBFS:
      source: [USBHS_PLL_CLK, PLLCLK]
      options: [10]
      default: 10
`;
  const e = fresh();
  e.registerMcuFile(PLLS);
  e.loadMcu('CH32V006-PLLS-DIV-REGRESSION');
  e.compute();
  const sel = e.clockSelectable();
  assert.deepEqual(sel.preSrc.USBFS, ['USBHS_PLL_CLK', 'PLLCLK']);
  assert.deepEqual(sel.preSrcEntries.USBFS, [
    { name: 'USBHS_PLL_CLK', source: 'USBHS_PLL_CLK', div: 1 },
    { name: 'PLLCLK', source: 'PLLCLK', div: 1 },
  ], 'a plain string entry normalises to div: 1, name === source');
  assert.equal(Math.round(e.clockCalc().USBFS), 48, 'RM 3.4.13: 480 / 10 = 48, unchanged');
});
