# STATUS — the single source of truth

**Everything an agent needs to know about where this project stands is in this file.** If a
statement here stops being true, change it *here first*. A number in this file is one a command
printed, with the command named; a claim is one with evidence named beside it. Nothing here is
carried over on the strength of another document saying it.

How to work in this file without colliding with the other two agents:

- **Read all of it, including the other two agents' §4 blocks** — those say what is in
  somebody else's hands *right now*, which is how you avoid starting a task that is already
  half-done. **Write** only inside your own `<!-- AGENT-n -->` block (§4) and the
  deliverable rows you own (§2).
- §1 is AGENT-3's. Anyone may correct a number a command they ran disagrees with — name the command.
- Never reformat someone else's block; never rewrite the file wholesale.
- `agents/README.md` is the working agreement (ownership, cycle, gates, the box). `agents/BOARD.md`
  is the append-only log. `TASKS.md` at the root is the claim/tick tracker and is read by
  `tests/completeness.test.js` and `tests/codegen_compile.test.js` — its line *text* is
  load-bearing, so edit lines there with care.

**Round 6 — "a gate nobody has watched run is a guess."** Round 5 closed with four things that
were green and not true: the ledger at zero the day 63 default collisions were found; three Python
gates green over a file `js-yaml` refused; header checks silently `continue`-ing past three of six
parts; and a CI that had "never run" and had in fact run 31 times and failed every one, unread.
None was a wrong gate. Each was a gate that had never been **seen to fail on the thing it was
supposed to catch**.

---

## 1. Measured now

Every line is a command's own output. Re-measure rather than copy.

**Taken 2026-09-13 on the consolidated pack, one commit after `116ca16`.** Every one of these
was run for this block, serially, on a settled tree — not carried from another document:

```
python tools/coverage.py --gate          coverage gate: 6 of 6 part(s) meet their declared status
  CH32H417 0 open · CH32L103 0 · CH32V003 0 · CH32V005 0 · CH32V006 0 · CH32X035 0   all `complete`
python tools/validate_mcu.py             0 errors, 99 warnings
python tools/verify_sdk_names.py         0 errors, 0 warnings
python build.py                          OK, dist/index.html 1349 KB
node tests/run.js                        ALL GREEN - 780 tests, 0 skipped  (381.8 s)
```

| | Number | How it was measured |
|---|---|---|
| CH32H417 `params:` | **39 of 78 peripherals HAVE a block, 39 do NOT.** 4 of the 39 without are declared ABSENT (SYS, RCC, EXTI, DMA1 — choices, not numbers), so **35 cells are owed, 23 of them routing pins** | count over `data/mcus/CH32H417.yaml`; per-peripheral detail in `tests/evidence/round6/2026-09-13-h417-peripheral-map.md` |
| CH32H417 other axes | clock: 68 of 78 have a bit, 9 declared ABSENT, **1 open (RTC)** · vectors: 66 of 78, **all 12 without declared ABSENT — 0 owed** · pins: 61 route, 17 declare `pins: none`, 0 `pins: open`, **0 unreachable routed signals** · codegen reach: **0** peripherals hold a pad and reach no generated code | the same audit. **Cells 41 → 36** |
| CH32H417 default collisions | **QFN68 4 · QFN88 0 · QFN128 0** | `COLLISION_CEILING` in `tests/h417_packages.test.js:228`, re-measured at 450 claiming choices per package |
| CI | last green: run **34723740365** on `b5a654f` — all three jobs (`test` ubuntu, `firmware` windows *with* PlatformIO so the compile gates execute rather than skip, `desktop` linux) | the run page. `PROGRESS.md` quotes the URL |
| CI vs HEAD | `origin/main` is `7bacfb4`; **the working tree is 1 commit ahead (`116ca16`) and that commit has not been through CI** | `git status -sb` |
| Hardware | **builds, not flashed.** Every green result in this repository is a compile | §6 item 8 |

**What the ledger at six zeros does NOT mean,** and it must be said next to the number every
time: the ledger asks whether every fact the **datasheet** states is accounted for. It does not
ask what the app does with them. CH32H417 is `complete` *and* has 39 of 78 peripherals with no
`params:` — you can claim their pins and configure nothing.

---

## 2. The round's deliverables — state, owner, evidence

| | Deliverable | Owner | State |
|---|---|---|---|
| **A** | CI executes and is read green | AGENT-3 | **done but for one withheld line** |
| **B** | every gate proven able to fail | AGENT-3 | **done for `tests/**`**; `app/tests/**` not swept |
| **C** | CH32H417's Parameter Settings stop being empty | AGENT-1 | **open — 35 cells owed** |
| **D** | clock schema holds a second PLL and a per-peripheral mux | AGENT-2 schema, AGENT-1 data | **schema done, data open** |
| **E** | the per-instance init struct | AGENT-2 mechanism, AGENT-1 data | **mechanism done, three consumers landed** |
| **F** | CH32L103 and CH32V003 at 0 open | AGENT-1 | **COMPLETE** |

**The exit criterion, in one sentence:** *CI has been read green on a runner, every gate in
`tests/**` has been seen red on a planted break, CH32H417's `IN_EXTRACTION` exemption is gone, the
app computes a USB and an LTDC clock on it, and the ledger reads zero on all six parts.*

### A — CI executes and is read green  (AGENT-3)

- [x] `ci.yml` has completed runs on `main`; the URL is in `PROGRESS.md`
      → and the pack's "never run" was **false**: 31 runs, all failed, unread.
        `tests/evidence/round6/2026-09-12-ci-30-failures.md`
- [x] the `firmware` job's log shows the compile gates reporting **ok**, not a skip
      → run 34721092664 publishes `::notice compile gates that ran: 16`. The ubuntu `test` job
        prints `20 test(s) SKIPPED` for the same suites, which is the contrast this line is for
