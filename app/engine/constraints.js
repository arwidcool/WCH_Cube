// =============================================================================
//  constraints.js — where the silicon says "not on this pin".
//
//  Round 5's rule is that every choice the app offers must be one the silicon can
//  honour, and rounds 3 and 4 each shipped a defect of the other kind: a choice
//  the app offered and the part could not honour. Both were fixed by DELETING an
//  entry (`GPIO_Speed_50MHz`, `GPIO_Mode_Out_OD`), which only works while the
//  capability is uniform across the part. It is not:
//
//    * one part's input pull-down exists on PA0-PA15 and PC16-PC17 only;
//    * a pair of IOs shorted inside the package may not be configured as outputs;
//    * two pins must be floating inputs while the USB peripheral is enabled.
//
//  Three shapes, one mechanism, and the mechanism is the deliverable. It reads
//  `gpio.constraints` from the MCU file — never a part name — and answers the
//  one question every consumer asks: is this option legal on this pin, right now?
//
//  ---------------------------------------------------------------------------
//  The shape — data/FORMAT.md `## constraints`, and DATA owns every entry
//  ---------------------------------------------------------------------------
//
//    constraints:                                  # document root, a sibling of gpio:
//      - id: pull-down-only-on-pa0-pa15-pc16-pc17  # unique slug, cited by issues/TODOs
//        option: gpio.mode | gpio.pull | gpio.speed
//        choices: [Pull-down]                      # OR classes: [out, in, analog],
//        only_on: [PA0, ... PC17]                  # OR not_on: [PC10, PC11],
//        packages: [LQFP64M, QFN28]                # optional: scoped to these packages
//        when: { peripheral: USBFS, enabled: true } # optional: only while it is on
//        reason: "..."                             # shown to the user, verbatim
//        source: "ch32x035_gpio.h:33"              # a rule with no citation is a guess
//
//  `only_on` is an ALLOW-list: the choice is legal there and refused everywhere else.
//  `not_on` is a DENY-list: refused on exactly those pins. `classes:` reads the
//  silicon's own direction off `gpio.modes[].class` instead of listing mode names, so
//  a mode added later is covered without editing every constraint — and `Input`, which
//  is not a `modes` entry, is class `in` by definition.
//
//  Both lists match a pin BY NAME, because that is what the data does: the shorted-pair
//  entries name every bit of the pair (`not_on: [PC10, PC11, PC16, PC17]`) rather than
//  leaning on the package table. The two bits of one pad are separately configurable —
//  one may be an alternate function while the other is a floating input — so "this pin
//  may not drive" and "the pad it shares may not drive" are different statements, and
//  only the data can say which one the silicon makes.
//
//  This file does NOT re-validate the entries. `tools/validate_mcu.py` enforces the
//  schema and `tests/constraints.test.js` audits the data against it; a third copy here
//  would be a third answer to the same question, which is the drift this round exists
//  to remove.
// =============================================================================
import { M, S, isEnabled, gpioModes, gpioInputModes, gpioSpeeds } from './model.js';

/** The columns a constraint can restrict, in the order the GPIO table shows them. */
export const CONSTRAINT_FIELDS = ['mode', 'pull', 'speed'];

// A part whose file says nothing about modes keeps the lists the page used before the
// lists became data, so no part regresses while its data is being written. The Tools
// tab names that fallback as a gap.
const LEGACY_MODES = ['Input', 'Output Push Pull', 'Output Open Drain',
  'Alternate Function Push Pull', 'Alternate Function Open Drain', 'Analog'];
const LEGACY_PULLS = ['No pull', 'Pull-up', 'Pull-down'];

/**
 * The option names a GPIO-table column offers on this part, from the MCU file.
 *
 * This is the single source of truth for both the constraint matcher and the page:
 * a constraint may only name an option that appears here. `Input` is prepended to
 * the mode list rather than listed in `gpio.modes` because the SPL folds the pull
 * into the mode - there is no single "input" macro, and which of
 * `GPIO_Mode_IN_FLOATING` / `_IPU` / `_IPD` applies is decided by the PULL column.
 */
export function gpioFieldOptionNames(field) {
  if (field === 'mode') {
    const m = gpioModes();
    return m.length ? ['Input', ...m.map(x => x.name)] : LEGACY_MODES.slice();
  }
  if (field === 'pull') {
    const p = gpioInputModes();
    return p.length ? p.map(x => x.name) : LEGACY_PULLS.slice();
  }
  if (field === 'speed') return gpioSpeeds().map(s => s.name);
  return [];
}

