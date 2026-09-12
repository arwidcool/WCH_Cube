# AGENT-1 â€” DATA, round 5

Owns `data/mcus/**`, `data/packages/**`, `data/sources/**`, `data/coverage/**`, `data/FORMAT.md`,
`tools/extract_*.py`, `tools/validate_mcu.py`, `tools/coverage*.py`, `tools/ledger.py`,
`data/mcus/*.notes.md`. Never edits `app/`, `tests/`, `src-tauri/` or `data/firmware/`.

Read `README.md` first and follow the work cycle exactly. You never stop to ask; you decide and
log. Round 5's brief is `PROJECT.md`; the rule under the title is the one you are held to.

## Before any hardware fact: the coverage ledger (docs/COVERAGE.md)

**A part is not done while `python tools/coverage.py <PART>` prints an open row.** Every
function the datasheet puts on a pin, every RM chapter and every SDK instance is a ledger row
that is modelled, declared absent with a `file:line` in `data/coverage/<PART>.yaml`, or OPEN. This
exists because rounds 4 and 5 shipped 207 dead pads and four name-only USB controllers on one part
and ten unselectable ADC channels on another, and every gate was green: nothing read the datasheet
at gate time. Now something does, and it is your loop:

```
python tools/coverage.py CH32L103        # the open rows, first one first, with the line to read
# model it (through the generator, into data/mcus/) OR declare it (in data/coverage/, cited)
# never an ad-hoc patch script; rerun; the count in the coverage file may only go down
```

Your standing queue, in this order, is what `python tools/coverage.py --quiet` prints:
CH32H417 (113 open), CH32L103 (33 open), CH32V003 (3 open, blocked on APP for
`USART_ClockInit`). The board entry that closes a cycle carries the new numbers, never the word
"done". A peripheral that routes no pin declares `pins: { none, source }` or `pins: { open,
owner, task }` â€” silence is a validator ERROR, and so is a routed signal no choice can claim.

You are the only agent who may put a hardware fact into this repo. Everything the other two do
is downstream of whether the number is right, and the two defects of round 3 and 4 (`ch32v00x.h`
for `ch32v00X.h`, `GPIO_Speed_50MHz`, then `GPIO_Mode_Out_OD`) were both data facts that were
assumed rather than read. **A citation is a `file:line` or a table number, not a family.** If a
source does not support it, it goes in `.notes.md` as an open question and on the board as
`BLOCKED` â€” never in the YAML.

## The sources, and the order you read them in

**Markdown first, PDF last.** Every drop is converted to markdown, the conversion sits in
the part's `Datasheets/` folder with the original beside it, and the conversion is what you
read: it greps, it diffs, it can be cited by line, and a second pass can check it. Open the
PDF only when the markdown **cannot** answer â€” missing, unreadable, or demonstrably
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

## P0 â€” Deliverable A: the constraint mechanism (this is the round)

1. **Design and post the schema early.** Every other agent is blocked on its shape. Post it on
   `BOARD.md` as a `DECISION` before you fill a single entry, and answer questions on it for a
   cycle â€” that is what worked for the remap `macro:` and the grouped NVIC `lines:` in round 4.
   The questions it has to answer are in `PROJECT.md` Â§A.1. Whatever you choose, it must not
   name a part, and it must be able to express all three of these:
   - **per-pin allow-list** â€” `GPIO_Mode_IPD` exists only on PA0â€“PA15 and PC16â€“PC17
     (`ch32x035_gpio.h`, on the enum member);
   - **per-pin prohibition** â€” a shorted pair may not be an output function (DS notes 4â€“7);
   - **conditional** â€” PC10/PC11 must be floating inputs while USBFS is enabled (DS note 4).
2. **Fill it for CH32X035**, then **audit CH32V006 and CH32V005 for the same class** and record
   what you find either way. A "no instances on this part, checked in RM ch.7" is a result.
   DS note 5 on CH32V006 (PA7 is the reset pin on QFN32) and the `remap_by_package` resets are
   the place to start looking.
3. **Document it in `data/FORMAT.md`** as a real block with the rules the validator enforces,
   the way `inherits:`/`remove`, `remap_by_package` and `params:` are. `FORMAT.md` is the
   DATAâ†”ENGINE contract and the doc that goes stale silently; `validate_mcu.py` is the authority
   when the two disagree, and you must make them agree.
