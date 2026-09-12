// =============================================================================
//  tests/source_order.test.js — markdown first, PDF last resort.
//
//  Every WCH drop arrives as a PDF and is converted to markdown. The conversion
//  is what the tools, the agents and the docs read: it greps, it diffs, it can be
//  cited by line, and a second pass can check it. The original PDF is the LAST
//  resort — opened only when the conversion is missing, unreadable or
//  *demonstrably* incomplete — because reading one costs minutes per table, cannot
//  be diffed, and produces a plausible-looking wrong answer when it goes wrong.
//
//  That order was implicit in the tools and written down nowhere, and the two
//  claims it silently invalidated are the reason this file exists:
//    * `data/mcus/CH32L103.notes.md` said "This drop has no PDF" and asked a human
//      for a second source for the pin numbers — while `CH32L103DS0.PDF` sat in
//      the folder it named;
//    * `data/sources/README.md` still said the EVT folders were empty and listed
//      two parts where there are now five.
//
//  So this file checks the three things that keep a fallback honest:
//    1. a PDF never stands alone — every one has its conversion beside it;
//    2. a script that reads a PDF says WHY, in a `PDF FALLBACK:` line, in the
//       words that name what the markdown could not answer;
//    3. the rule is actually written down where the people and agents who extract
//       a part will read it (the policy doc, the agent pack, the two guides).
//
//  And it can fail: the pairing check is run against a planted tree that has a
//  PDF with no conversion, so a check that stopped looking at anything cannot
//  read as green.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { suite, test, assert, skip } from './lib/harness.js';
import { ROOT } from './lib/app.js';

suite('source order');

const SOURCES = path.join(ROOT, 'data', 'sources');
const POLICY_DOC = 'data/sources/README.md';

// The sentences that count as stating the reading order. Deliberately a few
// spellings of one idea rather than a keyword: "PDF" appears all over a document
// about PDFs, and a check that any mention of markdown satisfies would pass on a
// file that says the opposite.
const READ_ORDER_RE = /markdown first, PDF last|markdown conversion first|markdown is read first|Read the markdown first|markdown FIRST, the/i;
const statesReadOrder = text => READ_ORDER_RE.test(text);

// The folders a datasheet / reference manual conversion lives in. Two spellings,
// because the drops arrived with both (`Datasheets/`, `datasheets/`).
const DOC_DIR = /^datasheets?$/i;
const isPdf = n => /\.pdf$/i.test(n);
const isMd = n => /\.md$/i.test(n);

/** Every `<root>/<PART>/<Datasheets|datasheets>/` folder, whatever the case. */
function docFolders(root) {
  const out = [];
  let parts = [];
  try { parts = fs.readdirSync(root); } catch { return out; }
  for (const part of parts) {
    const partDir = path.join(root, part);
    if (!fs.statSync(partDir).isDirectory()) continue;
    for (const sub of fs.readdirSync(partDir)) {
      if (!DOC_DIR.test(sub)) continue;
      const dir = path.join(partDir, sub);
      if (fs.statSync(dir).isDirectory()) out.push({ part, dir });
    }
  }
  return out;
}

/**
 * Every PDF in a document folder that has no markdown conversion beside it.
 *
 * The stem is what is compared, case-insensitively: `CH32X035DS0.pdf` is the
 * original of `CH32X035DS0.md`, and the vendor's own extension casing
 * (`CH32L103RM.PDF`) must not be read as a different document.
 */
function pdfsWithoutMarkdown(root) {
  const problems = [];
  const seen = [];
  for (const { part, dir } of docFolders(root)) {
    const files = fs.readdirSync(dir);
    const stems = new Set(files.filter(isMd).map(f => f.replace(/\.md$/i, '').toLowerCase()));
    for (const f of files.filter(isPdf)) {
      seen.push(`${part}/${f}`);
      if (!stems.has(f.replace(/\.pdf$/i, '').toLowerCase())) {
        problems.push(`${part}/${f}: a PDF with no markdown conversion beside it `
          + `(looked for ${f.replace(/\.pdf$/i, '.md')}) — the conversion is what everything `
          + 'here reads, and the PDF is the last resort, not the only copy');
      }
    }
  }
  return { problems, seen };
}

test('every source PDF has its markdown conversion beside it', () => {
  const { problems, seen } = pdfsWithoutMarkdown(SOURCES);
  if (!seen.length) {
    skip('no PDFs are present in any Datasheets folder, so there is nothing to pair — '
      + 'the rule still applies to the next drop that arrives with one');
  }
  assert.empty(problems, 'PDFs that stand alone');
});

