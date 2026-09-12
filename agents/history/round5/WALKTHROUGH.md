# WALKTHROUGH — round 5 acceptance

Run this end to end before `DECISION | ROUND 5 DONE`. It is written to be runnable by someone who
did not write any of it. Every step says what to do, what you should see, and what a failure means.

The app's acceptance script from rounds 2–4 still applies — configure a part, switch packages,
check the tree, the clock tab, the export. It is archived in `history/`. This file covers what
round 5 adds and what it must not break.

Prerequisites: `python build.py` has been run. `pio` is installed. A real browser is available.

---

## §1 — the constraint mechanism, on the part that has constraints

1. Open `dist/index.html`. Load **CH32X035** and select the **QFN28** package.
2. In **Pinout & Configuration**, pick a pin **inside** the pull-down allow-list — PA3, say — and
   set it to an input. **Expected:** the **Pull-down** option is offered.
3. Pick a pin **outside** it. On QFN28, `PC0`–`PC7` and `PC10`–`PC11` are outside (the allow-list
   is PA0–PA15 and PC16–PC17). **Expected:** Pull-down is **not offered** — absent from the
   control, not greyed, and the reason is available.
   *A failure here in the "offered anyway" direction is the round's whole point. A failure in the
   "not offered anywhere" direction is a worse bug: a mechanism that hides the control everywhere
   passes a one-sided check, which is why step 2 exists.*
4. Configure a **shorted pair** as an output. **Expected:** refused, and the message names the
   reason (the datasheet prohibits output functions on shorted pins). Find a shorted pair from
   the pin tooltip — it shows both names, e.g. `PC17/PC10`.
5. Switch to **USBFS** and enable it as a device. Then go back to the GPIO table and try to drive
   **PC10** or **PC11**. **Expected:** refused while USBFS is on; allowed again when it is
   switched off. This is the conditional case and it is the one most likely to be missing.
6. Console must be **silent** through all of the above. Open the browser console and confirm.

## §2 — the mechanism does not touch parts that have no constraints

7. Load **CH32V006** on **TSSOP20**. The GPIO table offers exactly the modes and pulls it offered
   before round 5 — read them, do not assume.
8. Load **CH32V005**. Same answer, and it is `inherits: CH32V006`, so this also proves the
   constraint block survives or is correctly absent through inheritance.
8b. Load **CH32V003** on **TSSOP20**. It declares no `constraints:` either, and it is the part that
   arrived last — so this is the check that a part added *after* the mechanism does not need one to
   behave. Its two documented differences from the V00x family are worth reading off the screen:
   the GPIO **speed** control offers **three** values (2 / 10 / 30 MHz) where the others offer one
   or show fixed text, and there is no port B.
9. `git stash`-free check: for a configuration you saved before the round, the generated C is
   **byte-identical**. The cheapest way is to generate C for a `tests/fixtures/*.wchproj` and
   confirm `tests/codegen_compile.test.js`'s "the checked-in fixtures still match what the engine
   produces" is green without regenerating them.

## §3 — a clean `--strict`

10. For **every** fixture in `tests/fixtures/`:
    ```
    node tools/wchcube_cli.js --project tests/fixtures/<fixture>.wchproj --strict
    ```
    **Expected:** exit **0**, no output about TODO or `#error`.
    At the start of the round this exits **2**. A fixture that exits 2 at the end of the round is
    an open E1/E2/params line, not a pass.
11. Confirm the generated C still **compiles** on a configuration that assigns pins:
    ```
    node tools/wchcube_cli.js --project tests/fixtures/CH32X035_QFN28_full.wchproj --new-project "$env:TEMP\R5Proj"
    cd "$env:TEMP\R5Proj"; pio run
    ```
    **Expected:** SUCCESS. *A default configuration generates an empty function and proves
    nothing — use a fixture that assigns pins.*

## §4 — the gates

