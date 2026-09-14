// An analog pad is not an alternate function — the three consumers, and the TODO that
// used to name the wrong fix.
//
// `GPIO_Mode_AIN` and `GPIO_Mode_AF_PP` are two values of ONE field in `GPIOx_CFGLR`, so
// a pad is an analog input or it is a muxed alternate function, never both. Three places
// have to agree about which: the GPIO table (what it OFFERS), the conflict engine (what
// it REPORTS) and codegen (what it EMITS). Before this, only codegen knew, and only when
// the data said so outright:
//
//   - `afPlan()` never asked whether a pad was analog, so a claimed analog signal with no
//     `af:` produced *"Add `af:` to the signal_pins entry and generate again"* — advice
//     nobody can follow, because an analog pad HAS no alternate-function code. A TODO
//     that names the wrong fix is worse than no TODO: it sends the next reader off to
//     invent a number. (`tests/evidence/round5/2026-09-12-analog-pads.md`)
//   - the GPIO table carried a THIRD copy of the mode derivation — "any peripheral claims
//     it, therefore alternate function" — which knew nothing about analog. Measured across
//     every shipped part × every package with every signal claimed: 175 rows read
//     "Alternate Function Push Pull" for a pad the generator puts in `GPIO_Mode_AIN`.
//   - two claims on one pad that disagree about analog-vs-AF were reported only when they
//     came from two different OWNERS. One peripheral's own analog signal sitting on its
//     own muxed signal's pad was silent, and the generator quietly dropped the AF.
//
// The part is invented here rather than taken from `data/mcus/`, for the reason
// `afmux.test.js` and `constraint.test.js` both give: a mechanism tested against the only
// shipped part that has the feature cannot tell "it works" from "it works on that part".
import { test, assert, fresh, eng } from './_harness.js';
import { boot } from '../../tests/lib/app.js';

// AIN1 is an analog input; TRIG is a muxed digital input on the SAME peripheral and can
// sit on the SAME pad, which is the case no conflict rule saw. MUX1 is an ordinary
// alternate function with an `af:`, MUX2 an ordinary one WITHOUT — so the `af:` message
// has somewhere correct to fire and the two messages can be told apart.
const PART = `
mcu:
  name: ANALOG-TEST
  family: test
  default_package: QFN32
  variants:
    A32: { package: QFN32, flash_kb: 64, sram_kb: 8, temp: 85, io_count: 32 }

packages:
  QFN32:
${Array.from({ length: 32 }, (_, i) => `    ${i + 1}: P${'AB'[Math.floor(i / 16)]}${i % 16}`).join('\n')}

pins:
${Array.from({ length: 32 }, (_, i) => `  P${'AB'[Math.floor(i / 16)]}${i % 16}: { type: io }`).join('\n')}

peripherals:
  ADCX:
    category: Analog
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: Scan, signals: [AIN1, AIN2] }
          - { name: Triggered, signals: [AIN1, TRIG] }
    signal_pins:
      AIN1: [{ pin: PA0 }]
      AIN2: [{ pin: PA1 }]
      TRIG: [{ pin: PA0, af: 3 }, { pin: PB2, af: 3 }]
  LINK:
    category: Connectivity
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: On, signals: [MUX1, MUX2] }
    signal_pins:
      MUX1: [{ pin: PA5, af: 5 }]
      # No af: and NOT an analog peripheral - the '\`af:\`' advice is right here.
      MUX2: [{ pin: PA6 }]

codegen:
  header: analogtest.h
  sdk: { synthetic: true }
  gpio_clock: { fn: RCC_APB2PeriphClockCmd, port: RCC_APB2Periph_GPIO$PORT }
  speeds: { "50 MHz": GPIO_Speed_50MHz }
  remap:
    style: af
    fn: GPIO_PinAFConfig
    macro: GPIO_AF$AF
  init_structs:
    GPIO_InitTypeDef: { fn: GPIO_Init }

gpio:
  speeds:
    - { name: "50 MHz", macro: GPIO_Speed_50MHz }
  modes:
    - { name: Output Push Pull, macro: GPIO_Mode_Out_PP }
    - { name: Alternate Function Push Pull, macro: GPIO_Mode_AF_PP }
    - { name: Analog, macro: GPIO_Mode_AIN }
  input_modes:
    - { name: No pull, macro: GPIO_Mode_IN_FLOATING }
    - { name: Pull-up, macro: GPIO_Mode_IPU }
`;

