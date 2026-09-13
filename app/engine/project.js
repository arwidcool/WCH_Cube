// =============================================================================
//  project.js — one project = one MCU + one package + every setting, saved as
//  readable YAML (`.wchproj`). Pure: serialise/apply touch only M, S and PROJECT.
//  The browser download and the file dialogs live in the app shell.
// =============================================================================
import {
  M, S, MCU_FILES, loadMcu, applyPackageRemaps, yamlDump, yamlLoad, gpioSpeeds, gpioSpeedFor,
  defaultNvicGroup, signalPinOptions,
} from './model.js';
import {
  addDmaRequest, setDmaParam, setDmaRequest, dmaLegalChannels,
  setNvicVector, setNvicGroup, nvicGroups,
} from './resources.js';
import { generatorOptions, setGeneratorOption, pinRows } from './export.js';
import { normaliseGpioConstraints } from './constraints.js';
import {
  applyParams, paramsObject, applyChannelParams, channelParamsObject, paramDefs, paramValue,
} from './params.js';
import { clearHistory } from './history.js';
import { pllList, tapSources, clockCalc } from './clock.js';
import { compute } from './engine.js';

export const PROJECT = { name: 'Untitled', variant: null, dirty: false };

// The .wchproj format number. Bump it only when an OLD file would be read wrongly
// by new code, and add the migration in MIGRATIONS at the same time. Adding a key
// that old files simply lack is not a bump: applying it is already tolerant.
export const PROJECT_FORMAT = 1;

// n -> function that turns a format-n object into a format-(n+1) object.
// Each one must be pure and must not need M or S: a project is migrated before
// its MCU is even loaded.
export const MIGRATIONS = {
  // 1: obj => ({ ...obj, wchproj: 2, ... }),
};

/**
 * Bring a project object up to PROJECT_FORMAT, or explain why it cannot be.
 * A file from the future is refused by name rather than half-applied.
 */
