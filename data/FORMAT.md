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

`sdk_none` without an `sdk_note` is a warning: an unexplained gap reads as an oversight
rather than a finding. And note ADC `sample`: it is `sdk_call: ADC_RegularChannelConfig`
because sample time is an argument set **per channel**, not a property of the peripheral —
a mapping that is invisible from the display name and wrong if assumed.

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
prescaler, an oscillator, `SYSCLK` or `PLLCLK`. `min_mhz` / `max_mhz` drive the red
out-of-spec warnings.

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

Do not hardcode `XI`/`XO` anywhere. `WCH-DUMMY32-C8` deliberately calls the same two pins
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
| `modes` | the GPIO-table modes and their `GPIOMode_TypeDef` macros |
| `input_modes` | mode `Input` has no single macro — the SPL folds the **pull** setting into it, so these are keyed by the pull name |

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
  analog_signals:
    ADC1: [IN0, IN1]
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
  sdk: { synthetic: true }     # WCH-DUMMY32-C8: a layout fixture, not a chip
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

1. Put the datasheet and reference manual as markdown in `data/sources/`.
2. Write `data/mcus/<PART>.yaml` and `<PART>.notes.md`, citing a table for every block.
3. Add any missing package geometry to `data/packages/packages.yaml`, with pitch and body
   size from the datasheet's package chapter.
4. `python tools/validate_mcu.py` until clean.
5. Point `tools/extract_remaps.py` at the new sources and get the remap diff to zero. If
   the part's manual is laid out differently, extend the tool rather than eyeballing it —
   a hand-checked table is not evidence.
6. `python build.py`, then `node tests/run.js`.
