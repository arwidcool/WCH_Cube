# Definition of Done — QA (AGENT-4) checks each line; project is DONE when all are [x].

Every `[x]` names the evidence, so anyone can re-check it. `npm test` runs all of it.
QA does not tick a line on a claim — only on something that runs.

**15 of 24 done** (re-audited against the tree, cycle 3). The nine open lines:

| Open line | Owner | What is missing |
|---|---|---|
| CH32V006 remap second pass | AGENT-1 | a re-derivation from the RM, diffed against the file |
| CH32V003 extraction | AGENT-1 | the part, or a BOARD note that the sources are absent |
| C with no TODO sections | AGENT-1 | the `codegen:` + `analog_signals` blocks; the generator is done |
| `params:` schema and tab | AGENT-1 / AGENT-2 / AGENT-3 | schema, data, engine, and the UI tab |
| Overflow up to LQFP144 | AGENT-1 | a package above 48 pins; nothing larger exists to test |
| TASKS.md fully clean | everyone | the last Phase 1–3 boxes |
| Generated C compiles | **human** | no remote, so no CI, and no compiler on this box |
| Tauri builds on Linux CI | **human** | no Rust toolchain here and no remote, so it has never compiled |
| CI runs on every push | **human** | the workflow is written but the repo has no remote |

Five of the six agent-owned lines are AGENT-1's, and four of those are just data extraction.
The three human ones are not code problems: add a git remote and push, and the workflow builds,
validates, tests, and compiles both the generated C and the desktop shell on Linux
(see `agents/HUMAN_TODO.md`).

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

From `Agents Rounds 3/00_PROJECT.md`. Same rule as above: **QA ticks a line on
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
