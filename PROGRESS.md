# PROGRESS — WCHCube

The ongoing source of truth for where this project stands. Keep it current: if a
statement here stops being true, change it here first.

- **Last updated:** 2026-09-12 (round 5, AGENT-3 cycle 2 — CI made publish-ready, the
  case-sensitivity defects that preparing it exposed, and one reading order for the data
  sources: markdown first, PDF last, in `tools/source_docs.py` and `tests/source_order.test.js`)
- **Branch:** `main`, remote `origin https://github.com/arwidcool/WCH_Cube.git`. **One shared
  working tree**, three agents, one working directory (`agents/`); rounds 1–4 are archived under
  `agents/history/`.
- **New 2026-09-12 (human-directed): the coverage ledger, and the numbers it found.** Every
  gate in this repository proved an MCU file was *consistent*; nothing proved it was
  *complete* against the sources, which is how the committed CH32H417 file carried **207**
  signals routed to pins that no setting could claim, CH32L103's ADC routed ten channels with
  no way to select one, and USBFS/USBHS/USBSS/TKEY said "holds no pin on any package" while the
  datasheet gives every one of them pads. `tools/coverage.py` now reads the datasheet's pin
  table (both readings, where the DS has two), the RM's chapter list and the SPL header's
  instances on every run and joins them to the file: a row is modelled, absent with a
  `file:line` in `data/coverage/<PART>.yaml`, or **open**, and `tests/coverage.test.js` holds
  every part to its declared status. `validate_mcu.py` gained the reverse-direction check (a
  routed signal no choice claims is an ERROR) and the `pins: { none | open }` declaration a
  routing-less peripheral must make. **Coverage, quoted from `python tools/coverage.py --quiet`
  at 2026-09-12T16:52Z** — the numbers move as rows close, so read the tool rather than this
  line, and treat what follows as a dated snapshot. On CH32H417 this figure moved
  **113 → 104 → 58 → 50 → 0 in a single afternoon**, which is the reason it is dated:

  ```
    CH32H417   OPEN 0  (modelled 1252, absent 23, disagreements 45)
    CH32L103   OPEN 12  (modelled 260, absent 11, disagreements 1)
    CH32V003   OPEN 3  (modelled 113, absent 10, disagreements 0)
    CH32V005   OPEN 0  (modelled 214, absent 14, disagreements 0)
    CH32V006   OPEN 0  (modelled 218, absent 11, disagreements 0)
    CH32X035   OPEN 0  (modelled 278, absent 11, disagreements 0)
  ```

  CH32V006, CH32V005, CH32X035 and now **CH32H417** are `complete`; CH32V003 and CH32L103 are
  `in_extraction`, owned, and their counts may only go down — never reported as done while the
  tool prints an open row.

  **CH32H417 reaching 0 open rows is not the same as CH32H417 being finished, and the
  difference is the point of this round.** The ledger asks whether every fact the DATASHEET
  states has been accounted for. It now has been — including 45 `disagreements:` entries, each
  citing BOTH readings with a `file:line` rather than averaging them (the SerDes pairs are the
  clearest: DS Table 2-1-1 line 3791 puts `SERDES_TXP` on PE3 and Table 2-2-20 line 7341 puts
  `SERDES_RXP` there; both are recorded, neither is picked). What the ledger does NOT ask is
  what the APP does with those facts, and asking that found a defect the same day the count
  reached zero: `tests/h417_packages.test.js` sweeps all 428 mode choices on each package and
  found **26 / 20 / 17** choices that put two signals on one pad although the signal had another
  bonded pad free — reached by doing nothing but switching a peripheral on, and invisible to
  the conflict engine because both claims share an owner. Now **4 / 0 / 0**, ratcheted, owner
  AGENT-1. A part can pass every gate and still be half-built if no gate reads the datasheet;
  it can also pass the gate that reads the datasheet and still hand the user a configuration
  the silicon cannot honour. The tool found two things on the "clean" parts too: CH32V003's USART1
  clock pin (declared open, not absent) and a handful of conversion typos (`X0` for `XO`, `C1NO`
  for `C1N0`, a torn `ACK4`) now recorded as corrections with the line they came from. Planted
  breaks: 21/21 caught. `docs/COVERAGE.md`
  is the process; `CLAUDE.md` puts it first for every session.
