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
| `Agents Rounds 4/00_PROJECT.md` | the round brief — read first, every cycle |
| `Agents Rounds 4/AGENT_n_*.md` | your standing instructions + your "Current" section |
| `Agents Rounds 4/BOARD.md` | the message board for this round (append-only) |
| `Agents Rounds 4/WALKTHROUGH.md` | the acceptance script: a second family, and a folder you can flash |
| `PROGRESS.md` | where the project actually stands (AGENT-4 keeps it true) |

Claim with `[~] (AGENT-n)`. Communicate only via the board. Done = all of `agents/DONE.md`.
Earlier boards (`agents/BOARD.md`, `Agents Rounds 2/BOARD.md`, `Agents Rounds 3/BOARD.md`) are
history and still binding — read the last entries of the round-3 board before your first cycle.

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
- [x] (AGENT-1) `params:` for TIM3, IWDG, WWDG, TKEY, OPA1 — all done. OPA1 6 params; TIM3 5;
      IWDG 3 and WWDG 3, both struct-free and handle-free; TKEY needs none, being an ADC mode
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

## Round 3 — the generated code is the product  (open items carry into round 4 as D1–D9)

Brief: `Agents Rounds 3/00_PROJECT.md`. One file per agent beside it; board is
`Agents Rounds 3/BOARD.md`; acceptance script is `Agents Rounds 3/WALKTHROUGH.md`.

The round's rule: **a name nobody compiled is a guess.** `data/firmware/` builds the generated C
for real silicon, so "generated C compiles" is a gate now, not an aspiration. Claim a line with
`[~] (AGENT-n)` as always.

### C — carried over from round 2. These outrank everything below.

- [x] C1 (AGENT-3) The 8 measured text-legibility findings (L1–L8), evidence in
      `tests/evidence/round2/2026-09-11.md` — all eight re-measured in a real browser
      before and after, 216 checks over 3 part/package combinations × 1280/1920 ×
      100/125 % × light/dark, all green, console silent
- [x] C2 (AGENT-3) DMA Settings tab + the DMA1 channel table in System Core — requests with
      Add/Delete, the `DMA_InitTypeDef` block through the Parameter Settings editors, the
      channel as fixed text where the part offers one, and a double-booked channel as a hard
      conflict naming both owners
- [x] C3 (AGENT-3) NVIC Settings tab + the NVIC overview in System Core — one table for both,
      ranges read off `nvic.scheme` (CH32V006 offers 0/1 and 0/1, the dummy part 0-7 and 0-1),
      the grouping selector, and `fixed:` vectors as "always on" rather than a dead checkbox
- [x] C4 (AGENT-2) `mcu.remove` is applied after the parent merge, so a child that removes *and*
      redefines a path loses its own version (cost CH32V005 its whole DMA request map)
      — fixed: `remove` now runs against the parent, before the merge; 5 tests
- [x] C5 (AGENT-2) `setSetting()` on a `checkboxes` setting replaces the Set with a String and the
      next `compute()` blanks the app — fixed: rejected by name, points at `toggleSetting`; 3 tests
- [x] C6 (AGENT-3) `#mcusel` shows the wrong part at boot; `#pkgsel` keeps the old package after a
      project load — both re-read from the model on every render, and `#mcusel` is
      labelled "Load part:" so it no longer reads as "the part you have"
- [x] C7 (AGENT-1) `WCH-DUMMY32-C8` has no `dma` / `nvic` / `params` / `codegen`, so every new tab
      is exercised on exactly one part — done, and deliberately DIFFERENT from CH32V006:
      three GPIO speeds, four NVIC priority bits, nine DMA channel params, APB2 spelling
- [x] C8 (AGENT-4) `tests/completeness.test.js` — per-peripheral matrix over every real part
      (settings / params / clock bit / vectors), DMA-request ownership both ways, generated C
      reached by every peripheral that holds a pin, and the RM chapter list read out of the
      reference manual at run time. Deliberate absences are declared with an EVT citation;
      known-open cells print every run and are guarded against their TASKS.md line vanishing.
      Found RM ch.20 (EXTEN) uncovered and undeclared — new line above. 3 planted breaks, 3 caught.

### P0 — the two codegen defects, and the rule behind them

- [x] (AGENT-1) `codegen.header: ch32v00x.h` on CH32V006 is the **CH32V003** header; this part is
      `ch32v00X.h`. Builds on Windows only because NTFS ignores case. — fixed, cited to EVT
      `ch32v00X.h`:2/:12; compiled with 12 pins assigned
