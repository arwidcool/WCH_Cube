#!/usr/bin/env node
// Test runner. Discovers every *.test.js under app/tests/ (engine, AGENT-2) and
// tests/ (QA, AGENT-4), runs them in one process, prints one line per test.
// Exit code 1 on the first failing assertion, so CI and the merge rule can gate on it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = [path.join(ROOT, 'app', 'tests'), path.join(ROOT, 'tests')];

const files = DIRS.flatMap(d => (fs.existsSync(d) ? fs.readdirSync(d) : [])
  .filter(f => f.endsWith('.test.js'))
  .sort()
  .map(f => path.join(d, f)));

if (!files.length) { console.error('no *.test.js found in', DIRS.join(', ')); process.exit(1); }

const { collected } = await import(pathToFileURL(path.join(ROOT, 'app', 'tests', '_harness.js')).href);

let pass = 0, fail = 0;
const started = Date.now();
for (const f of files) {
  const before = collected().length;
  await import(pathToFileURL(f).href);
  const mine = collected().slice(before);
  console.log(`\n${path.relative(ROOT, f).replace(/\\/g, '/')}  (${mine.length})`);
  for (const t of mine) {
    const t0 = Date.now();
    try {
      await t.fn();
      pass++;
      console.log(`  ok    ${t.name}${Date.now() - t0 > 40 ? `  [${Date.now() - t0} ms]` : ''}`);
    } catch (err) {
      fail++;
      console.log(`  FAIL  ${t.name}`);
      const msg = (err && err.message || String(err)).split('\n').slice(0, 12).join('\n');
      console.log(msg.replace(/^/gm, '        '));
      if (err && err.stack) {
        const at = err.stack.split('\n').find(l => l.includes('.test.js'));
        if (at) console.log('       ', at.trim());
      }
    }
  }
}
console.log(`\n${pass} passed, ${fail} failed, ${Date.now() - started} ms`);
process.exit(fail ? 1 : 0);
