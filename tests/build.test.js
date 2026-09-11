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

test('dist/index.html is not stale', () => {
  // Rebuild into a scratch copy and compare. A stale dist means someone edited the
  // template (or the data) and shipped the old build - or hand-edited dist itself.
  const before = dist();
  let ran = null;
  for (const exe of ['python', 'python3']) {
    const res = spawnSync(exe, [path.join(ROOT, 'build.py')], { cwd: ROOT, encoding: 'utf8' });
    if (!res.error) { ran = res; break; }
  }
  if (!ran) { console.log('        (skipped: no python interpreter on PATH)'); return; }
  assert.equal(ran.status, 0, 'build.py failed:\n' + (ran.stdout || '') + (ran.stderr || ''));
  const after = dist();
  assert.equal(after === before, true,
    'dist/index.html was out of date with app/ and data/ (it has now been rebuilt).\n' +
    '    Run "python build.py" before committing; never hand-edit dist/index.html.');
});
