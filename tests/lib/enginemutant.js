// tests/lib/enginemutant.js — plant a break app/tests/**'s own suite must catch, without
// ever writing app/engine/** (AGENT-2 is editing it right now) or dist/index.html (nobody
// may hand-edit it, and it is shared).
//
// Why this is NOT tests/lib/mutant.js's junction trick applied to app/tests/: Node's ESM
// loader realpaths every module it loads by default. Measured before writing a line of the
// working version of this file (tests/evidence/round6/2026-09-13-app-tests-planted-breaks.md):
// a file reached through a Windows junction reports its REAL path as import.meta.url, so ITS
// OWN relative imports resolve against the REAL tree. A junctioned app/tests/_harness.js
// would import the REAL, unmutated app/engine/index.js regardless of what sits at the
// junction target — this file would have been a no-op mutator that still prints green, which
// is exactly the failure mode round 6 exists to catch.
//
// So: every module whose relative imports must reach a mutated file is a REAL file physically
// under the temp root (fs.cpSync / fs.copyFileSync, never a symlink). Everything else — data
// reads, fixtures, leaf modules that need not see the mutation — is a junction, which IS
// transparent to a plain fs.readFileSync or file open (confirmed by the same experiment: only
// module RESOLUTION realpaths, not an ordinary read through a reparse point).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
const RUNNER = path.join(HERE, 'enginemutant_run.js');

function junction(real, link) {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(real, link, 'junction');
}

function realCopyFile(srcAbs, dstAbs, transform) {
  fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
  const text = transform ? transform(fs.readFileSync(srcAbs, 'utf8')) : null;
  if (text !== null) fs.writeFileSync(dstAbs, text);
  else fs.copyFileSync(srcAbs, dstAbs);
}

/** Assert `mutate(text)` actually changes `text` — an anchor that has moved plants nothing. */
function mustChange(label, text, mutate) {
  const mut = mutate(text);
  if (mut === text) {
    throw new Error(`${label}: the mutation left the text unchanged — its anchor has moved, so this break now plants nothing`);
  }
  return mut;
}

/** Number of times `needle` occurs in `text`. The P1 finding this whole file exists to not
 *  repeat: an anchor that is not exactly-once may mutate something unrelated and leave the
 *  real target untouched while still reporting a changed string. */
export function occurrences(text, needle) {
  return needle ? text.split(needle).length - 1 : 0;
}

function cleanupRoot(root, junctionLinks) {
  // Junctions first, and ONLY rmdirSync (non-recursive) on each: that removes just the
  // reparse point on Windows and never recurses into — or deletes — what it points at.
  for (const link of junctionLinks) { try { fs.rmdirSync(link); } catch { /* already gone */ } }
  // Only real, owned files remain under root now — safe to delete recursively.
  fs.rmSync(root, { recursive: true, force: true });
}

/**
 * A mutated, REAL, recursive copy of app/engine/ (one file changed) plus everything an
 * app/tests/*.test.js file needs to run against it under tests/lib/enginemutant_run.js:
 * junctions for data/, tests/ (fixtures + the QA lib) and app/vendor/ (plain reads, or leaf
 * modules that never need to see the mutation), real copies of app/tests/_harness.js and the
 * target test file (their relative imports must land on the mutated engine copy), and —
 * when `cli: true` — a real copy of tools/wchcube_cli.js for cli.test.js, whose spawned
 * subprocess reads app/engine off disk exactly the same way.
 *
 * Returns { root, testFilePath, cleanup() }.
 */
export function withMutantEngine(engineRelFile, mutate, { testFile, cli = false } = {}) {
  const realEngineFile = path.join(ROOT, 'app', 'engine', engineRelFile);
  const src = fs.readFileSync(realEngineFile, 'utf8');
  const mut = mustChange(`withMutantEngine(${engineRelFile})`, src, mutate);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-appmutant-'));
  const junctionLinks = [];
  const mkJunction = (from, to) => { const link = path.join(root, to); junction(from, link); junctionLinks.push(link); };

  mkJunction(path.join(ROOT, 'data'), 'data');
  mkJunction(path.join(ROOT, 'tests'), 'tests');
  mkJunction(path.join(ROOT, 'app', 'vendor'), path.join('app', 'vendor'));

  fs.cpSync(path.join(ROOT, 'app', 'engine'), path.join(root, 'app', 'engine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app', 'engine', engineRelFile), mut);

  realCopyFile(path.join(ROOT, 'app', 'tests', '_harness.js'), path.join(root, 'app', 'tests', '_harness.js'));
  let testFilePath = null;
  if (testFile) {
    testFilePath = path.join(root, 'app', 'tests', testFile);
    realCopyFile(path.join(ROOT, 'app', 'tests', testFile), testFilePath);
  }
  if (cli) realCopyFile(path.join(ROOT, 'tools', 'wchcube_cli.js'), path.join(root, 'tools', 'wchcube_cli.js'));

  return { root, testFilePath, cleanup: () => cleanupRoot(root, junctionLinks) };
}

