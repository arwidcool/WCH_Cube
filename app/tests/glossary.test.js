// =============================================================================
//  app/tests/glossary.test.js — what a peripheral's name means, and the boundary.
//
//  The rule this module is built on, and the one the tests are shaped around: an
//  acronym's expansion is VOCABULARY (one sentence in every part's file if it lived in
//  the files, so it lives here — the same argument PIN_KIND and the GPIO mode lists
//  follow), while anything that can differ BETWEEN parts is DATA and overrides this.
//
//  So there are two things to hold: every shipped peripheral is named, and nothing is
//  named that the data did not ask for. An unknown block gets empty strings rather than
//  a guess, which is the same refusal as `modeMacro()` and `structVar()`.
// =============================================================================
import { test, assert, fresh, mcuNames, eng } from './_harness.js';

/** Every real part. The synthetic fixture is not silicon; it still must not crash. */
const PARTS = () => mcuNames().filter(n => !/DUMMY/i.test(n));

test('every peripheral of every shipped part has a full name and a description', () => {
  const missing = [];
  for (const name of PARTS()) {
    const e = fresh(name);
    for (const pid of Object.keys(e.M.peripherals)) {
      const n = e.peripheralName(e.M, pid);
      if (!n.title) missing.push(`${name} ${pid}: no title`);
      if (!n.what) missing.push(`${name} ${pid}: no description`);
    }
    // and the two virtual tree entries, which are not in `M.peripherals` at all
    for (const pid of ['GPIO', 'NVIC']) {
      const n = e.peripheralName(e.M, pid);
      if (!n.title || !n.what) missing.push(`${name} ${pid}: the tree shows it, so it needs a name`);
    }
  }
  assert.deepEqual(missing, []);
});

