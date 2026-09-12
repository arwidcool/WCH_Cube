// Release QA for the Tauri shell.
//
// The Rust itself is compiled by CI (there is no toolchain on the dev box), so these
// tests cover the parts that break most often and cost nothing to check here: the
// config is coherent, the commands the bridge calls actually exist in main.rs, and
// - the important one - src-tauri/desktop.js behaves correctly both with and without
// a Tauri runtime. "Browser mode must keep working" is a requirement, so it is a test.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { suite, test, assert, skip } from './lib/harness.js';
import { boot, readDist, ROOT } from './lib/app.js';

suite('desktop shell');

const SRC = path.join(ROOT, 'src-tauri');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const bridge = () => read('desktop.js');
const mainRs = () => read('src', 'main.rs');

/** Boot the app with desktop.js appended, exactly as Tauri injects it. */
function bootWithBridge(fakeTauri) {
  // Tauri injects the bridge before the page's own scripts; appending it to the body is
  // close enough, but __TAURI__ has to exist before it runs, hence `globals`.
  const html = readDist().replace('</body>', `<script>${bridge()}</script></body>`);
  return boot({ html, globals: fakeTauri ? { __TAURI__: fakeTauri } : {} });
}

/** Minimal stand-in for the Tauri runtime: records calls, answers like the Rust would. */
function fakeTauri(responses = {}) {
  const calls = [];
  const listeners = {};
  return {
    calls, listeners,
    core: {
      invoke: (cmd, args) => {
        calls.push({ cmd, args });
        const r = responses[cmd];
        return Promise.resolve(typeof r === 'function' ? r(args) : r);
      },
    },
    event: {
      listen: (name, handler) => { (listeners[name] ||= []).push(handler); return Promise.resolve(() => {}); },
      emit: (name, payload) => (listeners[name] || []).forEach(h => h({ payload })),
    },
  };
}

const settle = () => new Promise(r => setTimeout(r, 120));

test('tauri.conf.json is valid and points at the built app', () => {
  const conf = JSON.parse(read('tauri.conf.json'));
  assert.equal(conf.productName, 'WCH_CubeMX', 'the window/product name is fixed by the brief');
  assert.ok(conf.identifier && conf.identifier.includes('.'), 'needs a reverse-DNS identifier');
  assert.equal(conf.build.frontendDist, '../dist');
  assert.ok(fs.existsSync(path.join(SRC, '..', 'dist', 'index.html')), 'frontendDist has no index.html');
  assert.ok(conf.app.withGlobalTauri, 'desktop.js uses window.__TAURI__, so withGlobalTauri must be on');
});

test('the window is titled WCH_CubeMX and injects the bridge', () => {
  const rs = mainRs();
  assert.includes(rs, '.title("WCH_CubeMX")');
  assert.includes(rs, 'initialization_script(include_str!("../desktop.js"))');
  assert.includes(rs, '"main"', 'the window label must be "main" to match capabilities/default.json');
});

test('the capability file matches the window the app creates', () => {
  const cap = JSON.parse(read('capabilities', 'default.json'));
  assert.deep(cap.windows, ['main']);
  assert.includes(cap.permissions, 'dialog:default', 'the native dialogs need the dialog plugin permission');
});

test('data/ is bundled as a resource and the user override folder is wired', () => {
  const conf = JSON.parse(read('tauri.conf.json'));
  const keys = Object.keys(conf.bundle.resources || {});
  assert.ok(keys.some(k => k.includes('data/mcus')), 'MCU YAML must ship with the app');
  assert.ok(keys.some(k => k.includes('data/packages')), 'package geometry must ship with the app');
  assert.includes(mainRs(), '.wch_cubemx', 'the user override folder ~/.wch_cubemx/mcus is missing');
});