export const gpioFieldLabel = field =>
  field === 'mode' ? 'GPIO mode'
    : field === 'pull' ? 'GPIO pull-up/pull-down'
      : field === 'speed' ? 'output speed' : field;

/** `gpio.mode` -> `mode`: the dotted `option:` as the GPIO table's own key. */
const FIELD_OF_OPTION = { 'gpio.mode': 'mode', 'gpio.pull': 'pull', 'gpio.speed': 'speed' };

/** Every constraint the MCU file states, in file order. */
export function gpioConstraints() {
  const list = M && M.constraints;
  if (!Array.isArray(list)) return [];
  return list.filter(c => c && typeof c === 'object' && c.id);
}

/** The GPIO-table column an entry restricts, or null if `option:` is not one we know. */
export const constraintField = c => FIELD_OF_OPTION[String(c && c.option)] || null;

/**
 * The choice names this entry refuses, wherever its region is.
 *
 * `classes:` is resolved against the part's own `gpio.modes[].class`, never a table in
 * this file. `Input` is the implicit fourth mode and its class is always `in` - it has
 * no `modes` entry of its own, so a class-based rule would miss it without that line.
 */
function refusedNames(c) {
  if (Array.isArray(c.choices)) return c.choices.map(String);
  if (!Array.isArray(c.classes)) return [];
  const classes = c.classes.map(String);
  const out = [];
  if (constraintField(c) === 'mode') {
    for (const m of gpioModes()) if (classes.includes(String(m.class))) out.push(m.name);
    if (classes.includes('in')) out.unshift('Input');
  }
  return out;
}

// Is the `when:` condition true right now? An absent condition always is.
function whenActive(w) {
  if (!w || typeof w !== 'object') return true;
  if (w.peripheral === undefined) return true;
  const pid = String(w.peripheral);
  // A condition naming hardware this part does not have never fires. That is a data
  // defect and tools/validate_mcu.py says so; this does not guess a meaning for it.
  if (!M || !M.peripherals || !M.peripherals[pid]) return false;
  const on = isEnabled(pid);
  return w.enabled === false ? !on : on;
}

/**
 * Is this entry in force at all - the right package, and its `when:` satisfied?
 *
 * Scope and region are separate questions on purpose: an entry scoped to a package is
 * not in force anywhere else, while one scoped to a pin is in force on every other pin.
 */
export function constraintActive(c) {
  if (Array.isArray(c.packages) && c.packages.length && !c.packages.map(String).includes(S.pkg)) return false;
  return whenActive(c.when);
}

/**
 * Is this pin inside the entry's REFUSED region?
 *
 * The two lists point opposite ways, which is the one thing to get right here:
 *
 *   only_on: [...]   the choice is LEGAL on these pins, so it is refused everywhere
 *                    else - the refused region is the complement of the list.
 *   not_on:  [...]   the choice is refused on exactly these pins.
 *
 * Both match the pin BY NAME. That is what the data does: the shorted-pair entries name
 * every bit of the pair (`not_on: [PC10, PC11, PC16, PC17]`) rather than leaning on the
 * package table, because the two bits are separately configurable and only one of them
 * is the pin the restriction is about.
 */
export function constraintRegion(c, pin) {
  const name = String(pin);
  if (Array.isArray(c.only_on)) return !c.only_on.map(String).includes(name);
  if (Array.isArray(c.not_on)) return c.not_on.map(String).includes(name);
  return true;                                   // no region stated: every pin
}

/**
 * The constraint that forbids this choice on this pin, or null.
 * `value` is the option name exactly as the GPIO table spells it.
 */
export function constraintFor(pin, field, value) {
  if (!pin || !field || value === undefined || value === null) return null;
  const v = String(value);
  for (const c of gpioConstraints()) {
    if (constraintField(c) !== field) continue;
    if (!constraintActive(c)) continue;
    if (!constraintRegion(c, pin)) continue;
    if (refusedNames(c).includes(v)) return c;
  }
  return null;
}

/**
 * A sentence naming the constraint, for an issue, a TODO or a tooltip.
 * The author's `reason` is used verbatim; the `id` follows so a reader can find the
 * rule in the MCU file.
 */
export function constraintSentence(c, pin, field, value) {
  const why = c.reason ? ` - ${c.reason}` : '';
  return `${pin}: ${field} "${value}" is not available on this pin${why} [${c.id}]`;
}

/**
 * The options this column offers ON THIS PIN, with the illegal ones removed.
 *
 * The caller renders exactly this list, so the control is absent (empty list) or its
 * options are reduced, on that row and no other - which is the whole point of a
 * per-pin mechanism rather than greying a column.
 */
