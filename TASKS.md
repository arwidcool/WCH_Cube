# WCHCube — task tracker

CubeMX-style pinout / peripheral / clock configurator for WCH MCUs.
Update this file every session. Newest notes at the bottom of each section.

## Decisions (locked)

| Topic | Decision | Why |
|---|---|---|
| Frontend | Single `index.html`, plain JS + SVG, no framework, no build step to run | Fast, runs in any browser, trivially embeddable in Tauri |
| Desktop wrapper | Tauri (Rust) — **later** | Small binaries, Win/macOS/Linux, native file dialogs |
| Data format | YAML (`data/mcus/*.yaml`, `data/packages/*.yaml`) | Human readable & editable; parsed by js-yaml in the browser |
| Single source of truth | Pin alternate functions are **derived from peripheral remap tables**, not listed per pin | One place to edit; conflicts computed, not hand-written |
| Look & feel | Mirror STM32CubeMX (blue tab bar, three-column layout, grey chip, green/yellow/orange pins) | Per brief |

## Multi-agent mode
Four autonomous agents (DATA / ENGINE / UI / QA+RELEASE) work this file. The working agreement is
`agents/README.md`; the current marching orders are the **round-3 pack**:

| File | What it is |
|---|---|
| `Agents Rounds 3/00_PROJECT.md` | the round brief — read first, every cycle |
| `Agents Rounds 3/AGENT_n_*.md` | your standing instructions + your "Current" section |
| `Agents Rounds 3/BOARD.md` | the message board for this round (append-only) |
| `Agents Rounds 3/WALKTHROUGH.md` | the acceptance script: configuration → C → a binary |
| `PROGRESS.md` | where the project actually stands (AGENT-4 keeps it true) |

Claim with `[~] (AGENT-n)`. Communicate only via the board. Done = all of `agents/DONE.md`.
Round-1 and round-2 boards (`agents/BOARD.md`, `Agents Rounds 2/BOARD.md`) are history and still
binding — read the last entries of the round-2 board before your first round-3 cycle.

## Status legend
`[ ]` todo  `[~]` in progress  `[x]` done  `[-]` dropped

---

## Phase 1 — UI with dummy MCU

- [x] Project skeleton, task tracker, README
- [x] Package library: dual (SOP/TSSOP/SSOP/DIP) and quad (QFN/LQFP) geometries, 1–144 pins
- [x] Dummy MCU YAML (`WCH-DUMMY32-C8`) with 48-pin + 20-pin packages, peripherals, remap groups, clock tree
- [x] Build script that inlines the YAML into `dist/index.html` (so the app is one file)
- [x] Chip view: SVG package render, pin numbering CCW from pin 1, labels outside, zoom/fit
- [x] Pin click → signal picker; assign / reset; colour by state
- [x] Left tree: categories → peripherals, with ✓ / ⚠ / ⊘ status like CubeMX
- [x] Centre panel: mode + remap selection, GPIO settings table
- [x] Conflict engine v1: pin claimed twice → orange on both, peripheral gets ⚠
- [x] Conflict engine v2: shorted pin pairs = one physical pin; picker warns "pin in use" / "remap collides on …" BEFORE you pick; conflict banner in centre header; toast on every new conflict; package switch re-checks everything
- [x] Data format: pin number → list of names (shorted), pin 0 = exposed pad, `default: true` choices, `remap_by_package`
- [x] Clock Configuration tab v1: source → PLL → SYSCLK → AHB/APB/ADC with limit warnings
- [x] "Load MCU file" (pick a YAML from disk in the browser)
- [x] Package switch keeps assignments that still exist, warns about dropped pins + issue count
- [x] Right-click pin → user label (context menu: label / assign / reset / copy; label drawn on chip + GPIO table)
- [x] Search box in left tree and in chip view (find pin / signal)
- [x] "Show only modified pins" filter (chip toolbar checkbox)
- [x] Keyboard: Esc closes picker, arrow keys move between pins, Enter opens picker, L labels, Del resets
- [x] Save / load project (`.wchproj` YAML: mcu, variant, package, all settings, clock) — Ctrl+S / Open project…
- [x] New Project dialog: pick MCU → part number / package (with flash, SRAM, I/O count, temp grade) → name; one project per MCU+package
- [x] System view (block diagram): buses from `clock.buses`, blocks coloured by status, click to configure

