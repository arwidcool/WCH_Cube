#!/usr/bin/env node
// tests/lib/enginemutant_run.js — runs ONE app/tests/*.test.js file's own registered tests,
// in the fresh process enginemutant.js spawned for it, and prints one JSON line so the
// caller never has to parse console formatting. Never invoked directly in a normal run;
// only tests/lib/enginemutant.js's runMutantTestFile() calls this.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const testFile = process.argv[2];
if (!testFile) {
  console.error('usage: node enginemutant_run.js <absolute test file path>');
  process.exit(2);
}

async function main() {
  // The SAME absolute path the test file itself uses for './_harness.js' — the ESM cache
  // keys on the resolved URL, so importing it here first (or after; order does not matter)
  // shares the one module instance and its `collected()` registry with what the test file
  // populates when it does `import { test } from './_harness.js'`.
  const harnessFile = path.join(path.dirname(testFile), '_harness.js');
  const { collected } = await import(pathToFileURL(harnessFile).href);
  await import(pathToFileURL(testFile).href);

  const tests = collected();
  let pass = 0, fail = 0;
  const results = [];
  for (const t of tests) {
    try { await t.fn(); pass++; results.push({ name: t.name, ok: true }); }
    catch (e) { fail++; results.push({ name: t.name, ok: false, error: (e && e.stack) || String(e) }); }
  }
  console.log(JSON.stringify({ pass, fail, results }));
  process.exit(fail ? 1 : 0);
}

main().catch(e => {
  console.log(JSON.stringify({ pass: 0, fail: 0, results: [], loadError: (e && e.stack) || String(e) }));
  process.exit(3);
});
