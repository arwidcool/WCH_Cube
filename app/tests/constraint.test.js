// constraints.js — round 5's deliverable A: the data can state a restriction on a
// GPIO choice, and the three consumers agree about it.
//
// The shape under test is `data/FORMAT.md` `## constraints` — the document ROOT
// `constraints:` list with `option:` / `choices:` or `classes:` / `only_on:` or
// `not_on:` / `packages:` / `when:` / `reason:` / `source:`. `tests/constraints.test.js`
// audits the SHIPPED data against that schema and exercises the same mechanism on the
// real part; this file is the ENGINE's half, on a part invented here, because the
// mechanism must be part-agnostic — that is the round's whole argument.
import { test, assert, fresh, read, eng } from './_harness.js';

const CONSTRAINTS = `
constraints:
  # a choice that exists on some pins and not others: an ALLOW-list
  - id: probe-pull-down-pins
    option: gpio.pull
    choices: [Pull-down]
    only_on: [PA0, PA1, PA2, PA3, PC16, PC17]
    reason: "Pull-down is available on PA0-PA3 and PC16-PC17 only"
    source: "probe"
  # ...and a DENY-list scoped to the packages where the pads are shorted
  - id: probe-shorted-no-output
    option: gpio.mode
    classes: [out]
    not_on: [PC17, PC10]
    packages: [QFN28]
    reason: "Neither pin of a shorted pair may be configured as an output function"
    source: "probe"
  # ...and one that is only illegal while another peripheral is on. It names its own
  # pins, so the shorted-pair entry above cannot be mistaken for it.
  - id: probe-usb-floating
    option: gpio.mode
    classes: [out, analog]
    not_on: [PC14, PC15]
    when: { peripheral: USBFS, enabled: true }
    reason: "PC14 and PC15 must stay floating inputs while USBFS is enabled"
    source: "probe"
  - id: probe-usb-no-pull
    option: gpio.pull
    choices: [Pull-up, Pull-down]
    not_on: [PC14, PC15]
    when: { peripheral: USBFS, enabled: true }
    reason: "PC14 and PC15 must carry no pull while USBFS is enabled"
    source: "probe"
`;

const PART = `
mcu:
  name: CONSTRAINT-TEST
  family: test
  variants:
    T28: { package: QFN28, flash_kb: 62, sram_kb: 20, temp: 85, io_count: 24 }
    T20: { package: QFN20, flash_kb: 62, sram_kb: 20, temp: 85, io_count: 18 }

# QFN28 carries a shorted pair; QFN20 does not, which is what makes the per-PACKAGE
# half of a constraint testable without the engine knowing a package name.
packages:
  QFN28:
    0: GND
    1: PA0
    2: PA1
    3: PA2
    4: PA3
    5: PB5
    6: PC16
    7: [PC17, PC10]
    8: [PC18, PC11]
    9: PA4
    10: PA5
    11: PA6
    12: PA7
    13: PB0
    14: PB1
    15: PB2
    16: PB3
    17: PB4
    18: PB6
    19: PB7
    20: PB8
    21: PB9
    22: PB10
    23: PB11
    24: PB12
    25: PC14
    26: PC15
    27: PC19
    28: PA15
  QFN20:
    0: GND
    1: PA0
    2: PA1
    3: PA2
    4: PA3
    5: PB5
    6: PC16
    7: PC17
    8: PC18
    9: PA4
    10: PA5
    11: PA6
    12: PA7
    13: PB0
    14: PB1
    15: PB2
    16: PB3
    17: PB4
    18: PB6
    19: PC14
    20: PA15

pins:
  PA0: { type: io }
  PA1: { type: io }
  PA2: { type: io }
  PA3: { type: io }
  PA4: { type: io }
  PA5: { type: io }
  PA6: { type: io }
  PA7: { type: io }
  PA15: { type: io }
  PB0: { type: io }
  PB1: { type: io }
  PB2: { type: io }
  PB3: { type: io }
  PB4: { type: io }
  PB5: { type: io }
  PB6: { type: io }
  PB7: { type: io }
  PB8: { type: io }
  PB9: { type: io }
  PB10: { type: io }
  PB11: { type: io }
  PB12: { type: io }
  PC10: { type: io }
  PC11: { type: io }
  PC14: { type: io }
  PC15: { type: io }
  PC16: { type: io }
  PC17: { type: io }
  PC18: { type: io }
  PC19: { type: io }

peripherals:
  USBFS:
    category: Connectivity
    settings:
      - name: USB_mode
        choices:
          - { name: Disable }
          - { name: Device, signals: [UDM, UDP] }
    remaps:
      - { name: Default, pins: { UDM: PC16, UDP: PC17 } }

gpio:
  speeds:
    - { name: "50 MHz", macro: GPIO_Speed_50MHz }
  modes:
    - { name: Output Push Pull,             macro: GPIO_Mode_Out_PP, class: out }
    - { name: Alternate Function Push Pull, macro: GPIO_Mode_AF_PP, class: out }
    - { name: Analog,                       macro: GPIO_Mode_AIN,    class: analog }
  input_modes:
    - { name: No pull,   macro: GPIO_Mode_IN_FLOATING }
    - { name: Pull-up,   macro: GPIO_Mode_IPU }
    - { name: Pull-down, macro: GPIO_Mode_IPD }
${CONSTRAINTS}
codegen:
  header: constraint_test.h
  gpio_clock: { fn: RCC_APB2PeriphClockCmd, port: RCC_APB2Periph_GPIO$PORT, afio: RCC_APB2Periph_AFIO }
`;

