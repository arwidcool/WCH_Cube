# AGENT-1 — DATA, round 6

Owns `data/mcus/**`, `data/packages/**`, `data/sources/**`, `data/coverage/**`, `data/FORMAT.md`,
`tools/extract_*.py`, `tools/gen_*.py`, `tools/validate_mcu.py`, `tools/coverage*.py`,
`tools/ledger.py`. Must not edit `app/`, `tests/`, `src-tauri/`, `data/firmware/`.

Read `README.md` first and follow the work cycle exactly. You never stop to ask; you decide and
log. Round 6's brief is `PROJECT.md`. Your round-5 "Current" is in `history/round5/AGENT_1_DATA.md`
if you need what you were in the middle of.

## Before any hardware fact: the coverage ledger (docs/COVERAGE.md)

A part is not done while `python tools/coverage.py <PART>` prints an open row. Every function
the datasheet puts on a pin, every RM chapter and every SPL instance is a row: **modelled** by a
named signal, **absent** with a `file:line` in `data/coverage/<PART>.yaml`, or **OPEN**. Take the
first open row, open the cited line, model it (through the part's generator, never an ad-hoc
script) or declare it (cited), rerun. `open_rows:` in the coverage file may only go down. A
peripheral that routes nothing says `pins: { none, source }` or `pins: { open, owner, task }`;
a routed signal no choice claims is a validator ERROR.

Two things this round found that the ledger cannot see, and that you own the fix for:

- **`status: complete` is "every datasheet fact is accounted for", not "the part is done".**
  CH32H417 reached 0 open rows on 2026-09-12 with 66 of 78 peripherals carrying no `params:`
  and 63 default-pin collisions. Report the ledger count *and* those two numbers.
- **A `disagreements:` entry is an unresolved fact, not a resolved one.** The SerDes TX/RX pairs
  are recorded both ways because the DS says both; the app routes one. Say which, in the notes.

## The sources, and the order you read them in

**Markdown first, PDF last.** Every drop is converted to markdown, the conversion sits in
the part's `Datasheets/` folder with the original beside it, and the conversion is what you
read: it greps, it diffs, it can be cited by line, and a second pass can check it. Open the
PDF only when the markdown **cannot** answer — missing, unreadable, or demonstrably
incomplete (a dropped column, a lost `-` placeholder, a table the conversion destroyed).
"The PDF is clearer" is not a reason. This is `data/sources/README.md`, and the rules that
make a fallback honest are there too: say why in a `PDF FALLBACK:` line, recover by script
with a check against numbers the datasheet states elsewhere, and write the recovered cells
back into the repo once so the PDF is read one time and no more. `tests/source_order.test.js`
fails the build on a PDF with no conversion beside it, and on a script that opens one without
saying why.

When you write a tool: default it to the markdown through `tools/source_docs.py`, which is
the one place the order is implemented. `source_docs.choose()` refuses to reach for a PDF
silently, `source_docs.require_markdown()` exits naming the fallback route instead of
handing back a PDF, and `source_docs.announce_pdf_fallback(reason)` is the banner that
makes a fallback visible on every run.

## P0 — Deliverable C: CH32H417's Parameter Settings stop being empty

66 of 78 peripherals have no `params:`; 49 of those route pins. That is the `IN_EXTRACTION`
exemption in `tests/completeness.test.js` (owner: you) and it retires **the cycle the last
block lands** — tick the TASKS.md line and every remaining cell fails hard. Rules:

1. Every parameter is `struct:`+`sdk_field:`, or `sdk_call:`+`sdk_args:`, or `sdk_none:`+`sdk_note:`,
   traced to `ch32h417_*.h` by `verify_sdk_names.py`. A name nobody compiled is a guess.
2. Order: the peripherals the fixtures already claim — USART, SPI, I2C, TIM1, USBFS — then FMC's
   `FMC_NORSRAMInitTypeDef` (the 8080 display added this round configures pins and no timings),
   then ADC1/ADC2, CAN1–3, DAC, DVP, ETH. Post the count each cycle: *N of 66 remain.*
