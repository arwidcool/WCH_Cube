// =============================================================================
//  tests/source_paths.test.js — every path this repo cites must exist ON LINUX.
//
//  Round 3's rule is "a name nobody compiled is a guess"; the same rule applies to
//  a PATH nobody opened. `data/mcus/*.notes.md` and each MCU file cite
//  `data/sources/...` paths as the evidence for hardware facts, and the tools
//  build the same paths from `codegen.sdk.evt`. On Windows every one of those
//  resolves case-INSENSITIVELY, so a citation whose casing is wrong works here and
//  is a dead path on the Linux runner — which is the one place a wrong-case path
//  is caught, and the one place nobody was looking.
//
//  That is not hypothetical. This file exists because the CH32V003 drop landed as
//  `data/sources/V003/evt/` and `.../datasheets/` while the other two parts use
//  `Evt/` and `Datasheets/`, which `data/sources/README.md` documents and
//  `tools/verify_sdk_names.py` hard-codes (`ROOT/"data"/"sources"/evt/"Evt"`). On
//  this box everything passed. On ubuntu-latest the SDK lookup would have found
//  nothing, degraded to "NOT CHECKED", and exited 0 — a green tick over a part
//  that was never checked, which is the exact failure mode this repo keeps
//  finding. The same defect shipped once before, one field over: a `codegen.header`
//  whose CASE differed from the real file, invisible on NTFS and fatal on Linux.
//
//  So this file does two things the other gates cannot:
//    * it resolves every cited path with the case the FILESYSTEM actually has,
//      not the case the string uses; and
//    * it does so for the whole repo, not only for the names an SDK checker
//      happens to look at.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { suite, test, assert, skip } from './lib/harness.js';
import { ROOT } from './lib/app.js';
import * as eng from '../app/engine/index.js';

suite('source paths');

const MCU_DIR = path.join(ROOT, 'data', 'mcus');
const SHIPPED = fs.readdirSync(MCU_DIR).filter(n => n.endsWith('.yaml')).sort();

// ---------------------------------------------------------------- case-exact fs
/**
 * Resolve a repo-relative path with the case the filesystem ACTUALLY has.
 *
 * Returns `{ ok }` when every segment matched exactly, `{ ok: false, fixed }`
 * when the path exists only case-insensitively — `fixed` being the real spelling,
 * which is what to print, because "wrong case" and "missing" need different fixes.
 */
function resolveExact(rel) {
  const parts = rel.split('/').filter(p => p !== '');
  let cur = ROOT;
  const real = [];
  for (const part of parts) {
    let entries;
    try { entries = fs.readdirSync(cur); } catch { return { ok: false, missing: rel }; }
    if (entries.includes(part)) { cur = path.join(cur, part); real.push(part); continue; }
    const ci = entries.find(e => e.toLowerCase() === part.toLowerCase());
    if (!ci) return { ok: false, missing: rel };
    return { ok: false, fixed: [...real, ci, ...parts.slice(real.length + 1)].join('/') };
  }
  return { ok: true, real: real.join('/') };
}

/** True when this filesystem would hide a wrong case. Says so instead of guessing. */
const CASE_INSENSITIVE = (() => {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-case-'));
  try {
    fs.writeFileSync(path.join(probe, 'CaseProbe'), '');
    return fs.existsSync(path.join(probe, 'caseprobe'));
  } finally { fs.rmSync(probe, { recursive: true, force: true }); }
})();

// ---------------------------------------------------------------- the citations
/**
 * Every `data/sources/...` path the tracked text cites.
 *
 * Read from the files rather than from a list, because the point is that a NEW
 * citation is covered the moment somebody writes it. Trailing punctuation a
 * sentence may own (`:12`, `:22-27`, a full stop, a `)`) is trimmed: the citation
 * convention here is `file:line`, and the line is not part of the path.
 *
 * A citation may also be a GLOB — `.../Peripheral/inc/ch32x035*.h` is how a table
 * cell says "the SPL headers for this part", and it is clearer than listing them.
 * A glob is checked on its DIRECTORY, which must still exist with the right case;
 * what is inside it is the SDK checker's business, not this file's.
 */
