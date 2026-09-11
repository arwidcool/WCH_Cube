# PROGRESS — WCHCube

The ongoing source of truth for where this project stands. Keep it current: if a
statement here stops being true, change it here first.

- **Last updated:** 2026-09-12 (hand edit — one delivery path, real parts only)
- **Branch:** `main` (no remote)
- **Verified this pass:** `python build.py` → OK · `node tests/run.js` → **467
  green, 0 skipped** · the browser Generate button re-checked by hand at the
  hand-off below.
- **New this pass: one Generate button, one archive, and no invented silicon.**
  Three changes, all on the delivery edge rather than in the engine:
  1. **GENERATE CODE and GENERATE PROJECT became ONE action.** The split was
     never real: the init code without `platformio.ini`, `src/main.c` and a
     README around it is a handful of files in Downloads that nobody can flash.
     There is now one file list, one button (two, doing literally the same
     thing: the breadcrumb and the Project Manager), and one delivery:
     `<Name>.zip` in a browser, `<folder>/<Name>/` on the desktop or through the
     File System Access API. The pin table and clock summary moved under
     `docs/` inside the archive.
  2. **The page no longer carries its own ZIP writer.** `app/template.html`
     had a second, hand-rolled copy of the format next to `app/engine/zip.js` —
     ~60 lines nothing tested, beside one `app/tests/zip.test.js` proves against
     a real unzipper. The page is now a thin `zipOf()` over the engine's
     `zipFiles`; one implementation, one set of evidence.
  3. **`WCH-DUMMY32-C8` is out of the shipped data.** It is not silicon, and it
     was in the part selector and in the built bundle (726 KB → **675 KB**). It
     moved to `tests/fixtures/mcus/`, kept rather than deleted because it is
     still the only fixture that reaches LQFP100/LQFP144, that has three GPIO
     speeds, that uses a different NVIC priority scheme, and that spells the HSE
     pins `OSC_IN`/`OSC_OUT`. `tests/data.test.js` now fails if a synthetic part
     reappears in `data/mcus/`, and `tests/clock_ui.test.js` covers the "no HSE,
     no PLL" clock shape on CH32X035 instead.
- **Not yet true, and the words matter:** nothing here has been **flashed**.
  Every green result in this repository is a compile. See §6 and `HUMAN_TODO` 6.
- **New this pass:** the CH32X035 DMA request map that the RM's markdown
  conversion had destroyed (RM Table 9-2 — rows kept, columns lost) is
  recovered from the original PDF by word position, cross-checked against the
  surviving row order and nine EVT-example anchors, all three agreeing on all 27
  requests: `agents/proposals/CH32X035_dma_requests.yaml`. The original RM
  (V1.9) and DS (V2.2) PDFs now sit beside their conversions.
- **New this pass, and the point of the round: a SECOND FAMILY compiles.**
  CH32X035's generated C builds for `CH32X035G8U6` through the same gate as the
  three CH32V00x fixtures, and the fixture that produces it contains no
  part-specific code — the data decides that the clock enable is
  `RCC_APB2PeriphClockCmd` rather than `RCC_PB2PeriphClockCmd` and that the one
  GPIO speed is 50 MHz rather than 30. `tests/no_part_names.test.js` holds that
  line: `app/engine/` and `app/template.html` name no part outside comments.
- **Not yet true, and the words matter:** nothing here has been **flashed**.
  Every green result in this repository is a compile. See §6 and `HUMAN_TODO` 6.

Related documents, none of which this file duplicates:

| Read this | For |
|---|---|
| `TASKS.md` | the backlog, claimed and unclaimed |
| `agents/PROJECT.md` | **the current round brief** and its definition of done |
| `agents/AGENT_n_*.md` | the three agents' standing instructions |
| `agents/BOARD.md` | the current message board — decisions, handoffs, QA results |
| `agents/WALKTHROUGH.md` | the round-5 acceptance script |
| `agents/README.md` | the working agreement: ownership, cycle, gates, rules |
| `agents/HUMAN_TODO.md` | things only the human can do |
| `agents/history/INDEX.md` | rounds 1–4, what each produced, and why they are archived |
| `data/FORMAT.md` | the MCU YAML schema — the DATA↔ENGINE contract |
| `data/firmware/ARCHITECTURE.md` | firmware layering, seams and ownership |
| `data/sources/README.md` | where hardware facts come from, and the EVT rule |

---

## 1. Overall status

Two halves, at very different maturities.

**The configurator** — an STM32CubeMX-style pinout, clock, peripheral and code
generator for WCH RISC-V parts, written as plain JS/SVG/YAML and built by
`build.py` into one offline `dist/index.html`. This half is **feature-complete
for round 1 and mid-way through round 2's correctness pass.** It loads, it is
tested by ~293 automated tests, and its P0 clock bug is fixed and verified in a
real browser.

