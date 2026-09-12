// =============================================================================
//  tests/h417_ltdc.test.js — the display controller's output width is a WIRING choice,
//  and the lines it does not claim must come back.
//
//  WHY THIS EXISTS. Most people do not wire a 24-bit panel. They wire 16-bit (RGB565) or
//  18-bit (RGB666) and expect the leftover colour lines to be ordinary pins they can use
//  for something else. That works on this silicon, and the reason is worth stating
//  because it is not obvious from the peripheral list:
//
//    * RM 43.4.5 — the global control register `R32_LTDC_GCR` has four polarity bits and
//      an enable, and bits [27:1] are RESERVED. There is no field that narrows the bus.
//      The controller always drives 24-bit parallel RGB at the pad.
//    * So a narrower panel is wired to the HIGH bits of each channel, and the low lines
//      are simply not connected. Nothing in the silicon reserves them: each is an
//      ordinary pin that carries LTDC only while its AFR field selects LTDC's AF.
//
//  A SECOND THING THIS FILE GUARDS, and it was a live defect until 2026-09-12: the
//  per-signal DEFAULT pins collided with each other. `defaultSignalPin()` takes the first
//  option bonded on the package, and four pads were the first option for two different
//  LTDC signals at once — PA8 was R6 *and* B3, PA15 was R3 *and* CLK, PA6 was G2 *and*
//  HSYNC, PA10 was B1 *and* B4. The conflict engine said nothing, because it only reports
//  a pad whose claims have different OWNERS and both of those are LTDC. One pad drives one
//  bit, so simply switching the controller on produced a configuration the silicon cannot
//  honour. The pin lists are now ordered so every default is distinct on every package.
//
//  The third guard is smaller and concrete: no default may land on the debug pads. B7's
//  first option used to be PB9, which is SWIO/SWDIO, so enabling the display collided with
//  the debug port before the user had touched anything.
//
//  THE LAYER PIXEL FORMAT is asserted here too, and its history is the round in miniature.
//  L8 / AL44 / AL88 (RM 43.4.18) are eight-bit-per-pixel FRAME BUFFER formats: they save RAM
//  and free no pin, which is a different axis from the wiring above and the reason both live
//  on one peripheral. Round 5 made it selectable but emitted only a COMMENT, because
//  `LTDC_LayerPixelFormat()` rescales `CFBLR` from a layer width that is 0 at init. Round 6
//  made that unnecessary: `channel_params` fills one `LTDC_Layer_InitTypeDef` PER LAYER -
//  geometry, pitch and format together - and applies it with `LTDC_LayerInit(LTDC_Layerx, &s)`.
//  The checks below therefore now require the register write that round 5 forbade. The rule
//  never moved: emit a write only when every field it needs can be computed.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { suite, test, assert } from './lib/harness.js';
import { ROOT } from './lib/app.js';
import * as eng from '../app/engine/index.js';
import { withMutantMcu } from './lib/mutant.js';

suite('CH32H417 LTDC');

const PART = 'CH32H417';
const PACKAGES = ['QFN68', 'QFN88', 'QFN128'];