export function migrateProject(obj) {
  if (!obj || typeof obj !== 'object' || obj.wchproj === undefined) {
    throw new Error('Not a WCHCube project file (no `wchproj:` version key).');
  }
  let v = Number(obj.wchproj);
  if (!Number.isInteger(v) || v < 1) throw new Error(`Not a WCHCube project file (wchproj: ${obj.wchproj}).`);
  if (v > PROJECT_FORMAT) {
    throw new Error(`This project was saved in format ${v} by a newer WCHCube; this build reads format ${PROJECT_FORMAT}. Update WCHCube, or re-save the project from the version that wrote it.`);
  }
  let out = obj;
  while (v < PROJECT_FORMAT) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from project format ${v} to ${v + 1}.`);
    out = step(out);
    v = Number(out.wchproj);
  }
  return out;
}

export function setProject(p) { Object.assign(PROJECT, p); }

export function projectObject() {
  const periph = {};
  for (const [pid, st] of Object.entries(S.periph)) {
    const settings = {};
    for (const [k, v] of Object.entries(st.settings)) settings[k] = v instanceof Set ? [...v] : v;
    periph[pid] = { settings, remap: st.remap };
    // Only signals the user actually moved. A default is not a decision, so a project
    // written before this key existed round-trips byte-identically and a diff shows
    // only what somebody chose - the same rule `generator:` and `dma:` follow.
    const af = {};
    for (const [sig, pin] of Object.entries(st.afPins || {})) if (pin) af[sig] = pin;
    if (Object.keys(af).length) periph[pid].af_pins = af;
    const params = paramsObject(pid);
    if (Object.keys(params).length) periph[pid].params = params;
    const chan = channelParamsObject(pid);
    if (Object.keys(chan).length) periph[pid].channel_params = chan;
  }
  return {
    wchproj: PROJECT_FORMAT,
    name: PROJECT.name,
    saved: new Date().toISOString(),
    mcu: M.mcu.name,
    variant: PROJECT.variant,
    package: S.pkg,
    peripherals: periph,
    gpio_manual: S.manual,
    gpio_settings: S.gpio,
    clock: S.clock,
    ...dmaObject(),
    ...nvicObject(),
    ...generatorObject(),
  };
}

// Only options the user actually changed, so a project written by a build with fewer
// options still opens and a diff shows only real decisions.
function generatorObject() {
  const opts = ((S.project || {}).options) || {};
  const out = {};
  for (const d of generatorOptions()) {
    if (opts[d.key] !== undefined && opts[d.key] !== d.default) out[d.key] = opts[d.key];
  }
  return Object.keys(out).length ? { generator: out } : {};
}

// Both blocks are omitted when the user has not touched them, so a project saved
// before either existed round-trips byte-identically and a diff of two .wchproj
// files shows only what somebody actually changed.
function dmaObject() {
  const list = S.dma && S.dma.requests;
  if (!list || !list.length) return {};
  return { dma: list.map(r => ({ request: r.request, channel: Number(r.channel), params: { ...r.params } })) };
}

function nvicObject() {
  const n = S.nvic || {};
  const vectors = {};
  for (const [name, st] of Object.entries(n.vectors || {})) {
    if (!st || (!st.enabled && st.preempt === undefined && st.sub === undefined)) continue;
    vectors[name] = { enabled: !!st.enabled, preempt: st.preempt, sub: st.sub };
  }
  const groupChanged = n.group !== undefined && n.group !== defaultNvicGroup(M.nvic);
  if (!Object.keys(vectors).length && !groupChanged) return {};
  return { nvic: { group: n.group || 0, vectors } };
}

export function projectSerialize() {
  return yamlDump(projectObject(), { noRefs: true, lineWidth: 120 });
}

// A .wchproj saved before the one-speed fix stores "Low" / "Medium" / "High" per pin -
// names this silicon has never had (round-3 P0b). Opening it must not carry them into S,
// where the GPIO table would show them and the generator would have to translate them
// forever. Rewrite them to a speed the part actually offers and say so, the same way an
// out-of-range parameter is reported rather than silently applied.
function normaliseGpioSpeeds() {
  const speeds = gpioSpeeds();
  if (!speeds.length) return [];
  const out = [];
  for (const [pin, g] of Object.entries(S.gpio)) {
    if (!g || g.speed === undefined || g.speed === '') continue;
    const fixed = gpioSpeedFor(g.speed);
    if (fixed === g.speed) continue;
    out.push(`${pin}: output speed "${g.speed}" is not one this part has; using "${fixed}".`);
    g.speed = fixed;
  }
  return out;
}

/**
 * The clock state from a .wchproj.
 *
 * This was `Object.assign(S.clock, obj.clock)` while the state was flat, and a flat
 * assign is exactly wrong now that `pre`, `preSrc` and `plls` are maps: assigning the
 * whole map REPLACES it, so a file saved before a tap existed would drop that tap's
 * divider from the state entirely and every frequency below it would read NaN. Each
 * map is merged key by key, and a value the part does not offer is dropped and named
 * rather than applied - the same contract as the GPIO speed and the DMA channel.
 */
function applyClock(saved) {
  const out = [];
  if (!saved || typeof saved !== 'object' || !M.clock || !S.clock) return out;
  const c = M.clock, k = S.clock;
  const drop = (what, val, why) => out.push(`Clock ${what}: "${val}" ${why}; using this part's default.`);
  for (const [key, val] of Object.entries(saved)) {
    if (key === 'pre') {
      for (const [name, v] of Object.entries(val || {})) {
        const pre = (c.prescalers || {})[name];
        if (!pre) { drop(`prescaler "${name}"`, v, 'is not a prescaler this part has'); continue; }
        if (!(pre.options || []).some(o => String(o) === String(v))) { drop(`prescaler ${name}`, v, 'is not one of its options'); continue; }
        k.pre[name] = v;
      }
    } else if (key === 'preSrc') {
      for (const [name, v] of Object.entries(val || {})) {
        const list = tapSources((c.prescalers || {})[name]);
        if (!list) { drop(`source mux "${name}"`, v, 'is not a mux this part has'); continue; }
        if (!list.includes(v)) { drop(`${name} source`, v, 'is not one of its sources'); continue; }
        (k.preSrc = k.preSrc || {})[name] = v;
      }
    } else if (key === 'plls') {
      const named = pllList(c).filter(p => !p.sys);
      for (const [id, st] of Object.entries(val || {})) {
        const p = named.find(n => n.id === id);
        if (!p || !st || typeof st !== 'object') { drop('PLL', id, 'is not a PLL this part has'); continue; }
        const held = ((k.plls = k.plls || {})[id] = k.plls[id] || {});
        if (st.in !== undefined) {
          if ((p.def.inputs || [])[st.in]) held.in = st.in;
          else drop(`${id} input`, st.in, 'is not one of its inputs');
        }
        if (st.mul !== undefined) {
          if ((p.def.multipliers || []).some(m => String(m) === String(st.mul))) held.mul = st.mul;
          else drop(`${id} multiplier`, st.mul, 'is not one of its multipliers');
        }
        if (st.div !== undefined) {
          if ((p.def.dividers || []).some(d => String(d) === String(st.div))) held.div = st.div;
          else drop(`${id} divider`, st.div, 'is not one of its dividers');
        }
      }
    } else {
      k[key] = val;
    }
  }
  return out;
}

