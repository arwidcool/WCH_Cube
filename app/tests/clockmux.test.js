// clockmux.test.js — the two things a clock block may now have more than one of:
// a SECOND PLL (`clock.plls`) and a tap whose `source:` is a LIST (a mux).
//
// The part under test is synthetic on purpose. The schema must not name a part, so
// proving it on CH32H417 would prove only that CH32H417's YAML is right; this file
// inherits CH32V006 and bolts the SHAPE of CH32H417's RM 3.4.13 onto it — a
// fixed-output 480 MHz PLL, a multiplied one, and a USBFS tap that picks between a
// secondary PLL and the SYS PLL. The arithmetic checked is the reference manual's
// own worked example: **USBHS_PLL 480 MHz / 10 = 48 MHz** for USBFS
// (CH32H417RM.md:4048 USBFSSRC=1, :4055-4067 USBFSDIV=0111 "Divided by 10").
//
// Every test here also has its planted-break half: a value the file does not offer
// must be REFUSED, not rounded or accepted, because a computed number that is wrong
// is worse than a missing one.
import { test, assert, fresh, eng } from './_harness.js';

// A second PLL and a mux, on a part that has neither. `inherits:` merges maps key by
// key and replaces lists, so `prescalers.USBFS` is added beside HB and ADC and
// `sysclk.sources` is replaced wholesale.
const PLLS = `
mcu:
  name: CH32V006-PLLS
  inherits: CH32V006
clock:
  plls:
    USBHS_PLL:
      label: USB HS PLL
      output: USBHS_PLL_CLK
      output_mhz: 480
      inputs:
        - { name: HSE, source: HSE, div: 1 }
        - { name: HSI, source: HSI, div: 1 }
        - { name: "SYS PLL /2", source: PLLCLK, div: 2 }
    SERDES_PLL:
      output: SERDES_PLL_CLK
      inputs:
        - { name: HSE, source: HSE, div: 1 }
        - { name: "SYS PLL /2", source: PLLCLK, div: 2 }
      multipliers: [25, 28, 30]
      dividers: [1, 2]
  sysclk: { sources: [HSI, HSE, PLLCLK, SERDES_PLL_CLK], max_mhz: 48 }
  prescalers:
    USBFS:
      label: USBFS 48 MHz clock
      source: [USBHS_PLL_CLK, PLLCLK]
      options: [1, 2, 5, 10]
      default: 10
      target_mhz: 48
`;

const withPlls = () => { const e = fresh(); e.registerMcuFile(PLLS); e.loadMcu('CH32V006-PLLS'); e.compute(); return e; };

// --------------------------------------------------------------- the defaults
test('a second PLL and a mux get state; the five parts without them get none', () => {
  const e = withPlls();
  const k = e.S.clock;
  assert.deepEqual(k.plls.USBHS_PLL, { in: 0 });                  // fixed output: no mul, no div
  assert.deepEqual(k.plls.SERDES_PLL, { in: 0, mul: 25, div: 1 });
  assert.equal(k.preSrc.USBFS, 'USBHS_PLL_CLK');                  // first entry of the list
  assert.equal(k.pre.USBFS, 10);                                  // `default:`, not options[0]

  // The parts that have neither must gain NO new keys, or every .wchproj they have
  // ever written stops round-tripping byte for byte against an older build.
  for (const part of ['CH32V006', 'CH32V005', 'CH32V003', 'CH32X035', 'CH32L103', 'CH32H417']) {
    const f = fresh(part);
    if (!f.M.clock) continue;
    const extra = Object.keys(f.S.clock).filter(n => n === 'preSrc' || n === 'plls');
    assert.deepEqual(extra, [], `${part} grew ${extra.join(', ')} without declaring any`);
    assert.deepEqual(Object.keys(f.projectObject().clock).filter(n => n === 'preSrc' || n === 'plls'), []);
  }
});

test('`default:` and `default_source:` must name something the file offers', () => {
  // The default is a CHOICE like any other: one the data does not list is ignored
  // rather than written into the state, where it would reach a frequency.
  const e = fresh();
  e.registerMcuFile(PLLS.replace('default: 10', 'default: 7').replace('[USBHS_PLL_CLK, PLLCLK]',
    '[USBHS_PLL_CLK, PLLCLK]\n      default_source: NOT_A_CLOCK'));
  e.loadMcu('CH32V006-PLLS');
  assert.equal(e.S.clock.pre.USBFS, 1, 'a default outside options: falls back to the first option');
  assert.equal(e.S.clock.preSrc.USBFS, 'USBHS_PLL_CLK', 'a default_source outside the list falls back to the first');
});