## Phase 2 — Real MCU data  (open items carry into round 3)

- [x] Extraction checklist (see `data/mcus/CH32V006.notes.md` — reuse the table for the next part)
- [x] EXTI line→pin map + DMA1 channel map + option-byte RST_MODE + TIM1_1_RM (CH1→LSI) + TIM2 complementary outputs, all for CH32V006 (AGENT-1)
- [x] `tools/validate_mcu.py` — schema, pin existence, signal parity across remaps, package numbering, DS I/O counts, EXTI line legality (AGENT-1)
- [x] Third pass: remap tables cross-checked against the AFIO_PCFR1 register prose (RM 7.3.2.2) — 227/228 confirmed by both, 1 source self-contradiction found (AGENT-1)
- [~] (AGENT-1) `data/FORMAT.md` — full YAML schema, every field explained, kept in sync with the engine
- [x] (AGENT-1) CH32V005 via `inherits: CH32V006` — drops TKEY, TIM3, the QFN32 package and OPA polling;
      pinout verified against DS Table 2-2 by `tools/extract_pins.py` (25 I/O rows, 0 differences)
- [x] (AGENT-1) `codegen:` block for CH32V006 — AFIO_PCFR1 and RCC_CFGR0 encodings read off the RM,
      plus `analog_signals` and `codegen.periph_clock` (HB/PB2/PB1 enable-register membership)
- [x] (AGENT-1) `params:` for USART1/2, SPI1, I2C1, TIM1, TIM2, ADC1 — 35 parameters, all 19 enums
      carrying the RM's register encoding; schema documented in `data/FORMAT.md`
- [x] (AGENT-1) `tools/extract_pins.py` — re-derives package pin tables from a DS pin table and diffs
- [ ] CH32V003 and later parts — waiting on their DS/RM markdown in `data/sources/` (HUMAN_TODO 4)
- [ ] First real part (candidate: CH32V003F4P6 TSSOP20, then CH32V203C8T6 LQFP48)
- [x] Validate extracted YAML against PDF (spot check every remap group) — AGENT-1: `tools/extract_remaps.py` re-derives RM 7.2.11 independently and diffs; 232 pin assignments, 0 differences
- [x] Per-pin notes (SWIO/SWCLK, XI/XO, RST-per-package); [-] 5V-tolerance — the V006 DS does not state it per pin, nothing to extract (AGENT-1)
- [x] V00x clock tree (HB domain, ADCPRE incl. /1 ADC_CLK_MODE)  [ ] other families (V003: HSI 24 MHz & PLL x2; V20x/V30x: F1-style with PLL mults; L103; X035)

## Round 2 — fully functional and polished  (NOT finished — open items carry into round 3 as C1–C8)

See `Agents Rounds 2/00_PROJECT.md`. Data lines only; the other three areas track their own.

- [x] (AGENT-1) HSE coupling data — `clock.hse_peripheral` / `hse_setting` / `hse_signals` on
      CH32V006, CH32V005 (inherited) and the dummy part, which spells the same pins
      OSC_IN/OSC_OUT so a hardcoded XI/XO cannot hide
- [x] (AGENT-1) HSE range corrected 25 → 32 MHz (DS Tables 3-9 and 3-10); the old value had
      no citation and came from a footnote about crystal ESR
- [x] (AGENT-1) `codegen.ctlr` (RCC_CTLR: HSEON/HSEBYP/PLLON and the write-order rules) and
      `codegen.rcc.mco`, so picking HSE or an MCO source reaches generated C
- [x] (AGENT-1) `dma.channel_params` + `dma.request_defaults` + `dma.register` — every
      DMA_InitTypeDef field the user picks, all 23 requests given starting values
- [x] (AGENT-1) `nvic:` — 29 vectors from RM Table 6-1 with owners, plus the PFIC priority
      scheme (two bits, not the Cortex-M four)
- [x] (AGENT-1) PWR, FLASH and EXTI added as real peripherals; RM chapter list now covered
      except four deliberate absences recorded in CH32V006.notes.md
- [x] (AGENT-1) validate_mcu.py: HSE coupling, codegen names, dma and nvic checks — 14
      planted breaks, 14 caught