/**
 * DMA requests from a .wchproj. Everything goes through the same setters the UI uses,
 * so a saved file can never put state into S that the engine would reject live: a
 * request the part no longer has, a channel it is not wired to, a parameter value out
 * of range. Each of those is dropped and reported, never applied - the project still
 * opens, minus the line that stopped being true.
 */
function applyDma(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const row of list) {
    if (!row || row.request === undefined) continue;
    const name = String(row.request);
    try {
      // The channel is only passed on when the part really offers a choice; otherwise
      // the hardware map decides and a stale one in the file is simply ignored.
      const legal = dmaLegalChannels(name);
      addDmaRequest(name, legal.length > 1 && row.channel !== undefined ? row.channel : undefined);
    } catch (e) { out.push(`dma ${name}: ${e.message}`); continue; }
    if (row.channel !== undefined && dmaLegalChannels(name).length > 1) {
      try { setDmaRequest(name, { channel: row.channel }); } catch (e) { out.push(`dma ${name}: ${e.message}`); }
    }
    for (const [k, v] of Object.entries(row.params || {})) {
      try { setDmaParam(name, k, v); } catch (e) { out.push(`dma ${name}: ${e.message}`); }
    }
  }
  return out;
}

/**
 * Generator options. An option this build does not have is dropped and reported -
 * a project saved by a build that could split files per peripheral must still open
 * on one that cannot, rather than quietly pretending the option is in force.
 */
function applyGenerator(obj) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    try { setGeneratorOption(k, v); }
    catch (e) { out.push(`generator: ${e.message}`); }
  }
  return out;
}

/** The same, for interrupt vectors and the priority grouping. */
function applyNvic(obj) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  if (obj.group !== undefined && nvicGroups().length) {
    try { setNvicGroup(obj.group); } catch (e) { out.push(`nvic: ${e.message}`); }
  }
  for (const [name, st] of Object.entries(obj.vectors || {})) {
    if (!st || typeof st !== 'object') continue;
    const patch = {};
    for (const k of ['enabled', 'preempt', 'sub']) if (st[k] !== undefined) patch[k] = st[k];
    if (!Object.keys(patch).length) continue;
    try { setNvicVector(name, patch); }
    catch (e) {
      out.push(`nvic ${name}: ${e.message}`);
      // a priority that no longer fits is not a reason to lose the enable
      if (patch.enabled !== undefined) {
        try { setNvicVector(name, { enabled: patch.enabled }); } catch (e2) { /* already reported */ }
      }
    }
  }
  return out;
}

// Restore a project. Throws with a human sentence if the MCU file is not loaded.
export function projectApply(src) {
  const obj = migrateProject(typeof src === 'string' ? yamlLoad(src) : src);
  const mcuSrc = MCU_FILES[obj.mcu];
  if (!mcuSrc) throw new Error(`This project is for "${obj.mcu}", which is not loaded. Use "Open MCU file…" to load its YAML first, then open the project again.`);

  loadMcu(mcuSrc);
  PROJECT.name = obj.name || 'Untitled';
  PROJECT.variant = obj.variant || null;
  if (obj.package in M.packages) S.pkg = obj.package;
  applyPackageRemaps();

  const dropped = [];
  for (const [pid, st] of Object.entries(obj.peripherals || {})) {
    if (!S.periph[pid]) continue;
    const P = M.peripherals[pid];
    for (const s of P.settings || []) {
      const v = (st.settings || {})[s.name];
      if (v === undefined) continue;
      if (s.type === 'checkboxes') S.periph[pid].settings[s.name] = new Set(Array.isArray(v) ? v : []);
      else if (s.choices.some(c => c.name === v)) S.periph[pid].settings[s.name] = v;
    }
    if (Number.isInteger(st.remap) && P.remaps && st.remap < P.remaps.length) S.periph[pid].remap = st.remap;
    // A saved pin the part no longer lists for that signal is DROPPED and named, never
    // carried: the same contract gpioSpeedFor() applies to a speed the part no longer
    // offers. Silently keeping it would put a pin the data does not allow into the
    // conflict engine and into generated C, where it compiles and does not work.
    for (const [sig, pin] of Object.entries(st.af_pins || {})) {
      const opts = signalPinOptions(pid, sig);
      if (opts.some(o => o.pin === pin)) S.periph[pid].afPins[sig] = pin;
      else if (opts.length) dropped.push(`${pid}_${sig}: ${pin} is not one of ${opts.map(o => o.pin).join(', ')}`);
      else dropped.push(`${pid}_${sig}: this part has no signal_pins entry for it`);
    }
    dropped.push(...applyParams(pid, st.params));
    dropped.push(...applyChannelParams(pid, st.channel_params));
  }
  S.manual = obj.gpio_manual || {};
  S.gpio = obj.gpio_settings || {};
  dropped.push(...normaliseGpioSpeeds());
  // A file written before the part stated a constraint, or one that violates it, opens
  // with no console error and says what it dropped - the same contract as the speed
  // above, through the same list. A stale value must never reach the GPIO table or the
  // generated C, where it would compile and not work on the board.
  dropped.push(...normaliseGpioConstraints());
  dropped.push(...applyDma(obj.dma));
  dropped.push(...applyNvic(obj.nvic));
  dropped.push(...applyGenerator(obj.generator));
  dropped.push(...applyClock(obj.clock));
  clearHistory();            // loadMcu already cleared it; be explicit
  PROJECT.dirty = false;
  // A project saved against an older MCU file may name parameters that no longer
  // exist or values now out of range. Those are dropped, never applied, and listed
  // here so the UI can say so instead of opening a file that silently lost settings.
  PROJECT.warnings = dropped;
  return PROJECT;
}

