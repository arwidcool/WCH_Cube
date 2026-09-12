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
Three autonomous agents — **DATA / APP / QA+RELEASE** — work this file. The working agreement is
`agents/README.md`; the current marching orders are **round 5**:

| File | What it is |
|---|---|
| `agents/PROJECT.md` | the round brief — read first, every cycle |
| `agents/AGENT_n_*.md` | your standing instructions + your "Current" section |
| `agents/BOARD.md` | the message board (append-only) — the ONLY board |
| `agents/WALKTHROUGH.md` | the round-5 acceptance script |
| `agents/PROMPT.txt` | the launcher prompt; only the agent number differs |
| `PROGRESS.md` | where the project actually stands (AGENT-3 keeps it true) |

Claim with `[~] (AGENT-n)`. Communicate only via the board. Done = all of `agents/DONE.md`.
`agents/` is the single agent working directory; rounds 1–4 are archived under `agents/history/`
(`INDEX.md` says what each produced) and are read only when a decision is genuinely in question.
ENGINE and UI were merged into APP in round 5 — one owner of `app/`.

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
- [x] (AGENT-1) `data/FORMAT.md` — full YAML schema, every field explained, kept in sync with the engine
      → **closed 2026-09-11 (AGENT-3, walkthrough §4 step 14).** The file documents every top-level
        key including `constraints:` (`## constraints`, with the rules `validate_mcu.py` enforces
        stated in prose), and `data.test.js` runs that validator on every bundled part, so drift
        between the two is a red test rather than a stale paragraph.
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

## Round 2 — fully functional and polished  (closed; archived)

See `agents/history/round2/00_PROJECT.md`. Data lines only; the other three areas track their own.

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

## Round 3 — the generated code is the product  (closed; archived as round 4's D1–D9)

Brief: `agents/history/round3/00_PROJECT.md`. One file per agent beside it; board is
`agents/history/round3/BOARD.md`; acceptance script is `agents/history/round3/WALKTHROUGH.md`.

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
- [-]  Wire `verify_sdk_names.py` into `node tests/run.js`
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
- [x] (AGENT-3) `Tools` tab: implement it or remove it. A dead tab is a dead control.
      → **implemented** (round 4, D4). Removing it needed an edit to `tests/layout.test.js`,
      which is AGENT-4's and went unanswered for two cycles; implementing costs no
      cross-area edit. It is a REPORT over the loaded MCU file — nothing on it changes a
      configuration — whose last panel names what the file does not say.
- [x] (AGENT-2) `generateAll()` returns `{ name, language, text }` per file so the UI can list and
      preview without knowing what codegen produces
- [x] (AGENT-2) Generator options in `S.project`, round-tripped in `.wchproj` and undoable
      — `generatorOptions()` lists only what the engine honours; the per-peripheral split is
      **not offered** rather than offered and broken (BOARD 16:22Z)
- [x] (AGENT-2) User code sections preserved across regeneration — or the option is **not offered**
      — `mergeUserCode()`, a configuration-independent tag set, and orphaned blocks kept under `#if 0`
- [-]  Tauri command to write generated files to a chosen folder, next to `save_project`

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
- [-]  Host-side unit tests for `lib/util` under a `[env:native]`

### P3 — more parts, now that there is a compiler

- [x] (AGENT-1) `data/mcus/CH32X035.yaml` from `data/sources/X035/Datasheets/`.
      → **closed 2026-09-11 (AGENT-3, walkthrough §4 step 14).** It landed: 8 variants, 7 packages,
        all seven packages diffed to 0 differences against the DS I/O column, `validate_mcu.py` and
        `verify_sdk_names.py` both 0 errors, `--strict` exit 0, generated C compiles, and it carries
        the seven cited `constraints:` entries. The record the line was holding: ports A/B/C only,
        24-bit, PC not contiguous (holes at PC8/9 and PC12/13), `RCC_APB2PeriphClockCmd`, one speed
        `GPIO_Speed_50MHz`, no `ADCCLK_Frequency` in `RCC_ClocksTypeDef`, no HSE at all. What
        remains is per-peripheral depth, which is the separate line at the top of this section.
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

- [-]  Correct `agents/README.md` "Environment facts" — `cargo` 1.98.1 and a C compiler
      both exist now; four agents read that file as ground truth
- [x] (AGENT-4) Compile `src-tauri/` locally — `cargo build` clean. The `open_project` fix was
      REQUIRED (`Result<Option<String>>` vs `Result<String>`, proved with `cargo check`), so the
      shell had never compiled; fix and `Cargo.lock` committed.
- [-]  Finish the dead-control sweep; `#m-open` / `#m-openproj` need a human or a stub
- [-]  Round-3 section in `agents/DONE.md`; re-audit the round-1 and round-2 lines
- [x] (AGENT-1) Stale source paths in `data/FORMAT.md`, `CH32V006.notes.md` and
      `tools/extract_remaps.py` — they still name the pre-reorganisation `data/sources/*.md`
      — `extract_pins.py` and `extract_remaps.py` fixed and both re-run; the two docs were
      already clean
- [-]  The human's `Taskfile.yml` is a stub. Make it the real task runner (build, test,
      firmware, validate) or leave it alone and say so — do not half-adopt it.

## Round 4 — a second family, and a project you can flash  (closed; archived as round 5's E1–E9)

Brief: `agents/history/round4/00_PROJECT.md`. One file per agent beside it; board is
`agents/history/round4/BOARD.md`; acceptance script is `agents/history/round4/WALKTHROUGH.md`;
launcher `agents/history/round4/run_round4.ps1` (superseded by `agents/run_agents.ps1`).

Two deliverables that prove each other. **A: CH32X035 end to end** — a second MCU family, read from
its own DS and RM and checked against its own EVT package. **B: "Generate PlatformIO project"** — a
complete folder you open in VS Code and flash. The round's rule: **a part nobody generated a project
for is a part nobody has actually used.**

Both EVT packages have landed: `data/sources/V006/Evt/` (988 files) and `data/sources/X035/Evt/`
(2 239 files). Every "until the EVT package arrives" sentence in the repo is now stale.

### Delivery edge — one Generate, one archive, real parts only (2026-09-12, hand edit)

- [x] **GENERATE CODE and GENERATE PROJECT are one action.** One file list, one button
      (the breadcrumb and the Project Manager both call `pmGenerate`), one delivery:
      `<Name>.zip` in a browser, `<folder>/<Name>/` on the desktop or via the File System
      Access API. The pin table and clock summary moved to `docs/` inside the archive.
      Rationale: init code with no `platformio.ini`, `main.c` or README around it is not
      something a user can flash, and the code button downloaded it as loose files.
- [x] **The page's duplicate ZIP writer is deleted.** `app/template.html` carried a second
      hand-rolled implementation of the format next to `app/engine/zip.js`; it was tested by
      nothing. The page is now a thin `zipOf()` over the engine's `zipFiles`.
- [x] **`WCH-DUMMY32-C8` is out of `data/mcus/`** → `tests/fixtures/mcus/`, kept because it
      is still the only fixture reaching LQFP100/LQFP144, with three GPIO speeds, a
      different NVIC priority scheme and the `OSC_IN`/`OSC_OUT` HSE spelling. The bundle
      dropped 726 KB → 675 KB. `tests/data.test.js` now fails if a synthetic part reappears
      in `data/mcus/`; `tests/clock_ui.test.js` covers the no-HSE/no-PLL clock shape on
      CH32X035 instead.
- [x] The app's part selector, the built bundle and `wchcube_cli.js --list` offer the three
      real parts and nothing else — verified in a real browser.

### D — carried over from round 3. These outrank everything below.

- [x] D1 (AGENT-2) `generateAll()` returns `{ name, language, text }` per file — AGENT-3 waits on it
- [x] D2 (AGENT-2) Generator options in `S.project`, round-tripped in `.wchproj` and undoable
- [x] D3 (AGENT-2) User code sections preserved across regeneration — or the option is not offered
- [x] D4 (AGENT-3) `Tools` tab: implement it or remove it — implemented as a data report.
      The app now has exactly one `disabled` control (`#m-redo`, justified by the undo
      history), so round 3's "no disabled control not justified by the MCU data" is true.
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
- [x] D7 (AGENT-4) `agents/README.md` "Environment facts"; round-3 section in `agents/DONE.md`
- [x] D8 (AGENT-1) RM chapter 20 "Extended Configuration" (EXTEN) on V006 — MODELLED, plus a new
      `dma.remaps` key: TIM2_DMA_REMAP moves TIM2_CH4's request from channel 7 to channel 2.
      AGENT-4: two ABSENT entries and a chapter-map line still needed in completeness.test.js
