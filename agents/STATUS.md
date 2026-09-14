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
| **Gates** | ledger 6 of 6, validate 0 errors, sdk-names 0 errors, cross-loader GREEN — **completeness RED, 2 disclosed citation gaps**, suite not re-run this cycle (tree unsettled) (§1) |
| **Biggest open item** | **DMA — CH32H417 is the only part in the repo with no `dma:` block at all.** Both controllers, the whole channel/request/crossbar surface, unmodelled — an engine gap (multi-controller + a true 123-request×16-channel DMAMUX), not a data one. Now AGENT-2's P0 (§1, §4) |
| **Closed this cycle** | Deliverable C's routing requirement (`params:` 0 owed on every pin-claiming peripheral) and its params-verification bullet, both acceptance criteria met · the whole H417 pin-verification record · the collision ratchet (4→0 avoidable, two reclassified silicon-forced) |
| **Still open, found today** | the ABSENT-citation gate itself (2 real instances, disclosed) · 2 of the 11 non-routing cells nearly declared ABSENT were real gaps needing real params (now landed: `IWDG`/`WWDG`/`PWR`/`FLASH`/`GPHA`) · `DFSDM`'s Filter/Rc/Jc second-struct axis · the pinout SVG's thermal-pad tooltip (§1) |
| **Unverified** | `src-tauri` in a window; **nothing has ever been flashed** (§6); the current full suite count (last confirmed: 780, more has landed since) |
| **Next per agent** | 1: DMA engine research handed off, next per main · 2: DMA engine P0 (multi-controller `dma:`, crossbar `requests:`, `DMA_MuxChannelConfig` codegen), `sdk_manual:` render check, SVG thermal-pad fix · 3: hold for the tree to settle, then the full suite, report the exact line (§4) |

---

## 1. Measured now

Run for this block, serially — 2026-09-14T09:55Z, at `ef2da4f`. **The tree is NOT settled**
(AGENT-1 mid-DMA-engine-P0, AGENT-2 mid `sdk_manual:` render check + SVG fix — see the row below),
so `python build.py` and `node tests/run.js` are deliberately NOT re-run against it; every other
row is a real command against the working tree as it stands right now:

```
python tools/coverage.py --gate      coverage gate: 6 of 6 part(s) meet their declared status
                                      PASS on H417, L103, V003, V005, V006, X035 — all complete
python tools/validate_mcu.py         0 errors, 73 warnings
python tools/verify_sdk_names.py     0 errors, 0 warnings
node tests/run.js "cross_loader"     ALL GREEN — 5 tests   (KNOWN_DIVERGENCES empty)
node tests/run.js "completeness"     1 FAILED, 16 passed   (2 real, disclosed ABSENT-citation gaps — see below)
node tests/run.js "h417_packages"    12 tests green, incl. the collision sweep below
node build.py / full suite           NOT RUN this update — tree has uncommitted data/mcus and
                                      app/engine changes mid-flight; held per main's repeated
                                      instruction, re-run and reported the moment it settles
```