13. `python build.py && node tests/run.js` → **ALL GREEN.** Read the last block: any skip is
    printed with its reason and counted. A skip you cannot explain is a failure.
14. `tasks=` no `[~]` left in `TASKS.md` that the round was supposed to close.
15. `python tools/validate_mcu.py` → exit 0, and `python tools/verify_sdk_names.py` → exit 0 with
    no part reported NOT CHECKED for a reason that no longer applies.
16. `node tools/wchcube_cli.js --list` names the **six real parts** — CH32V003, CH32V005,
    CH32V006, CH32X035, CH32L103, CH32H417. No synthetic fixture may appear;
    `tests/data.test.js` guards this. (This step said "three", then "four"; the check is that
    the list and `data/mcus/*.yaml` agree, not that the number is any particular value —
    `tests/sdk_names.test.js` asserts exactly that. If you are reading a number here that
    disagrees with the tree, the number is the bug.)
17. `grep -ri "x035\|ch32v006\|ch32v005\|x033" app/engine/ app/template.html` → comments only.

## §4b — CH32H417, the part this push is about

The claim being accepted is one sentence: *every pin the datasheet gives this part is claimable
in the app, every peripheral it names is configurable, and the C that comes out is right for the
pad it configures.* These steps are the human half of it — the machine half is
`tests/h417_packages.test.js`, `tests/h417_ltdc.test.js` and the compile gate. Do them in order;
each one is a thing you SEE, not a thing you are told.

H1. **New project → CH32H417 → QFN128.** The pin diagram draws 116 bonded pads. Zero console
    errors or warnings — open DevTools BEFORE this step, not after.
