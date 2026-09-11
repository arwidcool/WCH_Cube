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
//  }
// =============================================================================
import {
  M, S, canon, pinExists, pinLabel, pinNum, groupOf, sigName,
  requiredSignals, isEnabled, isAvailable, neutralChoice, gpioSpeeds, gpioSpeedFor,
} from './model.js';
import { record, batch } from './history.js';
import { resourceState } from './resources.js';
import { hseFeedsSysclk } from './clock.js';

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

  // Conflicts that are not about pins: EXTI lines and DMA channels.
  const resources = resourceState();
  for (const r of resources.issues) {
    for (const owner of r.owners) {
      if (owner === 'GPIO' || !M.peripherals[owner]) continue;
      (issues[owner] ||= []).push(r.text);
    }
  }

  const status = {}, issueCount = {};
  for (const pid of Object.keys(M.peripherals)) {
    status[pid] = !isAvailable(pid) ? 'na' : issues[pid] ? 'warn' : isEnabled(pid) ? 'ok' : '';
    issueCount[pid] = (issues[pid] || []).length;
  }

  E = {
    pins, issues, status, issueCount, conflictList, resources,
    resourceIssues: resources.issues,
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
      // the part's own first speed, never a Low/Medium/High name from nowhere
      pull: 'No pull', speed: gpioSpeedFor(undefined) || '', label: '',
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

// One cell of the GPIO settings table (mode, pull, speed, label).
export function setGpioField(pin, key, value) {
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
    } else {
      throw new Error(`setClock: unknown field "${k}"`);
    }
  }

  const changed = {};
  batch('Clock', () => {
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'pre') Object.assign(S.clock.pre, v); else S.clock[k] = v;
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
