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
import { clockCalc, firstPre } from './clock.js';
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
      // a missing `gpio.modes` entry does (PROJECT.md A.2).
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
export function rccWord() {
  const c = cfg().rcc;
  if (!c || !M.clock) return null;
  const k = S.clock;
  let value = 0, mask = 0;
  const parts = [];
  // One setting may need bits in more than one place: the V00x ADC divider is
  // ADCPRE[4:0] at bit 11 PLUS ADC_CLK_MODE at bit 31, and the gap between them holds
  // PLLSRC and MCO, so one wide field would swallow them. A spec may therefore be a
  // single { lsb, bits, values } or a LIST of them - the shape remap.fields already
  // uses. `default:` covers a slice that has no entry for the current value.
  const put = (spec, raw, what) => {
    if (!spec) return;
    const slices = Array.isArray(spec) ? spec : [spec];
    const encoded = [];
    let anyExplicit = false;
    for (const s of slices) {
      let field = s.values ? s.values[raw] : raw;
      if (field !== undefined) anyExplicit = true;
      else if (s.default !== undefined) field = s.default;
      else if (slices.length > 1) field = 0;   // a split field: the slice that does not
      encoded.push({ s, field });              // name this value contributes zero
    }
    if (!anyExplicit || encoded.some(e => e.field === undefined)) {
      parts.push({ what, note: `no encoding for ${raw}` });
      return;                                  // a half-written divider is worse than a gap
    }
    for (const { s, field } of encoded) {
      const width = (1 << s.bits) - 1;
      value |= (field & width) << s.lsb;
      mask |= width << s.lsb;
    }
    const one = encoded.length === 1;
    parts.push({
      what, raw,
      field: one ? encoded[0].field : encoded.map(e => e.field),
      bits: one ? encoded[0].s.bits : encoded.map(e => e.s.bits),
      lsb: one ? encoded[0].s.lsb : encoded.map(e => e.s.lsb),
      slices: encoded.length,
    });
  };
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
  for (const [name, spec] of Object.entries(c.prescalers || {})) put(spec, k.pre[name], `${name} prescaler`);
  return { register: c.register || 'RCC->CFGR0', value: value >>> 0, mask: mask >>> 0, parts };
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
  const L = [];
  L.push(banner('GPIO'));
  L.push('void WCHCube_GPIO_Init(void)');
  L.push('{');
  if (!plan.length) {
    if (left.length) L.push(...skipNote(left).slice(0, 2));
    else L.push('    /* No pins configured. */');
    // The same USER CODE tag as the configured path: the set of tags must not depend
    // on the configuration, or turning a peripheral off would orphan somebody's code.
    L.push(...user('GPIO', '    '));
    L.push('}');
    return L.join('\n');
  }
  L.push('    GPIO_InitTypeDef GPIO_InitStructure = {0};');
  L.push('');

  const ports = [...new Set(plan.map(p => p.port))].sort();
  const gc = cfg().gpio_clock;
  if (gc && gc.fn && gc.port) {
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
  L.push('');

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
    const used = Object.keys(M.peripherals).filter(pid =>
      (M.peripherals[pid].remaps || []).length > 1
      && (S.periph[pid] || {}).remap
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
  for (const [name, v] of Object.entries(M.clock.prescalers || {})) {
    if (name === fp) continue;
    L.push(`    /* ${name} /${k.pre[name]} -> ${r[name]} MHz${v.min_mhz || v.max_mhz ? ` (${v.min_mhz || 0}-${v.max_mhz || '?'} MHz)` : ''} */`);
  }
  if (r.over.length) L.push(`    /* WARNING: out of specification: ${r.over.join(', ')} */`);
  L.push('');
  const rcc = rccWord();
  if (rcc) {
    for (const p of rcc.parts) {
      L.push(p.note ? `    /* ${p.what}: ${p.note} */`
        : `    /* ${p.what} = ${bin(p.field, p.bits)} (bit${p.bits > 1 ? `s ${p.lsb + p.bits - 1}:${p.lsb}` : ` ${p.lsb}`}) */`);
    }
    L.push(`    ${rcc.register} = (${rcc.register} & ~${hex(rcc.mask)}) | ${hex(rcc.value)};`);
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
//    struct: other  it belongs to a DIFFERENT struct               (TIM1 deadtime)
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
    let block = structs.find(b => b.struct === d.struct);
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
      });
    }
    const lit = paramLiteral(pid, d);
    if (lit.missing) block.missing.push(lit.missing);
    else block.fields.push({ member: d.sdk_field, text: lit.text, name: d.name, value: paramValue(pid, d.key), unit: d.unit });
  }
  // A `when:` that cannot be resolved against this MCU file is a data defect with a
  // silent failure mode, so it becomes a TODO - see `depProblems()` in params.js for the
  // three ways it was measured to go wrong. Checked over EVERY param, not only the
  // applicable ones: a broken dependency is exactly the case that is applicable for the
  // wrong reason.
  const problems = [];
  for (const d of paramDefs(pid)) problems.push(...depProblems(pid, d));

  // ---- one struct, applied once PER INSTANCE ---------------------------------
  // `channel_params` (params.js). The block is filled and applied once for each LIVE
  // instance, and what varies per instance is the function, the handle, or both:
  // `TIM_OC1Init(TIM1, &s)` … `TIM_OC4Init(TIM1, &s)` vary the function and keep the
  // peripheral's handle; `LTDC_LayerInit(LTDC_Layer1, &s)` keeps the function and varies
  // the handle. Both arrive here as the same row, so this loop knows about neither.
  //
  // Each instance becomes an ordinary struct block, which is why `periphBlock()` needs no
  // change to emit it: a block already carries its own `fn` and its own `handle`.
  const cbl = channelParamBlock(pid);
  if (cbl && cbl.struct) {
    const plan = activeInstances(pid);
    if (plan.missing) problems.push(plan.missing);
    if (plan.note) notes.push(plan.note);
    for (const inst of plan.instances) {
      const block = {
        struct: cbl.struct, fn: inst.fn || null,
        // No `handle:` on the row means the peripheral's own register block, which is
        // the timer case. An LTDC layer names its own.
        noHandle: false, handle: inst.handle || handle || null,
        fields: [], missing: [],
        instance: { n: inst.n, noun: plan.noun },
      };
      for (const d of channelParamDefs(pid)) {
        if (d.readonly || !paramApplies(pid, d)) continue;
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
        block.missing.push(`channel_params names no sdk_call for ${plan.noun} ${inst.n}, `
          + 'and this generator does not paste a function name together from a number');
      }
      structs.push(block);
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
  const base = { key: d.key, name: d.name, fn: d.sdk_call, value: paramValue(pid, d.key), note: d.sdk_note || '' };
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
  return String(name).replace(/TypeDef$/, 'Structure');
}

function periphBlock(pid) {
  const plan = initPlan(pid);
  const L = [];
  const clk = clockBitOf(pid);
  L.push(`    /* ---- ${pid} ${'-'.repeat(Math.max(0, 58 - pid.length))} */`);
  if (clk && clk.fn) L.push(`    ${clk.fn}(${clk.macro}, ENABLE);`);
  else if (cfg().periph_clock) L.push(`    /* ${pid} has no clock enable bit in codegen.periph_clock — none is written. */`);

  for (const b of plan.structs) {
    const varName = structVar(b.struct);
    L.push(`    {`);
    // A per-instance block is one of several identical-looking scopes, so it says which
    // instance it is. Without this, two LTDC layers differing only in one member read as
    // a copy-paste in the generated file.
    if (b.instance) L.push(`        /* ${pid} ${b.instance.noun} ${b.instance.n} */`);
    L.push(`        ${b.struct} ${varName} = {0};`);
    for (const f of b.fields) {
      const human = f.unit ? `${f.value} ${f.unit}` : String(f.value);
      L.push(`        ${varName}.${f.member} = ${f.text};   /* ${f.name}: ${human} */`);
    }
    for (const m of b.missing) {
      L.push(`        /* TODO: ${m}. */`);
    }
    if (b.fn && (b.handle || b.noHandle)) {
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
    L.push(`    }`);
  }

  for (const c of plan.calls) {
    if (c.text) {
      L.push(`    ${c.text}   /* ${c.name}: ${c.value}${c.channel ? ` on ${c.channel}` : ''} */`);
      continue;
    }
    L.push(`    /* TODO: ${c.name} = ${c.value} is applied by ${c.fn}(), not by an init struct,`);
    L.push(`       and ${c.missing}. */`);
    if (c.note) L.push(`    /* ${c.note} */`);
  }
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
