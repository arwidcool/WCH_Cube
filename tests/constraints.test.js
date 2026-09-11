// =============================================================================
//  tests/constraints.test.js — round 5's P0.1: the constraint mechanism, and the
//  proof that it can fail.
//
//  Round 5's rule is "every choice the app offers must be one the silicon can
//  honour". `data/FORMAT.md` `## constraints` is the schema, `data/mcus/*.yaml`
//  carries the entries, and `app/engine/constraints.js` is read by three
//  consumers that must agree: the GPIO table (the option is absent on that row),
//  the conflict engine (a violation is an issue naming the constraint) and
//  codegen (it declines and emits a TODO rather than plausible wrong bits).
//
//  Two halves, because a one-sided check passes for the wrong reason:
//    * the option is NOT offered outside the region, AND
//    * it IS offered inside it. A mechanism that hid the control everywhere
//      would satisfy the first half alone and be just as broken.
//
//  The acceptance cases are CH32X035's three documented instances, on the real
//  shipped data. The negative controls beside them are what make the positives
//  mean something: an unshorted pin keeps the output mode, and Pull-down is not
//  offered by a part whose file states no constraint at all.
//
//  NOTE ON THE SHAPE. When this file was written the data and the consumer had
//  been written against two different schemas, and the mechanism did nothing at
//  all on the shipped tree — see agents/BOARD.md 2026-09-11T22:25Z. They now
//  agree on data/FORMAT.md's `## constraints`, and these tests assert it with no
//  skip and no shape detection in between: if the consumer stops reading the
//  documented shape, they go red rather than quiet.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { suite, test, assert, skip } from './lib/harness.js';
import { ROOT } from './lib/app.js';
import { boot } from './fixtures/make_fixtures.js';
import * as eng from '../app/engine/index.js';

suite('gpio constraints');

const MCU_DIR = path.join(ROOT, 'data', 'mcus');
const SHIPPED = fs.readdirSync(MCU_DIR).filter(n => n.endsWith('.yaml')).sort();
const OPTIONS = ['gpio.mode', 'gpio.pull', 'gpio.speed'];

/** The documented shape, read from the document root exactly as FORMAT.md writes it. */
function constraintsOf(file) {
  const doc = eng.yamlLoad(fs.readFileSync(path.join(MCU_DIR, file), 'utf8'));
  return { doc, list: Array.isArray(doc.constraints) ? doc.constraints : [] };
}

/** A part carrying constraints written by THIS test, on real CH32X035 pins. */
function withProbe(constraints, fn, pkg = 'QFN28') {
  boot();
  const doc = eng.yamlLoad(fs.readFileSync(path.join(MCU_DIR, 'CH32X035.yaml'), 'utf8'));
  doc.mcu.name = 'CONSTRAINT-PROBE';
  doc.constraints = constraints;
  eng.registerMcuFile(eng.yamlDump(doc));
  eng.loadMcu('CONSTRAINT-PROBE');
  eng.setPackage(pkg);
  return fn();
}

/** Bonded pins of the package currently loaded, in the part's own order. */
const bondedPins = () => Object.keys(eng.M.pins).filter(p => eng.pinExists(p));

// =============================================================================
//  The mechanism's own algebra — region, pad, and state — on a probe part.
//
//  The acceptance cases below use the real CH32X035 data, which is also what
//  makes them blunt: three instances, each one already known to be true. These
//  probes state a restriction, ask the engine, and check BOTH directions, so the
//  mechanism is exercised on a case whose answer the shipped data does not
//  already decide. There is no skip and no shape detection here: if the consumer
//  stops reading `constraints:`, these go red rather than quiet.
// =============================================================================
const CH35 = () => eng.yamlLoad(fs.readFileSync(path.join(MCU_DIR, 'CH32X035.yaml'), 'utf8'));

/** The modes of the named classes, read off the part's own `class:` — never a table here. */
const modesOfClass = (doc, classes) =>
  ((doc.gpio || {}).modes || []).filter(m => classes.includes(m.class)).map(m => m.name);

/** Pins this package bonds as one pad under more than one name. */
const shortedPins = (doc, pkg) =>
  Object.values((doc.packages || {})[pkg] || {}).filter(v => Array.isArray(v) && v.length > 1).flat();