// The three states the data can be in about an analog pad, and they are the three the
// mechanism has to tell apart:
//   SILENT   — neither the authoritative list nor the pin flag. The pad falls through to
//              the alternate-function branch. This is what CH32H417 shipped.
//   DECLARED — `codegen.analog_signals` names the signal. Authoritative; no pin flag needed.
//   INFERRED — no list, but an Analog-category peripheral on a pin marked analog-capable.
const SILENT = PART;
const DECLARED = PART.replace('  remap:\n', '  analog_signals:\n    ADCX: [AIN1, AIN2]\n  remap:\n');
const INFERRED = PART
  .replace('  PA0: { type: io }', '  PA0: { type: io, analog: true }')
  .replace('  PA1: { type: io }', '  PA1: { type: io, analog: true }');

const load = src => { fresh('CH32V006'); eng.loadMcu(src); };
const scan = src => { load(src); eng.setSetting('ADCX', 'Mode', 'Scan'); eng.compute(); };

// ---- codegen: what it EMITS ---------------------------------------------------

test('a declared analog pad is GPIO_Mode_AIN, writes no AF field and raises no TODO', () => {
  scan(DECLARED);
  const c = eng.cSource();
  assert.match(c, /GPIO_InitStructure\.GPIO_Mode = GPIO_Mode_AIN;/, 'the analog mode is emitted');
  assert.doesNotMatch(c, /GPIO_Mode_AF_PP/, 'and the alternate-function mode is not');
  // The AF field is the second half. A pad in AIN with its AFR nibble written would be
  // the generator disagreeing with itself inside one function.
  assert.doesNotMatch(c, /GPIO_PinAFConfig/, 'no AFR write for a pad that has no AF');
  assert.equal((c.match(/TODO/g) || []).length, 0, 'and nothing is missing, so nothing is asked for');
  // The "inferred" note is for a part that has NOT stated the list. Telling a reader to
  // add something they already added is noise.
  assert.doesNotMatch(c, /analog mode inferred/);

  const plan = eng.afPlan();
  assert.deepEqual(plan.calls, [], 'no AF call is planned');
  assert.deepEqual(plan.missing, [], 'and nothing is recorded as missing an af:');
  assert.deepEqual(plan.analog.map(x => `${x.pin}:${x.periph}_${x.signal}`), ['PA0:ADCX_AIN1', 'PA1:ADCX_AIN2']);
  assert.equal(plan.analog.every(x => x.inferred === false), true, 'declared, not guessed');
});

test('the inferred route reaches the same mode and says out loud that it guessed', () => {
  scan(INFERRED);
  const c = eng.cSource();
  assert.match(c, /GPIO_InitStructure\.GPIO_Mode = GPIO_Mode_AIN;/);
  assert.doesNotMatch(c, /GPIO_PinAFConfig/);
  assert.match(c, /analog mode inferred — add codegen\.analog_signals to be certain/,
    'the fallback names the key that would settle it');
  assert.equal(eng.afPlan().analog.every(x => x.inferred === true), true);
});