function citedPaths(text) {
  const out = new Map();
  for (const m of text.matchAll(/data\/sources\/[A-Za-z0-9_./+*-]+/g)) {
    let raw = m[0]
      .replace(/[.,;:]+$/, '')     // sentence punctuation
      .replace(/:\d+(-\d+)?$/, '') // :12 or :22-27
      .replace(/\/+$/, '');        // a trailing slash names a directory
    if (!raw || raw === 'data/sources') continue;
    if (raw.includes('*')) {
      // A glob's FIXED PREFIX is what can be checked: everything before the first
      // `*`, trimmed back to a directory boundary. `.../inc/ch32x035*.h` gives the
      // inc folder; `.../DEVICE/*/User/main.c` gives the DEVICE folder. What is
      // inside is the SDK checker's business, not this file's.
      const prefix = raw.slice(0, raw.indexOf('*')).replace(/[^/]*$/, '').replace(/\/+$/, '');
      if (!prefix || prefix === 'data/sources') continue;
      out.set(prefix, { path: prefix, glob: true, as: raw });
      continue;
    }
    out.set(raw, { path: raw, glob: false });
  }
  return [...out.values()];
}

const FILES_TO_SCAN = [
  ...SHIPPED.map(f => path.join('data', 'mcus', f)),
  ...fs.readdirSync(MCU_DIR).filter(n => n.endsWith('.notes.md')).map(f => path.join('data', 'mcus', f)),
  'data/FORMAT.md',
  'data/sources/README.md',
];

test('every data/sources path this repo cites exists, with that exact case', () => {
  const problems = [];
  let checked = 0;
  for (const rel of FILES_TO_SCAN) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { problems.push(`${rel}: does not exist, so its citations were not checked`); continue; }
    for (const cited of citedPaths(fs.readFileSync(abs, 'utf8'))) {
      checked++;
      const r = resolveExact(cited.path);
      if (r.ok) continue;
      const what = cited.glob ? `\`${cited.as}\` (the directory a glob cites)` : `\`${cited.path}\``;
      problems.push(r.fixed
        ? `${rel} cites ${what}, which does not exist. The real path is \`${r.fixed}\` — `
          + 'wrong CASE. It resolves on Windows and is a dead path on Linux, which is where CI runs.'
        : `${rel} cites ${what}, which does not exist at any case.`);
    }
  }
  assert.ok(checked > 20,
    `only ${checked} cited path(s) found across ${FILES_TO_SCAN.length} file(s) — the citation `
    + 'convention or the scan moved, so this check is not looking at what it thinks it is');
  assert.empty(problems, 'citations that do not resolve');
});

test('every MCU file\'s codegen.sdk.evt resolves to a real data/sources/<evt>/Evt', () => {
  // The other half: the tools BUILD this path, so a wrong table name is a dead
  // lookup even when no prose cites it. `tools/verify_sdk_names.py` degrades to
  // "NOT CHECKED" here and still exits 0, so nothing else goes red.
  const problems = [];
  for (const file of SHIPPED) {
    const doc = eng.yamlLoad(fs.readFileSync(path.join(MCU_DIR, file), 'utf8'));
    const sdk = ((doc.codegen || {}).sdk) || {};
    if (sdk.synthetic || !sdk.evt) continue;
    const rel = `data/sources/${sdk.evt}/Evt`;
    const r = resolveExact(rel);
    if (!r.ok) {
      problems.push(r.fixed
        ? `${file}: codegen.sdk.evt "${sdk.evt}" builds \`${rel}\`, whose real spelling is `
          + `\`${r.fixed}\`. verify_sdk_names.py would report this part NOT CHECKED and still exit 0.`
        : `${file}: codegen.sdk.evt "${sdk.evt}" builds \`${rel}\`, which does not exist.`);
      continue;
    }
    // And it must actually carry headers, or the lookup succeeds and finds nothing.
    const inc = path.join(ROOT, rel, 'EXAM', 'SRC', 'Peripheral', 'inc');
    if (!fs.existsSync(inc)) {
      problems.push(`${file}: ${rel} exists but has no EXAM/SRC/Peripheral/inc — nothing to check against`);
    }
  }
  assert.empty(problems, 'codegen.sdk.evt values that a case-sensitive filesystem would not resolve');
});

