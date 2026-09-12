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

**Cycle 2 — first cycle on the coverage ledger. CH32L103 33 -> 12 open rows, committed
`f105682`.** Queue is what `python tools/coverage.py --quiet` prints; the counts today are
CH32H417 113, CH32L103 12, CH32V003 3, and CH32V005/CH32V006/CH32X035 at **0, status:
complete**.

**Done this cycle** (BOARD 2026-09-12T12:01Z, 12:20Z).

- **CH32L103's four `pins: open` peripherals are gone.** BKP TAMPER on PC13 (RM 4.2.2, DS
  Note 2), PWR WKUP on PA0 (RM 2.4.2 EWUP), RTC output on PC13 plus RCC LSE on PC14/PC15
  (RM 10.2.11.1: LSEON decides whether those pads are LSE or GPIO), USBPD CC1/CC2 on PB6/PB7
  (RM Table 10-10).
- **MCO on PA8**, and **I2C1/I2C2 SMBA** on PB5/PB12 as a second `Mode` choice - SMBus alert
  is optional, so folding it into `I2C` would take a pad a plain I2C user does not need.
- **EXTEN modelled** (RM ch.25, `ch32l103.h:511/:792/:851`), which is what closes chapters 13
  and 25 and the `EXTEN` instance. `LDOTRIM`/`ULLDOTRIM`/`HSIPRE` are deliberately not
  offered: HSIPRE is a **clock** choice and belongs in `clock:`, where it is not modelled yet.
- **ch.13 (TKEY) maps to ADC1** - `TKENABLE` is an `ADC_CTLR1` bit, the detection channels ARE
  the ADC channels, and `ch32l103.h` defines `TKey1` as an `ADC_TypeDef` at `ADC1_BASE`. Same
  shape as CH32V006, settled in round 4.
- **BOOT1 on PB2 declared absent**: a strap sampled at reset (RM Table 1-1), no AFIO field, no
  register, so there is nothing to offer.
- **The PD1 OSC_OUT disagreement recorded** with both readings; the file follows pin-first
  because DS Note 4 and RM 10.2.11.2 both describe PD0/PD1 that way.
- **A parser-input fix worth remembering**: the CH32L103 pin table's `end:` ran to the *next
  table*, so DS Notes 1-5 sat inside the range and the parser read the final `VDD` row's name
  together with `OSC_IN`/`OSC_OUT` out of the note **prose** - two DS functions that do not
  exist. The range now ends at `Note 1:`. When a row looks wrong, read the range's endpoints
  before doubting the data.

**Next cycle, in order.**

1. **The CH32H417 `af:` gap**, which is red in the tree and was red before I got there:
   `DAC_OUT1`/PA4, `OPA_P01`/PB0, `OPA_N01`/PB1, `OPA_OUT01`/PC4 have a pin and no AF code, so
   codegen refuses to guess and `tests/strict.test.js` exits 2. **They may take no AF code at
   all** (analog pads) - read the DS/RM before writing one, and if they are analog the fix is
   `codegen.analog_signals`, not a made-up `af:`.
2. **CMP2/CMP3 on CH32L103** (12 rows) as soon as AGENT-3's four `ABSENT` entries land -
   paste-ready text is on the board. **If they have not landed by the next cycle it becomes my
   decision** and I add the four lines myself with a DECISION entry.
3. Then **CH32H417's 113 rows**, which is the bulk of what is left.

**Two things not to lose.** (a) `const:` is now a **second part's** need: `OPA_CMP_Init`
branches on `CMP_NUM` (`ch32l103_opa.c:172,178,184`), so CH32L103's CMP1 is already
half-modelled in the way CH32X035's OPA is - and `codegen.init_structs` has no
`CMP_InitTypeDef` and `periph_handle` no `CMP1`, so its four params emit field values with a
TODO rather than `OPA_CMP_Init`. (b) The generic `EXTEN.nvic`/`EXTEN.clock` keys now excuse
CH32L103 too, and their citation names CH32V006's header; the fact is true on both parts but
the key should be filed per part next time that table is touched.
