# CH32H417 — the pin-planning verification record

**Measured 2026-09-13/14 by AGENT-3, on the working tree, against `data/mcus/CH32H417.yaml` as it
stood after each landing named below.** Every count in this file came out of a command run for
this document (or is quoted verbatim from a board post made at the time a command was run); nothing
is carried over from memory. This file exists because the owner is going to commit money to a PCB
on the strength of it — the value is in being specific and complete about the edges, not in reading
reassuringly. **Where something is not clean, it is a heading below, not a footnote.**

**Nothing here has been flashed.** Every verdict is a text comparison between two independent
readings of the datasheet (or, for two items, the reference manual and the vendor's own example
code); none of it is a claim about silicon behaviour beyond what those documents state.

---

## The question this file answers, and the one it does not

`docs/COVERAGE.md`'s ledger (`tools/coverage.py`, 0 open across all six parts) answers *"is every
datasheet fact accounted for somewhere in the file"*. **This file answers a different, stronger
question: for every peripheral that routes a pad, does the file's `signal_pins:`/`remaps:`/
`signal_groups:` claim the SAME pin, at the SAME alternate-function code, that a SECOND,
independently-read table in the datasheet says it should — checked table against table, not
generator against its own source.**

The second table is `CH32H417DS0.md`'s **Table 2-1-1** — the PIN-first pin definition table
(`tools/extract_h417_pins.py`, AGENT-1's parser) — checked against every peripheral-first
**Table 2-2-N** (`N` = 1..31, one gap at none — every number from 1 to 31 is used) that
`tools/gen_h417_peripherals.py` read when the file was generated. The two tables are structurally
independent: one is organised by physical pin, the other by peripheral signal, and they were
transcribed from different pages of the same PDF. Agreement between them is real evidence; it does
not re-derive the file's own claim from the same source that produced it.

**The headline finding, found the expensive way partway through this work: in this datasheet,
Table 2-2-x is measurably less reliable than Table 2-1-1.** Of every raw disagreement the tooling
found between the file and a Table 2-2-x reading, the large majority turned out to be Table 2-2-x's
own transcription error — confirmed by checking Table 2-1-1 independently — not a defect in the
file. A tool (or a human) that read every Table-2-2-x disagreement as "the file is wrong" would have
recommended several real, correct pins be changed to wrong ones, including reversing a
differential pair. See "Near-misses caught" below.

---

## The one-line verdict

**45 `af_list`-shape peripherals + 7 `no_af`-shape + 2 `internal_channel`-shape + Ethernet + SWPMI +
SDMMC + UHSIF — every peripheral on this part that routes a pad — independently checked against
Table 2-1-1. One real pin defect found and fixed (`FMC.RAS_N`). One reversed differential pair
caught in a datasheet table before it could be copied into the file (`SerDes`). Four disagreements
between the DS's own two tables remain genuinely unresolved and are recorded as `disagreements:`
entries, not guessed at. Two FMC pad collisions on QFN68 are unresolved as to whether they are
fixable or silicon-forced — say which is claimed, and be exact. UHSIF on QFN68 only reaches 5 of
its 8 grouped ports under the RM's own recommended mapping — a real constraint for anyone
choosing that package, not a bug, and not something the default now being set should be read as
having fixed.**

---

## Tooling

| Tool | Shape it covers | Owner | Registered / ad hoc |
|---|---|---|---|
| `tools/audit_h417_pin_functions.py` | `af_list` (18 Table 2-2-x tables) | AGENT-3 | Registered: `TABLES` dict names all 31 Table 2-2-N headings, hard-errors (exit 2) on one it does not recognise |
| `tools/audit_h417_dedicated.py` | SDMMC's `remaps:` / UHSIF's `signal_groups:` (Table 2-2-12/16) | AGENT-3 | Registered, run by `tests/h417_dedicated.test.js` |
| standalone scripts, this cycle | `no_af` (7 tables), `internal_channel` (2 tables), Ethernet, SWPMI | AGENT-3 | Ad hoc — each reuses `tools/extract_h417_pins.py`'s `parse()`, none committed as a standing tool; see "Why not registered" below |

**The three-verdict classifier** (`audit_h417_pin_functions.py`'s `classify()`), applied to every
`af_list` disagreement: `file_defect` (Table 2-1-1 confirms Table 2-2-x against the file — fix the
file), `datasheet_self_contradiction` (Table 2-1-1 confirms the file against Table 2-2-x — the file
is right, the datasheet disagrees with itself), `unresolved` (Table 2-1-1 confirms neither — a real
open question, never guessed). Both required planted breaks are on record: a file corrupted alone
(both real tables agreeing against it) reports `file_defect`; Table 2-2-x corrupted alone in a copy
of the datasheet (Table 2-1-1 and the file both untouched) reports `datasheet_self_contradiction`.
An unrecognised Table 2-2-N heading is a hard error (exit 2) before anything is printed — this
fired for real once, on `Table 2-2-24 Ethernet`, which was missing from the first-pass registry.

**Why the `no_af`/`internal_channel`/Ethernet/SWPMI checks are not wired into the registered
tool.** Each of these tables has enough individual idiosyncrasy — ADC's one table feeding two yaml
peripherals, `DAC1_OUT`/`DAC2_OUT` renaming to the file's `OUT1`/`OUT2`, `USBFS`'s DS prefix
(`OTG_`) differing from its own peripheral name, `SYS`'s Debug table having no common prefix at
all, SWPMI's two-mode-column shape — that forcing them through the `af_list` machinery would have
cost more than a short, targeted script reusing the same underlying parser. Every one of these
checks is real and was run for real (counts below); none is re-runnable with a single command the
way the registered tool is. **This is the gap to close if this file's claims need to be
re-verified in one step later**: promote each ad hoc script into the registry, or accept that
re-verification means re-reading this file's method and re-running the scripts by hand.

---

## Per-shape / per-table results

| Shape / table(s) | Peripherals | Facts checked | `file_defect` | `datasheet_self_contradiction` | `unresolved` |
|---|---|---|---|---|---|
| `af_list` (Tables 4,5,6,7,8,9,11,13,14,15,17,23,25,27,28,29,30,31) | 45 (see list below) | 28 raw disagreements (of many thousands of agreeing facts, not individually counted — agreement is the norm and is not itemised here) | **0** | 24 | 4 (5 pin-level facts; USART8 RTS+CTS counted as one `disagreements:` entry) |
| `no_af` (Tables 1,2,3,10,18,19,20) | ADC1, ADC2, HSADC, DAC, SYS (Debug), USBFS, USBHS, SerDes | 37 | **0** | 1 (SerDes, see below) | 0 |
| `internal_channel` (Tables 21,22) | OPA, CMP | 29 | **0** | 0 | 0 |
| Ethernet (Table 24, ad hoc) | ETH | 24 (20 AF-based + 4 dedicated) | **0** | 0 | 0 |
| SWPMI (Table 26, ad hoc) | SWPMI | 5 | **0** | 0 | 0 pin-level; 1 open **settings-model** question (not a pin fact — see below) |
| SDMMC (Table 12, `remaps:`) | SDMMC | 13 signals, all pins across all 3 `remaps:` sets | **0** | 0 | 0 |
| UHSIF (Table 16, `signal_groups:`) | UHSIF | 49 signals, 62 pin candidates (including PORT0-7's 3-way group) | **0** | 0 | 0 pin facts; 1 open **package-bonding** constraint (QFN68's own default index only bonds 5 of the 8 grouped ports — see below) |

`af_list`'s 45 peripherals: `TIM1-5,8-12`, `LPTIM1-2`, `I2C1-4`, `I3C`, `SPI1-4`, `I2S2-3`,
`USART1-8`, `SDIO`, `CAN1-3`, `FMC` (Table 14 FSMC + Table 15 SDRAM merged — one external memory
controller, two modes), `USBPD`, `DVP`, `QSPI1-2`, `SAI`, `LTDC`, `DFSDM`, `RCC` (Table 30 MCO —
one choice-row of RCC's own setting, not its own peripheral), `PIOC`.

---

## The one real pin defect: `FMC.RAS_N`

Table 2-2-15 (SDRAM) gave `SDRAM_RAS_N` five candidate pins including `PF11(AF12)`; the file had
only four, missing `PF11`. Table 2-1-1 was silent at that exact slot (genuinely, not denied — see
next section for what "silent" versus "denied" means), so the disagreement stayed `unresolved`
against the two-table method alone. **Settled by a third source**: `Evt/EXAM/FMC/SDRAM_16bit/
Common/hardware.c:161-162` — real, shipped example code — configures `GPIO_PinAFConfig(GPIOF,
GPIO_PinSource11, GPIO_AF12)` with the comment `// RAS_N PF11(AF12)` directly above it. AGENT-1
added `PF11(AF12)` to `FMC.RAS_N`'s candidates. Re-verified after the fix: confirmed, no longer a
disagreement.

---

## Near-misses caught before they could be reported as fixes

**These did not become defects, and are recorded here precisely because checking twice is what
prevented them from becoming defects.** Each one, read from Table 2-2-x alone, looked exactly like
a wrong pin in the file.

1. **`SerDes` — a reversed differential pair.** Table 2-2-20 read `SERDES_RXP PE3 / SERDES_RXN PE4
   / SERDES_TXP PE5 / SERDES_TXN PE6`; the file has `TXP:PE3, TXN:PE4, RXP:PE5, RXN:PE6` — RX and TX
   fully swapped against that one table. **Table 2-1-1's own per-pin rows for these four pins**
   (pin type `SDP` = SerDes Pad, `CH32H417DS0.md:3787-3829`) read `PE3→SERDES_TXP`,
   `PE4→SERDES_TXN`, `PE5→SERDES_RXP`, `PE6→SERDES_RXN` — matching the file, not Table 2-2-20. **A
   third source agrees**: a pinout-diagram legend elsewhere in the DS (`:3216`) gives the identical
   mapping. Table 2-2-20 is the one with RX and TX swapped. Had this been reported and "fixed"
   on Table 2-2-x's word alone, a board built to the corrected file would have its SerDes RX and TX
   lines physically reversed.
2. **Ethernet — a naming mismatch that looked like 4 missing pins.** Table 2-2-24 spells the RGMII
   receive-data lines `RD0..RD3`; Table 2-1-1 spells them `RXD0..RXD3` (consistent with
   `TXD0..TXD3`'s already-uniform naming), and the file already uses `RXD0..RXD3`. The first check
   script used the Table-2-2-x spelling and produced 4 false negatives before being corrected to
   check the name both Table 2-1-1 and the file actually use.
3. **`LPTIM2.CH2`, `QSPI2.SIOX2`/`SIOX3`, `I2S2.SD`/`SDO`, two `FMC` entries — 8 of the original 13
   `unresolved` cases collapsed once the classifier's denial test was generalised** (a contested AF
   slot documented on that pin with a DIFFERENT signal denies the claim outright, with no need for
   the pin's whole 0-15 range to be fully enumerated first). All 8 resolved to
   `datasheet_self_contradiction` — the file was right in every one.

---

## What is NOT clean — every open item, named

### 1. Four `disagreements:` entries (Table 2-2-x asserts a pin, Table 2-1-1 is silent, no third
   source resolves it)

Per main's ruling: record both readings, average neither, state which the app routes. None of
these is asserted as a defect; none is asserted as settled either.

| Peripheral.Signal | Pin | Table 2-2-x says | Table 2-1-1 says | Third source checked |
|---|---|---|---|---|
| `LPTIM2.CH2` | `PB12` | `AF13` | `PB12`'s own AF13 slot is documented as `CMP_OUT` (a complete, gapless 0-15 enumeration for this pin) — genuinely contradicts Table 2-2-5, not merely silent | No RM AFIO table exists for this signal name; no LPTIM2 EVT example checked this specific claim |
| `FMC.CKE0` (`SDRAM_CKE0`) | `PB8` | `AF3` | Silent at this slot | Two SDRAM EVT examples exist; between them `CKE0` is exercised on `PF3(AF4)` and `PC5(AF12)` — other valid candidates from the same DS list, neither confirming nor denying `PB8` |
| `FMC.DQM2` (`SDRAM_DQM2`) | `PC11` | `AF1` | Silent at this slot | Same two EVT examples; `DQM2` is exercised on `PC10(AF0)` in the 32-bit example — again a different candidate |
| `USART8.RTS` / `.CTS` | `PE9` / `PE10` | `AF11` on each | Silent at both slots | No USART8 EVT example exists anywhere in the tree (`grep -rln "USART8" --include=hardware.c`: zero results) |

No RM AFIO per-pin mux table exists in `CH32H417RM.md` for any of these five signal names
(`grep`-checked directly, zero hits) — this reference manual does not carry the STM32-style
per-pin alternate-function table the datasheet does, so the RM is not an available tie-breaker
for anything in this file, not just these four.

### 2. SWPMI's "Single wire with supply" — an unresolved settings-model question, not a pin fact

`data/mcus/CH32H417.yaml`'s `"Single wire with supply"` choice claims `[IO, SUP]` together. `IO`
belongs to the DS's "1-wire mode" column (the chip's internal transceiver, one shared pin);
`SUP` belongs to the "Non-1-wire mode" column (an external transceiver, three discrete pins) and
`CH32H417RM.md:11003` scopes it explicitly: `"SWP_SUP (Non-1-wire mode) Suspend signal output"`.
Table 2-2-26 marks `SUP`'s cell `-` (not available) under the 1-wire column. Whether this
"supply" combination is a real fourth wiring mode the silicon supports, or a pin pairing the DS's
own table says does not coexist, could not be settled from the RM's `38.3 Register Description`
prose, and no SWPMI EVT example exists (`ch32h417_swpmi.c`/`.h` exist in `Peripheral/inc`/`src`;
no `Evt/EXAM/SWPMI` project does) to check against. **Flagged for AGENT-1's judgement on the
board; not yet resolved either way.**

### 3. UHSIF — QFN68's own default index bonds only 5 of its 8 grouped ports

**Updated 2026-09-14, after AGENT-1 closed the SDK-argument-to-pin-set linkage this section
previously described as open.** `data/mcus/CH32H417.yaml:8063-8079` now carries
`remap_by_package: { QFN68: 1, QFN88: 2 }`, set from the RM's own words
(`CH32H417RM.md:11839-11845`, right after Table 9-33's three mapping columns: *"The chip packaged
with 56/68 pins is recommended to use the mapping configuration of 01b; It is recommended to use
1xb mapping configuration for chips packaged as 88 pins."*) — not inferred from bonding alone.

**This is the RM's recommendation, and it is checked, but it is not a complete fix for QFN68.**
Index 0 (`RM=00`, this part's own reset default) bonds NONE of `PORT0-7` on QFN68 at all — its
pins (`PF12/PF13/PE7/PE8/PE9/PE10/PE11/PE12`) do not exist on that package. **Index 1 (`RM=01`,
the package default the file now sets) still leaves `PORT0-2` unbonded on QFN68** — `PF12`/`PF13`/
`PE7` again — and only bonds `PORT3-7` (`PC1`/`PC2`/`PC3`/`PB0`/`PB1`, all real QFN68 pads).
**A board designed around QFN68 with UHSIF enabled gets 5 of UHSIF's 8 grouped ports (`PORT3-7`);
`PORT0`, `PORT1`, `PORT2` are not reachable on that package under either index the RM
recommends.** QFN88 with index 2 IS a full fix (`PORT0-7` all bonded, checked the same way);
QFN128 needs no override since its own bonding already carries every `RM=00` pin.

The clock remap (`UHSIF_CLK_RM`, a separate 4-way register field from `UHSIF_PORT_RM`) is not yet
folded into `signal_groups:`; `CLK`'s four candidates are still a flat, ungrouped list — a smaller,
separate open item from the port-bonding constraint above.

### 4. Two FMC pad collisions on QFN68 — status genuinely open, corrected mid-cycle

`tests/h417_packages.test.js`'s `COLLISION_CEILING` for QFN68 dropped from 4 to 2 once UHSIF's
`signal_groups:` landed (the two collisions that fell were both UHSIF's, confirmed by re-running
the sweep, not assumed). **The two that remain: `FMC_A11` defaulting onto a pad shared with
`FMC_A6` on `PB11`, and `FMC_A12` shared with `FMC_A7` on `PB12`, both under the `"Address
lines" = "A0-A15"` choice.** The sweep's own classifier calls both **avoidable** (an alternative,
unclaimed pad exists for each), not silicon-forced — but this has NOT been independently
confirmed by AGENT-1's trace. **A specific correction, made by main, is recorded here rather than
silently folded in**: an earlier summary of this file's status named a *different* pair
(`PD11`/`PD12`) as the one AGENT-1 had traced silicon-forced; that trace was about different pins
than the ones this ratchet actually holds (`PB11`/`PB12`). The two-kind split
(silicon-forced-and-documented versus fixable-and-owed) that main wants for this ratchet is
**not applied to this pair** until AGENT-1 states which kind `FMC_A11`/`PB11` and `FMC_A12`/`PB12`
actually are, checked against Table 2-2-14 specifically, not inferred from a different pair's
result.

---

## Gates run for this record

- `python tools/audit_h417_pin_functions.py` (no args, real files) — `af_list` table, above.
- Ad hoc scripts for `no_af`/`internal_channel`/Ethernet/SWPMI — run interactively, results
  transcribed above and on `agents/BOARD.md` at the time (2026-09-13T23:48Z through
  2026-09-14T00:22Z; search those timestamps for the verbatim tool output this table summarises).
- `node tests/run.js "h417_dedicated"` — ALL GREEN, 2 tests (SDMMC + UHSIF vs Table 2-2-12/16,
  plus the torn-name planted-break guard).
- `node tests/run.js "h417_packages"` — ALL GREEN, 11 tests (collision sweep at the current
  ceiling, both planted breaks).
- `python tools/validate_mcu.py` — 0 errors, 73 warnings.
- `python tools/coverage.py --gate` — 6 of 6.

None of these is the full suite (`node tests/run.js` with no filter) — per the standing rule, that
is run once by main when AGENT-1 and AGENT-2 stop landing, not on a loop while data is moving.
