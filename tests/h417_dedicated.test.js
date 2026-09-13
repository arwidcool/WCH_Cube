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
//  WHAT IS ASSERTED. That the audit runs, reads both tables, and finds no UN-ACCOUNTED-FOR
//  difference. "Unaccounted-for" carries real weight, and is not "any difference we felt
//  like waving off": the ONE shape this file accepts as a legitimate difference is a
//  signal whose modeled pin set is a SUBSET of the DS's — never a superset, never a
//  substitution, never a signal added or dropped whole, never a torn name — and only for a
//  peripheral named in `KNOWN_NARROWED` below, with a citation for WHY the rest of the
//  DS's pin set can never be reached. That is `data/coverage/<PART>.yaml`'s own
//  `absent:`/`disagreements:` shape (a citation, not a silent patch) applied to this
//  audit: AGENT-1 found the SDMMC's DS Table 2-2-12 is a `SDMMC_RM[1:0]` remap table, this
//  part's `codegen.remap.style: af` forbids the `codegen.remap.fields` that could ever
//  write it (`data/FORMAT.md:654-657`), so only `SDMMC_RM=00` — the reset default — is
//  reachable through anything the generator emits (`AFIO_PCFR1.SDMMC_RM[1:0]`,
//  `CH32H417RM.md:11741-11768`, Table 9-32; `agents/BOARD.md` 2026-09-13T20:23Z). DS-
//  completeness and "never offer a choice the generator cannot reach" are both real rules;
//  this is where they are reconciled — by recording which one wins, for which peripheral,
//  and why, rather than by silently relaxing the check for everyone.
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

// A peripheral this audit may find NARROWER than the DS's signal-first table without
// that being a defect — every entry needs the citation for WHY the rest of the DS's pin
// set is unreachable, the same discipline `data/coverage/<PART>.yaml`'s `absent:` entries
// already carry. This does not exist yet: it is EMPTY until AGENT-1's narrowed
// `signal_pins:` actually lands, at which point the classifier below accepts it — a
// signal named here whose file pin set turns out NOT to be a subset of the DS's still
// fails, so this cannot silently cover a genuinely wrong pin.
const KNOWN_NARROWED = {
  // Verified 2026-09-13 (AGENT-3) against CH32H417RM.md:11741-11768 Table 9-32 itself,
  // not just AGENT-1's board claim: all 13 file pins equal SDMMC_RM=00's own "Default
  // mapping" value (STS/CMD/PD2, SDCK/SLVCK/PC12, STR/PD3, D0/PC8, D1/PC9, D2/PC10,
  // D3/PC11, D4/PA14, D5/PA15, D6/PC6, D7/PC7 - digit for digit), and each is a genuine
  // member of the DS's per-signal set (the union of the 00/01/1x remap rows) - zero torn
  // names, zero superset, zero substitution.
  SDMMC: 'AFIO_PCFR1.SDMMC_RM[1:0] (CH32H417RM.md:11741-11768, Table 9-32) selects the '
    + 'pin set; codegen.remap.style: af forbids codegen.remap.fields '
    + '(data/FORMAT.md:654-657), so no emitter can ever write it - only SDMMC_RM=00, '
    + 'the reset default, is reachable. agents/BOARD.md 2026-09-13T20:23Z.',
};

/** Parse the audit's `== {pid}: ...` header lines and per-signal `{s}: DS [...] file [...]`
 *  difference lines out of its text output. Returns
 *  `[{ pid, signal, ds: Set, file: Set }, ...]` for every pin-set difference found — MISSING/
 *  NOT-IN-THE-DS/TORN-NAMES lines are deliberately NOT matched here, because none of those
 *  shapes is ever an acceptable narrowing (a whole missing/extra/torn signal is a defect no
 *  matter what peripheral it is in). */