| | Measured | Source |
|---|---|---|
| CH32H417 `params:` | **67 of 78 peripherals have a `params:` or `channel_params:` block, 11 do not.** Of those 11: **9 are legitimately declared ABSENT** (CRC, DBGMCU, EXTI, HSEM, PIOC, RCC, RNG, SYS, TKEY — each checked against its own `ch32h417_*.h`, not assumed). **DMA1 and DMA2 are the only two real gaps left**, and both are blocked on an ENGINE limitation, not a data one: CH32H417 has two DMA controllers and a true 123-request × 16-channel DMAMUX crossbar, which the current single-controller, fixed-table `dma:` schema cannot express (AGENT-1, board 2026-09-14, full extraction done and NOT forced into the wrong shape). Now AGENT-2's engine P0. Routing peripherals: **0 owed** — every peripheral that claims a pad has a block | `eng.channelParamDefs()` + `M.peripherals` count, `data/mcus/CH32H417.yaml`; `tests/completeness.test.js`'s `ABSENT`/`IN_EXTRACTION` tables |
| CH32H417, other axes | clock 68 of 78 have a bit, 9 ABSENT, **1 open (RTC — a two-bit gate, `BKPEN`\|`PWREN`, owner AGENT-2)**. **RTC's `params:` block itself landed** (prescaler, alarm) — the clock gate and the params are different axes and only the clock one is still open · vectors 66 of 78, all 12 without ABSENT — 0 owed · pins 61 route, 17 `pins: none`, 0 `pins: open` · codegen reach 0 peripherals hold a pad and reach no code | `tests/completeness.test.js` matrix, `tests/evidence/round6/2026-09-13-h417-peripheral-map.md` |
| CH32H417 collisions | **QFN68 0 · QFN88 0 · QFN128 0 avoidable** (452 mode choices swept per package) — down from 4·0·0. Two of the four original QFN68 collisions were fixed (UHSIF's `signal_groups:` landing); the other two (`PB11`/`PB12`, FMC address-bus) are **CONFIRMED silicon-forced by experiment** (AGENT-1, `5895ee2`/board `84f4b53`: reorder-and-revert held QFN68 at 2 and regressed QFN88 0→2) and are tracked separately as `SILICON_FORCED_DOCUMENTED`, not counted against the ceiling | `COLLISION_CEILING`, `SILICON_FORCED_DOCUMENTED`, `tests/h417_packages.test.js` |
| Cross-loader gate (`tests/cross_loader.test.js`) | **GREEN.** Built 2026-09-14 after AGENT-1 found `yaml.safe_load` (Python, every gate above) and the app's `js-yaml` (YAML 1.2) disagree on `On`/`Off`/`Yes`/`No` and sexagesimal scalars — every Python gate had been validating a representation the app never runs. Found and AGENT-1 fixed both real instances (`CH32H417.yaml` OPA, `CH32V006.yaml` PWR) by quoting; `KNOWN_DIVERGENCES` is now empty with its staleness check still live | `node tests/run.js "cross_loader"` — 5/5 |
| ABSENT-citation gate (`tests/completeness.test.js`) | **RED, 2 real instances, disclosed, not exempted.** New test (2026-09-14) checking that every `ABSENT` exemption's cited location (a `file:line` or a data path) actually exists for every part the entry excuses — not just one. Found 5 stale citations total; AGENT-1 has adjudicated 3 (`DMA1.params` stays red, correctly — DMA is genuinely unmodelled; `PIOC.params` and `EXTEN.clock` split into per-part citations and fixed). **Still open: `EXTEN.nvic` on CH32L103 and CH32V003** — the underlying rule is confirmed true on both, but AGENT-1 has not yet found each part's own `IRQn_Type` line range and said so rather than guess | `node tests/run.js "completeness"` — 1 FAILED naming both |
| CH32H417 clock | **2 of 5 silicon PLL blocks modelled** (the base SYS PLL, always present, + `USBHS_PLL`), **1 of 8 RM-3.4.13 muxes modelled and computing** (`USBFS`). `clockCalc()` on the real shipped file: `USBHS_PLL 25→480 MHz`, `USBFS 48 MHz`, `over: []`, `under: []` — no longer parked in `agents/proposals/`, this is the shipped part. The other 4 PLL blocks (SERDES_PLL, ETH_PLL, USBSS_PLL, and the SYS PLL's own second input path) and 7 muxes (RNG, I2S2, I2S3, LTDC, UHSIF, HSADC, ETH1G) are confirmed feasible under the current schema (AGENT-2, board 2026-09-13T22:55Z — none need a new engine mechanism) but not yet landed | `clockCalc()` against `data/mcus/CH32H417.yaml` directly |
| DFSDM | Channel struct real (`DFSDM_ChannelInitTypeDef`, 13 fields, both channels, register-matched against a vendor example with two fields swapped — modelled to the register, not the swapped example). **`DFSDM_FilterInitTypeDef`/`RcInitTypeDef`/`JcInitTypeDef` NOT modelled** — a second, still-open axis: three structs want the same `DFSDM_FLTx` handle, the identical "one struct per peripheral" `channel_params:` limit SAI already hit (its own Frame/Slot structs) | AGENT-1, board 2026-09-14T05:20Z |
| Pinout SVG (`app/engine/export.js:pinoutSvg()`) | One real, narrow gap: the exposed thermal pad (every QFN package, `packages.yaml`'s `epad: true`) is drawn as a shape but carries no `<title>` tooltip and no pin-count credit — `pinoutSvg()`'s own doc-comment claims "EVERY physical pin... assigned or not", which overclaims for exactly this one row. The KiCad CSV export does NOT have this gap (includes the pad correctly). Sent to AGENT-2 (main, board 2026-09-14) | Found verifying AGENT-2's exports end to end (round-trip against `pinRows()`, not the CSV against the SVG) |
| Suite size | **Last full run this file can cite directly: 780 tests, 2026-09-13T01:52Z.** Main reports 827 at a more recent full run verified today; not yet reflected on the board under a run I can point at, and NOT re-measured by me this cycle — the tree has not been settled long enough to run it (see the command block above). Seven engine mechanisms, two exports, the cross-loader gate, ETH, and roughly twenty peripherals' worth of params have landed since 780; the real number will be measured, not guessed, the moment the tree holds still | pending — will report the exact line |
| CI | Not re-checked this cycle — last confirmed state (2026-09-13T20:39Z): `worktrees ON` NOT MET even under the corrected three-runs condition, still withheld | `agents/BOARD.md` 2026-09-13T20:39Z |
| Hardware | **builds, not flashed** — every green result here is a compile, in exactly those words | §6 item 8 |

> **What six zeros does not mean.** The ledger asks whether every fact the **datasheet** states is
> accounted for. It does not ask what the app does with them. CH32H417 is `complete` *and*, until
> the DMA engine work lands, has two peripherals (DMA1, DMA2) you can claim pins for and configure
> nothing on. Report the ledger count *and* the `params:` count *and* the collisions, every time.

---

## 2. Deliverables

| | Deliverable | Owner | State |
|---|---|---|---|
| **A** | CI executes and is read green | 3 | done; one line withheld |
| **B** | every gate proven able to fail | 3 | **COMPLETE** — `tests/**` and `app/tests/**` both swept, gates-without-a-plant list empty, both cycle-1 gaps closed |
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

**The stale-`dist` defect — four CI failures, one cause — now has a guard, closed
2026-09-13T20:38Z (AGENT-3).** Two data commits that did not rebuild, one clean-clone build
overtaken by later commits, and run 66 (`448b628`) failing at `dist/index.html is up to date`
and then **skipping** fonts/browser-detect/Run tests, so that commit shipped with no test result
at all. `scripts/check_dist_fresh.js` runs the same rebuild-and-diff check locally, but only when
a commit being pushed touches something `build.py` reads (`app/template.html`, `app/engine/**`,
`app/assets/**`, `data/**`, `build.py`) — anything else costs nothing. `scripts/install_hooks.js`
wires it into `.git/hooks/pre-push`; installed on this shared clone already, covering all three
agents' pushes from this box. `.github/workflows/ci.yml`'s own step now uses
`continue-on-error: true` plus a final re-raising step, so a stale `dist` no longer skips the
real tests — the job still fails, but only after everything else has had a chance to report.

- [ ] **`DECISION | worktrees ON` — the condition itself was redefined 2026-09-13T20:39Z
      (AGENT-3, board DECISION), because the old wording cannot be evaluated.** "Three
      consecutive commits from different agents seen green" presumes one CI run per commit;
      GitHub runs `ci.yml` once per **push**, so a multi-commit push produces one run and
      most commits get none — the condition could fail for reasons that have nothing to do
      with quality. **New wording: the three most recent COMPLETED CI runs on `main` are all
      green (every job success), and their three head commits were authored by three
      DIFFERENT agents.** Checkable directly from run number + conclusion + head commit
      author, no ambiguity about batching. **Applied honestly, not just redefined**: as of
      20:39Z the three most recent completed runs are 70 (`33fd841`, AGENT-2, success), 69
      (`f198d31`, AGENT-3, success), 68 (`0f259c7`, AGENT-3, success) — green, but only two
      distinct agents, not three; AGENT-1's most recent completed, dedicated run is 65
      (`b1eff49`), well back, because AGENT-1's latest commit (`4d15726`) was bundled into a
      later push and never got a run of its own. **STILL NOT MET, under either wording. Not
      posted.**

The 31 red runs, and why nobody saw them: `tests/evidence/round6/2026-09-12-ci-30-failures.md`.
Three fixes that outlive it — annotations must not sit behind a failing pipeline (`bash -eo
pipefail` aborts the step first), `cancel-in-progress` is OFF (it was discarding 15 of 20 runs on a
public repo where minutes are free), and the "dist is up to date" step cannot use `git diff` on
Windows (CRLF checkout).

### B — every gate is proven able to fail  (3; owners fix what goes red)

Fourteen refusals verbatim in `tests/evidence/round6/2026-09-12-planted-breaks.md`. Planted and
seen red: the collision ratchet, the reachability check, the SPL-header guard, fixture freshness,
`--strict` per fixture, the `IN_EXTRACTION` expiry, `verify_sdk_names.py`.

**Correction, found 2026-09-13T20:00Z (AGENT-3, §5 partial dry-run) — this line previously said
the gates-that-cannot-go-red list was empty; it was not.** Opened the actual file rather than
trusting the summary: `2026-09-13-gates-without-a-plant.md`'s own "Not yet planted" section named
two real gaps, unmoved since the file was written at cycle 1 (`2026-09-13T00:00Z`), with nobody
having corrected the "empty" claim when they didn't close.

- [x] **`features › arrow keys / Enter / Delete` (keyboard) — closed 2026-09-13T20:06Z (AGENT-3).**
      The evidence file's own objection — "a plant would test jsdom's key-event plumbing, not the
      app" — does not apply to a real tab: `tests/keyboard_ui.test.js` dispatches genuine
      `KeyboardEvent`s at `window` inside actual Chrome/Edge over CDP (`tests/lib/browser.js`),
      which `window.addEventListener('keydown', ...)` cannot tell apart from an operator's
      keypress. Two planted breaks, both watched red on a COPY of `dist/index.html`: emptying
      `const ARROWS = {...}` leaves `U.focus` at `null` after `ArrowDown`; neutering the
      `Delete`/`Backspace` branch's `resetPin()` call leaves a set pin's state unchanged.
      `node tests/run.js "keyboard_ui"`: 4/4.
- [x] **`features › a user label set on a pin shows on the chip and in the export` — closed
      2026-09-13T20:23Z (AGENT-3).** AGENT-2 landed `data-test="pin-user-label"` on the label
      `<tspan>` (`app/template.html:1238`, commit `33fd841`), its own comment marking it a TEST
      CONTRACT rather than a styling hook — stable by contract, which is what this row was
      actually blocked on (every prior anchor was engine code, and moved).
      `tests/features.test.js`'s new planted break mutates the ONE line that emits the attribute
      (`withMutantDist`, a copy of `dist/index.html`, tree untouched), confirms the label text
      still renders — the plant is deliberately invisible to a bare text-grep check, which is the
      gap the hook exists to close — and confirms the hook selector then finds nothing.
      `node tests/run.js "features.test"`: 7/7.

**§5.2 step 8's acceptance ("the list is empty") IS MET as of 2026-09-13T20:23Z.**
`2026-09-13-gates-without-a-plant.md` carries both closures with the red output verbatim, and
says explicitly that nothing remains in a "not yet planted" state. **Deliverable B is CLOSED.**

- [x] **the same sweep over `app/tests/**`** — done 2026-09-13: all 27 files (18 more than the 9
      counted when this row was written — the file grew under it while it was open, and the plan
      covers what is actually there rather than the count last measured). **CAUGHT 27 · MISSED 0 ·
      COULD-NOT-RUN 0**, `tests/evidence/round6/2026-09-13-app-tests-planted-breaks.md`,
      `scripts/plant_app_tests.js` reruns it. 22 files mutate a COPY of `app/engine/<file>` under a
      fresh temp root (`tests/lib/enginemutant.js`); 4 (`glue`, `clockmux_ui`, `tree`, `layout`)
      mutate a COPY of `dist/index.html` instead, because they `boot()`/`withPage()` the built
      bundle rather than importing the engine live — measured before writing either shape: Node's
      ESM loader realpaths a module reached through a Windows junction, so `tests/lib/mutant.js`'s
      junction trick would have had `app/tests/_harness.js` import the REAL, unmutated engine
      regardless of what the junction pointed at. Every module whose relative imports must reach
      the mutated file is a real file physically under the temp root instead.

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
| 09-12T23:04Z | 3→2 | **the layout is not tolerant of its own font fallback** — `#mcu-meta` needs 181px in a 168px box on Linux. It ellipsises by design so nothing fails, but the user sees less than intended. **Partial, AGENT-2 this cycle**: text shortened, provably narrows the gap, not re-measured against the actual Linux/fallback-font numbers — still open until someone with that runner confirms |
| 09-13T19:50Z | 2→1 | `mcu.fixture: true` — the ENGINE already reads it (landed 2026-09-11); needs blessing in `data/FORMAT.md` and setting on `tests/fixtures/mcus/WCH-DUMMY32-C8.yaml` (→AGENT-3 too) before `isFixture()`'s name-sniffing can go |
| 09-13T19:50Z | 2→1 | `codegen.rcc.pllsrc` cannot express a PLL input that is a source AND a divider (CH32H417's SYS PLL) — a FORMAT question with two candidate shapes on `agents/BOARD.md`, not shipped as an engine change; AGENT-2's call to make either way but the schema is AGENT-1's |

Answered this cycle (AGENT-3), both closed:
- 09-13T00:33Z 1→3 `tests/h417_packages.test.js:222-227`'s stale setting label — fixed, and the
  live collision output now prints the corrected label (`FMC.Address lines = "A0-A25"`); count
  unchanged at 4.
- 09-13T00:33Z 1→3 the expiry planted break's count capped at 40 by `assert.empty`'s display
  limit — fixed by reading the exact count from `assert.empty`'s own message header instead of
  the truncated bullet list; re-run now prints the true current count (32).

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
- Next step if I stop here: **C's routing requirement is CLOSED — `params:` 62 of 78,
  16 owed, all non-routing.** ETH landed (the third `verify_sdk_names.py` indexing mode,
  `codegen.sdk.driver_c:`, 26 of 47 fields on `call_arg:`/`dead_fields`). GPHA correctly
  excluded per main's own correction — it strands no pads. The 16 remaining cells are
  either declared ABSENT already (SYS/RCC/EXTI/DMA1/PIOC) or still need an ABSENT
  declaration for the rest (CRC/DBGMCU/DMA2/FLASH/GPHA/HSEM/IWDG/PWR/RNG/TKEY/WWDG) to
  formally close the `IN_EXTRACTION` line — **not yet done, next natural step if this
  line is picked up again.** DFSDM's Filter/Rc/Jc still need a genuinely new capability
  (a second, independent per-instance axis), REQUEST open to AGENT-2, distinct from
  SAI's (closed). The YAML 1.1/1.2 boolean split is FIXED, not just found — both real
  instances (CH32H417 OPA, CH32V006 PWR) quoted, `node tools/cross_loader_check.mjs`
  reads all 7 files clean; REQUEST open to AGENT-3 to empty their now-fully-stale
  `KNOWN_DIVERGENCES` (their test is red on that one assertion until they do,
  disclosed on the board, not silently left).
- Gates last run: `validate_mcu` 0 errors/73 warnings (unchanged) · `verify_sdk_names`
  0/0 · `coverage.py --gate` 6 of 6 · `validate_params_selftest` 6/6 ·
  `verify_sdk_names_selftest` 48/48 (was 44 before ETH's `driver_c_cases()`) ·
  `validate_afmux_selftest` 13/13 · `node tests/run.js "H417"` 66/66 ·
  `"completeness"` 15/15 · `"codegen_compile"` 18/18 · `node
  tools/cross_loader_check.mjs`: all 7 files clean (was 2 diverging). `node
  tools/wchcube_cli.js --format c --strict` on throwaway ETH/DFSDM/USB/SAI/LPTIM/OPA
  projects, each read by hand, not just the exit code. `pio run` not run this cycle (no
  `main` ask).

**Current — 2026-09-14T~07:35Z. ETH lands (the last routing peripheral), then the
cross-loader boolean fix. Commits: `8c94ad1` `8f6c4ef` `ba6c45c` `eef5b64`.**

- **The third `verify_sdk_names.py` indexing mode, `codegen.sdk.driver_c:`.**
  `ETH_RegInit` is declared in NO header anywhere, only defined in the example
  driver's own `.c`. Measured the general rule first, same discipline as UHSIF's own
  narrowing: "a public function whose name-prefix matches a real SPL peripheral
  prefix, outside standard boilerplate filenames" found **194 candidates on the real
  EVT drop, most of them wrong** (`FLASH_ReadID` and seven more in an example's own
  EXTERNAL SPI-flash driver, sharing the on-chip FLASH peripheral's prefix by
  coincidence; `RCC_Configuration`, `GPIO_Config`, `SDMMC_SetCommand`, dozens more).
  Rejected for the same reason UHSIF's 711-directory first attempt was — landed a
  hand-curated `driver_c:` file list instead, both halves (positive + negative)
  asserted as invariants in `verify_sdk_names_selftest.py`'s new `driver_c_cases()`.
  48/48 planted breaks, was 44.
- **ETH's 26 of 47 live fields landed on `call_arg:`/`dead_fields`**, every default
  citing the EVT's own `ETH_Configuration()`. Found and fixed a real error in
  `data/FORMAT.md`'s own worked `dead_fields:` example while landing this — it listed
  the 21 names WITHOUT their `ETH_` prefix, but `codegen.js` compares the list
  against `d.sdk_field` verbatim, so the documented example would never have matched
  anything real. Compiled: a throwaway project with non-default values,
  `ETH_RegInit(&ETH_InitStructure, 3)` emitted correctly, no handle, PHY address
  trailing.
- **The YAML 1.1/1.2 boolean split, fixed.** AGENT-3's new cross-loader gate found a
  second instance beyond my own report (CH32V006's `PWR.awu_prescaler`). Quoted both
  — `name: "Off"`, `name: "On"`, `default: "Off"` — not exempted. CH32H417 through
  `peripheral_extras.yaml` + regenerate; CH32V006 (no generator exists for it) edited
  in place, then its own gates re-run rather than assumed clean. `data/FORMAT.md`
  gained a section stating the rule plainly, right after the intro. REQUEST posted to
  AGENT-3 to empty `KNOWN_DIVERGENCES` — I don't own `tests/**`.

Red, and who owns it: `tests/cross_loader.test.js`'s one "stale entry" assertion,
AGENT-3's file, REQUEST posted — everything else green.

**Current — 2026-09-14T~06:35Z. Same cycle, continued: DFSDM's Channel struct, a
real LPTIM `clkpol` bug fixed, the four USB declarations, SAI's Frame/Slot, OPA's
PSEL/NSEL/Mode, and two real validator bugs found and fixed along the way.
`params:` 56 → 61 of 78. Commits: `01714b5` `bff24cd` `b7c00a1` `df1956a` `5bdca5d`.**

- **clkpol fix (`bff24cd`), found by AGENT-3, verified here.**
  `depends_on: { param: encoder, equals: false }` compared an ENUM (options are the
  strings "Disable"/"Enable") against a literal boolean - `compare()`'s
  `Boolean(have) === want` branch only fires for a bool-typed `want`, so the dependency
  was permanently unsatisfiable and `LPTIM_ClockPolarity` was never emitted on either
  LPTIM instance, in any configuration. Invisible because the struct's zero-init
  happens to equal the field's own default (Rising). Fixed to `equals: Disable`;
  verified past the validator with a throwaway project (`clkpol: Falling` now correctly
  emits `LPTIM_ClockPolarity_Falling`, was silently absent before).
- **The four USB declarations (`bff24cd`)**: USBHS/USBSS/USBPD get one
  `const:`+`sdk_manual:` row each (md5-identical bring-up across every shipped
  example), the note transcribing real register/value/file:line writes. USBFS does
  NOT get `const:` (8 different md5 hashes across its 8 examples) - two real
  `sdk_manual:` bool params instead (`USBFS_UC_DEV_PU_EN`, identical in all 8;
  `USBFS_UC_LOW_SPEED`, clear in 7 of 8, set in exactly the one example named for it).
- **SAI's Frame/Slot (`b7c00a1`) landed on AGENT-2's multi-struct `channel_params`
  mechanism**, verified (`channel_multi_struct` 5/5) before touching anything.
  **Corrected my own DFSDM claim in the same commit**: DFSDM's Filter/Rc/Jc are NOT the
  same gap - they need a SECOND, independent handle axis (`DFSDM_FLTx`, not
  `DFSDM_Channely`), confirmed by reading `codegen.js`'s actual multi-struct loop
  (`inst.handle || handle`, always the CURRENT instance's own handle - no way to give a
  secondary struct a different one). Forcing it through would silently emit
  `DFSDM_FilterInit(DFSDM_Channely, &s)`, a real type mismatch. REQUEST to AGENT-2,
  distinct from SAI's now-closed one.
- **A second real `check_param_list` gap found and fixed (`df1956a`)**:
  `channel_params.params:` was never actually validated on ANY peripheral, on any
  part - the call site assumed `channel_params:` was a map of named sub-blocks
  (`dma.channel_params`'s shape), not the single block it has always actually been, so
  `.items()` iterated the block's own top-level keys and never reached the real row
  list. Found by planting a bad default on OPA's `fb` row and watching
  `validate_mcu.py` exit 0. Fixed; re-ran all six parts, 0 errors - nothing was
  actually wrong, only unchecked.
- **OPA's PSEL/NSEL/Mode (`5bdca5d`) landed on `instance_setting`**, but not in the
  single-free-enum shape the FORMAT.md worked example's own text might suggest -
  checked `app/tests/instance_setting.test.js` first and found a `depends_on`-gated
  row with real options leaves the struct member UNWRITTEN whenever the OTHER live
  setting state is active. So each field is a PAIR of `const:` rows (mirroring
  `DVP_DataSize`'s existing precedent), six rows total. Compiled: OPA1 at P1/N0/OUT1,
  OPA2 at P0/N1/OUT0 (deliberately opposite), each instance resolves only its own
  setting in the generated C.
- **Found a real `check_flow_mappings()` false positive while landing OPA, fixed in the
  same commit.** The "unquoted comma" trap checker treated a literal `{n}` INSIDE a
  quoted string as its own flow-mapping span - `depends_on`'s own `"OPA{n} positive
  input"` (the mechanism's own documented syntax) tripped it. Fixed with
  `_mask_quoted()` plus excluding a `{` right after a word character, the second part
  needed because `validate_params_selftest.py`'s PyYAML round-trip drops the quotes
  entirely. Both the real trap and both `{n}` shapes verified directly, not assumed.
- Every landing this block describes was compiled with a throwaway `.wchproj` and the
  generated C read by hand before committing, not just `--strict`'s exit code.

Red, and who owns it: **nothing of mine.**

- **LPTIM1/LPTIM2 landed** (`bc2fdb7`): `params:` **54 → 56 of 78**. One shared struct
  and apply call (`LPTIM_TimeBaseInitTypeDef`/`LPTIM_TimeBaseInit`,
  `ch32h417_lptim.h:23-92,176`), 17 fields cited to the header and to the vendor's own
  PWM/One-Pulse example. The enable call carries `sdk_call_order: before_structs`
  (AGENT-2's mechanism) because RM 17.5.5 documents `CNTSTRT`/`SNGSTRT`/`OUTEN` as
  write-only-when-`ENABLE`=1 and `LPTIM_TimeBaseInit()` preserves whatever `ENABLE`
  already is in the same register write — reversed, it compiles clean and silently
  never starts. `LPTIM_EncoderMode` stays unmodelled (no macro values anywhere in the
  header, shares a union slot with `clkpol`, gated off it).
- **SWPMI's "Single wire with supply" ruling applied, and upgraded past what was on
  disk.** The predecessor had already removed the choice on the manager's citation (DS
  Table 2-2-26 + `CH32H417RM.md:11003`, no register bit either way), but recorded it
  only as a source `#` comment — invisible to the app. Moved it into the peripheral's
  own `notes:` field instead (real schema key, "shown to the user" per
  `data/FORMAT.md`), so the decision is visible in the app, not only to whoever reads
  the YAML next. Landed through `peripheral_extras.yaml`'s `swpmi_params` anchor +
  regenerate, never a hand edit.
- **UHSIF's QFN68/QFN88 `signal_groups` default gap closed** (`6d7165e`), the third item
  the manager owed me an answer on. AGENT-2 landed `signal_groups[].remap_by_package`
  this cycle (`82c2d73`, reusing `remaps:`'s own shape) — this is the data it was built
  for. `CH32H417RM.md:11839-11845` states the fix outright, right after Table 9-33:
  "The chip packaged with 56/68 pins is recommended to use the mapping configuration of
  01b; It is recommended to use 1xb mapping configuration for chips packaged as 88
  pins." `remap_by_package: { QFN68: 1, QFN88: 2 }`, verified against the real package
  pin tables both ways (index 1 bonds 5 of PORT0-7 on QFN68, not all 8 — the RM's own
  recommendation, not claimed as a full fix; index 2 bonds all 8 on QFN88). Found
  `signal_groups[].remap_by_package` had **no `validate_mcu.py` check at all** — only
  the peripheral-level `remaps:` one did — so a bad package name or an out-of-range
  index would have passed silently; added the check, `data/FORMAT.md` documents the
  key, two new cases in `validate_afmux_selftest.py` (13/13), both watched red before
  being trusted.
- **A stale self-test fixed along the way**: `validate_params_selftest.py` targeted
  `UHSIF.width_bit`, a param removed when `signal_groups:` landed — 2 of 5 planted
  breaks were silently NOT being planted at all (`row()` raises `KeyError` before
  `validate_mcu.py` ever runs, and the harness counted that as a catch). Found by
  re-running the selftest ahead of a data commit and seeing 3/5. Retargeted to
  `uhsif_port_rm`, 5/5.
- **TASKS.md's live `[~]` line updated** with the new count and this cycle's findings,
  and the UHSIF-claims-all-49-pads sub-item ticked `[x]` — it was already resolved
  (Mode's choices are width-specific pin claims today) before this cycle started, just
  never ticked.
- Fixtures refreshed once, for the LPTIM/SWPMI param defaults only:
  `node tests/fixtures/make_fixtures.js` (the two H417 ones were stale; the UHSIF
  `remap_by_package` change added no new `params:` key, so no second refresh needed).
- **FMC_A11/PB11 + FMC_A12/PB12 traced (`5895ee2`), answering main's ask for a re-
  statement on the SPECIFIC pair the test reports, not the older PD11/PD12 wording** —
  and proved empirically, not just reasoned: reordered `A11`/`A12` in a throwaway local
  edit, re-ran `node tests/run.js "h417_packages"`, reverted before touching anything
  else. QFN68's avoidable count held at exactly 2 (same collision, relabelled to
  `PD11`) while unmasking two already-real silicon collisions the sweep's per-pad dedup
  was hiding (`PB11`: `A6`+`A20`, `PB12`: `A7`+`A21`) AND regressing QFN88 from 0 to 2.
  Genuinely silicon-forced; REQUEST posted to AGENT-3 to reclassify (`tests/**` is
  theirs).

Red, and who owns it: **nothing of mine.** Did not touch `app/engine/**`,
`app/tests/**` or `tools/wchcube_cli.js`, all mid-edit under AGENT-2 on the shared tree
this cycle.

**Current — 2026-09-13T20:23Z. `pio run` posted; the SDMMC "P0" turned out to be two
real schema gaps, and I closed the investigation rather than force either fix.**

- **`pio run` SUCCESS on both halves of the batch**, verbatim to `main`: batch 1
  (SERDES both controllers, QSPI1, QSPI2, SAI Block A, USBFS) `RAM 7.9% / Flash 0.9%`;
  batch 2 (FMC `8080 LCD, 8-bit` + `Extended Mode: Enable`, exercising both `rw`/`wr`
  timing blocks) `RAM 7.7% / Flash 0.8%`. SDMMC held `Disable` in batch 1 for exactly
  the reason below — enabling it was HOW its own gap surfaced.
- **The manager's P0 — read Table 2-2-x's AF column and fill SDMMC's 32 gaps — could
  not be done as asked, because the premise was wrong, and I verified that three
  independent ways before saying so.** Table 2-2-12 "SDMMC Pin Functions" has NO af
  column: it is an `AFIO_PCFR1.SDMMC_RM[1:0]` REMAP table (RM 9.2.11.5,
  `CH32H417RM.md:11741-11768`, Table 9-32) - the CH32V006-style "one field, every
  signal" shape `remaps:` exists for, not the per-pin `af:` mux the other 417 signals
  use. `tools/extract_h417_pins.py`'s own mechanical AF parser - which found all 418
  real codes - returns NOTHING for any `SDMMC_*` name. The vendor's own
  `SD_GPIO_Init()` (`sdmmc_sd.c:93-113`) calls `GPIO_Init(Mode_AF_PP)` and
  `GPIO_PinAFConfig()` NOWHERE. No af code exists to fill in.
- **Tried the honest partial fix, and reverted it rather than force it past a QA gate
  I don't own.** Narrowed `signal_pins:` to the one reachable pin set (RM=00, needing
  no register write since it's the reset default), declared the other 18 rows
  `absent:` with citations, ledger held at 0 open. It broke
  `tests/h417_dedicated.test.js`, which asserts CH32H417.yaml's SDMMC/UHSIF pins match
  DS Table 2-2-12/2-2-16 COMPLETELY - correctly, by that test's own stated purpose
  (extraction fidelity, not reachability). Two legitimate rules in genuine conflict for
  this one peripheral; reverted all three files (`dedicated_pins.yaml`,
  `peripheral_extras.yaml`, `data/coverage/CH32H417.yaml`) back to the pre-investigation
  state rather than pick a winner that isn't mine to pick. Verified byte-for-byte:
  `git diff --stat` shows `data/coverage/CH32H417.yaml` at zero net change.
- **Found and fixed a real bug along the way, kept regardless of the revert**:
  `tools/gen_h417_peripherals.py`'s `signal_pins:` emission had NO `extra_keys` guard -
  unlike `settings:`/`pins:`/`notes:`, which all check it - so a peripheral extras
  override would silently emit `signal_pins:` TWICE (PyYAML takes the last
  duplicate key, `js-yaml` throws - the exact trap the settings-guard exists to
  prevent). Fixed with a proper three-way branch; no shipped part uses the override
  today, so this is a live landmine defused, not a visible change.
- **Two REQUESTs posted, `agents/BOARD.md` 2026-09-13T20:23Z**: to AGENT-2, a
  `codegen.remap` capability that coexists with `style: af` for one peripheral, or a
  `no_af:`-shaped marker for "`GPIO_Init` runs, `GPIO_PinAFConfig` deliberately does
  not, no TODO" (cited to the vendor evidence); to AGENT-3, whether
  `h417_dedicated.test.js`'s completeness check and a reachability restriction can
  coexist. Same underlying shape as FMC's multi-bank `Chip select` checkbox and SAI's
  Frame/Slot structs - three real schema gaps this cycle surfaced, all needing
  cross-agent design, none forced through.

Red, and who owns it: **nothing of mine.** SDMMC's `--strict` failure is exactly where
it was before this investigation - pre-existing, not a regression, now with the true
cause on record instead of a wrong one. `app/tests/clockmux.test.js` (previous cycle's
red) is AGENT-2's, already fixed on their side.

**Current — 2026-09-13T19:39Z. The manager's three follow-ups, in the order asked.**

- **The bitfield gate fix got the selftest case it was missing.** `bitfield_cases()` in
  `tools/verify_sdk_names_selftest.py`: four checks against a synthetic header exercise
  `Index.add_header()` directly (named bitfield captured, plain+array member still
  captured, anonymous padding contributes nothing, a name the header never wrote is
  still rejected in isolation), plus a fifth END TO END against the real
  `CH32H417.yaml` — SERDES's `clear_all` `sdk_field` mutated to `ClearALLNotAField` and
  confirmed REJECTED by the full `verify_file()` pipeline, not just the parser. Folded
  into the main tally rather than a side count like `driver_header_cases`: selftest now
  reads **44/44** (35 + 4 driver-header + 5 bitfield), not 35/35 with an unlisted extra.
- **PIOC declared, not silently absorbed.** Checked whether the `SYS.params`-style
  `ABSENT` map in `tests/completeness.test.js` (`:86-89`, QA-owned) was mine to touch —
  it is not — and posted the exact line as a REQUEST instead of guessing at an edit in
  a file I do not own: `agents/BOARD.md` 2026-09-13T19:23Z, citing
  `CH32H417RM.md:49360-49399`. Until AGENT-3 lands it, the peripheral-count script still
  reads PIOC as one of the open cells; owed is **28 once staged, 29 until then** (32
  peripherals without a block, minus SYS/RCC/EXTI/DMA1/PIOC).
- **FMC's NOR/SRAM controller, through AGENT-2's `embed:` contract, verified two ways.**
  `FMC_NORSRAMInitTypeDef` (13 fields) + `FMC_NORSRAMTimingInitTypeDef` embedded twice
  (`rw`/`wr`, one call each) — 25 params, all cited to `ch32h417_fmc.h` and RM ch.40's
  BCRx/BTRx tables. `FMC_Bank` is fixed to NE1/`FMC_Bank1_NORSRAM1` rather than offered,
  because "Chip select" above is a CHECKBOX (more than one of NE1-4 selectable at once)
  and one scalar bank id cannot answer "which bank" for a multi-bank design — the same
  `channel_params.instances` shape SERDES/SAI use, keyed to a checkbox instead of a
  channel number, not built this cycle (TASKS.md line). Verified past the schema: built
  a throwaway `.wchproj` enabling `Bus mode: 8080 LCD, 8-bit` and toggled `Extended
  Mode` both ways through `node tools/wchcube_cli.js --format c --strict` — Enable
  emits BOTH `FMC_NORSRAMTimingInitStructure_rw`/`_wr` blocks and both pointer
  assignments exactly as AGENT-2's worked example shows; Disable emits only `_rw` and
  leaves `FMC_WriteTimingStruct` at its `{0}` NULL, which is what the SDK reads under
  Disable. `--strict` exits 0 both ways. Every timing default is the SLOWEST value the
  header's own range allows — CH32H417's EVT ships no FMC example to check a real
  number against, unlike every other peripheral this cycle. ETH, ECDC, FMC_NAND,
  FMC_SDRAM are separate structs behind the same contract, not started.
- **USBHS_PLL/USBFS shipped**, unchanged from the parked proposal: `clock.plls.USBHS_PLL`
  (480 MHz off HSI, one input, the other three declared with the RM line that blocks
  each) and `clock.prescalers.USBFS` (the 48 MHz tap, sixteen dividers including the
  7.5 a first draft omitted). `agents/proposals/CH32H417_usbhs_pll.yaml`'s own numbers,
  spliced verbatim. Confirmed AGENT-2's row-packing fix holds for the real file, not
  only their copy-in-memory measurement: `node tests/run.js "clock"` 97/98,
  `layout`/`legibility` both green. The one red is `clockmux.test.js` hardcoding
  CH32H417 as a part with neither key — correct when written, stale now, REQUEST posted
  to AGENT-2 rather than edited (`app/tests/**`).

Red, and who owns it: `app/tests/clockmux.test.js:64`, AGENT-2's, REQUEST posted above —
everything else green. Fixtures refreshed twice (once per data change,
`node tests/fixtures/make_fixtures.js`) and both re-confirmed 18/18 before this commit.
`pio run` for this whole batch (SERDES/QSPI/SDMMC/SAI/FMC) is authorised and not yet run —
next action.

**Current — 2026-09-13, cycle 7. Four peripherals landed clean, one correctly refused.**

- **SERDES** (`SDS_CFG_TypeDef`, `ch32h417_serdes.h:62-81`): two independent controllers,
  `SDS1`/`SDS2` (`ch32h417.h:1827-1828`), behind the ONE differential pad set — modelled as
  `channel_params.instances`, E's mechanism, not a flat block, because the EVT's own
  full-duplex example calls `SDS_Config()` twice with different role bits
  (`Evt/EXAM/SerDes/FullDuxTrans/Common/hardware.c:95-120`). All twelve fields cite
  `CH32H417RM.md:23785-23864` (R32_SERDESx_CTRL) by exact bit line.
- **Found and fixed a real bug in a tool I own**, before SERDES could pass at all:
  `tools/verify_sdk_names.py`'s struct-field parser could not read a C bitfield
  (`uint32_t ClearALL : 1;`) — the regex required a comma or end-of-string right after the
  name, which `: 1` is neither, so all twelve of SERDES's real, correct fields reported as
  "not a member of its own struct". Fixed by stripping the `: <width>` suffix before field
  extraction (`BITFIELD_WIDTH_RE`); an anonymous bitfield (`uint32_t : 5;`) still correctly
  yields no field. `verify_sdk_names_selftest.py` unchanged at 35/35 — this fix has no
  planted-break case yet (noted, not invented under time pressure); the positive proof is
  the real file going from 12 errors to 0 on unchanged, correct data.
- **QSPI1/QSPI2** (`ch32h417_qspi.h`): one shared template (`&qspi_params`, both instances
  cast to the same `QSPI_TypeDef*`, `ch32h417.h:1815-1816`), 16 fields across TWO structs —
  `QSPI_InitTypeDef` (clock/flash geometry) and `QSPI_ComConfig_InitTypeDef` (one command's
  frame shape) — both ordinary `struct:`/`sdk_field:` rows since, unlike FMC, neither is
  reached only through a pointer inside the other. **Found a real scope limit**: ComConfig
  bakes ONE command's shape into init, correct for Memory-Mapped mode, only the first
  command's shape for Indirect mode. TASKS.md line, not guessed around.
- **SDMMC** (`ch32h417_sdmmc.h`): bus width is the `Mode` row exactly like SDIO's existing
  precedent (`const:`+`depends_on:`, three rows); the other nine fields of
  `SDMMC_InitTypeDef` default to what this part's OWN two SD/eMMC examples actually run
  (`sdmmc_sd.c`, `sdmmc_emmc.c`), not the raw register POR value, where the two disagree —
  `clock_speed`/`clock_div` because the examples deliberately start slow for card
  identification, `clock_oe` because both examples start SDCK through a separate runtime
  call (`SDMMC_ClockCmd`) the struct field is not part of. Four more structs
  (`SDMMC_CMDInitTypeDef`, `SDMMC_TranModeTypeDef`, two DDR I/O-delay structs) declared NOT
  modelled — two are per-transaction runtime calls, two are DDR-only settings neither
  example ever exercises.
- **SAI**: same two-block shape as SERDES (`SAI_Block_A`/`SAI_Block_B`,
  `ch32h417.h:1775-1776`), and the settings already had independent `Block A`/`Block B`
  rows to key `channel_params.instances` off. **Found the cycle's real schema gap**: the
  driver has THREE per-block init structs (`SAI_InitTypeDef`, `SAI_FrameInitTypeDef`,
  `SAI_SlotInitTypeDef`, all three called for the ONE block the EVT's own example uses —
  `Evt/EXAM/SAI/SAI_Play/Common/hardware.c:103,110,116`) and `channel_params:` holds exactly
  ONE `struct:` per peripheral. Modelled `SAI_InitTypeDef` (mode/protocol/clock, 10 fields,
  one of them — `SAI_OutDRIV` — fixed at `const: 0` because the header's own doc comment
  points at an `@ref` group that is not defined anywhere in it); Frame/Slot recorded as a
  REQUEST to AGENT-2 (peripheral_extras.yaml SAI comment, TASKS.md) rather than forced
  through a flat block that could only ever configure one hardcoded block.
- **PIOC checked and correctly NOT modelled.** The cycle brief said all five targets have
  real SPL drivers "so the task keeps its normal shape" — true for the other four, false
  for this one: there is no `ch32h417_pioc.c` anywhere, so no function of any kind applies
  `PIOC_TypeDef`. RM ch.34 (`CH32H417RM.md:49360-49399`) says why — PIOC is a second,
  embedded RISC8B CPU with its own 66-instruction set and a 2048-word program ROM; what it
  does is set by loading an assembly PROGRAM into that ROM (a separate toolchain,
  `Evt/EXAM/PIOC/*/Common/Asm/*.ASM`), not by filling a struct. Filling `PIOC_TypeDef`
  fields anyway would be rows no `codegen.init_structs` entry could ever apply — correctly
  refused rather than forced. `params:` left at 0 for it; TASKS.md line.
- **Fixtures refreshed in this commit**, at `main`'s request: `node tests/fixtures/make_fixtures.js`
  rewrote `tests/fixtures/CH32H417_QFN{128,68}*.wchproj` (default values for the sixteen new
  QSPI keys and the nine new SDMMC keys only — no other project field moved), and
  `node tests/run.js "codegen_compile"` went from 2 failing to **18/18 green**.

Red, and who owns it: **nothing.** `pio run` on this batch was not asked for and not run —
per the manager's "once per batch, not once per peripheral" rule, held for the end of the
FMC/USBHS_PLL work still to come this cycle.

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

- **P0** — ~~the nested-struct shape (§3, 19:33Z)~~ **done.**
- **P0.5** — ~~channel_params filling more than one struct per instance (SAI/SERDES, manager-relayed
  from AGENT-1)~~ **done.**
- **P1** — ~~D's remaining acceptance: the layout that blocked a shipped USBFS 48 MHz~~ **fixed —
  and AGENT-1 has since shipped it for real (`ff7d48d`), re-verified on the real data, real
  browser, still fits.**
- **sdk_manual:** — ~~sdk_none:'s false "exposes nothing" wording~~ **done.**
- **codegen.js read-through items 2-6** — ~~all six~~ **addressed**: 2 is a REQUEST (engine half
  already landed 2026-09-11), 3 and 4 fixed with tests, 5 recorded (no data to check a fix
  against), 6 is a decision made, measured wrong, reverted, documented.
- **codegen.js read-through item 7** — FILED as a FORMAT question to AGENT-1, not mine to answer
  by shipping one shape (`pllsrc` cannot express CH32H417's source+divider PLL input).
- **Font-fallback finding (§3, 23:04Z)** — partial: `#mcu-meta` text shortened, provably narrows
  the gap, not verified closed (no Linux box here).
- **P0 (round exit criterion)** — ~~a mux entry that carries its own divider~~ **done.** LTDC
  unblocked; three of the other six remaining muxes may need the identical shape.
- **`data-test="pin-user-label"` hook** — ~~deliverable B's last gates-that-cannot-go-red entry~~
  **done.**
- **§7 APP P0 — the peripheral tree reachable by keyboard alone, and AA contrast both themes** —
  **done.** Roving-tabindex arrow-key navigation landed; two real contrast failures found and
  fixed (the SELECTED row was WORSE contrast than unselected — 3.54:1/2.81:1, now 5.14/5.49:1;
  a dark-theme-only badge combo at 2.37:1, now 6.08:1). Contract for AGENT-3's planted-break
  sweep posted to `agents/BOARD.md` 20:45Z — not written by me, `tests/**` is not mine.
- **§7 P1** — ~~project diff between two `.wchproj` files~~ **done** (`23323ca`).
- **A per-package default for `signal_groups:`** — ~~QFN68/UHSIF bonded to nothing at the index-0
  default~~ **done, this cycle.** See Current below.
- **§7 P2, part one: the KiCad symbol pin CSV** — ~~the owner's literal deliverable~~ **done, this
  cycle.** See Current below.
- **CLI reachability for the KiCad CSV** — ~~`main` tested it, it was unreachable from
  `tools/wchcube_cli.js`~~ **fixed, this cycle.** See Current below.
- **§7 P2, part two: the pinout SVG export** — ~~built reachable from the CLI from its first
  commit, per main's explicit order~~ **done, this cycle.** See Current below.
- **CLI reachability for the KiCad CSV** — ~~main tested it, unreachable from the CLI~~ **fixed.**
- **§7 P2, part two: the pinout SVG export** — ~~built reachable from the CLI from its first
  commit~~ **done.** AGENT-3's independent verification found the exposed-pad tooltip missing
  (contradicted the function's own doc-comment) — **fixed**, tested, planted-break-verified.
- **The `sdk_manual:` render check** — ~~main's demand, first real data behind the key~~ **done.**
  Two real UI defects found and fixed (`getParams()` dropped every const+sdk_manual row
  entirely; `paramTable()` — the ACTUAL Parameter Settings tab, separate hand-duplicated code
  from `paramTableFrom()` despite that function's own doc-comment claiming otherwise — never
  read `sdk_note` at all). See Current below for both.
- **CH32H417 DMA — two controllers + the DMAMUX crossbar** — **done, this cycle: the engine
  mechanism main named the single biggest remaining item on the part.** `dma:` may now be a
  LIST of controllers, each optionally `mux:`-shaped; codegen emits `DMA_MuxChannelConfig`
  confirmed against the real SDK signature and two real EVT examples. 11 new tests, all
  backward-compat suites unchanged and green. Full contract posted to `agents/BOARD.md` for
  AGENT-1 to paste the 123-request table into. See Current below.
  **HOLD — main's decision, 2026-09-14: the System-Core "every channel at once" DMA overview
  table (`dmaChannelTable()`, currently fixed-table-only, dead code for a multi-controller
  part) is NOT to be built until AGENT-1's real 123-request data lands and the mechanism is
  proven end to end against it.** Building a multi-controller overview against no
  multi-controller data risks the wrong shape and a redo. Flagged HERE explicitly so this
  gap cannot quietly become permanent — check this line before assuming the DMA UI is
  finished once the data lands; it is not, until this table is built or main says otherwise.
- **Next (manager's order)** — stay available while AGENT-1 lands the DMA data: the first real
  consumer of a new mechanism is what finds its gaps (`preSel()`'s `[...v.options]` crash, the
  `signal_pins:`/`remaps:` double-emission — same pattern). **Be ready to defend the mux-
  before-struct-fill ordering decision against the RM specifically**, not just against the two
  EVT examples that happen to order it the other way — the LPTIM `sdk_call_order` precedent is
  exactly the shape where "the vendor's own order turned out to be load-bearing." Then §7 P2's
  last item (print view), only if it can reuse `pinoutSvg()`'s renderer cleanly. The
  `codegen.init_structs.<inner>.embed` documentation gap — worked example now posted to
  `agents/BOARD.md` for AGENT-1 to paste into `data/FORMAT.md` (not mine to edit); §7 backlog
  otherwise.
- **Idle-after-that** — USBHS_PLL's other three inputs (§2 D REQUEST from AGENT-1, 01:14Z), item
  2's data half (AGENT-1), once anyone answers.
- **`clockSummaryMarkdown()`'s two garbled tap shapes (main's finding, reproduced from the repo
  owner's own screen)** — ~~`/undefined` for a bare mux, `[object Object]` for a leg-divider
  entry~~ **done, this cycle.** See Current below.
- **CH32H417's DMA USER ACTION comment hardcoded to the single-buffer field names (main's
  finding, board 2026-09-14)** — ~~named `.DMA_MemoryBaseAddr`, a field this part's struct does
  not have, and never mentioned `.DMA_Memory0BaseAddr`/`.DMA_Memory1BaseAddr`, the ones it
  does~~ **done, this cycle.** See Current below.
- **`tests/features.test.js`'s export-coverage gate (main's finding: 23-24 uncovered
  `app/engine` exports, 89% against the 90% floor)** — ~~`pllList`/`tapSources`/`remapPlan`/
  `CONSTRAINT_FIELDS` and 20 others never called by name anywhere in `app/tests`~~ **done, this
  cycle: covered, not exempted — the threshold was never touched.** See Current below.

**IN FLIGHT** — nothing.
- TASKS.md line: — · Doing: — · Files touched: —
- Next step if I stop here: stay available while AGENT-1 lands the DMA data (a question and a
  bug are expected — the first real consumer of a new mechanism is what finds its gaps); then
  the System-Core multi-controller DMA overview table once that data lands (held per main); then
  the print view (§7 P2's last item), only if it reuses `pinoutSvg()`'s renderer cleanly.
- Gates last run: `node tests/run.js "export.test"` 43/43 (was 35/35 at cycle start), `"codegen.
  test"` 80/80, `"clock.test"` 34/34, `"resources.test"` 65/65, `"constraint.test"` 21/21,
  `"analog.test"` 15/15, `"glossary.test"` 9/9, `"signal_groups.test"` 15/15, `"params.test"`
  49/49, `"features.test"` 7/7 (the export-coverage gate is GREEN — no exempted line), full
  `"app/tests"` engine suite 608/608 (was 581/581 at cycle start, +27 across both fixes).
  `node --check` clean on every touched engine file, plus an `import()` smoke test through
  `app/engine/index.js`. `python build.py` NOT run this cycle — nothing painting changed on
  either fix (a generated-C comment's wording, and test files), and `data/mcus/CH32H417.yaml`
  is AGENT-1's live DMA-extraction target throughout.

**Current — 2026-09-14, cycle 9. main's two follow-ups on the DMA mechanism and the export-
coverage gate it exposed, both closed.**

- **The DMA USER ACTION comment (`app/engine/codegen.js` `dmaSection()`, ~line 1823).**
  AGENT-1 checked the shipped comment against `ch32h417_dma.h:23-67` and found it hardcoded to
  every OTHER part's field names (`DMA_PeripheralBaseAddr`, `DMA_MemoryBaseAddr`,
  `DMA_BufferSize`) — CH32H417's own struct does not have `DMA_MemoryBaseAddr` at all; it splits
  the pointer into `DMA_Memory0BaseAddr` + `DMA_Memory1BaseAddr` (a second pointer, for double-
  buffer mode). The comment told a user to fill in a field that does not exist and never
  mentioned the one they need — cosmetic (wrong comment text, not a wrong register write) but
  exactly the class of defect this repo exists to keep out of a user-facing surface.
  **Fixed by deriving the field names from the data, not by hardcoding a second, CH32H417-
  specific string** (main's explicit ask, and the reason the first version was wrong): a
  `doubleBuffer` flag reads whether THIS request's own `defs` (`dmaParamDefs()`) carries a
  `sdk_field: DMA_BufferMode` row — the same fact the data's OWN comment already states
  (`CH32H417.yaml:9391,9665`: "DMA_Memory1BaseAddr … same as DMA_Memory0BaseAddr — see codegen's
  own USER ACTION comment") — rather than a per-part-name list this function would need to be
  told about by hand for the next part that ships the same shape. True today only on CH32H417
  (the only part with a `DMA_BufferMode` channel_param); every other shipped part keeps the
  single-buffer wording unchanged, proven by a planted-break test on CH32V006.
  2 new tests in `app/tests/codegen.test.js`: the existing CH32V006 test gained assertions that
  it names `.DMA_MemoryBaseAddr` and NEVER `Memory0`/`Memory1`; a new CH32H417 test (the first in
  this file to exercise its DMA codegen against the REAL shipped data at all, not a synthetic
  fixture) asserts the reverse. **Seen red on the exact original bug**: stashed the fix, reran —
  `FAIL … names Memory0, the field this struct actually has` — popped, green again.
- **`tests/features.test.js`'s export-coverage floor.** 24 exports across `clock.js` (`pllList`,
  `pllNode`, `pllState`, `tapSources`, `tapSourceEntries`, `tapSourceEntry`, `tapMuxDiv`),
  `codegen.js` (`remapPlan`, `unwritableRemaps`), `constraints.js` (`CONSTRAINT_FIELDS`,
  `gpioFieldLabel`, `constraintActive`, `constraintRegion`, `constraintSentence`, `analogClaim`,
  `gpioEffectiveMode`, `gpioFieldFor`, `normaliseGpioConstraints`), `export.js` (`outputPins`,
  `projectFolderName`), `glossary.js` (`PERIPHERAL_VOCAB`), `model.js` (`defaultSignalPin`,
  `signalGroupOf`) and `util.js` (`isConstParam`) were real mechanisms proven end to end through
  a HIGHER-level caller (`cSource()`, `gpioFieldOptions()`, `signalPins()`…) but never called BY
  NAME from `app/tests` — so a regression in one that its caller happened not to surface would
  have had nothing here to catch it. **Covered with genuine calls against real behaviour, not
  gamed with a comment mention** (the check is a bare-word text scan, so a comment would have
  passed it — that is not what "cover the exports" asked for): 24 new direct-call tests across
  8 files (`clock.test.js` +3, `resources.test.js` +2, `constraint.test.js` +7, `analog.test.js`
  +3, `export.test.js` +2, `glossary.test.js` +1, `signal_groups.test.js` +2, `params.test.js`
  +1), each against real shipped data where one exists (CH32H417's LTDC leg-divider mux and
  UHSIF signal group, CH32V006's ADC/HB bare taps) and a minimal synthetic fixture only where no
  shipped part exercises the shape a function needs (a macro-style `remaps:` entry, a
  `remap_unwritable:` pin — the same fixture patterns already established elsewhere in these
  files, reused rather than invented). **The threshold itself was never touched** — `tests/
  features.test.js` is QA's file and CLAUDE.md forbids lowering a gate to make it pass by name;
  the fix is `app/tests/**` coverage, which is mine. `node tests/run.js "features.test"`: the
  export-coverage test is GREEN with no exemption.
  **One real, pre-existing test-harness gap found and fixed along the way, not routed around**:
  `app/tests/_harness.js`'s `fresh()` resets `PROJECT.variant` but never `.name` (its own long
  comment already documents this exact class of leak for `.variant` and generator options —
  `.name` was simply never covered because nothing before this asserted the bare default across
  a full multi-file run). My first `projectFolderName()` test asserted the untouched 'Untitled'
  default and passed in isolation, then failed in the full `app/tests` run because an earlier
  FILE had already called `setProject({ name: … })` — order-dependent, exactly the failure mode
  `_harness.js`'s own comment warns about. Fixed the TEST, not the shared harness (smaller,
  scoped, and does not risk another agent's concurrent reliance on current `fresh()` behaviour
  mid-tree): it now sets its own name explicitly before asserting anything, with a comment
  naming the hazard for the next person who is tempted to assert the bare default.

Red, and who owns it: **nothing of mine.**

**Current — 2026-09-14, cycle 8. Resumed after a predecessor was killed by a rate limit mid-task
(the third kill of this role today) — its uncommitted work (`clock.js`/`codegen.js`/`export.js`/
`export.test.js`) verified by reading the diffs, `node --check`, an `index.js` import smoke test,
and actually running the tests, then hardened and committed rather than left for a fourth kill to
inherit.**

- **The bug, exactly as main reproduced it**: `clockSummaryMarkdown()` (`app/engine/export.js:521`
  before the fix) printed `v.source`/`k.pre[n]` straight into a template string. `v.source` is an
  ARRAY on any multi-entry mux (USBFS: `/10 from USBHS_PLL_CLK,PLLCLK` — the WHOLE array, not the
  chosen leg), `k.pre[n]` is `undefined` on any bare mux with no `options:` divider at all (RNG,
  I2S2, I2S3, HSADC — `/undefined`), and a leg-divider entry (`{ name, source, div }`, LTDC/ETH1G's
  own shape) stringifies to `[object Object]` when read as a source. **The clock tab itself was
  never affected** — `app/template.html` already resolved both shapes correctly through its own,
  separately-fixed code; this was narrowly the `--format clocks-md` report `codegen.js`'s
  `rccSection()` (the generated-C comment) had ALSO already resolved correctly — the two had
  independently diverged on the same underlying fact, same pattern as the `paramTable()`/
  `paramTableFrom()` split found last cycle.
- **Fixed by one shared function, not by patching the one call site** (main's explicit
  requirement 1): `tapSetting(v, name, k)` (`app/engine/clock.js:137`) resolves the mux leg's own
  display NAME (`tapSourceEntry()`, already used correctly by `rccSection()`) and the tap's OWN
  `options:`-driven divider, each `''` when the tap has none. Both `codegen.js`'s `rccSection()`
  (`:940`, already correct — refactored onto the shared function anyway so it cannot drift back)
  and `export.js`'s `clockSummaryMarkdown()` (`:527`, the actual fix) call the SAME function now.
  Audited every other `.source`/`k.pre[` call site in `export.js`, `codegen.js` and
  `template.html` for the same two-shape hazard (`grep -n "\.source\b\|k\.pre\["`) — no other
  site prints a raw mux array or a raw leg-divider object; `template.html`'s own clock-tree
  renderer already reads `.name/.source` off the resolved entry, not the container.
- **Requirement 2 — the broad assertion, not just the narrow one.** Two new sweep tests in
  `app/tests/export.test.js`: `"no shipped part's clock summary ever contains 'undefined' or
  '[object Object]', on any package"` (every part × package, `clockSummaryMarkdown()` alone —
  the exact symptom) and the wider `"no generated report on any shipped part, any package, ever
  contains 'undefined' or '[object Object]'"`, which sweeps EVERY text file `generateAll()`
  hands the user (generated C, plain pinout, KiCad CSV, pinout SVG, clock summary — the whole
  `reports` option) on every part and package. **Disclosed gap, not implied-away**: both sweeps
  read `generateAll()`'s own text outputs only — neither reaches `template.html`'s live DOM
  rendering, so a defect visible only in a rendered page (not in a generated file's text) would
  not be caught here; that is what real-browser verification is for, not this test.
- **Every new test seen red on its own planted break BEFORE being trusted** — stashed the fix in
  `export.js` (`git stash push -- app/engine/export.js`), re-ran `"export.test"`: the 5 narrow
  tests AND the new wide sweep all failed correctly (`CH32H417 QFN68/88/128 ..._clocks.md:
  contains "undefined"` / `"[object Object]"` for the wide one), popped the stash, green again.
  Quoted red, wide sweep: `1 FAILED, 0 passed` — `no generated report on any shipped part, any
  package, ever contains "undefined" or "[object Object]"` — `CH32H417 QFN68/88/128
  CH32H417_QFN{68,88,128}_clocks.md: contains "undefined"` and `"[object Object]"`, six lines,
  one per part×package×string.
- **Not built this cycle, and said so rather than left ambiguous**: `python build.py` — nothing
  that PAINTS changed (the clock tab already read correctly; this is a text-export function), and
  `data/mcus/CH32H417.yaml` is AGENT-1's live DMA-extraction target, same reason my predecessors
  declined to build on three prior cycles.
- **Also committed this cycle, inherited unchanged from the predecessor's earlier, already-tested
  work**: the worked `embed:` example for `data/FORMAT.md` (posted `agents/BOARD.md`, cycle 7) and
  a correction to its own TODO-wording paraphrase (checked against `codegen.js:1288-1290` directly
  rather than trusted from memory) — both were fully written and verified before the kill, only
  uncommitted.

**Current — 2026-09-14, cycle 7. Three things from main, all closed: the `sdk_manual:` render
check (two real UI defects), the SVG pad tooltip AGENT-3 caught, and CH32H417's DMA — the engine
mechanism for two controllers and a true DMAMUX crossbar, the last real gap on the part.**

- **`sdk_manual:` render check.** main demanded I actually LOOK at the rendered row, not trust
  the mechanism because codegen was already right. Two real defects, both in the UI, neither in
  `codegen.js`:
  1. `getParams()` (`app/engine/params.js`) excluded every `const:` param from Parameter
  Settings on the theory a const is always a struct-field literal with nothing to draw — true
  for OPA's `PSEL`-style consts, false for USBHS/USBSS/USBPD's "Device bring-up" (`const:`
  carrying the row's fixed DISPLAY text for a pure `sdk_manual:` note, no `struct:` at all).
  Those three peripherals' tab read "has no parameters yet" while their generated C carried
  real bring-up instructions. Fixed additively (`!isConstParam(d) || d.sdk_manual`), value read
  through `paramValue()`, `readonly` set to `d.readonly || isConstParam(d)` — a plain const with
  no `sdk_manual:` stays excluded exactly as before, tested explicitly both ways.
  2. The deeper one, found only by checking the actual rendered row rather than stopping at fix
  1: `app/template.html` has TWO hand-duplicated note-builders (`paramTable()`, the peripheral's
  OWN tab — the one main was asking about — and `paramTableFrom()`, used only by DMA Settings)
  despite `paramTableFrom()`'s own doc-comment claiming a change can't land in one and not the
  other. It could, and had — `paramTable()` never read `sdk_note` at all. Closed with ONE shared
  `paramRowNote(r)`, calling the new `manualNoteText(kind, d)` (`app/engine/params.js`) —
  refactored out of `codegen.js`'s `initPlan()` too, so the generated comment and the UI row can
  no longer read two different things about the same fact. Verified live (jsdom, CH32H417/
  QFN128, zero console problems): all four peripherals now show the full register/value/
  `file:line` citation beside the control, not a disabled empty number input under a generic
  "no setter yet" banner. 6 new tests across `app/tests/params.test.js`/`sdk_manual.test.js`,
  each seen red on its own planted break — one break took down 5 tests across BOTH files at
  once, including 2 pre-existing codegen tests, proving the shared function is genuinely
  load-bearing on both sides now, not merely refactored.
- **The SVG pad tooltip (AGENT-3's independent verification).** `pinoutSvg()`'s own doc-comment
  claimed "EVERY physical pin… assigned or not"; the exposed-pad rectangle was the one silent
  exception — drawn, but with no `<title>`. Fixed from `pinRows()`'s own `num: ''` pad row (the
  same row the CSV exports already include): `VSS — exposed pad: GROUND`. 1 new test, planted-
  break-verified.
- **CH32H417's DMA — the mechanism, not the data.** AGENT-1 researched it fully and refused to
  force the crossbar into the existing fixed-table shape — right, because that would have
  misrepresented one shared 16-channel DMAMUX as 16 separate identical tables. `dma:` may now
  be a LIST of controllers, each optionally `mux:`-shaped (ANY of N named requests onto ANY of
  its own channels, via a real `DMA_MuxChannelConfig` call codegen had never emitted before) —
  additive, the single-object shape all five existing parts use is untouched, proven by every
  pre-existing DMA/codegen/resources test passing with zero edits. `dmaControllerFor(channel)`
  resolves which controller owns a GLOBAL channel number, so a request never carries a second
  `controller:` field — the same "resolve it, don't duplicate it" rule a pin's owner already
  follows. Codegen's channel-macro substitution, per-controller clock enables (once each, never
  doubled), and the mux call itself were all checked against the REAL SDK header
  (`ch32h417_dma.h:284`, `:246-261`) and two real EVT examples read end to end, not guessed —
  including the named-macro argument form (`DMA_MuxChannel7`, not a bare `7`) the vendor's own
  code actually uses. UI (`app/template.html`) generalised too: the Add dropdown, the per-
  request struct panel, and the Tools-tab diagnostics all read through the engine's own
  multi-controller-aware functions instead of `M.dma` directly. **One real bug found while
  smoke-testing the actual render, not the happy-path tests**: two mux controllers sharing the
  same request name (CH32H417's real shape — the same catalogue on DMA1 and DMA2) produced two
  identical, indistinguishable options in the Add dropdown; `dmaAllRequests()` now dedupes.
  11 new tests, every one seen red on its own planted break. **Disclosed, not hidden**: the
  System-Core "every channel at once" overview table stays fixed-table-only for now — it simply
  never renders for a multi-controller part (safe, not wrong), while the actual per-peripheral
  configuration surface is fully generalised and tested. Full data-side contract posted to
  `agents/BOARD.md` for AGENT-1.
- **Also found, and closed as far as I can close it**: `data/FORMAT.md` documents `dead_fields:`
  (already corrected by AGENT-1) but has NO section at all for `codegen.init_structs.
  <inner-struct>.embed` — a real, shipped, tested mechanism (FMC's nested-struct shape) with
  zero worked example in its own contract file. `FORMAT.md` is AGENT-1's file; the worked
  `embed:` example (real FMC data, verified against the shipped, tested mechanism — not
  invented for the write-up) is posted to `agents/BOARD.md` for AGENT-1 to paste in.

Red, and who owns it: **nothing of mine.** `tests/codegen_compile.test.js`'s two CH32H417
fixture-staleness failures are pre-existing (confirmed by stashing every file I touched this
cycle and re-running — the failures persisted unchanged), caused by AGENT-1's own landed data
commits outrunning the checked-in fixtures; not something I introduced or need to fix.

**Current — 2026-09-14, cycle 6. `main` tested my previous cycle's KiCad CSV from the command
line and found it unreachable — fixed, then applied the lesson to the pinout SVG before building
it, per main's explicit instruction, rather than shipping the same gap twice.**

- **The finding, read plainly first.** `node tools/wchcube_cli.js CH32H417 --package QFN128
  --format all --out <dir>` wrote seven files; `CH32H417_QFN128_kicad_pins.csv` was not one of
  them, and `grep -n kicad tools/wchcube_cli.js` returned nothing. `kicadPinCsv()` was real,
  tested, and correct — reachable only through `generateAll()`/`projectFiles()`, the Generate
  button's own path, never through the CLI's `FORMATS`/`outputs()`. A feature that only a browser
  session can reach is not the headless deliverable the owner asked for.
- **Fixed**: `pins-kicad` added to `tools/wchcube_cli.js`'s `FORMATS` (`:29`) and `outputs()`;
  `--format all` picks it up automatically (`FORMATS.filter(f => f !== 'json')`, no second list to
  forget). 2 tests in `app/tests/cli.test.js`, both seen red against the pre-fix code (removing
  the `FORMATS` entry and the `outputs()` case both independently fail the reachability test; the
  `--format all` test fails on the entry alone) before being trusted, then restored green.
- **The pinout SVG landed the SAME cycle, and its whole design answers the question main asked me
  to check first: can the CLI reach this from day one?** Yes, because it is not a port of the
  canvas's live DOM renderer (`app/template.html`'s `renderChip()`/`exportSvg()`) at all — that
  one depends on a browser to MEASURE text in (`fitSvgTexts()` reads real glyph widths off a
  rendered `<text>`) and on the page's own `<style>` sheet for `var(--x)` colours, neither of
  which exists headlessly. `pinoutSvg()` (`app/engine/export.js`) is a second, independent,
  self-styled renderer built from `pinRows()` and the package geometry alone (the PURE half of
  `layout()`/`labelRoom()`, ported; the live view's rotate/mirror dropped — `U.rot`/`U.flip` is
  UI-only chrome with no "current" value for a one-shot export). Verified across both package
  shapes (quad-with-exposed-pad, dual), and that it carries an assigned pin's signal/label, marks
  a conflict, and marks a `remap_unwritable:` pin "planning only" rather than hiding it — same
  three-constraint contract the KiCad CSV met.
  **A real coverage gap found and closed before shipping, not a hypothetical one**: my first
  planning-only test asserted only the tooltip text ("planning only"); deleting
  `svgPinColors()`'s planning-only branch entirely left that test GREEN, because the colour and
  the tooltip are built by different code paths and only the tooltip was checked. Added the colour
  assertion, watched the same deletion turn it red, restored. Documented the miss in the test's
  own comment rather than letting the fixed version imply the gap was never there.
  Wired into `generateAll()`/`projectFiles()` (all four call sites) AND `tools/wchcube_cli.js`'s
  `FORMATS`/`outputs()` in the SAME commit the function is introduced in.
- **Verified in the real built bundle, not only in the engine's own tests** — jsdom-booted
  `dist/index.html` (`tests/lib/app.js`'s `boot()`; honestly not a real Chrome/CDP session, said
  plainly rather than overclaimed) against CH32H417/QFN128: the Project Manager's file list
  carries both `_kicad_pins.csv` and `_pinout.svg`, zero console problems, and `pinoutSvg()`
  called in-page produces the exact byte length (54847) the standalone Node engine call does — the
  CLI, the browser bundle and the barrel agreeing, the same guarantee the plain pin table already
  had.
- **7 new tests total**, all seen red on their own planted break first: 2 in `cli.test.js`
  (KiCad reachability + `all`), 3 in `export.test.js` (XML well-formedness/part-package; both
  package shapes; assigned/conflict/planning-only content incl. the colour check above), 2 more in
  `cli.test.js` (SVG reachability + `all`). File-count assertions in `export.test.js` and
  `pinmap.test.js` updated for the new file, each checked to fail first with the old count.
- **`dist/index.html` intentionally not committed** — rebuilt once to run the jsdom check above,
  but `data/mcus/CH32H417.yaml` was uncommitted (AGENT-1, concurrently editing) at build time, so
  the fresh build is not safe to ship under my commit: exactly the "a rebuild re-bakes another
  agent's uncommitted data" mechanism main named when accepting my previous cycle's judgement call
  not to build at all. Left modified, uncommitted, in the working tree; the next agent who needs a
  current `dist/index.html` rebuilds once the tree is settled.

**Current — 2026-09-14, cycle 5. Resumed after a predecessor was killed by a rate limit mid-task;
verified its uncommitted work by reading the diffs and running the tests myself, then closed the
one real gap in it before committing.**

- **Verified, not trusted: `node --check` on every touched engine file, plus the barrel import
  (`app/engine/index.js` re-exports `export.js`, so `eng.kicadPinCsv()` reaches the test harness
  with no extra wiring) — clean, then ran the actual test suites rather than stopping at "it
  parses."**
- **Item 2 (a per-package default for `signal_groups:`) was already fully built and already had
  both required tests** (explicit choice beats the package default; the default does not survive
  onto a package that lacks it, checked in both directions on a live package switch) — read the
  mechanism in `app/engine/model.js:319` (`groupDefaultIndex()`), confirmed it is read inside
  `signalPins()` only when a signal has no stored explicit pin (so it cannot outrace
  `remaps:`-style write-on-switch), and left it as landed. Nothing to add.
- **Item 3 (the KiCad CSV) was built but its three stated constraints were only two-thirds
  tested** — the code already stated the package in a header comment and already marked
  `remap_unwritable:` pins "planning only" via `unwritableRemaps()` (a function my predecessor
  had already hoisted out of `codegen.js`'s `gpioSection()` for exactly this reuse), but no test
  read the CSV back, and no test exercised the planning-only marking at all. **Both closed**:
  `app/tests/export.test.js` gained a quote-aware CSV line parser and two tests — one round-trips
  an assigned pin's signal/label/name through the exported CSV and checks the header names the
  part AND the package, the other proves a `remap_unwritable:` pin (the same fixture shape
  `app/tests/resources.test.js` already uses for the codegen side of this mechanism) is exported
  rather than dropped, with its Notes column saying so. **Both seen red on a planted break before
  being trusted**: zeroing `pinRows()`'s `planningOnly` flag failed the planning-only test;
  stripping the part/package out of the header comment failed the round-trip test. Restored,
  green. `node tests/run.js "export.test"` 32/32 (was 30/30 before my two additions).
- **What I did not need to touch**: `app/engine/model.js`, `app/engine/codegen.js`,
  `app/engine/export.js`'s actual mechanism, `app/tests/pinmap.test.js`,
  `app/tests/signal_groups.test.js` — all my predecessor's, all read line-by-line, none needed a
  fix. The only real gap was test coverage, not behaviour.
- **`data/FORMAT.md`'s `signal_groups:` section is now stale** — it still says "every member
  defaults to index 0 together" with no mention of `remap_by_package`. Not mine to edit
  (AGENT-1's file); flagged on `agents/BOARD.md`.

Red, and who owns it: **nothing.** `dist/index.html` in the working tree already reflects the
mechanism (my predecessor rebuilt it before stopping) but I did not rebuild again — nothing under
my ownership changed behaviour this cycle, only test coverage, so a rebuild would have been pure
waiting and would have re-baked AGENT-1's own uncommitted `data/mcus/CH32H417.yaml` into a build I
have no reason to ship under my own commit.

**Current — 2026-09-13, cycle 4. §7's first item: the tree by keyboard, and two contrast bugs
nobody had measured.**

- **The peripheral tree, keyboard alone.** Every row was already individually tabbable
  (`role="button" tabindex="0"` on all ~80 of them on CH32H417) — operable per WCAG 2.1.1, but
  not USABLE: a keyboard-only user had to press Tab up to 80 times to get past the tree to reach
  anything else. Converted to the ARIA APG "tree view" pattern — a roving tabindex, same idea the
  chip canvas already uses its own version of (one tab-stop, arrow keys move), but built on the
  tree's REAL per-row DOM elements rather than the chip's virtual-focus model, since the tree
  already had real, individually-focusable rows to roving-manage rather than a single canvas to
  paint a fake cursor onto.
  `TREE.focus` (the one row key with `tabindex="0"`) and `TREE.rows` (the flat, ordered,
  currently-VISIBLE row list — headers plus un-collapsed children, rebuilt every `renderTree()`)
  are new state beside the existing `TREE.sort`/`TREE.enabledOnly`. `#cats`'s keydown handler
  (extended, Enter/Space on an item unchanged) adds ArrowUp/Down (move), Home/End, ArrowRight
  (expand a collapsed category or step into its first child), ArrowLeft (collapse — focus stays
  on the header — or step out to the parent header from an item). `paintTree()`'s existing
  "restore focus after innerHTML" guard is widened to recognise a category header too, and still
  only fires when focus was ALREADY in the tree before the render — typing in the search box
  must never yank focus into the tree, and did not before this either.
  Verified live in Chrome (`tests/lib/browser.js`) on CH32H417: exactly one `tabIndex===0`
  element at rest; ArrowDown/Up walk `TREE.rows` in order (GPIO → NVIC → CRC → back to NVIC,
  checked); Enter sets `S.sel`; ArrowLeft/Right (un)collapse with focus staying on the header;
  console silent. `node tests/run.js "tree"` 16/16, `"features"` 7/7, `app/tests` full 524/524,
  `"legibility"` 8/8, `"layout"` 20/20 — all unaffected, none of them needed to change.
  **Not written: the permanent regression test.** The manager's instruction was explicit —
  coordinate with AGENT-3, do not write `tests/**`. Full contract (the exact state shape, the key
  bindings, a planted-break recipe mirroring the chip's own `ARROWS`-emptying plant) posted to
  `agents/BOARD.md` 20:45Z, addressed to AGENT-3.
  **Deliberately not done**: no ARIA role rewrite (`.item` keeps `role="button"`, headers stay
  plain `<button>`s rather than becoming `role="treeitem"`/`"group"`). That is a bigger, riskier
  semantic change than "make it keyboard-operable without 80 tab-stops," and I did not read the
  ask as asking for it — said so on the board rather than guessing either way.

- **AA contrast, both themes, measured — not asserted — and two real failures found.** Built a
  real-browser contrast probe (same relative-luminance/composited-background maths
  `tests/legibility.test.js`'s own SVG contrast check uses, applied to the tree's plain HTML
  instead of SVG text) and ran it over every `.item`/category-header/badge class combination in
  both themes on CH32H417.
  **`.item.selected`** (white text on `var(--blue)`) — **3.54:1 light / 2.81:1 dark**, both under
  AA's 4.5:1. The SELECTED peripheral — the single most important state in the tree — had WORSE
  contrast than an ordinary unselected row (7.21/6.88:1). Fixed by switching to `var(--blue-hdr)`,
  which this app already uses everywhere else for exactly this "selected/active, white text"
  pattern (`.treebar .seg button.on` sits right next to this rule in the same toolbar; so do
  `.tab.active`, `.gen`, `.pmgen button`) — not a new colour, a dropped consistency. Now
  **5.14:1 / 5.49:1**.
  **`.item.selected .cnt.res`** (a shared-resource-conflict badge on a selected row, dark theme
  only) — **2.37:1**. The rule forces the badge onto a literal white background but kept
  `color:var(--res)`, and dark theme's `--res` (`#a79cff`) is calibrated for the dark PANEL, not
  for white. Fixed with a theme-INDEPENDENT ink (`#5a4fcf`, light theme's own `--res` value,
  which is what the background actually is here in both themes) — **6.08:1** now, confirmed by
  injecting the real markup shape into a live page and measuring the actual cascade rather than
  computing hex values by hand alone (I did both, and checked they agreed).
  Everything else already measured well clear of 4.5:1 in both themes and none of it touched:
  plain `.item` 7.21/6.88, `.st.ok` 5.48/6.87, category headers 17.04/12.06, the two badge
  classes unselected 7.68/6.29 and 6.08/7.05.

Red, and who owns it: **nothing.** `python build.py` run twice this sub-cycle (told on the board
each time) — once after the keyboard mechanism, once after the two CSS contrast fixes, both
verified in a real browser before moving on.

**Current — 2026-09-13, cycle 3. The last engine piece of the round's exit criterion, plus a small
hook for AGENT-3.**

- **P0 — a mux entry that carries its own divider.** The case: CH32H417's LTDC choice 01 is
  "SERDES_PLL clock divided by 2" (RM:4085-4089), not a bare source; STATUS §2 D said four of the
  seven remaining muxes need it. A `source:` LIST entry may now be an OBJECT `{ name, source, div }`
  — the same shape a PLL's own `inputs:` entries already use — instead of a bare string. Provably
  backward compatible, not merely argued: a plain string entry normalises to
  `{ name: s, source: s, div: 1 }`, so USBFS (the only mux actually shipped) is unaffected, checked
  directly in `app/tests/clock_mux_leg_div.test.js`'s last test and by the full 26-test
  `clockmux`/`clockmux_ui` suite staying green throughout, including the real CH32H417 check.
  `app/engine/clock.js` gained `tapSourceEntries()`/`tapSourceEntry()`/`tapMuxDiv()` beside the
  existing `tapSources()`/`tapSource()` (whose return semantics did NOT change — still the
  underlying source, never the leg's divider — so the tree's edge-drawing and topology code needed
  no change, only `clockCalc()`'s frequency math gained the extra division). `codegen.js`'s
  `rccFill()` now keys the RCC register value on the CHOSEN LEG'S OWN NAME rather than the bare
  source, because two legs can share one source with different built-in dividers and only the name
  tells them apart — for every existing mux this is the exact same string as before (name ===
  source). `app/template.html`'s edge-drawing resolves through `.source` now, not the display name
  (a leg's label, "SERDES_PLL /2", is not itself a graph node); `preSel()` draws nothing for a tap
  whose only divider is its mux, rather than the actual bug this shape exposed — `[...v.options]`
  on an absent `options:` THROWS, a real crash the old code had simply never been asked to survive.
  6 tests, `node tests/run.js "clock_mux_leg_div"`. Planted break seen red on the pre-mechanism
  engine: `git stash` `clock.js`/`codegen.js`/`template.html` to `913aeb6` — **5 of 6 fail**, one of
  them the `v.options is not iterable` crash quoted above, not merely a wrong number. Restored, all
  green. Verified in a real browser (this paints): a synthetic two-leg mux spliced in at runtime —
  both legs draw, no empty divider select, switching legs recomputes the value live (48 MHz → 300
  MHz on the same part), console silent. Full regression: `app/tests` 524/524, `strict` 25/25,
  `codegen_compile` 18/18, `clockmux` 26/26, `legibility` 8/8, `layout` 20/20. Worked LTDC example
  posted to `agents/BOARD.md` 20:10Z, with the caveat that only the muxes whose OWN RM table says
  "divided by N" need the object shape — the rest of the seven may just be bare-source lists.
- **`data-test="pin-user-label"` hook**, for AGENT-3's deliverable B gap
  (`tests/evidence/round6/2026-09-13-gates-without-a-plant.md:22-28`): the pin-label renderer's
  `<tspan class="userlabel">` (`app/template.html`, the chip SVG label pass) carries
  `data-test="pin-user-label"` now, with a comment marking it a TEST CONTRACT distinct from the
  styling class, so a future refactor renaming `.userlabel` does not silently break the anchor
  again. Verified present in a real browser after setting a label and re-rendering.

Red, and who owns it: **nothing.** `python build.py` run three times this cycle overall (told each
time) — twice for the mux-divider work (before/after measuring), once more after the data-test
hook to confirm it in a real browser.

**Current — 2026-09-13, cycle 2. Six more items, and the round's own rule caught ME once
mid-cycle: I made a decision, measured it, and it was wrong.**

- **P0.5, channel_params with MORE THAN ONE struct per instance** (SAI/SERDES, manager-relayed
  from AGENT-1). NOT `embed:` — deliberately a different mechanism, because it is a different
  shape: `embed:` is for a struct reached only through a pointer inside another, with no function
  of its own; SAI's `SAI_InitTypeDef`/`SAI_FrameInitTypeDef`/`SAI_SlotInitTypeDef` are each taken
  directly by their own SDK function and simply share one instance's handle. No new schema: a
  `channel_params.params:` row may now carry `struct:` exactly like an ordinary `params:` row
  already can; a row naming a struct other than the block's primary one gets its own block,
  applied by `codegen.init_structs.<that struct>.fn` — the same global table every non-channel
  struct uses — because a secondary struct's function does not vary by instance the way the
  primary struct's may. 5 tests, `app/tests/channel_multi_struct.test.js`, planted break seen red
  (`git stash` to `3201a9a`: 4 of 5 fail; the 5th — backward compat with the six shipped
  single-struct blocks — correctly stays green both sides). Worked SAI example posted to
  `agents/BOARD.md`.
- **`sdk_manual:`.** `sdk_none:` said "the SDK exposes nothing for it" even when it does and is
  merely unsafe to call from this generator's init function — CH32H417's five UHSIF params are in
  exactly that shape TODAY. `sdk_manual: true` says the true thing: `"<name> = <value> — set by
  firmware<: note>"`. Checked before `sdk_none` in `initPlan()` so the two can never conflict. 4
  tests, `app/tests/sdk_manual.test.js`, planted break seen red (2 of 4 fail pre-mechanism).
- **codegen.js read-through, items 2-6**, my own standing backlog, manager-assigned in order:
  - **2**: the ENGINE half of `isFixture()` reading `mcu.fixture: true` was already landed
    2026-09-11 — I found this out by reading the code, not by assuming the backlog line was
    current. What is still open is the data half; posted as a two-sided REQUEST (AGENT-1: bless it
    in FORMAT.md; AGENT-3: set it on the actual fixture).
  - **3**: `gpioPlan()` silently dropped an io pin whose name is not `P<letter><digits>`. Fixed:
    `unparsedGpioPins()` names every one and its signal in a TODO instead. 5 tests,
    `app/tests/unparsed_gpio.test.js`, planted break seen red (4 of 5 fail pre-mechanism).
  - **4**: `structVar()` assumed every struct typedef ends in `TypeDef`; one that does not now gets
    `_var` appended rather than becoming `Foo Foo = {0};` (invalid where a peripheral has two such
    structs). Inert on every real struct today — proven with a synthetic one, since the
    read-through found no real example. 1 test, planted break seen red.
  - **5**: `GPIO_Pin_<n>` is still the one SPL macro this generator invents without the data's
    permission. Recorded, not changed — no data anywhere needs anything else, and inventing a key
    with nothing to check it against is exactly "a name nobody compiled is a guess" one field over.
  - **6**: RCC word gaps stay comments, not TODOs — but only after I shipped the OPPOSITE decision
    first and **measured it wrong**. Made `put()`'s "no encoding for X" a TODO on the theory it was
    narrower/safer than `rccWords()`'s "not written". Ran `node tests/run.js "codegen.test"`: **6
    FAILED.** CH32V006's real ADC prescaler is exactly that case, ON PURPOSE —
    `data/mcus/CH32V006.yaml:2291-2294` says outright the generator is meant to report "no
    encoding for 1" until a second field is also modelled. Reverted. The regression guard is now a
    test using CH32V006's REAL data as the proof, not a synthetic stand-in it could pass by
    accident. **The lesson, plainly: "make the decision" is not "make A decision" — the tree
    itself was the check, and I only trusted it because I ran the suite before calling it done
    rather than after.**
  - **7**: `codegen.rcc.pllsrc` cannot express CH32H417's SYS-PLL input, which is a SOURCE AND A
    DIVIDER in one register field. FILED to AGENT-1 as a FORMAT question with two candidate shapes,
    not shipped as an engine change — this is a cross-agent schema call, not mine to make
    unilaterally, exactly as instructed.
- **The font-fallback finding (§3, 23:04Z), partial.** `#mcu-meta`'s text shortened
  ("960 KB flash · 896 KB SRAM" → "960K flash · 896K SRAM") — provably narrows the 181px-in-168px
  gap the finding measured (a strict substring, same font), not provably closes it: no Linux box
  or fallback font here to re-measure against. Flagged, not claimed.

Gates run across the whole cycle: `node tests/run.js "app/tests"` 517/517, `"strict"` 25/25,
`"codegen_compile"` 18/18 (all 8 fixtures, both CH32H417 packages, `pio run` SUCCESS),
`"clockmux"` 26/26 (incl. a new test against CH32H417's REAL shipped USBHS_PLL data — AGENT-1
landed it this cycle, `ff7d48d`, through both the P0 and P1 mechanisms above — 480 MHz / 10 = 48
MHz, in a real browser, no overflow, no overlaps, console silent), `"legibility"` 8/8 (first real
sweep of a shipped part with `plls:` — the exact gap that let round 6's original defect through).
`python build.py` run twice this cycle (P0.5+item-6 changes, then the font-fallback text change),
told here per the standing rule.

Red, and who owns it: **nothing.**

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

**IN FLIGHT** — holding the full suite for a settled tree, per main's repeated instruction
(checked and held three times this cycle: `git status` showed uncommitted `data/mcus/CH32H417.yaml`,
`app/engine/*.js`, `app/template.html` each time).
- TASKS.md line: — · Doing: nothing else queued until the suite runs; `git status` polled, not
  looped, between other work.
- Files touched (this wait): none.
- Next step if I stop here: `git status` — if clean (or only files outside `data/`/`app/` remain
  uncommitted), run `node tests/run.js` in full, report the EXACT line it prints on the board and
  in §1, and only then decide whether anything closes. Do not guess the count from what "should"
  have landed.
- Gates last run: see Current below, `ef2da4f`.

**Current — 2026-09-14T09:55Z. §1 fully re-measured and rewritten (this commit) — it had drifted
badly (`params:` read 40 of 78, should have been ~62-67 across the cycle; collisions read 4·0·0,
actually 0·0·0; the clock row hadn't been touched since the USBHS_PLL landing). Also today: built
the cross-loader gate, generalised the DMA finding into its own gate, verified Deliverable C's
whole params-verification bullet and both of AGENT-2's exports end to end.** Full detail is on
`agents/BOARD.md` under today's timestamps (07:00Z onward) and in
`tests/evidence/round6/2026-09-14-h417-pin-verification.md`'s addenda; the summary:

- **Cross-loader gate** (`tools/cross_loader_check.mjs`, `tests/cross_loader.test.js`): every
  Python gate in this repo validates YAML 1.1 (`yaml.safe_load`); the app ships YAML 1.2
  (`js-yaml`) — the two disagree on `On`/`Off`/`Yes`/`No`/sexagesimal scalars, and nothing checked
  that before today. Found 2 real divergences across all 7 files (`data/mcus/*.yaml` +
  `packages.yaml`); AGENT-1 fixed both by quoting. `KNOWN_DIVERGENCES` empty, staleness check live.
- **ABSENT-citation gate**, generalised from a single DMA finding into a standing check: does an
  `ABSENT` exemption's cited location actually resolve, for every part the entry excuses (not one).
  Found 5 stale citations across the whole table; 3 adjudicated and fixed with AGENT-1 today
  (`PIOC.params`, `EXTEN.clock` split per-part), 2 still open and RED on purpose
  (`DMA1.params` — real gap; `EXTEN.nvic` on L103/V003 — rule confirmed true, citation not yet
  written). Two real bugs in the check itself found and fixed before trusting the first run
  (missing peripheral-existence gating; a naive "file not found = lie" check that would have
  falsely flagged the genuinely real `ch32v00X.h`).
- **CH32H417's 11 non-routing cells**: checked every one against its own header before any ABSENT
  declaration. 5 genuinely absent (CRC, DBGMCU, HSEM, RNG, TKEY). 6 were real, unmodelled gaps —
  reported instead of declared away; AGENT-1 landed 5 of them as real params (`IWDG`/`WWDG`/`PWR`/
  `FLASH`/`GPHA`) and confirmed the 6th (`DMA2`, alongside `DMA1`) is blocked on the engine gap
  above. This correction is why the routing/params numbers in §1 moved as much as they did.
- **Deliverable C, both bullets independently verified**: routing `params:` at zero-owed, and
  every parameter across the previously-unverified set (ETH's 26 fields, DFSDM, the 4 USB
  declarations, DAC, RTC, CMP, OPA) traced to real generated C, not just read off the YAML —
  including independently diffing the two `driver_c:` files' `ETH_RegInit` bodies myself rather
  than trusting the comment that said they were identical.
- **AGENT-2's KiCad CSV + pinout SVG**, all four angles: CLI reachability, package labelling,
  planning-only pins (forced the real `remap_unwritable:` SDMMC case rather than trusting the code
  path ran), round-trip. Three clean; one real, narrow SVG gap found (the exposed-pad tooltip,
  above) and sent to AGENT-2.

**Current — 2026-09-13T20:15Z. §5.1 (CI), steps 1-4, and a process mistake of my own found and
fixed in the same check.**

- **Found my own two most recent commits (`913aeb6`, `0f259c7`) had never been pushed.**
  `git status -sb` read `ahead 2` — I had been committing but not pushing since the §5 partial
  dry-run. That means CI had never seen either, and — the part that actually matters — anyone
  else reading `origin/main` (including AGENT-1/AGENT-2, mid-cycle in the shared tree) could not
  see my STATUS.md corrections or `keyboard_ui.test.js` either. Pushed immediately
  (`593a82e..0f259c7`); the README's "commit small, straight to `main`, **push**" is the rule I
  had stopped following without noticing, three commits in.
- **The GitHub Actions REST API is reachable unauthenticated for this public repo**
  (`api.github.com/repos/arwidcool/WCH_Cube/actions/runs`) — no `gh` CLI on this box, so used
  `curl` directly. Raw job LOGS need admin rights (403'd); run/job STATUS and per-step
  STATUS/CONCLUSION do not, and that was enough for steps 1-4.
- **Run 66 (`448b628`) is a completed FAILURE** — `build + tests` failed at `dist/index.html is
  up to date`, skipping the rest of that job's steps (`firmware + generated project` and
  `tauri shell` still passed on the same run). A stale committed build, the exact recurring class
  `2026-09-12-ci-30-failures.md` already names.
- **Run 67 (`593a82e`) is a completed, fully-green success** — every step, all three jobs,
  including `Coverage ledger` printing `6 of 6` and a real PlatformIO compile (not a skip) in
  `firmware + generated project`.
- **Most commits between 66 and 67 have no CI run at all**, and this is a structural finding, not
  a gap in my search: GitHub triggers `ci.yml` once per `push` event, on the push's final commit —
  a multi-commit push leaves every earlier commit in it unread by CI. Checked directly
  (`?head_sha=<full 40-char sha>`) for `3bfc9e5`, `ff7d48d`, `668a315`, `ceb9b46`: zero runs for
  each. The commit list and the CI-verified list are NOT the same list.
- **`DECISION | worktrees ON` — checked and NOT posted.** One completed green run (67) is not
  three; the nearest three-commits-by-author-in-a-row includes a completed RED (66); and my own
  commit (68) is still in progress. Full reasoning in §2 A.
- **PROGRESS.md and STATUS.md §1 updated** to carry this rather than leave the 2026-09-12 "CI IS
  GREEN" record looking like an unbroken streak it was not.

**Current — 2026-09-13T20:06Z. B's keyboard gap closed for real, in an actual browser — the
jsdom objection on record no longer applies because nothing here is jsdom.**

- **`tests/keyboard_ui.test.js`.** The evidence file said a plant for arrow keys/Enter/Delete
  "would test jsdom's key-event plumbing, not the app." Answered rather than restated: dispatches
  a genuine `KeyboardEvent` at `window` inside a real Chrome/Edge tab over CDP
  (`tests/lib/browser.js`) — the app's own `window.addEventListener('keydown', ...)` cannot tell
  a dispatched event from an operator's keypress, so only the INPUT SOURCE was ever jsdom's, and
  this removes it. Two real checks first (arrow-key focus movement, Enter-opens-picker /
  Delete-clears), THEN two planted breaks on copies of `dist/index.html`
  (`tests/lib/mutant.js`'s `withMutantDist`, tree untouched): emptying `const ARROWS = {...}`
  leaves `U.focus` at `null` after `ArrowDown`; neutering the `Delete`/`Backspace` branch's
  `resetPin()` call leaves an assigned pin's state unchanged. Both watched red before being
  trusted. Found two bugs of my own along the way, not the app's: `assert.deepEqual` does not
  exist on this harness (`tests/lib/harness.js` only has `.deep`), and `E.pins[canon(pin)]` has
  NO entry at all for an unclaimed pin — `pinState()` (`tests/lib/app.js`) already falls back to
  `'unused'` for exactly that reason, and my first draft forgot to. Fixed both, not the app.
  `node tests/run.js "keyboard_ui"`: 4/4. Evidence file and §2 B updated for this one row; the
  label-renderer row stays open, so **B is not tickable yet** — one of two gaps closed.

**Current — 2026-09-13T19:45Z. Two §7 backlog items closed for real, both against the live
engine, and one found the engine more precise than expected rather than broken.**

- **`tests/hostile.test.js` — the hostile fixture, five properties, one peripheral/pin/pair each
  so a failure in one can never mask another.** Read the real engine source first rather than
  guessing expected behaviour: `compute()`'s claim/canon mechanism for the shorted-pin case,
  `isAvailable()`/`status[pid]` for the no-usable-mapping case, `clockCalc()`'s `over`/`under`
  population for the clock case, and `engine.js`'s constraint-check block (the one that reads
  `gpioEffectiveMode()` and pushes `constraintSentence()` onto the owning peripheral's issues) for
  the last case — every assertion targets a real, named function, not a guess at what "should"
  happen. Result: **all five pass against today's engine.** One of them (no usable mapping)
  corrected my own first-draft assertion: I expected `status: 'warn'`, the engine actually reports
  the more precise `'na'` (`isAvailable()` checks every choice's signals before `compute()` ever
  runs) — verified that is the RIGHT answer by reading `isAvailable()`, not asserted around to make
  the test pass. Two of the five (shorted pins, the constraint) watched fail for real before being
  trusted: un-shorting the pin pair turns the conflict test red (`'set' !== 'conflict'`); moving
  the constraint's `not_on:` to a pin nothing claims turns the constraint test red (empty issues
  array). **No board entry — nothing in `app/engine/**` was found wrong.** The fixture stays as a
  permanent, isolated (`registerMcuFile()`, never written to `tests/fixtures/mcus/`) regression
  guard for exactly the REFUSE/WARN half of "every choice must be one the silicon can honour" that
  had no test before.
- **`tests/perf.test.js` — `compute()` and a full render, timed for real on the largest REAL
  package, derived not hardcoded.** Swept every `data/mcus/*.yaml` for the biggest `_phys[pkg]`
  (today: `CH32H417`/`QFN128`, 129 pads — `WCH-DUMMY32-C8` excluded on purpose, the same filter
  `glossary.test.js`/`power.test.js` use, because this suite asks what a real user's machine has to
  do). Measured on this box before writing any threshold, so the number is not invented:
  `compute()` p50 0.3 ms over 200 runs (budget 5 ms, ~17x headroom); `renderAll()` in jsdom p50
  ~40-50 ms over 30 runs (budget 100 ms, ~2x headroom) — stated explicitly as a jsdom number
  (`boot()` has no layout engine, `getBoundingClientRect()` is faked) and NOT claimed to represent
  real-browser paint time, which is `tests/lib/browser.js` territory, not this file's. Machine and
  full min/p50/p95/max logged on every run, asserted on p50 only — the round-4 "threshold nobody
  could reproduce" defect is exactly what stating the machine and the real numbers is for. Both
  budgets watched fail (set to 0.01 ms) before being trusted, then restored.
- **Answered a REQUEST addressed to me the moment it landed** (AGENT-1, TASKS.md, PIOC's `params:`
  ABSENT declaration): added the one `ABSENT` line verbatim to `tests/completeness.test.js`,
  `node tests/run.js "completeness"` ALL GREEN (15 tests), owed-cell count moves 33→30 as a side
  effect of PIOC leaving the "open" pool. TASKS.md line ticked in the same commit.

Red, and who owns it: **nothing found in `app/engine/**` this cycle** — both new suites pass
against the real, unmutated engine as it stands today. Gates run: `node tests/run.js "hostile"`
5/5, `"perf"` 2/2 (numbers above), `"completeness"` 15/15, `"layout orientation"` 4/4 (re-checked
after AGENT-1/2's latest commits landed). **Not run: the full suite** — still held by `main`.

**Current — 2026-09-13T19:05Z. B's remaining half is closed, the two P1 findings addressed to
me are fixed, and the anchor guard found a real bug while fixing it.**

- **The planted-break sweep over `app/tests/**` — the junctioned-ROOT plan I inherited from the
  stopped session does not work, and I proved it before writing the real version.** Node's ESM
  loader realpaths every module it loads by default: a file reached through a Windows junction
  reports its REAL path as `import.meta.url` regardless of the path used to reach it (measured
  with a throwaway junction and a two-line importer before touching this file — the junction
  trick `tests/lib/mutant.js` already uses for `dist/index.html` copies is fine there because it
  mutates a single self-contained HTML file, never a module graph). A junctioned
  `app/tests/_harness.js` would have realpathed its own `import * as eng from '../engine/index.js'`
  straight back to the REAL, unmutated engine — the whole sweep would have been a no-op mutator
  that still printed green, which is the exact failure mode this deliverable exists to prevent.
  `tests/lib/enginemutant.js` instead makes a REAL, recursive, mutated copy of `app/engine/` under
  a fresh temp root, junctions only `data/`, `tests/` and `app/vendor` (plain `fs.readFileSync`
  reads and leaf modules that never need to see the mutation are transparent through a junction —
  confirmed separately), and real-copies `app/tests/_harness.js` plus the one target test file (and
  `tools/wchcube_cli.js` for `cli.test.js`) so their relative imports land on the mutated copy.
  `tests/lib/enginemutant_run.js` runs that one file's own tests in a fresh child process.
- **27 files, not the 9-17 last counted** — the directory grew while this row sat open
  (`nested_structs.test.js` landed mid-cycle, AGENT-2's). Swept all 27: 22 with a targeted
  one-line mutation of the `app/engine/*.js` function the file actually exercises (verified by
  reading each file's own assertions first, not guessed); 4 (`glue`, `clockmux_ui`, `tree`,
  `layout`) mutate a COPY of `dist/index.html` instead via `tests/lib/enginemutant.js`'s
  `withMutantDist()`, because they `boot()`/`withPage()` the built bundle rather than importing
  the engine live — a mutated engine copy is invisible to them.
  `node scripts/plant_app_tests.js`: **CAUGHT 27 · MISSED 0 · COULD-NOT-RUN 0**. The one real
  miss along the way: `export.test.js`'s first mutation (blanking `pinMapHeader()`'s text in
  `projectFiles()`) passed clean — that file's own assertions never look at `BoardPins.h`
  content (that is `pinmap.test.js`'s job, a separate file, separately caught); re-targeted at
  `pinRows()`'s shorted-pin name instead, which IS one of `export.test.js`'s own first three
  assertions, and it caught. Verbatim red for all 27, plus that one MISSED-then-fixed history:
  `tests/evidence/round6/2026-09-13-app-tests-planted-breaks.md`.
- **The two stale readings AGENT-1 found (§3, 00:33Z), both fixed and re-verified live**, not
  just read about: `tests/h417_packages.test.js`'s comment said `FMC.Address bus A0-A25`; the
  data's setting is now named `Address lines` (choice `A0-A25`) — fixed the comment and confirmed
  against `node tests/run.js "h417_packages"`'s own live output, which prints
  `FMC.Address lines = "A0-A25"` today. And `tests/completeness.test.js`'s IN_EXTRACTION-expiry
  planted break counted CH32H417 cells by regexing the CHILD PROCESS's printed bullet list, which
  `assert.empty` (`tests/lib/harness.js`) caps at 40 lines — a display limit, read as a count, and
  the very day it was written the real count was already different from what it showed. Fixed to
  read the exact, untruncated `list.length` `assert.empty` already puts in its own message header;
  re-run prints the TRUE current count, **32**, not 40.
- **`validate_constraints_selftest.py` and `validate_afmux_selftest.py`'s anchor-uniqueness
  guard — and it found a real bug in the first one, immediately, the moment it was added.** Both
  had AGENT-1's find-in-`validate_clock_selftest.py` shape: `if find not in base` proves the
  anchor exists, never that it is unique. Fixed both with the sibling's own guard
  (`base.count(find) == 1`, and `mutated != base`). The moment `validate_constraints_selftest.py`
  got it, two of its 19 cases failed: `when: { peripheral: USBFS, enabled: true }` is not unique
  in `data/mcus/CH32X035.yaml` — PC10/PC11's `gpio.mode` AND `gpio.pull` constraint entries both
  end in that exact line — so `.replace(find, replace, 1)` had always mutated the FIRST
  (`gpio.mode`) occurrence, and whichever of the two cases meant to target `gpio.pull` had never
  actually done so; both still read OK because `validate_mcu.py` refused the file for the same
  class of reason either way. Disambiguated both anchors on their own distinguishing line
  (`classes: [out, af, analog]` / `choices: [Pull-up, Pull-down]`) plus `not_on:` plus the shared
  `when:` line — each verified unique before trusting the fix. Re-run: 19/19.
  `validate_afmux_selftest.py`'s eleven anchors were already unique — nothing to disambiguate —
  so a non-unique one was planted on purpose (widened one case's anchor to the substring `af: 4`,
  which occurs 56 times in `CH32H417.yaml`), the guard was watched refuse it
  (`anchor matches 56 places`), and the case was reverted to its real text in the same sitting;
  `git diff` after the revert carries only the guard, not the demonstration. Both runs, and the
  full narrative: `tests/evidence/round6/2026-09-13-constraints-afmux-anchor-guard.md`.
- **The stale-pointer grep, P2.** One hit I own and fixed: `PROGRESS.md` cited `HUMAN_TODO`/
  `HUMAN_TODO.md` nine times — that file does not exist any more (`agents/` is three files now).
  Renumbered to `agents/STATUS.md §6`, and caught myself mapping the numbers blind on the first
  pass: the OLD `HUMAN_TODO` numbering had "flash a generated project" as item 6; in today's §6
  it is item 8 (three occurrences fixed to match). The rest of the grep's hits are outside my
  files — `data/mcus/CH32V006.*` and `data/sources/README.md` cite `HUMAN_TODO`/`00_PROJECT.md`
  (AGENT-1's), `agents/proposals/layout-orientation.test.js` cites `DONE.md` (already on §7's
  backlog as an orphan, not new), and a handful of `tests/*.test.js` comments cite `DONE.md` as
  narrative provenance rather than a live cross-reference — recorded, not fixed this cycle; none
  of them make a gate read wrong.
- **`main` this cycle:** two commits landed from two different agents while this work was in
  flight (AGENT-1 `e25ba30`, AGENT-2 `448b628`, both after AGENT-1's `b1eff49`) — **not verified
  green by me**, no `node tests/run.js` was run for this report, narrow suites only. If my own
  commit lands next, that would be three consecutive commits from three different agents
  (AGENT-1, AGENT-2, AGENT-3) — **not posting `DECISION | worktrees ON`**: the condition is about
  three commits *seen* green, not three commits merely landed, and nobody has run the full suite
  on this tree this cycle.

Red, and who owns it: **nothing found in `app/` or `data/` this cycle** — both P1 findings and
the anchor-guard bug were in files I own (`tests/`, `tools/validate_*_selftest.py`). Numbers:
unchanged from §1 except what this block states directly. Nothing closed by lowering anything.

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
7. **Corrected 2026-09-13T20:00Z (AGENT-3):** the `\|` in this line does nothing — `tests/run.js`'s
   filter is a plain `.includes()` substring match, never a regex (confirmed: the line as written
   returns 0 tests). Run the three phrases separately instead:
   `node tests/run.js "can actually fail"`, `node tests/run.js "planted break"`,
   `node tests/run.js "can go red"` — every suite named in §2 B has a hit across the three and
   every hit is `ok` (checked 2026-09-13T20:00Z: 3 + 21 + 2 hits, all `ok`, and every §2 B name —
   collision ratchet, reachability, SPL-header guard, fixture freshness, `--strict`, `IN_EXTRACTION`
   expiry, `verify_sdk_names.py` — accounted for by name in the output).
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
- ~~`tests/perf.test.js`~~ — **closed 2026-09-13 (AGENT-3).** `compute()` and `renderAll()` timed for
  real on the LARGEST REAL package (derived, not hardcoded — `CH32H417`/`QFN128`, 129 pads today),
  min/p50/p95/max stated in the log every run, asserted on p50 only (a GC-pause max is not a
  regression). Measured on this box (AMD Ryzen 9 5900X, node v24.18.0, win32/x64):
  `compute()` p50 **0.3 ms** (budget 5 ms), `renderAll()` in jsdom p50 **~40-50 ms** (budget 100 ms,
  and stated as jsdom-with-no-layout-engine, never claimed as a real-browser paint number). Both
  budgets watched fail on a planted break (thresholds set to 0.01 ms) before being trusted.
- ~~A **hostile** fixture for the engine's edge cases~~ — **closed 2026-09-13 (AGENT-3),
  `tests/hostile.test.js`.** `WCH-DUMMY32-C8` is a size stress test; this is the part built to
  provoke the REFUSE/WARN half of "every choice the app offers must be one the silicon can honour",
  which nothing tested. Five independent properties, each asserting what the engine SHOULD do, not
  merely that it does not throw — registered with `registerMcuFile()` inside each test (never
  written to `tests/fixtures/mcus/`, so it is invisible to every "every shipped part" sweep):
  shorted pins (two peripherals on the two names of one physical pad **conflict**, checked against
  `E.pins[canon].state`); an exposed pad (pin `"0"`, type `ground`, sorts last, claims nothing); a
  peripheral whose only pad does not exist on the selected package (status **`na`**, not the
  `'warn'` this file first guessed — `isAvailable()` is MORE precise than expected, checked and
  fixed rather than asserted around); a FIXED oscillator above `sysclk.max_mhz` (`clockCalc().over`
  includes `'SYSCLK'` unconditionally — no configuration can avoid it); a constraint refusing the
  one mode a peripheral claim always resolves to (`E.issues[pid]` carries the constraint's own
  `reason`, AND `gpioFieldOptions()` excludes it from the GPIO table). **All five pass against the
  real engine as it stands today — no board entry, because nothing was found broken.** Two of the
  five (the short and the constraint) were watched fail on a deliberately un-shorted / mis-scoped
  copy before being trusted; the fixture stays as a permanent regression guard either way.
- Real-browser screenshots per part × package as CI artifacts; `pio check` in CI.
- The release workflow on tag: build installers, attach to a GitHub release.
- Windows/macOS Tauri jobs now that Linux is green.
- Several round-4 board entries cite measurements nobody can re-run; `tests/evidence/` exists to
  prevent exactly that.

### The pack — AGENT-3
- ~~`agents/proposals/layout-orientation.test.js` is an orphan~~ — **closed 2026-09-13.** `git mv`d
  to `tests/layout_orientation.test.js` and run for the first time, which found the proposal's own
  claim was false as written: `boot()`'s `a.mcuNames` never includes the synthetic
  `WCH-DUMMY32-C8` (it must never ship in `dist/index.html`), so the sweep was silently covering
  only the six real parts — biggest package 129 pins, not the 144 the file's own sanity check
  asked for. Fixed by registering the fixture into the booted page first
  (`tests/layout.test.js`'s existing `registerMcuFile()` pattern), which is the one real edit the
  file needed. Now 4/4 green, genuinely covering QFN12-class up through LQFP144 — planted a break
  (`MIN_LABEL_GAP` raised to 999) and watched it fail before trusting it, reverted, re-green.
  (`agents/proposals/` still holds the CH32X035 DMA derivation, which **is** live: three files in
  `data/` cite `x035_dma_requests.py` by path.)
- ~~`history/round6-pack/DONE.md`'s rounds 1–5 still carry `[ ]` marks and a "15 of 24" count from
  round 3~~ — **closed 2026-09-13, explicitly superseded rather than re-audited.** The file's own
  header used to claim its tail "Round 6" section "is what gates the round" — true for a few hours
  on 2026-09-13, not since. Rewrote the header to supersede the WHOLE file, including that section,
  in favour of the live `agents/STATUS.md`: re-auditing 729 lines under a deadline is how a
  historical file gets a wrong count that reads as more current than the stale one it replaced.
- **When round 6 closes:** copy `STATUS.md` and `BOARD.md` into `history/round6/`, write the round-6
  row in `history/INDEX.md`, and open round 7 by rewriting §2, §4 and §5 **in place**. The live
  files keep their names, so nothing that points at them breaks and there is never a second copy of
  the truth.
