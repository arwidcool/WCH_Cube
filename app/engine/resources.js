// =============================================================================
//  resources.js — conflicts that are not about pins.
//
//  Two of them on CH32V00x, both from AGENT-1's data blocks:
//
//  EXTI  one interrupt line per pin NUMBER, shared by every port. AFIO_EXTICR
//        picks which port drives the line, so PA3 and PC3 can never both be
//        external interrupts. That is a hard conflict.
//
//  DMA   one channel serves several peripherals, and only one of them at a time.
//        Nothing in the data says whether a given peripheral is actually using
//        DMA, so this is reported as a warning about a shared channel, and only
//        once the DMA controller itself is switched on.
//
//  NVIC  which vectors the user switched on, and at what PFIC priority. Not a
//        conflict so much as the other resource that is not a pin, and it shares
//        this file because a DMA channel interrupt is one object seen from both.
//
//  Both conflicts are reported through E.resources and folded into E.issues, so the
//  tree and the centre panel show them with no UI change.
//
//  The state the user builds here - `S.dma.requests` and `S.nvic` - is defined in
//  model.js initState(), round-tripped by project.js and undone by history.js like
//  everything else. The setters below are the only way to change it.
// =============================================================================
import { M, S, isEnabled, pinExists } from './model.js';
import { normaliseParamDefs, validateParam, paramDefs, paramValue } from './params.js';
import { record } from './history.js';

// EXTI line a pin can drive, or null. `lines` maps a selector value to a pin.
export function extiLineOf(pin) {
  const lines = (M.exti || {}).lines || {};
  for (const [line, sel] of Object.entries(lines)) {
    for (const [value, p] of Object.entries(sel)) if (p === pin) return { line, value };
  }
  return null;
}

// Pins the user asked to be external interrupts.
const extiPins = () => Object.entries(S.manual)
  .filter(([pin, sig]) => sig === 'GPIO_EXTI' && pinExists(pin))
  .map(([pin]) => pin);

export function extiState() {
  if (!M.exti || !M.exti.lines) return null;
  const lines = {}, issues = [];
  for (const pin of extiPins()) {
    const hit = extiLineOf(pin);
    if (!hit) {
      issues.push({
        kind: 'exti', severity: 'conflict', pins: [pin], owners: ['GPIO'],
        text: `${pin} cannot be an external interrupt: no AFIO_EXTICR selector routes it to a line`,
      });
      continue;
    }
    (lines[hit.line] ||= []).push({ pin, value: hit.value });
  }
  for (const [line, users] of Object.entries(lines)) {
    if (users.length < 2) continue;
    const names = users.map(u => u.pin);
    issues.push({
      kind: 'exti', severity: 'conflict', pins: names, owners: ['GPIO'], line,
      text: `${names.join(' and ')} both need ${line} — AFIO_EXTICR selects one port per line, so only one of them can be an external interrupt`,
    });
  }
  return { lines, issues };
}

// The peripheral a DMA request name belongs to: SPI1_RX -> SPI1, ADC1 -> ADC1.
const requestOwner = name => (M.peripherals[name] ? name : String(name).split('_')[0]);

export function dmaState() {
  const d = M.dma;
  if (!d || !d.requests) return null;
  const controller = d.controller && M.peripherals[d.controller] ? d.controller : null;
  const on = !!(controller && isEnabled(controller));
  const channels = {}, issues = [];
  for (const [ch, requests] of Object.entries(d.requests)) {
    const live = (requests || []).filter(r => {
      const pid = requestOwner(r);
      return M.peripherals[pid] && isEnabled(pid);
    });
    channels[ch] = { requests: requests || [], live };
    if (!on || live.length < 2) continue;
    const owners = [...new Set(live.map(requestOwner))];
    if (owners.length < 2) continue;                  // one peripheral, several of its own events
    issues.push({
      kind: 'dma', severity: 'warning', channel: ch,
      owners: [...new Set([controller, ...owners])],   // the controller carries the warning too
      text: `${d.controller} channel ${ch} is shared by ${live.join(', ')} — only one of them can drive it`,
    });
  }
  return { controller: d.controller, channels, enabled: on, issues };
}

