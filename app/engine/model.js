// =============================================================================
//  model.js — MCU file parsing, derived maps, configuration state, pin helpers.
//  No DOM. Owned by AGENT-2 (ENGINE).
//
//  Public state:
//    M  parsed MCU model + derived maps (_pinSignals, _phys, _alias, _src)
//    S  configuration state { pkg, periph, manual, gpio, sel, selPin, clock, zoom, panX, panY }
//  The UI reads M/S/E as globals in the browser bundle and as live ES module
//  bindings in Node tests. Never reassign M or S from outside this module.
// =============================================================================
import { defaultClock } from './clock.js';
import { resolveInherits } from './inherit.js';
import { record, clearHistory } from './history.js';
import { isConstParam } from './util.js';

export const PACKAGES = {};          // package id -> geometry (from data/packages/packages.yaml)
export const MCU_FILES = {};         // mcu.name -> yaml source text (bundled + opened from disk)

export let M = null;
export let S = null;

// ---- YAML hook ---------------------------------------------------------------
// Browser: js-yaml is on globalThis. Node tests: call setYaml(jsyaml) first.
let YAML = null;
export function setYaml(y) { YAML = y; }
function yaml() {
  const y = YAML || (typeof globalThis !== 'undefined' ? globalThis.jsyaml : null);
  if (!y) throw new Error('No YAML parser available — call setYaml(jsyaml) first');
  return y;
}
export const yamlLoad = text => yaml().load(text);
export const yamlDump = (obj, opt) => yaml().dump(obj, opt);

// ---- registries --------------------------------------------------------------
export function loadPackages(src) {
  const y = typeof src === 'string' ? yamlLoad(src) : src;
  for (const p of y.packages) PACKAGES[p.id] = p;
  return PACKAGES;
}
export function registerMcuFile(text) {
  const y = yamlLoad(text);
  if (!y || !y.mcu || !y.mcu.name) throw new Error('Not an MCU file (no mcu.name)');
  MCU_FILES[y.mcu.name] = text;
  return y.mcu.name;
}

// ---- derive ------------------------------------------------------------------
// Pin alternate functions are NOT listed per pin in the data files; they are
// derived here from every peripheral's remap table (single source of truth).
export function deriveMcu(y) {
  y._pinSignals = {};                                   // pin name -> [{periph, signal, remap|af}]
  for (const [pid, P] of Object.entries(y.peripherals)) {
    (P.remaps || []).forEach((r, ri) => {
      for (const [sig, pin] of Object.entries(r.pins || {})) {
        (y._pinSignals[pin] ||= []).push({ periph: pid, signal: sig, remap: ri });
      }
    });
    // `signal_pins:` is the same fact for an AF-muxed part: where a signal CAN go.
    // The difference is that each signal chooses independently, so an entry carries
    // the pin's AF code instead of an index into a whole-peripheral remap list.
    // Both shapes land in the same `_pinSignals` map, because every reader of it is
    // asking the same question - "what can this pin do" - and neither answer is
    // per-pin data duplicated from somewhere else: for an AF part the signal list IS
    // the single source of truth, exactly as `remaps:` is for a remap part.
    for (const [sig, opts] of Object.entries(P.signal_pins || {})) {
      for (const o of (Array.isArray(opts) ? opts : [])) {
        if (!o || !o.pin) continue;
        (y._pinSignals[o.pin] ||= []).push({
          periph: pid, signal: sig, af: o.af === undefined || o.af === null ? null : Number(o.af),
        });
      }
    }
  }
  y._phys = {};                                         // package -> {pin number: [names]}
  y._alias = {};                                        // package -> {name: canonical name}
  for (const [pk, map] of Object.entries(y.packages)) {
    y._phys[pk] = {}; y._alias[pk] = {};
    for (const [num, v] of Object.entries(map)) {
      const names = Array.isArray(v) ? v : [v];
      y._phys[pk][num] = names;
      for (const n of names) y._alias[pk][n] = names[0];   // shorted pins share one canonical name
    }
  }
  return y;
}

// The priority grouping a part starts in: the one the data marks `default: true`,
// else the first. A part with no `nvic.scheme.groups` has no grouping to choose and
// the index stays 0, which every reader treats as "no group data".
export function defaultNvicGroup(nvic) {
  const groups = ((nvic || {}).scheme || {}).groups || [];
  const i = groups.findIndex(g => g && g.default);
  return i >= 0 ? i : 0;
}