- **Verified this pass:** `python build.py` → OK · `node tests/run.js` → **ALL GREEN, 0
  skipped** · `python tools/validate_mcu.py` → 0 errors, 5 warnings ·
  `python tools/verify_sdk_names.py` → 0 errors · `node tools/wchcube_cli.js --project
  <fixture> --strict` → exit 0 on all five fixtures, in both the default format and
  `--format c` · `git archive` → 1.7 MB with no vendor material in it.
- **New this pass: the repository is ready to publish, and getting it there found two real
  defects — one of them the class this repo exists to catch.** The workflows had never been
  read by anything, because there is no remote. `ci.yml` did not install PlatformIO
  anywhere, so `codegen_compile`, `generated_project` and `firmware_native` all **skipped**
  — and a skipped gate reads as a green job, which is how "the generated C compiles" stood
  unproven for a whole round once before. Its `desktop` job asked for
  `libappindicator3-dev`, which does not exist on a current Ubuntu runner. Both fixed, plus
  a `release.yml` that publishes on a `v*` tag, and `tests/release.test.js` now checks the
  plumbing the way everything else here is checked — including that the workflow which
  installs PlatformIO is the same one that runs the compile gate, and that a *commented-out*
  `pip install platformio` does not satisfy it, which the first version of that check
  wrongly accepted.
- **Also new this pass, and this is the interesting one: `data/sources/V003/` had landed
  with the wrong capitalisation, and every gate in the repo passed anyway.**
  `evt/` and `datasheets/` where the other two parts, `data/sources/README.md` and
  `tools/verify_sdk_names.py` all say `Evt/` and `Datasheets/`. On Windows — this box — the
  lookup resolves case-insensitively and 23 headers were checked. On the Linux runner the
  same lookup would have found nothing, reported CH32V003 **NOT CHECKED**, and exited **0**:
  a green tick over a part that was never checked. Renamed (not deleted) with the dangling
  citations in `CH32V003.yaml` and `CH32V003.notes.md` repaired in the same write, and
  `tests/source_paths.test.js` now resolves every `data/sources/...` path any tracked file
  cites **against the case the filesystem actually has**, with both a wrong-case path and a
  wrong-case `codegen.sdk.evt` planted to prove it bites. It is the same defect as
  `codegen.header: ch32v00x.h` one field over, and it was found by preparing CI rather than
  by running it.- **New this pass: the data sources have one reading order, and it is markdown first, PDF last.**
  Every drop arrives as a PDF with a converted `.md` beside it, and the conversion is now the
  documented working source: it greps, it diffs, it can be cited by line, and a second pass can
  check it. The original PDF is the **last resort** — opened only when the conversion is missing,
  unreadable or *demonstrably* incomplete, and then by a script that prints a `PDF FALLBACK:` line
  saying why, recovers by word position with a check against numbers the datasheet states
  elsewhere, and writes the recovered cells back into the repo so the page is opened once. It is
  implemented in `tools/source_docs.py` (both recovery scripts and the L103 markdown parser now
  resolve through it), stated in `data/sources/README.md`, carried into `agents/README.md`,
  `agents/PROMPT.txt`, `agents/AGENT_1_DATA.md`, `docs/ADDING-A-PART.md`, `docs/HOW-IT-WORKS.md`,
  `data/FORMAT.md` and the PR template, and enforced by `tests/source_order.test.js`: a PDF with
  no conversion beside it fails the build, and so does a script that opens a PDF without saying
  why. **Two stale claims went with it, and they are why the rule needed writing down:**
  `data/mcus/CH32L103.notes.md` said "This drop has no PDF" and asked a human for a second source
  while `CH32L103DS0.PDF` sat in the folder, and `data/sources/README.md` still said the EVT
  folders were empty and listed two parts where there are now five.- **Also new this pass:** the issue chooser's three `contact_links` pointed at
  `https://github.com/OWNER/REPO/...` — three buttons that would 404 the moment the
  repository was published. Removed, with the guidance moved into the templates as relative
  markdown (which is correct in a fork and after a rename), and a check that fails if that
  placeholder ever comes back.
