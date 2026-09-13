// tests/check_dist_fresh.test.js — proves scripts/check_dist_fresh.js v2 catches the exact
// defect v1 had, using the REAL commits that exposed it rather than a synthetic plant.
//
// "Seen red for REAL on the runner — better than a plant, and recorded as such"
// (tests/evidence/round6/2026-09-13-gates-without-a-plant.md) applies here in the
// strongest form available: this repo's own history already contains the counter-example.
// v1 rebuilt from the WORKING TREE. `862f099` ("AGENT-2: rebuild dist/index.html against
// the current tree") was built while AGENT-1's ECDC data sat uncommitted on disk, so the
// rebuild picked up placeholders for data `862f099` itself never committed - v1 would have
// certified it fine (the working tree "looked" consistent at the moment it ran). CI checks
// out `862f099` with nothing else on disk and rebuilds from exactly what is committed:
// different bytes, correctly stale (run 74, completed failure). `3df6ebf` and `90d6ab1`
// inherited the same staleness two commits further (runs 72/73, both completed failure);
// `851e974` predates it and is the last confirmed-green commit before it (run 71, completed
// success). All four conclusions here are read from those real, completed CI runs - not
// asserted from this file's own opinion of what should have happened.
//
// v2 builds every input with `git show <sha>:<path>` - the object database, never a path on
// disk - so another agent's uncommitted edit cannot be involved at all. This file's job is
// to prove that difference actually changes the answer on the commits where it mattered.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, assert } from './lib/harness.js';
import { checkCommitFresh, ROOT } from '../scripts/check_dist_fresh.js';

// sha, and CI's own completed conclusion for it (ground truth, not this file's opinion):
//   run 71 https://github.com/arwidcool/WCH_Cube/actions/runs/34780734937  success
//   run 72 https://github.com/arwidcool/WCH_Cube/actions/runs/34781364294  failure
//   run 73 https://github.com/arwidcool/WCH_Cube/actions/runs/34782444530  failure
//   run 74 https://github.com/arwidcool/WCH_Cube/actions/runs/34783215412  failure
//   run 76 https://github.com/arwidcool/WCH_Cube/actions/runs/34783474125  success
const CASES = [
  { sha: '851e974', ci: 'success', why: 'run 71 - predates the staleness window' },
  { sha: '862f099', ci: 'failure', why: 'run 74 - built from AGENT-1\'s uncommitted ECDC data, the exact defect this file exists to catch' },
  { sha: '3df6ebf', ci: 'failure', why: 'run 72 - inherited the staleness two commits later, touched none of the build inputs itself' },
  { sha: '90d6ab1', ci: 'failure', why: 'run 73 - inherited the same staleness one commit further' },
  { sha: '50cafdb', ci: 'success', why: 'run 76 - the data finally landed committed; the window closed' },
];

for (const { sha, ci, why } of CASES) {
  test(`${sha} matches CI's own completed conclusion (${ci}) - ${why}`, () => {
    const r = checkCommitFresh(ROOT, sha);
    if (ci === 'success') {
      assert.ok(r.fresh, `expected ${sha} fresh (CI run was success) but got stale: ${r.reason}`);
    } else {
      assert.ok(!r.fresh, `expected ${sha} STALE (CI run was failure) but v2 said fresh - `
        + `it would have missed the exact defect it was built to catch`);
      assert.ok(r.reason && r.reason.includes(sha), 'the stale reason does not name the commit it is about');
    }
  });
}

// Checked by hand before writing the test below: `git log --format=%H | while read c; do
// git cat-file -e $c:dist/index.html || echo MISSING $c; done` prints nothing over this
// repo's full 337-commit history — dist/index.html has been present since the very first
// commit (7ae8ff1). So "the repo's very first commit" is NOT an example of a commit missing
// dist/index.html; it IS an example of a commit that predates a build input the assembler
// needs unconditionally (app/vendor/js-yaml.js was added later). The two gaps get two
// separate tests below, each against the commit that actually demonstrates it, rather than
// one test asserting something false about our own history.

test('a commit whose shape predates a build input the assembler needs is reported clearly, not thrown as a raw git error', () => {
  const root = ROOT;
  const first = execSync('git rev-list --max-parents=0 HEAD', { cwd: root, encoding: 'utf8' }).trim().split('\n')[0];
  // Sanity-check the premise this test relies on, so it fails loudly (not silently passes
  // for the wrong reason) if history is ever rewritten under it.
  assert.ok(
    execSync(`git cat-file -e ${first}:dist/index.html || echo MISSING`, { cwd: root, encoding: 'utf8' }).trim() === '',
    `expected ${first} to HAVE dist/index.html (this test is about a DIFFERENT missing input)`
  );
  let threw = null;
  try { checkCommitFresh(root, first); } catch (e) { threw = e; }
  assert.ok(threw, `expected checkCommitFresh(${first}) to throw — it predates app/vendor/js-yaml.js — but it returned normally`);
  assert.ok(!/^fatal:/m.test(threw.message),
    `expected a clear message naming the problem, not git's raw fatal passthrough: ${threw.message}`);
  assert.ok(threw.message.includes(first), `expected the error to name the commit (${first}): ${threw.message}`);
  assert.ok(/app\/vendor\/js-yaml\.js/.test(threw.message),
    `expected the error to name the missing build input: ${threw.message}`);
});

test('a commit missing dist/index.html entirely is reported, not thrown past', () => {
  // No real commit in this repo's history lacks dist/index.html (see the note above), so
  // this plants the shape in a disposable scratch repo instead — never the shared tree,
  // per the same "mutate a copy" discipline tests/lib/mutant.js uses for file-level plants.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-nodist-'));
  try {
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email "qa@example.com"', { cwd: dir });
    execSync('git config user.name "check_dist_fresh test"', { cwd: dir });
    fs.writeFileSync(path.join(dir, 'build.py'), '# stub — this commit has no dist/index.html, so build.py is never actually run\n');
    execSync('git add build.py', { cwd: dir });
    execSync('git commit -q -m "no dist/index.html in this commit"', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();

    const r = checkCommitFresh(dir, sha);
    assert.equal(r.fresh, false);
    assert.ok(/no dist\/index\.html/.test(r.reason), `expected a "no dist/index.html" reason, got: ${r.reason}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
