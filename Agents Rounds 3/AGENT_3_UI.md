# AGENT-3 — UI, round 3.

Owns `app/template.html` sections 4–7 (CSS, markup, render code) and `app/assets/*`.
Must not edit `data/`, engine logic, `tests/`, `src-tauri/`, `data/firmware/`.

Round 3 gives you the round's visible feature — **the code generation UI** — and finishes three
things from round 2 that are still open and still in front of a user.

## P0 — carry-over. These come first, before anything new.

1. **The 8 text-legibility findings**, all measured by AGENT-4 in a real browser with bounding
   boxes, `scrollWidth` vs `clientWidth`, and WCAG contrast against the real composited background,
   at 1280×720 and 1920×1080, zoom 100 % and 125 %. Screenshots per finding in
   `tests/evidence/round2/2026-09-11.md`:
   - **L1** the brand block top-left clips its third line "clocks" at every size; at 125 %
     "Open MCU file…" wraps to three lines and clips too.
   - **L2** the clock tree is 1282 px wide, so at 1280 the ADC prescaler / Flash time base / Core
     SysTick column is cut off at the viewport edge with the ADC select sliced through; at 125 %
     (1024 CSS px) the whole right half is off-screen.
   - **L3** at 125 % the clock `.cnote` paragraph runs past the right edge mid-sentence — it wraps
     to the tree width, not the panel width.
   - **L4** the GPIO Pull-up/Pull-down select shows "No pu", truncated inside the control.
   - **L5** the pin-search placeholder reads "find pin or sigr".
   - **L6** the package selector cuts the temp grade: "CH32V006F8P7 105".
   - **L7** SVG signal labels `SYS_RST` / `SYS_SWIO` measure **1.23:1** against what is behind them,
     and pin names in coloured boxes **2.78:1**, against 4.5:1 for AA. This is literally the human's
     original "text not correctly visible".
   - **L8** the CH32V006 and TSSOP20 die labels overlap slightly.
2. **Two selectors that lie about state.** `#mcusel` reads CH32V005 at boot while CH32V006 is what
   is loaded — it is never synced to `M.mcu.name`, and has no label saying whether it means "current
   part" or "load another". `projectApply()` with a different package leaves `#pkgsel` showing the
   old one. WALKTHROUGH §6.2 cannot pass until both resync on project load.
3. **DMA Settings tab** — round-2 item 5b, never built. `app/template.html` contains no "DMA
   Settings" string today. CubeMX layout: a table of requests (Request, Channel, Direction,
   Priority) with Add / Delete; selecting a row opens its details below (Mode normal/circular,
   increment peripheral/memory, data width peripheral/memory). The channel select lists only
   channels legal for that request; a double-booked channel is outlined red **with the owner named**.
   Plus the **DMA1** panel in System Core: channels 1–7 → request → owner → direction, click-through
   to the owning peripheral.
   AGENT-1 built `dma.channel_params` deliberately in the **same schema as `peripherals.*.params`**
   — key/name/type/default/options{name,value}, same `group: Basic|Advanced` — so render it with
   your existing Parameter Settings editors rather than writing new ones.
4. **NVIC Settings tab** — round-2 item 5c, never built. Per peripheral: Interrupt, Enabled,
   Preemption priority, Sub priority. Plus the **NVIC** panel in System Core listing every enabled
   vector and the priority-group selector.
   **Do not build this from CubeMX muscle memory.** The PFIC implements **two** priority bits, not
   four: `PFIC_IPRIORx` [5:0] are "reserved, fixed to 0, write invalid" (RM 6.5.2.21), and max
   nesting depth is 2. With nesting on, bit 7 is preemption and bit 6 is sub-priority, so both
   ranges are 0–1; with nesting off it is a flat 0–3 and nothing preempts. `nvic.scheme.groups`
   carries both. A spinner offering 0–15 fails AGENT-1's validator before it ships — take the
   ranges from the data.
   Tab order in the centre panel, exactly like CubeMX: **Parameter Settings · NVIC Settings · DMA
   Settings · GPIO Settings**. Tabs a peripheral cannot use are **hidden, not disabled**.

## P1 — the code generation UI  ← the round's feature

The tab bar has two `disabled` placeholder tabs today:

```html
<button class="tab" disabled title="Future">Project Manager</button>
<button class="tab" disabled title="Future">Tools</button>
```

They are dead controls — which round 2 forbade — and the Project Manager one is exactly where this
belongs. Build it. AGENT-2 owns everything behind the glass; agree the data shape on the board
before either of you writes a line (they are shaping `generateAll()` to return
`{ name, language, text }` per file for this).

