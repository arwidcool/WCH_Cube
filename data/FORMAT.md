# MCU file format

One file per part under `data/mcus/<PART>.yaml`, plus `<PART>.notes.md` next to it saying
where every number came from. This document is the schema. `tools/validate_mcu.py`
enforces it; if the two ever disagree, the tool is right and this file needs updating.

```
python tools/validate_mcu.py          # 0 = clean, 1 = at least one ERROR
python tools/coverage.py <PART>       # every datasheet function / RM chapter / SDK instance the
                                      # file does not account for; 0 open rows is "done" (docs/COVERAGE.md)
python tools/extract_remaps.py        # re-derives the remap tables from the RM and diffs
python build.py                       # inlines every data file into dist/index.html
```

This document says what a file may contain. **`docs/COVERAGE.md` says when a file is
complete**, and the two are checked by different tools: `validate_mcu.py` proves the file is
consistent with itself, `coverage.py` proves it accounts for everything the sources say. A
file can pass the first and fail the second — that is how 207 dead pads shipped on one part —
so a part is not done until both exit 0.

## The one idea that shapes everything else

**Alternate functions are never listed per pin.** They live only in each peripheral's
`remaps:` table, and the app derives the per-pin signal list and every conflict from
those. There is exactly one place to edit a fact, so a pin cannot disagree with a
peripheral about what it can do.

---

## Top level

| Key | Required | What it is |
|---|---|---|
| `mcu` | yes | identity, memory, package list |
| `packages` | yes | pin number → pin name, one table per package |
| `pins` | yes | every pin name that exists on the die, with its type |
| `peripherals` | yes | the left-hand tree: settings, signals, remap tables |
| `exti` | no | external-interrupt line → pin, via AFIO_EXTICR |
| `dma` | no | DMA channel → peripheral requests, and how a request is configured |
| `nvic` | no | every interrupt vector, its owner, and the priority scheme |
| `clock` | no | the Clock Configuration tab |
| `gpio` | no | what the GPIO block on **this part** actually offers |
| `codegen` | no | register encodings the C generator cannot derive |

The loader only *requires* `mcu`, `packages`, `pins` and `peripherals`. Unknown top-level
keys are ignored, which is how `exti:` and `dma:` could be added as data before anything
consumed them. Use that: put the facts in the file, then ask the engine owner for support.

---

## `mcu`

```yaml
mcu:
  name: CH32V006            # unique; the key the app stores projects against
  vendor: WCH
  family: CH32V00x
  core: QingKe RISC-V2A (RV32EmC)
  flash_kb: 62
  sram_kb: 8
  vdd_v: [2.0, 5.5]
  max_sysclk_mhz: 48
  default_package: TSSOP20  # must be a key of `packages`
  variants:                 # the datasheet's model table, one row per orderable part
    CH32V006K8U7: { package: QFN32, flash_kb: 62, sram_kb: 8, temp: 105, io_count: 31 }
```

`variants` feeds the New Project dialog. `io_count` is the datasheet's own I/O column, and
`validate_mcu.py` counts the package table and fails if they disagree. That is what
catches a dropped or duplicated row in `packages:`, so fill it in.

A variant may also carry its build mapping, for the Project Manager's Toolchain panel:

| Key | What it is |
|---|---|
| `pio_board` | the board id the `ch32v` PlatformIO platform ships, e.g. `genericCH32V006F8P6` |
| `pio_env` | the environment in `data/firmware/platformio.ini` — **only where one is actually defined** |

**Do not derive either from the part number.** The board files are the 85 °C grades, and
plenty of orderable parts are 105 °C: `CH32V006F8P7` builds with `genericCH32V006F8P6`.
That substitution is correct — a board file carries clock, flash, RAM, `march`/`mabi` and
the `-D` flags, and **no temperature field at all** — but it is not something a naive
`"generic" + part` rule would produce, and such a rule prints an environment that does not
exist. That is the `ch32v00x.h` defect in a different costume.

A variant the platform has no board for says **nothing** rather than naming the nearest
one: picking a neighbouring board would hand the user the wrong flash size. `pio_env` is
absent far more often than `pio_board`, because `platformio.ini` defines four
environments while the platform ships a board for nearly every part.

`tools/verify_sdk_names.py` checks both against the installed platform and against
`platformio.ini`, and reports NOT CHECKED with a reason when neither is present.

### `mcu.inherits` and `mcu.remove` — a part defined as a delta

A part that is another part minus some things says so, instead of copying 700 lines that
then rot apart. `data/mcus/CH32V005.yaml` is CH32V006 without TouchKey, TIM3 and QFN32,
and is about 130 lines rather than 1600.

```yaml
mcu:
  inherits: CH32V006            # the PARENT's mcu.name. Chains allowed, loops rejected.
  remove:
    - peripherals.TKEY          # dotted paths into the PARENT
    - packages.QFN32
```

How the merge behaves, and every line of this has cost someone a bug:

| Kind | Rule | Why |
|---|---|---|
| maps | merge key by key, **the child wins** | so a child can change one setting without restating the peripheral |
| lists | **replace wholesale — never concatenated** | a `remaps[]` index *is* the AFIO_PCFR1 field value, so appending would silently mis-map every pin after the join |
| scalars | replace | |
| `mcu.variants` | replaces rather than merges | a derived part never shares part numbers with its parent |

**`remove` is applied to the parent, BEFORE the child is merged onto it.** A path that
matches nothing in the parent is a hard error, so a rename upstream fails the load instead
of leaving a removal that quietly does nothing.

That ordering was the other way round until round 3 and it cost this repo a shipped
defect: a child that removed a path **and** redefined it lost its own version too.
CH32V005 removed `dma.request_defaults.TIM3_CH3` and redefined `dma.requests`, and shipped
for a whole round with **no DMA request map at all**, which silently killed channel-clash
detection on that part. Now `remove` means what it says — *drop what I inherit* — and
remove-then-redefine keeps the child's version.

Two habits that follow from this:

- **Prefer redefining to removing** where a map merge already does the job. Listing the
  seven DMA channels you do have replaces the parent's seven outright; adding a removal as
  well says the same thing twice and leaves the next reader guessing which is load-bearing.
- **A new entry in the parent is a new entry in every child.** Adding something to
  `codegen:` here is worth a thought about whether the derived part has that peripheral at
  all — `validate_mcu.py`'s codegen name check is what caught `codegen.analog_signals.TKEY`
  being inherited onto a part with no TouchKey.

Resolution runs before validation, so a child may omit `packages`, `pins` and
`peripherals` entirely; nothing downstream ever sees `inherits`.

## `packages`

```yaml
packages:
  TSSOP20:
    1: PD4
    4: [PD7, PA4]       # internally shorted: ONE physical pin with two names
    7: VSS
  QFN20:
    0: VSS              # pin 0 is the exposed pad, only on packages that have one
```

Rules the validator enforces:

- Numbered pins run `1..N` with no gaps and no duplicates.
- `N` must match the geometry of the same name in `data/packages/packages.yaml`, or the
  chip cannot be drawn.
- Pin `0` is the exposed pad and nothing else. It is excluded from `io_count`.
- Every name must appear in `pins:`.
- A **list** value means those GPIOs are bonded together inside the package. The app
  treats them as one physical pin, so a signal on either name claims it. Look for this in
  the datasheet's notes, not its pin table.

## `pins`

```yaml
pins:
  VDD:  { type: power }
  PA1:  { type: io, analog: true, notes: XI when HSE used (AFIO PA12_RM) }
```

`type` is one of `io`, `power`, `ground`, `reset`, `boot`, `sys`, `nc`, `analog`. Only
`io` pins are assignable; everything else renders as a fixed pad. Allowed keys are
`type`, `analog`, `notes`, `five_volt_tolerant`, `drive` — anything else is an error, for
the reason in the warning below.

Record 5 V tolerance only where the datasheet states it per pin. The CH32V006 datasheet
does not, so that field is absent there. Do not carry it over from another family.

### Ports are not all the same shape, and two of the assumptions are load-bearing

Nothing in `pins:` states a port's width or its range — they are implied by the names —
so the two facts below are implied too, and both were false the moment a second family
arrived. **CH32X035 is the part to test any pin code against.**

| | CH32V005 / CH32V006 | CH32X035 |
|---|---|---|
| Ports | A, C, D | A, B, C |
| Width | 16 bits, `uint16_t` masks | **24 bits, `uint32_t`** — `GPIO_Pin_0 … GPIO_Pin_23` |
| Contiguous? | yes | **no** — port C is PC0–PC7, PC10–PC11, PC14–PC19 |

Two rules follow, and they are rules rather than advice because each has already broken
something in this repo:

- **Never write a 16-bit pin mask.** `uint16_t`, `0xFFFF` and a four-digit hex literal are
  all wrong on a 24-bit port. Take the width from the highest pin number the part has.
- **Never iterate a port `0..max`.** Port C of CH32X035 has holes at 8–9 and 12–13, and an
  iteration invents four pins that do not exist. Iterate the names in `pins:`.

`tools/extract_pins.py` carried the first assumption itself — it matched `P[A-D][0-7]` —
and silently failed to find two thirds of this part's pins until round 4.

## `peripherals`

```yaml
peripherals:
  USART1:
    category: Connectivity      # groups it in the tree
    notes: ...                  # optional, shown to the user
    settings:
      - name: Mode
        type: choice            # or `checkboxes` for a multi-select
        choices:
          - { name: Disable }
          - { name: Asynchronous, signals: [TX, RX] }
      - name: Hardware Flow Control
        choices:
          - { name: Disable }
          - { name: CTS/RTS, signals: [CTS, RTS] }
    remaps:
      - { name: "0000 Default", pins: { TX: PD5, RX: PD6, CTS: PD3, RTS: PC2 } }
      - { name: "0001",         pins: { TX: PD6, RX: PD5, CTS: PC6, RTS: PC7 } }
    remap_by_package: { QFN12: 0, QSOP24: 1 }    # optional, forces a remap per package
```

