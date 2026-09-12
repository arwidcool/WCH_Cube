// =============================================================================
//  engine.js — the conflict engine. Everything the UI colours orange comes from
//  here. A conflict is two different owners (two peripherals, or a peripheral
//  and a manual GPIO) claiming one PHYSICAL pin. Pins shorted inside the package
//  are one physical pin, so PD7 and PA4 on QFN20 collide with each other.
//
//  E = {
//    pins:         { canonPin: { state, label, claims:[{who, signal, via}] } }  via = real pin name
//    issues:       { periphId: [message, ...] },
//    status:       { periphId: 'ok'|'warn'|'na'|'' },
//    issueCount:   { periphId: n },
//    conflicts:    [ 'PD7/PA4: TIM1_CH1 / USART1_TX', ... ]        // legacy string form
//    conflictList: [ { pin, label, num, signals, owners, shorted, text } ]
//    resources:    { exti, dma }  — see resources.js
//    resourceIssues: [ { kind:'exti'|'dma', severity:'conflict'|'warning', text, owners } ]
//    constraintIssues: [ { pin, field, value, id, sentence, reason, source } ]
//    analogIssues: [ { pin, label, analog:[sig], af:[sig], sentence } ]
//  }
// =============================================================================
import {
  M, S, canon, pinExists, pinLabel, pinNum, groupOf, sigName,
  requiredSignals, isEnabled, isAvailable, neutralChoice, gpioSpeeds, gpioSpeedFor,
  signalPins, signalPinOptions, isAfMuxed,
} from './model.js';
import { record, batch } from './history.js';
import { resourceState } from './resources.js';
import { hseFeedsSysclk, pllList, tapSources } from './clock.js';
import { constraintFor, constraintSentence, gpioEffectiveMode, gpioModeForSignal, gpioFieldOptionNames, analogClaim, skippedClaim } from './constraints.js';

export let E = null;

