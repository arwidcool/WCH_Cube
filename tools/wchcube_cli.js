#!/usr/bin/env node
// =============================================================================
//  wchcube_cli.js — the engine without a browser.
//
//  Loads an MCU (and optionally a .wchproj), then prints or writes exactly what
//  the GENERATE CODE button produces: the pin table, the clock summary and the C
//  init files. CI diffs this output, so nothing here may depend on the DOM and
//  the bytes must match what the app writes.
//
//  Examples
//      node tools/wchcube_cli.js --list
//      node tools/wchcube_cli.js CH32V006 --package TSSOP20 --format pins-md
//      node tools/wchcube_cli.js --project my.wchproj --format all --out build/
//      node tools/wchcube_cli.js CH32V006 --format json --strict
//
//  Exit codes:  0 fine · 1 bad usage or a load error · 2 --strict and the
//  configuration has pin conflicts or unroutable signals.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as eng from '../app/engine/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const FORMATS = ['pins-md', 'pins-csv', 'clocks-md', 'c', 'json'];

const USAGE = `wchcube — headless pinout, clocks and code generation

  node tools/wchcube_cli.js [options] [<mcu name or .yaml path>]

Options
  --project <file>     apply a .wchproj (it names its own MCU and package)
  --package <id>       package to use, e.g. TSSOP20 (default: the part's own default)
  --format <list>      comma separated: ${FORMATS.join(', ')}, or all   [default: pins-md]
  --out <dir>          write files there instead of printing to stdout
  --mcu-dir <dir>      where to look for MCU yaml  [default: data/mcus]
  --list               list the MCUs found, with their packages, and exit
  --strict             exit 2 if the configuration has conflicts or issues
  --quiet              suppress the summary line on stderr
  -h, --help           this text
`;

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const o = { formats: ['pins-md'], strict: false, quiet: false, list: false, mcuDir: path.join(DATA, 'mcus') };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = what => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs ${what}`);
      return v;
    };
    if (a === '-h' || a === '--help') { process.stdout.write(USAGE); process.exit(0); }
    else if (a === '--list') o.list = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--project') o.project = need('a .wchproj path');
    else if (a === '--package') o.pkg = need('a package id');
    else if (a === '--out') o.out = need('a directory');
    else if (a === '--mcu-dir') o.mcuDir = need('a directory');
    else if (a === '--format') o.formats = need('a format list').split(',').map(s => s.trim()).filter(Boolean);
    else if (a.startsWith('-')) fail(`unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length > 1) fail(`expected one MCU, got ${rest.length}: ${rest.join(' ')}`);
  o.mcu = rest[0];
  if (o.formats.includes('all')) o.formats = FORMATS.filter(f => f !== 'json');
  const bad = o.formats.filter(f => !FORMATS.includes(f));
  if (bad.length) fail(`unknown format(s): ${bad.join(', ')}. Known: ${FORMATS.join(', ')}, all`);
  return o;
}

function fail(msg) {
  process.stderr.write(`wchcube: ${msg}\n\n${USAGE}`);
  process.exit(1);
}

