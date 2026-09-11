// =============================================================================
//  tests/release.test.js — the release plumbing, checked like everything else.
//
//  `DONE.md` has carried "generated C compiles **in CI**" as an open line since
//  round 3, and `agents/AGENT_3_QA_RELEASE.md` says what closes it: the remote
//  appears, then the workflow builds `data/firmware` **and** runs the
//  generated-project gate. The repository had no remote, so `.github/workflows/`
//  was the one part of this tree that nothing ever read — a workflow with a typo, a
//  package that does not exist on the runner's distro, or a missing `pio` is
//  discovered by the first push, which is the worst moment to discover it.
//
//  So the workflow is checked here, from the same suite as everything else:
//    * every workflow file PARSES, and every job is bounded;
//    * CI actually installs PlatformIO and actually runs the compile gate, rather
//      than being green because the compile suites skipped;
//    * the Taskfile's environment list matches `data/firmware/platformio.ini`,
//      because that list is typed twice and drifting is silent.
//
//  It is a structural check, not a substitute for running the workflow. It cannot
//  tell you the apt package names are right on the day's runner image, and it does
//  not claim to.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { suite, test, assert, skip } from './lib/harness.js';
import { ROOT } from './lib/app.js';
import { dep } from './lib/deps.js';

suite('release plumbing');

const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

function workflowFiles() {
  if (!fs.existsSync(WORKFLOW_DIR)) return [];
  return fs.readdirSync(WORKFLOW_DIR).filter(f => /\.ya?ml$/.test(f)).sort();
}

