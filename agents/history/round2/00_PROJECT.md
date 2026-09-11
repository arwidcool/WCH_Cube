# WCH_CubeMX — Round 2: "fully functional, polished"

Round 1 built the machinery (engine, data, tests, tree, exports, codegen). Round 2 has ONE goal:
**every feature a user can click must work correctly, end to end, on a real browser, with no surprises.**
Feature count is frozen except where listed below. Polish, correctness and CubeMX-likeness win over new scope.

Read this file, then your own `AGENT_n_*.md`, then `../agents/BOARD.md` (round-1 history and decisions still
apply), then `../TASKS.md`. `../agents/README.md` rules (ownership, work cycle, shared tree, "idle is not a
stop", 2-cycle request deadline, HUMAN_TODO) remain in force. This folder only adds round-2 priorities.

## Project layout (as of end of round 1)
```
WCH_CubeMX/
├── app/
│   ├── template.html        UI: CSS + markup + render code (AGENT-3). Sections 4–7 UI, 8 glue.
│   ├── engine/*.js          11 ESM modules, zero DOM (AGENT-2): model, engine, clock, resources,
│   │                        project, history, export, codegen, inherit, util, index
│   ├── tests/*.test.js      engine unit tests (AGENT-2)
│   ├── vendor/js-yaml.js    vendored parser, inlined by build.py
│   └── assets/              UI assets, param stubs (AGENT-3)
├── data/
│   ├── mcus/*.yaml          CH32V006, WCH-DUMMY32-C8 (+ CH32V005 via inherits when done)  (AGENT-1)
│   ├── mcus/*.notes.md      extraction provenance per part
│   ├── packages/packages.yaml
│   ├── sources/             DS + RM markdown
│   └── FORMAT.md            YAML schema — the contract between DATA and ENGINE
├── tools/                   extract_remaps.py, validate_mcu.py, (wchcube_cli.js)   (AGENT-1 / AGENT-2)
├── tests/                   runner, smoke, layout, features, desktop, build tests  (AGENT-4)
├── src-tauri/               Tauri 2 shell (AGENT-4) — never compiled yet (no cargo here)
├── .github/workflows/ci.yml never run yet (no remote)
├── build.py                 python build.py → dist/index.html (single file, offline)
├── dist/index.html          GENERATED. Never hand-edit.
├── agents/                  round-1 pack + BOARD.md (still the message board)
└── agents_round2/           THIS folder
```
Run: `python build.py && node tests/run.js`. Windows box, `python` not `python3`, shared tree, direct
commits to `main`, no remote (see agents/README.md "Environment facts").

## Known broken / suspect (reported by the human — treat as P0 bugs)
1. **Clock Configuration: cannot choose HSI vs HSE as the system clock source.** Expected behaviour
   (CubeMX): the SYSCLK mux and the PLL-source mux are ALWAYS selectable between HSI / HSE / PLLCLK. Selecting
   HSE anywhere auto-enables RCC "High Speed Clock (HSE)" = Crystal/Ceramic Resonator, which claims XI/XO
   (PA1/PA2 on V006) and runs through the normal conflict engine. Selecting away from HSE leaves RCC's HSE
   setting as the user set it. If HSE is disabled in RCC and the user picks it in the mux, enable it — do not
   grey the option. Greyed branches are for sources not *feeding* SYSCLK, never for sources the user is not
   *allowed* to pick.
2. **Text is partly invisible / cut off / overlapping in places** (human-reported). Every piece of text in
   the app must be fully readable: nothing clipped by a container, nothing overflowing its box, nothing
   overlapping another label, nothing in a colour too close to its background (in light AND dark theme),
   nothing truncated without a tooltip carrying the full text. This includes: pin names inside pin boxes
   (esp. shorted names like "PD7/PA4"), signal labels around the chip, rotated top/bottom labels, tree items
   with long names, the GPIO table columns, the clock-tree boxes, toasts, the conflict banner, the picker,
   the New Project dialog rows, and the system view. AGENT-3 fixes, AGENT-4 audits with real screenshots at
   1280×720 and 1920×1080, and at browser zoom 100 % and 125 % (Windows default scaling).
3. **DMA has no configuration** (human-reported), and more generally: **every MCU must be FULLY FEATURED.**
   Every peripheral the reference manual describes must be configurable in the software the way CubeMX does
   it — Mode, Parameter Settings, DMA Settings, NVIC Settings, GPIO Settings — and end up in the generated
   code. No placeholder peripherals, no "Activated" checkboxes that do nothing. The completeness contract:

   | Tab | What it must offer, per peripheral |
   |---|---|
   | Mode | every mode/remap the RM allows (done for pins) |
   | Parameter Settings | every init-struct field of the WCH EVT SDK for that peripheral, with RM limits |
   | DMA Settings | add/remove a DMA request for each DMA-capable signal (USARTx_TX/RX, SPI1_TX/RX, I2C1_TX/RX, ADC1, TIMx_CHy/UP/TRIG/COM): channel (from `dma.requests`), direction, priority, mode normal/circular, increment memory/peripheral, data width peripheral/memory; channel double-booking is a conflict |
   | NVIC Settings | each interrupt vector the peripheral owns (from a new `nvic:` block): enable, preemption priority, sub-priority per the PFIC scheme of that core |
   | GPIO Settings | mode/pull/speed/label per pin (done) |
   Plus: a **DMA1** entry in System Core showing the channel table (which request on which channel, who
   owns it), and an **NVIC** entry in System Core showing every enabled vector with priorities.
   Data → engine → UI → .wchproj → undo → codegen, for every row of that table, for CH32V006 first and every
   later part by construction (the format carries it, the UI is generic).
4. Assume the same class of bug elsewhere: any control that is disabled/greyed/no-op must be justified by the
   MCU data (option missing on this part) — never by UI state. AGENT-4 audits every control (see AGENT_4).

## Round-2 definition of done (added to ../agents/DONE.md by AGENT-4 as a "Round 2" section)
- [ ] Clock tab: every mux and prescaler selectable; HSE selection auto-enables RCC HSE and claims XI/XO;
      values correct for every MCU; red on out-of-spec; PLL greyed only when not feeding SYSCLK; MCO output
      selectable; HSE frequency editable within DS limits; tested in `app/tests/clock.test.js` + UI test.
- [ ] Manual walkthrough script `agents_round2/WALKTHROUGH.md` executed by AGENT-4 in a REAL browser
      (not jsdom) on Windows for every MCU × package: every step passes, evidence = screenshots in
      `tests/evidence/round2/`.
- [ ] Text legibility audit passed: no clipped, overflowing, overlapping, or low-contrast text anywhere,
      light and dark theme, 100 % and 125 % zoom, every MCU × package; evidence screenshots in tests/evidence/round2/.
- [ ] Zero dead controls: every button/select/checkbox/menu item does something or is removed.
- [ ] DMA Settings tab on every DMA-capable peripheral + DMA1 channel table in System Core; double-booked
      channel = conflict; DMA config in .wchproj, undo and generated C (`DMA_InitTypeDef` per request).
- [ ] NVIC Settings tab on every peripheral with vectors + NVIC overview; priorities in .wchproj and C.
- [ ] Completeness matrix (AGENT-4 `tests/completeness.test.js`): for every peripheral in CH32V006.yaml —
      settings present, params present, DMA requests present if the RM lists any, NVIC vectors present,
      codegen emits an init block. Any missing cell is a failure that names the peripheral and the cell.
- [ ] Parameter Settings tab functional for USART/SPI/I2C/TIM/ADC on CH32V006 (params in data, engine, UI,
      .wchproj, undo, codegen).
- [ ] Generated C for CH32V006 has no TODO sections (codegen block + analog_signals present).
- [ ] New Project → configure → Save → close → Open restores everything, including clock and params.
- [ ] CH32V005 selectable in New Project.
- [ ] Dummy part covers LQFP64/100/144; layout audit passes at 1280 and 1920.
- [ ] Every DONE.md line not marked human-blocked is ticked.

## Round-2 rules (additions)
- **"Feature freeze" means no *new kinds* of feature. Completing every peripheral (params, DMA, NVIC) is not
  new scope — it is the product.** The completeness table above is the checklist.
- **Real-browser verification is mandatory** for UI changes: after `python build.py`, open
  `dist/index.html` in Edge/Chrome, exercise the change, and write "verified in browser" in the commit
  message. jsdom tests are necessary, not sufficient.
- **Bug first, then feature.** A P0 from the human or a QA-FAIL beats anything in the priority lists.
- **No new tabs, panels or features** beyond those named in this folder until the round-2 DONE section is green.
- If you touch a control, you own confirming it works on every MCU × package in the repo.
