// =============================================================================
//  codegen.js — C initialisation code in WCH EVT SDK style.
//
//  What is generated from the model alone (always correct):
//    the GPIO_InitTypeDef blocks — ports, pin masks, modes — because every one of
//    those comes from the pin assignments and the GPIO table. The speed MACRO is
//    not derivable and comes from the MCU file's `gpio.speeds`: a part with one
//    speed gets that one macro, never a Low/Medium/High mapping.
//
//  What needs register encodings from the MCU file (`codegen:` block):
//    the AFIO remap word, the peripheral clock enables and the RCC clock setup.
//    Bit positions are per family and are NOT guessed here: without them those
//    sections are emitted as an explicit TODO that names exactly what is needed,
//    rather than plausible-looking code that would configure the wrong bits.
//
//  Schema (see the board request to AGENT-1):
//    codegen:
//      header: ch32v00x.h
//      gpio_clock: { fn: RCC_PB2PeriphClockCmd, port: RCC_PB2Periph_GPIO$PORT,
//                    afio: RCC_PB2Periph_AFIO }
//      speeds: { "30 MHz": GPIO_Speed_30MHz }   # legacy-name translation only;
//                                                the OFFER is mcu `gpio.speeds`
//      remap:  { register: "AFIO->PCFR1",
//                fields: { USART1: [{ lsb: 6, bits: 4 }],
//                          TIM2:   [{ lsb: 14, bits: 2 }, { lsb: 16, bits: 1, from: 2 }] } }
//      rcc:    { register: "RCC->CFGR0",
//                sw:     { lsb: 0,  bits: 2, values: { HSI: 0, HSE: 1, PLLCLK: 2 } },
//                pllsrc: { lsb: 16, bits: 1, values: { HSI: 0, HSE: 1 } },
//                prescalers: { HB: { lsb: 4, bits: 4, values: { 1: 0, 2: 1 } } } }
//    A field may be split across slices: `from` is the bit of the remap index a
//    slice starts at (TIM2_RM[2] lives at bit 16, away from TIM2_RM[1:0]).
// =============================================================================
import {
  M, S, pinType, requiredSignals, sigName, gpioSpeeds, gpioSpeedFor, gpioModes,
  gpioInputModes, isEnabled, pinExists, signalPins, signalAf, canon,
} from './model.js';
import {
  paramDefs, paramValue, paramApplies, depProblems,
  channelParamBlock, channelParamDefs, channelParamValue, activeInstances,
} from './params.js';
import { dmaRequests, dmaParamDefs, dmaParamValue, dmaConflicts, nvicState } from './resources.js';
import { E, compute } from './engine.js';
import { generatorOption, userSection } from './export.js';
import { clockCalc, firstPre, pllList, pllState, tapSource, tapSources, tapSourceEntry } from './clock.js';
import { PROJECT } from './project.js';
import {
  constraintFor, constraintSentence, skippedClaim, gpioEffectiveMode,
  analogClaim, analogAdvice,
} from './constraints.js';
import { isConstParam } from './util.js';

const PIN_RE = /^P([A-Z])(\d+)$/;
const hex = (v, digits = 8) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(digits, '0') + 'U';
const bin = (v, bits) => (v >>> 0).toString(2).padStart(bits, '0');

// The SPL macro for a stored GPIO-table speed name. `gpio.speeds` in the MCU file
// is the authority - it lists the speeds the part HAS, with the macro for each - and
// `codegen.speeds` is consulted only to translate a name that list does not carry, so
// a .wchproj saved when the app still offered Low/Medium/High still generates code
// that compiles.
//
// Nothing is invented here. A part that states neither gets a TODO naming what is
// missing, because the wrong speed macro is exactly the defect this round opened
// with: GPIO_Speed_50MHz does not exist on CH32V006 and never did.
function speedMacro(stored) {
  const name = gpioSpeedFor(stored);
  const hit = gpioSpeeds().find(x => x.name === name);
  if (hit && hit.macro) return { macro: hit.macro, name };
  const legacy = (cfg().speeds || {})[name] || (cfg().speeds || {})[stored];
  if (legacy) return { macro: legacy, name };
  return { macro: null, name };
}

// The SPL macro for a GPIO mode, from the MCU file. `GPIOMode_TypeDef` is per family
// exactly as `GPIOSpeed_TypeDef` was - GPIO_Mode_AIN exists on this part, but a table
// carried over from another CH32 would be the same defect the round opened with - so
// these come from `gpio.modes` / `gpio.input_modes` and are never assumed here.
//
// `Input` has no macro of its own: the SPL folds the pull into the mode, which is why
// the second table is keyed by the PULL name. A part that states neither gets a TODO
// naming exactly what is missing.
function modeMacro(mode, pull) {
  const list = mode === 'Input' ? gpioInputModes() : gpioModes();
  const key = mode === 'Input' ? (pull || 'No pull') : mode;
  const hit = list.find(x => x.name === key);
  if (hit && hit.macro) return { macro: hit.macro };
  if (!list.length) {
    return { missing: `the MCU file has no gpio.${mode === 'Input' ? 'input_modes' : 'modes'}` };
  }
  return { missing: `gpio.${mode === 'Input' ? 'input_modes' : 'modes'} has no entry for "${key}"` };
}

// Exported because export.js's project generator needs the part's own SPL header
// name for the generated main.c, and there must be one place that answers it.
export const cfg = () => M.codegen || {};

// Signals that are NOT set up with GPIO_Init, and whether a function is analog, now
// live in constraints.js as `skippedClaim()` / `analogClaim()`. They moved there rather
// than being copied because the CONFLICT ENGINE needs the same two answers to decide
// which mode a pin will be configured with, and a second copy is how the two consumers
// would start disagreeing about a constraint. `constraintFor()` is the third consumer.
const skipped = claim => skippedClaim(claim);

// ---- what to configure -------------------------------------------------------
// One entry per physical GPIO the configuration uses, named by the pin the
// signal actually sits on (on a shorted pair that is not always the canonical one).
export function gpioPlan() {
  const e = E || compute();
  const out = [];
  for (const [canonPin, info] of Object.entries(e.pins)) {
    const usable = info.claims.filter(c => !skipped(c));
    if (!usable.length) continue;                        // e.g. a pin that only carries SWIO
    for (const claim of usable) {
      const pin = claim.via || canonPin;
      const m = PIN_RE.exec(pin);
      if (!m || pinType(pin) !== 'io') continue;
      if (out.some(x => x.pin === pin)) continue;         // one register setup per pin
      const g = S.gpio[pin] || S.gpio[canonPin] || {};
      // ONE derivation, shared with the conflict engine (constraints.js), so a rule the
      // engine reports and the generator refuses cannot be two different rules.
      const eff = gpioEffectiveMode(pin, usable, g);
      const mode = eff.mode, inferred = eff.inferred;
      const pull = g.pull || 'No pull';
      const m2 = modeMacro(mode, pull);
      const speed = gpioSpeedFor(g.speed);

      // Constraints - the third consumer, and the last line of defence. The GPIO
      // table does not offer a forbidden value and `compute()` reports one that got
      // in anyway, but a hand-written `.wchproj`, or a mode DERIVED for a signal
      // nobody chose a mode for, can still arrive here. It must never become
      // plausible-looking bits: it becomes a TODO naming the constraint, exactly as
      // a missing `gpio.modes` entry does (round 5's constraint rule; agents/STATUS.md).
      //
      // The pull is only part of the mode when the mode is Input - the SPL ignores
      // the pull column for every other mode - so that is when it is checked.
      const cPull = mode === 'Input' ? constraintFor(pin, 'pull', pull) : null;
      const cMode = constraintFor(pin, 'mode', mode) || cPull;
      const cSpeed = constraintFor(pin, 'speed', speed);
      const modeMissing = cMode
        ? constraintSentence(cMode, pin, cMode === cPull ? 'pull' : 'mode', cMode === cPull ? pull : mode)
        : m2.missing || null;

      out.push({
        pin, port: m[1], bit: +m[2],
        signal: usable.map(c => c.signal).join(' / '),
        label: (g.label || '').trim(),
        mode, pull, speed,
        macro: cMode ? null : m2.macro || null,
        macroMissing: modeMissing,
        constrainedBy: cMode ? cMode.id : null,
        speedMacro: cSpeed ? null : (speedMacro(speed).macro || null),
        speedMissing: cSpeed ? constraintSentence(cSpeed, pin, 'speed', speed) : null,
        speedConstrainedBy: cSpeed ? cSpeed.id : null,
        inferred,
        conflict: info.state === 'conflict',
      });
    }
  }
  return out.sort((a, b) => (a.port === b.port ? a.bit - b.bit : a.port.localeCompare(b.port)));
}

// An io-typed pin the configuration claims, whose name `gpioPlan()` cannot parse into
// a port letter and a bit number (`PIN_RE`, `P<letter><digits>`). Before this existed,
// `gpioPlan()`'s own `!m` check silently dropped it: right on all eight shipped parts,
// which all spell their pins that way, and wrong the moment a ninth does not - a part
// whose GPIO_Init came out looking complete with one pin simply, silently, absent.
// codegen.js's read-through backlog item 3: "the fix is a named TODO, not a wider
// regex" - deriving a port/bit pair from a different naming scheme is the same class
// of guess this generator refuses everywhere else.
export function unparsedGpioPins() {
  const e = E || compute();
  const out = [];
  for (const [canonPin, info] of Object.entries(e.pins)) {
    const usable = info.claims.filter(c => !skipped(c));
    for (const claim of usable) {
      const pin = claim.via || canonPin;
      if (pinType(pin) !== 'io' || PIN_RE.test(pin)) continue;
      if (out.some(x => x.pin === pin)) continue;
      out.push({ pin, signal: usable.map(c => c.signal).join(' / ') });
    }
  }
  return out.sort((a, b) => a.pin.localeCompare(b.pin));
}

// Pins the configuration uses but GPIO_Init must not touch, with the reason.
export function skippedPins() {
  const e = E || compute();
  const out = [];
  for (const [canonPin, info] of Object.entries(e.pins)) {
    for (const claim of info.claims) {
      if (!skipped(claim)) continue;
      out.push({ pin: claim.via || canonPin, signal: claim.signal });
    }
  }
  return out.sort((a, b) => a.pin.localeCompare(b.pin));
}

// ---- alternate function remap ------------------------------------------------
//  Two families, two spellings, one rule: the DATA says which.
//
//  `codegen.remap.style: macro` - CH32X035 - means each remap entry carries a
//  `macro:` and the SDK's own `GPIO_PinRemapConfig(<macro>, ENABLE)` applies it. The
//  macro packs the register position AND the value into one constant that the SDK
//  decodes, so building the mask by hand would re-derive an encoding the SDK already
//  knows - and a wrong macro name fails to compile, where a wrong hand-built mask is
//  silent. An index with NO macro emits nothing, which is how "No remap" stays quiet.
//
//  `codegen.remap.fields` - CH32V006 - means the remap index IS the register field
//  value and one `AFIO->PCFR1` word carries every peripheral at once.
//
//  A part may in principle have both; a peripheral whose selected remap has a macro is
//  applied by the call and left out of the word, so it is never written twice.

/** The `GPIO_PinRemapConfig`-style calls this configuration needs. */
export function remapPlan() {
  const c = cfg().remap || {};
  const calls = [];
  for (const [pid, P] of Object.entries(M.peripherals)) {
    if (!S.periph[pid]) continue;
    const index = S.periph[pid].remap || 0;
    const r = (P.remaps || [])[index];
    if (!r || !r.macro) continue;
    calls.push({ periph: pid, index, name: r.name, macro: r.macro, used: requiredSignals(pid).size > 0 });
  }
  calls.sort((a, b) => a.periph.localeCompare(b.periph));
  return { style: c.style || (c.fields ? 'register' : null), fn: c.fn || null, enable: c.enable || 'ENABLE', calls };
}

