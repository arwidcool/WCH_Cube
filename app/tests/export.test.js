// export.js — the pin table and clock summary behind the Generate button.
import { test, assert, fresh, eng } from './_harness.js';

// A minimal RFC4180 reader for one CSV line, quote-aware the same way the
// exporter's own `esc()` is (a doubled `""` inside a quoted field is one literal
// `"`). Used to prove the KiCad export actually ROUND-TRIPS rather than merely
// "looks right" by eye - nobody diffs a CSV, which is exactly where a silent drop
// hides (main's own words for why this test exists at all).
function parseCsvLine(line) {
  const fields = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else cur += c;
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { fields.push(cur); cur = ''; }
    else cur += c;
  }
  fields.push(cur);
  return fields;
}

test('the pin table has one row per physical pin, in pin-number order', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const rows = e.pinRows();
  assert.equal(rows.length, 20);
  assert.deepEqual(rows.map(r => r.num), Array.from({ length: 20 }, (_, i) => String(i + 1)));
  assert.equal(rows[0].name, 'PD4');
  assert.equal(rows[3].name, 'PD7/PA4');
  assert.equal(rows[3].shorted, true);
});

test('the exposed pad sorts last and power pins keep their type', () => {
  const e = fresh('CH32V006', 'QFN20');
  const rows = e.pinRows();
  assert.equal(rows.length, 21);                 // 20 pins + the pad
  assert.equal(rows[rows.length - 1].num, '');
  assert.equal(rows[rows.length - 1].name, 'VSS');
  assert.equal(rows.find(r => r.name === 'VDD').type, 'power');
});

test('assigned pins carry their signal, mode and user label', () => {
  const e = fresh();
  e.assignSignal('PC0', { periph: 'USART1', signal: 'TX', remap: 3 });
  e.S.gpio.PC0 = { mode: 'Alternate Function Push Pull', pull: 'Pull-up', speed: 'High', label: 'DEBUG_TX' };
  e.compute();
  const row = e.pinRows().find(r => r.name === 'PC0');
  assert.equal(row.signal, 'USART1_TX');
  assert.equal(row.mode, 'Alternate Function Push Pull');
  assert.equal(row.pull, 'Pull-up');
  assert.equal(row.label, 'DEBUG_TX');
  assert.equal(row.conflict, false);
});

test('conflicts are marked in the markdown table and listed under it', () => {
  const e = fresh();
  e.S.periph.USART1.settings.Mode = 'Asynchronous';
  e.S.periph.USART1.remap = 4;                   // TX collides with SYS_SWIO on PD1
  e.compute();
  const md = e.pinTableMarkdown();
  assert.ok(md.includes('# CH32V006 — pinout (TSSOP20)'));
  assert.ok(/\| 18 \| PD1 \|.*CONFLICT/.test(md), 'the PD1 row is marked');
  assert.ok(md.includes('**1 pin conflict:**'));
  assert.ok(md.includes('PD1: SYS_SWIO / USART1_TX'));
});

test('a clean configuration says so instead of listing conflicts', () => {
  const e = fresh();
  assert.ok(e.pinTableMarkdown().includes('No pin conflicts.'));
});

test('the CSV has a header plus one line per pin and quotes what it must', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.S.gpio.PC0 = { mode: 'Output Push Pull', pull: 'No pull', speed: 'Low', label: 'A,B "quoted"' };
  e.compute();
  const lines = e.pinTableCsv().trim().split('\n');
  assert.equal(lines.length, 21);
  assert.equal(lines[0], 'Pin,Name,Signal,Mode,Pull,Speed,User label,Note');
  const pc0 = lines.find(l => l.startsWith('10,PC0,'));
  assert.ok(pc0.includes('"A,B ""quoted"""'), `CSV quoting: ${pc0}`);
});

// ---- KiCad symbol pin table --------------------------------------------------
// The owner's literal deliverable, and its three named constraints: it must state
// which package it is for, it must carry a `remap_unwritable:` planning-only pin
// (not silently drop it), and it must round-trip - export, re-read, every assigned
// pin still there - because nobody diffs a CSV by eye.

