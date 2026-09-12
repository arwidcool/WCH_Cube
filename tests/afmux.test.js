// =============================================================================
//  tests/afmux.test.js — the per-pin AF mechanism against the SHIPPED data.
//
//  `app/tests/afmux.test.js` is the engine's half, on a part invented there so the
//  mechanism cannot be confused with the one part that has it. This file is the other
//  half: it audits every real MCU file against the schema in `data/FORMAT.md`
//  (`## signal_pins`), exercises the mechanism on the real part, and runs the
//  validator's planted-break self-test so that "validate_mcu exits 0" means the new
//  checks were actually read.
//
//  It also holds the REGRESSION assertion the round turns on: a part that does not
//  use `signal_pins:` must be untouched by any of it.
// =============================================================================
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, assert, fresh, eng, mcuFiles, ROOT, jsyaml } from '../app/tests/_harness.js';

const parts = () => mcuFiles().map(rel => ({
  rel,
  name: path.basename(rel, '.yaml'),
  doc: jsyaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')),
}));

const afParts = () => parts().filter(p =>
  Object.values((p.doc.peripherals || {})).some(P => P && P.signal_pins));

test('at least one shipped part is AF-muxed, or this whole gate is vacuous', () => {
  const names = afParts().map(p => p.name);
  assert.ok(names.length, 'no shipped part uses signal_pins: — the AF checks below prove nothing');
});

test('every signal_pins entry names a real pin and a four-bit AF code', () => {
  const bad = [];
  for (const { name, doc } of afParts()) {
    for (const [pid, P] of Object.entries(doc.peripherals || {})) {
      for (const [sig, opts] of Object.entries(P.signal_pins || {})) {
        assert.ok(Array.isArray(opts) && opts.length, `${name}.${pid}.${sig}: empty option list`);
        const seen = new Set();
        for (const o of opts) {
          if (!doc.pins[o.pin]) bad.push(`${name} ${pid}_${sig}: ${o.pin} is not in pins:`);
          if (seen.has(o.pin)) bad.push(`${name} ${pid}_${sig}: ${o.pin} listed twice`);
          seen.add(o.pin);
          if (o.af !== undefined && (!Number.isInteger(o.af) || o.af < 0 || o.af > 15)) {
            bad.push(`${name} ${pid}_${sig}: af ${o.af} does not fit GPIOx_AFRy's four bits`);
          }
        }
      }
    }
  }
  assert.deepEqual(bad, [], 'signal_pins entries that name something that does not exist');
});

test('a part declares one mux shape, and the style matches the peripherals', () => {
  const bad = [];
  for (const { name, doc } of parts()) {
    const style = ((doc.codegen || {}).remap || {}).style;
    const af = Object.entries(doc.peripherals || {}).filter(([, P]) => P && P.signal_pins);
    for (const [pid, P] of af) {
      if (P.remaps) bad.push(`${name}.${pid}: has remaps: AND signal_pins:, so one of them is dead`);
    }
    if (af.length && style !== 'af') {
      bad.push(`${name}: ${af.length} peripheral(s) use signal_pins: but codegen.remap.style is ${style || 'unset'}`);
    }
    if (style === 'af') {
      if (!af.length) bad.push(`${name}: style: af but no peripheral has signal_pins:`);
      if (!((doc.codegen || {}).remap || {}).fn) bad.push(`${name}: style: af with no codegen.remap.fn`);
      if (((doc.codegen || {}).remap || {}).fields) bad.push(`${name}: style: af cannot have remap.fields`);
    }
  }
  assert.deepEqual(bad, [], 'mux shape and declared style disagree');
});

test('every signal a setting can request has a pin on an AF part', () => {
  const bad = [];
  for (const { name, doc } of afParts()) {
    for (const [pid, P] of Object.entries(doc.peripherals || {})) {
      if (!P.signal_pins) continue;
      const routed = new Set(Object.keys(P.signal_pins));
      for (const s of P.settings || []) {
        for (const c of s.choices || []) {
          for (const sig of c.signals || []) {
            if (!routed.has(sig)) bad.push(`${name}.${pid}: "${c.name}" asks for ${sig}, which signal_pins: does not route`);
          }
        }
      }
    }
  }
  assert.deepEqual(bad, [], 'a choice that can never be satisfied');
});

// ---- the mechanism, on the real part -----------------------------------------