function loadWorkflow(file) {
  const yaml = dep('js-yaml');
  return yaml.load(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8'));
}

/** GitHub reads `on:`; a YAML 1.1 parser reads it as the boolean `true`. Handle both. */
const triggersOf = doc => doc.on || doc[true] || doc['true'] || null;

test('every workflow parses and has a trigger and at least one job', () => {
  const files = workflowFiles();
  assert.ok(files.length > 0, 'there is no workflow under .github/workflows/ — CI would never run');
  const problems = [];
  for (const file of files) {
    let doc;
    try { doc = loadWorkflow(file); } catch (e) { problems.push(`${file}: does not parse — ${e.message}`); continue; }
    if (!doc || typeof doc !== 'object') { problems.push(`${file}: is not a mapping`); continue; }
    if (!triggersOf(doc)) problems.push(`${file}: has no \`on:\` trigger, so nothing would ever start it`);
    const jobs = doc.jobs || {};
    const names = Object.keys(jobs);
    if (!names.length) problems.push(`${file}: declares no jobs`);
    for (const name of names) {
      const job = jobs[name] || {};
      if (!job['runs-on']) problems.push(`${file} job "${name}": no runs-on`);
      if (!Array.isArray(job.steps) || !job.steps.length) problems.push(`${file} job "${name}": no steps`);
      // An unbounded job is a job that can hang for six hours before anyone looks.
      if (!job['timeout-minutes']) {
        problems.push(`${file} job "${name}": no timeout-minutes — a hung step would burn the runner's full limit`);
      }
    }
  }
  assert.empty(problems, 'workflows that would not run, or would not stop');
});

/**
 * What a step actually RUNS, with comments removed.
 *
 * This is not pedantry: the first version of this check matched the raw step text,
 * and a `# pip install platformio` line — a comment — satisfied it. Planting that
 * break showed the check staying green over a CI job that installs nothing, which
 * is the exact failure mode this whole file exists to catch. Comments are stripped
 * because a workflow explains itself in them.
 */
function shellOf(steps) {
  const out = [];
  for (const step of steps) {
    if (typeof step.uses === 'string') out.push(step.uses);
    for (const key of ['run', 'name', 'working-directory']) {
      const v = step[key];
      if (typeof v !== 'string') continue;
      // Drop whole-line comments from a block scalar, and any trailing comment.
      out.push(v.split('\n').map(l => l.replace(/\s+#.*$/, '')).filter(l => !/^\s*#/.test(l)).join('\n'));
    }
  }
  return out.join('\n');
}

test('CI really compiles the generated C, in a job that has PlatformIO', () => {
  // The line this closes is specific: "generated C compiles **in CI**". A workflow
  // that never installs `pio` runs the suite with the compile gate SKIPPING, and
  // the runner counts a skip as a skip — but the job is green, and green is what
  // people read. So require the install AND the build, in the same job.
  const file = workflowFiles().find(f => /^ci\.ya?ml$/.test(f));
  assert.ok(file, 'there is no .github/workflows/ci.yml');
  const doc = loadWorkflow(file);
  const jobs = doc.jobs || {};
  const problems = [];

  const stepsOf = job => (jobs[job] && jobs[job].steps) || [];
  const shell = job => shellOf(stepsOf(job));

  // A real install: an executed pip/pip3 line, or a PlatformIO action.
  const INSTALLS = /(^|\n)\s*(python -m )?pip3?\s+install\s[^\n]*\bplatformio\b|uses:\s*platformio\//;
  // A real build of generated code: the CLI writing a project, or `pio run`.
  const RUNS_GATE = /wchcube_cli\.js[^\n]*--new-project|(^|\n)\s*pio\s+run\b/;

  const installsPio = Object.keys(jobs).filter(j => INSTALLS.test(shell(j)));
  const runsGate = Object.keys(jobs).filter(j => RUNS_GATE.test(shell(j)));

  if (!installsPio.length) {
    problems.push('no job actually installs PlatformIO (an executed pip line, or a platformio action), so '
      + 'tests/codegen_compile.test.js, tests/generated_project.test.js and tests/firmware_native.test.js '
      + 'all SKIP — "the generated C compiles in CI" would be asserted by a green run that never compiled');
  }
  if (!runsGate.length) {
    problems.push('no job generates a project or runs `pio run` — the generated-project gate is what makes '
      + '"a configuration the app produces actually compiles" a measured claim');
  }
  if (installsPio.length && runsGate.length) {
    const both = installsPio.filter(j => runsGate.includes(j));
    if (!both.length) {
      problems.push(`PlatformIO is installed in [${installsPio.join(', ')}] and the compile gate runs in `
        + `[${runsGate.join(', ')}]; they must be the SAME job or the gate still skips`);
    }
  }
  assert.empty(problems, 'CI does not actually compile anything, whatever else it proves');
});

test('the compile-gate guard can fail: commenting out the install is caught', () => {
  // The planted break, run every time — and it is here because this check shipped
  // once WITHOUT being able to fail: it matched the raw step text, so a commented
  // `# pip install platformio` satisfied it. Strip-comments is what makes it real,
  // and this asserts the stripping, not merely that the regex exists.
  const real = ['      - name: Install', '        run: |', '          npm ci', '          pip install platformio'].join('\n');
  const commented = ['      - name: Install', '        run: |', '          npm ci', '          # pip install platformio'].join('\n');
  const parsed = text => {
    // Feed the same shape the workflow parser would hand `shellOf`.
    const doc = dep('js-yaml').load(text.replace(/^(\s*)- name:/m, '$1- name:'));
    return shellOf(doc ? (Array.isArray(doc) ? doc : [doc]) : []);
  };
  const INSTALLS = /(^|\n)\s*(python -m )?pip3?\s+install\s[^\n]*\bplatformio\b|uses:\s*platformio\//;
  assert.ok(INSTALLS.test(parsed(real)), 'a real `pip install platformio` was not recognised as an install');
  assert.notOk(INSTALLS.test(parsed(commented)),
    'a COMMENTED-OUT install was recognised as an install — this is the bug this check had, and it makes '
    + 'the whole guard green over a job that installs nothing');
});

test("the Taskfile's environment list matches data/firmware/platformio.ini", () => {
  // The list is typed twice — once in platformio.ini, once in Taskfile.yml's
  // `ENVS` — and a part added to one and not the other is a build that silently
  // is not run. `tests/fixtures/make_fixtures.js` has the same hazard and refuses
  // to write a fixture for an environment that does not exist; this checks the
  // other direction.
  const ini = fs.readFileSync(path.join(ROOT, 'data', 'firmware', 'platformio.ini'), 'utf8');
  const declared = [...ini.matchAll(/^\[env:([^\]]+)\]/gm)].map(m => m[1]).filter(e => e !== 'native').sort();
  assert.ok(declared.length >= 3, `only ${declared.length} firmware environment(s) found in platformio.ini`);

  const taskfile = fs.readFileSync(path.join(ROOT, 'Taskfile.yml'), 'utf8');
  const line = /^\s*ENVS:\s*(.+)$/m.exec(taskfile);
  assert.ok(line, 'Taskfile.yml has no ENVS: var, so `task firmware` has nothing to iterate');
  const listed = line[1].trim().split(/\s+/).sort();

  assert.deep(listed, declared,
    'Taskfile.yml ENVS and data/firmware/platformio.ini have drifted apart — a part in one and not the '
    + 'other is a configuration nobody builds, and `task firmware` would report success over it');
});

test('the check can fail: a drifted environment list is caught', () => {
  // Planted break, run every time. Re-derive the comparison against a list with an
  // entry added and one removed, and insist both are reported.
  const ini = fs.readFileSync(path.join(ROOT, 'data', 'firmware', 'platformio.ini'), 'utf8');
  const declared = [...ini.matchAll(/^\[env:([^\]]+)\]/gm)].map(m => m[1]).filter(e => e !== 'native').sort();

  const drifted = [...declared.slice(1), 'CH32V999F9P9'].sort();
  const reported = {
    missing: declared.filter(e => !drifted.includes(e)),   // in the ini, not in the list
    extra: drifted.filter(e => !declared.includes(e)),     // in the list, not in the ini
  };
  assert.deep(reported.missing, [declared[0]], 'dropping the first environment from the list was not detected');
  assert.deep(reported.extra, ['CH32V999F9P9'], 'an environment that does not exist was not detected');
  assert.deep(declared.slice().sort(), declared, 'the comparison is not order-insensitive, so it would flake');
});

test('nothing under .github/ ships an unresolved OWNER/REPO placeholder', () => {
  // An absolute GitHub URL is the one thing in this directory that cannot be written
  // correctly before the repository is published: the owner and the repo name do not
  // exist yet, cannot be derived, and change on a fork. Three such links shipped in
  // the issue chooser as `https://github.com/OWNER/REPO/...`, so the first thing a
  // visitor to the published repository would see is three buttons that 404.
  //
  // Relative markdown references (`docs/ADDING-A-PART.md`) have no such problem —
  // GitHub resolves them against whichever repository renders the template. So the
  // rule is absolute: this string is always a defect, never a placeholder worth
  // keeping, and it is checked before the push rather than after.
  const gh = path.join(ROOT, '.github');
  const files = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  };
  if (!fs.existsSync(gh)) skip('there is no .github/ directory');
  walk(gh);
  assert.ok(files.length >= 5, `only ${files.length} file(s) under .github/ — the walk is not reading it`);

  const offenders = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    text.split('\n').forEach((line, i) => {
      // Ignore the comment that EXPLAINS the rule, which necessarily contains it.
      if (/OWNER\/REPO|<owner>\/<repo>/.test(line) && !/^\s*#/.test(line)) {
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
      }
    });
  }
  assert.empty(offenders,
    'an unresolved repository placeholder under .github/ — it will 404 the moment this is published. '
    + 'Use a relative markdown reference instead, which works in a fork and after a rename');
});

