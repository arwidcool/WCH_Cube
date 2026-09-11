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
//  Both are reported through E.resources and folded into E.issues, so the tree
//  and the centre panel show them with no UI change.
// =============================================================================
import { M, S, isEnabled, pinExists } from './model.js';

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

// Everything above, plus the flat issue list compute() folds into E.
export function resourceState() {
  const exti = extiState();
  const dma = dmaState();
  const issues = [...((exti && exti.issues) || []), ...((dma && dma.issues) || [])];
  return { exti, dma, issues };
}
