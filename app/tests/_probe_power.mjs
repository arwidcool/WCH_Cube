// Parse every MCU file, list the non-io pins, and catch a duplicated pin key - the
// defect I introduced into CH32H417 by appending entries that already existed.
import fs from 'node:fs';
import { fresh, eng, jsyaml } from './_harness.js';

const files = fs.readdirSync('data/mcus').filter(x => x.endsWith('.yaml')).sort();

for (const f of files) {
  const text = fs.readFileSync(`data/mcus/${f}`, 'utf8');
  try { jsyaml.load(text); } catch (e) { console.log(`${f}: THROWS ${String(e.message).split('\n')[0]}`); continue; }
  // duplicated pin keys inside the pins: block, line-based
  const lines = text.split(/\r?\n/);
  let inPins = false; const seen = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (/^pins:\s*$/.test(lines[i])) { inPins = true; continue; }
    if (inPins && /^\S/.test(lines[i])) inPins = false;
    if (!inPins) continue;
    const m = /^  ([A-Za-z0-9_]+):/.exec(lines[i]);
    if (!m) continue;
    if (seen.has(m[1])) console.log(`  ${f}: DUPLICATE pin ${m[1]} at lines ${seen.get(m[1])} and ${i + 1}`);
    else seen.set(m[1], i + 1);
  }
}
for (const f of files) eng.registerMcuFile(fs.readFileSync(`data/mcus/${f}`, 'utf8'));

let total = 0, bare = 0;
for (const name of files.map(f => f.replace(/\.yaml$/, ''))) {
  const e = fresh(name);
  const rows = Object.entries(e.M.pins).filter(([, v]) => v.type !== 'io');
  const noNote = rows.filter(([, v]) => !v.notes);
  total += rows.length; bare += noNote.length;
  console.log(`${e.M.mcu.name}: ${rows.length} non-io pins, ${noNote.length} without a note` +
    (noNote.length ? ` -> ${noNote.map(([p]) => p).join(', ')}` : ''));
}
console.log(`\nTOTAL ${total} non-io pins, ${bare} still bare`);
