// project.js — .wchproj must round-trip 100% of the state, or a saved project
// silently loses work.
import { test, assert, fresh, snapshot, jsyaml, mcuNames } from './_harness.js';

// A project with something switched on in every part of the state.
function configure(e) {
  e.setPackage('QFN20');
  e.S.periph.USART1.settings.Mode = 'Asynchronous';
  e.S.periph.USART1.settings['Hardware Flow Control'] = 'CTS/RTS';
  e.S.periph.USART1.remap = 2;
  e.S.periph.ADC1.settings.Channels.add('IN2');
  e.S.periph.ADC1.settings.Channels.add('IN5');
  e.S.periph.SYS.settings['External reset pin'] = 'RST disabled — pin is GPIO (RST_MODE=11)';
  e.assignSignal('PC4', { gpio: 'GPIO_Output' });
  // '30 MHz' because that is the only speed CH32V006 has (gpio.speeds). A project
  // storing a speed the part does not have is a migration case, tested on its own below.
  e.S.gpio.PC4 = { mode: 'Output Open Drain', pull: 'Pull-up', speed: '30 MHz', label: 'LED_STATUS' };
  e.S.clock.sys = 'PLLCLK';
  e.S.clock.pre.HB = 2;
  e.S.clock.hse = 12;
  e.setProject({ name: 'Blinky', variant: 'CH32V006F8U7' });
  e.compute();
}

test('a project round-trips through YAML with no loss', () => {
  const e = fresh();
  configure(e);
  const before = snapshot(e.S);
  const beforeProject = { ...e.PROJECT };
  const text = e.projectSerialize();

  e.loadMcu(e.MCU_FILES.CH32V006);                 // wipe everything
  e.setProject({ name: 'Untitled', variant: null, dirty: true });
  assert.notDeepEqual(snapshot(e.S), before);

  e.projectApply(text);
  assert.deepEqual(snapshot(e.S), before);
  assert.equal(e.PROJECT.name, beforeProject.name);
  assert.equal(e.PROJECT.variant, beforeProject.variant);
  assert.equal(e.PROJECT.dirty, false);
});

// Round-3 P0b. Before the one-speed fix the GPIO table offered Low / Medium / High,
// none of which this silicon has, and projects saved then are on people's disks.
test('opening a project saved with a speed this part never had rewrites it, and says so', () => {
  const e = fresh();
  configure(e);
  const text = e.projectSerialize().replace("speed: 30 MHz", "speed: High");
  assert.match(text, /speed: High/, 'setup: the file really says High');

  e.projectApply(text);
  assert.equal(e.S.gpio.PC4.speed, '30 MHz', 'S must not carry a speed the part cannot express');
  assert.ok(e.PROJECT.warnings.some(w => /PC4/.test(w) && /"High"/.test(w) && /"30 MHz"/.test(w)),
    'and the user is told, rather than the change happening behind their back: ' + JSON.stringify(e.PROJECT.warnings));
  // everything else about the project survived the rewrite
  assert.equal(e.S.gpio.PC4.label, 'LED_STATUS');
  assert.equal(e.S.gpio.PC4.mode, 'Output Open Drain');
  assert.equal(e.S.pkg, 'QFN20');
  assert.ok(e.cSource().includes('GPIO_Speed_30MHz'), 'and it generates a macro that exists');
});

test('setGpioField refuses a speed a multi-speed part does not offer', () => {
  const e = fresh();
  e.registerMcuFile(`
mcu:
  name: CH32V006-TWOSPEED-P
  inherits: CH32V006
gpio:
  speeds:
    - { name: "10 MHz", macro: GPIO_Speed_10MHz }
    - { name: "30 MHz", macro: GPIO_Speed_30MHz }
`);
  e.loadMcu('CH32V006-TWOSPEED-P');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  assert.throws(() => e.setGpioField('PC0', 'speed', 'High'), /has no output speed "High".*10 MHz, 30 MHz/);
  assert.equal(e.S.gpio.PC0.speed, '10 MHz', 'the rejected write left the assign-time default alone');
  assert.equal(e.canUndo(), true, 'the assignment itself is still undoable');
  e.setGpioField('PC0', 'speed', '10 MHz');
  assert.equal(e.S.gpio.PC0.speed, '10 MHz');
});

test('a one-speed part quietly stores its own speed whatever the caller passes', () => {
  const e = fresh();
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.setGpioField('PC0', 'speed', 'High');
  assert.equal(e.S.gpio.PC0.speed, '30 MHz',
    'there is no choice to get wrong here, so a stale caller is corrected rather than broken');
});