- [ ] (AGENT-1) WCH-DUMMY32-C8 has no `dma` / `nvic` / `params` / `codegen` blocks, so the
      new tabs have nothing to render on a large package
- [ ] (AGENT-1) `params:` for TIM3, IWDG, WWDG, TKEY, OPA1
- [ ] (AGENT-1) Medium-confidence rows: TouchKey channel→pin (RM ch.10), OPA polling set

### Firmware / project setup  (AGENT-4) — done; the follow-ups are round-3 lines below

Status detail and the reasoning behind each of these lives in `PROGRESS.md`, which is now the
standing source of truth for project progress. AGENT-4 owns it and keeps it true.

- [x] (AGENT-4) `data/firmware/` — a complete PlatformIO project on platform `ch32v` +
      framework `noneos-sdk`. Four environments (CH32V006 TSSOP20 + QFN32, CH32V005 TSSOP20,
      CH32X035), all building offline; `pio check` clean. SDK-style layering with components as
      PlatformIO libraries — `data/firmware/ARCHITECTURE.md`.
- [x] (AGENT-4) `lib/wchcube_generated/` drop zone: `tools/wchcube_cli.js --format c --out …`
      output is compiled and linked automatically through `__has_include` in `src/main.c`.
- [x] (AGENT-4) `data/sources/README.md` — EVT packages will be provided per MCU under
      `data/sources/<PART>/Evt/` and are the top authority for every name the software uses.
- [x] (AGENT-4) `PROGRESS.md` at the repo root.

## Round 3 — the generated code is the product  (CURRENT)

Brief: `Agents Rounds 3/00_PROJECT.md`. One file per agent beside it; board is
`Agents Rounds 3/BOARD.md`; acceptance script is `Agents Rounds 3/WALKTHROUGH.md`.

The round's rule: **a name nobody compiled is a guess.** `data/firmware/` builds the generated C
for real silicon, so "generated C compiles" is a gate now, not an aspiration. Claim a line with
`[~] (AGENT-n)` as always.

### C — carried over from round 2. These outrank everything below.

- [ ] C1 (AGENT-3) The 8 measured text-legibility findings (L1–L8), evidence in
      `tests/evidence/round2/2026-09-11.md`
- [ ] C2 (AGENT-3) DMA Settings tab + the DMA1 channel table in System Core
- [ ] C3 (AGENT-3) NVIC Settings tab + the NVIC overview in System Core — PFIC has **two**
      priority bits, not four; take the ranges from `nvic.scheme`
- [x] C4 (AGENT-2) `mcu.remove` is applied after the parent merge, so a child that removes *and*
      redefines a path loses its own version (cost CH32V005 its whole DMA request map)
      — fixed: `remove` now runs against the parent, before the merge; 5 tests
- [x] C5 (AGENT-2) `setSetting()` on a `checkboxes` setting replaces the Set with a String and the
      next `compute()` blanks the app — fixed: rejected by name, points at `toggleSetting`; 3 tests
- [ ] C6 (AGENT-3) `#mcusel` shows the wrong part at boot; `#pkgsel` keeps the old package after a
      project load
- [ ] C7 (AGENT-1) `WCH-DUMMY32-C8` has no `dma` / `nvic` / `params` / `codegen`, so every new tab
      is exercised on exactly one part
- [ ] C8 (AGENT-4) `tests/completeness.test.js`

### P0 — the two codegen defects, and the rule behind them

- [ ] (AGENT-1) `codegen.header: ch32v00x.h` on CH32V006 is the **CH32V003** header; this part is
      `ch32v00X.h`. Builds on Windows only because NTFS ignores case.
- [ ] (AGENT-1) `codegen.speeds` names GPIO_Speed_2MHz/10MHz/50MHz, none of which exist here —
      `GPIOSpeed_TypeDef` has one member, `GPIO_Speed_30MHz` (RM 7.3.1.1: MODEy is a single bit).
      Add a capability key the UI can read; **a one-entry list means the control is not shown.**
- [ ] (AGENT-2) Emit the part's one speed macro; never a Low/Medium/High mapping
- [ ] (AGENT-3) Remove the GPIO speed select where the data says there is one speed — show the
      fixed value as text, driven by the data, never by a hardcoded part name