**`choices[0]` is the off state.** The engine decides whether a peripheral is enabled by
asking whether any setting is still on its first choice. Put `Disable` first. If the first
choice legitimately claims a pin, say why in a comment — the validator warns, and the
warning should not be silenced by reordering something that is physically true. See the
external reset pin on CH32V006 for the worked example.

**Remap index is the register value.** Entry 0 is the default mapping, entry 1 is what you
get when the field reads 1, and so on. Keep them in order and do not add entries for
values that select something other than a pin: model those as a setting instead. CH32V006
TIM1 does this for `TIM1_RM=11xx`, which routes channel 1 to the internal LSI.

**Every remap must offer the same signal keys.** A signal that exists in one remap and not
another silently disappears when the user switches. The validator rejects it.

**Every signal a choice can request must be routed by some remap**, or the choice can
never be satisfied.

**And every signal a remap routes must be requestable by some choice.** The validator
checks both directions. A signal that is routed to a pin and named by no choice is a pad
the user can never assign — it renders on the chip as a function and the picker offers
nothing. Ten ADC channels on CH32L103 and 207 signals on CH32H417 shipped that way
before this check existed (2026-09-12); it is an ERROR, not a warning.

### `title:` and `desc:` — the peripheral's name and what it does

The tree shows `SDIO`, `GPHA`, `UHSIF`, and three to five letters of abbreviation are not
a description. The app names every peripheral from a **glossary of vocabulary** in
`app/engine/glossary.js` (an acronym's expansion is the same sentence on every part, so
writing it into six files is six places for a typo — the same argument the `type:`
vocabulary and the GPIO mode lists follow). Two optional keys let a part say its own:

```yaml
  SDIO:
    category: Connectivity
    title: SD card and SDIO host          # overrides the glossary's name
    desc: >                               # overrides the glossary's description
      Two cards share the bus on this part (CH32H417DS0.md 1.2).
    notes: >                              # unchanged: shown under both
      ...what this part's file has to say about it...
```

| Key | Overrides | Shown |
|---|---|---|
| `title` | the glossary's name | the tree tooltip, the accessible name, and the heading of the panel |
| `desc` | the glossary's one-sentence description | under that heading |
| `notes` | nothing — it is additive | below the description; this is the part-specific half |

**A peripheral the glossary does not know is not guessed at.** With no `title:`/`desc:` it
shows its bare id and no description — the same refusal as a missing `gpio.modes` entry or
a struct with no `init_structs` entry. `unnamedPeripherals()` lists them and the Tools tab
reports the count, so a blank becomes visible instead of silent. Every peripheral of every
part that ships is named, and a new block is named either by adding a glossary entry (the
engine's vocabulary) or by giving it a `title:` in its own file (the data's), which is the
boundary this table exists to keep at one line: **if it is the same on every part it is
vocabulary; if a part could say it differently it is data.**

### `pins:` — a peripheral that routes nothing must say so

```yaml
  IWDG:
    category: System Core
    pins: { none: true, source: "CH32V006DS0.md Table 2-1-1 and 2-1-2: no pin row carries a function of it" }
  USBFS:
    category: Connectivity
    pins: { open: true, owner: AGENT-1, task: "CH32H417: close the coverage ledger" }
```

A peripheral with neither `remaps:` nor `signal_pins:` must carry exactly one of:

| Form | Meaning | Checked by |
|---|---|---|
| `none: true` + `source:` | the silicon gives it no pad. The source is a DS table or note number; a family is not a source | `validate_mcu.py` (the shape); `tools/coverage.py` (the claim — a `none` on a peripheral the datasheet lists a pad for is an open row) |
| `open: true` + `owner:` + `task:` | its pads are not extracted yet. `task` is a phrase that exists in `TASKS.md` | `validate_mcu.py` (the shape); `tools/coverage.py` (it is an open row until routing replaces it) |

Silence — a routing-less peripheral with no `pins:` — is an ERROR, and a `pins:` on a
peripheral that does route is one too. This replaced the prose note “This peripheral holds
no pin on any package”, which USBFS, USBHS, USBSS and TKEY carried on CH32H417 while the
datasheet gave every one of them pads: a note nothing could check, replaced by a claim
something does. `docs/COVERAGE.md` has the whole mechanism.

### `pins.supplies:` — the supply domains the Power setup governs

A supply rail is not a peripheral function, so no pin-table row carries it and `none: true`
stays correct for the power interface — yet which pads carry a rail, over what voltage, and
**constrained against which other rail** is a hardware fact, and hardware facts live in the
data with a citation. The Power setup reads this block; the app derives nothing about a
supply from a pin's `type:`.

```yaml
  PWR:
    category: System Core
    pins:
      none: true
      source: "CH32H417DS0.md Table 2-1-1 and Tables 2-2-x: no pin row carries a function of this peripheral"
      supplies:
        - name: VDDIO
          pins: [VDDIO]
          range: "1.65-3.6 V"
          note: >
            I/O supply: sets the output high level of the regular I/O pins and feeds the I/O
            LDO that produces VIO18. Must not exceed VDD33 or VDD33A.
          source: "CH32H417DS0.md 1.4.3"
```

| Key | Required | What it is |
|---|---|---|
| `name` | yes | the rail as the datasheet writes it (`VDDIO`, `VDD33A`, `VREF+`). A row may cover several pads that are the same domain (`VSS / VSSA`) — the name is then the label, and `pins` carries both |
| `pins` | yes | the pads this rail is bonded to, as declared in the part's own `pins:` table. A name that is not a pin there is an ERROR |
| `range` | no | the operating range, verbatim from the DS. Omitted = "not stated" on screen, which is honest; a made-up number is not |
| `note` | no | what the rail powers and what to connect to it. This is what a designer reads |
| `source` | yes | `file:line` or a DS section/table number. **A family is not a source**, and a rail with no citation is an ERROR — the same rule every other fact in this file follows |

Two shapes are legal, and which one depends on whether the peripheral routes anything:

| Peripheral | Declaration |
|---|---|
| routes nothing (the usual case) | `none: true` + `source:` + `supplies:` |
| **does** route (CH32L103's PWR holds the WKUP pad) | `supplies:` alone — `none`/`open` claim "I have no pad", so they would be false, but `supplies` says nothing about pads |

`tools/validate_mcu.py` checks both shapes, the key set, the required fields, and that every
named pad exists on the part. `tools/coverage.py` treats a supplies-only declaration on a
routing peripheral as **not** a contradicting `pins:` claim, for the same reason. The order
of the list is the order the rails are written, which is the order the DS presents them —
CH32H417's section states `VDD33 >= VDD33A >= VDDIO >= VIO18` at the end, and the file
keeps that order so the constraint reads top-down.

`pins.<NAME>.notes:` on the power, ground, reset, boot and system pins is the other half of
the same job: the hover card shows it, so a bare pad says what it is, what voltage it takes
and what to connect. Every non-io pin of every part carries one (`app/tests/power.test.js`).

A signal that two features share is modelled once. CH32V006 TIM2 routes `CH1_ETR` as a
single signal because channel 1 and the external trigger are the same pin, and it exposes
complementary outputs as a setting that claims the existing `CH3`/`CH4` signals, because
that is physically what the silicon does with those pins.

## Peripheral parameters (`params:`)

`settings:` answers "which pins does this peripheral take". `params:` answers "how is it
configured once it has them" — baud rate, prescaler, polarity. **A parameter never claims
a pin**, which is why the conflict engine can ignore this block entirely. Anything that
changes which pin is used is a `setting` with `signals:`, not a parameter.

The implementation is `app/engine/params.js`; when this document and that module disagree,
the module is right.

```yaml
  USART1:
    params:
      - key: baud                 # identifier: .wchproj key, codegen key. Stable forever.
        name: Baud rate           # the label a user sees
        type: int                 # int | number | enum | bool
        default: 115200           # required; must satisfy its own constraints
        min: 110
        max: 3000000
        unit: Bd
        help: Ceiling is fCK/16, so 3 MBd at the 48 MHz maximum. USART_BRR.
      - key: stop
        name: Stop bits
        type: enum
        default: "1"
        options:
          - { name: "1",   value: 0 }
          - { name: "0.5", value: 1 }
          - { name: "2",   value: 2 }
          - { name: "1.5", value: 3 }
        help: "USART_CTLR2 STOP[13:12], listed in register order."
```

### Fields

| Field | Required | Meaning |
|---|---|---|
| `key` | **yes** | stable identifier. An entry without one is silently dropped by `paramDefs()`, so a whole block can look fine in the file and not exist to the app |
| `name` | no | label; defaults to the key |
| `type` | no | `int`, `number`, `enum`, `bool`; inferred from `options`/`default` when omitted |
| `default` | yes | what a fresh project starts with; for `enum` it is an option **name** |
| `min` / `max` / `step` | numeric only | bounds are enforced on the way in, so nothing downstream re-checks |
| `unit` | no | shown after the value: `Bd`, `Hz`, `cycles` |
| `options` | enum | plain names, or `{ name, value }` pairs |
| `help` | no | one sentence, shown as help text |
| `when` / `depends_on` | no | when the parameter applies at all |
| `struct` / `sdk_field` | no | the `*_InitTypeDef` and the exact member this parameter sets |
| `sdk_call` | no | the SDK function that sets it, when no struct member exists |
| `sdk_args` | with `sdk_call` | its argument list, as placeholders |
| `sdk_repeat` | no | `channels` — one call per enabled channel rather than one per peripheral |
| `sdk_enabled` / `sdk_disabled` | `bool` only | the macros for true and false, e.g. `ENABLE` / `DISABLE` |
| `sdk_none` | no | the SDK exposes neither; codegen must write the register |
| `sdk_note` | no | why, when one of the three above is not the obvious answer |

### Say where in the SDK each parameter goes

Codegen must not infer the SDK mapping from a display name. `struct` + `sdk_field` say it
outright, and `tools/verify_sdk_names.py` checks that the type exists, that the member is
really a member of it, and that every option's `sdk` macro exists:

```yaml
- key: word
  name: Word length
  struct: USART_InitTypeDef
  sdk_field: USART_WordLength
  options:
    - { name: 8 bits, value: 0, sdk: USART_WordLength_8b }
    - { name: 9 bits, value: 1, sdk: USART_WordLength_9b }
```

**Not every parameter is an init-struct member, and guessing that it is produces code that
does not compile.** Three cases, all of them real on CH32V006:

| Case | Say | Example |
|---|---|---|
| the SDK sets it with a function | `sdk_call:` | `arpe` → `TIM_ARRPreloadConfig`; `TIM_TimeBaseInitTypeDef` has no such member |
| the SDK exposes nothing at all | `sdk_none: true` | ADC `lowpower` — `ch32v00X_adc.h` has neither a member nor a function for `ADC_CTLR1.ADC_LP` |
| it belongs to a **different** struct | `struct:` naming that one | TIM1 `deadtime` → `TIM_BDTRInitTypeDef.TIM_DeadTime`, applied by `TIM_BDTRConfig`, not `TIM_TimeBaseInit` |

**`sdk_call` needs `sdk_args`.** Knowing *what* to call is not knowing *how*; without the
argument list the generator emits a TODO instead of the call. Arguments are a list of
placeholders, and anything that is not a placeholder is passed through literally:

| Placeholder | Resolves to |
|---|---|
| `$HANDLE` | `codegen.periph_handle[<peripheral>]` — the register block, e.g. `ADC1` |
| `$VALUE` | the option's `sdk` macro; for a `bool`, `sdk_enabled` / `sdk_disabled` |
| `$CHANNEL` | `codegen.channel_macros[<peripheral>][<signal>]`, under `sdk_repeat: channels` |
| `$RANK` | the 1-based position of that channel in the conversion sequence |
| `$INDEX` | the 0-based loop index |

```yaml
- key: arpe
  sdk_call: TIM_ARRPreloadConfig
  sdk_args: [$HANDLE, $VALUE]      # TIM_ARRPreloadConfig(TIM1, ENABLE)
  sdk_enabled: ENABLE
  sdk_disabled: DISABLE
```

`sdk_repeat: channels` is for a call that is **per channel, not per peripheral**. ADC
sample time is the only one today: `ADC_RegularChannelConfig($HANDLE, $CHANNEL, $RANK,
$VALUE)` runs once for each enabled channel. `verify_sdk_names.py` rejects a placeholder it
does not define, so `$HANDEL` fails the gate instead of reaching generated C as literal text.

**`sdk_call_order: before_structs`** — every `sdk_call:` row is emitted *after* every
`struct:` block for the peripheral, by default, because that has been true of every case
until now and most calls are order-independent (`TIM_ARRPreloadConfig` above does not
care whether the time base was already applied). Some calls are a **precondition** for a
struct write to take effect rather than an independent setting: CH32H417's LPTIM is the
proven case (`CH32H417RM.md` 17.5.5, `LPTIMx_CR`) — `LPTIM_TimeBaseInit()` writes
`CNTSTRT`/`SNGSTRT`/`OUTEN` into the SAME register as `ENABLE`, preserving whatever
`ENABLE` already was (`ch32h417_lptim.c:54,76-77`), and the RM says outright those three
bits are "write only when ENABLE=1". Emit `LPTIM_Cmd(handle, ENABLE)` in the default
order (after `LPTIM_TimeBaseInit()`, as an ordinary `sdk_call` would be) and the write
lands while `ENABLE` is still 0 — it compiles, `CNTSTRT`/`SNGSTRT`/`OUTEN` never latch,
the counter never starts and PWM output never enables, and nothing says so. Marking that
row `sdk_call_order: before_structs` moves it ahead of every struct block for that
peripheral, matching the vendor's own EVT example (`LPTIM_Cmd` before `LPTIM_TimeBaseInit`,
`hardware.c:55,95`). Leave it unset for the ordinary case; only add it when a call's
own documentation says a struct write depends on it.

