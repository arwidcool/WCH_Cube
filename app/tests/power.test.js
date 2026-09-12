// =============================================================================
//  app/tests/power.test.js — the Power setup: supply domains and pin descriptions.
//
//  Two things the app now shows and could not before:
//    * `peripherals.<PID>.pins.supplies:` — the rails a peripheral governs, each with
//      its pads, its voltage range, what it feeds and a CITATION. A rail is a hardware
//      fact, so it lives in the MCU file; deriving it in the app from a pin's `type:`
//      would lose exactly the part a designer needs (VDDA may not exceed VDD) and would
//      guess which rail each pad belongs to.
//    * `pins.<NAME>.notes:` on the non-io pins — what a supply, ground, reset or strap
//      pin is and what to connect to it. These are what the hover card shows.
//
//  Both are asserted over EVERY shipped part rather than one, because the failure mode
//  is a part that was left half-written rather than one that is wrong.
// =============================================================================
import { test, assert, fresh, mcuNames, eng } from './_harness.js';

/** Every part that is real silicon (the synthetic fixture declares no supplies). */
const PARTS = () => mcuNames().filter(n => !/DUMMY/i.test(n));

test('every shipped part declares its supply domains, and each rail is cited', () => {
  for (const name of PARTS()) {
    const e = fresh(name);
    // Find the peripheral that declares them rather than naming it: the app does not
    // know which peripheral owns the power interface, and neither should a test.
    const owners = Object.keys(e.M.peripherals).filter(pid => e.suppliesOf(pid).length);
    assert.equal(owners.length, 1, `${name}: exactly one peripheral declares supplies (got ${owners.length})`);

    const rails = e.suppliesOf(owners[0]);
    assert.ok(rails.length >= 2, `${name}: ${rails.length} rail(s) - a part has at least a supply and a ground`);
    for (const r of rails) {
      assert.ok(r.name, `${name}: a rail with no name`);
      assert.ok(r.pins.length, `${name} ${r.name}: names no pad`);
      assert.ok(r.range, `${name} ${r.name}: states no voltage range`);
      assert.ok(r.note, `${name} ${r.name}: says nothing about what it feeds`);
      // The rule the whole project is built on: a hardware fact carries a source, and a
      // family is not a source - so this must name a DOCUMENT and a locator in it. The
      // part name alone would be a family; `CH32V003.md Table 2-1` is a document and a
      // table. The suffix is not fixed: V003's conversion is `CH32V003.md` while the
      // others are `<PART>DS0.md`, which is why this matches a `.md` file rather than
      // one spelling of it.
      assert.match(r.source, /\S+\.md/, `${name} ${r.name}: source names no document`);
      assert.match(r.source, /\d/, `${name} ${r.name}: source names no table, section or line`);
      for (const p of r.pins) {
        assert.ok(e.M.pins[p], `${name} ${r.name}: "${p}" is not a pin this part defines`);
      }
    }
  }
});

test('the declared rails are the part-supply pins, not a second opinion about them', () => {
  // The two must agree, and that is the point of checking rather than trusting: a rail
  // whose pad is typed `io` would be assignable as a GPIO, and a power/ground pin on no
  // rail would be invisible to the Power setup. Either way one of the two is wrong.
  for (const name of PARTS()) {
    const e = fresh(name);
    const pid = Object.keys(e.M.peripherals).find(p => e.suppliesOf(p).length);
    const declared = new Set(e.suppliesOf(pid).flatMap(r => r.pins));
    const typed = Object.entries(e.M.pins)
      .filter(([, v]) => v.type === 'power' || v.type === 'ground').map(([p]) => p);
    for (const p of typed) assert.ok(declared.has(p), `${name}: ${p} is a ${e.M.pins[p].type} pin on no rail`);
    for (const p of declared) {
      assert.ok(['power', 'ground'].includes(e.M.pins[p].type), `${name}: rail pad ${p} is typed ${e.M.pins[p].type}`);
    }
  }
});