test('the saved file is readable YAML with the fields a human would expect', () => {
  const e = fresh();
  configure(e);
  const obj = jsyaml.load(e.projectSerialize());
  assert.equal(obj.wchproj, 1);
  assert.equal(obj.mcu, 'CH32V006');
  assert.equal(obj.package, 'QFN20');
  assert.equal(obj.variant, 'CH32V006F8U7');
  assert.equal(obj.name, 'Blinky');
  assert.deepEqual(obj.peripherals.ADC1.settings.Channels, ['IN2', 'IN5']);   // Sets become lists
  assert.equal(obj.peripherals.USART1.remap, 2);
  assert.equal(obj.gpio_manual.PC4, 'GPIO_Output');
  assert.equal(obj.gpio_settings.PC4.label, 'LED_STATUS');
  assert.equal(obj.clock.sys, 'PLLCLK');
  assert.ok(!/\*ref_|&ref_/.test(e.projectSerialize()), 'no YAML anchors — the file must stay readable');
});

test('the engine result is identical after reopening', () => {
  const e = fresh();
  configure(e);
  const before = JSON.stringify(e.compute().pins);
  const text = e.projectSerialize();
  e.loadMcu(e.MCU_FILES.CH32V006);
  e.projectApply(text);
  assert.equal(JSON.stringify(e.compute().pins), before);
});

test('opening a project for an MCU that is not loaded says which one', () => {
  const e = fresh();
  const text = e.projectSerialize().replace('mcu: CH32V006', 'mcu: CH32V999');
  assert.throws(() => e.projectApply(text), /CH32V999.*not loaded/s);
});

test('a file that is not a project is rejected', () => {
  const e = fresh();
  assert.throws(() => e.projectApply('hello: world\n'), /Not a WCHCube project file/);
});

test('unknown peripherals, settings and remap indices in a project are ignored, not fatal', () => {
  const e = fresh();
  configure(e);
  const obj = jsyaml.load(e.projectSerialize());
  obj.peripherals.NOSUCHPERIPH = { settings: { Mode: 'On' }, remap: 3 };
  obj.peripherals.USART1.settings['No Such Setting'] = 'x';
  obj.peripherals.USART1.settings.Mode = 'No Such Mode';
  obj.peripherals.I2C1.remap = 99;
  e.projectApply(obj);
  assert.equal(e.S.periph.USART1.settings.Mode, 'Disable', 'an unknown choice falls back to the default');
  assert.equal(e.S.periph.I2C1.remap, 0, 'an out-of-range remap index is ignored');
  assert.equal(e.S.periph.NOSUCHPERIPH, undefined);
});

test('a project saved for a package the MCU does not have keeps the default package', () => {
  const e = fresh();
  configure(e);
  const obj = jsyaml.load(e.projectSerialize());
  obj.package = 'LQFP144';
  e.projectApply(obj);
  assert.equal(e.S.pkg, 'TSSOP20');
});

// ---------------------------------------------------------------- format versioning

test('a saved project carries the format number the build understands', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const obj = e.projectObject();
  assert.equal(obj.wchproj, e.PROJECT_FORMAT);
  assert.equal(typeof e.PROJECT_FORMAT, 'number');
});

test('a project from a newer WCHCube is refused by name, not half applied', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const obj = e.projectObject();
  obj.wchproj = e.PROJECT_FORMAT + 3;
  assert.throws(() => e.projectApply(obj), /saved in format \d+ by a newer WCHCube/);
  assert.throws(() => e.projectApply({ name: 'no version' }), /no `wchproj:` version key/);
  assert.throws(() => e.projectApply({ wchproj: 'x' }), /Not a WCHCube project file/);
});

test('migrateProject walks an old file forward one step at a time', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const current = e.PROJECT_FORMAT;
  // Pretend this build is one format ahead, with a migration for the step.
  const older = { ...e.projectObject(), wchproj: current, legacy_name: 'from the old days' };
  e.MIGRATIONS[current] = obj => ({ ...obj, wchproj: current + 1, name: obj.legacy_name || obj.name });
  try {
    // migrateProject stops at PROJECT_FORMAT, so with no bump it must NOT run the step
    assert.equal(e.migrateProject(older).wchproj, current, 'a current file is left alone');
    // and a file one behind a bumped format is carried forward
    const ancient = { ...older, wchproj: current - 1 };
    if (current > 1) {
      e.MIGRATIONS[current - 1] = obj => ({ ...obj, wchproj: current });
      assert.equal(e.migrateProject(ancient).wchproj, current);
    }
  } finally {
    delete e.MIGRATIONS[current];
    delete e.MIGRATIONS[current - 1];
  }
});

test('an unmigratable old file says so instead of loading wrong', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const obj = { ...e.projectObject(), wchproj: 0 };
  assert.throws(() => e.migrateProject(obj), /Not a WCHCube project file/);
});