H2. **Claim a signal on each of ports A..F.** One per port, six in all; port F is the one that
    matters, because every pin regex in this repository once assumed A..D and this part goes to
    F. A workable set that needs no hunting: `USART2` Asynchronous (PA2/PA3), `USART1`
    Asynchronous (PB14/PB15), `TIM3` PWM CH1 (→ PA6, so move it to **PC6** from the pin's menu),
    `SPI1` Full-Duplex Master (PF7/PF8/PF9), then manual GPIO output on **PD0** and **PE0**.
    Every one of those must appear on the pin diagram in the same instant you pick it.
H3. **Check the pin menu on a pad you did NOT claim.** Click any unclaimed bonded pad. It must
    offer something — a peripheral signal or plain GPIO. A pad whose menu is empty is a dead
    pad, which is the defect that shipped 207 times on this part; report it rather than
    shrugging.
H4. **Parameter settings.** With `USART1` selected, the Parameter Settings panel must show real
    rows (baud, word length, parity, stop bits) and changing one must mark the project dirty.
    **Expected to be INCOMPLETE:** many of this part's peripherals still have no `params:` block
    — that is `TASKS.md` "CH32H417: `params:` for the peripherals that have none", owned by
    AGENT-1 and held in `tests/completeness.test.js`'s `IN_EXTRACTION`. An empty panel on, say,
    `DFSDM` is the recorded gap; an empty panel on `USART1` is a regression.
H5. **The clock tab.** This is the richest clock tree in the repository and the step most worth
    doing by hand. The SYSCLK mux offers HSI/HSE/PLLCLK; the PLL source mux offers **32**
    entries, which are (source, divider) PAIRS — "HSI /1" through "HSE /64" — and the
    multiplier list has **32** entries including the half steps (8.5, 9.5, 10.5 …). Pick
    `HSE /2` × `32` and watch the numbers move. Then read the HPRE list: it is
    1/2/4/8/16/**64**/128/256/512 — **there is no /32**, and a list that shows one is the
    silent bus-halving defect `data/mcus/CH32H417.notes.md` warns about.
H6. **What the clock tab does NOT offer, and must not pretend to.** Four secondary PLLs (USBHS,
    ETH, USBSS, SerDes) and the eight peripheral clock muxes of RM 3.4.13 are **absent by
    declaration**, because the schema holds one PLL and one source per tap. `sysclk.sources` is
    therefore three entries and not the seven SYSPLL_SEL allows. If you see a 48 MHz USB clock or
    an LTDC pixel clock quoted anywhere, that is a computed number with nothing behind it — a
    wrong clock number is worse than a missing one, and this step is where you catch it.
H7. **Save, reopen.** Save the project, reload the app, open it again. Every pin, every setting
    and every clock choice comes back — and the package comes back as QFN128, not as the
    default. Zero console output on load.
H8. **Generate, then build it.**
    ```
    node tools/wchcube_cli.js --project <your>.wchproj --new-project <tmp>/H417
    cd <tmp>/H417 && pio run
    ```
    `pio run` reports **SUCCESS**. Then open `lib/wchcube_generated/src/wchcube_init.c` and read
    the `GPIO_PinAFConfig` block: there is one line per claimed pad, each naming a port, a pin
    source and an AF code, and each carrying the pad and signal in its comment. No `TODO`, no
    `#error`.
H9. **The package is not cosmetic — prove it.** Repeat H1/H2 on **QFN68** with the same four
    peripheral calls, generate, and diff the `GPIO_PinAFConfig` block against H8's. It must be
    DIFFERENT: `USART1_RX` moves from `GPIOB/PinSource15/AF4` to `GPIOD/PinSource12/AF14`, and
    SPI1's three signals move off port F onto PA5/PF3/PD7. If the two blocks are identical, the
    generator is ignoring the package and everything above it is decoration. The recorded
    listings to compare against are in
    `tests/evidence/round5/2026-09-12-h417-package-pads.md`.
H10. **Switch on a display and count the pads.** `LTDC` → Colour depth `RGB888` + Sync and clock
    `Enabled` claims **28** pads (24 colour + 4 timing), each on its own. Switch to `RGB565`:
    eight colour lines are RELEASED and can immediately be claimed as GPIO. No two LTDC signals
    may land on one pad, and none may land on **PB9** (SWIO) or **PB8** (SWCLK) — enabling a
    display must not cost you the debug port. **Known open at the time of writing:** this is the
    defect `TASKS.md` "CH32H417: default pins collide" tracks, with the counts ratcheted in
    `tests/h417_packages.test.js`; if this step fails, check that file's numbers before
    reporting it as new.

## §5 — the browser, properly

18. Reload the app at **1280×720** and **1920×1080**, at **100 %** and **125 %** zoom, **light and
    dark**. The New Project dialog, the GPIO table and the clock tab must all fit with nothing
    clipped. A round-5 change to the GPIO table's per-row controls is exactly the kind of thing
    that breaks the 125 % case and nothing else.
19. Open the **Project Manager**. Generate. **Expected in a browser:** one `<Name>.zip`; **on the
    desktop:** a native folder picker, then `<folder>/<Name>/`. Either way the file list is the
    whole project and the panel says where it went before you click. Unzip and confirm the folder
    builds: `cd <Name> && pio run`.

## §6 — the things that are still not true

20. **Nothing has been flashed.** Confirm `agents/HUMAN_TODO.md` item 8 is present, that the
    `DONE.md` hardware line reads exactly **"builds, not flashed"**, and that `PROGRESS.md` says
    the same. If anyone has rounded that up, this is the step that catches it.
21. **`src-tauri` may still be unverified in a window.** Check whether `PROGRESS.md` records that
    the relink status is unknown, and that no board entry claims the desktop path is verified.

---

## The verdict

Post on `BOARD.md`:

```
<UTC> | AGENT-3 | QA-PASS | WALKTHROUGH round 5 run end to end. §1 n/n, §2 n/n, ... What failed: ... (or "nothing").
```

`DECISION | ROUND 5 DONE` requires §1–§5 green. §6 is not a blocker — it is the honest statement
of what remains, and it must still be there when the round closes.