test('kicadPinCsv states its part and package, and every assigned pin round-trips through it', () => {
  const e = fresh('CH32V006', 'QFN32');
  e.assignSignal('PC0', { periph: 'USART1', signal: 'TX', remap: 3 });
  e.S.gpio.PC0 = { mode: 'Alternate Function Push Pull', pull: 'Pull-up', speed: 'High', label: 'DEBUG_TX' };
  e.compute();
  const csv = e.kicadPinCsv();

  // A CSV that does not say QFN32 vs QFN20 is a trap: assert the header states
  // BOTH the part and the package, not merely that a comment line exists.
  const headerComment = csv.split('\n')[0];
  assert.ok(headerComment.startsWith('#'), 'a leading comment, so a plain CSV reader still imports cleanly');
  assert.ok(headerComment.includes('CH32V006'), `part not named: ${headerComment}`);
  assert.ok(headerComment.includes('QFN32'), `package not named: ${headerComment}`);

  const rows = csv.trim().split('\n').filter(l => !l.startsWith('#'));
  assert.deepEqual(parseCsvLine(rows.shift()),
    ['Number', 'Name', 'Electrical Type', 'Port', 'Signal', 'User Label', 'Notes']);

  // Round-trip: parse every data row back and confirm the assigned pin survived
  // with its real facts intact, not just that SOME row exists for it.
  const parsed = rows.map(parseCsvLine);
  assert.equal(parsed.length, e.pinRows().length, 'every physical pin makes it into the export, assigned or not');
  const pc0 = parsed.find(f => f[3] === 'PC0');
  assert.ok(pc0, 'PC0 survives the round trip at all');
  assert.equal(pc0[4], 'USART1_TX', 'the assigned signal survives');
  assert.equal(pc0[5], 'DEBUG_TX', 'the user label survives');
  assert.equal(pc0[1], 'DEBUG_TX', 'the label wins as the KiCad pin NAME too, per the stated preference order');
  assert.equal(pc0[2], 'bidirectional', 'an io pin reads as bidirectional per the vendor-library convention');
});