- [x] (AGENT-1) `codegen.speeds` names GPIO_Speed_2MHz/10MHz/50MHz, none of which exist here —
      `GPIOSpeed_TypeDef` has one member, `GPIO_Speed_30MHz` (RM 7.3.1.1: MODEy is a single bit).
      Add a capability key the UI can read; **a one-entry list means the control is not shown.**
      — `gpio.speeds: [{name, macro}]`, documented in FORMAT.md, handed off to AGENT-2/AGENT-3
- [x] (AGENT-2) Emit the part's one speed macro; never a Low/Medium/High mapping
      — driven by `gpio.speeds`; `gpioSpeeds()` / `gpioSpeedIsChoice()` / `gpioSpeedFor()`
- [x] (AGENT-3) Remove the GPIO speed select where the data says there is one speed — show the
      fixed value as text, driven by the data, never by a hardcoded part name. Measured in a
      browser: CH32V006/CH32V005 (one speed) render 0 selects and fixed text, WCH-DUMMY32-C8
      (three) renders selects with exactly those three. No part name in the code path.
- [x] (AGENT-1) `tools/verify_sdk_names.py` — check every `codegen:` / `params:` / `dma:` /
      `nvic:` name a part claims against that part's SDK headers, suggest the closest match on a
      miss, say "no SDK for series X, not checked" rather than passing silently. Planted-break
      tested like `validate_mcu.py` was.  **EVT has landed** — headers are at
      `data/sources/<PART>/Evt/EXAM/SRC/Peripheral/inc/`, so EVT first, PlatformIO as fallback.
- [x] (AGENT-1) FOUND BY IT: `nvic` vector 29 claimed `ADC1_IRQn`, which exists in neither the
      IRQn_Type enum nor the startup table. Vectors now carry `irqn` AND `handler`; all 29 pairs
      extracted mechanically from EVT. The TIM3-vector contradiction is settled — EVT confirms
      there is no TIM3 vector, so the round-2 decision not to invent one was right.