export function initState(m) {
  const pkgs = Object.keys(m.packages);
  const st = {
    pkg: pkgs.includes(m.mcu.default_package) ? m.mcu.default_package : pkgs[0],
    periph: {},            // pid -> { settings: {name: choice | Set}, remap: index }
    manual: {},            // pin -> 'GPIO_Output' | …
    gpio: {},              // pin -> { mode, pull, speed, label }
    sel: null,             // selected peripheral
    selPin: null,
    clock: defaultClock(m.clock),
    // What the user has asked the DMA controller and the interrupt controller to do.
    // Both are shared resources rather than pins, so they live beside `periph` rather
    // than inside it: one DMA channel serves several peripherals, and one vector can be
    // the only interrupt a peripheral has. Shapes and rules: app/engine/resources.js.
    // Generator options, as the round-3 brief puts them: in S, so they round-trip
    // through .wchproj and undo like everything else. The list of options that EXIST
    // is generatorOptions() in export.js - an option the engine cannot honour is not
    // offered, so this map only ever holds keys that one of them names.
    project: { options: {} },
    dma: { requests: [] },     // [{ id, request, channel, params: {key: value} }]
    nvic: { group: defaultNvicGroup(m.nvic), vectors: {} },  // name -> { enabled, preempt, sub }
    zoom: 1, panX: 0, panY: 0,
  };
  for (const [pid, P] of Object.entries(m.peripherals)) {
    // params are values (baud, period); settings decide pins. Separate maps on purpose.
    const params = {};
    for (const d of (Array.isArray(P.params) ? P.params : [])) {
      // A `const:` member has no value for the user to hold: the MCU file names the one
      // it can take and codegen writes that. Seeding it with `undefined` would serialize
      // a null into every .wchproj that carries this peripheral. The predicate is shared
      // with params.js because THAT module cannot be imported here - it imports this one.
      if (!d || d.key === undefined || isConstParam(d)) continue;
      params[String(d.key)] = d.default;
    }
    // channelParams: TIM_OCInitTypeDef is filled once per CHANNEL, so its values are
    // keyed by the channel number the data uses. Empty until somebody sets one.
    // `remap` is an index into `remaps:`; `afPins` is signal -> pin for a part that
    // muxes per pin. A part uses one or the other and never both - which is checked,
    // not assumed, by validate_mcu.py. `afPins` holds only what the user has actually
    // chosen, so a signal the user never touched keeps whatever defaultSignalPin()
    // answers and a .wchproj records a decision rather than a default.
    const ps = { settings: {}, remap: 0, afPins: {}, params, channelParams: {} };
    for (const s of P.settings || []) {
      const def = s.choices.find(c => c.default);
      ps.settings[s.name] = s.type === 'checkboxes' ? new Set(def ? [def.name] : []) : (def || s.choices[0]).name;
    }
    st.periph[pid] = ps;
  }
  return st;
}

// Parse a file and resolve `mcu.inherits:` against the loaded files, without
// deriving or installing it. The New Project dialog uses this to list a derived
// part's packages and variants.
export function mcuModel(source) {
  const text = typeof source === 'string' && source in MCU_FILES ? MCU_FILES[source] : source;
  const y = typeof text === 'string' ? yamlLoad(text) : text;
  return resolveInherits(y, name => MCU_FILES[name], yamlLoad);
}

// Load an MCU: accepts a registered mcu.name, YAML text, or a parsed object.
// Pure — no DOM.
export function loadMcu(source) {
  const y = mcuModel(source);
  if (!y || !y.mcu || !y.packages || !y.pins || !y.peripherals)
    throw new Error('Not an MCU file (needs mcu, packages, pins, peripherals)');
  const src = typeof source === 'string' ? (MCU_FILES[source] || source) : yamlDump(y);
  M = deriveMcu(y);
  M._src = src;
  MCU_FILES[y.mcu.name] ||= src;
  S = initState(M);
  applyPackageRemaps();
  clearHistory();            // a different part is a different document
  return M;
}

// ---- pin helpers (current package) -------------------------------------------
export const pkgPins  = () => M._phys[S.pkg];
export const canon    = name => M._alias[S.pkg][name] || name;
export const pinExists = name => name in M._alias[S.pkg];
export const pinType  = name => (M.pins[name] || {}).type || 'io';
export const pinNum   = name => Object.keys(pkgPins()).find(n => pkgPins()[n].includes(name));
export const pinLabel = name => { const num = pinNum(name); return num === undefined ? name : pkgPins()[num].join('/'); };
export const groupOf  = name => { const num = pinNum(name); return num === undefined ? [name] : pkgPins()[num]; };
export const sigName  = (pid, sig) => `${pid}_${sig}`;
export const GPIO_SIGS = ['GPIO_Input', 'GPIO_Output', 'GPIO_Analog', 'GPIO_EXTI'];