test('kicadPinCsv carries a remap_unwritable pin, marked planning-only rather than dropped', () => {
  // Mirrors resources.test.js's own `remap_unwritable:` fixture: a real, cited pin
  // plan the generated C cannot write. The export's whole point is that this pin
  // still needs its pad on the board - a `remap_unwritable:` SDMMC/UHSIF selection
  // generates no code but is exactly as real a plan as any other for a hardware
  // export.
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-UNWRITABLE-REMAP-KICAD
  inherits: CH32V006
peripherals:
  TESTPERIPH:
    category: Connectivity
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: On, signals: [SIG] }
    remaps:
      - { name: "00 Default", pins: { SIG: PD5 } }
      - { name: "01", pins: { SIG: PD6 } }
    remap_unwritable: "AFIO_PCFR1.TESTPERIPH_RM[1:0] - not writable on this part"
`);
  e.loadMcu('CH32V006-UNWRITABLE-REMAP-KICAD');
  e.setPackage('TSSOP20');
  e.setSetting('TESTPERIPH', 'Mode', 'On');
  e.setRemap('TESTPERIPH', 1);
  e.compute();

  const rows = e.kicadPinCsv().trim().split('\n').filter(l => !l.startsWith('#'));
  const parsed = rows.slice(1).map(parseCsvLine);
  const pd6 = parsed.find(f => f[3] === 'PD6');
  assert.ok(pd6, 'the planning-only pin is exported, not dropped - the whole point of the mechanism');
  assert.equal(pd6[4], 'TESTPERIPH_SIG', 'it still carries its real signal, not blanked out');
  assert.match(pd6[6], /planning only/, 'marked, so a board house does not read it as firmware-driven today');
});

// ---- pinout SVG ---------------------------------------------------------------
// Built reachable from the CLI from the start (main's finding on the KiCad CSV,
// this cycle): a second, plainer, self-contained renderer - not a clone of the
// canvas's live DOM - so `pinoutSvg()` needs no browser and no page theme.

// A tiny well-formedness check: every element opened is closed, in order. Cheaper
// than a real XML parser and catches exactly the failure mode a string-built SVG
// is prone to - an unbalanced tag from a copy-paste or a missing closing `</g>`.
function xmlBalance(xml) {
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(xml))) {
    const [full, closing, name, rest] = m;
    if (full.startsWith('<?') || full.startsWith('<!')) continue;
    if (closing) { if (stack.pop() !== name) return false; }
    else if (!/\/\s*$/.test(rest)) stack.push(name);
  }
  return stack.length === 0;
}

test('pinoutSvg is well-formed and states its part and package', () => {
  const e = fresh('CH32V006', 'QFN32');
  e.compute();
  const svg = e.pinoutSvg();
  assert.ok(xmlBalance(svg), 'every opened element must be closed - a string-built SVG has no parser to catch this for us');
  assert.match(svg, /^<\?xml version="1\.0"/, 'a real XML document, not a markup fragment');
  assert.match(svg, /<!-- CH32V006 QFN32 —/, 'states its part and package in a leading comment, same rule as the KiCad CSV');
  assert.match(svg, /<title>CH32V006 QFN32 —/, 'and in an SVG-native <title> element too, for a viewer that shows it');
});

test('pinoutSvg covers both package shapes - quad (with an exposed pad) and dual', () => {
  const e = fresh('CH32V006', 'QFN20');
  e.compute();
  let svg = e.pinoutSvg();
  assert.ok(xmlBalance(svg));
  assert.ok(svg.includes('#2b3444'), 'a quad package with an exposed pad draws the pad rectangle');

  e.setPackage('TSSOP20');
  e.compute();
  svg = e.pinoutSvg();
  assert.ok(xmlBalance(svg), 'the dual-package layout branch is well-formed too, not only the quad one');
});

test('pinoutSvg carries every assigned pin, marks conflicts, and never hides a remap_unwritable pin', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.assignSignal('PC0', { periph: 'USART1', signal: 'TX', remap: 3 });
  e.S.gpio.PC0 = { mode: 'Alternate Function Push Pull', pull: 'Pull-up', speed: 'High', label: 'DEBUG_TX' };
  e.compute();
  let svg = e.pinoutSvg();
  assert.match(svg, /DEBUG_TX/, 'a user label reaches the diagram');
  assert.match(svg, /USART1_TX/, 'so does the assigned signal');

  // The same known conflict export.test.js's markdown test above uses: TX collides
  // with SYS_SWIO on PD1.
  e.S.periph.USART1.settings.Mode = 'Asynchronous';
  e.S.periph.USART1.remap = 4;
  e.compute();
  svg = e.pinoutSvg();
  assert.match(svg, /CONFLICT/, 'a conflict is visible in the export, not silently drawn like any other pin');

  // remap_unwritable, same fixture shape as the KiCad test above.
  const f = fresh();
  f.registerMcuFile(`
mcu:
  name: CH32V006-UNWRITABLE-REMAP-SVG
  inherits: CH32V006
peripherals:
  TESTPERIPH:
    category: Connectivity
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: On, signals: [SIG] }
    remaps:
      - { name: "00 Default", pins: { SIG: PD5 } }
      - { name: "01", pins: { SIG: PD6 } }
    remap_unwritable: "AFIO_PCFR1.TESTPERIPH_RM[1:0] - not writable on this part"
