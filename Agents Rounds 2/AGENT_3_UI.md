# AGENT-3 — UI, round 2. Owns template.html sections 4–7, CSS, markup, app/assets/*.

## P0 — clock source selection bug (human-reported, blocks the round)
The user cannot pick HSI vs HSE on the Clock Configuration tab. Your half:
1. The SYSCLK mux, PLL-source mux, every prescaler and the HSE frequency input are **always enabled** and
   always list the full option set from `clockCalc().selectable` (AGENT-2 provides it). Never grey or disable
   an option because RCC HSE is off, because a branch is "not feeding", or because of any UI state.
   Greying is a *display* of non-feeding branches only (dashed + dimmed), never an *interaction* block.
2. When the user selects HSE and the engine auto-enables RCC HSE, show a toast: "HSE enabled in RCC — PA1/PA2
   now RCC_XI/RCC_XO" and repaint the chip. If that creates a conflict, the normal orange path handles it.
3. Verify in a REAL browser (Edge/Chrome) on both MCUs, all of WALKTHROUGH §4, before posting DONE. Include
   "verified in browser" in the commit message. jsdom passing is not enough for this one — the bug was not
   caught by jsdom in round 1.
4. Then audit every other control in the app for the same disease: anything `disabled`, hidden, or a no-op
   must be justified by the MCU data, not by state. List what you found on the board.

## P0b — text legibility (human-reported: "some text is not correctly visible, a bit cut off")
Go through the app with a real browser and fix every place text is clipped, overflowing, overlapping or
hard to read. Known-risky spots and what to do:
- **Pin boxes**: long names (shorted pairs "PD7/PA4", "PA1/PA6", names like "PC13") shrink below legibility
  or overflow the box. Fix: minimum font size 7.5 px; if the name still doesn't fit, show the primary name
  and draw the alias on a second line or as "PD7+", with the full pair in the tooltip and picker. Never let
  the text run outside the rectangle.
- **Signal labels around the chip**: rotated top/bottom labels must not overlap neighbours or run off the
  canvas; long "SIGNAL · user_label" strings need an ellipsis with a full-text `<title>`. fitChip() must
  include the label bounding box so nothing is cut at the edge after "Fit".
- **Pin numbers**: must not sit under the label or the box.
- **Tree items**: long peripheral names + status icon + badge must not wrap or push the badge out of view.
- **GPIO table**: columns wrap or ellipsis with tooltip; header text never clipped; horizontal scroll only
  as a last resort.
- **Clock tree boxes**: box width fits its longest line; values like "0.375 MHz ADC" fit; the limit text
  ("min 16, max 48 MHz") is complete.
- **Centre panel Mode grid**: long choice names in selects must not be cut; conflict banner wraps.
- **Toast / picker / dialog**: long messages wrap, never overflow the viewport; picker max-height scrolls.
- **Contrast**: every text/background pair ≥ 4.5:1 in both themes (you measured 25 elements in round 1 —
  extend that to ALL text, including SVG text inside pins and clock boxes and the pad label).
- **Windows 125 % scaling**: check at browser zoom 125 %; fixed pixel heights that clip at 125 % become
  min-heights.
Deliver: a list on the board of every spot fixed, and "verified in browser at 100 %/125 %, light/dark" in the
commit message. AGENT-4 audits independently with screenshots.

## P1
5. Parameter Settings tab: grouped table (Basic / Advanced), editors by type (number with unit, select for
   enum, checkbox for bool), read-only derived rows ("Actual baud rate 115207 (0.006 %)"), invalid values
   outlined red with the reason. Binds to `getParams/setParam/derivedParams`. Build against
   `app/assets/params.stub.yaml` if real data is late.
5b. **DMA Settings tab** on every DMA-capable peripheral (CubeMX layout): table of requests (Request,
    Channel, Direction, Priority) with Add / Delete buttons; selecting a row shows its details below (Mode
    normal/circular, increment address peripheral/memory, data width peripheral/memory). Channel select
    lists only channels legal for that request; a double-booked channel is outlined red with the owner named.
    Plus the **DMA1** panel in System Core: the channel table (1–7 → request → owner → direction) with a
    click-through to the owning peripheral.
5c. **NVIC Settings tab** on every peripheral with vectors: table (Interrupt, Enabled checkbox, Preemption
    priority, Sub priority); and the **NVIC** panel in System Core listing every enabled vector plus the
    priority-group selector. Tabs order in the centre panel: Parameter Settings · NVIC Settings · DMA
    Settings · GPIO Settings, exactly like CubeMX; tabs a peripheral cannot use are hidden, not disabled.
5d. Peripherals without a single configurable thing must not exist in the tree (talk to AGENT-1); everything
    listed must open a panel with real controls.
6. Tree: Categories / A→Z toggle, expand/collapse all, "enabled only" filter (matches the reference screenshot).
7. Chip toolbar parity with the reference: rotate, flip, export SVG, search-results dropdown.
8. `E.resourceIssues` (EXTI/DMA) rendered distinctly from pin conflicts.

## Rule
A UI change is not done until it has been exercised in a real browser at 1280 and 1920 wide on CH32V006
(TSSOP20 and QFN32) and the dummy part (LQFP48). Say so in the commit message.
