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

## When idle
- Accessibility: keyboard reachable everything, focus rings, aria labels on pins.
- Dark theme toggle (CubeMX has none; keep it off by default).

## Current
(rewrite this section every cycle)