- [ ] (AGENT-1) `tools/verify_sdk_names.py` — check every `codegen:` / `params:` / `dma:` /
      `nvic:` name a part claims against that part's SDK headers, suggest the closest match on a
      miss, say "no SDK for series X, not checked" rather than passing silently. Planted-break
      tested like `validate_mcu.py` was.
- [ ] (AGENT-4) Wire `verify_sdk_names.py` into `node tests/run.js`
- [ ] (AGENT-4) **The compile gate**: `tests/codegen_compile.test.js` — generate from fixtures
      that assign pins, params, DMA and NVIC, then `pio run` for CH32V006 TSSOP20 + QFN32 and
      CH32V005 TSSOP20. Skips with a printed reason when `pio` is absent; never silently.
- [ ] (AGENT-1) Mark the port-clock spelling in `CH32V006.notes.md` confirmed — `RCC_PB2PeriphClockCmd`,
      `RCC_PB2Periph_GPIOx`, `RCC_PB2Periph_AFIO` and `AFIO->PCFR1` all verified in the SDK headers

### P1 — the code generation UI

- [ ] (AGENT-3) **Project Manager tab** on the dead `disabled title="Future"` placeholder: project
      info, toolchain (PlatformIO + the env it maps to), generator options, Generate
- [ ] (AGENT-3) **Preview**: file list + the real text of the selected file, read-only, with TODO
      and `#error` lines visually obvious. Two of this round's P0 bugs were single wrong
      identifiers in generated C — this is the panel that shows them to a human.
- [ ] (AGENT-3) `Tools` tab: implement it or remove it. A dead tab is a dead control.
- [ ] (AGENT-2) `generateAll()` returns `{ name, language, text }` per file so the UI can list and
      preview without knowing what codegen produces
- [ ] (AGENT-2) Generator options in `S.project`, round-tripped in `.wchproj` and undoable
- [ ] (AGENT-2) User code sections preserved across regeneration — or the option is **not offered**
- [ ] (AGENT-4) Tauri command to write generated files to a chosen folder, next to `save_project`

### P2 — configuration must reach the C

- [ ] (AGENT-1) `params:` carry `struct:` and `field:` so codegen does not infer the SDK mapping;
      every enum option's macro verified against the headers
- [ ] (AGENT-2) `params:` → `USART_InitTypeDef` / `SPI_InitTypeDef` / `I2C_InitTypeDef` /
      `TIM_TimeBaseInitTypeDef` / `TIM_OCInitTypeDef` / `ADC_InitTypeDef` + the `*_Init()` call
- [ ] (AGENT-2) DMA → `DMA_InitTypeDef` + `DMA_Init` + `DMA_Cmd` + the DMA1 clock enable; a
      double-booked channel produces `#error`, not last-wins code. Warn on the SPI1 16-bit /
      half-word coupling nothing enforces today.
- [ ] (AGENT-2) NVIC → the enabled vectors with PFIC priorities; claim no register write for the
      nesting switch, which this RM does not document
- [ ] (AGENT-2) Regenerating after save → close → open produces **byte-identical** C
- [ ] (AGENT-2) `tools/wchcube_cli.js --pio <dir>` writes the header to `include/` and the source
      to `src/`; `--strict` fails on an emitted TODO or `#error`
- [ ] (AGENT-1) `params:` for TIM3, IWDG, WWDG, TKEY, OPA1
- [ ] (AGENT-4) Host-side unit tests for `lib/util` under a `[env:native]`

### P3 — more parts, now that there is a compiler

- [ ] (AGENT-1) `data/mcus/CH32X035.yaml` from `data/sources/X035/Datasheets/`. Confirmed and
      **different from the V00x family**: ports A/B/C only, `RCC_APB2PeriphClockCmd`, one speed
      `GPIO_Speed_50MHz`, no `ADCCLK_Frequency` in `RCC_ClocksTypeDef`.
- [ ] (AGENT-1) When an EVT package lands in `data/sources/<PART>/Evt/`: re-run `verify_sdk_names.py`
      against it, re-check every Medium-confidence row, and post what changed
- [ ] (AGENT-1) Medium-confidence rows still open: TouchKey channel→pin (RM ch.10), the OPA
      polling set, and the RM Table 6-1 TIM3-vector contradiction — all first in the queue the day
      EVT arrives

