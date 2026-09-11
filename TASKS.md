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
- [~] (AGENT-3) Right-click pin → user label
- [x] Search box in left tree and in chip view (find pin / signal)
- [~] (AGENT-3) "Show only modified pins" filter
- [x] Keyboard: Esc closes picker  [~] (AGENT-3) arrow keys move between pins
- [x] Save / load project (`.wchproj` YAML: mcu, variant, package, all settings, clock) — Ctrl+S / Open project…
- [x] New Project dialog: pick MCU → part number / package (with flash, SRAM, I/O count, temp grade) → name; one project per MCU+package
- [ ] System view (block diagram) — low priority

## Phase 2 — Real MCU data  (CURRENT)

- [x] Extraction checklist (see `data/mcus/CH32V006.notes.md` — reuse the table for the next part)
- [ ] First real part (candidate: CH32V003F4P6 TSSOP20, then CH32V203C8T6 LQFP48)
- [ ] Validate extracted YAML against PDF (spot check every remap group)
- [x] Per-pin notes (SWIO/SWCLK, XI/XO, RST-per-package); [ ] 5V-tolerance not stated per pin in V006 DS
- [x] V00x clock tree (HB domain, ADCPRE incl. /1 ADC_CLK_MODE)  [ ] other families (V003: HSI 24 MHz & PLL x2; V20x/V30x: F1-style with PLL mults; L103; X035)

## Phase 3 — Code / report generation  (FUTURE — keep hooks, do not build yet)

- [ ] Pin table export (markdown + CSV)
- [ ] Clock init as C (RCC register writes) for WCH EVT SDK
- [ ] GPIO init as C
- [ ] `Generate` button is present in the toolbar but disabled — wire it here

## Phase 4 — Desktop app

- [ ] Tauri shell, native open/save dialogs, MCU folder watcher (auto reload on YAML edit)
- [ ] Bundled `data/` folder + user override folder

---

## Session log

**2026-09-11** — Chose stack. Built package library (23 packages), dummy MCU, and first working UI:
pinout view, signal picker, peripheral tree with status, mode/remap panel, GPIO table, clock tab.
Next: package-switch behaviour, user labels, search, project save/load. Then start real CH32V003 data.

**2026-09-11 (V006)** — Extracted CH32V006 from DS v2.0 + RM v1.4 into `data/mcus/CH32V006.yaml` (packages QFN32/QSOP24/QFN20/TSSOP20/QFN12, TIM1/TIM2/USART1/USART2/SPI/I2C remap tables, ADC/TKEY/OPA, clock). Engine extended for shorted pins, exposed pad, per-package reset pin, and loud conflict reporting. Added QSOP24 + QFN12 geometries. Next: user spot-check, then EXTI/DMA maps, project save/load, user labels.

**2026-09-11 (agents)** — Added `agents/` pack: README (roles, ownership, git worktrees, work cycle), BOARD.md, DONE.md, four agent briefs, `run_agents.sh` launcher with permissions bypassed. Sources stashed in `data/sources/`, CubeMX reference screenshot in `agents/reference/`.

**2026-09-11 (projects)** — New Project dialog (MCU → variant/package list from `mcu.variants`), Save project (.wchproj download, Ctrl+S), Open project (validates MCU is loaded, restores every setting incl. remaps/checkbox sets/clock), dirty marker `*` in breadcrumb, unload warning. Round-trip test passes.