test('a title is a name, not a sentence, and a description is a sentence', () => {
  // Cheap shape checks with real teeth: the first version of this table had a stray
  // multi-clause line in a `title` field, which rendered as a heading two lines long.
  const bad = [];
  for (const name of PARTS()) {
    const e = fresh(name);
    for (const pid of Object.keys(e.M.peripherals)) {
      const n = e.peripheralName(e.M, pid);
      if (!n.title) continue;
      if (n.title.length > 74) bad.push(`${name} ${pid}: title is ${n.title.length} chars`);
      if (/[.;]$/.test(n.title)) bad.push(`${name} ${pid}: title ends like a sentence`);
      if (n.what && n.what.length < 40) bad.push(`${name} ${pid}: description is ${n.what.length} chars`);
      // A citation lives in `what` where it is needed and never in a title
      if (/\.md|\d+:\d+/.test(n.title)) bad.push(`${name} ${pid}: title carries a citation`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the instance number is stripped for the lookup, and the exact name still wins', () => {
  const e = fresh('CH32H417');
  // an instance: `USART7` resolves through `USART`
  const u = e.peripheralName(e.M, 'USART7');
  assert.equal(u.base, 'USART');
  assert.equal(u.instance, '7');
  assert.match(u.title, /Universal synchronous/);
  // an exact key beats the base, which is the whole reason TIM1 can differ from TIM
  const t1 = e.peripheralName(e.M, 'TIM1');
  const t2 = e.peripheralName(e.M, 'TIM2');
  assert.match(t1.title, /Advanced-control/);
  assert.match(t2.title, /^Timer$/);
  assert.notEqual(t1.what, t2.what, 'an advanced-control timer is not a general one');
  // and a name with no digits is looked up as itself, letters and all
  for (const pid of ['USBFS', 'USBHS', 'USBSS', 'SDIO', 'SDMMC', 'GPHA', 'I3C', 'I2S2']) {
    const n = e.peripheralName(e.M, pid);
    assert.ok(n.title, `${pid} has no name`);
  }
  assert.equal(e.peripheralName(e.M, 'I2S2').base, 'I2S', 'I2S2 is the second I2S, not "I" plus "2S2"');
});

test('an id nobody knows gets NOTHING, not the nearest guess', () => {
  const e = fresh('CH32H417');
  for (const pid of ['NOSUCHBLOCK', 'X', '1234', 'TIM99Z', '']) {
    const n = e.peripheralName(e.M, pid);
    assert.equal(n.title, '', `${pid}: a guess would be worse than a blank`);
    assert.equal(n.what, '');
    assert.equal(n.source, '');
  }
  assert.equal(e.peripheralLabel(e.M, 'NOSUCHBLOCK'), 'NOSUCHBLOCK', 'the label falls back to the bare id');
});

test('the MCU file overrides the glossary, per half', () => {
  const e = fresh('CH32H417');
  const before = e.peripheralName(e.M, 'SDIO');
  assert.equal(before.source, 'glossary');
  const saved = e.M.peripherals.SDIO.title;
  e.M.peripherals.SDIO.title = 'SD card host, this part only';
  const named = e.peripheralName(e.M, 'SDIO');
  assert.equal(named.title, 'SD card host, this part only');
  // `source` says where the ANSWER came from, and the answer is still half glossary: a
  // part that renames a block without re-describing it has not replaced the description.
  assert.equal(named.source, 'mcu+glossary');
  assert.equal(named.what, before.what, 'the description still comes from the glossary');
  // a `desc:` alone overrides only the description
  delete e.M.peripherals.SDIO.title;
  e.M.peripherals.SDIO.desc = 'Two cards on one bus on this part (DS 1.2).';
  const described = e.peripheralName(e.M, 'SDIO');
  assert.equal(described.what, 'Two cards on one bus on this part (DS 1.2).');
  assert.equal(described.title, before.title, 'the name still comes from the glossary');
  assert.equal(described.source, 'mcu+glossary');
  if (saved === undefined) delete e.M.peripherals.SDIO.title; else e.M.peripherals.SDIO.title = saved;
});

test('an unknown peripheral can be NAMED by the data alone', () => {
  // The escape hatch that keeps this table from being the ceiling: a block the glossary
  // has never heard of is named by its own MCU file, and no engine change is needed.
  const e = fresh('CH32H417');
  e.M.peripherals.WIDGET = { category: 'Connectivity', title: 'Widget engine', desc: 'Does widget things.' };
  const n = e.peripheralName(e.M, 'WIDGET');
  assert.equal(n.title, 'Widget engine');
  assert.equal(n.what, 'Does widget things.');
  assert.equal(n.source, 'mcu');
  assert.deepEqual(e.unnamedPeripherals(e.M), [], 'and it is no longer reported as unnamed');
});

test('unnamedPeripherals reports what the table cannot name, per part', () => {
  // The honest half of the boundary: an unknown block is blank rather than wrong, and
  // this is how the blank becomes visible instead of silent. It is empty on every part
  // that ships, and a plant proves the query can fail.
  for (const name of PARTS()) {
    const e = fresh(name);
    assert.deepEqual(e.unnamedPeripherals(e.M), [], `${name}: a peripheral the app cannot name`);
  }
  const e = fresh('CH32H417');
  e.M.peripherals.MYSTERY = { category: 'Connectivity' };
  assert.deepEqual(e.unnamedPeripherals(e.M), ['MYSTERY'],
    'a block with no glossary entry and no title: is reported');
  // ...and one that only the DATA can explain is NOT reported, because the data did
  e.M.peripherals.MYSTERY.title = 'Mystery block';
  assert.deepEqual(e.unnamedPeripherals(e.M), []);
});

test('the glossary is keyed by name, so a new instance costs nothing', () => {
  const e = fresh('CH32H417');
  // A tenth USART that does not exist on any part yet must still be named: the table is
  // keyed on the family, not on the instances one part happens to have.
  const n = e.peripheralName(e.M, 'USART10');
  assert.equal(n.base, 'USART');
  assert.equal(n.instance, '10');
  assert.match(n.title, /Universal synchronous/);
});

test('PERIPHERAL_VOCAB carries the two virtual tree entries directly - GPIO and NVIC are not in M.peripherals at all', () => {
  // Every test above reaches this table only THROUGH peripheralName(); this is the one
  // place the table itself is read by name (tests/features.test.js's export-coverage
  // sweep, main 2026-09-14). GPIO/NVIC are the sharpest case: peripheralName()'s DATA-
  // override rule ("the MCU file overrides this") cannot apply to them, since neither
  // is a document a part's `peripherals:` block can even carry a title: for.
  assert.ok(eng.PERIPHERAL_VOCAB.GPIO && eng.PERIPHERAL_VOCAB.GPIO.title && eng.PERIPHERAL_VOCAB.GPIO.what);
  assert.ok(eng.PERIPHERAL_VOCAB.NVIC && eng.PERIPHERAL_VOCAB.NVIC.title && eng.PERIPHERAL_VOCAB.NVIC.what);
  // Every entry in the table follows the same title/description shape - the exact
  // contract 'a title is a name, not a sentence' above checks through peripheralName().
  for (const [id, entry] of Object.entries(eng.PERIPHERAL_VOCAB)) {
    assert.equal(typeof entry.title, 'string', `${id}: title is a string`);
    assert.ok(entry.title.length, `${id}: title is non-empty`);
    assert.equal(typeof entry.what, 'string', `${id}: what is a string`);
    assert.ok(entry.what.length, `${id}: what is non-empty`);
  }
});