`);
  f.loadMcu('CH32V006-UNWRITABLE-REMAP-SVG');
  f.setPackage('TSSOP20');
  f.setSetting('TESTPERIPH', 'Mode', 'On');
  f.setRemap('TESTPERIPH', 1);
  f.compute();
  const svg2 = f.pinoutSvg();
  assert.match(svg2, /planning only/, 'a remap_unwritable pin is drawn and named as planning-only, never dropped');
  // The tooltip text alone does not prove the pin reads differently at a glance -
  // assert the colour too, so a break in the fill-selection branch (as opposed to
  // the tooltip-building one) cannot pass this test by accident. Found exactly this
  // gap while planting a break during development: the tooltip assertion alone
  // stayed green with `svgPinColors()`'s planningOnly branch deleted entirely.
  assert.ok(svg2.includes('#e0a53f'), 'and coloured distinctly from an ordinary assigned pin, not merely annotated');
});

test('the clock summary reports every node and the out-of-spec ones', () => {
  const e = fresh();
  e.S.clock.sys = 'PLLCLK';
  let md = e.clockSummaryMarkdown();
  assert.ok(md.includes('| SYSCLK | source PLLCLK | 48 MHz |'));
  assert.ok(md.includes('| HCLK | HB /1 | 48 MHz |'));
  assert.ok(md.includes('| ADC | /1 from HB | 48 MHz |'));
  assert.ok(md.includes('| Core SysTick | HCLK /8 | 6 MHz |'));
  assert.ok(md.includes('All clocks within specification.'));
  e.S.clock.pre.ADC = 8;
  md = e.clockSummaryMarkdown();
  assert.ok(md.includes('**Out of specification: ADC**'));
});

test('generateAll names its files after the part and package', () => {
  const e = fresh('CH32V006', 'QFN32');
  const out = e.generateAll();
  // A LIST of { name, language, text }, so the Project Manager can list and preview
  // without knowing what codegen produces. The C comes first: it is what people came for.
  assert.ok(Array.isArray(out));
  // `BoardPins.h` joined this list when the pin map landed: it is a C file with a FIXED
  // include name, because a project includes it by name, and it therefore sits with the
  // other two rather than with the reports. The rule the list is here for - reports carry
  // the part and the package, C files do not - is asserted below rather than left to the
  // reader of a literal.
  assert.deepEqual(out.map(f => f.name), [
    'wchcube_init.h', 'wchcube_init.c', 'BoardPins.h',
    'CH32V006_QFN32_pinout.md', 'CH32V006_QFN32_pinout.csv', 'CH32V006_QFN32_kicad_pins.csv',
    'CH32V006_QFN32_pinout.svg', 'CH32V006_QFN32_clocks.md',
  ], 'the reports are named after the part; the C files keep fixed include names');
  assert.deepEqual(out.map(f => f.language), ['c', 'c', 'c', 'markdown', 'csv', 'csv', 'svg', 'markdown']);
  for (const f of out) assert.ok(f.text.length > 100, `${f.name} has content`);
  for (const f of out) {
    const named = f.name.includes('CH32V006_QFN32');
    assert.equal(named, f.language !== 'c',
      `${f.name}: a report carries the part and the package, a C file keeps its include name`);
  }
});

test('generateAll obeys the generator options, and only the ones that exist', () => {
  const e = fresh('CH32V006', 'QFN32');
  assert.deepEqual(e.generatorOptions().map(o => o.key),
    ['split_peripherals', 'reports', 'user_code', 'pin_map', 'pin_map_only'],
    'an option the engine cannot honour is not offered at all');
  assert.equal(e.generatorOption('reports'), true, 'the default comes from the definition');
  assert.equal(e.generatorOption('pin_map'), true);
  assert.equal(e.generatorOption('pin_map_only'), false);

  e.setGeneratorOption('reports', false);
  assert.deepEqual(e.generateAll().map(f => f.name), ['wchcube_init.h', 'wchcube_init.c', 'BoardPins.h'],
    'turning the reports off really stops generating them');
  // Each option is checked on its own, or a list that changed for TWO reasons would still
  // look right: the pin map is a separate switch and turning it off leaves the init pair.
  e.setGeneratorOption('pin_map', false);
  assert.deepEqual(e.generateAll().map(f => f.name), ['wchcube_init.h', 'wchcube_init.c'],
    'and so does turning the pin map off');
  e.undo();
  assert.deepEqual(e.generateAll().map(f => f.name), ['wchcube_init.h', 'wchcube_init.c', 'BoardPins.h'],
    'one undo brings the pin map back and leaves the reports off');
  e.undo();
  assert.equal(e.generateAll().length, 8, 'and each is one undo step like everything else');

  assert.throws(() => e.setGeneratorOption('no_such_option', true),
    /No generator option "no_such_option"/);
  assert.throws(() => e.setGeneratorOption('reports', 'maybe'), /expected true or false/);
});

test('generator options round-trip, and an unknown one is dropped and reported', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  assert.equal(/^generator:/m.test(e.projectSerialize()), false, 'an untouched option writes no key');
  e.setGeneratorOption('user_code', false);
  const text = e.projectSerialize();
  assert.match(text, /^generator:/m);

  e.loadMcu(e.MCU_FILES.CH32V006);
  assert.equal(e.generatorOption('user_code'), true, 'setup: back to the default');
  e.projectApply(text);
  assert.equal(e.generatorOption('user_code'), false);
  assert.deepEqual(e.PROJECT.warnings, []);

  e.projectApply(text.replace('generator:', 'generator:\n  from_a_newer_build: true\nignored_here:'));
  assert.ok(e.PROJECT.warnings.some(w => /from_a_newer_build/.test(w)),
    'an option this build does not have is dropped and said out loud: ' + JSON.stringify(e.PROJECT.warnings));
});

// =============================================================================
//  USER CODE sections — the contract that makes a generated file safe to edit
// =============================================================================

test('the generated file carries a USER CODE section in every part of it', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.compute();
  const tagsOf = t => [...t.matchAll(/USER CODE BEGIN (\S+)/g)].map(m => m[1]);
  const source = tagsOf(e.cSource());
  assert.deepEqual(source, ['Includes', 'PV', 'RCC', 'GPIO', 'Periph', 'DMA', 'NVIC', 'Init']);
  assert.deepEqual(tagsOf(e.cHeader()), ['Prototypes']);
  // every BEGIN has its END, or a merge would swallow the rest of the file
  for (const tag of source) assert.ok(e.cSource().includes(`/* USER CODE END ${tag} */`), tag);
});

// This test USED to hold two `fresh()` results at once and compare them at the end.
// `fresh()` returns the one engine singleton, so both variables were the same object and
// the comparison was between a configuration and itself - it could not fail. Read each
// one out before configuring the next.
const CORE_USER_TAGS = ['Includes', 'PV', 'RCC', 'GPIO', 'Periph', 'DMA', 'NVIC', 'Init'];

test('the core USER CODE tags do not depend on the configuration', () => {
  const tagsOf = e => [...e.cSource().matchAll(/USER CODE BEGIN (\S+)/g)].map(m => m[1]);

  const bare = fresh('CH32V006', 'TSSOP20');
  bare.compute();
  const empty = tagsOf(bare);

  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.addDmaRequest('USART1_TX');
  e.setNvicVector('USART1', { enabled: true });
  e.compute();
  const full = tagsOf(e);

  assert.deepEqual(empty.filter(t => CORE_USER_TAGS.includes(t)), CORE_USER_TAGS);
  assert.deepEqual(full.filter(t => CORE_USER_TAGS.includes(t)), CORE_USER_TAGS,
    'a core tag that came and went would orphan code every time a peripheral was '
    + 'switched off');
  // The per-peripheral tags DO depend on the configuration - the deliberate exception,
  // recorded on the board 16:41Z. Everything else must be core.
  for (const t of [...empty, ...full]) {
    if (CORE_USER_TAGS.includes(t)) continue;
    assert.match(t, /^(Periph|Includes|Prototypes)_\w+$/, `${t} is neither core nor per-peripheral`);
  }
  assert.ok(full.includes('Periph_USART1'), 'setup: USART1 really got its own block');
  assert.equal(empty.includes('Periph_USART1'), false, 'and a peripheral that is off has none');
});

test('switching a peripheral off orphans its user code loudly rather than dropping it', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.compute();
  const edited = e.cSource().replace(
    '/* USER CODE BEGIN Periph_USART1 */',
    '/* USER CODE BEGIN Periph_USART1 */\n    USART_Cmd(USART1, ENABLE);');

  e.setSetting('USART1', 'Mode', 'Disable');
  e.compute();
  const merged = eng.mergeUserCode(edited, e.cSource());
  assert.deepEqual(merged.orphaned, ['Periph_USART1']);
  assert.ok(merged.text.includes('USART_Cmd(USART1, ENABLE);'), 'the line is still in the file');
  assert.match(merged.text, /was: USER CODE Periph_USART1/);
});

test('turning the option off removes the markers rather than ignoring them', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setGeneratorOption('user_code', false);
  e.compute();
  assert.equal(/USER CODE/.test(e.cSource()), false);
  assert.equal(/USER CODE/.test(e.cHeader()), false);
  e.undo();
  assert.ok(/USER CODE/.test(e.cSource()), 'and back again');
});

test('userSections reads every block, and reports what it cannot read', () => {
  const { sections, issues } = eng.userSections([
    'int before;',
    '/* USER CODE BEGIN PV */',
    'static int mine = 1;',
    'static int also;',
    '/* USER CODE END PV */',
    '    /* USER CODE BEGIN Init */',
    '    setup();',
    '    /* USER CODE END Init */',
    '/* USER CODE BEGIN Empty */',
    '/* USER CODE END Empty */',
  ].join('\n'));
  assert.deepEqual(issues, []);
  assert.equal(sections.PV, 'static int mine = 1;\nstatic int also;');
  assert.equal(sections.Init, '    setup();', 'indentation is the user\'s, and is preserved');
  assert.equal(sections.Empty, '');
});

test('a malformed marker is reported, never guessed at', () => {
  const unclosed = eng.userSections('/* USER CODE BEGIN PV */\nint x;');
  assert.match(unclosed.issues[0], /BEGIN PV at line 1 is never closed/);

  const stray = eng.userSections('/* USER CODE END PV */');
  assert.match(stray.issues[0], /END PV at line 1 with nothing open/);

  const mismatched = eng.userSections('/* USER CODE BEGIN A */\n/* USER CODE END B */');
  assert.match(mismatched.issues[0], /END B at line 2 closes A/);

  const nested = eng.userSections('/* USER CODE BEGIN A */\n/* USER CODE BEGIN B */\n/* USER CODE END A */');
  assert.match(nested.issues[0], /BEGIN B at line 2 while A is still open/);
});

test('regeneration carries the user code across, by tag', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.compute();
  const first = e.cSource()
    .replace('/* USER CODE BEGIN PV */', '/* USER CODE BEGIN PV */\nstatic volatile uint32_t g_ticks;')
    .replace('/* USER CODE BEGIN Init */', '/* USER CODE BEGIN Init */\n    start_things();');

  // a different configuration entirely
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setPackage('QFN32');
  e.compute();
  const merged = eng.mergeUserCode(first, e.cSource());

  assert.ok(merged.text.includes('static volatile uint32_t g_ticks;'));
  assert.ok(merged.text.includes('    start_things();'));
  assert.deepEqual(merged.orphaned, []);
  assert.ok(merged.kept.includes('PV') && merged.kept.includes('Init'));
  // and the newly generated code is there as well, not replaced by the old file
  assert.ok(merged.text.includes('USART_InitTypeDef'), 'the new configuration is generated');
  assert.equal((merged.text.match(/static volatile uint32_t g_ticks;/g) || []).length, 1,
    'carried once, not duplicated');
});

test('merging into a file with no user code at all changes nothing', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.compute();
  const next = e.cSource();
  const merged = eng.mergeUserCode('/* an empty previous file */', next);
  assert.equal(merged.text, next);
  assert.deepEqual(merged.kept, []);
  assert.deepEqual(merged.orphaned, []);
});

test('a block whose tag disappeared is kept, commented out, never dropped', () => {
  const previous = [
    '/* USER CODE BEGIN PV */',
    'int keep_me;',
    '/* USER CODE END PV */',
    '/* USER CODE BEGIN Gone */',
    'int precious;',
    '/* USER CODE END Gone */',
  ].join('\n');
  const next = '/* USER CODE BEGIN PV */\n/* USER CODE END PV */\n';
  const merged = eng.mergeUserCode(previous, next);

  assert.deepEqual(merged.kept, ['PV']);
  assert.deepEqual(merged.orphaned, ['Gone']);
  assert.ok(merged.text.includes('int keep_me;'));
  assert.ok(merged.text.includes('int precious;'), 'deleting somebody\'s code quietly is not allowed');
  assert.match(merged.text, /USER CODE ORPHANED/);
  assert.match(merged.text, /was: USER CODE Gone/);
  // and it does not break the build it lands in
  assert.ok(merged.text.includes('#if 0'));
  assert.ok(merged.text.includes('#endif'));
});

test('an empty block whose tag disappeared is not reported as orphaned', () => {
  const previous = '/* USER CODE BEGIN Gone */\n\n/* USER CODE END Gone */';
  const merged = eng.mergeUserCode(previous, 'int x;\n');
  assert.deepEqual(merged.orphaned, [], 'nobody wrote anything in it, so there is nothing to save');
  assert.equal(merged.text, 'int x;\n');
});

test('merging twice is stable — regeneration is not a ratchet', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.compute();
  const edited = e.cSource().replace('/* USER CODE BEGIN PV */', '/* USER CODE BEGIN PV */\nint mine;');
  const once = eng.mergeUserCode(edited, e.cSource()).text;
  const twice = eng.mergeUserCode(once, e.cSource()).text;
  assert.equal(twice, once, 'the file converges instead of growing a copy every time');
});

// =============================================================================
//  Round 4, deliverable B — a whole PlatformIO project, not a file pair
// =============================================================================

test('the project is the folder data/firmware proved works, minus what only it needs', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setProject({ name: 'BlinkDemo', variant: 'CH32V006F8P7' });
  e.compute();
  const paths = e.projectFiles().map(f => f.path);
  for (const want of ['platformio.ini', 'README.md', '.gitignore', 'src/main.c',
    'lib/wchcube_generated/include/wchcube_init.h',
    'lib/wchcube_generated/src/wchcube_init.c']) {
    assert.ok(paths.includes(want), `${want} is in the project (${paths.join(', ')})`);
  }
  // the header goes to include/ and the source to src/, which is what that component's
  // library.json declares - the same split --pio writes into an existing project
  assert.ok(paths.every(p => !p.includes('//')));
  for (const f of e.projectFiles()) {
    assert.equal(f.name, f.path.slice(f.path.lastIndexOf('/') + 1), 'name is the basename');
    assert.ok(f.text.length, `${f.path} has content`);
    assert.ok(f.language, `${f.path} says what it is, for the preview`);
  }
});

test('platformio.ini takes every per-part value from the MCU file', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setProject({ name: 'BlinkDemo', variant: 'CH32V006F8P7' });
  e.compute();
  const ini = e.projectFiles().find(f => f.path === 'platformio.ini').text;
  const v = e.M.mcu.variants.CH32V006F8P7;
  assert.ok(ini.includes(`board     = ${v.pio_board}`), 'the board is the one the MCU file names');
  // The platform is pinned by GIT URL, and this assertion is the guard for it. The
  // Community-PIO-CH32V platform is not published in the PlatformIO registry - `pio pkg
  // search ch32v` finds nothing and the registry API answers 404 - so `platform = ch32v`
  // only ever resolved on a machine where it had been installed by hand. Emitting that
  // spelling sent every user a project that cannot build on a clean machine, and it is
  // the same defect that made the CI firmware job fail in two seconds.
  assert.match(ini, /platform {2}= https:\/\/github\.com\/Community-PIO-CH32V\/platform-ch32v\.git/,
    'the generated project must pin the platform by URL: the registry has no `ch32v`');
  assert.ok(!/^platform\s*=\s*ch32v\s*$/m.test(ini),
    '`platform = ch32v` does not resolve from the registry — a generated project saying it '
    + 'cannot build on a clean machine');
  assert.match(ini, /framework = noneos-sdk/);
  assert.match(ini, /-D SDI_PRINT=1/);
  assert.match(ini, /upload_protocol = wch-link/);
  assert.match(ini, /monitor_speed {3}= 115200/);
  assert.match(ini, /lib_ldf_mode = chain\+/, 'or the generated component is never found');
  // nothing about the part that the board JSON already knows. Comments may SAY that;
  // the settings may not contain it.
  const settings = ini.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith(';'));
  assert.deepEqual(settings.filter(l => /flash|f_cpu|march|mabi|upload_size/i.test(l)), [],
    'flash size, clock and ABI come from the platform board file, never from here');
});