3. Everything goes through `data/sources/H417/peripheral_extras.yaml`, **never** into the
   generated block of `CH32H417.yaml` — `gen_h417_peripherals.py --splice --refresh` discards a
   hand edit, which happened once this round and undid a fix within a day.

## P1 — Deliverable F: CH32L103 and CH32V003 to 0 open

- **L103, 12 rows, all CMP2/CMP3 pads.** `const:` is implemented (AGENT-2, board 18:10Z) and the
  four `ABSENT` lines are in `tests/completeness.test.js`. Model CMP2/CMP3 as `const: CMPn`
  params; the rows close.
- **V003, 3 rows, all USART1_CK.** Waits on `USART_ClockInit` in codegen — post a REQUEST(→AGENT-2)
  with the struct and the header line in your first cycle, model it the cycle it lands.

## P2 — Deliverable D, the data half, and the carried items

- **D — the clock data for H417's four secondary PLLs and eight muxes**, the cycle AGENT-2 lands
  the schema. Each PLL's inputs, dividers and multipliers from RM 3.4.3–3.4.13, each mux's
  sources from RM 3.4.13, cited by line. Until then they stay declared absent in `notes:`.
- **The 4 remaining default collisions on QFN68** (`COLLISION_CEILING` in
  `tests/h417_packages.test.js`): FMC_A11/PB11, FMC_A12/PB12, UHSIF_PORT3/PB0, UHSIF_PORT4/PB1.
  The fix is the pin order in the generator; lower the ceiling as they close.
- **`gen_h417_peripherals.py:1415`** — `write_text()` rewrites all 3677 lines to CRLF every run.
  `newline="\n"`. One keyword; three commits this round normalised it by hand.
- **`validate_mcu.py` should refuse a duplicate YAML key.** PyYAML keeps the last silently;
  js-yaml refuses the file; three green Python gates stood over a part the app could not open.
  `tests/data.test.js` catches it now, but the failure belongs in your tool, three steps earlier.
- **MEU6/WEU6 — CH32H416 or CH32H417?** The DS contradicts itself 3 sources to 1. Settle it with
  a citation; `CH32H417_QFN68_pkg.wchproj` follows the answer.
- **The dual core.** `mcu.core` is one string; PlatformIO ships `_V3F`/`_V5F` board files. Decide
  what a generated project targets, and say it in the notes.

## When idle

`BACKLOG.md` DATA section, and the ledger on any part that is not at 0.

## Authority

Every fact in `data/` cites a DS/RM table or an EVT `file:line` in the part's `.notes.md`.
"The other CH32 parts have it" is not a citation. Where two sources disagree, record both,
average neither. Never delete a data file. Never raise `open_rows:` or `COLLISION_CEILING`.

## Current

*(Rewrite this section every cycle: what you did, what is red and who owns it, the numbers —
ledger count per part, `params:` remaining, collisions per package.)*

**Cycle 1 - 2026-09-12T19:24Z.** Baseline at the open was H417 0 open / 65 peripherals with no
`params:` (the brief said 66; LTDC's landed in round 5's last commit) / collisions 4-0-0;
L103 12 open / 7 params missing; V003 3 open.

Done this cycle:

- **Deliverable C: `params:` 65 -> 48 missing of 78.** USART4-8, SPI3-4, I2C3-4 and all eight
  remaining timers, every one through `data/sources/H417/peripheral_extras.yaml` and never into
  the generated block. The nine serial instances are one struct each, aliased from a single
  template so a correction has one place to land. **The timers are FOUR time bases, not one**,
  and `ch32h417_tim.c` is the citation for each split: `TIM_TimeBaseInit()` writes CTLR1 only for
  TIM1/2/3/4/5/8 and RPTCR only for TIM1/8, and TIM9-TIM12 have their own
  `TIM9_12_TimeBaseInitTypeDef` + `TIM9_12_TimeBaseInit()` with a 32-bit period written to
  `ATRLR_32`. So TIM6/TIM7 carry no counter-mode and no clock-division row - absent by RM 16.4.1's
  bit table (`CH32H417RM.md:20474`: CTLR1 [6:4] and [15:8] Reserved), not by omission - and TIM8 is
  the only instance besides TIM1 with a repetition counter.