// ------------------------------------------------- the number this round is for
test('USBFS is 48 MHz from USBHS_PLL / 10 — RM 3.4.13, computed not copied', () => {
  const e = withPlls();
  const r = e.clockCalc();
  assert.equal(r.USBHS_PLL_CLK, 480, 'a fixed-output PLL reports output_mhz whatever its input is');
  assert.equal(r.plls.USBHS_PLL.out, 480);
  assert.equal(r.plls.USBHS_PLL.fixed, true);
  assert.equal(r.USBFS, 48, '480 / 10');
  assert.ok(!r.over.includes('USBFS'), 'on target: no red box');
});

test('off target is red, and says WHICH way it is wrong', () => {
  const e = withPlls();
  e.setClock({ pre: { USBFS: 5 } });                              // 480 / 5 = 96
  let r = e.clockCalc();
  assert.equal(r.USBFS, 96);
  assert.ok(r.over.includes('USBFS'));
  assert.ok(!r.under.includes('USBFS'), '96 MHz is too FAST for a 48 MHz target');
  e.setClock({ pre: { USBFS: 1 }, preSrc: { USBFS: 'PLLCLK' } });  // SYS PLL is 24 x 2 = 48
  r = e.clockCalc();
  assert.equal(r.USBFS, 48);
  assert.ok(!r.over.includes('USBFS'), 'the other side of the mux can hit the target too');
});

test('the mux moves the tap onto a different tree, and only the chosen one', () => {
  const e = withPlls();
  e.setClock({ preSrc: { USBFS: 'PLLCLK' }, pre: { USBFS: 2 } });
  assert.equal(e.clockCalc().USBFS, 24, 'SYS PLL 48 / 2');
  assert.equal(e.clockCalc().HCLK, 24, 'HB is untouched by a tap the user moved');
  e.setClock({ preSrc: { USBFS: 'USBHS_PLL_CLK' } });
  assert.equal(e.clockCalc().USBFS, 240, '480 / 2');
});

// ------------------------------------------------------------- the second PLLs
test('a multiplied second PLL computes input x mul / div', () => {
  const e = withPlls();
  let r = e.clockCalc();
  assert.equal(r.SERDES_PLL_CLK, 24 * 25, 'HSE 24 MHz x 25');
  e.setClock({ plls: { SERDES_PLL: { mul: 30, div: 2 } } });
  r = e.clockCalc();
  assert.equal(r.SERDES_PLL_CLK, 24 * 30 / 2);
  assert.equal(r.plls.SERDES_PLL.mul, 30);
  assert.equal(r.plls.SERDES_PLL.div, 2);
});

test('a PLL may take another PLL’s output, whatever order the file lists them in', () => {
  const e = withPlls();
  e.setClock({ plls: { SERDES_PLL: { in: 1 } } });                 // SYS PLL /2
  const r = e.clockCalc();
  assert.equal(r.PLLCLK, 48, 'HSI 24 x 2');
  assert.equal(r.plls.SERDES_PLL.in, 24, '48 / 2');
  assert.equal(r.SERDES_PLL_CLK, 24 * 25);
});

test('sysclk.sources may name a secondary PLL, and its limit still bites', () => {
  const e = withPlls();
  assert.ok(e.clockSelectable(e.M).sys.includes('SERDES_PLL_CLK'));
  e.setClock({ sys: 'SERDES_PLL_CLK' });
  const r = e.clockCalc();
  assert.equal(r.SYSCLK, 600);
  assert.equal(r.HCLK, 600);
  assert.ok(r.over.includes('SYSCLK'), '600 MHz is well over this part’s 48 MHz ceiling');
});

test('HSE reaching SYSCLK THROUGH a second PLL still switches the crystal on', () => {
  const e = withPlls();
  assert.equal(e.hseFeedsSysclk(e.M, e.S), false);
  e.setClock({ sys: 'SERDES_PLL_CLK' });                           // SERDES input 0 is HSE
  assert.equal(e.hseFeedsSysclk(e.M, e.S), true);
  e.setClock({ plls: { SERDES_PLL: { in: 1 } } });                 // now fed by the SYS PLL, which is on HSI
  assert.equal(e.hseFeedsSysclk(e.M, e.S), false);
});