- [ ] (AGENT-1) **CH32X035 extraction: `params:` for the peripherals that have none** — USBFS
      and USBPD carry settings but no parameters yet; `tests/completeness.test.js` prints them
      every run as tracked-open rather than failing.
- [-]~ D9 `#m-open` / `#m-openproj` sweep — still open. `Taskfile.yml` **ADOPTED**:
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
      — DONE: all seven packages diff to **0 differences** against the DS I/O column. Port C is
      PC0-PC7, PC10-PC11, PC14-PC19 (TWO holes); A and B are contiguous, 24 and 22 pins. Posted.
- [x] (AGENT-1) `clock:` with **no HSE** — `grep -c HSE ch32x035_rcc.h` = 0. One 48 MHz RC, SYSCLK
      48/24/16/12/8. No HSE branch "for symmetry", not even a disabled one. Post it early.
      — DONE. Also found: `RCC_CFGR0` has **no SW field at all**, and HCLK resets to SYSCLK/6.
- [x] (AGENT-1) Remap schema: a **`macro:` per remap index** alongside `lsb`/`bits`, because this
      part's EVT exposes 40 named macros applied with `GPIO_PinRemapConfig`. Agree it with AGENT-2
      before filling 40 entries. Re-derive from RM AFIO_PCFR1 independently and diff.
- [x] (AGENT-1) 27 peripherals landed with all ten remap tables, generated from Table 2-3 and
      cross-checked against the EVT macro counts (10 agree, 0 disagree). Still out: TouchKey
      (settled as an ADC mode, so correctly not a peripheral) and the 1-wire IO2W controller.
      Peripherals incl. four kinds this repo has never modelled: **USBFS** (host+device),
      **USBPD** (Type-C source/sink/DRP), **PIOC**, **AWU** — plus 4×USART, TIM1/2/3, SPI1, I2C1,
      ADC1, 2×OPA, 3×CMP, PWR, FLASH, EXTI, IWDG, WWDG. No "Activated" stubs.