test('with NEITHER, the TODO names codegen.analog_signals — never an `af:`', () => {
  scan(SILENT);
  const c = eng.cSource();
  // The defect this test exists for. The old message was "Add `af:` to the signal_pins
  // entry and generate again", which for an analog pad is unfollowable.
  assert.doesNotMatch(c, /Add `af:` to the signal_pins entry/,
    'the unfollowable advice must not appear for an analog pad');
  assert.match(c, /codegen\.analog_signals\.ADCX: \[AIN1, AIN2\]/,
    'it names the key AND the exact line to write');
  assert.match(c, /PA0 — ADCX_AIN1/, 'with the pad beside it');
  // Both halves of the fallback, because naming one sends the reader back for a second round.
  assert.match(c, /pins\.<pin>\.analog is not set for PA0, PA1/);
  // And the consequence, which is the part no gate downstream can see: the pad IS
  // configured as an alternate function until the list exists.
  assert.match(c, /GPIO_Init above configures PA0, PA1/);
  assert.match(c, /which is wrong for an analog pad/);
});

test('a non-analog peripheral with no af: still gets the `af:` advice, which is right for it', () => {
  load(SILENT);
  eng.setSetting('LINK', 'Mode', 'On');
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /Add `af:` to the signal_pins entry/, 'the original message survives where it is correct');
  assert.match(c, /PA6: LINK_MUX2/);
  assert.doesNotMatch(c, /codegen\.analog_signals/, 'and the analog advice is not offered for a Connectivity pad');
  // The one with an af: is emitted rather than complained about.
  assert.match(c, /GPIO_PinAFConfig\(GPIOA, GPIO_PinSource5, GPIO_AF5\)/);
});

// ---- analogClaim()/gpioEffectiveMode() themselves -----------------------------
// Every test above reads cSource()/afPlan(); nothing calls the two functions that
// actually DECIDE analog-vs-AF by name, so a regression the higher-level callers
// happened not to surface would have nothing here to catch it (tests/features.test.js's
// export-coverage sweep, main 2026-09-14).

test('analogClaim()/gpioEffectiveMode() read a DECLARED analog claim straight off codegen.analog_signals, not guessed', () => {
  scan(DECLARED);
  const claim = eng.E.pins.PA0.claims.find(c => c.who === 'ADCX');
  assert.ok(claim, 'setup: PA0 is claimed by ADCX');
  assert.deepEqual(eng.analogClaim(claim, 'PA0'), { analog: true, inferred: false });
  const eff = eng.gpioEffectiveMode('PA0', eng.E.pins.PA0.claims, eng.S.gpio.PA0 || {});
  assert.deepEqual(eff, { mode: 'Analog', inferred: false });
});

test('analogClaim()/gpioEffectiveMode() fall back to an INFERRED guess when the part states no list at all', () => {
  scan(INFERRED);
  const claim = eng.E.pins.PA0.claims.find(c => c.who === 'ADCX');
  assert.deepEqual(eng.analogClaim(claim, 'PA0'), { analog: true, inferred: true });
  const eff = eng.gpioEffectiveMode('PA0', eng.E.pins.PA0.claims, eng.S.gpio.PA0 || {});
  assert.deepEqual(eff, { mode: 'Analog', inferred: true });
});

test('gpioEffectiveMode() falls through to Alternate Function for a non-analog claim, and an explicit stored mode wins outright', () => {
  load(SILENT);
  eng.setSetting('LINK', 'Mode', 'On');
  eng.compute();
  const claims = eng.E.pins.PA5.claims;   // LINK's MUX1 - an ordinary AF signal, not analog
  assert.deepEqual(eng.gpioEffectiveMode('PA5', claims, {}), { mode: 'Alternate Function Push Pull', inferred: false });
  // A stored mode is read FIRST (constraints.js:317-318) - it wins over any claim at all.
  assert.deepEqual(eng.gpioEffectiveMode('PA5', claims, { mode: 'Output Push Pull' }),
    { mode: 'Output Push Pull', inferred: false });
});