// --------------------------------------------------------------- feeding/dimming
test('a PLL nothing asks for is not feeding; one a tap hangs off is', () => {
  const e = withPlls();
  let r = e.clockCalc();
  assert.equal(r.feeding['pll:USBHS_PLL'], true, 'the USBFS tap is pointed at it');
  assert.equal(r.feeding['pll:SERDES_PLL'], false, 'nothing selects it');
  assert.equal(r.feeding.HSE, true, 'and the crystal that PLL runs off is lit with it');
  e.setClock({ preSrc: { USBFS: 'PLLCLK' } });
  r = e.clockCalc();
  assert.equal(r.feeding['pll:USBHS_PLL'], false, 'the mux moved off it');
  assert.equal(r.feeding.HSE, false, 'so nothing is left running off the crystal');
  assert.equal(r.feeding['pre:USBFS'], true, 'the tap itself is still running');
  e.setClock({ sys: 'SERDES_PLL_CLK' });
  r = e.clockCalc();
  assert.equal(r.feeding['pll:SERDES_PLL'], true);
  assert.equal(r.feeding.HSE, true, 'and so is what feeds it');
});

// ------------------------------------------------------- the planted-break half
test('setClock refuses every value the MCU file does not offer', () => {
  const e = withPlls();
  assert.throws(() => e.setClock({ preSrc: { USBFS: 'HSI' } }), /USBHS_PLL_CLK/);
  assert.throws(() => e.setClock({ preSrc: { HB: 'PLLCLK' } }), /not offered/);
  assert.throws(() => e.setClock({ plls: { NOPE: { in: 0 } } }), /USBHS_PLL/);
  assert.throws(() => e.setClock({ plls: { USBHS_PLL: { in: 9 } } }), /not offered/);
  assert.throws(() => e.setClock({ plls: { SERDES_PLL: { mul: 26 } } }), /25, 28, 30/);
  assert.throws(() => e.setClock({ plls: { SERDES_PLL: { div: 4 } } }), /not offered/);
  // The SYS PLL is set through pllIn/pllMul; naming it here would write a second copy
  // of state the RCC codegen reads from the flat keys.
  assert.throws(() => e.setClock({ plls: { PLL: { mul: 2 } } }), /PLL/);
  // and nothing was applied by any of them
  assert.equal(e.S.clock.preSrc.USBFS, 'USBHS_PLL_CLK');
  assert.deepEqual(e.S.clock.plls.SERDES_PLL, { in: 0, mul: 25, div: 1 });
});

// ------------------------------------------------------------- undo and round-trip
test('a mux and a second PLL are each ONE undo step', () => {
  const e = withPlls();
  e.setClock({ preSrc: { USBFS: 'PLLCLK' } });
  e.setClock({ plls: { SERDES_PLL: { mul: 30 } } });
  assert.equal(e.clockCalc().SERDES_PLL_CLK, 720);
  assert.equal(e.undo(), 'Clock');
  assert.equal(e.S.clock.plls.SERDES_PLL.mul, 25);
  assert.equal(e.S.clock.preSrc.USBFS, 'PLLCLK', 'the earlier step is still applied');
  assert.equal(e.undo(), 'Clock');
  assert.equal(e.S.clock.preSrc.USBFS, 'USBHS_PLL_CLK');
  e.redo(); e.redo();
  assert.equal(e.S.clock.plls.SERDES_PLL.mul, 30);
  assert.equal(e.S.clock.preSrc.USBFS, 'PLLCLK');
});

test('a .wchproj round-trips the mux and every PLL', () => {
  const e = withPlls();
  e.setClock({ preSrc: { USBFS: 'PLLCLK' }, pre: { USBFS: 2 }, plls: { SERDES_PLL: { in: 1, mul: 28, div: 2 } } });
  const text = e.projectSerialize();
  const before = e.clockCalc();
  const e2 = withPlls();
  e2.projectApply(text);
  assert.deepEqual(e2.S.clock.plls, e.S.clock.plls);
  assert.deepEqual(e2.S.clock.preSrc, e.S.clock.preSrc);
  assert.equal(e2.clockCalc().SERDES_PLL_CLK, before.SERDES_PLL_CLK);
  assert.equal(e2.clockCalc().USBFS, before.USBFS);
  assert.deepEqual(e2.PROJECT.warnings, []);
});

