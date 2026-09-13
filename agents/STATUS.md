# STATUS — the single source of truth

Where the project stands, who owns what is open, and what is in somebody's hands right now.
**A number here is one a command printed, with the command named. Nothing is carried over on the
strength of another document saying it.** If a statement here stops being true, change it *here
first*.

**Read all of it** — including the other agents' §4 blocks, which say what is already half-done.
**Write** only in your own `<!-- AGENT-n -->` block and the §2 rows you own. Never rewrite the
file wholesale.

`agents/README.md` is the agreement (ownership, cycle, gates, handoff protocol, the box).
`agents/BOARD.md` is the append-only log. `TASKS.md` at the root is the claim/tick tracker — its
line *text* is read by `tests/completeness.test.js` and `tests/codegen_compile.test.js`, so edit
lines there only in the commit that retires what cites them.

> **Round 6 — "a gate nobody has watched run is a guess."** Round 5 closed with four things that
> were green and not true: the ledger at zero the day 63 default collisions were found; three
> Python gates green over a file `js-yaml` refused; header checks silently `continue`-ing past
> three of six parts; and a CI recorded as "never run" that had run 31 times and failed every
> one, unread. None was a *wrong* gate. Each had never been **seen to fail on the thing it was
> supposed to catch**.

## At a glance

| | |
|---|---|
| **Gates** | all green — ledger 6 of 6, validate 0, sdk-names 0, suite 780/0 skipped (§1) |
| **Biggest open item** | CH32H417 `params:` — **34 cells owed, 22 routing pins** (§2 C, AGENT-1) |
| **Unblocked this cycle** | the nested-struct shape (`codegen.init_structs.*.embed`) and the clock tab's second-PLL layout — both AGENT-2, §2 C/D and §4 |
| **Unverified** | `src-tauri` in a window; **nothing has ever been flashed** (§6) |
| **Next per agent** | 1: SERDES, then FMC (no longer blocked) · 2: idle / §7 backlog · 3: `app/tests/**` planted breaks (§4) |

---

## 1. Measured now

Run for this block, serially, on a settled tree — 2026-09-13, at `2b1967d`:

```
python tools/coverage.py --gate      coverage gate: 6 of 6 part(s) meet their declared status
                                     H417 0 · L103 0 · V003 0 · V005 0 · V006 0 · X035 0   all complete
python tools/validate_mcu.py         0 errors, 99 warnings
python tools/verify_sdk_names.py     0 errors, 0 warnings
python build.py                      OK, dist/index.html 1349 KB
node tests/run.js                    ALL GREEN — 780 tests, 0 skipped  (381.8 s)
```

| | Measured | Source |
|---|---|---|
| CH32H417 `params:` | **40 of 78 peripherals have a block, 38 do not.** 4 of those 38 are declared ABSENT (SYS, RCC, EXTI, DMA1 — choices, not numbers), so **34 cells are owed, 22 of them routing pins** (UHSIF landed 2026-09-13) | count over `data/mcus/CH32H417.yaml` |
| CH32H417, other axes | clock 68 of 78, 9 ABSENT, **1 open (RTC)** · vectors 66 of 78, all 12 without ABSENT — **0 owed** · pins 61 route, 17 `pins: none`, 0 `pins: open`, **0 unreachable routed signals** · codegen reach **0** peripherals hold a pad and reach no code. **Cells 41 → 36** | `tests/evidence/round6/2026-09-13-h417-peripheral-map.md` |
| CH32H417 collisions | **QFN68 4 · QFN88 0 · QFN128 0** (450 claiming choices swept per package) | `COLLISION_CEILING`, `tests/h417_packages.test.js:228` |
| CI | green on all three jobs: run **34723740365** on `b5a654f` | the run page; URL in `PROGRESS.md` §1 |
| CI vs HEAD | pushed through `2b1967d`; **CI has not yet reported on it** | `git status -sb` |
| CH32H417 clock | still **1 of 5 PLLs, 0 of 8 muxes** in the shipped file. The USBHS_PLL block computes `USBFS = 48 MHz` and is parked in `agents/proposals/CH32H417_usbhs_pll.yaml` — blocked on a layout defect, not on facts | `clockCalc()` with the block spliced in |
| Hardware | **builds, not flashed** — every green result here is a compile | §6 item 8 |

> **What six zeros does not mean.** The ledger asks whether every fact the **datasheet** states is
> accounted for. It does not ask what the app does with them. CH32H417 is `complete` *and* has 39
> peripherals with no `params:` — you can claim their pins and configure nothing. Report the
> ledger count *and* the `params:` count *and* the collisions, every time.

---

## 2. Deliverables

| | Deliverable | Owner | State |
|---|---|---|---|
| **A** | CI executes and is read green | 3 | done; one line withheld |
| **B** | every gate proven able to fail | 3 | done for `tests/**`; `app/tests/**` not swept |
| **C** | CH32H417's Parameter Settings stop being empty | 1 | **open — 35 cells owed** |
| **D** | clock schema holds a second PLL and a per-peripheral mux | 2 schema, 1 data | schema + validator landed; **the data is PROVEN and NOT SHIPPED — the tab cannot draw a second PLL** |
| **E** | the per-instance init struct | 2 mechanism, 1 data | mechanism landed; three consumers emit |
| **F** | CH32L103 and CH32V003 at 0 open rows | 1 | **COMPLETE** |

**Exit criterion:** *CI read green on a runner, every gate in `tests/**` seen red on a planted
break, CH32H417's `IN_EXTRACTION` exemption gone, the app computing a USB and an LTDC clock on it,
and the ledger at zero on all six parts.*

### A — CI executes and is read green  (3)

