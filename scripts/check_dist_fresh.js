#!/usr/bin/env node
// scripts/check_dist_fresh.js — catch a stale dist/index.html LOCALLY, before a runner
// spends eight minutes finding out and then skips the real tests because of it.
//
// This is the fourth time the exact same defect has failed CI: two data commits that
// did not rebuild, one clean-clone build overtaken by four commits by the time it
// finished, and 2026-09-13's run 66 (448b628) — which then SKIPPED fonts, browser-detect
// and Run tests in consequence, so that commit shipped with NO test result at all. Four
// instances, one cause, is a missing guard, not bad luck (main, 2026-09-13).
//
// The check is the same one CI runs (.github/workflows/ci.yml, "dist/index.html is up
// to date"): rebuild, then diff. What is different is WHETHER it rebuilds at all — a
// needless `python build.py` on a shared tree is its own hazard (README §4: it can read
// another agent's mid-edit, uncommitted file and blame the wrong commit, and it wastes
// everyone's time when the change in hand cannot touch dist/index.html anyway), so this
// only rebuilds when something dist/index.html is actually built FROM has changed in the
// commits being pushed. A change to tests/, tools/, docs/ or the agent pack costs nothing
// here — it exits before touching build.py at all.
//
// Usage:
//   node scripts/check_dist_fresh.js            # run by hand before pushing
//   installed as .git/hooks/pre-push             # automatic — see scripts/install_hooks.js
//
// Known limitation, stated rather than hidden: this runs against the SHARED working
// tree, not a clean checkout. If another agent has uncommitted edits under app/engine/,
// app/template.html, app/assets/ or data/ at the moment this runs, the rebuild reflects
// their in-progress work too, not just the commits being pushed — the same class of
// cross-agent noise `README.md` §4 already names for `python build.py` generally. Treat
// a failure here as "something needs a rebuild before this push," and re-run once the
// tree is quiet if the result looks like it was not about your own change.
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'index.html');

// Exactly what build.py reads (app/template.html inlines app/engine/*.js and every
// data/mcus/*.yaml — see build.py's own read_text()/glob() calls). tools/wchcube_cli.js
// reads app/engine/*.js too but does not touch dist/index.html, so it is not listed here.
const BUILD_INPUTS = ['app/template.html', 'app/engine', 'app/assets', 'data', 'build.py'];

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
}

/** Every ref range about to be pushed, from the pre-push hook's stdin protocol
 *  (`<local ref> <local sha> <remote ref> <remote sha>`, one line per ref), or — run by
 *  hand, no stdin — whatever is not yet on the upstream tracking branch. */
function pushedRanges() {
  let stdinText = '';
  try { if (!process.stdin.isTTY) stdinText = fs.readFileSync(0, 'utf8').trim(); } catch { /* no stdin piped */ }
  if (stdinText) {
    const ZERO = '0'.repeat(40);
    return stdinText.split('\n').filter(Boolean).map(line => {
      const [, localSha, , remoteSha] = line.trim().split(/\s+/);
      return remoteSha && remoteSha !== ZERO ? `${remoteSha}..${localSha}` : localSha;
    });
  }
  try {
    const upstream = sh('git rev-parse --abbrev-ref --symbolic-full-name @{u}').trim();
    return [`${upstream}..HEAD`];
  } catch {
    return ['HEAD']; // no upstream configured (a fresh branch) - check the tip commit at least
  }
}

function touchesBuildInputs(range) {
  try {
    const files = sh(`git diff --name-only ${range} -- ${BUILD_INPUTS.map(p => `"${p}"`).join(' ')}`).trim();
    return files.length > 0;
  } catch {
    return true; // a range git cannot resolve (e.g. the very first commit) - safer to check
  }
}

function main() {
  const ranges = pushedRanges();
  if (!ranges.some(touchesBuildInputs)) {
    console.log('check_dist_fresh: nothing being pushed touches ' + BUILD_INPUTS.join(', ') + ' - skipped.');
    return 0;
  }

  console.log('check_dist_fresh: a build-relevant file is being pushed - rebuilding dist/index.html to check it is current...');
  const build = spawnSync('python', ['build.py'], { cwd: ROOT, stdio: 'inherit' });
  if (build.status !== 0) {
    console.error('check_dist_fresh: `python build.py` itself failed - fix that before pushing (not a staleness question).');
    return 1;
  }
  if (!fs.existsSync(DIST)) {
    console.error('check_dist_fresh: build.py did not produce dist/index.html at all.');
    return 1;
  }
  const diff = spawnSync('git', ['diff', '--quiet', '--', 'dist/index.html'], { cwd: ROOT });
  if (diff.status !== 0) {
    console.error('\ncheck_dist_fresh: dist/index.html is STALE relative to what is about to be pushed.');
    console.error('  The rebuild above already updated it on disk (the exact same check CI runs).');
    console.error('  git add dist/index.html, fold it into your commit, and push again.\n');
    spawnSync('git', ['diff', '--stat', '--', 'dist/index.html'], { cwd: ROOT, stdio: 'inherit' });
    return 1;
  }
  console.log('check_dist_fresh: dist/index.html matches a fresh build - OK.');
  return 0;
}

process.exit(main());