/**
 * The DIST-based shape: app/tests files that read dist/index.html through `boot()`
 * (tests/lib/app.js) or a real browser (tests/lib/browser.js) — a mutated COPY of app/engine
 * is invisible to them because dist/index.html is a static bundle, not a live import. Here
 * the file that must be REAL (so its relative reads land on the mutated HTML) is whichever
 * of app.js / browser.js the target test file uses; `libs` says which, e.g. { app: true } or
 * { browser: true, harness: true }.
 */
export function withMutantDist(mutateHtml, { testFile, libs }) {
  const distFile = path.join(ROOT, 'dist', 'index.html');
  const html = fs.readFileSync(distFile, 'utf8');
  const mutHtml = mustChange('withMutantDist', html, mutateHtml);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-distmutant-'));
  const junctionLinks = [];
  const mkJunction = (from, to) => { const link = path.join(root, to); junction(from, link); junctionLinks.push(link); };

  mkJunction(path.join(ROOT, 'data'), 'data');
  mkJunction(path.join(ROOT, 'app', 'engine'), path.join('app', 'engine'));   // unmutated; _harness.js just needs it to load
  mkJunction(path.join(ROOT, 'app', 'vendor'), path.join('app', 'vendor'));
  mkJunction(path.join(ROOT, 'tests', 'fixtures'), path.join('tests', 'fixtures'));

  const mutDist = path.join(root, 'mutant.html');
  fs.writeFileSync(mutDist, mutHtml);

  realCopyFile(path.join(ROOT, 'app', 'tests', '_harness.js'), path.join(root, 'app', 'tests', '_harness.js'));
  const testFilePath = path.join(root, 'app', 'tests', testFile);
  realCopyFile(path.join(ROOT, 'app', 'tests', testFile), testFilePath);

  // tests/lib/deps.js has no relative imports of its own (falls back to %LOCALAPPDATA%\wchcube-deps
  // regardless of where ROOT computes to), so a plain copy is always safe when app.js is needed.
  if (libs.app) {
    realCopyFile(path.join(ROOT, 'tests', 'lib', 'deps.js'), path.join(root, 'tests', 'lib', 'deps.js'));
    realCopyFile(path.join(ROOT, 'tests', 'lib', 'app.js'), path.join(root, 'tests', 'lib', 'app.js'),
      text => mustChange('withMutantDist(app.js DIST patch)', text,
        t => t.replace(
          "export const DIST = path.join(ROOT, 'dist', 'index.html');",
          `export const DIST = ${JSON.stringify(mutDist)};`)));
  }
  if (libs.browser) {
    realCopyFile(path.join(ROOT, 'tests', 'lib', 'browser.js'), path.join(root, 'tests', 'lib', 'browser.js'),
      text => mustChange('withMutantDist(browser.js DIST patch)', text,
        t => t.replace(
          "export const DIST = path.join(ROOT, 'dist', 'index.html');",
          `export const DIST = ${JSON.stringify(mutDist)};`)));
  }
  if (libs.harness) {
    realCopyFile(path.join(ROOT, 'tests', 'lib', 'harness.js'), path.join(root, 'tests', 'lib', 'harness.js'));
  }

  return { root, testFilePath, cleanup: () => cleanupRoot(root, junctionLinks) };
}

/**
 * Run ONE app/tests/*.test.js file's own registered tests in a fresh child process, against
 * whatever `root` set up. Returns { code, pass, fail, results, loadError, stdout, stderr }.
 */
export function runMutantTestFile(testFilePath, { timeoutMs = 60000, env } = {}) {
  const r = spawnSync(process.execPath, [RUNNER, testFilePath], {
    encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, ...env },
  });
  let parsed = null;
  if (r.stdout) {
    const line = r.stdout.trim().split('\n').filter(Boolean).pop();
    try { parsed = JSON.parse(line); } catch { /* runner crashed before printing JSON */ }
  }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error, ...(parsed || {}) };
}
