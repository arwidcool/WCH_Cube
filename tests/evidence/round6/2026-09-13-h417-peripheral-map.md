# CH32H417 — the peripheral mapping audit

**Measured 2026-09-13 by AGENT-1 on the working tree.** Every number below came out of a command
run for this document; nothing is carried over from a previous round's note. Where a number
differs from what a document said yesterday, the document is wrong and is corrected in the same
commit as this file.

**Nothing here has been flashed.** Every green is a compile, or a check against a document.

---

## The one-line verdict

78 peripherals audited on six axes plus two build-level ones. **Five cells closed** — two modelled
(I2S2 and I2S3 had no clock gate at all, and generated C that could not have run), three declared
absent with a `file:line` (DBGMCU, HSEM, IPC genuinely have no gate). **36 cells remain**: 35
`params` and one `clock`, each with an owner and a TASKS.md line. Ledger **0 open, `status:
complete`**, unchanged. Suite **ALL GREEN**.

## The two conventions, spelled out

These two sentences are both true of this part and mean opposite things, which is how four
documents drifted apart:

* **39 of 78 peripherals HAVE a `params:` block.**
* **39 of 78 peripherals DO NOT have a `params:` block.**

Of the 39 without, **4 are declared ABSENT** in `tests/completeness.test.js` (SYS, RCC, EXTI,
DMA1 — each configured by choices rather than numbers), so the number of `params` cells anyone
still owes is **35**, and **23 of those 35 route pins**: you can claim their pads and configure
nothing.

Likewise for clocks: **68 of 78 have a clock-enable bit**; 10 do not; **9 of those 10 are declared
ABSENT** and **1 is open** (RTC). And for vectors: **66 of 78 are named by an NVIC vector**; **all
12 that are not are declared ABSENT**, so zero `nvic` cells are owed.

## The six axes, and what each is read from

| Axis | The question | Read from |
|---|---|---|
| A. Pins | does it route a pad, and can a setting claim every signal it routes? | `peripherals.<P>.signal_pins` / `remaps` / `pins:`, checked by `validate_mcu.py` and ledger checks 1-2 |
| B. Settings | can a user switch it on and pick a mode? | `peripherals.<P>.settings`, counting rows with more than one choice |
| C. Params | does Parameter Settings have rows? | `peripherals.<P>.params` |
| D. Clock | can the generated C enable its clock? | `codegen.periph_clock.*.bits` |
| E. Interrupt | does a vector name it as `peripheral:`? | `nvic.vectors` |
| F. Codegen reach | does the generated C name one of its signals when it is switched on and holding a pad? | the engine, run for real: load, `setPackage`, `setSetting`, `compute()`, `cFiles()` |

Plus **fixture** (a `tests/fixtures/CH32H417_*.wchproj` switches it on) and **compiled** (that
fixture goes through `tests/codegen_compile.test.js` -> `pio run -e CH32H417QEU6` / `CH32H417WEU6`).

### How to read the cells

* **A pins** — `N routed` is the number of distinct signals with a pad; `` `none` (cited) `` is a
  `pins: { none: true, source: ... }` declaration the ledger checks against the datasheet.
  0 peripherals declare `pins: open`.
* **C / D / E** — a number or `yes` is modelled; `ABSENT` is declared with a citation in
  `tests/completeness.test.js`; `flagged` is a cell somebody still owes.
* **F codegen** — `yes` means a line of `wchcube_init.c` names one of its signals.
  `n/a` means the sweep could not switch it on this way: its first multi-choice setting claims
  no signal, which is right for the 20 peripherals that hold no pad or configure only registers.
  `n/a*` is USBHS alone — on every package its Device (HS) mode collides with SYS_SWIO on PB9
  (see the sweep below), so a one-peripheral-at-a-time sweep never reaches it. **0 peripherals
  reach no generated code while holding a pad**, which is the assertion
  `tests/completeness.test.js` makes and it is green.

---

## The table