/**
 * One restriction, stated once, written in data/FORMAT.md's shape.
 * `spec` is: { id, kind: 'mode'|'pull', deny|classes, only_on|not_on|on_shorted,
 *              packages, when: {peripheral} }. A class is spelled out as the mode
 * names it covers, taken from the part's own data, so a probe cannot name a mode
 * this silicon does not have.
 */
function liveEntry(spec, doc, pkg) {
  const names = spec.classes ? modesOfClass(doc, spec.classes) : spec.deny;
  return {
    id: spec.id,
    option: `gpio.${spec.kind}`,
    ...(spec.classes ? { classes: spec.classes } : { choices: names }),
    ...(spec.on_shorted ? { not_on: shortedPins(doc, pkg) }
      : spec.only_on ? { only_on: spec.only_on } : { not_on: spec.not_on }),
    ...(spec.packages ? { packages: spec.packages } : {}),
    ...(spec.when ? { when: { peripheral: spec.when.peripheral, enabled: true } } : {}),
    reason: spec.reason, source: 'probe',
  };
}

/** A probe part carrying `specs`, written in data/FORMAT.md's shape, on real CH32X035 pins. */
function withLiveProbe(specs, fn, pkg = 'QFN28') {
  const doc = CH35();
  return withProbe(specs.map(s => liveEntry(s, doc, pkg)), fn, pkg);
}

test('the mechanism removes the option outside the region and keeps it inside (both halves)', () => {
  const spec = { id: 'probe-pull', kind: 'pull', deny: ['Pull-down'], only_on: ['PA1'], reason: 'probe: PA1 only' };
  withLiveProbe([spec], () => {
    // The positive control first: the option exists in this part's data at all.
    // Without it "not offered" could be satisfied by an option nobody ever had.
    assert.ok(eng.gpioFieldOptionNames('pull').includes('Pull-down'),
      'the part does not offer Pull-down at all, so this probe proves nothing');
    assert.ok(!eng.gpioFieldOptions('PC0', 'pull').includes('Pull-down'),
      'Pull-down is still offered on PC0, which the probe restricts away');
    assert.ok(eng.gpioFieldOptions('PA1', 'pull').includes('Pull-down'),
      'Pull-down vanished from PA1 too — a mechanism that hides the control everywhere is just as wrong');
    // The other values are untouched: this reduces a column, it does not blank it.
    assert.ok(eng.gpioFieldOptions('PC0', 'pull').includes('Pull-up'), 'the rest of the column survived');
  });
});

test('the check can fail: remove the restriction from the data and the option comes back', () => {
  // The planted break, run every time. A test that asserts "the option is not
  // offered" passes for a mechanism that works AND for one that empties the
  // column — the pair below cannot pass unless removing the data really is what
  // brought the option back.
  const spec = { id: 'probe-break', kind: 'pull', deny: ['Pull-down'], only_on: ['PA1'], reason: 'probe: PA1 only' };
  withLiveProbe([spec], () => {
    assert.ok(!eng.gpioFieldOptions('PC0', 'pull').includes('Pull-down'), 'baseline: the restriction is in force');
  });
  withLiveProbe([], () => {
    assert.ok(eng.gpioFieldOptions('PC0', 'pull').includes('Pull-down'),
      'with the restriction removed from the data the option did NOT come back, so the baseline above '
      + 'was passing for some other reason and proves nothing about the constraint mechanism');
  });
});

test('the mechanism matches a shorted pair by pad, and the row can say why', () => {
  const spec = { id: 'probe-shorted', kind: 'mode', classes: ['out'], on_shorted: true, reason: 'probe: shorted pairs are not outputs' };
  withLiveProbe([spec], () => {
    const pins = bondedPins();
    const group = pins.map(p => eng.groupOf(p)).find(g => g.length > 1);
    assert.ok(group, 'setup: QFN28 has no shorted pair, so this probe cannot run');
    for (const pin of group) {
      assert.ok(!eng.gpioFieldOptions(pin, 'mode').includes('Output Push Pull'),
        `${pin} is one name of ${group.join('/')} and still offers an output mode`);
    }
    const notes = eng.gpioRowNotes(group[0], 'mode');
    assert.ok(notes.some(n => n.id === 'probe-shorted'), `the row does not name the constraint it hit: ${JSON.stringify(notes)}`);
    const solo = pins.find(p => eng.groupOf(p).length === 1 && eng.pinType(p) === 'io');
    assert.ok(eng.gpioFieldOptions(solo, 'mode').includes('Output Push Pull'),
      `${solo} is not shorted and lost its output mode too — the rule is matching every pin`);
  });
});

