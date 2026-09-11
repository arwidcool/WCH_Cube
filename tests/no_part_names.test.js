// =============================================================================
//  tests/no_part_names.test.js — no part may be named in code. (Round 4 DONE line.)
//
//  Everything in `data/mcus/` was one family until round 4. Every assumption the
//  engine, the UI and the tests quietly made about "an MCU" had only ever been
//  tested against one shape of MCU, and the round-4 brief lists ten ways
//  CH32X035 is a different shape — no HSE, 24-bit ports, two holes in port C,
//  named remap macros, APB instead of PB, 8 DMA channels, 45 vectors with no
//  RCC_IRQn, one GPIO speed, no open-drain modes.
//
//  The deliverable was never "one more part". It is the proof that adding a part
//  is a DATA job. A part name in `app/` is the opposite of that proof: it is a
//  place where the next part will not work like this one, and it will be found
//  by the person adding it rather than by us.
//
//  So: `grep -ri "x035\|ch32v006\|ch32v005" app/engine/ app/template.html` comes
//  back empty, except in comments — where naming the part that motivated a piece
//  of code is exactly the right thing to do, and this file says so rather than
//  forcing people to write worse comments.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, test, assert } from './lib/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

suite('no part names in code');

/** Any real part number, in any spelling anyone has used here. */
const PART = /\b(CH32[VX]\d{3}[A-Z0-9-]*|CH32M\d{3})\b/i;

/**
 * Strip comments and string-ish content that is legitimately allowed to name a
 * part, leaving the code that must not.
 *
 * Comments are exempt on purpose. "CH32V006's GPIOx_CFGLR.MODEy is a single bit,
 * which is why this reads the speed list from the file" is a better comment than
 * the same sentence with the part filed off, and a rule that punishes it would
 * be trading real explanation for a green tick.
 */
function codeOnly(text, { js }) {
  let out = text;
  out = out.replace(/\/\*[\s\S]*?\*\//g, ' ');           // /* block */
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');       // // line (not http://)
  if (!js) out = out.replace(/<!--[\s\S]*?-->/g, ' ');   // <!-- html -->
  return out;
}

/** Lines of `text` whose CODE (not comments) names a part. */
function offendingLines(text, opts) {
  const stripped = codeOnly(text, opts).split('\n');
  const raw = text.split('\n');
  const hits = [];
  stripped.forEach((line, i) => {
    const m = PART.exec(line);
    if (m) hits.push({ line: i + 1, name: m[0], text: raw[i].trim().slice(0, 110) });
  });
  return hits;
}

test('no engine module names a part', () => {
  const dir = path.join(ROOT, 'app', 'engine');
  const bad = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js')).sort()) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const h of offendingLines(text, { js: true })) {
      bad.push(`app/engine/${f}:${h.line} names ${h.name} — ${h.text}`);
    }
  }
  assert.empty(bad,
    'engine code names a specific part. The MCU file has to tell it instead, or the next '
    + 'part will not work like this one. (Comments may name parts; these are not comments.)');
});

test('the template names no part outside its comments', () => {
  const text = fs.readFileSync(path.join(ROOT, 'app', 'template.html'), 'utf8');
  const bad = offendingLines(text, { js: false })
    .map(h => `app/template.html:${h.line} names ${h.name} — ${h.text}`);
  assert.empty(bad,
    'the UI names a specific part. Every option it offers must be justified by the MCU data, '
    + 'not by a part number in the markup or the render code.');
});

test('the check can actually find a part name', () => {
  // A grep-shaped test that matches nothing looks identical to a grep-shaped test
  // whose regex is broken. Two plants: one that must be caught, one that must not.
  const caught = offendingLines("const parts = ['CH32V006'];\n", { js: true });
  assert.equal(caught.length, 1, 'a part name in plain code was not detected — the check is blind');

  const exempt = offendingLines('// CH32V006 has one GPIO speed, which is why this reads the file\n'
    + '/* CH32X035 has no HSE at all */\n', { js: true });
  assert.equal(exempt.length, 0, 'a part named in a COMMENT was flagged — comments are allowed to explain');
});