/**
 * The `GPIO_PinAFConfig`-style calls this configuration needs - one per SIGNAL, not one
 * per peripheral, because that is the unit the silicon muxes.
 *
 * This is the third mux shape and the first that is not a whole-peripheral switch. A
 * remap part writes ONE field (or calls ONE macro) and every signal moves together; an
 * AF part gives each pin four bits in `GPIOx_AFRL`/`AFRH` and each signal chooses
 * alone, so the plan is a list of (pin, AF) pairs.
 *
 * `af: null` is NOT emitted. The data has to state the AF code; deriving one from a
 * peripheral name or a pin number is the same class of guess as deriving a function
 * name from a struct name, which this generator already refuses to make. A signal whose
 * AF the file does not give becomes a named TODO, and `--strict` catches it.
 */
export function afPlan() {
  const c = cfg().remap || {};
  // The "nothing here" object is deliberately NOT the `af` shape: it carries no `macro`
  // and no analog buckets, and `tests/afmux.test.js` pins it as "exactly what a part
  // with no signal_pins produced before this key existed". Every reader of the extra
  // keys is already behind an `ap.style === 'af'` test. Do not tidy the two into one.
  if ((c.style || '') !== 'af') return { style: null, fn: null, calls: [], missing: [] };
  const calls = [], missing = [], analog = [], contradictory = [], dropped = [];
  for (const [pid, P] of Object.entries(M.peripherals)) {
    if (!P.signal_pins || !S.periph[pid]) continue;
    const req = requiredSignals(pid);
    if (!req.size) continue;
    const routed = signalPins(pid).pins;
    for (const sig of [...req].sort()) {
      const pin = routed[sig];
      if (!pin || !pinExists(pin)) continue;               // compute() already says so
      if (skippedClaim({ who: pid, signal: sigName(pid, sig) })) continue;
      const m = PIN_RE.exec(pin);
      if (!m) continue;
      const af = signalAf(pid, sig, pin);
      const entry = { periph: pid, signal: sig, pin, port: m[1], bit: +m[2], af };

      // An analog pad has no AF field to write. `gpioEffectiveMode()` puts this pin in
      // GPIO_Mode_AIN, so writing GPIOx_AFRL for it too would be the generator
      // disagreeing with itself one block further down the same function. Same rule,
      // same source of truth: `analogClaim()`.
      const an = analogClaim({ who: pid, signal: sigName(pid, sig) }, pin);
      if (an.analog) {
        // The data states BOTH that the pad is analog and that it has an AF code. That
        // is one fact written twice with two different answers; the generator picks
        // neither and says which two keys disagree.
        (af === null || Number.isNaN(af) ? analog : contradictory)
          .push({ ...entry, inferred: an.inferred });
        continue;
      }
      if (af !== null && !Number.isNaN(af)) {
        // The claim is not analog, but the PAD may be: another claim on the same pin can
        // be, and `gpioEffectiveMode()` puts analog first, so GPIO_Init above writes
        // GPIO_Mode_AIN. Writing this signal's AFR nibble anyway would configure a mux
        // field on a pad that is not muxed - the generator disagreeing with itself two
        // blocks apart. The engine reports the same pad as an analog-vs-AF issue; here
        // the AF is declined and said out loud rather than emitted or dropped in silence.
        const padClaims = ((E || compute()).pins[canon(pin)] || {}).claims || [];
        if (padClaims.length > 1 && gpioEffectiveMode(pin, padClaims, S.gpio[pin] || {}).mode === 'Analog') {
          dropped.push({ ...entry, with: padClaims.filter(c => c.who !== pid || c.signal !== sigName(pid, sig))
            .map(c => c.signal) });
          continue;
        }
        calls.push(entry);
        continue;
      }
      // No `af:`, and not settled as analog. Which key the data is short of depends on
      // what it already says about the peripheral and the pin — see analogAdvice().
      missing.push({ ...entry, advice: analogAdvice({ who: pid, signal: sigName(pid, sig) }, pin) });
    }
  }
  const order = (a, b) => (a.port === b.port ? a.bit - b.bit : a.port.localeCompare(b.port));
  return { style: 'af', fn: c.fn || null, macro: c.macro || 'GPIO_AF$AF',
           calls: calls.sort(order), missing: missing.sort(order),
           analog: analog.sort(order), contradictory: contradictory.sort(order),
           dropped: dropped.sort(order) };
}

/** True when this peripheral's selected remap is applied by a macro call. */
function remappedByMacro(pid) {
  const index = (S.periph[pid] || {}).remap || 0;
  const r = ((M.peripherals[pid] || {}).remaps || [])[index];
  return !!(r && r.macro);
}

// Returns { register, value, mask, parts } or null when the file has no map.
export function remapWord() {
  const c = cfg().remap;
  if (!c || !c.fields) return null;
  let value = 0, mask = 0;
  const parts = [];
  for (const [pid, slices] of Object.entries(c.fields)) {
    if (!S.periph[pid]) continue;
    if (remappedByMacro(pid)) continue;          // the call applies it; writing it twice is a bug
    const index = S.periph[pid].remap || 0;
    const remaps = (M.peripherals[pid] || {}).remaps || [];
    let width = 0;
    for (const s of slices) {
      const from = s.from || 0;
      const field = (index >> from) & ((1 << s.bits) - 1);
      value |= field << s.lsb;
      mask |= ((1 << s.bits) - 1) << s.lsb;
      width = Math.max(width, from + s.bits);
    }
    parts.push({
      periph: pid, index, width,
      name: (remaps[index] || {}).name || String(index),
      used: requiredSignals(pid).size > 0,
    });
  }
  return { register: c.register || 'AFIO->PCFR1', value: value >>> 0, mask: mask >>> 0, parts };
}

// ---- RCC ---------------------------------------------------------------------
/**
 * One register word under construction: the value, the mask, and the running list of
 * what went into it. Pulled out of `rccWord()` because a part whose clock block has a
 * second PLL or a peripheral source mux needs MORE THAN ONE register - CH32H417 puts
 * the SYSCLK mux and the bus prescalers in CFGR0, the eight peripheral muxes in CFGR2
 * and the PLL reference selects in PLLCFGR2 - and three copies of this arithmetic is
 * three places for a mask to go wrong.
 */
function rccWordBuilder(register) {
  const w = { register, value: 0, mask: 0, parts: [] };
  // One setting may need bits in more than one place: the V00x ADC divider is
  // ADCPRE[4:0] at bit 11 PLUS ADC_CLK_MODE at bit 31, and the gap between them holds
  // PLLSRC and MCO, so one wide field would swallow them. A spec may therefore be a
  // single { lsb, bits, values } or a LIST of them - the shape remap.fields already
  // uses. `default:` covers a slice that has no entry for the current value.
  w.put = (spec, raw, what) => {
    if (!spec) return;
    const slices = Array.isArray(spec) ? spec : [spec];
    const encoded = [];
    let anyExplicit = false;
    for (const sl of slices) {
      let field = sl.values ? sl.values[raw] : raw;
      if (field !== undefined) anyExplicit = true;
      else if (sl.default !== undefined) field = sl.default;
      else if (slices.length > 1) field = 0;   // a split field: the slice that does not
      encoded.push({ s: sl, field });          // name this value contributes zero
    }
    if (!anyExplicit || encoded.some(e => e.field === undefined)) {
      // DECISION (STATUS §2 AGENT-2, this cycle - "codegen.js item 6"), and the
      // MEASUREMENT that changed it mid-cycle: the first attempt at this made "no
      // encoding for X" a TODO on the theory that it is narrower and safer than
      // rccWords()'s "not written" case below - a FIELD `codegen.rcc` already
      // declares, just missing one value, versus a control it never attempts at all.
      // That theory was wrong, measured: `node tests/run.js "codegen.test"` went
      // 6 FAILED the moment it shipped, because CH32V006's OWN ADC prescaler is
      // EXACTLY this case, on purpose, right now - `data/mcus/CH32V006.yaml:2291-2294`
      // documents /1 as deliberately unencoded (it needs ADC_CLK_MODE, RCC_CFGR0 bit
      // 31, a second field this MCU file does not yet also write) and says outright
      // "the generator is left to report 'no encoding for 1' until it can write bit 31
      // too." Converting this to a TODO does not catch a forgotten fact; it fails
      // `--strict` on CH32V006 and CH32V005's DEFAULT configuration, for a gap AGENT-1
      // already tracked and already left this way on purpose. So: still a comment,
      // and the distinction this file's OTHER TODOs earn ("a gap the generator hit
      // while doing work it could otherwise have done") is not enough on its own -
      // "already hit" has to also mean "not already declared incomplete elsewhere in
      // the data", which nothing here can check. Filed as a finding instead of a
      // silent revert: `agents/BOARD.md`, this cycle.
      w.parts.push({ what, note: `no encoding for ${raw}` });
      return;                                  // a half-written divider is worse than a gap
    }
    for (const { s: sl, field } of encoded) {
      const width = (1 << sl.bits) - 1;
      w.value |= (field & width) << sl.lsb;
      w.mask |= width << sl.lsb;
    }
    const one = encoded.length === 1;
    w.parts.push({
      what, raw,
      field: one ? encoded[0].field : encoded.map(e => e.field),
      bits: one ? encoded[0].s.bits : encoded.map(e => e.s.bits),
      lsb: one ? encoded[0].s.lsb : encoded.map(e => e.s.lsb),
      slices: encoded.length,
    });
    w.wrote = true;
  };
  return w;
}

// The fields any one register spec can carry. `sources:` and `plls:` are what the
// second-PLL / source-mux schema added; a register that names none of them writes
// nothing, which is what every part but CH32H417 does today.
function rccFill(w, spec, k) {
  const named = pllList(M.clock).filter(p => !p.sys);
  const byId = Object.fromEntries(named.map(p => [p.id, p]));
  for (const [name, sp] of Object.entries(spec.sources || {})) {
    const v = (M.clock.prescalers || {})[name];
    if (!v) continue;
    // The register field selects a MUX LEG, not a bare clock signal — two legs can
    // share the same underlying source with different built-in dividers (RM
    // 4085-4089's "SERDES_PLL clock divided by 2"), and only the entry's own NAME
    // tells them apart. Unchanged for every existing mux: a plain-string entry's
    // name IS the source, so `values:` is still keyed exactly as it always was.
    const chosen = tapSourceEntry(v, name, k);
    w.put(sp, chosen ? chosen.name : null, `${name} clock source`);
  }
  for (const [name, sp] of Object.entries(spec.prescalers || {})) w.put(sp, (k.pre || {})[name], `${name} prescaler`);
  for (const [id, sp] of Object.entries(spec.plls || {})) {
    const p = byId[id];
    if (!p || !sp) continue;
    const st = pllState(p, k);
    // `src:` is keyed on the input's SOURCE, not on its index: an index is a position in
    // a list the data may reorder, and the register field names a clock.
    const inp = (p.def.inputs || [])[st.in || 0] || {};
    if (sp.src) w.put(sp.src, inp.source, `${id} source`);
    if (sp.div_in) w.put(sp.div_in, inp.div || 1, `${id} input divider`);
    if (sp.mul) w.put(sp.mul, st.mul, `${id} multiplier`);
    if (sp.div) w.put(sp.div, st.div, `${id} divider`);
  }
}

/**
 * Every RCC register this configuration writes: the primary one, then each entry of
 * `codegen.rcc.extra:`. A part with one register gets a one-element list, which is
 * what `rccWord()` returns the head of.
 */