export function compute() {
  const claims = {};                     // canonical pin -> [{who, signal}]
  const issues = {};                     // pid -> [message]
  // `via` is the name the signal actually uses: on a shorted pair the claim sits
  // under the canonical pin (PD7) but the register to configure may be PA4's.
  const add = (pin, who, signal, via) => (claims[pin] ||= []).push({ who, signal, via });

  for (const [pid, P] of Object.entries(M.peripherals)) {
    const req = requiredSignals(pid);
    if (!req.size) continue;
    const r = signalPins(pid);
    for (const sig of req) {
      const pin = r.pins[sig];
      if (!pin) { (issues[pid] ||= []).push(`${sig}: not routed in "${r.name}"`); continue; }
      if (!pinExists(pin)) { (issues[pid] ||= []).push(`${sig} needs ${pin}, which is not bonded on ${S.pkg}`); continue; }
      add(canon(pin), pid, sigName(pid, sig), pin);
    }
  }
  for (const [pin, sig] of Object.entries(S.manual)) if (pinExists(pin)) add(canon(pin), 'GPIO', sig, pin);

  const pins = {}, conflictList = [];
  for (const [pin, cl] of Object.entries(claims)) {
    // one peripheral taking one pin twice (TIM2 CH1 + ETR on PA0) is not a conflict
    const owners = [...new Set(cl.map(c => c.who))];
    const conflict = owners.length > 1;
    const shorted = groupOf(pin).length > 1;
    pins[pin] = { state: conflict ? 'conflict' : 'set', label: cl.map(c => c.signal).join(' / '), claims: cl };
    if (!conflict) continue;
    const label = pinLabel(pin);
    conflictList.push({
      pin, label, num: pinNum(pin), owners, shorted,
      signals: cl.map(c => c.signal),
      text: `${label}: ${cl.map(c => c.signal).join(' / ')}${shorted ? ' (shorted inside the package)' : ''}`,
    });
    for (const c of cl) {
      if (c.who === 'GPIO') continue;
      const others = cl.filter(x => x !== c).map(x => x.signal).join(', ');
      (issues[c.who] ||= []).push(`${c.signal} on ${label} conflicts with ${others}${shorted ? ' (pins are shorted inside the package)' : ''}`);
    }
  }

  // Conflicts that are not about pins: EXTI lines and DMA channels.
  const resources = resourceState();
  for (const r of resources.issues) {
    for (const owner of r.owners) {
      if (owner === 'GPIO' || !M.peripherals[owner]) continue;
      (issues[owner] ||= []).push(r.text);
    }
  }

  // Constraints: a per-pin capability the silicon states and the model can express.
  // A claim that violates one is an issue naming the constraint, exactly as an EXTI
  // or DMA clash is, so it shows up on the peripheral and in the conflict banner
  // rather than only in the generated C. This is the second of the three consumers;
  // the GPIO table (which must not OFFER the value) and codegen (which must not EMIT
  // it) are the other two, and all three read the same data.
  //
  // The value checked is the one that will be USED, from the same derivation the
  // generator uses (`gpioEffectiveMode()`), so a rule this reports and a rule codegen
  // enforces cannot drift apart. The pull is checked only when the mode is Input,
  // because the SPL ignores the pull column for every other mode - a stale pull on an
  // output pin is inert, not a violation.
  const constraintIssues = [];
  for (const [canonPin, info] of Object.entries(pins)) {
    const pin = (info.claims.find(c => c.via) || {}).via || canonPin;
    const g = S.gpio[pin] || S.gpio[canonPin] || {};
    const eff = gpioEffectiveMode(pin, info.claims, g);
    const effective = [['mode', eff.mode], ['speed', g.speed]];
    if (eff.mode === 'Input') effective.push(['pull', g.pull]);
    for (const [field, value] of effective) {
      if (value === undefined || value === null || value === '') continue;
      const c = constraintFor(pin, field, value);
      if (!c) continue;
      const sentence = constraintSentence(c, pin, field, value);
      constraintIssues.push({
        pin, field, value, id: c.id, sentence,
        reason: c.reason || null, source: c.source || null,
      });
      const owners = [...new Set(info.claims.map(cl => cl.who))];
      for (const owner of owners) {
        if (owner === 'GPIO' || !M.peripherals[owner]) continue;
        (issues[owner] ||= []).push(sentence);
      }
    }
  }

  // Analog against alternate function, on one pad, from ONE owner.
  //
  // `GPIO_Mode_AIN` and `GPIO_Mode_AF_PP` are two values of ONE field, so a pad is an
  // analog input or it is a muxed alternate function and never both - and
  // `gpioEffectiveMode()` resolves that by putting analog first, silently dropping the
  // alternate function.
  //
  // TWO owners on one pad are already a conflict above, said loudly and by name, so this
  // deliberately says nothing there: a second sentence on a pad the user must fix anyway
  // is noise, and it fired on 2 pads of a fully-enabled CH32V006 when it did not have
  // this guard. The gap is ONE owner claiming its own pad twice - ADC1_IN4 beside a muxed
  // ADC1 signal - where `owners.length === 1`, nothing above looks, and the generated C
  // configures the pad analog and never writes the AF field the other signal needs. A
  // peripheral that looks configured and does not work is the round's defect class.
  const analogIssues = [];
  for (const [canonPin, info] of Object.entries(pins)) {
    if (info.state === 'conflict') continue;              // already reported, by name, above
    const live = info.claims.filter(c => !skippedClaim(c) && c.who !== 'GPIO' && M.peripherals[c.who]);
    if (live.length < 2) continue;
    const isAn = c => analogClaim(c, c.via || canonPin).analog;
    const an = live.filter(isAn), af = live.filter(c => !isAn(c));
    if (!an.length || !af.length) continue;
    const label = pinLabel(canonPin);
    const sentence = `${label}: ${an.map(c => c.signal).join(', ')} ${an.length > 1 ? 'are' : 'is'}`
      + ` an analog function and ${af.map(c => c.signal).join(', ')} ${af.length > 1 ? 'are' : 'is'}`
      + ' an alternate function. One pad is GPIO_Mode_AIN or it is muxed, never both, so'
      + ` the generated C configures ${canonPin} analog and writes no alternate-function`
      + ' field for the rest.';
    analogIssues.push({ pin: canonPin, label, analog: an.map(c => c.signal), af: af.map(c => c.signal), sentence });
    for (const owner of [...new Set(live.map(c => c.who))]) (issues[owner] ||= []).push(sentence);
  }

  const status = {}, issueCount = {};
  for (const pid of Object.keys(M.peripherals)) {
    status[pid] = !isAvailable(pid) ? 'na' : issues[pid] ? 'warn' : isEnabled(pid) ? 'ok' : '';
    issueCount[pid] = (issues[pid] || []).length;
  }

  E = {
    pins, issues, status, issueCount, conflictList, resources,
    resourceIssues: resources.issues,
    constraintIssues, analogIssues,
    conflicts: conflictList.map(c => `${c.label}: ${c.signals.join(' / ')}`),
  };
  return E;
}