| # | Peripheral | Cat | A pins | B settings | C params | D clock | E vector | F codegen | fixture | state |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `ADC1` | Analog | 16 routed | 2 | 10 | yes | 50 | n/a | - | MAPPED |
| 2 | `ADC2` | Analog | 16 routed | 2 | 10 | yes | ABSENT | n/a | - | MAPPED |
| 3 | `CAN1` | Connectivity | 2 routed | 1 | flagged | yes | 39,40,41,42 | yes | - | NO-PARAMS |
| 4 | `CAN2` | Connectivity | 2 routed | 1 | flagged | yes | 93,94,95,96 | yes | - | NO-PARAMS |
| 5 | `CAN3` | Connectivity | 2 routed | 1 | flagged | yes | 112,113,114,115 | yes | - | NO-PARAMS |
| 6 | `CMP` | Analog | 5 routed | 3 | flagged | yes | ABSENT | yes | - | NO-PARAMS |
| 7 | `CRC` | System Core | `none` (cited) | 1 | flagged | yes | ABSENT | n/a | - | NO-PARAMS |
| 8 | `DAC` | Analog | 2 routed | 2 | flagged | yes | ABSENT | yes | - | NO-PARAMS |
| 9 | `DBGMCU` | System Core | `none` (cited) | 1 | flagged | ABSENT | ABSENT | n/a | - | NO-PARAMS |
| 10 | `DFSDM` | Analog | 5 routed | 3 | flagged | yes | 107,108 | yes | - | NO-PARAMS |
| 11 | `DMA1` | System Core | `none` (cited) | 1 | ABSENT | yes | 19,20,21,22,23,24,25,38 | n/a | - | MAPPED |
| 12 | `DMA2` | System Core | `none` (cited) | 1 | flagged | yes | 83,84,85,86,87,88,89,90 | n/a | - | NO-PARAMS |
| 13 | `DVP` | Graphics | 15 routed | 1 | 16 | yes | 101 | yes | - | MAPPED |
| 14 | `ECDC` | System Core | `none` (cited) | 1 | flagged | yes | 102 | n/a | - | NO-PARAMS |
| 15 | `ETH` | Connectivity | 24 routed | 3 | flagged | yes | 91,92 | yes | - | NO-PARAMS |
| 16 | `EXTI` | System Core | `none` (cited) | 1 | ABSENT | ABSENT | 14,17 | n/a | - | MAPPED |
| 17 | `FLASH` | System Core | `none` (cited) | 3 | flagged | ABSENT | 15 | n/a | - | NO-PARAMS |
| 18 | `FMC` | Memory | 86 routed | 7 | flagged | yes | 75 | yes | - | NO-PARAMS + COLLISION (QFN68) |
| 19 | `GPHA` | Graphics | `none` (cited) | 1 | flagged | yes | 106 | n/a | - | NO-PARAMS |
| 20 | `HSADC` | Analog | 7 routed | 2 | 3 | yes | 120 | n/a | - | MAPPED |
| 21 | `HSEM` | System Core | `none` (cited) | 1 | flagged | ABSENT | 12 | n/a | - | NO-PARAMS |
| 22 | `I2C1` | Connectivity | 3 routed | 1 | 4 | yes | 27,28 | yes | compiled | MAPPED |
| 23 | `I2C2` | Connectivity | 3 routed | 1 | 4 | yes | 33,34 | yes | - | MAPPED |
| 24 | `I2C3` | Connectivity | 3 routed | 1 | 4 | yes | 59,60 | yes | - | MAPPED |
| 25 | `I2C4` | Connectivity | 3 routed | 1 | 4 | yes | 61,62 | yes | - | MAPPED |
| 26 | `I2S2` | Connectivity | 4 routed | 1 | 10 | yes | ABSENT | yes | - | MAPPED |
| 27 | `I2S3` | Connectivity | 4 routed | 1 | 10 | yes | ABSENT | yes | - | MAPPED |
| 28 | `I3C` | Connectivity | 2 routed | 1 | 2 | yes | 99,100,118 | yes | - | MAPPED |
| 29 | `IPC` | System Core | `none` (cited) | 1 | 6 | ABSENT | 8,9,10,11 | n/a | - | MAPPED |
| 30 | `IWDG` | System Core | `none` (cited) | 1 | flagged | ABSENT | ABSENT | n/a | - | NO-PARAMS |
| 31 | `LPTIM1` | Timers | 4 routed | 4 | flagged | yes | 77,117 | yes | - | NO-PARAMS |
| 32 | `LPTIM2` | Timers | 4 routed | 4 | flagged | yes | 78,116 | yes | - | NO-PARAMS |
| 33 | `LTDC` | Graphics | 28 routed | 4 | 15 | yes | 105 | yes | - | MAPPED |
| 34 | `OPA` | Analog | 18 routed | 9 | flagged | yes | ABSENT | yes | - | NO-PARAMS |
| 35 | `PIOC` | Connectivity | 2 routed | 1 | flagged | yes | 103 | yes | - | NO-PARAMS |
| 36 | `PWR` | System Core | `none` (cited) | 2 | flagged | yes | ABSENT | n/a | - | NO-PARAMS |
| 37 | `QSPI1` | Connectivity | 11 routed | 2 | flagged | yes | 63 | yes | - | NO-PARAMS |
| 38 | `QSPI2` | Connectivity | 11 routed | 2 | flagged | yes | 110 | yes | - | NO-PARAMS |
| 39 | `RCC` | System Core | 5 routed | 3 | ABSENT | ABSENT | 16 | yes | - | MAPPED |
| 40 | `RNG` | Security | `none` (cited) | 1 | flagged | yes | 122 | n/a | - | NO-PARAMS |
| 41 | `RTC` | Timers | 1 routed | 1 | flagged | flagged | 47,119 | yes | - | NO-PARAMS + OPEN |
| 42 | `SAI` | Audio | 8 routed | 2 | flagged | yes | 104 | yes | - | NO-PARAMS |
| 43 | `SDIO` | Connectivity | 10 routed | 1 | 8 | yes | 123 | yes | - | MAPPED |
| 44 | `SDMMC` | Connectivity | 13 routed | 2 | flagged | yes | 76 | yes | - | NO-PARAMS |
| 45 | `SERDES` | Connectivity | 4 routed | 1 | flagged | yes | 64 | yes | - | NO-PARAMS |
| 46 | `SPI1` | Connectivity | 4 routed | 2 | 5 | yes | 18 | yes | compiled | MAPPED |
| 47 | `SPI2` | Connectivity | 4 routed | 2 | 5 | yes | 30 | yes | - | MAPPED |
| 48 | `SPI3` | Connectivity | 4 routed | 2 | 5 | yes | 31 | yes | - | MAPPED |
| 49 | `SPI4` | Connectivity | 4 routed | 2 | 5 | yes | 32 | yes | - | MAPPED |
| 50 | `SWPMI` | Connectivity | 4 routed | 1 | 5 | yes | 109,111 | yes | - | MAPPED |
| 51 | `SYS` | System Core | 2 routed | 1 | ABSENT | ABSENT | ABSENT | yes | compiled | MAPPED |
| 52 | `TIM1` | Timers | 10 routed | 6 | 6 | yes | 51,52,53,54 | yes | compiled | MAPPED |
| 53 | `TIM10` | Timers | 5 routed | 5 | 5 | yes | 72 | yes | - | MAPPED |
| 54 | `TIM11` | Timers | 5 routed | 5 | 5 | yes | 73 | yes | - | MAPPED |
| 55 | `TIM12` | Timers | 5 routed | 5 | 5 | yes | 74 | yes | - | MAPPED |
| 56 | `TIM2` | Timers | 4 routed | 6 | 5 | yes | 55 | yes | - | MAPPED |
| 57 | `TIM3` | Timers | 5 routed | 6 | 5 | yes | 56 | yes | compiled | MAPPED |
| 58 | `TIM4` | Timers | 5 routed | 6 | 5 | yes | 57 | yes | - | MAPPED |
| 59 | `TIM5` | Timers | 5 routed | 5 | 5 | yes | 58 | yes | - | MAPPED |
| 60 | `TIM6` | Timers | `none` (cited) | 1 | 3 | yes | 81 | n/a | - | MAPPED |
| 61 | `TIM7` | Timers | `none` (cited) | 1 | 3 | yes | 82 | n/a | - | MAPPED |
| 62 | `TIM8` | Timers | 10 routed | 6 | 6 | yes | 67,68,69,70 | yes | - | MAPPED |
| 63 | `TIM9` | Timers | 5 routed | 5 | 5 | yes | 71 | yes | - | MAPPED |
| 64 | `TKEY` | Analog | `none` (cited) | 1 | flagged | ABSENT | ABSENT | n/a | - | NO-PARAMS |
| 65 | `UHSIF` | Connectivity | 49 routed | 1 | flagged | yes | 121 | yes | - | NO-PARAMS + COLLISION (QFN68) |
| 66 | `USART1` | Connectivity | 5 routed | 2 | 4 | yes | 29,124 | yes | compiled | MAPPED |
| 67 | `USART2` | Connectivity | 5 routed | 2 | 4 | yes | 26 | yes | compiled | MAPPED |
| 68 | `USART3` | Connectivity | 5 routed | 2 | 4 | yes | 65 | yes | - | MAPPED |
| 69 | `USART4` | Connectivity | 5 routed | 2 | 4 | yes | 66 | yes | - | MAPPED |
| 70 | `USART5` | Connectivity | 5 routed | 2 | 4 | yes | 79 | yes | - | MAPPED |
| 71 | `USART6` | Connectivity | 5 routed | 2 | 4 | yes | 80 | yes | - | MAPPED |
| 72 | `USART7` | Connectivity | 5 routed | 2 | 4 | yes | 97 | yes | - | MAPPED |
| 73 | `USART8` | Connectivity | 5 routed | 2 | 4 | yes | 98 | yes | - | MAPPED |
| 74 | `USBFS` | Connectivity | 4 routed | 2 | flagged | yes | 48,49 | yes | compiled | NO-PARAMS |
| 75 | `USBHS` | Connectivity | 2 routed | 1 | flagged | yes | 37,45 | n/a* | - | NO-PARAMS |
| 76 | `USBPD` | Connectivity | 2 routed | 1 | flagged | yes | 35,36 | yes | - | NO-PARAMS |
| 77 | `USBSS` | Connectivity | 4 routed | 1 | flagged | yes | 43,44,46 | yes | compiled | NO-PARAMS |
| 78 | `WWDG` | System Core | `none` (cited) | 1 | flagged | yes | 13 | n/a | - | NO-PARAMS |