// ---- GPIO output speed -------------------------------------------------------
// The speeds this part HAS, in the data's order: [{ name, macro }]. `gpio.speeds`
// in the MCU file is the authority; `name` is what the GPIO table shows and what a
// .wchproj stores, `macro` is the SPL enum member.
//
// **A one-entry list means the control is not shown** (data/FORMAT.md): CH32V006 and
// CH32V005 have exactly one, `GPIO_Speed_30MHz`, because `GPIOx_CFGLR.MODEy` is a
// single bit (RM v1.4 7.3.1.1) and `GPIOSpeed_TypeDef` in the EVT header
// data/sources/V006/Evt/EXAM/SRC/Peripheral/inc/ch32v00X_gpio.h lines 22-26 has one
// member. Offering Low/Medium/High there offered a choice the silicon does not have,
// and generated three macro names that do not compile.
//
// A part with no `gpio.speeds` makes no claim. Rather than invent a list, fall back to
// the legacy `codegen.speeds` map's keys, which is what such a file used to mean.
export function gpioSpeeds() {
  const list = ((M && M.gpio) || {}).speeds;
  if (Array.isArray(list) && list.length) {
    return list.filter(s => s && s.name).map(s => ({ name: String(s.name), macro: s.macro || null }));
  }
  const legacy = ((M && M.codegen) || {}).speeds;
  if (legacy && typeof legacy === 'object') {
    return Object.entries(legacy).map(([name, macro]) => ({ name, macro }));
  }
  return [];
}

// ---- GPIO mode and pull ------------------------------------------------------
// `GPIOMode_TypeDef` is per family exactly as `GPIOSpeed_TypeDef` was, so a mode macro
// from another CH32 part is the same defect class the round opened with. `gpio.modes`
// lists the five real modes and `gpio.input_modes` the three the SPL reaches through
// the PULL column - the SDK folds pull into the mode, so `Input` has no single macro
// and the list is keyed by pull name rather than by a fourth mode.
//
// `class:` is the direction the mode drives - `out`, `in` or `analog` - and it is
// carried here because a constraint says "not an output function" once, by class,
// instead of listing mode names that go stale the day a mode is added. It is optional
// in the file; `null` means this part does not say, and a `classes:` constraint on such
// a part matches nothing rather than guessing (data/FORMAT.md).
export function gpioModes() {
  const list = ((M && M.gpio) || {}).modes;
  if (!Array.isArray(list)) return [];
  return list.filter(x => x && x.name).map(x => ({
    name: String(x.name), macro: x.macro || null, class: x.class ? String(x.class) : null,
  }));
}

export function gpioInputModes() {
  const list = ((M && M.gpio) || {}).input_modes;
  if (!Array.isArray(list)) return [];
  return list.filter(x => x && x.name).map(x => ({ name: String(x.name), macro: x.macro || null }));
}

// True when the part offers a real choice. False (one speed, or none stated) means the
// UI shows fixed text and no selector - never a disabled selector.
export const gpioSpeedIsChoice = () => gpioSpeeds().length > 1;

// The speed name to USE for a pin, given whatever S.gpio[pin].speed holds. A part with
// one speed always answers with that one, so a .wchproj saved when the app still offered
// "High" opens as "30 MHz" rather than carrying a name the part cannot express.
export function gpioSpeedFor(stored) {
  const list = gpioSpeeds();
  if (!list.length) return stored || null;
  if (list.length === 1) return list[0].name;
  const hit = list.find(s => s.name === stored);
  return hit ? hit.name : list[0].name;
}

// Some peripherals sit on different pins depending on the package (bonding, not AFIO).
export function applyPackageRemaps() {
  for (const [pid, P] of Object.entries(M.peripherals))
    if (P.remap_by_package && S.pkg in P.remap_by_package) S.periph[pid].remap = P.remap_by_package[S.pkg];
}