- **Verified this pass (previous cycle):** `node tests/run.js` → **510 green, 0 skipped**.
- **Also new (previous cycle): a FOURTH part arrived mid-cycle, and every gate it touched was
  already wide enough to catch it.** `data/mcus/CH32V003.yaml` landed (DATA, whose brief
  did not include it). `tests/strict.test.js`'s coverage check failed immediately, which is
  what it is for — a shipped part with no `.wchproj` behind the `--strict` gate has
  unproven generated C — and so did `tests/completeness.test.js`, on `CH32V003 OPA1: nvic`.
  Both were closed rather than excused: a fifth fixture (`CH32V003_TSSOP20_full.wchproj`,
  USART1 + I2C1 + TIM1 PWM + AIN2 + five GPIOs, remap 0 throughout), a fourth firmware
  environment, and a `WCH_HAL_SERIES_CH32V003` branch in `data/firmware/lib/wch_hal`
  because CH32V003's SPL series is `ch32v00x` — small x — and its die has **no GPIOB at
  all** (`ch32v00x.h` defines GPIOA, GPIOC and GPIOD only, and `ch32v00x_rcc.h:87-89` the
  matching clock bits). The OPA has no interrupt vector on this part where CH32V006 has
  `OPCM_IRQn = 40`, so that cell is declared **ABSENT** with its citation rather than left
  blank. `pio run -e CH32V003F4P6` builds the generated C.
- **New this pass: every choice the app offers is now one the silicon can honour — and
  the two halves that make that true were written against two different schemas.**
  `data/mcus/CH32X035.yaml` carries seven cited `constraints:` entries at the document
  root in the shape `data/FORMAT.md` documents; `app/engine/constraints.js` reads
  `gpio.constraints` with `field:`/`deny:`/`allow:`/`on_pins:`/`off_pins:`. Because the
  placement fails first the consumer sees an EMPTY list, so `gpioConstraintProblems()`
  reported nothing — not an error, not a warning — while the GPIO table went on offering
  Pull-down on PC0 and an output mode on every shorted pair. QA-FAIL on the board at
  22:11Z, corrected and narrowed at 22:25Z, and closed in the same cycle when the consumer
  moved to the documented shape. That is the round's defect class arriving in the round's
  own mechanism, and it was invisible to every gate in the repo.
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
`build.py` into one offline `dist/index.html`. It loads, it is tested by **510
automated tests** across two harnesses, and it carries **three real parts** —
CH32V006, CH32V005 and CH32X035 — with the synthetic part moved out of `data/mcus/`
entirely. Every choice it offers is now supposed to be one the silicon can honour,
which is round 5's rule and the constraint mechanism's job.

**The firmware** — `data/firmware/` is a PlatformIO project that compiles for real
CH32V006 / CH32V005 / CH32X035 silicon with the WCH EVT NoneOS SDK. It exists to
turn the configurator's output into an ELF, and to make "the generated C compiles"
a checkable claim rather than a hope. It builds today, for four environments.

The honest one-line summary: **the tool works, two families generate and compile,
and the round-5 mechanism that stops it offering impossible choices is real but was
found disconnected from its own data on the day it landed.** Nothing has ever been
flashed.

---


**CI, in the exact words the round-6 brief requires: never run in CI.** `origin` exists and
every commit is pushed; `.github/workflows/ci.yml` has three jobs checked by
`tests/release.test.js`; **not one has ever executed**. Every green result in this file is a
result on one Windows box. Round 6 deliverable A is that this sentence is replaced by a run URL.

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
- **Round 3 put under git.** `data/firmware/`, this file, the round-3 pack (now
  `agents/history/round3/`) and the whole reorganised `data/sources/` tree were
  all untracked.

---

## 3. Current work

**Round 5 — "every choice the app offers must be one the silicon can honour"** is open.
Brief and per-agent instructions are in `agents/`; the launcher is
`agents/run_agents.ps1`. Round 4's open lines carry over as E1–E9.

**A wrong choice the app offers is worse than a missing feature.** A missing feature is
a gap; an offered-but-impossible choice produces a configuration that compiles,
exports, looks correct in the export and does not work on the board. Two deliverables,
and they prove each other:

**A — the data can state a constraint.** One mechanism, three real instances on
CH32X035 (the pull-down allow-list PA0–PA15/PC16–PC17; output functions prohibited on
shorted pairs; PC10/PC11 floating only while USBFS is on), consumed by the **GPIO
table** per row, the **conflict engine** and **codegen**, with CH32V006/CH32V005
unchanged as the regression half. It landed, and so did the defect class it exists to
remove: the data and the consumer were written against different schemas and the
mechanism was inert on the shipped tree until the board entry at 22:11Z. Both halves
now read `data/FORMAT.md` `## constraints`, and `tests/constraints.test.js` asserts it
with no skip in between.

**B — every part generates C with no TODO and no `#error`.** `--strict` exited 2 at the
start of the round, blocked on `codegen.nvic` and `channel_params.channels`. Both keys
landed, and `node tools/wchcube_cli.js --project <fixture> --strict` now exits **0** on
all four fixtures — asserted on the exit code, in the default format and with
`--format c`, by `tests/strict.test.js`. What remains of B is the CH32X035 peripheral
gaps and the ADC internal channel, listed in `agents/PROJECT.md` §B.

| Agent | Round 5, in order |
|---|---|
| DATA | The constraint schema in `data/FORMAT.md` and the seven cited CH32X035 entries; the remaining CH32X035 peripheral gaps (OPA, CMP1/2/3, USBFS/USBPD params, TKEY), the ADC internal Vrefint channel on **both** families, USART LIN/SmartCard/IrDA; E6/E7. |
| APP | Consume `constraints:` in the GPIO table, the conflict engine and codegen; E1 and E2; the `.wchproj` migration path. E1/E2 and all three consumers are in. |
| QA | The constraint test that can fail; `--strict` as a gate; `verify_sdk_names.py` inside the runner; CH32X035 × 7 packages across every suite; the compile matrix; E8. |

## 4. Remaining work

Ordered by what blocks the most. The per-line list is `agents/DONE.md` Round 5 and the
brief is `agents/PROJECT.md`; this is the short version.

1. **The CH32X035 peripheral gaps** (DATA). OPA (13 struct members, 3 modelled), CMP1/2/3
   (5 members, 3 modelled), USBFS/USBPD `params:`, TKEY (no EVT header at all, so every
   write is a raw register), the ADC internal Vrefint channel on **both** families, and
   USART LIN / SmartCard / IrDA as `params:` with `sdk_call`. `tests/completeness.test.js`
   prints the open cells on every run and guards each against its `TASKS.md` line.
2. **E5 — CH32X035 × all 7 packages across every suite.** `smoke.js`, `data.test.js`,
   `completeness.test.js` and `codegen_compile.test.js` cover it; `layout.test.js` and
   `legibility.test.js` still need the seven packages named. LQFP64M at 60 I/O with names
   like `USBPD_CC1` is the first real stress the legibility test has had.
3. **E4 — the 16 known-missing cells** in `tests/completeness.test.js`, each filled or
   declared ABSENT with an EVT citation. The two are different and must not be conflated.
4. **E8 — `src-tauri` relinked.** `cargo build` is green and the Rust unit tests run in
   the suite, but the round-4 changes to `write_project` have never been seen in a window:
   the human had the old executable open. **Still unverified** — do not claim the desktop
   path writes a project until somebody has watched it.
5. **The remaining round-3/4 DONE lines**: the `.wchproj` round-trip for DMA and NVIC
   (E9 — the engine test is green; the DONE line is unread), and the round-1 section of
   `agents/DONE.md`, which still carries a "15 of 24" count from round 3.
6. **`WALKTHROUGH.md` run end to end**, and the QA-PASS line posted with what failed.
7. **More parts.** CH32V003, CH32V203 and CH32V307 have no DS/RM in `data/sources/`
   (`HUMAN_TODO` 4). Adding a part is meant to be a data job; the constraint mechanism is
   the newest place that claim is testable.
8. **A human flashes one generated project.** `HUMAN_TODO` 6. It is the highest-value
   open item in the repo and the only one nobody here can close.

---

## 5. Hardware / MCU status