// Would picking this option collide? Returns '' or a short reason. The picker
// shows it BEFORE the click, so a conflict is never a surprise.
export function previewAssign(pin, opt) {
  if (!E) compute();
  const cur = E.pins[canon(pin)];
  if (opt.gpio || opt.reset) return cur && cur.claims.some(c => c.who !== 'GPIO') ? 'pin in use' : '';
  const { periph, signal, remap } = opt;
  const onThisPin = !!(cur && cur.claims.some(c => c.who === periph && c.signal === sigName(periph, signal)));
  // An AF-muxed signal moves ALONE, so picking it can only ever collide on the pin
  // being clicked - there is no sibling to drag along. That is the whole difference
  // between the two shapes, and it is why this returns before the remap check below:
  // running that check here would invent collisions on pins nothing is about to move.
  if (isAfMuxed(periph)) {
    if (onThisPin) return '';
    return cur && cur.claims.some(c => c.who !== periph) ? 'pin in use' : '';
  }
  const isCur = !!(onThisPin && S.periph[periph].remap === remap);
  if (isCur) return '';
  if (cur && cur.claims.some(c => c.who !== periph)) return 'pin in use';
  if (S.periph[periph].remap !== remap && requiredSignals(periph).size) {
    const r = M.peripherals[periph].remaps[remap];
    const hit = [...requiredSignals(periph)]
      .filter(sig => sig !== signal)
      .map(sig => r.pins[sig])
      .filter(px => px && E.pins[canon(px)] && E.pins[canon(px)].claims.some(c => c.who !== periph));
    if (hit.length) return 'remap collides on ' + [...new Set(hit)].join(', ');
  }
  return '';
}

/**
 * A pin has to exist on the CURRENT package before anything may be written about it.
 * Without this the writers accepted a name the part does not have and stored it: on
 * CH32X035 `assignSignal('PC8', …)` silently put a pin the datasheet never names into
 * S, where compute() ignored it, the plan never mentioned it, and `.wchproj` saved it
 * for ever. That port runs PC0-PC7, PC10-PC11, PC14-PC19 - iterate the pins the data
 * lists, never a range, and refuse the gaps by name (round 4, P0b item 5).
 */
function requirePin(pin, what) {
  if (pinExists(pin)) return;
  const port = /^P([A-Z])/.exec(String(pin));
  const siblings = port
    ? Object.keys(M.pins).filter(p => p.startsWith(`P${port[1]}`) && pinExists(p))
    : [];
  throw new Error(`Cannot ${what} "${pin}": ${M.mcu.name} ${S.pkg} has no such pin`
    + (siblings.length ? `. Port ${port[1]} here is ${siblings.join(', ')}` : ''));
}

// Assign an option from the pin picker: either a plain GPIO mode, or a
// peripheral signal (which also selects the remap that routes it to this pin).
export function assignSignal(pin, opt) {
  requirePin(pin, 'assign a signal to');
  record(`${opt.gpio || sigName(opt.periph, opt.signal)} on ${pinLabel(pin)}`);
  if (opt.gpio) {
    for (const n of groupOf(pin)) delete S.manual[n];
    S.manual[pin] = opt.gpio;
    S.gpio[pin] ||= {
      // The part's OWN name for this mode, read off its `gpio.modes` - the same answer
      // the generator and the constraint matcher reach, from `gpioModeForSignal()`.
      // These were the literals "Output Push Pull" / "Analog" / "Input", which is the
      // round-3 defect one field over: a name from this app's vocabulary rather than
      // the part's. Every part here happens to spell them the same way, so it was
      // latent rather than live - and the literal is still the fallback, so a part
      // whose file states nothing gets the same TODO it got before rather than a
      // silently different mode.
      mode: gpioModeForSignal(opt.gpio)
        || (opt.gpio === 'GPIO_Output' ? 'Output Push Pull' : opt.gpio === 'GPIO_Analog' ? 'Analog' : 'Input'),
      // the part's own first speed and first pull, never a name from nowhere
      pull: gpioFieldOptionNames('pull')[0] || 'No pull',
      speed: gpioSpeedFor(undefined) || '', label: '',
    };
    return;
  }
  const { periph, signal, remap } = opt;
  const P = M.peripherals[periph], st = S.periph[periph];
  for (const n of groupOf(pin)) delete S.manual[n];
  // Selecting the route is the one step that differs by mux shape: a remap part picks
  // an index that moves every signal at once, an AF part records THIS signal's pin and
  // leaves its siblings where they were.
  if (P.signal_pins) {
    const chosen = groupOf(pin).find(n => signalPinOptions(periph, signal).some(o => o.pin === n));
    if (chosen) (st.afPins ||= {})[signal] = chosen;
  } else {
    st.remap = remap;
  }
  // turn on the first setting choice that carries this signal (if none already does)
  if (!requiredSignals(periph).has(signal)) {
    outer: for (const s of P.settings || []) for (const c of s.choices) {
      if ((c.signals || []).includes(signal)) {
        if (s.type === 'checkboxes') st.settings[s.name].add(c.name); else st.settings[s.name] = c.name;
        break outer;
      }
    }
  }
  S.sel = periph;
}

