// =============================================================================
//  tools/cross_loader_check.mjs — the DATA<->APP contract, checked where it actually
//  lives: two different YAML PARSERS, not two different readings of the same one.
//
//  Every Python gate in this repository (`validate_mcu.py`, `coverage.py`,
//  `verify_sdk_names.py`, every `*_selftest.py`) reads `data/mcus/*.yaml` and
//  `data/packages/packages.yaml` with `yaml.safe_load` — PyYAML, which has never
//  implemented anything past YAML 1.1. The app that ships reads the SAME bytes
//  (`build.py` embeds them verbatim into `dist/index.html`, see `yaml_block()`) with the
//  vendored `js-yaml`'s default schema — YAML 1.2. The two schemas do not agree on what
//  counts as a boolean: 1.1 auto-resolves `On`/`Off`/`Yes`/`No`/`y`/`n` (and a bare
//  `HH:MM` scalar as a sexagesimal NUMBER) that 1.2 leaves as plain strings. A file every
//  Python gate calls clean can be silently WRONG in the one place a user's browser reads
//  it, and until this file, nothing checked that — one layer below where anyone had
//  looked (AGENT-1 found and reproduced it on OPA's `fb`/`pgadif`/`hs` rows, which
//  happen to work today only because both parsers currently agree on THAT peripheral's
//  particular option names).
//
//  METHOD: parse the same file with both loaders, tag every scalar with the CATEGORY the
//  app's own JS runtime would see it as (null/bool/number/string/date/array/object —
//  `typeof` has no int-vs-float distinction and neither does this check), and diff the
//  two tagged trees structurally. No On/Off special-casing anywhere below: whatever
//  differs, differs, and is reported by exact path with both actual values.
//
//  A file the JS loader REFUSES outright is a hard, named failure — not a skip, not
//  silently absent from the report. Round 5 shipped three green Python gates over a file
//  `js-yaml` rejected outright (`STATUS.md`'s own round-6 preamble); this is the direct
//  descendant of that lesson, and this file repeats the mistake it exists to catch if it
//  ever treats "the other loader threw" as anything but a defect.
//
//  Two ways to run this:
//    node tools/cross_loader_check.mjs                 — the tool AGENT-1 can run by hand
//    import { runCheck } from './cross_loader_check.mjs'  — what tests/cross_loader.test.js
//                                                            calls for the CI gate
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** `python` on Windows, `python3` elsewhere. Try both, report which failed — the same
 *  shape `tests/coverage.test.js`'s `runPy()` uses, so a missing interpreter reads the
 *  same way across every gate in this repo. */
