# The coverage ledger — every peripheral, every function, every pin

**Read this before you extract, extend or declare done any part in `data/mcus/`.** It is the
process that stops a part shipping with pads no user can claim and peripherals that are only a
name. `CLAUDE.md` at the repository root points here, and so does the agent working agreement.

## The one rule

> Every pin-bearing fact a source states about a part is a ledger row. A row is **modelled** by a
> named signal, or **absent** with a `file:line`, or the build is red. Silence is the defect.

Every other gate in this repository asks whether what an MCU file *says* holds together.
`validate_mcu.py` proves a remap names a real pin; `verify_sdk_names.py` proves a macro exists;
the compile gate proves the C builds. Not one of them asks whether what the **sources** say has
all been said — so a peripheral with `Mode: [Disable, Enabled]`, no signals and a note “holds no
pin” passed every gate, and so did a peripheral whose routing listed ten pads that no choice could
claim. On 2026-09-12 the committed CH32H417 file had **207** such dead pads across 18 peripherals,
CH32L103's ADC routed ten channels with no way to select one, and USBFS, USBHS, USBSS and TKEY
on CH32H417 said “holds no pin on any package” while the datasheet gives every one of them pads.
Nobody could see it, because nothing read the datasheet at gate time.

The ledger reads the datasheet at gate time.

## What is inventoried, and from where

`tools/coverage.py` builds the inventory from the sources named in `data/coverage/<PART>.yaml`,
on every run, mechanically:

| Inventory | Source | How it is read |
|---|---|---|
| **pin functions** | the datasheet's pin table (`Table 2-1-x`), pin-first | on the row token stream: a row is a pin name that follows a run of package cells and is followed by a pin-type token; everything after the type, up to the next row, is a function of that pin. This survives every way the PDF conversion mangles a row (name on its own line, wrapped cells, dropped dash, split subscript, torn name) without a per-row regex |
| **pin functions, second reading** | the datasheet's signal-first table where it has one (`Table 2-3`, or `Tables 2-2-x` on CH32H417) | a different layout of the same silicon, so a parse error in one does not repeat in the other. Where the two readings differ, the difference is a row that must be **declared**, never averaged |
| **chapters** | the reference manual's `Chapter N Title` headings | every chapter maps to a peripheral or is declared not to be one |
| **instances** | `#define X ((X_TypeDef *) …)` in the part's main SPL header | every instance the SDK defines maps to a peripheral or is declared absent |
| **resources** | the datasheet's model table, declared by hand with a citation | the count of peripherals matching a pattern equals what the datasheet says |

The written copy under `data/coverage/ledger/<PART>.yaml` is **generated** (`python
tools/ledger.py --write`) so a human or an agent can open a row and follow its `line:` to the
datasheet. Never edit it: fix the coverage file or the parser and regenerate. The suite checks it
is current.

## The seven checks, and what a row means

`python tools/coverage.py <PART>` prints every **open** row, with the line to read, and exits 1
while any remain.

| # | Check | An OPEN row of this kind means |
|---|---|---|
| 1 | **routed ⇒ claimable** (also a `validate_mcu.py` ERROR) | a signal is routed to a pin and no setting's choice names it: a pad the user can never assign |
| 2 | **no routing ⇒ declared** (also a `validate_mcu.py` ERROR) | a peripheral routes nothing and says nothing; or says `pins: none` while the datasheet lists a pad for it; or says `pins: open` and someone still owns closing it |
| 3 | **DS function ⇒ routed** | the datasheet puts a function on a pin and no peripheral of the file routes it there — or routes it elsewhere, or with the wrong AF code, or the file has no name that answers to it (an alias is missing) |
| 3′ | **routed ⇒ in the DS** (the reverse) | the file routes a signal to a pin the datasheet does not list it on: a wrong pin, a wrong remap index, or a missing alias |
| 4 | **RM chapter ⇒ peripheral** | a chapter is mapped to nothing and declared nothing |
| 5 | **SPL instance ⇒ peripheral** | the header defines an instance the file has no peripheral for |
| 6 | **resource counts** | a declared count from the model table does not match the file |
| 7 | **two-source agreement** | the datasheet's two readings differ on a pin and nobody recorded it |

Plus one guard on the ledger itself: a declaration that matches nothing (an `absent:` token the
sources never produce, a `corrections:` entry for a token that no longer appears) is **dead** and
reported, because a dead declaration reads exactly like one that works.

Row statuses: `modelled` · `absent` (declared, cited) · `disagreement` (declared, cited) · `pad`
(a power or system pad, informational) · **`OPEN`**.

## The two files per part