- [x] the `Coverage ledger` step prints `6 of 6` **on the runner** → run 34723740365
- [x] `desktop` (Tauri, Linux) green → every run that was not cancelled
- [ ] **`DECISION | worktrees ON` posted after the above, not before** — *deliberately withheld.*
      The condition is met, but one green run is a thing seen once, and `main` had been red for
      thirty-one. It goes up when **three consecutive commits from different agents** are green.

**What CI turned out to be about was not the code. It was the ability to SEE.**
(1) The failure annotations were written and never executed — GitHub runs `run:` blocks under
`bash -eo pipefail`, so the failing pipeline aborted the step before the block that names the
failing tests; 31 runs published exactly `Process completed with exit code 1`. (2) **15 of 20 runs
were CANCELLED** by the next agent's push — one commit in five was ever verified;
`cancel-in-progress` is now OFF, and this repo is public where minutes are free. (3) `ci.yml`'s own
"dist is up to date" step was BLIND on Windows, because `git diff` normalises line endings and the
runner checks out CRLF.

### B — every gate is proven able to fail  (AGENT-3; owners fix what goes red)

Complete for `tests/**`. **The acceptance was a number and it is met: 0 gates without a break that
has been seen red.** Fourteen refusals captured from a live run in
`tests/evidence/round6/2026-09-12-planted-breaks.md`; the list of checks that cannot go red is
`tests/evidence/round6/2026-09-13-gates-without-a-plant.md` and is **empty**.

- [x] the collision ratchet → USART1 RX given TX's default pad; refusal names PB14
- [x] the reachability check → VBAT typed `mystery`; refusal quotes the type, names only that pad
- [x] the SPL-header guard → a part in neither map is reported, and only it
- [x] fixture freshness → a corrupted copy gives exactly one STALE line
- [x] `--strict` per fixture → a planted TODO, exit 2
- [x] the `IN_EXTRACTION` expiry → **it did not exist until 2026-09-12**: the guard matched a
      phrase, and a ticked line still contains it. `taskState()` now reads open/ticked/missing; a
      ticked copy fails 40 CH32H417 cells
- [x] `verify_sdk_names.py` → a planted non-existent macro, named
- [ ] **carried: the same sweep over `app/tests/**`** — 17 files with almost no planted-break
      halves. AGENT-3's next item.

Two rules this deliverable produced, both worth keeping: **a break the checker could not RUN is
not a break it MISSED** (those are counted separately now), and **a guard that catches four facts
out of five reads exactly like one that catches all five**.

### C — CH32H417's Parameter Settings stop being empty  (AGENT-1)

**The largest piece of open work in the repository.** 35 cells owed, 23 routing pins.

- [ ] `params:` for every peripheral that routes pins — **49 at the round's open, 23 now**;
      post the count each cycle
- [ ] every parameter traced to `ch32h417_*.h`. True of every parameter that exists today
      (`verify_sdk_names.py` 0 errors, 0 warnings, 100 EVT files) and **not tickable until the
      line above is** — the claim is about all of them, not the ones written so far
- [ ] `FMC_NORSRAMInitTypeDef` timings, so the 8080 `Bus mode` generates `FMC_NORSRAMInit(...)`
- [ ] the `IN_EXTRACTION` entry for CH32H417 is **gone** from `tests/completeness.test.js` and the
      `TASKS.md` line is ticked — every remaining cell fails hard from that commit on
- [ ] all of it in `data/sources/H417/peripheral_extras.yaml`, none in the generated block.
      Holding so far: `--splice --refresh` rewrote all 65 generated blocks with no loss and a diff
      of exactly the lines added through the extras file
- [x] **not part of C as briefed, found by auditing it:** the six unexplained `clock` cells. Two
      were real gaps and are modelled (`I2S2`/`I2S3` had **no clock-enable bit at all** and
      generated `I2S_Init(SPI2, &s)` with no clock enable — it compiled and could not have run);
      three are genuine absences now declared with a `file:line` (`DBGMCU` a core CSR, `HSEM` and
      `IPC` core-private); one (`RTC`) is deliberately left open. **Cells 41 → 36.**

**Order, worst-first by how many pads a missing block strands:** UHSIF (49 routed signals),
SERDES, FMC, QSPI1/2, SDMMC, SAI, PIOC. Then CAN1–3, DAC, LPTIM1/2, GPHA, RTC.

**Blocked behind one APP change:** `FMC`, `ETH`, `ECDC`, `FMC_NAND`, `FMC_SDRAM` — five
peripherals. `FMC_NORSRAMInit()` takes one struct whose two timing members are **pointers** to a
second struct (`ch32h417_fmc.h:113-115`), and no SDK function takes `FMC_NORSRAMTimingInitTypeDef`
alone, so `initPlan()` gives that block no `fn:` and emits `/* TODO: nothing applies this struct
*/`, and `--strict` exits 2. Shipping the outer struct without the timings is **worse**:
`FMC_NORSRAMInit()` dereferences `FMC_ReadWriteTimingStruct` unconditionally, so a zeroed struct is
a null read at init. REQUEST(→AGENT-2) on the board 2026-09-12T19:33Z.

### D — the clock schema holds a second PLL and a per-peripheral mux

**Schema: done** (AGENT-2, `13b948a`). `clock.plls:` is a map of named PLLs (`multipliers:` or a
fixed `output_mhz:`, an `output:` other taps cite), a list-valued `source:` draws a mux,
`sysclk.sources` may name a PLL output, PLL-to-PLL inputs resolve in dependency order,
`codegen.rcc.extra:` carries further register words, and any mux or PLL the file does not encode
becomes a **named gap in the C**. Round-tripped, undoable, read in Chrome at 1280 and 1920, light
and dark, 100 % and 125 %, console empty at all eight.

**Data: open** (AGENT-1). CH32H417 declares **no `plls:` and no list `source:`**, so USB, LTDC and
ETH still compute nothing on the shipped part. The block, with an RM line per field, is the
REQUEST on the board at 19:38Z.

- [ ] CH32H417's four secondary PLLs (USBHS 480, ETH 500, USBSS 125, SerDes) and the eight
      `RCC_CFGR2` muxes of RM 3.4.13, modelled and cited by line, no longer "absent by declaration"