test('a part number with no PlatformIO board is refused by name, never substituted', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const noBoard = Object.entries(e.M.mcu.variants).find(([, v]) => !v.pio_board);
  if (!noBoard) return;                       // every variant has one on this part
  e.setProject({ name: 'x', variant: noBoard[0] });
  const t = e.pioTarget();
  assert.equal(t.board, null);
  assert.match(t.missing, /ships no board for/);
  assert.ok(t.generatable.length, 'and it says which part numbers can');
  assert.throws(() => e.projectFiles(), new RegExp(`Part numbers that can`));
  // F4U6 is 16 KB of flash against F8U6's 62 KB: the nearest board would lie
  assert.equal(t.generatable.includes(noBoard[0]), false);
});

test('a part number for a different package is refused, not quietly mixed', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const other = Object.entries(e.M.mcu.variants)
    .find(([, v]) => v.pio_board && v.package && v.package !== 'TSSOP20');
  if (!other) return;
  e.setProject({ name: 'x', variant: other[0] });
  const t = e.pioTarget();
  assert.equal(t.board, null, 'generating pins for one package and an ini for another would build');
  assert.match(t.missing, new RegExp(`is the ${other[1].package} part but this configuration is for TSSOP20`));
});

test('main.c blinks a pin the user configured, and nothing when there is none', () => {
  const bare = fresh('CH32V006', 'TSSOP20');
  bare.setProject({ name: 'Bare', variant: 'CH32V006F8P7' });
  bare.compute();
  const noPin = bare.projectFiles().find(f => f.path === 'src/main.c').text;
  assert.equal(/GPIO_WriteBit/.test(noPin), false, 'nothing is toggled');
  assert.match(noPin, /no output GPIO is configured/);
  assert.match(noPin, /Picking a\s+pin for you would be inventing hardware/);

  const e = fresh('CH32V006', 'TSSOP20');
  e.setProject({ name: 'Blink', variant: 'CH32V006F8P7' });
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.setGpioField('PC0', 'label', 'STATUS_LED');
  e.compute();
  const c = e.projectFiles().find(f => f.path === 'src/main.c').text;
  assert.ok(c.includes('GPIO_WriteBit(GPIOC, GPIO_Pin_0,'), 'the pin the user configured');
  assert.match(c, /PC0 — "STATUS_LED" — Output Push Pull in this project/);
  assert.match(c, /toggling {10}: PC0 \\"STATUS_LED\\"/, 'and the banner names it');
});