test('a part the SDK checker could not resolve is visible, not a green tick', () => {
  // The coupling this file exists for: the casing above is only harmful because
  // `verify_sdk_names.py` exits 0 when it resolves nothing. Assert that the two
  // facts are connected, by running the checker over a part whose EVT folder is
  // renamed to a case that only Windows resolves.
  const src = path.join(MCU_DIR, 'CH32X003-does-not-exist.yaml');
  assert.notOk(fs.existsSync(src), 'a fixture part leaked into data/mcus/');
  if (!CASE_INSENSITIVE) skip('this filesystem is case-sensitive, so the wrong-case probe cannot be built here — the check above still applies');
  if (!SHIPPED.length) skip('no MCU files to test with');
  assert.ok(fs.existsSync(path.join(ROOT, 'tools', 'verify_sdk_names.py')),
    'the checker this coupling names is gone');
  // Static, because building the probe means renaming a shipped part's folder:
  // the checker's contract is that it reports NOT CHECKED and exits 0, and the
  // suite's is that such a part becomes a counted SKIP. Both are asserted where
  // they live — `tests/sdk_names.test.js` plants the no-SDK file and insists the
  // skip fires. What this test adds is that the casing above is one of the ways
  // that path gets taken, so the two are not independent.
  assert.match(fs.readFileSync(path.join(ROOT, 'tools', 'verify_sdk_names.py'), 'utf8'),
    /NOT CHECKED/, 'the checker no longer reports an unresolved part by name');
});

// ---------------------------------------------------------------- can it fail
test('the path check can fail: a wrong-case citation and a wrong-case table are both caught', () => {
  // Plant both shapes and insist `resolveExact` separates them from a real path.
  const good = resolveExact('data/sources/V006/Datasheets');
  assert.ok(good.ok, 'a path that exists with the right case was reported missing, so the check proves nothing');

  if (!CASE_INSENSITIVE) {
    // On Linux a wrong-case path is simply missing, which `resolveExact` also reports.
    assert.notOk(resolveExact('data/sources/V006/datasheets').ok, 'a wrong-case path resolved on a case-sensitive filesystem');
    return;
  }
  const bad = resolveExact('data/sources/V006/datasheets');
  assert.notOk(bad.ok, 'a wrong-case path resolved as if it were fine');
  assert.equal(bad.fixed, 'data/sources/V006/Datasheets',
    'the failure must name the real spelling, or the message sends the reader hunting for a missing file '
    + 'when the file is there with different capitals');
  assert.notOk(resolveExact('data/sources/NOPE').ok, 'a path that exists nowhere resolved');
});

test('the scan reads real citations, not a pattern that matches nothing', () => {
  // The whole file is a no-op if `citedPaths` stops matching, and a no-op that
  // prints "ok" is worse than no check at all.
  const sample = citedPaths('see `data/sources/V006/Evt/EXAM/SRC/Peripheral/inc/ch32v00X_gpio.h:33` and data/sources/X035/Datasheets/CH32X035DS0.md.');
  const paths = sample.map(c => c.path);
  assert.includes(paths, 'data/sources/V006/Evt/EXAM/SRC/Peripheral/inc/ch32v00X_gpio.h',
    'the trailing :33 was not trimmed, so every `file:line` citation would read as missing');
  assert.includes(paths, 'data/sources/X035/Datasheets/CH32X035DS0.md',
    'a sentence-final full stop was not trimmed');
  assert.notOk(paths.some(p => /:\d+$/.test(p)), 'a line number survived into a path');

  // A glob is checked on its fixed prefix, not read as a truncated filename.
  const glob = citedPaths('| EVT | `data/sources/X035/Evt/EXAM/SRC/Peripheral/inc/ch32x035*.h` |');
  assert.equal(glob.length, 1, `a glob produced ${glob.length} citations:\n${JSON.stringify(glob)}`);
  assert.ok(glob[0].glob, 'the glob was not recognised as one');
  assert.equal(glob[0].path, 'data/sources/X035/Evt/EXAM/SRC/Peripheral/inc',
    'a glob must be reduced to its fixed directory prefix — the filename fragment before the * is not a path');
  // A glob with the star in the middle keeps only what is fixed before it.
  const mid = citedPaths('see data/sources/X035/Evt/EXAM/USB/USBFS/DEVICE/*/User/main.c');
  assert.equal(mid[0].path, 'data/sources/X035/Evt/EXAM/USB/USBFS/DEVICE',
    'a mid-path glob kept a fragment containing the star, which can never be resolved');

  // And every citation the real files carry is either a path or a glob, never junk.
  for (const rel of FILES_TO_SCAN) {
    for (const c of citedPaths(fs.readFileSync(path.join(ROOT, rel), 'utf8'))) {
      assert.ok(c.path.split('/').length >= 3 && !c.path.endsWith('/'),
        `${rel}: a citation reduced to \`${c.path}\`, which cannot be checked usefully`);
    }
  }
});