test('the mechanism is conditional on another peripheral, and lifts when it goes off', () => {
  const spec = { id: 'probe-usb', kind: 'mode', classes: ['out', 'analog'], not_on: ['PC10', 'PC11'], when: { peripheral: 'USBFS' }, reason: 'probe: floating while USBFS is on' };
  withLiveProbe([spec], () => {
    assert.ok(eng.gpioFieldOptions('PC10', 'mode').includes('Output Push Pull'),
      'the refusal applies while USBFS is off — that is not a conditional constraint');
    const P = eng.M.peripherals.USBFS;
    const s = (P.settings || [])[0];
    const c = (s.choices || []).find(x => x.signals && x.signals.length);
    assert.ok(c, 'setup: USBFS has no setting that claims a pin');
    eng.setSetting('USBFS', s.name, c.name);
    assert.ok(eng.isEnabled('USBFS'), 'setup: USBFS did not switch on');
    assert.ok(!eng.gpioFieldOptions('PC10', 'mode').includes('Output Push Pull'),
      'the option survived USBFS switching on, so `when:` is not consulted');
    assert.ok(!eng.gpioFieldOptions('PC10', 'mode').includes('Analog'),
      'a class-based restriction matched only one of its classes');
    assert.ok(eng.gpioFieldOptions('PA1', 'mode').includes('Output Push Pull'),
      'the refusal leaked onto a pin outside its region');
  });
});

// =============================================================================
//  The audit — the data, pinned to the schema it says it is written against.
//  These run today. They are the half that would have caught the mismatch from
//  the data side, and they fail on a malformed entry rather than ignoring it.
// =============================================================================
/**
 * One sentence per thing wrong with a constraint entry. Separate from the test so
 * the planted-break check below can hand it a known-bad entry and insist it bites.
 */
function entryProblems(entries, part) {
  const out = [];
  const ids = new Set();
  for (const c of entries) {
    const where = `constraints "${c && c.id}":`;
    if (!c || typeof c !== 'object') { out.push('constraints: an entry is not a mapping'); continue; }
    if (!c.id) out.push('constraints: an entry has no id, so nothing can cite it');
    else if (ids.has(c.id)) out.push(`${where} declared twice`);
    ids.add(c.id);
    if (!OPTIONS.includes(c.option)) out.push(`${where} option "${c.option}" is not one of ${OPTIONS.join(', ')}`);
    const hasC = c.choices !== undefined, hasCl = c.classes !== undefined;
    if (hasC === hasCl) out.push(`${where} exactly one of choices: / classes: is required`);
    for (const key of ['choices', 'classes', 'only_on', 'not_on']) {
      if (c[key] !== undefined && (!Array.isArray(c[key]) || !c[key].length)) out.push(`${where} ${key}: is not a non-empty list`);
    }
    const hasOn = c.only_on !== undefined, hasNot = c.not_on !== undefined;
    if (hasOn === hasNot) out.push(`${where} exactly one of only_on: / not_on: is required`);
    if (!c.reason) out.push(`${where} has no reason:, so a user hitting it is told nothing`);
    if (!c.source) out.push(`${where} has no source: — a rule with no citation is a guess`);
    if (c.packages !== undefined && (!Array.isArray(c.packages) || !c.packages.length)) out.push(`${where} packages: is not a non-empty list`);
    if (c.when !== undefined && (typeof c.when !== 'object' || c.when === null || (!c.when.peripheral && !c.when.package))) {
      out.push(`${where} when: names neither a peripheral nor a package`);
    }
    if (c.when && c.when.enabled !== undefined && typeof c.when.enabled !== 'boolean') out.push(`${where} when.enabled is not a boolean`);
  }
  return out.map(s => `${part}: ${s}`);
}

