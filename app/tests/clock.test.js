// clock.js — the clock tree maths (CH32V006: single HB domain, HSI 24 MHz, PLL x2).
import { test, assert, fresh, eng, read } from './_harness.js';

test('defaults come from the file: HSI 24 MHz straight through', () => {
  const e = fresh();
  const k = e.S.clock;
  assert.equal(k.sys, 'HSI');
  assert.equal(k.hse, 24);
  assert.equal(k.pllMul, 2);
  assert.deepEqual(k.pre, { HB: 1, ADC: 1 });
  const r = e.clockCalc();
  assert.equal(r.SYSCLK, 24);
  assert.equal(r.HCLK, 24);
  assert.equal(r.ADC, 24);
  assert.deepEqual(r.over, []);
});

test('the root prescaler is the one with no source (HB on V00x)', () => {
  const e = fresh();
  assert.equal(e.firstPre(e.M.clock), 'HB');
});

test('PLL x2 off HSI gives the full 48 MHz', () => {
  const e = fresh();
  e.S.clock.sys = 'PLLCLK';
  const r = e.clockCalc();
  assert.equal(r.pllIn, 24);
  assert.equal(r.PLLCLK, 48);
  assert.equal(r.SYSCLK, 48);
  assert.equal(r.HCLK, 48);
  assert.deepEqual(r.over, []);
});

test('PLL off HSE follows the crystal box', () => {
  const e = fresh();
  e.S.clock.pllIn = 1; e.S.clock.hse = 8; e.S.clock.sys = 'PLLCLK';
  const r = e.clockCalc();
  assert.equal(r.PLLCLK, 16);
  assert.equal(r.SYSCLK, 16);
});

test('SYSCLK over the datasheet maximum is flagged', () => {
  const e = fresh();
  e.S.clock.sys = 'HSE'; e.S.clock.hse = 25;          // legal crystal, legal SYSCLK
  assert.deepEqual(e.clockCalc().over, []);
  e.S.clock.pllIn = 1; e.S.clock.sys = 'PLLCLK';      // 25 x 2 = 50 MHz > 48
  const r = e.clockCalc();
  assert.equal(r.SYSCLK, 50);
  assert.ok(r.over.includes('SYSCLK'));
});

test('a crystal outside the HSE range is flagged', () => {
  const e = fresh();
  // read the limits from the file: the DS range is data, and it has been corrected once
  const { min_mhz, max_mhz } = e.M.clock.sources.HSE;
  e.S.clock.hse = max_mhz + 1;
  assert.ok(e.clockCalc().over.includes('HSE'), `${max_mhz + 1} MHz is above the ${max_mhz} MHz ceiling`);
  e.S.clock.hse = min_mhz - 1;
  assert.ok(e.clockCalc().over.includes('HSE'));
  e.S.clock.hse = min_mhz;
  assert.equal(e.clockCalc().over.includes('HSE'), false);
  e.S.clock.hse = max_mhz;
  assert.equal(e.clockCalc().over.includes('HSE'), false);
});

test('the HB prescaler divides SYSCLK into HCLK', () => {
  const e = fresh();
  e.S.clock.sys = 'PLLCLK'; e.S.clock.pre.HB = 4;
  const r = e.clockCalc();
  assert.equal(r.HCLK, 12);
  assert.equal(r.ADC, 12);
});

test('the ADC prescaler hangs off HB and has a minimum as well as a maximum', () => {
  const e = fresh();
  e.S.clock.sys = 'PLLCLK'; e.S.clock.pre.ADC = 4;    // 48 / 4 = 12 MHz, below the 16 MHz floor
  const r = e.clockCalc();
  assert.equal(r.ADC, 12);
  assert.ok(r.over.includes('ADC'));
  e.S.clock.pre.ADC = 2;                              // 24 MHz, in range
  assert.deepEqual(e.clockCalc().over, []);
});

test('derived taps are informational divisions of HCLK', () => {
  const e = fresh();
  e.S.clock.sys = 'PLLCLK';
  const r = e.clockCalc();
  assert.equal(r['Core SysTick'], 6);
  assert.equal(r['Flash time base'], 16);
});