function pinSetDifferences(out) {
  const pins = s => new Set((s.match(/'([^']+)'/g) || []).map(m => m.slice(1, -1)));
  let pid = null;
  const found = [];
  for (const line of out.split('\n')) {
    const header = /^==\s+(\S+):/.exec(line);
    if (header) { pid = header[1]; continue; }
    const diff = /^\s+([A-Za-z0-9]+):\s+DS\s+(\[[^\]]*\])\s+file\s+(\[[^\]]*\])\s*$/.exec(line);
    if (diff && pid) found.push({ pid, signal: diff[1], ds: pins(diff[2]), file: pins(diff[3]) });
  }
  return found;
}

const isSubset = (small, big) => small.size > 0 && [...small].every(p => big.has(p));

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

  if (res.status !== 0) {
    // The tool's own tally: every difference group it counted, of EVERY kind (missing,
    // extra, pin-set, torn names). This is the number that must fully reconcile with what
    // gets accepted below - if it does not, something other than a cited pin-set narrowing
    // contributed to the failure, and no classification of pin-set lines can excuse that.
    const totalBad = Number((/^(\d+) difference group\(s\)/m.exec(out) || [])[1] || -1);

    // Every pin-set difference the audit printed, classified: accepted only when its
    // peripheral is named in KNOWN_NARROWED AND the file's pins are a genuine, non-empty
    // SUBSET of the DS's — never equal-but-different, never a superset, never empty.
    const diffs = pinSetDifferences(out);
    const accepted = [];
    const unaccepted = [];
    for (const d of diffs) {
      const reason = KNOWN_NARROWED[d.pid];
      (reason && isSubset(d.file, d.ds) ? accepted : unaccepted).push({ ...d, reason });
    }
    if (accepted.length) {
      console.log(`      accepted as a cited narrowing, not a defect: ${accepted.length} signal(s)`);
      for (const a of accepted) console.log(`        ${a.pid}.${a.signal}: DS ${[...a.ds].sort()} -> file ${[...a.file].sort()} (${a.reason})`);
    }

    assert.equal(unaccepted.length, 0,
      `${unaccepted.length} pin-set difference(s) are not accounted for by KNOWN_NARROWED ` +
      `(each needs its peripheral cited there with a reason, or the file's pin set is not ` +
      `actually a subset of the DS's — a genuinely wrong pin, not a narrowing):\n` +
      unaccepted.map(u => `    ${u.pid}.${u.signal}: DS ${[...u.ds].sort()}  file ${[...u.file].sort()}`).join('\n'));

    // Every difference group the tool counted must be one of the pin-set lines this loop
    // just accepted — if `totalBad` is bigger than `accepted.length`, a MISSING / NOT IN
    // THE DS / TORN NAMES line (or a pin-set line for a peripheral not in KNOWN_NARROWED)
    // is hiding in the same run, and accepting the pin-set lines must not paper over it.
    assert.equal(totalBad, accepted.length,
      'CH32H417\'s dedicated-function signals differ from the DS\'s own signal-first tables '
      + 'in a way KNOWN_NARROWED does not account for - the tool counted more difference '
      + `group(s) (${totalBad}) than this file accepted (${accepted.length}).\n`
      + '    MISSING / NOT IN THE DS means a signal name changed. A name carrying a '
      + '`_<digit>` suffix or a trailing underscore is the AFIO_PCFR1 remap value read as '
      + 'part of the name (DS Note 3) — the signal is the stem, and the remap value is not '
      + 'part of it.\n'
      + '    Regenerate with:  python tools/gen_h417_dedicated_pins.py && '
      + 'python tools/gen_h417_peripherals.py --splice --refresh\n'
      + `\n${out}`);
  } else {
    assert.equal(Object.keys(KNOWN_NARROWED).length, 0,
      'KNOWN_NARROWED names a peripheral but the audit found no difference for it - either '
      + 'the exception is stale (the file agrees with the DS again; remove the entry) or it '
      + 'is not being exercised, which is the "guard nobody has seen fire" failure this '
      + 'repo keeps finding. Either way, do not leave an unused exception on record.');
  }
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