// =============================================================================
//  DMA requests — what the user asked the controller to move
// =============================================================================
//  `M.dma.requests` is the hardware map: channel -> the request lines wired to it.
//  On CH32V006 every request name appears on exactly ONE channel, so the channel is
//  not a choice at all - it is a consequence of the request. `legalChannels` is
//  computed from the map rather than assumed, so a part whose request CAN go to more
//  than one channel gets a real selector and this part gets fixed text. A one-entry
//  list means the control is not shown, exactly as with gpio.speeds.
//
//  `S.dma.requests` is a LIST, not a map, because regenerating after a save/open
//  cycle has to produce byte-identical C and object key order is not something to
//  rely on. It is kept sorted by channel then request name, so two users who added
//  the same requests in a different order still generate the same file.
//
//  `id` is the request name. A request line is a single piece of silicon: it cannot
//  be added twice, so it is its own identity, it survives a .wchproj round trip
//  unchanged, and a human reading the saved file can tell what it is.

const dmaCfg = () => (M && M.dma) || {};

/** Request name -> the channels that can serve it, from the hardware map. */
export function dmaLegalChannels(request) {
  const out = [];
  for (const [ch, list] of Object.entries(dmaCfg().requests || {})) {
    if ((list || []).map(String).includes(String(request))) out.push(String(ch));
  }
  return out.sort((a, b) => Number(a) - Number(b));
}

/** Every request this part has, in channel order. */
export function dmaAllRequests() {
  const out = [];
  for (const [ch, list] of Object.entries(dmaCfg().requests || {})) {
    for (const r of list || []) {
      out.push({ request: String(r), channel: String(ch), owner: requestOwner(r) });
    }
  }
  return out.sort((a, b) => (a.channel === b.channel ? a.request.localeCompare(b.request) : Number(a.channel) - Number(b.channel)));
}

/** The ones not added yet — what an "Add" control should offer. */
export const dmaAddableRequests = () =>
  dmaAllRequests().filter(r => !(S.dma.requests || []).some(x => x.id === r.request));

/** Normalised DMA_InitTypeDef parameter definitions — the same schema as params:. */
export function dmaParamDefs() {
  const list = dmaCfg().channel_params;
  if (!Array.isArray(list)) return [];
  return normaliseParamDefs(list);
}

const dmaDefOf = key => dmaParamDefs().find(d => d.key === key);

/** Starting values for a request: the definition defaults, then dma.request_defaults. */
export function dmaRequestDefaults(request) {
  const out = {};
  for (const d of dmaParamDefs()) out[d.key] = d.default;
  const seed = (dmaCfg().request_defaults || {})[request];
  if (seed && typeof seed === 'object') {
    for (const [k, v] of Object.entries(seed)) {
      const d = dmaDefOf(k);
      if (!d) continue;                       // the data names a parameter that is gone
      try { out[k] = validateParam(d, v, `dma.request_defaults.${request}.${k}`); }
      catch (e) { /* a bad starting value is not worth refusing to load the part for */ }
    }
  }
  return out;
}

const byChannelThenName = (a, b) =>
  (a.channel === b.channel ? String(a.id).localeCompare(String(b.id)) : Number(a.channel) - Number(b.channel));

/** Everything the DMA Settings tab renders, one row per added request. */
export function dmaRequests() {
  if (!dmaCfg().requests) return [];
  return (S.dma.requests || []).map(r => ({
    id: r.id,
    request: r.request,
    owner: requestOwner(r.request),
    channel: String(r.channel),
    legalChannels: dmaLegalChannels(r.request),
    params: { ...r.params },
  })).sort(byChannelThenName);
}

const findRequest = id => (S.dma.requests || []).find(r => r.id === id);

/**
 * Add a request. The channel comes from the hardware map; pass one only when the
 * part offers more than one and the user picked. Throws on a request this part does
 * not have, and on adding the same request twice - one request line, one user.
 */