export function gpioFieldOptions(pin, field) {
  return gpioFieldOptionNames(field).filter(v => !constraintFor(pin, field, v));
}

/**
 * The GPIO mode a manual `GPIO_*` signal means, so the engine and the generator
 * agree about a pin whose mode nobody has chosen yet.
 *
 * `gpioPlan()` derives "Output Push Pull" for a manual output, and this must give
 * the same answer or a constraint would be checked against one mode and enforced
 * against another. It reads the part's own list rather than hardcoding the string,
 * so a part whose plain output mode is spelled differently is not silently exempt -
 * and `app/tests/constraint.test.js` asserts the two agree on every bundled part.
 */
export function gpioModeForSignal(signal) {
  if (typeof signal !== 'string' || !signal.startsWith('GPIO_')) return null;
  const kind = signal.slice('GPIO_'.length);
  if (kind === 'Input' || kind === 'EXTI') return 'Input';
  if (kind === 'Analog') return gpioFieldOptionNames('mode').find(n => n === 'Analog') || null;
  if (kind === 'Output') {
    const modes = gpioModes();
    const hit = modes.find(m => String(m.class) === 'out' && /^Output /.test(m.name))
      || modes.find(m => /^Output /.test(m.name));
    return hit ? hit.name : null;
  }
  return null;
}

// ---- the ONE mode derivation, shared by the conflict engine and the generator ------
//
// The round requires the conflict engine and codegen to agree, and "the mode this pin
// will be configured with" is the thing they could most easily disagree about: the
// engine used to look only at what the USER stored, while the generator derives a mode
// for a pin carrying a peripheral's signal. That gap is a rule the engine does not
// report and the generator refuses to emit - one rule with two answers.
//
// So the derivation lives here, once, and both call it. `gpioPlan()` was the reference
// implementation and this is that code MOVED rather than copied, so the generated C is
// the same file it was before the move - which `tests/codegen_compile.test.js` and the
// fixture diff in the commit message check.

const DEFAULT_SKIP = { SYS: true };

/**
 * Claims GPIO_Init must NOT touch: the debug interface and the reset pin are controlled
 * by the option bytes and the debug hardware, and driving the reset pin as a push-pull
 * output would be actively harmful. Overridable per family through `codegen.skip_signals`;
 * SYS is the default because every WCH part puts SWIO/SWCLK/RST there.
 */
export function skippedClaim(claim) {
  const rule = ((M && M.codegen) || {}).skip_signals || DEFAULT_SKIP;
  const r = rule[claim.who];
  const bare = String(claim.signal).slice(String(claim.who).length + 1);
  return r === true || (Array.isArray(r) && r.includes(bare));
}

/**
 * Is one claim's function analog? `codegen.analog_signals` is the authoritative list.
 * Without it, fall back to "an Analog-category peripheral on an analog-capable pin" and
 * say in the generated code that it was inferred - the fallback cannot tell ADC1_IN4
 * from ADC1_RETR0, which share a pin, and only one of them is analog.
 */
export function analogClaim(claim, pin) {
  const table = ((M && M.codegen) || {}).analog_signals || {};
  const bare = String(claim.signal).slice(String(claim.who).length + 1);
  const listed = table[claim.who];
  if (listed) return { analog: listed.includes(bare), inferred: false };
  const P = (M.peripherals || {})[claim.who];
  const guess = !!(P && P.category === 'Analog' && ((M.pins || {})[pin] || {}).analog);
  return { analog: guess, inferred: guess };
}

/**
 * Which KEY the data is missing when a claimed signal has no `af:` — and it is not
 * always `af:`.
 *
 * An ADC, OPA, CMP, DAC or HSADC pad has no alternate-function code and never will:
 * the function IS analog and the pad is selected by `GPIO_Mode_AIN`, a GPIO *mode*,
 * not a four-bit field in `GPIOx_AFRL`. Telling that pad's owner to "add `af:`" is
 * advice nobody can follow, so it sends the next reader off to invent a number — which
 * is the failure this generator's whole TODO discipline exists to prevent. A TODO that
 * names the wrong fix is worse than no TODO.
 *
 * Decided from the two things the data already states, and from nothing else:
 *   - the peripheral's `category`, which is what `analogClaim`'s fallback reads too;
 *   - whether the pin is marked analog-capable, which is the fallback's other half.
 * A peripheral this file does not call Analog gets the `af:` answer, because a
 * non-analog pad genuinely is muxed. A part whose analog pads are NOT in an
 * Analog-category peripheral (a SERDES lane, a USB pair) states
 * `codegen.analog_signals` — the authoritative list — and never reaches here at all.
 *
 * Returns null when `af:` is the right answer, otherwise the analog repair:
 *   { key, entry, pinFlagMissing }
 */
