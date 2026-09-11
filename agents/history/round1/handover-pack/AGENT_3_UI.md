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
All seven brief priorities are shipped and both "when idle" items are done.

| # | Item | State |
|---|---|---|
| 1 | Conflict visibility (pulse, tree/category badges, click-through banner) | done |
| 2 | Right-click user label (context menu + inline editor, chip + table + export) | done |
| 3 | "Only modified" filter, arrow-key navigation, Enter/L/Del | done |
| 4 | Clock tab as a real tree (boxes + SVG connectors, greying, red out-of-spec) | done |
| 5 | Layout hardening QFN12..LQFP144, 961..2560 px | done (144-pin proven with an in-memory part; data still needed for the committed audit) |
| 6 | System view (bus spines, status blocks, click to configure) | done |
| 7 | Package selector with I/O count and part numbers | done |
| idle | Accessibility: names, tooltips, focus, keyboard reach, live regions, AA contrast | done |
| idle | Dark theme, off by default, remembered per browser | done |

Also, outside the original list: adopted the engine's E.conflictList / E.issueCount /
previewAssign(); routed the centre panel and clock tab through setSetting / toggleSetting /
setRemap / setClock so undo covers them; added Undo/Redo buttons; un-disabled GENERATE CODE;
fixed clock edits not marking the project dirty.

Open, not mine to close: the DONE.md line "no layout overflow from QFN12 to LQFP144" needs a
package table above 48 pins on WCH-DUMMY32-C8 (AGENT-1; fragment handed over on the board).

Next cycle: answer board requests, then polish - pin-search result styling and count, and a
"Parameter Settings" tab that shows something once real per-peripheral parameters exist.