- [~] (AGENT-1) `dma:` with **8 channels**; `nvic:` with ~~47~~ **45 vectors** and the three
      **grouped** EXTI vectors covering 26 lines; PFIC priority scheme read for the **V4C**, not
      assumed from the V2A — NVIC scheme DONE (V4C has **three** priority bits at [7:5], not the
      V2A's two, so 8 levels not 4). Vector COUNT is **45**, not 47: `IRQn_Type` and the startup
      `.word` table agree on every one, and there is **no RCC vector**. 20 of 45 emitted; the rest
      arrive with their peripherals. **`dma:` DONE** - 8 channels, `channel_params`, and 9
      requests cited to EVT examples; the rest BLOCKED on the RM conversion, see the board.
- [x] (AGENT-1) `codegen:` — header `ch32x035.h`, `RCC_APB2PeriphClockCmd` / `RCC_APB2Periph_GPIO$PORT`,
      domains **AHB/APB1/APB2**, one speed `GPIO_Speed_50MHz` — DONE, plus `codegen.rcc`. Found:
      **no open-drain modes on this part** (6 members of GPIOMode_TypeDef, not 8).
- [x] (AGENT-1) `params:` with `struct:`/`field:`/`sdk_call` for every peripheral landed;
      `pio_board`/`pio_env` per variant, omitted rather than approximated where no board ships
      - USART1-4, SPI1, I2C1, TIM1/2/3, ADC1. QFN12 (D8U6) has no board, so it says nothing.
- [x] (AGENT-1) `verify_sdk_names.py` prefers `data/sources/<PART>/Evt/` over the PlatformIO package
      and **says which headers it used**; both parts 0 errors — already built that way in round 3;
      confirmed reporting "checked against EVT data/sources/X035/Evt (97 files)".
- [x] (AGENT-1) `CH32X035.notes.md` cites a DS/RM table or an EVT `file:line` per fact, and records
      the EVT/DS TouchKey disagreement (DS says 14 channels; EVT ships no tkey header) — DONE,
      including every open question rather than a guess for it.
- [x] (AGENT-2) 24-bit pin masks — hunt `uint16_t`, `0xFFFF`, 4-digit hex, implied-16 shifts
- [x] (AGENT-2) Never iterate a port 0..N — PC is not contiguous
- [x] (AGENT-2) A part with **no HSE**: `clockCalc().selectable` from the data, the HSE auto-enable
      coupling no-ops when `clock.hse_peripheral` is absent, nothing throws or renders a placeholder
- [x] (AGENT-2) Emit `GPIO_PinRemapConfig(<macro>, ENABLE)` where the data gives a macro, the
      `AFIO->PCFR1` word where it does not — both families, no special case
- [x] (AGENT-2) Grouped NVIC vectors: many EXTI lines → one vector, enabled exactly once
- [~] (AGENT-3) Clock tab on a part with no HSE: no box, no mux entry, no RCC row, **no greyed
      placeholder**, no layout gap, silent console — and CH32V006 unchanged
- [ ] (AGENT-3) 24-bit ports and PC's hole in the GPIO table, tree, picker and chip labels
- [ ] (AGENT-3) Seven packages draw, incl. **LQFP64 with 60 I/O** and long names (`USBPD_CC1`,
      `USART4_CTS`, `TIM2_CH3N`) — the legibility work's first real stress
- [ ] (AGENT-3) DMA panel sizes itself from `dma.requests` (**8** channels); NVIC tab lists the EXTI
      vectors as **three rows, not twenty-six**
- [x] (AGENT-4) CH32X035 fixture in `tests/fixtures/`; `CH32X035G8U6` in the compile matrix —
      `CH32X035_QFN28_full.wchproj`, in both `codegen_compile` and `generated_project`
- [x] (AGENT-4) `smoke`, `layout`, `legibility`, `completeness`, `codegen_compile`, `data` all cover
      CH32X035 × every package — and CH32V006/CH32V005 still pass. `smoke`, `layout`, `legibility`,
      `completeness` and `data` iterate every registered part (`a.mcuNames` / `readdirSync`), so the
      seven packages were covered the moment the file landed; `codegen_compile` names the fixture.
- [x] (AGENT-4) `tests/no_part_names.test.js` — `grep -ri "x035|ch32v006|ch32v005" app/engine/
      app/template.html` empty outside comments — self-tested with a planted break
- [x] (AGENT-4) `data/firmware/README.md`'s "the configurator has no CH32X035 data yet" becomes
      false the day the part lands — fixed; the row now points at the compile gate

### B — Generate PlatformIO project

- [x] (AGENT-2) The file set as `{ path, name, language, text }`: `platformio.ini`, `src/main.c`,
      `README.md`, `.gitignore`, `lib/wchcube_generated/{include,src}` — mirroring `data/firmware/`
- [x] (AGENT-2) `platformio.ini` from the variant: `platform = ch32v`, `framework = noneos-sdk`,
      `board = variants[*].pio_board`, `-D SDI_PRINT=1`, `upload_protocol = wch-link`
- [x] (AGENT-2) A variant with **no `pio_board` is refused by name** with the generatable variants
      listed — never substituted (F4U6 is 16 KB against F8U6's 62 KB)
- [x] (AGENT-2) `main.c`: printf over SDI (**claims no pin**), prints part / configured SYSCLK /
      `SystemCoreClock` read back; blinks a pin **only** if the user configured an output and names
      it; says plainly when they did not; `USER CODE BEGIN/END` around the loop
- [x] (AGENT-2) Generated README explains two-clock-owners in one sentence
- [x] (AGENT-2) CLI: write a whole standalone project, refusing a non-empty directory unless forced
- [x] (AGENT-2) Browser delivery: a stored-entry `.zip` written in `app/engine/` (no external
      library — the app is one offline file), or the alternative argued on the board
- [~] (AGENT-3) Project Manager: **Generate PlatformIO project** with name + destination; preview
      shows **every** file incl. `main.c` and `platformio.ini`
- [x] (AGENT-3) Says what `main.c` will do before generating, driven by the configuration; refusal
      shows its reason; after a desktop generate, the path and the next two commands in copyable text
- [x] (AGENT-4) `tests/generated_project.test.js` **(gate)**: generate to a scratch dir, `pio run`,
      exit 0, self-containment asserted, cleaned up; skips with a printed reason when `pio` is absent
      — 9 checks GREEN on all four fixtures once `projectFiles()` landed; the one red was two
      `r.pin`/`o.pin` reads of a row that carries `name` (AGENT-2's 18:05Z finding), now fixed
- [x] (AGENT-4) A specific one-paragraph request in `HUMAN_TODO.md` for someone with a board and a
      WCH-Link to flash one, with the exact commands — item 6
- [-]  The flash result in `tests/evidence/round4/` — **or the DONE line says "builds, not
      flashed", in those words**

### Housekeeping

- [x] (AGENT-4) The stale "until the EVT package arrives" language: `PROGRESS.md`,
      `data/firmware/ARCHITECTURE.md` — both corrected (ARCHITECTURE still said "empty today" two
      paragraphs above "both have landed"). The round-3 pack is left as written: it is history.
- [ ] (AGENT-1) `data/sources/README.md` — which parts have EVT and where its headers live
- [x] (AGENT-1) `data/FORMAT.md` — the remap `macro:` form, grouped NVIC vectors, a part with no
      HSE, 24-bit and non-contiguous ports, `pio_board`/`pio_env`
- [x] (AGENT-4) `PROGRESS.md` §5/§6/§7/§9 rewritten for a second family and a flashable artefact

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

## Round 5 - every choice the app offers must be one the silicon can honour  (CURRENT)

Brief: `agents/PROJECT.md`. Standing instructions `agents/AGENT_n_*.md`; the ONLY board is `agents/BOARD.md`; acceptance script `agents/WALKTHROUGH.md`; launcher `agents/run_agents.ps1`.

Three agents: DATA / APP / QA+RELEASE. Since round 5 `agents/` is the single agent working
directory - rounds 1-4 are archived under `agents/history/` and `INDEX.md` says what each
produced. Claim a line with `[~] (AGENT-n)`.

**A - the data can state a constraint.** Three documented instances on CH32X035 (the pull-down
allow-list PA0-PA15/PC16-PC17; output functions prohibited on shorted pins; PC10/PC11 floating
only while USBFS is on), one mechanism, consumed by the GPIO table per row, the conflict engine
and codegen - with CH32V006/CH32V005 byte-identical as the regression half.

**B - every part generates C with no TODO and no #error**, so `--strict` exits 0. It exits 2
today, blocked on `codegen.nvic`, `channel_params.channels` and the CH32X035 params gaps.

Per-line acceptance list: `agents/DONE.md` Round 5. Full detail: `agents/PROJECT.md`.

### Round 5 — open lines

- [x] (AGENT-2) **The constraint consumer and the constraint data used two different shapes,
      and while they did the mechanism did nothing at all.** The data (and `data/FORMAT.md`
      `## constraints`, which `tools/validate_mcu.py` enforces) is the document ROOT key
      `constraints:` with `option: gpio.mode|gpio.pull|gpio.speed`, exactly one of `choices:` /
      `classes:`, exactly one of `only_on:` / `not_on:`, optional `packages:` and
      `when: {peripheral, enabled}`, plus `reason:` and `source:`. `app/engine/constraints.js`
      read `M.gpio.constraints` with `field:` / `deny:` / `allow:` / `on_pins:` / `off_pins:` /
      `on_shorted:` / `on_packages:`. Because the placement failed first, `gpioConstraints()`
      returned `[]` and `gpioConstraintProblems()` reported **nothing** — not an error, not a
      warning, not a FAIL — while the GPIO table went on offering Pull-down on PC0 and an output
      mode on every shorted pair. **CLOSED**: the consumer moved to `FORMAT.md`'s shape in the
      same cycle (BOARD 22:11Z QA-FAIL, 22:25Z correction, 22:52Z QA-PASS);
      `tests/constraints.test.js` asserts the shipped blocks reach the engine with no skip in
      between, plus both halves of the pull-down case, the shorted-pair case, the USBFS-
      conditional case and the violating-`.wchproj` path — 13 tests, and a planted break that
      removes the restriction and requires the option to come back.
- [x] (AGENT-2) **`normaliseGpioConstraints()` had no caller**, so a project carrying a choice
      the silicon forbids opened without being rewritten or reported. **CLOSED**: it runs on the
      project-load path beside `normaliseGpioSpeeds()`, its sentences join the same `dropped`
      array, and `tests/constraints.test.js` "a violating project loads with zero console output
      and says what it dropped" holds it shut — with `console.error`/`console.warn` captured, so
      a silent rewrite that logged would fail too.
- [x] (AGENT-3) `tests/strict.test.js` — `--strict` asserted on the exit code for every fixture ×
      both formats, every shipped part required to have a fixture, and both planted breaks
      (a conflicted project, a part with no `codegen:` block) confirmed to exit 2.
- [x] (AGENT-3) E3 — `tests/sdk_names.test.js` registers one test per shipped part and turns the
      tool's own NOT CHECKED sentence into a counted SKIP, so a part whose SDK was not resolved
      can no longer read as a green tick; the file list is asserted against `wchcube_cli.js --list`
      and a planted no-`codegen.sdk` file proves the skip fires.
- [x] (AGENT-3) **CH32V003 arrived mid-round and two gates caught it.** `tests/strict.test.js`'s
      coverage check (a shipped part with no fixture behind the `--strict` gate) and
      `tests/completeness.test.js` (`CH32V003 OPA1: nvic`). Closed on evidence: a fifth fixture
      `tests/fixtures/CH32V003_TSSOP20_full.wchproj`, `[env:CH32V003F4P6]` in
      `data/firmware/platformio.ini`, a `WCH_HAL_SERIES_CH32V003` branch in `lib/wch_hal`
      (small-x `ch32v00x`, ports A/C/D and no GPIOB), and the OPA vector declared **ABSENT**
      citing `ch32v00x.h`'s `TIM2_IRQn = 38`.
- [ ] (AGENT-1) **`CH32V003` variants carry `pio_board` but no `pio_env`**, so nothing checks that
      its firmware environment exists — `verify_sdk_names.py` does that cross-check on the other
      three parts and would catch a typo. `[env:CH32V003F4P6]` exists as of this cycle; add
      `pio_env: CH32V003F4P6` (or deliberately none, as `CH32X035D8U6` does) so it becomes a
      checked claim. Minor: `params:` for `CH32V003 OPA1` is still open and prints every run.
- [x] (AGENT-3) **CI made publish-ready, and the two defects that preparing it found.** `ci.yml`
      never installed PlatformIO, so the compile suites would have SKIPPED on the runner under a
      green job; its `desktop` job asked for `libappindicator3-dev`, which does not exist on a
      current Ubuntu runner; and its comments claimed `Cargo.lock` was uncommitted when it is not.
      All fixed, plus `permissions: contents: read`, per-job timeouts, and a new
      `.github/workflows/release.yml` that publishes `dist/index.html` and a vendor-free source
      archive on a `v*` tag. `tests/release.test.js` (7 checks, 3 with planted breaks) now asserts
      the plumbing — including that the PlatformIO install and the compile gate are the same job.
- [x] (AGENT-3) **`data/sources/V003/` had the wrong capitalisation and every gate passed anyway** —
      `evt/`/`datasheets/` where the other parts and the tools say `Evt/`/`Datasheets/`. On Windows
      the lookup resolves and 23 headers were checked; on Linux it resolves nothing, reports
      CH32V003 **NOT CHECKED**, and exits 0. Renamed (never deleted), the dangling citations in
      `CH32V003.yaml`/`CH32V003.notes.md` repaired, and `tests/source_paths.test.js` (5 checks) now
      resolves every cited `data/sources/...` path against the case the filesystem actually has.
      Decision and rationale: `agents/BOARD.md` 2026-09-11T23:06Z.
- [ ] (AGENT-1) **`tools/verify_sdk_names.py` degrades a wrong-case EVT folder to a WARNING and
      then to NOT CHECKED, and still exits 0** — which is what made the defect above invisible to
      every gate. It should be an ERROR: the path the tool builds is a claim like any other, and
      `data/sources/<evt>/Evt` not existing (with the case the tool spells) is the difference
      between a part that was checked and a part that was not. `tests/source_paths.test.js` catches
      this from the outside now; the tool should catch it from the inside too.
- [ ] (AGENT-3) **The workflows have never executed.** `ci.yml` (3 jobs) and `release.yml` are
      written and checked structurally, but no local check can substitute for a run on a real
      runner — expect the first one to shake out a package name or a cache path. Unblocks on
      `HUMAN_TODO` item 1. Also deferred: `pio check` in CI, and `tests/perf.test.js`, both from
      `agents/BACKLOG.md`.
- [x] (AGENT-1) **The constraint mechanism, DATA half.** Schema posted on the board BEFORE any
      entry was filled; `data/FORMAT.md` gains `## constraints` (mechanism, key table, the rules
      the validator enforces, how the three consumers read it, and why "must be a floating input"
      is two prohibitions rather than a second `require:` mechanism); `gpio.modes[]` gains
      `class:` (`out`/`in`/`analog`); **7 cited entries** on CH32X035 covering all three DS cases
      (allow-list, per-package deny-list, peripheral-conditional); `check_gpio()` and
      `check_constraints()` added to `tools/validate_mcu.py`; `tools/validate_constraints_selftest.py`
      plants **19 breaks, one per rule, and catches all 19** with the unmutated part validating
      clean first. BOARD 2026-09-11T22:17Z. The shape question is settled in DATA's favour by
      `data/FORMAT.md` + `validate_mcu.py` + QA's 22:25Z recommendation; `on_shorted:` is
      recorded as considered-and-deferred, with the reason, in the same board entry.
- [x] (AGENT-1) **Correction: `class:` had to split `out` from `af`.** `classes: [out]` covered
      `GPIO_Mode_AF_PP` as well, so with USBFS on, PC16/PC17 — which USBFS's own remap puts
      UDM/UDP on — were refused and `--strict` went red on five of seven packages (AGENT-2's
      measurement, BOARD 01:22Z+). The DS prohibits an "output function", which is the GPIO
      output register; its own Note 4 requires USB on that pair and the EVT's USB examples
      configure no GPIO there at all. The set is now `out` / `af` / `analog` / `in`, the four
      shorted-pair entries say `classes: [out]`, and the USB entry refuses all three driving
      classes on PC10/PC11. Measured after: USBFS `Device (FS)` on QFN28 exits `--strict` 0 and a
      manual `PC16: GPIO_Output` still comes out `IN_FLOATING`. Reads cited in
      `CH32X035.notes.md`; `data/FORMAT.md` documents the four values.
- [ ] (AGENT-2) **`const:` — a struct member fixed by WHICH INSTANCE it is, not by the user.**
      Requested BOARD 22:34Z with the citations: `OPA_InitTypeDef.OPA_NUM` / `CMP_InitTypeDef.CMP_NUM`
      are branched on by the SDK (`ch32x035_opa.c:117`), so an `OPA_Init(&s)` with the member unset
      silently configures the *other* OPA. It cannot be an editable param (that offers a choice the
      silicon does not have) and `readonly:` is filtered out of `initPlan`, so it would not be
      emitted at all. **This blocks OPA and CMP `params:` — the head of DATA's P1 list — and the
      alternative is worse than the gap.** FORMAT.md gets the block the moment the shape is agreed.
- [ ] (AGENT-3) Paste the CH32V003 `OPA1.nvic` ABSENT entry posted BOARD 22:34Z — OPA raises no
      vector on that part (`ch32v00x.h:35-68` has no `OPA_IRQn`; the startup `.word` table ends at
      `TIM2_IRQHandler`). It is the one red in the tree; `data/` cannot clear it, because the
      `ABSENT` table is in `tests/completeness.test.js`.
- [x] (AGENT-1) **CH32V006/CH32V005 audited for the same class, result recorded either way**
      (`data/mcus/CH32V006.notes.md`). Instance 2 (shorted pair not an output) **exists** there -
      CH32V006 DS notes 3 and 4, quoted verbatim - and is deliberately NOT filled this round,
      because Deliverable A's acceptance test requires that part's behaviour to stay
      byte-identical; it needs no code change when it does land. Instance 1 is **absent** ("All
      GPIO pins support controllable pull-up and pull-down resistors", DS ch.1.4.16) and instance
      3 is **absent** (no USB), both with the source read rather than assumed. The audit also
      found a **fourth shape the mechanism cannot express** - "When PA1 and PA2 are crystal pins,
      i.e., PA1PA2_RM = 1, PA1 and PA2 cannot be used for GPIO functions" (same chapter), which is
      conditional on a remap/clock state rather than on a peripheral being enabled - recorded as
      an open question rather than stretched to fit `when: {peripheral, enabled}`.
- [ ] (AGENT-3) Gate `tools/validate_constraints_selftest.py` the way `tests/sdk_names.test.js`
      gates the SDK-name selftest: assert the exit code AND that the output says `19/19`, so a
      selftest that degenerates to "0 cases" cannot read as a pass. Requested on the board
      2026-09-11T22:17Z.
- [ ] (AGENT-1) **CH32X035's five partial peripherals**, in this order: OPA (13 members, 3
      modelled), CMP1/2/3 (5 and 3), TKEY (raw registers; `TKEY1_CHARGE1` **overlaps** the ADC
      `sample` parameter and the interaction has to be decided before either ships), USBFS and
      USBPD `params:`. EVT headers are the citation, `data/FORMAT.md` the contract.
- [ ] (AGENT-1) **The ADC internal Vrefint channel** - a repo-wide decision, not an X035 miss,
      because the same gap exists on CH32V006. Decide once, apply to every part.
- [x] (AGENT-1) **USART LIN / SmartCard / IrDA** on X035 — `params:` with `sdk_call` on all four
      USARTs (`USART_LINCmd` `ch32x035_usart.h:165`, `USART_SmartCardCmd` `:171`, `USART_IrDACmd`
      `:175`), each a `bool` emitting both its ENABLE and DISABLE forms. **They are `params:` and
      not `settings:`, because none of the three claims a pin** — a setting exists to claim one.
      Compiled on the compile-gate fixture with USART1 `Asynchronous` + `lin`/`irda` true:
      `pio run` succeeds for CH32X035G8U6 and the calls appear. `validate_mcu.py` and
      `verify_sdk_names.py` both exit 0 (97 EVT header files).
- [ ] (AGENT-1) **The two USART refinements that live INSIDE a mode**, cited and recorded but not
      wired: LIN break detection length (`USART_LINBreakDetectLengthConfig`,
      `ch32x035_usart.h:164`, macros `_10b`/`_11b` at `:134-135`) and the IrDA low-power pulse
      width (`USART_IrDAConfig`, `:174`, macros `USART_IrDAMode_Normal`/`_LowPower` at
      `:138-139`). Both need `depends_on:` on the mode flag; before emitting them unconditionally
      I want the dependency's lookup key (param `key` vs display `name`) proved from
      `app/engine/params.js`, which is APP's file. Recorded in `CH32X035.notes.md`.

### Deliverable A — the three consumers (AGENT-2)

The schema is `data/FORMAT.md` `## constraints` (AGENT-1, 22:02Z). APP reads it and decides
nothing about a part; `app/engine/constraints.js` is the only place it is interpreted.

- [x] (AGENT-2) **The GPIO table** — per ROW, from the data: a refused choice is not offered (not
      offered-and-greyed), and when every option is refused the control is absent and the value is
      text. The row's tooltip carries the constraint's `reason` and `source`. Measured in a real
      browser on CH32X035/QFN28: PC16/PC11 offers Input+Analog, PA3 offers all four modes, PC18
      offers No pull+Pull-up while PA3 offers Pull-down too.
- [x] (AGENT-2) **The conflict engine** — a configured choice a constraint refuses is an issue
      carrying the author's `reason` and the constraint `id`, attached to the owning peripheral and
      collected in `E.constraintIssues` for a strip beside the shared-resource one. The pull is
      checked only when the mode is Input, because the SPL ignores the pull column otherwise.
- [x] (AGENT-2) **Codegen** — it never emits a forbidden combination: it declines and emits the
      TODO the strict gate looks for, naming the constraint. The `speed` and `mode`/`pull` halves
      are separate, so a speed constraint cannot suppress a legal mode macro.
- [x] (AGENT-2) **A stored value the part forbids degrades the way a stored speed already does** —
      `normaliseGpioConstraints()` called from `projectApply()`, next to `normaliseGpioSpeeds()`,
      same contract: the file opens, the value is rewritten to the first legal one, and
      `PROJECT.warnings` says which constraint and what it used instead. QA's 22:11Z request closed.
- [x] (AGENT-2) **One shared mode derivation** — `gpioEffectiveMode()`/`skippedClaim()`/
      `analogClaim()` in `app/engine/constraints.js`, called by both the engine and `gpioPlan()`,
      so a rule the engine reports and the generator refuses cannot be two rules. Moved, not
      copied: the generated C for all four fixtures is byte-identical to the baseline.
- [x] (AGENT-2) **CH32V006 and CH32V005 unchanged** — every existing test unchanged, and every
      generated `.c`/`.h` byte-identical before and after (`wchcube_cli.js --format c` on all four
      fixtures, hashes compared). `--strict` exits 0 on all four, both formats.
- [x] (AGENT-2) `app/tests/constraint.test.js` — 14 engine tests on a part invented in the test
      (no part named in `app/`), covering both halves of a region, per-package scoping, the
      `classes:` direction read off the data, the peripheral-coupled rule lifting, the codegen
      TODO, the project degrade and the regression loop over all three real parts.
- [ ] (AGENT-2) **The USBFS interaction the mechanism exposed** — `classes: [out]` on the shorted
      pairs refuses the alternate function too, so enabling USBFS on five of seven CH32X035
      packages makes `--strict` exit 2 for a configuration the silicon honours. REQUEST(→AGENT-1)
      2026-09-12T01:22Z, with the measurement and a suggested `choices:` shape. Blocked on DATA by
      design: the mechanism is faithful either way and `data/` is not mine.
- [x] (AGENT-2) **`assignSignal()` stored this app's mode vocabulary, not the part's** — the
      literals "Output Push Pull" / "Analog" / "Input" went into `S.gpio[pin].mode`, while the
      macro is looked up in that part's `gpio.modes`. Latent (every shipped part spells it the
      same way) and found by reading `codegen.js` end to end, the way rounds 3 and 4 each found
      theirs. Now `gpioModeForSignal()` with the literal as the fallback, so a part whose file
      states nothing gets the same TODO as before. The pull default comes from the part's own
      `input_modes` for the same reason.
- [x] (AGENT-2) **CH32X035 TSSOP20/QSOP28 emitted a spurious remap TODO on every configuration
      that assigns a pin** — a real defect: `--strict` exited 2 for a package whose board ships.
      `SYS`'s reset pin is bonded to PC3 there (`remap_by_package`), its remap table carries no
      `macro:` because the reset pin is an option-byte setting and not a remap, and the "the data
      cannot apply the selected remap" filter asked only "is a non-zero index selected". The rule
      is now "does any signal this peripheral requires actually reach a GPIO register" — read
      from `codegen.skip_signals`, no peripheral named. QFN28 was unaffected, which is why the
      compile fixture never caught it; `app/tests/codegen.test.js` now assigns a pin on every part
      on every package and demands zero complaints, which is the coverage hole it hid in.



### CH32H417 — the per-pin AF mechanism  (AGENT-4, human-directed, spans AGENT-1 + AGENT-2 areas)

Posted on `agents/BOARD.md` 2026-09-11T23:14Z with the file hold list. CH32H417 selects its
alternate function **per pin** (`GPIOx_AFRL`/`AFRH`, `AFRy[3:0]` = AF0..AF15, RM 9.3.2.2;
`GPIO_PinAFConfig`), which `remaps:` cannot express: 418 signals, 70 % of them reach more than
one pin, and a whole-peripheral enumeration is 8.5e20 entries. Measured by
`tools/extract_h417_pins.py --audit`.

- [x] `data/packages/packages.yaml` — `QFN128`, `QFN88`, `QFN60X6` added; `QFN68` confirmed (AGENT-4)
- [x] `tools/extract_h417_pins.py` — package tables + AF map + the format audit (AGENT-4)
- [x] `data/mcus/CH32H417.notes.md` — the finding, the extraction, the open questions (AGENT-4)
- [x] `codegen.remap.style: af` + `signal_pins:` in `data/FORMAT.md` (AGENT-4)
- [x] engine: `signalPins(pid)` seam, pin grid, conflict engine, codegen (AGENT-4)
- [x] `tools/validate_mcu.py` — checks for the new keys, in the same change as the keys (AGENT-4)
- [x] `tools/validate_afmux_selftest.py` — 11 planted breaks, 11 caught (AGENT-4)
- [x] `app/tests/afmux.test.js` (engine, synthetic part) + `tests/afmux.test.js` (shipped data) (AGENT-4)
- [x] `data/mcus/CH32H417.yaml` — 12 peripherals on 3 packages; `--strict` 0, `pio run` SUCCESS (AGENT-4)
- [x] `[env:CH32H417QEU6]` in `data/firmware/platformio.ini` + Taskfile ENVS (AGENT-4)
- [x] `tests/fixtures/CH32H417_QFN128_full.wchproj` — TX and SCK moved off their defaults
      while their siblings stay put, which no remap-shaped model can express (AGENT-4)
- [x] Latent defects a sixth part surfaced: `sys`/`nc`/`analog` had no CSS rule (44 labels at
      1.14:1); `codegen_compile.test.js` counted pins with `P[A-D]`; `port_clock()` fell off
      the end of a non-void function; `data/sources/H417/` casing (AGENT-4)
- [x] Generated `main.c` reads `codegen.clock_update_fn` / `sdi_printf_fn` instead of naming
      SDK functions this part renames — three link failures, no part named in `app/` (AGENT-4)
- [ ] Which family owns MEU6/WEU6 — DS contradicts itself 3 sources to 1 (AGENT-1)
- [x] `data/sources/H417/` rename to the documented `Datasheets/` + `Evt/` layout (AGENT-1)
      → **closed 2026-09-12.** Both folders are there with exactly that case
        (`data/sources/H417/Datasheets/CH32H417DS0.md`, `.../CH32H417RM.md`, `data/sources/H417/Evt/`),
        `codegen.sdk.evt: H417` resolves, and `tests/source_paths.test.js` is green — it was the
        test that would have caught it either way.
- [ ] How the dual core (RISC-V5F 400 MHz + RISC-V3F 160 MHz) is modelled (AGENT-1)
- [ ] Draw a 128-pin QFN — 32 pins a side, no existing layout/legibility case (AGENT-2)
      → **Measured 2026-09-12 (AGENT-3), and the answer is that the UI job does not change.**
        `tests/layout.test.js` has the case permanently: QFN128 synthesised into the layout fixture
        at runtime from its own LQFP144 order, fitted at both viewports, compared against LQFP144.
        QFN128 is better on every metric at both sizes — 32 pins a side against 36, so its labels
        are further apart and drawn larger (1280x720: gap 14.28px vs 13.20px, smallest label 6.17px
        vs 5.70px; 1920x1080: 21.42px vs 19.80px, 9.25px vs 8.55px). The 12.3mm body costs nothing
        because `fitChip()` scales the whole drawing. Planted break included.
        **What is still open:** the real-browser half. `tests/legibility.test.js` sweeps only what
        `#mcusel` offers, so it cannot see a synthesised package — that case arrives with the first
        real part shipping QFN128, i.e. `CH32H417.yaml`. Until then this is structural (jsdom)
        evidence about the app's own SVG arithmetic, not a rendering measurement.
- [ ] (AGENT-1) **`data/mcus/CH32H417.yaml` will be the first part whose package tables exercise
      three brand-new geometries at once (QFN60X6/QFN88/QFN128).** A package map that disagrees
      with its geometry is accepted **silently** at runtime — fewer pins drawn, empty console, no
      problem reported (measured: 127 entries → 127 pins, 130 → 128, 92 valid → 92). The gate is
      `tests/data.test.js` "the pin count in each package table matches its geometry", which runs
      against `data/mcus/` and will therefore cover the new part. Recorded so that "fewer pins than
      expected and no console output" is recognised as this and not as an extraction bug.

Regression rule for the whole block, and it HELD: **CH32V003/V005/V006/X035 byte-identical,
559 tests green, `--strict` 0 on all six fixtures.** `app/tests/afmux.test.js` asserts that for
every peripheral of the four earlier parts, `signalPins(pid)` returns the IDENTICAL object the old
code read — not an equal copy — so nothing downstream can see a difference; and the checked-in
fixtures still match what the engine produces. A part with no `signal_pins:` behaves exactly as it
did before the key existed, the same rule a part with no `constraints:` follows.

Still open, and none of it blocks the mechanism — all four are argued in
`data/mcus/CH32H417.notes.md`:

- [ ] Settle whether MEU6/WEU6 are CH32H416 or CH32H417 — the DS contradicts itself 3 sources
      to 1; this file follows the majority with a `notes:` on each variant (AGENT-1)
- [ ] Re-derive the AF map from DS Table 2-2-x and diff to zero, the CH32V006 standard (AGENT-1)
- [ ] The clock tree (RM ch.8, several PLLs). It gates every analog peripheral (AGENT-1)
- [ ] How the dual core is modelled — `mcu.core` is one string, PlatformIO ships three board
      files per package (AGENT-1)
- [ ] CH32H416 / CH32H415 — DS Tables 2-1-2 and 2-1-3, on QFN60X6, whose geometry is already
      in `packages.yaml`. Separate parts under the repo's own rule (AGENT-1)

### Data sources — markdown first, PDF last resort  (2026-09-12, human-directed)

Five drops now, each one arriving as a PDF with a markdown conversion beside it, and two
recoveries have already needed the original. The order was implicit in the tools and stated
nowhere, so it is now written down once, implemented once, and checked:

- [x] **`data/sources/README.md` — "Read the markdown first. The PDF is the last resort."** The
      four-step fallback protocol (read the markdown → open the PDF only when it demonstrably
      cannot answer → say why and recover by script with checks → write the cells back once), the
      current five-part layout with each drop's casing, and the table of which drops have actually
      needed the PDF and what the conversion had destroyed. Stale claims in the same file fixed:
      "the EVT folders are empty today" (all five have landed) and a two-part EVT table.
- [x] **`tools/source_docs.py`** — the order in code. `choose()` returns the markdown and reaches
      for a PDF only with an announced fallback; `require_markdown()` exits naming the fallback
      route so a markdown-only tool cannot silently take a PDF; `announce_pdf_fallback()` is the
      `PDF FALLBACK:` banner; `markdown()`/`pdf()` resolve part and file case-insensitively.
- [x] **`tools/recover_l103_pins_from_pdf.py`** — prints the reason it needs the PDF (7 of 51 rows
      of Table 2-1-1 start with fewer than five cells) and **refuses to open the PDF** when
      `markdown_short_rows()` finds zero, i.e. when the conversion can answer. Its `--yaml` block
      carries the provenance.
- [x] **`tools/extract_l103_pins.py`** — markdown only, through `require_markdown()`. Its "This
      drop has no PDF" paragraph was simply false: `CH32L103DS0.PDF` is in the drop.
- [x] **`agents/proposals/x035_dma_requests.py`** — `PDF FALLBACK:` marker and banner, and both of
      its sources now resolve through `source_docs` (it still reads the markdown for row order and
      the EVT anchors, which is what makes the recovered columns checkable).
- [x] **`data/mcus/CH32L103.notes.md`** — the false "no PDF" claim and the §4 request for a second
      source a human would have had to find. Both corrected, with the recovery's real state.
- [x] **Propagated to** `agents/README.md` (rules that never bend), `agents/PROMPT.txt`,
      `agents/AGENT_1_DATA.md` (a new "sources, and the order you read them in" section),
      `docs/ADDING-A-PART.md`, `docs/HOW-IT-WORKS.md`, `data/FORMAT.md`, the PR template.
- [x] **`tests/source_order.test.js`** — three checks: a PDF in a `Datasheets/` folder with no
      conversion beside it fails; a script that reads a PDF with no `PDF FALLBACK:` reason fails;
      and the markdown-only extractors may name no PDF at all. Plus a planted-break half, so a
      check that stopped looking at anything cannot read as green.

### CH32H417 - the peripheral set and the clock (AGENT-3, human-directed)

The human's brief: CH32H417 looked half-built - most peripherals missing, the clock stubbed.
Session of 2026-09-12. Result: **13 peripherals -> 78**, 125 NVIC vectors, 73 clock-enable
bits, and a clock tree that models what the schema can hold.

- [x] `tools/extract_h417_setup.py` - the non-pin setup blocks. `--nvic` emits the 125-vector
      table from `ch32h417.h`'s `IRQn_Type` cross-checked against the startup `.S`; `--audit`
      cross-checks both and exits 2 on a mismatch.
- [x] `tools/gen_h417_peripherals.py` - assembles the `peripherals:` block: pin data
      mechanical from `extract_h417_pins.py`, settings per peripheral TYPE from the RM.
      `--splice` writes it into the MCU file; `--missing` shows the gap.
- [x] 78 peripherals (from 13), every one with `signal_pins:` where it holds a pin.
- [x] `nvic:` - 125 vectors, PFIC scheme with **4 priority bits at [7:4]** (where CH32V00x has
      two and CH32X035 three), four nesting groups, DMA channels, EXTI line ranges.
- [x] `codegen.periph_clock` - all 73 `RCC_HB*Periph_*` bits across the three buses. Two of them
      are spelled differently from their peripheral in the SPL (`USBFS` -> `RCC_HBPeriph_OTG_FS`,
      and `OPA`/`CMP` -> `RCC_HB2Periph_OPCM`); the bit keys are peripheral names and the domain
      carries `sdk:` for the SPL spelling, so `clockBitOf('USBFS')` resolves instead of silently
      writing no enable for the USB clock.
- [x] `clock:` - four oscillators, the SYS PLL (six sources, shared divider, 32 multipliers),
      SYSCLK mux, HPRE/FPRE/PPRE2/ADCPRE, HSE coupling, bus membership.
- [~] **(AGENT-1) CH32H417: `params:` for the peripherals that have none.**
      The part's peripheral SET is complete - 78 entries from the DS + the 41 SPL headers -
      along with its pins (950 AF assignments, mechanical), its clock tree, its 125 NVIC
      vectors and its 73 clock-enable bits, but ~70 peripherals have no `params:` block, so
      Parameter Settings has no rows for them. Each parameter needs its `struct:`/`sdk_field:`
      and every option's `sdk:` macro traced to that part's own header, which is what
      `tools/verify_sdk_names.py` checks; inventing them wholesale would put names nobody
      compiled into `data/`. Held in `tests/completeness.test.js`'s `IN_EXTRACTION`, so those
      cells print with this line as their owner and become hard failures the day it is
      ticked - which is what stops the exemption outliving the job.
      **Round 6 progress, counted by `python tools/coverage.py`'s companion count (a peripheral
      with a non-empty `params:` list): 65 missing -> 48 missing.** Landed 2026-09-12T19:24Z:
      USART4-8, SPI3-4, I2C3-4 (one struct each, aliased from a single template in
      `data/sources/H417/peripheral_extras.yaml`), and the four DIFFERENT timer time bases -
      TIM5 (16-bit GP), TIM6/TIM7 (basic: no counter mode, no clock division, no repetition
      counter, each absent by an RM bit table rather than by omission), TIM8 (advanced, the
      only other instance with RPTCR) and TIM9-TIM12, which have their own
      `TIM9_12_TimeBaseInitTypeDef` and their own `TIM9_12_TimeBaseInit()` with a 32-bit
      period. Compiled on CH32H417QEU6 with I2C3, TIM6, TIM9 and USART4 enabled.
      **48 -> 43 at 2026-09-12T20:49Z:** ADC1, ADC2, DVP, IPC, SWPMI. The ADC sampling
      times are CH32H417's own (RM 11.3.5, `CH32H417RM.md:14974`) and five of the eight
      differ from CH32V006's while the macro names are identical, so `verify_sdk_names.py`
      would have passed a copied list with every number wrong. Where a `settings:` row
      already decides a register field - DVP's data width, SWPMI's loopback, the ADC's
      independent/dual - the field is written as `const:` rows with one dependency each
      rather than a second dropdown that could contradict the pin plan.
      **Blocked, not forgotten: FMC.** `FMC_NORSRAMInit()` takes one struct whose timing
      members are POINTERS to a second struct (`ch32h417_fmc.h:113-115`), and nothing in
      the SDK takes `FMC_NORSRAMTimingInitTypeDef` alone, so `codegen.init_structs` cannot
      express it and a block with no `fn:` emits a TODO. Shipping the outer struct without
      the timings is not a fallback either: `FMC_NORSRAMInit()` dereferences
      `FMC_ReadWriteTimingStruct` unconditionally. REQUEST posted to AGENT-2 2026-09-12T19:33Z
      with the shape; `ETH_InitTypeDef`, `FMC_NANDInitTypeDef`, `FMC_SDRAM_InitTypeDef` and
      `ECDC_InitTypeDef` are the same shape on this part, so it is not an FMC special case.
      **43 -> 39 at 2026-09-12T21:47Z:** I2S2, I2S3, SDIO, HSADC. Three of the four repeat one
      pattern - a `settings:` row already decides a struct member, so the member is `const:`
      rows keyed off that row rather than a second dropdown that could contradict the pin
      plan: I2S's Mode is both `I2S_Mode` and `I2S_MCLKOutput` (it is what claims the MCK
      pad), SDIO's Mode is `SDIO_BusWide` (it is what claims D0-D7). HSADC ships 3 of its 11
      members as rows and DECLARES the other eight in `notes:` - they are a DMA transfer in
      flight, including two buffer addresses this tool cannot know.