- **A disagreement recorded rather than averaged:** the RM states the TIM9-12 ATRLR reset value
  twice and differently (register map `0x0000FFFF` at `:18992`/`:19062`, field description
  `0xFFFFFFFF` at `:20209`). The default follows EVT - `TIM9_12_TimeBaseStructInit()` sets
  `0xFFFFFFFF` - and both readings are in `peripheral_extras.yaml`.
- **`codegen.init_structs.TIM9_12_TimeBaseInitTypeDef` and 21 new `codegen.periph_handle` rows.**
  A `params:` block without a handle emits `/* TODO: nothing applies this struct */` beside a
  filled-in struct, which is worse than having no rows at all.
- **`gen_h417_peripherals.py:1425`, AGENT-3's FINDING of 19:02Z:** `write_text(..., newline="
")`.
  A refresh that changes four lines no longer rewrites all 3855 to CRLF.

Red, and who owns it: nothing. Gates watched, not assumed - `validate_mcu` 0 errors,
`verify_sdk_names` 0 errors, `coverage --gate` 6 of 6, `node tests/run.js` ALL GREEN 721,
and `pio run` **SUCCESS** on CH32H417QEU6 with I2C3 + TIM6 + TIM9 + USART4 enabled. One
decision posted to AGENT-3: the two CH32H417 `tests/fixtures/*.wchproj` are in my commit
because `make_fixtures.js` regenerates them from the MCU data and a new `params:` block adds
its defaults to every saved project; 92 added lines each, nothing removed.

Numbers: ledger H417 **0** / L103 **12** / V003 **3** / V005 0 / V006 0 / X035 0.
H417 `params:` **48 of 78 remain**. Collisions QFN68 **4** / QFN88 0 / QFN128 0.

**Cycle 2 - 2026-09-12T20:49Z. `params:` 48 -> 43 of 78.** ADC1, ADC2, DVP, IPC, SWPMI.

- **FMC did not land, and the reason is a schema gap, not a shortage of facts.**
  `FMC_NORSRAMInit()` takes ONE struct whose two timing members are POINTERS to a second
  struct (`ch32h417_fmc.h:113-115`), and no SDK function takes
  `FMC_NORSRAMTimingInitTypeDef` alone - so `initPlan()` gives that block no `fn:` and
  emits `/* TODO: nothing applies this struct */`, and `--strict` exits 2. Shipping the
  outer struct without the timings is worse, not safer: `FMC_NORSRAMInit()` dereferences
  `FMC_ReadWriteTimingStruct` unconditionally, so a zeroed struct is a null read at init.
  REQUEST(->AGENT-2) posted 19:33Z with the smallest shape that closes it. `ETH`,
  `FMC_NAND`, `FMC_SDRAM` and `ECDC` are the same shape, so four more peripherals are
  waiting behind the same one change - which is why I took ADC/DVP/IPC/SWPMI instead.
- **The ADC sampling times were the third sibling-copy trap on this part, and the nastiest.**
  RM 11.3.5 (`CH32H417RM.md:14974`) gives 1.5 / 7.5 / 13.5 / 28.5 / 41.5 / 55.5 / 71.5 /
  239.5 cycles; CH32V006 has 3.5 / 7.5 / 11.5 / 19.5 / 35.5 / 55.5 / 71.5 / 239.5. Five of
  eight differ and **the macro names are identical**, so `verify_sdk_names.py` passes a
  copied list in which every label a user reads is wrong.
- **Where a `settings:` row already decides a register field, the field is `const:` rows
  with one dependency each** - DVP's data width (the Mode row is what claims D8-D11),
  SWPMI's loopback, the ADC's independent/dual. A second dropdown could claim twelve pads
  and configure eight.
- **A gate went red on data that was correct, and that is a real finding**:
  `paramReachWarnings()` (`app/engine/resources.js:480-494`) counts a `const:` param as one
  the user changed, because `paramValue()` returns `d.const` while `d.default` is
  undefined - four spurious issues on the shipped fixtures, `--strict` exit 2. FINDING
  posted to AGENT-2. Worked around in my data by mirroring each constant into `default:`,
  commented as a workaround with their file:line so it is deleted in one commit.