test('a .wchproj naming a source, a PLL or a divider the part lost is dropped and SAID', () => {
  const e = withPlls();
  const text = e.projectSerialize()
    .replace(/^(\s*)USBFS: USBHS_PLL_CLK$/m, '$1USBFS: LSI')
    .replace(/^(\s*)mul: 25$/m, '$1mul: 99');
  assert.ok(/USBFS: LSI/.test(text) && /mul: 99/.test(text), 'the doctored file really carries both');
  const e2 = withPlls();
  e2.projectApply(text);
  assert.equal(e2.S.clock.preSrc.USBFS, 'USBHS_PLL_CLK', 'the bad source was never applied');
  assert.equal(e2.S.clock.plls.SERDES_PLL.mul, 25, 'nor the bad multiplier');
  assert.equal(e2.PROJECT.warnings.length, 2, e2.PROJECT.warnings.join(' | '));
  assert.ok(e2.PROJECT.warnings.some(w => /LSI/.test(w)));
  assert.ok(e2.PROJECT.warnings.some(w => /99/.test(w)));
  // and the frequencies are the part's, not the file's
  assert.equal(e2.clockCalc().USBFS, 48);
});

// ------------------------------------------------------------------ the old shape
test('every shipped part’s clock numbers are unchanged by the new schema', () => {
  // The five single-PLL parts are the regression this schema most easily breaks:
  // `pll`, `PLLCLK`, `pllIn` and `feeding.PLL` all had to keep meaning exactly what
  // they meant, because five MCU files and the RCC codegen read them.
  const expect = {
    CH32V006: { SYSCLK: 24, HCLK: 24, PLLCLK: 48 },
    CH32V005: { SYSCLK: 24, HCLK: 24, PLLCLK: 48 },
    CH32V003: { SYSCLK: 24, HCLK: 24, PLLCLK: 48 },
  };
  for (const [part, want] of Object.entries(expect)) {
    const f = fresh(part);
    const r = f.clockCalc();
    for (const [key, val] of Object.entries(want)) assert.equal(r[key], val, `${part}.${key}`);
    assert.equal(r.pll.index, 0);
    assert.equal(r.pll.out, r.PLLCLK);
    assert.equal(typeof r.feeding.PLL, 'boolean');
    assert.ok(r.plls.PLL, 'the SYS PLL appears in the map as well, under the id PLL');
    assert.equal(r.plls.PLL.output, 'PLLCLK');
  }
});

test('a part that spells the SYS PLL as plls.PLL is read identically', () => {
  const e = fresh();
  // Same CH32V006 tree, written the other way round: no `pll:`, one entry in `plls:`.
  e.registerMcuFile(`
mcu:
  name: CH32V006-PLLSMAP
  inherits: CH32V006
  remove: [clock.pll]
clock:
  plls:
    PLL:
      inputs:
        - { name: HSI, source: HSI, div: 1 }
        - { name: HSE, source: HSE, div: 1 }
      multipliers: [2]
`);
  e.loadMcu('CH32V006-PLLSMAP');
  assert.equal(e.S.clock.pllMul, 2);
  assert.deepEqual(Object.keys(e.S.clock).filter(n => n === 'plls'), [], 'the SYS PLL still lives in the flat keys');
  e.setClock({ sys: 'PLLCLK' });
  const r = e.clockCalc();
  assert.equal(r.PLLCLK, 48);
  assert.equal(r.SYSCLK, 48);
  assert.equal(r.feeding.PLL, true);
  assert.equal(r.selectable.pllMul.length, 1);
});

// ---------------------------------------------------------------------- codegen
//
// The RCC word used to be ONE register, and a part with a second PLL or a peripheral
// mux needs three (CH32H417: CFGR0, CFGR2, PLLCFGR2). Both halves are checked: the
// encoding, when the MCU file gives one; and the NOTE, when it does not — because a
// generated file that prints "USBFS USBHS_PLL_CLK /10 -> 48 MHz" in a comment and
// writes no CFGR2 bit is exactly the wrong-but-compiling output this round exists to
// remove.
const ENCODED = PLLS + `
codegen:
  rcc:
    extra:
      - register: "RCC->CFGR2"
        sources:
          USBFS: { lsb: 20, bits: 1, values: { PLLCLK: 0, USBHS_PLL_CLK: 1 } }
        prescalers:
          USBFS: { lsb: 16, bits: 4, values: { 1: 0, 2: 1, 5: 4, 10: 7 } }
      - register: "RCC->PLLCFGR2"
        plls:
          USBHS_PLL:
            src: { lsb: 0, bits: 2, values: { HSE: 0, HSI: 1 } }
          SERDES_PLL:
            src: { lsb: 2, bits: 2, values: { HSE: 0, PLLCLK: 3 } }
            mul: { lsb: 16, bits: 4, values: { 25: 0, 28: 1, 30: 2 } }
`;

