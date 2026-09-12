// ONE peripheral, TWO register blocks, and which one is right is a MODE.
//
// `codegen.periph_handle.<PID>` is a string, because almost every peripheral has one
// register block. CH32H417's full-speed USB has two, at the SAME base address:
//
//     #define USBFSD  ((USBFSD_TypeDef *)USBFS_BASE)      ch32h417.h:1810
//     #define USBFSH  ((USBFSH_TypeDef *)USBFS_BASE)      ch32h417.h:1811
//
// Two different struct types over one block, because the registers MEAN different things
// depending on whether the controller is a device or a host. A single string cannot name
// both, so USB `params:` could not be written at all — and the same shape appeared on
// CH32X035 in round 4 (`USBFSD` / `USBFSH` again) and was parked there.
//
// It is not two handles at once and it is not two peripherals: it is one handle whose
// value follows a choice the user has already made. The Device/Host setting exists and
// already decides which block is initialised, so the data names that setting and the
// handle each of its choices implies. The half that matters most is the REFUSAL: a choice
// with no entry is not defaulted to either block, because writing host registers through
// device field names compiles and is wrong on the board.
//
// Synthetic part, as always here: a mechanism tested against the one chip it was designed
// for cannot tell "it works" from "it works there".
import { test, assert, fresh, eng, mcuNames } from './_harness.js';

const PART = handleBlock => `
mcu:
  name: HANDLE-TEST
  family: test
  default_package: QFN32
  variants:
    A32: { package: QFN32, flash_kb: 64, sram_kb: 8, temp: 85, io_count: 32 }
packages:
  QFN32:
${Array.from({ length: 32 }, (_, i) => `    ${i + 1}: P${'AB'[Math.floor(i / 16)]}${i % 16}`).join('\n')}
pins:
${Array.from({ length: 32 }, (_, i) => `  P${'AB'[Math.floor(i / 16)]}${i % 16}: { type: io }`).join('\n')}
peripherals:
  SERIALBUS:
    category: Connectivity
    settings:
      - name: Mode
        choices:
          - { name: Disable }
          - { name: Device }
          - { name: Host }
          - { name: Dual-role }
    params:
      - key: speed
        name: Bus speed
        struct: BUS_InitTypeDef
        sdk_field: BUS_Speed
        type: enum
        default: Full
        options:
          - { name: Full, value: 0, sdk: BUS_Speed_Full }
      - key: pull
        name: Bus pull-up
        sdk_call: BUS_PullUpCmd
        sdk_args: [$HANDLE, $VALUE]
        type: bool
        default: true
        sdk_enabled: ENABLE
        sdk_disabled: DISABLE
codegen:
  header: handletest.h
  sdk: { synthetic: true }
${handleBlock}
  init_structs:
    BUS_InitTypeDef: { fn: BUS_Init }
    GPIO_InitTypeDef: { fn: GPIO_Init }
gpio:
  modes: [{ name: Output Push Pull, macro: GPIO_Mode_Out_PP }]
  input_modes: [{ name: No pull, macro: GPIO_Mode_IN_FLOATING }]
`;

const BY_CHOICE = PART(`  periph_handle:
    SERIALBUS:
      setting: Mode
      by_choice:
        Device: BUSD
        Host: BUSH`);

const PLAIN = PART('  periph_handle:\n    SERIALBUS: BUS');

const load = src => { fresh('CH32V006'); eng.loadMcu(src); };

// ---- the handle follows the mode ----------------------------------------------

test('the same peripheral resolves to a different register block per mode', () => {
  load(BY_CHOICE);
  eng.setSetting('SERIALBUS', 'Mode', 'Device');
  assert.deepEqual(eng.periphHandle('SERIALBUS'),
    { handle: 'BUSD', missing: null, via: 'Mode = Device' });
  eng.setSetting('SERIALBUS', 'Mode', 'Host');
  assert.deepEqual(eng.periphHandle('SERIALBUS'),
    { handle: 'BUSH', missing: null, via: 'Mode = Host' });
});