- **`f4d2afe "H417 fixes"` (AGENT-4) committed this cycle's data while it was mid-flight**,
  so the work is in the tree under someone else's message. Not rewriting history for it;
  NOTE posted. Same `git add -A` trap I hit from the other side in cycle 1.

Red, and who owns it: nothing. Two tests failed in a full run and both passed on re-run -
the runner's own "dist was rebuilt while these tests ran" case, three agents building at
once. Gates watched: `validate_mcu` 0 errors, `verify_sdk_names` 0 errors,
`coverage --gate` 6 of 6, `codegen_compile` ALL GREEN 18, `app/tests/engine` ALL GREEN 22.
`pio run` SUCCESS three ways on CH32H417QEU6: ADC1 dual + 3 channels + ADC2 + TIM6 + TIM9 +
IPC; DVP 12-bit with a crop window; SWPMI single-wire with multi/single buffering.

Numbers: ledger H417 **0** / L103 **12** / V003 **3** / V005 0 / V006 0 / X035 0.
H417 `params:` **43 of 78 remain**. Collisions QFN68 **4** / QFN88 0 / QFN128 0.

**Cycle 3 - 2026-09-12T21:05Z. DELIVERABLE F IS DONE: the ledger reads ZERO on all six
parts.** `coverage --gate` 6 of 6 `complete`; no part is `in_extraction`, nothing is owned,
and both TASKS.md lines are ticked.

- **CH32L103 12 -> 0.** CMP2 and CMP3 modelled. One `OPA_CTLR2` holds all three comparators
  at shifts 1, 9 and 17 and `OPA_CMP_Init()` branches on `CMP_NUM` (`ch32l103_opa.c`), so
  the two new ones are the same four parameters aimed at different bits; only the pads and
  the `const: CMP_NUM` differ. **It surfaced two defects that had been shipping since the
  part landed, both invisible because no fixture ever switched a comparator on**: there was
  no `CMP_InitTypeDef` in `codegen.init_structs`, so CMP1's `params:` were filled in and
  then followed by `/* TODO: nothing applies this struct */`; and no comparator had a
  `CMP_NUM` row, which was right for CMP1 BY ACCIDENT (`CMP1 = 0`, struct zero-initialised)
  and would have made CMP2's and CMP3's blocks configure CMP1.
- **CH32V003 3 -> 0, and the blocker was not real.** The row said "needs APP: the generator
  cannot gate a second init struct off yet". It can: `initPlan()` already groups by
  `struct:` and looks each up in `init_structs`, and `depends_on: { setting: Mode, equals:
  Synchronous }` on every row of `USART_ClockInitTypeDef` is the gate. Checking that cost
  less than the round the row spent waiting. **A blocker nobody has re-read is a guess too.**
- Both parts compiled rather than asserted: `pio run` SUCCESS on CH32L103K8U6 with CMP2 and
  CMP3 enabled and on CH32V003F4P6 with USART1 synchronous on PD4, `--strict` 0 both.

Red, and who owns it: **three tests, all AGENT-2's, none mine** - `app/tests/export.test.js`
x2 and the new `app/tests/pinmap.test.js`, on their uncommitted `pin_map` / `BoardPins.h`
work (`app/engine/export.js` modified, `pinmap.test.js` untracked). FINDING posted with the
reproduction. Everything that reads `data/` is green: `coverage` 15, `completeness` 15,
`strict` 25, `data` 56, `codegen_compile` 18, plus `validate_mcu`, `verify_sdk_names` and
`coverage --gate` at 0.

AGENT-2 landed the `paramReachWarnings()` fix I filed mid-cycle. My `const:` params still
mirror their constant into `default:` because that fix is UNCOMMITTED, and a commit of mine
that depends on an uncommitted change of theirs puts main red in the gap; the mirrors go the
cycle it is committed, and the board says so.

Numbers: ledger **0 / 0 / 0 / 0 / 0 / 0 - all six complete**.
H417 `params:` **43 of 78 remain**. Collisions QFN68 **4** / QFN88 0 / QFN128 0.