**The firmware** — new this round. `data/firmware/` is a PlatformIO project that
compiles for real CH32V006 / CH32V005 / CH32X035 silicon with the WCH EVT NoneOS
SDK. It exists to turn the configurator's output into an ELF, and to make
"the generated C compiles" a checkable claim rather than a hope. It builds today.

The honest one-line summary: **the tool works and is being polished; the
firmware path is wired end to end, it found two defects in the generated code
that no amount of browser testing could have caught, and both are now fixed and
held shut by a test that compiles.**

---

## 2. Completed work

### Configurator — engine and data

- Engine split into 12 ESM modules under `app/engine/` with zero DOM access;
  `build.py` inlines them so `dist/index.html` stays a single offline file, and
  Node imports the same modules for tests.
- Conflict engine: shorted pin pairs treated as one physical pin, exposed pads,
  per-package reset pins, pre-emptive warnings in the picker, conflict banner.
- Clock engine with `clockCalc`, HSE coupling, out-of-spec detection.
- `mcu.inherits:` with map merge / list replace / `mcu.remove:` — CH32V005 is
  defined as a delta on CH32V006.
- Project save/load (`.wchproj` YAML), undo/redo, exports (pin table md + CSV,
  clock summary md), C code generation (`app/engine/codegen.js`).
- `tools/wchcube_cli.js` — the whole engine without a browser.
- **CH32V006 fully extracted** from DS v2.0 + RM v1.4: 7 packages, remap tables
  re-derived by an independent parser with 0 differences over 232 pin
  assignments, EXTI map, DMA1 request map, 18 peripherals, 29 NVIC vectors,
  23 DMA requests with defaults, `params:` for USART1/2, SPI1, I2C1, TIM1, TIM2,
  ADC1, and a `codegen:` register-encoding block.
- **CH32V005** via `inherits:`, pinout verified against DS Table 2-2 (0 diffs).
- `WCH-DUMMY32-C8` synthetic part covering QFN12 → LQFP144 for layout testing —
  **moved to `tests/fixtures/mcus/`** (2026-09-12): a fixture is not something
  the app should offer in its part selector.
- `tools/validate_mcu.py` — schema, geometry, pin existence, remap parity, I/O
  counts, EXTI legality, HSE coupling, codegen names, DMA and NVIC checks.
  14 planted breaks, 14 caught.

### Configurator — UI

- CubeMX-shaped frame: menu bar, breadcrumb, four tabs, three-column pinout view.
- Chip SVG with rotation, mirroring, SVG export, search; pin picker; peripheral
  tree with status glyphs; GPIO settings table; user labels; keyboard shortcuts
  with an overlay; dark theme; system block-diagram view.
- Parameter Settings tab, driven by the MCU file's `params:`.
- **Round-2 P0a: the clock tab.** HSE is selectable everywhere, selecting it
  auto-enables RCC's crystal and claims XI/XO through the normal conflict engine,
  the crystal frequency moves SYSCLK, out-of-DS-max goes red. QA-verified in a
  real browser across three parts (`tests/clock_ui.test.js`, 14 checks).

### QA

- ~293 tests over `app/tests/` (engine) and `tests/` (QA), one runner.
- **`tests/codegen_compile.test.js` — the compile gate.** Generates C from a
  checked-in `.wchproj` that assigns pins, drops it into `data/firmware` and runs
  `pio run` for three part/package/environment combinations. Planted-break
  tested: three breaks, three caught. Builds in its own `.pio/gate` tree so a
  concurrent `pio run` cannot make it lie in either direction.
- **Skips are first class.** `tests/lib/harness.js` has `skip(reason)` and the
  runner counts skips, prints the reason, and lists every one above the verdict
  on a green run. A check that did not run is never reported as a pass.
- `tests/smoke.js` drives every MCU × every package with a silent-console
  assertion; `tests/layout.test.js` checks fit at 1280×720 and 1920×1080.
- Real-browser evidence with screenshots in `tests/evidence/round2/`.
- Engine unit tests reach 100 % of `app/engine/*` exports.

### Firmware and project setup — this round

- **`data/firmware/`: a complete, building PlatformIO project.** Four
  environments, SDK-style layering, components as PlatformIO libraries.
- **`data/firmware/ARCHITECTURE.md`** — layers, seams, the two-clock-owners
  hazard, the EVT authority rule, and the concurrency/ownership rules.
- **`data/sources/README.md`** — the EVT note: EVT sources are provided per MCU
  under `data/sources/<PART>/Evt/` and are authoritative. **They have landed** for
  V006 and X035 — section 5.
- **Two defects in the generated C found by compiling it, and both now closed** —
  section 6.
- **`agents/HUMAN_TODO.md` item 5 settled** — section 6.
- **`tests/codegen_compile.test.js`, the compile gate** — section 7. Three
  configurations that assign pins, generated and built for their own
  environments.
- **`src-tauri/` compiled for the first time** — and it had never compiled;
  section 6.
- **Round 3 put under git.** `data/firmware/`, this file, the `Agents Rounds 3/`
  pack and the whole reorganised `data/sources/` tree were all untracked.