test('every non-io pin of every part carries a note, which is what the hover shows', () => {
  // A supply pin with no note is the defect this whole change is about: the user hovers
  // VSSA and the app has nothing to say. `io` pins are excluded deliberately - their
  // note is the signal assignment, which the app knows already.
  const bare = [];
  for (const name of PARTS()) {
    const e = fresh(name);
    for (const [pin, v] of Object.entries(e.M.pins)) {
      if (v.type === 'io') continue;
      if (!v.notes || !String(v.notes).trim()) bare.push(`${name} ${pin} (${v.type})`);
    }
  }
  assert.deepEqual(bare, [], 'non-io pins with nothing to say on hover');
});

test('a rail is found by pad, so hovering a supply pin can name its domain', () => {
  const e = fresh('CH32H417');
  const V = (pin, want) => {
    const rail = e.suppliesOf('PWR').find(r => r.pins.includes(pin));
    assert.ok(rail, `no rail for ${pin}`);
    assert.equal(rail.name, want);
  };
  V('VDD33', 'VDD33');
  V('VREFP', 'VREFP');
  V('VSSA', 'VSS / VSSA');
  // and a pad that is not a rail answers nothing rather than the nearest guess
  assert.equal(e.suppliesOf('PWR').some(r => r.pins.includes('PA0')), false);
});

test('suppliesOf is empty for a peripheral that declares none, and never throws', () => {
  const e = fresh('CH32H417');
  for (const pid of Object.keys(e.M.peripherals)) {
    if (e.suppliesOf(pid).length) continue;
    assert.deepEqual(e.suppliesOf(pid), [], `${pid} declares no rails`);
  }
  assert.deepEqual(e.suppliesOf('NO_SUCH_PERIPHERAL'), [], 'an unknown peripheral is empty, not an error');
  // and a malformed block is normalised rather than leaking its shape into the view
  e.M.peripherals.PWR.pins.supplies = [{ name: 'V', pins: 'PA0' }, {}];
  const got = e.suppliesOf('PWR');
  assert.deepEqual(got.map(r => r.name), ['V'], 'an entry with no name is dropped');
  assert.deepEqual(got[0].pins, ['PA0'], 'a scalar `pins:` becomes a one-element list');
  assert.equal(got[0].range, '', 'a missing range is empty, not undefined');
  assert.equal(got[0].source, '');
});

test('the rail order is the data order, because it is the DS order', () => {
  // CH32H417's 1.4.3 states the ordering between four rails in prose at the end of the
  // section, so the list is read top-down in the file. Re-ordering it would put VIO18
  // above the rail it must never exceed.
  const e = fresh('CH32H417');
  assert.deepEqual(e.suppliesOf('PWR').map(r => r.name),
    ['VDD33', 'VDD33A', 'VDDIO', 'VIO18', 'VDD12A', 'VDDK', 'VREFP', 'VBAT', 'VSS / VSSA']);
});

test('the power peripheral is under System Core on every part', () => {
  // The tree groups by `category`, so a part whose power entry sits in a category of its
  // own moves when the part changes. CH32L103 shipped under plain `System`.
  for (const name of PARTS()) {
    const e = fresh(name);
    const pid = Object.keys(e.M.peripherals).find(p => e.suppliesOf(p).length);
    assert.equal(e.M.peripherals[pid].category, 'System Core', `${name}: ${pid} is not under System Core`);
  }
});

test('a supply declaration does not make the engine think the peripheral has pins', () => {
  // `pins:` is the declaration that a peripheral routes nothing, and `supplies:` rides in
  // that same block. It must not be read as a routing - no signal, no claim, no change to
  // what the configuration generates.
  const e = fresh('CH32H417');
  e.setSetting('PWR', 'Low power mode', 'Stop');
  e.compute();
  const before = e.cSource();
  assert.ok(before.includes('void WCHCube_PWR_Init(void)'), 'setup: PWR is configured');
  for (const pid of Object.keys(e.M.peripherals)) if (e.suppliesOf(pid).length) delete e.M.peripherals[pid].pins.supplies;
  e.compute();
  assert.equal(e.cSource(), before, 'deleting the rails changes not one byte of the C');
  assert.deepEqual([...e.requiredSignals('PWR')].filter(s => /VDD|VSS|VREF/.test(s)), [],
    'a rail is not a signal, so nothing can be assigned to it');
});