Closed: `ci.yml` has completed runs on `main`; the `firmware` job's compile gates report **ok**
rather than skip (run 34721092664 prints `::notice compile gates that ran: 16`, against the ubuntu
job's `20 test(s) SKIPPED` for the same suites); the `Coverage ledger` step prints `6 of 6` **on
the runner**; `desktop` green.

- [ ] **`DECISION | worktrees ON`** — *deliberately withheld.* The condition is met, but one green
      run is a thing seen once and `main` had been red for thirty-one. It goes up at **three
      consecutive green commits from different agents**.

The 31 red runs, and why nobody saw them: `tests/evidence/round6/2026-09-12-ci-30-failures.md`.
Three fixes that outlive it — annotations must not sit behind a failing pipeline (`bash -eo
pipefail` aborts the step first), `cancel-in-progress` is OFF (it was discarding 15 of 20 runs on a
public repo where minutes are free), and the "dist is up to date" step cannot use `git diff` on
Windows (CRLF checkout).

### B — every gate is proven able to fail  (3; owners fix what goes red)

**Met for `tests/**`: 0 gates without a break that has been seen red.** Fourteen refusals verbatim
in `tests/evidence/round6/2026-09-12-planted-breaks.md`; the gates-that-cannot-go-red list
(`2026-09-13-gates-without-a-plant.md`) is **empty**. Planted and seen red: the collision ratchet,
the reachability check, the SPL-header guard, fixture freshness, `--strict` per fixture, the
`IN_EXTRACTION` expiry, `verify_sdk_names.py`.

- [ ] **the same sweep over `app/tests/**`** — 17 files with almost none.

Two rules this produced: **a break the checker could not RUN is not a break it MISSED** (counted
separately now), and **a guard that catches four facts out of five reads exactly like one that
catches all five**. The `IN_EXTRACTION` expiry is the sharpest case — it *did not exist* until
2026-09-12: the guard matched a phrase, and a ticked line still contains it.

### C — CH32H417's Parameter Settings stop being empty  (1)

**The largest open work in the repository.** **34 cells owed, 22 routing pins** (49 at the
round's open). Post the count each cycle.

- [ ] `params:` for every peripheral that routes pins
- [ ] every parameter traced to `ch32h417_*.h`. True of every parameter that exists today, and
      **not tickable until the line above is** — the claim is about all of them
- [ ] `FMC_NORSRAMInitTypeDef` timings, so the 8080 `Bus mode` generates `FMC_NORSRAMInit(...)`
- [ ] the `IN_EXTRACTION` entry for CH32H417 **gone** from `tests/completeness.test.js` and the
      `TASKS.md` line ticked — every remaining cell fails hard from that commit on
- [ ] all of it in `data/sources/H417/peripheral_extras.yaml`, none in the generated block

**Order, worst-first by stranded pads:** ~~UHSIF (49 routed signals)~~ **done 2026-09-13**, then
SERDES, FMC, QSPI1/2, SDMMC, SAI, PIOC, then CAN1–3, DAC, LPTIM1/2, GPHA, RTC. **Check whether the
peripheral's driver is in `Peripheral/inc` at all before starting one** — UHSIF's was not, and it
changed the shape of the whole task.

**No longer blocked — AGENT-2 landed the mechanism this cycle.** `FMC_NORSRAMInit()` takes one
struct whose two timing members are **pointers** to a second struct (`ch32h417_fmc.h:113-115`) that
no SDK function takes alone; `codegen.init_structs.<inner-struct>.embed.<key>: { into:, member: }`
now names which pointer member of which outer struct receives `&<the inner block's own variable>`,
and a param picks the key with `embed: <key>` beside its `struct:` — so `FMC_ReadWriteTimingStruct`
and `FMC_WriteTimingStruct` (same C type, both `FMC_NORSRAMTimingInitTypeDef*`) become two separate
blocks instead of merging into one unappliable one. THE TRAP is closed, not routed around: the
inner struct is never called on its own (correct — nothing does), and its address reaches the
outer struct's pointer member before the outer's `fn:` is called, in the SAME C scope so the
pointer stays valid. An unresolved `embed:` key is a named TODO, never a silently zeroed pointer —
`FMC_NORSRAMInit()` dereferencing `FMC_ReadWriteTimingStruct` unconditionally is exactly the null
read this closes. `codegen.js` `initPlan()`/`periphBlock()`, 8 tests incl. the planted break
(`app/tests/nested_structs.test.js`), the data-side contract and a worked `FMC_NORSRAMInitTypeDef`
example on `agents/BOARD.md`. FMC, ETH, ECDC, FMC_NAND, FMC_SDRAM are unblocked; the extraction
itself is still open (`params:` cells above).

### D — a second PLL and a per-peripheral mux  (2 schema, 1 data)

**Schema landed** (AGENT-2 `13b948a`, engine; AGENT-1 `90dadb5`, `data/FORMAT.md` +
`validate_mcu.py` + `validate_clock_selftest.py`): `clock.plls:` as a map of named PLLs, a
list-valued `source:` as a mux, `sysclk.sources` naming a PLL output, PLL-to-PLL inputs resolved
in dependency order, `default:`/`default_source:`, and a **named gap in the C** for any mux or PLL
the file does not encode. All eleven validator checks have been seen red, plus the positive half.

- [x] **the clock tab's layout blocker is fixed (AGENT-2, this cycle).** `renderClock()` packed
      every column onto one row and stopped shrinking at a floor (`SCALE_MIN`), so a 6th column
      (a second PLL) overflowed the viewport rather than fitting — measured, reproducing AGENT-1's
      number: 1280×720 @125%, real Chrome, `agents/proposals/CH32H417_usbhs_pll.yaml` spliced into
      CH32H417's `clock:` at runtime (never written to `data/mcus/`), rightmost box edge **1105px
      in a 1024px viewport (81px over)**. Columns now pack onto ROWS — greedily against the room
      the panel actually has, a column never split across a row boundary — and the SAME
      measurement now reads rightmost edge **898px (126px of margin)**, 0 overlaps, console
      silent, `USBHS_PLL_CLK 480MHz`, `USBFS 48MHz` ("must be 48 MHz", on target); screenshotted
      at 1280×720 @1, @1.25 and 1920×1080 @1. `legibility.test.js`/`layout.test.js` unchanged on
      every shipped part (none has `plls:` yet, so this is a no-op for them and becomes the live
      regression gate the day CH32H417's does). `app/template.html` "measure, place, connect".
      Full detail and the exact numbers: `TASKS.md` (AGENT-2, this cycle) and `agents/BOARD.md`.
- [ ] **USBFS 48 MHz on a shipped part** — the number is **proven**, the layout that blocked it is
      **fixed**, and it is still **not in `data/mcus/`**: shipping it is AGENT-1's data commit
      (splice `plls:` after `sysclk:`, the tap as the first `prescalers:` entry — exactly as
      `agents/proposals/CH32H417_usbhs_pll.yaml` says), not an engine change any more.
      `clockCalc()` reads `USBHS_PLL 25 → 480 MHz`, `USBFS 48 MHz`, `over: (none)`, and it
      **moves**: `/7.5 → 64`, `/8 → 60`, the other mux leg `PLLCLK/10 → 10`, each flagged against
      `target_mhz: 48`.
- [x] every number checked against the RM's own worked example (`:4048` USBFSSRC, `:4055-4077`
      USBFSDIV=0111 → /10). All **sixteen** dividers are modelled, including the 7.5 the board's
      block omitted
- [ ] the remaining three PLLs (ETH 500, USBSS 125, SerDes) and seven muxes (RNG, I2S2, I2S3,
      LTDC, UHSIF, HSADC, ETH1G)
- [ ] **USBHS_PLL's other three inputs** — blocked, and this is the interesting one. The 480 MHz
      is conditional on `USBHSPLL_REFSEL[1:0]` (`:4266-4274`) matching the real input, and
      `clock.js` returns `output_mhz` unconditionally, so HSE (editable 4–25 MHz, no REFSEL code
      below 20) and SYS_PLL/N would print a number the silicon may not produce. Only HSI is
      shipped, because it is `fixed: true` at 25 MHz and REFSEL=00 is then always right. §3
      REQUEST to AGENT-2
- [ ] **a mux entry that carries its own divider** — LTDC's choice 01 is "SERDES_PLL clock
      divided by 2" (`:4085-4089`), not a bare source. Four of the seven remaining muxes need it
- [ ] `sysclk.sources` listing all seven `SYSPLL_SEL` allows (it lists three; USBHS_PLL could be
      added now that it computes)
- [ ] `tests/clock_ui.test.js`'s sweep and planted breaks cover the new controls on all five parts

### E — the per-instance init struct  (2 mechanism, 1 data)

**Mechanism landed** (`096daa6`): one struct filled per instance, applied by a call that takes the
instance, with the FUNCTION and the HANDLE varying independently — `TIM_OC1Init..OC4Init` keep the
handle, `LTDC_LayerInit(LTDC_Layer1, &s)` keeps the function. 16 tests, each with its failing half.

**Consumers emit:** TIM PWM on four parts, six `channel_params.channels` maps each derived from
*that part's own* `ChannelN` rows and asserted back against them (`74a1e12`); CH32H417's two LTDC
layers, sixteen members each, the pixel format moved *into* the layer struct and the round-5 "your
layer init applies it" comment gone; CH32L103 CMP1–3 through `OPA_CMP_Init` with `CMP_NUM` fixed by
`const:` (`4b43cbd`), which closed F. `USART_ClockInit` landed as data on CH32V003 — **the blocker
was not real**, and had cost a round; a struct all of whose params carry a `when:` was already
emitted on the gate. *A blocker nobody has re-read is a guess too.*

- [ ] `--strict` exit 0 on every fixture **throughout** — holding; re-check each cycle

### F — CH32L103 and CH32V003 at 0 open rows  (1) — **COMPLETE**

12 → 0 and 3 → 0; `coverage.py --quiet` prints six zeros, verified in a clean clone at
`origin/main`. Both compiled rather than asserted: `pio run` SUCCESS on CH32L103K8U6 with CMP2 and
CMP3, and on CH32V003F4P6 with USART1 synchronous on PD4.

L103 surfaced two defects shipping since the part landed, both invisible because **no fixture ever
switched a comparator on**: no `CMP_InitTypeDef` in `codegen.init_structs`, so CMP1's params were
filled in and then followed by `/* TODO: nothing applies this struct */`; and no comparator had a
`CMP_NUM` row, which was right for CMP1 **by accident** (`CMP1 = 0`, struct zero-initialised) and
would have made CMP2 and CMP3 configure CMP1.

### Housekeeping

Closed: `gen_h417_peripherals.py` writes LF · `validate_mcu.py` refuses a duplicate YAML key
(`:762`) · the two stale comments in `app/`.

- [ ] the 4 QFN68 default collisions closed and `COLLISION_CEILING` at 0-0-0 — **waited three
      rounds** (1). **Two of them are probably UHSIF's 49-pad claim**, which ignores `width_bit`
      (see §4 AGENT-1); that needs the pad table behind the UHSIF PDF. `FMC_A11`/PB11, `FMC_A12`/PB12, `UHSIF_PORT3`/PB0, `UHSIF_PORT4`/PB1; all cases
      where a signal has few pads to move to. The fix is the pin order in the generator
- [ ] CH32X035's remaining `params:` — an `IN_EXTRACTION` entry with a live `TASKS.md` line (1)
- [ ] §5 run end to end, QA-PASS posted with what failed (3)
- [ ] §1 and `PROGRESS.md` re-measured each cycle, never asserted (3)

---

## 3. Open cross-agent requests

Answer one addressed to you **before** picking up new work. Unanswered for two of your cycles it
becomes your decision: post `DECISION | (unanswered) …` and implement the least-invasive version.

| Posted | → | What |
|---|---|---|
| 09-12T19:38Z | 2→1 | **H417's `clock.plls:` block**, with the three errors `validate_mcu.py` raises on it today and an RM line per field |
| 09-12T23:04Z | 3→2 | **the layout is not tolerant of its own font fallback** — `#mcu-meta` needs 181px in a 168px box on Linux. It ellipsises by design so nothing fails, but the user sees less than intended |
| 09-13T00:33Z | 1→3 | `tests/h417_packages.test.js:222-227` names the four QFN68 collisions by a **setting label the data no longer uses**. The count is right, the label is stale |
| 09-13T00:33Z | 1→3 | the expiry planted break's cell count is **capped at 40 by `assert.empty`** — a display limit, not a count |

---

## 4. The agents — brief, IN FLIGHT, last cycle

**IN FLIGHT** is written *before* you touch a file, in the same edit as the `TASKS.md` claim,
updated as you go, cleared in the commit that finishes. **Current** is rewritten at the *end* of a
cycle. `agents/README.md` §2a is the protocol. If another agent's IN FLIGHT looks stale, post a
`NOTE(→AGENT-n)` — do not clear it silently.

<!-- AGENT-1 -->
### AGENT-1 — DATA

Owns `data/mcus/**`, `data/packages/**`, `data/sources/**`, `data/coverage/**`, `data/FORMAT.md`,
`tools/extract_*.py`, `tools/gen_*.py`, `tools/validate_mcu.py`, `tools/coverage*.py`,
`tools/ledger.py`.

**The ledger comes before any hardware fact** (`docs/COVERAGE.md`). Take the first open row, open
the cited line, model it **through the part's generator, never an ad-hoc script**, or declare it
with a `file:line`; rerun. `open_rows:` may only go down.

**The sources: Markdown first, PDF last.** The conversion in the part's `Datasheets/` folder is
what you read — it greps, it diffs, it can be cited by line. Open the PDF only when the markdown
**cannot** answer: missing, unreadable, or demonstrably incomplete. "The PDF is clearer" is not a
reason. The protocol is `data/sources/README.md` — a `PDF FALLBACK:` line saying why, recovery by
script checked against numbers the datasheet states elsewhere, and the recovered cells written back
so the PDF is read once. New tools default to the markdown through `tools/source_docs.py`.

- **P0** — C's 35 `params:` cells, worst-first. Every parameter is `struct:`+`sdk_field:`, or
  `sdk_call:`+`sdk_args:`, or `sdk_none:`+`sdk_note:`, traced to `ch32h417_*.h`. **A name nobody
  compiled is a guess.** Through `peripheral_extras.yaml` only — `--splice --refresh` discards a
  hand edit, which undid a fix within a day this round.
- **P1** — D's data half, the cycle §3's REQUEST is answered.
- **P2** — the four QFN68 collisions; MEU6/WEU6 (the DS contradicts itself 3 sources to 1 — settle
  it with a citation); the dual core (`mcu.core` is one string, PlatformIO ships `_V3F`/`_V5F` —
  decide what a generated project targets, say it in the notes).
- **Idle** — §7 DATA, and the ledger on any part not at 0.

**Two things the ledger cannot see, and you own the fix:** `status: complete` is "every datasheet
fact is accounted for", not "the part is done". And a `disagreements:` entry is an **unresolved**
fact — the SerDes TX/RX pairs are recorded both ways because the DS says both; the app routes one.
Say which, in the notes.

**IN FLIGHT** — CH32H417 `params:` worst-first: SERDES, then QSPI1/QSPI2, SDMMC, SAI, PIOC.
- TASKS.md line: `- [~] (AGENT-1) CH32H417: params: for the peripherals that have none.` (line 983)
- Doing: confirmed all five targets have real SPL drivers in `Peripheral/inc`
  (`ch32h417_serdes.h`, `_qspi.h`, `_sdmmc.h`, `_sai.h`, `_pioc.h` — unlike UHSIF). Starting
  SERDES: `SDS_CFG_TypeDef` applied per controller via `SDS_Config(SDSx, &cfg)`
  (`ch32h417_serdes.h:62-81`) — two independent register blocks `SDS1`/`SDS2`
  (`ch32h417.h:1827-1828`) behind the one differential pad set already routed, which is
  `channel_params.instances` (E's mechanism), not a flat `params:` block.
- Files touched: none committed yet.
- Next step if I stop here: write SERDES's `channel_params` block into
  `data/sources/H417/peripheral_extras.yaml` (extras.SERDES.yaml), citing
  `CH32H417RM.md:23785-23864` (R32_SERDESx_CTRL bit table) and
  `Evt/EXAM/SerDes/FullDuxTrans/Common/hardware.c:88-138` (the two-instance TX/RX example),
  then `python tools/gen_h417_peripherals.py --splice --refresh --dry-run` to check, then for
  real, then `validate_mcu.py` + `verify_sdk_names.py` + `coverage.py CH32H417`.
- Gates last run: `validate_mcu` 0 · `verify_sdk_names` 0 · `coverage --gate` 6 of 6 ·
  `validate_clock_selftest` 11/11 · `validate_params_selftest` 5/5 · `verify_sdk_names_selftest`
  35/35 + 3 · `--strict` 0 on all 8 fixtures · `pio run` **SUCCESS** on CH32H417QEU6 with UHSIF
  Master / Mapping 2 / Mapping 1 / /4 / 32-bit. (baseline before this cycle's edits)

**Current — 2026-09-13T02:00Z. UHSIF, and it is not shaped like the other 34.**

- **Its driver is not in the SPL.** There is no `ch32h417_uhsif.h` in `Peripheral/inc`: UHSIF
  ships as a prebuilt **`libUHSIF.a`** with its header beside it in an example folder. The API is
  one five-argument call, `UHSIF_GPIO_Init(mode_select, port_rm, clk_rmm, clk_div, width_bit)`
  (`ch32h417_uhsif.h:181`), not an init struct. Five `params:` rows, every value read out of the
  header rather than typed — the 64 `RCC_UHSIFDIV_DIV*` options are generated from
  `ch32h417.h:7920-7983`, so the list cannot acquire a typo.
- **`verify_sdk_names.py` had to learn about driver headers outside `Peripheral/inc` first**, or
  every `DEF_UHSIF_*` name would have been reported non-existent and the cheap way out would have
  been to leave UHSIF unmodelled — a peripheral holding 49 pads and reaching no generated code.
  **My first version of that rule matched 711 directories**, because every example ships
  `main.h`/`main.c`; that would have let a stale example header vouch for a macro the SPL had
  removed. Narrowed to "a header beside a prebuilt `.a` that follows the SPL's own `<prefix>_*.h`
  naming" — **5 directories** — and the selftest now asserts both halves as invariants over every
  indexed folder, each seen red under a deliberate re-widening.
- **`check_param_list()` was never called for `peripherals.*.params`.** Its own docstring has said
  "Shared by `peripherals.*.params` and `dma.channel_params`" since it was written, and there was
  one call site, for DMA. So **every `params:` row on every part has been unchecked** — a missing
  `default:`, a `default:` naming something that is not one of its own options, a duplicate `key:`,
  a `min` above its `max`. I found it by writing `default: 0` where the options are named
  "Slave, FPGA" / "Slave, SOC" / "Master" and watching **every gate pass**. Wiring it up found one
  more on shipped data: `CH32V003.USART1.ck_enable` carried `const:` **and** `default:` with the
  same value — a surviving mirror from the round-5 workaround. `tools/validate_params_selftest.py`,
  5 planted breaks plus the positive half.
- **A `const:` row legitimately has no `default:`**, and the newly-wired check accused 25 correct
  rows (I2S2/I2S3/SDIO/SWPMI, CH32L103's three comparators) before that was taught to it. A check
  being new does not make the data it accuses wrong.
- **The defect UHSIF's own data cannot fix, demonstrated twice.** `Mode: Enabled` claims **all 49
  pads regardless of `width_bit`**, so an 8-bit bus still takes 32 data pads it does not use and
  cannot release. Enabling UHSIF on the QFN128 fixture produces **5 unresolved conflicts** and on
  QFN68 **10** — it cannot be switched on in either shipped fixture. **This is very likely two of
  the four QFN68 collisions `COLLISION_CEILING` has carried for three rounds.** The fix needs the
  per-mapping, per-width pad table, which is in a PDF with no markdown conversion, behind a
  binary driver. Not guessed. FINDING + TASKS line.

Red, and who owns it: **nothing.** Compiled rather than asserted: `pio run` SUCCESS, and
`--strict` is 0 on all eight shipped fixtures (it exits 2 on a hand-made UHSIF-on project, because
those 49 pads have no `af:` and nothing declares them dedicated — recorded, pre-existing, now
reachable).

**Current — 2026-09-13T01:14Z and 01:52Z, two cycles. D's schema, then D's number.**

- **The schema half** (`90dadb5`): `validate_mcu.py` takes `plls:`, a list `source:`,
  `default:`/`default_source:` and refuses a PLL input cycle; `data/FORMAT.md` gains `### plls:`;
  `tools/validate_clock_selftest.py` plants eleven breaks, all caught, **plus the positive half**
  the sibling self-tests do not have — a correct block that must validate clean first, because a
  check that refuses everything passes a planted-break sweep exactly as well as one that works.
- **The number, and why it is not shipped** (this cycle): `USBFS = 48 MHz`, from `clockCalc()`
  with the block in the real file, and it moves when either axis of the mux moves — so the data
  is right. **The clock TAB cannot draw a second PLL**: `legibility.test.js` measures 1095px
  painted into a 1024px viewport at 1280×720 @125%. I measured it three ways before believing
  it — with the tap, with shorter labels (no change; it is a structural column, not text), and
  with the tap removed and only the PLL left (still 1095px). **No data-side edit avoids it**, so
  I reverted rather than ship a red `main`, and parked the proven block in
  `agents/proposals/CH32H417_usbhs_pll.yaml` with all three measurements on it.
- **The thing worth keeping:** AGENT-2 verified this schema in a browser at exactly these eight
  combinations and reported it green — on a SYNTHETIC part. `legibility.test.js` sweeps only
  SHIPPED parts, so the first real consumer of the schema is the first thing to test it, and it
  did not fit. A gate that covers six parts and not the seventh you are actually developing
  against is the round's own rule, one file over.
- **I read every RM line the 19:38Z request cited before writing any of it, and three things were
  wrong with it.** The USBFSDIV list was short by one — sixteen codes, sixteen *distinct*
  dividers, **7.5 (code 1110)** missing, which would have shipped an unreachable divider. The RM
  contradicts *itself* on USBFSSRC=1 (prose `:1811-1813` "USBFS_PLL" vs register table
  `:4048-4050` "USBHS_PLL"; no USBFS_PLL exists elsewhere) — register table followed, both
  recorded. And **`USBHSPLL_REFSEL[1:0]` makes the 480 MHz conditional**, which is why USBHS_PLL
  ships with one input instead of four.
- **The decision worth recording:** the request was pasteable and I did not paste it. `output_mhz:
  480` with all four inputs would have printed 48 MHz for an HSE the user set to 8 MHz — legal on
  this part, no REFSEL code for it, PLL will not lock. Shipping only HSI is round 5's rule applied
  literally: *every choice the app offers must be one the silicon can honour.* The other three are
  declared beside the block with the line that blocks each.
- **And one about our own tooling** (FINDING to AGENT-3): a find/replace self-test anchor with no
  line boundary matches *inside* a longer line — `"  prescalers:"` inside `codegen.rcc`'s
  four-space one, `"      default: 10"` inside `"        default: 100000"`. Both mutated something
  unrelated, left the real target untouched, and the case printed **OK** over a file that was
  never broken. My runner now requires each anchor to occur exactly once and the mutation to
  change the text, and I planted a non-unique anchor to watch that guard fire before trusting it.
  `validate_constraints_selftest.py` and `validate_afmux_selftest.py` have the same shape and
  neither guard; they are AGENT-3's and I did not touch them.

Red, and who owns it: **nothing.** Numbers: §1, unchanged except the clock row — ledger still
0/0/0/0/0/0, `params:` still 35 owed, collisions still 4/0/0. Nothing closed by lowering anything.

**The three findings in full, with the lines, as posted to the board at 01:14Z:**
1. **The USBFSDIV option list is short by one.** `CH32H417RM.md:4055-4077` gives sixteen codes and
   **sixteen distinct dividers** — 0000:1 0001:2 0010:3 0011:4 0100:5 0101:6 0110:8 0111:10, then
   1000:1.5 1001:2.5 1010:3.5 1011:4.5 1100:5.5 1101:6.5 **1110:7.5** 1111:9.5. The request lists
   fifteen and calls them "the sixteen codes", missing **7.5 (code 1110)**. Shipping its list
   makes one divider unreachable — the dead-option shape, one field over.
2. **The RM contradicts itself on USBFSSRC=1.** The prose at `:1811-1813` says "the **USBFS_PLL**
   clock"; the register bit table at `:4048-4050` says "1: **USBHS_PLL** clock". There is no
   USBFS_PLL anywhere else in the RM. Following the register table — it is what the software must
   name — and recording both, averaging neither.
3. **`USBHSPLL_REFSEL[1:0]` is not modelled and it is load-bearing.** `:4266-4274`: "USBHS_PLL
   reference clock frequency selection, writable only when USBHS_PLLON is 0: 00: 25MHz, 01: 20MHz,
   10: 24MHz, 11: 32MHz", and the prose at `:1808` says "the clock frequency **must match** the
   USBHS_PLL input clock". So **480 MHz is conditional**: pick HSE at 25 MHz with REFSEL saying 20
   and the PLL does not make 480, so USBFS does not make 48. `output_mhz: 480` with no REFSEL
   would have the app print 48 MHz unconditionally — *a computed number that is wrong is worse
   than a missing one*, which is AGENT-2's own rule for this deliverable.
4. Minor, recorded so nobody greps for it: the RM spells USBHSPLLSRC 01 as "**HIS**" (`:4288`),
   a typo for HSI. And `USBSSPLL_REFSEL[1:0]` at `:4245` occupies **`[6:4]`** with **eight**
   documented values — the name's `[1:0]` contradicts its own bit range; three bits is right.

**Current — cycle 6, 2026-09-13T00:33Z. The peripheral map is measured, and measuring it found
generated C that could not have run.**

- **`I2S2` and `I2S3` had NO bit in `codegen.periph_clock` at all.** Switching either on emitted
  `I2S_Init(SPI2, &s)` under a comment saying no clock enable was written. It compiled, `--strict`
  exited 0, `validate_mcu`/`verify_sdk_names` were at 0 and `coverage.py` said 0 open — because
  **not one of them asks, peripheral by peripheral, whether the clock gets turned on.** The I2S is
  a MODE of the SPI block and shares its gate, which is what the EVT does one line above its own
  `I2S_Init` (`.../DFSDM_I2S_Audio/Common/hardware.c:103`, beside `:111`).
- Three more clock cells declared **by address, not by analogy** (`ch32h417_rcc.h:230-307` is 73
  macros and none of the three is in it). **`RTC` I did NOT close:** its gate is TWO bits and
  `bits:` maps one peripheral to one bit — **`BKP` alone would have ticked the cell and shipped a
  half-enable that reads exactly like a whole one.**
- Earlier cycles: `params:` 65 → 39 · **F closed, both parts** · E's data half (six `channels:`
  maps, LTDC's two layers).
- **The near-miss:** `--splice --refresh` silently reverted an ETH commit written into the
  generated block. The loss guard caught the notes and the pads and refused to write; it said
  nothing about the choice row, because `_losses()` compared peripherals, signals, routed pairs and
  remaps and **not choice lists**. It compares choices now, planted and seen red.

Red, and who owns it: **nothing.** Numbers: §1. Nothing closed by lowering anything.
**Next:** the 35 cells, UHSIF first; FMC/ETH/ECDC/NAND/SDRAM stay blocked on §3's REQUEST; then the
QFN68 collisions and the secondary PLLs.
<!-- /AGENT-1 -->

<!-- AGENT-2 -->
### AGENT-2 — APP

Owns `app/engine/**`, `app/template.html`, `app/tests/**`, `app/assets/**`, `build.py`,
`tools/wchcube_cli.js`.

**The rule you consume:** *every choice the app offers must be one the silicon can honour.* The
data says what the silicon allows; the engine refuses what it does not; **a computed number that is
wrong is worse than a missing one.** Every new clock tap ships with its number checked against the
RM's worked example, or it does not ship.

- **P0** — ~~the nested-struct shape (§3, 19:33Z)~~ **done this cycle.**
- **P1** — ~~D's remaining acceptance: the layout that blocked a shipped USBFS 48 MHz~~ **fixed
  this cycle.** The number itself is still AGENT-1's data commit, not an engine gap any more.
- **P2** — the font-fallback layout finding (§3, 23:04Z); `sdk_none:`'s emitted prefix, *"the SDK
  exposes nothing for it"*, which is wrong for the LTDC pixel format where the SDK exposes a setter
  that is unsafe at init — a `sdk_manual:` key emitting `"set by firmware: <note>"` would say the
  true thing; USBHS_PLL's other three inputs and the mux-with-its-own-divider shape (§2 D, both
  REQUESTs from AGENT-1, 01:14Z) — read before starting either.
- **Idle** — §7 APP, then the standing task: read `codegen.js` end to end for an assumption that
  only holds for the parts that existed when it was written. Seven findings from the last such read
  are in §7; the first is fixed, the rest recorded rather than guessed at.

**IN FLIGHT** — nothing.
- TASKS.md line: — · Doing: — · Files touched: —
- Next step if I stop here: P2 above — the font-fallback finding, or the two USBHS_PLL/mux
  REQUESTs once AGENT-1 answers whether they are still wanted now that D's layout blocker is gone.
- Gates last run: see Current below, at the tree's HEAD this cycle produced.

**Current — 2026-09-13. P0 and P1, and both were "make the trap actually impossible", not "make
the symptom go away".**

- **P0, the nested-struct shape (`codegen.js` `initPlan()`/`periphBlock()`).** The case is
  `ch32h417_fmc.h:113-115`: `FMC_NORSRAMInitTypeDef` has two members, `FMC_ReadWriteTimingStruct`
  and `FMC_WriteTimingStruct`, both `FMC_NORSRAMTimingInitTypeDef*`, and no SDK function takes the
  inner struct alone. Before this, `initPlan()` grouped params by `struct:` name only, so both
  pointer members' params merged into ONE block with no `fn:` — a TODO, and `--strict` exit 2 — but
  worse than the TODO: nothing stopped a *different* MCU file (any future data, not this session's)
  from shipping the OUTER struct's own params without either timing block ever resolving, which
  compiles and is a **null read at init**, because `FMC_NORSRAMInit()` dereferences
  `FMC_ReadWriteTimingStruct` unconditionally. That is the trap AGENT-1 recorded, and "emit a TODO"
  alone does not close it — the outer struct's `fn:` still applies with the pointer at `{0}` the
  moment the TODO is fixed by deleting rather than resolving it.
  The shape: a param carries `embed: <key>` beside its `struct:`, and
  `codegen.init_structs.<inner-struct>.embed.<key>: { into: <outer-struct>, member: <ptr-field> }`
  says which pointer member receives `&<the inner block's own C variable>`. Two params naming the
  SAME struct TYPE but different `embed:` keys now become two SEPARATE blocks (`initPlan()` groups
  by `struct: + embed:`), each with its own variable name (`blockVarName()` suffixes by the embed
  key, since `structVar()` alone would give RW and WR the same name). `periphBlock()` emits an
  embedded block and the block it points into inside ONE shared `{ }` C scope, child(ren) first —
  not each in its own scope, which is how every OTHER struct block is emitted, and would leave
  `&FMC_NORSRAMTimingInitStructure_rw` pointing at a variable already out of scope when
  `FMC_NORSRAMInit(&FMC_NORSRAMInitStructure)` reads it. Resolution runs once, after every block
  has all its fields, so it does not matter which order the MCU file states RW/WR/outer params in.
  An `embed:` key that does not resolve is a named TODO on the INNER block — never a silently unset
  pointer on the outer one — so `--strict` refuses it rather than shipping the trap under a
  different name. `WriteTimingStruct` is conditional (only when the data's `when:` says Extended
  Mode is on) and simply produces no block at all when its params do not apply, which is correct:
  the SDK only reads it under that mode.
  8 tests, `app/tests/nested_structs.test.js`, run `node tests/run.js "nested_structs"`. The
  planted break that matters most is not a data typo I invented — it is the mechanism itself:
  `git stash` the two changed engine files back to the tree's state before this cycle (`e25ba30`)
  and re-run the same suite: **7 of 8 red**, including the exact trap ("the outer member was never
  assigned" / TODO absent where it should be present) — restored, all green again. Verbatim RED is
  in this cycle's own terminal output, not re-typed from memory. Existing mechanisms unaffected:
  `app/tests/instances.test.js` (E, per-instance blocks) 16/16 still green, `app/tests` full sweep
  501/501, `strict`/`codegen`/`codegen_compile` (incl. both CH32H417 fixtures) all green — no `pio
  run` regression on real silicon.
  **Data-side contract, for AGENT-1**, posted with a worked `FMC_NORSRAMInitTypeDef` example to
  `agents/BOARD.md` and this cycle's `TASKS.md` entry. FMC, ETH, ECDC, FMC_NAND, FMC_SDRAM
  unblocked — none of the five was started or checked for the SAME shape twice, so read the BOARD
  post before assuming they nest identically.

- **P1, the clock tab's second-PLL layout (`app/template.html`, `renderClock()`, "measure, place,
  connect").** Read `agents/proposals/CH32H417_usbhs_pll.yaml` first, as asked. Reproduced AGENT-1's
  measurement before touching anything: spliced the proposal's `plls:`/`prescalers:` block into a
  COPY of CH32H417's `clock:` at runtime — `registerMcuFile()` in a real, `python build.py`-built
  `dist/index.html` opened in headless Chrome via `tests/lib/browser.js` (CDP, no jsdom — jsdom has
  no layout engine and cannot see this at all, which is on record as how this defect survived to
  round 6 in the first place) — never written to `data/mcus/CH32H417.yaml`. **Before:** 1280×720
  @125% (1024 CSS px viewport), rightmost `.cnode` edge at **1105px, 81px over** (AGENT-1's own
  three measurements said 1095px/71px on a slightly different synthetic splice point — same
  phenomenon, confirmed independently).
  The cause: `renderClock()`'s placement pass laid every column onto ONE row and, once shrinking
  hit its floor (`SCALE_MIN = 0.78`, there so a `<select>` and a "min/max MHz" line stay readable),
  left the remainder to `.ctreescroll`'s `overflow-x:auto` — visible only by scrolling, which
  `legibility.test.js` rightly does not count as "fits" (nor should a user have to). A second PLL
  adds a whole COLUMN (`COL.pll2`), never more nodes packed into an existing one, so six columns —
  the schema's worst case on any part it can describe today, since further PLLs and taps stack
  vertically WITHIN a column rather than adding columns — is the fixed ceiling this had to solve
  for, not just this one part.
  The fix: columns now pack onto ROWS. Same shrink pass as before (unchanged), then a greedy
  left-to-right pack of columns into the room the panel actually has; a column never splits across
  a row (every node in it keeps the neighbours its edges already point at); wrapped rows stack
  underneath with a gap. The single-row case is not a special branch — the row-packing algorithm
  degenerates to the exact original width/height formulas when everything already fits one row (a
  column-by-column derivation is in the commit), which is why every shipped part's layout is
  provably unchanged rather than merely "still green": `legibility.test.js` and `layout.test.js`
  are byte-for-byte the same suites, unmodified, and both pass, because none of the six shipped
  parts has `plls:` yet — this is D's own rule (a computed number checked against a worked example)
  applied to a LAYOUT number instead of a clock one.
  **After**, same splice, same viewport: rightmost edge **898px, 126px of margin**, 0 overlaps
  (measured pairwise over every `.cnode`), console silent, `USBHS_PLL_CLK` reads **480MHz**,
  `USBFS` reads **48MHz** ("must be 48 MHz" — on target, not merely present). Also checked at
  1280×720 @1 and 1920×1080 @1 (both single-row — the wrap only engages at 125%, where it is
  needed) and screenshotted at all three. `python build.py` run twice this cycle (once to pick up
  P0's engine change before measuring the "before" state, once after the layout fix) — told here,
  as the rule asks; no other agent's run should have overlapped it (checked `git status` for a
  concurrent `dist/index.html` diff before each build; none).
  **This is D's layout blocker, not D's data.** AGENT-1's `plls:`/`prescalers:` block for CH32H417
  can now be spliced into `data/mcus/CH32H417.yaml` for real — the worked example above is the
  exact content, unmodified, that was just proven to fit.

Red, and who owns it: **nothing.** Gates run this cycle, each named with its own result:
`node tests/run.js "nested_structs"` 8/8, `"instances"` 16/16, `"app/tests"` 501/501,
`"codegen"` 99/99 (incl. both CH32H417 compile-gate fixtures), `"strict"` 25/25 (incl. both
CH32H417 fixtures), `"legibility"` 8/8, `"clock"` 97/97, `"layout"` 15/15. `python build.py` run
twice, told above. **Not run: the full `node tests/run.js`** — not asked for this cycle, and the
narrow sweep above already covers every suite either change touches.

**Current — cycle 2, 2026-09-12T21:14Z. D's schema is done; E's mechanism is done and its consumers
were data, which AGENT-1 has since landed.**

- **D (`13b948a`)** — the number: **USBHS_PLL 480 MHz → USBFS /10 = 48.0 MHz**, RM 3.4.13, read in
  Chrome at all eight combinations with the console empty. **Which taps compute on a shipped part:
  still none new** — CH32H417 declares no `plls:` yet.
- **E (`096daa6`)** — I generated the eight `channels:` maps from each part's own settings and read
  the C **before** asking for them: `TIM_OC1Init(TIM1, &s)` with `TIM_Pulse = 500`, nothing for the
  input-capture channel, nothing for the two at Disable, no TODO. A test asserts all eight are still
  silent, so it goes red the day one lands and **cannot outlive the gap it records**.
- **`paramReachWarnings()` counted a `const:` member and the inapplicable half of a dependent pair
  as "the user changed it"**, and `--strict` exits 2 on a warning — a *disabled* ADC1 failed the
  gate. Fixed with the table's own two predicates, both clauses seen red (`6645e38`).
- Two `app/tests/export.test.js` tests enumerating the output and option lists were red after
  `BoardPins.h` landed without them. Each now moves **one switch at a time**, so a list that changed
  for two reasons cannot still look right (`724334d`).

Red, and who owns it: nothing. **The hazard from my side, for everyone: a half-saved engine module
takes the whole CLI down, because `tools/wchcube_cli.js` reads `app/engine/*` off disk. Write the
import before the body that uses it.**
<!-- /AGENT-2 -->

<!-- AGENT-3 -->
### AGENT-3 — QA + RELEASE

Owns `tests/**`, `tests/evidence/**`, `src-tauri/**`, `data/firmware/**`, `.github/**`,
`scripts/**`, `README.md`, `PROGRESS.md`, `Taskfile.yml`, `agents/**`. May add tests anywhere; may
only ADD to `app/`. **You are the only agent who ticks a §2 line, and only on something that runs.**

**The standing rule:** *a check nobody has seen go red is not a check.* Your own duplicate-key
detector caught two bugs **in itself** through its planted break before it caught anything in the
tree. That is the discipline working, not failing.

- **P0** — watch `main` stay green across other agents' commits; three in a row from different
  agents and `worktrees ON` goes up.
- **P1** — the planted-break sweep over `app/tests/**`. A red found in `app/` or `data/` is a board
  entry for its owner, never a fix by you.
- **P2** — §1 re-measured every cycle; §5 run end to end before any `ROUND 6 DONE`; `src-tauri` has
  not been relinked since round 4 and `cargo build` green is not a window opening; and the pack —
  run the stale-pointer grep each cycle (`Agents Rounds`, `agents/Update`, `run_round`,
  `PROMPT_AGENT_`, `AGENT_1_DATA`, `AGENT_2_APP`, `AGENT_3_QA_RELEASE`, `DONE.md`, `PROJECT.md`,
  `HUMAN_TODO`, `BACKLOG.md`, `run_agents.ps1`, `Prompt.txt`); a hit outside `history/`, `BOARD.md`
  and `tests/evidence/` is a live pointer at something that no longer exists.
- **Idle** — §7 QA/RELEASE.

**IN FLIGHT** — B's remaining half: the planted-break sweep over `app/tests/**`, plus the three
findings addressed to me in §3 and at BOARD 01:14Z.
- TASKS.md line: "Deliverable B's remaining half - the planted-break sweep over `app/tests/**`"
  (+ the two beside it: the self-test anchor guard, and the two stale readings in `tests/`)
- Doing: `tests/lib/enginemutant.js` — one mutation into a COPY of `app/engine/` under a junctioned
  ROOT, the mutated engine run under one `app/tests/*.test.js` file in a child process, restore,
  re-prove green. **The tree is never touched and `app/` is never written.**
- Files touched: `TASKS.md`, `agents/STATUS.md`, `tests/lib/enginemutant.js`,
  `tests/app_tests_planted.test.js`, `scripts/plant_app_tests.js`,
  `tests/evidence/round6/2026-09-13-app-tests-planted-breaks.md`,
  `tools/validate_constraints_selftest.py`, `tools/validate_afmux_selftest.py`,
  `tests/h417_packages.test.js`, `tests/completeness.test.js`
- Next step if I stop here: run `node scripts/plant_app_tests.js` — it prints one row per
  `app/tests/*.test.js` file (CAUGHT / MISSED / COULD-NOT-RUN) and writes the verbatim red into
  the evidence file. Then the same for any file whose row is not CAUGHT.
- Gates last run: see §1, at `2b1967d`.

**Current — 2026-09-13. The pack is three files, and a stopped session is now resumable.**
`README.md`, `STATUS.md`, `BOARD.md`; the eight superseded files archived whole under
`history/round6-pack/` with a README mapping each to where its content went. §4 gained the IN FLIGHT
block, because until now the only per-cycle writing happened at the *end* of a cycle and an agent
that stopped mid-task left nothing. Swept every live `.md` for stale pointers: `PROGRESS.md` §3/§4
were still round 5, its §1 quoted the first green CI run as the literal string `%s`, and
`tests/source_order.test.js` required `agents/PROMPT.txt` — already deleted, so that gate was red.

**Before that, cycle 1 — CI is GREEN on all three jobs, the first time in this repository's
history.** Run 34723740365 on `b5a654f`. **The round's rule turned out to be true of the round's own
first deliverable:** everything said CI had never executed; it had run 31 times and failed every one
— worse than never run, because it had been guessed green for a day. Almost nothing was wrong with
the code; what was wrong was the ability to see. **Nothing was weakened to make anything pass:** a
stale `dist` shipped twice by data commits that did not rebuild, and a third time **by me**, one
commit after reporting it, by building from a clean clone at a SHA four commits had already
overtaken.

**NOT claimed:** `worktrees ON` is not posted. The hardware line still reads **"builds, not
flashed"**. `src-tauri` has not been relinked since round 4.
<!-- /AGENT-3 -->

---

## 5. Acceptance — the script that closes the round

Runnable by someone who did not write it; every step is a thing you **see**. AGENT-3 runs it end to
end before posting `DECISION | ROUND 6 DONE`, which requires §5.1–§5.6 green. §5.7 is not a blocker
— it is the honest statement of what remains, and must still be there when the round closes.

**§5.1 CI has run, and somebody read it**
1. The Actions tab has a completed `ci.yml` run on `main` — the run page, not a badge, three jobs.
2. The `firmware` log shows the compile gates reporting an actual **ok**, not a skip reading "pio
   not on PATH". No skip reason in the summary may be "PlatformIO is not installed".
3. The `Coverage ledger` step prints `6 of 6` **on the runner**.
4. `PROGRESS.md` quotes the run URL and no longer contains "never run in CI".
5. `BOARD.md` has `DECISION | worktrees ON` posted **after** step 2's run.

**§5.2 every gate has been seen red**
6. `tests/evidence/round6/` holds one file per planted break with the red output verbatim and the
   restore. Open two at random: the assertion text names the thing that was planted.
7. `node tests/run.js "can actually fail\|planted break\|can go red"` — every suite named in §2 B
   has a hit and every hit is `ok`.
8. The board carries the gates-that-cannot-go-red list by name. **The acceptance is that it is
   empty.**

**§5.3 CH32H417's Parameter Settings are not empty**
9. New project → CH32H417 → QFN128. `ADC1`, `CAN1`, `DAC`, `FMC` each show a Parameter Settings tab
   with real rows. No CH32H417 `IN_EXTRACTION` entry, and the `TASKS.md` line ticked.
10. `FMC`, `Bus mode: 8080 LCD, 8-bit` shows the `FMC_NORSRAMInitTypeDef` timings. Generate: the C
    carries `FMC_NORSRAMInit(...)` with those values and **no TODO**.
11. `python tools/verify_sdk_names.py` → 0 errors.

**§5.4 the clock tab computes what it used to declare absent**
12. CH32H417: a `USBHS_PLL` box with its own source mux and multiplier, and a `USBFS 48M` tap with a
    source select offering the choices RM 3.4.13 gives it.
13. `USBHS_PLL / 10` → the tap reads **48 MHz**. Change the multiplier; the number moves.
14. Save, reload, reopen: the mux choice comes back. Undo, redo: it moves and moves back.
15. On CH32V006 the clock tab is **unchanged** — one PLL, no mux selects, no new controls.

**§5.5 the per-instance struct emits**
16. CH32H417, LTDC on, both layers' formats set. Generate: two `LTDC_Layer_InitTypeDef` blocks and
    `LTDC_LayerInit(LTDC_Layer1, ...)` / `(LTDC_Layer2, ...)`.
17. CH32L103, CMP1 on. Generate: `OPA_CMP_Init(&s)` with `s.CMP_NUM = CMP1` fixed by `const:`.
18. `node tests/run.js "strict"` — all `ok`.

**§5.6 the ledger**
19. `python tools/coverage.py --quiet` prints **six zeros**, all six `complete`.
20. `python tools/coverage_selftest.py` → all planted breaks caught, count printed.

**§5.7 what is still not true**
21. **Nothing has been flashed.** §1 and `PROGRESS.md` read **"builds, not flashed"** in exactly
    those words and §6 item 8 is still there. If anyone rounded this up, this step catches it.
22. **`src-tauri` unverified in a window** unless §6 item 7 has a reply, and no board entry claims
    the desktop path is verified.

Verdict: `<UTC> | AGENT-3 | QA-PASS | acceptance run end to end. §1 n/n, §2 n/n, … What failed: … (or "nothing").`

---

## 6. Only a human can do these

Listed once. **Never re-request one on the board.** If a job fails for a reason only the repository
owner can change, add it here with the exact setting named.

1. ~~Add a git remote and push~~ — **done 2026-09-12.** `origin` is
   `https://github.com/arwidcool/WCH_Cube.git`. Nothing is yours unless a CI run needs a repository
   setting (Actions enabled, a runner minute budget).
2. ~~Rust toolchain~~ — **not needed.** `cargo` 1.98.1 is on PATH. The desktop gap is item 7.
3. **Move the repo off the Google Drive mount.** `npm install` fails there (EBADF) and sync can
   corrupt a half-written `dist/index.html` mid-run. Any local folder works. This is also why the
   suite must be run serially.
4. **Datasheet + RM markdown for the next parts** into `data/sources/`: **CH32V203, then CH32V307.**
   AGENT-1 starts each the cycle it appears. (CH32V003 is done and reads 0 open.)
5. ~~Verify the ch32v00x port-clock spelling~~ — **resolved.** `ch32v00X_rcc.h:157` declares
   `RCC_PB2PeriphClockCmd`, `:88-92` the `RCC_PB2Periph_*` macros, `AFIO->PCFR1` is
   `ch32v00X.h:197`.
6. ~~The ADC internal Vrefint channel~~ — an agent task; the same gap exists on CH32V006 and
   CH32X035, so it is repo-wide rather than a hole in one file.
7. **See the desktop app write a project, and say whether it worked.** `cargo build` is green and
   the Rust tests pass, but the round-4 changes to `write_project` have never been relinked into a
   running exe — the old one was open at the time. Close it, `cargo run`, generate through the
   native folder picker.

---

8. **Flash one generated project.** ← *the only thing here nobody else can do, and the
   highest-value item on the list.*

   `pio run` exits 0 for four configurations across two families and the generated C links — but
   **every green result in this project is a compile.** We do not know that one of these produces a
   chip that starts. With any **CH32V006, CH32V005 or CH32X035 board and a WCH-Link** it is five
   minutes; the generated project exists precisely so that it is:

   ```
   # In the app: pick the part and package, assign one pin as Output Push Pull
   # (the banner names it), then Project Manager -> GENERATE PROJECT. Then:
   cd <the folder it wrote>
   pio run                 # already green - this is what CI proves
   pio run -t upload       # <- THE NEW INFORMATION. Needs the WCH-Link attached.
   pio device monitor      # printf goes over the WCH-Link SDI channel, no pin used
   ```

   **Send back**, either way — a failure is worth as much as a success: the SDI banner text (part,
   package, the SYSCLK asked for, and `SystemCoreClock` read back after init); whether the output
   pin actually toggles; and if it does not start, `pio run -t upload` verbatim.

   **The banner prints two clock numbers and they may differ. That is expected, not a bug:** the
   board file's `SYSCLK_FREQ_*` is applied by `SystemInit()` before `main()`, and the generated
   `WCHCube_RCC_Init()` then overrides it — 24 MHz boots at 48 and drops to 24. CubeMX does the
   same. Seeing both numbers is the point.

   The result goes in `tests/evidence/round6/` and would be **the first hardware result this
   project has**. Until then the line reads **"builds, not flashed"**, in exactly those words.

---

## 7. Backlog — for an agent whose brief is complete

**Idle is not a stop.** Two `IDLE` posts in a row with nothing between means taking an item from
here. Say so on the board and move it into `TASKS.md` — a backlog entry nobody can see is no entry.

### DATA
- Every part whose sources exist in `data/sources/`. **Adding a part should be a data job**; one
  that needs an engine change is a finding worth a board entry.
- `params:` for every peripheral on CH32V006 and CH32X035 — the same class as CH32H417's.
- Per-pin drive strength / input-only / 5 V tolerance **where the DS states them**. The CH32V006 DS
  does not state 5 V per pin, which is why the field is absent there — do not carry it over.
- Interrupt vector tables for parts that lack `nvic:`.
- The constraint mechanism wherever an audit finds an instance. CH32V006 and CH32V005 must be
  **audited either way** — "no instances, checked in RM ch.7" is a result, and it is the one that
  proves the mechanism was not built for one part.
- `data/FORMAT.md` read end to end against what the engine accepts. It is the DATA↔APP contract and
  it drifts silently; `validate_mcu.py` wins when they disagree.
- `WCH-DUMMY32-C8` gets `dma` / `nvic` / `params` / `codegen`.

### APP
- Project diff: two `.wchproj` files → changed pins, settings and clock, readably.
- Pinout SVG export; print view; a KiCad symbol pin CSV.
- Categories / A→Z toggle, expand/collapse all, show-enabled-only in the peripheral tree.
- Accessibility: the tree reachable by keyboard alone (the chip already is), AA contrast in both
  themes.
- **From the last `codegen.js` read-through (2026-09-12), in the order to take them:**
  1. ~~`rccWord()` went silent about a PLL input it had no encoding for~~ — **fixed.** On CH32H417
     that was 32 asked-for clock rates and no bit written to choose between them, in a file that
     read as complete.
  2. **`isFixture()` sniffs the part's NAME and VENDOR** (`/dummy/i` on both). The clean flag is
     `mcu.fixture: true`, which `data/FORMAT.md` must bless and the fixture must carry — a `tests/`
     file, so it is a REQUEST. Two-sided: the flag lands before the sniffing goes.
  3. **`gpioPlan()` drops an `io` pin whose name is not `P<letter><digits>`**, with no TODO and no
     note. Unreachable on all six parts; a seventh would get a `WCHCube_GPIO_Init` quietly missing a
     pin. The fix is a named TODO, not a wider regex.
  4. **`structVar()` assumes every struct typedef ends in `TypeDef`** — one that does not becomes
     `Foo Foo = {0};`, and two such structs on one peripheral would collide inside the block.
  5. **`GPIO_Pin_<n>` is the one SPL macro the generator writes without the data's permission.**
     Right on all six parts, and the kind of thing that is right until the first part that is not.
  6. **The RCC word's gaps are comments; everywhere else in the file a gap is a TODO.** So
     `--strict` cannot see a clock the configuration asked for and the C does not produce. A
     decision rather than a change — the alternative is a red shared tree for every part with an
     unencoded divider.
  7. **`pllsrc` is keyed on the PLL input's SOURCE**, the whole register field on parts with one.
     CH32H417's input is a source AND a divider (`RCC_PLLCFGR` PLL_SRC_DIV) — not a value to fill in
     but a shape `codegen.rcc` cannot express. A FORMAT question.

### QA / RELEASE
- `tests/perf.test.js`: `compute()` under 5 ms and a full render under 100 ms on the largest real
  package. There is a per-test budget today but no perf suite.
- Real-browser screenshots per part × package as CI artifacts; `pio check` in CI.
- The release workflow on tag: build installers, attach to a GitHub release.
- Windows/macOS Tauri jobs now that Linux is green.
- A **hostile** fixture for the engine's edge cases — shorted pins, exposed pad, a peripheral with
  no usable mapping, an out-of-spec clock, a constraint that excludes a pin. `WCH-DUMMY32-C8` is a
  size stress test, not a hostile one.
- Several round-4 board entries cite measurements nobody can re-run; `tests/evidence/` exists to
  prevent exactly that.

### The pack — AGENT-3
- **`agents/proposals/layout-orientation.test.js` is an orphan.** Written for AGENT-4, who no longer
  exists, and never run: every part × package × 4 rotations × mirrored at three widths, 384
  combinations. Either `git mv` it into `tests/` and let it run, or say on the board why not — a
  proposed test nobody owns is a check that reads as done and is not. (`agents/proposals/` also
  holds the CH32X035 DMA derivation, which **is** live: three files in `data/` cite
  `x035_dma_requests.py` by path.)
- `history/round6-pack/DONE.md`'s rounds 1–5 still carry `[ ]` marks and a "15 of 24" count from
  round 3. They are the **evidence record**, not a status — read a line for *how* something closed,
  never for where the project stands. Re-audit or explicitly supersede.
- **When round 6 closes:** copy `STATUS.md` and `BOARD.md` into `history/round6/`, write the round-6
  row in `history/INDEX.md`, and open round 7 by rewriting §2, §4 and §5 **in place**. The live
  files keep their names, so nothing that points at them breaks and there is never a second copy of
  the truth.
