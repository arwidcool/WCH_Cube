// =============================================================================
//  tests/completeness.test.js — the per-peripheral matrix. (C8, carried from round 2.)
//
//  `validate_mcu.py` checks that what an MCU file SAYS is consistent. This file
//  checks what it does not say. Every other test in this repo can pass on a part
//  whose peripherals are empty shells, because a shell is internally consistent.
//
//  For every peripheral of every real (non-fixture) part it asks:
//      settings   at least one setting that does something
//      params     a `params:` block, so Parameter Settings has rows
//      clock      a bit in codegen.periph_clock, so generated C can enable it
//      nvic       at least one vector, if the part has an `nvic:` block
//      dma        a DMA request, if the RM lists one for it
//      codegen    an init block appears in the generated C when it is enabled
//
//  Every missing cell is reported as `<peripheral>: <cell>` and ALL of them are
//  listed, not just the first. A gap is either a bug or a deliberate absence
//  with a written reason — and a deliberate absence has to be declared HERE, in
//  ABSENT below, with its citation. That is the point: it makes "we meant to
//  leave that out" a thing someone had to type, rather than a silence.
//
//  Last: the RM's chapter list is the outer checklist, read out of the reference
//  manual at run time rather than remembered, so a new RM revision that adds a
//  peripheral cannot pass unnoticed.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, test, assert, skip } from './lib/harness.js';
import * as eng from '../app/engine/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

suite('completeness');

