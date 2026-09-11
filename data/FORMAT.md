# MCU file format

One file per part under `data/mcus/<PART>.yaml`, plus `<PART>.notes.md` next to it saying
where every number came from. This document is the schema. `tools/validate_mcu.py`
enforces it; if the two ever disagree, the tool is right and this file needs updating.

```
python tools/validate_mcu.py          # 0 = clean, 1 = at least one ERROR
python tools/extract_remaps.py        # re-derives the remap tables from the RM and diffs
python build.py                       # inlines every data file into dist/index.html
```

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
| `dma` | no | DMA channel → peripheral requests |
| `clock` | no | the Clock Configuration tab |

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

A signal that two features share is modelled once. CH32V006 TIM2 routes `CH1_ETR` as a
single signal because channel 1 and the external trigger are the same pin, and it exposes
complementary outputs as a setting that claims the existing `CH3`/`CH4` signals, because
that is physically what the silicon does with those pins.

## Peripheral parameters (`params:`)

`settings:` answers "which pins does this peripheral take". `params:` answers "how is it
configured once it has them" — baud rate, prescaler, polarity. Parameters never claim a
pin and never cause a conflict, which is the whole reason they are a separate list.

```yaml
  USART1:
    category: Connectivity
    settings: [ ... ]
    remaps:  [ ... ]
    params:
      - { name: Baud Rate, type: int, default: 115200, min: 300, max: 3000000,
          unit: bps, group: Basic, register: "USART_BRR", notes: "HCLK/16 max" }
      - name: Parity
        type: enum
        default: None
        group: Basic
        register: "USART_CTLR1 PCE(10), PS(9)"
        options:
          - { name: None, value: 0 }
          - { name: Even, value: 1 }
          - { name: Odd,  value: 2 }
      - { name: Clock Phase, type: enum, default: 1 Edge, group: Basic,
          options: [1 Edge, 2 Edge],
          depends_on: { setting: Mode, not: Disable } }
```

### Fields

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | unique within the peripheral; the UI label and the key state is stored under |
| `type` | yes | `int`, `float`, `enum`, or `bool` |
| `default` | yes | the value a fresh project starts with; for `enum` it is an option **name** |
| `min` / `max` | int, float | inclusive bounds, rejected outside |
| `step` | int, float | UI increment; does not restrict the value |
| `options` | enum | either plain names (`[1 Edge, 2 Edge]`) or `{ name, value }` pairs when the register encoding matters |
| `unit` | no | shown after the field: `bps`, `Hz`, `MHz`, `ns` |
| `group` | no | `Basic` (default) or `Advanced`; the UI renders one table per group |
| `readonly` | no | `true` for a computed or fixed row — displayed, never edited |
| `depends_on` | no | when this parameter applies at all (below) |
| `register` | no | provenance, e.g. `"SPI_CTLR1 BR[5:3]"`. Not consumed by code; it is what makes the number checkable |
| `notes` | no | one line shown as help text |

### `depends_on`

A parameter that only applies in some configurations. Exactly one of `setting` or `param`
names what it looks at, and exactly one of `equals`, `in` or `not` says what it wants:

```yaml
depends_on: { setting: Hardware Flow Control, in: [CTS only, CTS/RTS] }
depends_on: { param: CRC Calculation, equals: true }
depends_on: { setting: Mode, not: Disable }
```

When the condition is false the parameter is hidden and keeps its value; it is not reset.

### Rules

- **A parameter never claims a pin.** Anything that changes which pin is used is a
  `setting` with `signals:`, not a parameter. Keeping that line sharp is what lets the
  conflict engine ignore `params:` entirely.
- **`default` must be valid against its own constraints** — inside `min`/`max`, or one of
  the `options` names. `validate_mcu.py` checks this.
- **An `enum` option's `value` is the raw register encoding** when one is given. Write the
  encoding the reference manual gives, not a sequential index, and cite it in `register`.
  A parameter with a stated encoding is checkable; one without is folklore.
- **Bounds are physical, not preferences.** `max: 3000000` on a baud rate is HCLK/16 at
  48 MHz, not a round number someone liked.
- **A fixed hardware fact is `readonly`, not a parameter with one option.** ADC resolution
  is a property of the silicon; it is shown so the user knows it, and cannot be changed.

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
  requests:
    1: [ADC1, TIM2_CH3, TIM3_CH3]
```

No pins are involved, so this never affects the pinout. Two enabled peripherals on one
channel is a conflict worth warning about.

## `clock`

```yaml
clock:
  sources:
    HSI: { mhz: 24, fixed: true }
    HSE: { mhz: 24, min_mhz: 3, max_mhz: 25 }
  pll:
    inputs: [{ name: HSI, source: HSI, div: 1 }]
    multipliers: [2]
  sysclk: { sources: [HSI, HSE, PLLCLK], max_mhz: 48 }
  prescalers:
    HB:  { options: [1, 2, 4], max_mhz: 48, label: HB prescaler (HPRE) → HCLK }
    ADC: { options: [1, 2, 4], source: HB, min_mhz: 16, max_mhz: 48 }
  derived:
    - { name: Core SysTick, source: HB, div: 8 }
  buses:
    HB: [TIM1, USART1, ADC1]
```

A prescaler with no `source` hangs off SYSCLK. Otherwise `source` names another
prescaler, an oscillator, `SYSCLK` or `PLLCLK`. `min_mhz` / `max_mhz` drive the red
out-of-spec warnings.

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

1. Put the datasheet and reference manual as markdown in `data/sources/`.
2. Write `data/mcus/<PART>.yaml` and `<PART>.notes.md`, citing a table for every block.
3. Add any missing package geometry to `data/packages/packages.yaml`, with pitch and body
   size from the datasheet's package chapter.
4. `python tools/validate_mcu.py` until clean.
5. Point `tools/extract_remaps.py` at the new sources and get the remap diff to zero. If
   the part's manual is laid out differently, extend the tool rather than eyeballing it —
   a hand-checked table is not evidence.
6. `python build.py`, then `node tests/run.js`.