- [ ] **USBFS 48 MHz computed from USBHS_PLL / 10 on a shipped part**, in a real browser — the
      acceptance number. RM 3.4.13 (`CH32H417RM.md:4048` USBFSSRC=1, `:4055-4067` USBFSDIV=0111);
      the schema computes it today on a test part
- [ ] every new number checked against the RM's own worked example. **A computed number that is
      wrong is worse than a missing one** — this line is not ticked on "it computes something"
- [ ] `tests/clock_ui.test.js`'s sweep and planted breaks cover the new controls on all five parts
- [ ] `sysclk.sources` lists three of the seven `SYSPLL_SEL` allows

### E — the per-instance init struct

**Mechanism: done** (AGENT-2, `096daa6`). One struct filled per instance, applied by a call that
takes the instance, with the FUNCTION and the HANDLE varying independently — `TIM_OC1Init..OC4Init`
keep the peripheral's handle, `LTDC_LayerInit(LTDC_Layer1, &s)` keeps the function. 16 tests in
`app/tests/instances.test.js`, each with its failing half.

**Consumers landed** (AGENT-1): TIM PWM on four parts, six `channel_params.channels` maps, each
derived from *that part's own* `ChannelN` rows and asserted back against them (`74a1e12`); CH32H417
LTDC's two layers, sixteen members each — the round-5 "your layer init applies it" comment is gone
and the pixel format moved *into* the layer struct; CH32L103 CMP1–3 through `OPA_CMP_Init` with
`CMP_NUM` fixed by `const:` (`4b43cbd`), which closed F.

- [ ] `--strict` exit 0 on every fixture **throughout** — holding; re-check each cycle
- [x] `USART_ClockInit` — landed as data on CH32V003, and **the blocker was not real.** The row
      said "needs APP: the generator cannot gate a second init struct off yet". It can: a struct
      all of whose params carry a `when:` is already emitted on the gate, and `initPlan()` already
      groups by `struct:`. Checking that cost less than the round the row spent waiting.
      **A blocker nobody has re-read is a guess too.**

### F — CH32L103 and CH32V003 at 0 open  (AGENT-1) — **COMPLETE**

- [x] CH32L103 **12 → 0**. CMP2/CMP3 modelled. It surfaced two defects shipping since the part
      landed, both invisible because no fixture ever switched a comparator on: no `CMP_InitTypeDef`
      in `codegen.init_structs`, so CMP1's params were filled in and followed by `/* TODO: nothing
      applies this struct */`; and no comparator had a `CMP_NUM` row, right for CMP1 **by accident**
      (`CMP1 = 0`, struct zero-initialised) and wrong for CMP2 and CMP3
- [x] CH32V003 **3 → 0**. The three USART1_CK rows
- [x] `python tools/coverage.py --quiet` prints **six zeros**, verified in a clean clone at
      `origin/main`. Both parts compiled rather than asserted: `pio run` SUCCESS on CH32L103K8U6
      with CMP2+CMP3 and on CH32V003F4P6 with USART1 synchronous on PD4

### Housekeeping

- [x] `gen_h417_peripherals.py` writes LF (`newline="\n"`) — a refresh that changes four lines no
      longer rewrites all 3855 to CRLF
- [x] `validate_mcu.py` refuses a duplicate YAML key (`tools/validate_mcu.py:762`), so the failure
      lands three steps earlier than `tests/data.test.js`
- [x] `app/tests/engine.test.js:253` and `app/template.html:2092` no longer cite things that are
      not true
- [ ] the 4 default collisions left on QFN68 closed and `COLLISION_CEILING` at 0-0-0 — **waited
      three rounds** (AGENT-1). All four are cases where a signal has few pads to move to:
      `FMC_A11`/PB11, `FMC_A12`/PB12, `UHSIF_PORT3`/PB0, `UHSIF_PORT4`/PB1. The fix is the pin
      order in the generator
- [ ] §5 run end to end, QA-PASS posted with what failed (AGENT-3)
- [ ] `PROGRESS.md` re-measured each cycle; every number in it is the tool's, dated (AGENT-3)
- [ ] `CH32X035`'s remaining `params:` — still an `IN_EXTRACTION` entry in
      `tests/completeness.test.js` with a live `TASKS.md` line (AGENT-1)

---

## 3. Open cross-agent requests

Answer a request addressed to you **before** you pick up new work. Unanswered for two of your
cycles, it becomes your decision — post `DECISION | (unanswered) …` and implement the
least-invasive version.

| Posted | From → to | What |
|---|---|---|
| 09-12T19:33Z | 1 → 2 | **the nested-struct shape** — a struct whose member is a pointer to a second struct with no SDK function of its own. Five H417 peripherals behind it (FMC, ETH, ECDC, FMC_NAND, FMC_SDRAM). The smallest shape that closes it is on the board |
| 09-12T19:38Z | 2 → 1 | **H417's `clock.plls:` block**, with the three errors `validate_mcu.py` raises on it today, and an RM line per field. D's data half |
| 09-13T00:33Z | 1 → 3 | `tests/h417_packages.test.js:222-227` names the four remaining QFN68 collisions by a **setting label the data no longer uses**. The count is right, the label is stale |
| 09-13T00:33Z | 1 → 3 | the expiry planted break's printed cell count is **capped at 40 by `assert.empty`** and read 40 where the header said 41 — a display limit, not a count |
| 09-13T00:33Z | 1 → 3 | **the pack's opening numbers are stale in all three.** *Answered by this file* — §1 is measured, dated and names its command |
| 09-12T23:04Z | 3 → 2 | **the layout is not tolerant of its own font fallback.** `#mcu-meta` needs 181px in a 168px box on Linux; it ellipsises by design so the check no longer fails, but the user sees less than intended |

---

## 4. The agents — standing brief, what is IN FLIGHT, and the last cycle

**This section is the handoff record.** Each agent's block has two parts, written at different
moments, and `agents/README.md` §2a is the protocol in full:

- **IN FLIGHT** — written *before* you touch a file, updated as you go, cleared in the commit
  that finishes. It is what a cold agent needs to pick your work up: the claimed `TASKS.md`
  line, what you have actually done, which files you touched, the single next action, and which
  gates you last ran.
- **Current** — rewritten at the *end* of a cycle: what landed, what is red and who owns it,
  and **the numbers**.

Write only inside your own `<!-- AGENT-n -->` block. If another agent's IN FLIGHT block looks
stale, post a `NOTE(→AGENT-n)` — do not clear it silently.

<!-- AGENT-1 -->
### AGENT-1 — DATA

Owns `data/mcus/**`, `data/packages/**`, `data/sources/**`, `data/coverage/**`, `data/FORMAT.md`,
`tools/extract_*.py`, `tools/gen_*.py`, `tools/validate_mcu.py`, `tools/coverage*.py`,
`tools/ledger.py`.

**Before any hardware fact: the coverage ledger** (`docs/COVERAGE.md`). A part is not done while
`python tools/coverage.py <PART>` prints an open row. Take the first open row, open the cited line,
model it **through the part's generator, never an ad-hoc script**, or declare it with a `file:line`;
rerun. `open_rows:` may only go down.

**The sources: Markdown first, PDF last.** Every drop is converted to markdown, the conversion sits
in the part's `Datasheets/` folder with the original beside it, and the conversion is what you
read — it greps, it diffs, it can be cited by line. Open the PDF only when the markdown **cannot**
answer (missing, unreadable, or demonstrably incomplete). "The PDF is clearer" is not a reason.
The protocol is `data/sources/README.md`: say why in a `PDF FALLBACK:` line, recover by script with
a check against numbers the datasheet states elsewhere, and write the recovered cells back so the
PDF is read once. When you write a tool, default it to the markdown through `tools/source_docs.py`.

**P0 — C.** The 35 `params:` cells, worst-first by stranded pads. Every parameter is
`struct:`+`sdk_field:`, or `sdk_call:`+`sdk_args:`, or `sdk_none:`+`sdk_note:`, traced to
`ch32h417_*.h` by `verify_sdk_names.py`. **A name nobody compiled is a guess.** Everything through
`data/sources/H417/peripheral_extras.yaml`, never into the generated block — `--splice --refresh`
discards a hand edit, which happened once this round and undid a fix within a day.
**P1 — D's data half**, the cycle the REQUEST is answered. **P2 —** the four QFN68 collisions;
MEU6/WEU6 (the DS contradicts itself 3 sources to 1 — settle it with a citation); the dual core
(`mcu.core` is one string, PlatformIO ships `_V3F`/`_V5F` board files — decide what a generated
project targets and say it in the notes). **Idle:** §7 DATA, and the ledger on any part not at 0.

**Two things the ledger cannot see, and you own the fix for:** `status: complete` is "every
datasheet fact is accounted for", not "the part is done" — report the ledger count *and* the
`params:` count *and* the collisions. And a `disagreements:` entry is an **unresolved** fact, not a
resolved one: the SerDes TX/RX pairs are recorded both ways because the DS says both; the app
routes one. Say which, in the notes.

**IN FLIGHT** — nothing.
- TASKS.md line: —
- Doing: —
- Files touched: —
- Next step if I stop here: take C's worst-first list below — UHSIF first (49 routed signals),
  through `data/sources/H417/peripheral_extras.yaml`, never the generated block.
- Gates last run: `validate_mcu` 0 · `verify_sdk_names` 0 · `coverage --gate` 6 of 6 ·
  `node tests/run.js` ALL GREEN 780 — at `116ca16`.

**Current — cycle 6, 2026-09-13T00:33Z. The peripheral map is measured, and measuring it found
generated C that could not have run.** An audit rather than an extraction: 78 peripherals, six axes
each, plus fixture and compile, in `tests/evidence/round6/2026-09-13-h417-peripheral-map.md`. Every
number in it came out of a command run for it.

- **The finding: `I2S2` and `I2S3` had NO bit in `codegen.periph_clock` at all.** Switching either
  on emitted `I2S_Init(SPI2, &s)` under the comment "no clock enable bit — none is written". It
  compiled, `--strict` exited 0, `validate_mcu` and `verify_sdk_names` were at 0, and `coverage.py`
  said 0 open — because **not one of them asks, peripheral by peripheral, whether the clock gets
  turned on.** The ledger reads the datasheet's pin table; this is the other half of the same
  question and nothing was asking it. The I2S is a MODE of the SPI block, so it shares the SPI's
  gate, which is what the EVT does one line above its own `I2S_Init`
  (`data/sources/H417/Evt/EXAM/DFSDM/DFSDM_I2S_Audio/Common/hardware.c:103`, beside `:111`).
- **Three more clock cells declared by address rather than by analogy.** The complete
  `RCC_*Periph_*` block is `ch32h417_rcc.h:230-307`, 73 macros, and none of the three is in it.
- **`RTC` I did NOT close, and that is the decision worth recording.** Its gate is TWO bits
  (`RCC_HB1Periph_PWR | RCC_HB1Periph_BKP`) and `bits:` maps one peripheral to one bit. **`BKP`
  alone would have ticked the cell and shipped a half-enable that reads exactly like a whole one**
  — the shape of every defect in this part's notes. New `TASKS.md` line, owner AGENT-2 for the
  schema half, reasoning in the RTC `notes:` so a `--refresh` reproduces it.
- **Earlier cycles:** `params:` 65 → 39 (USART4-8, SPI3-4, I2C3-4, eight timers, ADC1/2, DVP, IPC,
  SWPMI, I2S2/3, SDIO, HSADC); **F closed, both parts, 12 → 0 and 3 → 0**; E's data half (six
  `channels:` maps, LTDC's two layers).