export function rccWords() {
  const head = rccWord();
  if (!head) return [];
  const c = cfg().rcc, k = S.clock;
  const out = [head];
  for (const spec of c.extra || []) {
    if (!spec || !spec.register) continue;
    const w = rccWordBuilder(spec.register);
    rccFill(w, spec, k);
    if (w.parts.length) out.push(w);
  }
  // Anything the clock tab lets the user choose and NO register spec encodes. Without
  // this the generated C prints "USBFS from USBHS_PLL_CLK /10 -> 48 MHz" in a comment
  // and writes not one bit of CFGR2 for it: a file that reads as configured and boots
  // at the reset value. Reported as a note beside the others, which is what `put()`
  // already does for a divider it cannot encode - see the DECISION comment on that one
  // a few lines up in `rccWordBuilder`, measured rather than assumed: making either of
  // these two a TODO fails `--strict` on real, shipped parts TODAY for gaps AGENT-1
  // already tracks by name (CH32V006/CH32V005's ADC_CLK_MODE bit for `put()`'s case;
  // every secondary PLL/mux mid-rollout on CH32H417, this cycle's own USBHS_PLL/USBFS
  // included, for this one) - blocking exactly the incremental landing D depends on.
  const wrote = new Set();
  for (const w of out) for (const p of w.parts) if (p.what) wrote.add(p.what);
  const missing = [];
  for (const [name, v] of Object.entries(M.clock.prescalers || {})) {
    if (tapSources(v) && !wrote.has(`${name} clock source`)) missing.push(`${name}'s source mux`);
  }
  for (const p of pllList(M.clock)) {
    if (p.sys) continue;
    if (![`${p.id} source`, `${p.id} multiplier`, `${p.id} divider`].some(x => wrote.has(x))) missing.push(p.id);
  }
  if (missing.length) {
    head.parts.push({
      what: 'not written',
      note: `${missing.join(', ')} - the clock tab configures ${missing.length > 1 ? 'these' : 'this'} and the `
        + `MCU file has no codegen.rcc encoding for ${missing.length > 1 ? 'them' : 'it'}, so the register `
        + `${missing.length > 1 ? 'fields keep' : 'field keeps'} the reset value. Add a codegen.rcc.extra `
        + `entry naming the register and the field`,
    });
  }
  return out;
}

export function rccWord() {
  const c = cfg().rcc;
  if (!c || !M.clock) return null;
  const k = S.clock;
  const w = rccWordBuilder(c.register || 'RCC->CFGR0');
  const put = w.put, parts = w.parts;
  put(c.sw, k.sys, 'SYSCLK source');
  if (c.pllsrc && M.clock.pll) put(c.pllsrc, M.clock.pll.inputs[k.pllIn].source, 'PLL input');
  else if (!c.pllsrc && M.clock.pll && k.sys === 'PLLCLK') {
    // A part with a PLL and no `pllsrc:` encoding used to land here SILENTLY: the word
    // covered SW and the prescalers and said nothing about the input, while the header
    // comment above named the input the configuration asked for. On CH32H417 that is up
    // to 32 different asked-for clock rates and not one bit written for the field that
    // selects between them, in a file that reads as complete.
    //
    // It is NOT simply a missing value to fill in: `pllsrc` is keyed on the PLL input's
    // SOURCE, which is the whole register field on the parts that have one (HSI or HSE).
    // A part whose input is a source AND a divider - H417's PLL_SRC_DIV - needs more than
    // that shape can say, so this is a question for the data rather than a gap to guess at.
    //
    // Reported as a note rather than a TODO because that is what `put()` already does for
    // a prescaler it cannot encode: the RCC word's gaps are comments here, and making this
    // one a TODO would be a second rule inside one function.
    const inp = M.clock.pll.inputs[k.pllIn] || {};
    parts.push({
      what: 'PLL input',
      note: `no codegen.rcc.pllsrc in the MCU file, so the input this configuration selects `
        + `("${inp.name || k.pllIn}") is NOT written. That field is not derivable here, and on a `
        + `part whose input carries a divider it is more than a source`,
    });
  }
  rccFill(w, c, k);
  return { register: w.register, value: w.value >>> 0, mask: w.mask >>> 0, parts: w.parts };
}

// ---- the files ---------------------------------------------------------------
const banner = title => `/* ${'='.repeat(74)}\n * ${title}\n * ${'='.repeat(74)} */`;

// An empty USER CODE block, or nothing at all when the option is off. Off means the
// markers are ABSENT rather than present-and-ignored: a marker that regeneration does
// not honour is a promise the file does not keep.
// Exported: export.js's generated main.c carries the same blocks under the same
// option, and two copies of this would be two things to keep in step.
export const user = (tag, indent = '') => (generatorOption('user_code') ? userSection(tag, indent) : []);

function headerComment() {
  const r = M.clock ? clockCalc() : null;
  const lines = [
    '/*',
    ` * ${M.mcu.name} initialisation — generated by WCHCube. Do not edit by hand:`,
    ' * change the configuration and generate again.',
    ' *',
    ` * Project : ${PROJECT.name}${PROJECT.variant ? ` (${PROJECT.variant})` : ''}`,
    ` * Part    : ${M.mcu.name}  ${S.pkg}`,
    ` * Core    : ${M.mcu.core || 'unknown'}`,
  ];
  if (r) lines.push(` * Clocks  : SYSCLK ${r.SYSCLK} MHz, HCLK ${r.HCLK} MHz (source ${S.clock.sys})`);
  lines.push(' *');
  lines.push(' * Register names follow the WCH EVT SDK (StdPeriph) headers.');
  lines.push(' */');
  return lines.join('\n');
}

export function cHeader() {
  const guard = `WCHCUBE_INIT_H`;
  return [
    headerComment(),
    '',
    `#ifndef ${guard}`,
    `#define ${guard}`,
    '',
    `#include "${cfg().header || 'debug.h'}"`,
    '',
    'void WCHCube_RCC_Init(void);    /* clock tree: SYSCLK source, PLL, prescalers */',
    'void WCHCube_GPIO_Init(void);   /* port clocks, AFIO remap, every configured pin */',
    'void WCHCube_Periph_Init(void); /* peripheral clocks and *_InitTypeDef blocks */',
    'void WCHCube_DMA_Init(void);    /* DMA_InitTypeDef per configured request */',
    'void WCHCube_NVIC_Init(void);   /* the enabled vectors, with PFIC priorities */',
    'void WCHCube_Init(void);        /* all of them, in the right order */',
    '',
    // Declared here only when they are DEFINED here; in split mode each one is
    // declared by its own header, and declaring it twice would be a second place to
    // keep in step.
    ...(generatorOption('split_peripherals') ? [] : initPeripherals().map(
      pid => `void ${periphInitName(pid)}(void);   /* ${pid} */`)),
    ...(generatorOption('split_peripherals') || !initPeripherals().length ? [] : ['']),
    ...user('Prototypes'),
    ...(generatorOption('user_code') ? [''] : []),
    `#endif /* ${guard} */`,
    '',
  ].join('\n');
}

// The pins the debug interface and the reset pin sit on, as a comment block.
function skipNote(left) {
  return [
    '    /* Not configured here, by design: ' + left.map(s => `${s.pin} (${s.signal})`).join(', '),
    '       the debug interface and the reset pin are controlled by the option bytes. */',
    '',
  ];
}

