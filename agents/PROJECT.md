# Round 5 — "every choice the app offers must be one the silicon can honour"

> **Added 2026-09-12, and it governs every part from here on:** *every function the datasheet
> puts on a pin is modelled, or declared absent with a `file:line`, or the build is red.* The
> mechanism is the coverage ledger — `docs/COVERAGE.md`, `python tools/coverage.py <PART>` — and
> a part is not done while it prints an open row. This is the complement of the round's rule: that
> one stops the app offering what the silicon cannot do; this one stops the app *omitting* what
> the silicon does. The counts today: CH32H417 113 open, CH32L103 33, CH32V003 3, the rest 0.

Rounds 1–4 built a configurator, made what you can click correct, made the generated C compile,
and added a second family plus a project you can flash. Round 5 has **two deliverables that
prove each other**, and the round's rule is written in the title.

Round 4 found the defect class by accident, twice, from different agents:

- `gpio.modes` on CH32X035 listed `GPIO_Mode_Out_OD` and `GPIO_Mode_AF_OD`, which that part
  **does not have** — `GPIOMode_TypeDef` has six members and neither is among them
  (`ch32x035_gpio.h:29-37`). Round 3's `GPIO_Speed_50MHz` was the same mistake, one field over.
- `GPIO_Mode_IPD` on the same part carries a **per-pin** restriction, stated in the header:
  *"Only PA0--PA15 and PC16--PC17 support input pull-down"*. Nothing in the model can express
  it, so the GPIO table offers Pull-down on every row.

The first was fixed by **deleting** two entries. That works only while the capability is uniform
across the part. The second cannot be fixed that way at all, and it is not the only one — the
CH32X035 datasheet states three separate per-pin constraints:

| # | The constraint | Source |
|---|---|---|
| 1 | Input pull-down exists only on PA0–PA15 and PC16–PC17 | `ch32x035_gpio.h` on the enum member |
| 2 | A **shorted pair** — two GPIOs bonded to one physical pin — is "prohibited from being configured as output functions" | DS notes 4–7 |
| 3 | PC10 and PC11 must be **floating inputs while USB is enabled** | DS note 4 |

Constraint 3 is not even per-pin: it couples a peripheral's state to a pin's legality. So the
mechanism has to be able to say "this choice is valid here", "this choice is valid except here",
and "this choice is invalid while that peripheral is on", and the UI has to stop offering what
the data rules out rather than colouring it after the fact.

**A wrong choice the app offers is worse than a missing feature.** A missing feature is a gap;
an offered-but-impossible choice produces a configuration that compiles, generates, looks
correct in the export, and does not work on the board. That is the whole round in one sentence.

---

## Deliverable A — the data can state a constraint

One mechanism, three real instances already documented, no part named in the code.

1. **DATA** designs the schema and fills it for CH32X035's three cases plus any CH32V006 case
   that turns out to exist. It goes in `data/FORMAT.md` as a documented block, not a comment.
   Whatever it is called, these are the questions it must answer: which choice is restricted,
   which pins it is restricted to or from, whether the restriction is per-pin or
   per-package, and whether it is conditional on another peripheral being enabled.
2. **APP** consumes it in three places, and all three must agree: the **GPIO table** (the
   control is absent or its options reduced *on that row*), the **conflict engine** (a claim
   that violates a constraint is an issue that names the constraint), and **codegen** (it never
   emits a combination the data forbids).
3. **QA** proves it on real data and proves it can fail.

**CH32V006 and CH32V005 must be byte-identical in behaviour** before and after. That is the
regression half of the round, and it is the one that catches a mechanism that only works for the
part it was designed against — which is exactly how rounds 3 and 4 each shipped a defect.

### The acceptance test for A

- CH32X035: the Pull-down option is **not offered** on a pin outside PA0–PA15/PC16–PC17, and
  **is** offered on one inside it. Both halves, because a mechanism that hides the control
  everywhere would pass a one-sided check.
- A shorted pair on CH32X035 cannot be configured as an output, and the reason is visible.
- With USBFS enabled, PC10/PC11 cannot be driven; with it off, they can.
- A `.wchproj` written before the constraint existed, and one that violates it, both load
  **without a console error** and say what was dropped — the same rule `gpioSpeedFor()` already
  applies to a saved speed the part no longer offers.
- CH32V006 and CH32V005: every existing test unchanged.

## Deliverable B — every part generates C with no `TODO` and no `#error`

`--strict` currently fails on a fully configured project, and the reasons are tracked and known.
Round 4 left the generator complete but blocked on two small data keys, and left five CH32X035
peripherals partially modelled. Closing this is what makes "the generated code is the product"
true for a second family rather than for one part.

The standing gaps, all with their evidence already on the board:

| Gap | What is missing | Where |
|---|---|---|
| `codegen.nvic` | an enabled vector emits a **comment** instead of an `NVIC_Init` call | `ch32v00X_misc.h:50-56,67`; `NVIC_Init` takes no handle |
| `channel_params.channels` | nothing links a channel SETTING (`Channel1: PWM Generation CH1`) to the channel index `TIM_OC<N>Init()` needs | AGENT-2 parked the emitter against this shape |
| USBFS / USBPD | `params:` blocks; `codegen.periph_handle.USBFS` names `USBFS_DEVICE`, which does not exist — the headers define **`USBFSD` and `USBFSH` as two separate peripherals** | `ch32x035_usbfs.h`, `ch32x035_usbpd.h` |
| OPA | 13 struct members, 3 modelled; its polling set is the shape that had to be corrected on CH32V006 | RM ch.16 |
| CMP1/2/3 | 5 members, 3 modelled | RM ch.15 |
| TKEY | RM ch.11 has real registers and the EVT ships **no tkey header**, so every write is a raw register; `TKEY1_CHARGE1` **overlaps** the ADC `sample` parameter | RM ch.11 |
| ADC internal channel | the Vrefint channel is not modelled — **and the same gap exists on CH32V006**, so it is a repo-wide decision, not an X035 miss | both RMs |
| USART LIN / SmartCard / IrDA | the DS advertises them and the SPL has the calls; they are mode flags, so `params:` with `sdk_call` | DS + `ch32x00X_usart.h` |

### The acceptance test for B

- `node tools/wchcube_cli.js --project <each fixture> --strict` exits **0**. Every fixture, every
  part — currently it exits 2.
- Every generated project still **compiles**: `pio run` for all four environments and for the
  generated-project gate in the system temp directory.
- Regenerating after save → close → open is **byte-identical**, including DMA and NVIC.
- `grep -ri "x035\|ch32v006\|ch32v005\|x033" app/engine/ app/template.html` is still empty
  outside comments.

## Carried over from round 4 — E1–E9. These come first.

| # | Line | Owner |
|---|---|---|
| E1 | `codegen.nvic` — the last TODO standing between a configured part and a clean `--strict` | DATA + APP |
| E2 | `channel_params.channels` — the `TIM_OCInitTypeDef` emitter is written and parked on it | DATA + APP |
| E3 | Wire `tools/verify_sdk_names.py` into `node tests/run.js` — it is a gate run by hand today | QA |
| E4 | `tests/completeness.test.js`'s 16 known-missing cells, each either filled or declared ABSENT with a citation | all three |
| E5 | Extend `smoke.js`, `layout.test.js`, `legibility.test.js`, `codegen_compile.test.js` to **CH32X035 × all 7 packages** | QA |
| E6 | `CH32X033F8P6` is its own part (DS Table 2-2 is a separate pin table), most likely `inherits: CH32X035` | DATA |
| E7 | Open: whether QFN28 / QFN20 / QFN12 on CH32X035 have an external reset at all. Guessing is banned; an answer or a recorded BLOCKED is fine | DATA |
| E8 | `src-tauri` has not been **relinked** since the round-4 changes — the human's desktop app was running. `cargo build` is green; the window is unverified | QA |
| E9 | The Round 3/4 DONE lines still open: `--strict` clean, `.wchproj` round-trip for DMA and NVIC | all three |

## What is NOT in this round

- **New parts.** CH32V003, CH32V203 and CH32V307 still have no DS/RM in `data/sources/`
  (`HUMAN_TODO` 4). Adding a part is now a data job and that is the point — but it is not this
  round's job.
- **The hardware flash.** It is `HUMAN_TODO` 6, the highest-value open item in the repo, and
  nobody here can do it. The DONE line reads **"builds, not flashed"**, in exactly those words,
  until a human runs `pio run -t upload` and reports the SDI banner. Nobody may round that up.
- **A second `main.c` HAL.** The generated project calls the SDK and the configurator's init and
  nothing else. That is deliberate and stays.

## What "round 5 is done" means

All four of these, and they are checked against the tree rather than asserted:

1. **DATA** — `data/mcus/CH32X035.yaml` is complete enough that `validate_mcu.py` and
   `verify_sdk_names.py` both exit 0, `CH32X035.notes.md` cites a source for every fact, and the
   constraint mechanism is documented in `data/FORMAT.md` and filled for the three real cases.
2. **APP** — the constraint mechanism is consumed by the GPIO table, the conflict engine and
   codegen, with **no part named anywhere in `app/`**; `--strict` is clean on every fixture; and
   CH32V006/CH32V005 behaviour is unchanged.
3. **QA** — the constraint mechanism has a test that can fail; every existing suite covers
   CH32X035 × 7 packages; the compile gate is green for every part; `verify_sdk_names.py` runs
   inside `node tests/run.js`.
4. **The evidence exists.** `python build.py && node tests/run.js` is ALL GREEN, the browser was
   opened, and for every claim that changed generated output, a `pio run` says so.

QA posts `DECISION | ROUND 5 DONE` and tags `v1.4.0` when all four hold and every non-human line
in `DONE.md` is ticked.

---

## Why a constraint mechanism and not three special cases

Worth stating, because three special cases are cheaper today and this is the argument against
them. Each of the three instances is one `if` in the render path and one `if` in codegen. That is
six edits, and it buys a fourth part with a fourth constraint nothing can express, and a fifth
where the same `if` is subtly wrong because the shape is slightly different. The repo has now
paid for that lesson twice — `GPIO_Speed_50MHz` and `GPIO_Mode_Out_OD` were both "the other CH32
parts have it", both written down as a citation-free assumption, and both found by a gate rather
than by reading. A mechanism that reads from the data is what makes the next part a data job,
which is the claim this project has been making since round 4 and has not yet earned for
constraints.
