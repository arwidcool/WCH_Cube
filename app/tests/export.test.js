// export.js — the pin table and clock summary behind the Generate button.
import { test, assert, fresh, eng } from './_harness.js';

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
  assert.deepEqual(out.map(f => f.name), [
    'wchcube_init.h', 'wchcube_init.c',
    'CH32V006_QFN32_pinout.md', 'CH32V006_QFN32_pinout.csv', 'CH32V006_QFN32_clocks.md',
  ], 'the reports are named after the part; the C files keep fixed include names');
  assert.deepEqual(out.map(f => f.language), ['c', 'c', 'markdown', 'csv', 'markdown']);
  for (const f of out) assert.ok(f.text.length > 100, `${f.name} has content`);
});

test('generateAll obeys the generator options, and only the ones that exist', () => {
  const e = fresh('CH32V006', 'QFN32');
  assert.deepEqual(e.generatorOptions().map(o => o.key), ['split_peripherals', 'reports', 'user_code'],
    'an option the engine cannot honour is not offered at all');
  assert.equal(e.generatorOption('reports'), true, 'the default comes from the definition');

  e.setGeneratorOption('reports', false);
  assert.deepEqual(e.generateAll().map(f => f.name), ['wchcube_init.h', 'wchcube_init.c'],
    'turning the reports off really stops generating them');
  e.undo();
  assert.equal(e.generateAll().length, 5, 'and it is one undo step like everything else');

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

test('the set of tags does not depend on the configuration', () => {
  const tagsOf = e => [...e.cSource().matchAll(/USER CODE BEGIN (\S+)/g)].map(m => m[1]).join(',');
  const empty = fresh('CH32V006', 'TSSOP20');
  empty.compute();

  const full = fresh('CH32V006', 'TSSOP20');
  full.setSetting('USART1', 'Mode', 'Asynchronous');
  full.assignSignal('PC0', { gpio: 'GPIO_Output' });
  full.addDmaRequest('USART1_TX');
  full.setNvicVector('USART1', { enabled: true });
  full.compute();

  assert.equal(tagsOf(empty), tagsOf(full),
    'a tag that comes and goes with the configuration would orphan code every time a '
    + 'peripheral is switched off');
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