| Part | Sources present | YAML | PlatformIO env | Notes |
|---|---|---|---|---|
| CH32V006 | DS v2.0 + RM v1.4, `data/sources/V006/Datasheets/` | complete | `CH32V006F8P6`, `CH32V006K8U6` | the reference part. 7 packages, 18 peripherals, 29 vectors, 23 DMA requests |
| CH32V005 | same RM (family) | `inherits: CH32V006` | `CH32V005F6P6` | drops TKEY, TIM3, QFN32 |
| CH32X035 | DS v2.2 + RM v1.9, `data/sources/X035/Datasheets/` + **EVT, 2 239 files** | landed; `validate_mcu.py` 0 errors, `verify_sdk_names.py` 0 errors | `CH32X035G8U6` | the second family. 7 packages, 8 variants, all packages draw with 0 conflicts, generated C **compiles**, `--strict` exits 0. Five peripherals are still partly modelled (OPA, CMP1/2/3, USBFS/USBPD params, TKEY) and `tests/completeness.test.js` prints those cells every run. Seven cited `constraints:` entries, and the consumer that reads them |
| WCH-DUMMY32-C8 | n/a — synthetic | `tests/fixtures/mcus/` | n/a | layout/scale fixture, QFN12 → LQFP144. Not shipped, not offered in the part selector |
| CH32V003 | DS + RM, `data/sources/V003/datasheets/` + **EVT** | landed mid-round-5 | `CH32V003F4P6` | the smallest part the app ships: RV32EC, 16 KB flash, 2 KB SRAM, 18 I/O on TSSOP20, **no GPIOB**, no OPA interrupt vector. 4 packages, 4 variants. `--strict` exits 0; `tests/completeness.test.js` and `tests/smoke.js` cover it; `params:` for OPA1 is the one open cell |
| CH32V203, CH32V307 | none | none | none | waiting on sources (`HUMAN_TODO` 4) |

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

- ~~**`gpio.modes` claims two modes this silicon does not have.**~~ **CLOSED.** The two
  open-drain entries were deleted, so `gpio.modes` now has exactly the three
  `GPIOMode_TypeDef` members the header declares plus the implicit `Input`, and every one
  carries a `class:`. `verify_sdk_names.py` exits 0.
- ~~**`codegen.periph_handle.USBFS: USBFS_DEVICE` does not exist.**~~ **CLOSED.** It reads
  `USBFSD` now, with the host/device split recorded as an open question in
  `CH32X035.notes.md` rather than guessed at (the handle depends on the mode the user
  picked, and `USBFSH` is the other half).
- ~~**The GPIO table's mode list is hardcoded in the UI.**~~ **CLOSED.** `app/template.html`
  no longer contains a literal mode list or the words "Output Open Drain"; the table renders
  `gpioFieldOptions(pin, field)`, which is the data reduced by the constraints on that row.
- ~~**`GPIO_Mode_IPD` is per-pin on this part.**~~ **CLOSED, and this is round 5's whole
  point.** It is now constraint `pull-down-only-on-pa0-pa15-pc16-pc17`, and the same
  mechanism carries the shorted-pair rules, the `packages:` scoping that keeps Note 4 from
  over-applying to QFN20/QFN12, and the USBFS-conditional pair.
- **Five peripherals are partly modelled** (OPA, CMP1/2/3, USBFS/USBPD params, TKEY) and
  the ADC internal Vrefint channel is missing on **CH32V006 too**. Tracked open in
  `tests/completeness.test.js`; §4 item 1.
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
  **The workflow side is ready as of 2026-09-12** and is now checked by
  `tests/release.test.js` rather than only by reading it: `ci.yml` has three jobs
  (`test` with no PlatformIO; `firmware`, which installs PlatformIO, builds all five
  environments and then generates every fixture's project and builds it; and
  `desktop` for the Tauri shell), and `release.yml` publishes on a `v*` tag. Two real
  defects were found by writing that file and preparing this: `ci.yml` never installed
  PlatformIO at all, so the compile suites **skipped**, and the `desktop` job asked for
  `libappindicator3-dev`, which does not exist on a current Ubuntu runner (Tauri 2 needs
  `libayatana-appindicator3-dev` plus `libxdo-dev`). Both are fixed. **What remains
  unproven is that the workflows run** — they have never executed, and no local check can
  substitute for that.