function boot() {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'vendor', 'js-yaml.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  eng.setYaml(mod.exports);
  eng.loadPackages(eng.yamlLoad(fs.readFileSync(path.join(ROOT, 'data', 'packages', 'packages.yaml'), 'utf8')));
  const dir = path.join(ROOT, 'data', 'mcus');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yaml')).sort()) {
    eng.registerMcuFile(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}
boot();

const load = pkg => { eng.loadMcu(eng.MCU_FILES[PART]); eng.setPackage(pkg); };
const display = depth => {
  eng.setSetting('LTDC', 'Colour depth', depth);
  eng.setSetting('LTDC', 'Sync and clock', 'Enabled');
};
/** Every pad LTDC currently holds. */
function ltdcPads() {
  eng.compute();
  const out = new Set();
  for (const r of eng.pinRows()) {
    for (const p of String(r.signal || '').split(' / ')) if (p.startsWith('LTDC_')) out.add(r.name);
  }
  return out;
}
const defaultPin = sig => eng.M.peripherals.LTDC.signal_pins[sig][0].pin;

// The standard panel wiring: the panel's most significant bit goes to the controller's,
// so a narrower bus drops the LOW lines of each channel. 24 / 18 / 16 lines plus the four
// timing signals (CLK, HSYNC, VSYNC, DE) on every one.
const DEPTHS = [
  ['RGB888', 24, []],
  ['RGB666', 18, ['R0', 'R1', 'G0', 'G1', 'B0', 'B1']],
  ['RGB565', 16, ['R0', 'R1', 'R2', 'G0', 'G1', 'B0', 'B1', 'B2']],
];

for (const pkg of PACKAGES) {
  test(`${pkg}: no two LTDC signals share a default pad`, () => {
    // The defect this file was written for. It has to hold per package, because the
    // default is "the first option BONDED here" and the three packages bond differently.
    load(pkg);
    const bonded = new Set();
    for (const v of Object.values(eng.M.packages[pkg])) for (const n of [].concat(v)) bonded.add(String(n));
    const seen = new Map();
    const clashes = [];
    for (const [sig, opts] of Object.entries(eng.M.peripherals.LTDC.signal_pins)) {
      const pin = (opts.find(o => bonded.has(String(o.pin))) || opts[0]).pin;
      if (seen.has(pin)) clashes.push(`${pin} is the default for both LTDC_${seen.get(pin)} and LTDC_${sig}`);
      seen.set(pin, sig);
    }
    assert.empty(clashes, `LTDC signals sharing one default pad on ${pkg} — one pad drives one bit`);
  });

  test(`${pkg}: switching the display on conflicts with nothing`, () => {
    // Including the debug port: no LTDC default may land on SWCLK/SWIO (PB8/PB9).
    for (const [depth] of DEPTHS) {
      load(pkg);
      display(depth);
      const E = eng.compute();
      assert.equal(E.conflictList.length, 0,
        `LTDC ${depth} on ${pkg} should be conflict-free out of the box, got: `
        + E.conflictList.map(c => c.text).join(' | '));
    }
  });
}

test('each colour depth claims the right number of lines', () => {
  const bad = [];
  for (const [depth, colourLines] of DEPTHS) {
    load('QFN128');
    display(depth);
    const pads = ltdcPads();
    // colour lines + CLK/HSYNC/VSYNC/DE, each on its own pad now that defaults are distinct
    if (pads.size !== colourLines + 4) {
      bad.push(`${depth} should hold ${colourLines + 4} pads (${colourLines} colour + 4 timing), holds ${pads.size}`);
    }
  }
  assert.empty(bad, 'colour depths claiming the wrong number of pads');
});

test('a narrower panel releases its low colour lines, and they can be used', () => {
  // THE POINT OF THE WHOLE ROW. Pick 16-bit, get eight pins back, and put them to work.
  const bad = [];
  for (const [depth, , freed] of DEPTHS) {
    load('QFN128');
    display(depth);
    const pads = ltdcPads();
    for (const sig of freed) {
      if (pads.has(defaultPin(sig))) bad.push(`${depth} should release LTDC_${sig} (${defaultPin(sig)}), but it is still claimed`);
    }
  }
  assert.empty(bad, 'colour lines a narrower panel should have released');

  // ...and the released pads really are free: take all eight with manual GPIO.
  load('QFN128');
  display('RGB565');
  for (const sig of ['R0', 'R1', 'R2', 'G0', 'G1', 'B0', 'B1', 'B2']) {
    eng.assignSignal(defaultPin(sig), { gpio: 'GPIO_Output' });
  }
  const E = eng.compute();
  assert.equal(E.conflictList.length, 0,
    'the eight lines RGB565 does not wire should be assignable to something else, got: '
    + E.conflictList.map(c => c.text).join(' | '));

  const c = eng.cFiles()['wchcube_init.c'] || '';
  assert.notOk(/TODO/.test(c), 'the generated C should carry no TODO for a 16-bit panel plus eight reused pins');
  assert.notOk(/#error/.test(c), 'the generated C should carry no #error');
});

test('the file says the output width is wiring, not a register', () => {
  // The user-visible half. `notes:` is what the configurator shows next to the
  // peripheral, and it is where the "your spare pins are free" fact has to live — the
  // question this file answers is one a person asks of the app, not of the source tree.
  eng.loadMcu(eng.MCU_FILES[PART]);
  const notes = String(eng.M.peripherals.LTDC.notes || '');
  assert.ok(notes.length > 200, 'LTDC should carry a notes: paragraph explaining the width');
  for (const re of [/24 bits? wide/i, /wired/i, /assigned to another peripheral/i]) {
    assert.match(notes, re, `LTDC notes should say something matching ${re}`);
  }
  // ...and it must not repeat the claim that an 8-bit format frees pins, because it does not.
  assert.match(notes, /frame buffer|memory/i,
    'LTDC notes should say that an 8-bit format is a frame-buffer format, not a pin count');
});


// =============================================================================
//  THE LAYER PIXEL FORMAT — selectable for PLANNING, and emitting no register write.
//
//  The question this answers is the one people actually ask of this controller: *can it do
//  8-bit, and can I pick that here?* Until 2026-09-12 the answer to the second half was no,
//  and the recorded reason was that `LTDC_Layer_InitTypeDef` is filled once per LAYER while
//  `codegen.init_structs` maps a struct to one function. The reason was right that a struct
//  cannot be emitted; it was wrong about the cheap path, because the SDK also has a plain
//  two-argument setter, `LTDC_LayerPixelFormat(LTDC_Layerx, fmt)`, and `sdk_args:` passes a
//  non-placeholder like `LTDC_Layer1` through literally.
//
//  READING THAT SETTER IS WHY THE ROW EMITS NOTHING. `ch32h417_ltdc.c:622-672` is a
//  RECONFIGURE call, not an init one: it reads the current `PFCR` for the old bytes-per-pixel,
//  divides `CFBLR >> 16` — the frame-buffer line length, which `LTDC_LayerInit()` computes
//  from the layer WIDTH — to recover a pixel count, and re-multiplies by the new
//  bytes-per-pixel. At reset `CFBLR` is 0, so a generated init calling it would write a line
//  length of 3 bytes and a pitch of 0: a broken display, compiling perfectly, with nothing in
//  the configurator to show it. The SDK's own doc comment (`:619-620`) adds that a
//  shadow-register reload must follow it.
//
//  So the row records the choice and states it in the generated C as a comment, and the layer
//  init that owns the geometry applies it. These tests hold BOTH halves: that the choice is
//  really offered and reaches the C, and that no register write, TODO or `#error` appears
//  because of it. The second half is the one that would rot quietly.
// =============================================================================

const FORMATS = ['ARGB8888', 'RGB888', 'RGB565', 'ARGB1555', 'ARGB4444', 'L8', 'AL44', 'AL88'];
const EIGHT_BIT = ['L8', 'AL44', 'AL88'];

// THE FORMAT MOVED, AND IT MOVED THE RIGHT WAY (2026-09-13, AGENT-1's 74a1e12). It used to be
// two peripheral-level `params:` rows, `layer1_format` / `layer2_format`, that emitted a COMMENT
// and no register write - because `LTDC_LayerPixelFormat()` rescales `CFBLR` from a layer width
// that is 0 at init, so calling it there would have written a bogus frame-buffer line length.
// That reasoning is now SUPERSEDED rather than wrong: `channel_params` (deliverable E) fills one
// `LTDC_Layer_InitTypeDef` PER LAYER - geometry, pitch and format together - and applies it with
// `LTDC_LayerInit(LTDC_Layerx, &s)`, which is the init path the SDK actually documents. So the
// format now reaches the C as a real assignment, and these checks assert the opposite of what
// they asserted in round 5. Kept as a record because "the generator must not emit a register
// write it cannot compute" was the right rule, and the answer was to compute the rest of it.
const layerParams = () => ((eng.M.peripherals.LTDC.channel_params || {}).params || []);
const formatParam = () => layerParams().find(p => p.key === 'pixel_format');
const layerInstances = () => Object.keys((eng.M.peripherals.LTDC.channel_params || {}).instances || {});

test('both layers offer all eight pixel formats, and the 8-bit ones are among them', () => {
  eng.loadMcu(eng.MCU_FILES[PART]);
  const inst = layerInstances();
  assert.deep(inst, ['1', '2'],
    'LTDC should carry one layer instance per layer; this controller has exactly two '
    + '(LTDC_Layer1 / LTDC_Layer2, ch32h417.h:1770-1771)');
  const d = formatParam();
  assert.ok(d, `no pixel_format in LTDC.channel_params; keys are ${layerParams().map(x => x.key).join(', ')}`);
  const names = (d.options || []).map(o => o.name);
  assert.deep(names, FORMATS, 'pixel_format does not offer exactly the eight formats of LTDC_LxPFCR.PF[2:0]');
  // PF[2:0] is a 3-bit field and the option values ARE the encoding, so an off-by-one here is a
  // wrong register value rather than a cosmetic slip.
  assert.deep((d.options || []).map(o => o.value), [0, 1, 2, 3, 4, 5, 6, 7],
    'pixel_format option values must be the PF[2:0] encoding from RM 43.4.18');
  for (const f of EIGHT_BIT) {
    assert.includes(names, f, `pixel_format must offer ${f} - the eight-bit-per-pixel formats are the point`);
  }
});

test('every pixel format names a macro that exists in this part\'s own SPL header', () => {
  // verify_sdk_names.py checks this too, as a gate. It is repeated here because this file is
  // where someone adds a ninth format, and a macro that does not exist should fail next to the
  // change rather than in a different tool.
  const inc = path.join(ROOT, 'data', 'sources', 'H417', 'Evt', 'EXAM', 'SRC', 'Peripheral', 'inc', 'ch32h417_ltdc.h');
  if (!fs.existsSync(inc)) return assert.ok(true, 'no EVT drop on this machine - verify_sdk_names.py covers it');
  const h = fs.readFileSync(inc, 'utf8');
  eng.loadMcu(eng.MCU_FILES[PART]);
  const bad = [];
  for (const o of formatParam().options || []) {
    if (!o.sdk) { bad.push(`${o.name}: no sdk: macro`); continue; }
    if (!new RegExp('#define\\s+' + o.sdk + '\\b').test(h)) bad.push(`${o.name}: ${o.sdk} is not #defined in ch32h417_ltdc.h`);
  }
  assert.empty(bad, 'pixel-format macros the SPL header does not define');
});

/** Enable the display and one layer, on `pkg`. */
function withLayer(pkg, depth = 'RGB565') {
  load(pkg);
  display(depth);
  eng.setSetting('LTDC', 'Layer 1', 'Enabled');
}

test('choosing an 8-bit format claims no pin and releases none', () => {
  // The whole reason the two axes are separate. `Colour depth` is the WIRING and moves pins; the
  // pixel format is the FRAME BUFFER and must move none. If this ever fails, one of the two has
  // been wired into the other and the notes are lying to the user.
  for (const pkg of PACKAGES) {
    withLayer(pkg);
    const before = ltdcPads();
    for (const f of FORMATS) {
      withLayer(pkg);
      eng.setChannelParam('LTDC', 1, 'pixel_format', f);
      assert.deep([...ltdcPads()].sort(), [...before].sort(),
        `${pkg}: pixel format ${f} changed which pads LTDC holds - it is a memory format, not a wiring one`);
    }
  }
});

test('the chosen format reaches the generated C as a real LTDC_LayerInit, with no TODO', () => {
  // BOTH halves in one test on purpose: "it is recorded" and "it costs nothing wrong" are the two
  // things a user is promised, and a change that breaks either should not pass by satisfying the
  // other. In round 5 this test asserted that NO call was emitted; the per-instance struct landed
  // and now the call is the correct output. What has not changed is the rule underneath: the
  // generator emits a register write only when it can compute every field it needs.
  withLayer('QFN128');
  eng.setChannelParam('LTDC', 1, 'pixel_format', 'L8');
  const E = eng.compute();
  assert.equal(E.conflictList.length, 0, 'picking a pixel format must not create a pin conflict');

  const c = eng.cFiles()['wchcube_init.c'] || '';
  assert.match(c, /LTDC_PixelFormat\s*=\s*LTDC_Pixelformat_L8/,
    'the generated C does not assign the chosen layer-1 pixel format');
  assert.match(c, /LTDC_LayerInit\(\s*LTDC_Layer1\s*,/,
    'the format is assigned but never applied - LTDC_LayerInit(LTDC_Layer1, ...) is missing');
  assert.notOk(/TODO/.test(c), 'choosing a pixel format must not emit a TODO');
  assert.notOk(/#error/.test(c), 'choosing a pixel format must not emit an #error');

  // ...and NOT the reconfigure call, which would be wrong-but-compiling at init: it rescales
  // CFBLR from a layer width that is still 0 before LTDC_LayerInit() has run
  // (ch32h417_ltdc.c:622-672). The init path is right; that one never was.
  const code = c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.notOk(/LTDC_LayerPixelFormat\s*\(/.test(code),
    'the generated init calls LTDC_LayerPixelFormat(), which rescales CFBLR from a layer width '
    + 'that is 0 at init - a 3-byte line length and a pitch of 0, compiling perfectly');

  // The user still needs somewhere for their own code, and it must survive regeneration.
  assert.match(c, /USER CODE BEGIN Periph_LTDC/, 'LTDC should carry a USER CODE block');
});

test('a layer that is not enabled emits no init for itself', () => {
  // The other half of per-instance: layer 2 is off here, so its struct must not be written.
  // An init for a disabled layer is a register write the user did not ask for.
  withLayer('QFN128');
  const c = eng.cFiles()['wchcube_init.c'] || '';
  assert.match(c, /LTDC_LayerInit\(\s*LTDC_Layer1\s*,/, 'layer 1 is enabled and should be initialised');
  assert.notOk(/LTDC_LayerInit\(\s*LTDC_Layer2\s*,/.test(c),
    'layer 2 is disabled, but the generated C initialises it anyway');
});

test('the format is remembered across save and reload', () => {
  // A planning choice that does not survive the project file is not a planning choice.
  withLayer('QFN128');
  eng.setChannelParam('LTDC', 1, 'pixel_format', 'AL44');
  const text = eng.projectSerialize();
  assert.includes(text, 'AL44', 'the chosen pixel format is not written into the .wchproj');

  load('QFN128');
  assert.notEqual(eng.channelParamValue('LTDC', 1, 'pixel_format'), 'AL44', 'the probe did not actually reset');
  eng.projectApply(text);
  eng.compute();
  assert.equal(eng.channelParamValue('LTDC', 1, 'pixel_format'), 'AL44', 'the pixel format did not survive a reload');
});

// =============================================================================
//  THE PLANTED BREAK — round 6, deliverable B. This file was written for one defect: on
//  2026-09-12 PA8 was the first option for BOTH LTDC_R6 and LTDC_B3, and every gate was
//  green. The fix that survived the regenerator is B3's — PA8 is now its LAST option — while
//  R6 still leads with PA8. So the historical defect is one move away: put PA8 back at the
//  front of B3, and the very first check in this file must go red on QFN128, naming PA8.
//  It is planted on a re-registered COPY of the part's text (tests/lib/mutant.js); the tree
//  is untouched and the restore is proved by re-running the check and requiring green.
// =============================================================================
test('planted break: putting PA8 back at the front of B3 re-creates the original R6/B3 collision, and it is caught', () => {
  const B3 = 'B3: [{ pin: PD10, af: 14 }, { pin: PD7, af: 14 }, { pin: PE0, af: 15 }, { pin: PF5, af: 14 }, { pin: PA8, af: 13 }]';
  const check = () => {
    load('QFN128');
    const bonded = new Set();
    for (const v of Object.values(eng.M.packages.QFN128)) for (const n of [].concat(v)) bonded.add(String(n));
    const seen = new Map(), clashes = [];
    for (const [sig, opts] of Object.entries(eng.M.peripherals.LTDC.signal_pins)) {
      const pin = (opts.find(o => bonded.has(String(o.pin))) || opts[0]).pin;
      if (seen.has(pin)) clashes.push(`${pin} is the default for both LTDC_${seen.get(pin)} and LTDC_${sig}`);
      seen.set(pin, sig);
    }
    return clashes;
  };
  assert.empty(check(), 'the baseline already has a shared LTDC default, so the plant could not be attributed');
  const clashes = withMutantMcu(eng, PART,
    src => src.replace(B3, 'B3: [{ pin: PA8, af: 13 }, { pin: PD10, af: 14 }, { pin: PD7, af: 14 }, { pin: PE0, af: 15 }, { pin: PF5, af: 14 }]'),
    check);
  assert.ok(clashes.length >= 1, 'PA8 shared by R6 and B3 was not reported — the 2026-09-12 defect would ship again');
  assert.ok(clashes.some(c => /^PA8 /.test(c) && /R6/.test(c) && /B3/.test(c)),
    `the report does not name PA8 with both R6 and B3:\n${clashes.join('\n')}`);
  console.log(`      planted refusal (LTDC default): ${clashes[0]}`);
  assert.empty(check(), 'the original part was not restored after the plant');
});