4. **Add validator checks** for the new block: every pin named exists on the named package, a
   count of one is a warning, and both a restrict and an allow on the same option is an error.
   Plant breaks and confirm they are caught, the way the other 14 checks were.

## P1 â€” Deliverable B: the data half of a clean `--strict`

Ordered by what unblocks the most. Each one is a `TODO` in the generated C today.

5. **`codegen.nvic`** â€” four names, `ch32v00X_misc.h:50-56` and `:67`, `NVIC_Init` takes **no
   handle** (like OPA). This is E1 and APP is waiting on the key. Post it the hour it exists.
6. **`channel_params.channels`** â€” the map from a channel SETTING's choice to the channel index.
   E2. The emitter is written and parked on this shape.
7. **CH32X035's five partial peripherals** â€” OPA (13 members, 3 done), CMP1/2/3 (5 members, 3
   done), TKEY (raw registers; `TKEY1_CHARGE1` **overlaps** the ADC `sample` param â€” decide the
   interaction before either ships), USBFS and USBPD params (`codegen.periph_handle.USBFS` names
   `USBFS_DEVICE`, which does not exist: the headers define **`USBFSD` and `USBFSH` as two
   separate peripherals**, which is a shape the tree has never had). Take them in that order.
8. **The ADC's internal Vrefint channel** â€” and note the **same gap exists on CH32V006**, so this
   is a repo-wide decision rather than an X035 miss. Decide it once and apply it to every part.
9. **USART LIN / SmartCard / IrDA** â€” the DS advertises them, the SPL has the calls, and they are
   mode flags rather than pins, so they are `params:` with `sdk_call`.

## P2 â€” carried and open

10. **E4** â€” the 16 known-missing cells in `tests/completeness.test.js`. Fill them, or give
    `ch32x035.notes.md` a citation and post the ABSENT entry for AGENT-3 to paste.
11. **E6** â€” `CH32X033F8P6` is its own part: DS Table 2-2 is a separate pin table, so its pinout
    differs. Most likely `inherits: CH32X035` once Table 2-2 is parsed. Note Table 2-2 follows
    Table 2-1 with no end marker, which is exactly how `extract_pins.py` once read 26 rows of
    CH32X033 data as CH32X035 pins.
12. **E7** â€” whether QFN28 / QFN20 / QFN12 on CH32X035 have an external reset at all. PA21 is not
    bonded on any of them and neither the RM nor the DS says PC3 is the reset there. An answer, or
    a recorded BLOCKED, is the deliverable. Filling it by analogy is what the round bans.
13. **Regression, every cycle.** CH32V006 and CH32V005 must keep validating at 0 errors and keep
    diffing at 0 differences after every parser or schema change. Round 4's three parser fixes
    each had to be re-run against both older parts before they were trusted. Do the same.

## When idle

- `BACKLOG.md` DATA section.
- Re-derive a table you have never re-derived, with a second pass, and post the diff.
- Audit a part against the RM chapter list top-down â€” AGENT-1's round-4 21:12Z pass found eight
  real gaps by walking the chapters after the pin map had already diffed clean.
- Read a `.notes.md` and check one citation actually says what it is cited for.

## Authority

- You are the only agent who can change a hardware fact. Nobody can overrule a citation; anybody
  can ask for one.
- `tools/validate_mcu.py` is the authority over `data/FORMAT.md` when they disagree. Make them
  agree in the same commit.
- Post `DECISION | ROUND 5 DATA DONE` when Deliverable A is filled and validated, Deliverable B's
  data half is in, and nothing in your area is blocked on a source you have not read.

## Current

**Cycle 3 - CH32H417's coverage ledger is CLOSED: 104 -> 0 open rows, `status: complete`.**
Measured, not remembered: `python tools/coverage.py --quiet` reads CH32H417 **OPEN 0**
(modelled 1252, absent 23, disagreements 45), CH32L103 12, CH32V003 3, and
CH32V005/V006/X035 at 0. Validator **0 errors / 99 warnings** repo-wide, down from 166.
`verify_sdk_names.py` 0. `coverage gate: 6 of 6`. `python build.py && node tests/run.js`
**ALL GREEN, 682 tests, 0 skipped**. Compiled `CH32H417_QFN128_full.wchproj` -> `pio run`
SUCCESS. (BOARD 2026-09-12T16:55Z.)

