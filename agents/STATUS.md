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
| **Biggest open item** | CH32H417 `params:` — **35 cells owed, 23 routing pins** (§2 C, AGENT-1) |
| **Blocked on one change** | 5 H417 peripherals wait on the nested-struct shape (§3, AGENT-2) |
| **Unverified** | `src-tauri` in a window; **nothing has ever been flashed** (§6) |
| **Next per agent** | 1: UHSIF · 2: the nested struct · 3: `app/tests/**` planted breaks (§4) |

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
| CH32H417 `params:` | **39 of 78 peripherals have a block, 39 do not.** 4 of those 39 are declared ABSENT (SYS, RCC, EXTI, DMA1 — choices, not numbers), so **35 cells are owed, 23 of them routing pins** | count over `data/mcus/CH32H417.yaml` |
| CH32H417, other axes | clock 68 of 78, 9 ABSENT, **1 open (RTC)** · vectors 66 of 78, all 12 without ABSENT — **0 owed** · pins 61 route, 17 `pins: none`, 0 `pins: open`, **0 unreachable routed signals** · codegen reach **0** peripherals hold a pad and reach no code. **Cells 41 → 36** | `tests/evidence/round6/2026-09-13-h417-peripheral-map.md` |
| CH32H417 collisions | **QFN68 4 · QFN88 0 · QFN128 0** (450 claiming choices swept per package) | `COLLISION_CEILING`, `tests/h417_packages.test.js:228` |
| CI | green on all three jobs: run **34723740365** on `b5a654f` | the run page; URL in `PROGRESS.md` §1 |
| CI vs HEAD | pushed through `2b1967d`; **CI has not yet reported on it** | `git status -sb` |
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
| **D** | clock schema holds a second PLL and a per-peripheral mux | 2 schema, 1 data | schema landed; **data open** |
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

**The largest open work in the repository.** 35 cells owed, 23 routing pins (49 at the round's
open). Post the count each cycle.

- [ ] `params:` for every peripheral that routes pins
- [ ] every parameter traced to `ch32h417_*.h`. True of every parameter that exists today, and
      **not tickable until the line above is** — the claim is about all of them
- [ ] `FMC_NORSRAMInitTypeDef` timings, so the 8080 `Bus mode` generates `FMC_NORSRAMInit(...)`
- [ ] the `IN_EXTRACTION` entry for CH32H417 **gone** from `tests/completeness.test.js` and the
      `TASKS.md` line ticked — every remaining cell fails hard from that commit on
- [ ] all of it in `data/sources/H417/peripheral_extras.yaml`, none in the generated block

**Order, worst-first by stranded pads:** UHSIF (49 routed signals), SERDES, FMC, QSPI1/2, SDMMC,
SAI, PIOC, then CAN1–3, DAC, LPTIM1/2, GPHA, RTC.

**Blocked behind one APP change:** FMC, ETH, ECDC, FMC_NAND, FMC_SDRAM. `FMC_NORSRAMInit()` takes
one struct whose two timing members are **pointers** to a second struct (`ch32h417_fmc.h:113-115`)
that no SDK function takes alone, so `initPlan()` gives that block no `fn:` and emits `/* TODO:
nothing applies this struct */`; `--strict` exits 2. Shipping the outer struct alone is **worse** —
`FMC_NORSRAMInit()` dereferences `FMC_ReadWriteTimingStruct` unconditionally, so a zeroed struct is
a null read at init. §3, REQUEST 19:33Z.

### D — a second PLL and a per-peripheral mux  (2 schema, 1 data)

**Schema landed** (`13b948a`): `clock.plls:` as a map of named PLLs, a list-valued `source:` as a
mux, `sysclk.sources` naming a PLL output, PLL-to-PLL inputs resolved in dependency order,
`codegen.rcc.extra:`, and a **named gap in the C** for any mux or PLL the file does not encode.

**Data open.** CH32H417 declares no `plls:` and no list `source:`, so USB, LTDC and ETH compute
nothing on the part that has them.

- [ ] the four secondary PLLs (USBHS 480, ETH 500, USBSS 125, SerDes) and the eight `RCC_CFGR2`
      muxes of RM 3.4.13, modelled and cited by line
- [ ] **USBFS 48 MHz computed from USBHS_PLL / 10 on a shipped part**, read in a real browser — the
      acceptance number (`CH32H417RM.md:4048` USBFSSRC=1, `:4055-4067` USBFSDIV=0111)
- [ ] every new number checked against the RM's worked example. **A computed number that is wrong
      is worse than a missing one** — not ticked on "it computes something"
- [ ] `sysclk.sources` listing all seven `SYSPLL_SEL` allows (it lists three)
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
      rounds** (1). `FMC_A11`/PB11, `FMC_A12`/PB12, `UHSIF_PORT3`/PB0, `UHSIF_PORT4`/PB1; all cases
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
| 09-12T19:33Z | 1→2 | **the nested-struct shape** — a member that is a pointer to a second struct no SDK function takes alone. Five H417 peripherals behind it |
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

**IN FLIGHT** — nothing.
- TASKS.md line: — · Doing: — · Files touched: —
- Next step if I stop here: UHSIF (49 routed signals), through
  `data/sources/H417/peripheral_extras.yaml`, never the generated block.
- Gates last run: `validate_mcu` 0 · `verify_sdk_names` 0 · `coverage --gate` 6 of 6 · suite ALL
  GREEN 780 — at `116ca16`.

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

- **P0** — the nested-struct shape (§3, 19:33Z). Five H417 peripherals are behind it and AGENT-1
  has taken other work twice to avoid it.
- **P1** — D's remaining acceptance: the schema is landed, the number on a shipped part is not.
  Read it in a real browser the cycle AGENT-1's `plls:` block lands.
- **P2** — the font-fallback layout finding (§3, 23:04Z); `sdk_none:`'s emitted prefix, *"the SDK
  exposes nothing for it"*, which is wrong for the LTDC pixel format where the SDK exposes a setter
  that is unsafe at init — a `sdk_manual:` key emitting `"set by firmware: <note>"` would say the
  true thing.
- **Idle** — §7 APP, then the standing task: read `codegen.js` end to end for an assumption that
  only holds for the parts that existed when it was written. Seven findings from the last such read
  are in §7; the first is fixed, the rest recorded rather than guessed at.

**IN FLIGHT** — nothing.
- TASKS.md line: — · Doing: — · Files touched: —
- Next step if I stop here: the nested-struct shape. `ch32h417_fmc.h:113-115` is the case.
- Gates last run: suite ALL GREEN 775, 0 skipped — at `096daa6`.

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

**IN FLIGHT** — nothing.
- TASKS.md line: — · Doing: — · Files touched: —
- Next step if I stop here: the `app/tests/**` planted-break sweep, and watch `main` for three
  consecutive green commits before posting `DECISION | worktrees ON`.
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