// ---------------------------------------------------------------- loading
function loadYamlEngine() {
  // The vendored js-yaml is a UMD bundle; run it as CommonJS without a bundler,
  // exactly as app/tests/_harness.js does, so CLI and tests parse identically.
  const src = fs.readFileSync(path.join(ROOT, 'app', 'vendor', 'js-yaml.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  eng.setYaml(mod.exports);
}

function registerAll(mcuDir) {
  eng.loadPackages(eng.yamlLoad(fs.readFileSync(path.join(DATA, 'packages', 'packages.yaml'), 'utf8')));
  if (!fs.existsSync(mcuDir)) fail(`no such directory: ${mcuDir}`);
  const names = [];
  for (const f of fs.readdirSync(mcuDir).filter(n => n.endsWith('.yaml')).sort()) {
    const text = fs.readFileSync(path.join(mcuDir, f), 'utf8');
    try { names.push({ name: eng.registerMcuFile(text), file: f }); }
    catch (e) { process.stderr.write(`wchcube: skipping ${f}: ${e.message}\n`); }
  }
  return names;
}

/** An MCU argument is either a registered name or a path to a yaml file. */
function resolveMcu(arg, known) {
  if (!arg) {
    if (known.length !== 1) {
      fail(`name an MCU (${known.map(k => k.name).join(', ')}) or pass --project`);
    }
    return known[0].name;
  }
  if (eng.MCU_FILES[arg]) return arg;
  if (fs.existsSync(arg)) return eng.registerMcuFile(fs.readFileSync(arg, 'utf8'));
  fail(`unknown MCU "${arg}". Known: ${known.map(k => k.name).join(', ') || '(none)'}`);
}

// ---------------------------------------------------------------- output
function outputs(formats) {
  const base = `${eng.M.mcu.name}_${eng.S.pkg}`;
  const files = {};
  for (const f of formats) {
    if (f === 'pins-md') files[`${base}_pinout.md`] = eng.pinTableMarkdown();
    else if (f === 'pins-csv') files[`${base}_pinout.csv`] = eng.pinTableCsv();
    else if (f === 'clocks-md') files[`${base}_clocks.md`] = eng.clockSummaryMarkdown();
    else if (f === 'c') Object.assign(files, eng.cFiles());
    else if (f === 'json') files[`${base}.json`] = JSON.stringify(report(), null, 2) + '\n';
  }
  return files;
}

/** Machine-readable state, for CI to assert on without parsing Markdown. */
function report() {
  const E = eng.compute();
  const clocks = eng.M.clock ? eng.clockCalc() : null;
  return {
    mcu: eng.M.mcu.name,
    package: eng.S.pkg,
    project: eng.PROJECT.name,
    pins: eng.pinRows().filter(r => r.signal || r.label),
    conflicts: E.conflictList.map(c => ({ pin: c.label, number: c.num, signals: c.signals, owners: c.owners, shorted: !!c.shorted })),
    issues: E.issues,
    peripherals: Object.fromEntries(Object.entries(E.status).filter(([, v]) => v).map(([k, v]) => [k, v])),
    clocks: clocks && Object.fromEntries(Object.entries(clocks).filter(([k]) => k !== 'over')),
    outOfSpec: clocks ? clocks.over : [],
  };
}

// ---------------------------------------------------------------- main
function main() {
  const o = parseArgs(process.argv.slice(2));
  loadYamlEngine();
  const known = registerAll(o.mcuDir);

  if (o.list) {
    for (const { name, file } of known) {
      const m = eng.mcuModel(eng.MCU_FILES[name]);
      process.stdout.write(`${name}\n  file      ${file}\n  packages  ${Object.keys(m.packages).join(', ')}\n`
        + `  default   ${m.mcu.default_package || Object.keys(m.packages)[0]}\n`);
    }
    return 0;
  }

  if (o.project) {
    if (!fs.existsSync(o.project)) fail(`no such project file: ${o.project}`);
    eng.projectApply(fs.readFileSync(o.project, 'utf8'));
  } else {
    eng.loadMcu(eng.MCU_FILES[resolveMcu(o.mcu, known)]);
  }
  if (o.pkg) {
    if (!(o.pkg in eng.M.packages)) {
      fail(`"${o.pkg}" is not a package of ${eng.M.mcu.name}. Try: ${Object.keys(eng.M.packages).join(', ')}`);
    }
    eng.setPackage(o.pkg);
  }

  const E = eng.compute();
  const files = outputs(o.formats);

  if (o.out) {
    fs.mkdirSync(o.out, { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      fs.writeFileSync(path.join(o.out, name), text, 'utf8');
      if (!o.quiet) process.stderr.write(`wrote ${path.join(o.out, name)}\n`);
    }
  } else {
    const many = Object.keys(files).length > 1;
    for (const [name, text] of Object.entries(files)) {
      if (many) process.stdout.write(`\n===== ${name} ${'='.repeat(Math.max(0, 66 - name.length))}\n`);
      process.stdout.write(text.endsWith('\n') ? text : text + '\n');
    }
  }

  const issueCount = Object.values(E.issues).reduce((n, list) => n + list.length, 0);
  if (!o.quiet) {
    process.stderr.write(`${eng.M.mcu.name} ${eng.S.pkg}: ${E.conflictList.length} conflict(s), ${issueCount} issue(s)\n`);
  }
  if (o.strict && (E.conflictList.length || issueCount)) {
    process.stderr.write('wchcube: --strict and the configuration is not clean\n');
    return 2;
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (e) {
  process.stderr.write(`wchcube: ${e.message}\n`);
  process.exitCode = 1;
}
