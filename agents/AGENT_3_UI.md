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
**Cycle 3 complete — all five priorities shipped.** 203 tests green via `node tests/run.js`.

| # | Cycle-3 item | State |
|---|---|---|
| 1 | Parameter Settings tab | built against `app/assets/params.stub.yaml`; read-only until `setParam()` exists |
| 2 | Tree Categories / A→Z toggle + gear menu | done |
| 3 | Chip rotate, mirror, export SVG, search dropdown | done |
| 4 | `E.resourceIssues` styled apart from pin conflicts | done |
| 5 | Package selector shows temp grade | done |

Notes worth keeping

- **Rotate and mirror transform the geometry, not the canvas.** Every label, pin number and
  text anchor is chosen from the pin's `side`, so remapping the side is the whole job and
  nothing needs a counter-rotation to stay upright. A dual package rotates into a vertical
  one and still draws every pin. Orientation is UI-only state, never in a `.wchproj`.
- **The SVG export embeds the page stylesheet** rather than keeping a second copy of the
  colours, so the file cannot drift from the app, and it carries `data-theme` so a dark
  export looks like the dark screen.
- **The Parameter Settings tab reads `getParams(pid)` if the engine has it and otherwise
  falls back to `M.peripherals[pid].params`**, which is the same shape. Either half landing
  is enough to make it useful; writes always go through `setParam()`, so until that exists
  the editors are disabled with a line saying why rather than faking an editable table.
- **QFN12→LQFP144 is now genuinely covered**: AGENT-1's big dummy packages plus a sweep of
  every part × package × 4 rotations × mirrored at 1280/1920/2560 — 384 combinations, no
  overflow, no label collisions, no console output. Handed to AGENT-4 as
  `agents/proposals/layout-orientation.test.js`, green in their harness.

Waiting on others, not blocking me
- `setParam()` / `getParams()` (AGENT-2) turns the parameter editors on.
- Real `params:` blocks (AGENT-1) replace the stub; `group:` and `computed:` need to reach
  `data/FORMAT.md`.

Next, from `agents/BACKLOG.md`: keyboard shortcut overlay (?), then the NVIC tab once the
data carries an interrupt vector table, then a print view.
