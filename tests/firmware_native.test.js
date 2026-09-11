// =============================================================================
//  tests/firmware_native.test.js — the host-side firmware tests, in the suite. (D6)
//
//  `data/firmware/lib/util` is the one firmware component that compiles for the
//  development machine: its `library.json` declares no framework and no platform,
//  it allocates nothing and it never includes an SDK header. That constraint is
//  written down in `ARCHITECTURE.md` and it only pays for itself if something
//  exercises it, so `pio test -e native` runs ten Unity tests over the ring
//  buffer's wrap-around and full/empty cases.
//
//  This file is what makes those run in `node tests/run.js` rather than being a
//  thing someone remembers to type. Same rule as the compile gate: if the host
//  toolchain is missing it SKIPS with a printed reason the runner counts, never
//  silently.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { suite, test, assert, skip } from './lib/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FW = path.join(ROOT, 'data', 'firmware');

suite('firmware (host)');

/**
 * A host C compiler, and the PATH that finds it.
 *
 * There is no `gcc` on PATH on the box this was written on, which made it look
 * for a while as though host tests simply could not run here. They can: MinGW is
 * installed at C:\MinGW and PlatformIO's `native` platform uses it happily once
 * it is on PATH. So look in the usual places before concluding anything — an
 * environment fact that is wrong in the pessimistic direction costs just as much
 * as one that is wrong in the optimistic direction, and this repo has now had
 * both (`agents/README.md` used to say there was no cargo and no C compiler).
 */
const host = (() => {
  const direct = spawnSync('gcc', ['--version'], { encoding: 'utf8' });
  if (!direct.error && direct.status === 0) {
    return { ok: true, env: process.env, how: 'gcc on PATH' };
  }
  const candidates = process.platform === 'win32'
    ? ['C:/MinGW/bin', 'C:/msys64/mingw64/bin', 'C:/msys64/ucrt64/bin', 'C:/w64devkit/bin',
       'C:/Program Files/Git/mingw64/bin', 'C:/TDM-GCC-64/bin']
    : ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];
  for (const dir of candidates) {
    const exe = path.join(dir, process.platform === 'win32' ? 'gcc.exe' : 'gcc');
    if (!fs.existsSync(exe)) continue;
    const r = spawnSync(exe, ['--version'], { encoding: 'utf8' });
    if (r.error || r.status !== 0) continue;
    const sep = process.platform === 'win32' ? ';' : ':';
    return {
      ok: true,
      env: { ...process.env, PATH: `${dir.replace(/\//g, path.sep)}${sep}${process.env.PATH}` },
      how: `${exe} (${(r.stdout || '').split('\n')[0].trim()})`,
    };
  }
  return {
    ok: false,
    why: 'no host C compiler found. Looked for `gcc` on PATH and in '
      + `${candidates.join(', ')}. Install MinGW/gcc/clang and \`pio test -e native\` runs `
      + 'the firmware\'s host-side unit tests.',
  };
})();

const pioCmd = (() => {
  for (const cmd of process.platform === 'win32'
    ? [['pio.exe'], ['platformio.exe'], ['pio'], ['platformio']]
    : [['pio'], ['platformio']]) {
    const r = spawnSync(cmd[0], [...cmd.slice(1), '--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return cmd;
  }
  return null;
})();

test('the native test environment does not inherit the target build', () => {
  // Every key `[env]` sets is target-only — `framework = noneos-sdk`, the ch32v
  // lib_deps, the SDI build flag — and letting any of them through makes a host
  // build ask for a `board`. That is not a theory: it failed twice that way
  // before the overrides went in. Cheap to assert, and it fails with a sentence
  // rather than with "BoardConfig: Board is not defined".
  const ini = fs.readFileSync(path.join(FW, 'platformio.ini'), 'utf8');
  const native = /\[env:native\]([\s\S]*?)(?=\n\[|$)/.exec(ini);
  assert.ok(native, 'no [env:native] section in data/firmware/platformio.ini');
  const body = native[1];
  assert.match(body, /^\s*platform\s*=\s*native/m, '[env:native] does not set platform = native');
  assert.match(body, /^\s*framework\s*=\s*$/m,
    '[env:native] must clear `framework`, or it inherits noneos-sdk from [env] and demands a board');
  assert.match(body, /^\s*test_build_src\s*=\s*no/m,
    'test_build_src must be off: src/main.c is target firmware and must never link into a host test binary');
  assert.match(body, /^\s*lib_deps\s*=\s*util\s*$/m,
    '[env:native] may depend on `util` only — `board` and `wch_hal` include SDK headers by design');
});

test('lib/util compiles and its unit tests pass on the host', () => {
  if (!pioCmd) skip('PlatformIO is not on PATH, so the host test environment cannot be run');
  if (!host.ok) skip(host.why);

  const r = spawnSync(pioCmd[0], [...pioCmd.slice(1), 'test', '-e', 'native'],
    { cwd: FW, encoding: 'utf8', env: host.env, maxBuffer: 32 * 1024 * 1024 });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  assert.equal(r.status, 0, `pio test -e native failed (compiler: ${host.how}):\n${out.split('\n').slice(-40).join('\n')}`);

  // "0 test cases" exits 0 and proves nothing — the same trap as cargo test and
  // the SDK-name self-test. Insist the tests were found and that none failed.
  const m = /(\d+) test cases: (\d+) succeeded/.exec(out);
  assert.ok(m, `could not read a test tally out of pio's output:\n${out.split('\n').slice(-20).join('\n')}`);
  const [, total, passed] = m.map(Number);
  assert.ok(total > 0, `pio test -e native ran 0 test cases, so this proves nothing:\n${out}`);
  assert.equal(passed, total, `${total - passed} of ${total} host test case(s) failed:\n${out}`);
});