export function addDmaRequest(request, channel) {
  const name = String(request);
  const legal = dmaLegalChannels(name);
  if (!legal.length) {
    const all = dmaAllRequests().map(r => r.request);
    throw new Error(`${M.mcu.name} has no DMA request "${name}"${all.length ? ` (has: ${all.join(', ')})` : ''}`);
  }
  const already = findRequest(name);
  if (already) throw new Error(`${name} is already on DMA channel ${already.channel}`);
  const ch = channel === undefined ? legal[0] : String(channel);
  if (!legal.includes(ch)) throw new Error(`DMA request ${name} cannot use channel ${ch} — it is wired to ${legal.join(', ')}`);
  record(`Add DMA ${name}`);
  (S.dma.requests ||= []).push({ id: name, request: name, channel: ch, params: dmaRequestDefaults(name) });
  S.dma.requests.sort(byChannelThenName);
  return name;
}

export function removeDmaRequest(id) {
  const i = (S.dma.requests || []).findIndex(r => r.id === id);
  if (i < 0) throw new Error(`No DMA request "${id}" is configured`);
  record(`Remove DMA ${id}`);
  S.dma.requests.splice(i, 1);
}

/** Move a request to another channel it is actually wired to. */
export function setDmaRequest(id, patch) {
  const r = findRequest(id);
  if (!r) throw new Error(`No DMA request "${id}" is configured`);
  if (!patch || patch.channel === undefined) return;
  const ch = String(patch.channel);
  const legal = dmaLegalChannels(r.request);
  if (!legal.includes(ch)) throw new Error(`DMA request ${r.request} cannot use channel ${ch} — it is wired to ${legal.join(', ')}`);
  record(`DMA ${id} channel`);
  r.channel = ch;
  S.dma.requests.sort(byChannelThenName);
}

/** One DMA_InitTypeDef field, validated exactly like a peripheral parameter. */
export function setDmaParam(id, key, value) {
  const r = findRequest(id);
  if (!r) throw new Error(`No DMA request "${id}" is configured`);
  const d = dmaDefOf(key);
  if (!d) {
    const known = dmaParamDefs().map(x => x.key).join(', ');
    throw new Error(`DMA has no parameter "${key}"${known ? ` (has: ${known})` : ''}`);
  }
  if (d.readonly) throw new Error(`DMA.${d.name} is fixed by the hardware and cannot be set`);
  const v = validateParam(d, value, `${r.request}.${d.name}`);
  record(`DMA ${id} ${d.name}`);
  (r.params ||= {})[key] = v;
  return v;
}

export function dmaParamValue(id, key) {
  const r = findRequest(id);
  if (!r) return undefined;
  if (r.params && r.params[key] !== undefined) return r.params[key];
  const d = dmaDefOf(key);
  return d ? d.default : undefined;
}

/** The register encoding behind a chosen option, for codegen. */
export function dmaParamRegisterValue(id, key) {
  const d = dmaDefOf(key);
  if (!d) return undefined;
  const v = dmaParamValue(id, key);
  if (!d.options) return v;
  const hit = d.options.find(o => String(o.name) === String(v));
  return hit ? hit.value : undefined;
}

/**
 * Two requests the user configured on one channel. This is a HARD conflict, not the
 * soft "this channel is shared" warning dmaState() reports about what is merely
 * switched on: the user has explicitly asked for both, and the channel can serve one.
 * codegen turns it into an #error rather than last-wins code.
 */
export function dmaConflicts() {
  const byCh = {};
  for (const r of dmaRequests()) (byCh[r.channel] ||= []).push(r);
  const out = [];
  for (const [channel, rows] of Object.entries(byCh)) {
    if (rows.length < 2) continue;
    out.push({
      channel,
      ids: rows.map(r => r.id),
      owners: [...new Set(rows.map(r => r.owner))],
      text: `${dmaCfg().controller || 'DMA'} channel ${channel} is configured for ${rows.map(r => r.request).join(' and ')}`
        + ' — one channel serves one request at a time',
    });
  }
  return out.sort((a, b) => Number(a.channel) - Number(b.channel));
}

/**
 * A coupling the data deliberately does not automate (AGENT-1, round 2): SPI1 moving
 * 16-bit frames needs half-word widths on both sides of the transfer. Nothing enforces
 * it, so say so rather than generate a silent mismatch.
 */
