// =============================================================================
//  tests/strict.test.js — the `--strict` gate, asserted as an EXIT CODE.
//
//  Round 5's Deliverable B says: every part generates C with no TODO and no
//  `#error`, and the acceptance test is
//
//      node tools/wchcube_cli.js --project <fixture> --strict   ->  exit 0
//
//  for every fixture x every part. Round 4 opened with that command exiting 2.
//  Two things make this a gate rather than a slogan:
//
//  1. The DEFAULT format is `pins-md`, and `--strict` deliberately says nothing
//     about codegen when no C was generated (there is a test for that in
//     app/tests/cli.test.js). So the literal round-5 command is checked AND the
//     same command with `--format c`, which is what actually puts the "no TODO,
//     no #error" claim under a gate. Asserting the file's exit code — not the
//     absence of the word TODO in its text — is the point: `--strict` is the
//     thing CI branches on.
//
//  2. A gate nobody has seen go red is a gate nobody should trust. Both halves
//     are planted below: a conflicting project and a part with no `codegen:`
//     block, each of which must exit 2.
//
//  The fixtures are the checked-in `.wchproj` files that ASSIGN PINS. A default
//  configuration generates an empty WCHCube_GPIO_Init() and would pass this gate
//  while proving nothing at all.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { suite, test, assert, skip } from './lib/harness.js';
import { ROOT } from './lib/app.js';
import { FIXTURES, boot } from './fixtures/make_fixtures.js';
import * as eng from '../app/engine/index.js';

suite('--strict gate');

const CLI = path.join(ROOT, 'tools', 'wchcube_cli.js');

function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (r.error) throw r.error;
  return r;
}

// ---------------------------------------------------------------- the gate
for (const fx of FIXTURES) {
  const proj = path.join(ROOT, 'tests', 'fixtures', fx.file);

  test(`${fx.file}: --strict exits 0`, () => {
    if (!fs.existsSync(CLI)) skip('tools/wchcube_cli.js does not exist');
    assert.ok(fs.existsSync(proj), `${fx.file} is missing — this gate has nothing to run on`);
    const r = run(['--project', proj, '--strict', '--quiet']);
    assert.equal(r.status, 0,
      `--strict exited ${r.status} on a fully configured ${fx.mcu} (${fx.pkg}). `
      + `Exit 0 is the round-5 acceptance test for deliverable B:\n${(r.stderr || r.stdout || '').trim()}`);
  });

  test(`${fx.file}: --strict exits 0 with the C generated`, () => {
    if (!fs.existsSync(CLI)) skip('tools/wchcube_cli.js does not exist');
    assert.ok(fs.existsSync(proj), `${fx.file} is missing — this gate has nothing to run on`);
    // `--format c` is the half that can see a TODO or an `#error`. Without it the
    // default `pins-md` makes --strict silent about codegen by design.
    const r = run(['--project', proj, '--format', 'c', '--strict', '--quiet']);
    assert.equal(r.status, 0,
      `--strict --format c exited ${r.status} on ${fx.mcu} (${fx.pkg}): the generated C carries `
      + `a TODO or an #error, or the configuration is not clean:\n${(r.stderr || r.stdout || '').trim()}`);
  });
}

// A gate over the fixtures is only as wide as the fixtures. Every part the app
// ships must have one, or "every fixture x every part" is a sentence about a part
// nobody tested — and adding a part would silently add no coverage.
test('every shipped part has a fixture behind the --strict gate', () => {
  if (!fs.existsSync(CLI)) skip('tools/wchcube_cli.js does not exist');
  const r = run(['--list']);
  assert.equal(r.status, 0, `wchcube_cli.js --list failed:\n${r.stderr || r.stdout}`);
  const shipped = r.stdout.split('\n')
    .filter(l => l && !/^\s/.test(l)).map(l => l.trim()).filter(Boolean);
  assert.ok(shipped.length, 'the CLI listed no parts at all');
  const covered = new Set(FIXTURES.map(f => f.mcu));
  assert.empty(shipped.filter(p => !covered.has(p)),
    'part(s) the app ships with no .wchproj behind the --strict gate — a new part must bring '
    + 'a fixture with it, or nothing compiles its generated C');
});

// ---------------------------------------------------------------- the gate can fail
// Plant the two conditions `--strict` exists to reject and insist it exits 2.
// Without this, a bug that made the CLI always exit 0 would leave every check
// above green and the round's claim standing on nothing.
test('the gate can go red: a conflicting configuration exits 2', () => {
  if (!fs.existsSync(CLI)) skip('tools/wchcube_cli.js does not exist');
  boot();
  eng.loadMcu(eng.MCU_FILES.CH32V006);
  eng.setPackage('TSSOP20');
  eng.setProject({ name: 'strict_gate_red' });
  // The round-3 setup pass's own mistake: two peripherals that both want PA2.
  for (const pid of ['ADC1', 'TKEY']) {
    const s = eng.M.peripherals[pid].settings[0];
    const c = s.choices.find(x => x.signals && x.signals.length);
    if (s.type === 'checkboxes') eng.toggleSetting(pid, s.name, c.name, true);
    else eng.setSetting(pid, s.name, c.name);
  }
  assert.ok(eng.compute().conflictList.length,
    'setup: the planted configuration was supposed to conflict on PA2');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-strict-'));
  try {
    const proj = path.join(dir, 'strict_gate_red.wchproj');
    fs.writeFileSync(proj, eng.projectSerialize(), 'utf8');
    const loose = run(['--project', proj, '--quiet']);
    assert.equal(loose.status, 0, 'without --strict the same project still generates — the flag is the gate');
    const strict = run(['--project', proj, '--strict', '--quiet']);
    assert.equal(strict.status, 2,
      `--strict must exit 2 on a conflicted project, not ${strict.status}:\n`
      + (strict.stderr || strict.stdout));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the gate can go red: a TODO in the generated C exits 2', () => {
  if (!fs.existsSync(CLI)) skip('tools/wchcube_cli.js does not exist');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-strict-nocg-'));
  try {
    // CH32V006 with its `codegen:` block taken away: codegen then declines to
    // guess and emits TODOs. Written outside data/mcus/ — this is a planted
    // break, not a part the app ships.
    const yaml = path.join(dir, 'nocodegen.yaml');
    fs.writeFileSync(yaml, [
      'mcu:',
      '  name: CH32V006-STRICT-NOCODEGEN',
      '  inherits: CH32V006',
      '  fixture: true',
      '  remove: [codegen, gpio]',
      '',
    ].join('\n'), 'utf8');

    const r = run([yaml, '--format', 'c', '--strict', '--quiet']);
    assert.equal(r.status, 2,
      `--strict must exit 2 when the generated C is a complaint, not code — got ${r.status}:\n`
      + (r.stderr || r.stdout));
    assert.match(r.stderr || '', /TODO/,
      'and it should say which complaint it found, not just fail');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