/** The fixture, with its `constraints:` block replaced — so a test can plant a break. */
const part = overrides => PART.replace(CONSTRAINTS, overrides === undefined ? CONSTRAINTS : overrides);

// Packages are the real geometry library; the part is the fixture above.
function load(overrides, pkg = 'QFN28') {
  const e = fresh();                    // registers every shipped part and the package library
  e.loadMcu(part(overrides));
  e.setPackage(pkg);
  e.compute();
  return e;
}

const usbOn = e => e.setSetting('USBFS', 'USB_mode', 'Device');

// --------------------------------------------------------------- the reader

test('the constraints come from the document root, in the documented shape', () => {
  const e = load();
  assert.deepEqual(e.gpioConstraints().map(c => c.id),
    ['probe-pull-down-pins', 'probe-shorted-no-output', 'probe-usb-floating', 'probe-usb-no-pull']);
  assert.equal(e.constraintField(e.gpioConstraints()[1]), 'mode', 'gpio.mode is the mode column');
  assert.equal(e.gpioFieldOptionNames('mode').join('|'),
    'Input|Output Push Pull|Alternate Function Push Pull|Analog');
});

test('a classes: entry reads the directions off the part, never a table in the app', () => {
  const e = load();
  // both `class: out` modes are refused, and the analog one is not
  assert.ok(!e.gpioFieldOptions('PC17', 'mode').includes('Output Push Pull'));
  assert.ok(!e.gpioFieldOptions('PC17', 'mode').includes('Alternate Function Push Pull'));
  assert.ok(e.gpioFieldOptions('PC17', 'mode').includes('Analog'), 'the class was `out`');
  // and a mode this part does not have cannot match a class either
  assert.ok(!e.gpioFieldOptions('PC17', 'mode').includes('Output Open Drain'));
});

test('an allow-list refuses everywhere else, and a deny-list only where it says', () => {
  const e = load();
  assert.ok(e.gpioFieldOptions('PA3', 'pull').includes('Pull-down'), 'PA3 is named by only_on');
  assert.ok(!e.gpioFieldOptions('PB5', 'pull').includes('Pull-down'), 'PB5 is not, so it is refused');
  assert.deepEqual(e.gpioFieldOptions('PB5', 'pull'), ['No pull', 'Pull-up'],
    'the rest of the column survives — this reduces a column, it does not blank it');
  assert.ok(!e.gpioFieldOptions('PC19', 'pull').includes('Pull-down'), 'nor is PC19');
});

test('a packages: entry is in force on those packages and nowhere else', () => {
  const e = load(undefined, 'QFN28');
  assert.ok(!e.gpioFieldOptions('PC17', 'mode').includes('Output Push Pull'), 'QFN28 is scoped in');
  e.setPackage('QFN20'); e.compute();
  assert.ok(e.gpioFieldOptions('PC17', 'mode').includes('Output Push Pull'),
    'QFN20 is not scoped in, so PC17 keeps its output mode');
});