**State totals (a peripheral may carry more than one):**

| State | Count |
|---|---|
| `MAPPED` | 43 |
| `NO-PARAMS` | 35 |
| `COLLISION (package)` | 2 (`FMC`, `UHSIF` — both also `NO-PARAMS`) |
| `OPEN` | 1 (`RTC`, the clock gate) |
| `NO-CLOCK` | 0 |
| `NO-VECTOR` | 0 |
| `ABSENT (cited)` | not a peripheral state but a per-cell one: 4 `params`, 9 `clock`, 12 `nvic` |

**35 of 78 peripherals carry at least one non-`MAPPED` state.** 43 are clear on all six axes.

---

## What this audit closed, and the evidence for each

### 1. I2S2 and I2S3 had no clock gate, and the generated C said so in a comment

**This is the finding.** Before this commit, switching I2S2 on produced:

```
    /* ---- I2S2 ------------------------------------------------------ */
    void WCHCube_I2S2_Init(void)
        /* I2S2 has no clock enable bit in codegen.periph_clock - none is written. */
        ...
        I2S_Init(SPI2, &I2S_InitStructure);
```

It compiled. On silicon it would have configured an I2S whose clock was never turned on. The EVT
does it one line above its own `I2S_Init`:

```
data/sources/H417/Evt/EXAM/DFSDM/DFSDM_I2S_Audio/Common/hardware.c
  103:    RCC_HB1PeriphClockCmd(RCC_HB1Periph_SPI2, ENABLE);
  111:    I2S_Init(SPI2, &I2S_InitStructure);
```