export function analogAdvice(claim, pin) {
  const P = (M.peripherals || {})[claim.who];
  if (!P || P.category !== 'Analog') return null;
  const bare = String(claim.signal).slice(String(claim.who).length + 1);
  return {
    key: `codegen.analog_signals.${claim.who}`,
    entry: bare,
    // The fallback needs BOTH halves. Naming only one sends the reader back for a
    // second round, so when the pin flag is absent the TODO says so in the same breath.
    pinFlagMissing: !((M.pins || {})[pin] || {}).analog,
  };
}

/**
 * The mode this pin will be configured with, and whether it was inferred.
 *
 * Order matters and it is the generator's order: a stored value wins, then an analog
 * function, then any peripheral's alternate function, then what the manual GPIO signal
 * means, then Input.
 */
export function gpioEffectiveMode(pin, claims, stored) {
  const list = (claims || []).filter(c => !skippedClaim(c));
  // `stored` lets the caller pass the settings it already resolved - the GPIO table and
  // the generator both fall back to the CANONICAL name of a shorted pair, and that
  // lookup must not end up in two places either.
  const g = stored || ((S && S.gpio) || {})[pin] || {};
  if (g.mode) return { mode: g.mode, inferred: false };
  const an = list.map(c => analogClaim(c, c.via || pin)).find(x => x.analog);
  if (an) return { mode: 'Analog', inferred: an.inferred };
  if (list.some(c => c.who !== 'GPIO')) return { mode: 'Alternate Function Push Pull', inferred: false };
  const manual = (list.find(c => c.who === 'GPIO') || {}).signal;
  if (manual === 'GPIO_Output') return { mode: gpioModeForSignal(manual) || 'Output Push Pull', inferred: false };
  if (manual === 'GPIO_Analog') return { mode: gpioModeForSignal(manual) || 'Analog', inferred: false };
  return { mode: 'Input', inferred: false };
}

/** Which constraints removed options from this row's column - for the row's tooltip. */
export function gpioRowNotes(pin, field) {
  const all = gpioFieldOptionNames(field);
  const legal = gpioFieldOptions(pin, field);
  if (legal.length === all.length) return [];
  const seen = new Map();
  for (const v of all) {
    if (legal.includes(v)) continue;
    const c = constraintFor(pin, field, v);
    if (c && !seen.has(c.id)) seen.set(c.id, c);
  }
  return [...seen.values()];
}

/**
 * The value to USE for this pin's column, given whatever is stored.
 *
 * The same contract `gpioSpeedFor()` keeps for a speed the part no longer offers: a
 * stored value the silicon forbids is rewritten to the first legal one and the
 * caller is told, rather than carried into the table and the generated C. A pin
 * whose every option is forbidden keeps what it had - the constraint is then an
 * issue, not a silent edit - because there is nothing to rewrite it to.
 */
export function gpioFieldFor(pin, field, stored) {
  const legal = gpioFieldOptions(pin, field);
  if (!legal.length) return stored === undefined ? null : stored;
  if (stored !== undefined && stored !== null && legal.includes(String(stored))) return String(stored);
  return legal[0];
}

/**
 * Every stored GPIO value this part's constraints forbid, rewritten in place and
 * reported. Called on project load, next to `normaliseGpioSpeeds()` and with the
 * same contract: the file still opens, minus the line that stopped being true.
 *
 * Returns one sentence per change.
 */
export function normaliseGpioConstraints() {
  const out = [];
  if (!gpioConstraints().length) return out;
  for (const [pin, g] of Object.entries((S && S.gpio) || {})) {
    if (!g || typeof g !== 'object') continue;
    for (const field of CONSTRAINT_FIELDS) {
      const stored = g[field];
      if (stored === undefined || stored === null || stored === '') continue;
      // The pull is only part of the mode when the mode is Input: the SPL ignores the
      // pull column for every other mode, so a stale pull on an output pin is inert
      // and is not rewritten or reported as a violation.
      if (field === 'pull' && g.mode && g.mode !== 'Input') continue;
      const c = constraintFor(pin, field, stored);
      if (!c) continue;
      const fixed = gpioFieldFor(pin, field, stored);
      if (fixed === stored) continue;
      out.push(`${constraintSentence(c, pin, field, stored)}; using "${fixed}".`);
      g[field] = fixed;
    }
  }
  return out;
}