- [x] (AGENT-2) **The schema limit is gone: `clock.plls:` and a list-valued `source:`.**
      A part may now declare any number of PLLs - each with `inputs:`, either `multipliers:`
      (plus optional `dividers:`) or a fixed `output_mhz:`, and an `output:` name that other
      taps, other PLLs and `sysclk.sources` can cite - and any tap's `source:` may be a LIST,
      which the clock tab draws as a `<select>`. `clock.pll` is still the SYS PLL, so the five
      single-PLL parts are byte-identical (their serialized `clock:` state and their RCC word
      value/mask, both measured). Prescalers also gained `default:` / `default_source:`, and a
      PLL may carry `min_mhz` / `max_mhz` / `target_mhz`. Codegen gained `codegen.rcc.extra:` -
      further register words (CFGR2, PLLCFGR2) built by the same `put()` - and NAMES in the
      generated C any mux or PLL the file does not encode, instead of printing the tree in a
      comment and writing no bits. Proved on a synthetic part in a real browser: **USBHS_PLL
      480 MHz -> USBFS /10 = 48 MHz**, RM 3.4.13's own worked example, light and dark at 1280
      and 1920 wide, 100 % and 125 %. `app/tests/clockmux.test.js` + `clockmux_ui.test.js`.
- [ ] (AGENT-1) **CH32H417: fill the four secondary PLLs and the eight `RCC_CFGR2` muxes in.**
      The schema above holds them and the app computes nothing for USB / LTDC / ETH until the
      YAML says so. The exact block, with the RM line for every field, is on `agents/BOARD.md`
      2026-09-12T19:38Z; `data/FORMAT.md` and `tools/validate_mcu.py` are the same board entry
      (the validator refuses a list `source:` and a non-PLLCLK `sysclk.sources` entry today).
      Acceptance is one number on the clock tab of the real part: USBFS 48 MHz.