test('every bundled MCU has a clock tree that computes without NaN', () => {
  const e = fresh();
  for (const name of Object.keys(e.MCU_FILES)) {
    e.loadMcu(e.MCU_FILES[name]);
    if (!e.M.clock) continue;
    for (const sys of e.M.clock.sysclk.sources) {
      e.S.clock.sys = sys;
      const r = e.clockCalc();
      assert.ok(Number.isFinite(r.SYSCLK), `${name} ${sys} SYSCLK is ${r.SYSCLK}`);
      assert.ok(Number.isFinite(r.HCLK), `${name} ${sys} HCLK is ${r.HCLK}`);
    }
  }
});

test('adcConversionUs turns the sampling parameter into a real conversion time', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  // 11.5 sampling + 11 SAR cycles at 24 MHz = 0.938 us
  const fast = e.adcConversionUs('ADC1');
  assert.ok(fast, 'CH32V006 ADC1 has a sampling-time parameter');
  assert.equal(fast.clockMhz, 24, 'the ADC prescaler output feeds it, not SYSCLK');
  assert.equal(fast.samplingCycles, 11.5);
  assert.equal(fast.totalCycles, 22.5);
  assert.equal(fast.us, 0.938);

  e.setParam('ADC1', 'sample', '239.5 cycles');
  const slow = e.adcConversionUs('ADC1');
  assert.equal(slow.totalCycles, 250.5);
  assert.equal(slow.us, 10.438);
  assert.ok(slow.ksps < fast.ksps, 'a longer sample means fewer samples per second');
});

test('the ADC conversion time follows the ADC prescaler, not the core clock', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const before = e.adcConversionUs('ADC1');
  e.setClock({ pre: { ADC: 2 } });
  const after = e.adcConversionUs('ADC1');
  assert.equal(after.clockMhz, before.clockMhz / 2);
  assert.ok(after.us > before.us, 'half the clock, twice the time');
});

test('a peripheral without a sampling parameter has no conversion time', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.equal(e.adcConversionUs('USART1'), null);
});

// ---------------------------------------------------------------------------
//  Round 2 P0 — the source muxes. The human could not pick HSI vs HSE, so every
//  one of these is a regression guard: the engine must accept every source the
//  MCU file lists, whatever RCC currently says.
// ---------------------------------------------------------------------------

test('every SYSCLK source in the data is accepted, on every bundled MCU', () => {
  const e = fresh();
  for (const name of Object.keys(e.MCU_FILES)) {
    e.loadMcu(e.MCU_FILES[name]);
    if (!e.M.clock) continue;
    for (const sys of e.M.clock.sysclk.sources) {
      e.setClock({ sys });                                  // must never throw
      assert.equal(e.S.clock.sys, sys, `${name}: setClock({sys:'${sys}'}) did not stick`);
    }
    for (let i = 0; i < ((e.M.clock.pll || {}).inputs || []).length; i++) {
      e.setClock({ pllIn: i });
      assert.equal(e.S.clock.pllIn, i, `${name}: PLL input ${i} did not stick`);
    }
  }
});

test('clockCalc reports the full option lists, never filtered by state', () => {
  const e = fresh();
  e.setClock({ sys: 'HSI' });
  const r = e.clockCalc();
  assert.deepEqual(r.selectable.sys, ['HSI', 'HSE', 'PLLCLK'], 'the SYSCLK mux offers all three with HSI selected');
  assert.deepEqual(r.selectable.pllIn.map(i => i.source), ['HSI', 'HSE']);
  assert.deepEqual(r.selectable.pre.HB, e.M.clock.prescalers.HB.options);
  e.setClock({ sys: 'HSE' });
  assert.deepEqual(e.clockCalc().selectable.sys, ['HSI', 'HSE', 'PLLCLK'], 'and all three with HSE selected');
});