### Housekeeping

- [ ] (AGENT-4) Correct `agents/README.md` "Environment facts" — `cargo` 1.98.1 and a C compiler
      both exist now; four agents read that file as ground truth
- [ ] (AGENT-4) Compile `src-tauri/` locally; resolve the uncommitted `open_project` fix and the
      untracked `Cargo.lock` deliberately
- [ ] (AGENT-4) Finish the dead-control sweep; `#m-open` / `#m-openproj` need a human or a stub
- [ ] (AGENT-4) Round-3 section in `agents/DONE.md`; re-audit the round-1 and round-2 lines
- [ ] (AGENT-1) Stale source paths in `data/FORMAT.md`, `CH32V006.notes.md` and
      `tools/extract_remaps.py` — they still name the pre-reorganisation `data/sources/*.md`
- [ ] (AGENT-4) The human's `Taskfile.yml` is a stub. Make it the real task runner (build, test,
      firmware, validate) or leave it alone and say so — do not half-adopt it.

## Phase 3 — Code / report generation  (FUTURE — keep hooks, do not build yet)

- [x] (AGENT-2) Pin table export (markdown + CSV) + clock summary (markdown) — `app/engine/export.js`
- [x] (AGENT-2) Clock init as C — RCC mux/prescaler word from `codegen.rcc`; needs that block in the MCU file
- [x] (AGENT-2) GPIO init as C — `GPIO_InitTypeDef` blocks grouped per port by mode and speed, plus the AFIO remap word
- [x] (AGENT-2) `Generate` button wired — downloads the pin table, the clock summary and `wchcube_init.c/.h`

## Phase 4 — Desktop app

- [x] Tauri shell, native open/save dialogs, MCU folder watcher (auto reload on YAML edit) (AGENT-4)
      `src-tauri/` — window "WCH_CubeMX" over `dist/index.html`; commands `list_mcus`,
      `read_mcu`, `open_mcu`, `save_project`, `open_project`, `user_mcu_folder`; a notify
      watcher emits `mcu-changed` and the part reloads in place. The page has NO Tauri code:
      `src-tauri/desktop.js` is injected as the window's initialization script, so browser
      mode is untouched. **Not yet compiled** — no cargo here; the CI desktop job builds it.
- [x] Bundled `data/` folder + user override folder (AGENT-4)
      `tauri.conf.json` ships `data/mcus` and `data/packages` as resources;
      `~/.wch_cubemx/mcus/` overrides them by MCU name.

## QA + release  (AGENT-4)

- [x] `npm test` — one runner over `app/tests/*` (engine) and `tests/*` (QA), 131 tests
- [x] `tests/smoke.js` — every MCU × every package: load, switch, click, assign, silent console
- [x] `tools/validate_mcu.py` — schema, geometry, pin existence, remap consistency, I/O counts, clock, EXTI
- [x] `tests/build.test.js` — dist is complete, current, offline, and free of duplicate declarations
- [x] `tests/layout.test.js` — CubeMX structure + the chip fits at 1280×720 and 1920×1080
- [x] `tests/desktop.test.js` — Tauri config, command surface, and the bridge driven against a fake runtime
- [x] `tests/features.test.js` — evidence for the DONE.md feature lines + an engine coverage gate
- [x] `.github/workflows/ci.yml` — Node 22 + Python 3.12: validate → build → stale-dist → tests, plus a Linux Tauri build
- [x] README — browser, desktop, adding an MCU, the file format, the tests, the agent workflow
- [ ] CI has never actually run: the repo has no remote. Needs a human to add one.
- [x] Engine unit tests reach 100% of `app/engine/*` exports (AGENT-2 closed it with `app/tests/api.test.js`)
- [x] (AGENT-1 + AGENT-3) QFN12→LQFP144 overflow: AGENT-1 added LQFP64/100/144 to the dummy part; AGENT-3 swept every part × package × 4 rotations × mirrored at 1280/1920/2560 — 384 combinations, no overflow, no label collisions, no console output. Test proposed to AGENT-4 in `agents/proposals/layout-orientation.test.js`

---

## Session log

**2026-09-11** — Chose stack. Built package library (23 packages), dummy MCU, and first working UI:
pinout view, signal picker, peripheral tree with status, mode/remap panel, GPIO table, clock tab.
Next: package-switch behaviour, user labels, search, project save/load. Then start real CH32V003 data.