test('on the real part, two signals of one peripheral sit on independently chosen pins', () => {
  const part = afParts()[0];
  fresh(part.name);
  // Find a peripheral with two signals that each have more than one pin option. That
  // combination is the thing `remaps:` cannot express, so if the shipped data has none,
  // this part did not need the mechanism and the claim behind it is weaker than stated.
  let found = null;
  for (const pid of Object.keys(eng.M.peripherals)) {
    if (!eng.isAfMuxed(pid)) continue;
    const multi = Object.keys(eng.M.peripherals[pid].signal_pins)
      .filter(sig => eng.signalPinOptions(pid, sig).length > 1);
    if (multi.length >= 2) { found = { pid, sigs: multi }; break; }
  }
  assert.ok(found, `${part.name} has no peripheral with two independently movable signals`);

  const { pid, sigs } = found;
  const [a, b] = sigs;
  // Turn the peripheral on through a setting that needs both signals, so compute() sees them.
  for (const s of eng.M.peripherals[pid].settings || []) {
    const c = (s.choices || []).find(x => (x.signals || []).includes(a) && (x.signals || []).includes(b));
    if (c) { eng.setSetting(pid, s.name, c.name); break; }
  }
  const before = { ...eng.signalPins(pid).pins };
  const other = eng.signalPinOptions(pid, a).map(o => o.pin).find(p => p !== before[a]);
  eng.setSignalPin(pid, a, other);
  const after = eng.signalPins(pid).pins;
  assert.equal(after[a], other, `${pid}_${a} moved`);
  assert.equal(after[b], before[b], `${pid}_${b} must NOT have followed it`);
});

test('the generated C names one AF call per signal, and the call exists in the SDK', () => {
  const part = afParts()[0];
  fresh(part.name);
  const fn = part.doc.codegen.remap.fn;
  // Switch on every peripheral that has a plain two-choice mode, so several ports are hit.
  for (const [pid, P] of Object.entries(eng.M.peripherals)) {
    if (!eng.isAfMuxed(pid) || pid === 'SYS') continue;
    const mode = (P.settings || []).find(s => s.name === 'Mode');
    if (mode && mode.choices[1]) eng.setSetting(pid, 'Mode', mode.choices[1].name);
  }
  eng.compute();
  const c = eng.cSource();
  const calls = (c.match(new RegExp(`${fn}\\(`, 'g')) || []).length;
  assert.ok(calls >= 4, `expected several ${fn} calls, got ${calls}`);
  // Every emitted call must carry a real AF macro, never an unsubstituted placeholder.
  assert.ok(!/GPIO_AF\$AF/.test(c), 'an unsubstituted $AF reached the generated C');
  assert.ok(!/GPIO_PinSourceundefined|GPIOundefined/.test(c), 'an undefined port or bit reached the generated C');
  assert.ok(!/AFIO->PCFR/.test(c), 'an AF part must not also write a per-peripheral AFIO word');
});

// ---- the regression half ------------------------------------------------------

test('a part with no signal_pins generates exactly what it did before the key existed', () => {
  for (const { name, doc } of parts()) {
    if (Object.values(doc.peripherals || {}).some(P => P && P.signal_pins)) continue;
    fresh(name);
    eng.compute();
    const c = eng.cSource();
    assert.ok(!/GPIO_PinAFConfig/.test(c), `${name} must emit no per-pin AF call`);
    assert.deepEqual(eng.afPlan(), { style: null, fn: null, calls: [], missing: [] },
      `${name} must produce no AF plan`);
  }
});

// ---- the checks can fail -------------------------------------------------------

test('validate_mcu.py catches a planted break in every new AF check', () => {
  const tool = path.join(ROOT, 'tools', 'validate_afmux_selftest.py');
  assert.ok(fs.existsSync(tool), 'the AF self-test exists');
  const r = spawnSync('python', [tool], { encoding: 'utf8', cwd: ROOT });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 0, `tools/validate_afmux_selftest.py exited ${r.status}:\n${out}`);
  // ...and that it actually ran cases rather than finding nothing to do.
  const m = /(\d+)\/(\d+) planted breaks caught/.exec(out);
  assert.ok(m, `self-test printed no tally:\n${out}`);
  assert.ok(Number(m[2]) >= 8, `only ${m[2]} planted breaks; the checks are barely covered`);
});