test('the reason is visible, and it cites the constraint and its source', () => {
  const e = load();
  const notes = e.gpioRowNotes('PC17', 'mode');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, 'probe-shorted-no-output');
  assert.match(notes[0].reason, /shorted pair/);
  assert.ok(notes[0].source, 'a rule with no citation is a guess');
  assert.deepEqual(e.gpioRowNotes('PA4', 'mode'), [], 'nothing was removed from PA4');
});

// ------------------------------------------------- consumer 2: the engine

test('a claim that violates a constraint is an issue that names the constraint', () => {
  const e = load();
  assert.deepEqual(e.E.constraintIssues, [], 'a clean configuration says nothing');
  e.assignSignal('PC17', { gpio: 'GPIO_Output' });
  e.compute();
  const hit = e.E.constraintIssues.filter(c => c.id === 'probe-shorted-no-output');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].pin, 'PC17');
  assert.equal(hit[0].field, 'mode');
  assert.match(hit[0].sentence, /\[probe-shorted-no-output\]/);
  assert.match(hit[0].sentence, /shorted pair/, "the issue carries the author's reason");
});

test('a peripheral-coupled constraint applies only while that peripheral is on', () => {
  const e = load();
  assert.ok(e.gpioFieldOptions('PC14', 'mode').includes('Output Push Pull'), 'USBFS is off');
  e.assignSignal('PC14', { gpio: 'GPIO_Output' });
  e.compute();
  assert.deepEqual(e.E.constraintIssues, [], 'still off: the claim is legal');
  usbOn(e); e.compute();
  assert.deepEqual(e.gpioFieldOptions('PC14', 'mode'), ['Input'], 'USBFS is on: input only');
  assert.deepEqual(e.gpioFieldOptions('PC14', 'pull'), ['No pull'], 'and floating means no pull');
  const hit = e.E.constraintIssues.filter(c => c.id === 'probe-usb-floating');
  assert.equal(hit.length, 1, 'the output already configured is now an issue');
  assert.ok(e.gpioFieldOptions('PA0', 'mode').includes('Output Push Pull'),
    'the refusal leaked onto a pin outside its region');
});

// ------------------------------------------------- consumer 3: codegen