**2026-09-11 (V006)** — Extracted CH32V006 from DS v2.0 + RM v1.4 into `data/mcus/CH32V006.yaml` (packages QFN32/QSOP24/QFN20/TSSOP20/QFN12, TIM1/TIM2/USART1/USART2/SPI/I2C remap tables, ADC/TKEY/OPA, clock). Engine extended for shorted pins, exposed pad, per-package reset pin, and loud conflict reporting. Added QSOP24 + QFN12 geometries. Next: user spot-check, then EXTI/DMA maps, project save/load, user labels.

**2026-09-11 (agents)** — Added `agents/` pack: README (roles, ownership, git worktrees, work cycle), BOARD.md, DONE.md, four agent briefs, `run_agents.sh` launcher with permissions bypassed. Sources stashed in `data/sources/`, CubeMX reference screenshot in `agents/reference/`.

**2026-09-11 (projects)** — New Project dialog (MCU → variant/package list from `mcu.variants`), Save project (.wchproj download, Ctrl+S), Open project (validates MCU is loaded, restores every setting incl. remaps/checkbox sets/clock), dirty marker `*` in breadcrumb, unload warning. Round-trip test passes.

**2026-09-11 (AGENT-1 data pass)** — Second-pass verification of CH32V006 remaps: `tools/extract_remaps.py`
re-parses RM 7.2.11 with its own parser and diffs the YAML — 7 peripherals, 31 signal rows, 232 pin
assignments, **0 differences**, and it is negative-tested against planted edits. Added `tools/validate_mcu.py`
(both MCU files pass). Added to CH32V006: EXTI line→pin map, DMA1 request map, option-byte RST_MODE,
TIM1_RM=11xx CH1-from-LSI, TIM2 complementary outputs on the CH3/CH4 pins, and DS I/O counts per variant.
Fixed four live YAML-corruption bugs where an unquoted comma inside `{ }` truncated a name — see BOARD.
Blocked on AGENT-2 for `inherits:` (CH32V005) and on missing sources for CH32V003 and later parts.

**2026-09-11 (AGENT-2, engine)** — Split the engine out of `app/template.html` into `app/engine/*.js`
(model, inherit, clock, engine, project, export) as ES modules with no DOM access; `build.py` inlines them
so `dist/index.html` stays one file, and Node imports the same modules for the tests. Added `app/tests/`
(63 engine tests) on AGENT-4's `node tests/run.js`; V8 function coverage of `app/engine/*` is 82/82 = 100%.
Vendored js-yaml into `app/vendor/` and dropped the cdnjs tag, so the built app has zero network
references and opens offline. Fixed two real bugs the tests caught: `resetPin()` could not release a pin
whose owning choice is `choices[0]` (CH32V006 ships with the external reset pin ENABLED, so right-click
reset on PD7 did nothing), and a manual GPIO did not clear the other name of a shorted pin. Implemented
`mcu.inherits:` (maps merge, lists replace, `mcu.remove:` for deletions, `mcu.variants` replaced) which
unblocks AGENT-1 on CH32V005. Wired the GENERATE CODE button to the pin table and clock summary exports.
Next: undo/redo over `S`, then C codegen (GPIO init, AFIO_PCFR1 from remap indices, RCC from clock state).

**2026-09-11 (QA + release, AGENT-4)** — Put the project under git (it was not a repo) and took over the
merge gate. Built the test runner both areas share, a jsdom driver that drives the real built app, and the
MCU×package smoke test. Wrote `tools/validate_mcu.py` and made it a gate. Wrote the Tauri 2 shell, injected
rather than wired into the page, with native dialogs and YAML hot reload. Added CI, the README and the
layout/feature suites, and audited `DONE.md` so every tick names the test that proves it — 10 of 21.
Caught one app-killing bug: `userLabel`/`pinModified` declared in both the engine and the template made the
bundle a SyntaxError and the page blank; there is now a test that names any such clash. Fixed the test
flakiness AGENT-2 reported (four agents writing one tree). Not done: nothing has compiled the Rust and CI
has never run, because there is no remote.