function dmaCouplingWarnings() {
  const out = [];
  for (const r of dmaRequests()) {
    const ps = (S.periph[r.owner] || {}).params || {};
    const wide = Object.entries(ps).some(([k, v]) => /data|size|frame|width/i.test(k) && /16/.test(String(v)));
    if (!wide) continue;
    const psize = dmaParamValue(r.id, 'psize'), msize = dmaParamValue(r.id, 'msize');
    if (psize === undefined && msize === undefined) continue;
    if (String(psize) === 'Half Word' && String(msize) === 'Half Word') continue;
    out.push({
      kind: 'dma', severity: 'warning', owners: [r.owner, dmaCfg().controller].filter(Boolean),
      text: `${r.owner} moves 16-bit data but ${r.request} transfers ${psize} / ${msize}`
        + ' — both widths should be Half Word or the transfer is misaligned',
    });
  }
  return out;
}

// =============================================================================
//  NVIC — which interrupt vectors are on, and at what priority
// =============================================================================
//  The PFIC is NOT the Cortex-M scheme. `PFIC_IPRIORx` gives every vector a byte and
//  implements TWO of its bits ([5:0] are reserved, fixed to 0 and write-invalid; RM
//  6.5.2.21), and the maximum nesting depth is 2. `nvic.scheme.groups` carries the
//  variants; the ranges come from the ACTIVE group, never from a hardcoded 0-15.
//
//  Where the nesting depth itself is configured is not in this reference manual, so
//  the group is a recorded choice with no register write claimed for it. Do not
//  invent one - AGENT-1's note under `nvic.scheme.notes` says why.

const nvicCfg = () => (M && M.nvic) || {};
export const nvicScheme = () => nvicCfg().scheme || null;
export const nvicGroups = () => ((nvicCfg().scheme || {}).groups || []);
export const nvicGroup = () => nvicGroups()[S.nvic.group] || null;

/** The EXTI lines the configuration has actually claimed, as numbers. */
function claimedExtiLines() {
  const ex = extiState();
  if (!ex) return [];
  return Object.keys(ex.lines).map(l => Number(String(l).replace(/\D+/g, ''))).filter(Number.isFinite);
}

/**
 * A vector is available when something can raise it.
 *
 * A vector that declares `lines:` is raised by a PIN, not by a peripheral being
 * switched on in the settings - EXTI has no "Mode: Enable", it has pins. So its
 * availability is "at least one of my lines is claimed". That is keyed off the data's
 * own `lines:` key rather than off the peripheral being called EXTI, so a part that
 * groups some other vector the same way gets the same treatment for free.
 */
function vectorAvailable(v) {
  if (v.system) return true;                       // NMI, SysTick, the software interrupt
  if (Array.isArray(v.lines) && v.lines.length === 2) {
    return claimedExtiLines().some(n => n >= v.lines[0] && n <= v.lines[1]);
  }
  if (!v.peripheral) return true;
  if (!M.peripherals[v.peripheral]) return false;  // the part does not have it at all
  return isEnabled(v.peripheral);
}

/** Clamp a priority into the active group's range, or null when there is no group. */
function nvicRange(which) {
  const g = nvicGroup();
  const spec = g && g[which];
  if (!spec) return null;
  return { min: spec.min || 0, max: spec.max === undefined ? 0 : spec.max, bits: spec.bits || 0 };
}

/** Everything the NVIC Settings tab and the System Core overview render. */
export function nvicVectors() {
  const list = nvicCfg().vectors;
  if (!Array.isArray(list)) return [];
  return list.map(v => {
    const st = (S.nvic.vectors || {})[v.name] || {};
    return {
      name: String(v.name),
      vector: v.vector,
      irqn: v.irqn || null,          // IRQn_Type member — NVIC_InitStructure.NVIC_IRQChannel
      handler: v.handler || null,    // the startup-table symbol the user's ISR must be called
      peripheral: v.peripheral || null,
      channel: v.channel === undefined ? null : v.channel,
      description: v.description || '',
      system: !!v.system,
      fixed: !!v.fixed,              // NMI and HardFault cannot be switched off
      // An EXTI vector may cover MANY lines: CH32X035's EXTI7_0 / EXTI15_8 / EXTI25_16
      // carry 26 between them, so `lines: [first, last]` (inclusive) is how one row
      // stands for a group. A vector with no `lines:` is simply not an EXTI group.
      lines: Array.isArray(v.lines) && v.lines.length === 2 ? [v.lines[0], v.lines[1]] : null,
      available: vectorAvailable(v),
      enabled: v.fixed ? true : !!st.enabled,
      preempt: st.preempt === undefined ? (nvicRange('preempt') || { min: 0 }).min : st.preempt,
      sub: st.sub === undefined ? (nvicRange('sub') || { min: 0 }).min : st.sub,
    };
  });
}