test('clockCalc carries the round-2 shape the clock UI binds to', () => {
  const e = fresh();
  e.setClock({ sys: 'PLLCLK', pllIn: 1, hse: 8 });
  const r = e.clockCalc();
  assert.equal(r.sysclk, r.SYSCLK);
  assert.equal(r.hclk, r.HCLK);
  assert.equal(r.sources.HSE.mhz, 8);
  assert.equal(r.sources.HSI.mhz, 24);
  assert.equal(r.sources.HSE.feeding, true, 'HSE feeds the PLL, which feeds SYSCLK');
  assert.equal(r.sources.HSI.feeding, false);
  assert.equal(r.sources.HSI.fixed, true);
  assert.equal(r.sources.HSE.editable, true);
  assert.equal(r.pll.in, 8);
  assert.equal(r.pll.out, 16);
  assert.equal(r.pll.source, 'HSE');
  assert.equal(r.pll.feeding, true);
  assert.equal(r.feeding['pre:HB'], true);
  assert.equal(r.feeding['drv:Core SysTick'], true);
  assert.deepEqual(r.under, []);
});

test('under is the too-slow subset of over, so a UI can word them differently', () => {
  const e = fresh();
  e.setClock({ sys: 'PLLCLK', pre: { ADC: 128 } });          // 48 / 128 = 0.375 MHz, floor is 16
  const r = e.clockCalc();
  assert.ok(r.over.includes('ADC'));
  assert.ok(r.under.includes('ADC'));
  e.setClock({ hse: e.M.clock.sources.HSE.max_mhz + 1 });    // above the datasheet ceiling
  const r2 = e.clockCalc();
  assert.ok(r2.over.includes('HSE'));
  assert.equal(r2.under.includes('HSE'), false, 'too fast is not "under"');
});

test('picking HSE turns the crystal on in RCC and claims XI/XO', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.equal(e.S.periph.RCC.settings['High Speed Clock (HSE)'], 'Disable');
  const changed = e.setClock({ sys: 'HSE' });
  assert.equal(e.S.clock.sys, 'HSE');
  assert.equal(e.S.periph.RCC.settings['High Speed Clock (HSE)'], 'Crystal / ceramic resonator');
  assert.deepEqual(changed.hse.pins, ['PA1', 'PA2'], 'the toast can name the pins it just took');
  e.compute();
  assert.equal(e.E.pins.PA1.claims[0].signal, 'RCC_XI');
  assert.equal(e.E.pins.PA2.claims[0].signal, 'RCC_XO');
});

test('HSE as the PLL input counts as feeding SYSCLK, and enables the crystal too', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setClock({ sys: 'PLLCLK' });                             // PLL is on HSI: no crystal yet
  assert.equal(e.S.periph.RCC.settings['High Speed Clock (HSE)'], 'Disable');
  e.setClock({ pllIn: 1 });                                  // now the PLL runs off HSE
  assert.equal(e.S.periph.RCC.settings['High Speed Clock (HSE)'], 'Crystal / ceramic resonator');
});

test('the crystal switching on is ONE undo step with the clock change', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.clearHistory();
  e.setClock({ sys: 'HSE' });
  assert.equal(e.historyDepth().undo, 1, 'one step, not two');
  assert.equal(e.undo(), 'Clock');
  assert.equal(e.S.clock.sys, 'HSI');
  assert.equal(e.S.periph.RCC.settings['High Speed Clock (HSE)'], 'Disable', 'undo puts RCC back too');
});

test('switching back to HSI leaves the crystal exactly as the user set it', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setClock({ sys: 'HSE' });
  e.setClock({ sys: 'HSI' });
  assert.equal(e.S.clock.sys, 'HSI');
  assert.equal(e.S.periph.RCC.settings['High Speed Clock (HSE)'], 'Crystal / ceramic resonator',
    'CubeMX does not switch HSE off behind the user');
  e.compute();
  assert.equal(e.E.pins.PA1.state, 'set', 'and it still holds XI');
});

test('a crystal the user set to BYPASS is not overwritten by picking HSE', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('RCC', 'High Speed Clock (HSE)', 'BYPASS clock source');
  const changed = e.setClock({ sys: 'HSE' });
  assert.equal(e.S.periph.RCC.settings['High Speed Clock (HSE)'], 'BYPASS clock source');
  assert.equal(changed.hse, undefined, 'nothing to report: it was already on');
});

