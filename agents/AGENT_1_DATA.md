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

Round 6 opened 2026-09-12. Nothing done yet. Baseline: H417 0 open / 66 params missing /
collisions 4-0-0; L103 12 open / 7 params missing; V003 3 open.