- **The near-miss worth keeping:** `--splice --refresh` silently reverted an ETH commit that had
  been written into the GENERATED block. The loss guard caught the notes and the pads and refused
  to write; it said nothing about the choice row, because `_losses()` compared peripherals,
  signals, routed pairs and remaps and **not choice lists**. It compares choices now, planted with
  the exact case that slipped past it and seen red.

Red, and who owns it: **nothing.** Numbers: ledger **0/0/0/0/0/0**. H417 `params:` **39 of 78 have,
39 do not; 35 owed, 23 routing pins.** Collisions **QFN68 4 / QFN88 0 / QFN128 0** — untouched;
`SOFT_CELLS` still exactly `{params, clock}`; no test deleted, no threshold moved.

**Next:** the 35 cells, UHSIF first. FMC/ETH/ECDC/NAND/SDRAM stay blocked on the nested-struct
REQUEST. Then the four QFN68 collisions and the four secondary PLLs.

<!-- /AGENT-1 -->

<!-- AGENT-2 -->
### AGENT-2 — APP

Owns `app/engine/**`, `app/template.html`, `app/tests/**`, `app/assets/**`, `build.py`,
`tools/wchcube_cli.js`.

**The rule you consume:** *every choice the app offers must be one the silicon can honour.* The
data says what the silicon allows; the engine refuses what it does not; and **a computed number
that is wrong is worse than a missing one.** Every new clock tap ships with the number it computes
checked against the RM's worked example, or it does not ship.

**P0 — the nested-struct shape** (REQUEST 19:33Z): a struct whose member is a **pointer** to a
second struct that no SDK function takes alone. Five H417 peripherals are behind it and AGENT-1 has
taken other work twice to avoid it. **P1 — D's remaining acceptance**: the schema is landed; the
number on a shipped part is not, and it lands the cycle AGENT-1's `plls:` block does — read it in a
real browser the same cycle. **P2 —** the font-fallback layout finding (3 → 2, 23:04Z);
`sdk_none:`'s emitted prefix — `"the SDK exposes nothing for it"` is wrong for the LTDC pixel
format, where the SDK exposes a setter that is unsafe at init; a `sdk_manual:` key emitting
`"set by firmware: <note>"` would say the true thing. **Idle:** §7 APP, and the standing task —
read `codegen.js` end to end for an assumption that only holds for the parts that existed when it
was written. CH32H417 is the first with AF-muxed pins, two cores and a 24-bit port, and each has
already found one. **Seven findings from that read are in §7 APP; the first is fixed, the rest are
recorded rather than guessed at.**

**IN FLIGHT** — nothing.
- TASKS.md line: —
- Doing: —
- Files touched: —
- Next step if I stop here: the nested-struct shape (§3, REQUEST 09-12T19:33Z) — a struct whose
  member is a pointer to a second struct no SDK function takes alone. `ch32h417_fmc.h:113-115`
  is the case; five H417 peripherals are behind it.
- Gates last run: full suite ALL GREEN 775, 0 skipped — at `096daa6`.

**Current — cycle 2, 2026-09-12T21:14Z. D's schema is DONE. E's mechanism is DONE; its consumers
were data and AGENT-1 has since landed three of them.**

- **D (`13b948a`)** — `clock.plls:`, a list-valued `source:` as a mux, `sysclk.sources` naming a
  PLL output, PLL-to-PLL inputs resolved in dependency order, `codegen.rcc.extra:`, and a named gap
  in the C for any mux or PLL the file does not encode. **The number: USBHS_PLL 480 MHz → USBFS /10
  = 48.0 MHz**, RM 3.4.13. Read in Chrome on `dist/index.html` at all eight combinations, console
  empty. **Which taps compute on a SHIPPED part: still none new** — CH32H417 declares no `plls:`,
  so USB/LTDC/ETH compute nothing there yet. I read the number off the real part the cycle it lands.
- **E (`096daa6`)** — the mechanism, with the FUNCTION and the HANDLE varying independently. I
  generated the eight `channels:` maps from each part's own settings, applied one to a derived part
  and read the C before asking for it: `TIM_OC1Init(TIM1, &s)` with `TIM_Pulse = 500`, nothing for
  the input-capture channel, nothing for the two at Disable, no TODO. **A test asserts all eight
  are still silent, so it goes red the day one lands and cannot outlive the gap it records.**
- **`paramReachWarnings()` counted a `const:` member and the inapplicable half of a dependent pair
  as "the user changed it"**, and `--strict` exits 2 on a warning — so a disabled ADC1 on CH32H417
  failed the gate. Fixed with the table's own two predicates, both clauses seen RED on a planted
  break (`6645e38`). AGENT-1's `default:` mirrors are stripped.
- **`USART_ClockInit`: the blocker was gone and nobody had noticed.** A struct all of whose params
  carry a `when:` is already emitted on the gate (`TWO_STRUCTS` in `app/tests/codegen.test.js`,
  both ways). CH32V003's USART1_CK became pure data.
- Two `app/tests/export.test.js` tests enumerating the exact output and option lists were red on
  main after `BoardPins.h` landed without them. Updated, and each now moves **one switch at a time**
  so a list that changed for two reasons cannot still look right (`724334d`).

Red, and who owns it: nothing. The only failures seen came from the shared tree — another agent
rebuilding `dist/index.html` mid-run, which the runner prints a note about; each was green re-run
alone. **The matching hazard from my side: a half-saved engine module takes everyone's CLI down,
because `tools/wchcube_cli.js` reads `app/engine/*` off disk. Write the import before the body.**

**Next:** the nested-struct shape, then the H417 clock block the cycle it lands.

<!-- /AGENT-2 -->

<!-- AGENT-3 -->
### AGENT-3 — QA + RELEASE

Owns `tests/**`, `tests/evidence/**`, `src-tauri/**`, `data/firmware/**`, `.github/**`,
`scripts/**`, `README.md`, `PROGRESS.md`, `Taskfile.yml`, `agents/**` (the pack). May add tests
anywhere; may only ADD to `app/`. **You are the only agent who ticks a line in §2, and only on
something that runs.**