test('HSE on remap 101 collides with SPI1_SCK on PA1, through the normal conflict engine', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('SPI1', 'Mode', 'Full-Duplex Master');
  e.setRemap('SPI1', 5);                                     // SPI1_RM=101: SCK on PA1
  e.setClock({ sys: 'HSE' });
  e.compute();
  const hit = e.E.conflictList.find(c => c.signals.includes('RCC_XI'));
  assert.ok(hit, 'PA1 is claimed twice: ' + JSON.stringify(e.E.conflicts));
  assert.deepEqual(hit.owners.slice().sort(), ['RCC', 'SPI1']);
});

test('setClock refuses what the data does not offer, and says what it does', () => {
  const e = fresh();
  assert.throws(() => e.setClock({ sys: 'LSI' }), /HSI, HSE, PLLCLK/);
  assert.throws(() => e.setClock({ pllIn: 7 }), /pllIn/);
  assert.throws(() => e.setClock({ pllMul: 9 }), /pllMul/);
  assert.throws(() => e.setClock({ pre: { HB: 5000 } }), /pre\.HB/);
  assert.throws(() => e.setClock({ pre: { AHB: 2 } }), /prescaler/);
  assert.throws(() => e.setClock({ nonsense: 1 }), /unknown field/);
  assert.throws(() => e.setClock({ hse: 0 }), /positive number/);
  assert.equal(e.S.clock.sys, 'HSI', 'a refused call changes nothing');
});

test('an out-of-datasheet crystal is accepted and shown red, not refused', () => {
  const e = fresh();
  const tooFast = e.M.clock.sources.HSE.max_mhz + 1;
  e.setClock({ hse: tooFast });
  assert.equal(e.S.clock.hse, tooFast, 'the engine takes the number and lets the UI redden it');
  assert.ok(e.clockCalc().over.includes('HSE'));
});

test('the coupling is read from the data, never hard-coded to RCC or to XI/XO', () => {
  const e = fresh();
  const h = e.hseSetting();
  assert.equal(h.pid, e.M.clock.hse_peripheral || 'RCC');
  assert.equal(h.setting, e.M.clock.hse_setting || 'High Speed Clock (HSE)');

  // the dummy part deliberately calls its crystal pins OSC_IN / OSC_OUT
  e.loadMcu(e.MCU_FILES['WCH-DUMMY32-C8']);
  const d = e.hseSetting();
  assert.deepEqual(d.signals, ['OSC_IN', 'OSC_OUT']);
  e.setClock({ sys: 'HSE' });
  assert.equal(e.S.periph[d.pid].settings[d.setting], d.crystal);
  e.compute();
  const held = Object.entries(e.E.pins).filter(([, v]) => v.claims.some(c => /OSC_(IN|OUT)/.test(c.signal)));
  assert.equal(held.length, 2, 'both crystal pins are claimed on the dummy part too');
});

// =============================================================================
//  Round 4 P0b — the engine reads the MCU file, or it has a CH32V006 assumption
// =============================================================================
//  CH32X035 is the first part that is not shaped like CH32V006: no HSE at all,
//  24-bit ports, a port with holes in it, different clock-domain names. Each test
//  here is a place where the engine could have baked one of those in, and the point
//  is that the answer is checkable rather than assumed.

test('a part with no HSE has no HSE anywhere - not in the state, the maths or the C', () => {
  const e = fresh();
  if (!eng.MCU_FILES.CH32X035) return;
  e.loadMcu('CH32X035');
  e.compute();

  assert.equal(e.M.clock.sources.HSE, undefined, 'setup: ch32x035_rcc.h mentions HSE zero times');
  assert.deepEqual(e.M.clock.sysclk.sources, ['HSI'], 'one source, and the data says which');

  // nothing throws, nothing warns, nothing is placed
  assert.equal(e.hseFeedsSysclk(), false);
  const r = e.clockCalc();
  assert.ok(Number.isFinite(r.SYSCLK) && r.SYSCLK > 0, `SYSCLK is a number (${r.SYSCLK})`);
  assert.deepEqual(r.over, [], 'and it is in specification');
  assert.deepEqual(r.selectable.sys, ['HSI'], 'the clock tab offers exactly what the data lists');
  assert.deepEqual(e.E.conflictList, []);
  assert.deepEqual(Object.values(e.E.issues).flat(), []);

  // asking for it is refused by name rather than half-applied
  assert.throws(() => e.setClock({ sys: 'HSE' }), /is not offered by CH32X035/);
  assert.deepEqual(e.clockCalc().selectable.sys, ['HSI'], 'and the refusal changed nothing');
});