function gpioSection() {
  const plan = gpioPlan();
  const left = skippedPins();
  const unparsed = unparsedGpioPins();
  const L = [];
  L.push(banner('GPIO'));
  L.push('void WCHCube_GPIO_Init(void)');
  L.push('{');
  if (!plan.length && !unparsed.length) {
    if (left.length) L.push(...skipNote(left).slice(0, 2));
    else L.push('    /* No pins configured. */');
    // The same USER CODE tag as the configured path: the set of tags must not depend
    // on the configuration, or turning a peripheral off would orphan somebody's code.
    L.push(...user('GPIO', '    '));
    L.push('}');
    return L.join('\n');
  }
  if (plan.length) {
    L.push('    GPIO_InitTypeDef GPIO_InitStructure = {0};');
    L.push('');
  }

  const ports = [...new Set(plan.map(p => p.port))].sort();
  const gc = cfg().gpio_clock;
  if (!ports.length) {
    // Every claimed io pin failed to parse - `unparsed.length` is why this function
    // was even called - so there is no port to enable a clock for and no
    // GPIO_InitStructure to fill. Fall through to the unparsed-pin TODO below.
  } else if (gc && gc.fn && gc.port) {
    const macros = ports.map(p => gc.port.replace('$PORT', p));
    const remap = remapWord();
    if (remap && gc.afio) macros.push(gc.afio);
    L.push(`    ${gc.fn}(${macros.join(' | ')}, ENABLE);`);
  } else {
    L.push('    /* TODO: enable the port clocks for ' + ports.map(p => 'GPIO' + p).join(', ') +
      (remapWord() ? ' and AFIO' : '') + '.');
    L.push('       The MCU file has no codegen.gpio_clock block, and this generator does');
    L.push('       not guess register names. */');
  }
  if (ports.length) L.push('');

  for (const port of ports) {
    const mine = plan.filter(p => p.port === port);
    // one GPIO_Init call per distinct mode+speed on the port, the way CubeMX groups them
    const groups = new Map();
    for (const p of mine) {
      const key = `${p.macro || `?${p.mode}/${p.pull}`}|${p.speed}|${p.constrainedBy || ''}`
        + `|${p.speedMacro || ''}|${p.speedConstrainedBy || ''}`;
      (groups.get(key) || groups.set(key, []).get(key)).push(p);
    }
    for (const [key, pins] of groups) {
      const [, speed] = key.split('|');
      const macro = pins[0].macro;
      for (const p of pins) {
        const notes = [p.conflict ? '*** CONFLICT ***' : '', p.inferred ? 'analog mode inferred — add codegen.analog_signals to be certain' : ''].filter(Boolean);
        L.push(`    /* P${p.port}${p.bit}${p.label ? ` "${p.label}"` : ''} — ${p.signal}${notes.length ? '   ' + notes.join('; ') : ''} */`);
      }
      L.push(`    GPIO_InitStructure.GPIO_Pin = ${pins.map(p => `GPIO_Pin_${p.bit}`).join(' | ')};`);
      if (macro) {
        L.push(`    GPIO_InitStructure.GPIO_Mode = ${macro};`);
      } else if (pins[0].constrainedBy) {
        // The macro exists; the SILICON forbids this combination on these pins. Saying
        // "no SPL macro for ..." here would send the reader to the YAML, so it says
        // what actually happened and which constraint said so.
        L.push(`    /* TODO: ${pins[0].macroMissing}`);
        L.push('       The data forbids this mode on this pin; the generator will not emit it. */');
      } else {
        L.push(`    /* TODO: no SPL macro for GPIO mode "${pins[0].mode}"`
          + `${pins[0].mode === 'Input' ? ` with pull "${pins[0].pull}"` : ''} — ${pins[0].macroMissing}.`);
        L.push('       GPIOMode_TypeDef is per family; this generator does not guess a mode macro. */');
      }
      const sp = speedMacro(speed);
      if (pins[0].speedConstrainedBy) {
        L.push(`    /* TODO: ${pins[0].speedMissing}`);
        L.push('       The data forbids this output speed on this pin; the generator will not emit it. */');
      } else if (pins[0].speedMacro) {
        L.push(`    GPIO_InitStructure.GPIO_Speed = ${pins[0].speedMacro};`);
      } else if (sp.macro) {
        L.push(`    GPIO_InitStructure.GPIO_Speed = ${sp.macro};`);
      } else {
        L.push(`    /* TODO: no SPL macro for output speed ${sp.name === null ? '(unstated)' : `"${sp.name}"`}.`);
        L.push('       Add gpio.speeds (name + macro) to the MCU YAML; this generator does not');
        L.push('       guess a speed macro - the wrong one silently does not exist on the part. */');
      }
      L.push(`    GPIO_Init(GPIO${port}, &GPIO_InitStructure);`);
      L.push('');
    }
  }

  if (left.length) L.push(...skipNote(left));

  if (unparsed.length) {
    L.push(`    /* TODO: ${unparsed.length} pin${unparsed.length > 1 ? 's' : ''} this configuration claims `
      + `${unparsed.length > 1 ? 'are' : 'is'} not named P<port-letter><bit-number>, so this generator`);
    L.push('       cannot derive a GPIO port and bit for ' + (unparsed.length > 1 ? 'them' : 'it')
      + ' - it does not guess one from a different naming convention:');
    for (const u of unparsed) L.push(`         ${u.pin}: ${u.signal}`);
    L.push('       Needed: a pin-naming convention this generator recognises, or an explicit');
    L.push('       port/bit mapping in the MCU file. */');
    L.push('');
  }

  // AF style: one call per SIGNAL. Emitted before the two whole-peripheral styles
  // because a part is only ever one of the three, so at most one of these blocks runs.
  const ap = afPlan();
  if (ap.style === 'af'
      && (ap.calls.length || ap.missing.length || ap.contradictory.length || ap.dropped.length)) {
    if (ap.calls.length && ap.fn) {
      L.push('    /* Alternate function select (GPIOx_AFRL/AFRH, one field per pin) */');
      for (const c of ap.calls) {
        const macro = String(ap.macro).replace('$AF', String(c.af));
        L.push(`    ${ap.fn}(GPIO${c.port}, GPIO_PinSource${c.bit}, ${macro});`
          + `   /* ${c.pin} — ${sigName(c.periph, c.signal)} */`);
      }
      L.push('');
    } else if (ap.calls.length) {
      L.push('    /* TODO: alternate function select. The MCU file muxes per pin but gives no');
      L.push('       codegen.remap.fn, so the call that applies it cannot be written. Needed:');
      for (const c of ap.calls) L.push(`         ${c.pin}: ${sigName(c.periph, c.signal)} = AF${c.af}`);
      L.push('       Add codegen.remap.fn (GPIO_PinAFConfig on the parts seen so far). */');
    }
    // Two different gaps wear the same symptom — "a claimed signal with no `af:`" — and
    // they need two different keys. Splitting them here is the whole point: the first
    // list is followable advice, the second one used to be an instruction to invent an
    // AF code for a pad that has none.
    const needAf = ap.missing.filter(c => !c.advice);
    const needAnalog = ap.missing.filter(c => c.advice);
    if (needAf.length) {
      L.push('    /* TODO: alternate function select. These signals have a pin but the MCU file');
      L.push('       states no `af:` for it, and this generator does not guess an AF code:');
      for (const c of needAf) L.push(`         ${c.pin}: ${sigName(c.periph, c.signal)}`);
      L.push('       Add `af:` to the signal_pins entry and generate again. */');
    }
    if (needAnalog.length) {
      L.push('    /* TODO: these signals have a pin and no `af:` — and `af:` is most likely NOT');
      L.push('       what the MCU file is short of. Every one of them sits on a peripheral this');
      L.push('       file puts in the Analog category, and an analog pad has no alternate-function');
      L.push('       code to add: the function IS analog, and the pad is selected by the GPIO mode');
      L.push('       (GPIO_Mode_AIN), not by a field in GPIOx_AFRL/AFRH. The key is the analog');
      L.push('       list, one line per peripheral:');
      const byKey = new Map();
      for (const c of needAnalog) {
        (byKey.get(c.advice.key) || byKey.set(c.advice.key, []).get(c.advice.key)).push(c);
      }
      for (const [key, list] of [...byKey].sort((a, b) => a[0].localeCompare(b[0]))) {
        const sigs = [...new Set(list.map(c => c.advice.entry))].sort();
        L.push(`         ${key}: [${sigs.join(', ')}]`);
        for (const c of list) L.push(`           ${c.pin} — ${sigName(c.periph, c.signal)}`);
      }
      // The consequence, said out loud. GPIO_Init above has already configured these
      // pads as an alternate function, because that is what the data it was given says
      // — and a pad configured AF_PP when the silicon wants AIN is wrong-but-compiling,
      // which no gate downstream of here can see.
      L.push(`       Until that list exists, GPIO_Init above configures ${
        [...new Set(needAnalog.map(c => c.pin))].sort().join(', ')}`);
      L.push('       as an alternate function, which is wrong for an analog pad. If one of these');
      L.push('       really is muxed, `af:` is still the right answer for that one.');
      // The fallback route needs the pin flag too; the authoritative list does not. Say
      // which one is short of what rather than leaving the reader to find out by trying.
      const noFlag = needAnalog.filter(c => c.advice.pinFlagMissing).map(c => c.pin);
      if (noFlag.length) {
        L.push(`       (pins.<pin>.analog is not set for ${[...new Set(noFlag)].sort().join(', ')}`);
        L.push('        either, so the Analog-category fallback cannot answer this on its own.');
        L.push('        codegen.analog_signals is authoritative and needs no pin flag.) */');
      } else {
        L.push('       */');
      }
    }
    if (ap.dropped.length) {
      L.push('    /* TODO: these signals have an `af:` and it is NOT written, because another');
      L.push('       function on the same pad is analog and GPIO_Init above put the pad in');
      L.push('       GPIO_Mode_AIN. One pad is analog or it is muxed, never both:');
      for (const c of ap.dropped) {
        L.push(`         ${c.pin}: ${sigName(c.periph, c.signal)} (AF${c.af}) shares the pad with `
          + `${c.with.join(', ')}`);
      }
      L.push('       Move one of them to another pad, or switch the analog function off. */');
    }
    if (ap.contradictory.length) {
      L.push('    /* TODO: the MCU file says two different things about these pads. Each is in');
      L.push('       codegen.analog_signals — so its pad is GPIO_Mode_AIN and has no AF field —');
      L.push('       and each ALSO carries an `af:` code, which only a muxed pad can have:');
      for (const c of ap.contradictory) {
        L.push(`         ${c.pin}: ${sigName(c.periph, c.signal)} — af: ${c.af},`
          + ` and listed in codegen.analog_signals.${c.periph}`);
      }
      L.push('       Delete whichever is wrong; this generator will not pick one. */');
    }
  }

  // Macro style first: one SDK call per peripheral whose selected remap names a macro.
  const rp = remapPlan();
  const live = rp.calls.filter(c => c.used);
  if (live.length && rp.fn) {
    L.push('    /* Alternate function remap */');
    for (const c of live) {
      L.push(`    ${rp.fn}(${c.macro}, ${rp.enable});   /* ${c.periph}: ${c.name} */`);
    }
    L.push('');
  } else if (live.length) {
    L.push('    /* TODO: alternate function remap. The MCU file gives a macro per remap but no');
    L.push('       codegen.remap.fn, so the call that applies it cannot be written. Selected:');
    for (const c of live) L.push(`         ${c.periph}: ${c.name} — ${c.macro}`);
    L.push('       Add codegen.remap.fn (GPIO_PinRemapConfig on the parts seen so far). */');
  }
  for (const c of rp.calls) {
    if (c.used) continue;
    L.push(`    /*   ${c.periph} selects "${c.name}" but is switched off; nothing is remapped for it. */`);
  }

  // Register style: one word carrying every peripheral a macro did not already apply.
  const remap = remapWord();
  if (remap && remap.parts.length) {
    const active = remap.parts.filter(p => p.used);
    L.push('    /* Alternate function remap (AFIO) */');
    for (const p of remap.parts) {
      L.push(`    /*   ${p.periph}_RM = ${bin(p.index, p.width)} — ${p.name}${p.used ? '' : ' (peripheral off)'} */`);
    }
    L.push(`    ${remap.register} = (${remap.register} & ~${hex(remap.mask)}) | ${hex(remap.value)};`);
    if (!active.length) L.push('    /*   nothing enabled uses a remap; the write is the reset value. */');
  } else if (!rp.calls.length) {
    // Neither style reaches these: the peripheral is on, has a real choice of remaps,
    // and the data says nothing about how to apply the one that is selected.
    //
    // One exclusion, and it is the difference between a TODO and a false TODO: a
    // peripheral whose pins GPIO_Init must NOT touch needs no AFIO write either. CH32X035
    // bonds its reset pin to PC3 on TSSOP20 and QSOP28 instead of PA21 (`remap_by_package`,
    // index 1), SYS carries no `macro:` on either index because the reset pin is
    // controlled by the option bytes and not by a remap, and SYS's pins are skipped by
    // `codegen.skip_signals` - so EVERY CH32X035 TSSOP20 configuration used to emit a
    // spurious TODO naming SYS, and failed --strict for a rule that does not exist.
    //
    // The test is read from the data, not from a peripheral name: does any signal this
    // peripheral requires actually reach a GPIO register?
    const configured = pid => [...requiredSignals(pid)]
      .some(sig => !skippedClaim({ who: pid, signal: sigName(pid, sig) }));
    // `remap_unwritable:` peripherals are excluded here — they get their own, more
    // specific TODO below (citing WHY, rather than suggesting a fix that does not
    // exist for them), and reporting the same peripheral twice under two different
    // explanations would be worse than either alone.
    const used = Object.keys(M.peripherals).filter(pid =>
      (M.peripherals[pid].remaps || []).length > 1
      && (S.periph[pid] || {}).remap
      && !M.peripherals[pid].remap_unwritable
      && configured(pid));
    if (used.length) {
      L.push('    /* TODO: alternate function remap. The MCU file has neither a `macro:` on the');
      L.push('       selected remap nor codegen.remap.fields, so nothing can be applied. Selected:');
      for (const pid of used) {
        const i = S.periph[pid].remap;
        L.push(`         ${pid}: index ${i} — ${M.peripherals[pid].remaps[i].name}`);
      }
      L.push('       Add one or the other to the MCU YAML and generate again. */');
    }
  }

  // `remap_unwritable:` — a peripheral whose SELECTED, non-default remap is a real
  // silicon choice (offered for pin planning, claims its pads, exports correctly — all
  // already true of any `remaps:` peripheral, nothing above this needed to change) but
  // that THIS part's codegen has no way to write, permanently, not as an oversight.
  // The block above already catches "nothing can be applied" and suggests "add a macro
  // or a fields entry" — correct advice for a gap someone can close. That advice is
  // WRONG for SDMMC on CH32H417: `AFIO_PCFR1.SDMMC_RM[1:0]` is a real register field,
  // but this part's `codegen.remap.style: af` has no per-peripheral field to write it
  // (`FORMAT.md`: "style: af forbids codegen.remap.fields") and the SDK exposes no
  // macro for it either — there is no YAML key to add. Silently emitting nothing here
  // (the previous behaviour, and the reason SDMMC's other two mappings were dropped
  // from the file entirely rather than shipped this way) is the worse failure: a user
  // plans RM=01, the generator writes nothing, and the board ships wired for a mux the
  // firmware never sets. `remap_unwritable:` says so in the generated C instead, cited,
  // so `--strict`/`cComplaints()` catches it exactly like any other TODO — visible, not
  // an unexplained warning and not invisible either. Checked independently of every
  // style and of the generic detection above, so a part that also has a macro- or
  // fields-covered peripheral elsewhere cannot hide a cited gap behind its success.
  const citedUnwritable = Object.keys(M.peripherals).filter(pid => {
    const P = M.peripherals[pid];
    if (!P.remap_unwritable) return false;
    const remaps = P.remaps || [];
    const idx = (S.periph[pid] || {}).remap || 0;
    if (!idx || !remaps[idx]) return false;                          // index 0 needs no write
    if (remaps[idx].macro) return false;                             // a macro covers THIS entry
    if (((cfg().remap || {}).fields || {})[pid]) return false;       // a fields word covers it
    return [...requiredSignals(pid)].some(sig => !skippedClaim({ who: pid, signal: sigName(pid, sig) }));
  });
  if (citedUnwritable.length) {
    L.push('    /* TODO: alternate function remap. Selected for pin planning, but this MCU file');
    L.push('       says this part\'s generator has no way to write it at all - not a gap to');
    L.push('       close by adding a macro or a fields entry, see the citation. Configure this');
    L.push('       register by hand to match the plan:');
    for (const pid of citedUnwritable) {
      const i = S.periph[pid].remap;
      L.push(`         ${pid}: index ${i} — ${M.peripherals[pid].remaps[i].name}. ${M.peripherals[pid].remap_unwritable}`);
    }
    L.push('    */');
  }

  L.push(...user('GPIO', '    '));
  L.push('}');
  return L.join('\n');
}

