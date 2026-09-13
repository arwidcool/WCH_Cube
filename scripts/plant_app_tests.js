#!/usr/bin/env node
// scripts/plant_app_tests.js — round 6 deliverable B's remaining half: prove every
// app/tests/*.test.js file can actually catch a break in the engine (or the built page)
// it exercises. One targeted mutation per file, verified against a unique anchor, run in a
// throwaway process against a throwaway copy (tests/lib/enginemutant.js) — the working
// tree is never touched, and app/engine/** and dist/index.html are never written.
//
// Usage: node scripts/plant_app_tests.js [file substring filter]
//
// Prints one row per file:
//   CAUGHT        the mutation made at least one of the file's own tests fail
//   MISSED        the mutation changed the text and nothing in the file's own suite noticed
//                 - a finding, not a pass; the guard misses this shape of break
//   COULD-NOT-RUN the anchor was not found / not exactly once, or the runner crashed before
//                 running anything - counted separately: a check that never ran did not
//                 fail to catch anything, and reporting it as MISSED would hide the real
//                 defect (a stale anchor) behind a weaker one (a blind spot)
import fs from 'node:fs';
import path from 'node:path';
import { withMutantEngine, withMutantDist, runMutantTestFile, occurrences, ROOT } from '../tests/lib/enginemutant.js';

const filter = (process.argv[2] || '').toLowerCase();