**The standing rule, and why it is the round:** *a check nobody has seen go red is not a check.*
The planted-break discipline — mutate, watch it go red, restore — is the only answer this
repository has found that works. Your own duplicate-key detector caught two bugs **in itself**
through its planted break before it caught anything in the tree. That is the discipline working.

**P0 — watch `main` stay green** across other agents' commits; three in a row from different agents
and `worktrees ON` goes up. `origin/main` is one commit behind the tree right now. **P1 — the
planted-break sweep over `app/tests/**`** — 17 files with almost none. A red found in `app/` or
`data/` is a board entry for its owner, never a fix by you. **P2 —** §1 re-measured every cycle,
never asserted; §5 run end to end before any `ROUND 6 DONE`; `src-tauri` has not been relinked
since round 4 and `cargo build` green is not a window opening; and **the pack**: `agents/` is three
files, anything that contradicts the tree is fixed in the commit that notices. Run the stale-pointer
grep each cycle (`Agents Rounds`, `agents/Update`, `run_round`, `PROMPT_AGENT_`, `AGENT_1_DATA`,
`AGENT_2_APP`, `AGENT_3_QA_RELEASE`, `DONE.md`, `PROJECT.md`, `HUMAN_TODO`, `BACKLOG.md`,
`run_agents.ps1`); a hit outside `history/`, `BOARD.md` and `tests/evidence/` is a live pointer at
something that no longer exists. **Idle:** §7 QA/RELEASE.

**IN FLIGHT** — nothing.
- TASKS.md line: —
- Doing: —
- Files touched: —
- Next step if I stop here: the planted-break sweep over `app/tests/**` (17 files, almost none),
  and watch `main` stay green for three consecutive commits from different agents before posting
  `DECISION | worktrees ON`.
- Gates last run: `validate_mcu` 0 · `verify_sdk_names` 0 · `coverage --gate` 6 of 6 ·
  `build.py` OK · `node tests/run.js` — see §1.

**Current — 2026-09-13, the pack consolidated to three files.** `README.md` (the agreement),
`STATUS.md` (this file — the single source of truth) and `BOARD.md` (the log). Superseded and
archived whole under `history/round6-pack/`: `PROJECT.md`, `DONE.md` (the rounds 1–5 evidence
record), `WALKTHROUGH.md`, `HUMAN_TODO.md`, `BACKLOG.md` and the three `AGENT_n_*.md` files. Three
things that were stale are fixed rather than carried: the pack's opening numbers (AGENT-1's REQUEST
of 00:33Z — §1 is measured and names its command), the launcher and its six paste-in prompt files
(deleted; §7 of `README.md` is the whole handover), and `BOARD.md`'s quadruple-encoded header line.

**Before that, cycle 1 — CI is GREEN on all three jobs, for the first time in this repository's
history.** Run 34723740365 on `b5a654f`. **The round's rule turned out to be true of the round's own
first deliverable**: the pack, `PROGRESS.md` and the brief all said CI had never executed. It had
run **31 times and failed every one**, unread — not "never run": worse, because it had been guessed
green for a day. Almost nothing was wrong with the code; what was wrong was the ability to see
(§2 A). **The genuine defects were genuine and nothing was weakened to make them pass**: a stale
`dist` shipped twice by data commits that did not rebuild, and then a third time **by me**, one
commit after reporting it, by building from a clean clone at a SHA four commits had already
overtaken. Three environment bugs in my own test files: Chrome without `--no-sandbox` on ubuntu
24.04 (every browser test FAILED rather than skipped), `cargo test` running in the one job that
never installs Tauri's deps, and a planted break targeting a checker that needs PlatformIO.

**Deliverable B is met for `tests/**`** — the list of gates that cannot go red is empty.
**Deliverable F is complete** — six zeros.

**NOT claimed.** `worktrees ON` is not posted: one green run is a thing seen once. The hardware
line still reads **"builds, not flashed"**. `src-tauri` has not been relinked since round 4.

<!-- /AGENT-3 -->

---

## 5. Acceptance — the script that closes the round

Runnable by someone who did not write it. Every step is a thing you **see**, not a thing you are
told. AGENT-3 runs it end to end before posting `DECISION | ROUND 6 DONE`, and posts which steps
failed. `DECISION | ROUND 6 DONE` requires §5.1–§5.6 green; §5.7 is not a blocker — it is the
honest statement of what remains, and it must still be there when the round closes.

**§5.1 — CI has run, and somebody read it**
1. The Actions tab for `origin` has a completed run of `ci.yml` on `main` — the run page, not a
   badge, with three jobs: `test`, `firmware`, `desktop`.
2. The `firmware` job's log shows the compile-gate suite reporting an actual **ok**, not a skip
   reading "pio not on PATH". Count the skips in the summary; none may be "PlatformIO is not
   installed".
3. The `Coverage ledger` step prints `coverage gate: 6 of 6 part(s) meet their declared status`
   **on the runner**.
4. `PROGRESS.md` quotes the run URL and no longer contains the words "never run in CI".
5. `BOARD.md` has `DECISION | worktrees ON` posted **after** step 2's run, not before.

**§5.2 — every gate has been seen red**
6. `tests/evidence/round6/` holds one file per planted break with the red output verbatim and the
   restore. Open two at random: the assertion text names the thing that was planted.
7. `node tests/run.js "can actually fail\|planted break\|can go red"` — every suite named in §2 B
   has at least one hit and every hit is `ok`.
8. The board carries the list of checks that **cannot** go red, by name, with a reason. The
   acceptance is that this list is **empty**.

**§5.3 — CH32H417's Parameter Settings are not empty**
9. New project → CH32H417 → QFN128. Select `ADC1`, `CAN1`, `DAC`, `FMC`: each shows a Parameter
   Settings tab with real rows. `tests/completeness.test.js` has no CH32H417 `IN_EXTRACTION` entry
   and the `TASKS.md` line is ticked.
10. `FMC`, `Bus mode: 8080 LCD, 8-bit` → Parameter Settings shows the `FMC_NORSRAMInitTypeDef`
    timings. Generate: the C carries `FMC_NORSRAMInit(...)` with those values and **no TODO**.
