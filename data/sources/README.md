# `data/sources/` — the hardware documentation everything else is derived from

Nothing in `data/mcus/*.yaml` or in the generated C is allowed to state a
hardware fact that does not come from this folder. Extraction provenance goes in
the matching `data/mcus/<PART>.notes.md`, citing the table it came from.

## Read the markdown first. The PDF is the last resort.

Every drop arrives as a PDF. Each one is **converted to markdown**, and where the
original was kept it sits beside its conversion as `<name>.pdf` / `<name>.PDF`.
The conversion is the **working source** — for the tools, for an agent and for a
human — and the original is the fallback for the cases where the conversion cannot
answer. That order is not a preference, it is the difference between a fact you can
diff and a fact you have to squint at:

| | Markdown (`*.md`) | Original PDF |
|---|---|---|
| grep / diff / cite by line | yes | no |
| read by `tools/extract_*.py` | yes | only by a `recover_*.py` |
| a wrong reading | caught by the tool's own checks | caught by you, by eye |
| cost | seconds | minutes per table, per page |

**The order:**

1. **Read the markdown.** If the table parses, that answer is the answer. It is also
   the only version a second-pass diff can check, which is the standard every part in
   `data/mcus/` has met.
2. **Open the PDF only when the markdown cannot answer** — it is missing, unreadable,
   or *demonstrably* incomplete (the conversion dropped a column, a placeholder cell,
   or a whole table). "The PDF is probably clearer" is not a reason; a table that
   parses cleanly in the markdown is already the better source.
3. **When the PDF is needed, the recovery follows three rules** — all three exist
   because each was learned the hard way:
   - **it says why, in a `PDF FALLBACK:` line.** In the tool's docstring and on every
     run, in the words that name the missing thing. A PDF read that does not say why
     it was necessary is the case this page exists to stop.
   - **it is a script, not a pair of eyes.** `tools/recover_*.py` reads the page by
     word position and then checks its own output against the datasheet's own numbers
     (pin numbers `1..N` with no gaps, the model table's I/O count per package, the
     surviving row order). A plausible-looking wrong table is the one outcome worse
     than no table, and only a check can tell the two apart.
   - **it is written back into the repo, once.** The recovered cells land in a
     declared file next to the conversion (X035's are
     `data/sources/X035/Datasheets/CH32X035_pin_corrections.yaml`), the part's
     `.notes.md` cites the PDF by page/table **and** the declared file, and nobody has
     to open the PDF again. A fact that lives only inside a PDF has not been extracted.
4. **A PDF never stands alone.** Every PDF in a `Datasheets/` folder has its markdown
   conversion beside it; `tests/source_order.test.js` fails the build if one appears
   without the other, and if a script opens a PDF without saying why.

Which drops this has actually been needed for, and what it cost — kept here so the
next person can see the shape of the problem rather than rediscover it:

| Part | The markdown's defect | The recovery |
|---|---|---|
| CH32X035 | RM Table 9-2 (DMA requests) lost its **columns**; DS Table 2-1 lost `-` placeholder cells | `agents/proposals/x035_dma_requests.py`, `CH32X035_pin_corrections.yaml` |
| CH32L103 | DS Table 2-1-1 **drops the `-` placeholder cells**, so a row's five numbers cannot be told apart by position | `tools/recover_l103_pins_from_pdf.py` |
| CH32H417, CH32V003 | pin rows wrap, a name splits mid-token, a leading `-` disappears | not needed so far — the markdown was enough for the pin tables, with a parser and a 1..N assertion |

## Layout

One folder per part family, two folders inside it. The conversion is the file with the
citable name; a PDF beside it is the fallback above and nothing else:

```
data/sources/
├── V006/
│   ├── Datasheets/     CH32V006DS0.md   the datasheet, as markdown
│   │                   CH32V00XRM.md    the reference manual, as markdown
│   └── Evt/            the WCH EVT package for this part
├── X035/
│   ├── Datasheets/     CH32X035DS0.md, CH32X035RM.md
│   │                   CH32X035DS0.pdf, CH32X035RM.pdf     + the two recoveries
│   └── Evt/            the WCH EVT package
├── V003/
│   ├── Datasheets/     CH32V003.md, CH32V003RM.md  (+ .pdf/.PDF originals)
│   └── Evt/
├── H417/
│   ├── Datasheets/     CH32H417DS0.md, CH32H417RM.md  (+ CH32H417DS0.PDF)
│   └── Evt/
└── l103/
    ├── datasheets/     CH32L103DS0.md, CH32L103RM.md  (+ the two .PDF originals)
    └── evt/
```