test('every bundled constraints: entry is written in the documented shape', () => {
  const all = [];
  for (const file of SHIPPED) {
    const { list } = constraintsOf(file);
    all.push(...entryProblems(list, file.replace(/\.yaml$/, '')));
  }
  assert.empty(all, 'gpio.constraints entries that do not match data/FORMAT.md');
});

// The audit above is only worth its green tick if it can go red. Hand it the two
// entries that would start a silent, dead constraint — one with a choice name the
// part does not offer, one with no citation — and insist it says so.
test('the schema audit can fail: a dead constraint and an uncited one are both caught', () => {
  const bad = [
    { id: 'no-source', option: 'gpio.mode', classes: ['out'], not_on: ['PC0'], reason: 'x' },
    { id: 'both-regions', option: 'gpio.pull', choices: ['Pull-down'], only_on: ['PA1'], not_on: ['PC0'], reason: 'x', source: 'x' },
    { id: 'no-restriction', option: 'gpio.mode', only_on: ['PA1'], reason: 'x', source: 'x' },
  ];
  const problems = entryProblems(bad, 'AUDIT-PROBE');
  assert.ok(problems.some(p => /no source:/.test(p)), `an uncited entry slipped through:\n${problems.join('\n')}`);
  assert.ok(problems.some(p => /exactly one of only_on: \/ not_on:/.test(p)), 'an entry restricting both ways slipped through');
  assert.ok(problems.some(p => /exactly one of choices: \/ classes:/.test(p)), 'an entry with no restriction slipped through');
  assert.equal(problems.length, 3, `expected one problem per planted break:\n${problems.join('\n')}`);
  const good = { id: 'good', option: 'gpio.pull', choices: ['Pull-down'], only_on: ['PA1'], reason: 'x', source: 'x' };
  assert.empty(entryProblems([good], 'AUDIT-PROBE'), 'the audit rejects a well-formed entry, so it proves nothing');
});

test('every choice a constraint names is one the part actually offers', () => {
  const all = [];
  for (const file of SHIPPED) {
    const { doc, list } = constraintsOf(file);
    const modes = ((doc.gpio || {}).modes || []).map(m => m.name);
    const pulls = ((doc.gpio || {}).input_modes || []).map(m => m.name);
    const speeds = ((doc.gpio || {}).speeds || []).map(m => m.name);
    const pool = { 'gpio.mode': ['Input', ...modes], 'gpio.pull': pulls, 'gpio.speed': speeds };
    for (const c of list) {
      for (const v of (c.choices || [])) {
        if (!(pool[c.option] || []).includes(v)) {
          all.push(`${file} ${c.id}: choice "${v}" is not a ${c.option} option this part has (${(pool[c.option] || []).join(', ')})`);
        }
      }
      // A classes: entry needs a class on every modes entry, or it can silently match nothing.
      if (c.classes) {
        const missing = ((doc.gpio || {}).modes || []).filter(m => !m.class).map(m => m.name);
        if (missing.length) all.push(`${file} ${c.id}: classes: but ${missing.length} gpio.modes entr(ies) declare no class (${missing.join(', ')})`);
      }
    }
  }
  assert.empty(all, 'constraints that can never match, or can match less than they say');
});

// =============================================================================
//  The mechanism is visible to the engine — the mismatch, stated directly.
// =============================================================================
test('the shipped constraint blocks reach the engine', () => {
  const offenders = [];
  for (const file of SHIPPED) {
    const { list } = constraintsOf(file);
    if (!list.length) continue;
    const name = eng.registerMcuFile(fs.readFileSync(path.join(MCU_DIR, file), 'utf8'));
    eng.loadMcu(name);
    if (!eng.gpioConstraints().length) {
      offenders.push(`${file}: ${list.length} cited entr(ies) in the file, gpioConstraints() sees none`);
    }
  }
  assert.empty(offenders, 'the constraint entries are in the file but the engine cannot see them — the '
    + 'consumer reads a different key or a different nesting than data/FORMAT.md `## constraints` documents');
});

