// =============================================================================
//  tests/h417_packages.test.js — the three claims of the CH32H417 push, checked from
//  the APP rather than from the datasheet, on every package the part is sold in.
//
//      "Every pin the datasheet gives this part is claimable in the app, every
//       peripheral it names is configurable, and the C that comes out is right for
//       the pad it configures."
//
//  The coverage ledger (`python tools/coverage.py CH32H417`, docs/COVERAGE.md) checks the
//  first two of those FROM THE DATASHEET: it reads the pin table and asks whether the MCU
//  file accounts for every row. That is the half that stops a fact going missing. This file
//  checks the same two FROM THE ENGINE, which is the half a user actually meets — a pin can
//  be modelled in `signal_pins:` and still be unreachable in the app, and a peripheral can
//  have a `settings:` block and still offer nothing that does anything.
//
//  WHY PER PACKAGE, AND WHY THIS PART. CH32H417 is the first part in this repository where
//  the PACKAGE decides which pins a peripheral can reach. 301 of its signals have a
//  different set of bonded options on QFN68 / QFN88 / QFN128, and for most of them the pad
//  the app hands you when you switch the peripheral on is a different pad on each. So every
//  check here runs three times; a check that ran once would be a statement about QFN128.
//
//  THE THIRD CHECK IS A GENERALISATION OF A LIVE DEFECT. tests/h417_ltdc.test.js documents
//  four LTDC pads that were the first option for two signals at once — PA8 was R6 *and* B3,
//  PA15 was R3 *and* CLK, PA6 was G2 *and* HSYNC, PA10 was B1 *and* B4 — while the conflict
//  engine said nothing, because it only reports a pad whose claims have different OWNERS and
//  both of those were LTDC. One pad drives one bit. Simply switching the controller on
//  produced a configuration the silicon cannot honour, and every gate in the repository was
//  green. That check is LTDC-shaped; this one is the same question asked of every
//  peripheral, in every mode, on all three packages.
//
//  WHAT IS AND IS NOT A DEFECT HERE. Two signals landing on one pad is only a defect if the
//  app could have chosen otherwise. Where a signal's ONLY bonded option on this package is
//  that pad, the collision is silicon and the user has to resolve it — USBHS_DM can only be
//  PB9 (which is also SWIO) because DS Table 2-2-19 puts it there, and on QFN68 I2C1 has
//  exactly one option per signal and both are debug pads. Those are reported as FACTS below
//  and asserted as such. A signal that had four other bonded pads and defaulted onto an
//  occupied one is a defect. The difference is computed, never assumed.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { suite, test, assert } from './lib/harness.js';
import { ROOT } from './lib/app.js';
import * as eng from '../app/engine/index.js';

suite('CH32H417 packages');

const PART = 'CH32H417';
const PACKAGES = ['QFN68', 'QFN88', 'QFN128'];