function rccSection() {
  const L = [];
  L.push(banner('Clock tree'));
  L.push('void WCHCube_RCC_Init(void)');
  L.push('{');
  if (!M.clock) {
    L.push('    /* This MCU file has no clock section. */');
    L.push('}');
    return L.join('\n');
  }
  const r = clockCalc(), k = S.clock, fp = firstPre(M.clock);
  L.push(`    /* SYSCLK ${r.SYSCLK} MHz from ${k.sys}${k.sys === 'PLLCLK' ? ` (${M.clock.pll.inputs[k.pllIn].name} x ${k.pllMul})` : ''} */`);
  L.push(`    /* ${fp} /${k.pre[fp]} -> HCLK ${r.HCLK} MHz */`);
  // A second PLL gets its own line: its output is what the taps below are divided from,
  // so a reader who cannot see it cannot check their arithmetic.
  for (const p of pllList(M.clock)) {
    if (p.sys) continue;
    const rp = r.plls[p.id];
    L.push(`    /* ${p.id}: ${rp.name || rp.source || '?'}${rp.fixed ? '' : ` x ${rp.mul}${rp.div !== 1 ? ` / ${rp.div}` : ''}`}`
      + ` -> ${p.output} ${rp.out} MHz${rp.fixed ? ' (fixed)' : ''} */`);
  }
  for (const [name, v] of Object.entries(M.clock.prescalers || {})) {
    if (name === fp) continue;
    // A tap whose source is a mux says which side of it this configuration picked -
    // the LEG's own name, so a divider the leg itself carries ("SERDES_PLL /2") reads
    // in the comment rather than only the bare signal it divides.
    const chosen = tapSourceEntry(v, name, k);
    const from = tapSources(v) ? `${chosen.name} ` : '';
    // A tap whose only divider lives in its mux legs (RM 4085-4089's shape) has no
    // `k.pre[name]` to print - the "/<n>" is the tap's OWN options divider, and there
    // is nothing to say when the file gives it none.
    const div = k.pre[name] !== undefined ? `/${k.pre[name]} ` : '';
    L.push(`    /* ${name} ${from}${div}-> ${r[name]} MHz${v.min_mhz || v.max_mhz ? ` (${v.min_mhz || 0}-${v.max_mhz || '?'} MHz)`
      : v.target_mhz ? ` (must be ${v.target_mhz} MHz)` : ''} */`);
  }
  if (r.over.length) L.push(`    /* WARNING: out of specification: ${r.over.join(', ')} */`);
  L.push('');
  const words = rccWords();
  const rcc = words[0] || null;
  if (rcc) {
    // One block per register: the fields that went into it, then the write. A part with
    // one register gets exactly what it got before; CH32H417 gets CFGR0, then CFGR2,
    // then PLLCFGR2, each under its own fields.
    for (const w of words) {
      for (const p of w.parts) {
        L.push(p.note ? `    /* ${p.what}: ${p.note} */`
          : `    /* ${p.what} = ${bin(p.field, p.bits)} (bit${p.bits > 1 ? `s ${p.lsb + p.bits - 1}:${p.lsb}` : ` ${p.lsb}`}) */`);
      }
      L.push(`    ${w.register} = (${w.register} & ~${hex(w.mask >>> 0)}) | ${hex(w.value >>> 0)};`);
    }
    L.push('');
    // Name what THIS part has to start, not what CH32V006 has. A source the data marks
    // `fixed: true` runs from reset and needs no start-up; the rest do. A part with none
    // - CH32X035 has no HSE at all - must not be told about an oscillator it lacks.
    const starts = Object.entries(M.clock.sources || {})
      .filter(([, v]) => v && !v.fixed).map(([n]) => n);
    if (M.clock.pll) starts.push('the PLL');
    if (starts.length) {
      L.push(`    /* NOTE: this writes the mux and prescaler fields only. Starting ${starts.join(' and ')}`);
      L.push('       and waiting for it to lock is the SDK SystemInit()\'s job. */');
    } else {
      L.push('    /* NOTE: this writes the mux and prescaler fields only. Every clock source on');
      L.push('       this part runs from reset, so there is nothing to start or wait for. */');
    }
  } else {
    L.push('    /* TODO: the MCU file has no codegen.rcc block, so the register word cannot');
    L.push('       be computed. The settings above are what the configuration asks for. */');
  }
  L.push(...user('RCC', '    '));
  L.push('}');
  return L.join('\n');
}

// A fixture exists to exercise the tool, not to be flashed: it may legitimately have
// no `codegen:` block and its output stays an explanatory TODO. A real part without one
// must refuse to compile instead, so nobody flashes a half-generated init.
// AGENT-1: set `mcu.fixture: true` on the dummy part and the name/vendor sniffing goes away.
export function isFixture() {
  const m = (M && M.mcu) || {};
  return !!(m.fixture || /dummy/i.test(m.vendor || '') || /dummy/i.test(m.name || ''));
}

export function cSource() {
  const e = E || compute();
  const L = [headerComment(), '', '#include "wchcube_init.h"'];
  // In split mode the bodies are in their own translation units, so this one needs
  // their declarations to call them.
  if (generatorOption('split_peripherals')) {
    for (const pid of initPeripherals()) L.push(`#include "${periphFileBase(pid)}.h"`);
  }
  L.push('');
  const inc = user('Includes'), pv = user('PV');
  if (inc.length) L.push(...inc, '');
  if (pv.length) L.push(...pv, '');
  if (!M.codegen && !isFixture()) {
    L.push(`#error "WCHCube: ${M.mcu.name} has no codegen: block, so the AFIO and RCC register `
      + `words cannot be generated. Add one to its MCU file (see data/FORMAT.md); the sections `
      + `below name exactly what is missing."`);
    L.push('');
  }
  // A channel the user booked twice cannot be resolved by generating both and letting
  // the last write win - that is silently wrong silicon. Round-3 P2 asks for #error.
  for (const c of dmaConflicts()) {
    L.push(`#error "WCHCube: ${c.text.replace(/"/g, "'")}. Remove one of them in DMA Settings."`);
    L.push('');
  }
  if (e.conflictList.length) {
    L.push(`#error "WCHCube: ${e.conflictList.length} unresolved pin conflict(s) — ${e.conflictList.map(c => c.text).join('; ')}"`);
    L.push('');
  }
  L.push(rccSection(), '', gpioSection(), '', periphSection(), '', dmaSection(), '', nvicSection(), '');
  L.push(banner('Entry point'));
  L.push('void WCHCube_Init(void)');
  L.push('{');
  // Clocks first because everything else needs them; peripherals before DMA because a
  // channel points at a peripheral register; NVIC last so nothing can fire into a
  // half-configured peripheral.
  L.push('    WCHCube_RCC_Init();');
  L.push('    WCHCube_GPIO_Init();');
  L.push('    WCHCube_Periph_Init();');
  L.push('    WCHCube_DMA_Init();');
  L.push('    WCHCube_NVIC_Init();');
  L.push(...user('Init', '    '));
  L.push('}');
  L.push('');
  return L.join('\n');
}

// ---- peripheral init structs -------------------------------------------------
//  `params:` -> `*_InitTypeDef` blocks. Every name here comes from the MCU file:
//  `struct:` is the typedef, `sdk_field:` the member, and an enum option's `sdk:`
//  the macro. Nothing is derived from the peripheral's name - `USART_InitTypeDef`
//  does NOT imply `USART_Init`, and data/FORMAT.md is explicit that not every
//  parameter is a struct member at all:
//
//    sdk_call:      the SDK sets it with a function, not a member  (TIM arpe)
//    sdk_none:      the SDK exposes nothing for it                 (ADC lowpower)
//    sdk_manual:    the SDK exposes something, but not safely at init - firmware
//                   sets it later                                  (LTDC pixel format)
//    struct: other  it belongs to a DIFFERENT struct               (TIM1 deadtime)
//
//  `sdk_none` and `sdk_manual` read as the same shape - a note instead of a struct
//  field - and they say a DIFFERENT true thing. `sdk_none: "the SDK exposes nothing
//  for it"` is false for a parameter the SDK CAN set; it is only unsafe to set from
//  this generator's one-shot init function. Saying "nothing" when something exists is
//  the kind of false comment a person reads as documentation and believes.
//
//  A parameter that does not apply under the current settings is not emitted, and
//  neither is one the data marks readonly - those are derived, not chosen.

/** The literal to assign for one parameter, or a reason it cannot be written. */
// `value` is optional and defaults to the peripheral-level store. A per-INSTANCE
// parameter has the same definitions and the same literal rules but a different store
// (`channelParamValue(pid, n, key)`), so the value is passed in rather than the whole
// formatter being written a second time next to this one.
function paramLiteral(pid, d, value) {
  // A `const:` member comes first because it is the most specific thing a param can be:
  // the MCU file names the one value it can take, and there is nothing to look up. OPA
  // and CMP are why - the SDK branches on `*_NUM` inside `OPA_Init`, so a struct that
  // leaves it unset configures whichever instance the uninitialised field happens to
  // name. Wrong but compiling, which is the defect class this file exists to avoid.
  if (isConstParam(d)) return { text: String(d.const) };
  const v = value !== undefined ? value : paramValue(pid, d.key);
  if (d.type === 'bool') {
    const macro = v ? d.sdk_enabled : d.sdk_disabled;
    if (macro) return { text: macro };
    return { missing: `${d.name}: the MCU file gives no sdk_enabled/sdk_disabled macro for ${v}` };
  }
  if (d.options) {
    const hit = d.options.find(o => String(o.name) === String(v));
    if (hit && hit.sdk) return { text: hit.sdk };
    return { missing: `${d.name}: option "${v}" has no sdk: macro in the MCU file` };
  }
  if (typeof v === 'number' && Number.isFinite(v)) return { text: String(v) };
  if (v === undefined || v === null) return { missing: `${d.name}: no value` };
  return { missing: `${d.name}: "${v}" is not a number and has no sdk: macro` };
}

/**
 * What has to be emitted for one peripheral, grouped the way the SDK applies it:
 * one block per `struct:`, in the order the parameters appear in the MCU file,
 * which is the order AGENT-1 wrote them in - register order.
 *
 * `fn` and `handle` are looked up in `codegen.init_structs` / `codegen.periph_handle`.
 * They are NOT guessed: `USART_Init(USART1, &s)` is two names this generator has no
 * source for, and round 3 opened with two defects that were exactly one wrong
 * identifier each. Without them the block is still emitted - the field values are
 * known and useful - followed by a TODO naming the two keys that would apply it.
 */
/**
 * ONE peripheral, TWO register blocks — and which one is right is a MODE, not a name.
 *
 * `codegen.periph_handle.<PID>` is a string for every peripheral that has one register
 * block. CH32H417's full-speed USB has two: `ch32h417.h:1810-1811` defines
 *
 *     #define USBFSD  ((USBFSD_TypeDef *)USBFS_BASE)
 *     #define USBFSH  ((USBFSH_TypeDef *)USBFS_BASE)
 *
 * — the SAME base address behind two different struct types, because the peripheral is a
 * device controller or a host controller and its registers mean different things in each
 * role. A single string cannot name both, so USB `params:` could not be written at all;
 * the same shape appeared on CH32X035 in round 4 (`USBFSD` / `USBFSH`) and was parked.
 *
 * It is not a second peripheral and it is not two handles at once: it is one handle whose
 * value depends on a choice the user has ALREADY made. The Device/Host setting exists, it
 * already decides which block is initialised, so the data names the setting and the handle
 * each of its choices implies:
 *
 *     periph_handle:
 *       USBFS:
 *         setting: Mode
 *         by_choice:
 *           Device (FS): USBFSD
 *           Host (FS):   USBFSH
 *
 * A choice with no entry is NOT defaulted to either one. Picking the device block for a
 * host configuration writes host registers through device field names, which compiles and
 * is wrong on the board - the defect class this generator exists to refuse - so it becomes
 * a TODO naming the choice and the key.
 */
export function periphHandle(pid) {
  const spec = (cfg().periph_handle || {})[pid];
  if (spec === undefined || spec === null) return { handle: null, missing: null };
  if (typeof spec === 'string') return { handle: spec, missing: null };
  if (typeof spec !== 'object') {
    return { handle: null, missing: `codegen.periph_handle.${pid} is neither a name nor a by_choice block` };
  }
  const setting = spec.setting;
  const table = spec.by_choice;
  if (!setting || !table || typeof table !== 'object') {
    return {
      handle: null,
      missing: `codegen.periph_handle.${pid} is a block but names no `
        + `${!setting ? 'setting:' : 'by_choice:'}, so which register block applies cannot be read`,
    };
  }
  const chosen = ((S.periph[pid] || {}).settings || {})[setting];
  if (chosen === undefined) {
    return { handle: null, missing: `codegen.periph_handle.${pid}.setting names "${setting}", `
      + `which is not a setting ${pid} has` };
  }
  const hit = table[chosen];
  if (hit) return { handle: hit, missing: null, via: `${setting} = ${chosen}` };
  return {
    handle: null,
    missing: `codegen.periph_handle.${pid}.by_choice has no register block for ${setting} = `
      + `"${chosen}" (it names ${Object.keys(table).map(k => `"${k}"`).join(', ') || 'nothing'}). `
      + 'The two blocks are the same base address read as different structs, so the wrong one '
      + 'compiles and is wrong on the board; this generator will not pick one',
  };
}

