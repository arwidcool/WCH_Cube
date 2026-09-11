# AGENT-3 — UI. You own the look, layout and interaction: CSS, HTML, SVG chip renderer, panels, clock tab drawing.

Read `agents/README.md` first and follow the work cycle exactly. You never stop to ask; you decide and log.

## Mission
Make it feel like STM32CubeMX (screenshot in `agents/reference/cubemx.png` — copy it there from the
project uploads if missing): navy breadcrumb, blue tab bar, three columns, grey chip with green/yellow/orange
pins, labels outside the chip, ✔/⚠/⊘ in the tree. Conflicts must be impossible to miss.

## Priorities (in order)
1. Conflict visibility polish: orange pins pulse once when a new conflict appears (respect
   prefers-reduced-motion), the banner in the centre header links to the peripheral, and the tree item shows
   the count.
2. Right-click pin → inline user-label editor; label drawn on the chip under the signal name and in the GPIO table.
3. "Show only modified pins" filter; arrow keys move between pins, Enter opens picker, Esc closes.
4. Clock tab as a real tree: boxes and connectors in SVG, driven entirely by `M.clock` + `clockCalc()` so any
   MCU's tree renders without UI changes. Red boxes when out of spec, greyed branches when a source is off.
5. Layout hardening: QFN12 through LQFP144, window widths 1280–2560, no overflow, labels never overlap
   (rotate/stagger when pitch is tight).
6. System view tab: block diagram of enabled peripherals and their buses.
7. Package selector shows I/O count and the variant part numbers (`mcu.variants`).

## Interface contract with AGENT-2 (ENGINE)
- Render only from `M`, `S`, `E`. Never compute conflicts in the UI.
- Need a new engine field? Post `REQUEST(→AGENT-2)` on BOARD and keep working on something else meanwhile.

## Cycle 3 priorities (your original brief is complete — this is the new list)
1. **Parameter Settings tab** against AGENT-2's `getParams/setParam`: CubeMX-style grouped table
   (Basic / Advanced), inline editors per type, read-only computed rows (actual baud rate, error %). Build
   against `app/assets/params.stub.yaml` if real data has not landed; the stub is never inlined into dist.
2. Tree: the CubeMX **Categories / A→Z** toggle and the gear (expand all / collapse all / show enabled only).
3. Chip toolbar icons still missing vs the reference screenshot: rotate 90°, flip, export pinout as SVG,
   pin-search dropdown listing matches.
4. `E.resourceIssues` (EXTI/DMA) get a distinct line style in the centre panel and a non-orange badge in the
   tree — they are not pin conflicts.
5. Package selector shows temp grade next to the part number, like the New Project dialog.

## When idle
- Accessibility: keyboard reachable everything, focus rings, aria labels on pins.
- Dark theme toggle (CubeMX has none; keep it off by default).

## Current
**Round 2, cycle 1 — P0 (clock) closed, P0b (legibility) swept clean.** 267 tests green.
Commits e6a4df8, e1c6202. Everything below was verified in a REAL browser (headless Edge,
Blink layout), not jsdom — the round-1 bug proved jsdom cannot see this class of defect.

| Round-2 item | State |
|---|---|
| P0 clock source selection (UI half) | done — AGENT-4's defects 2 and 3, plus walkthrough 1.1 |
| P0b text legibility | swept clean: 2 themes x 2 MCUs x 12 packages x 3 viewports |
| P0 item 4 dead-control audit | done except the two `disabled title="Future"` tabs (AGENT-4's call) |
| P1 5 Parameter Settings | editable — AGENT-2's setParam() landed, writing `baud` reaches the engine |
| P1 5b DMA Settings + DMA1 panel | data ready, engine setters not — REQUEST(->AGENT-2) posted 15:10Z |
| P1 5c NVIC Settings + NVIC panel | same |
| P1 6/7/8 tree, toolbar, resourceIssues | shipped in round 1 |

### What the P0 actually was
The muxes were never greyed and `setClock` never refused anything. `renderClock()` bound
its handlers AFTER the early return it takes while the tab has never been laid out, so the
clock tree was drawn and **dead**: selects moved on screen and nothing reached the engine.
Interaction is one delegated listener on `#clock` now, installed at parse time, so the
geometry pass can still be deferred without taking the controls with it. Two things made
it read as "not allowed" rather than "not working": `.cnode.off` was `opacity:.45`, which
is exactly how a disabled control looks, and the CH32V006 crystal defaults to 24 MHz —
the same as HSI — so picking HSE changed no number on screen either.

### Two CSS rules that had never applied
Only a real browser could show these, and both had been wrong since they were written.
- `.pin text` (0,1,1) outranks a bare `.pinnum` (0,1,0), so pin NUMBERS took the pin-box
  ink instead of the muted grey the rule intended.
- A `font-size` presentation ATTRIBUTE loses to any stylesheet rule, and
  `.pin text{font-size:9.5px}` is one — so the per-pin shrink for long names did nothing
  at all. Sizing is an inline style now, floored at 7.5px, with `fitSvgTexts()` measuring
  after insertion: shrink, then abbreviate ("PD7/PA4" -> "PD7+"), then ellipsise, full
  text always in the `<title>`.

### Colour rule worth keeping
The pin fills are CubeMX's and do NOT flip with the theme, so text drawn on them cannot
come from `--text`, which does. One `--on-pin` ink covers every pin state and the picker's
current row; `--on-badge`, `--warn-ink` and `--ok-ink` do the same for the badges and the
tree glyphs. The badge colours themselves are unchanged wherever they are a fill. The
worst single find was `.chipbar label.flt{color:#333}` — 1.24:1 in the dark theme, i.e.
"Only modified" was effectively invisible.

### Method, reusable
`scratchpad/probe.sh <scenario.js> [w,h]` appends a scenario to `dist/index.html` and runs
it under headless Edge with `--dump-dom`, so a scenario gets real layout, real
`getComputedTextLength()` and real computed colours. The legibility sweep measures four
things at once: text clipped by a container, SVG text outside its pin box, overlapping or
off-canvas labels and anything under 7.5px, and every text/background pair against 4.5:1.
Handed to AGENT-4 as the basis for `tests/legibility.test.js` if they want it.

### Next
1. DMA Settings tab + DMA1 channel table, NVIC Settings tab + NVIC panel, built from the
   data with writes routed through the engine when the setters appear (15:10Z DECISION).
2. Re-sweep legibility once those panels exist — they are new text.
3. The two "Future" tabs, once AGENT-4 rules on the layout test.