test('both routes to the SDK take it: the init struct and the standalone call', () => {
  load(BY_CHOICE);
  eng.setSetting('SERIALBUS', 'Mode', 'Host');
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /BUS_Init\(BUSH, &BUS_InitStructure\);/, 'the struct route');
  assert.match(c, /BUS_PullUpCmd\(BUSH, ENABLE\);/, 'and $HANDLE in an sdk_call');
  assert.doesNotMatch(c, /BUSD/, 'the device block appears nowhere in a host configuration');
  assert.equal((c.match(/TODO/g) || []).length, 0);

  eng.setSetting('SERIALBUS', 'Mode', 'Device');
  eng.compute();
  const d = eng.cSource();
  assert.match(d, /BUS_Init\(BUSD, &BUS_InitStructure\);/);
  assert.match(d, /BUS_PullUpCmd\(BUSD, ENABLE\);/);
  assert.doesNotMatch(d, /BUSH/);
});

// ---- what it refuses ----------------------------------------------------------

test('a mode with no register block is a TODO, not whichever one is listed first', () => {
  // The whole point. Dual-role is a real choice of this setting and the data does not say
  // which block it initialises. Defaulting to the device block writes host registers
  // through device field names: it compiles, and it is wrong on the board.
  load(BY_CHOICE);
  eng.setSetting('SERIALBUS', 'Mode', 'Dual-role');
  eng.compute();
  const c = eng.cSource();
  assert.doesNotMatch(c, /BUS_Init\(BUS[DH],/, 'neither block is picked');
  assert.match(c, /TODO/);
  assert.match(c, /by_choice has no register block for Mode = "Dual-role"/);
  assert.match(c, /it names "Device", "Host"/, 'and says what the data does list');
  assert.match(c, /wrong one compiles and is wrong on the board/);
  // The standalone call refuses too, and for the same stated reason rather than the
  // generic "codegen.periph_handle.SERIALBUS is missing" - that key is not missing.
  assert.match(c, /BUS_PullUpCmd\(\), not by an init struct/);
  assert.doesNotMatch(c, /and codegen\.periph_handle\.SERIALBUS\. \*\//);
});

test('a by_choice block missing its halves says which half', () => {
  load(PART('  periph_handle:\n    SERIALBUS:\n      by_choice:\n        Device: BUSD'));
  eng.setSetting('SERIALBUS', 'Mode', 'Device');
  assert.match(eng.periphHandle('SERIALBUS').missing, /names no setting:/);

  load(PART('  periph_handle:\n    SERIALBUS:\n      setting: Mode'));
  eng.setSetting('SERIALBUS', 'Mode', 'Device');
  assert.match(eng.periphHandle('SERIALBUS').missing, /names no by_choice:/);

  load(PART('  periph_handle:\n    SERIALBUS:\n      setting: Nope\n      by_choice: { Device: BUSD }'));
  eng.setSetting('SERIALBUS', 'Mode', 'Device');
  assert.match(eng.periphHandle('SERIALBUS').missing,
    /names "Nope", which is not a setting SERIALBUS has/);
});

// ---- the regression half ------------------------------------------------------

test('a plain string handle behaves exactly as it did', () => {
  load(PLAIN);
  eng.setSetting('SERIALBUS', 'Mode', 'Host');
  eng.compute();
  assert.deepEqual(eng.periphHandle('SERIALBUS'), { handle: 'BUS', missing: null });
  const c = eng.cSource();
  assert.match(c, /BUS_Init\(BUS, &BUS_InitStructure\);/);
  assert.match(c, /BUS_PullUpCmd\(BUS, ENABLE\);/, 'the mode does not enter into it');
});

test('no periph_handle at all still asks for the key by name', () => {
  load(PART(''));
  eng.setSetting('SERIALBUS', 'Mode', 'Device');
  eng.compute();
  assert.deepEqual(eng.periphHandle('SERIALBUS'), { handle: null, missing: null },
    'absent is not an error here - it is the TODO below that reports it');
  assert.match(eng.cSource(), /codegen\.periph_handle\.SERIALBUS — the SPL name of SERIALBUS's register block/);
});

test('every shipped part still resolves every handle it declares, to the same string', () => {
  // The rule the mechanism has to obey: inert on data that does not use it. Read straight
  // off each part's own file rather than from a list written here, so a part added later
  // is covered without anyone remembering to add it.
  let checked = 0;
  for (const name of mcuNames()) {
    const e = fresh(name);
    for (const [pid, spec] of Object.entries((e.M.codegen || {}).periph_handle || {})) {
      if (typeof spec !== 'string') continue;
      assert.deepEqual(e.periphHandle(pid), { handle: spec, missing: null },
        `${name}.${pid}: a string handle must come back unchanged`);
      checked++;
    }
  }
  assert.ok(checked > 20, `the sweep must actually have run (checked ${checked})`);
});