test('every command the bridge invokes exists in main.rs', () => {
  const rs = mainRs();
  const declared = new Set([...rs.matchAll(/#\[tauri::command\]\s*fn\s+(\w+)/g)].map(m => m[1]));
  const registered = (rs.match(/generate_handler!\[([\s\S]*?)\]/) || [, ''])[1]
    .split(',').map(s => s.trim()).filter(Boolean);
  const invoked = new Set([...bridge().matchAll(/invoke\(\s*'([a-z_]+)'/g)].map(m => m[1]));

  const missing = [...invoked].filter(c => !declared.has(c));
  assert.empty(missing, 'commands desktop.js calls but main.rs does not define');

  const unregistered = [...declared].filter(c => !registered.includes(c));
  assert.empty(unregistered, 'commands defined but not passed to generate_handler!');
});

test('the icons the bundle references exist', () => {
  const conf = JSON.parse(read('tauri.conf.json'));
  const missing = (conf.bundle.icon || []).filter(i => !fs.existsSync(path.join(SRC, i)));
  assert.empty(missing, 'icon files referenced by tauri.conf.json but not on disk');
});

// ---- the bridge itself -------------------------------------------------------

test('in a plain browser the bridge does nothing at all', async () => {
  const a = bootWithBridge(null);      // no window.__TAURI__
  try {
    await settle();
    assert.empty(a.problems(), 'desktop.js must be silent and harmless in a browser');
    // the app's own browser behaviour is untouched
    assert.equal(a.document.documentElement.dataset.shell, undefined, 'must not mark the page as a shell');
    assert.ok(a.pinEls().length > 0, 'the app still renders');
  } finally { a.close(); }
});

test('under Tauri it loads MCU files from disk and marks the page as a shell', async () => {
  const yaml = fs.readFileSync(path.join(ROOT, 'data', 'mcus', 'CH32V006.yaml'), 'utf8');
  const t = fakeTauri({
    list_mcus: [{ name: 'CH32V006-FROM-DISK', path: '/x/CH32V006.yaml', source: 'user', yaml }],
  });
  const a = bootWithBridge(t);
  try {
    await settle();
    assert.empty(a.problems(), 'the bridge logged problems');
    assert.ok(t.calls.some(c => c.cmd === 'list_mcus'), 'it never asked for the MCU list');
    assert.equal(a.document.documentElement.dataset.shell, 'tauri');
    const names = a.mcuNames;
    assert.includes(names, 'CH32V006-FROM-DISK', 'a disk MCU was not registered');
    const sel = a.document.getElementById('mcusel');
    assert.ok([...sel.options].some(o => o.value === 'CH32V006-FROM-DISK'), 'it is missing from the MCU dropdown');
  } finally { a.close(); }
});

test('Ctrl+S and the Save button both go through the native dialog', async () => {
  const t = fakeTauri({ list_mcus: [], save_project: () => '/home/u/Demo.wchproj' });
  const a = bootWithBridge(t);
  try {
    await settle();
    a.window.document.getElementById('m-save').click();
    await settle();
    const save = t.calls.filter(c => c.cmd === 'save_project');
    assert.equal(save.length, 1, 'the Save button did not reach save_project');
    assert.ok(save[0].args.yaml.includes('wchproj'), 'the serialised project was not passed');

    a.key('s', { ctrlKey: true });
    await settle();
    assert.equal(t.calls.filter(c => c.cmd === 'save_project').length, 2, 'Ctrl+S did not reach save_project');
    assert.empty(a.problems(), 'saving logged problems');
  } finally { a.close(); }
});

test('opening a project through the native dialog restores it', async () => {
  const first = bootWithBridge(fakeTauri({ list_mcus: [] }));
  let projectYaml, before;
  try {
    await settle();
    first.assign('PA1', { gpio: 'GPIO_Output' });
    projectYaml = first.window.projectSerialize();
    before = JSON.stringify(first.S.manual);
  } finally { first.close(); }

  const t = fakeTauri({ list_mcus: [], open_project: projectYaml });
  const a = bootWithBridge(t);
  try {
    await settle();
    a.document.getElementById('m-openproj').click();
    await settle();
    assert.ok(t.calls.some(c => c.cmd === 'open_project'), 'the dialog was never opened');
    assert.equal(JSON.stringify(a.S.manual), before, 'the project did not come back');
    assert.empty(a.problems(), 'opening logged problems');
  } finally { a.close(); }
});

test('a mcu-changed event hot-reloads the part that is on screen', async () => {
  const original = fs.readFileSync(path.join(ROOT, 'data', 'mcus', 'CH32V006.yaml'), 'utf8');
  const edited = original.replace('max_sysclk_mhz: 48', 'max_sysclk_mhz: 24');
  assert.notEqual(edited, original, 'the fixture edit did not apply - has the YAML changed?');

  const t = fakeTauri({ list_mcus: [] });
  const a = bootWithBridge(t);
  try {
    await settle();
    a.loadMcu('CH32V006');
    assert.equal(a.M.mcu.max_sysclk_mhz, 48);

    t.event.emit('mcu-changed', { name: 'CH32V006', path: '/x.yaml', source: 'user', yaml: edited });
    await settle();

    assert.equal(a.M.mcu.max_sysclk_mhz, 24, 'the edited YAML was not picked up');
    assert.ok(a.pinEls().length > 0, 'the chip stopped rendering after a hot reload');
    assert.empty(a.problems(), 'hot reload logged problems');
  } finally { a.close(); }
});

test('a broken YAML on disk does not take the app down', async () => {
  const t = fakeTauri({ list_mcus: [] });
  const a = bootWithBridge(t);
  try {
    await settle();
    const drawnBefore = a.pinEls().length;
    t.event.emit('mcu-changed', { name: a.M.mcu.name, path: '/x.yaml', source: 'user', yaml: 'this: [is, not: valid' });
    await settle();
    assert.equal(a.pinEls().length, drawnBefore, 'the app lost its render over a bad file');
  } finally { a.close(); }
});

// ---------------------------------------------------------------- D5: write_project
//
// The round-4 command: the app hands over a whole project TREE and the shell
// decides only where the root goes. These drive the bridge against the fake
// runtime; the refusals themselves (paths that escape the root, a non-empty
// folder) are unit-tested in Rust, in `src-tauri/src/main.rs`, because that is
// where the decision is made and the page can never be the thing enforcing it.

test('write_project is declared in Rust, registered, and reachable from the bridge', () => {
  const rs = mainRs();
  assert.match(rs, /fn write_project\s*\(/, 'write_project is not declared in main.rs');
  // Declaring a #[tauri::command] and forgetting to register it is a runtime
  // "command not found" the page only discovers when a user clicks Generate.
  const handlers = /generate_handler!\[([^\]]*)\]/s.exec(rs);
  assert.ok(handlers, 'no generate_handler! block in main.rs');
  assert.includes(handlers[1], 'write_project', 'write_project is not in generate_handler!');
  assert.includes(bridge(), "invoke('write_project'", 'the bridge never invokes write_project');
});

test('the bridge hands write_project a relative-path file list and a folder name', async () => {
  const seen = [];
  const t = fakeTauri({
    list_mcus: [],
    write_project: args => { seen.push(args); return { root: '/home/u/Demo', written: args.files.map(f => f.path) }; },
  });
  const a = bootWithBridge(t);
  try {
    await settle();
    const res = await a.window.desktopWriteProject('Demo', [
      { path: 'platformio.ini', text: '[env:CH32V006F8P6]\n' },
      { path: 'src/main.c', text: 'int main(void){return 0;}\n' },
      { path: 'lib/wchcube_generated/src/wchcube_init.c', text: '/* generated */\n' },
    ]);
    assert.equal(seen.length, 1, 'desktopWriteProject did not reach write_project');
    assert.equal(seen[0].name, 'Demo', 'the folder name was not passed');
    assert.equal(seen[0].overwrite, false, 'overwrite must default to false — it is a destructive flag');
    // Every path relative, so the shell can refuse anything that leaves the root.
    for (const f of seen[0].files) {
      assert.notOk(/^([a-zA-Z]:)?[\/]/.test(f.path), `${f.path} is not relative`);
      assert.notOk(f.path.includes('..'), `${f.path} contains ..`);
      assert.ok(typeof f.text === 'string', `${f.path} carries no text`);
    }
    assert.equal(res.written.length, 3, 'the result did not come back to the caller');
    assert.empty(a.problems(), 'writing a project logged problems');
  } finally { a.close(); }
});

test('a cancelled folder picker is not an error', async () => {
  // Rust returns Ok(None) when the user closes the dialog. The bridge must treat
  // that as "nothing happened", not as a failure to report.
  const t = fakeTauri({ list_mcus: [], write_project: () => null });
  const a = bootWithBridge(t);
  try {
    await settle();
    const res = await a.window.desktopWriteProject('Demo', [{ path: 'src/main.c', text: 'x' }]);
    assert.equal(res, null, 'a cancelled picker should come back as null');
    assert.empty(a.problems(), 'cancelling logged problems');
  } finally { a.close(); }
});

test('the refusals live in Rust, where the page cannot talk past them', () => {
  // A test that the SHAPE is right, not the behaviour: the behaviour is covered
  // by `cargo test` in main.rs. What this guards is that the checks do not drift
  // into desktop.js, where a page bug would be able to skip them.
  const rs = mainRs();
  assert.match(rs, /fn safe_relative\s*\(/, 'no safe_relative() in main.rs');
  assert.includes(rs, 'may not contain `..`', 'safe_relative does not refuse ..');
  assert.includes(rs, 'must be relative to the project folder', 'safe_relative does not refuse absolute paths');
  assert.includes(rs, 'already exists and is not empty', 'write_project does not refuse a non-empty folder');
  // And the validation must happen before anything is created, or a bad entry
  // halfway down the list leaves a half-written tree behind.
  const body = /fn write_project\([\s\S]*?\n}/.exec(rs)[0];
  const validateAt = body.indexOf('safe_relative');
  const writeAt = body.indexOf('fs::write');
  assert.ok(validateAt > -1 && writeAt > -1 && validateAt < writeAt,
    'write_project must validate every path BEFORE it creates the first file, '
    + 'or a bad entry leaves a half-written project on disk');
});

test('the Rust unit tests in src-tauri pass', () => {
  // `cargo test` is the only thing that actually runs safe_relative(). Round 3
  // found that src-tauri had NEVER been compiled; the fix for that is not to
  // compile it once by hand, it is to put it in the suite everyone runs.
  // `cargo` being on PATH is not the same as being able to compile a Tauri app. On Linux the
  // crate needs webkit2gtk / gtk3 / libsoup from apt, which only the `desktop` CI job installs
  // - and that job runs `cargo test --release --locked` itself, so the Rust tests ARE run
  // where their environment exists. In the `test` job cargo is present and the libraries
  // are not, and this test failed there on every push until 2026-09-12: a check running in a
  // job that lacks its environment reads as a defect in the code. Skip with the reason on
  // Linux when pkg-config cannot find the toolkit; on Windows (WebView2) there is no such
  // dependency and the test runs as before.
  if (process.platform === 'linux') {
    const pc = spawnSync('pkg-config', ['--exists', 'webkit2gtk-4.1'], { encoding: 'utf8' });
    if (pc.error || pc.status !== 0) {
      skip('Tauri\'s Linux system libraries are not installed here (pkg-config finds no webkit2gtk-4.1) '
        + '- the desktop CI job installs them and runs cargo test itself');
    }
  }
  const r = spawnSync('cargo', ['test', '--quiet'], { cwd: SRC, encoding: 'utf8' });
  if (r.error) skip(`cargo is not on PATH (${r.error.code}) — the Rust half of the shell was not run`);
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  assert.equal(r.status, 0, `cargo test failed:\n${out}`);
  // "0 tests run" exits 0 and proves nothing.
  const m = /test result: ok\. (\d+) passed/.exec(out);
  assert.ok(m && Number(m[1]) > 0, `cargo test ran no tests, so this proves nothing:\n${out}`);
});
