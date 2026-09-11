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
Four autonomous agents (DATA / ENGINE / UI / QA+RELEASE) work this file. See `agents/README.md`.
Claim with `[~] (AGENT-n)`. Communicate only via `agents/BOARD.md`. Done = all of `agents/DONE.md`.

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

## Phase 2 — Real MCU data  (CURRENT)

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

## Round 2 — fully functional and polished  (CURRENT)

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
