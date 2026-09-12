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
//      node tools/wchcube_cli.js CH32V006 --package TSSOP20 --pio data/firmware
//
//  Exit codes:  0 fine · 1 bad usage or a load error · 2 --strict and the
//  configuration has pin conflicts, unroutable signals, or the generated C
//  carries a TODO or an #error.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as eng from '../app/engine/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const FORMATS = ['pins-md', 'pins-csv', 'pins-h', 'clocks-md', 'c', 'json'];

const USAGE = `wchcube — headless pinout, clocks and code generation

  node tools/wchcube_cli.js [options] [<mcu name or .yaml path>]

Options
  --project <file>     apply a .wchproj (it names its own MCU and package)
  --package <id>       package to use, e.g. TSSOP20 (default: the part's own default)
  --format <list>      comma separated: ${FORMATS.join(', ')}, or all   [default: pins-md]
  --out <dir>          write files there instead of printing to stdout
  --pio <dir>          write into a PlatformIO project: wchcube_init.h to
                       <dir>/lib/wchcube_generated/include/, wchcube_init.c to
                       .../src/, anything else to the component root. Refuses a
                       directory with no platformio.ini. Implies --format c
                       unless --format says otherwise.
  --mcu-dir <dir>      where to look for MCU yaml  [default: data/mcus]
  --new-project <dir>  write a WHOLE PlatformIO project there - platformio.ini,
                       src/main.c, README.md, .gitignore and lib/wchcube_generated/ -
                       something you open and flash. Refuses a non-empty directory
                       unless --force. Needs a part number with a PlatformIO board:
                       pass --variant, or use a project that names one.
  --variant <part>     the part number to build for, e.g. CH32V006F8P7
  --force              let --new-project write into a directory that is not empty
  --option <k>=<v>     set a generator option; repeatable. --option list prints the
                       ones this build honours, with their defaults, and exits
  --list               list the MCUs found, with their packages, and exit
  --strict             exit 2 if the configuration has conflicts or issues, or
                       if the generated C carries a TODO or an #error
  --quiet              suppress the summary line on stderr
  -h, --help           this text
`;