export function initPlan(pid) {
  const defs = paramDefs(pid).filter(d => !d.readonly && paramApplies(pid, d));
  const structs = [];
  const calls = [];
  const notes = [];
  const cg = cfg();
  const hs = periphHandle(pid);
  const handle = hs.handle;
  for (const d of defs) {
    // `sdk_manual:` FIRST, and checked separately from `sdk_none:` even though both
    // produce a note rather than a struct field — the two say opposite things about
    // whether the SDK exposes the setting at all, and `sdk_none` read over a
    // `sdk_manual` case would tell a reader the SDK has no such setter when it does.
    if (d.sdk_manual) {
      notes.push(`${d.name} = ${paramValue(pid, d.key)} — set by firmware`
        + (d.sdk_note ? `: ${d.sdk_note}` : ''));
      continue;
    }
    if (d.sdk_none) {
      notes.push(`${d.name} = ${paramValue(pid, d.key)} — the SDK exposes nothing for it`
        + (d.sdk_note ? `: ${d.sdk_note}` : ''));
      continue;
    }
    if (d.sdk_call) {
      calls.push(...sdkCalls(pid, d, handle));
      continue;
    }
    if (!d.struct) {
      notes.push(`${d.name} = ${paramValue(pid, d.key)} — the MCU file says neither struct:, sdk_call: nor sdk_none:`);
      continue;
    }
    if (!d.sdk_field) {
      notes.push(`${d.name}: struct: ${d.struct} without an sdk_field:, so the member name is unknown`);
      continue;
    }
    // Two params can name the SAME struct: but a struct member that is a pointer to a
    // second struct (below) needs TWO separate instances of that second struct, one per
    // pointer member — grouping by struct name alone would merge FMC_ReadWriteTimingStruct's
    // fields and FMC_WriteTimingStruct's fields into one block. `embed:` disambiguates.
    let block = structs.find(b => b.struct === d.struct && b.embed === (d.embed || null));
    if (!block) {
      const spec = (cg.init_structs || {})[d.struct] || {};
      // A single-instance peripheral's Init takes the struct ALONE: OPA_Init(&s), not
      // OPA_Init(OPA, &s) (ch32v00X_opa.h). The data says so; it is not guessable.
      structs.push(block = {
        struct: d.struct, fn: spec.fn || null,
        noHandle: !!spec.no_handle, handle: spec.no_handle ? null : (handle || null),
        // WHY the handle is absent, when the data tried to give one. A by_choice block
        // whose current choice is unlisted is a different gap from no entry at all, and
        // "add codegen.periph_handle.USBFS" would be wrong advice for it - the key is
        // already there.
        handleMissing: spec.no_handle ? null : hs.missing,
        fields: [], missing: [],
        // Set below this loop, once every block has all its fields, for a block whose
        // `embed:` names a real `codegen.init_structs.<struct>.embed.<key>` entry: the
        // block it is a pointer INTO. Left null for an ordinary (non-nested) struct.
        embed: d.embed || null, embedInto: null,
      });
    }
    const lit = paramLiteral(pid, d);
    if (lit.missing) block.missing.push(lit.missing);
    else block.fields.push({ member: d.sdk_field, text: lit.text, name: d.name, value: paramValue(pid, d.key), unit: d.unit });
  }

  // ---- nested structs: a member that is a POINTER to a second struct -----------
  // `ch32h417_fmc.h:113-115`: `FMC_NORSRAMInitTypeDef` has two members,
  // `FMC_ReadWriteTimingStruct` and `FMC_WriteTimingStruct`, both
  // `FMC_NORSRAMTimingInitTypeDef*`, and no SDK function takes the inner struct alone.
  // Shipping the outer struct with those left null is WORSE than not shipping it —
  // `FMC_NORSRAMInit()` dereferences `FMC_ReadWriteTimingStruct` unconditionally, so a
  // zeroed struct is a null read at init. So every block whose params carried `embed:`
  // is resolved here, AFTER every block has all its fields (a param naming the outer
  // struct may be read before or after the params naming the inner one — order in the
  // MCU file must not matter): `codegen.init_structs.<inner-struct>.embed.<key>` names
  // the outer struct and the pointer member that receives `&<this block's variable>`.
  // The outer struct's own block is created here if the data has no direct params for
  // it (FMC_NORSRAMInitTypeDef might, in principle, be nothing but two timing pointers).
  for (const block of structs) {
    if (!block.embed) continue;
    const spec = (cg.init_structs || {})[block.struct] || {};
    const emb = (spec.embed || {})[block.embed];
    if (!emb || !emb.into || !emb.member) {
      block.missing.push(`codegen.init_structs.${block.struct}.embed.${block.embed} does not name `
        + 'both an into: struct and a member: — this struct has no fn: because nothing calls it '
        + 'alone, so without a complete embed: entry nothing applies it either');
      continue;
    }
    let target = structs.find(b => b.struct === emb.into && !b.embed);
    if (!target) {
      const outerSpec = (cg.init_structs || {})[emb.into] || {};
      structs.push(target = {
        struct: emb.into, fn: outerSpec.fn || null,
        noHandle: !!outerSpec.no_handle, handle: outerSpec.no_handle ? null : (handle || null),
        handleMissing: outerSpec.no_handle ? null : hs.missing,
        fields: [], missing: [], embed: null, embedInto: null,
      });
    }
    block.embedInto = target;
    target.fields.push({
      member: emb.member, text: `&${blockVarName(block)}`,
      name: `${block.struct} (embed: ${block.embed})`, pointer: true,
    });
  }
  // A `when:` that cannot be resolved against this MCU file is a data defect with a
  // silent failure mode, so it becomes a TODO - see `depProblems()` in params.js for the
  // three ways it was measured to go wrong. Checked over EVERY param, not only the
  // applicable ones: a broken dependency is exactly the case that is applicable for the
  // wrong reason.
  const problems = [];
  for (const d of paramDefs(pid)) problems.push(...depProblems(pid, d));

  // ---- one OR MORE structs, applied once PER INSTANCE -------------------------
  // `channel_params` (params.js). Every block is filled and applied once for each LIVE
  // instance, and what varies per instance is the function, the handle, or both:
  // `TIM_OC1Init(TIM1, &s)` … `TIM_OC4Init(TIM1, &s)` vary the function and keep the
  // peripheral's handle; `LTDC_LayerInit(LTDC_Layer1, &s)` keeps the function and varies
  // the handle. Both arrive here as the same row, so this loop knows about neither.
  //
  // SAI (and SERDES, the same shape) need MORE than one struct per instance: the SDK's
  // own example calls `SAI_Init`, `SAI_FrameInit` and `SAI_SlotInit` for a single block
  // (`SAI1_Block_A` / `SAI1_Block_B`, `ch32h417.h:1775-1776`), each its own struct type,
  // each taken directly by its own function - unlike `embed:` (codegen.js above), where
  // an inner struct is reached ONLY through a pointer inside another and nothing calls
  // it alone. This is the opposite shape: three structs that all stand on their own and
  // simply happen to share one instance's handle.
  //
  // No new list-of-structs schema is needed: a `channel_params.params:` ROW may already
  // carry `struct:` like any ordinary `params:` row (TIM1's deadtime does the same thing
  // one level up, "it belongs to a DIFFERENT struct" in the comment atop this file) - it
  // simply used to be pointless here because every row silently used `cbl.struct`. A row
  // naming a DIFFERENT struct now gets its OWN block, and because that struct's function
  // does not vary by instance (SAI_FrameInit is SAI_FrameInit on Block A and Block B;
  // only the HANDLE varies, and that is resolved the same way as the primary struct's),
  // its `fn:` comes from `codegen.init_structs.<that struct>.fn` - the same global table
  // every non-channel struct already uses - rather than from the per-instance `sdk_call`
  // table, which is the primary struct's mechanism and stays exactly as it was.
  const cbl = channelParamBlock(pid);
  if (cbl && cbl.struct) {
    const plan = activeInstances(pid);
    if (plan.missing) problems.push(plan.missing);
    if (plan.note) notes.push(plan.note);
    const chanDefs = channelParamDefs(pid);
    for (const inst of plan.instances) {
      const byStruct = new Map();
      const primary = {
        struct: cbl.struct, fn: inst.fn || null,
        // No `handle:` on the row means the peripheral's own register block, which is
        // the timer case. An LTDC layer names its own.
        noHandle: false, handle: inst.handle || handle || null,
        fields: [], missing: [],
        instance: { n: inst.n, noun: plan.noun },
      };
      byStruct.set(cbl.struct, primary);
      structs.push(primary);
      for (const d of chanDefs) {
        if (d.readonly || !paramApplies(pid, d)) continue;
        const structName = d.struct || cbl.struct;
        let block = byStruct.get(structName);
        if (!block) {
          const spec = (cg.init_structs || {})[structName] || {};
          block = {
            struct: structName, fn: spec.fn || null,
            noHandle: !!spec.no_handle, handle: spec.no_handle ? null : (inst.handle || handle || null),
            // Read by `periphBlock()`'s existing "nothing applies this struct" fallback
            // when `fn` is missing - the SAME message an ordinary (non-channel) struct
            // gets, because it is the same gap: a struct beyond the block's own
            // `cbl.struct` needs its OWN `codegen.init_structs.<struct>.fn` entry, since
            // unlike the primary struct its function cannot come from an instance's
            // `sdk_call`.
            fields: [], missing: [],
            instance: { n: inst.n, noun: plan.noun },
          };
          byStruct.set(structName, block);
          structs.push(block);
        }
        if (!d.sdk_field) {
          block.missing.push(`${d.name}: channel_params gives no sdk_field:, so the member name is unknown`);
          continue;
        }
        const value = channelParamValue(pid, inst.n, d.key);
        const lit = paramLiteral(pid, d, value);
        if (lit.missing) block.missing.push(lit.missing);
        else block.fields.push({ member: d.sdk_field, text: lit.text, name: d.name, value, unit: d.unit });
      }
      if (!inst.fn) {
        primary.missing.push(`channel_params names no sdk_call for ${plan.noun} ${inst.n}, `
          + 'and this generator does not paste a function name together from a number');
      }
    }
  }
  return { pid, structs, calls, notes, handle: handle || null, problems };
}

/**
 * A parameter the SDK sets with a FUNCTION rather than a struct member. The data gives
 * the function and its argument list as placeholders, because the shape is not
 * derivable: `TIM_ARRPreloadConfig(TIMx, NewState)` takes two arguments and
 * `ADC_RegularChannelConfig(ADCx, channel, rank, sampletime)` takes four, one call per
 * CHANNEL. Placeholders, all from data/FORMAT.md:
 *     $HANDLE   codegen.periph_handle[pid]
 *     $VALUE    the option's sdk: macro, the bool's sdk_enabled/sdk_disabled, or a number
 *     $CHANNEL  codegen.channel_macros[pid][signal], with sdk_repeat: channels
 *     $RANK     1-based position in that repeat
 *     $INDEX    0-based position in that repeat
 * Anything else, or a placeholder that cannot be filled, becomes a TODO naming it.
 */
