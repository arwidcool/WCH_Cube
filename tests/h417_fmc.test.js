// =============================================================================
//  tests/h417_fmc.test.js — the memory controller has a BUS MODE, and the reason that
//  matters is the most common thing anyone bolts onto an FSMC: an 8080 parallel TFT.
//
//  WHY THIS EXISTS. CH32H417's FMC was modelled with one switch per bus — `Data bus
//  D0-D31: Enabled`, `Address bus A0-A25: Enabled`. Both are real buses and both were
//  correctly routed, so every gate was green; but a user asking for an ILI9341-style
//  panel, which needs eight data lines and ONE address line, had no way to say so.
//  Measured on QFN128 before the reshaping: FSMC control alone claimed 48 pads, plus the
//  data bus 80, plus the address bus 103 — of 116 bonded. The part was unplannable for
//  the case it is most often used in, and nothing said so, because "can you express this
//  configuration" is not a question any other check in this repository asks.
//
//  The widths are the silicon's: `FMC_BCRx.MWID[5:4]` (RM 40, Table 40-17 at
//  CH32H417RM.md:57002) selects 8 / 16 / 32 bits and the SDK spells all three out
//  (`FMC_MemoryDataWidth_8b` / `_16b` / `_32b`, ch32h417_fmc.h:278-280). So what is
//  offered is a register field, not a convenience.
//
//  THE CONSTRAINT THAT MAKES THIS DELICATE, and the reason the "still claimable" test is
//  not optional: narrowing a choice REMOVES signals from it, and a signal no choice can
//  claim is a dead pad — a `validate_mcu.py` ERROR and an open coverage row
//  (docs/COVERAGE.md check 1). Splitting one 32-signal choice into several is exactly the
//  move that strands D16-D31. All 86 FMC signals are checked.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { suite, test, assert } from './lib/harness.js';
import { ROOT } from './lib/app.js';
import * as eng from '../app/engine/index.js';
import { withMutantMcu } from './lib/mutant.js';

suite('CH32H417 FMC');

const PART = 'CH32H417';

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

const load = pkg => { eng.loadMcu(eng.MCU_FILES[PART]); eng.setPackage(pkg); };

/** The `Bus mode` choice names, read from the data rather than retyped. */
const busModes = () => {
  eng.loadMcu(eng.MCU_FILES[PART]);
  const st = (eng.M.peripherals.FMC.settings || []).find(s => s.name === 'Bus mode');
  return (st ? st.choices || [] : []).map(c => c.name);
};
const modeNamed = re => busModes().find(n => re.test(n));

/** The FMC signals held after selecting one bus mode, plus anything `extra` adds. */
function fmcPads(pkg, mode, extra) {
  load(pkg);
  if (mode) eng.setSetting('FMC', 'Bus mode', mode);
  if (extra) extra();
  const E = eng.compute();
  const rows = eng.pinRows().filter(r => r.signal && /(^|\s|\/)FMC_/.test(String(r.signal)));
  return {
    conflicts: E.conflictList.length,
    signals: rows.map(r => String(r.signal).replace(/^FMC_/, '')).sort(),
    count: rows.length,
  };
}