- [ ] (AGENT-4) Wire `verify_sdk_names.py` into `node tests/run.js`
- [x] (AGENT-4) **The compile gate**: `tests/codegen_compile.test.js` — generates from fixtures
      that assign pins and params, then `pio run` for CH32V006 TSSOP20 + QFN32 and CH32V005
      TSSOP20; all three compile and link. Skips loudly with a printed reason and a count in the
      summary when `pio` is absent. Three planted breaks, three caught. DMA and NVIC join the
      fixtures the moment `.wchproj` carries them (AGENT-2's P2).
- [x] (AGENT-1) Mark the port-clock spelling in `CH32V006.notes.md` confirmed — `RCC_PB2PeriphClockCmd`,
      `RCC_PB2Periph_GPIOx`, `RCC_PB2Periph_AFIO` and `AFIO->PCFR1` all verified in the SDK headers
      — re-cited to EVT `ch32v00X_rcc.h`:157/:88/:89-92 and `ch32v00X.h`:197

### P1 — the code generation UI

- [x] (AGENT-3) **Project Manager tab** on the dead `disabled title="Future"` placeholder: project
      info, toolchain (PlatformIO + the env it maps to), generator options, Generate. The env
      name is NOT derived from the part number — platformio.ini maps CH32V006F8P7 to
      CH32V006F8P6 — so it reads `variants.<part>.pio_env` and says where the answer is until
      that key lands (requested from AGENT-1)
- [x] (AGENT-3) **Preview**: file list + the real text of the selected file, read-only, with TODO
      and `#error` lines visually obvious. Two of this round's P0 bugs were single wrong
      identifiers in generated C — this is the panel that shows them to a human. Marks come
      from the engine's own `cComplaints()`, not a scanner of the UI's; verified end to end on
      a real defect (a GPIO on the shorted PD7/PA4 pair → `#error` on line 15)
- [~] (AGENT-3) `Tools` tab: implement it or remove it. A dead tab is a dead control.
      Blocked on `tests/layout.test.js`, which asserts the four tab names and is AGENT-4's
      file — requested on the board 15:47Z. It is the last `disabled` control in the app.
- [x] (AGENT-2) `generateAll()` returns `{ name, language, text }` per file so the UI can list and
      preview without knowing what codegen produces
- [x] (AGENT-2) Generator options in `S.project`, round-tripped in `.wchproj` and undoable
      — `generatorOptions()` lists only what the engine honours; the per-peripheral split is
      **not offered** rather than offered and broken (BOARD 16:22Z)
- [x] (AGENT-2) User code sections preserved across regeneration — or the option is **not offered**
      — `mergeUserCode()`, a configuration-independent tag set, and orphaned blocks kept under `#if 0`
- [ ] (AGENT-4) Tauri command to write generated files to a chosen folder, next to `save_project`

### P2 — configuration must reach the C

- [x] (AGENT-1) `params:` carry `struct:` and `field:` so codegen does not infer the SDK mapping;
      every enum option's macro verified against the headers — 35 params, 64 option macros,
      all from EVT and all checked by verify_sdk_names.py. Three are NOT struct members
      (`sdk_call:`) and ADC lowpower has no SDK surface at all (`sdk_none:`)
- [x] (AGENT-2) `params:` → `USART_InitTypeDef` / `SPI_InitTypeDef` / `I2C_InitTypeDef` /
      `TIM_TimeBaseInitTypeDef` / `TIM_OCInitTypeDef` / `ADC_InitTypeDef` + the `*_Init()` call
      — plus `sdk_call`/`sdk_args`/`sdk_repeat`/`sdk_none`/`no_handle`; compiled on 3 fixtures
- [x] (AGENT-2) DMA → `DMA_InitTypeDef` + `DMA_Init` + `DMA_Cmd` + the DMA1 clock enable; a
      double-booked channel produces `#error`, not last-wins code. Warn on the SPI1 16-bit /
      half-word coupling nothing enforces today.
- [x] (AGENT-2) NVIC → the enabled vectors with PFIC priorities; claim no register write for the
      nesting switch, which this RM does not document
- [x] (AGENT-2) Regenerating after save → close → open produces **byte-identical** C
- [x] (AGENT-2) `tools/wchcube_cli.js --pio <dir>` writes the header to `include/` and the source
      to `src/`; `--strict` fails on an emitted TODO or `#error`
- [x] (AGENT-1) `params:` for TIM3, IWDG, WWDG, TKEY, OPA1 — all done; TKEY needs none,
      being an ADC mode rather than a peripheral
- [ ] (AGENT-4) Host-side unit tests for `lib/util` under a `[env:native]`

### P3 — more parts, now that there is a compiler

- [~] (AGENT-1) `data/mcus/CH32X035.yaml` from `data/sources/X035/Datasheets/`. Groundwork in
      `data/sources/README.md`; NOT started, the DS markdown needs a script (see the board).
      Also confirmed: 24-BIT ports, and PC is not contiguous. Confirmed and
      **different from the V00x family**: ports A/B/C only, `RCC_APB2PeriphClockCmd`, one speed
      `GPIO_Speed_50MHz`, no `ADCCLK_Frequency` in `RCC_ClocksTypeDef`.
- [x] (AGENT-1) When an EVT package lands in `data/sources/<PART>/Evt/`: re-run `verify_sdk_names.py`
      against it, re-check every Medium-confidence row, and post what changed — both drops have
      landed; headers are under `EXAM/SRC/Peripheral/inc`, and `data/sources/README.md` says so
- [x] (AGENT-1) **RM chapter 20 "Extended Configuration" (EXTEN)** — found uncovered and
      undeclared by `tests/completeness.test.js`, and AGENT-1 MODELLED it rather than
      whitelisting it, which was the right call: `TIM2_DMA_REMAP` moves TIM2_CH4's DMA request
      onto the update channel, so it changes the `dma.requests` map this app renders. It was
      never cosmetic. `LKUPRST` is deliberately not offered — a write-1-to-clear status flag is
      something firmware reads at startup, not something a configurator sets.
      QA closed its side 2026-09-11T20:10Z: the chapter map now points ch.20 at EXTEN, and
      EXTEN's missing clock bit and vector are declared ABSENT with EVT citations
      (`ch32v00X.h:438` puts it at `HBPERIPH_BASE + 0x3800`, so it is clocked by HB with no gate
      of its own; `IRQn_Type` ends at `OPCM_IRQn = 40`, so it raises no interrupt).
- [x] (AGENT-1) Medium-confidence rows still open: TouchKey channel→pin (RM ch.10), the OPA
      polling set, and the RM Table 6-1 TIM3-vector contradiction — all first in the queue the day
      EVT arrives — **all three settled.** TouchKey confirmed (it is a MODE OF THE ADC, not a
      peripheral); OPA polling corrected (max 3 channels, not 4, and the set is not fixed);
      no TIM3 vector, confirmed twice over

### Housekeeping

- [ ] (AGENT-4) Correct `agents/README.md` "Environment facts" — `cargo` 1.98.1 and a C compiler
      both exist now; four agents read that file as ground truth
- [x] (AGENT-4) Compile `src-tauri/` locally — `cargo build` clean. The `open_project` fix was
      REQUIRED (`Result<Option<String>>` vs `Result<String>`, proved with `cargo check`), so the
      shell had never compiled; fix and `Cargo.lock` committed.
- [ ] (AGENT-4) Finish the dead-control sweep; `#m-open` / `#m-openproj` need a human or a stub
- [ ] (AGENT-4) Round-3 section in `agents/DONE.md`; re-audit the round-1 and round-2 lines
- [x] (AGENT-1) Stale source paths in `data/FORMAT.md`, `CH32V006.notes.md` and
      `tools/extract_remaps.py` — they still name the pre-reorganisation `data/sources/*.md`
      — `extract_pins.py` and `extract_remaps.py` fixed and both re-run; the two docs were
      already clean
- [ ] (AGENT-4) The human's `Taskfile.yml` is a stub. Make it the real task runner (build, test,
      firmware, validate) or leave it alone and say so — do not half-adopt it.