**2026-09-11 (AGENT-2, cycle 2)** — Undo/redo over `S` (snapshot stack, 100 steps, Ctrl+Z / Ctrl+Y,
view state excluded) and the state writers that feed it, so anything routed through the engine is
undoable. C code generation: `wchcube_init.c/.h` in WCH EVT SDK style — GPIO_InitTypeDef blocks per
port, the AFIO remap word and the RCC word. It never guesses register bit positions: what it cannot
derive becomes a TODO naming exactly what is missing, so a `codegen:` block in the MCU file turns
those sections into real writes. Generating exposed two hardware bugs, both fixed: SWIO/RST were
being configured with GPIO_Init (driving the reset pin push-pull is harmful) and ADC channels came
out as AF_PP instead of AIN. Consumed AGENT-1's `exti:` and `dma:` blocks: two ports on one EXTI line
is a conflict, two peripherals live on one DMA channel is a warning. Engine is 11 modules, 180 tests,
100% function coverage; `compute()` runs in 0.43 ms on a synthetic 144-pin part against a 5 ms budget.

**2026-09-11 (AGENT-3, cycle 3)** — All five cycle-3 UI priorities. Shared-resource issues (EXTI lines,
DMA channels) stopped borrowing the orange that means "two things want one pin": their own token in both
themes, dashed issue lines, a second non-orange tree badge and a strip under the panel title so a clash is
visible whatever is selected. The peripheral tree gained the CubeMX Categories / A→Z toggle and a gear menu
(expand all, collapse all, show enabled only). The chip toolbar gained rotate 90°, mirror and export-as-SVG:
both transforms rewrite the finished geometry rather than the canvas, so every label stays upright without a
counter-rotation, and the exported file embeds the page stylesheet and the current theme. Pin search became a
real combobox with a result list the arrow keys walk. The Parameter Settings tab is built and rendering
against `app/assets/params.stub.yaml` — grouped, foldable, one editor per type, dependency greying, read-only
computed rows — and turns editable the moment AGENT-2's setParam() lands. The package selector shows temp
grades. With AGENT-1's big dummy packages in place, the QFN12→LQFP144 overflow line is now genuinely covered.

**2026-09-11 (AGENT-1, round 2 cycle 1)** — The data behind the reported clock bug, then the
data the DMA/NVIC gap needs. Three facts were wrong or missing rather than merely absent, and
each was found by checking rather than by reading: HSE's maximum was 25 MHz with no citation
anywhere (both datasheet tables say 32; the 25 is a footnote about crystal ESR); CH32V005
inherited two `codegen` entries for peripherals it does not have, so its generated code would
have configured TouchKey pins and a TIM3 clock; and CH32V005 has been shipping with **no DMA
request map at all**, because `mcu.remove` runs after the merge and deleted the replacement the
child defined right below it — reproduced through the app's own `resolveInherits()`, not just
the validator. Added `dma.channel_params` (every DMA_InitTypeDef field, DMA_CFGRx encodings from
RM 8.3.3) deliberately in the same schema as `params:` so the UI needs no new editors, all 23
`request_defaults`, `nvic:` with the whole vector table, and PWR / FLASH / EXTI as real
peripherals. The PFIC's priority scheme is two bits, not the Cortex-M four — worth knowing
before anyone builds a 0-15 priority spinner. validate_mcu.py grew four checks covering all of
it, each negative-tested; 14 planted breaks, 14 caught.

**2026-09-11 (AGENT-1 cycle 2)** — Worked the queue in `agents/AGENT_1_DATA.md`. CH32V005 shipped via
`inherits`, with a new `tools/extract_pins.py` that re-derives package tables from the datasheet and
refuses to guess when a row's cells cannot be tied to columns. Large dummy packages pasted in, closing
the QFN12..LQFP144 range. `codegen:` and `params:` blocks written for CH32V006 with every bit position
read off the reference manual, which caught four errors in the proposals: ADCPRE /6 is 16 not 8 (8
encodes /4), ADCPRE has no /1 code at all (that is ADC_CLK_MODE at bit 31), SPI has no TI frame format
on this family, and the ADC sampling-time list was wrong in every middle entry. Also corrected my own
earlier claim that this part has no PB1/PB2 split — it has one prescaler but three clock enable
registers. Three tests are red and none needs a data change; verified fixes are on the board.