export function runPy(root, args) {
  const tried = [];
  for (const exe of ['python', 'python3']) {
    tried.push(exe);
    const res = spawnSync(exe, [path.join(root, 'tools', 'cross_loader_dump.py'), ...args],
      { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    if (!res.error) return { ...res, exe };
  }
  return { missing: true, tried };
}

/** The default file set: exactly what `build.py`'s `yaml_block()` embeds into
 *  `dist/index.html` — the real DATA<->APP boundary, not "every yaml file under data/"
 *  (most of `data/` is vendored third-party source trees — under `data/firmware/.pio`
 *  and `data/sources/.../Evt` — that neither loader is ever asked to parse for this
 *  product; including them would be noise, not signal). */
export function defaultFiles(root) {
  const out = [path.join(root, 'data', 'packages', 'packages.yaml')];
  const mcuDir = path.join(root, 'data', 'mcus');
  for (const f of fs.readdirSync(mcuDir).filter(n => n.endsWith('.yaml')).sort()) {
    out.push(path.join(mcuDir, f));
  }
  return out;
}

// ---- JS-side tagging, mirroring tools/cross_loader_dump.py's tag() exactly ---------

function loadJsYaml(root) {
  const src = fs.readFileSync(path.join(root, 'app', 'vendor', 'js-yaml.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
}

function tagJs(v) {
  if (v === null || v === undefined) return ['null', null];
  if (typeof v === 'boolean') return ['bool', v];
  if (typeof v === 'number') return ['number', Number.isNaN(v) ? 'NaN' : v];
  if (typeof v === 'string') return ['string', v];
  if (v instanceof Date) {
    const iso = v.toISOString();
    // js-yaml's timestamp resolver gives a Date even for a date-only scalar (midnight
    // UTC) — normalise to a bare date the same way Python's `date.isoformat()` would,
    // so a genuine date-vs-date agreement is not reported as a false difference.
    return ['date', iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso];
  }
  if (Array.isArray(v)) return ['array', v.map(tagJs)];
  if (typeof v === 'object') return ['object', Object.entries(v).map(([k, val]) => [tagJs(k), tagJs(val)])];
  return ['UNHANDLED_JS_TYPE:' + typeof v, String(v)];
}

// ---- structural diff over two tagged trees ------------------------------------------

const describe = ([cat, val]) => `${cat} ${JSON.stringify(val)}`;

/** The identity used to align two "object" node's [tagKey, tagVal] pairs — VALUE rather
 *  than position, since position alone would misreport a reordered-but-equal mapping as
 *  N differences. This is deliberately the key's JS-RUNTIME STRING FORM, not its tagged
 *  category+value: a JS object key is ALWAYS a string — that is a property of the
 *  JavaScript language, not a parser choice, so `packages.QFN68`'s `0: VSS` reads as
 *  Python dict key `int 0` and JS object key `"0"` on every part in this repo, and that
 *  is not a case where the two loaders disagree about what the YAML MEANS (both agree
 *  it is the plain scalar `0`) — it is a case where one host language can keep the type
 *  and the other cannot. Flagging it would be noise dressed as a finding. What this
 *  check exists to catch is a case where the two loaders resolve the SAME key text to
 *  DIFFERENT js-runtime string forms — `On:` reads as Python bool key `True`
 *  (`jsKeyForm` -> `"true"`) but as JS string key `"On"` (`jsKeyForm` -> `"On"`) — and
 *  aligning on this form catches exactly that, while leaving `0`/`"0"` alone. VALUES
 *  (the other half of every pair) are never put through this — a value keeps its full
 *  tagged category, because a value in the app can be any JS type, not only a string,
 *  and that is exactly where a real On/Off-shaped bug lives. */
function jsKeyForm([cat, val]) {
  switch (cat) {
    case 'string': return val;
    case 'number': return String(val);
    case 'bool': return val ? 'true' : 'false';
    case 'null': return 'null';
    default: return JSON.stringify(val);
  }
}

function diffTagged(py, js, at, out) {
  if (!py || !js) { out.push({ path: at, py: py ? describe(py) : '<absent>', js: js ? describe(js) : '<absent>' }); return; }
  const [pCat, pVal] = py, [jCat, jVal] = js;
  if (pCat !== jCat) { out.push({ path: at, py: describe(py), js: describe(js) }); return; }
  switch (pCat) {
    case 'array': {
      const len = Math.max(pVal.length, jVal.length);
      for (let i = 0; i < len; i++) {
        if (i >= pVal.length) out.push({ path: `${at}[${i}]`, py: '<missing>', js: describe(jVal[i]) });
        else if (i >= jVal.length) out.push({ path: `${at}[${i}]`, py: describe(pVal[i]), js: '<missing>' });
        else diffTagged(pVal[i], jVal[i], `${at}[${i}]`, out);
      }
      return;
    }
    case 'object': {
      const pMap = new Map(pVal.map(([k, v]) => [jsKeyForm(k), v]));
      const jMap = new Map(jVal.map(([k, v]) => [jsKeyForm(k), v]));
      const label = id => /^[A-Za-z_][A-Za-z0-9_]*$/.test(id) ? `.${id}` : `[${JSON.stringify(id)}]`;
      for (const [id, v] of pMap) {
        if (!jMap.has(id)) out.push({ path: `${at}${label(id)}`, py: describe(v), js: '<key absent under js-yaml>' });
        else diffTagged(v, jMap.get(id), `${at}${label(id)}`, out);
      }
      for (const [id, v] of jMap) {
        if (!pMap.has(id)) out.push({ path: `${at}${label(id)}`, py: '<key absent under yaml.safe_load>', js: describe(v) });
      }
      return;
    }
    case 'number': {
      const pn = pVal === 'NaN' ? NaN : pVal, jn = jVal === 'NaN' ? NaN : jVal;
      if (Number.isNaN(pn) && Number.isNaN(jn)) return;
      if (pn !== jn) out.push({ path: at, py: describe(py), js: describe(js) });
      return;
    }
    case 'date': {
      if (String(pVal).slice(0, 10) !== String(jVal).slice(0, 10)) out.push({ path: at, py: describe(py), js: describe(js) });
      return;
    }
    default: // 'bool' | 'string' | 'null' | any UNHANDLED_* tag
      if (pVal !== jVal) out.push({ path: at, py: describe(py), js: describe(js) });
  }
}

/**
 * Run the cross-loader check over `files` (absolute paths; defaults to
 * `defaultFiles(root)`). Returns `{ results: [{ file, relPath, ok, error?, diffs? }] }`
 * — `ok: false` covers BOTH a loader refusing the file AND the two trees disagreeing;
 * they are distinguished by whether `error` or `diffs` is populated, but neither is ever
 * silently downgraded to a skip.
 */
export function runCheck(root, files) {
  files = files || defaultFiles(root);
  const jsyaml = loadJsYaml(root);
  const py = runPy(root, files);
  if (py.missing) return { missing: `no python interpreter on PATH (tried: ${py.tried.join(', ')})` };
  let pyOut;
  try { pyOut = JSON.parse(py.stdout); }
  catch { return { missing: `cross_loader_dump.py did not print JSON: ${(py.stdout || '') + (py.stderr || '')}` }; }
  if (pyOut.__fatal__) return { missing: pyOut.__fatal__ };

  const results = [];
  for (const file of files) {
    const relPath = path.relative(root, file);
    const pyEntry = pyOut[file];
    if (!pyEntry) { results.push({ file, relPath, ok: false, error: 'python side produced no entry for this file (spawn/argv mismatch)' }); continue; }
    if (!pyEntry.ok) { results.push({ file, relPath, ok: false, error: `yaml.safe_load (Python): ${pyEntry.error}` }); continue; }

    let jsTree;
    try {
      const text = fs.readFileSync(file, 'utf8');
      jsTree = tagJs(jsyaml.load(text));
    } catch (e) {
      results.push({ file, relPath, ok: false, error: `js-yaml .load() (JS): ${e.message}` });
      continue;
    }

    const diffs = [];
    diffTagged(pyEntry.tree, jsTree, '', diffs);
    if (diffs.length) results.push({ file, relPath, ok: false, diffs });
    else results.push({ file, relPath, ok: true });
  }
  return { results };
}

// ---- CLI ------------------------------------------------------------------------------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const rep = runCheck(root);
  if (rep.missing) { console.error('cross_loader_check: ' + rep.missing); process.exit(2); }
  let bad = 0;
  for (const r of rep.results) {
    if (r.ok) { console.log(`OK    ${r.relPath}`); continue; }
    bad++;
    if (r.error) { console.log(`FAIL  ${r.relPath} — ${r.error}`); continue; }
    console.log(`FAIL  ${r.relPath} — ${r.diffs.length} divergence(s):`);
    for (const d of r.diffs.slice(0, 50)) console.log(`        ${r.relPath}${d.path || '(root)'}: py ${d.py} vs js ${d.js}`);
    if (r.diffs.length > 50) console.log(`        ... and ${r.diffs.length - 50} more`);
  }
  console.log(bad ? `\n${bad} of ${rep.results.length} file(s) diverge between yaml.safe_load and js-yaml.` : `\nAll ${rep.results.length} files parse identically under both loaders.`);
  process.exit(bad ? 1 : 0);
}