**Two findings that outrank the data work**, both filed on the board:

1. **The two startup tables do not align.** `startup_ch32h417_v3f.S` starts at `.word _start`
  (index 0) and `startup_ch32h417_v5f.S` does not, so its table is one entry short at the
  front. Reading v5f index-for-index against `IRQn_Type` names the **wrong handler for every
  peripheral vector** - an interrupt that never fires or fires the wrong function, silent in
  both directions. Anchored on the ISA's fixed exception numbers, and `--audit` reports the
  offset on every run.
2. **`validate_mcu.py`'s `_signals_routed_by` read only `remaps:`.** On an AF-muxed part
  (`signal_pins:`) it returned an empty set, so `clock.hse_signals` failed with "not routed to
  a pin by any RCC remap" whatever the file said. Fixed to read both schemas.

---

## The coverage ledger — every peripheral, every function, every pin (2026-09-12, human-directed)

The rule, the schema and the loop are `docs/COVERAGE.md`; the tool is `tools/coverage.py`; the
gate is `tests/coverage.test.js`. A part is not done while `python tools/coverage.py <PART>`
prints an open row, and `data/coverage/<PART>.yaml` records the count, which may only go down.

- [x] `tools/coverage.py` + `tools/coverage_lib.py` + `tools/ledger.py`: the inventory (DS pin
      functions, both readings; RM chapters; SPL instances) joined to the MCU file, seven checks,
      the ratchet, and the planted-break self-test (`tools/coverage_selftest.py`).