5. **Project Manager tab.** Four sections, top to bottom:
   - **Project** — name, MCU, part number, package. Read-only, from the project; the name is the
     one editable field. This is also where the breadcrumb's truth lives, so it must never disagree
     with `#mcusel` / `#pkgsel` (see P0 item 2).
   - **Toolchain / IDE** — `PlatformIO` is the only real option. Show the environment it maps to
     (`CH32V006F8P6`, `CH32V006K8U6`, `CH32V005F6P6`) and the output folder, defaulting to
     `data/firmware/lib/wchcube_generated/`. **Do not list greyed toolchains we do not support** —
     say in one line that others are not supported. Round-2 rule, still in force.
   - **Code generator** — the options AGENT-2 lands in `S.project`: one file or a pair per
     peripheral; keep user code sections on regeneration; also emit the pin table and clock summary.
     An option the engine cannot honour yet is **not shown**.
   - **Generate** — browser: downloads. Desktop (Tauri): native folder picker, writes the header to
     `include/` and the source to `src/`. AGENT-4 owns the Tauri command; request it on the board.
6. **The preview is the point.** A file list on the left (`wchcube_init.h`, `wchcube_init.c`,
   `pins.md`, `clocks.md`) and the selected file's actual text on the right: read-only, monospace,
   line-numbered, horizontally scrollable, with a copy button. Nothing clever — no editor, no
   syntax highlighting worth the bytes — but **every character the user is about to take, visible
   before they take it.** Two of round 3's P0 bugs were single wrong identifiers in generated C;
   this is the panel that would have shown them to a human.
   Make `#error` and TODO lines visually obvious — the generator emits them deliberately when the
   MCU data cannot support a section, and they must not scroll past unnoticed.
7. **`Tools` tab: implement it or remove it.** There is no plan for it. Removing a dead tab is a
   perfectly good round-3 commit.

## P2 — stop offering choices the silicon does not have

8. **The GPIO speed control.** CH32V006 has exactly **one** output speed. `GPIOx_CFGLR.MODEy` is a
   single bit (RM §7.3.1.1: *"1: Output mode, maximum speed 30MHz; 0: Input mode"*) and the SDK enum
   has one member. CH32X035 likewise has one. The GPIO table's Low/Medium/High select is offering a
   choice that does not exist.
   AGENT-1 is landing a capability list in the data; a **one-entry list means the control is not
   shown** — show the fixed value as text instead. Take it from the data, never hardcode a part
   name.
9. **Finish the dead-control audit** you started in round 2. Anything `disabled`, hidden or a no-op
   must be justified by the MCU data saying the option is absent on this part — never by UI state.
   AGENT-4's sweep found `#m-open` and `#m-openproj` open an OS file chooser headless Chrome cannot
   answer; those two need a human or a stub, everything else on the menu bar responded. Post what is
   left on the board.

## Rules
- **A UI change is not done until it has been exercised in a real browser** at 1280 and 1920 wide on
  CH32V006 (TSSOP20 and QFN32) and the dummy part (LQFP48), light and dark, 100 % and 125 %. Say so
  in the commit message. jsdom passing is necessary, not sufficient — it did not catch the clock bug
  and it cannot measure text.
- **Greying is a display of non-feeding branches, never an interaction block.**
- Build against `app/assets/*.stub.yaml` if real data is late, and say on the board that you did.

---

## Current — round 3, cycle 1

**Done this cycle**

- **C1 — all eight legibility findings (L1–L8).** Measured in a real browser before and
  after, 216 checks over CH32V006 TSSOP20 + QFN32 and WCH-DUMMY32-C8 LQFP48 × 1280x720 and
  1920x1080 × zoom 100 % and 125 % × light and dark. All green, console silent.
  Numbers per finding are on the board and in the commit message.
- **C6 — `#mcusel` and `#pkgsel`.** Both re-read from the model on every render, so no
  code path can leave either disagreeing with `M`/`S`. `#mcusel` is labelled "Load part:".
- A resize handler, which the app did not have: the chip re-fits and the clock tree
  re-lays out when the window changes size. Without it a layout measured as fitting at
  one viewport silently reproduced L2 at another.

**Next, in order**

1. **C3 — NVIC Settings tab** and the NVIC overview in System Core. Ranges come from
   `nvic.scheme.groups` (PFIC has two priority bits, not four).
2. **C2 — DMA Settings tab** and the DMA1 channel table in System Core, rendered with the
   existing Parameter Settings editors (`dma.channel_params` is in the `params:` schema).
3. **P1 — the Project Manager tab**, then the preview panel, then `Tools`.
4. **P2 item 8 — the GPIO speed control**, as soon as AGENT-1's capability key lands.

**Open decisions of mine on the board**

- The package selector displays `PKG · N I/O`; part numbers and temperature grades moved
  to `title=`, the New Project dialog and (next) Project Manager.
- The GPIO table scrolls sideways rather than truncating a value. The 88 px speed column
  comes out of that width the moment the GPIO-speed capability key lands.
