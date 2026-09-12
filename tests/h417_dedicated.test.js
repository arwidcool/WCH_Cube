// =============================================================================
//  tests/h417_dedicated.test.js — CH32H417's SDMMC and UHSIF signals, cross-checked
//  against the DS's own signal-first tables, as a gate rather than a one-off audit.
//
//  WHY THIS EXISTS. DS Table 2-1-1 is PIN-first, and WCH writes the AFIO_PCFR1 remap
//  field value into the signal name there. DS Note 3 says so in as many words:
//
//      "The value after the remap function underline indicates the configuration value
//       of the corresponding bit in the AFIO_PCFR1 register. For example, UHSIF_CLK_1
//       indicates that the corresponding bit of the register is configured as 01b."
//
//  Read as a name, `UHSIF_CLK_1` is a second signal on a second pad. It is not: it is
//  `UHSIF_CLK` with the remap bits set to 01. The pin-first read produced 74 signal names
//  where the datasheet has 62; four of SDMMC's eight data lines were split in two; and
//  `CMD_2` and `CMD_3` named the SAME pad (PC10) as two different signals, so the engine
//  would report no conflict between two things that are one thing.
//
//  A second defect lived in the same table: the PDF text extractor wraps a long name, so
//  `UHSIF_PORT32_2` arrives as `UHSIF_PORT32_` with the `2` on the next line. The digit
//  was lost and 48 names kept a trailing underscore that appears nowhere in the
//  datasheet — a name no compiler has ever seen.
//
//  The check is DS Tables 2-2-12 (SDMMC) and 2-2-16 (UHSIF), which are SIGNAL-first: one
//  row per signal, one column per remap, no suffix in the name. Structurally independent
//  from Table 2-1-1, so agreeing with it is evidence rather than a restatement.
//
//  WHAT IS ASSERTED. That the audit runs, reads both tables, and finds NO difference —
//  names and pin sets both. Unlike `h417_af.test.js` there is no recorded difference set
//  here: Table 2-2-x and the file agree completely, and any new difference is a defect.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { suite, test, assert, skip } from './lib/harness.js';
import { ROOT } from './lib/app.js';

suite('CH32H417 dedicated signals');

const TOOL = path.join(ROOT, 'tools', 'audit_h417_dedicated.py');
const DS = path.join(ROOT, 'data', 'sources', 'H417', 'Datasheets', 'CH32H417DS0.md');
const MCU = path.join(ROOT, 'data', 'mcus', 'CH32H417.yaml');

function runAudit() {
  const tried = [];
  for (const exe of ['python', 'python3']) {
    tried.push(exe);
    const res = spawnSync(exe, [TOOL], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (!res.error) return { ...res, out: ((res.stdout || '') + (res.stderr || '')) };
  }
  return { missing: true, tried };
}

test('SDMMC and UHSIF match DS Tables 2-2-12 and 2-2-16, signal for signal', () => {
  if (!fs.existsSync(TOOL)) skip(`${path.relative(ROOT, TOOL)} does not exist`);
  if (!fs.existsSync(DS)) skip('the CH32H417 datasheet is not in data/sources/ — nothing to compare');
  if (!fs.existsSync(MCU)) skip('data/mcus/CH32H417.yaml does not exist');

  const res = runAudit();
  if (res.missing) skip(`no python interpreter on PATH (tried: ${res.tried.join(', ')})`);
  if (/PyYAML is required/.test(res.out)) skip('PyYAML is not installed — pip install pyyaml');

  const out = res.out.replace(/\r\n?/g, '\n');

  // Exit 2 is "the tables could not be read", which means it compared nothing and a green
  // result here would mean nothing either.
  assert.notEqual(res.status, 2,
    `the DS signal-first tables could not be read, so this gate proves nothing:\n${out}`);

  // Proof the audit is still looking. These counts come from the datasheet, so a change
  // to either means the parse moved, not that the data improved.
  assert.ok(/== SDMMC: DS names 13 signals/.test(out),
    `the audit no longer reads 13 signals out of DS Table 2-2-12 — its parse of the table `
    + `has changed, so agreeing with it would no longer mean anything:\n${out}`);
  assert.ok(/== UHSIF: DS names 49 signals/.test(out),
    `the audit no longer reads 49 signals out of DS Table 2-2-16:\n${out}`);

  assert.equal(res.status, 0,
    'CH32H417\'s dedicated-function signals no longer match the DS\'s own signal-first '
    + 'tables.\n'
    + '    MISSING / NOT IN THE DS means a signal name or pin set changed. A name carrying '
    + 'a `_<digit>` suffix or a trailing underscore is the AFIO_PCFR1 remap value read as '
    + 'part of the name (DS Note 3) — the signal is the stem, and the remap value is not '
    + 'part of it.\n'
    + '    Regenerate with:  python tools/gen_h417_dedicated_pins.py && '
    + 'python tools/gen_h417_peripherals.py --splice --refresh\n'
    + `\n${out}`);
});

test('the audit can fail: a torn signal name is caught', () => {
  // Planted break, run every time — the same shape `h417_af.test.js` uses. The audit's
  // whole job is to notice a name like `PORT32_` or `CMD_3`, so if that detection
  // silently stopped working the assertion above would pass on exactly the data this
  // file exists to reject.
  //
  // The real audit was seen to go RED on real data before this fix landed: exit 1, with
  // `UHSIF CLK file [PB9, PC0, PD9, PF11, PF14]` (PB9 is the SWDIO pad, which Table
  // 2-2-16 does not give to UHSIF_CLK), `TORN NAMES still in the file (40)` and
  // `TORN NAMES still in the file (34)`. That red run is what the fix was for.
  const tornReport = [
    '   TORN NAMES still in the file (2): [\'CMD_3\', \'PORT32_\']',
    '   CLK: DS [\'PC0\', \'PD9\', \'PF11\', \'PF14\']  file [\'PB9\', \'PC0\']',
    '',
    '2 difference group(s) against DS Tables 2-2-12/2-2-16',
  ].join('\r\n');
  const cleanReport = [
    '== SDMMC: DS names 13 signals; file names 13',
    '== UHSIF: DS names 49 signals; file names 49',
    '',
    'SDMMC and UHSIF agree with DS Tables 2-2-12/2-2-16, signal for signal',
  ].join('\r\n');

  // CRLF plants, because the report comes from Python on Windows. Without the
  // normalisation these reads return nothing — the defect `build.py` and
  // `h417_af.test.js` both hit, and the reason the real run normalises too.
  const read = (s) => s.replace(/\r\n?/g, '\n');

  const torn = /TORN NAMES still in the file \((\d+)\)/.exec(read(tornReport));
  assert.ok(torn, 'the reader no longer finds the torn-name line, so this gate cannot report one');
  assert.equal(torn[1], '2', 'the torn-name count is not read back correctly');
  assert.ok(/CLK: DS \[[^\]]*\]\s+file \[/.test(read(tornReport)),
    'the reader no longer finds a disagreement line, so a wrong pin set would go unreported');

  // The clean report must NOT match either reader, or "no difference" and "a difference"
  // would be indistinguishable and the green result above would mean nothing.
  assert.ok(!/TORN NAMES/.test(read(cleanReport)),
    'a clean report is being read as though it had torn names');
  assert.ok(/\bagree with DS Tables 2-2-12\/2-2-16\b/.test(read(cleanReport)),
    'the success line moved — the assertion above would pass on a red run');
});