// ---- where a peripheral's signals land ---------------------------------------
// THE SEAM. Two families of silicon answer "which pin does this signal use" in two
// different shapes, and this is the only place that knows there are two:
//
//   `remaps:`      ONE register field moves EVERY signal of the peripheral at once,
//                  so a selected index is a complete, atomic, register-valued choice.
//                  CH32V003/V005/V006 (AFIO_PCFR1 field) and CH32X035 (a macro).
//   `signal_pins:` each signal picks its OWN pin, and the pin's four-bit AFR field
//                  says which function it carries. CH32H417 (GPIOx_AFRL/AFRH).
//
// Everything downstream - the conflict engine, the pin grid, the picker, codegen -
// asks this function and never looks at either key directly. That is what keeps the
// remap parts byte-identical: for them this returns the very object they used before.
export const signalPinDefs = pid => (M.peripherals[pid] || {}).signal_pins || null;
export const isAfMuxed = pid => !!signalPinDefs(pid);

// The pins a signal of an AF-muxed peripheral may use: [{ pin, af }], in file order.
export function signalPinOptions(pid, sig) {
  const sp = signalPinDefs(pid);
  const list = sp && sp[sig];
  if (!Array.isArray(list)) return [];
  return list.filter(o => o && o.pin).map(o => ({
    pin: String(o.pin), af: o.af === undefined || o.af === null ? null : Number(o.af),
  }));
}

// What a signal uses when the user has not chosen: the first option BONDED on this
// package, falling back to the first option at all. Preferring a bonded pin matters -
// this part's packages drop whole ports, and defaulting to an absent pin would make a
// peripheral look unusable on a package where three other pins would have served.
// It is a pure function of (part, package, file order), so a reload answers the same.
export function defaultSignalPin(pid, sig) {
  const opts = signalPinOptions(pid, sig);
  if (!opts.length) return null;
  return (opts.find(o => pinExists(o.pin)) || opts[0]).pin;
}

// `signal_groups:` - a NAMED SUBSET of an `af`-muxed peripheral's signals that the
// silicon moves TOGETHER under one shared field, inside a peripheral whose OTHER
// signals genuinely do pick their pin independently. CH32H417 UHSIF is the proven
// case: `UHSIF_PORT_RM` moves PORT0-7's eight signals as one atomic, three-valued
// choice - structurally identical to `SDMMC_RM` - while UHSIF_CLK's four options are a
// real independent choice (a single signal has nothing else to disagree with), and
// PORT8-47 have exactly one candidate each (no choice, nothing to couple). `remaps:`
// cannot express "just these eight signals, atomically" without giving every OTHER
// signal of the peripheral a matching entry in a shape they do not need; `signal_pins:`
// cannot express the coupling at all - each signal already picks independently, which
// is the exact defect (CMD-from-RM=00 beside D0-from-RM=01, one repository over).
//
// The shape reuses `signal_pins:`'s own per-signal candidate lists rather than
// inventing a second place to state the same pins twice: `signal_groups:` says WHICH
// signals move together; each grouped signal's own `signal_pins:` entry still says
// WHAT its candidates are, in the SAME order for every signal in the group (index 0 is
// every member's own pin under choice 0, index 1 under choice 1, and so on - the same
// "index is the register value" rule `remaps:` already states). `setSignalPin()` below
// is where the coupling actually happens: choosing a pin for ONE grouped signal moves
// every sibling to the matching index in the SAME call, so `signalPins()` itself needs
// no group-awareness for an already-chosen signal - only for picking today's DEFAULT,
// which must be uniform across the group rather than each signal's own "first bonded"
// pick (a mismatch there would start the group on an impossible combination too).
export const signalGroupOf = (pid, sig) =>
  ((M.peripherals[pid] || {}).signal_groups || []).find(g => (g.signals || []).includes(sig)) || null;

// A group's DEFAULT index on the CURRENT package - index 0 unless the group names a
// per-package override, same key and shape `remaps:` already uses for a whole
// peripheral (`remap_by_package: { QFN12: 0, QSOP24: 1 }`, data/FORMAT.md:223).
// CH32H417 UHSIF is why this exists: PORT0-7 default to index 0 on every package, but
// QFN68's own bonding wants index 1 (RM's own mapping for that package) - defaulting
// to 0 regardless left the group bonded to NOTHING on QFN68, correctly SHOWN (not
// silently mixed the way independent per-signal defaults used to) but not USABLE.
//
// Deliberately NOT `remaps:`'s own mechanism (a stored index `applyPackageRemaps()`
// overwrites on every `setPackage()` call): that pattern is only safe for a whole
// peripheral because `projectApply()` calls it BEFORE restoring the project's saved
// `remap:` value, so a reopened project's explicit choice still wins by ORDER. A
// group's default is read HERE INSTEAD, inside `signalPins()`, and only consulted
// when the signal has no stored `afPins` entry at all - so it can never override an
// explicit choice by construction, regardless of call order, on a live package
// switch as much as on a reopened project. Provably safer than copying the mutate-
// on-switch pattern, not merely assumed to be.
const groupDefaultIndex = g => {
  const rbp = g.remap_by_package || {};
  return S.pkg in rbp ? rbp[S.pkg] : 0;
};