// ---- the plan: one entry per app/tests/*.test.js file ---------------------------------
// `engine` entries mutate a COPY of app/engine/<file> at the given anchor and run the test
// file against it (tests/lib/enginemutant.js's withMutantEngine). `dist` entries mutate a
// COPY of dist/index.html instead, because the target file reads the BUILT bundle through
// boot() or a real browser (withPage()) rather than importing app/engine live - a mutated
// engine copy is invisible to them.
const PLAN = [
  { test: 'afmux.test.js', engine: 'model.js',
    find: "  return hit ? hit.af : null;", to: "  return null;",
    why: 'signalAf() always reports no alternate function for an AF-muxed signal' },
  { test: 'analog.test.js', engine: 'constraints.js',
    find: "    pinFlagMissing: !((M.pins || {})[pin] || {}).analog,",
    to: "    pinFlagMissing: ((M.pins || {})[pin] || {}).analog,",
    why: "analogAdvice()'s pinFlagMissing is inverted" },
  { test: 'api.test.js', engine: 'model.js',
    find: "  return i >= 0 ? i : 0;", to: "  return 0;",
    why: 'defaultNvicGroup() always reports group 0' },
  { test: 'cli.test.js', engine: 'export.js', cli: true,
    find: "    byName.set(base, { ...ent, why });", to: "    return;",
    why: 'pinMap() never records a macro, so BoardPins.h loses every #define' },
  { test: 'clock.test.js', engine: 'clock.js',
    find: "    src[name] = d.khz !== undefined ? d.khz / 1000 : (name === 'HSE' ? k.hse : d.mhz);",
    to: "    src[name] = 0;",
    why: 'clockCalc() reads every oscillator as 0 MHz' },
  { test: 'clockmux.test.js', engine: 'clock.js',
    find: "  const list = pllList(c), sysPll = list.find(p => p.sys);",
    to: "  const list = [], sysPll = undefined;",
    why: 'clockSelectable() reports no PLLs at all' },
  { test: 'codegen.test.js', engine: 'codegen.js',
    find: "  const defs = paramDefs(pid).filter(d => !d.readonly && paramApplies(pid, d));",
    to: "  const defs = [];",
    why: 'initPlan() emits no struct members for any peripheral' },
  { test: 'constraint.test.js', engine: 'constraints.js',
    find: "    if (refusedNames(c).includes(v)) return c;", to: "    if (refusedNames(c).includes(v)) {}",
    why: 'constraintFor() never reports a refused GPIO value' },
  { test: 'engine.test.js', engine: 'engine.js',
    find: "      add(canon(pin), pid, sigName(pid, sig), pin);", to: "      void 0;",
    why: 'compute() never records a claim, so no pin is ever set or in conflict' },
  { test: 'export.test.js', engine: 'export.js',
    find: "      name: names.join('/'),", to: "      name: names[0],",
    why: "pinRows() drops the shorted pin's second name (PD7/PA4 -> PD7)" },
  { test: 'glossary.test.js', engine: 'glossary.js',
    find: "  const title = dataTitle || (hit ? hit.title : '');", to: "  const title = '';",
    why: 'peripheralName() reports no title for anything' },
  { test: 'handle.test.js', engine: 'codegen.js',
    find: "  if (typeof spec === 'string') return { handle: spec, missing: null };",
    to: "  if (typeof spec === 'string') return { handle: null, missing: null };",
    why: 'periphHandle() drops a plain-string handle name' },
  { test: 'history.test.js', engine: 'history.js',
    find: "  redoStack.push({ label: entry.label, state: snap() });", to: "  ;",
    why: 'undo() no longer leaves anything to redo' },
  { test: 'inherit.test.js', engine: 'inherit.js',
    find: "    else out[k] = deepMerge(base[k], over[k]);", to: "    else out[k] = deepClone(base[k]);",
    why: "deepMerge() takes the BASE's value on a key both sides declare, instead of merging it" },
  { test: 'instances.test.js', engine: 'params.js',
    find: "  return { channels: p.instances.map(r => r.n), missing: p.missing };",
    to: "  return { channels: [], missing: p.missing };",
    why: 'activeChannels() reports no channels for any peripheral' },
  { test: 'nested_structs.test.js', engine: 'codegen.js',
    find: "    block.embedInto = target;", to: "    block.embedInto = null;",
    why: "the embedded struct's pointer never reaches the outer struct - initPlan() forgets which member it fills" },
  { test: 'model.test.js', engine: 'model.js',
    find: "      const on = s.type === 'checkboxes' ? v.has(c.name) : v === c.name;", to: "      const on = false;",
    why: 'requiredSignals() reports no signal as required, for any setting' },
  { test: 'params.test.js', engine: 'params.js',
    find: "  return isConstParam(d) ? d.const : d.default;", to: "  return d.default;",
    why: "paramValue() stops honouring const: - every const member reads its default instead" },
  { test: 'pinmap.test.js', engine: 'export.js',
    find: "        af: signalAf(claim.who, raw, pin),", to: "        af: null,",
    why: 'pinMap() drops the alternate-function number from every macro' },
  { test: 'power.test.js', engine: 'model.js',
    find: "  if (!Array.isArray(raw)) return [];", to: "  return [];",
    why: 'suppliesOf() reports no supply rail for any peripheral' },
  { test: 'project.test.js', engine: 'project.js',
    find: "  return yamlDump(projectObject(), { noRefs: true, lineWidth: 120 });",
    to: "  return yamlDump({}, { noRefs: true, lineWidth: 120 });",
    why: 'projectSerialize() writes an empty document' },
  { test: 'resources.test.js', engine: 'resources.js',
    find: "    for (const [value, p] of Object.entries(sel)) if (p === pin) return { line, value };",
    to: "    for (const [value, p] of Object.entries(sel)) if (p === pin) return null;",
    why: 'extiLineOf() never finds a line for any pin' },
  { test: 'zip.test.js', engine: 'zip.js',
    find: "    t[n] = c;", to: "    t[n] = 0;",
    why: 'the CRC-32 table is all zeroes, so crc32() is wrong for everything but the empty string' },

  // ---- DIST-based ------------------------------------------------------------------
  { test: 'glue.test.js', dist: true, libs: { app: true },
    find: "document.getElementById('m-undo').onclick = () => runHistory(false);",
    to: "document.getElementById('m-undo').onclick = () => runHistory(true);",
    why: 'the Undo button redoes instead' },
  { test: 'clockmux_ui.test.js', dist: true, libs: { browser: true },
    find: "    if (!list || list.length < 2) return '';", to: "    if (true) return '';",
    why: 'srcSel() never draws a mux <select>, even when the file lists two or more sources' },
  { test: 'tree.test.js', dist: true, libs: { browser: true, harness: true },
    find: "const periphOrder = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });",
    to: "const periphOrder = (a, b) => String(a).localeCompare(String(b));",
    why: 'the tree sorts TIM10 before TIM2 again - the exact bug this file exists to catch' },
  { test: 'layout.test.js', dist: true, libs: { browser: true, harness: true },
    find: "  .mode .periphintro,.mode .paramhead,.mode table.rail,.mode .afrow{grid-column:1/-1}",
    to: "  .mode .paramhead,.mode table.rail,.mode .afrow{grid-column:1/-1}",
    why: 'the peripheral intro no longer spans both #mode columns - the exact bug this file exists to catch' },
];