`sdk_none` without an `sdk_note` is a warning: an unexplained gap reads as an oversight
rather than a finding. And note ADC `sample`: it is `sdk_call: ADC_RegularChannelConfig`
because sample time is an argument set **per channel**, not a property of the peripheral —
a mapping that is invisible from the display name and wrong if assumed.

### `channel_params` — an init struct that is filled once per channel

Most init structs are filled once per peripheral. `TIM_OCInitTypeDef` is not: a timer has
one time base and up to four independent compare units, so the struct is filled and
applied once for **each configured channel**.

```yaml
TIM1:
  channel_params:
    struct: TIM_OCInitTypeDef
    applies_per: channel
    sdk_calls: { 1: TIM_OC1Init, 2: TIM_OC2Init, 3: TIM_OC3Init, 4: TIM_OC4Init }
    params:
      - key: ocmode
        sdk_field: TIM_OCMode
        options: [{ name: PWM mode 1, value: 6, sdk: TIM_OCMode_PWM1 }]
```

The entries under `params:` use **exactly the same schema** as `dma.channel_params`, so
one set of per-channel editors renders both and one checker checks both.

**`sdk_calls` is a table, not a pattern.** Four different functions apply this struct —
`TIM_OC1Init` … `TIM_OC4Init` — so `codegen.init_structs`, which maps a struct to a single
`fn`, cannot express it. Write the four out rather than leaving the generator to paste
`TIM_OC${n}Init` together from a number: deriving a function name from a number is the
same class of guess as deriving one from a struct name, which the generator already
refuses to do.

**A member the peripheral does not have is absent, not disabled.** The header marks
`TIM_OCIdleState` and `TIM_OCNIdleState` valid *only* for TIM1, so TIM2's list has six
entries and TIM1's has eight. That is the same rule as `gpio.speeds`: what the part does
not have is not offered.

### `depends_on: { instance_setting: ... }` — a dependency whose SETTING NAME varies per instance

Every `depends_on`/`when` above is checked against the PERIPHERAL's settings once — right
for `channel_params` whose own fields are free enums (DAC's trigger/wave, LTDC's layer
members), because nothing about them depends on which instance is being filled. CH32H417
OPA breaks that: `OPA_InitTypeDef.PSEL` is derived from a setting whose *name itself*
changes per instance — `"OPA1 positive input"`, `"OPA2 positive input"`, `"OPA3 positive
input"` are three DIFFERENT settings on ONE shared peripheral, not one setting three
instances could share. Checking `depends_on: { setting: "OPA1 positive input", ... }`
against the peripheral once would apply instance 1's choice to instances 2 and 3 alike —
a number that compiles and configures the wrong op-amp, the same defect class `CMP_NUM`
already exists to prevent (right for instance 1 by accident, wrong for the rest).

```yaml
channel_params:
  struct: OPA_InitTypeDef
  applies_per: channel
  instances:
    1: { sdk_call: OPA_Init, handle: OPA1, setting: "OPA1 positive input", active_choices: [P0, P1] }
    2: { sdk_call: OPA_Init, handle: OPA2, setting: "OPA2 positive input", active_choices: [P0, P1] }
    3: { sdk_call: OPA_Init, handle: OPA3, setting: "OPA3 positive input", active_choices: [P0, P1] }
  params:
    - key: psel
      name: Positive input select
      sdk_field: PSEL
      type: enum
      default: P0
      options: [{ name: P0, value: 0, sdk: PSEL_P0 }, { name: P1, value: 1, sdk: PSEL_P1 }]
      depends_on: { instance_setting: "OPA{n} positive input", equals: P0 }
```

`{n}` is substituted with the ACTIVE instance's own number — `1`, `2`, or `3` — only at
the point `channel_params:`'s per-instance loop checks the dependency, never earlier;
`normDeps()` keeps the literal `{n}` in the parsed dependency's name. Every OTHER
dependency kind (`setting:`, `param:`, plain `when:`) is unaffected and unchanged: an
`instance_setting` dependency checked OUTSIDE a `channel_params:` instance loop (no
instance to substitute) is left applicable, the same "an unresolvable dependency does not
hide a field" rule every other dependency kind already follows.

### `call_arg: true` — a scalar the apply call needs beside the struct pointer

