// =============================================================================
//  tests/h417_af.test.js — the CH32H417 pin/AF map, cross-checked against the DS's
//  OWN second reading, as a gate rather than a one-off audit.
//
//  WHY THIS EXISTS. `data/mcus/CH32H417.yaml` carries ~950 pin/AF assignments and every
//  one came from a single parsing of DS Table 2-1-1 - the PIN-first table. This
//  repository's rule is that a mechanical extraction is confirmed against an independent
//  second source (CH32V006's 232 remap assignments were, with 0 differences), and until
//  2026-09-12 that had never been done here. It was worth doing: the audit found 12
//  assignments the first parse had LOST to line-wrapped signal names, and a merge that
//  replaced instead of uniting - including `DVP` pins filed under the USB controller.
//
//  The second reading is the DS's Tables 2-2-1..2-2-31, which are PERIPHERAL-first: one
//  table per peripheral family. Different layout, different parse, so a bug in one does
//  not reproduce in the other.
//
//  WHAT IS ASSERTED, and what is deliberately NOT. The remaining differences are the
//  places where the DS's own two tables disagree - recorded, with citations, in
//  `CH32H417.notes.md`. This test does NOT assert they are equal (they are not) and does
//  NOT assert a particular side is right. It asserts that the difference set is EXACTLY
//  the one on record: a new difference means either a data change or a parse regression,
//  and both want a human. That is the same contract `completeness.test.js` uses for its
//  OPEN cells - a declared, cited, countable gap rather than a silent one.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { suite, test, assert, skip } from './lib/harness.js';
import { ROOT } from './lib/app.js';

suite('CH32H417 AF map');

const TOOL = path.join(ROOT, 'tools', 'audit_h417_af.py');
const DS = path.join(ROOT, 'data', 'sources', 'H417', 'Datasheets', 'CH32H417DS0.md');
const MCU = path.join(ROOT, 'data', 'mcus', 'CH32H417.yaml');

/**
 * The differences on record, exactly as `tools/audit_h417_af.py` reports them.
 *
 * Every line is a place where DS Table 2-1-1 (pin-first, which this file follows) and the
 * DS's Tables 2-2-x (peripheral-first) disagree about the same part. Both readings are
 * kept in `CH32H417.notes.md` with what each one says; none is silently picked. A line
 * leaving this list is a change to the data or to the parser, not a happy accident.
 */
const INVENTED = [
  'LTDC_B4 PA15 AF10',
  'LTDC_CLK PE14 AF13',
  'QSPI1_SIOX3 PF5 AF9',
  'QSPI2_SIOX0 PB13 AF11',
  'QSPI2_SIOX1 PB14 AF11',
  'SAI_SD_A PC1 AF7',
  'SDIO_D1 PB15 AF9',
  'USART8_CTS PF10 AF11',
  'USART8_RTS PF9 AF11',
];
const GAPS = [
  'I2S2_MCK PC6 AF5',
  'LPTIM2_CH2 PB12 AF13',
  'LTDC_CLK PE14 AF14',
  'QSPI2_SIOX2 PB13 AF11',
  'QSPI2_SIOX3 PB14 AF11',
  'SAI_SD_A PC1 AF6',
  'USART8_CTS PE10 AF11',
  'USART8_RTS PE9 AF11',
];