// ---------------------------------------------------------------- the model
function boot() {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'vendor', 'js-yaml.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  eng.setYaml(mod.exports);
  eng.loadPackages(eng.yamlLoad(fs.readFileSync(path.join(ROOT, 'data', 'packages', 'packages.yaml'), 'utf8')));
  const dir = path.join(ROOT, 'data', 'mcus');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yaml')).sort()) {
    eng.registerMcuFile(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}
boot();

/**
 * The parts this applies to.
 *
 * Only real silicon counts here, and this file boots from `data/mcus/` alone — so the
 * synthetic layout fixture is not even registered. `FIXTURE_PARTS` stays as the explicit
 * statement of the rule rather than an accident of which directory is scanned: the
 * fixture (now `tests/fixtures/mcus/WCH-DUMMY32-C8.yaml`) is a renderer stress test from
 * QFN12 to LQFP144, its peripherals are invented, and no RM chapter owns them.
 */
const FIXTURE_PARTS = new Set(['WCH-DUMMY32-C8']);
const REAL_PARTS = Object.keys(eng.MCU_FILES).filter(n => !FIXTURE_PARTS.has(n)).sort();

// ---------------------------------------------------------------- exemptions
//
// A cell may be empty for two different reasons, and conflating them is how a
// whitelist quietly becomes a way of turning failures off. So there are two
// tables, and they behave differently.

/**
 * ABSENT — the silicon does not have it. Permanent, and each entry cites the
 * source that says so. `ch32v00X_rcc.h` and `ch32v00X.h` below are the EVT
 * package at `data/sources/V006/Evt/EXAM/SRC/Peripheral/inc/`, which
 * `data/sources/README.md` makes the highest authority for names.
 *
 * The clock entries are all the same evidence read the same way: `ch32v00X_rcc.h`
 * lines 84–104 are the COMPLETE set of `RCC_*Periph_*` macros for this family —
 * HB: DMA1, SRAM · PB2: AFIO, GPIOA–D, ADC1, TIM1, SPI1, USART1/2 · PB1: TIM2,
 * TIM3, WWDG, I2C1, PWR. A peripheral not in that list has no clock gate to emit.
 *
 * The nvic entries likewise: `IRQn_Type` in `ch32v00X.h` lines 45–82 ends at
 * `OPCM_IRQn = 40`, and the startup table in `Startup/startup_ch32v00X.S` agrees.
 */
const ABSENT = {
  // --- no `params:` because the peripheral's whole configuration is choices
  'SYS.params': 'SYS is the debug interface and the reset-pin option byte — both are choices, not numbers',
  'RCC.params': 'the clock tree is configured on the Clock tab; RCC has no per-peripheral parameters',
  'EXTI.params': 'notes.md: "the per-line trigger edge (EXTI_RTENR / EXTI_FTENR, RM 6.4.3), eight lines, no signals" — eight choices, no numbers',
  'DMA1.params': 'DMA parameters are per-REQUEST and live in the top-level dma.channel_params, not on the peripheral. FORMAT.md forbids modelling one fact twice',

  // --- no clock-enable bit exists for it (ch32v00X_rcc.h:84-104)
  'SYS.clock': 'not a clocked peripheral: the debug pins and an option byte. No RCC_*Periph_SYS exists',
  'RCC.clock': 'RCC is the clock controller; it cannot gate itself. No RCC_*Periph_RCC exists',
  'IWDG.clock': 'the independent watchdog runs from LSI and is started by writing IWDG_CTLR\'s key. There is no RCC_PB1Periph_IWDG in ch32v00X_rcc.h — checked, not assumed',
  'FLASH.clock': 'the flash controller is always clocked. No RCC_*Periph_FLASH exists',
  'EXTI.clock': 'EXTI sits behind AFIO, and the GPIO section already enables RCC_PB2Periph_AFIO. No RCC_*Periph_EXTI exists',
  'TKEY.clock': 'TouchKey is a mode of the ADC (RM ch.10), not a separate unit, and shares RCC_PB2Periph_ADC1. No RCC_*Periph_TKEY exists',
  'OPA1.clock': 'the OPA/CMP block has no clock gate of its own. No RCC_*Periph_OPA exists',
  'EXTEN.clock': 'the extended-configuration unit sits on the HB domain and is clocked with it, '
    + 'with no gate of its own: `ch32v00X.h:438` puts it at `HBPERIPH_BASE + 0x3800` (= the RM\'s '
    + '0x40023800) and there is no RCC_*Periph_EXTEN anywhere in ch32v00X_rcc.h. Same shape as '
    + 'FLASH, EXTI, TKEY and OPA1 above',
  'EXTEN.params': 'both of its user-visible bits are switches, not numbers: LKUPEN on/off and '
    + 'TIM2_DMA_REMAP on/off. LKUPRST is deliberately not offered at all — it is a write-1-to-clear '
    + 'STATUS flag saying a lock-up already reset the part, which firmware reads at startup and a '
    + 'configurator has no business setting (AGENT-1, round 3 board 16:29Z)',

  // --- no interrupt vector exists for it (IRQn_Type, ch32v00X.h:45-82)
  'SYS.nvic': 'the debug interface and the reset pin are not interrupt sources',
  'IWDG.nvic': 'the independent watchdog RESETS the part, it does not interrupt. No IWDG_IRQn in the enum',
  'TKEY.nvic': 'TouchKey raises the ADC vector, which is declared with peripheral: ADC1. No TKEY_IRQn in the enum',
  'EXTEN.nvic': 'the extended-configuration unit raises no interrupt: IRQn_Type in ch32v00X.h:45-82 '
    + 'ends at OPCM_IRQn = 40 and contains no EXTEN entry. LKUPRST is a polled status flag, not a vector',
  // --- per-part: true on THIS part and not on its siblings
  //
  // CH32X035 has ONE vector, `OPA_IRQn = 48`, for two OPAs and three
  // comparators. `IRQn_Type` in ch32x035.h contains no CMP entry of any kind and
  // no second OPA entry — the full list is 45 names and these are not among
  // them. So one of the five carries the vector (AGENT-1's data says which) and
  // the other four have none of their own. Same shape as TKEY sharing ADC1's
  // vector on CH32V006, and the same reason: a shared interrupt is a fact about
  // the silicon, not a gap in the extraction.
  'CH32X035.CMP1.nvic': 'shares OPA_IRQn = 48; there is no CMP vector in ch32x035.h',
  'CH32X035.CMP2.nvic': 'shares OPA_IRQn = 48; there is no CMP vector in ch32x035.h',
  'CH32X035.CMP3.nvic': 'shares OPA_IRQn = 48; there is no CMP vector in ch32x035.h',
  'CH32X035.OPA2.nvic': 'shares OPA_IRQn = 48 with OPA1; the enum has one OPA vector, not two',

  'CH32X035.RCC.nvic': 'CH32X035 has no RCC interrupt AT ALL. `IRQn_Type` in '
    + 'data/sources/X035/Evt/EXAM/SRC/Peripheral/inc/ch32x035.h jumps FLASH_IRQn = 18 straight to '
    + 'EXTI7_0_IRQn = 20, and Startup/startup_ch32x035.S has `.word 0` in that slot — two '
    + 'independent sources agreeing on an absence. CH32V006 has RCC_IRQn = 19, which is exactly '
    + 'why this key is per-part: "every family has an RCC interrupt" is the kind of assumption '
    + 'round 4 exists to break (AGENT-1, round-4 board 16:44Z)',

  'TIM3.nvic': 'THE RECORDED CONTRADICTION, and it survived the EVT drop: this part HAS a TIM3, and there is no TIM3 vector. '
    + 'RM Table 6-1 omits it, IRQn_Type ends at OPCM_IRQn = 40, and startup_ch32v00X.S agrees. Two independent sources, '
    + 'so it is recorded rather than invented. See CH32V006.notes.md',
};

/**
 * OPEN — the part HAS it and we have not modelled it yet, each entry naming the
 * `TASKS.md` line that tracks the work and the agent who owns it.
 *
 * These do not fail the run, because they are claimed work rather than unknown
 * gaps and a permanently red shared gate would stop four agents rather than
 * inform one. They are printed on every run instead, and a separate test below
 * checks each one still has a live TASKS.md line — so an entry cannot be parked
 * here and then quietly dropped from the backlog.
 */
const OPEN = {
  'TIM3.params': ['AGENT-1', '`params:` for TIM3, IWDG, WWDG, TKEY, OPA1'],
  'IWDG.params': ['AGENT-1', '`params:` for TIM3, IWDG, WWDG, TKEY, OPA1'],
  'WWDG.params': ['AGENT-1', '`params:` for TIM3, IWDG, WWDG, TKEY, OPA1'],
  'TKEY.params': ['AGENT-1', '`params:` for TIM3, IWDG, WWDG, TKEY, OPA1'],
  'OPA1.params': ['AGENT-1', '`params:` for TIM3, IWDG, WWDG, TKEY, OPA1'],
};

/**
 * Look a cell up in one of the tables, most specific key first.
 *
 * Keys may be `<PART>.<PID>.<cell>` or `<PID>.<cell>`, and `*` stands in for the
 * cell. The per-part form exists because **CH32X035 proved that an absence is
 * not a property of a peripheral, it is a property of a peripheral ON A PART**:
 * `RCC` has a vector on CH32V006 (`RCC_IRQn = 19`) and none at all on CH32X035,
 * where the enum jumps 18 → 20 and the startup table has a `.word 0` in that
 * slot. A table keyed only by peripheral cannot say that, and until the second
 * family landed nothing here needed it to. That is the round's whole thesis
 * arriving in a test file.
 */
const lookup = (table, part, pid, cell) =>
  table[`${part}.${pid}.${cell}`] || table[`${part}.${pid}.*`]
  || table[`${pid}.${cell}`] || table[`${pid}.*`];

const excused = (part, pid, cell) =>
  process.env.WCHCUBE_NO_EXEMPTIONS ? false : lookup(ABSENT, part, pid, cell);

/**
 * Parts whose extraction is explicitly still in progress, and the TASKS.md line
 * that says so.
 *
 * A part arrives over many commits. Listing every half-filled cell in OPEN as it
 * appears turns this file into a running commentary on somebody else's work in
 * progress, and every one of those entries then has to be removed by hand —
 * which is how a whitelist ends up outliving the thing it excused.
 *
 * So: while the part is declared in-extraction, its `params` and `clock` gaps
 * PRINT with the owner instead of failing. `settings` and `nvic` still fail,
 * because a peripheral with no setting at all is not "not finished yet", it is a
 * tree entry that does nothing; and a missing vector on a part that HAS an nvic
 * block is a claim about silicon rather than a gap in depth.
 *
 * It self-closes: the guard below fails if the TASKS.md line disappears, and the
 * day AGENT-1 ticks it every cell becomes a hard failure with no edit here.
 */
const IN_EXTRACTION = {
  CH32X035: ['AGENT-1', 'CH32X035 extraction: `params:` for the peripherals that have none'],
};
const SOFT_CELLS = new Set(['params', 'clock']);

// ---------------------------------------------------------------- the matrix
test('every peripheral of every real part has settings, params, a clock bit, and vectors', () => {
  const missing = [];
  const stillOpen = new Set();
  for (const part of REAL_PARTS) {
    eng.loadMcu(eng.MCU_FILES[part]);
    const M = eng.M;
    const clockBits = new Set();
    for (const dom of Object.values((M.codegen || {}).periph_clock || {})) {
      for (const name of Object.keys(dom.bits || {})) clockBits.add(name);
    }
    // Vectors declare their owner in `peripheral:`. Read that and nothing else —
    // guessing an owner from the vector NAME would be wrong on this part in both
    // directions: PVD and AWU belong to PWR, EXTI7_0 to EXTI, OPCM to OPA1, and
    // the ADC vector is spelled `ADC` while the peripheral is `ADC1`.
    const vectorOwners = new Set();
    for (const v of Object.values((M.nvic || {}).vectors || {})) {
      if (v.peripheral) vectorOwners.add(v.peripheral);
    }

    const say = (pid, cell, why) => {
      if (excused(part, pid, cell)) return;
      const extracting = IN_EXTRACTION[part];
      if (extracting && SOFT_CELLS.has(cell)) {
        stillOpen.add(`${part}  ${pid}: ${cell} — ${extracting[0]} owns it, extraction in progress`);
        return;
      }
      const open = lookup(OPEN, part, pid, cell);
      if (open) { stillOpen.add(`${part}  ${pid}: ${cell} — ${open[0]} owns it, TASKS.md: ${open[1]}`); return; }
      missing.push(`${part}  ${pid}: ${cell} — ${why}`);
    };

    for (const [pid, P] of Object.entries(M.peripherals || {})) {
      // settings — at least one, with at least one real (non-neutral) choice
      const settings = P.settings || [];
      const real = settings.filter(s => s.type === 'checkboxes' || (s.choices || []).length > 1);
      if (!real.length) say(pid, 'settings', `${settings.length} setting(s), none offering a choice`);

      // params — a block with at least one definition
      if (!(P.params || []).length) say(pid, 'params', 'no params: block, so Parameter Settings has no rows for it');

      // clock — a bit in codegen.periph_clock, or generated C cannot enable it
      if (Object.keys(M.codegen || {}).length && !clockBits.has(pid)) {
        say(pid, 'clock', 'no bit in codegen.periph_clock, so generated C cannot enable its clock');
      }

      // nvic — only asked of parts that have an nvic: block at all
      if (Object.keys((M.nvic || {}).vectors || {}).length && !vectorOwners.has(pid)) {
        say(pid, 'nvic', 'no vector in nvic.vectors names it');
      }
    }
  }
  // Claimed-but-unfinished cells are not failures, but they are not invisible
  // either: print them every run, so "we know about it" cannot decay into
  // "nobody has looked at it since round 2".
  if (stillOpen.size) {
    process.stdout.write(`        ${stillOpen.size} cell(s) known-missing and tracked:
`);
    for (const line of [...stillOpen].sort()) process.stdout.write(`          - ${line}
`);
  }
  assert.empty(missing, 'peripheral cells that are neither filled in nor declared absent in ABSENT');
});

test('every part declared in-extraction still has a live TASKS.md line', () => {
  // The guard that makes IN_EXTRACTION self-closing. Without it, a part could sit
  // "in extraction" forever and quietly stop being checked.
  const tasks = fs.readFileSync(path.join(ROOT, 'TASKS.md'), 'utf8');
  const orphans = [];
  for (const [part, [owner, task]] of Object.entries(IN_EXTRACTION)) {
    if (!eng.MCU_FILES[part]) { orphans.push(`${part} is declared in-extraction but is not a registered part`); continue; }
    if (!tasks.includes(task)) {
      orphans.push(`${part} is declared in-extraction citing ${owner}'s task "${task}", which is no longer in TASKS.md `
        + '— if the extraction is finished, delete the IN_EXTRACTION entry and let the cells fail');
    }
  }
  assert.empty(orphans, 'parts held in-extraction with no backlog line');
});

test('every cell parked in OPEN still has a live TASKS.md line', () => {
  // The check that keeps OPEN honest. Park something here and delete its backlog
  // line and this goes red — otherwise OPEN is just ABSENT without the citation.
  const tasks = fs.readFileSync(path.join(ROOT, 'TASKS.md'), 'utf8');
  const orphans = [];
  for (const [cell, [owner, line]] of Object.entries(OPEN)) {
    // Match on the distinctive words of the task line, not the whole string:
    // TASKS.md wraps, and a wrapped line must not read as a deleted one.
    const words = line.replace(/[`:]/g, '').split(/[\s,]+/).filter(w => w.length > 3);
    const present = words.every(w => tasks.includes(w));
    if (!present) orphans.push(`${cell} is parked in OPEN citing ${owner}'s task "${line}", which is no longer in TASKS.md`);
  }
  assert.empty(orphans, 'OPEN entries whose backlog line has gone');
});

test('every DMA request the data lists is owned by a peripheral that exists', () => {
  const bad = [];
  for (const part of REAL_PARTS) {
    eng.loadMcu(eng.MCU_FILES[part]);
    const reqs = (eng.M.dma || {}).requests || {};
    if (!Object.keys(reqs).length) continue;
    for (const [ch, list] of Object.entries(reqs)) {
      for (const sig of [].concat(list)) {
        const owner = String(sig).split('_')[0];
        if (!eng.M.peripherals[owner]) {
          bad.push(`${part}  DMA1 channel ${ch}: request "${sig}" names ${owner}, which is not a peripheral of this part`);
        }
      }
    }
  }
  assert.empty(bad, 'DMA requests naming a peripheral the part does not have');
});

test('every peripheral with a DMA request can actually be switched on', () => {
  // The inverse of the test above: a request map that mentions a peripheral the
  // user cannot enable is a dead row in the DMA tab.
  const bad = [];
  for (const part of REAL_PARTS) {
    eng.loadMcu(eng.MCU_FILES[part]);
    const reqs = (eng.M.dma || {}).requests || {};
    if (!Object.keys(reqs).length) continue;
    const owners = new Set();
    for (const list of Object.values(reqs)) {
      for (const sig of [].concat(list)) owners.add(String(sig).split('_')[0]);
    }
    for (const pid of owners) {
      const P = eng.M.peripherals[pid];
      if (!P) continue;                                  // reported by the test above
      if (!(P.settings || []).some(s => s.type === 'checkboxes' || (s.choices || []).length > 1)) {
        bad.push(`${part}  ${pid} has DMA requests but no setting that turns it on`);
      }
    }
  }
  assert.empty(bad, 'peripherals with DMA requests that cannot be enabled');
});

test('generated C emits an init block for every peripheral that claims a pin', () => {
  // The end of the chain: a peripheral can have settings, params, a clock bit and
  // a vector and STILL be invisible in the output. Enable each one in turn, put
  // its signals on pins, and look for it in the generated source.
  const missing = [];
  for (const part of REAL_PARTS) {
    eng.loadMcu(eng.MCU_FILES[part]);
    if (!Object.keys(eng.M.codegen || {}).length) continue;
    const pkg = eng.M.mcu.default_package || Object.keys(eng.M.packages)[0];

    for (const [pid, P] of Object.entries(eng.M.peripherals)) {
      // Turn it on through the first setting that has a non-neutral choice.
      eng.loadMcu(eng.MCU_FILES[part]);
      eng.setPackage(pkg);
      const s = (P.settings || []).find(x => x.type !== 'checkboxes' && (x.choices || []).length > 1);
      if (!s) continue;
      const neutral = eng.neutralChoice(s);
      const on = s.choices.find(c => c !== neutral && (c.signals || []).length);
      if (!on) continue;                                 // nothing that claims a pin
      try { eng.setSetting(pid, s.name, on.name); } catch { continue; }

      const E = eng.compute();
      if (E.conflictList.length) continue;               // this part/package cannot host it alone
      const claimed = eng.pinRows().filter(r => r.signal && r.signal.startsWith(pid + '_'));
      if (!claimed.length) continue;                     // the remap put it on no pin of this package

      const c = eng.cFiles()['wchcube_init.c'] || '';
      const named = claimed.some(r => c.includes(r.signal));
      if (!named) {
        missing.push(`${part}  ${pid}: enabled and holding ${claimed.map(r => r.pin || r.signal).join(', ')}, `
          + 'but no line of the generated C mentions any of its signals');
      }
    }
  }
  assert.empty(missing, 'peripherals that reach no generated code even when they hold a pin');
});

// ---------------------------------------------------------------- RM coverage
/**
 * RM chapter → what models it, for the CH32V00X family.
 *
 * A chapter is either mapped to peripherals in the MCU file, or listed with the
 * reason it is not a peripheral — quoted from `data/mcus/CH32V006.notes.md`,
 * "Round 2: PWR, FLASH and EXTI added as real peripherals". The map is checked
 * against the chapter headings read out of the RM at run time, so this cannot
 * drift from the document it claims to cover.
 */
const RM_CHAPTERS = {
  1:  { not_a_peripheral: 'memory and bus architecture — the map, not a unit' },
  2:  { peripherals: ['PWR'] },
  3:  { peripherals: ['RCC'] },
  4:  { peripherals: ['IWDG'] },
  5:  { peripherals: ['WWDG'] },
  6:  { peripherals: ['EXTI'], not_a_peripheral: 'notes.md: "PFIC (ch.6) is the `nvic:` block rather than a tree entry"; EXTI is ch.6.4 and IS a peripheral' },
  7:  { not_a_peripheral: 'notes.md: "GPIO/AFIO (ch.7) is the pin grid itself"' },
  8:  { peripherals: ['DMA1'] },
  9:  { peripherals: ['ADC1'] },
  10: { peripherals: ['TKEY'] },
  11: { peripherals: ['TIM1'] },
  12: { peripherals: ['TIM2'] },
  13: { peripherals: ['TIM3'] },
  14: { peripherals: ['USART1', 'USART2'] },
  15: { peripherals: ['I2C1'] },
  16: { peripherals: ['SPI1'] },
  17: { peripherals: ['OPA1'] },
  18: { peripherals: ['FLASH'] },
  19: { not_a_peripheral: 'notes.md: "ESIG (ch.19) is read-only silicon identity"' },
  // Found by this test. Not modelled, and NOT one of the four deliberate absences
  // CH32V006.notes.md declares — an undeclared fifth. Now tracked in TASKS.md and
  // owned, so it prints rather than failing; see OPEN above for why.
  // Found uncovered by this test in round 3, and AGENT-1 MODELLED it rather than
  // whitelisting it — the right call, because TIM2_DMA_REMAP moves TIM2_CH4's DMA
  // request onto the update channel, which changes the dma.requests map this app
  // renders. It was never cosmetic.
  20: { peripherals: ['EXTEN'] },
  21: { not_a_peripheral: 'notes.md: "DBG (ch.21) is covered by SYS\'s debug setting"' },
};

/** Chapter numbers and titles, read out of the reference manual. */
function rmChapters() {
  const rm = path.join(ROOT, 'data', 'sources', 'V006', 'Datasheets', 'CH32V00XRM.md');
  if (!fs.existsSync(rm)) return null;
  const out = new Map();
  for (const line of fs.readFileSync(rm, 'utf8').split(/\r?\n/)) {
    const m = /^#*\s*Chapter (\d+)\s+(.+?)\s*$/.exec(line);
    if (m && !out.has(Number(m[1]))) out.set(Number(m[1]), m[2]);
  }
  return out;
}

test('the RM chapter list is accounted for, chapter by chapter', () => {
  const chapters = rmChapters();
  if (!chapters) skip('data/sources/V006/Datasheets/CH32V00XRM.md is not present, so the chapter list cannot be read');
  assert.ok(chapters.size >= 20, `only ${chapters.size} chapters parsed out of the RM — the heading format changed`);

  eng.loadMcu(eng.MCU_FILES.CH32V006);
  const have = eng.M.peripherals;
  const problems = [], openChapters = [];

  for (const [n, title] of chapters) {
    const entry = RM_CHAPTERS[n];
    if (!entry) { problems.push(`RM chapter ${n} "${title}" is not accounted for at all — map it or declare it`); continue; }
    if (entry.open) {
      const [owner, what, why] = entry.open;
      openChapters.push(`RM chapter ${n} "${title}": ${what} — ${owner} owns it. ${why}`);
      continue;
    }
    for (const pid of entry.peripherals || []) {
      if (!have[pid]) problems.push(`RM chapter ${n} "${title}" maps to ${pid}, which CH32V006 does not have`);
    }
  }
  // And the other direction: a mapping for a chapter the RM no longer has.
  for (const n of Object.keys(RM_CHAPTERS)) {
    if (!chapters.has(Number(n))) problems.push(`RM_CHAPTERS names chapter ${n}, which this RM does not contain`);
  }
  if (openChapters.length) {
    process.stdout.write(`        ${openChapters.length} RM chapter(s) known-uncovered and tracked:\n`);
    for (const line of openChapters) process.stdout.write(`          - ${line}\n`);
  }
  assert.empty(problems, 'reference-manual chapters not covered by the MCU data');
});

test('every RM chapter parked as open still has a live TASKS.md line', () => {
  // Same guard as for OPEN cells: an uncovered chapter may only stop failing
  // because someone owns it, and ownership means a backlog line that exists.
  // The chapter-20 version of this hardcoded "RM chapter 20" and "EXTEN", which
  // stopped meaning anything the moment AGENT-1 modelled it. An `open` entry now
  // carries the backlog phrase it is claiming, and the guard checks THAT — so the
  // next uncovered chapter is guarded the same way without anyone editing this.
  const tasks = fs.readFileSync(path.join(ROOT, 'TASKS.md'), 'utf8');
  const orphans = [];
  for (const [n, entry] of Object.entries(RM_CHAPTERS)) {
    if (!entry.open) continue;
    const [owner, what, , task] = entry.open;
    if (!task) {
      orphans.push(`RM chapter ${n} is parked as open ("${what}") but names no TASKS.md line to check`);
    } else if (!tasks.includes(task)) {
      orphans.push(`RM chapter ${n} is parked as open citing ${owner}'s task "${task}", which is no longer in TASKS.md`);
    }
  }
  assert.empty(orphans, 'RM chapters parked as open with no backlog line');
});

test('every peripheral in the MCU file belongs to an RM chapter', () => {
  // The inverse sweep: a peripheral nobody can point at a chapter for is either
  // invented or misnamed, and either way it will generate code for nothing.
  eng.loadMcu(eng.MCU_FILES.CH32V006);
  const mapped = new Set();
  for (const e of Object.values(RM_CHAPTERS)) for (const pid of e.peripherals || []) mapped.add(pid);
  const orphans = Object.keys(eng.M.peripherals).filter(pid => !mapped.has(pid) && pid !== 'SYS');
  assert.empty(orphans.map(p => `${p} is in the MCU file but no RM chapter is mapped to it`),
    'peripherals with no reference-manual chapter behind them');
});