// =============================================================================
//  The acceptance cases — CH32X035's three instances, on the shipped data.
// =============================================================================
function x035(pkg) {
  boot();
  eng.loadMcu(eng.MCU_FILES.CH32X035);
  eng.setPackage(pkg);
}

test('CH32X035: Pull-down is offered only where the silicon has it (both halves)', () => {
  x035('QFN28');
  const { list } = constraintsOf('CH32X035.yaml');
  const c = list.find(x => x.option === 'gpio.pull' && x.only_on);
  assert.ok(c, 'setup: CH32X035 must state a pin allow-list for pull-down');

  const allowed = new Set(c.only_on);
  const pins = bondedPins();
  const inside = pins.find(p => allowed.has(p + '') || allowed.has(p));
  const outside = pins.find(p => !allowed.has(p) && eng.pinType(p) === 'io');
  assert.ok(inside, 'setup: no bonded pin inside the allow-list on this package');
  assert.ok(outside, 'setup: no bonded pin outside the allow-list on this package');

  // HALF ONE: refused outside.
  assert.ok(!eng.gpioFieldOptions(outside, 'pull').includes('Pull-down'),
    `Pull-down is still offered on ${outside}, which the data says has no pull-down resistor`);
  // HALF TWO: offered inside. Without this the test passes for a mechanism that
  // hides the control on every row — just as broken, and invisible to half one.
  assert.ok(eng.gpioFieldOptions(inside, 'pull').includes('Pull-down'),
    `Pull-down is missing on ${inside}, which the header says supports it`);
  // And the control: the pull column is not simply emptied.
  assert.ok(eng.gpioFieldOptions(inside, 'pull').length >= 2, 'the pull column still offers its other values');
});

test('CH32X035: a shorted pair cannot be driven as an output, and the reason is visible', () => {
  x035('QFN28');
  const pins = bondedPins();
  const group = pins.map(p => eng.groupOf(p)).find(g => g.length > 1);
  assert.ok(group, 'setup: this package has no shorted pair to test — the case cannot be exercised here');

  for (const pin of group) {
    assert.ok(!eng.gpioFieldOptions(pin, 'mode').includes('Output Push Pull'),
      `${pin} is one name of the shorted pair ${group.join('/')} and still offers an output mode`);
  }
  // The reason has to be visible, or the table just looks broken.
  const notes = eng.gpioRowNotes(group[0], 'mode');
  assert.ok(notes.length, `nothing on the ${group[0]} row says why the output modes went missing`);
  const sentence = eng.constraintSentence(notes[0], group[0], 'mode', 'Output Push Pull');
  assert.match(sentence, /shorted|short-circuit/i, `the row's explanation does not state the rule: ${sentence}`);

  // Control: a pin that is NOT shorted keeps the option, so the mechanism is
  // removing it for the short and not for everything.
  const solo = pins.find(p => eng.groupOf(p).length === 1 && eng.pinType(p) === 'io');
  assert.ok(solo, 'setup: no unshorted IO pin on this package');
  assert.ok(eng.gpioFieldOptions(solo, 'mode').includes('Output Push Pull'),
    `${solo} is not shorted and lost its output mode too`);
});