`H417` and `l103` keep the spelling their drop arrived with; the tools search
recursively and case-insensitively, and `codegen.sdk.evt` cites the path as it exists,
which is what `tests/source_paths.test.js` checks. `V003` arrived lower-case and was
renamed to match the documented spelling — see `PROGRESS.md` for why that mattered.

This layout replaced the earlier flat one on 2026-09-11; `CH32V006DS0.md` and
`CH32V00XRM.md` used to sit directly in `data/sources/`. Paths written before
that date — in `data/FORMAT.md`, `data/mcus/CH32V006.notes.md`,
`tools/extract_remaps.py` and the agent packs — still name the old locations.

## EVT sources — provided per MCU, and authoritative

WCH ships an **EVT** package for each part: the Standard Peripheral Library
sources and headers, the startup files, the linker scripts, the `.svd`, and
worked examples. **An EVT package will be provided for every MCU this project
supports**, in that part's `Evt/` folder — see "Which parts have EVT" below for
which of them have landed (the answer is all of them; the paragraph that used to
sit here said the folders were empty, and it was stale for two rounds).

When a package lands it becomes the **highest authority** for anything the
software has to *name* or *call*:

- register and bitfield names, and which header they live in
- SPL function names, init-struct fields, enum members and their values
- startup code, vector table order, linker script symbols
- which peripherals and which options exist on **this** part, as opposed to its
  family

Precedence, highest first:

**EVT sources → Reference Manual → Datasheet → anything else.**

That order decides *which document is right* when two of them disagree. It is a
different question from the one at the top of this page, which decides *which copy
of one document you read* — **its markdown, or its PDF as a last resort**. Both
apply at once: an EVT header outranks the RM, and the RM's markdown is read before
the RM's PDF.

Where the EVT sources and the RM disagree, they are answering different
questions: EVT says what the SDK will compile, the RM says what the silicon
does. Record the contradiction in the part's `.notes.md`; do not average them and
do not pick the convenient one.

### Nothing outside these sources may be assumed

Not an API, not a peripheral, not a register behaviour, not a pin assignment, not
a startup detail, not an SDK function that "the other CH32 parts have". If a
fact is not in the datasheet, the reference manual or the EVT package, it does
not go into the YAML and it does not go into generated code — it goes into the
part's `.notes.md` as an open question.

The cost of assuming is already on the record. `data/mcus/CH32V006.yaml` used to state
`codegen.speeds: {Low: GPIO_Speed_2MHz, Medium: GPIO_Speed_10MHz, High:
GPIO_Speed_50MHz}` — fixed in round 3, and kept here because it is the example that
earned every rule on this page. Those are the CH32V10x/20x/30x spellings. On CH32V006 the
SPL enum `GPIOSpeed_TypeDef` has exactly one member, `GPIO_Speed_30MHz`, because
`GPIOx_CFGLR.MODEy` is a single bit — CH32V00X RM v1.4 §7.3.1.1: *"1: Output
mode, maximum speed 30MHz; 0: Input mode."* Generated GPIO code for this part
did not compile, and nothing in the repo could see it: the names are real, correctly
spelled SPL identifiers that belong to a different chip, so a validator checking the file
against itself passed, 267 tests passed and a browser passed. Only a compiler disagreed.
`tools/verify_sdk_names.py` exists so that the next one is caught by a tool instead.

## Which parts have EVT, and where its headers are

**Every drop has landed.** They are no longer empty, and `00_PROJECT.md` and the round-3
agent packs are stale where they say otherwise.

| Part | EVT | SPL headers | Startup |
|---|---|---|---|
| CH32V005, CH32V006 | `V006/Evt/` | `V006/Evt/EXAM/SRC/Peripheral/inc/ch32v00X_*.h` | `.../Startup/startup_ch32v00X.S` |
| CH32V003 | `V003/Evt/` | `V003/Evt/EXAM/SRC/Peripheral/inc/ch32v00x_*.h` (small x, a different series) | `.../Startup/` |
| CH32X035 | `X035/Evt/` | `X035/Evt/EXAM/SRC/Peripheral/inc/ch32x035_*.h` | `.../Startup/` |
| CH32H417 | `H417/Evt/` | `H417/Evt/EXAM/SRC/Peripheral/inc/ch32h417_*.h` | `.../Startup/` |
| CH32L103 | `l103/evt/` | `l103/evt/EXAM/SRC/Peripheral/inc/ch32l103_*.h` | `.../Startup/` |
| WCH-DUMMY32-C8 | n/a | synthetic — declares `codegen.sdk: { synthetic: true }`; lives in `tests/fixtures/mcus/`, never in `data/mcus/` | |