**`data/coverage/<PART>.yaml` — written, every entry cited.** This is the only place a judgement
is typed. Its sections:

```yaml
part: CH32L103
status: in_extraction          # or: complete
owner: AGENT-1                 # in_extraction only
task: "CH32L103: close the coverage ledger"   # a phrase that must exist in TASKS.md
open_rows: 33                  # what coverage.py counts today; may only go DOWN

sources:
  ds: data/sources/l103/Datasheets/CH32L103DS0.md
  rm: data/sources/l103/Datasheets/CH32L103RM.md
  header: data/sources/l103/Evt/EXAM/SRC/Peripheral/inc/ch32l103.h
pin_tables:                    # the pin-first table(s); `end` is the first later line starting so
  - { start: "Table 2-1-1 CH32L103 Pin definitions", end: "Table 2-1-2" }
signal_table:                  # the second reading, when the DS has one
  { kind: pin_grid, start: "Table 2-3 Pin alternate and remapping functions", end: "## Chapter 3" }
pin_aliases: { OSC_IN: PD0 }   # the DS names a pad after its function, the file after its port

aliases:                       # DS token -> the file's PERIPHERAL_SIGNAL
  USBDM: USBFS_UDM
  T*CH*: TIM*_CH*              # `*` is a wildcard; patterns are tried in file order
  OPA{1}_P{2}: OPA_P{2}{1}     # numbered wildcards the template may reorder
  ADC_IN*: [ADC1_IN*, TKEY_CH*]   # a list means ANY of them routed on the pin satisfies the row
corrections:                   # a token the conversion tore; replaced BEFORE the checks run
  - { pin: PA6, token: ACK4, replace_with: [A6, CK4_1], reason: "...", source: "CH32X035DS0.md:1734" }
absent:                        # the silicon has it, the file will never model it, and here is why
  - { token: RST, pin: PB7, reason: "only on CH32X033 in TSSOP20 - a different part", source: "CH32X035DS0.md:2585" }
  - { chapter: 13, reason: "...", source: "..." }
  - { instance: TIM3, reason: "...", source: "..." }
disagreements:                 # the two DS readings differ; both recorded, neither averaged
  - { pin: PE3, token: SERDES_TXP, reason: "Table 2-1-1 says TXP, Table 2-2-20 says RXP", source: "..." }
chapters:                      # RM chapter -> peripheral(s), or a sentence saying why it is not one
  2: [PWR]
  6: { peripherals: [EXTI], note: "PFIC is the nvic: block" }
  7: "GPIO/AFIO is the pin grid itself"
instances:                     # SPL instance -> peripheral, where the names differ
  TKey1: ADC1
  USBFSD: USBFS
  FMC_*: FMC
resources:                     # optional: the DS model table, cited
  - { name: USART, count: 4, match: "^USART\\d+$", source: "CH32L103DS0.md:131" }
```

Aliases resolve in this order, first hit wins: an exact key; a pattern, in file order; the token
read as `PID_SIG` at any underscore (`TIM2_CH1_ETR` → TIM2 + CH1_ETR); the single-instance
family rule (`OPA_P0` → OPA1_P0 when exactly one peripheral is `OPA<n>`); a bare signal name
exactly one peripheral routes (`MCO` → RCC_MCO). Most datasheets need only a handful of
entries; CH32V003 and CH32X035 abbreviate every function (`T1CH1`, `TX2`, `A13`) and need a
vocabulary.

**`data/coverage/ledger/<PART>.yaml` — generated.** The inventory, one line per fact, with the
datasheet line each came from. `python tools/ledger.py --write` regenerates it; the suite fails
if it is stale.

**And one declaration in the MCU file itself.** A peripheral that routes nothing must say so —
this is what `validate_mcu.py` enforces, and it is the schema change that makes “holds no pin”
a claim instead of a note:

```yaml
peripherals:
  IWDG:
    category: System Core
    pins: { none: true, source: "CH32V006DS0.md Table 2-1-1 and 2-1-2: no pin row carries a function of it" }
  USBFS:
    category: Connectivity
    pins: { open: true, owner: AGENT-1, task: "CH32H417: close the coverage ledger" }
```

`none` is the claim that the silicon gives it no pad, and the ledger checks that claim against the
datasheet: a `none` on a peripheral the DS lists a pad for is an open row. `open` is the admission
that its pads are not extracted yet; it is an open row until it is replaced by routing.

## The loop

This is what an agent runs, and it has a terminating condition that is a number.