test('a script that reads a PDF says why, in a PDF FALLBACK: line with a reason', () => {
  // Reading a PDF means PyMuPDF/fitz: that is how every recovery in this repo does
  // it, and it is not something a markdown parser can have by accident.
  const dirs = [path.join(ROOT, 'tools'), path.join(ROOT, 'agents', 'proposals')];
  const readers = [];
  const problems = [];
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names.filter(n => n.endsWith('.py')).sort()) {
      const rel = path.relative(ROOT, path.join(dir, name)).replace(/\\/g, '/');
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      if (!/^\s*(?:import|from)\s+(pymupdf|fitz)\b/m.test(text)) continue;
      readers.push(rel);
      const at = text.indexOf('PDF FALLBACK:');
      if (at < 0) {
        problems.push(`${rel} imports PyMuPDF but has no \`PDF FALLBACK:\` line saying what the `
          + 'markdown could not answer. A fallback nobody has to justify becomes the normal path.');
        continue;
      }
      // The marker has to be followed by an actual reason, not left as a label.
      const reason = text.slice(at + 'PDF FALLBACK:'.length).split('\n')[0].trim();
      if (reason.replace(/[-\s.]/g, '').length < 20) {
        problems.push(`${rel} has a \`PDF FALLBACK:\` marker with no reason after it `
          + `(found ${JSON.stringify(reason)}) — name the table and what the conversion lost`);
      }
    }
  }
  if (!readers.length) {
    skip('no script reads a PDF any more — the fallback rule has nothing to police, which is '
      + 'a fine state to be in');
  }
  assert.ok(readers.length >= 1, 'the scan found no PDF readers, so it proves nothing');
  assert.empty(problems, 'PDF readers that do not declare their fallback');
});

test('the rule is written down where the people and agents who extract a part read it', () => {
  // A rule that lives in one file nobody opens is how the L103 note came to ask a
  // human for a document that was already in the repo. These are the places an
  // extractor is pointed at, so each must carry the order (or point at the doc
  // that states it in full).
  const mustSay = [
    POLICY_DOC,
    'agents/README.md',
    'agents/AGENT_1_DATA.md',
    'agents/PROMPT.txt',
    'docs/ADDING-A-PART.md',
    'docs/HOW-IT-WORKS.md',
    'data/FORMAT.md',
  ];
  const problems = [];
  let checked = 0;
  for (const rel of mustSay) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { problems.push(`${rel}: does not exist`); continue; }
    checked++;
    const text = fs.readFileSync(abs, 'utf8');
    const saysMarkdownFirst = statesReadOrder(text);
    if (!saysMarkdownFirst) {
      problems.push(`${rel}: does not state the reading order (markdown first, PDF last resort). `
        + 'Point it at data/sources/README.md if the rule lives there.');
    }
    if (rel !== POLICY_DOC && !text.includes('data/sources/README.md')) {
      problems.push(`${rel}: states the order without pointing at ${POLICY_DOC}, where the `
        + 'fallback protocol (PDF FALLBACK:, recover by script, write the cells back) lives.');
    }
  }
  assert.ok(checked === mustSay.length, `only ${checked} of ${mustSay.length} files were checked`);
  assert.empty(problems, 'files that hand out extraction instructions without the reading order');
});

test('the pairing check can fail: a planted PDF with no conversion is caught', () => {
  // Same function, a tree built to fail. Without this half, a `docFolders()` that
  // stopped finding directories would report zero problems and read as green.
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-order-'));
  try {
    const dir = path.join(probe, 'PROBE', 'Datasheets');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'PROBEDS0.md'), '# a conversion\n');
    const paired = pdfsWithoutMarkdown(probe);
    assert.equal(paired.problems.length, 0,
      `a conversion with no PDF was reported as a problem:\n${paired.problems.join('\n')}`);
    assert.equal(paired.seen.length, 0, 'the probe found a PDF that does not exist');
    // Now the defect: the original without its conversion.
    fs.writeFileSync(path.join(dir, 'PROBEDS0.PDF'), 'not a real pdf\n');
    assert.equal(pdfsWithoutMarkdown(probe).problems.length, 0,
      'the PDF that DOES have a conversion beside it was reported as standing alone');
    fs.unlinkSync(path.join(dir, 'PROBEDS0.md'));
    const alone = pdfsWithoutMarkdown(probe);
    assert.equal(alone.seen.length, 1, 'the planted PDF was not seen at all');
    assert.equal(alone.problems.length, 1,
      'a PDF with no conversion beside it was not caught, so the real check proves nothing');
    assert.includes(alone.problems[0], 'PROBEDS0.PDF',
      'the failure does not name the PDF that stands alone');
    // And a folder spelled the other way is still a document folder.
    const lower = path.join(probe, 'PROBE2', 'datasheets');
    fs.mkdirSync(lower, { recursive: true });
    fs.writeFileSync(path.join(lower, 'X.PDF'), 'x\n');
    assert.equal(pdfsWithoutMarkdown(probe).problems.length, 2,
      'the lower-case `datasheets/` spelling is not being searched — V003 and l103 use it');
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }

  // The documentation half, on text rather than on the tree: the sentence that says
  // the order must be recognised, and a file that merely mentions the PDFs must not.
  assert.ok(statesReadOrder('read the markdown first; the PDF is the last resort'),
    'the reading order in its canonical wording is not recognised, so the doc check fires on everything');
  assert.notOk(statesReadOrder('Everything is derived from the datasheet PDF and its tables.'),
    'a sentence that never mentions markdown passed the reading-order check');
  assert.notOk(statesReadOrder('the PDF is authoritative, the markdown is a convenience'),
    'a sentence saying the OPPOSITE passed the reading-order check, which is worse than missing it');
});