test('a signal that is BOTH declared analog and given an af: is a TODO, not a coin toss', () => {
  // Two keys, two answers, one pad. The generator picks neither and says which two
  // disagree - `validate_mcu.py` cannot see this one, because each key is valid alone.
  scan(DECLARED.replace('      AIN2: [{ pin: PA1 }]', '      AIN2: [{ pin: PA1, af: 9 }]'));
  const c = eng.cSource();
  assert.match(c, /says two different things about these pads/);
  assert.match(c, /PA1: ADCX_AIN2 — af: 9, and listed in codegen\.analog_signals\.ADCX/);
  assert.doesNotMatch(c, /GPIO_AF9/, 'and it does not write the AF it was told about');
  assert.equal(eng.afPlan().contradictory.length, 1);
});

test('analogAdvice answers from the peripheral category and nothing else', () => {
  load(SILENT);
  // An Analog-category peripheral: the repair is the list, and the pin flag is missing too.
  const a = eng.analogAdvice({ who: 'ADCX', signal: 'ADCX_AIN1' }, 'PA0');
  assert.deepEqual(a, { key: 'codegen.analog_signals.ADCX', entry: 'AIN1', pinFlagMissing: true });
  // The same peripheral on a pin the file DOES mark analog-capable: still the list, but
  // the fallback's other half is already there, so the TODO does not ask for it twice.
  load(INFERRED);
  assert.equal(eng.analogAdvice({ who: 'ADCX', signal: 'ADCX_AIN1' }, 'PA0').pinFlagMissing, false);
  // A peripheral this file does not call Analog gets `af:`, which is the right answer for
  // a muxed pad. The mechanism must not decide "analog" from the pin alone.
  load(INFERRED);
  assert.equal(eng.analogAdvice({ who: 'LINK', signal: 'LINK_MUX2' }, 'PA0'), null,
    'an analog-capable PIN does not make a Connectivity signal analog');
});

// ---- the conflict engine: what it REPORTS -------------------------------------