test('codegen never emits a forbidden combination - it emits a TODO naming it', () => {
  const e = load();
  e.assignSignal('PC14', { gpio: 'GPIO_Output' });
  usbOn(e); e.compute();
  const files = e.cFiles();
  const text = Object.values(files).join('\n');
  assert.ok(!/#error/.test(text), 'a TODO is the documented answer, not a refusal to compile');
  const complaints = e.cComplaints(files);
  assert.ok(complaints.some(c => c.kind === 'todo' && /probe-usb-floating/.test(c.text)),
    'the pin that violates the rule is declined, by name: ' + JSON.stringify(complaints));
  assert.match(text, /PC14[\s\S]{0,300}?TODO/, 'and it has no mode macro: the bit is not written');
  // Switching a peripheral on can put a pin under a rule by itself - here USBFS claims
  // PC17, which the shorted-pair entry refuses as an output function. That is a real
  // consequence of the data and NOT something this mechanism should paper over: the
  // generated C declines it too, through the same rule.
  assert.ok(complaints.every(c => c.kind === 'todo'), 'nothing silently emits what the data refuses');
});

test('a configuration the silicon can honour generates no complaint at all', () => {
  const e = load();
  e.assignSignal('PC14', { gpio: 'GPIO_Output' });      // USBFS is off
  e.compute();
  assert.deepEqual(e.cComplaints(e.cFiles()), []);
  const e2 = load();
  e2.assignSignal('PA0', { gpio: 'GPIO_Output' });      // a pin no constraint names
  e2.compute();
  assert.deepEqual(e2.cComplaints(e2.cFiles()), []);
});

// ------------------------------------------------- the stored value degrades

test('a project that violates a constraint loads, is rewritten, and says what changed', () => {
  const e = load();
  usbOn(e); e.compute();
  // A file saved before the constraint existed: PC14 stored as an output. Written
  // through the real serialiser rather than by editing text, so this is a file the
  // app would actually have produced.
  e.S.gpio.PC14 = { mode: 'Output Push Pull', pull: 'No pull', speed: '50 MHz', label: '' };
  const bad = e.projectSerialize();
  assert.match(bad, /mode: Output Push Pull/);
  e.projectApply(bad);
  assert.equal(e.S.gpio.PC14.mode, 'Input', 'the forbidden value never reaches the table or the C');
  const said = e.PROJECT.warnings.join('\n');
  assert.match(said, /probe-usb-floating/);
  assert.match(said, /using "Input"/);
  assert.ok(!e.cComplaints(e.cFiles()).some(c => /\bPC14\b/.test(c.text)),
    'and the pin the file got wrong no longer reaches the generated C: '
    + JSON.stringify(e.cComplaints(e.cFiles())));
});

test('a project saved before the constraint existed opens with no console error', () => {
  const e = load();
  e.assignSignal('PC17', { gpio: 'GPIO_Output' });
  const before = e.projectSerialize();
  assert.doesNotThrow(() => e.projectApply(before));
  assert.deepEqual(e.cComplaints(e.cFiles()), []);
});

test('a stored pull on an output pin is inert, so it is not reported as a violation', () => {
  const e = load();
  e.assignSignal('PC14', { gpio: 'GPIO_Output' });
  e.S.gpio.PC14.pull = 'Pull-up';                  // set before the mode was chosen
  usbOn(e); e.compute();
  const sentences = e.E.constraintIssues.map(c => c.sentence).join('\n');
  assert.ok(!/pull/.test(sentences), 'the SPL ignores the pull column outside Input mode: ' + sentences);
});

// ------------------------------------------------- the regression half

test('a part that states no constraint offers everything it offered before', () => {
  for (const name of ['CH32V006', 'CH32V005', 'CH32X035']) {
    const pkgs = Object.keys(eng.mcuModel(read(`data/mcus/${name}.yaml`)).packages);
    for (const pkg of pkgs) {
      const e = fresh(name, pkg);
      for (const pin of ['PA0', 'PB1', 'PC3', 'PC14']) {
        if (!e.pinExists(pin)) continue;
        for (const field of ['mode', 'pull']) {
          const offered = e.gpioFieldOptions(pin, field);
          for (const v of e.gpioFieldOptionNames(field)) {
            assert.ok(offered.includes(v) || e.constraintFor(pin, field, v),
              `${name} ${pkg} ${pin} ${field}: "${v}" vanished with no constraint to explain it`);
          }
        }
      }
    }
  }
});

test('the mode a manual output implies is the mode the generator derives', () => {
  for (const name of ['CH32V006', 'CH32V005', 'CH32X035']) {
    const e = fresh(name);
    const pin = Object.keys(e.M.pins).find(p => e.pinExists(p) && e.pinType(p) === 'io');
    e.assignSignal(pin, { gpio: 'GPIO_Output' });
    e.compute();
    const plan = e.gpioPlan().find(x => x.pin === pin);
    assert.equal(plan.mode, e.gpioModeForSignal('GPIO_Output'),
      `${name}: the engine's idea of "an output" and the generator's must be one answer`);
  }
});

test('assigning an output stores the part\'s OWN name for the mode, not another family\'s', () => {
  // A part whose plain output mode is spelled differently. The app used to store the
  // literal "Output Push Pull" here, which is a name from its own vocabulary rather
  // than the part's - round 3's defect one field over. Every shipped part happens to
  // spell it the same way, which is what made it latent.
  const e = fresh();
  const renamed = PART.replace(
    '{ name: Output Push Pull,             macro: GPIO_Mode_Out_PP, class: out }',
    '{ name: Output Push-Pull,             macro: GPIO_Mode_Out_PP, class: out }');
  assert.notEqual(renamed, PART, 'setup: the fixture line moved, so this test proves nothing');
  e.loadMcu(renamed);
  e.setPackage('QFN28');
  e.assignSignal('PA0', { gpio: 'GPIO_Output' });
  assert.equal(e.S.gpio.PA0.mode, 'Output Push-Pull', "the part's own spelling is what is stored");
  assert.deepEqual(e.cComplaints(e.cFiles()), [],
    'and the macro is looked up in that same list, so the C still compiles');
  assert.ok(e.gpioFieldOptions('PA0', 'mode').includes('Output Push-Pull'));
});
