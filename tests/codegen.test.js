// Release QA for the generated C.
//
// AGENT-2's app/tests/codegen.test.js checks the generator's structure. This checks the
// thing DONE.md actually gates on: the C produced for a real part, from the real built
// app, with no TODO left in it.
//
// While an MCU file has no `codegen:` block the generator is SUPPOSED to emit a TODO that
// names what is missing - that is the documented behaviour and is tested here too. The
// moment AGENT-1 lands the block, the no-TODO rule starts being enforced automatically,
// so nobody has to remember to turn this on.
import fs from 'node:fs';
import path from 'node:path';
import { suite, test, assert } from './lib/harness.js';
import { boot, ROOT } from './lib/app.js';
import { yaml } from './lib/deps.js';

suite('generated C');

const mcuDoc = name => yaml().load(fs.readFileSync(path.join(ROOT, 'data', 'mcus', `${name}.yaml`), 'utf8'));
// Judge the RESOLVED model, not the raw file: CH32V005 inherits CH32V006's codegen
// block, so its own YAML shows none while the app generates real register words.
const hasCodegenBlock = name => {
  const doc = mcuDoc(name);
  if (doc.codegen) return true;
  const parent = (doc.mcu || {}).inherits;
  return parent ? hasCodegenBlock(parent) : false;
};

/** Every TODO the generator left, one line each. */
function todosIn(text) {
  return text.split('\n')
    .map((line, i) => ({ line: i + 1, text: line.trim() }))
    .filter(l => l.text.includes('TODO'))
    .map(l => `line ${l.line}: ${l.text.replace(/^\/\*\s*/, '').slice(0, 110)}`);
}

test('the generator produces both C files for every MCU on every package', () => {
  const a = boot();
  const problems = [];
  try {
    if (typeof a.window.cFiles !== 'function') {
      assert.ok(false, 'cFiles() is not in the bundle - codegen.js is not being inlined by build.py');
    }
    for (const name of a.mcuNames) {
      a.loadMcu(name);
      for (const pkg of a.packages) {
        a.setPackage(pkg);
        a.clearProblems();
        let files;
        try { files = a.window.cFiles(); } catch (e) { problems.push(`${name} ${pkg}: cFiles() threw - ${e.message}`); continue; }

        for (const want of ['wchcube_init.h', 'wchcube_init.c']) {
          const body = files[want];
          if (!body) { problems.push(`${name} ${pkg}: no ${want}`); continue; }
          if (body.length < 200) problems.push(`${name} ${pkg}: ${want} is only ${body.length} bytes`);
          const open = (body.match(/\{/g) || []).length, close = (body.match(/\}/g) || []).length;
          if (open !== close) problems.push(`${name} ${pkg}: ${want} has ${open} "{" and ${close} "}"`);
          const opened = (body.match(/\/\*/g) || []).length, closed = (body.match(/\*\//g) || []).length;
          if (opened !== closed) problems.push(`${name} ${pkg}: ${want} has an unterminated comment`);
        }
        const h = files['wchcube_init.h'] || '';
        if (!/#ifndef|#pragma once/.test(h)) problems.push(`${name} ${pkg}: the header has no include guard`);
        for (const p of a.problems()) problems.push(`${name} ${pkg}: ${p}`);
      }
    }
  } finally { a.close(); }
  assert.empty(problems, 'generated C problems');
});

test('a missing codegen: block produces a TODO that says what is missing', () => {
  const a = boot();
  try {
    const withoutBlock = a.mcuNames.filter(n => !hasCodegenBlock(n));
    if (!withoutBlock.length) { console.log('        (every MCU file now has a codegen: block)'); return; }

    const name = withoutBlock[0];
    a.loadMcu(name);
    const c = a.window.cFiles()['wchcube_init.c'];
    const todos = todosIn(c);
    assert.ok(todos.length, `${name} has no codegen: block, so the C should carry a TODO saying so`);
    // AGENT-2 06:xx: a real part must also refuse to compile; only a fixture may just warn.
    const fixture = a.ev('isFixture()');
    assert.equal(c.includes('has no codegen: block'), !fixture,
      fixture ? `${name} is a fixture, so no #error is expected`
              : `${name} is a real part with no codegen: block and must #error`);
    const vague = todos.filter(t => t.length < 40);
    assert.empty(vague, 'TODOs that do not name what is missing');
  } finally { a.close(); }
});

test('once an MCU file has a codegen: block its C contains no TODO', () => {
  const a = boot();
  const problems = [];
  try {
    const ready = a.mcuNames.filter(hasCodegenBlock);
    if (!ready.length) {
      // DONE.md "C code generation ... (no TODO sections)" stays open until this runs.
      console.log('        (pending: no MCU file has a codegen: block yet - AGENT-1)');
      return;
    }
    for (const name of ready) {
      a.loadMcu(name);
      for (const pkg of a.packages) {
        a.setPackage(pkg);
        const files = a.window.cFiles();
        for (const [file, body] of Object.entries(files)) {
          for (const t of todosIn(body)) problems.push(`${name} ${pkg} ${file}: ${t}`);
        }
      }
    }
  } finally { a.close(); }
  assert.empty(problems, 'the MCU file has a codegen: block but the generated C still has TODOs');
});

test('the generated C names the pins the user actually configured', () => {
  const a = boot();
  try {
    a.loadMcu('CH32V006');
    const pin = a.pinNames().find(n => a.ev(`pinType(${JSON.stringify(n)})`) === 'io');
    a.assign(pin, { gpio: 'GPIO_Output' });
    a.ev(`(S.gpio[${JSON.stringify(pin)}] ||= {}).label = 'LED_RED'`);
    a.window.renderAll();

    const c = a.window.cFiles()['wchcube_init.c'];
    assert.includes(c, pin.replace(/^P([A-Z])(\d+)$/, 'GPIO$1'), `the port of ${pin} is missing from the C`);
    assert.ok(c.includes(pin) || c.includes('LED_RED'), `neither ${pin} nor its label appears in the C`);
    assert.empty(a.problems(), 'generating C logged problems');
  } finally { a.close(); }
});