// Round 3 made this a DONE line and it stayed open for two rounds: **regenerating after
// save -> close -> open is byte-identical, INCLUDING DMA and NVIC**. The test above
// compares `S` on one part with a hand-written configuration; that cannot see a value
// that survives the store and changes the generated C, and it cannot see DMA or NVIC at
// all. This is the sweep: every part x every package, every peripheral switched on, every
// DMA request the part offers added, every request moved to another legal channel, every
// DMA_InitTypeDef enum driven to a different option, and twenty NVIC vectors enabled at
// four priorities - then saved, opened in a FRESH engine, and compared four ways.
//
// The `saved:` line is excluded and nothing else is: it records when the file was
// written, so it is supposed to differ. Measured on 2026-09-12: 33 part x package
// combinations, up to 38 DMA requests on 8 channels with 304 parameter edits, in 3.6 s.
test('save -> close -> open -> regenerate is byte-identical, including DMA and NVIC', () => {
  const strip = t => t.split('\n').filter(l => !/^saved:/.test(l)).join('\n');
  let moved = 0, withDma = 0, combos = 0, choosable = 0, movedChannels = 0;
  for (const name of mcuNames()) {
    for (const pkg of Object.keys(fresh(name).M.packages)) {
      const e = fresh(name, pkg);
      for (const pid of Object.keys(e.M.peripherals)) {
        for (const st of (e.M.peripherals[pid].settings || [])) {
          const live = (st.choices || []).find(c => (c.signals || []).length);
          if (live) { try { e.setSetting(pid, st.name, live.name); } catch { /* a checkbox */ } }
        }
      }
      // DMA, and it has to MOVE: a byte-comparison that cannot move is not evidence.
      // `dmaAddableRequests()` returns objects, not names - passing the object silently
      // adds nothing, which is exactly how this check was vacuous when it was written.
      for (const r of e.dmaAddableRequests()) { try { e.addDmaRequest(r.request); } catch { /* full */ } }
      const reqs = e.dmaRequests();
      for (const r of reqs) {
        const legal = e.dmaLegalChannels(r.request);
        if (legal.length > 1) {
          choosable++;
          if (String(legal[legal.length - 1]) !== String(r.channel)) {
            try { e.setDmaRequest(r.id, { channel: String(legal[legal.length - 1]) }); moved++; movedChannels++; } catch { /* taken */ }
          }
        }
        for (const d of e.dmaParamDefs()) {
          if (!d.options || d.options.length < 2) continue;
          const alt = d.options[d.options.length - 1];
          try { e.setDmaParam(r.id, d.key, String(alt.name !== undefined ? alt.name : alt)); moved++; } catch { /* not settable */ }
        }
      }
      const vectors = e.nvicVectors().slice(0, 20);
      vectors.forEach((v, i) => { try { e.setNvicVector(v.name, { enabled: true, priority: i % 4 }); } catch { /* fixed */ } });
      e.compute();

      const saved = e.projectSerialize();
      const c = e.cSource();
      const dma = JSON.stringify(e.dmaRequests());
      const nvic = JSON.stringify(e.nvicVectors().filter(v => v.enabled));

      const g = fresh(name, pkg);                      // a genuinely fresh engine
      g.projectApply(saved);
      g.compute();
      const where = `${name}/${pkg}`;
      assert.equal(strip(g.projectSerialize()), strip(saved), `${where}: the project file`);
      assert.equal(g.cSource(), c, `${where}: the generated C`);
      assert.equal(JSON.stringify(g.dmaRequests()), dma, `${where}: the DMA requests`);
      assert.equal(JSON.stringify(g.nvicVectors().filter(v => v.enabled)), nvic, `${where}: the NVIC vectors`);
      if (reqs.length) withDma++;
      combos++;
    }
  }
  // The sweep has to have swept something. Without these three the whole test passes on
  // an empty configuration and proves nothing - which is how it read before `.request`.
  assert.ok(combos >= 20, `the sweep must cover every part x package (covered ${combos})`);
  assert.ok(withDma >= 4, `several parts must actually have configured DMA (had ${withDma})`);
  assert.ok(moved > 500, `DMA channels and parameters must have been CHANGED (${moved} edits)`);

  // ONE HALF OF THIS TEST CANNOT FAIL TODAY, AND SAYING SO IS THE POINT. Deleting
  // `channel:` from `dmaObject()` leaves this test green - run as a plant on 2026-09-12 -
  // because NOT ONE DMA request on ANY shipped part has more than one legal channel:
  // every request is hard-wired to its channel in the silicon, so reopening re-derives
  // the same number whether the file carried it or not. That is a fact about the data,
  // not a hole in the serialiser, and template.html's DMA tab says the same thing where
  // it declines to draw a channel selector.
  //
  // So the assertion is on the CONDITION rather than on the outcome: while no request has
  // a choice, nothing is required; the day a part ships one, this test starts demanding
  // that the choice was exercised, and the comment above becomes provably stale.
  assert.equal(choosable > 0, movedChannels > 0,
    `${choosable} request(s) have a channel CHOICE but ${movedChannels} were moved - `
    + 'a part with a selectable DMA channel now exists, so this sweep must exercise it');
});