Every mechanism above assumes the function that applies a struct takes the struct alone
(or the struct plus the peripheral's own handle). CH32H417's Ethernet MAC does not:
`ETH_RegInit(ETH_InitTypeDef* ETH_InitStruct, uint16_t PHYAddress)` (found only in EXAMPLE
driver code, `Evt/EXAM/ETH/.../ETH_Driver/eth_driver_100M.c:482` — there is no `ETH_Init()`
in `Peripheral/src` at all) takes a second argument that is not a struct member anywhere:
the MDIO address of whichever PHY chip the board actually wires up, a real per-board
choice, not a fixed fact `const:` could name.

```yaml
peripherals:
  ETH:
    params:
      - key: phy_addr
        name: PHY address
        struct: ETH_InitTypeDef
        call_arg: true          # NOT a struct member - an extra argument to its apply call
        type: int
        default: 1              # cite the EVT's own gPHYAddress, not a guess
        min: 0
        max: 31
        help: "ETH_RegInit()'s second argument - which MDIO address the board's PHY answers to."
```

A `call_arg:` param is still an ordinary, editable, validated `params:` row — `type:`,
`min:`/`max:`, `default:` all mean what they always mean. The only difference is where its
value lands: appended to the struct's own apply call, in declaration order, after the
struct pointer (`ETH_RegInit(&ETH_InitStructure, 1)`), rather than assigned to a member. A
struct may have more than one `call_arg:` row; they are emitted in the order they appear.

### `codegen.init_structs.<struct>.dead_fields` — a member that must never be modelled

Not every field of a struct the generator CAN fill is a field the generator CAN apply.
CH32H417's `ETH_InitTypeDef` is 47 fields, but `ETH_RegInit()` — the only function that
ever applies it to hardware — reads just 26 of them (confirmed identical in both driver
variants, 100M and RGMII); the other 21 are filled only by `ETH_StructInit()`'s defaults,
which nothing reads back. A `params:` row for one of those 21 would compile, render as an
ordinary control in the UI, and change nothing on the board — the exact "plausible-looking
wrong code" this generator exists to refuse, and refusing it once by not writing the row is
not the same as refusing it FOREVER: the next person to open the header sees a real struct
member and a gap that looks like an oversight.

```yaml
codegen:
  init_structs:
    ETH_InitTypeDef:
      fn: ETH_RegInit
      dead_fields: [ETH_AutoNegotiation, ETH_CarrierSense, ETH_Speed, ETH_ReceiveOwn,
                    ETH_Mode, ETH_RetryTransmission, ETH_BackOffLimit, ETH_DeferralCheck,
                    ETH_ZeroQuantaPause, ETH_PauseLowThreshold, ETH_ReceiveStoreForward,
                    ETH_FlushReceivedFrame, ETH_TransmitThresholdControl,
                    ETH_ReceiveThresholdControl, ETH_SecondFrameOperate,
                    ETH_AddressAlignedBeats, ETH_FixedBurst, ETH_RxDMABurstLength,
                    ETH_TxDMABurstLength, ETH_DescriptorSkipLength, ETH_DMAArbitration]
```

**Each entry is the exact `sdk_field:` string a `params:` row would use** — the struct's
real member name, `ETH_`-prefix included (`codegen.js` compares `dead_fields` against
`d.sdk_field` verbatim, `spec.dead_fields.includes(d.sdk_field)`) — not an abbreviated or
display-friendly form. A `params:` row whose `sdk_field:` names a listed member is refused
with a TODO on the struct's own block — the same `--strict`-visible failure as a missing
`fn:` or handle, not a quiet note — so adding one of the 21 back is a red gate, not a
silent, accepted mistake.

### `codegen.sdk.driver_c` — a name no header anywhere declares

```yaml
codegen:
  sdk:
    evt: H417
    series: ch32h417
    driver_c: [EXAM/ETH/MAC_RAW/Common/ETH_Driver/eth_driver_100M.c,
               EXAM/ETH/MAC_RAW/Common/ETH_Driver/eth_driver_RGMII.c]
```

`tools/verify_sdk_names.py` reads every `.h` under the EVT's `Peripheral/inc` (and any
driver header found the way `signal_pins:` documentation describes for UHSIF) for
DECLARATIONS. That misses a function that is never declared anywhere and only DEFINED in
an example's own source — CH32H417's `ETH_RegInit` is the proven case: there is no
`ETH_Init()` in `Peripheral/src` at all, and the only function that ever applies
`ETH_InitTypeDef` to hardware is defined once, in the example driver's own `.c`, with no
prototype in any header, including the one beside it.