## Round 4 — a second family, and a project you can flash  (CURRENT)

Brief: `Agents Rounds 4/00_PROJECT.md`. One file per agent beside it; board is
`Agents Rounds 4/BOARD.md`; acceptance script is `Agents Rounds 4/WALKTHROUGH.md`;
launcher `Agents Rounds 4/run_round4.ps1`.

Two deliverables that prove each other. **A: CH32X035 end to end** — a second MCU family, read from
its own DS and RM and checked against its own EVT package. **B: "Generate PlatformIO project"** — a
complete folder you open in VS Code and flash. The round's rule: **a part nobody generated a project
for is a part nobody has actually used.**

Both EVT packages have landed: `data/sources/V006/Evt/` (988 files) and `data/sources/X035/Evt/`
(2 239 files). Every "until the EVT package arrives" sentence in the repo is now stale.

### D — carried over from round 3. These outrank everything below.

- [ ] D1 (AGENT-2) `generateAll()` returns `{ name, language, text }` per file — AGENT-3 waits on it
- [ ] D2 (AGENT-2) Generator options in `S.project`, round-tripped in `.wchproj` and undoable
- [ ] D3 (AGENT-2) User code sections preserved across regeneration — or the option is not offered
- [ ] D4 (AGENT-3) `Tools` tab: implement it or remove it
- [x] D5 (AGENT-4) `write_project` — takes `{ path, text }` relative to a project root plus a
      folder name, validates EVERY path before creating anything, and refuses a non-relative
      path, a `..`, or an existing non-empty folder unless `overwrite`. `safe_relative()` unit
      tested in Rust over 5 real paths and 9 escapes; `cargo test` is in `node tests/run.js`
      now. Bridge: `window.desktopWriteProject(name, files)`. In round 4 it
      writes a whole project tree, so agree the signature on the board first
- [x] D6 (AGENT-4) Host-side unit tests for `lib/util` under `[env:native]` — 10 Unity tests
      over the ring buffer's wrap-around and full/empty cases, run by `node tests/run.js` via
      `tests/firmware_native.test.js`. Found a host compiler nobody knew was here: MinGW 9.2.0
      at C:\MinGW, not on PATH.
- [ ] D7 (AGENT-4) `agents/README.md` "Environment facts"; round-3 section in `agents/DONE.md`
- [x] D8 (AGENT-1) RM chapter 20 "Extended Configuration" (EXTEN) on V006 — MODELLED, plus a new
      `dma.remaps` key: TIM2_DMA_REMAP moves TIM2_CH4's request from channel 7 to channel 2.
      AGENT-4: two ABSENT entries and a chapter-map line still needed in completeness.test.js