test('the generated clock note names the sources this part actually has to start', () => {
  const withHse = fresh('CH32V006', 'TSSOP20');
  withHse.compute();
  assert.match(withHse.cSource(), /Starting HSE[\s\S]{0,40}waiting for it to lock/,
    'CH32V006 has an HSE and a PLL to start');

  const e = fresh();
  if (!eng.MCU_FILES.CH32X035) return;
  e.loadMcu('CH32X035');
  e.compute();
  const c = e.cSource();
  assert.equal(/HSE/.test(c), false,
    'a part with no HSE must not be told about one, not even in a comment');
  assert.match(c, /runs from reset, so there is nothing to start or wait for/);
});

test('the engine names no part and no peripheral', () => {
  // Round-4 DONE line, not a style note. Citations in comments are required by the
  // round rules and are not code, so only real code counts.
  const files = ['util', 'inherit', 'history', 'model', 'params', 'clock',
    'resources', 'engine', 'project', 'codegen', 'export'];
  const offenders = [];
  for (const name of files) {
    const src = read(`app/engine/${name}.js`);
    // Block comments are stripped from the WHOLE file first - a citation spans lines,
    // and the round rules require citations, so only real code counts.
    const lines = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).split(/\r?\n/);
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/CH32|x035|X035|V006|v00[0-9]/.test(code)) {
        offenders.push(`${name}.js:${i + 1}  ${src.split(/\r?\n/)[i].trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], 'a part name in engine CODE is a part the engine special-cases');
});

test('every bundled part computes a clock tree, whatever shape it is', () => {
  for (const name of Object.keys(eng.MCU_FILES)) {
    const e = fresh();
    e.loadMcu(name);
    e.compute();
    if (!e.M.clock) continue;
    const r = e.clockCalc();
    assert.ok(Number.isFinite(r.SYSCLK), `${name}: SYSCLK is ${r.SYSCLK}`);
    assert.ok(Number.isFinite(r.HCLK), `${name}: HCLK is ${r.HCLK}`);
    for (const [k, v] of Object.entries(r)) {
      if (k === 'over' || k === 'under' || k === 'selectable') continue;
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${name}: ${k} is ${v}`);
    }
    // and every source the data offers is selectable, on every part
    for (const src of e.M.clock.sysclk.sources) {
      assert.ok(r.selectable.sys.includes(src), `${name}: ${src} is listed but not selectable`);
    }
  }
});

test('a port is iterated as the pins the data lists, never as a range', () => {
  const e = fresh();
  if (!eng.MCU_FILES.CH32X035) return;
  e.loadMcu('CH32X035');
  e.setPackage('LQFP64M');
  e.compute();
  // PC has holes. Anything doing `for (i = 0; i <= max; i++)` over a port would produce
  // pins the datasheet never names, and they would silently reach the generated C.
  const pc = Object.keys(e.M.pins).filter(p => /^PC\d+$/.test(p)).map(p => +p.slice(2));
  const max = Math.max(...pc);
  const missing = [];
  for (let i = 0; i <= max; i++) if (!pc.includes(i)) missing.push(i);
  assert.ok(missing.length, `setup: PC really has holes (${missing.join(',')})`);

  for (const n of missing) {
    assert.equal(e.pinExists(`PC${n}`), false, `PC${n} is not a pin on this part`);
    assert.throws(() => e.assignSignal(`PC${n}`, { gpio: 'GPIO_Output' }),
      /./, `assigning PC${n} must fail rather than invent it`);
  }
  assert.deepEqual(e.gpioPlan().filter(r => r.port === 'C' && missing.includes(r.bit)), [],
    'and no hole ever reaches the plan');
});
