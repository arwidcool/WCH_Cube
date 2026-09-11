# AGENT-3 — UI, round 4.

Owns `app/template.html` sections 4–7 (CSS, markup, render code) and `app/assets/*`.
Must not edit `data/`, engine logic, `tests/`, `src-tauri/`, `data/firmware/`.

You built the Project Manager tab in round 3. Round 4 gives it the button that makes it worth
having — **Generate PlatformIO project** — and puts the whole UI in front of a part that is not
shaped like CH32V006.

## P0 — carried over from round 3
1. **D4** `Tools` tab: implement it or remove it. It is still a `disabled` placeholder, which is
   still a dead control. Removing it is a perfectly good commit.

## P0b — a part that is not shaped like the one you built against

CH32X035 is arriving from AGENT-1. Every line below is a confirmed difference, and each is a place
where the UI either reads the MCU file or has a CH32V006 assumption in it. **Finding out which is
the work** — none of this is hypothetical.

2. **The clock tab on a part with no HSE.** `grep -c HSE ch32x035_rcc.h` → **0**. This part has one
   48 MHz RC oscillator and SYSCLK dividers, and nothing else.
   Round 2's P0 was *"the SYSCLK mux and the PLL-source mux are ALWAYS selectable between HSI / HSE /
   PLLCLK"*. **That was a statement about not letting UI state disable a control — it was never a
   statement that every part has an HSE.** On CH32X035 there must be:
   - no HSE box in the clock tree,
   - no HSE entry in the SYSCLK or PLL-source mux,
   - no "High Speed Clock (HSE)" row in RCC,
   - no greyed placeholder standing where it would have been,
   - no console output, and no gap in the layout where a box used to be.
   And on CH32V006, everything exactly as it is today. Take the source list from
   `clockCalc().selectable`; if anything in the render names HSE unconditionally, that is the bug
   this part exists to find.
3. **24-bit ports and a port with two holes.** Pin names go up to `PC19`, ports are
   `GPIO_Pin_0..23`, and PC reads as **PC0–PC7, PC10–PC11, PC14–PC19** — the DS never names PC8,
   PC9, PC12 or PC13 (AGENT-1 is confirming the exact set). Anything that renders a port by
   counting 0..N will draw pins that do not exist. Check the GPIO table, the tree, the pin picker and
   the chip labels.
4. **Seven packages, including LQFP64.** `tests/layout.test.js` already covers QFN12 → LQFP144 on
   the dummy part, but CH32X035 is a *real* part at LQFP64 with 60 I/O and long signal names
   (`USBPD_CC1`, `USART4_CTS`, `TIM2_CH3N`). The legibility work you did in round 3 gets its first
   real stress here: pin-box text, rotated top/bottom labels, the package selector, the GPIO table.
5. **More peripherals, and four kinds this app has never shown**: USBFS (host *and* device), USBPD
   (Type-C source/sink/DRP), PIOC, AWU, plus four USARTs, 2×OPA and 3×CMP. Categories matter — a
   tree with twenty-odd peripherals under the wrong headings is worse than one with twelve. Take the
   category from the MCU file; if the data needs a new category, ask AGENT-1 rather than mapping it
   in the UI.
6. **DMA: 8 channels.** The DMA1 panel in System Core is a channel table — it must size itself from
   `dma.requests`, not from a 7 you typed once.
7. **NVIC: 47 vectors, and the EXTI ones are grouped.** `EXTI7_0`, `EXTI15_8`, `EXTI25_16` cover 26
   EXTI lines between them. The NVIC tab lists **three rows, not twenty-six**. AGENT-1 is landing the
   shape that expresses that; read it from the data.
8. **`grep -ri "x035" app/template.html` must be empty when you are done.** Round-4 DONE line.

## P1 — the button: Generate PlatformIO project

The Project Manager tab currently offers generator options and a preview. Round 4 adds the thing a
user actually wants: **a folder they can open in VS Code and flash.**

9. **The control.** In the Toolchain / IDE section, next to Generate:
   - **Output** — project name (defaults to the `.wchproj` name) and the destination.
   - **What you get** — list the files before they exist: `platformio.ini`, `src/main.c`,
     `lib/wchcube_generated/…`, `README.md`. The preview panel shows every one of them, `main.c` and
     `platformio.ini` included, not just the init pair. AGENT-2's `generateAll()` returns them all
     with a path each (D1); render whatever it returns rather than a list you hardcode.
   - **Generate project** — desktop: native folder picker, then written (AGENT-4's Tauri command,
     D5). Browser: a single `.zip` download.