```
python tools/ledger.py CH32L103            # optional: read the inventory the tool will use
python tools/coverage.py CH32L103          # every OPEN row, with the line to read; exit 1 while any remain

# take the FIRST open row. Open the cited line. Then exactly one of:
#   (a) MODEL it   - the signal, choice or peripheral goes into data/mcus/<PART>.yaml, through the
#                    part's generator where one exists; a choice that claims it, a remap or
#                    signal_pins entry that routes it
#   (b) DECLARE it - an aliases: / absent: / disagreements: / corrections: entry in
#                    data/coverage/<PART>.yaml, with a file:line the tool can open
# never (c): an ad-hoc script that edits data/mcus/<PART>.yaml in place

python tools/coverage.py CH32L103          # again. Repeat until it prints 0 open, then:
python tools/ledger.py --write             # regenerate the inventory the suite checks
python tools/validate_mcu.py && python tools/verify_sdk_names.py && python build.py && node tests/run.js
```

**Definition of done for a part**, checked against the tree rather than asserted:

1. `python tools/coverage.py <PART>` prints **0 open** and the coverage file says `status: complete`;
2. `validate_mcu.py` and `verify_sdk_names.py` exit 0;
3. a fixture under `tests/fixtures/` assigns pins and the compile gate builds it;
4. `node tests/run.js` is green — `tests/coverage.test.js` runs the gate for every part inside it.

Until 1 holds, the part is `status: in_extraction` with an `owner`, a `task` phrase that exists
in `TASKS.md`, and `open_rows:` set to what the tool counts. **The count may only go down.** The
gate fails if the tool finds more (a regression: new gaps were introduced) and fails if it finds
fewer (lower the number: the count must be current). Raising the number is never the fix; a diff
that does is a review flag.

## Three rules for anyone who writes a hardware fact

1. **A part is not done, and may not be reported as done, while `coverage.py` prints an open
   row.** The open count goes in the board entry and in `PROGRESS.md`, as a number.
2. **A declaration needs a `file:line` the tool can open**, and the tool refuses a `pins: none`
   for a peripheral the datasheet still lists on a pad. “The other CH32 parts have it” is not a
   source, and neither is “probably internal”.
3. **Settings templates name the mode grammar, and are checked both ways.** A generator's
   template says *Asynchronous*, *Full-Duplex Master*, *Channel n*; the signal set comes from the
   inventory. A template that leaves an inventory signal unclaimed fails the reverse check; one
   that claims a signal the instance does not route fails the validator. Neither is a warning.

## What the tool refuses to do

- **Believe a parse that cannot see a pin.** If the pin-table parse finds no row for a pin the
  file bonds, the tool exits 2 with the pins named. A parse that lost four rows of CH32V006 on
  its first run would otherwise have reported those pins' functions as absent.
- **Invent a name to repair a torn one.** The conversion splits names across lines (`I2` +
  `C4_SMBA`, `SD` + `RAM_D20`, `T1CH3N_` + `3`); the tool joins a fragment only when the join
  is a name the file or the datasheet uses elsewhere. What it cannot repair it reports, and
  `corrections:` records the fix with the line it came from.
- **Average two readings.** Where the datasheet's pin-first and signal-first tables disagree
  (CH32H417's SerDes pairs, USART8's CTS/RTS pins), both readings are kept, the difference is a
  row, and the row is closed by a `disagreements:` entry that cites both — never by picking one
  quietly.

  **One entry closes both rows the difference produces.** A token only one reading carries
  opens a check-3 row ("the DS puts this function on this pin and the file does not route it
  there") *and* a check-7 row ("the two readings differ"). They are the same fact, so a
  `disagreements:` entry keyed `{pin, token}` answers both, and both print as `disagreement`
  with its reason — declared and counted, never `modelled` and never silent. It does **not**
  touch a row the file routes correctly: a declaration explains a row, it does not un-route a
  pin. The alternative — an `absent:` entry beside every `disagreements:` one — is worse than
  verbose: `absent:` is consulted first, so the pair would report the row as absent and the
  conflict would never be printed at all. And an entry that explains nothing is **dead** and
  reported, the same guard `absent:` has.
- **Pass on silence.** A source that cannot be read, a coverage file that is missing, a part
  with no coverage file at all: exit 2, named, never a green tick.

## Where the counts stand

`python tools/coverage.py --quiet` prints one line per part. `PROGRESS.md` carries the same
numbers, and a part's `.notes.md` may carry the reasoning behind its declarations, but the
coverage file holds the claim and the tool holds the truth.

Planted breaks: `python tools/coverage_selftest.py` mutates a clean CH32V006 twenty ways — each
validator check, each ledger row kind, each way the gate says no — and requires every one to be
caught. `tests/coverage.test.js` runs it on every suite run. A check nobody has seen go red is
not a check.