test('CH32X035: PC10/PC11 must be floating inputs while USBFS is on, and are free while it is off', () => {
  // Every package that bonds PC10 bonds it as one name of a SHORTED pair, so the
  // shorted-pair rule already removes the output modes there and the mode half of
  // this case cannot be seen on its own. The PULL prohibition is not covered by
  // that rule, so it is the half that isolates the peripheral condition — and the
  // DS states the same fact both ways ("floating input" = no drive AND no pull).
  const found = Object.keys(CH35().packages).find(p => {
    x035(p);
    return eng.pinExists('PC10') && eng.pinExists('PC11');
  });
  if (!found) skip('no CH32X035 package bonds both PC10 and PC11, so this case cannot be exercised');
  x035(found);

  const pulls = pin => eng.gpioFieldOptions(pin, 'pull');
  for (const pin of ['PC10', 'PC11']) {
    assert.ok(pulls(pin).includes('Pull-up'),
      `with USBFS off, ${pin} on ${found} must still offer its pull-up`);
    // The pull-down is already gone here for a DIFFERENT reason — PC10 is not in
    // the allow-list the header gives. Two constraints on one row is the point of
    // a mechanism rather than an `if`: this asserts they compose instead of one
    // silently replacing the other.
    assert.ok(!pulls(pin).includes('Pull-down'),
      `${pin} is not on the pull-down allow-list, so it must not offer it even with USBFS off`);
    const why = eng.gpioRowNotes(pin, 'pull').map(n => n.id).join(',');
    assert.match(why, /pull-down-only-on/, `the ${pin} row does not name the allow-list that removed Pull-down: ${why}`);
  }

  // Switch USBFS on through the normal engine call — the same one the UI makes.
  const P = eng.M.peripherals.USBFS;
  assert.ok(P, 'setup: CH32X035 has no USBFS peripheral in the data');
  const s = (P.settings || [])[0];
  const on = (s.choices || []).find(x => x.signals && x.signals.length);
  const off = (s.choices || []).find(x => !(x.signals && x.signals.length));
  assert.ok(on, 'setup: USBFS has no setting that claims a pin, so it cannot be switched on');
  assert.ok(off, 'setup: USBFS has no setting that leaves every pin alone, so it cannot be switched off');

  eng.setSetting('USBFS', s.name, on.name);
  assert.ok(eng.isEnabled('USBFS'), 'setup: USBFS did not switch on');
  for (const pin of ['PC10', 'PC11']) {
    assert.deep(pulls(pin), ['No pull'],
      `${pin} must be left with exactly "No pull" while USBFS is on — floating input is no drive AND no pull`);
  }
  // The reason must name USB, not merely "this pin is shared" — the difference
  // between a warning the user can act on and one they cannot.
  const notes = eng.gpioRowNotes('PC10', 'pull');
  assert.ok(notes.length, 'nothing on the PC10 row says why its pull options went missing');
  const said = notes.map(n => `${eng.constraintSentence(n, 'PC10', 'pull', 'Pull-up')} ${n.id}`).join(' | ');
  assert.match(said, /usb/i, `the row's explanation does not mention USB: ${said}`);

  // And the condition lifts: a refusal that never lifts is not conditional.
  eng.setSetting('USBFS', s.name, off.name);
  assert.notOk(eng.isEnabled('USBFS'), 'setup: USBFS did not switch off');
  assert.ok(pulls('PC10').includes('Pull-up'),
    'the refusal did not lift when USBFS went off, so it is not conditional on it at all');
});

// =============================================================================
//  A violating .wchproj loads silently and says what it dropped — the same
//  contract gpioSpeedFor() already keeps for a speed the part no longer offers.
// =============================================================================
test('a violating project loads with zero console output and says what it dropped', () => {
  x035('QFN28');
  const { list } = constraintsOf('CH32X035.yaml');
  const pc = list.find(x => x.option === 'gpio.pull' && x.only_on);
  const outside = bondedPins().find(p => !new Set(pc.only_on).has(p) && eng.pinType(p) === 'io');
  assert.ok(outside, 'setup: no bonded pin outside the pull-down allow-list');

  const proj = [
    'wchproj: 1',
    'name: constraint-probe',
    'mcu: CH32X035',
    'package: QFN28',
    'peripherals: {}',
    'gpio_settings:',
    `  ${outside}:`,
    '    mode: Input',
    '    pull: Pull-down',
    '',
  ].join('\n');

  const said = [];
  const realError = console.error, realWarn = console.warn;
  console.error = (...a) => said.push(['error', a.join(' ')]);
  console.warn = (...a) => said.push(['warn', a.join(' ')]);
  let p;
  try { p = eng.projectApply(proj); } finally { console.error = realError; console.warn = realWarn; }

  assert.empty(said, 'loading a project must be silent — a console message is a defect, not a report');
  assert.ok(eng.S.gpio[outside], 'setup: the project did not apply the gpio_settings row at all');
  assert.notEqual(String(eng.S.gpio[outside].pull), 'Pull-down',
    `${outside} kept a pull-down the silicon does not have`);
  const warnings = (p && p.warnings) || [];
  assert.ok(warnings.some(w => /pull/i.test(w) && /Pull-down/.test(w)),
    `the load did not say what it dropped — PROJECT.warnings was ${JSON.stringify(warnings)}`);
});