// =============================================================================
//  projectDiff — "what did I change" between two .wchproj files, readably. §7 APP
//  backlog: the most useful of the remaining items, because the format already
//  round-trips through this exact engine and needs no new data contract.
//
//  Both projects are loaded for REAL, one after the other, through the same
//  projectApply()/compute() every "Open project…" already goes through - never a
//  second, parallel reading of the raw YAML. That is what makes "PA9: SPI1 MOSI ->
//  (unassigned)" trustworthy: it is `pinRows()`'s own label, the one the pinout view
//  and the exported pin table already show, not a re-derivation that could disagree
//  with them. The one cost is real too: loading B overwrites the M/S the app's own
//  UI is showing, exactly like opening a project from the menu does - callers that
//  care what was open before calling this must reload it after.
// =============================================================================

/** One project, snapshotted after really loading it: pins as the pinout view would
 * show them, peripheral settings/params as flat "pid.name" keys, and the clock -
 * both the raw mux/PLL/divider choices and what they compute to - the same shape a
 * settings/params/clock diff can walk generically. */
function snapshotProject(src, label) {
  const obj = migrateProject(typeof src === 'string' ? yamlLoad(src) : src);
  if (!MCU_FILES[obj.mcu]) {
    throw new Error(`${label}: "${obj.mcu}" is not loaded — register its MCU file before diffing.`);
  }
  projectApply(obj);
  compute();

  const pins = {};
  for (const r of pinRows()) {
    if (!r.name) continue;
    pins[r.name] = r.signal || (r.type !== 'io' ? r.type.toUpperCase() : '(unassigned)');
    if (r.label) pins[`${r.name} label`] = r.label;
  }

  const settings = {};
  for (const [pid, st] of Object.entries(S.periph)) {
    for (const [name, v] of Object.entries(st.settings || {})) {
      settings[`${pid}.${name}`] = v instanceof Set ? [...v].sort().join(', ') || '(none)' : String(v);
    }
  }

  const params = {};
  for (const pid of Object.keys(M.peripherals)) {
    for (const d of paramDefs(pid)) {
      if (d.readonly) continue;               // derived, never a decision - would never differ meaningfully
      params[`${pid}.${d.name}`] = String(paramValue(pid, d.key));
    }
  }

  const clock = {};
  if (M.clock) {
    const k = S.clock, r = clockCalc();
    clock['SYSCLK source'] = k.sys;
    if (M.clock.pll) {
      const inp = M.clock.pll.inputs[k.pllIn];
      clock['PLL input'] = inp ? inp.name : String(k.pllIn);
      clock['PLL multiplier'] = String(k.pllMul);
    }
    if (M.clock.sources.HSE) clock['HSE frequency'] = `${k.hse} MHz`;
    for (const [name, v] of Object.entries(k.pre || {})) clock[`${name} divider`] = `/${v}`;
    for (const [name, v] of Object.entries(k.preSrc || {})) clock[`${name} source`] = v;
    for (const [id, st] of Object.entries(k.plls || {})) {
      if (st.in !== undefined) clock[`${id} input`] = String(st.in);
      if (st.mul !== undefined) clock[`${id} multiplier`] = String(st.mul);
      if (st.div !== undefined) clock[`${id} divider`] = String(st.div);
    }
    // The NUMBERS a user actually reads, not only the choices behind them - two
    // projects can pick the same mux leg and still compute differently if something
    // upstream moved, and "the tap still says 48 MHz" is exactly what a diff should
    // be able to say plainly rather than making the reader recompute it by hand.
    clock['SYSCLK (computed)'] = `${num2(r.SYSCLK)} MHz`;
    clock['HCLK (computed)'] = `${num2(r.HCLK)} MHz`;
    for (const name of Object.keys(M.clock.prescalers || {})) {
      clock[`${name} (computed)`] = `${num2(r[name])} MHz`;
    }
  }

  return {
    label, name: obj.name || 'Untitled', mcu: obj.mcu, variant: obj.variant || null,
    pkg: obj.package || S.pkg, pins, settings, params, clock,
    dma: obj.dma || null, nvic: obj.nvic || null, generator: obj.generator || null,
  };
}