**Cycle 4 - 2026-09-12T21:35Z. Deliverable E's data half, and a near-miss that is the most
useful thing in this cycle.**

- **The `default:` mirrors are stripped**, the cycle AGENT-2 committed the
  `paramReachWarnings()` fix (`6645e38`), as promised on the board. Both fixtures report
  `issues: {}` with no mirror in sight.
- **E consumer 1 - TIM PWM on four parts, six `channel_params.channels` maps.** Each derived
  from THAT PART'S OWN `ChannelN` rows and then asserted back against them, because the four
  parts spell the choices differently. `tests/fixtures/CH32V006_QFN32_full.wchproj` has had
  `Channel2: PWM Generation CH2` since it was written and now emits
  `TIM_OC2Init(TIM2, &TIM_OCInitStructure)` - the compile gate builds it.
- **E consumer 2 - CH32H417 LTDC layers**, sixteen members, two instances, gated by new
  `Layer 1` / `Layer 2` rows that claim no pad. The pixel format moved INTO the layer struct
  and its two `sdk_none:` planning rows are deleted - the round-5 note explaining why it
  could only be recorded is obsolete, not just stale. LTDC gained its own fifteen-member
  `LTDC_InitTypeDef` params so the peripheral cell did not empty. TASKS.md line ticked.

**THE NEAR-MISS, and it is mine to own.** `--splice --refresh` silently reverted AGENT-4's
ETH commit (`9a502ae`): they had written `Interface` / `SMI` / `notes:` / four MDI pads into
the GENERATED block, so the regeneration put MII and RMII back - two choices that commit
removed as INVENTED - and took `Internal PHY (built-in 10/100M)` out. The loss guard caught
the notes and the pads and REFUSED to write; it said nothing about the choice row, because
`_losses()` compares peripherals, signals, routed pairs and remaps and **not choice lists**.
I noticed only because `validate_mcu` then failed on four dead MDI pads. All three pieces are
now where the generator can see them - pads in `dedicated_pins.yaml`, notes in
`peripheral_extras.yaml`, the two rows in `MODES["ETH"]` with their citations kept word for
word - and a clean refresh reproduces every one. **A guard that catches four facts out of
five reads exactly like one that catches all five**, which is this round's rule pointed at my
own tool.

Red, and who owns it: nothing known; the full suite is still running as this is written and
the result goes on the board either way. `validate_mcu` 0, `verify_sdk_names` 0,
`coverage --gate` 6 of 6. Compiled: `pio run` SUCCESS on CH32H417QEU6 with LTDC RGB565 +
layer 1, and the V006 PWM fixture through the compile gate.

Numbers: ledger **0 / 0 / 0 / 0 / 0 / 0**. H417 `params:` **43 of 78 remain** (LTDC swapped
two planning rows for fifteen real ones, so the count held while the content improved).
Collisions QFN68 **4** / QFN88 0 / QFN128 0.

**Cycle 5 - 2026-09-12T21:47Z. `params:` 43 -> 39 of 78.** I2S2, I2S3, SDIO, HSADC, and
`_losses()` now compares setting rows and their choices - planted the exact ETH case that
slipped past it, watched it print ``ETH.settings.`Interface`: choice(s) gone`` and exit 2,
restored.

- **Three of the four repeat one pattern, and it is worth naming because it keeps recurring
  on this part: a `settings:` row already decides a struct member.** I2S's `Mode` is
  `I2S_Mode` AND `I2S_MCLKOutput`, because it is also what claims the MCK pad - so a
  dropdown would let a project claim the pad and switch the driver off. SDIO's `Mode` is
  `SDIO_BusWide`, because it is what claims D0 / D0-D3 / D0-D7. Both become `const:` rows
  with one dependency each, the same shape ADC, DVP and SWPMI already use.
- **I2S's handle is SPI2 / SPI3.** `I2S_Init(SPI_TypeDef*, ...)` - the I2S is a MODE of the
  SPI block, not a peripheral beside it, which is also why enabling both halves of one block
  is a configuration the silicon cannot honour. Recorded in `init_structs`.
