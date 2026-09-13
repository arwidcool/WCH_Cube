#!/usr/bin/env node
// scripts/check_dist_fresh.js — catch a stale dist/index.html LOCALLY, before a runner
// spends eight minutes finding out and then skips the real tests because of it.
//
// v2, 2026-09-14. v1 rebuilt from the WORKING TREE and compared against whatever
// dist/index.html happened to be on disk. On a shared clone that is a live defect, not a
// theoretical one: AGENT-2's `862f099` ("rebuild dist/index.html against the current
// tree") was built while AGENT-1's ECDC data sat uncommitted on disk, so the rebuild
// picked up ECDC's placeholders — but `862f099` itself never committed that data. CI
// checks out `862f099` fresh (no uncommitted anything) and rebuilds from exactly what was
// committed: no ECDC, a different file, correctly stale. The hook had said OK. Root-caused
// by main via `git show <sha>:<path>` on the two commits, no checkout needed — the same
// technique this file uses now.
//
// So: build from the COMMIT being pushed, never the working tree. Every input file is
// read with `git show <sha>:<path>`, which reads the object database directly — another
// agent's uncommitted edit on disk cannot affect it, because this never opens the file on
// disk at all. Assembled into a throwaway temp directory (never the shared tree) and built
// there with the SAME build.py, extracted from the SAME commit (so a push that also edits
// build.py stays self-consistent). The result is compared, byte for byte, against
// `git show <sha>:dist/index.html` — the dist the commit actually carries.
//
// This is the fourth time the underlying "dist is stale" shape has failed CI (two data
// commits that did not rebuild, one clean-clone build overtaken by later commits, run 66's
// 448b628) and the guard's own first version was a FIFTH instance of the same family — a
// check that reads the wrong input source. Fixed here, and `tests/check_dist_fresh.test.js`
// plants exactly this shape (a commit whose dist does not match its own committed data) so
// this version is never trusted on the strength of code review alone.
//
// Usage:
//   node scripts/check_dist_fresh.js            # run by hand before pushing
//   installed as .git/hooks/pre-push             # automatic — see scripts/install_hooks.js
import { execSync, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Only used to decide WHETHER to bother rebuilding at all — a plain path-name diff between
// two commits, never a read of file CONTENT, so the working tree cannot leak into it.
const BUILD_INPUTS = ['app/template.html', 'app/engine', 'app/vendor', 'data', 'build.py'];

function sh(cmd, cwd = ROOT) {
  return execSync(cmd, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function gitShow(root, sha, relPath) {
  // Buffer, not text: dist/index.html and the YAML sources must compare byte for byte,
  // and decoding+re-encoding could silently normalise a difference away.
  return execFileSync('git', ['show', `${sha}:${relPath}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
}

function pathExistsAt(root, sha, relPath) {
  const r = spawnSync('git', ['cat-file', '-e', `${sha}:${relPath}`], { cwd: root });
  return r.status === 0;
}

/**
 * `gitShow`, but for a path `assembleFromCommit` requires unconditionally (it is not itself
 * discovered from the commit, the way ENGINE_MODULES and the data/mcus/*.yaml list are).
 * An old commit can predate such a file entirely — before this repo had a `app/vendor/`
 * directory, say — and without this check that shows up as `git show`'s raw
 * `fatal: path '...' exists on disk, but not in '<sha>'`, thrown straight out of
 * `execFileSync` with no context about WHICH assembly step failed or why. That is not "this
 * commit is stale," it is "this commit's shape predates what today's assembler expects," a
 * different, honestly-reported problem — so name it here instead of letting git's own wording
 * stand in for ours.
 */
function requireGitShow(root, sha, relPath) {
  if (!pathExistsAt(root, sha, relPath)) {
    throw new Error(`${sha} has no ${relPath} — this commit predates that build input (or it later `
      + `moved/was renamed), so a fresh build of it cannot be assembled; this is not a staleness verdict.`);
  }
  return gitShow(root, sha, relPath);
}

/** Every ref about to be pushed, from the pre-push hook's stdin protocol
 *  (`<local ref> <local sha> <remote ref> <remote sha>`, one line per ref) — the TIP
 *  commit only, because that is the one commit CI will ever actually check out and test
 *  (GitHub runs `ci.yml` once per push, on the push's final commit). Run by hand with no
 *  stdin: just HEAD. */
function pushedTips() {
  let stdinText = '';
  try { if (!process.stdin.isTTY) stdinText = fs.readFileSync(0, 'utf8').trim(); } catch { /* no stdin piped */ }
  if (stdinText) {
    return [...new Set(stdinText.split('\n').filter(Boolean).map(line => line.trim().split(/\s+/)[1]))];
  }
  return [sh('git rev-parse HEAD').trim()];
}

/** Did this push actually change anything dist/index.html is built from? A plain
 *  `git diff --name-only`, comparing two commits already in the object database — never a
 *  read of the working tree, so an unrelated agent's uncommitted edit cannot trip it. */
function touchesBuildInputs(root, sha) {
  try {
    const base = sh(`git rev-parse ${sha}~1`, root).trim();
    const files = sh(`git diff --name-only ${base} ${sha} -- ${BUILD_INPUTS.map(p => `"${p}"`).join(' ')}`, root).trim();
    return files.length > 0;
  } catch {
    return true; // no parent (the repo's first commit) - safer to check than assume clean
  }
}

/** build.py's own ENGINE_MODULES list, read out of the EXTRACTED build.py rather than
 *  duplicated here by hand — so a push that reorders or adds an engine module cannot go
 *  stale against a hardcoded copy in this file. */
function engineModulesFrom(buildPySource) {
  const m = /ENGINE_MODULES\s*=\s*\[([\s\S]*?)\]/.exec(buildPySource.toString('utf8'));
  if (!m) throw new Error('could not find ENGINE_MODULES in the extracted build.py - has its shape changed?');
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map(x => x[1]);
}

/**
 * Assemble exactly what `build.py` reads, AT `sha`, into `tmpDir` — every byte read with
 * `git show sha:path`, never `fs.readFileSync` on the real tree. Returns the path to the
 * `build.py` copy so the caller can run it.
 */
function assembleFromCommit(root, sha, tmpDir) {
  const write = (rel, buf) => {
    const dest = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  };

  const buildPy = requireGitShow(root, sha, 'build.py');
  write('build.py', buildPy);

  write('app/template.html', requireGitShow(root, sha, 'app/template.html'));
  write('app/vendor/js-yaml.js', requireGitShow(root, sha, 'app/vendor/js-yaml.js'));
  for (const mod of engineModulesFrom(buildPy)) {
    write(`app/engine/${mod}`, requireGitShow(root, sha, `app/engine/${mod}`));
  }

  write('data/packages/packages.yaml', requireGitShow(root, sha, 'data/packages/packages.yaml'));
  const mcuFiles = sh(`git ls-tree -r --name-only ${sha} -- data/mcus`, root)
    .trim().split('\n').filter(f => f.endsWith('.yaml'));
  for (const rel of mcuFiles) write(rel, requireGitShow(root, sha, rel));

  return path.join(tmpDir, 'build.py');
}

/**
 * Does `sha`'s own committed `dist/index.html` match a fresh build of `sha`'s own other
 * committed files? Builds in an isolated temp directory; the real working tree is never
 * read or written. Returns `{ fresh, reason }` for the two staleness verdicts (no
 * dist/index.html at all, or one that doesn't match a fresh build); throws — with a message
 * naming the commit and the missing path, never git's raw passthrough — for the two ways
 * this cannot even be attempted: `python build.py` itself failing, or `sha` predating a
 * build input the assembler requires (`requireGitShow`). Both are "not a staleness
 * question," and the caller (`main`, or a direct caller like the test file) must not mistake
 * either for "fresh."
 */
export function checkCommitFresh(root, sha) {
  if (!pathExistsAt(root, sha, 'dist/index.html')) {
    return { fresh: false, reason: `${sha} has no dist/index.html at all` };
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-distcheck-'));
  try {
    const buildPyPath = assembleFromCommit(root, sha, tmpDir);
    const built = spawnSync('python', [buildPyPath], { cwd: tmpDir, encoding: 'utf8' });
    if (built.status !== 0) {
      throw new Error(`python build.py failed against ${sha}'s own committed files (not a staleness question):\n`
        + (built.stdout || '') + (built.stderr || ''));
    }
    const freshBytes = fs.readFileSync(path.join(tmpDir, 'dist', 'index.html'));
    const committedBytes = gitShow(root, sha, 'dist/index.html');
    if (Buffer.compare(freshBytes, committedBytes) !== 0) {
      return {
        fresh: false,
        reason: `${sha}'s committed dist/index.html (${committedBytes.length} bytes) does not match `
          + `a fresh build of ${sha}'s own committed sources (${freshBytes.length} bytes)`,
      };
    }
    return { fresh: true, reason: null };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main() {
  const tips = pushedTips();
  const relevant = tips.filter(sha => touchesBuildInputs(ROOT, sha));
  if (!relevant.length) {
    console.log('check_dist_fresh: nothing being pushed touches ' + BUILD_INPUTS.join(', ') + ' - skipped.');
    return 0;
  }

  let ok = true;
  for (const sha of relevant) {
    console.log(`check_dist_fresh: ${sha} touches a build input - rebuilding from the COMMIT (not the working tree) to check it...`);
    let result;
    try {
      result = checkCommitFresh(ROOT, sha);
    } catch (e) {
      console.error(`check_dist_fresh: ${e.message}`);
      ok = false;
      continue;
    }
    if (!result.fresh) {
      console.error(`\ncheck_dist_fresh: ${sha} is STALE - ${result.reason}.`);
      console.error('  This is the commit as it would be PUSHED, built in isolation - another agent\'s');
      console.error('  uncommitted work on disk cannot hide this and cannot cause a false one either.');
      console.error(`  Fix: on a clean tree at ${sha}, run \`python build.py\`, commit dist/index.html, and push again.\n`);
      ok = false;
    } else {
      console.log(`check_dist_fresh: ${sha} - dist/index.html matches a fresh build of exactly what is committed. OK.`);
    }
  }
  return ok ? 0 : 1;
}

// Only run main() when invoked directly (node scripts/check_dist_fresh.js / the git hook),
// not when imported for its exports by tests/check_dist_fresh.test.js.
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] || '')) {
  process.exit(main());
}