10. **Refuse clearly when you must.** A variant with no `pio_board` cannot produce a project —
    CH32V006F4U6 and D8U7 are in that position deliberately, because the platform ships no board for
    them and the nearest one lies about the flash size. Show *"no PlatformIO board for this part
    number"* with the variants that can be generated, and disable the button **with that reason
    visible**. This is the one kind of disabled control round 2 always allowed: justified by the MCU
    data, and saying so.
11. **Tell the user what `main.c` will do, before they generate it.** One line, driven by the
    configuration:
    - *"Blinks PA1 (STATUS_LED) and prints over the WCH-Link debug channel"*, or
    - *"Prints over the WCH-Link debug channel. No output GPIO is configured, so nothing will
      blink — assign one in Pinout & Configuration to get a visible result."*
    The second sentence is the honest one and it is the one that teaches. Do not offer a "blink LED"
    checkbox that picks a pin for them.
12. **Say where it went.** After a desktop generate, show the path and the two commands that follow
    it (`pio run`, `pio run -t upload`) in copyable text. The round is only done when a user gets
    from the app to a running chip without guessing a step.

## Rules
- **A UI change is not done until it has been exercised in a real browser** at 1280 and 1920 wide,
  light and dark, 100 % and 125 % — now on **CH32V006 (TSSOP20, QFN32), CH32X035 (QFN28 and LQFP64)
  and the dummy part (LQFP48)**. Say so in the commit message.
- **A second part is a regression test for the first.** Nothing you do for X035 may change what
  CH32V006 renders. Check both before you commit.
- **Greying is justified by the MCU data or it does not exist.** A missing HSE is data. A `disabled`
  Generate button with a visible reason is data. Everything else is the bug.

---

## Current — round 4, cycle 1

**Done this cycle**

- **D4 — `Tools`.** Implemented, not removed, and the reasoning is on the board: removing
  it needed an edit to `tests/layout.test.js` (AGENT-4's, unanswered two cycles),
  implementing it cost no cross-area edit. It is a **report** over the loaded MCU file —
  nothing on it changes a configuration — and its last panel names what the file does not
  say. **The app now has exactly one `disabled` control, `#m-redo`, and it is justified.**
- **P0b item 2, and it found a real bug rather than the expected one.** Reshaped a loaded
  model to CH32X035's shape before that YAML exists. "No HSE" was already correct. But a
  part whose oscillator is named anything other than HSI/HSE/LSI/LSE **had no box drawn at
  all** — the loop WAS that four-name list — while the SYSCLK mux still offered it. Fixed;
  it iterates `clock.sources` now.
- **The generator options render from `generatorOptions()`** (AGENT-2's D2 handoff), so an
  option this build cannot honour cannot be offered and one it gains appears with no UI
  change.
- **P0b item 4 cleared in advance.** The dummy part already has an LQFP64, so I assigned
  all 64 I/O pins X035-length labels and measured: widest drawn label
  `GPIO_Output · USBPD_CC1`, 23 characters, and **0 outside the canvas, 0 overlaps, 0
  pin-box spill, 0 clipped cells in a 64-row GPIO table**, at all four size/zoom/theme
  combinations. LQFP64 should not be a surprise when the real part lands.
- **P1, my half of Generate PlatformIO project**: Board and Environment read from
  `variants[*].pio_board` / `pio_env`; the refusal path proven on CH32V006F4U6 with the
  generatable parts listed; "what `main.c` will do" driven by the configuration; a
  **ZIP writer verified by Python's `zipfile.testzip()`**, not by agreeing with itself.

**Blocked**

1. **`projectFiles()` from AGENT-2** — the TEXT of `platformio.ini`, `src/main.c`,
   `README.md`, `.gitignore`. Requested 16:53Z with the exact shape (AGENT-4's
   `write_project` shape, so there is only one). The button appears by itself when it
   lands; until then it is **absent rather than present and broken**.
2. **CH32X035.yaml from AGENT-1** — items 3–8 below cannot be verified on the real part
   until it exists. What I could test by reshaping a model, I have.

**Next, in order**

1. Whichever of the two blockers lands first.
2. P0b items 3, 5, 6, 7 on the real part: the PC hole in the table/tree/picker, 20-odd
   peripherals under their categories, 8 DMA channels, 47 vectors with the three grouped
   EXTI rows. Item 4 (LQFP64, long names) is already measured clean.
3. Re-run the dead-control sweep and the 216-check legibility sweep with X035 in the grid.

**Decisions of mine on the board, still in force**

- The package selector displays `PKG · N I/O`; part numbers live in `title=`, New Project
  and Project Manager.
- The GPIO table scrolls sideways rather than truncating a value.
- Generator options the engine cannot honour are not shown at all, not shown greyed.
- Do not test for an engine export through `globalThis`: `export const` names are not
  properties of it, and the check fails silently.
- The clock tree draws the MCU file's own oscillators, not a fixed list of four names.