// Put a pin back to its reset state: drop the manual GPIO and switch off
// whichever peripheral choices were driving it.
export function resetPin(pin) {
  requirePin(pin, 'reset');
  record(`Reset ${pinLabel(pin)}`);
  const cl = ((E && E.pins[canon(pin)]) || {}).claims || [];
  for (const n of groupOf(pin)) { delete S.manual[n]; delete S.gpio[n]; }
  for (const c of cl) {
    if (c.who === 'GPIO') continue;
    const P = M.peripherals[c.who], st = S.periph[c.who], sig = c.signal.slice(c.who.length + 1);
    for (const s of P.settings || []) {
      if (s.type === 'checkboxes') {
        for (const ch of s.choices) if ((ch.signals || []).includes(sig)) st.settings[s.name].delete(ch.name);
      } else {
        const cur = s.choices.find(x => x.name === st.settings[s.name]);
        if (cur && (cur.signals || []).includes(sig)) st.settings[s.name] = neutralChoice(s).name;
      }
    }
  }
}


// ---- state writers -----------------------------------------------------------
// Everything that changes the configuration goes through one of these, so undo
// works and the UI never has to know how S is shaped. (AGENT-3: route the centre
// panel and the clock tab here — these replace the thin writers in section 4b.)

// Shared by both setting writers: the peripheral has to exist on this part, and
// so does the setting. A generic caller — the peripheral tabs drive every setting
// by name — gets a sentence, not a TypeError from `undefined.settings`.
function findSetting(pid, setting) {
  const p = M.peripherals[pid];
  if (!p) throw new Error(`no peripheral "${pid}" on ${M.mcu.name}`);
  const s = (p.settings || []).find(x => x.name === setting);
  if (!s) throw new Error(`${pid} has no setting "${setting}"`);
  return s;
}

// A dropdown setting: "Mode" -> "Asynchronous".
export function setSetting(pid, setting, choice) {
  const s = findSetting(pid, setting);
  // Round-3 C5. Writing a String over the Set left the next compute() calling
  // `v.has(...)` on a string — a blank app until reload, and no exception at the
  // call site to say who did it. Reject it here, by name, with the way out.
  if (s.type === 'checkboxes')
    throw new Error(`${pid}.${setting} is a checkbox setting — use toggleSetting(pid, setting, choice, on), not setSetting`);
  if (!s.choices.some(c => c.name === choice)) throw new Error(`${pid}.${setting} has no choice "${choice}"`);
  record(`${pid} ${setting}`);
  S.periph[pid].settings[setting] = choice;
}

// A checkbox setting: ADC1 "Channels" IN3 on or off.
export function toggleSetting(pid, setting, choice, on) {
  const s = findSetting(pid, setting);
  if (s.type !== 'checkboxes')
    throw new Error(`${pid}.${setting} is not a checkbox setting — use setSetting(pid, setting, choice)`);
  if (!s.choices.some(c => c.name === choice)) throw new Error(`${pid}.${setting} has no choice "${choice}"`);
  record(`${pid} ${choice}`);
  const set = S.periph[pid].settings[setting];
  if (on === undefined ? set.has(choice) : !on) set.delete(choice); else set.add(choice);
}

// The AFIO remap / pin-location selector.
export function setRemap(pid, index) {
  const remaps = M.peripherals[pid].remaps || [];
  if (!remaps[index]) throw new Error(`${pid} has no remap ${index}`);
  record(`${pid} remap ${remaps[index].name}`);
  S.periph[pid].remap = index;
}