function runAudit() {
  const tried = [];
  for (const exe of ['python', 'python3']) {
    tried.push(exe);
    const res = spawnSync(exe, [TOOL], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (!res.error) return { ...res, out: ((res.stdout || '') + (res.stderr || '')) };
  }
  return { missing: true, tried };
}

/** The lines the tool printed after a heading, up to the next blank-ish line. */
function section(out, heading) {
  // Normalise line endings FIRST. Python on Windows writes CRLF, and in JavaScript `.` does
  // not match `\r` (it is a line terminator) while `$` does not match before it either — so
  // a pattern like /^\s{6}(\S.*)$/ silently matches NOTHING and this reader returned an
  // empty list for every section. The assertion that caught it was the one insisting a
  // known difference is still present, which is why that assertion exists.
  //
  // It is the same class of defect as `build.py` writing the dist with the OS line ending:
  // a text artefact that differs between the machine that produced it and the one reading
  // it. Cheap to normalise, expensive to debug.
  const lines = out.replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex(l => l.includes(heading));
  if (at < 0) return null;
  const got = [];
  for (let i = at + 1; i < lines.length; i++) {
    const m = /^\s{6}(\S.*)$/.exec(lines[i]);
    if (!m) break;
    got.push(m[1].trim());
  }
  return got.sort();
}

test('the AF map still matches the DS\'s second reading, difference for difference', () => {
  if (!fs.existsSync(TOOL)) skip(`${path.relative(ROOT, TOOL)} does not exist`);
  if (!fs.existsSync(DS)) skip('the CH32H417 datasheet is not in data/sources/ — nothing to compare');
  if (!fs.existsSync(MCU)) skip('data/mcus/CH32H417.yaml does not exist');

  const res = runAudit();
  if (res.missing) skip(`no python interpreter on PATH (tried: ${res.tried.join(', ')})`);
  if (/PyYAML is required/.test(res.out)) skip('PyYAML is not installed — pip install pyyaml');

  // The tool exits 2 when the two readings share nothing, which means it compared nothing.
  assert.notEqual(res.status, 2,
    `the two DS readings could not be compared at all, so this gate proves nothing:\n${res.out}`);

  const invented = section(res.out, 'MCU pairs the 2-2 tables do NOT have');
  const gaps = section(res.out, 'DS 2-2 pairs the MCU file does NOT have');
  assert.ok(invented && gaps,
    `could not read the difference lists out of the audit — its output format moved:\n${res.out}`);

  // A cross-check that stops finding anything has stopped looking. Both lists being empty
  // is possible in principle, but the pair `LTDC_CLK PE14` appears in both directions and
  // cannot vanish without the DS changing, so its absence means the parse broke.
  assert.ok(invented.includes('LTDC_CLK PE14 AF13'),
    'the audit no longer sees the LTDC_CLK/PE14 disagreement, which is in the datasheet '
    + 'itself. Either the datasheet changed or the parser stopped reading it');

  assert.deep(invented, INVENTED.slice().sort(),
    'the set of pairs the MCU file has and the 2-2 tables do not has changed.\n'
    + '    A NEW line means the data gained an assignment the second reading does not '
    + 'support: check it against DS Table 2-1-1 and, if it is real, add it to INVENTED here '
    + 'and to the table in CH32H417.notes.md.\n'
    + '    A MISSING line means a difference was resolved — good, but say so in the notes '
    + 'rather than only here.');

  assert.deep(gaps, GAPS.slice().sort(),
    'the set of pairs the 2-2 tables have and the MCU file does not has changed.\n'
    + '    A NEW line is a possible GAP — an assignment the pin-first reading lost. Check '
    + 'whether the 2-1-1 row for that pin carries the signal, allowing for a line-wrapped '
    + 'name (tools/extract_h417_pins.py repairs those).\n'
    + '    A MISSING line means a gap was filled; remove it here and update the notes.');
});

test('the audit can fail: a changed difference set is caught', () => {
  // Planted break, run every time. `section()` is the half that reads the tool's report,
  // and a report parser that matched nothing would leave the assertions above vacuous
  // while still passing the `ok(...)` guard.
  const sample = [
    'DS tables 2-2-x : 391 signal(s)',
    '',
    "  MCU pairs the 2-2 tables do NOT have (possible inventions): 2",
    '      LTDC_CLK PE14 AF13',
    '      SOMETHING_NEW PA1 AF2',
    '',
    '  DS 2-2 pairs the MCU file does NOT have (possible gaps)   : 1',
    '      LTDC_CLK PE14 AF14',
  ].join('\n');
  assert.deep(section(sample, 'MCU pairs the 2-2 tables do NOT have'),
    ['LTDC_CLK PE14 AF13', 'SOMETHING_NEW PA1 AF2'],
    'the report reader did not pick up a planted line, so the assertions above compare '
    + 'against whatever it happens to return');
  assert.deep(section(sample, 'DS 2-2 pairs the MCU file does NOT have'),
    ['LTDC_CLK PE14 AF14'], 'the gaps list was not read');
  assert.equal(section(sample, 'a heading that is not there'), null,
    'an absent heading returned a list instead of null, so a missing section would read as empty');
});