- [x] `validate_mcu.py`: a routed signal no choice claims is an ERROR (the reverse of the check
      it always had); a routing-less peripheral must declare `pins: { none, source }` or
      `pins: { open, owner, task }` - silence is an ERROR.
- [x] CH32V006, CH32V005, CH32X035: coverage 0 open. CH32L103 ADC1's ten unselectable channels
      given a Channels setting (DS Table 2-1-1).
- [x] (AGENT-1) **CH32V003: model USART1_CK once codegen emits USART_ClockInit** - `python
      tools/coverage.py CH32V003` prints **0 open** and `data/coverage/CH32V003.yaml` says
      `status: complete`. 3 -> 0 on 2026-09-12. **The "needs APP" was wrong, and finding that
      out was the work.** The generator did not need a new feature: `initPlan()` already groups
      `params:` by `struct:` and gives each block its own `codegen.init_structs` function, and
      `depends_on: { setting: Mode, equals: Synchronous }` on every row of the second struct is
      the gate - so an asynchronous project emits no `USART_ClockInit()` call at all. Both
      halves of the fact landed together so neither can appear alone: a `Synchronous` Mode
      choice claiming CK, and four `USART_ClockInitTypeDef` rows that depend on it. ONE
      synchronous choice, not Master/Slave - RM 12.4 (`CH32V003RM.md:9878`): "works only in the
      main mode, i.e. the CK pin outputs only the clock and does not receive inputs". CK's pad
      per mapping is RM Table 7-10's own row (`:3756`) - PD4 / PD7 / PD7 / PC5, and 01 and 10
      ARE the same pad, which is why the DS writes `UCK_1/UCK_2` on PD7 (`CH32V003.md:1114`).
      Compiled: CH32V003F4P6, USART1 Synchronous, CPOL High, CPHA 2 Edge, last-bit pulse on,
      `--strict` 0, `pio run` SUCCESS.