function sdkCalls(pid, d, handle) {
  const lit = paramLiteral(pid, d);
  const args = Array.isArray(d.sdk_args) ? d.sdk_args : null;
  // `sdk_call_order: before_structs` — most `sdk_call:` rows are an ordinary
  // "set this one thing", order-independent, so the default and the ONLY behaviour
  // before this existed is unchanged: every call after every struct block. But some
  // calls are a PRECONDITION for a struct write to take effect, not merely another
  // thing to configure — LPTIM is the proven case (RM 3.4.13 neighbourhood aside; see
  // CH32H417RM.md 17.5.5 LPTIMx_CR): `LPTIM_TimeBaseInit()` writes CNTSTRT/SNGSTRT/OUTEN
  // into the SAME register as ENABLE, preserving whatever ENABLE already was
  // (`ch32h417_lptim.c:54,76-77`, `temp2 = CR & 1` then `CR = temp2`) — and the RM says
  // outright those bits are "write only when ENABLE=1". Emit `LPTIM_Cmd(.... ENABLE)`
  // in this generator's usual (struct-then-call) order and the write lands while
  // ENABLE is still 0: it compiles, the counter never starts, PWM output never enables,
  // and nothing says so — the exact "plausible-looking wrong code" this file exists to
  // refuse. `before_structs` says the call must run BEFORE any struct in this
  // peripheral is filled and applied; anything else keeps today's order, unchanged.
  const order = d.sdk_call_order === 'before_structs' ? 'before' : 'after';
  const base = {
    key: d.key, name: d.name, fn: d.sdk_call, value: paramValue(pid, d.key), note: d.sdk_note || '', order,
  };
  if (!args) return [{ ...base, missing: 'the MCU file gives no sdk_args, so the argument list is unknown' }];
  if (lit.missing) return [{ ...base, missing: lit.missing }];

  // One call per selected channel, or exactly one call.
  let repeats = [null];
  if (d.sdk_repeat === 'channels') {
    const macros = (cfg().channel_macros || {})[pid];
    if (!macros) return [{ ...base, missing: `codegen.channel_macros.${pid} — no macro for any channel` }];
    const chosen = selectedChannels(pid);
    if (!chosen.length) return [];                 // nothing selected, nothing to configure
    repeats = chosen.map((sig, i) => ({ sig, macro: macros[sig], rank: i + 1, index: i }));
    const unknown = repeats.filter(r => !r.macro).map(r => r.sig);
    if (unknown.length) return [{ ...base, missing: `codegen.channel_macros.${pid} has no macro for ${unknown.join(', ')}` }];
  } else if (d.sdk_repeat) {
    return [{ ...base, missing: `sdk_repeat: ${d.sdk_repeat} is not a repeat this generator knows` }];
  }

  const out = [];
  for (const r of repeats) {
    const filled = [];
    let missing = null;
    for (const a of args) {
      const token = String(a);
      if (token === '$VALUE') filled.push(lit.text);
      else if (token === '$HANDLE') {
        if (!handle) missing = periphHandle(pid).missing || `codegen.periph_handle.${pid}`;
        else filled.push(handle);
      }
      else if (token === '$CHANNEL') { if (!r) missing = '$CHANNEL without sdk_repeat: channels'; else filled.push(r.macro); }
      else if (token === '$RANK') { if (!r) missing = '$RANK without sdk_repeat: channels'; else filled.push(String(r.rank)); }
      else if (token === '$INDEX') { if (!r) missing = '$INDEX without sdk_repeat: channels'; else filled.push(String(r.index)); }
      else if (/^[$]/.test(token)) missing = `${token} is not a placeholder this generator knows`;
      else filled.push(token);                      // a literal argument, written as given
      if (missing) break;
    }
    if (missing) { out.push({ ...base, missing }); break; }
    out.push({ ...base, text: `${d.sdk_call}(${filled.join(', ')});`, channel: r ? r.sig : null });
  }
  return out;
}

/**
 * The signals of a `checkboxes` setting the user ticked — ADC1's Channels. Read from
 * the settings rather than from a name, so a part that spells it differently still
 * works and the engine special-cases no peripheral.
 */
function selectedChannels(pid) {
  const P = M.peripherals[pid] || {};
  const st = (S.periph[pid] || {}).settings || {};
  const out = [];
  for (const s of P.settings || []) {
    if (s.type !== 'checkboxes') continue;
    const v = st[s.name];
    if (!(v instanceof Set)) continue;
    for (const c of s.choices) if (v.has(c.name)) out.push(c.name);
  }
  return out;
}

/** Peripherals that are switched on and have something to initialise. */
export function initPeripherals() {
  const e = E || compute();
  return Object.keys(M.peripherals)
    .filter(pid => isEnabled(pid))
    // `channelParamBlock` is in this test because a peripheral's parameters can live
    // ENTIRELY in its per-instance block: LTDC's settable members are all in
    // `LTDC_Layer_InitTypeDef`, one per layer, so `paramDefs()` is empty for it and it
    // was dropped here before it ever reached initPlan(). Measured on the synthetic
    // layer part: the init function was not generated at all. Every peripheral that
    // ships today has peripheral-level params beside its channel ones, so this adds
    // nobody to the list on the current data - checked by the byte-comparison.
    .filter(pid => paramDefs(pid).length || channelParamBlock(pid)
      || (cfg().periph_clock && clockBitOf(pid)))
    .sort();
}

/** The RCC enable register a peripheral's clock bit lives in, from codegen.periph_clock. */
export function clockBitOf(pid) {
  for (const [bus, spec] of Object.entries(cfg().periph_clock || {})) {
    if (!spec || typeof spec !== 'object' || !spec.bits) continue;
    if (spec.bits[pid] === undefined) continue;
    // The bit's key names the peripheral, and the macro is built from it. Those two are
    // usually the same word and sometimes are not: on CH32H417 the USB full-speed
    // controller is the peripheral `USBFS`, but its clock bit is `RCC_HBPeriph_OTG_FS`,
    // and `OPA`/`CMP` share `RCC_HB2Periph_OPCM`. Without `sdk` the lookup is still by
    // peripheral name but the macro would be `RCC_HBPeriph_USBFS`, which the SPL does not
    // define — so there is no way to write the bit that is right in both roles. A domain
    // may therefore carry `sdk: { <peripheral>: <macro suffix> }`; a peripheral not named
    // there keeps using its own name, so data files that predate this are unaffected.
    const suffix = (spec.sdk || {})[pid] || pid;
    return { bus, fn: spec.fn, macro: `${spec.prefix || ''}${suffix}`, register: spec.register };
  }
  return null;
}

function structVar(name) {
  // USART_InitTypeDef -> USART_InitStructure, the SPL's own naming in every example.
  const s = String(name);
  const stripped = s.replace(/TypeDef$/, 'Structure');
  // codegen.js read-through item 4 (backlog, manager-assigned): every struct type on
  // every shipped part ends in `TypeDef`, so this line never fires today - but nothing
  // in codegen.init_structs PROMISES that, and one that does not would otherwise get a
  // variable named IDENTICALLY to its own type (`Foo Foo = {0};`), which a peripheral
  // with two such structs could then collide on. Suffixed instead: cheap, and inert on
  // every real struct because every real struct already took the branch above.
  return stripped === s ? `${s}_var` : stripped;
}

// An embedded block's variable needs to be UNIQUE from its siblings: RW and WR are both
// `FMC_NORSRAMTimingInitTypeDef`, and structVar() alone would give both the same name.
// Suffixing with the embed key keeps every declared variable distinct without inventing
// a numbering scheme the data does not have.
function blockVarName(b) {
  return structVar(b.struct) + (b.embed ? `_${b.embed}` : '');
}

// Group struct blocks so an embedded (child) block and the block it is a pointer INTO
// share one C scope, child(ren) declared first — `&FMC_NORSRAMTimingInitStructure_rw`
// must still be in scope when `FMC_NORSRAMInit(&FMC_NORSRAMInitStructure)` reads it.
// Every other block keeps its own scope exactly as before: unrelated blocks (and two
// per-instance blocks of the SAME struct type, e.g. two LTDC layers) reuse variable
// names across SIBLING scopes today, which only works because each is self-contained.
function structGroups(structs) {
  const done = new Set();
  const groups = [];
  for (const b of structs) {
    if (b.embedInto || done.has(b)) continue;
    const children = structs.filter(c => c.embedInto === b && !done.has(c));
    for (const c of children) done.add(c);
    done.add(b);
    groups.push([...children, b]);
  }
  // Safety net: a block whose embedInto target was somehow never grouped (should not
  // happen — embedInto always points at an object already in `structs`) still gets
  // emitted, on its own, rather than silently dropped.
  for (const b of structs) if (!done.has(b)) groups.push([b]);
  return groups;
}

/** One `plan.calls` entry, exactly as it read inline in `periphBlock()` before the
 * before/after split — a helper now only so the same rendering runs from both call
 * sites and cannot drift between them. */
function emitCall(c, L) {
  if (c.text) {
    L.push(`    ${c.text}   /* ${c.name}: ${c.value}${c.channel ? ` on ${c.channel}` : ''} */`);
    return;
  }
  L.push(`    /* TODO: ${c.name} = ${c.value} is applied by ${c.fn}(), not by an init struct,`);
  L.push(`       and ${c.missing}. */`);
  if (c.note) L.push(`    /* ${c.note} */`);
}

function periphBlock(pid) {
  const plan = initPlan(pid);
  const L = [];
  const clk = clockBitOf(pid);
  L.push(`    /* ---- ${pid} ${'-'.repeat(Math.max(0, 58 - pid.length))} */`);
  if (clk && clk.fn) L.push(`    ${clk.fn}(${clk.macro}, ENABLE);`);
  else if (cfg().periph_clock) L.push(`    /* ${pid} has no clock enable bit in codegen.periph_clock — none is written. */`);

  // `sdk_call_order: before_structs` calls run here — before any struct in this
  // peripheral is filled and applied, per the data's own declaration that a struct
  // write in this block depends on one of these having already run. See `sdkCalls()`.
  for (const c of plan.calls) if (c.order === 'before') emitCall(c, L);

  for (const group of structGroups(plan.structs)) {
    L.push(`    {`);
    for (const b of group) {
      const varName = blockVarName(b);
      // A per-instance block is one of several identical-looking scopes, so it says which
      // instance it is. Without this, two LTDC layers differing only in one member read as
      // a copy-paste in the generated file.
      if (b.instance) L.push(`        /* ${pid} ${b.instance.noun} ${b.instance.n} */`);
      if (b.embed) L.push(`        /* ${b.struct}, embed "${b.embed}" — written into a pointer member below */`);
      L.push(`        ${b.struct} ${varName} = {0};`);
      for (const f of b.fields) {
        const comment = f.pointer ? f.name : `${f.name}: ${f.unit ? `${f.value} ${f.unit}` : String(f.value)}`;
        L.push(`        ${varName}.${f.member} = ${f.text};   /* ${comment} */`);
      }
      for (const m of b.missing) {
        L.push(`        /* TODO: ${m}. */`);
      }
      if (b.embedInto) {
        // Consumed via a pointer by another block in this same scope (above or below) —
        // nothing calls this struct directly, and that is correct, not a gap.
      } else if (b.embed) {
        // `embed:` named a key `codegen.init_structs` does not resolve; already reported
        // in `b.missing` above. Falling through to "nothing applies this struct" would
        // ask for a `.fn` this struct is never meant to have.
      } else if (b.fn && (b.handle || b.noHandle)) {
        L.push(`        ${b.fn}(${b.noHandle ? '' : `${b.handle}, `}&${varName});`);
      } else {
        L.push('        /* TODO: nothing applies this struct. The MCU file needs');
        if (!b.fn) L.push(`           codegen.init_structs.${b.struct}.fn — the SDK function that takes a ${b.struct}`);
        if (!b.handle) {
          L.push(b.handleMissing
            ? `           ${b.handleMissing}`
            : `           codegen.periph_handle.${pid} — the SPL name of ${pid}'s register block`);
        }
        L.push('           This generator does not derive a function name from a struct name. */');
      }
    }
    L.push(`    }`);
  }

  // Every OTHER call — today's original behaviour, unchanged: after every struct block,
  // in declaration order. `order === 'before'` ones already ran above and are skipped
  // here rather than repeated.
  for (const c of plan.calls) if (c.order !== 'before') emitCall(c, L);
  for (const p of plan.problems) L.push(`    /* TODO: ${p}. */`);
  for (const n of plan.notes) L.push(`    /* ${n} */`);
  if (L.length === 1) L.push(`    /* nothing to configure */`);
  L.push('');
  return L;
}

// A peripheral id is not guaranteed to be a C identifier, so one place turns it into
// one and everything - function name, file name, include guard - derives from that.
const cIdent = pid => String(pid).replace(/[^A-Za-z0-9_]/g, '_');
export const periphInitName = pid => `WCHCube_${cIdent(pid)}_Init`;
const periphFileBase = pid => `wchcube_${cIdent(pid).toLowerCase()}`;