test('an 8080 8-bit LCD is one dropdown pick and twelve signals', () => {
  // THE POINT OF THE FILE. D0-D7 + A0 (the panel's RS/DC) + NE1 (CS) + NOE (RD) + NWE (WR).
  // The panel's RESET and backlight are ordinary GPIO and deliberately NOT FSMC signals.
  const mode = modeNamed(/^8080 LCD, 8-bit \(/);
  assert.ok(mode, `no 8-bit 8080 LCD choice in Bus mode; got ${JSON.stringify(busModes())}`);
  const r = fmcPads('QFN128', mode);
  assert.deep(r.signals,
    ['A0', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'NE1', 'NOE', 'NWE'].sort(),
    'the 8080 8-bit preset should be a COMPLETE wiring: data, RS/DC, CS and both strobes');
  assert.equal(r.conflicts, 0, 'the 8080 preset should be conflict-free out of the box');
});

test('every 8080 LCD preset is complete — data lines plus RS, CS and both strobes', () => {
  // A preset that claimed only data lines would be a trap: it looks configured and the
  // panel does not work, and the missing pins are exactly the ones a beginner forgets.
  const bad = [];
  for (const mode of busModes().filter(n => /^8080 LCD/.test(n))) {
    const s = new Set(fmcPads('QFN128', mode).signals);
    for (const need of ['A0', 'NOE', 'NWE']) {
      if (!s.has(need)) bad.push(`${mode}: no ${need}`);
    }
    if (!s.has('NE1') && !s.has('NE2')) bad.push(`${mode}: no chip select`);
    const data = [...s].filter(x => /^D\d+$/.test(x));
    if (data.length !== 8 && data.length !== 16) bad.push(`${mode}: ${data.length} data lines, expected 8 or 16`);
    // ...and the data lines must be D0..Dn-1, contiguous from zero.
    const nums = data.map(x => +x.slice(1)).sort((a, b) => a - b);
    if (nums.some((v, i) => v !== i)) bad.push(`${mode}: data lines are not D0..D${data.length - 1}`);
  }
  assert.ok(busModes().filter(n => /^8080 LCD/.test(n)).length >= 2, 'expected at least an 8- and a 16-bit LCD preset');
  assert.empty(bad, 'incomplete 8080 LCD presets');
});

test('no 6800 mode is offered, because this controller does not have one', () => {
  // THE ROUND'S RULE, applied to a thing people ask for. FSMC drives an 8080-style bus:
  // separate read and write strobes, and `FMC_BCRx.MTYP` selects SRAM / PSRAM / NOR only
  // (ch32h417_fmc.h:273-275). There is no register that turns NOE/NWE into a 6800 E + R/W
  // pair, so offering "6800" would be offering a mode the silicon cannot honour. A
  // 6800-wired panel is strapped to 8080 at the PANEL (IM/PS pins) instead.
  const offered = busModes().filter(n => /6800|motorola/i.test(n));
  assert.empty(offered, 'Bus mode offers a 6800 interface, which FSMC does not implement — '
    + 'MTYP is SRAM/PSRAM/NOR and the strobes are NOE/NWE, so this would be a choice the '
    + 'silicon cannot honour');
  // ...and the reason has to be written down where a user meets it, or the absence reads
  // as an oversight and somebody adds it back.
  eng.loadMcu(eng.MCU_FILES[PART]);
  const notes = String(eng.M.peripherals.FMC.notes || '');
  assert.ok(notes.length > 200, 'FMC should carry a notes: paragraph');
  assert.match(notes, /8080/, 'FMC notes should name the interface it does drive');
});

test('the bus width is a real choice: 8 / 16 / 32 claim 8 / 16 / 32 data lines', () => {
  // A width that does not change the pin count is a label, not a setting — and MWID is a
  // register field, so the options have to differ in the only way a pin planner sees.
  const bad = [];
  for (const [re, n] of [[/^Memory bus, 8-bit/, 8], [/^Memory bus, 16-bit/, 16], [/^Memory bus, 32-bit/, 32]]) {
    const mode = modeNamed(re);
    assert.ok(mode, `no Bus mode choice matching ${re}`);
    const data = fmcPads('QFN128', mode).signals.filter(s => /^D\d+$/.test(s));
    if (data.length !== n) bad.push(`${mode}: ${data.length} data lines, expected ${n}`);
    const nums = data.map(s => +s.slice(1)).sort((a, b) => a - b);
    if (nums.some((v, i) => v !== i)) bad.push(`${mode}: should claim D0..D${n - 1}`);
    // A memory-bus choice claims DATA ONLY: the address width, chip select and strobes are
    // the rows below, because a memory wants a real address bus where a display wants one line.
    const nonData = fmcPads('QFN128', mode).signals.filter(s => !/^D\d+$/.test(s));
    if (nonData.length) bad.push(`${mode}: also claims ${nonData.join(',')} — memory modes claim data only`);
  }
  assert.empty(bad, 'the memory bus widths do not behave as widths');
});

test('choosing a narrow bus frees the high data lines for something else', () => {
  // The planning payoff, and the same argument as LTDC's colour depth: the lines the
  // controller does not claim are ordinary pins. Verified by taking four of them.
  const wide = fmcPads('QFN128', modeNamed(/^Memory bus, 32-bit/));
  const narrow = fmcPads('QFN128', modeNamed(/^8080 LCD, 8-bit \(/));
  assert.ok(narrow.count < wide.count - 15,
    `an 8-bit LCD bus should hold far fewer pads than a 32-bit memory bus (${narrow.count} vs ${wide.count})`);

  load('QFN128');
  eng.setSetting('FMC', 'Bus mode', modeNamed(/^8080 LCD, 8-bit \(/));
  const opts = eng.M.peripherals.FMC.signal_pins || {};
  const taken = [];
  for (const sig of ['D16', 'D17', 'D18', 'D19']) {
    const o = (opts[sig] || [])[0];
    if (o) { eng.assignSignal(String(o.pin), { gpio: 'GPIO_Output' }); taken.push(String(o.pin)); }
  }
  assert.ok(taken.length >= 3, 'expected the high data lines to have bonded pads to reuse');
  const E = eng.compute();
  assert.equal(E.conflictList.length, 0,
    'the data lines an 8-bit bus does not wire should be assignable to something else, got: '
    + E.conflictList.map(c => c.text).join(' | '));
});

test('every FMC signal is still claimable by some choice after the split', () => {
  // THE REGRESSION GUARD. Narrowing a choice removes signals from it, and a routed signal
  // no choice names is a dead pad — the defect class that shipped 207 of them on this part.
  // `completeness.test.js` asserts this for every peripheral of every part; it is repeated
  // here, named, because THIS file is where someone edits the FMC choices.
  eng.loadMcu(eng.MCU_FILES[PART]);
  const per = eng.M.peripherals.FMC;
  const routed = new Set(Object.keys(per.signal_pins || {}));
  const named = new Set();
  for (const st of per.settings || []) {
    for (const ch of st.choices || []) for (const s of ch.signals || []) named.add(s);
  }
  const orphaned = [...routed].filter(s => !named.has(s)).sort();
  assert.empty(orphaned,
    `FMC signals routed to a pin that no setting choice can claim (${routed.size} routed, `
    + `${named.size} named) — each is a pad the user can never assign`);
  const invented = [...named].filter(s => !routed.has(s)).sort();
  assert.empty(invented, 'FMC choices naming signals this peripheral does not route');
});

test('the address rows are contiguous from A0, and A0-only really is one line', () => {
  // A0 is the 8080 RS/DC on an 8-bit bus, and the reason is arithmetic rather than taste:
  // with MWID = 8 bits A0 is the byte address, so the command register sits at the bank
  // base and the data register one byte above it. If the LCD preset ever claims more than
  // one address line, the note telling people to wire RS to A0 is wrong.
  const lcd = fmcPads('QFN128', modeNamed(/^8080 LCD, 8-bit \(/));
  assert.deep(lcd.signals.filter(s => /^A\d+$/.test(s)), ['A0'],
    'the 8080 preset must claim exactly one address line');

  const bad = [];
  for (const [choice, n] of [['A0-A7', 8], ['A0-A15', 16], ['A0-A18', 19], ['A0-A25', 26]]) {
    const r = fmcPads('QFN128', null, () => eng.setSetting('FMC', 'Address lines', choice));
    const a = r.signals.filter(s => /^A\d+$/.test(s)).map(s => +s.slice(1)).sort((x, y) => x - y);
    if (a.length !== n || a.some((v, i) => v !== i)) {
      bad.push(`${choice} should claim A0..A${n - 1}, claimed ${a.length} line(s)`);
    }
  }
  assert.empty(bad, 'the address-line groups are not contiguous runs from A0');
});

// =============================================================================
//  THE PLANTED BREAK — round 6, deliverable B. The completeness check above is the one a
//  beginner is protected by: a preset that claimed the data lines and forgot a strobe would
//  look configured and the panel would never answer. Drop WR (NWE) from the 8-bit preset in
//  a re-registered COPY of the part's text and the check must name exactly that. The tree
//  is untouched; the restore is proved by re-running the check and requiring it clean.
// =============================================================================
test('planted break: an 8080 preset missing its WR strobe is named by the completeness check', () => {
  const LINE = 'signals: [D0, D1, D2, D3, D4, D5, D6, D7, A0, NE1, NOE, NWE] }';
  const incomplete = () => {
    const bad = [];
    for (const mode of busModes().filter(n => /^8080 LCD/.test(n))) {
      const s = new Set(fmcPads('QFN128', mode).signals);
      for (const need of ['A0', 'NOE', 'NWE']) if (!s.has(need)) bad.push(`${mode}: no ${need}`);
    }
    return bad;
  };
  assert.empty(incomplete(), 'the baseline has an incomplete preset, so the plant could not be attributed');
  const bad = withMutantMcu(eng, PART,
    src => src.replace(LINE, 'signals: [D0, D1, D2, D3, D4, D5, D6, D7, A0, NE1, NOE] }'),
    incomplete);
  assert.equal(bad.length, 1, `expected exactly the planted preset to be reported, got ${bad.length}:\n${bad.join('\n')}`);
  assert.match(bad[0], /^8080 LCD, 8-bit \(/, 'the wrong preset was named');
  assert.match(bad[0], /no NWE$/, 'the report does not say which strobe is missing');
  console.log(`      planted refusal (8080 preset): ${bad[0]}`);
  assert.empty(incomplete(), 'the original part was not restored after the plant');
});