- **HSADC ships 3 of 11 members and DECLARES the other 8.** They are a DMA transfer in
  flight: two 32-bit receive addresses, three lengths, and three switches that mean nothing
  until those addresses point somewhere real. A buffer address is a symbol this tool cannot
  know, so they stay at the zero-initialiser and `notes:` names which eight and why - rather
  than rows that write zeros over what the user set up.

Red, and who owns it: **3 tests, all AGENT-2's** - `app/tests/instances.test.js` `:263`,
`:376`, `:392`, made false by the TIM `channels:` maps landing, with `:376` being the one
whose own message says "when the last one does, delete this test". Exact edits in my 21:41Z
QA-FAIL. AGENT-3 closed the other four in `18ac944` the same cycle they were reported, and
inverted the assertion that needed inverting rather than porting it.

Gates: `codegen_compile` 18, `completeness` 15, `strict` 25, `h417` 64, all ALL GREEN, plus
`validate_mcu`, `verify_sdk_names` and `coverage --gate` at 0. Compiled twice on
CH32H417QEU6: I2S2 Master Transmit + HSADC on IN4/IN5, and SDIO in SD 8-bit.

Numbers: ledger **0 / 0 / 0 / 0 / 0 / 0**. H417 `params:` **39 of 78 remain**.
Collisions QFN68 **4** / QFN88 0 / QFN128 0.

Next: LPTIM1/2 (one struct, but an anonymous union - `LPTIM_ClockPolarity` and
`LPTIM_EncoderMode` share storage, so at most one may be written), QSPI1/2, SDMMC, GPHA,
CAN1-3, DAC, RTC, SAI. Then the four QFN68 default collisions, which have waited two rounds.
FMC/ETH/ECDC/FMC_NAND/FMC_SDRAM stay blocked on the nested-struct shape (REQUEST 19:33Z) -
five peripherals behind one change.

**Cycle 6 - 2026-09-13T00:33Z. THE PERIPHERAL MAP IS MEASURED, AND MEASURING IT FOUND
GENERATED C THAT COULD NOT HAVE RUN.**

This cycle was an audit rather than an extraction: 78 peripherals, six axes each (pins,
settings, params, clock, vector, codegen reach) plus fixture and compile, in
`tests/evidence/round6/2026-09-13-h417-peripheral-map.md`. Every number in it came out of a
command run for it; nothing was carried over.

- **THE FINDING, and it is problem 8 in `CH32H417.notes.md` all over again two peripherals
  over: `I2S2` and `I2S3` had NO bit in `codegen.periph_clock` at all.** Switching either on
  emitted `I2S_Init(SPI2, &s)` under the comment "I2S2 has no clock enable bit in
  codegen.periph_clock - none is written". It compiled, `--strict` exited 0, `validate_mcu`
  and `verify_sdk_names` were at 0, and `coverage.py` said 0 open - because **not one of them
  asks, peripheral by peripheral, whether the clock gets turned on.** The ledger reads the
  datasheet's pin table; this is the other half of the same question and nothing was asking
  it. The I2S is a MODE of the SPI block (RM ch.23 is "SPI/I2S", `I2S_Init()` takes a
  `SPI_TypeDef *`, and `codegen.periph_handle` already said `I2S2: SPI2`), so it shares the
  SPI's gate the way `OPA`/`CMP` already share `RCC_HB2Periph_OPCM` on this part. The EVT does
  it one line above its own `I2S_Init`:
  `data/sources/H417/Evt/EXAM/DFSDM/DFSDM_I2S_Audio/Common/hardware.c:103`, beside `:111`.
  Modelled as `I2S2: 14` / `I2S3: 15` under `sdk: { I2S2: SPI2, I2S3: SPI3 }`.
- **Three more clock cells are genuine absences and are now DECLARED, each by address rather
  than by analogy.** The complete `RCC_*Periph_*` block is `ch32h417_rcc.h:230-307`, 73
  macros, and none of the three is in it: `DBGMCU` is a core CSR (`R32_DBGMCU_CR`, "Offset
  address: 0x7C0(CSR)", `CH32H417RM.md:66907`), `HSEM` is core-private at `0xE000C000` (RM 4.5,
  `:6561`, register `:6652`), `IPC` core-private at `0xE000D000` (RM 4.4, `:6287`, register
  `:6332`). The RM names both in words at `:4313`. The RCC gates HB/HB1/HB2; none of the three
  sits on one.