// ---------------------------------------------------------------- projectDiff, §7 APP P1
// "What did I change" between two .wchproj files, readably - built on the same
// projectApply()/compute() every "Open project…" already goes through, never a second
// parallel reading of the raw YAML, so a diff line can never disagree with what the app
// itself would show for the same file.

test('projectDiff on the same project text reports unchanged everywhere', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.compute();
  const text = e.projectSerialize();

  const out = e.projectDiff(text, text);
  assert.match(out, /MCU: CH32V006 \(unchanged\)/);
  assert.match(out, /Package: TSSOP20 \(unchanged\)/);
  assert.match(out, /Pins: unchanged\./);
  assert.match(out, /Settings: unchanged\./);
  assert.match(out, /Params: unchanged\./);
  assert.match(out, /Clock: unchanged\./);
  assert.match(out, /DMA, NVIC and generator options: unchanged\./);
  assert.equal(/NOTE:/.test(out), false, 'no cross-MCU note on a same-part diff');
});

test('projectDiff reports a changed pin, setting, param and clock choice, and nothing it did not change', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const a = e.projectSerialize();

  e.assignSignal('PC0', { gpio: 'GPIO_Output' });
  e.S.gpio.PC0.label = 'LED';
  e.setSetting('USART1', 'Mode', 'Asynchronous');
  e.setParam('USART1', 'baud', 9600);
  e.S.clock.sys = 'PLLCLK';
  e.compute();
  const b = e.projectSerialize();

  const out = e.projectDiff(a, b);
  assert.match(out, /PC0: \(unassigned\) -> GPIO_Output/, out);
  assert.match(out, /PC0 label: \(unassigned\) -> LED/, out);
  assert.match(out, /USART1\.Mode: .* -> Asynchronous/, out);
  assert.match(out, /USART1\.Baud rate: .* -> 9600/, out);
  assert.match(out, /SYSCLK source: .* -> PLLCLK/, out);
  assert.match(out, /Pins \(\d+ changed\):/);
  assert.match(out, /Settings \(\d+ changed\):/);
  assert.match(out, /Params \(\d+ changed\):/);
  assert.match(out, /Clock \(\d+ changed\):/);
  // a peripheral never touched must not show up as a false positive
  assert.equal(new RegExp('\\bSPI1\\.').test(out), false, out);
});

test('projectDiff runs a stale field through the same rewrite Open project uses, not a raw text compare', () => {
  // If this used a second, parallel YAML reader instead of projectApply(), a file
  // needing a migration or a speed rewrite (see "opening a project saved with a
  // speed this part never had" above) would diff the RAW, pre-rewrite text - silently
  // wrong, and disagreeing with what the app itself would show for the same file.
  const e = fresh('CH32V006', 'TSSOP20');
  configure(e);
  const a = e.projectSerialize();
  const b = a.replace('speed: 30 MHz', 'speed: High');   // "High" does not exist on this part
  assert.match(b, /speed: High/, 'setup: the file really says High');

  const out = e.projectDiff(a, b);
  // "High" is not a real speed on this one-speed part - the rewrite must have run
  // and put it back to 30 MHz before the diff ever compared anything, so A and B's
  // PC4 speed must read identical rather than "High" appearing as the after value.
  assert.equal(/-> High\b/.test(out), false, out);
  assert.equal(/\bPC4\b.*speed/i.test(out), false, 'a rewrite back to the same value is not a change: ' + out);
});

test('projectDiff prints a cross-MCU note when the two projects are for different parts', () => {
  const e = fresh('CH32V006', 'QFN32');
  const a = e.projectSerialize();
  const f = fresh('CH32L103', 'QFN32');
  const b = f.projectSerialize();

  const out = e.projectDiff(a, b);
  assert.match(out, /MCU: CH32V006 -> CH32L103/);
  assert.match(out, /NOTE: the two projects are for different parts/);
  assert.match(out, /Pins \(\d+ changed\):/, 'cross-part pin sets must show as changed, not "unchanged"');
});

test('projectDiff on a project naming an MCU that is not loaded says which of the two files, and which part', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  const a = e.projectSerialize();
  const bogus = a.replace('mcu: CH32V006', 'mcu: CH32V999');
  assert.throws(() => e.projectDiff(a, bogus), /B: "CH32V999" is not loaded/);
  assert.throws(() => e.projectDiff(bogus, a), /A: "CH32V999" is not loaded/);
});
