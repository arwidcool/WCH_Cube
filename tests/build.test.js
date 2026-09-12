// Release QA: what build.py produces must be one self-contained file that opens
// from the filesystem with no server and no network, and it must match the sources.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { suite, test, assert } from './lib/harness.js';
import { ROOT, DIST } from './lib/app.js';

suite('build');

const dist = () => fs.readFileSync(DIST, 'utf8');

test('dist/index.html exists and is a complete document', () => {
  assert.ok(fs.existsSync(DIST), 'dist/index.html is missing - run "python build.py"');
  const html = dist();
  assert.match(html, /^<!DOCTYPE html>/i, 'should start with a doctype');
  assert.includes(html, '</html>', 'should be a complete document');
  assert.ok(html.length > 50_000, `suspiciously small (${html.length} bytes) - did the build inline the data?`);
});

test('no build placeholder is left unexpanded', () => {
  const left = (dist().match(/<!--@@[A-Z]+@@-->/g) || []);
  assert.empty(left, 'placeholders build.py did not replace');
});

test('the app is offline: no external scripts, styles, fonts or images', () => {
  const html = dist();
  const offenders = [];
  const attr = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = attr.exec(html))) {
    const url = m[1].trim();
    if (/^(https?:)?\/\//i.test(url)) offenders.push(url);
  }
  // @import and url() in CSS would fetch too
  for (const re of [/@import\s+(?:url\()?["']?(https?:)?\/\//gi, /url\(\s*["']?(?:https?:)?\/\//gi]) {
    if (re.test(html)) offenders.push('a CSS rule fetches from the network');
  }
  assert.empty(offenders, 'dist/index.html reaches out to the network; it must run from a file:// URL and inside Tauri');
});

test('js-yaml is bundled, not fetched', () => {
  const html = dist();
  assert.notOk(/cdnjs|unpkg|jsdelivr/i.test(html), 'a CDN reference is still in the built file');
  assert.ok(/jsyaml/.test(html), 'the js-yaml global is not present in the bundle');
});

test('every data file is inlined and parses', () => {
  const html = dist();
  const missing = [];
  const dataFiles = [
    path.join('data', 'packages', 'packages.yaml'),
    ...fs.readdirSync(path.join(ROOT, 'data', 'mcus'))
      .filter(f => f.endsWith('.yaml'))
      .map(f => path.join('data', 'mcus', f)),
  ];
  for (const rel of dataFiles) {
    const tag = `data-file="${rel.replace(/\\/g, '/')}"`;
    if (!html.includes(tag)) missing.push(rel);
  }
  assert.empty(missing, 'data files that build.py did not inline');
});

/** Fingerprint everything build.py reads, so we can tell if the tree moved under us. */
function sourceStamp() {
  const files = [path.join(ROOT, 'app', 'template.html')];
  for (const dir of [['app', 'engine'], ['app', 'vendor'], ['data', 'mcus'], ['data', 'packages']]) {
    const d = path.join(ROOT, ...dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) files.push(path.join(d, f));
  }
  return files.sort().map(f => {
    try { const st = fs.statSync(f); return `${f}:${st.size}:${st.mtimeMs}`; } catch { return `${f}:gone`; }
  }).join('|');
}

test('dist/index.html carries no CRLF, so it builds the same bytes on every OS', () => {
  // THE DEFECT THIS EXISTS FOR, measured on the CI runner rather than reasoned about:
  // `build.py` wrote dist with `write_text(tpl, encoding="utf-8")`, which uses the
  // PLATFORM DEFAULT line ending. Windows produced CRLF, Linux produced LF, and the same
  // source therefore produced two different files. The "dist/index.html is up to date"
  // step in `ci.yml` exists to catch a stale build; it failed on a build that was
  // perfectly current, because `git diff` was comparing 19 270 line endings rather than
  // content - and it failed identically on two consecutive CI runs while passing on every
  // developer box, which reads exactly like a broken workflow.
  //
  // `.gitattributes` deliberately sets no `* text=auto` and renormalises nothing (it says
  // so, at length), so nothing else can fix this: the generator has to choose the line
  // ending instead of inheriting one from whichever OS ran it. A committed dist with any
  // CRLF at all is a dist that cannot round-trip through `python build.py` on Linux.
  const html = fs.readFileSync(DIST);
  const crlf = (html.toString('latin1').match(/\r\n/g) || []).length;
  assert.equal(crlf, 0,
    `dist/index.html contains ${crlf} CRLF(s). build.py must write with newline="\\n" so `
    + 'the committed file is byte-identical on Windows and Linux — a CRLF dist makes the '
    + 'CI "dist is up to date" check fail on a current build, in both directions');

  // And the generator really does ask for LF, not merely happen to produce it here.
  const py = fs.readFileSync(path.join(ROOT, 'build.py'), 'utf8');
  assert.match(py, /write_text\([^)]*newline=["']\\n["']/,
    'build.py no longer passes newline="\\n" to write_text — the dist line ending is back '
    + 'under the control of whichever OS runs the build');
});

test('dist/index.html is not stale', () => {
  // Rebuild and compare: a difference means someone changed app/ or data/ and shipped
  // the old build - or hand-edited dist itself.
  //
  // Four agents write this tree at once, so a source file changing WHILE the test runs
  // looks exactly like a stale dist. Detect that and say so instead of failing the
  // build on somebody else's half-finished edit.
  const runBuild = () => {
    for (const exe of ['python', 'python3']) {
      const res = spawnSync(exe, [path.join(ROOT, 'build.py')], { cwd: ROOT, encoding: 'utf8' });
      if (!res.error) return res;
    }
    return null;
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const stamp = sourceStamp();
    const before = dist();
    const ran = runBuild();
    if (!ran) { console.log('        (skipped: no python interpreter on PATH)'); return; }
    assert.equal(ran.status, 0, 'build.py failed:\n' + (ran.stdout || '') + (ran.stderr || ''));
    const after = dist();

    if (after === before) return;                 // dist was up to date
    if (sourceStamp() !== stamp) continue;        // another agent edited mid-run: retry

    assert.ok(false,
      'dist/index.html was out of date with app/ and data/ (it has now been rebuilt).\n' +
      '    Run "python build.py" before committing; never hand-edit dist/index.html.');
  }
  console.log('        (inconclusive: app/ or data/ kept changing while the build ran)');
});

/**
 * build.py concatenates app/engine/*.js and the app script into ONE classic script
 * scope. Two files declaring the same top-level name is then a SyntaxError that kills
 * the whole app - and the only symptom is a blank page. Name the clash instead.
 */
test('no identifier is declared twice in the bundled scripts', () => {
  const html = dist();
  const scripts = [...html.matchAll(/<script(?![^>]*text\/x-yaml)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const seen = new Map();       // name -> [contexts]
  const clashes = [];

  for (const src of scripts) {
    if (src.length < 200) continue;                      // inline one-liners, not the bundle
    let where = 'app script';
    for (const line of src.split('\n')) {
      const marker = line.match(/^\/\/ =====\s+([^\s=]\S*)/);  // build.py's per-module banner
      if (marker) { where = marker[1]; continue; }
      // top-level declarations sit at column 0 in every file here
      const m = line.match(/^(?:export\s+)?(?:async\s+)?(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/);
      if (!m) continue;
      const [, kind, name] = m;
      if (seen.has(name)) {
        const first = seen.get(name);
        // var and function may legally repeat; const/let/class cannot
        if (kind !== 'var' && !(kind === 'function' && first.kind === 'function')) {
          clashes.push(`${name}: ${kind} here in ${where}, already declared as ${first.kind} in ${first.where}`);
        }
      } else {
        seen.set(name, { kind, where });
      }
    }
  }
  assert.empty(clashes, 'the same name is declared twice in one script scope - the app will not start');
});