// signal -> pin for this peripheral as it is configured right now, in the same shape
// a `remaps:` entry has, so one reader covers both.
export function signalPins(pid) {
  const P = M.peripherals[pid] || {}, st = S.periph[pid] || {};
  if (!P.signal_pins) return (P.remaps || [])[st.remap] || { pins: {} };
  const chosen = st.afPins || {};
  const pins = {};
  for (const sig of Object.keys(P.signal_pins)) {
    const want = chosen[sig];
    const ok = want && signalPinOptions(pid, sig).some(o => o.pin === want);
    // A grouped signal's UNCHOSEN default is its own group-default-index entry
    // (usually index 0, or this package's own override), not "first bonded" -
    // every sibling defaults to the SAME index too, so the group starts on a real,
    // atomic combination rather than each signal picking whatever fits it alone.
    const grp = signalGroupOf(pid, sig);
    const pin = ok ? want
      : grp ? (signalPinOptions(pid, sig)[groupDefaultIndex(grp)] || {}).pin
      : defaultSignalPin(pid, sig);
    if (pin) pins[sig] = pin;
  }
  return { name: 'the per-pin AF map', pins, af: true };
}

// The AF code a signal needs on a given pin, or null when the data does not say.
// Codegen refuses to emit a GPIO_PinAFConfig without one rather than guessing a
// number - the same rule that stops it deriving a function name from a struct name.
export function signalAf(pid, sig, pin) {
  const hit = signalPinOptions(pid, sig).find(o => o.pin === pin);
  return hit ? hit.af : null;
}

// ---- peripheral queries ------------------------------------------------------
// Which signals this peripheral needs, given its current settings.
export function requiredSignals(pid) {
  const P = M.peripherals[pid], st = S.periph[pid], out = new Set();
  for (const s of P.settings || []) {
    const v = st.settings[s.name];
    for (const c of s.choices) {
      const on = s.type === 'checkboxes' ? v.has(c.name) : v === c.name;
      if (on) (c.signals || []).forEach(x => out.add(x));
    }
  }
  return out;
}
// ---- what the FILE does not say ----------------------------------------------
// Two queries the Tools tab prints and nothing else derives, because both are facts
// about the MCU file rather than about the silicon.

/**
 * The peripherals whose pads this file has not extracted yet, each with the owner and
 * the backlog line its `pins:` block names.
 *
 * A peripheral with no routing must carry one of two declarations: `pins: { none,
 * source }` - the silicon gives it no pad, cited to a table - or `pins: { open, owner,
 * task }`, which is the only form that says "nobody has written this down yet". So this
 * list is the coverage ledger's queue, and it is the one place the app can report that a
 * part's file is unfinished without any code here knowing which part that is.
 */
export function openPadPeripherals() {
  return Object.keys(M.peripherals || {})
    .filter(pid => ((M.peripherals[pid].pins || {}).open) === true)
    .map(pid => {
      const p = M.peripherals[pid].pins || {};
      return { pid, owner: p.owner || null, task: p.task || null };
    })
    .sort((a, b) => a.pid.localeCompare(b.pid));
}

/**
 * Every signal a peripheral routes on a per-pin AF map that NO setting's choice names,
 * as `{ pid, signal }`.
 *
 * Such a row is a pad with NO WAY TO ASSIGN IT: `requiredSignals()` derives every claim
 * from the settings, so the pin grid cannot offer it, the conflict engine never sees it
 * and the generated C never muxes it - the row is decoration. `validate_mcu.py` makes it
 * an ERROR and `tests/completeness.test.js` asserts it per part, so this reads empty on
 * every part that ships; the Tools tab prints the count so it stays that way.
 *
 * The two exemptions are rules, not a hole. `codegen.skip_signals` names the pins codegen
 * must not drive from GPIO_Init (the debug pair, the reset pin) - SYS and the `clock:`
 * tree claim those, not a setting, so no setting may name them. And a part that moves
 * whole peripherals with a `remaps:` index has no per-pin map to check in the first
 * place, which is why `signal_pins` being empty is not a failure here.
 */
