# Round 6 — "a gate nobody has watched run is a guess"

> **The rule from round 5 still binds:** *every choice the app offers must be one the silicon
> can honour*, and its complement, the coverage ledger — *every function the datasheet puts
> on a pin is modelled, or declared absent with a `file:line`, or the build is red.* Neither
> is repeated below. `CLAUDE.md` and `docs/COVERAGE.md` state them; read those first.

Round 5 closed on 2026-09-12 with CH32H417 at **0 open rows** and the suite at **721 tests,
all green**. It also closed with four findings that share one shape, and that shape is this
round's subject:

| What was green | What was true |
|---|---|
| `coverage.py CH32H417` → 0 open, `status: complete` | 63 mode choices put two signals on one pad the moment you switched a peripheral on — reachable by doing nothing, invisible to the conflict engine because both claims shared an owner |
| `validate_mcu.py`, `verify_sdk_names.py`, `coverage.py --gate` → 0 errors, 6 of 6 | the file had a duplicate YAML key; PyYAML kept the last one silently, js-yaml refused it, and the app would not open the part |
| `codegen_compile.test.js` header-case and GPIO-enum checks → `ok` | three of six fixture parts fell out through `if (!spl) continue;` — no failure, no skip, no summary line |
| `.github/workflows/ci.yml` — three jobs, checked by `tests/release.test.js` | has never executed. Every green result in this repository is a local result |

None of those was a wrong gate. Each was a gate that had never been **seen to fail on the
thing it was supposed to catch**, and read as a pass over something nobody had looked at. The
planted-break discipline — mutate, watch it go red, restore — already exists in
`tools/coverage_selftest.py`, `tests/source_order.test.js`, `tests/clock_ui.test.js`,
`tests/data.test.js`. Round 6 makes it the rule rather than the exception, and puts the one
gate that has never run at all on a machine that runs it.

## The deliverables, and how they prove each other

**A — CI executes and is read green. (AGENT-3)**
`origin` exists, the workflows are written and self-checked, and not one of them has run.
Push, read the first run, fix what the runner image shakes out (post it, do not fix it
quietly), and get all three jobs — `test`, `firmware`, `desktop` — green **with the compile
suites executing rather than skipping**. Until then the worktree model stays off and
`PROGRESS.md` says "never run in CI" in those words. A is what makes B, C, D and E mean the
same thing on a second machine as on this one.

**B — every gate is proven able to fail, on every part it covers. (AGENT-3, each owner fixes
what goes red)**
A sweep of `tests/**` for checks with no planted-break half, and a planted break added to
each that matters: the collision ratchet, the reachability check, the SPL-header guard, the
`--strict` gate per part, the duplicate-key check (done), the fixture-freshness check. The
acceptance is a number: **0 gates without a break that has been seen red.** A gate that
cannot go red is removed from the count by being fixed, never by being excused.

**C — CH32H417's Parameter Settings stop being empty. (AGENT-1)**
66 of 78 peripherals have no `params:`; 49 of those route pins. ADC1, ADC2, CAN1–3, DAC, ETH,
FMC, DVP, DFSDM, HSADC, I2C3… — you can claim their pins and configure nothing. This is the
`IN_EXTRACTION` exemption in `tests/completeness.test.js`, and it retires **the cycle the last
block lands**: tick the TASKS.md line and every remaining cell becomes a hard failure. Each
parameter's `struct:`/`sdk_field:` or `sdk_call:`/`sdk_args:` is traced to `ch32h417_*.h`
by `verify_sdk_names.py`; nothing is invented. Start with the peripherals the fixtures
already claim (USART, SPI, I2C, TIM1, USBFS) and FMC's `FMC_NORSRAMInitTypeDef` timings, which
are what the 8080 display added this round is waiting on.

**D — the clock schema holds a second PLL and a per-peripheral source mux. (AGENT-2 schema,
AGENT-1 data)**
`clock.pll` is one object and `clock.prescalers` has one source per tap, so CH32H417's four
secondary PLLs (USBHS 480, ETH 500, USBSS 125, SerDes) and the eight muxes of RM 3.4.13 are
"absent by declaration", `sysclk.sources` lists three of the seven SYSPLL_SEL allows, and the
app computes **nothing** for the USB 48 MHz, LTDC pixel or ETH clocks. The schema is the
deliverable and it must not name a part; H417 is the first consumer. A computed number that
is wrong is worse than a missing one — that rule does not relax — so each new tap ships with
the number it computes checked against the RM's own worked example.

**E — the per-instance init struct. (AGENT-2)**
`LTDC_LayerInit(LTDC_Layerx, &s)`, `TIM_OCxInit`, `OPA_CMP_Init` branching on `CMP_NUM` —
one struct, filled once per instance, applied by a call that takes the instance. Parked since
round 4 as E2 (`channel_params.channels`). The LTDC pixel format shipped this round as a
comment precisely because this did not exist; the rest of `LTDC_Layer_InitTypeDef` and
CH32L103's CMP1 are the first two consumers.

**F — CH32L103 and CH32V003 reach 0 open rows. (AGENT-1, with E for CMP)**
L103's twelve rows are all CMP2/CMP3 pads waiting on `const:` and the `ABSENT` lines already
posted; V003's three are USART1_CK waiting on `USART_ClockInit` in codegen. Both are small
and both have been waiting a round.

## The exit criterion, in one sentence

*CI has been read green on a runner, every gate in `tests/**` has been seen red on a planted
break, CH32H417's `IN_EXTRACTION` exemption is gone, the app computes a USB and an LTDC
clock on it, and the ledger reads zero on all six parts.*

## Where things stand at the open (2026-09-12T19:00Z, measured)

```
python tools/coverage.py --quiet
  CH32H417   OPEN 0   (modelled 1252, absent 23, disagreements 45)   complete
  CH32L103   OPEN 12  (modelled 260,  absent 11, disagreements 1)    in_extraction, AGENT-1
  CH32V003   OPEN 3   (modelled 113,  absent 10, disagreements 0)    in_extraction, AGENT-1
  CH32V005   OPEN 0   CH32V006   OPEN 0   CH32X035   OPEN 0          complete

node tests/run.js            ALL GREEN, 721 tests, 0 skipped
CH32H417 default collisions  QFN68 4 / QFN88 0 / QFN128 0   (COLLISION_CEILING, AGENT-1)
CH32H417 params: missing     66 of 78 peripherals, 49 of them route pins
CH32L103 params: missing     7 of 31
CI                           never executed
flashed                      nothing — "builds, not flashed"
```

## What is NOT in this round

- **Flashing.** `HUMAN_TODO.md` item 8. Nobody here can close it and nobody may round it up.
- **New parts.** CH32V203 / V307 / H416 wait on sources (`HUMAN_TODO.md` item 4). A part with
  no sources is not started.
- **The desktop shell verified in a window.** `cargo build` is green; a human has to see it
  write a project (`HUMAN_TODO.md` item 7).

## Read next

`agents/README.md` (the working agreement), then your own `AGENT_n_*.md` — its P0/P1 are this
round's, its "Current" section is yours to rewrite each cycle, and your round-5 Current is in
`history/round5/` if you need what you were in the middle of. `PROMPT_AGENT_n_R6.txt` is the
same brief as a paste-in prompt for a fresh session.