// Move ONE signal of an AF-muxed peripheral to one of its listed pins. The remap
// equivalent is setRemap() above, and the two are deliberately separate calls rather
// than one that guesses: a remap index and a signal's pin are not the same decision,
// and a part that took both would have two ways to say where a signal goes.
// Refuses a pin the data does not list for that signal, by name - the same contract
// requirePin() applies to a pin the package does not have.
export function setSignalPin(pid, signal, pin) {
  const opts = signalPinOptions(pid, signal);
  if (!opts.length) throw new Error(`${pid} has no signal_pins entry for ${signal}`);
  if (!opts.some(o => o.pin === pin))
    throw new Error(`${pid}_${signal} cannot use ${pin}: the data lists ${opts.map(o => o.pin).join(', ')}`);
  record(`${sigName(pid, signal)} on ${pinLabel(pin)}`);
  (S.periph[pid].afPins ||= {})[signal] = pin;
}

// One cell of the GPIO settings table (mode, pull, speed, label).
export function setGpioField(pin, key, value) {
  requirePin(pin, 'configure');
  // Round-3 P0b: S must never carry an output speed the part cannot express.
  // `gpio.speeds` in the MCU file says what the part HAS. A part with exactly one
  // speed has no choice to make, so whatever arrives is stored as that one name -
  // that is how a caller holding a stale Low/Medium/High list (or a .wchproj saved
  // before the one-speed fix) stops putting a name into S that the silicon, the SDK
  // and the generator all disagree with. A part with a REAL choice gets no such
  // courtesy: a value it does not offer is a bug at the call site and throws.
  if (key === 'speed' && value !== '') {
    const speeds = gpioSpeeds();
    if (speeds.length > 1 && !speeds.some(s => s.name === value)) {
      throw new Error(`${M.mcu.name} has no output speed "${value}". It offers: ${speeds.map(s => s.name).join(', ')}`);
    }
    if (speeds.length) value = gpioSpeedFor(value);
  }
  record(value === '' ? `Clear ${key} on ${pinLabel(pin)}` : `${pinLabel(pin)} ${key}`);
  (S.gpio[pin] ||= {})[key] = value;
}
export const userLabel = pin => ((S.gpio[pin] || {}).label || '').trim();
export const pinModified = pin => !!(E && E.pins[canon(pin)]) || !!userLabel(pin);

/**
 * The RCC setting that switches the external crystal on, read from the data:
 * `clock.hse_peripheral` / `clock.hse_setting` / `clock.hse_signals`. A file
 * that carries none of them still works — the peripheral called RCC, and the
 * setting whose choices claim the crystal pins (or whose name says HSE).
 * Nothing here knows that those pins are usually called XI and XO: the dummy
 * part names them OSC_IN/OSC_OUT on purpose.
 * Returns { pid, setting, crystal, neutral, signals } or null.
 */
export function hseSetting(m = M) {
  const c = m.clock || {};
  const pid = c.hse_peripheral || 'RCC';
  const P = (m.peripherals || {})[pid];
  if (!P || !P.settings) return null;
  const want = c.hse_signals || ['XI', 'XO'];
  const carries = ch => want.every(sig => (ch.signals || []).includes(sig));
  const s = (c.hse_setting && P.settings.find(x => x.name === c.hse_setting))
    || P.settings.find(x => x.choices.some(carries))
    || P.settings.find(x => /\bHSE\b/i.test(x.name));
  if (!s) return null;
  // the crystal choice claims every HSE signal; BYPASS claims only the input
  const crystal = s.choices.find(carries);
  if (!crystal) return null;
  return { pid, setting: s.name, crystal: crystal.name, neutral: neutralChoice(s).name, signals: want };
}

/**
 * Clock tab: { sys, hse, pllIn, pllMul, pre: { HB: 2 } } — partial, merged in.
 *
 * Every source the MCU file lists is always accepted: the muxes are never
 * gated on RCC state, which is the whole point of the round-2 P0. Picking HSE
 * (directly, or as the PLL input feeding SYSCLK) turns the crystal on in RCC
 * the way CubeMX does, as ONE undo step with the clock change. Switching back
 * to HSI deliberately leaves the crystal on — that is the user's setting now.
 *
 * Returns what else changed, for the toast: { hse: { pid, setting, choice, pins } } or {}.
 */