test('analog and alternate function on one pad is an issue, even from ONE peripheral', () => {
  load(DECLARED);
  // Triggered puts AIN1 (analog, PA0) and TRIG (muxed, defaults to PA0) on the same pad.
  // One owner, so the pin-conflict rule above never looked at it.
  eng.setSetting('ADCX', 'Mode', 'Triggered');
  eng.compute();
  assert.equal(eng.E.pins.PA0.claims.length, 2, 'setup: two claims, one owner');
  assert.equal(eng.E.pins.PA0.state, 'set', 'setup: and therefore not a pin conflict');

  assert.equal(eng.E.analogIssues.length, 1);
  const iss = eng.E.analogIssues[0];
  assert.equal(iss.pin, 'PA0');
  assert.deepEqual(iss.analog, ['ADCX_AIN1']);
  assert.deepEqual(iss.af, ['ADCX_TRIG']);
  assert.match(iss.sentence, /One pad is GPIO_Mode_AIN or it is muxed, never both/);
  // It has to reach the peripheral, or it shows up nowhere a user looks.
  assert.ok((eng.E.issues.ADCX || []).some(m => m === iss.sentence), 'the owning peripheral carries it');
  assert.equal(eng.E.status.ADCX, 'warn');
  // And the generated C does what the sentence says it does.
  const c = eng.cSource();
  assert.match(c, /GPIO_Mode_AIN/);
  assert.doesNotMatch(c, /GPIO_PinAFConfig\(GPIOA, GPIO_PinSource0/, 'the AF is dropped, as the issue says');
});

test('moving the muxed signal off the analog pad clears the issue', () => {
  // The other half. A rule that reports every configuration has not reported anything.
  load(DECLARED);
  eng.setSetting('ADCX', 'Mode', 'Triggered');
  eng.setSignalPin('ADCX', 'TRIG', 'PB2');
  eng.compute();
  assert.deepEqual(eng.E.analogIssues, []);
  assert.match(eng.cSource(), /GPIO_PinAFConfig\(GPIOB, GPIO_PinSource2, GPIO_AF3\)/,
    'and the AF the pad can now have IS written');
});

test('a part that declares no analog anywhere reports no analog issues', () => {
  // The regression half: the rule is inert on data that does not use it, which is what
  // keeps every shipped part byte-identical.
  for (const name of ['CH32V005', 'CH32V006']) {
    const e = fresh(name);
    for (const pid of Object.keys(e.M.peripherals)) {
      for (const st of (e.M.peripherals[pid].settings || [])) {
        const live = (st.choices || []).find(c => (c.signals || []).length);
        if (live) { try { e.setSetting(pid, st.name, live.name); } catch { /* a checkbox setting */ } }
      }
    }
    e.compute();
    assert.deepEqual(e.E.analogIssues, [], `${name} has no analog-vs-AF pad`);
  }
});

// ---- the GPIO table: what it OFFERS -------------------------------------------
//
// Through the built page, because the table is HTML and the defect was in the HTML: an
// engine assertion would have passed against the broken table for the whole of round 5.

const table = (a, pins) => a.ev(`gpioTable(${JSON.stringify(pins)})`);

test('the GPIO table shows an analog pad as Analog, not as an alternate function', () => {
  const a = boot();
  try {
    a.ev(`registerMcuFile(${JSON.stringify(DECLARED)}); openMcu(MCU_FILES['ANALOG-TEST'])`);
    a.ev(`setSetting('ADCX', 'Mode', 'Scan'); renderAll(true)`);
    const rows = table(a, ['PA0']);
    assert.match(rows, /<option selected>Analog<\/option>/,
      'the row the generator puts in GPIO_Mode_AIN must not read "Alternate Function Push Pull"');
    assert.doesNotMatch(rows, /<option selected>Alternate Function Push Pull<\/option>/);
    assert.deepEqual(a.problems(), []);
  } finally { a.close(); }
});

test('the pull column is a control on an input row and inert text on every other row', () => {
  // Both halves. The SPL has no standalone pull bit - `modeMacro()` reads the pull only
  // when the mode is Input - so a pull select on an analog or output row changed the
  // stored value and changed nothing in the generated C.
  const a = boot();
  try {
    a.ev(`registerMcuFile(${JSON.stringify(DECLARED)}); openMcu(MCU_FILES['ANALOG-TEST'])`);
    a.ev(`setSetting('ADCX', 'Mode', 'Scan'); renderAll(true)`);
    const analogRow = table(a, ['PA0']);
    assert.doesNotMatch(analogRow, /data-k="pull"/, 'no pull control on an analog pad');
    assert.match(analogRow, /has no pull-up\/pull-down/, 'and the row says why');

    // The half that proves it did not just delete the column: an Input row keeps it.
    a.ev(`assignSignal('PB5', { gpio: 'GPIO_Input' }); renderAll(true)`);
    const inputRow = table(a, ['PB5']);
    assert.match(inputRow, /data-k="pull"/, 'an input row still chooses a pull');
    assert.match(inputRow, /<option[^>]*>Pull-up<\/option>/);
    assert.deepEqual(a.problems(), []);
  } finally { a.close(); }
});

test('a pad GPIO_Init never touches offers no GPIO controls at all', () => {
  // The debug pads are controlled by the option bytes and the debug hardware. The
  // generator prints "Not configured here, by design" and skips them; this table used to
  // offer a mode, a pull and a speed for them, none of which anything ever writes.
  const a = boot();
  try {
    const pin = Object.keys(a.E.pins).find(p => a.ev(`E.pins[${JSON.stringify(p)}].claims.every(c => skippedClaim(c))`));
    assert.ok(pin, 'the default configuration claims at least one skipped pad');
    const row = table(a, [pin]);
    assert.doesNotMatch(row, /<select/, `${pin} must offer no control`);
    assert.match(row, /GPIO_Init does not configure this pad/, 'and must say why');
    assert.deepEqual(a.problems(), []);
  } finally { a.close(); }
});