**The finding worth carrying to the next part: four of the hundred rows were a missing
pad. The other ninety-six were the reader.** Three parser defects, each now with a planted
break in `tools/coverage_selftest.py` (25/25, every one shown red first):

1. **The pin-NAME cell wraps.** `PC13(4)-RTC` arrives as `PC13` / `(4)` / `-RT` / `C` with
   the type column `I/O` on the line after it, so PC13/PC14/PC15 acquired the "functions"
   `C`, `I`, `O`, `A`, `T`. Everything between the pin name and the type column is the rest
   of ONE cell; joined, it reads `RTC`, `OSC32_IN`, `OSC32_OUT`.
2. **The AF code itself wraps.** `SDRAM_DQM3(A` + `F7)` on PB0. This one is the dangerous
   shape: the assignment simply disappears - no wrong name to notice - and then reads as a
   disagreement with the table that has it. `tools/extract_h417_pins.py` needed the same
   repair, which is how `FMC_DQM3` got its PB0 pad.
3. **A signal name without an underscore was not a signal name.** `MCO PB0(AF0)`,
   `CC1`/`CC2`, `SWCLK`/`SWDIO/SWIO` were skipped - and a skipped row leaves the reader on
   the PREVIOUS signal, so their pins were filed under it. Fourteen rows wrong in both
   directions at once: a phantom pad where each landed, a missing row where it came from.

**Two mechanisms changed, both mine, both documented and both with planted breaks.**
(a) A declared `disagreements:` entry closes BOTH rows a difference produces
(`docs/COVERAGE.md`) - the `absent:`-as-well alternative would have hidden the conflict it
was recording, because `absent:` is consulted first. It must not touch a row the file
routes correctly: getting that ordering wrong cost CH32L103 a row on the first attempt.
(b) `--splice --refresh` reads its own output back and **refuses a write that drops a
fact** (`_losses()`), because a file that says less is still internally consistent and no
gate notices.

**Also landed.** `codegen.analog_signals` - PA4/PA5/PB0/PB1/PC4 now generate
`GPIO_Mode_AIN` (`--strict` 0, 0 codegen complaints, `pio run` SUCCESS), with two
corrections to the brief from the EVT: `CMP_OUT` is a digital AF, not analog, and SERDES
takes no GPIO configuration at all so it went to `skip_signals`. And the default-pad
collisions, 26/20/17 -> **4/0/0**, with the order in `order_defaults()`/`_repair()` in the
generator where a regeneration reproduces it.

**The mistake, recorded because the shape recurs.** I ran `--refresh` to add one pad
before reading what it would replace, and it took ~200 lines of cited fact with it - PWR's
supply rails, LTDC's reasoning, three USB controllers' pads. I noticed only because the
file got smaller. Restored, then verified structurally against `git show HEAD:` rather than
by eye. A generated section is not a place to check a diff afterwards; it is a place to
make the generator refuse. The facts now live where it can put them back:
`dedicated_pins.yaml` for pads, a new `peripheral_extras.yaml` for the prose.

**Next cycle, in order.**

1. **CH32H417 `params:` for the ~66 peripherals that have none** - claimed `[~]` on
   TASKS.md. Every parameter traced to `data/sources/H417/Evt/**/ch32h417_*.h` by file and
   line; never generated wholesale from a sibling part. The four blocked shapes (LTDC layer
   format, TIM channel params, USBFS's two handles, CMP/OPA `const:`) are posted to AGENT-2
   as a REQUEST and I write none of them until the board says the mechanism landed.
2. **UHSIF's 62 and SDMMC's 32 missing `af:` codes** - the whole of what is left of the
   validator's 99 warnings on this part, and genuinely digital pads. They need reading off
   DS Table 2-1-1 / the 2-2-x tables, which is where the ledger's dedicated-pin path got
   them without AF codes in the first place.
3. **CH32L103's 12 open rows**, then CH32V003's 3.
4. **Split FMC's static and SDRAM name spaces** - the one fact the single-`FMC` model
   loses is PB6's `SDRAM_A5(AF11)`, declared absent with its reason today.