---

## 3. Current work

**Round 4 — "a second family, and a project you can flash"** is open. Brief and per-agent
instructions in `Agents Rounds 4/`; launcher `Agents Rounds 4/run_round4.ps1`. Round 3's open lines
carry over as D1–D9 and come first.

Two deliverables, and they prove each other:

**A. CH32X035 end to end.** Everything in `data/mcus/` today is one family — CH32V005 is CH32V006
with things removed, and the dummy part was built to look like them. CH32X035 is a different shape
in nine confirmed ways (no HSE at all, 24-bit ports, a port with a hole, remaps as named SDK macros,
AHB/APB1/APB2 domains, 8 DMA channels, 47 vectors with grouped EXTI, four USARTs, USB + USB-PD +
PIOC + AWU). Each one is a place where the repo either reads the MCU file or has a CH32V006
assumption baked in, **and today nobody knows which.** The real deliverable is the proof that adding
a part is a data job.

**B. "Generate PlatformIO project".** The app emits a complete standalone folder — `platformio.ini`,
`src/main.c`, the generated init, a README — that a user opens in VS Code and flashes. Today they
can generate `wchcube_init.c` and still be several manual steps from a running board.

**Both EVT packages have landed** — `data/sources/V006/Evt/` (988 files) and `data/sources/X035/Evt/`
(2 239 files) — so every "until the EVT package arrives" sentence in this repo is stale, this one
included once AGENT-4 sweeps them.

| Agent | Round 4, in order |
|---|---|
| DATA | The bulk of A. Extract CH32X035 with a **parser** (the DS markdown is mangled — rows split across lines, seven package columns merged into single cells) and diff it with a second pass. 8 variants, 7 packages, `QSOP28` geometry, `LQFP64M` resolved. Post the `clock:` block (no HSE), the `pins:` block (24-bit, PC has a hole) and the remap `macro:` schema **early** — each unblocks someone else. Then D8. |
| ENGINE | D1–D3 first (they block AGENT-3). Then make the engine genuinely generic: 24-bit masks, no port iterated 0..N, a part with no HSE that neither throws nor renders a placeholder, remaps as `GPIO_PinRemapConfig` where the data gives a macro, grouped NVIC vectors. Then B's generator: the whole project file set, `platformio.ini` from `pio_board`, an honest `main.c`, a CLI flag, and a ZIP writer for the browser. |
| UI | D4. Then the clock tab on a part with no HSE — no box, no mux entry, no greyed placeholder — with CH32V006 unchanged. Seven packages incl. LQFP64 at 60 I/O. DMA sized from the data at 8 channels, NVIC showing three grouped EXTI rows not twenty-six. Then B's button: Generate PlatformIO project, previewing every file, refusing by name where no board exists. |
| QA | D5–D7, D9. Then `tests/generated_project.test.js` — generate a whole project to a scratch dir and `pio run` it standalone. Extend every suite to CH32X035 × 7 packages without costing CH32V006 anything, add `tests/no_part_names.test.js`, sweep the stale EVT language, and put a specific flash request to the human. |

## 4. Remaining work

Ordered by what blocks the most.

1. **DMA Settings and NVIC Settings tabs** (P0c). The data exists and is
   complete for CH32V006; the UI does not render it yet — `app/template.html`
   contains no "DMA Settings" or "NVIC Settings" tab. Also missing: the DMA1
   channel table and the NVIC overview in System Core, double-booked-channel
   conflicts, and the `DMA_InitTypeDef` blocks in generated C.
2. **Text legibility (P0b)** — 8 measured findings, all open.
3. ~~Fix the generated C so it compiles~~ — **done**. Both defects closed and
   held shut by `tests/codegen_compile.test.js` (§7). What is left of this line:
   `params:` → `*_InitTypeDef`, DMA and NVIC into the `.wchproj` format and then
   into the C, and the fixtures grown to cover them.
4. **`tests/completeness.test.js`** — the per-peripheral matrix that fails by
   name when a cell is missing.
5. ~~`WCH-DUMMY32-C8` gets `dma`/`nvic`/`params`/`codegen`~~ — **done in round 3
   (C7), and the part has since left `data/mcus/` entirely (2026-09-12).** It is
   now `tests/fixtures/mcus/WCH-DUMMY32-C8.yaml`, registered only by the test
   harnesses that want it, so the app offers real parts and nothing else.
6. **The remaining round-2 DONE lines**: zero dead controls, no TODO sections in
   generated C, full round-trip through save/open including clock and params.
7. **More parts.** CH32X035 datasheet and RM arrived this round and there is no
   `data/mcus/CH32X035.yaml` yet. CH32V003, CH32V203, CH32V307 have no sources.
8. **Firmware, once the configurator side is honest**: a real peripheral
   component (UART first), host-side unit tests for `lib/util` under a
   `[env:native]`, and a CI job that regenerates and compiles.

---

## 5. Hardware / MCU status