The I2S is a **mode of the SPI block**, not a unit beside it (RM ch.23 is "SPI/I2S"), so it shares
the SPI's gate the way `OPA` and `CMP` already share `RCC_HB2Periph_OPCM` on this part. Modelled as
`I2S2: 14` / `I2S3: 15` under `sdk: { I2S2: SPI2, I2S3: SPI3 }`. After:

```
  85:     RCC_HB1PeriphClockCmd(RCC_HB1Periph_SPI2, ENABLE);
```

`verify_sdk_names.py` checks the macro exists; `RCC_HB1Periph_SPI2` is at `ch32h417_rcc.h:291` and
`RCC_HB1Periph_SPI3` at `:292`.

### 2. Three clock gates that genuinely do not exist, declared

The complete `RCC_*Periph_*` block in
`data/sources/H417/Evt/EXAM/SRC/Peripheral/inc/ch32h417_rcc.h` is **lines 230-307** —
`/* HB_peripheral */` through `RCC_HB1Periph_SWPMI`, 73 macros. None of these three is in it, and
in each case the RM says why, by address:

| Peripheral | Why there is no gate | Citation |
|---|---|---|
| `DBGMCU` | it is a core **CSR**, not a bus peripheral: `R32_DBGMCU_CR` is at "Offset address: 0x7C0(CSR)" | RM 45.2.1, `CH32H417RM.md:66907` |
| `HSEM` | **core-private**: `R32_HSEM_RX0` at `0xE000C000` | RM 4.5, `CH32H417RM.md:6561`; register at `:6652` |
| `IPC` | **core-private**: `R32_IPC_CTLR` at `0xE000D000` | RM 4.4, `CH32H417RM.md:6287`; register at `:6332` |