const KNOWN = new Set(PLAN.map(p => p.test));
const ALL_TESTS = fs.readdirSync(path.join(ROOT, 'app', 'tests')).filter(f => f.endsWith('.test.js'));
const unplanned = ALL_TESTS.filter(f => !KNOWN.has(f));

const EVIDENCE = path.join(ROOT, 'tests', 'evidence', 'round6', '2026-09-13-app-tests-planted-breaks.md');
const lines = [];
const log = s => { console.log(s); lines.push(s); };

let caught = 0, missed = 0, couldNot = 0;

for (const item of PLAN) {
  if (filter && !item.test.toLowerCase().includes(filter)) continue;
  log(`\n${item.test}  (${item.dist ? 'dist/index.html' : 'app/engine/' + item.engine})`);
  log(`  planting: ${item.why}`);

  let testFilePath, cleanup;
  try {
    if (item.dist) {
      const distSrc = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');
      const n = occurrences(distSrc, item.find);
      if (n !== 1) throw new Error(`anchor occurs ${n} time(s) in dist/index.html, need exactly 1`);
      ({ testFilePath, cleanup } = withMutantDist(t => t.split(item.find).join(item.to),
        { testFile: item.test, libs: item.libs }));
    } else {
      const engSrc = fs.readFileSync(path.join(ROOT, 'app', 'engine', item.engine), 'utf8');
      const n = occurrences(engSrc, item.find);
      if (n !== 1) throw new Error(`anchor occurs ${n} time(s) in app/engine/${item.engine}, need exactly 1`);
      ({ testFilePath, cleanup } = withMutantEngine(item.engine, t => t.split(item.find).join(item.to),
        { testFile: item.test, cli: !!item.cli }));
    }
  } catch (e) {
    couldNot++;
    log(`  COULD-NOT-RUN: ${e.message}`);
    continue;
  }

  let r;
  try {
    r = runMutantTestFile(testFilePath, { timeoutMs: 120000 });
  } finally {
    cleanup();
  }

  if (r.loadError) {
    couldNot++;
    log(`  COULD-NOT-RUN: the file would not even load: ${r.loadError.split('\n')[0]}`);
    continue;
  }
  if ((r.pass || 0) === 0 && (r.fail || 0) === 0) {
    couldNot++;
    log(`  COULD-NOT-RUN: no tests registered (exit ${r.code})`);
    if (r.stderr) log('    stderr: ' + r.stderr.split('\n').slice(0, 6).join('\n    '));
    continue;
  }
  if (r.fail > 0) {
    caught++;
    const first = r.results.find(x => !x.ok);
    log(`  CAUGHT - ${r.fail} of ${r.pass + r.fail} of its own tests went red`);
    log(`    ${first.name}`);
    log('    ' + first.error.split('\n').slice(0, 6).join('\n    '));
  } else {
    missed++;
    log(`  MISSED - the mutation changed the text and all ${r.pass} of its own tests still passed`);
  }
}

log(`\n${'-'.repeat(64)}`);
log(`CAUGHT ${caught} - MISSED ${missed} - COULD-NOT-RUN ${couldNot}  (of ${PLAN.length} planned)`);
if (unplanned.length) log(`NOT YET PLANNED (new files since this list was written): ${unplanned.join(', ')}`);

if (!filter) {
  const header = `# app/tests/**'s own planted-break sweep - round 6, deliverable B\n\n` +
    `Captured from \`node scripts/plant_app_tests.js\` on ${new Date().toISOString().slice(0, 16)}Z. ` +
    `Each row mutates a COPY - app/engine/<file> under a fresh temp root (tests/lib/enginemutant.js) ` +
    `for the engine-based tests, or dist/index.html for the ones that boot()/withPage() the built ` +
    `bundle instead of importing app/engine live. The working tree is never touched; every mutation ` +
    `is verified to change the text at an anchor that occurs EXACTLY ONCE first, or the row is ` +
    `COULD-NOT-RUN rather than a silent no-op over a file that was never broken.\n\n` +
    'A break the checker could not RUN is not a break it MISSED - the two are counted separately.\n\n' +
    '```\n' + lines.join('\n') + '\n```\n';
  fs.writeFileSync(EVIDENCE, header);
  console.log(`\nwrote ${EVIDENCE}`);
}