| Part | Sources present | YAML | PlatformIO env | Notes |
|---|---|---|---|---|
| CH32V006 | DS v2.0 + RM v1.4, `data/sources/V006/Datasheets/` | complete | `CH32V006F8P6`, `CH32V006K8U6` | the reference part. 7 packages, 18 peripherals, 29 vectors, 23 DMA requests |
| CH32V005 | same RM (family) | `inherits: CH32V006` | `CH32V005F6P6` | drops TKEY, TIM3, QFN32 |
| CH32X035 | DS v2.2 + RM, `data/sources/X035/Datasheets/` + **EVT, 2 239 files** | **landed, in progress** | `CH32X035G8U6` | the second family. 7 packages, 8 variants, all packages draw with 0 conflicts; generated C **compiles**. Extraction is not finished — 7 peripherals so far, and `gpio.modes` still claims two open-drain modes this part does not have (§6) |
| WCH-DUMMY32-C8 | n/a — synthetic | `tests/fixtures/mcus/` | n/a | layout/scale fixture, QFN12 → LQFP144. Not shipped, not offered in the part selector |
| CH32V003, V203, V307 | none | none | none | waiting on sources |

**Both EVT packages have landed** — `data/sources/V006/Evt/` (988 files) and
`data/sources/X035/Evt/` (2 239 files). Every "until the EVT package arrives"
sentence in this repository is stale; the ones in `PROGRESS.md`,
`data/firmware/ARCHITECTURE.md` and `data/firmware/README.md` are corrected,
and `data/sources/README.md` is AGENT-1's.

**EVT packages: BOTH HAVE LANDED.** `data/sources/V006/Evt/` and
`data/sources/X035/Evt/` are populated — 84 MB, ~3 200 files, `EXAM/` + `PUB/`
+ the part list files. They are now under git. Per `data/sources/README.md` they
are the **highest authority** for every name the software uses, above the RM.
All 17 `ch32v00X_*.h` are in
`data/sources/V006/Evt/EXAM/SRC/Peripheral/inc/`.

**They are not the same as the copy PlatformIO installs, and the drop is newer**
— StdPeriph sub-version `0x05` against the package's `0x04`. All 17 headers were
diffed against `framework-wch-noneos-sdk/Peripheral/ch32v00Xx/inc/`: 14
identical, 3 differ, and two of those are **value** changes rather than version
banners:

| Macro | PlatformIO package | **EVT drop (authoritative)** | Where |
|---|---|---|---|
| `GPIO_Remap_LSI_CAL` | `0x00200080` | **`0x001A3000`** | `ch32v00X_gpio.h:117` |
| `FLASH_FLAG_OPTERR` | `0x00000001` | **`0x80000001`** | `ch32v00X_flash.h:104` |

The third, `ch32v00X.h`, differs only in which part its `#if !defined(...)`
fallback selects — harmless here because the build defines the part explicitly
(verified: `CH32V006F8P6` compiles with `-DCH32V006`). `GPIO_Remap_LSI_CAL` is
the TIM1 CH1-from-LSI remap, so anything derived from the older copy is wrong.
Handed to AGENT-1 and AGENT-2 on the board.

The PlatformIO package (installed at
`~/.platformio/packages/framework-wch-noneos-sdk`) remains what the build links
against. Series mapping, which is not guessable from the part number: **CH32V005/CH32V006 → series `ch32v00Xx`, header
`ch32v00X.h` (capital X)**; `ch32v00x.h` is a different part, CH32V003.
**CH32X035 → series `ch32x035`, header `ch32x035.h`.**

Silicon facts worth having in one place, all confirmed against the SDK this pass:

- CH32V006 GPIO has **one** output speed. `GPIOx_CFGLR.MODEy` is a single bit
  (RM v1.4 §7.3.1.1) and `GPIOSpeed_TypeDef` has one member, `GPIO_Speed_30MHz`.
  CH32X035 likewise has one, `GPIO_Speed_50MHz`.
- CH32V006 has GPIO ports **A, B, C, D** and uses `RCC_PB2PeriphClockCmd` /
  `RCC_PB2Periph_GPIOx`. CH32X035 has **A, B, C** only and uses
  `RCC_APB2PeriphClockCmd` / `RCC_APB2Periph_GPIOx`.
- `RCC_ClocksTypeDef` carries `ADCCLK_Frequency` on CH32V00Xx but **not** on
  CH32X035.
- No hardware has been flashed or run. Every firmware claim here is a build-time
  claim.

---

## 6. Known issues and blockers

### CLOSED — Defect 1, `codegen.header` named the wrong part's header

`data/mcus/CH32V006.yaml` had `header: ch32v00x.h`. The CH32V006 SPL header is
**`ch32v00X.h`**, capital X; `ch32v00x.h` is the **CH32V003** header, a different
part with a different register map. It compiled on Windows only because NTFS is
case-insensitive.

