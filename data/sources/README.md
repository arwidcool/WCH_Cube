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

The cost of assuming is already on the record. `data/mcus/CH32V006.yaml` states
`codegen.speeds: {Low: GPIO_Speed_2MHz, Medium: GPIO_Speed_10MHz, High:
GPIO_Speed_50MHz}`. Those are the CH32V10x/20x/30x spellings. On CH32V006 the
SPL enum `GPIOSpeed_TypeDef` has exactly one member, `GPIO_Speed_30MHz`, because
`GPIOx_CFGLR.MODEy` is a single bit — CH32V00X RM v1.4 §7.3.1.1: *"1: Output
mode, maximum speed 30MHz; 0: Input mode."* Generated GPIO code for this part
therefore does not compile. See `../../PROGRESS.md`.

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