// Where --pio puts each generated file, by extension. The layout is
// lib/wchcube_generated/{include,src} because that is what its library.json
// declares as includeDir/srcDir; the header has to be in include/ for
// `#include "wchcube_init.h"` to resolve from the application layer too.
const PIO_COMPONENT = ['lib', 'wchcube_generated'];
const PIO_SUBDIR = { '.h': 'include', '.c': 'src' };

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
    else if (a === '--pio') o.pio = need('a PlatformIO project directory');
    else if (a === '--mcu-dir') o.mcuDir = need('a directory');
    else if (a === '--option') (o.options ||= []).push(need('key=value, or "list"'));
    else if (a === '--new-project') o.newProject = need('a directory to create the project in');
    else if (a === '--variant') o.variant = need('a part number');
    else if (a === '--force') o.force = true;
    else if (a === '--format') { o.formats = need('a format list').split(',').map(s => s.trim()).filter(Boolean); o.formatGiven = true; }
    else if (a.startsWith('-')) fail(`unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length > 1) fail(`expected one MCU, got ${rest.length}: ${rest.join(' ')}`);
  o.mcu = rest[0];
  const dests = ['out', 'pio', 'newProject'].filter(k => o[k]);
  if (dests.length > 1) fail(`--${dests.join(' and --')} are two destinations or more; pick one`);
  if (o.force && !o.newProject) fail('--force only means something with --new-project');
  // The only reason to point at a PlatformIO project is to feed it C. Saying so
  // beats writing a pin table there because the default format happened to be that.
  if (o.pio && !o.formatGiven) o.formats = ['c'];
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
/**
 * Write one file, carrying the user's code across if the option is on and there is a
 * previous version to carry it from. This is the only place a previous version EXISTS:
 * the browser downloads into a folder it cannot read, so there is nothing to merge
 * there, and the engine's mergeUserCode() is pure so it can be tested without a disk.
 */
function writeFile(dest, text, o) {
  let out = text;
  if (eng.generatorOption('user_code') && /[.][ch]$/.test(dest) && fs.existsSync(dest)) {
    const merged = eng.mergeUserCode(fs.readFileSync(dest, 'utf8'), text);
    out = merged.text;
    if (!o.quiet) {
      for (const i of merged.issues) process.stderr.write(`wchcube: ${dest}: ${i}\n`);
      if (merged.kept.length) process.stderr.write(`  kept your code in: ${merged.kept.join(', ')}\n`);
      if (merged.orphaned.length) {
        process.stderr.write(`  ${merged.orphaned.join(', ')} no longer exist(s) in the template —`
          + ` your code is kept at the end of the file under USER CODE ORPHANED\n`);
      }
    }
  }
  fs.writeFileSync(dest, out, 'utf8');
  if (!o.quiet) process.stderr.write(`wrote ${dest}\n`);
}

function outputs(formats) {
  const base = `${eng.M.mcu.name}_${eng.S.pkg}`;
  const files = {};
  for (const f of formats) {
    if (f === 'pins-md') files[`${base}_pinout.md`] = eng.pinTableMarkdown();
    else if (f === 'pins-csv') files[`${base}_pinout.csv`] = eng.pinTableCsv();
    else if (f === 'pins-h') files['BoardPins.h'] = eng.pinMapHeader();
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

/**
 * Write a whole PlatformIO project. Refuses a non-empty directory unless --force,
 * because the one thing worse than not generating is quietly overwriting somebody's
 * work - and unlike `--pio`, which updates a drop zone inside a project that is
 * already theirs, this owns the whole folder.
 *
 * USER CODE in an existing src/main.c is still carried across, so --force on a
 * project you generated before is a regeneration rather than a reset.
 */
function writeNewProject(o) {
  let files;
  try { files = eng.projectFiles(); }
  catch (e) { process.stderr.write(`wchcube: ${e.message}\n`); return 1; }

  const dir = o.newProject;
  if (fs.existsSync(dir)) {
    const inside = fs.readdirSync(dir);
    if (inside.length && !o.force) {
      fail(`${dir} is not empty (${inside.length} entr${inside.length === 1 ? 'y' : 'ies'}).`
        + ' Pass --force to write into it anyway; USER CODE sections in an existing'
        + ' src/main.c are carried across either way.');
    }
  }
  for (const f of files) {
    const dest = path.join(dir, ...f.path.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    writeFile(dest, f.text, o);
  }
  const E = eng.compute();
  const t = eng.pioTarget();
  const complaints = eng.cComplaints(Object.fromEntries(
    files.filter(f => /[.][ch]$/.test(f.path)).map(f => [f.name, f.text])));
  if (!o.quiet) {
    process.stderr.write(`${eng.M.mcu.name} ${eng.S.pkg} -> ${t.variant} on board ${t.board}:`
      + ` ${files.length} files, ${E.conflictList.length} conflict(s),`
      + ` ${complaints.length} codegen complaint(s)\n`);
    process.stderr.write(`  cd ${dir} && pio run -t upload\n`);
  }
  const issueCount = Object.values(E.issues).reduce((n, list) => n + list.length, 0);
  if (o.strict && (E.conflictList.length || issueCount || complaints.length)) {
    process.stderr.write('wchcube: --strict and the project is not clean\n');
    return 2;
  }
  return 0;
}

// ---------------------------------------------------------------- main
function main() {
  const o = parseArgs(process.argv.slice(2));
  loadYamlEngine();
  const known = registerAll(o.mcuDir);

  // Generator options are applied AFTER the project, so a flag overrides what the
  // .wchproj saved - which is what lets one fixture be built both ways.
  if (o.options && o.options.includes('list')) {
    for (const d of eng.generatorOptions()) {
      process.stdout.write(`${d.key}=${d.default}   ${d.name}\n`);
      if (d.help) process.stdout.write(`    ${d.help}\n`);
    }
    return 0;
  }

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

  for (const pair of o.options || []) {
    const at = String(pair).indexOf('=');
    if (at < 0) fail(`--option wants key=value, got "${pair}". Try --option list.`);
    const key = pair.slice(0, at), value = pair.slice(at + 1);
    try { eng.setGeneratorOption(key, value); }
    catch (e) { fail(`${e.message}`); }
  }

  if (o.variant) {
    const known = Object.keys((eng.M.mcu && eng.M.mcu.variants) || {});
    if (!known.includes(o.variant)) {
      fail(`"${o.variant}" is not a part number of ${eng.M.mcu.name}. Known: ${known.join(', ')}`);
    }
    eng.setProject({ variant: o.variant });
  }

  if (o.newProject) {
    // Name the project after the folder unless the .wchproj already named it - the
    // banner, the README heading and the ini header all read better than "Untitled".
    if (!eng.PROJECT.name || eng.PROJECT.name === 'Untitled') {
      eng.setProject({ name: path.basename(path.resolve(o.newProject)) });
    }
    return writeNewProject(o);
  }

  const E = eng.compute();
  const files = outputs(o.formats);

  if (o.pio) {
    // Refuse before creating anything: a directory that is not a PlatformIO project
    // must not acquire a lib/ tree because someone typo'd a path.
    if (!fs.existsSync(path.join(o.pio, 'platformio.ini'))) {
      fail(`${o.pio} is not a PlatformIO project (no platformio.ini). Nothing was written.`);
    }
    for (const [name, text] of Object.entries(files)) {
      const sub = PIO_SUBDIR[path.extname(name)];
      const dir = path.join(o.pio, ...PIO_COMPONENT, ...(sub ? [sub] : []));
      fs.mkdirSync(dir, { recursive: true });
      writeFile(path.join(dir, name), text, o);
    }
  } else if (o.out) {
    fs.mkdirSync(o.out, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFile(path.join(o.out, name), text, o);
  } else {
    const many = Object.keys(files).length > 1;
    for (const [name, text] of Object.entries(files)) {
      if (many) process.stdout.write(`\n===== ${name} ${'='.repeat(Math.max(0, 66 - name.length))}\n`);
      process.stdout.write(text.endsWith('\n') ? text : text + '\n');
    }
  }

  const issueCount = Object.values(E.issues).reduce((n, list) => n + list.length, 0);
  // Only meaningful when C was actually generated. A complaint is about the MCU
  // file, not about the configuration, so it is counted separately from conflicts
  // and issues and reported with the line it sits on.
  const complaints = o.formats.includes('c') ? eng.cComplaints(eng.cFiles()) : [];
  if (!o.quiet) {
    process.stderr.write(`${eng.M.mcu.name} ${eng.S.pkg}: ${E.conflictList.length} conflict(s), ${issueCount} issue(s)`
      + (o.formats.includes('c') ? `, ${complaints.length} codegen complaint(s)` : '') + '\n');
    for (const c of complaints) {
      process.stderr.write(`  ${c.kind === 'error' ? '#error' : 'TODO  '} ${c.file}:${c.line}  ${c.text}\n`);
    }
  }
  if (o.strict && complaints.length && !(E.conflictList.length || issueCount)) {
    const n = k => complaints.filter(c => c.kind === k).length;
    process.stderr.write('wchcube: --strict and the generated C is a complaint, not code'
      + ` — ${n('error')} #error, ${n('todo')} TODO. What they name is missing from the MCU file.\n`);
    return 2;
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