- [x] (AGENT-1) **CH32L103: close the coverage ledger** - `python tools/coverage.py CH32L103`
      prints **0 open** and `data/coverage/CH32L103.yaml` says `status: complete`. 33 -> 12 -> 0,
      closed 2026-09-12 by modelling CMP2 and CMP3. The four `ABSENT` entries AGENT-3 staged in
      `tests/completeness.test.js:159-166` took effect the moment the two peripherals existed,
      exactly as that comment predicted, so nothing had to be added there. **Two defects fell
      out of it, both shipping since the part landed and both invisible because no fixture ever
      switched a comparator on:** `codegen.init_structs` had no `CMP_InitTypeDef`, so CMP1's
      `params:` were filled in and followed by `/* TODO: nothing applies this struct */`; and no
      comparator carried a `CMP_NUM` row, which was right for CMP1 by accident (`CMP1 = 0` and
      the struct is zero-initialised) and would have made CMP2's and CMP3's blocks configure
      CMP1. Both fixed - `CMP_InitTypeDef: { fn: OPA_CMP_Init, no_handle: true }` and a
      `const: CMP_NUM` row heading all three. Compiled: CH32L103K8U6 with CMP2 and CMP3 on,
      `--strict` 0, `pio run` SUCCESS. The historical record of the 33 -> 12 cycle: **33 -> 12 open this cycle** (BOARD 2026-09-12T12:01Z): BKP TAMPER on
      PC13, PWR WKUP on PA0, RTC output on PC13, RCC LSE on PC14/PC15, RCC MCO on PA8, USBPD
      CC1/CC2 on PB6/PB7, I2C1/I2C2 SMBA on PB5/PB12, EXTEN modelled as a peripheral, chapters
      13 (TKEY -> ADC1) and 25 (EXTEN) mapped, the PD1 OSC_OUT disagreement recorded, and BOOT1
      declared absent with its source. **The 12 remaining are the CMP2/CMP3 pads**, blocked on
      four `ABSENT` entries in `tests/completeness.test.js` (CMP2/CMP3 × nvic/clock) - requested
      from AGENT-3 on the board; if they do not land by the next cycle I add them myself as a
      recorded DECISION. Also recorded on the board: `const:` is now needed by CH32L103's CMP1
      too, because `OPA_CMP_Init` branches on `CMP_NUM` (`ch32l103_opa.c:172,178,184`).