The layout is not the one the round-3 brief guessed: the headers sit under `EXAM/SRC/`,
beside the examples, rather than at the root of the drop. `tools/verify_sdk_names.py`
finds them with a recursive search for `Peripheral/inc` so a differently-shaped drop still
works, and `codegen.sdk.evt` in each MCU file names which folder covers that part.

`EXAM/` is worth reading and not only for headers. The TouchKey channel→pin mapping that
sat at Medium confidence for two rounds was settled by an *example*, not by a header:
`V006/Evt/EXAM/TOUCHKEY/.../main.c` says *"this example demonstrates channel 2 (PC4)"* and
then configures GPIOC pin 4. `PUB/` holds the evaluation-board schematics.

## CH32X035, confirmed against its EVT headers before extraction starts

**Historical, and kept because it is the reasoning that produced the file:** these facts
were checked before `data/mcus/CH32X035.yaml` was written from them, and all of them held.
They are recorded here so that the next part of this family starts from checked ground
instead of re-deriving it — and **every one of them differs from the CH32V00x family**,
which is the whole argument against inheriting by analogy.

| Fact | CH32X035 | CH32V005/V006 |
|---|---|---|
| GPIO ports | **A, B, C only** (`ch32x035.h`:656–658) | A, B, C, D |
| Port width | **24 bits** — `GPIO_Pin_0..23` exist (`ch32x035_gpio.h`) | 16 bits |
| Pins per port (DS Fig. 1-1) | PA0–PA23, PB0–PB21, PC0–PC7 **and PC14–PC19** | contiguous |
| Clock enable | `RCC_APB2PeriphClockCmd` / `RCC_APB2Periph_GPIOx` | `RCC_PB2…`, no `A` |
| GPIO speeds | one: `GPIO_Speed_50MHz` (`ch32x035_gpio.h`:25) | one: `GPIO_Speed_30MHz` |
| `RCC_ClocksTypeDef` | **no** `ADCCLK_Frequency` member | has it |
| Peripherals EVT ships | adds `usb`, `usbpd`, `awu`, `PIOC_SFR`; no `tkey` header | no USB |

Two of those are traps rather than trivia. **The ports are 24 bits wide**, so anything
that assumes a 16-pin port — a pin-name regex, a bit mask, a package table — is wrong
here; and **PC has a hole**, running 0–7 and then 14–19, so a port is not a contiguous
range either. Neither is true of any part currently in `data/mcus/`.

The DS markdown for this part is badly mangled by PDF extraction: pin rows are split
across lines and the seven package columns are merged into single cells. Table 2-1 cannot
be read by eye reliably, so the extraction wants a script and a second-pass diff in the
way `tools/extract_pins.py` and `tools/extract_remaps.py` did for CH32V006 — 232 pin
assignments, 0 differences. **Two places needed the PDF instead of the markdown** — the
rows whose `-` placeholders the conversion dropped
(`data/sources/X035/Datasheets/CH32X035_pin_corrections.yaml`) and
RM Table 9-2's DMA request columns (`agents/proposals/x035_dma_requests.py`). Both were
recovered by script, checked against numbers the datasheet states elsewhere, and written
back into the repo: the rule at the top of this page, applied twice.

### PlatformIO's packaged copy of the SDK — the cross-check, not the source

PlatformIO already installs a packaged copy of the same vendor code at
`~/.platformio/packages/framework-wch-noneos-sdk` (`Peripheral/<series>/inc`,
`Core/`, `Startup/`, `System/`, `Debug/`). It carries the same authority in
practice and is where the defect above was found. It is **not** a replacement:
it lags WCH's own releases, it does not cover every part, and it is outside the
repository, so it cannot be cited in a `.notes.md` the way a file in `Evt/` can.

Series names differ from part names and the mapping is not guessable. For the
parts in this repo: CH32V005 and CH32V006 are SPL series **`ch32v00Xx`**, header
`ch32v00X.h` — note the capital X. `ch32v00x.h` is a *different part*,
CH32V003. CH32X035 is series `ch32x035`, header `ch32x035.h`.