**Fixed by AGENT-1** (`header: ch32v00X.h`, cited to
`data/sources/V006/Evt/EXAM/SRC/Peripheral/inc/ch32v00X.h` line 2) and held shut
by `tests/codegen_compile.test.js`, which compares the generated `#include`
case-sensitively against the files that actually exist in the part's SPL
directory — reading the EVT drop first and the PlatformIO package second.

**The lesson is in how it was caught.** Planted back in, the *compile* still
passed: NTFS resolved the wrong-case name and the build went green. Only the
name check caught it. On this class of bug compiling is necessary and not
sufficient, which is why the two checks sit side by side rather than one
replacing the other.

### CLOSED (data half) — Defect 2, `codegen.speeds` named macros this part lacks

`codegen.speeds` said `{ Low: GPIO_Speed_2MHz, Medium: GPIO_Speed_10MHz, High:
GPIO_Speed_50MHz }` — the CH32V10x/20x/30x spellings. On CH32V006 the only member
of `GPIOSpeed_TypeDef` is `GPIO_Speed_30MHz`, because `GPIOx_CFGLR.MODEy` is a
single bit (RM v1.4 §7.3.1.1).

**Fixed by AGENT-1**: a `gpio.speeds:` list with one entry, `GPIO_Speed_30MHz`,
cited to `ch32v00X_gpio.h` lines 23–26, with the legacy Low/Medium/High keys
aliased to the same macro so nothing breaks mid-flight. Generated C now emits
`GPIO_Speed_30MHz` and the three fixtures compile.