test('main.c prints both clocks, because a configuration that did not take is invisible otherwise', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setProject({ name: 'Clocks', variant: 'CH32V006F8P7' });
  e.setClock({ sys: 'PLLCLK' });
  e.compute();
  const c = e.projectFiles().find(f => f.path === 'src/main.c').text;
  const r = e.clockCalc();
  assert.ok(c.includes(`configured SYSCLK : ${r.SYSCLK} MHz`), 'what the configuration asked for');
  assert.match(c, /SystemCoreClock\s*:\s*%lu Hz/, 'and what the silicon reports back');
  // the two-clock-owners sentence, and the call that keeps Delay_Ms honest
  assert.equal((c.match(/SystemCoreClockUpdate\(\);/g) || []).length, 2,
    'once before WCHCube_Init and once after, or Delay_Ms lies');
  assert.match(c, /WCHCube_RCC_Init\(\) then applies the tree this project asked for and wins/);
});

test('main.c has USER CODE sections, so regenerating it is not a reset', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setProject({ name: 'Keep', variant: 'CH32V006F8P7' });
  e.compute();
  const first = e.projectFiles().find(f => f.path === 'src/main.c').text;
  assert.deepEqual([...first.matchAll(/USER CODE BEGIN (\S+)/g)].map(m => m[1]),
    ['Includes', 'PV', 'Setup', 'Loop']);

  const edited = first.replace('/* USER CODE BEGIN Loop */', '/* USER CODE BEGIN Loop */\n        my_task();');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });      // a different configuration
  e.compute();
  const next = e.projectFiles().find(f => f.path === 'src/main.c').text;
  const merged = eng.mergeUserCode(edited, next);
  assert.ok(merged.text.includes('my_task();'), 'the user code survives');
  assert.ok(merged.text.includes('GPIO_WriteBit'), 'and the new configuration arrives');
  assert.deepEqual(merged.orphaned, []);
});