const num2 = v => Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '—';

/** Every key present in either map, in the order A then B introduces them. */
function unionKeys(a, b) {
  const seen = new Set();
  const out = [];
  for (const k of [...Object.keys(a), ...Object.keys(b)]) if (!seen.has(k)) { seen.add(k); out.push(k); }
  return out;
}

/** `{key: value}` maps -> readable "key: before -> after" lines, changed keys only. */
function diffLines(a, b, missing = '(none)') {
  const lines = [];
  for (const k of unionKeys(a, b)) {
    const av = a[k] !== undefined ? a[k] : missing, bv = b[k] !== undefined ? b[k] : missing;
    if (av !== bv) lines.push(`  ${k}: ${av} -> ${bv}`);
  }
  return lines;
}

// A raw block (dma:/nvic:/generator:) that came straight off the YAML, not through
// the engine - each is already a plain-enough structure that a JSON round-trip is a
// faithful, if blunt, "did this change at all" without inventing a second parser for
// three different small shapes. Good enough for "changed, see the file", which is
// all the round-6 ask needed for these three; the pin/setting/clock sections above
// carry the readable, field-by-field detail.
function blockChanged(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * The readable report itself. `srcA`/`srcB` are .wchproj YAML text (or already-parsed
 * objects) - CLI's `--diff`, and any future UI, both hand this the same two arguments.
 * Loads A, then B, through the app's own projectApply()/compute() - the CALLER'S
 * currently-open project (if any) is not restored, exactly like opening either file
 * from the menu is not undone by opening the other; say so where this is offered
 * from a running UI, not a fresh CLI process.
 */
export function projectDiff(srcA, srcB) {
  const a = snapshotProject(srcA, 'A');
  const b = snapshotProject(srcB, 'B');
  const L = [];
  L.push(`Project diff: ${a.name} -> ${b.name}`);
  L.push('');
  L.push(`MCU: ${a.mcu}${a.mcu === b.mcu ? ' (unchanged)' : ` -> ${b.mcu}`}`);
  L.push(`Package: ${a.pkg}${a.pkg === b.pkg ? ' (unchanged)' : ` -> ${b.pkg}`}`);
  if (a.variant !== b.variant) L.push(`Variant: ${a.variant || '(none)'} -> ${b.variant || '(none)'}`);
  if (a.mcu !== b.mcu) {
    L.push('');
    L.push('NOTE: the two projects are for different parts. Pins, settings and params below');
    L.push('      compare whatever names happen to exist on both - most will read as fully');
    L.push('      added or removed rather than "changed", which is the honest answer here.');
  }

  const section = (title, lines) => {
    L.push('');
    if (!lines.length) { L.push(`${title}: unchanged.`); return; }
    L.push(`${title} (${lines.length} changed):`);
    L.push(...lines);
  };
  section('Pins', diffLines(a.pins, b.pins, '(unassigned)'));
  section('Settings', diffLines(a.settings, b.settings));
  section('Params', diffLines(a.params, b.params));
  section('Clock', diffLines(a.clock, b.clock));

  const blocks = [['DMA', a.dma, b.dma], ['NVIC', a.nvic, b.nvic], ['Generator options', a.generator, b.generator]];
  const changedBlocks = blocks.filter(([, x, y]) => blockChanged(x, y));
  L.push('');
  if (changedBlocks.length) {
    L.push(`Also changed (see the file for detail): ${changedBlocks.map(([n]) => n).join(', ')}.`);
  } else {
    L.push('DMA, NVIC and generator options: unchanged.');
  }
  return L.join('\n') + '\n';
}
