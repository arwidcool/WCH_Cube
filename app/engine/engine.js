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
//  }
// =============================================================================
import {
  M, S, canon, pinExists, pinLabel, pinNum, groupOf, sigName,
  requiredSignals, isEnabled, isAvailable, neutralChoice,
} from './model.js';
import { record } from './history.js';

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
    const r = (P.remaps || [])[S.periph[pid].remap] || { pins: {} };
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

  const status = {}, issueCount = {};
  for (const pid of Object.keys(M.peripherals)) {
    status[pid] = !isAvailable(pid) ? 'na' : issues[pid] ? 'warn' : isEnabled(pid) ? 'ok' : '';
    issueCount[pid] = (issues[pid] || []).length;
  }

  E = {
    pins, issues, status, issueCount, conflictList,
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
  const isCur = !!(cur
    && cur.claims.some(c => c.who === periph && c.signal === sigName(periph, signal))
    && S.periph[periph].remap === remap);
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

// Assign an option from the pin picker: either a plain GPIO mode, or a
// peripheral signal (which also selects the remap that routes it to this pin).
export function assignSignal(pin, opt) {
  record(`${opt.gpio || sigName(opt.periph, opt.signal)} on ${pinLabel(pin)}`);
  if (opt.gpio) {
    for (const n of groupOf(pin)) delete S.manual[n];
    S.manual[pin] = opt.gpio;
    S.gpio[pin] ||= {
      mode: opt.gpio === 'GPIO_Output' ? 'Output Push Pull' : opt.gpio === 'GPIO_Analog' ? 'Analog' : 'Input',
      pull: 'No pull', speed: 'Low', label: '',
    };
    return;
  }
  const { periph, signal, remap } = opt;
  const P = M.peripherals[periph], st = S.periph[periph];
  for (const n of groupOf(pin)) delete S.manual[n];
  st.remap = remap;
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

// A dropdown setting: "Mode" -> "Asynchronous".
export function setSetting(pid, setting, choice) {
  const s = (M.peripherals[pid].settings || []).find(x => x.name === setting);
  if (!s) throw new Error(`${pid} has no setting "${setting}"`);
  if (!s.choices.some(c => c.name === choice)) throw new Error(`${pid}.${setting} has no choice "${choice}"`);
  record(`${pid} ${setting}`);
  S.periph[pid].settings[setting] = choice;
}

// A checkbox setting: ADC1 "Channels" IN3 on or off.
export function toggleSetting(pid, setting, choice, on) {
  const s = (M.peripherals[pid].settings || []).find(x => x.name === setting);
  if (!s || s.type !== 'checkboxes') throw new Error(`${pid}.${setting} is not a checkbox setting`);
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

// One cell of the GPIO settings table (mode, pull, speed, label).
export function setGpioField(pin, key, value) {
  record(value === '' ? `Clear ${key} on ${pinLabel(pin)}` : `${pinLabel(pin)} ${key}`);
  (S.gpio[pin] ||= {})[key] = value;
}
export const userLabel = pin => ((S.gpio[pin] || {}).label || '').trim();
export const pinModified = pin => !!(E && E.pins[canon(pin)]) || !!userLabel(pin);

// Clock tab: { sys, hse, pllIn, pllMul, pre: { HB: 2 } } — partial, merged in.
export function setClock(patch) {
  record('Clock');
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'pre') Object.assign(S.clock.pre, v); else S.clock[k] = v;
  }
}

// selectPeripheral() stays in the UI: it re-renders, and the engine never touches
// the DOM. Selection is view state anyway — no undo step.