const vectorDef = name => (nvicCfg().vectors || []).find(v => String(v.name) === String(name));

/**
 * The vector an EXTI line raises. Looked up line -> vector, which is the direction
 * every question is actually asked in: "the user made PA3 an external interrupt, which
 * vector has to be on?" Many lines map to one vector, so enabling a second line in the
 * same group enables nothing new - the group is already on.
 */
export function nvicVectorForLine(line) {
  const n = Number(line);
  if (!Number.isFinite(n)) return null;
  return nvicVectors().find(v => v.lines && n >= v.lines[0] && n <= v.lines[1]) || null;
}

/**
 * The vectors the configured external interrupts need, each once. `extiState()` gives
 * the lines; this turns them into the rows the NVIC tab should light up, so the tab
 * lists three vectors rather than twenty-six lines.
 */
export function extiVectorsNeeded() {
  const ex = extiState();
  if (!ex) return [];
  const out = new Map();
  for (const [line, users] of Object.entries(ex.lines)) {
    const num = Number(String(line).replace(/\D+/g, ''));
    const v = nvicVectorForLine(num);
    if (!v) continue;
    const row = out.get(v.name) || { vector: v, lines: [], pins: [] };
    row.lines.push(num);
    row.pins.push(...users.map(u => u.pin));
    out.set(v.name, row);
  }
  return [...out.values()].sort((a, b) => a.vector.vector - b.vector.vector);
}

/** Enable a vector, or set its priority. Validated against the ACTIVE group. */
export function setNvicVector(name, patch) {
  const v = vectorDef(name);
  if (!v) {
    const known = (nvicCfg().vectors || []).map(x => x.name).join(', ');
    throw new Error(`${M.mcu.name} has no interrupt vector "${name}"${known ? ` (has: ${known})` : ''}`);
  }
  const p = patch || {};
  if (v.fixed && p.enabled === false) {
    throw new Error(`${name} cannot be disabled — it is always active on this core`);
  }
  for (const which of ['preempt', 'sub']) {
    if (p[which] === undefined) continue;
    const r = nvicRange(which);
    if (!r) throw new Error(`${M.mcu.name} has no priority grouping data, so ${which} priority cannot be set`);
    const n = Number(p[which]);
    if (!Number.isInteger(n) || n < r.min || n > r.max) {
      throw new Error(`${name}: ${which} priority ${p[which]} is outside ${r.min}-${r.max}`
        + ` for "${(nvicGroup() || {}).name || 'the active grouping'}"`);
    }
  }
  record(`${name} interrupt`);
  const st = ((S.nvic.vectors ||= {})[name] ||= {});
  if (p.enabled !== undefined) st.enabled = !!p.enabled;
  if (p.preempt !== undefined) st.preempt = Number(p.preempt);
  if (p.sub !== undefined) st.sub = Number(p.sub);
  return st;
}

/**
 * Change the priority grouping. Priorities already set are clamped into the new
 * group's range rather than silently left out of it - a 1-bit preempt field cannot
 * hold the 3 that a wider grouping allowed.
 */
export function setNvicGroup(index) {
  const groups = nvicGroups();
  const i = Number(index);
  if (!groups[i]) throw new Error(`${M.mcu.name} has no interrupt priority grouping ${index} (it has ${groups.length})`);
  record('Interrupt priority grouping');
  S.nvic.group = i;
  for (const st of Object.values(S.nvic.vectors || {})) {
    for (const which of ['preempt', 'sub']) {
      if (st[which] === undefined) continue;
      const r = nvicRange(which);
      if (r) st[which] = Math.min(Math.max(st[which], r.min), r.max);
    }
  }
  return i;
}

