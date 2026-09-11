# Definition of Done — QA (AGENT-3) checks each line; project is DONE when all are [x].

Every `[x]` names the evidence, so anyone can re-check it. `python build.py && node tests/run.js`
runs all of it. **QA does not tick a line on a claim — only on something that runs.**

**The authoritative open list is the Round 5 section at the end of this file.** The round-1
section below still carries its `[ ]`/`[x]` marks and its "15 of 24" count, last audited in
round 3; most of what it calls open has since closed, and re-auditing it is a round-5 task
rather than something to trust. Read it for a line's evidence, not for the project's status —
`PROGRESS.md` §4 is where the remaining work is listed, and the round-5 section is what gates
the round.

Round 4's rule still binds and is not repeated below: **every green result in this repository is
a compile.** Nothing has been flashed. The hardware line reads "builds, not flashed", in exactly
those words, until a human runs `pio run -t upload` and reports the SDI banner.

## Data
- [ ] CH32V006.yaml spot-checked: every remap table re-derived from RM by a second pass and diffed (0 differences)
- [x] EXTI line mapping and DMA channel table added for CH32V006
      → `data/mcus/CH32V006.yaml` has `exti.lines` (AFIO_EXTICR, 4 sources per line) and
        `dma.requests` (DMA1, 7 channels); every EXTI pin reference is checked by
        `tools/validate_mcu.py` and gated in `tests/data.test.js`
- [x] CH32V005 variant file (no TKEY/TIM3, same pinout) generated from V006 with an `inherits:` field
      → `data/mcus/CH32V005.yaml`: `mcu.inherits: CH32V006` plus a `remove:` list that drops
        `peripherals.TKEY`, `peripherals.TIM3`, `packages.QFN32` and its remap entry, with four
        CH32V005 part numbers of its own. It declares only what actually differs (OPA1).
        Passes `tools/validate_mcu.py` with 0 errors, and it is picked up automatically by
        `tests/smoke.js` ("CH32V005: every package loads, draws and survives clicking") and by
        `tests/data.test.js`, so it is exercised on every package with a silent console.
        Engine support: `app/engine/inherit.js` + `app/tests/inherit.test.js`.
- [ ] CH32V003 extracted (DS + RM present in `data/sources/` or requested via BOARD → HUMAN and skipped if absent)
- [x] Every MCU file passes `tools/validate_mcu.py` (schema + pin-existence + remap-consistency + package I/O counts vs model table)
      → `python tools/validate_mcu.py` exits 0 for both bundled parts; run as a merge gate by
        `tests/data.test.js` ("every MCU file passes tools/validate_mcu.py"). 10 warnings
        remain, all reported on the board; none is an error.