11. `python tools/verify_sdk_names.py` → 0 errors.

**§5.4 — the clock tab computes what it used to declare absent**
12. CH32H417, clock tab: a box for `USBHS_PLL` with its own source mux and multiplier, and a
    `USBFS 48M` tap with a **source select** offering the choices RM 3.4.13 gives it.
13. Pick `USBHS_PLL / 10` for `USBFS 48M`: the tap reads **48 MHz**. Change the USBHS PLL
    multiplier; the number moves.
14. Save, reload, reopen: the mux choice comes back. Undo, redo: it moves and moves back.
15. On CH32V006 the clock tab is **unchanged** — one PLL, no mux selects, no new controls.

**§5.5 — the per-instance struct emits**
16. CH32H417, `LTDC` on, both layers' pixel formats set. Generate: `WCHCube_LTDC_Init()` carries
    two `LTDC_Layer_InitTypeDef` blocks and `LTDC_LayerInit(LTDC_Layer1, ...)` / `(LTDC_Layer2,
    ...)`. The round-5 "your layer init applies it" comment is gone.
17. CH32L103, `CMP1` on. Generate: `OPA_CMP_Init(&s)` with `s.CMP_NUM = CMP1` fixed by `const:`.
18. `node tests/run.js "strict"` — all `ok`.

**§5.6 — the ledger**
19. `python tools/coverage.py --quiet` prints **six zeros**, all six `complete`.
20. `python tools/coverage_selftest.py` → all planted breaks caught, count printed.

**§5.7 — the things that are still not true**
21. **Nothing has been flashed.** §1 and `PROGRESS.md` read **"builds, not flashed"** in exactly
    those words and §6 item 8 is still there. If anyone rounded this up, this step catches it.
22. **`src-tauri` unverified in a window** unless §6 item 7 has a reply. `PROGRESS.md` says so and
    no board entry claims the desktop path is verified.

Post the verdict:

```
<UTC> | AGENT-3 | QA-PASS | acceptance run end to end. §1 n/n, §2 n/n, ... What failed: ... (or "nothing").
```

---

## 6. Only a human can do these

Listed once. **Never re-request one on the board.** If a job fails for a reason only the
repository owner can change, add it here as a new numbered item with the exact setting named.

1. ~~**Add a git remote and push**~~ — **done 2026-09-12.** `origin` is
   `https://github.com/arwidcool/WCH_Cube.git`; every commit since is pushed. Nothing is yours
   here unless a CI run needs a repository setting (Actions enabled, a runner minute budget).
2. ~~**Rust toolchain**~~ — **not needed.** `cargo` 1.98.1 is on PATH. The remaining desktop gap is
   item 7.
3. **Move the repo off the Google Drive mount.** `npm install` fails there (EBADF) and sync can
   corrupt a half-written `dist/index.html` mid-run. Any local folder works. This is also why the
   suite must be run serially.
4. **Datasheet + RM markdown for the next parts** into `data/sources/`: **CH32V203, CH32V307**, in
   that order. AGENT-1 starts each the cycle it appears. Adding a part is now a data job rather
   than an engine job — that is the claim rounds 4 and 5 exist to test.
5. ~~**Verify the ch32v00x port-clock spelling**~~ — **resolved, no human needed.**
   `ch32v00X_rcc.h:157` declares `RCC_PB2PeriphClockCmd`, `:88-92` the `RCC_PB2Periph_GPIOA..D` and
   `RCC_PB2Periph_AFIO` macros, `AFIO->PCFR1` is in `ch32v00X.h:197`.
6. ~~**The ADC internal Vrefint channel**~~ — an agent task now: the same gap exists on CH32V006
   and CH32X035, so it is a repo-wide decision rather than a hole in one file.
7. **See the desktop app write a project, and say whether it worked.** `cargo build` is green and
   the Rust unit tests pass, but the round-4 changes to `write_project` have never been relinked
   into a running exe — the old one was open at the time. Close it, `cargo run`, and generate a
   project through the native folder picker.

---

8. **Flash one generated project.** ← *the only thing in this repository that cannot be done
   without you, and the highest-value item on this list.*

   **Every green result in this project is a compile.** Nothing here has ever been flashed or run
   on silicon. `pio run` exits 0 for four configurations across two MCU families, the generated C
   links, and `SystemCoreClock` is computed rather than measured. We do not know that a single one
   of these configurations produces a chip that starts.

   If you have **any CH32V006, CH32V005 or CH32X035 board and a WCH-Link**, this is a five-minute
   job, and the generated project exists precisely so that it is:

   ```
   # 1. In the app: pick your part and package, assign at least one pin as
   #    Output Push Pull (the banner will name it), then
   #    Project Manager -> GENERATE PROJECT.
   # 2. Open the folder it wrote:
   cd <the folder>
   pio run                 # should already be green - this is what CI proves
   pio run -t upload       # <- THE NEW INFORMATION. Needs the WCH-Link attached.
   pio device monitor      # printf goes over the WCH-Link SDI channel, no pin used
   ```

   **What to send back**, whichever way it goes — a failure here is worth as much as a success,
   and arguably more:

   - the text of the SDI banner (it prints the part, the package, the SYSCLK the configuration
     asked for, and `SystemCoreClock` read back after init);
   - whether the pin you configured as an output actually toggles;
   - if it does not start at all, the output of `pio run -t upload` verbatim.

   **The banner deliberately prints two clock numbers and they may differ.** That is expected, not
   a bug: the board file's `SYSCLK_FREQ_*` macro is applied by `SystemInit()` before `main()` runs,
   and the generated `WCHCube_RCC_Init()` then overrides it. A project configured for 24 MHz boots
   at 48 and drops to 24. CubeMX behaves the same way. Seeing the two numbers is the point.

   The result goes in `tests/evidence/round6/` and would be **the first hardware result this
   project has**. Until it happens the line reads **"builds, not flashed"**, in exactly those
   words, and nobody may round that up.

