# `data/sources/` — the hardware documentation everything else is derived from

Nothing in `data/mcus/*.yaml` or in the generated C is allowed to state a
hardware fact that does not come from this folder. Extraction provenance goes in
the matching `data/mcus/<PART>.notes.md`, citing the table it came from.

## Layout

One folder per part family, two folders inside it:

```
data/sources/
├── V006/
│   ├── Datasheets/     CH32V006DS0.md   the datasheet, as markdown
│   │                   CH32V00XRM.md    the reference manual, as markdown
│   └── Evt/            the WCH EVT package for this part  (EMPTY — see below)
└── X035/
    ├── Datasheets/     CH32X035DS0.md, CH32X035RM.md
    └── Evt/            (EMPTY — see below)
```

This layout replaced the earlier flat one on 2026-09-11; `CH32V006DS0.md` and
`CH32V00XRM.md` used to sit directly in `data/sources/`. Paths written before
that date — in `data/FORMAT.md`, `data/mcus/CH32V006.notes.md`,
`tools/extract_remaps.py` and the agent packs — still name the old locations.

## EVT sources — provided per MCU, and authoritative

WCH ships an **EVT** package for each part: the Standard Peripheral Library
sources and headers, the startup files, the linker scripts, the `.svd`, and
worked examples. **An EVT package will be provided for every MCU this project
supports**, in that part's `Evt/` folder. Those folders exist and are empty
today — the drop has not happened yet.

When a package lands it becomes the **highest authority** for anything the
software has to *name* or *call*:

- register and bitfield names, and which header they live in
- SPL function names, init-struct fields, enum members and their values
- startup code, vector table order, linker script symbols
- which peripherals and which options exist on **this** part, as opposed to its
  family

Precedence, highest first:

**EVT sources → Reference Manual → Datasheet → anything else.**

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

**Both drops have landed.** They are no longer empty, and `00_PROJECT.md` and the round-3
agent packs are stale where they say otherwise.

| Part | EVT | SPL headers | Startup |
|---|---|---|---|
| CH32V005, CH32V006 | `V006/Evt/` | `V006/Evt/EXAM/SRC/Peripheral/inc/ch32v00X_*.h` | `.../Startup/startup_ch32v00X.S` |
| CH32X035 | `X035/Evt/` | `X035/Evt/EXAM/SRC/Peripheral/inc/ch32x035_*.h` | `.../Startup/` |
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

`data/mcus/CH32X035.yaml` does not exist yet. These facts are recorded here so that
whoever writes it starts from checked ground instead of re-deriving it — and **every one
of them differs from the CH32V00x family**, which is the whole argument against
inheriting by analogy.

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
assignments, 0 differences. Budget it as a multi-cycle job, not an afternoon.

### Until the EVT drop arrives

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