export function setClock(patch) {
  if (!M.clock) throw new Error('this MCU file has no clock: block');
  const c = M.clock;
  const bad = (k, v, allowed) =>
    new Error(`setClock: ${k} "${v}" is not offered by ${M.mcu.name} (has ${allowed.join(', ')})`);
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'sys') {
      if (!c.sysclk.sources.includes(v)) throw bad('sys', v, c.sysclk.sources);
    } else if (k === 'pllIn') {
      const inputs = (c.pll || {}).inputs || [];
      if (!inputs[v]) throw bad('pllIn', v, inputs.map((i, n) => `${n}=${i.name}`));
    } else if (k === 'pllMul') {
      const muls = (c.pll || {}).multipliers || [];
      if (!muls.some(m => String(m) === String(v))) throw bad('pllMul', v, muls.map(String));
    } else if (k === 'hse') {
      // out of the datasheet range is ALLOWED and shows red — only nonsense is refused
      if (!Number.isFinite(v) || v <= 0) throw new Error(`setClock: hse must be a positive number, got ${v}`);
    } else if (k === 'pre') {
      for (const [name, val] of Object.entries(v)) {
        const pre = (c.prescalers || {})[name];
        if (!pre) throw bad('prescaler', name, Object.keys(c.prescalers || {}));
        if (!pre.options.some(o => String(o) === String(val))) throw bad(`pre.${name}`, val, pre.options.map(String));
      }
    } else if (k === 'preSrc') {
      // A tap whose `source:` is a LIST is a mux, and the list is the whole set of
      // choices: refusing anything outside it is the same rule the prescaler options
      // follow. A tap with a single source has no mux to set at all.
      const muxes = Object.keys(c.prescalers || {}).filter(n => tapSources(c.prescalers[n]));
      for (const [name, val] of Object.entries(v)) {
        const list = tapSources((c.prescalers || {})[name]);
        if (!list) throw bad('clock mux', name, muxes);
        if (!list.includes(val)) throw bad(`preSrc.${name}`, val, list);
      }
    } else if (k === 'plls') {
      // The SYS PLL is set through `pllIn` / `pllMul`; `plls` is for the others, so a
      // patch naming PLL here is refused rather than quietly writing a second copy of
      // state the rest of the engine reads from the flat keys.
      const named = pllList(c).filter(q => !q.sys);
      for (const [id, st] of Object.entries(v)) {
        const q = named.find(n => n.id === id);
        if (!q) throw bad('PLL', id, named.map(n => n.id));
        const inputs = q.def.inputs || [], muls = q.def.multipliers || [], divs = q.def.dividers || [];
        if (st.in !== undefined && !inputs[st.in]) throw bad(`plls.${id}.in`, st.in, inputs.map((i, n) => `${n}=${i.name}`));
        if (st.mul !== undefined && !muls.some(mu => String(mu) === String(st.mul))) throw bad(`plls.${id}.mul`, st.mul, muls.map(String));
        if (st.div !== undefined && !divs.some(d => String(d) === String(st.div))) throw bad(`plls.${id}.div`, st.div, divs.map(String));
      }
    } else {
      throw new Error(`setClock: unknown field "${k}"`);
    }
  }

  const changed = {};
  batch('Clock', () => {
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'pre' || k === 'preSrc') S.clock[k] = Object.assign(S.clock[k] || {}, v);
      else if (k === 'plls') {
        S.clock.plls = S.clock.plls || {};
        for (const [id, st] of Object.entries(v)) S.clock.plls[id] = Object.assign(S.clock.plls[id] || {}, st);
      } else S.clock[k] = v;
    }
    if (!hseFeedsSysclk()) return;
    const h = hseSetting();
    if (!h || S.periph[h.pid].settings[h.setting] !== h.neutral) return;   // already the user's choice: leave it
    setSetting(h.pid, h.setting, h.crystal);
    const r = (M.peripherals[h.pid].remaps || [])[S.periph[h.pid].remap] || { pins: {} };
    changed.hse = {
      pid: h.pid, setting: h.setting, choice: h.crystal,
      pins: h.signals.map(sig => r.pins[sig]).filter(Boolean),
      signals: h.signals,
    };
  });
  return changed;
}

// selectPeripheral() stays in the UI: it re-renders, and the engine never touches
// the DOM. Selection is view state anyway — no undo step.