test('the README tells the truth about this configuration', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setProject({ name: 'Documented', variant: 'CH32V006F8P7' });
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.setGpioField('PC0', 'label', 'STATUS_LED');
  e.compute();
  const md = e.projectFiles().find(f => f.path === 'README.md').text;
  assert.match(md, /^# Documented/m);
  assert.match(md, /\*\*CH32V006F8P7\*\* \(CH32V006, TSSOP20\)/);
  assert.match(md, /pio run -t upload/);
  assert.match(md, /claims \*\*no pin\*\*/, 'why the banner works on a bare chip');
  assert.match(md, /`PC0` "STATUS_LED"/);
  assert.match(md, /Regeneration overwrites it/, 'which folder is machine-owned');
  assert.ok(md.includes(e.pinRows().filter(r => r.signal || r.label).length + ' pin'),
    'and it counts the pins this configuration really assigns');
});

test('every bundled part with a board generates a project that names only its own facts', () => {
  for (const name of Object.keys(eng.MCU_FILES)) {
    const e = fresh();
    e.loadMcu(name);
    const able = Object.entries((e.M.mcu.variants) || {}).filter(([, v]) => v && v.pio_board);
    if (!able.length) continue;
    for (const [variant, v] of able) {
      if (v.package && e.M.packages[v.package]) e.setPackage(v.package);
      e.setProject({ name: `t_${variant}`, variant });
      e.compute();
      const files = e.projectFiles();
      const ini = files.find(f => f.path === 'platformio.ini').text;
      assert.ok(ini.includes(v.pio_board), `${name} ${variant}: its own board`);
      const main = files.find(f => f.path === 'src/main.c').text;
      assert.ok(main.includes(`#include "${e.M.codegen.header}"`), `${name}: its own SPL header`);
      assert.equal(/GPIO_Speed_\w+/.test(main), false, 'main.c sets no GPIO up; the generated init does');
    }
  }
});