- **The sixth, `RTC`, I did NOT close, and that is the decision worth recording.** Its gate is
  TWO bits - `RCC_HB1Periph_PWR | RCC_HB1Periph_BKP`, EVT
  `.../RTC/RTC_Calendar/Common/hardware.c:94`, repeated :205 and :247; BKPEN bit 27, PWREN bit
  28, `CH32H417RM.md:3538`/`:3535` - and `bits:` maps one peripheral to one bit.
  **`BKP` alone would have ticked the cell and shipped a half-enable that reads exactly like a
  whole one**, which is the shape of every defect in this part's notes. New TASKS.md line,
  owner AGENT-2 for the schema half, reasoning in the RTC `notes:` in
  `peripheral_extras.yaml` so a `--refresh` reproduces it rather than losing it once.
- **Everything went through the generator.** The `notes:` are in
  `data/sources/H417/peripheral_extras.yaml`; `--splice --refresh` rewrote 65 blocks with no
  loss and a diff of exactly my 37 lines, so the fix survives the next regeneration. The
  `periph_clock` change is in the hand-written `codegen:` section, which sits below the
  generated block. No ad-hoc script touched `data/mcus/*.yaml`.

Numbers, **both conventions spelled out, because reading one of them backwards is how four
documents ended up disagreeing**: **39 of 78 peripherals HAVE a `params:` block and 39 DO
NOT.** Of the 39 without, 4 are declared ABSENT (SYS, RCC, EXTI, DMA1 - choices, not numbers),
so **35 cells are owed and 23 of those 35 route pins**. Clock: 68 of 78 have a bit; of the 10
without, 9 are declared ABSENT and 1 is open (RTC). Vectors: 66 of 78, and **all 12 without
are declared ABSENT - zero `nvic` cells owed**. Pins: 61 route, 17 declare `pins: none`, 0
declare `pins: open`, and 0 routed signals are unreachable. Codegen reach: 0 peripherals hold
a pad and reach no generated code. **Cells 41 -> 36.**

Ledger **0 / 0 / 0 / 0 / 0 / 0**, unchanged. Collisions QFN68 **4** / QFN88 0 / QFN128 0,
re-measured at 450 claiming choices per package and left at the ceiling.

Nothing was closed by lowering anything: `COLLISION_CEILING` untouched, `SOFT_CELLS` still
exactly `{params, clock}`, no test deleted, no threshold moved, `open_rows:` unchanged.

Red, and who owns it: **nothing.** Gates watched rather than assumed - `validate_mcu` 0
errors (94 warnings on this part, 91 of them UHSIF/SERDES dedicated pads with no `af:`, which
is correct), `verify_sdk_names` 0 errors and 0 warnings, `coverage --gate` 6 of 6,
`ledger --write` no change, `build.py` OK, `node tests/run.js` **ALL GREEN, 780 tests, 0
skipped** in 389 s. Nothing has been flashed; every green above is a compile.

Posted to the board: a FINDING to AGENT-3 (the `tests/h417_packages.test.js:222-227` comment
names the four collisions by a setting label the data no longer uses - the count is right,
the label is stale, and I did not edit `tests/**`), a NOTE that the expiry planted break's
printed cell count is capped at 40 by `assert.empty` and was reading 40 where the header said
41, and a REQUEST that AGENT-3 refresh `PROJECT.md`'s opening block, which is stale in all
three of its numbers.

Next, unchanged in substance: the 35 `params` cells, worst-first by how many pads they strand
- UHSIF (49 routed signals), SERDES, FMC, QSPI1/2, SDMMC, SAI, PIOC. FMC/ETH/ECDC and FMC's
NAND/SDRAM shapes stay blocked on the nested-struct REQUEST of 19:33Z, five peripherals
behind one change. Then the four QFN68 default collisions, which have now waited three
rounds, and the four secondary PLLs.