Held shut two ways, both planted-break tested: the compiler ("`'GPIO_Speed_50MHz'
undeclared … did you mean 'GPIO_Speed_30MHz'?`") and a check that every
`GPIO_Speed_*` in the generated C is a member of the enum as read out of that
part's header.

**Still open — the UI half.** The point was never only the macro name: the GPIO
table offers the user a Low/Medium/High choice this silicon does not have.
`FORMAT.md`'s rule is that a one-entry `speeds:` list means the control is **not
shown** and the fixed value is displayed as text. ENGINE and UI own that, and it
is in flight (`app/tests/project.test.js` currently has a red line named
"setGpioField refuses a speed a multi-speed part does not offer").

### Resolved this pass — `HUMAN_TODO.md` item 5

"Verify the ch32v00x EVT SDK spelling of the port clock enable." **Settled, and
AGENT-1's spelling is correct.** `framework-wch-noneos-sdk/Peripheral/ch32v00Xx/inc/ch32v00X_rcc.h`
declares `void RCC_PB2PeriphClockCmd(uint32_t, FunctionalState)` (line 157) and
`RCC_PB2Periph_GPIOA..GPIOD` (lines 89–92) and `RCC_PB2Periph_AFIO` (line 88).
`AFIO->PCFR1` is also confirmed (`AFIO_TypeDef`, line 197). No YAML change needed;
the assumption note in `CH32V006.notes.md` can be marked confirmed.

### Open — CH32X035, found by the gates this round

- **`gpio.modes` claims two modes this silicon does not have.**
  `GPIOMode_TypeDef` in `data/sources/X035/Evt/EXAM/SRC/Peripheral/inc/ch32x035_gpio.h:29-37`
  has **six** members and no open-drain at all, yet `data/mcus/CH32X035.yaml`
  lines 686 and 688 carry `GPIO_Mode_Out_OD` and `GPIO_Mode_AF_OD` — the CH32V006
  list copied across. `verify_sdk_names.py` fails on it, so **`task validate` is
  currently red, correctly.** Generated C naming either would not compile. This is
  round 3's `GPIO_Speed_50MHz` defect one field over.
- **`codegen.periph_handle.USBFS: USBFS_DEVICE` does not exist** — 0 occurrences
  in the X035 EVT tree. The real names are `USBFSD` (device) and `USBFSH` (host),
  two separate `*_TypeDef`s, plus `USBFS_BASE` and `USBFS_IRQn`.
- **The GPIO table's mode list is hardcoded in the UI.** `app/template.html:2434`
  has `const MODES = [...]` including both open-drain entries, while the engine
  reads them from the data (`gpioModes()`). So even once the data is fixed, the
  table would still offer them. Round 3 made the SPEED column data-driven and left
  the mode list directly underneath it behind.
- **`GPIO_Mode_IPD` is per-pin on this part** — the header comments it "Only
  PA0--PA15 and PC16--PC17 support input pull-down". Nothing in the model can
  express a mode that only some pins have.
- **Three variants have no `pio_board`** and so cannot produce a generated
  project: `CH32V006F4U6`, `CH32V006D8U7`, `CH32X035D8U6`. The refusal is correct
  — F4U6 is 16 KB of flash against F8U6's 62 KB, so the nearest board would lie.

### Open, from the board

- **`mcu.remove` is applied after the parent merge** (`app/engine/inherit.js`),
  so a child that removes *and* redefines a path loses its own version. It cost
  CH32V005 its entire DMA request map. Data-side worked around; engine fix open.
- **`setSetting()` on a `checkboxes` setting** replaces the `Set` with a `String`
  and the next `compute()` throws `v.has is not a function`, blanking the app.
  Not reachable from today's UI; will be the moment peripheral tabs are generic.
- **8 text-legibility findings** (P0b), all measured, all open.
- **Two selectors show stale state**: `#mcusel` reads the wrong part at boot,
  `#pkgsel` keeps the old package after a project load.
- **RM Table 6-1 has no TIM3 vector** although CH32V006 has a TIM3. Recorded, not
  invented. **The EVT package has now landed** (§5), so this is answerable today
  from `data/sources/V006/Evt/` rather than parked — first in AGENT-1's queue,
  along with the TouchKey channel map and the OPA polling set.
- **Two macro values in the PlatformIO SDK copy are superseded by the EVT drop**
  — `GPIO_Remap_LSI_CAL` and `FLASH_FLAG_OPTERR`, §5. Anything derived from the
  older copy needs re-checking; `GPIO_Remap_LSI_CAL` is the TIM1 CH1-from-LSI
  remap the MCU file models.
- **Two red test lines, both in work in flight in `app/`** as of 14:36Z:
  `app/tests/project.test.js` (the GPIO-speed control, above) and
  `tests/build.test.js` "dist is not stale" (four agents rebuilding one
  `dist/index.html` while the suite runs). Neither is in `tests/` or `data/firmware`.

### Environment

- **No git remote.** CI has never run. `HUMAN_TODO` item 1.
- **The repo is on a Google Drive mount.** `npm install` fails with EBADF; test
  deps live in `%LOCALAPPDATA%\wchcube-deps`. `HUMAN_TODO` item 3.
- **`agents/README.md` "Environment facts" is stale.** It says there is no
  `cargo` and no C compiler. Both now exist: `cargo 1.98.1` is on PATH, and
  PlatformIO has the WCH RISC-V GCC 12.2.0 at
  `~/.platformio/packages/toolchain-riscv`. `HUMAN_TODO` item 2 is done.
- **RESOLVED — the floating `src-tauri` change.** The `open_project` fix was not
  optional: the command returns `Result<Option<String>, String>` and the body
  returned `Result<String, String>`. Reverting just that line and running
  `cargo check` gives `error[E0308]: mismatched types … could not compile
  wch-cubemx`. So `src-tauri` had **never compiled**, and every claim about the
  desktop shell before this pass was about code that does not build. Fixed,
  `cargo build` clean, fix and `Cargo.lock` committed.
- **RESOLVED — round 3 is under git.** `data/firmware/`, `PROGRESS.md`, the
  `Agents Rounds 3/` pack and the whole reorganised `data/sources/` tree were all
  untracked, with the two ORIGINAL datasheets showing as deleted and their moved
  replacements untracked — `git checkout .` would have taken the CH32V006
  datasheet and reference manual with it. All committed.
- **DECISION — `data/Pio Source/` is gitignored.** It is a 45 MB reference copy of
  the *installed* PlatformIO platform `ch32v`, and the round brief forbids
  vendoring the SDK into this repo. It stays on disk to read; cite the package.
- **`data/sources/` was reorganised** into `<PART>/{Datasheets,Evt}/`. Paths in
  `data/FORMAT.md`, `data/mcus/CH32V006.notes.md`, `tools/extract_remaps.py` and
  the agent packs still name the old flat locations.
- **The repo is 52 MB of history plus an 84 MB EVT drop.** Not a problem today;
  worth a thought the day a remote appears (`HUMAN_TODO` item 1).
- **The human's `Taskfile.yml` is still a stub** (`echo "Hello, world!"`),
  untracked. Not half-adopted; see `TASKS.md` housekeeping.

---

## 7. Software / firmware status

### The PlatformIO project

`data/firmware/` — open **that folder** in VS Code (PlatformIO needs
`platformio.ini` at the workspace root), or open
`data/firmware/wchcube-firmware.code-workspace` for a two-root workspace with the
repo alongside it.

```
data/firmware/
├── platformio.ini              4 environments; every per-part fact comes from board JSON
├── README.md                   build, flash, debug, and how to feed it generated code
├── ARCHITECTURE.md             layers, seams, ownership, the EVT authority rule
├── include/app_config.h        build-time switches — the sdkconfig role
├── src/main.c                  application layer: no registers, no pins
├── lib/
│   ├── board/                  what is physically wired. No source, no line.
│   ├── wch_hal/                thin wrappers over the WCH EVT SPL
│   ├── util/                   hardware-free, host-buildable (ring buffer)
│   └── wchcube_generated/      drop zone for configurator output, machine-owned
└── test/                       empty, and says so
```

### Verified build

`pio run`, 2026-09-11, PlatformIO Core 6.2.0, platform `ch32v` 1.1.0, toolchain
`riscv-wch-elf-gcc` 12.2.0:

| Environment | Board | Result | Flash | RAM |
|---|---|---|---|---|
| `CH32V006F8P6` (default) | `genericCH32V006F8P6` | **SUCCESS** | 7 796 / 63 488 B (12.3 %) | 712 / 8 192 B (8.7 %) |
| `CH32V006K8U6` | `genericCH32V006K8U6` | **SUCCESS** | — | — |
| `CH32V005F6P6` | `genericCH32V005F6P6` | **SUCCESS** | — | — |
| `CH32X035G8U6` | `genericCH32X035G8U6` | **SUCCESS** | 6 724 / 63 488 B (10.6 %) | 2 224 / 20 480 B (10.9 %) |

`pio check -e CH32V006F8P6` (cppcheck): **no defects found.**

Everything the build needs was already installed locally, so this works offline.

### The compile gate — generated C from a real configuration

`tests/codegen_compile.test.js`, run by `node tests/run.js`. For each fixture it
runs the real CLI over a checked-in `.wchproj`, puts the header in `include/` and
the source in `src/`, and builds:

| Fixture | Part / package | Environment | Result |
|---|---|---|---|
| `CH32V006_TSSOP20_full.wchproj` | CH32V006 TSSOP20 | `CH32V006F8P6` | **compiles and links** |
| `CH32V006_QFN32_full.wchproj` | CH32V006 QFN32 | `CH32V006K8U6` | **compiles and links** |
| `CH32V005_TSSOP20_full.wchproj` | CH32V005 TSSOP20 | `CH32V005F6P6` | **compiles and links** |
| `CH32X035_QFN28_full.wchproj` | CH32X035 QFN28 | `CH32X035G8U6` | **compiles and links** |

These fixtures **assign pins**. Between them: ports A/C/D and A/B/C/D, non-default
USART1 and SPI1 remaps, an HSE crystal, a PWM output, an ADC channel, a labelled
GPIO, and `params:` on USART1/SPI1/TIM1/TIM2/I2C1/ADC1.
`tests/fixtures/make_fixtures.js` builds them by driving the real engine and
refuses to write one that has a pin conflict or fewer than eight assigned pins.
Flash for `CH32V006F8P6` went from 7 796 B on the old default configuration to
7 972 B, so `WCHCube_GPIO_Init()` is demonstrably not empty this time.

**What this now supports saying, and what it does not.**

*Does:* for these three configurations, the generated GPIO, AFIO remap and RCC
code compiles and links against the real WCH SPL for the right part — verified
with `-DCH32V006` actually reaching the compiler, because `ch32v00X.h` picks the
part in a `#if !defined(...)` block whose first branch is CH32V002, and
everything would otherwise still compile, as a different chip.

*Does:* the same for **CH32X035**, a second family, through the same gate and the
same fixture generator, with no part-specific code anywhere in `app/`. That is
the round-4 thesis — adding a part is a data job — as a green line rather than an
argument.

*Does not:* nothing has been **flashed or run**. The gate is a build-time claim.
It covers GPIO, AFIO and RCC only — `params:` are carried in the fixtures but
codegen does not yet turn them into `*_InitTypeDef` blocks, and DMA and NVIC are
not in the `.wchproj` format yet, so neither is compiled. Those join the gate as
AGENT-2's P2 work lands. And it has only ever run on Windows: the wrong-case
header defect is caught here by a name check rather than by the compiler, and
nothing in this repo has ever been built on Linux.

The previous version of this section reported a pass on a **default** TSSOP20
configuration, where no GPIO is assigned and `WCHCube_GPIO_Init()` is empty, and
said so in the same paragraph. That caveat is now discharged rather than
repeated — but the habit it came from is why the paragraph above exists.

The drop zone is `.gitignore`d on purpose: machine output, regenerated per
configuration, and not something two agents should be resolving a diff over. The
gate builds into `data/firmware/.pio/gate` rather than `.pio/build`, so a
concurrent `pio run` by a human or another agent cannot make it lie in either
direction — it produced one spurious red before that was isolated.

### Firmware capability

What is genuinely implemented: board bring-up (clock readback, delay timer,
printf over the WCH-Link SDI channel, which claims no pin), the generated
configuration applied if present, a clock-tree report, and a tick loop.

What is deliberately **not** implemented, and is marked as such in the code
rather than stubbed:

- **No peripheral drivers.** No UART, SPI, I2C, ADC or timer component exists.
- **No board pin map.** The targets are bare chips, not named dev boards with
  published schematics, so `lib/board` declares no LED, no button and no UART
  pins. `board_has_led()` returns 0 and `board_led_toggle()` is a no-op until
  someone declares a real LED via `build_flags` — see `lib/board/include/board.h`.
- **No tests.** `test/` is empty and explains why.
- **Nothing has been flashed or run on silicon.**

---

## 8. Architectural decisions

Decisions made earlier and still in force (from `TASKS.md` and the board):

| Decision | Why |
|---|---|
| Single-file offline `dist/index.html`, plain JS + SVG, no framework, no bundler | Runs from a USB stick; trivially embeddable in Tauri |
| Pin alternate functions **derived** from peripheral remap tables, never listed per pin | One place to edit; conflicts computed rather than maintained |
| YAML for MCU data, js-yaml vendored | Human-editable, diffable, parseable in the browser |
| Engine is ESM with zero DOM access | Same modules run in the browser, in Node tests and in the CLI |
| Every hardware fact cites a DS/RM table in `<PART>.notes.md` | A fact without a citation is a guess |
| Codegen emits an explicit TODO rather than plausible-looking register code when the MCU file lacks an encoding | Wrong bits are worse than absent bits |
| Four agents, strict file ownership, board-only communication | One shared tree with no merge conflicts |

Added this round:

| Decision | Why |
|---|---|
| **The firmware is a PlatformIO project under `data/firmware/`, not a vendored SDK tree** | PlatformIO already resolves the WCH toolchain, the NoneOS SDK, the linker script template and the upload tools. Vendoring any of that would be a second copy to keep in sync with WCH. |
| **Components are PlatformIO libraries under `lib/`, one concern each** | The ESP-IDF `components/` shape. `library.json` `dependencies` makes the dependency graph real and build-enforced, and the folder boundary doubles as the agent ownership boundary. |
| **Structure borrowed from the NONOS/ESP-IDF ecosystem; APIs not borrowed** | `esp_err_t`, `system_os_task` and an event loop belong to a different chip and SDK. Importing the names would be inventing an API this silicon does not have. |
| **`lib/util` may not include an SDK header** | It is the one layer that compiles for the host, which is what makes off-target unit tests possible. Enforced by its `library.json` declaring no framework and no platform. |
| **Generated code lives in its own component and is `.gitignore`d** | Machine-owned. Hand-editing it is a bug, and two agents generating from two `.wchproj` files must not produce a diff to resolve. |
| **`printf` goes to the WCH-Link SDI channel, not USART1** | SDI claims no pin. The SDK's default (`DEBUG_UART1_NoRemap`) silently occupies PD5 and would fight whatever the configurator assigned there. |
| **`lib/board` states no pin it cannot cite** | The targets are generic chips. "Probably PD4" is the class of invention that produced defects 1 and 2. |
| **Every component is named in `lib_deps`** | The LDF only compiles what something includes, and does not evaluate `__has_include`. Without this, `util` would never be built and `wchcube_generated` would never be found. |
| **The build-time clock (`SystemInit`) and the generated clock (`WCHCube_RCC_Init`) both exist, generated wins** | The framework sets SYSCLK from the board file before `main()`. Rather than fight it, `main()` applies the generated tree afterwards and re-runs `SystemCoreClockUpdate()`. Documented in `ARCHITECTURE.md` as "Two clock owners". |
| **EVT sources are the top authority when they arrive** | Above the RM for anything that has a *name*: the RM describes silicon, EVT describes what the SDK will compile. |

---

## 9. Recommended next steps

The first four items of the previous list are **done** and are kept here, struck
through, because a status file that silently drops what it recommended is how you
stop being able to tell progress from rewriting: ~~fix `codegen.header`~~,
~~name the part's one GPIO speed~~, ~~put the firmware build in the test story~~,
~~refresh `agents/README.md`~~. What is left, in order:

1. **AGENT-1: work the EVT drop, now that it is here.** It is the highest
   authority and it is on disk. Three things are one `grep` from settled: the
   RM Table 6-1 TIM3-vector contradiction, the TouchKey channel→pin map, the OPA
   polling set. **And re-check anything derived from the PlatformIO copy** —
   `GPIO_Remap_LSI_CAL` and `FLASH_FLAG_OPTERR` differ between the two (§5), and
   the first of those is a remap the MCU file models.
2. **UI: finish the GPIO speed question.** The data says one speed; the control
   must stop being offered. That is the half of defect 2 that is still open, and
   it is the round-2 rule "a hardware choice the part does not have must not be
   offered" in its original instance.
3. **UI: land the DMA Settings and NVIC Settings tabs.** The data has been
   complete for CH32V006 for three cycles. Then the eight legibility findings.
4. **ENGINE: configuration reaching the C.** `params:` → `*_InitTypeDef`, DMA and
   NVIC into `.wchproj` and then into the generated code. Each one becomes a line
   in the compile gate the day it lands — the fixtures already carry `params:`
   and are waiting for codegen to use them.
5. **QA: `tests/completeness.test.js`**, then the round-2 walkthrough re-run and
   `tests/legibility.test.js`.
6. **Fix the stale `data/sources/` paths** in `FORMAT.md`, `CH32V006.notes.md`,
   `tools/extract_remaps.py` and the agent packs. `data/sources/README.md` also
   still says the `Evt/` folders are empty; they are not.
7. **Build something on Linux.** Every compile claim in this file is a Windows
   claim, and the one defect a compiler could not catch here (wrong-case header)
   is exactly the one Linux would have caught instantly. This wants the git
   remote — `HUMAN_TODO` item 1.