And the RM says it in words at `CH32H417RM.md:4313`: *"Private peripherals include system timers,
inter-core communication, and hardware semaphore modules."* The RCC gates HB, HB1 and HB2; none of
these three sits on one. IPC's generated C correctly emits `IPC_Init()` with no clock line.

### 3. RTC's gate is two bits, and the schema holds one — left OPEN, not invented

The EVT enables both in one call:

```
data/sources/H417/Evt/EXAM/RTC/RTC_Calendar/Common/hardware.c
   94:    RCC_HB1PeriphClockCmd(RCC_HB1Periph_PWR | RCC_HB1Periph_BKP, ENABLE);
   95:    PWR_BackupAccessCmd(ENABLE);
```

repeated at `:205-206` and `:247-248`. BKPEN is bit 27 and PWREN bit 28 of `RCC_HB1PCENR`
(`CH32H417RM.md:3538` and `:3535`). There is no `RCC_*Periph_RTC` macro at all — the RTC appears in
`ch32h417_rcc.h` only as `RCC_RTCCLKSource_*` (`:226-228`) and `RCC_RTCCLKCmd` (`:646`), which
select and run the RTC clock rather than gate its bus interface.

`codegen.periph_clock.<bus>.bits` maps one peripheral to one bit and `clockBitOf()` returns one
macro. **Writing `BKP` alone would be a half-enable that reads exactly like a whole one**, so the
RTC deliberately carries no entry and the generated C prints "RTC has no clock enable bit in
codegen.periph_clock — none is written", which is true and visible. Owner AGENT-2 for the schema
half; TASKS.md carries it; the reasoning is in the RTC `notes:` in
`data/sources/H417/peripheral_extras.yaml`, where a regeneration reproduces it rather than losing
it once.

**A staging note, because that test file's own CH32L103 entries warn about exactly this:** the
`OPEN` entry `'CH32H417.RTC.clock'` is **not consulted today**. `clock` is a `SOFT_CELL` and
CH32H417 is in `IN_EXTRACTION`, so that branch is taken first and the cell still prints with
AGENT-1's `params:` line as its owner — which is the wrong owner, and is exactly why the entry was
written now. It becomes live the moment `IN_EXTRACTION` retires. Both facts are in the comment
beside it.

---

## What remains, by kind, with its owner

| Kind | Count | Owner | TASKS.md line |
|---|---|---|---|
| `params` cells | **35** (23 of them route pins) | AGENT-1 | "CH32H417: `params:` for the peripherals that have none" (`[~]`) |
| `clock` cell | **1** (RTC) | AGENT-2 schema, AGENT-1 data | "CH32H417 RTC: a clock gate that is two bits" (`[ ]`, new this commit) |
| avoidable default collisions | **4**, all QFN68 | AGENT-1 | "CH32H417: default pins collide" (`[~]`) |
| `nvic` cells | 0 | — | — |
| `settings` cells | 0 | — | — |
| ledger open rows | 0 | — | — |