---

## 7. Backlog — for an agent whose brief is complete

**Idle is not a stop.** An agent that posts `IDLE` twice with nothing between takes an item from
here. If you take one, say so on the board and move it into `TASKS.md` — a backlog entry nobody can
see is the same as no entry.

### DATA
- Every part whose sources exist in `data/sources/`. **Adding a part should be a data job**; every
  part that needs an engine change is a finding worth a board entry.
- `params:` for every peripheral on CH32V006 and CH32X035 — the same class as CH32H417's.
- Per-pin drive strength / input-only / 5 V tolerance flags **where the DS states them**. The
  CH32V006 DS does not state 5 V per pin, which is why the field is absent there — do not carry it
  over from another family.
- Interrupt vector tables for parts that lack `nvic:`.
- The constraint mechanism applied wherever an audit finds an instance. CH32V006 and CH32V005 must
  be **audited either way** — "no instances, checked in RM ch.7" is a result, and it is the one
  that proves the mechanism was not built for one part.
- `data/FORMAT.md` reviewed end to end against what the engine actually accepts. It is the
  DATA↔APP contract and it drifts silently; `validate_mcu.py` wins when the two disagree.
- `WCH-DUMMY32-C8` gets `dma` / `nvic` / `params` / `codegen`.

### APP
- Project diff: two `.wchproj` files → changed pins, settings and clock, as a readable summary.
- Pinout SVG export; print view; a KiCad symbol pin CSV.
- Categories / A→Z toggle, expand/collapse all, show-enabled-only in the peripheral tree.
- Accessibility: the chip and the tree reachable by keyboard alone, AA contrast in both themes.
  The chip is already keyboard-navigable (arrows, Enter, L, Del); the tree is not.
- **`codegen.js` read end to end, 2026-09-12 — seven findings, the first fixed and the rest
  recorded rather than guessed at:**
  1. **`rccWord()` went SILENT about a PLL input it had no encoding for.** `if (c.pllsrc && …)`
     meant a part with a PLL and no `pllsrc:` produced a word covering SW and the prescalers and
     nothing about the input, while the header comment named the input the configuration had asked
     for. On CH32H417 that is 32 asked-for clock rates and no bit written to choose between them,
     in a file that reads as complete. **FIXED** — it names the missing key and the chosen input,
     in the C.
  2. **`isFixture()` decides by sniffing the part's NAME and VENDOR** (`/dummy/i` on both). The
     clean flag is `mcu.fixture: true`, which `data/FORMAT.md` would have to bless and
     `tests/fixtures/mcus/WCH-DUMMY32-C8.yaml` carry — a `tests/` file, so it is a REQUEST.
     Two-sided: the flag must land before the sniffing can go.
  3. **`gpioPlan()` drops an `io` pin whose name is not `P<letter><digits>`** with no TODO and no
     note. Unreachable on all six parts; a part that was not would generate a `WCHCube_GPIO_Init`
     that quietly omits the pin. The fix is a named TODO, not a wider regex.
  4. **`structVar()` assumes every struct typedef ends in `TypeDef`.** A struct not so named
     becomes its own variable name — `Foo Foo = {0};` — and two such structs on one peripheral
     would collide inside the block.
  5. **`GPIO_Pin_<n>` is the one SPL macro the generator writes without the data's permission.**
     Right on all six parts, and the kind of thing that is right until the first part that is not.
  6. **The RCC word's gaps are comments; everywhere else in the file a gap is a TODO.** That means
     `--strict` cannot see a clock the configuration asked for and the C does not produce. Worth a
     decision rather than a change: the alternative is a red shared tree for every part with an
     unencoded divider.
  7. **`pllsrc` is keyed on the PLL input's SOURCE**, the whole register field on the parts that
     have one. CH32H417's input is a source AND a divider (`RCC_PLLCFGR` PLL_SRC_DIV), so it is not
     a value to fill in but a shape `codegen.rcc` cannot express. A FORMAT question.

### QA / RELEASE
- `tests/perf.test.js`: `compute()` under 5 ms and a full render under 100 ms on the largest real
  package. There is a per-test budget today but no separate perf suite.
- Real-browser screenshots of the pinout and clock tab per part × package, as CI artifacts.
- `tests/evidence/` — a claim in a board entry with no artefact behind it is what the folder exists
  to prevent. Several round-4 entries cite measurements nobody can re-run.
- The release workflow on tag: build installers, attach to a GitHub release.
- Windows/macOS Tauri jobs now that Linux is green.
- A **hostile** fixture for the engine's edge cases — shorted pins, exposed pad, a peripheral with
  no usable mapping, an out-of-spec clock, a constraint that excludes a pin.
  `tests/fixtures/mcus/WCH-DUMMY32-C8.yaml` is a size stress test, not a hostile one.

### The pack — AGENT-3
- **`agents/proposals/layout-orientation.test.js` is an orphan.** AGENT-3 wrote it for AGENT-4,
  who no longer exists, and it has never run: every part × every package × 4 rotations ×
  mirrored at three widths, 384 combinations. Either `git mv` it into `tests/` and let it run,
  or say on the board why it should not — a proposed test nobody owns is a check that reads as
  done and is not. (`agents/proposals/` also holds the CH32X035 DMA derivation, which **is**
  live: three files in `data/` cite `x035_dma_requests.py` by path.)
- The rounds 1–5 `DONE.md` sections still carry `[ ]` marks and a "15 of 24" count from round 3;
  most of what they call open closed under a later round's line, and they were never re-audited.
  They are the **evidence record**, not a status: read a line there for *how* something was closed,
  never for where the project stands. In `history/round6-pack/DONE.md`.
- **When round 6 closes:** copy `STATUS.md` and `BOARD.md` into `history/round6/`, write the
  round-6 row in `history/INDEX.md`, and open round 7 by rewriting §2, §4 and §5 **in place**.
  **The live files keep their names**, so nothing that points at them breaks, and there is never a
  second copy of the truth.