function boot() {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'vendor', 'js-yaml.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  eng.setYaml(mod.exports);
  eng.loadPackages(eng.yamlLoad(fs.readFileSync(path.join(ROOT, 'data', 'packages', 'packages.yaml'), 'utf8')));
  const dir = path.join(ROOT, 'data', 'mcus');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yaml')).sort()) {
    eng.registerMcuFile(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}
boot();

/** Load the part on one package. Always from scratch: settings persist otherwise. */
const load = pkg => { eng.loadMcu(eng.MCU_FILES[PART]); eng.setPackage(pkg); };

/** Every pin name this package bonds. */
function bondedPins(pkg) {
  const out = new Set();
  for (const v of Object.values(eng.M.packages[pkg])) for (const n of [].concat(v)) out.add(String(n));
  return out;
}

/** Every pin any peripheral could route a signal to. */
function claimablePins() {
  const out = new Set();
  for (const per of Object.values(eng.M.peripherals)) {
    for (const opts of Object.values(per.signal_pins || {})) for (const o of opts) out.add(String(o.pin));
    for (const r of per.remaps || []) for (const p of Object.values(r.pins || {})) out.add(String(p));
  }
  return out;
}

/**
 * Every (peripheral, setting, choice) that claims at least one signal — i.e. every way a
 * user can switch something on. `Disable`-style choices and choices with no `signals:` are
 * not ways of claiming a pad and are excluded.
 */
function claimingChoices() {
  const out = [];
  for (const [pid, per] of Object.entries(eng.M.peripherals)) {
    for (const st of per.settings || []) {
      for (const ch of st.choices || []) {
        if (!ch.name || /^Disable/i.test(ch.name) || !(ch.signals || []).length) continue;
        out.push({ pid, setting: st.name, choice: ch.name, checkbox: st.type === 'checkboxes' });
      }
    }
  }
  return out;
}

/** Apply one choice to a freshly loaded part. Returns an error string, or null. */
function applyChoice(pkg, c) {
  load(pkg);
  try {
    if (c.checkbox) eng.toggleSetting(c.pid, c.setting, c.choice, true);
    else eng.setSetting(c.pid, c.setting, c.choice);
  } catch (e) {
    return `${c.pid}.${c.setting} = ${c.choice}: the engine refused it — ${e.message}`;
  }
  return null;
}

// --------------------------------------------------------------- 1. every pin is reachable
for (const pkg of PACKAGES) {
  test(`${pkg}: every bonded pin is claimable, or is a declared power/system pad`, () => {
    // The ledger asks this of the datasheet. This asks it of the file the app loads, which
    // is what makes a "dead pad" visible: on 2026-09-12 this part shipped 207 pins that a
    // peripheral routed to and no setting could claim, with every gate green.
    load(pkg);
    const claimable = claimablePins();
    const meta = eng.M.pins || {};
    // The pad types allowed to be unclaimable, because they carry no function a user
    // configures. Anything NOT in this list must be reachable, or the app has a pin nobody
    // can use.
    const PAD_TYPES = new Set(['power', 'ground', 'sys', 'reset']);
    const dead = [];
    for (const pin of [...bondedPins(pkg)].sort()) {
      if (claimable.has(pin)) continue;
      const type = (meta[pin] || {}).type;
      if (PAD_TYPES.has(type)) continue;
      dead.push(`${pin}: bonded on ${pkg}, no peripheral routes a signal to it, and pins.${pin}.type is `
        + `${type ? `"${type}"` : 'not declared'} — not one of ${[...PAD_TYPES].join('/')}. `
        + 'Either a peripheral should route it, or it needs a pad type saying why it carries nothing.');
    }
    assert.empty(dead, `${pkg}: bonded pins no user can claim and nothing declares as a pad`);
  });
}

// ------------------------------------------------------- 2. every peripheral is configurable
test('every peripheral offers a mode that does something, or declares that it holds no pad', () => {
  // Each peripheral must either route pins from some choice, or say `pins: { none: ... }`
  // (the silicon gives it no pad — the ledger checks that claim against the datasheet) or
  // `pins: { open: ... }` (its pads are not extracted yet, with an owner). Silence is the
  // defect that shipped four name-only USB controllers on this part.
  load('QFN128');
  const choices = claimingChoices();
  const silent = [], declaredNone = [], declaredOpen = [];
  for (const [pid, per] of Object.entries(eng.M.peripherals)) {
    const routes = Object.keys(per.signal_pins || {}).length > 0 || (per.remaps || []).length > 0;
    const none = per.pins && per.pins.none;
    const open = per.pins && per.pins.open;
    if (none) declaredNone.push(pid);
    if (open) declaredOpen.push(`${pid} (owner ${(per.pins || {}).owner || '?'})`);
    if (routes) {
      // It routes pins — so some choice must be able to claim them. `completeness.test.js`
      // checks the reverse (every routed signal is named by a choice); this checks the
      // peripheral is reachable AT ALL, which a `settings:`-less peripheral is not.
      if (!choices.some(c => c.pid === pid)) {
        silent.push(`${pid}: routes ${Object.keys(per.signal_pins || {}).length} signal(s) but no setting `
          + 'choice claims any of them — the pads cannot be switched on');
      }
      continue;
    }
    if (!none && !open) {
      silent.push(`${pid}: routes no pin and declares neither pins.none nor pins.open — `
        + 'silence is the defect (docs/COVERAGE.md check 2)');
    }
  }
  assert.empty(silent, 'peripherals that are only a name');
  // Printed as numbers so a board entry can quote them rather than an adjective.
  console.log(`      ${Object.keys(eng.M.peripherals).length} peripherals: `
    + `${declaredNone.length} declare pins.none, ${declaredOpen.length} declare pins.open`
    + (declaredOpen.length ? ` — ${declaredOpen.join(', ')}` : ''));
});

// ---------------------------------------------------- 3. no default pin collides with another
//
// THE RATCHET, AND WHY THIS IS A COUNT RATHER THAN A ZERO.
//
// When this check was first run (2026-09-12) it found the defect ALREADY COMMITTED, on every
// package: 26 / 20 / 17 mode choices that put two signals on one pad although the signal had
// another bonded pad free. tests/h417_ltdc.test.js had fixed nine of them — by hand, by
// reordering LTDC's pin lists inside data/mcus/CH32H417.yaml — and the other seventeen on
// QFN128 (DVP, FMC, I2C4, PIOC, SDIO, UHSIF, USART6) had never been looked at.
//
// So the honest options were: assert zero and leave main red on somebody else's area, or
// soften the check into a warning nobody reads. Neither. This is the shape the repository
// already uses for exactly this situation — `open_rows:` in data/coverage/<PART>.yaml and
// the IN_EXTRACTION block in tests/completeness.test.js: an owner, a TASKS.md line, and a
// number that MAY ONLY GO DOWN.
//
//   * a count that ROSE is a regression and fails, naming what came back;
//   * a count that FELL is a fix that was not recorded, and fails asking for the number to
//     be lowered — so the ceiling can never quietly stop meaning anything;
//   * at zero, delete the entry and this becomes the plain assertion it wants to be.
//
// The ratchet earned itself within an hour of being written: AGENT-1's in-flight
// regeneration of data/mcus/CH32H417.yaml took QFN68 from 26 to 38, because
// tools/gen_h417_peripherals.py:1086 emits signal_pins: in DATASHEET order and knows nothing
// about which pad ends up as the default. The hand-ordering fix lives in the generator's
// OUTPUT, so every regeneration throws it away. That is the actual bug to fix, and it is
// AGENT-1's: the order belongs in the generator.
// LOWERED TWICE ON THE AFTERNOON IT WAS WRITTEN: 26/20/17 -> 8/3/0 -> 4/0/0. AGENT-1 took the
// finding and moved the ordering into the generator, which is where it belongs; QFN88 and
// QFN128 are now at ZERO, so on those packages switching a peripheral on can no longer produce
// a pad doing two jobs. That is the ratchet working in the direction it is supposed to, and it
// is worth saying that the number was lowered by re-measuring twice and getting the same answer
// both times, not by writing down whatever the last run printed - the data was moving under this
// file all afternoon.
//
// The four that remain are all QFN68, all cases where a signal has few pads to move to:
//   FMC.Address bus A0-A25   FMC_A6 + FMC_A11 + FMC_A20 on PB11  (FMC_A11 could move)
//   FMC.Address bus A0-A25   FMC_A7 + FMC_A12 + FMC_A21 on PB12  (FMC_A12 could move)
//   UHSIF.Mode = Enabled     UHSIF_PORT3 + UHSIF_PORT6 on PB0    (UHSIF_PORT3 could move)
//   UHSIF.Mode = Enabled     UHSIF_PORT4 + UHSIF_PORT7 on PB1    (UHSIF_PORT4 could move)
// At 0 the entry goes and these three checks become the plain assertions they want to be.
const COLLISION_CEILING = {
  // package: choices that default onto an already-taken pad they could have avoided
  QFN68: 4,
  QFN88: 0,
  QFN128: 0,
};
const COLLISION_OWNER = 'AGENT-1';
const COLLISION_TASK = 'CH32H417: default pins collide';

for (const pkg of PACKAGES) {
  test(`${pkg}: switching any single peripheral on never double-claims a pad it could have avoided`, () => {
    // THE GENERALISATION of tests/h417_ltdc.test.js. Read this file's header for why
    // `E.conflictList` is not enough on its own: two claims with the SAME owner do not
    // reach it, and that is exactly how four LTDC pads stayed broken through a green suite.
    // The detector is the pin row itself — the engine joins two claims on one pad with
    // ' / ', so a row whose signal contains ' / ' is a pad being asked to do two jobs.
    load(pkg);
    const bonded = bondedPins(pkg);
    const choices = claimingChoices();
    const defects = [], silicon = [];

    /** Bonded pads this signal could have used instead of `pin`. */
    const alternatives = (pid, sig, pin) => {
      const per = eng.M.peripherals[pid] || {};
      const opts = (per.signal_pins || {})[sig] || [];
      return opts.map(o => String(o.pin)).filter(p => p !== pin && bonded.has(p));
    };

    for (const c of choices) {
      const err = applyChoice(pkg, c);
      if (err) { defects.push(err); continue; }
      eng.compute();
      for (const row of eng.pinRows()) {
        const label = String(row.signal || '');
        if (!label.includes(' / ')) continue;
        const claims = label.split(' / ').map(s => s.trim()).filter(Boolean);
        // Can ANY of the colliding claims move? If none can, the silicon forces it and the
        // user has to choose; that is a fact about the part, not a defect in the app.
        const movable = claims.filter(full => {
          const i = full.indexOf('_');
          if (i < 0) return false;
          return alternatives(full.slice(0, i), full.slice(i + 1), String(row.name)).length > 0;
        });
        const where = `${c.pid}.${c.setting} = "${c.choice}" puts ${claims.join(' + ')} on ${row.name}`;
        if (movable.length) defects.push(`${where} — ${movable.join(', ')} had somewhere else to go`);
        else silicon.push(`${where} — neither claim has another bonded pad here`);
      }
    }
    // The silicon-forced collisions are printed rather than asserted away: they are the
    // answer to "why is this not zero", and a reviewer should be able to read them.
    if (silicon.length) {
      console.log(`      ${pkg}: ${silicon.length} collision(s) the silicon forces (not defects):`);
      for (const s of silicon.slice(0, 6)) console.log(`        - ${s}`);
      if (silicon.length > 6) console.log(`        ... and ${silicon.length - 6} more`);
    }
    const ceiling = COLLISION_CEILING[pkg];
    const why =
      `Each one is a configuration the silicon cannot honour, produced by doing nothing but switching the\n`
      + `      peripheral on. The default IS the first bonded option in signal_pins:, so the fix is the ORDER of\n`
      + `      that list — and it belongs in tools/gen_h417_peripherals.py (:1086 emits it in datasheet order),\n`
      + `      NOT in the YAML it writes, or the next regeneration discards it the way it discarded the LTDC one.\n`
      + `      Owner: ${COLLISION_OWNER}. TASKS.md: "${COLLISION_TASK}".`;

    if (ceiling === 0) {
      assert.empty(defects, `${pkg}: default pin collisions that an alternative pad was free to avoid.\n      ${why}`);
      return;
    }
    if (defects.length > ceiling) {
      const shown = defects.slice(0, 12).map(d => `        - ${d}`).join('\n');
      assert.ok(false,
        `${pkg}: REGRESSION — ${defects.length} avoidable default collisions, ${ceiling} recorded. `
        + `${defects.length - ceiling} new one(s) were introduced; the count may only go DOWN.\n`
        + `      ${why}\n${shown}`
        + (defects.length > 12 ? `\n        ... and ${defects.length - 12} more` : ''));
    }
    if (defects.length < ceiling) {
      assert.ok(false,
        `${pkg}: ${defects.length} avoidable default collisions, but COLLISION_CEILING records ${ceiling}. `
        + `Someone fixed ${ceiling - defects.length} and did not lower the number — do that, in this file, `
        + 'so the ceiling keeps meaning something. It may only go down, and it must be current.');
    }
    // At the ceiling: report the number, never a green adjective. A part is not done while
    // this prints anything but 0, and PROGRESS.md quotes this figure.
    console.log(`      ${pkg}: ${defects.length} avoidable default collision(s) at the recorded ceiling `
      + `(${choices.length} mode choices swept, owner ${COLLISION_OWNER})`);
  });
}

test('the collision ceiling is a tracked exemption, not a place to put a number', () => {
  // The repository's rule for every exemption (agents/README.md, "Rules that never bend"): an
  // owner, a TASKS.md line, and a condition that retires it. Without this check the ceiling is
  // just a magic number that anyone can raise, which is the one thing a ratchet must not be.
  const tasks = fs.readFileSync(path.join(ROOT, 'TASKS.md'), 'utf8');
  assert.includes(tasks, COLLISION_TASK,
    `COLLISION_CEILING exempts ${Object.values(COLLISION_CEILING).reduce((a, b) => a + b, 0)} collisions and `
    + `cites the TASKS.md line "${COLLISION_TASK}", which is not in TASKS.md. An exemption whose task line `
    + 'has vanished has no condition that retires it — either restore the line or delete the exemption.');
  assert.ok(COLLISION_OWNER && /^AGENT-\d$/.test(COLLISION_OWNER),
    `the ceiling needs a named owner, has ${JSON.stringify(COLLISION_OWNER)}`);
  // And it must never be raised as the fix. Nothing can enforce that from inside the file, so
  // the ceiling is stated once, here, as the number a reviewer checks the diff against.
  assert.deep(Object.keys(COLLISION_CEILING).sort(), [...PACKAGES].sort(),
    'COLLISION_CEILING must carry exactly one entry per package, or a package drops out of the ratchet');
});

// ------------------------------------------------------ the facts the checks above rely on
test('QFN68 can only have I2C1 at the price of the debug port, and that is the silicon', () => {
  // Asserted rather than written in a comment, because the whole point of the package sweep
  // is that a fact like this is DIFFERENT on another package. If a later data change gives
  // QFN68 another I2C1 pad, this test goes red and the note saying "costs you SWD" has to be
  // rewritten — which is the correct outcome, not a nuisance.
  load('QFN68');
  const bonded = bondedPins('QFN68');
  const debugPins = new Set();
  for (const opts of Object.values(eng.M.peripherals.SYS.signal_pins || {})) {
    for (const o of opts) debugPins.add(String(o.pin));
  }
  assert.ok(debugPins.size >= 2, `SYS should route at least SWIO and SWCLK, routes ${debugPins.size} pad(s)`);
  for (const sig of ['SCL', 'SDA']) {
    const opts = (eng.M.peripherals.I2C1.signal_pins[sig] || []).map(o => String(o.pin)).filter(p => bonded.has(p));
    assert.equal(opts.length, 1,
      `I2C1_${sig} on QFN68 should have exactly one bonded option, has ${opts.length}: ${opts.join(',') || '(none)'}`);
    assert.ok(debugPins.has(opts[0]),
      `I2C1_${sig}'s only QFN68 pad should be a debug pad, is ${opts[0]}`);
  }
  // ...and the same peripheral on QFN128 must NOT be forced onto them, or the contrast this
  // whole file exists to check is not there.
  load('QFN128');
  const big = bondedPins('QFN128');
  for (const sig of ['SCL', 'SDA']) {
    const opts = (eng.M.peripherals.I2C1.signal_pins[sig] || []).map(o => String(o.pin)).filter(p => big.has(p));
    assert.ok(opts.some(p => !debugPins.has(p)),
      `I2C1_${sig} on QFN128 should have a pad that is not a debug pad; options are ${opts.join(',')}`);
  }
});
