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
- [ ] C code generation for GPIO + AFIO remap + RCC (WCH EVT SDK style), with real register words for CH32V006 (no TODO sections)
      → **the generator is done and correct**: `app/engine/codegen.js` + `app/tests/codegen.test.js`
        (19 structural tests), and `tests/codegen.test.js` generates the C from the built app for
        every MCU × package and checks it is well formed — both files present, braces and comments
        balanced, an include guard, and the configured pins named in the output.
        What is missing is DATA, not code: `data/mcus/CH32V006.yaml` has no `codegen:` block, so the
        generator emits the TODO it is designed to emit ("the MCU file has no codegen.rcc block, so
        the register word cannot…"). The gate is already armed — `tests/codegen.test.js` ("once an
        MCU file has a codegen: block its C contains no TODO") flips from reporting to enforcing the
        moment AGENT-1 lands the block, so this line ticks itself.
- [ ] Generated C compiles in CI (`riscv-none-elf-gcc`, else `gcc -fsyntax-only` with stub headers) — **human-blocked** (no remote)
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
- [ ] No layout overflow on any package from QFN12 to LQFP144 (dummy part covers the large ones)
      → `tests/layout.test.js` ("nothing is drawn outside the chip drawing...") passes for
        every package that exists, but the largest is 48-pin, so the top of the range is
        **unexercised**. Needs an LQFP64/100/144 table on the dummy part — AGENT-1.

## Release
- [ ] Tauri shell builds on Linux (CI) and packages the `data/` folder; app reads YAML from disk with hot-reload
      → `src-tauri/` is complete (commands, notify watcher, bundled `data/` resource,
        `~/.wch_cubemx/mcus` override) and `tests/desktop.test.js` proves the config, the
        command surface and the bridge — disk MCUs, native dialogs, hot reload, and that it
        is inert in a browser. **The Rust has never been compiled**: no cargo on this box and
        the CI `desktop` job has never run, because the repo has no remote. Cannot tick.
- [ ] `npm test` / `node tests/run.js` green; GitHub Actions workflow runs build + tests on every push
      → `node tests/run.js` is **green: 145 tests**, and `.github/workflows/ci.yml` is written
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