`driver_c:` names the exact `.c` file(s), paths relative to the part's own `Evt/` root,
to read for function DEFINITIONS instead of declarations. **Deliberately a hand-curated
list of files, not a filesystem rule** — see `tools/verify_sdk_names.py`'s own
`driver_c_files()` docstring for the general rule that was tried first (a public function
whose name-prefix matches some real SPL peripheral's own prefix) and measured to be
wrong on 194 of the 194 names it found on this one EVT drop, most of them an unrelated
example's own local helper sharing a real peripheral's prefix by coincidence
(`FLASH_ReadID` in an example's own SPI-NOR-flash driver, nothing to do with the on-chip
FLASH peripheral). A function marked `static` in a designated file is still excluded — a
name private to its own translation unit is never part of anything exported.

### Give every enum its register encoding

Write `options` as `{ name, value }` whenever the reference manual states the field
encoding, and put the field itself in `help`:

```yaml
options:
  - { name: "2",  value: 0 }      # SPI_CTLR1 BR[5:3]
  - { name: "4",  value: 1 }
```

A plain list of names is only a label. With values, `paramRegisterValue(pid, key)` returns
the number the generator has to emit, and the value becomes checkable against the manual
instead of folklore. Write the encoding the manual gives, never a sequential index that
happens to line up.

### `when` and `depends_on`

`when` tests a **setting**, `depends_on` tests another **parameter**:

```yaml
when: { Mode: Asynchronous }
depends_on: { param: crc, equals: true }
```

A parameter that does not apply is reported as `applicable: false` rather than hidden, so
the user can still see it exists. Neither form can test a numeric parameter's *value*, so
a dependency like "fast-mode duty cycle only matters above 100 kHz" belongs in `help`
until the engine can express it.

### Rules

- **`default` must be valid against its own constraints** — inside `min`/`max`, or exactly
  one of the `options` names.
- **Bounds are physical, not preferences.** `max: 3000000` on a baud rate is fCK/16 at
  48 MHz, not a round number someone liked.
- **Do not model a fixed hardware fact as a one-option parameter.** There is no read-only
  flag, so a single-option enum reads as a choice the user could make. State it in the
  peripheral's `notes:` instead — ADC resolution on CH32V006 is the worked example.
- **Do not duplicate a setting.** Hardware flow control decides whether CTS and RTS claim
  pins, so it is a setting; adding a `flow` parameter beside it would let the two disagree.

### Two ways a remap reaches the silicon, and the data says which

A `remaps[]` entry lists which pin each signal lands on for one AFIO setting. **How that
setting is written differs by family**, so `codegen.remap.style` names the route and
neither family is special-cased.

**`style: register`** — the default, and what CH32V005/CH32V006 do. `codegen.remap` carries
a register and a field per peripheral, and the generator builds the word:

```yaml
codegen:
  remap:
    register: "AFIO->PCFR1"
    fields:
      USART1: [{ lsb: 6, bits: 4 }]
```

**`style: macro`** — what CH32X035 does. Its EVT exposes forty named macros applied with
one call, and each `remaps[]` entry carries the one that selects it:

```yaml
codegen:
  remap:
    style: macro
    fn: GPIO_PinRemapConfig
    enable: ENABLE

peripherals:
  USART2:
    remaps:
      - name: No remap                                     # index 0 has no macro
        pins: { TX: PA2, RX: PA3 }
      - name: Full remap
        macro: GPIO_FullRemap_USART2
        pins: { TX: PC0, RX: PC1 }
```

The generator emits one `GPIO_PinRemapConfig(<macro>, ENABLE)` per enabled peripheral whose
selected index has a macro, and **emits nothing for an index with none** — which is how
"No remap" stays silent without a special case.

Why macro rather than raw fields where both would work: the EVT examples all use
`GPIO_PinRemapConfig`, so it is the spelling a user reading WCH's own code recognises; the
macro packs register position *and* value into one constant that the SDK decodes, so
building the mask by hand means re-deriving an encoding the SDK already knows; and a wrong
macro name fails to compile and is caught by `verify_sdk_names.py` first, where a wrong
hand-built mask is silent.

**`remaps[].macro` is checked**, and it was not always: CH32X035 landed 44 of them and a
planted `GPIO_FullRemap_USART2X` passed the gate, because the key was new and nothing
looked at it. Every new schema key needs its checker in the same commit.

---

## `signal_pins` — when the silicon muxes per PIN, not per peripheral

Everything above assumes the idea this document opens with: **one register field moves
every signal of a peripheral at once**, so a `remaps[]` index is a complete, atomic,
register-valued choice. That is true of CH32V003/V005/V006 (an AFIO_PCFR1 field) and of
CH32X035 (a `GPIO_PinRemapConfig` macro).

**It is not true of CH32H417**, and the difference is not a detail. That part gives every
PIN four bits of its own — `GPIOx_AFRL` / `GPIOx_AFRH`, `AFRy[3:0]` = AF0..AF15, RM 9.3.2.2,
applied with `GPIO_PinAFConfig(GPIOx, GPIO_PinSource<n>, GPIO_AF<n>)` — so **each signal
picks its pin independently**. `USART1_TX` on PD13 with `USART1_RX` on PB15 is legal, and
so is every other combination.

`remaps:` cannot hold that, and the number says how badly. Run
`python tools/extract_h417_pins.py --audit`:

```
  signals with an AF code   : 418
  signals reaching >1 pin   : 294 of 418 (70%)
  ALL        418 signals -> 851,948,976,569,927,895,391 entries
```

USART1 alone is 2 × 4 × 4 × 2 × 2 = **128** legal combinations, none of which is a register
value. So a part like this declares `codegen.remap.style: af` and replaces `remaps:` with
`signal_pins:`, one entry per signal:

```yaml
codegen:
  remap:
    style: af                     # per-pin. The other two are `register` and `macro`.
    fn: GPIO_PinAFConfig          # the call that applies it
    macro: GPIO_AF$AF             # $AF is substituted with the entry's `af:`

peripherals:
  USART1:
    signal_pins:
      TX: [{ pin: PA9,  af: 7 }, { pin: PB6, af: 7 }, { pin: PB14, af: 4 }, { pin: PD13, af: 14 }]
      RX: [{ pin: PA10, af: 7 }, { pin: PB7, af: 7 }, { pin: PB15, af: 4 }, { pin: PD12, af: 14 }]
```

| Key | Required | What it is |
|---|---|---|
| `pin` | yes | a pin name, which must exist in `pins:` |
| `af` | no, but warned | the AF code that pin's `AFRy` field must hold, 0–15. **Without it the generator emits a TODO rather than guessing a number** — the same rule that stops it deriving a function name from a struct name. |
| `notes` | no | why, for an entry that needs one |

### The rules, and why each one exists

- **A peripheral has `remaps:` or `signal_pins:`, never both.** The engine reads
  `signal_pins` first, so a file with both would have a `remaps:` list that silently never
  applies. Rejected rather than resolved by precedence.
- **`style: af` and `signal_pins:` require each other**, checked in both directions. A
  `style: af` with no peripheral to apply it to emits nothing; a `signal_pins:` under any
  other style reaches the pinout and never reaches the generated C. Both look like working
  data, which is why both are errors.
- **`style: af` forbids `codegen.remap.fields`.** There is no per-peripheral AFIO field to
  write. (CH32H417 still *has* an `AFIO_PCFR1`, but it carries only `PD0_1_REMAP`,
  `UHSIF_CLK_RM`, the PIOC port map and four ADC trigger-*source* bits — none of which is
  pin muxing.)
- **The same pin may not be listed twice for one signal.** The user's choice is keyed by
  pin name, so the second entry is unreachable.
- **Every signal a setting can request needs an entry**, exactly as it needs a remap.
- **…and every entry needs a setting that can request it.** This is the other direction, and
  it is checked too: `requiredSignals()` derives every pin claim from the settings, so a
  `signal_pins:` row no `choices[].signals` names is **decoration** — the pin grid cannot
  offer it, the conflict engine never sees it, and the generated C never muxes it. The pin
  is unusable and nothing says so. `tests/completeness.test.js` asserts this for every
  peripheral of every real part, with `codegen.skip_signals` exempt (those pads are claimed
  by the debug interface or by `clock.hse_*`, and no setting may name them).

  It is worth knowing how this looks in practice, because it is not obvious in a diff: on
  2026-09-12 CH32H417 had **167** such rows and the peripheral tree still rendered them as
  working peripherals. `ADC1` offered two of its sixteen channels, `ADC2` had no
  `signal_pins:` at all, `FMC` claimed none of its 87 pins, and `UHSIF` and `SERDES` claimed
  nothing — every one of them an empty shell that validated and compiled.

  A related trap, an engine fact rather than a data rule: a `checkboxes` row defaults to
  **nothing ticked**, but any other row defaults to `choices[0]`. So a channel list written
  as plain choices silently selects its FIRST channel on a freshly created project, which is
  a real pin. A row offering a set of things wants `type: checkboxes`.

### What it means for the three consumers

The engine funnels both shapes through one function, `signalPins(pid)` in
`app/engine/model.js`, which answers "signal → pin" in the same shape a `remaps[]` entry
has. Everything downstream — the pin grid, the conflict engine, the picker, codegen — asks
that and never looks at either key. **A part with no `signal_pins:` therefore gets back the
very object the old code read**, which is what keeps the remap parts byte-identical.

Three behaviours do differ, and all three follow from signals moving alone:

1. **The peripheral panel shows one selector per signal**, not one remap dropdown. A list
   of whole-peripheral combinations could only ever offer a fraction of the legal ones.
2. **`previewAssign` warns about the clicked pin only.** There is no sibling to drag along,
   so "remap collides on …" cannot happen and is not reported.
3. **`isAvailable` tests each signal separately** — a peripheral is usable when every
   signal a choice needs has at least one bonded pin, rather than when one listed
   combination happens to be fully bonded.

A signal the user has not moved uses **the first option bonded on the current package**,
falling back to the first option at all. Preferring a bonded pin matters on a part whose
packages drop whole ports: defaulting to an absent pin would make a peripheral look
unusable where three other pins would have served.

### Saving

`.wchproj` records `af_pins: { <signal>: <pin> }` per peripheral, and **only for signals
the user actually moved** — a default is not a decision. A saved pin the part no longer
lists is dropped and named, never carried, the same contract `gpioSpeedFor()` applies to a
speed the part no longer offers.

`tools/validate_afmux_selftest.py` plants a break in each of these checks and requires the
validator to catch it, because a check that cannot fail is worth nothing.

### `signal_groups` — a NAMED SUBSET that moves together, inside an `af`-muxed peripheral

Everything above assumes an `af`-muxed peripheral's signals are *all* independent — the
whole reason `signal_pins:` replaces `remaps:` in the first place. CH32H417 UHSIF breaks
that assumption for exactly eight of its 49 signals: `UHSIF_PORT_RM` moves `PORT0`-`PORT7`
together under ONE shared, three-valued field — structurally identical to `SDMMC_RM` (the
`remaps:` case above) — while `UHSIF_CLK`'s four options are a genuinely independent
choice (a lone signal has nothing to disagree with) and `PORT8`-`PORT47` have exactly one
candidate each (no choice, nothing to couple). Neither `remaps:` nor `signal_pins:` alone
fits: `remaps:` would force every one of the other 41 signals into a shape they do not
need; `signal_pins:` cannot express the coupling at all, which is the exact defect this
key exists to close — offering `PORT0` from one mapping alongside `PORT1` from another,
a combination the silicon cannot produce.

```yaml
peripherals:
  UHSIF:
    signal_pins:
      PORT0: [{ pin: PC1 }, { pin: PF12 }, { pin: PE8 }]   # index 0/1/2 = RM 00/01/1x
      PORT1: [{ pin: PC2 }, { pin: PF13 }, { pin: PE9 }]   # same order, same meaning
      # ...PORT2-PORT7, same shape...
      CLK: [{ pin: PC0 }, { pin: PF14 }, { pin: PD9 }, { pin: PF11 }]   # independent, untouched
      PORT8: [{ pin: PE13 }]                                            # fixed, untouched
      # ...
    signal_groups:
      - signals: [PORT0, PORT1, PORT2, PORT3, PORT4, PORT5, PORT6, PORT7]
```

**The pins still live in `signal_pins:`, once, exactly as they would without a group** —
`signal_groups:` says only WHICH signals move together, not what their candidates are.
This means **every signal named in a group must offer the SAME NUMBER of options, in the
SAME order** — index 0 is every member's own pin under choice 0, index 1 under choice 1,
and so on, the identical "index is the register value" rule `remaps:` already states one
level up. `validate_mcu.py` should check the counts agree; a group whose members disagree
on how many options they have is a data defect, not something the engine guesses past.

**What changes for a grouped signal, and what does not:**

- Picking a pin for ONE member moves every other member to the matching index, in the
  same call (`setSignalPin()`) — never as two separate user actions, and never leaving
  the group on a mismatched combination even for one intermediate render.
- An unchosen grouped signal defaults to **its own index 0**, not "first bonded on this
  package" — every member defaults to index 0 together, so the group starts on a real
  combination rather than each signal picking whatever fits it alone.
- `previewAssign` — normally "no sibling to drag along" for an `af`-muxed signal — checks
  every OTHER member of the group at the same target index too, because a pin that looks
  free for the clicked signal alone can still collide through a sibling the move drags
  with it.
- A signal outside every group (`CLK`, `PORT8`-`PORT47` above) is completely unaffected:
  it keeps picking its own pin exactly as an ordinary `signal_pins:` signal always has.

**`remap_by_package:`** — the same key and shape a whole-peripheral `remaps:` already has
(above), now on one `signal_groups:` entry instead of the peripheral: a package -> index
override for the group's default, read only when a member has no stored explicit choice
yet, so it can never override a choice the user already made.

```yaml
    signal_groups:
      - signals: [PORT0, PORT1, PORT2, PORT3, PORT4, PORT5, PORT6, PORT7]
        remap_by_package: { QFN68: 1, QFN88: 2 }
```

CH32H417 UHSIF is why this exists: `PORT0`-`PORT7` default to index 0 on every package,
but index 0's pins (`PF12`/`PF13`/`PE7`/...) are not bonded on QFN68 at all — the group
was correctly SHOWN as unbonded there (not silently mixed the way independent per-signal
defaults used to) but not USABLE. The RM states a per-package recommendation outright
(`CH32H417RM.md:11839-11845`: "The chip packaged with 56/68 pins is recommended to use
the mapping configuration of 01b; It is recommended to use 1xb mapping configuration for
chips packaged as 88 pins."), so `remap_by_package` names index 1 for QFN68 and index 2
for QFN88 rather than leaving the picker to default both to a combination this part's own
manual says not to use. `validate_mcu.py` checks the package exists and the index is in
range, the same way it does for a peripheral-level `remap_by_package`.

## `exti`

```yaml
exti:
  register: { name: AFIO_EXTICR, address: 0x40010008, bits_per_line: 2 }
  lines:
    EXTI3: { "00": PA3, "01": PB3, "10": PC3, "11": PD3 }
    EXTI7: { "00": PA7,            "10": PC7, "11": PD7 }   # no PB7 on this family
  internal:
    EXTI8: { event: PVD — supply crossed the voltage-monitoring threshold }
```

Not a peripheral, because a `remaps:` entry switches every signal of a peripheral at once
and EXTI has one independent selector per line. The key is the register field value. Line
*x* can only ever reach pin number *x*; the validator checks that. Omit a value that
selects a port pin the part does not have.

## `dma`

```yaml
dma:
  controller: DMA1
  channels: 7
  init_struct: DMA_InitTypeDef
  requests:
    1: [ADC1, TIM2_CH3, TIM3_CH3]
  register:
    name: DMA_CFGRx
    address: 0x40020008        # channel 1
    stride: 20                 # bytes to the next channel's register
    fields: { DIR: { lsb: 4, bits: 1 }, CIRC: { lsb: 5, bits: 1 } }
  channel_params:              # same schema as `params:` - see below
    - key: dir
      name: Direction
      type: enum
      field: DIR               # which register field it writes
      sdk_field: DMA_DIR       # which DMA_InitTypeDef member it is
      default: Peripheral to memory
      options:
        - { name: Peripheral to memory, value: 0, sdk: DMA_DIR_PeripheralSRC }
        - { name: Memory to peripheral, value: 1, sdk: DMA_DIR_PeripheralDST }
  request_defaults:            # what a request starts as when the user adds it
    ADC1: { dir: Peripheral to memory, psize: Half Word, msize: Half Word, mode: Circular }
  request_notes:
    ADC1: why those values, in prose
```

No pins are involved, so this never affects the pinout. Two enabled peripherals on one
channel is a conflict.

**`channel_params` is deliberately the same schema as a peripheral's `params:`** — same
`key` / `name` / `type` / `default` / `options` with `{ name, value }`. The DMA Settings
tab therefore renders with the Parameter Settings editors instead of growing its own, and
one set of rules covers both.

**`request_defaults` is hardware, not taste.** A USART data register is eight bits wide,
so a half-word transfer to it is a bug; `ADC_RDATAR` is twelve bits inside a sixteen-bit
field, so a byte transfer truncates every sample. Where the data genuinely cannot decide —
`TIMx_CHy` serves PWM output *and* input capture, which run in opposite directions — pick
the common case and say so in `request_notes`. Do not leave it blank: the user gets a row
of generic defaults to fix by hand, and `validate_mcu.py` warns about it.

What is **not** here: the buffer address and the transfer count. `DMA_PeripheralBaseAddr`,
`DMA_MemoryBaseAddr` and `DMA_BufferSize` are the application's, not a configuration
choice, and CubeMX does not ask for them either. The generator emits them as named TODOs.

## `nvic`

```yaml
nvic:
  controller: PFIC
  scheme:
    register: { name: PFIC_IPRIORx, address: 0xE000E400, bits_per_vector: 8 }
    priority_bits: 2               # how many of those bits the silicon implements
    priority_lsb: 6
    max_nesting: 2
    groups:
      - name: 2 levels of nesting (1 preemption bit, 1 sub-priority bit)
        default: true
        preempt: { bits: 1, lsb: 7, min: 0, max: 1 }
        sub:     { bits: 1, lsb: 6, min: 0, max: 1 }
  vectors:
    - { name: USART1, vector: 32, irqn: USART1_IRQn, handler: USART1_IRQHandler,
        peripheral: USART1, description: USART1 global interrupt }
    - { name: ADC, vector: 29, irqn: ADC_IRQn, handler: ADC1_IRQHandler,
        peripheral: ADC1, description: ADC global interrupt }
    - { name: DMA1_CH1, vector: 22, irqn: DMA1_Channel1_IRQn, handler: DMA1_Channel1_IRQHandler,
        peripheral: DMA1, channel: 1, description: DMA1 channel 1 global interrupt }
```

**A vector has TWO names and they are not interchangeable.** `irqn` is the `IRQn_Type`
member — what `NVIC_InitStructure.NVIC_IRQChannel` takes. `handler` is the symbol in the
startup vector table — what the user's ISR must be called to be linked in; it is declared
`.weak` and defaults to an endless loop, so a misspelled handler silently never runs.

The vendor is not consistent between them, so neither may this file be: on CH32V006
vector 29 is `ADC_IRQn` in the enum but `ADC1_IRQHandler` in the startup table, and
vector 2 is `NonMaskableInt_IRQn` but `NMI_Handler`. Take each from its own source rather
than deriving one from the other, and let `tools/verify_sdk_names.py` check both — it
found `ADC1_IRQn` in this repo, a name that exists in neither place and would not have
compiled.

`peripheral:` groups the vector under that peripheral's NVIC Settings tab. `system: true`
puts it under the NVIC entry in System Core instead — SysTick, the software interrupt, NMI
and HardFault belong to no peripheral. `fixed: true` marks a vector whose priority cannot
be set at all. `channel:` ties a DMA vector to its channel, so enabling a DMA request can
offer the matching interrupt.

**Read `priority_bits` off the manual; do not assume the Cortex-M answer.** The PFIC in
CH32V00X gives each vector a byte in `PFIC_IPRIORx` but implements only bits [7:6] —
[5:0] are "reserved, fixed to 0, write invalid" (RM 6.5.2.21). Two bits is the whole
range, and with nesting on it splits one and one. A tab offering priorities 0–15 would be
offering settings the silicon throws away. `validate_mcu.py` checks that each group's
`max` fits in its `bits` and that the halves add up to `priority_bits`.

### Grouped vectors (`lines:`)

One vector may serve a whole range of EXTI lines. CH32X035 has three that cover
twenty-six between them, so a `lines: [first, last]` range — inclusive — says which:

```yaml
- { name: EXTI7_0,   vector: 20, irqn: EXTI7_0_IRQn,   handler: EXTI7_0_IRQHandler,
    lines: [0, 7],   peripheral: EXTI }
- { name: EXTI15_8,  vector: 40, irqn: EXTI15_8_IRQn,  handler: EXTI15_8_IRQHandler,
    lines: [8, 15],  peripheral: EXTI }
- { name: EXTI25_16, vector: 41, irqn: EXTI25_16_IRQn, handler: EXTI25_16_IRQHandler,
    lines: [16, 25], peripheral: EXTI }
```

**The NVIC tab lists three rows, not twenty-six**, and the EXTI tab answers "which vector
does line 11 raise" by finding the range that contains it. CH32V006's single `EXTI7_0`
carries `lines: [0, 7]` too, so there is one code path rather than two.

Do not assume the grouped vectors cover every line the part has. CH32X035 defines **thirty**
EXTI lines: 26–29 are internal events — PVD, auto-wake-up, USBFS wake-up, USBPD wake-up —
each with its own vector, outside the grouped three.

### A peripheral this part does not interrupt on

CH32V006 has `RCC_IRQn = 19`. **CH32X035 has no RCC vector at all** — number 19 is a gap in
the enum and a `.word 0` in the startup table. "Every family has an RCC interrupt" is the
kind of assumption a second family exists to break. A vector that is absent is absent; do
not add one for symmetry.

## `clock`

```yaml
clock:
  sources:
    HSI: { mhz: 24, fixed: true }
    HSE: { mhz: 24, min_mhz: 3, max_mhz: 32 }
  pll:
    inputs: [{ name: HSI, source: HSI, div: 1 }]
    multipliers: [2]
  sysclk: { sources: [HSI, HSE, PLLCLK], max_mhz: 48 }
  hse_peripheral: RCC                     # see "Selecting HSE" below
  hse_setting: High Speed Clock (HSE)
  hse_signals: [XI, XO]
  prescalers:
    HB:  { options: [1, 2, 4], max_mhz: 48, label: HB prescaler (HPRE) → HCLK }
    ADC: { options: [1, 2, 4], source: HB, min_mhz: 16, max_mhz: 48 }
  derived:
    - { name: Core SysTick, source: HB, div: 8 }
  buses:
    HB: [TIM1, USART1, ADC1]
```

A prescaler with no `source` hangs off SYSCLK. Otherwise `source` names another
prescaler, an oscillator, `SYSCLK`, `PLLCLK` or a `plls:` output. `min_mhz` / `max_mhz`
drive the red out-of-spec warnings.

### `plls:` — more than one PLL, and a per-peripheral source mux

`pll:` above is **one** PLL feeding SYSCLK, which is every part except CH32H417. That part
has five (RM 3.3.4: SYS, USBHS 480 MHz, ETH 500 MHz, USBSS 125 MHz, SerDes) and eight
peripheral clocks with their own source select (RM 3.4.13, `RCC_CFGR2`). `pll:` is
**unchanged and still the alias for the SYS PLL** — the five single-PLL parts do not move.

```yaml
clock:
  plls:
    USBHS_PLL:
      label: USB HS PLL            # optional; the tab falls back to the id
      output: USBHS_PLL_CLK        # REQUIRED. the name other nodes cite
      output_mhz: 480              # a FIXED output the silicon does not let you change
      inputs:
        - { name: HSE, source: HSE, div: 1 }
        - { name: "SYS PLL /N", source: PLLCLK, div: 4 }
    SERDES_PLL:
      output: SERDES_PLL_CLK
      multipliers: [25, 28, 30]    # ...or a multiplier list. EXACTLY ONE of the two.
      inputs: [{ name: HSE, source: HSE, div: 1 }]
  prescalers:
    USBFS:
      label: USBFS 48 MHz
      source: [USBHS_PLL_CLK, PLLCLK]   # a LIST is a mux: the tab draws a <select>
      options: [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
      default: 10                       # must be one of its own `options:`
      default_source: USBHS_PLL_CLK     # must be one of its own `source:` entries
      target_mhz: 48
```

| Key | Means |
|---|---|
| `plls.<ID>.output` | **required** — the node name other taps, `sysclk.sources` and other PLLs cite. It may not collide with an oscillator, another PLL's output, or a reserved name |
| `output_mhz` / `multipliers` | **exactly one.** `output_mhz` is a PLL whose output the silicon fixes; `multipliers` is one the user picks. Both, or neither, is an error |
| `inputs[].source` | an oscillator, `PLLCLK` (the SYS PLL), or another PLL's `output`. A cycle is an error |
| `source:` as a **list** | a mux. `clockCalc()` computes from the chosen entry, the `.wchproj` round-trips it, undo/redo covers it |
| `default:` / `default_source:` | the value and the mux entry the tab opens on. Each must be in its own list — **the engine falls back to the first entry silently**, so a typo would ship a tab that looks deliberate and is not, which is why the validator refuses it |

`sysclk.sources` may name a PLL `output`, not just `PLLCLK`.

**Reserved names.** A prescaler, a derived tap or a PLL `output` may not be called
`sources`, `pll`, `plls`, `feeding`, `over`, `under`, `selectable`, `sysclk` or `hclk` —
the clock tab uses those for structure rather than for a node.

**A fixed `output_mhz:` is a claim about the silicon, not a convenience.** Where the part
makes that output conditional — CH32H417's USBHS_PLL is 480 MHz *only* when
`USBHSPLL_REFSEL[1:0]` matches the actual input frequency (RM `:4266-4274`) — the
condition belongs in the file too, or the tab computes a number the hardware will not
produce. A computed number that is wrong is worse than a missing one.

**All of this is checked**, and every check has been seen to fail:
`python tools/validate_clock_selftest.py` plants eleven breaks one at a time — plus the
positive half, a correct block that must validate **clean**, because a check that refuses
everything passes a planted-break sweep exactly as well as one that works.

### A part with no HSE at all

Round 2's P0 was *"HSE must ALWAYS be selectable"*. That was right about CH32V006 and is
wrong as a general rule: **CH32X035 has no HSE** — `grep -c HSE ch32x035_rcc.h` returns 0.
One internal 48 MHz RC, and SYSCLK is that divided to 48/24/16/12/8 MHz.

So on that part `clock:` has **one source, no `pll:`, no `hse_peripheral`, no
`hse_setting`, no `hse_signals`, and no crystal pins**, and the clock tab must show an
HSI-only tree: no HSE box, no HSE row in RCC, **and no greyed placeholder**. Round 2's rule
is that a control is justified by the MCU data or it does not exist; greying is for an
option the part has and cannot use right now.

The absence reaches further than the tab. `RCC_CFGR0` on that part has **no `SW` field** —
there is nothing to switch between — so `codegen.rcc` has no `sw:` key and the generator
correctly writes nothing for the source mux. And its MCO offers two sources rather than
four, for the same reason.

### Selecting HSE (`hse_peripheral` / `hse_setting` / `hse_signals`)

A crystal is two facts at once: a frequency in the clock tree, and two pins claimed on the
chip. The clock tab owns the first, the peripheral table owns the second, and these three
keys are the only thing joining them.

| Key | What it names |
|---|---|
| `hse_peripheral` | the peripheral holding the crystal setting, e.g. `RCC` |
| `hse_setting` | that peripheral's `settings[]` entry, matched by `name` |
| `hse_signals` | the signals the crystal choice claims, e.g. `[XI, XO]` |

The rule the app implements, from CubeMX: **picking HSE anywhere in the clock tree — as
SYSCLK's source or as the PLL's — switches that setting on** (to the first choice claiming
every signal in `hse_signals`, i.e. the crystal rather than the bypass), and the pins go
through the ordinary conflict engine. Selecting *away* from HSE does **not** switch it back
off: the user wired a crystal to the board, and only the user un-wires it.

Do not hardcode `XI`/`XO` anywhere. The synthetic fixture
(`tests/fixtures/mcus/WCH-DUMMY32-C8.yaml`) deliberately calls the same two pins
`OSC_IN`/`OSC_OUT`, so an engine that assumed the CH32V006 spelling passes on the real part
and silently fails on the fixture. `validate_mcu.py` checks that all three keys still
resolve and that some choice of that setting really claims those signals.

`sources.HSE.min_mhz` / `max_mhz` bound the editable crystal frequency. For CH32V006 that
is 3 to 32 MHz — DS Tables 3-9 and 3-10, min/typ/max 3 / 24 / 32, for the external-clock
and crystal cases respectively. (It read 25 until round 2; 25 MHz appears in the datasheet
only in a footnote about crystal ESR, not as a limit.)

---

## `gpio`

What the GPIO block on **this part** offers. It exists so the UI can stop offering a
hardware choice the silicon does not have — round 3's rule, and the reason the CH32V006
GPIO table used to show a Low/Medium/High speed selector for a port with one speed.

```yaml
gpio:
  speeds:
    - { name: "30 MHz", macro: GPIO_Speed_30MHz }
```

| Key | What it is |
|---|---|
| `speeds` | ordered list of the output speeds the part has. `name` is what the GPIO table shows and what a `.wchproj` stores; `macro` is the SPL enum member, and it must exist in that part's headers. |
| `modes` | the GPIO-table modes and their `GPIOMode_TypeDef` macros; each may carry `class:` (see below) |
| `input_modes` | mode `Input` has no single macro — the SPL folds the **pull** setting into it, so these are keyed by the pull name |

**The set of modes is per part, not per project.** CH32X035's `GPIOMode_TypeDef` has
**six** members and CH32V006's has eight: **there is no open-drain at all on CH32X035** —
no `GPIO_Mode_Out_OD`, no `GPIO_Mode_AF_OD`. Its `modes` list therefore has three entries
where CH32V006's has five, and the GPIO table must render what the part offers rather than
a fixed five. Copying CH32V006's list across is how this was nearly shipped; the gate
caught it.

### `class:` — which part of the chip drives the pin

A `modes` entry may carry `class:`, one of **`out`, `af`, `analog`, `in`**:

| class | meaning | example |
|---|---|---|
| `out` | the **GPIO output register** drives the pin | `GPIO_Mode_Out_PP` |
| `af` | a **peripheral** drives the pin | `GPIO_Mode_AF_PP` |
| `analog` | the pin is an analog input, no digital drive | `GPIO_Mode_AIN` |
| `in` | input; `Input` is the implicit fourth mode and is always this class, with `input_modes` as the pull list underneath it | — |

`class:` exists so a constraint can say *"not an output function"* once instead of
listing mode names that go stale the day a mode is added. **`out` and `af` are separate
because a datasheet's word for one is not its word for the other.** CH32X035 DS Notes 4–7
prohibit a shorted pin from being configured as an "output function" — the GPIO output
register — and the same note says PC10/PC11 must be floating inputs "in USB applications",
while `USBFS`'s own remap puts its data lines on PC16/PC17 of that very pair. A rule that
covered `af` would refuse the peripheral the note is about: measured, that made USBFS fail
`--strict` on five of seven packages. The EVT's own USB examples configure no GPIO at all
on those pins, which is the third sign that `af` is not what the note means.

`class:` is optional, but a file that writes a `classes:` constraint must give **every**
`modes` entry a `class:` — `validate_mcu.py` fails otherwise. A class-based constraint
that could silently fail to match a new mode is exactly the defect the mechanism exists to
prevent.

**A restriction is not written here as prose.** `pins_note:` records a human note about a
mode; a *rule* the app must enforce goes in `constraints:` below. CH32X035's
`GPIO_Mode_IPD` was annotated *"Only PA0--PA15 and PC16--PC17 support input pull-down"* in
`pins_note` for two rounds because nothing could express it; it is now constraint
`pull-down-only-on-pa0-pa15-pc16-pc17`.

Between them, `modes` and `input_modes` must account for every member of
`GPIOMode_TypeDef`: a mode the silicon has but the table cannot ask for is a mode the user
cannot reach, and `verify_sdk_names.py` warns about the ones left over. They exist so the
generator carries no macro table of its own — the same reasoning as `speeds`, and the same
defect class, since `GPIOMode_TypeDef` is per family too.

**A one-entry `speeds` list means the control is NOT SHOWN.** The value is rendered as
fixed text. It does *not* mean "shown disabled" — greying is for an option that exists on
the part and is unavailable right now, never for an option the part does not have.
Two or more entries means a real selector with those entries and no others.

A part with no `gpio:` block at all makes no claim, and the engine falls back to whatever
`codegen.speeds` says. Prefer stating it: silence is how the wrong thing got offered.

`gpio.speeds[].macro` is checked against the part's SDK headers by
`tools/verify_sdk_names.py`, so a spelling from another family fails the gate instead of
reaching a compiler.

---

## `constraints`

**A choice the app must not offer — on some pins, on some packages, or while some other
peripheral is on.** This is round 5's mechanism, and its rule is one sentence: *a wrong
choice the app offers is worse than a missing feature*, because an offered-but-impossible
choice produces a configuration that compiles, exports, looks correct and does not work on
the board.

Nothing in this block names a part, and nothing in `app/` knows any part exists. A part
with **no** `constraints:` block behaves exactly as it did before the block existed, which
is what keeps a part that has no instances byte-identical.

```yaml
constraints:
  - id: pull-down-only-on-pa0-pa15-pc16-pc17
    option: gpio.pull
    choices: [Pull-down]
    only_on: [PA0, PA1, ... PA15, PC16, PC17]
    reason: "Pull-down is available on PA0-PA15 and PC16-PC17 only; ..."
    source: "ch32x035_gpio.h:33"

  - id: shorted-pc10-pc11-pc16-pc17-not-output
    option: gpio.mode
    classes: [out]
    not_on: [PC10, PC11, PC16, PC17]
    packages: [LQFP64M, LQFP48, QFN28, QSOP28, TSSOP20]
    reason: "..."
    source: "CH32X035DS0.md Note 4 (p.19)"

  - id: usb-pc10-pc11-not-driven
    option: gpio.mode
    classes: [out, analog]
    not_on: [PC10, PC11]
    when: { peripheral: USBFS, enabled: true }
    reason: "..."
    source: "CH32X035DS0.md Note 4 (p.19)"
```

| Key | Required | What it is |
|---|---|---|
| `id` | yes | unique slug. A conflict message and a test name the constraint by it, so it must read as the rule, not as the part. |
| `option` | yes | which control the choice comes from, dotted: `gpio.mode`, `gpio.pull`, `gpio.speed`. |
| `choices` | one of | the restricted choice names, **verbatim as the GPIO table spells them** |
| `classes` | one of | every choice of these classes, read off `gpio.modes[].class` — how "an output function" is said without listing modes. `out` is the GPIO output register, `af` a peripheral drive: see `class:` above for why the two are not one |
| `only_on` | one of | the pin **allow**-list: the choice is legal on these pins and refused everywhere else |
| `not_on` | one of | the pin **deny**-list: the choice is refused on exactly these pins |
| `packages` | no | scope the entry to these packages. Omitted = every package. |
| `when` | no | `{ peripheral: <name>, enabled: true\|false }` — the refusal only applies while that peripheral is (or is not) enabled |
| `reason` | yes | one sentence, shown to the user: the GPIO table's tooltip and the conflict engine's text both use it verbatim |
| `source` | yes | `file:line` or a DS/RM table or note number. A family is not a source. |

### Rules the validator enforces

- `choices` and `classes` are mutually exclusive, and exactly one must be present.
- `only_on` and `not_on` are mutually exclusive, and exactly one must be present.
- Every name in `choices` must exist in that part's list for `option` — `gpio.modes` for
  `gpio.mode`, `gpio.input_modes` for `gpio.pull`. A constraint naming a choice the part
  does not offer is silently dead, which reads exactly like a constraint that works.
- A `classes:` entry requires every `gpio.modes` entry to declare a `class:`.
- Every pin named in `only_on`/`not_on` must exist in that part's `pins:`. If `packages:`
  is given, it must exist in **each** named package as well.
- Every name in `packages:` must be a package of the part.
- `when.peripheral` must be a peripheral of the part; `when.enabled` must be a boolean.
- `id` must be unique within the file.

### How the app reads it — the three consumers, and why they must agree

1. **The GPIO table.** For each row the control's option list is reduced: a choice a
   constraint refuses on that pin is **not offered**, not offered-and-greyed. Greying is
   for something the part has and cannot use *right now*; a constraint that depends on a
   peripheral states its `when` in the tooltip.
2. **The conflict engine.** A configured choice that a constraint refuses is an issue,
   and the issue **names the constraint's `reason`** — the user has to be told which rule
   they hit, or the table looks broken.
3. **Codegen.** It never emits a combination the data forbids: it declines, names the
   constraint, and emits the `TODO` the strict gate looks for. Declining is the
   documented behaviour — the generator must never emit plausible-looking wrong code.

**Semantics are prohibition only**, deliberately. "PC10 and PC11 must be a floating input
while USBFS is on" is written as two prohibitions — no output or analog mode, no pull —
which leaves exactly `Input` + `No pull`. A positive `require:` form would be a second
mechanism for a case the first one already covers, and two mechanisms that can disagree is
how the GPIO speed defect shipped twice.

**A pin that is not bonded on the current package cannot be configured at all**, so an
entry naming it is inert there rather than an error. `packages:` exists for the case where
the pin *does* exist and the rule still does not apply — CH32X035's Note 4 excludes the
QFN20 and QFN12 packages by name while both bond PC16 and PC17.

---

## `codegen`

Everything the C generator cannot work out from the model: which register field a remap
index is written to, which signals are analog, and how the clock choices encode. The
generator never guesses a bit position — without this block it emits a `TODO` naming
exactly what is missing, so a part with no `codegen:` still generates a useful file.

```yaml
codegen:
  header: ch32v00X.h          # the part's OWN main header — see the warning below
  gpio_clock: { fn: RCC_PB2PeriphClockCmd, port: RCC_PB2Periph_GPIO$PORT, afio: RCC_PB2Periph_AFIO }
  speeds:                     # stored GPIO-table speed name -> SPL macro
    "30 MHz": GPIO_Speed_30MHz
    Low:      GPIO_Speed_30MHz    # alias, so a .wchproj saved earlier still compiles
  remap:
    register: "AFIO->PCFR1"
    fields:
      SPI1: [{ lsb: 0, bits: 3 }]
      TIM2: [{ lsb: 14, bits: 2 }, { lsb: 16, bits: 1, from: 2 }]   # split field
  analog_signals:             # signals whose FUNCTION is analog: GPIO_Mode_AIN, never an AF
    ADC1: [IN0, IN1]
`analog_signals` is the authoritative list, per peripheral, of the signals whose pad is an
analog one: an ADC or HSADC channel, a DAC output, an OPA or comparator **input**. Two
things read it, and they must agree:

* `analogClaim()` (`app/engine/constraints.js`) uses it to pick `GPIO_Mode_AIN` over the
  alternate-function branch. Without an entry it falls back to "an `Analog`-category
  peripheral on a pin flagged `analog:`", and says in the generated code that it inferred
  it — a part that declares neither (CH32H417 until 2026-09-12) gets the fallback's
  `false` and emits `GPIO_Mode_AF_PP` for an analog pad. Wrong, and it compiles.
* `validate_mcu.py` uses it to stay quiet about `af:`. An analog pad has no AF code and
  never will, so "codegen will not guess an AF code and emits a TODO instead" is advice
  nobody can follow; the same exemption `codegen.skip_signals` already had.

List only the analog members. A comparator's inputs are analog and its **output** is a
digital alternate function on the same peripheral (CH32H417's `CMP`: `P0/P1/N0/N1` are
listed, `OUT` is not, and `OUT` carries seven real AF codes) — which is precisely the
distinction the category fallback cannot make.

  rcc:
    register: "RCC->CFGR0"
    sw:     { lsb: 0,  bits: 2, values: { HSI: 0, HSE: 1, PLLCLK: 2 } }
    pllsrc: { lsb: 16, bits: 1, values: { HSI: 0, HSE: 1 } }
    mco:
      peripheral: RCC                       # whose choice names the `values` keys are
      setting: Master Clock Output (MCO)
      lsb: 24
      bits: 3
      values: { Disable: 0, SYSCLK: 4, HSI: 5, HSE: 6, PLLCLK: 7 }
    prescalers:
      HB: { lsb: 4, bits: 4, values: { 1: 0, 2: 1 } }
  ctlr:
    register: "RCC->CTLR"
    fields: { HSEON: { lsb: 16, bits: 1 }, HSEBYP: { lsb: 18, bits: 1 } }
    hse_choices:                            # keys = choices of clock.hse_setting
      Disable:                     { HSEON: 0, HSEBYP: 0 }
      Crystal / ceramic resonator: { HSEON: 1, HSEBYP: 0 }
```

**`header:` is the part's own main SPL header, spelled exactly as the file is spelled.**
This is not cosmetic and it has already shipped wrong once. The SDK carries a series
`ch32v00Xx` (header `ch32v00X.h`, CH32V005/CH32V006) *and* a series `ch32v00x` (header
`ch32v00x.h`, CH32V003) — two different parts with different register maps. On NTFS the
wrong case resolves anyway, so the mistake is invisible on Windows, fails outright on
Linux, and on a machine with both include paths silently compiles the other part. The
series a part belongs to is not guessable from its part number; it is written down in
`data/sources/README.md` and checked by `tools/verify_sdk_names.py`.

**`sdk:` says which SDK this part's names are checked against**, because it is not
guessable from the part number and getting it wrong is how round 2 shipped a defect:

```yaml
codegen:
  sdk:
    evt: V006          # data/sources/<evt>/Evt   - the EVT package covering this part
    series: ch32v00Xx  # framework-wch-noneos-sdk/Peripheral/<series>/inc
```

`tools/verify_sdk_names.py` reads it, prefers the EVT drop, falls back to the PlatformIO
package, and **reports "NOT CHECKED" with a reason rather than passing silently** when
neither is present. A part that is not real silicon says so instead:

```yaml
codegen:
  sdk: { synthetic: true }     # the layout fixture: not a chip
```

That is how a synthetic part is skipped — by its own declaration, not by a name
hardcoded in the tool, so adding a second fixture part needs no change to the checker.

**`init_structs` says what applies each struct, and `periph_handle` says to what.**

```yaml
codegen:
  init_structs:
    USART_InitTypeDef: { fn: USART_Init }
    TIM_BDTRInitTypeDef: { fn: TIM_BDTRConfig }        # NOT TIM_TimeBaseInit
    OPA_InitTypeDef: { fn: OPA_Init, no_handle: true } # single instance, takes no handle
  periph_handle:
    USART1: USART1
    OPA1: OPA                                          # tree id and SDK name differ
  channel_macros:
    ADC1: { IN0: ADC_Channel_0 }
```

The generator deliberately **does not derive a function name from a struct name**, because
the pairing is not mechanical: `TIM_TimeBaseInitTypeDef` goes to `TIM_TimeBaseInit` but
`TIM_BDTRInitTypeDef` goes to `TIM_BDTRConfig`, and `OPA_Init` takes no handle at all while
every other init function takes one. `no_handle: true` says so rather than letting the
generator emit `OPA_Init(OPA, &s)`, which would not compile. Note also that a peripheral's
tree id and its SDK register-block name are not always equal — CH32V006's OPA block is
`OPA`, not `OPA1`.

**`speeds:` is a translation table, not an offer.** What the part offers is `gpio.speeds`.
Keys here are stored GPIO-table speed names — including names kept only so an older
`.wchproj` still generates code that compiles — and every value must be a macro that
exists in this part's headers.

Two registers are involved in a clock change, not one: `CFGR0` carries the muxes and
prescalers, `CTLR` the oscillator *enables*. Selecting HSE therefore needs `HSEON` in
`ctlr` as well as `sw`/`pllsrc` in `rcc`, which is why `ctlr` exists.

**`remap.fields` only lists peripherals whose `remaps:` index IS the register field
value.** A peripheral whose remap list means something else — `SYS`, whose remaps select
the package's reset pin — must be left out, or the generator writes a package index into
an AFIO field. A field must also be wide enough for its remap list; the validator checks
that arithmetic.

**Value maps keyed by a choice name** (`mco.values`, `ctlr.hse_choices`) say where their
keys come from, so renaming a choice in `peripherals:` is caught rather than quietly
turning into a reset value. `hse_choices` must cover *every* choice of the setting.

---

## The trap that has cost this repo the most time

**An unquoted comma inside `{ }` silently corrupts the file.** YAML flow mappings treat a
comma as a field separator:

```yaml
- { name: IN8 (Vrefint, internal) }      # name becomes "IN8 (Vrefint"
- { name: "IN8 (Vrefint, internal)" }    # correct
```

The file still parses and the app still loads. The damage shows up later: the app keys a
setting's state by choice name, so two choices whose names both truncate to the same
string collapse into one, and the user loses an option with no error anywhere. Four live
instances were found in this repo on 2026-09-11.

Quote any value containing a comma, a colon followed by a space, or a leading `[`, `{`,
`*`, `&`, `!`, `%`, `@`. The validator rejects unknown keys in `pins`, `settings` and
`choices` entries specifically to catch this, and rejects duplicate choice names as the
second line of defence.

## Adding a part

1. Put the datasheet and reference manual as markdown in `data/sources/`, and keep the
   original PDFs beside them: the **markdown is read first** and the PDF only as a last
   resort, when the conversion is missing, unreadable or demonstrably incomplete
   (`data/sources/README.md`, and `tools/source_docs.py` implements the order for the
   tools).
2. Write `data/mcus/<PART>.yaml` and `<PART>.notes.md`, citing a table for every block.
3. Add any missing package geometry to `data/packages/packages.yaml`, with pitch and body
   size from the datasheet's package chapter.
4. `python tools/validate_mcu.py` until clean.
5. Point `tools/extract_remaps.py` at the new sources and get the remap diff to zero. If
   the part's manual is laid out differently, extend the tool rather than eyeballing it —
   a hand-checked table is not evidence.
6. `python build.py`, then `node tests/run.js`.