export function unclaimableSignals() {
  const skip = new Set(Object.keys((M.codegen || {}).skip_signals || {}));
  const out = [];
  for (const [pid, P] of Object.entries(M.peripherals || {})) {
    const sigs = Object.keys(P.signal_pins || {});
    if (!sigs.length || skip.has(pid)) continue;
    const claimed = new Set();
    for (const s of P.settings || []) {
      for (const c of s.choices || []) for (const x of c.signals || []) claimed.add(x);
    }
    for (const s of sigs) if (!claimed.has(s)) out.push({ pid, signal: s });
  }
  return out;
}
/**
 * The supply domains a peripheral governs, from its `pins.supplies:` block, normalised
 * to `{ name, pins, range, note, source }`.
 *
 * A supply rail is a hardware fact - which pads carry it, over what voltage, constrained
 * against which other rail - and so it lives in the MCU file, cited, rather than being
 * derived here from a pin's `type:`. That distinction is why this is a query over the
 * data and not a filter over `M.pins`: the file can say something the pin table cannot,
 * such as VDDA never exceeding VDD, and a set of rails that only exists as "every pin
 * typed power" would be a guess about which rail each pad belongs to.
 *
 * Empty for a peripheral that declares none - which is every peripheral except the one
 * that owns the power interface.
 */
export function suppliesOf(pid) {
  const raw = (((M.peripherals || {})[pid] || {}).pins || {}).supplies;
  if (!Array.isArray(raw)) return [];
  const one = v => String(v).trim().replace(/\s+/g, ' ');
  return raw.filter(s => s && s.name !== undefined).map(s => ({
    name: one(s.name),
    pins: (Array.isArray(s.pins) ? s.pins : s.pins === undefined ? [] : [s.pins]).map(one),
    range: s.range === undefined ? '' : one(s.range),
    note: s.note === undefined ? '' : one(s.note),
    source: s.source === undefined ? '' : one(s.source),
  }));
}

// The choice that means "off": the first one that needs no pins. Usually

// choices[0] ("Disable"), but not always — CH32V006's external reset pin is
// ENABLED at the factory, so its off switch is the RST_MODE=11 choice at the end.
// Anything keyed off choices[0] would be unable to release that pin.
export const neutralChoice = setting =>
  setting.choices.find(c => !c.signals || !c.signals.length) || setting.choices[0];

export function isEnabled(pid) {
  const P = M.peripherals[pid], st = S.periph[pid];
  for (const s of P.settings || []) {
    const v = st.settings[s.name];
    if (s.type === 'checkboxes' ? v.size : v !== neutralChoice(s).name) return true;
  }
  return false;
}
// Can any non-default choice of this peripheral be satisfied on this package?
export function isAvailable(pid) {
  const P = M.peripherals[pid];
  // An AF-muxed peripheral is usable when every signal a choice needs has at least one
  // bonded pin - and the signals are INDEPENDENT, so this is a per-signal test rather
  // than a search for one remap that satisfies them all. Testing it the remap way here
  // would call a peripheral unusable whenever no single listed combination happened to
  // be fully bonded, which on this silicon is not what "unusable" means.
  if (P.signal_pins) {
    for (const s of P.settings || []) for (const c of s.choices) {
      if (!c.signals) continue;
      if (c.signals.every(sig => signalPinOptions(pid, sig).some(o => pinExists(o.pin)))) return true;
    }
    return !((P.settings || []).some(s => s.choices.some(c => c.signals)));
  }
  if (!P.remaps || !P.remaps.length) return true;
  for (const s of P.settings || []) for (const c of s.choices) {
    if (!c.signals) continue;
    if (P.remaps.some(r => c.signals.every(sig => r.pins[sig] && pinExists(r.pins[sig])))) return true;
  }
  return !((P.settings || []).some(s => s.choices.some(c => c.signals)));
}

// Switch package, keeping everything that still exists. Returns the pin names that
// are no longer bonded (the caller decides how loudly to say so).
export function setPackage(pkg) {
  if (!(pkg in M.packages)) throw new Error(`No such package: ${pkg}`);
  record(`Package ${pkg}`);
  S.pkg = pkg;
  applyPackageRemaps();
  return Object.keys(S.manual).filter(p => !pinExists(p));
}