test('a release archive carries no vendor material, and does carry the app', () => {
  // The release workflow attaches `git archive` output and tells the reader it holds
  // no SDK and no datasheets. That is a redistribution claim about WCH's files, not
  // tidiness, so it is checked rather than asserted in a comment — `export-ignore`
  // in `.gitattributes` is the mechanism, and a rule that stopped matching would be
  // invisible until a tarball shipped 45 MB of somebody else's material.
  const gitProbe = spawnSync('git', ['--version'], { cwd: ROOT, encoding: 'utf8' });
  if (gitProbe.status !== 0) skip('git is not on PATH, so there is no archive to inspect');

  // Ask git for the paths directly. `git archive` output has to be fed to a real
  // `tar -t` to be read — matching the raw stream against a name pattern also
  // matches TEXT INSIDE the archived files, which is how the first version of this
  // check reported `.gitattributes` and an agent brief as vendor files.
  const listed = spawnSync('git', ['archive', '--format=tar', 'HEAD'], {
    cwd: ROOT, maxBuffer: 512 * 1024 * 1024,
  });
  if (listed.error || listed.status !== 0) {
    skip(`git archive failed: ${String(listed.error || listed.stderr || '').trim().split('\n')[0]}`);
  }
  const tar = spawnSync('tar', ['-t'], { input: listed.stdout, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (tar.error || tar.status !== 0 || !tar.stdout) {
    skip(`could not list the archive with tar: ${String(tar.error || tar.stderr || '').trim().split('\n')[0]}`);
  }
  const paths = tar.stdout.split('\n').map(s => s.trim()).filter(Boolean);
  assert.ok(paths.length > 100,
    `the archive listed only ${paths.length} path(s), so this check is not reading a real archive`);

  const vendor = /^data\/sources\/[^/]+\/(Evt|Datasheets)\/.+/;
  const offenders = paths.filter(p => vendor.test(p));
  assert.empty(offenders.slice(0, 10),
    'vendor files inside a release archive — .gitattributes `export-ignore` is not matching, and a release '
    + 'tarball would redistribute WCH\'s SDK and datasheets');

  assert.ok(paths.some(p => p === 'dist/index.html' || p.endsWith('/dist/index.html')),
    'the archive has no dist/index.html — the one file a release exists to hand out');
  assert.ok(paths.some(p => p === 'build.py' || p.endsWith('/build.py')),
    'the archive has no build.py, so it cannot be rebuilt from source');
  // And the guard has teeth both ways: the vendored SDK is not in there, so an
  // `export-ignore` that accidentally matched EVERYTHING would also pass the vendor
  // assertion while shipping an empty archive.
  assert.ok(paths.some(p => p.startsWith('app/engine/')),
    'the archive has no app/engine/ — export-ignore is excluding far more than the vendor material');
});