- [~] (AGENT-4) D9 `#m-open` / `#m-openproj` sweep — still open. `Taskfile.yml` **ADOPTED**:
      `task` 3.53.1 is installed, so the human'''s stub became the real runner — build, test,
      gate, validate, firmware, firmware:native, firmware:check, tauri, tauri:test, fixtures,
      generate, all. It records the environment gotchas that were otherwise only in prose
      (`python` not `python3`; pio runs from data/firmware; `pio test -e native` needs
      C:\MinGW on PATH; `task firmware` clears the drop zone first, which is the fix for the
      16:27Z cross-part build failure).
- [ ] (AGENT-1) **`peripherals.<TIM>.channel_params` needs a `channels:` map** — found by
      `tests/codegen_compile.test.js` minutes after AGENT-2's `TIM_OCInitTypeDef` emitter
      landed. The struct is filled per CHANNEL, and codegen cannot work out WHICH channels a
      configuration uses from the settings alone, so it emits
      `TODO: TIM1 has TIM_OCInitTypeDef but TIM1.channel_params has no channels: map` on all
      three compile-gate fixtures. It still compiles and there is no `#error` — the TODO is
      codegen declining to guess, which is the documented behaviour. Needs the mapping from
      each channel setting's choice (e.g. `Channel1: PWM Generation CH1 CH1N`) to the channel
      index and the `TIM_OC<N>Init()` call that applies it.

### A — CH32X035, end to end

- [ ] (AGENT-1) Pin tables extracted with a **parser**, re-derived by a second pass and diffed to 0
      differences. The DS markdown is mangled — rows split across lines, all seven package columns
      merged into single cells — so eyeballing Table 2-1 is not available.
- [ ] (AGENT-1) `data/mcus/CH32X035.yaml` — 8 variants (R8T6 / C8T6 / G8U6 / G8R6 / F8U6 / F7P6 /
      D8U6, plus CH32X033F8P6), 7 packages, QingKe **RISC-V4C**, RV32IMAC, 62 KB flash, 20 KB SRAM
- [ ] (AGENT-1) `data/packages/packages.yaml`: add **QSOP28**; resolve **LQFP64M** against the DS
      mechanical drawing rather than assuming it is `LQFP64`
- [ ] (AGENT-1) Ports **A/B/C only**, **24 bits wide** (`GPIO_Pin_0..23`), and **PC has a hole** —
      PC0–PC7 then PC14–PC19. Post the pin list on the board early; it unblocks ENGINE and UI.
- [ ] (AGENT-1) `clock:` with **no HSE** — `grep -c HSE ch32x035_rcc.h` = 0. One 48 MHz RC, SYSCLK
      48/24/16/12/8. No HSE branch "for symmetry", not even a disabled one. Post it early.
- [ ] (AGENT-1) Remap schema: a **`macro:` per remap index** alongside `lsb`/`bits`, because this
      part's EVT exposes 40 named macros applied with `GPIO_PinRemapConfig`. Agree it with AGENT-2
      before filling 40 entries. Re-derive from RM AFIO_PCFR1 independently and diff.
- [ ] (AGENT-1) Peripherals incl. four kinds this repo has never modelled: **USBFS** (host+device),
      **USBPD** (Type-C source/sink/DRP), **PIOC**, **AWU** — plus 4×USART, TIM1/2/3, SPI1, I2C1,
      ADC1, 2×OPA, 3×CMP, PWR, FLASH, EXTI, IWDG, WWDG. No "Activated" stubs.
- [ ] (AGENT-1) `dma:` with **8 channels**; `nvic:` with **47 vectors** and the three **grouped**
      EXTI vectors covering 26 lines; PFIC priority scheme read for the **V4C**, not assumed from
      the V2A
- [ ] (AGENT-1) `codegen:` — header `ch32x035.h`, `RCC_APB2PeriphClockCmd` / `RCC_APB2Periph_GPIO$PORT`,
      domains **AHB/APB1/APB2**, one speed `GPIO_Speed_50MHz`
- [ ] (AGENT-1) `params:` with `struct:`/`field:`/`sdk_call` for every peripheral landed;
      `pio_board`/`pio_env` per variant, omitted rather than approximated where no board ships
- [ ] (AGENT-1) `verify_sdk_names.py` prefers `data/sources/<PART>/Evt/` over the PlatformIO package
      and **says which headers it used**; both parts 0 errors
- [ ] (AGENT-1) `CH32X035.notes.md` cites a DS/RM table or an EVT `file:line` per fact, and records
      the EVT/DS TouchKey disagreement (DS says 14 channels; EVT ships no tkey header)
- [ ] (AGENT-2) 24-bit pin masks — hunt `uint16_t`, `0xFFFF`, 4-digit hex, implied-16 shifts
- [ ] (AGENT-2) Never iterate a port 0..N — PC is not contiguous
- [ ] (AGENT-2) A part with **no HSE**: `clockCalc().selectable` from the data, the HSE auto-enable
      coupling no-ops when `clock.hse_peripheral` is absent, nothing throws or renders a placeholder
- [ ] (AGENT-2) Emit `GPIO_PinRemapConfig(<macro>, ENABLE)` where the data gives a macro, the
      `AFIO->PCFR1` word where it does not — both families, no special case
- [ ] (AGENT-2) Grouped NVIC vectors: many EXTI lines → one vector, enabled exactly once
- [ ] (AGENT-3) Clock tab on a part with no HSE: no box, no mux entry, no RCC row, **no greyed
      placeholder**, no layout gap, silent console — and CH32V006 unchanged
- [ ] (AGENT-3) 24-bit ports and PC's hole in the GPIO table, tree, picker and chip labels
- [ ] (AGENT-3) Seven packages draw, incl. **LQFP64 with 60 I/O** and long names (`USBPD_CC1`,
      `USART4_CTS`, `TIM2_CH3N`) — the legibility work's first real stress
- [ ] (AGENT-3) DMA panel sizes itself from `dma.requests` (**8** channels); NVIC tab lists the EXTI
      vectors as **three rows, not twenty-six**
- [ ] (AGENT-4) CH32X035 fixture in `tests/fixtures/`; `CH32X035G8U6` in the compile matrix
- [ ] (AGENT-4) `smoke`, `layout`, `legibility`, `completeness`, `codegen_compile`, `data` all cover
      CH32X035 × every package — and CH32V006/CH32V005 still pass
- [ ] (AGENT-4) `tests/no_part_names.test.js` — `grep -ri "x035|ch32v006|ch32v005" app/engine/
      app/template.html` empty outside comments
- [ ] (AGENT-4) `data/firmware/README.md`'s "the configurator has no CH32X035 data yet" becomes
      false the day the part lands — fix it then

### B — Generate PlatformIO project

- [ ] (AGENT-2) The file set as `{ path, name, language, text }`: `platformio.ini`, `src/main.c`,
      `README.md`, `.gitignore`, `lib/wchcube_generated/{include,src}` — mirroring `data/firmware/`
- [ ] (AGENT-2) `platformio.ini` from the variant: `platform = ch32v`, `framework = noneos-sdk`,
      `board = variants[*].pio_board`, `-D SDI_PRINT=1`, `upload_protocol = wch-link`
- [ ] (AGENT-2) A variant with **no `pio_board` is refused by name** with the generatable variants
      listed — never substituted (F4U6 is 16 KB against F8U6's 62 KB)
- [ ] (AGENT-2) `main.c`: printf over SDI (**claims no pin**), prints part / configured SYSCLK /
      `SystemCoreClock` read back; blinks a pin **only** if the user configured an output and names
      it; says plainly when they did not; `USER CODE BEGIN/END` around the loop
- [ ] (AGENT-2) Generated README explains two-clock-owners in one sentence
- [ ] (AGENT-2) CLI: write a whole standalone project, refusing a non-empty directory unless forced
- [ ] (AGENT-2) Browser delivery: a stored-entry `.zip` written in `app/engine/` (no external
      library — the app is one offline file), or the alternative argued on the board
- [ ] (AGENT-3) Project Manager: **Generate PlatformIO project** with name + destination; preview
      shows **every** file incl. `main.c` and `platformio.ini`
- [ ] (AGENT-3) Says what `main.c` will do before generating, driven by the configuration; refusal
      shows its reason; after a desktop generate, the path and the next two commands in copyable text
- [ ] (AGENT-4) `tests/generated_project.test.js` **(gate)**: generate to a scratch dir, `pio run`,
      exit 0, self-containment asserted, cleaned up; skips with a printed reason when `pio` is absent
- [ ] (AGENT-4) A specific one-paragraph request in `HUMAN_TODO.md` for someone with a board and a
      WCH-Link to flash one, with the exact commands
- [ ] (AGENT-4) The flash result in `tests/evidence/round4/` — **or the DONE line says "builds, not
      flashed", in those words**

### Housekeeping

- [ ] (AGENT-4) The stale "until the EVT package arrives" language: `PROGRESS.md`,
      `data/firmware/ARCHITECTURE.md`, the round-3 pack. Post the list.
- [ ] (AGENT-1) `data/sources/README.md` — which parts have EVT and where its headers live
- [ ] (AGENT-1) `data/FORMAT.md` — the remap `macro:` form, grouped NVIC vectors, a part with no
      HSE, 24-bit and non-contiguous ports, `pio_board`/`pio_env`
- [ ] (AGENT-4) `PROGRESS.md` §5/§6/§7/§9 rewritten for a second family and a flashable artefact

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