/**
 * Parameters set on a peripheral that is switched OFF. Round-3 P2 is "configuration
 * must reach the C", and this is the one way it silently does not: the generator only
 * emits a section for an enabled peripheral, so a baud rate typed into a USART nobody
 * turned on is a value the user believes they set and the code has never heard of.
 *
 * A warning rather than a conflict - nothing is wrong with the silicon, the user just
 * has not finished. It names the peripheral so the UI can link to it, the same way the
 * NVIC warning does.
 */
function paramReachWarnings() {
  const out = [];
  for (const pid of Object.keys(M.peripherals)) {
    if (isEnabled(pid)) continue;
    const changed = [];
    for (const d of paramDefs(pid)) {
      if (d.readonly) continue;
      const v = paramValue(pid, d.key);
      if (v === undefined || String(v) === String(d.default)) continue;
      changed.push(d.name);
    }
    const store = (S.periph[pid] || {}).channelParams || {};
    for (const [ch, vals] of Object.entries(store)) {
      if (vals && Object.keys(vals).length) changed.push(`channel ${ch}`);
    }
    if (!changed.length) continue;
    out.push({
      kind: 'params', severity: 'warning', owners: [pid],
      text: `${pid} has ${changed.length === 1 ? '' : changed.length + ' settings changed ('}`
        + `${changed.join(', ')}${changed.length === 1 ? ' set' : ')'} but is switched off`
        + ' — none of it reaches the generated code until the peripheral is enabled',
    });
  }
  return out;
}

/**
 * An external interrupt the user configured whose vector is not enabled. The pin is
 * routed and the line is claimed, and nothing will ever fire - which is invisible
 * until it is 3am. The mirror of the "enabled but nothing can raise it" warning.
 */
function extiVectorWarnings() {
  const out = [];
  for (const row of extiVectorsNeeded()) {
    if (row.vector.enabled) continue;
    out.push({
      kind: 'nvic', severity: 'warning', owners: ['EXTI', row.vector.peripheral].filter(Boolean),
      text: `${row.pins.join(', ')} ${row.pins.length === 1 ? 'is an external interrupt' : 'are external interrupts'}`
        + ` but ${row.vector.name} is not enabled — nothing will fire.`
        + ` One vector covers line${row.vector.lines[0] === row.vector.lines[1] ? '' : 's'}`
        + ` ${row.vector.lines[0]}${row.vector.lines[0] === row.vector.lines[1] ? '' : `-${row.vector.lines[1]}`},`
        + ' so enabling it once covers all of them',
    });
  }
  return out;
}

/** A vector the user enabled on a peripheral that is now off. */
function nvicIssues() {
  const out = [];
  for (const v of nvicVectors()) {
    if (!v.enabled || v.available || v.fixed) continue;
    out.push({
      kind: 'nvic', severity: 'warning', owners: [v.peripheral].filter(Boolean),
      text: `${v.name} is enabled but ${v.peripheral ? `${v.peripheral} is switched off` : 'nothing raises it'}`
        + ' — the vector will never fire',
    });
  }
  return out;
}

/** The whole NVIC picture, for the System Core overview. */
export function nvicState() {
  if (!nvicCfg().vectors) return null;
  return {
    controller: nvicCfg().controller || 'NVIC',
    scheme: nvicScheme(),
    groups: nvicGroups(),
    group: S.nvic.group,
    vectors: nvicVectors(),
    extiVectors: extiVectorsNeeded(),
    issues: [...nvicIssues(), ...extiVectorWarnings()],
  };
}

// Everything above, plus the flat issue list compute() folds into E.
export function resourceState() {
  const exti = extiState();
  const dma = dmaState();
  const nvic = nvicState();
  const hard = dmaConflicts().map(c => ({
    kind: 'dma', severity: 'conflict', channel: c.channel,
    owners: [...new Set([dmaCfg().controller, ...c.owners].filter(Boolean))],
    text: c.text,
  }));
  const issues = [
    ...((exti && exti.issues) || []),
    ...((dma && dma.issues) || []),
    ...hard,
    ...dmaCouplingWarnings(),
    ...paramReachWarnings(),
    ...((nvic && nvic.issues) || []),
  ];
  return { exti, dma, nvic, issues };
}