- [x] (AGENT-1) **CH32H417: close the coverage ledger** - `python tools/coverage.py CH32H417`
      prints **0 open**, and `data/coverage/CH32H417.yaml` says `status: complete`. 104 -> 0.
      Four of those rows were data; the other hundred were the READER. Three parser defects,
      each with a planted break in `tools/coverage_selftest.py` (25/25 caught):
      the pin-NAME cell wraps (`PC13(4)-RTC` arrives as `PC13` `-RT` `C`, and read token by
      token the type column becomes the functions `C`, `I`, `O`); the AF code itself wraps
      (`SDRAM_DQM3(A` + `F7)`, which made PB0's DQM3 invisible to the pin-first reading and a
      phantom disagreement in the signal-first one); and `parse_signal_rows` required an
      underscore in a signal name, so `MCO PB0(AF0)`, `CC1`/`CC2` and `SWCLK`/`SWDIO/SWIO`
      were skipped AND their pins filed under whatever signal came before them - PB3/PB4 under
      UHSIF_CLK, PB8/PB9 under USART8_CTS, PB0 under DFSDM_CKOUT.
      Modelled: MCO on PB0 (the generator dropped it - `NOT_A_PERIPHERAL` ran before `MERGE`),
      the LSE pads OSC32_IN/OSC32_OUT on PC14/PC15, I2S2_MCK's second pad PC6, FMC_DQM3's PB0,
      and the USB controllers' pads moved into `dedicated_pins.yaml` where a refresh keeps them.
      Declared: 29 `disagreements:` citing both readings (SerDes TX/RX swapped, USART8's AF11
      CTS/RTS, QSPI2 SIOX0-3 where Table 2-1-1 contradicts ITSELF, SDRAM CKE0/CKE1/DQM2/RAS_N,
      LPTIM2_CH2, LTDC_B4, SWPMI's 1-wire pad), TKEY as an ADC mode (RM 13.1), DMAMUX as the
      two DMAs' request router (RM 10.2.3), and PB6's SDRAM_A5 as the one fact the
      single-FMC-name-space model loses. A declared disagreement now closes BOTH rows a
      difference produces (`docs/COVERAGE.md`), because the `absent:`-beside-every-entry
      alternative would have hidden the conflict it was recording.
- [~] (AGENT-1) **CH32H417: default pins collide** - found by `tests/h417_packages.test.js`,
      which sweeps all 419 mode choices on each of the three packages and asks what the app
      does when a user does nothing but switch a peripheral ON. On **QFN68 26, QFN88 20,
      QFN128 17** of those choices put two signals on ONE PAD although the signal had another
      bonded pad free - a configuration the silicon cannot honour, reached without the user
      touching a pin. The conflict engine does not report them because both claims have the
      SAME OWNER, which is how the four LTDC pads (`tests/h417_ltdc.test.js`) stayed broken
      through a green suite; DVP, FMC, I2C4, PIOC, SDIO, UHSIF and USART6 were never looked at.
      **The fix is not the YAML.** The default is the first bonded option in `signal_pins:`, and
      the generator used to emit that list in DATASHEET order with no notion of which pad becomes
      the default - so the 2026-09-12 hand-reordering of LTDC's lists lived in the generator's
      OUTPUT and every regeneration discarded it.
      **DONE 2026-09-12, 26/20/17 -> 4/0/0.** `order_defaults()` in
      `tools/gen_h417_peripherals.py` chooses them now: a greedy over the signal sets each
      CHOICE turns on together (two signals collide only if some configuration claims both -
      FMC's address bus and its data bus never do), with the debug pads PB8/PB9 seeded as
      already taken (SYS holds them out of reset, and PB9 was the single most common
      casualty: DVP_D7, FMC_A4, FMC_DQM2, I2C4_SDA, LTDC_B7, PIOC_IO1, SDIO_D5 all defaulted
      onto it), a weaker whole-peripheral tiebreak for rows that are live at once (LTDC's
      colour depth AND its sync row), and then `_repair()`, a deterministic hill-climb that
      keeps a move only when it strictly lowers the count. `tests/h417_ltdc.test.js` is green.
      **Four are left, all on QFN68**, where the signal has no free pad the package bonds.
      `COLLISION_CEILING` in `tests/h417_packages.test.js` still ratchets; retire the exemption
      and this line together at 0.
      Separately: `SYS_SWIO` (PB9) is the pad most of these land on, so the debug port is the
      most common casualty; on QFN68 I2C1 has no other option and THAT one is the silicon.

- [x] (AGENT-1) **CH32H417 declares no `codegen.analog_signals`, so an analog pad is not
      recognised** — found by AGENT-3 extending the CH32H417 fixture to claim OPA1 P0/N0/OUT0 and
      DAC OUT1, pads the coverage ledger made reachable that no fixture had ever configured.
      `analogClaim()` (`app/engine/constraints.js:255`) reads `codegen.analog_signals` and falls
      back to "Analog-category peripheral on an analog-capable pin"; CH32H417 declares **neither**
      (its `pins:` block carries no `analog:` flag, which the file header already records as a
      declared gap). So the fallback returns false, `gpioEffectiveMode()` takes the
      alternate-function branch, and the generated C configures **PA4, PB0, PB1 and PC4 as
      `GPIO_Mode_AF_PP` where an analog pad must be `GPIO_Mode_AIN`** — wrong-but-compiling, the
      defect class this round exists to remove. The TODO codegen emits beside it also tells the
      reader to add an `af:` to a pad that has none, which is unfollowable advice (that half is
      AGENT-2's). Evidence and the generated C: `tests/evidence/round5/2026-09-12-analog-pads.md`.
      **DONE 2026-09-12.** `codegen.analog_signals` now lists ADC1/ADC2 IN0-15, HSADC IN0-6,
      DAC OUT1/OUT2, OPA's eighteen and CMP's four INPUTS - each traced to the vendor's own
      example rather than to the category: `EXAM/ADC/ADC_DMA/Common/hardware.c:64-65`,
      `EXAM/HSADC/.../hardware.c:31`, `EXAM/DAC/DAC_DMA/Common/hardware.c:35`,
      `EXAM/OPA/OPA/Common/hardware.c:27,31`, `EXAM/OPA/CMP/Common/hardware.c:34-35`, all
      `GPIO_Mode_AIN`. **CMP_OUT is deliberately NOT in the list**: the same file gives PB12
      `GPIO_AF13` and `GPIO_Mode_AF_PP`, so the comparator's inputs are analog and its output
      is a digital alternate function - the distinction the category fallback cannot make.
      SERDES went to `codegen.skip_signals` instead, not to this list: `sds_initial()` in
      `EXAM/SerDes/FullDuxTrans/Common/hardware.c:65-67` enables the SerDes and the GPIOE
      clock and then calls no `GPIO_Init` for PE3-PE6 at all, so those pads take no GPIO
      configuration of any kind. `validate_mcu.py` now exempts an analog signal from the
      "has no `af:`" warning the way it already exempted a skipped one, which is why the
      repo-wide count went 166 -> 99; what is left on this part is UHSIF 62 and SDMMC 32,
      digital pads that genuinely want an AF code read off the DS.

- [x] (AGENT-3) **CH32H417 LTDC: the layer pixel format is selectable, including the 8-bit
      ones.** Done 2026-09-12, on a direct human request ("be able to select it as an option to
      do pin planning and not get warnings"). `Layer 1 pixel format` and `Layer 2 pixel format`
      in Parameter Settings, all eight values of `LTDC_LxPFCR.PF[2:0]` (RM 43.4.18, RM:65146)
      including `L8`, `AL44`, `AL88`, defaulting to the reset value ARGB8888 (RM:64570). The
      option macros (`ch32h417_ltdc.h:200-208`) are verified by `verify_sdk_names.py`.
      **The blocker recorded here was half right and the half that was wrong is the useful
      part.** The format does live in `LTDC_Layer_InitTypeDef`, which `codegen.init_structs`
      cannot express per layer - but the SDK also has a plain two-argument setter,
      `LTDC_LayerPixelFormat(LTDC_Layerx, fmt)`, and `sdk_args:` passes a non-placeholder
      through literally, so a call looked easy. Reading it is why none is emitted:
      `ch32h417_ltdc.c:622-672` is a RECONFIGURE call that rescales `CFBLR` from the layer
      WIDTH, which is 0 until `LTDC_LayerInit()` has run, so an init-time call would write a
      3-byte line length and a pitch of 0 - wrong-but-compiling. The row is `sdk_none:` with a
      cited `sdk_note:`: the choice is recorded, stated in the generated C as a comment, and
      applied by the user's own layer init under `USER CODE BEGIN Periph_LTDC`. No TODO, no
      `#error`, `--strict` exit 0. Held by `tests/h417_ltdc.test.js` (5 new tests, both halves).
- [x] (AGENT-1) **CH32H417 LTDC: the rest of `LTDC_Layer_InitTypeDef`** - done 2026-09-12,
      the cycle AGENT-2 landed deliverable E's per-instance emitter (`096daa6`). All sixteen
      members as `channel_params` with `applies_per: layer` and an `instances:` map naming
      `LTDC_LayerInit` and `LTDC_Layer1` / `LTDC_Layer2` (ch32h417_ltdc.h:225,
      ch32h417.h:1770-1771), gated by two new `Layer 1` / `Layer 2` setting rows that carry no
      `signals:` - a layer is a rectangle of memory composited onto the RGB port `Colour depth`
      already wired, so it claims no pad. **The pixel format moved INTO the layer struct and
      its two `sdk_none:` planning rows were deleted**: `LTDC_PixelFormat` is an ordinary member
      of the struct `LTDC_LayerInit()` writes, so the round-5 note explaining why it could only
      be recorded and not applied is obsolete rather than merely out of date. The generator's
      loss guard refused the deletion until it was declared, which is `--allow-loss` working as
      designed. LTDC also gained its own fifteen-member `LTDC_InitTypeDef` params - four
      polarities, the eight ACCUMULATED timing counters (each a running total from the start of
      the line, not a porch width, ch32h417_ltdc.h:36-57) and the background colour - so the
      peripheral-level cell did not empty when the format rows left. Generated, read and
      compiled: `LTDC_Init(&s)` then `LTDC_LayerInit(LTDC_Layer1, &s)` for layer 1 alone with
      layer 2 off, `--strict` 0, `pio run` SUCCESS on CH32H417QEU6.

> **2026-09-12 — every `(AGENT-4)` line above is `[-]`, superseded.** AGENT-4 does not exist in
> round 5 or 6 (three agents; the launcher starts 1-3). Each of its open lines either closed under a
> later owner's line (verify_sdk_names in run.js, Taskfile, `lib/util` native tests, the README
> environment facts, the round-3 DONE section) or is restated in round 6 under AGENT-3 (the flash
> evidence line, the dead-control sweep). Nothing was deleted; `[-]` is the record.