- **Case-sensitive filesystems, found by preparing the above.** `data/sources/V003/` had
  landed as `evt/` and `datasheets/` while the other two parts and the tools say `Evt/`
  and `Datasheets/`. Everything passed here, because this box is case-insensitive; on the
  Linux runner the CH32V003 SDK lookup would have resolved nothing, degraded to
  "NOT CHECKED", and exited 0 — a green tick over a part nobody checked, which is
  precisely the defect class this repo keeps finding. Renamed (not deleted) and the
  citations in `CH32V003.yaml` and `CH32V003.notes.md` repaired with it;
  `tests/source_paths.test.js` now resolves every `data/sources/...` path a tracked file
  cites **against the case the filesystem actually has**, and plants both a wrong-case
  path and a wrong-case `codegen.sdk.evt` to prove it bites.
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
  `agents/history/round3/` pack and the whole reorganised `data/sources/` tree were all
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
| `CH32V003_TSSOP20_full.wchproj` | CH32V003 TSSOP20 | `CH32V003F4P6` | **compiles and links** |
| `CH32H417_QFN128_full.wchproj` | CH32H417 QFN128 | `CH32H417QEU6` | **compiles and links** |
| `CH32H417_QFN68_pkg.wchproj` | CH32H417 QFN68 | `CH32H417WEU6` | **compiles and links** |
| `CH32L103_QFN32_full.wchproj` | CH32L103 QFN32 | `CH32L103K8U6` | **compiles and links** |

**The last two rows of the CH32H417 pair are one check, not two.** CH32H417 is the first
part here where the PACKAGE decides which pins a peripheral can reach — 301 of its signals
have a different set of bonded options on QFN68 than on QFN128 — and until 2026-09-12 one
QFN128 fixture stood for all three packages, so that path had never been compiled. The two
fixtures make the same four engine calls and land on different pads: `USART1_RX` emits
`GPIO_PinAFConfig(GPIOD, GPIO_PinSource12, GPIO_AF14)` on QFN68 and `(GPIOB,
GPIO_PinSource15, GPIO_AF4)` on QFN128 — a different port, pin and AF code, all three wrong
together if the generator ignored the package, and all three compiling either way. Evidence,
with both listings: `tests/evidence/round5/2026-09-12-h417-package-pads.md`.

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
It covers GPIO, AFIO, RCC, `params:` → `*_InitTypeDef`, DMA and NVIC at the level of
"it compiles", and `--strict` now exits 0 on every fixture in both the default format
and `--format c`. It has only ever run on Windows: the wrong-case header defect is
caught here by a name check rather than by a compiler, and nothing in this repo has
ever been built on Linux.

**Skips are first class, and they are now the thing to watch.** The runner counts them
and prints every reason above the verdict, a part the SDK-name checker cannot resolve
becomes a counted SKIP rather than a green tick, and the compile gate skips loudly when
another agent is writing the drop zone mid-build. A green run of 510 with 0 skipped is
the only shape that proves what it says.

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

Everything the previous version of this list recommended is **done** — the EVT drop was
worked, the GPIO control stopped being offered where the part has one value, the DMA and
NVIC tabs landed, `params:` reach the C, and the compile gate covers all four fixtures.
They are not repeated here. What is left, in order:

1. **DATA: the CH32X035 peripheral gaps, and the ADC internal channel on both
   families.** §4 item 1. This is the last thing between the round and a clean
   `--strict` on a peripheral nobody has modelled yet.
2. **QA: E5, the breadth pass.** Seven packages in `layout.test.js` and
   `legibility.test.js`; LQFP64M at 60 I/O is the first genuine stress either has had.
3. **QA: run `agents/WALKTHROUGH.md` end to end** and post where it fails. It is
   written to be runnable by someone who did not write it, and it has not been run this
   round.
4. **QA: the stale-documentation greps** in `AGENT_3_QA_RELEASE.md` item 11. This file's
   live pointers at `Agents Rounds 4/` are fixed in the same commit as this rewrite; the
   remaining hits are history or a comment about history.
5. **AGENT-3: re-audit or explicitly supersede the round-1 section of `agents/DONE.md`.**
   It still carries a "15 of 24" count from round 3 and most of what it calls open has
   since closed. A status nobody has checked is worse than no status.
6. **A human flashes one generated project.** `HUMAN_TODO` 6, the highest-value open item
   in the repo, and the only one that turns "compiles" into "works". Until then every
   DONE line about the generated code says **builds, not flashed**.
7. **Build something on Linux.** Every compile claim in this file is a Windows claim, and
   the one defect a compiler could not catch here (wrong-case header) is exactly the one
   Linux would have caught instantly. This wants the git remote — `HUMAN_TODO` item 1.