test('a second register is written when the MCU file encodes it', () => {
  const e = fresh();
  e.registerMcuFile(ENCODED);
  e.loadMcu('CH32V006-PLLS');
  e.compute();
  const words = e.rccWords();
  assert.deepEqual(words.map(w => w.register), ['RCC->CFGR0', 'RCC->CFGR2', 'RCC->PLLCFGR2']);
  const cfgr2 = words[1];
  assert.equal((cfgr2.value >>> 20) & 1, 1, 'USBFSSRC = USBHS_PLL_CLK');
  assert.equal((cfgr2.value >>> 16) & 0xf, 7, 'USBFSDIV = "divided by 10"');
  assert.equal(cfgr2.mask >>> 0, (1 << 20) | (0xf << 16));
  assert.equal((words[2].value >>> 16) & 0xf, 0, 'SERDES multiplier 25 encodes as 0000');
  // and the C carries each register under its own fields
  const c = e.cSource();
  assert.match(c, /USBFS clock source = 1 \(bit 20\)/);
  assert.match(c, /RCC->CFGR2 = \(RCC->CFGR2 & ~0x[0-9A-Fa-f]+U?\) \| 0x[0-9A-Fa-f]+U?;/);
  assert.match(c, /RCC->PLLCFGR2 = /);
  assert.doesNotMatch(c, /not written:/, 'nothing is left unencoded');
});

test('a mux or a PLL with NO encoding is named in the C, not silently skipped', () => {
  const e = fresh();
  e.registerMcuFile(PLLS);                                  // inherits CH32V006's rcc, which has no `extra:`
  e.loadMcu('CH32V006-PLLS');
  e.compute();
  const head = e.rccWords()[0];
  const note = head.parts.find(p => p.what === 'not written');
  assert.ok(note, 'the gap is reported');
  assert.match(note.note, /USBFS's source mux/);
  assert.match(note.note, /USBHS_PLL/);
  assert.match(note.note, /SERDES_PLL/);
  assert.match(note.note, /codegen\.rcc\.extra/, 'and says what would close it');
  const c = e.cSource();
  assert.match(c, /USBHS_PLL: HSE -> USBHS_PLL_CLK 480 MHz \(fixed\)/, 'the C states the tree it is describing');
  assert.match(c, /USBFS USBHS_PLL_CLK \/10 -> 48 MHz \(must be 48 MHz\)/);
  assert.match(c, /not written: .*keep the reset value/);
});

test('the RCC word of a part with one register is byte-for-byte what it was', () => {
  // The refactor that made room for a second register must not have moved a bit on the
  // five parts that have one. Checked as the value AND the mask, per part.
  const want = {
    CH32V006: { register: 'RCC->CFGR0' },
    CH32V005: { register: 'RCC->CFGR0' },
    CH32X035: { register: 'RCC->CFGR0' },
  };
  for (const [part, w] of Object.entries(want)) {
    const e = fresh(part);
    const words = e.rccWords();
    assert.equal(words.length, 1, `${part} writes one register`);
    assert.equal(words[0].register, w.register);
    assert.equal(words[0].value, e.rccWord().value);
    assert.equal(words[0].mask, e.rccWord().mask);
    assert.ok(!words[0].parts.some(p => p.what === 'not written'), `${part} has nothing unencoded`);
  }
});

test('a PLL wired to itself reports nothing rather than hanging', () => {
  const e = fresh();
  e.registerMcuFile(PLLS.replace('{ name: HSE, source: HSE, div: 1 }\n        - { name: "SYS PLL /2", source: PLLCLK, div: 2 }\n      multipliers',
    '{ name: loop, source: SERDES_PLL_CLK, div: 1 }\n      multipliers'));
  e.loadMcu('CH32V006-PLLS');
  const r = e.clockCalc();
  assert.equal(r.SERDES_PLL_CLK, 0, 'unresolvable, so 0 and no number anybody could trace');
  assert.equal(r.USBFS, 48, 'and the rest of the tree still computes');
});