## Engine
- [x] Engine split out of template.html into `app/engine/*.js` modules with unit tests (≥ 90% of functions covered)
      → split into model, clock, engine, project, export, inherit, history, util.
        Coverage is **100%**: all 67 exports are referenced by `app/tests/*`, and
        `app/tests/api.test.js` calls each one directly rather than only through the app.
        Enforced at 90% by `tests/features.test.js` ("the engine unit tests reach at least
        90% of what the engine exports"), which names any export that falls out of cover.
- [x] Conflict engine: shorted pins, exposed pad, remap collision preview, package switch re-check — all covered by tests
      → `app/tests/engine.test.js` ("shorted pins collide with each other and say so",
        "previewAssign warns before the click", "previewAssign warns when the remap switch
        would drag other signals onto taken pins", "switching package re-checks everything")
        and `app/tests/model.test.js` ("exposed pad is pin 0 and is not counted as an I/O")
- [x] Project save/load (`.wchproj` YAML) round-trips 100% of state (browser download/upload; AGENT-4 wires native dialogs in Tauri)
      → `app/tests/project.test.js` (7 tests, round-trip + rejection cases); native dialogs
        proven by `tests/desktop.test.js` ("Ctrl+S and the Save button both go through the
        native dialog", "opening a project through the native dialog restores it")
- [x] Undo/redo for pin and mode changes
      → `app/engine/history.js` + `app/tests/history.test.js`, all green: pin assign/reset,
        mode and checkbox settings restored as real Sets, a package switch including the
        pins it dropped, `batch()` collapsing several changes into one step, and undo
        leaving the selection, zoom and pan alone.
- [x] Pin table export (Markdown + CSV) and clock summary export (Markdown) — the Generate button's first real output
      → `app/engine/export.js` + `app/tests/export.test.js` (6 tests: row per physical pin in
        pin order, exposed pad last, signal/mode/user label carried, conflicts marked and
        listed, CSV header and quoting). GENERATE CODE downloads all three files.
- [x] C code generation for GPIO + AFIO remap + RCC (WCH EVT SDK style), with real register words for CH32V006 (no TODO sections)
      → the missing half was DATA and AGENT-1 landed it. `tests/codegen_compile.test.js`
        ("a fully configured part generates C with no TODO section and no #error") runs
        `cComplaints()` over all three `tests/fixtures/*.wchproj` and finds **nothing** — no
        TODO, no `#error`, on CH32V006 TSSOP20 and QFN32 and on CH32V005. Negative-tested by
        deleting `codegen.rcc` from a COPY of the MCU file, which brings the TODO straight
        back. Real register words, not explanations of missing ones.
        Still there: `app/engine/codegen.js` + `app/tests/codegen.test.js` for the structure.
- [ ] Generated C compiles in CI (`riscv-none-elf-gcc`, else `gcc -fsyntax-only` with stub headers)
      → **the compile half is DONE and is no longer human-blocked** — the old note here said
        there was no compiler on this box, and that was wrong. PlatformIO ships WCH's RISC-V
        GCC 12.2.0, and `tests/codegen_compile.test.js` generates from a fixture that assigns
        pins and runs a real `pio run`: CH32V006 TSSOP20 (`CH32V006F8P6`), CH32V006 QFN32
        (`CH32V006K8U6`) and CH32V005 TSSOP20 (`CH32V005F6P6`) all compile AND link.
        What is left is literally the two words "in CI": the workflow has never run, because
        the repo has no remote. **Human-blocked for that half only** (`HUMAN_TODO` item 1).
        Not ticked, because the line says "in CI" and it is not true yet — see the Round 3
        section for the local gate, which is ticked on its own terms.
- [ ] `params:` schema in FORMAT.md, filled for CH32V006 USART/SPI/I2C/TIM/ADC, consumed by the engine and a Parameter Settings tab, round-trips in `.wchproj`

## UI
- [x] Pinout view matches CubeMX layout at 1280×720 and 1920×1080 (screenshot compared by QA)
      → `tests/layout.test.js`, **structural rather than pixel**: jsdom has no layout engine
        and Playwright will not install here, so it locks in the shape of
        `agents/reference/cubemx.png` — menu bar, breadcrumb with GENERATE CODE, the four
        tabs in order, then tree / centre / chip with its zoom bar — and checks the chip
        fits its canvas at both required sizes. A true pixel diff needs a browser in CI.
- [x] Right-click pin → user label; labels show on chip and in export
      → `tests/features.test.js` ("a user label set on a pin shows on the chip and in the
        export") and `app/tests/export.test.js` ("assigned pins carry their signal, mode and
        user label")
- [x] "Show only modified pins" filter; keyboard navigation between pins
      → `tests/features.test.js` ("show only modified pins hides the untouched ones and
        brings them back", "arrow keys move the focus from pin to pin", "Enter opens the
        picker on the focused pin and Delete clears it")
- [x] Clock tab drawn as a real tree (boxes + connectors) with all V006 taps, live values, red when out of spec
      → `tests/layout.test.js` ("the clock tab is a drawn tree, not an empty panel") for the
        drawing; `app/tests/clock.test.js` for the values and the limits ("SYSCLK over the
        datasheet maximum is flagged", HSE range); out-of-spec nodes get `.cnode.over`,
        which is `--bad` red in the stylesheet
- [x] System view (block diagram of enabled peripherals)
      → `tests/features.test.js` ("the system view lists the peripherals that are switched
        on"): the tab swaps `#canvas` for `#syscanvas` and the drawing names the peripheral
- [x] No layout overflow on any package from QFN12 to LQFP144 (dummy part covers the large ones)
      → AGENT-1 added LQFP64, LQFP100 and LQFP144 to `WCH-DUMMY32-C8`, so the range is real
        now: `tests/layout.test.js` ("nothing is drawn outside the chip drawing from QFN12 up
        to LQFP144") passes over all of them. AGENT-3 additionally swept every part × package
        × 4 rotations × mirrored at 1280/1920/2560 — 384 combinations, no overflow, no label
        collisions. And `tests/legibility.test.js` now measures a real browser at 1280 and
        1920, zoom 100 % and 125 %, light and dark: no chip label falls outside the canvas.

## Release
- [ ] Tauri shell builds on Linux (CI) and packages the `data/` folder; app reads YAML from disk with hot-reload
      → `src-tauri/` is complete (commands, notify watcher, bundled `data/` resource,
        `~/.wch_cubemx/mcus` override) and `tests/desktop.test.js` proves the config, the
        command surface and the bridge — disk MCUs, native dialogs, hot reload, and that it
        is inert in a browser.
        **It compiles now, on Windows**: `cargo build` clean, 2026-09-11 (cargo 1.98.1 — the
        old note here claiming no cargo on this box was wrong). Compiling it for the first
        time found that it had NEVER compiled: `open_project` returned
        `Result<String, String>` from a function declared `Result<Option<String>, String>`.
        Fixed and committed.
        Not ticked: the line says **on Linux**, and nothing in this repo has ever been built
        on Linux. That half needs the remote (`HUMAN_TODO` item 1).
- [ ] `npm test` / `node tests/run.js` green; GitHub Actions workflow runs build + tests on every push
      → `node tests/run.js` is **green: 333 tests**, and `.github/workflows/ci.yml` is written
        (Node 22, Python 3.12, validate → build → stale-dist check → tests, plus a Linux
        desktop job). Half of this line is therefore done; the workflow itself has never run
        because the repo has no remote, so it cannot be ticked.
- [x] README documents: run in browser, run desktop, add an MCU, file format, agent workflow
      → `README.md`: run in a browser, run and build the desktop app, projects, add an MCU
        (with the remap-table idea and `tools/validate_mcu.py`), running the tests including
        the npm-on-Google-Drive workaround, and how the four agents work
- [x] Zero console errors/warnings on load for every MCU × every package (automated check)
      → also `tests/boot.test.js` (AGENT-3's 01:08Z request): a parsed MCU, an initialised state and
        an engine result after load, the page actually painted, and a silent console. Note `window.M`
        is undefined **by construction** — the bundle is one classic script, where a top-level
        `let` never becomes a window property — so it cannot be the boot signal; the test pins that
        down so nobody writes a check against it.
      → `tests/smoke.js`: every MCU × every package loads, switches, draws the expected pin
        count, survives five deterministic pin clicks with an assignment each, and must
        produce no console output at all. Also `tests/data.test.js` ("the app can load every
        bundled MCU on every one of its packages").
- [ ] TASKS.md has no `[~]` left and no `[ ]` in Phase 1–4

---

# Round 3 — "the generated code is the product"

From `agents/history/round3/00_PROJECT.md`. Same rule as above: **QA ticks a line on
something that runs, never on a claim.** Every `[x]` names the test.

Status at 2026-09-11T16:05Z: **5 of 13.**

## The compile gate and the two P0 defects

- [x] `codegen.header` and `codegen.speeds` correct on CH32V006
      → AGENT-1 fixed both, citing the EVT package
        (`ch32v00X.h` line 2 for the capital-X header, `ch32v00X_gpio.h` lines 23–26 for
        `GPIO_Speed_30MHz` as the only member of `GPIOSpeed_TypeDef`).
        Held shut by two checks in `tests/codegen_compile.test.js`, **both planted-break
        tested**. Worth reading the results together: the wrong-case header break **still
        compiles** here, because NTFS is case-insensitive, and only the name check catches
        it; the wrong speed macro is caught twice, by GCC and by the name check. On this
        class of defect compiling is necessary and not sufficient, which is why the two sit
        side by side rather than one replacing the other.
- [x] **The compile gate**: C generated from a configuration with pins assigned builds in
      `data/firmware`, for CH32V006 on two packages and for CH32V005
      → `tests/codegen_compile.test.js`. `CH32V006F8P6`, `CH32V006K8U6` and `CH32V005F6P6`
        all compile **and link**. The fixtures are checked in and assign pins on three or
        four ports, set non-default USART1 and SPI1 remaps, an HSE crystal, a PWM output, an
        ADC channel and `params:` on six peripherals; `tests/fixtures/make_fixtures.js`
        refuses to write one with a pin conflict or under eight assigned pins, and `--check`
        fails when the data moves under them. Flash went 7 796 → 7 972 B against the old
        default-configuration build, so `WCHCube_GPIO_Init()` is measurably not empty.
        Skips with a printed reason when PlatformIO is absent, and the runner counts and
        lists skips above the verdict on a green run — a silent skip is how this got claimed
        for a whole round without anyone compiling.
        **Read the scope, not just the tick**: GPIO, AFIO and RCC. `params:` ride in the
        fixtures but codegen does not emit `*_InitTypeDef` yet, DMA and NVIC are not in the
        `.wchproj` format at all, and nothing has ever been built on Linux or flashed.
- [ ] Generated C for CH32V006 has zero TODO sections and zero `#error` for a fully
      configured part
      → **was ticked at 15:50Z and is UNTICKED at 16:05Z, in the same session.** It was true
        when I checked it: `cComplaints()` over all three fixtures found nothing. Then
        AGENT-2 landed `params:` → `*_InitTypeDef`, and a fully configured part now emits
        **28 TODOs** — because the new emitter needs data keys the MCU files do not carry
        yet (`sdk_enabled`/`sdk_disabled` for bools, the `*_Init()` to hand a filled struct
        to, and which call applies a parameter that is not a struct field). That is a
        feature arriving ahead of its data, not a regression in either half, and all 28 are
        one open TASKS.md line of AGENT-1's.
        Zero `#error`, still, on all three fixtures — and they all still compile.
        The gate is now "no TODO of an UNTRACKED KIND": known kinds print with their owner
        and backlog line, a new kind fails, and an `#error` is never excused because it does
        not compile. Ticks itself again when AGENT-1's `struct:`/`field:` work lands.
- [ ] `tools/verify_sdk_names.py` checks every `codegen:` / `params:` / `dma:` / `nvic:` name
      against that part's SDK headers, wired into `node tests/run.js`, planted-break tested
      → AGENT-1 has written `tools/verify_sdk_names.py` and `tools/verify_sdk_names_selftest.py`
        and it has already earned its keep (it found `ADC1_IRQn`, which exists in neither the
        IRQn enum nor the startup table). **Not yet wired into `node tests/run.js`** — AGENT-4.

## Carried over from round 2

- [ ] C1 — the 8 legibility findings
      → `tests/legibility.test.js` re-runs the round-2 §6b audit on the same grid every time
        and currently measures **clean**: no clipped text, nothing past the right edge, no
        truncated `<select>`, and every chip label inside the canvas, non-overlapping and at
        or above 4.5:1. All four measurements plant a defect and insist it is caught.
        AGENT-3's line to tick, not mine; when they tick C1 the grid becomes a hard gate.
- [ ] C2 — DMA Settings tab + the DMA1 channel table in System Core  (AGENT-3)
- [ ] C3 — NVIC Settings tab + the NVIC overview in System Core  (AGENT-3)
- [x] C4 — `mcu.remove` applied before the parent merge  (AGENT-2)
      → committed 02a1608; `app/tests/inherit.test.js` covers the ordering.
- [x] C5 — `setSetting()` on a `checkboxes` setting throws instead of blanking the app  (AGENT-2)
      → committed; `app/tests/engine.test.js`.
- [ ] C6 — `#mcusel` at boot and `#pkgsel` after a project load  (AGENT-3)
- [ ] C7 — `WCH-DUMMY32-C8` gets `dma` / `nvic` / `params` / `codegen`  (AGENT-1)
- [x] C8 — `tests/completeness.test.js`
      → the per-peripheral matrix (settings / params / clock bit / vectors) over every real
        part, DMA-request ownership both ways, every peripheral that holds a pin reaching the
        generated C, and the RM chapter list read out of `CH32V00XRM.md` at run time.
        Deliberate absences are declared with an EVT citation; known-open cells print every
        run and are guarded against their TASKS.md line vanishing. Three planted breaks,
        three caught. **It found RM chapter 20 (EXTEN) uncovered and undeclared.**

## The rest of round 3

- [ ] Project Manager tab: project info, toolchain, generator options, file preview, Generate
      that writes where it says it writes. `Tools` tab implemented or removed.  (AGENT-3)
- [ ] No `disabled` control anywhere that is not justified by the MCU data
      → the GPIO speed control is fixed (AGENT-3). The dead-control sweep is not finished;
        `#m-open` / `#m-openproj` open an OS file chooser headless Chrome cannot answer.
- [ ] `params:` → C for USART/SPI/I2C/TIM/ADC on CH32V006, round-tripping through `.wchproj`
      and undo  (AGENT-2)
      → the round-trip half is done and tested (`app/tests/params.test.js`, "every shipped
        parameter survives a project round trip", "one parameter change is one undo step").
        The `→ C` half is not: no `*_InitTypeDef` is emitted yet.
- [ ] DMA and NVIC configuration → C, with a double-booked channel still a hard conflict  (AGENT-2)
- [ ] Save → close → Open restores everything, and regenerating produces byte-identical C  (AGENT-2)
- [ ] `data/firmware` builds all four environments; `pio check` clean
      → **both true today** (2026-09-11T14:36Z: `CH32V006F8P6`, `CH32V006K8U6`,
        `CH32V005F6P6`, `CH32X035G8U6` all SUCCESS; `pio check` no defects) but **not yet
        automated**, so it is not ticked. Note the build needs the drop zone EMPTY: it holds
        one configuration, and a bare `pio run` builds every environment against it, so a
        CH32V006 file left there fails CH32X035 — correctly.
- [x] `PROGRESS.md` current: no statement in it is false
      → re-audited 2026-09-11T14:36Z; four false statements fixed (the EVT packages had
        landed, the test count, both defects still written as open, and §7's "not yet known
        to compile in general"). §7 now carries an explicit *what this does and does not
        support saying*. Re-checked every cycle — that is the line's whole point.

---

# Round 4 — "a second family, and a project you can flash"

From `agents/history/round4/00_PROJECT.md`. Same rule: **QA ticks on something that
runs, never on a claim.** Every `[x]` names the test.

Status at 2026-09-11T17:12Z: **6 of 21.**

## Deliverable A — CH32X035 end to end

- [ ] `data/mcus/CH32X035.yaml` — 8 variants, 7 packages, every peripheral the RM
      describes, remaps re-derived by a second pass and diffed to 0 differences
      → **in progress** (AGENT-1). It loads, 7 packages draw with 0 conflicts, and
        7 peripherals are in so far.
- [ ] `validate_mcu.py` 0 errors; `verify_sdk_names.py` against the X035 EVT 0 errors
      → **RED, correctly**, and this is the gate doing its job on a second family:
        `gpio.modes` claims `GPIO_Mode_Out_OD` and `GPIO_Mode_AF_OD`, and
        `GPIOMode_TypeDef` (`ch32x035_gpio.h:29-37`) has six members with **no
        open-drain at all**. Plus `codegen.periph_handle.USBFS: USBFS_DEVICE`,
        which is 0 occurrences in the whole X035 EVT tree.
- [x] `grep -ri "x035" app/engine/ app/template.html` is empty. No part special-cased
      → `tests/no_part_names.test.js`, and it is a real check rather than a grep in
        a comment: comments MAY name parts (explaining why a piece of code reads the
        file is worth more than a green tick), code may not. Self-tested both ways.
- [x] Generated C for CH32X035 **compiles**: `pio run -e CH32X035G8U6` exits 0
      → `tests/codegen_compile.test.js`, fixture `CH32X035_QFN28_full.wchproj`.
        Pins on three ports including the 24-bit port C, and PC16 which is shorted
        to PC11 in QFN28 — so the shorted-pin path runs on a part that is not
        CH32V006. **Zero TODO sections of an untracked kind and zero `#error`.**
- [x] Every existing test still passes on CH32V006 and CH32V005 — no regression
      paid for X035
      → the whole suite, 413 green. The compile matrix runs all four fixtures
        every time, which is the place a shared codegen change would break the
        part nobody is looking at.
- [ ] `smoke.js`, `layout.test.js`, `legibility.test.js`, `completeness.test.js`
      and `codegen_compile.test.js` all cover CH32X035 × every package
      → `smoke.js` and `completeness.test.js` cover it automatically (they iterate
        the registered parts — that design paying off), and `codegen_compile` has
        it explicitly. `layout` and `legibility` still need the X035 packages
        added; LQFP64M with names like `USBPD_CC1` is the first real stress the
        legibility test has had.
- [ ] The clock tab on CH32X035 shows an HSI-only tree: no HSE box, no greyed
      placeholder, no console output. CH32V006 unchanged.  (AGENT-3)
- [ ] 24-bit ports and the PC holes work everywhere: masks, GPIO table, drawing,
      EXTI map, generated `GPIO_Pin_*`.
- [ ] DMA tab shows 8 channels; NVIC tab shows **45** vectors, the three grouped
      EXTI vectors once each, and **no `RCC_IRQn`** — this part does not have one.
- [ ] Package geometries for all seven; `QSOP28` added; `LQFP64M` resolved against
      the DS mechanical drawing.  (AGENT-1)
- [ ] `CH32X035.notes.md` cites a source for every fact.  (AGENT-1)

## Deliverable B — the generated PlatformIO project

- [ ] `Generate PlatformIO project` produces a folder that builds with no manual
      step, for CH32V006 TSSOP20 and CH32X035
      → **`tests/generated_project.test.js` is written and SKIPPING**, with the
        reason printed on every run: `app/engine/` exports no `projectFiles()`
        yet. Written against the contract on purpose, so it runs the moment
        AGENT-2 lands it rather than being retrofitted around what got built.
- [ ] `platformio.ini` names the board from `variants[*].pio_board`; a variant
      without one is refused by name  → asserted by that gate, skipping.
- [ ] `main.c` prints the part, the configured SYSCLK and `SystemCoreClock` read
      back, and blinks a pin **only** if the user configured an output
      → asserted in BOTH directions by that gate, skipping.
- [ ] The generated README explains the two-clock-owners behaviour in one sentence
      → asserted by that gate, skipping.
- [ ] Desktop writes a folder through a native picker; the browser delivers a
      `.zip` with no external library
      → the desktop half is **done** (D5 below). AGENT-3 has the ZIP writer.
- [x] `tests/generated_project.test.js`: generate to a scratch dir, `pio run`,
      exit 0, clean up; skips with a printed reason when `pio` is absent
      → the FILE exists and behaves correctly; its nine checks skip loudly until
        the seam lands. The test is ticked, the feature it tests is not.
- [ ] **A human has flashed one generated project, or this line says
      "builds, not flashed"** → **BUILDS, NOT FLASHED.** Every green result in
      this repository is a compile. `pio run -t upload` has never been run here
      and nobody has hardware attached. `agents/HUMAN_TODO.md` item 6 is the
      specific request, with the exact commands and what to send back.

## Carried over from round 3

- [ ] D1 `generateAll()` returns `{ name, language, text }` per file  (AGENT-2)
- [ ] D2 Generator options in `S.project`, round-tripped and undoable  (AGENT-2)
- [ ] D3 User code sections preserved across regeneration  (AGENT-2)
- [x] D4 `Tools` tab implemented  (AGENT-3)
      → AGENT-3's 16:57Z sweep: the only `disabled` control left anywhere is
        `#m-redo`, which reflects undo history rather than an option the silicon
        lacks. That also makes round 3's "no `disabled` control not justified by
        the MCU data" true.
- [x] D5 Tauri command to write generated files to a chosen folder
      → `write_project(name, files, overwrite)`. Validates every path BEFORE
        creating anything (there is a test on that ORDERING, not just the
        behaviour), refuses a non-relative path, a `..`, and a non-empty folder.
        `safe_relative()` unit-tested in Rust over 5 real paths and 9 escapes;
        `cargo test` now runs inside `node tests/run.js`.
- [x] D6 Host-side unit tests for `lib/util` under `[env:native]`
      → 10 Unity tests over the ring buffer, run by `tests/firmware_native.test.js`.
        Found a host compiler nobody knew this box had: MinGW 9.2.0 at `C:\MinGW`,
        not on PATH.
- [x] D7 `agents/README.md` "Environment facts"; round-3 section in `agents/DONE.md`
      → both done; the README also had a stale current-round pointer.
- [x] D8 RM chapter 20 (EXTEN) on V006  (AGENT-1) — modelled, not whitelisted.
- [~] D9 `#m-open` / `#m-openproj` sweep; `Taskfile.yml` adopt-or-leave
      → **Taskfile ADOPTED** (`task` 3.53.1 is installed): build, test, gate,
        validate, firmware, firmware:native, firmware:check, tauri, tauri:test,
        fixtures, generate, all. `task firmware` clears the drop zone first, which
        is the fix for the cross-part build failure. The dead-control sweep half
        is superseded by AGENT-3's 16:57Z result and needs confirming.

## Round-4 housekeeping

- [x] `PROGRESS.md` current; the stale "EVT has not arrived" language corrected
      → §5 has the second family, §6 the five live X035 findings, §7 the second
        family in the compile table. `data/firmware/{ARCHITECTURE,README}.md`
        corrected; `data/sources/README.md` is AGENT-1's.

---

# Round 5 — "every choice the app offers must be one the silicon can honour"

From `agents/PROJECT.md`. Same rule as every section above: **QA ticks a line on something that
runs.** A line whose evidence is a sentence in a board entry is not ticked.

## Deliverable A — the data can state a constraint

- [ ] The constraint schema is documented in `data/FORMAT.md` as a real block, with the rules
      `tools/validate_mcu.py` enforces stated in prose.  (AGENT-1)
- [ ] It is filled for CH32X035's three documented cases: the pull-down allow-list
      (PA0–PA15, PC16–PC17 — `ch32x035_gpio.h`), output functions prohibited on shorted pins
      (DS notes 4–7), and PC10/PC11 floating-only while USBFS is enabled (DS note 4).
      (AGENT-1)
- [ ] CH32V006 and CH32V005 were **audited** for the same class of constraint, and the result is
      recorded either way — "no instances, checked in RM ch.7" is a valid result.  (AGENT-1)
- [ ] `validate_mcu.py` checks the block (pins exist on the named package; restrict+allow on one
      option is an error), with planted breaks confirmed caught.  (AGENT-1)
- [x] The **GPIO table** honours it **per row** — the option is absent on the rows it does not
      apply to, not greyed for the whole column.  (AGENT-2)
      → `tests/constraints.test.js` asks it row by row on the shipped CH32X035 data:
        Pull-down absent on a bonded pin outside PA0–PA15/PC16–PC17 and **present** on one inside
        (both halves, so a mechanism that emptied the column would fail); the output modes absent
        on every name of a shorted pair and **present** on an unshorted pin; PC10/PC11 left with
        exactly `No pull` while USBFS is on and given `Pull-up` back when it goes off. On a probe
        part the same three assertions run with no skip in between, so the mechanism is exercised
        on a case whose answer the shipped data does not already decide.
- [x] The **conflict engine** reports a claim that violates a constraint as an issue naming the
      constraint, the way an EXTI or DMA clash is reported today.  (AGENT-2)
      → `app/tests/constraint.test.js` "a claim that violates a constraint is an issue that names
        the constraint"; `E.constraintIssues` carries the pin, the field, the value, the id and the
        source, and the same sentence reaches the owning peripheral's issue list.
- [x] **codegen** never emits a combination the data forbids, and emits a `TODO` naming the
      constraint if it somehow reaches one.  (AGENT-2)
      → `app/tests/constraint.test.js` "codegen never emits a forbidden combination - it emits a
        TODO naming it" and "a configuration the silicon can honour generates no complaint at all";
        the row carries `constrainedBy` / `speedConstrainedBy` and a null macro, and the TODO is the
        one `--strict` fails on.
- [x] A `.wchproj` that violates a constraint — or predates it — loads with **zero console
      output** and says what it dropped, through the same path `gpioSpeedFor()` already uses for
      a saved speed the part no longer offers.  (AGENT-2)
      → `tests/constraints.test.js` "a violating project loads with zero console output and says
        what it dropped": a project storing `Pull-down` on a pin outside the allow-list passes
        through `projectApply()` with `console.error`/`console.warn` captured — the run is silent —
        the stored value is rewritten, and `PROJECT.warnings` names the constraint and the value;
        `app/tests/constraint.test.js` "a project saved before the constraint existed opens with no
        console error" covers the older file.
- [x] **A test that can fail**: with the restriction removed from the data or the consumer
      disabled, the test goes red. Both halves of the pull-down check are present — not offered
      **outside** the allow-list AND offered **inside** it.  (AGENT-3)
      → `tests/constraints.test.js`. The planted break runs on every green run:
        "the check can fail: remove the restriction from the data and the option comes back" — the
        same probe part is loaded with the constraint and then without it, and the option must
        reappear, so the first assertion cannot be passing because the column was emptied. Both
        halves are asserted in every region check, each with its own counter-control (Pull-up
        survives, an unshorted pin keeps its output mode, the refusal lifts when USBFS goes off).
        The schema audit carries its own planted break too. **Worth recording how it earned its
        keep on the first run**: the file was written against the documented shape while
        `app/engine/constraints.js` still read a different one, and the round's own defect class —
        an offering the silicon cannot honour — was live in the mechanism built to remove it.
        BOARD 22:11Z / 22:25Z; the consumer moved and the skips are gone.
- [x] **Regression**: CH32V006 and CH32V005 byte-identical — every existing test unchanged, and
      generated C for the checked-in fixtures byte-identical without regenerating them.
      (AGENT-3)
      → neither part's data changed this round based on git diff, and neither declares
        `constraints:`, so `gpioConstraints()` is empty for both and every row offers exactly what
        it offered before — APP's "a part that states no constraint offers everything it offered
        before" runs that claim on every bundled part. The whole suite is green at
        **510, 0 skipped**, and `tests/codegen_compile.test.js`'s "the checked-in fixtures still
        match what the engine produces" confirms the fixtures did not drift.

## Deliverable B — every part generates C with no TODO and no `#error`

- [x] `node tools/wchcube_cli.js --project <fixture> --strict` exits **0** for **every** fixture
      × part. It exits **2** today.  (AGENT-1 + AGENT-2, asserted by AGENT-3)
      → `tests/strict.test.js`. Both `codegen.nvic` and `channel_params.channels` landed, and all
        four fixtures now exit 0. Asserted as an **exit code**, twice per fixture: the round-5
        command verbatim and the same command with `--format c`, which is the half that can
        actually see a TODO or an `#error` — the default format is `pins-md` and `--strict`
        deliberately says nothing about codegen when no C was generated, so the literal command
        alone would not have been the gate it is described as. Plus the coverage half (every part
        the app ships must have a `.wchproj` behind it) and **both planted breaks** — a conflicted
        configuration and a part with its `codegen:` block removed — each confirmed to exit 2.
- [ ] `codegen.nvic` — an enabled vector emits an `NVIC_Init` call, not a comment. `NVIC_Init`
      takes no handle.  (AGENT-1 + AGENT-2)
- [ ] `channel_params.channels` — the `TIM_OCInitTypeDef` emitter is no longer parked: the
      channel index comes from the data, not from reading the digit out of `"Channel1"`.
      (AGENT-1 + AGENT-2)
- [ ] CH32X035's five partial peripherals are modelled or declared ABSENT with a citation:
      OPA, CMP1/2/3, TKEY, USBFS/USBPD params. `codegen.periph_handle.USBFS` must stop naming
      `USBFS_DEVICE`, which does not exist — the headers define `USBFSD` and `USBFSH`.
      (AGENT-1)
- [ ] The ADC internal Vrefint channel is modelled — and the decision is applied to **CH32V006
      too**, where the same gap exists.  (AGENT-1)
- [ ] USART LIN / SmartCard / IrDA modelled as `params:` with `sdk_call`.  (AGENT-1)
- [ ] Every generated project still **compiles**: `pio run` for all four firmware environments
      and for the generated-project gate in the system temp directory.  (AGENT-3)
- [ ] Save → close → open → regenerate is **byte-identical including DMA and NVIC**.  (AGENT-2)

## Carried over from round 4 — E1–E9

- [ ] E1 `codegen.nvic`  (DATA + APP) — also a Deliverable B line above
- [ ] E2 `channel_params.channels`  (DATA + APP) — also a Deliverable B line above
- [x] E3 `tools/verify_sdk_names.py` runs inside `node tests/run.js`, and its NOT CHECKED reasons
      reach the run summary the way every other skip does  (AGENT-3)
      → `tests/sdk_names.test.js` registers **one test per shipped `data/mcus/*.yaml`**, asserts the
        tool's exit code, and then requires a `codegen.sdk: checked against …` line: without it the
        test SKIPs carrying the tool's own sentence, so a part nobody checked is a counted skip in
        the summary rather than a green tick. Three checks hold it shut — the file list is asserted
        against `wchcube_cli.js --list`, a planted file with no `codegen.sdk` block proves the skip
        fires instead of passing, and the success marker is anchored to `codegen.sdk: checked
        against` because a bare `/checked against /` matched the tool's own failure message and read
        it as a pass. AGENT-1's planted-break self-test was already in the runner.
- [ ] E4 the 16 known-missing cells in `tests/completeness.test.js`, each filled or declared
      ABSENT with an EVT citation — the two are different and must not be conflated  (all three)
- [ ] E5 `smoke.js`, `layout.test.js`, `legibility.test.js`, `codegen_compile.test.js`,
      `data.test.js` all cover **CH32X035 × 7 packages**  (AGENT-3)
- [ ] E6 `CH32X033F8P6` modelled as its own part (DS Table 2-2 is a separate pin table),
      most likely `inherits: CH32X035`  (AGENT-1)
- [ ] E7 QFN28 / QFN20 / QFN12 on CH32X035: an answer on whether they have an external reset,
      or a recorded BLOCKED. Filling it by analogy is banned  (AGENT-1)
- [ ] E8 `src-tauri` relinked and the desktop write path **verified in a window** — or
      `PROGRESS.md` says plainly that it is still unverified  (AGENT-3)
- [ ] E9 the round-3/4 DONE lines still open: `--strict` clean, and the `.wchproj` round-trip
      for DMA and NVIC  (all three)

## Round-5 housekeeping

- [x] `PROGRESS.md` current: §1 the consolidated pack, §4 the remaining work, §5 CH32X035's
      status, §7 what the gates now prove, §9 next steps  (AGENT-3)
      → rewritten this cycle against the tree: §1 carries the three real parts and the 510-test
        count, §3 and §4 are round 5 rather than round 4 (which had been left open for two
        rounds), §5's CH32X035 row reports `validate_mcu.py` and `verify_sdk_names.py` at 0 errors,
        §6's four X035 items are marked closed with what closed them, §7 says what `--strict` and
        the compile gate now cover, and §9 drops the recommendations that have since been done and
        lists what is actually left. §6's "still open" list and §5's rows were each checked against
        the tree rather than carried forward.
- [x] The stale-path greps in `AGENT_3_QA_RELEASE.md` item 11 come back clean  (AGENT-3)
      → run over every tracked file. The live pointers were in this file's own `PROGRESS.md` —
        §3 said "instructions in `Agents Rounds 4/`" and §2/§6 referred to the round-3 pack by a
        path that no longer exists. Both now name `agents/history/roundN/`. Everything else is a
        path under `agents/` (or `agents/history/`, where those folders actually live) or a
        sentence that says what the folder *used* to be — `Prompt.txt`'s note and `README.md`'s
        account of the consolidation are the latter, and both are load-bearing history, not
        pointers.
- [ ] `WALKTHROUGH.md` run end to end, with the QA-PASS line posted including what failed
      (AGENT-3)
- [ ] The round-1 section at the top of this file is re-audited against the tree, or explicitly
      superseded — it must not keep claiming a status nobody has checked  (AGENT-3)

## Not in this round, and the line that must not be rounded up

- [ ] **A human has flashed one generated project.**  (human)
      → Until then: **"builds, not flashed."** Every green result here is a compile.
        `agents/HUMAN_TODO.md` item 6 is the specific request, with the exact commands
        and what to send back; the result goes in `tests/evidence/round5/`.