/**
 * One `void WCHCube_<PID>_Init(void)` per configured peripheral, whichever layout the
 * user picked. The split is then a question of which FILE each function lands in rather
 * than a second way of generating code - and even in one file it is better shaped,
 * because re-initialising one peripheral after a mode change becomes a call instead of
 * a copy of half of WCHCube_Periph_Init().
 */
function periphFunction(pid) {
  const body = periphBlock(pid);
  const L = [];
  L.push(body[0].trimStart());          // the "---- PID ----" banner, now at file scope
  L.push(`void ${periphInitName(pid)}(void)`);
  L.push('{');
  for (const line of body.slice(1)) L.push(line);
  while (L[L.length - 1] === '') L.pop();
  L.push(...user(`Periph_${cIdent(pid)}`, '    '));
  L.push('}');
  return L.join('\n');
}

/** `WCHCube_Periph_Init()`: call each one, in the order they are declared. */
function periphDispatch() {
  const L = [];
  L.push('void WCHCube_Periph_Init(void)');
  L.push('{');
  const pids = initPeripherals();
  if (!pids.length) L.push('    /* No peripheral is switched on. */');
  for (const pid of pids) L.push(`    ${periphInitName(pid)}();`);
  L.push(...user('Periph', '    '));
  L.push('}');
  return L.join('\n');
}

function periphSection() {
  const L = [banner('Peripherals'), ''];
  // In split mode the bodies live in their own files and only the dispatcher stays.
  if (!generatorOption('split_peripherals')) {
    for (const pid of initPeripherals()) L.push(periphFunction(pid), '');
  }
  L.push(periphDispatch());
  return L.join('\n');
}

// ---- DMA ---------------------------------------------------------------------
//  One DMA_InitTypeDef per configured request, the DMA1 clock enable, and the
//  channel handle from `dma.register.channel_macro`. A channel the user booked
//  twice is an #error in cSource(), not last-wins code.
//
//  DMA_PeripheralBaseAddr, DMA_MemoryBaseAddr and DMA_BufferSize are deliberately
//  absent from the data: they are the application's buffer, not a configuration
//  choice, and CubeMX does not ask for them either. They are emitted as named TODOs
//  so the file says what the application still has to fill in.

function dmaChannelHandle(channel) {
  const reg = ((M.dma || {}).register) || {};
  if (!reg.channel_macro) return null;
  return String(reg.channel_macro).replace('$CH', String(channel));
}

function dmaSection() {
  const rows = dmaRequests();
  const L = [];
  L.push(banner('DMA'));
  L.push('void WCHCube_DMA_Init(void)');
  L.push('{');
  if (!rows.length) {
    L.push('    /* No DMA request is configured. */');
    L.push(...user('DMA', '    '));
    L.push('}');
    return L.join('\n');
  }
  const ctrl = (M.dma || {}).controller;
  const clk = ctrl ? clockBitOf(ctrl) : null;
  if (clk && clk.fn) L.push(`    ${clk.fn}(${clk.macro}, ENABLE);`);
  else L.push(`    /* TODO: ${ctrl || 'the DMA controller'} has no clock enable bit in codegen.periph_clock. */`);
  L.push('');

  const spec = (cfg().init_structs || {})[(M.dma || {}).init_struct] || {};
  const defs = dmaParamDefs();
  for (const r of rows) {
    const handle = dmaChannelHandle(r.channel);
    const st = (M.dma || {}).init_struct;
    L.push(`    /* ---- ${r.request} on ${ctrl || 'DMA'} channel ${r.channel} (${r.owner}) ${'-'.repeat(Math.max(0, 20 - r.request.length))} */`);
    if (!st) {
      L.push('    /* TODO: the MCU file has no dma.init_struct, so no struct can be declared. */');
      L.push('');
      continue;
    }
    const varName = structVar(st);
    L.push('    {');
    L.push(`        ${st} ${varName} = {0};`);
    for (const d of defs) {
      const value = dmaParamValue(r.id, d.key);
      let text = null;
      if (d.type === 'bool') text = value ? d.sdk_enabled : d.sdk_disabled;
      else if (d.options) { const hit = d.options.find(o => String(o.name) === String(value)); text = hit && hit.sdk; }
      else if (typeof value === 'number') text = String(value);
      if (!d.sdk_field) { L.push(`        /* TODO: ${d.name}: dma.channel_params gives no sdk_field:. */`); continue; }
      if (!text) { L.push(`        /* TODO: ${d.name} = ${value}: no sdk macro in dma.channel_params. */`); continue; }
      L.push(`        ${varName}.${d.sdk_field} = ${text};   /* ${d.name}: ${value} */`);
    }
    // USER ACTION, not TODO, and the distinction matters: `cComplaints()` reports what
    // the GENERATOR could not do because the MCU file is missing something, and --strict
    // fails CI on that. A buffer address is not missing from the data - it is not a
    // configuration choice at all, and CubeMX does not ask for it either. Marking it
    // TODO would make every project with a DMA request fail --strict forever.
    L.push('        /* USER ACTION: the application owns the addresses and the length —');
    L.push(`           set ${varName}.DMA_PeripheralBaseAddr, .DMA_MemoryBaseAddr and`);
    L.push('           .DMA_BufferSize before this call. They are a buffer, not a');
    L.push('           configuration choice, so the configurator does not ask for them. */');
    if (handle && spec.deinit) L.push(`        ${spec.deinit}(${handle});`);
    if (spec.fn && handle) {
      L.push(`        ${spec.fn}(${handle}, &${varName});`);
      if (spec.cmd) L.push(`        ${spec.cmd}(${handle}, ENABLE);`);
    } else {
      L.push(`        /* TODO: nothing applies this struct. The MCU file needs`);
      if (!spec.fn) L.push(`           codegen.init_structs.${st}.fn — the SDK function that takes a ${st}`);
      if (!handle) L.push('           dma.register.channel_macro — the SPL name of a channel, e.g. DMA1_Channel$CH');
      L.push('           This generator does not derive a function name from a struct name. */');
    }
    L.push('    }');
    L.push('');
  }
  if (L[L.length - 1] === '') L.pop();
  L.push(...user('DMA', '    '));
  L.push('}');
  return L.join('\n');
}

// ---- NVIC --------------------------------------------------------------------
//  The PFIC is not the Cortex-M scheme: PFIC_IPRIORx gives each vector a byte and
//  implements TWO of its bits ([5:0] reserved, write-invalid; RM 6.5.2.21), and the
//  maximum nesting depth is 2.
//
//  Where the nesting depth itself is configured is NOT in this reference manual -
//  `nvic.scheme.notes` says so outright - so the chosen grouping is emitted as a
//  comment and NO register write is claimed for it. Do not invent one.

function nvicSection() {
  const L = [];
  L.push(banner('Interrupts'));
  L.push('void WCHCube_NVIC_Init(void)');
  L.push('{');
  const st = nvicState();
  const on = st ? st.vectors.filter(v => v.enabled && !v.fixed) : [];
  if (!st || !on.length) {
    L.push('    /* No interrupt vector is enabled. */');
    L.push(...user('NVIC', '    '));
    L.push('}');
    return L.join('\n');
  }
  const g = st.groups[st.group] || null;
  if (g) {
    L.push(`    /* Priority grouping: ${g.name} */`);
    const note = ((st.scheme || {}).notes || '').trim().split('\n')[0];
    if (note) L.push(`    /* The register that selects it is not in this part's reference manual, so`);
    if (note) L.push('       nothing is written for the grouping itself — only the per-vector bytes. */');
  }
  const spec = (cfg().nvic || {});
  const structName = spec.init_struct || null;
  const fn = spec.fn || null;
  if (!structName || !fn) {
    L.push('    /* TODO: the MCU file has no codegen.nvic.init_struct / .fn, so the');
    L.push('       SDK call that enables a vector cannot be written. The vectors the');
    L.push('       configuration asks for, with their PFIC priorities, are: */');
    for (const v of on) {
      L.push(`    /*   ${v.irqn || v.name}  preempt ${v.preempt}, sub ${v.sub}`
        + `${v.handler ? `  — ISR: ${v.handler}()` : ''} */`);
    }
    L.push(...user('NVIC', '    '));
    L.push('}');
    return L.join('\n');
  }
  const varName = structVar(structName);
  L.push(`    ${structName} ${varName} = {0};`);
  L.push('');
  for (const v of on) {
    if (!v.irqn) {
      L.push(`    /* TODO: vector ${v.name} has no irqn: in the MCU file, so it cannot be named. */`);
      continue;
    }
    L.push(`    /* ${v.name}${v.description ? ` — ${v.description}` : ''}`
      + `${v.handler ? `   ISR: ${v.handler}()` : ''} */`);
    L.push(`    ${varName}.${spec.field_channel || 'NVIC_IRQChannel'} = ${v.irqn};`);
    if (spec.field_preempt) L.push(`    ${varName}.${spec.field_preempt} = ${v.preempt};`);
    if (spec.field_sub) L.push(`    ${varName}.${spec.field_sub} = ${v.sub};`);
    if (spec.field_enable) L.push(`    ${varName}.${spec.field_enable} = ENABLE;`);
    L.push(`    ${fn}(&${varName});`);
    L.push('');
  }
  if (L[L.length - 1] === '') L.pop();
  L.push(...user('NVIC', '    '));
  L.push('}');
  return L.join('\n');
}

/** One peripheral's own .h, in split mode. */
function periphHeader(pid) {
  const guard = `WCHCUBE_${cIdent(pid).toUpperCase()}_H`;
  return [
    headerComment(),
    '',
    `#ifndef ${guard}`,
    `#define ${guard}`,
    '',
    `#include "${cfg().header || 'debug.h'}"`,
    '',
    `void ${periphInitName(pid)}(void);`,
    '',
    ...user(`Prototypes_${cIdent(pid)}`),
    ...(generatorOption('user_code') ? [''] : []),
    `#endif /* ${guard} */`,
    '',
  ].join('\n');
}

/** One peripheral's own .c, in split mode. */
function periphSource(pid) {
  return [
    headerComment(),
    '',
    `#include "${periphFileBase(pid)}.h"`,
    '',
    ...(user(`Includes_${cIdent(pid)}`).length ? [...user(`Includes_${cIdent(pid)}`), ''] : []),
    periphFunction(pid),
    '',
  ].join('\n');
}

/**
 * The C files, as `{ name: text }`. Always the wchcube_init pair; in split mode also a
 * pair per configured peripheral. The header/source ORDER is fixed and the peripherals
 * are in initPeripherals() order, which is sorted - two runs of the same configuration
 * must produce the same files in the same order or the byte-identical test is a lie.
 */
export function cFiles() {
  const out = { 'wchcube_init.h': cHeader(), 'wchcube_init.c': cSource() };
  if (generatorOption('split_peripherals')) {
    for (const pid of initPeripherals()) {
      out[`${periphFileBase(pid)}.h`] = periphHeader(pid);
      out[`${periphFileBase(pid)}.c`] = periphSource(pid);
    }
  }
  return out;
}

// ---- complaints ---------------------------------------------------------------
// "Generated successfully" and "generated a complaint" are different outcomes, and
// only this module knows the difference. A generator that cannot compute something
// says so in exactly two spellings, both written above: `#error "..."` at the start
// of a line, and a `/* TODO: ...` comment block. Scanning our own output is
// therefore not a heuristic - it reads back what these functions just wrote.
//
// `/* USER ACTION:` is deliberately NOT one of them. A complaint means the MCU file is
// missing something and --strict fails CI on it; a user action means the generated code
// is complete and the application still has a buffer address to fill in. Treating the
// second as the first would fail every project that uses DMA, for ever, over something
// no data could supply.
//
// `--strict` on the CLI turns a non-empty list into exit 2, so CI can tell a build
// that generated code from one that generated an explanation of what is missing.
export function cComplaints(files = cFiles()) {
  const out = [];
  for (const [name, text] of Object.entries(files)) {
    String(text).split(/\r?\n/).forEach((line, i) => {
      const e = /^\s*#error\s+"?(.*?)"?\s*$/.exec(line);
      if (e) { out.push({ file: name, line: i + 1, kind: 'error', text: e[1] }); return; }
      const t = /\/\*\s*TODO:\s*(.*?)\s*$/.exec(line);
      if (t) out.push({ file: name, line: i + 1, kind: 'todo', text: t[1] });
    });
  }
  return out;
}