The 35 `params` peripherals, measured:

`CAN1` `CAN2` `CAN3` `CMP` `CRC` `DAC` `DBGMCU` `DFSDM` `DMA2` `ECDC` `ETH` `FLASH` `FMC` `GPHA`
`HSEM` `IWDG` `LPTIM1` `LPTIM2` `OPA` `PIOC` `PWR` `QSPI1` `QSPI2` `RNG` `RTC` `SAI` `SDMMC`
`SERDES` `TKEY` `UHSIF` `USBFS` `USBHS` `USBPD` `USBSS` `WWDG`

`FMC`, `ETH` and `ECDC` (and FMC's NAND and SDRAM shapes) are blocked on the nested init-struct
schema — REQUEST to AGENT-2, board 2026-09-12T19:33Z — not on a shortage of facts.

---

## The collision sweep, measured per package

450 claiming choices swept on each of the three packages. `COLLISION_CEILING` in
`tests/h417_packages.test.js` records **QFN68 4 / QFN88 0 / QFN128 0**, and the sweep agrees:

```
### QFN68: 450 claiming choice(s) swept; avoidable 4, silicon-forced 7
  AVOIDABLE  FMC.Address lines = "A0-A15" puts FMC_A6 + FMC_A11 on PB11 - FMC_A11 had somewhere else to go
  AVOIDABLE  FMC.Address lines = "A0-A15" puts FMC_A7 + FMC_A12 on PB12 - FMC_A12 had somewhere else to go
  AVOIDABLE  UHSIF.Mode = "Enabled" puts UHSIF_PORT3 + UHSIF_PORT6 on PB0 - UHSIF_PORT3 had somewhere else to go
  AVOIDABLE  UHSIF.Mode = "Enabled" puts UHSIF_PORT4 + UHSIF_PORT7 on PB1 - UHSIF_PORT4 had somewhere else to go
  SILICON    I2C1.Mode = "I2C" puts SYS_SWIO + I2C1_SDA on PB9 - neither claim has another bonded pad here
  SILICON    FMC.Address lines = "A0-A15" puts FMC_A8 + FMC_A13 on PB13 - neither claim has another bonded pad here
  SILICON    FMC.Address lines = "A0-A25" puts FMC_A5 + FMC_A19 on PB10 - neither claim has another bonded pad here
  SILICON    FMC.Address lines = "A0-A25" puts FMC_A14 + FMC_A23 on PB14 - neither claim has another bonded pad here
  SILICON    TIM10.Channel4 = "Input Capture" puts SYS_SWIO + TIM10_CH4 on PB9 - neither claim has another bonded pad here
  SILICON    UHSIF.Mode = "Enabled" puts UHSIF_PORT2 + UHSIF_PORT5 on PC3 - neither claim has another bonded pad here
  SILICON    USBHS.Mode = "Device (HS)" puts SYS_SWIO + USBHS_DM on PB9 - neither claim has another bonded pad here
### QFN88: 450 claiming choice(s) swept; avoidable 0, silicon-forced 3
  SILICON    I2C1.Mode = "I2C" puts SYS_SWIO + I2C1_SDA on PB9 - neither claim has another bonded pad here
  SILICON    FMC.Address lines = "A0-A25" puts FMC_A14 + FMC_A23 on PB14 - neither claim has another bonded pad here
  SILICON    USBHS.Mode = "Device (HS)" puts SYS_SWIO + USBHS_DM on PB9 - neither claim has another bonded pad here
### QFN128: 450 claiming choice(s) swept; avoidable 0, silicon-forced 1
  SILICON    USBHS.Mode = "Device (HS)" puts SYS_SWIO + USBHS_DM on PB9 - neither claim has another bonded pad here
```

**Note for AGENT-3, raised rather than edited because `tests/**` is AGENT-3's:** the comment at
`tests/h417_packages.test.js:222-227` names the four as `FMC.Address bus A0-A25`. The data now
spells that setting `Address lines`, and the PB11/PB12 pair is reached through its `A0-A15` choice.
The pads, the movable signals and the count are all unchanged — only the label in the comment is
stale. The ceiling itself is correct and is not touched.

---

## The raw output

```
$ python tools/coverage.py --quiet
  CH32H417   OPEN 0  (modelled 1256, absent 23, disagreements 45)
  CH32L103   OPEN 0  (modelled 272, absent 11, disagreements 1)
  CH32V003   OPEN 0  (modelled 116, absent 10, disagreements 0)
  CH32V005   OPEN 0  (modelled 214, absent 14, disagreements 0)
  CH32V006   OPEN 0  (modelled 218, absent 11, disagreements 0)
  CH32X035   OPEN 0  (modelled 278, absent 11, disagreements 0)

$ python tools/coverage.py --gate
  PASS  CH32H417   complete, 0 open
  PASS  CH32L103   complete, 0 open
  PASS  CH32V003   complete, 0 open
  PASS  CH32V005   complete, 0 open
  PASS  CH32V006   complete, 0 open
  PASS  CH32X035   complete, 0 open

coverage gate: 6 of 6 part(s) meet their declared status

$ python tools/validate_mcu.py   (tail)
          info   peripherals.SYS.settings[0]: first choice `Serial Wire (SDI)` carries signals, so this peripheral reads as enabled from reset - correct when the reset state holds the pin

0 error(s), 99 warning(s)

$ python tools/verify_sdk_names.py   (tail)
          info   codegen.sdk: checked against EVT data/sources/X035/Evt (97 files)

0 error(s), 0 warning(s)

$ python tools/ledger.py CH32H417   (tail: the inventory totals)
```

Ledger inventory for CH32H417 (`python tools/ledger.py CH32H417`): **1212 pin functions, 95
signal-first rows, 47 RM chapters, 109 SPL instances**. `python tools/coverage.py --all CH32H417`
classifies every one: **modelled 1256 · absent 23 · disagreements 45 · pads 15 · OPEN 0**.

`node tests/run.js completeness` — **ALL GREEN, 15 tests**, printing **54 cells known-missing and
tracked** across all six parts, of which **36 are CH32H417** (35 `params` + 1 `clock`). It was 59
and 41 before this commit.

`node tests/run.js h417` — **ALL GREEN, 64 tests**, including the three package sweeps, the two
compile-gate builds (`CH32H417QEU6` QFN128, `CH32H417WEU6` QFN68) and the two standalone project
builds.

### One caution confirmed, not inherited

`tests/completeness.test.js`'s planted-break case spawns a child `node`. The brief warned that
under a restricted sandbox the spawn returns `EPERM`, the child prints nothing, and the test fails
with an empty assertion message. **It did not happen here** — the child ran, and the case passed.

Its printed line now reads `36 CH32H417 cell(s) failed once the line was ticked`, and that is the
true total. Before this commit it printed `40` while the assertion header said `(41)`, because
`assert.empty` lists 40 entries and appends "... and 1 more". **The printed number is a display
limit, not a count** — worth knowing before anyone quotes it as one.

---

## Method, so this is repeatable

The table was produced by loading `app/engine` the way `tests/completeness.test.js` does, then for
each of the 78 peripherals: reading `signal_pins` / `remaps` / `pins` / `settings` / `params` off
the model, checking `codegen.periph_clock` and `nvic.vectors`, and — for axis F — reloading the
part, setting the package, switching the peripheral on through the first multi-choice setting that
claims a signal, calling `compute()`, and searching `cFiles()['wchcube_init.c']` for the signals it
ended up holding. The fixture column comes from parsing the two `.wchproj` files and comparing each
saved setting against `neutralChoice()`, so a fixture that names a peripheral and leaves it
disabled does not count as exercising it. The collision figures come from re-running the same sweep
`tests/h417_packages.test.js` runs, outside its ceiling assertion, so the four could be named
rather than counted. The flagged/ABSENT split comes from the suite's own output rather than from
reading the exemption tables by eye.

The scripts are scratch and are not committed. The point of this section is that every number
above has a command behind it, and the command is described.
