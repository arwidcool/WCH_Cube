# AGENT-1 — DATA, round 4.

Owns `data/mcus/*`, `data/packages/*`, `data/mcus/*.notes.md`, `data/FORMAT.md`,
`data/sources/README.md`, `tools/extract_*.py`, `tools/validate_mcu.py`, `tools/verify_sdk_names.py`.
Must not edit `app/`, `tests/`, `src-tauri/`, `data/firmware/`.

**CH32X035 is yours and it is most of this round.** You already did the groundwork and declined to
start until it could be done properly — that call was right, and the EVT package has since landed, so
the reason to wait is gone. Everything you confirmed is in `data/sources/README.md`; this file adds
what the round needs on top and points at the traps.

## Before anything: the sources you now have

```
data/sources/X035/Datasheets/CH32X035DS0.md    DS v2.2, 4 294 lines — MANGLED, see below
data/sources/X035/Datasheets/CH32X035RM.md     RM, 17 082 lines
data/sources/X035/Evt/                         2 239 files, the real EVT package
    EXAM/SRC/Peripheral/inc/    21 headers   ch32x035.h, _gpio.h, _rcc.h, _usart.h, _usb.h,
                                             _usbpd.h, _awu.h, _opa.h, PIOC_SFR.h, …
    EXAM/SRC/Peripheral/src/    17 sources
    EXAM/                       worked examples per peripheral — the best answer to
                                "how is this actually used" that exists
```

`data/sources/V006/Evt/` has landed too. **Precedence: EVT → RM → DS.** Where EVT and the RM
disagree, record both in the notes — EVT says what the SDK compiles, the RM says what the silicon
does.

## P0 — extract CH32X035

### 1. The pin tables, with a parser and a second pass

The DS markdown is mangled: pin rows split across lines, all seven package columns merged into
single cells. **Do not read Table 2-1 by eye.** The CH32V006 standard is the standard here —
`tools/extract_pins.py` re-derived its package tables and diffed to 0 differences, and
`tools/extract_remaps.py` re-derived 232 remap assignments independently. Do the same:

- extend `extract_pins.py`, or add `extract_pins_x035.py` if the mangling needs its own parser;
- re-derive, diff, and **report the count and the differences in the commit message**;
- negative-test it against planted edits, as you did before;
- a row the conversion has genuinely destroyed is a line in `CH32X035.notes.md` and, if it blocks a
  package, a `BLOCKED` on the board. **Not a plausible value.**

### 2. The part, and the two things about its pins that break everything else

From the DS Overview and model table, confirmed:

- **QingKe 32-bit RISC-V4C**, RV32IMAC. 62 KB flash, 20 KB SRAM, VDD 2–5.5 V, 48 MHz.
- Eight variants, seven packages:

  | Variant | Package | I/O | Notes |
  |---|---|---|---|
  | CH32X035R8T6 | LQFP64M | 60 | |
  | CH32X035C8T6 | LQFP48 | 46 | |
  | CH32X035G8U6 | QFN28 | 27 | has a `pio_env` in `data/firmware` |
  | CH32X035G8R6 | QSOP28 | 26 | **no geometry in packages.yaml yet** |
  | CH32X035F8U6 | QFN20 | 19 | |
  | CH32X035F7P6 | TSSOP20 | 18 | note the **7**, not 8 |
  | CH32X035D8U6 | QFN12 | 11 | |
  | CH32X033F8P6 | TSSOP20 | 18 | a **different part number family** — decide whether it is a variant here or its own file, and say why in the notes |

  Re-derive that table from the DS rather than trusting this one: it was read off a mangled
  conversion and the I/O column is exactly the kind of thing `validate_mcu.py` cross-checks.

- **Ports A, B, C only** (`ch32x035.h:656-658`) — no GPIOD.
- **Ports are 24 bits wide**: `GPIO_Pin_0 … GPIO_Pin_23`, `uint32_t` (`ch32x035_gpio.h:76-83`).
- **PC has TWO holes**, and the round-3 board entry that said one was incomplete — worth knowing
  as an illustration of this round's own rule. Counting occurrences across the DS and the RM:
  `PC8`, `PC9`, `PC12`, `PC13` appear **zero** times in either; `PC10` and `PC11` appear **12 times
  each** in the DS. So port C reads as **PC0–PC7, PC10–PC11, PC14–PC19**. Settle it from the pin
  table itself — a name count is evidence, not a pin table — and record the exact set in the notes.
  **A port that is not a contiguous range, twice over.**

Those last two are traps rather than trivia, and they are traps for AGENT-2 and AGENT-3 more than
for you — **post them on the board the moment your `pins:` block exists**, with the exact pin list,
so they can go looking for 16-bit masks and `for (i=0; i<=max; i++)` while you carry on.

### 3. Packages

- `QSOP28` does not exist in `data/packages/packages.yaml` — add it, with pitch and body from the DS
  mechanical drawings.
- `LQFP64M` — `LQFP64` exists (0.5 mm, 10×10). **Check the DS drawing before reusing it.** WCH's "M"
  suffix marks a body variant; if the dimensions differ, it is a new geometry, and if they do not,
  say so in the notes so the next person does not re-ask.
- Everything else (LQFP48, QFN28, QFN20, TSSOP20, QFN12) already has a geometry.

### 4. Peripherals — including four kinds this repo has never modelled

From the EVT headers, which is the authoritative list of what the SDK can drive:

`adc awu dbgmcu dma exti flash gpio i2c iwdg misc opa pwr rcc spi tim usart usb usbpd wwdg` +
`PIOC_SFR.h`. Note there is **no tkey header** although the DS advertises 14-channel TouchKey —
record that, it is exactly the sort of EVT/DS disagreement the precedence rule exists for.

- **USART1, USART2, USART3, USART4** — four of them. Clock bits at
  `ch32x035_rcc.h:60` (APB2, USART1) and `:66-68` (APB1, USART2/3/4).
- **TIM1 / TIM2 / TIM3**, SPI1, I2C1, ADC1.
- **USBFS** — host *and* device, on AHB (`RCC_AHBPeriph_USBFS`, `:48`).
- **USBPD** — Type-C source / sink / DRP, on AHB (`RCC_AHBPeriph_USBPD`, `:50`). This part's headline
  feature. It has its own pins (CC1/CC2) and they belong in the conflict engine like any others.
- **PIOC** — the programmable I/O controller. `GPIO_Remap_PIOC` exists
  (`ch32x035_gpio.h:124`), so it has a pin story even if its programming model is unlike anything
  else here.
- **AWU**, 2×OPA, 3×CMP, and `RCC_AHBPeriph_IO2W` (`:49`) — the 1-wire controller the DS mentions.
- PWR, FLASH, EXTI, IWDG, WWDG, SYS, RCC, DMA, as on CH32V006.

**No empty "Activated" stubs.** A peripheral with nothing configurable does not go in the tree —
that is a dead control under round 2's rule. If USBPD or PIOC is too large to model properly in one
cycle, land the peripherals you can do fully and post what is left; a partial part is better than a
fake one, and both are better than a stub.

### 5. Remaps — a different mechanism, and it needs a schema change

This is the most interesting difference and the one to raise on the board early.

CH32V006 remaps are raw `AFIO_PCFR1` field values, and `codegen.remap` carries `lsb`/`bits`.
CH32X035's EVT gives **40 named macros** instead (`ch32x035_gpio.h:88-125`):

```c
#define GPIO_PartialRemap1_SPI1    ((uint32_t)0x00100001)
#define GPIO_FullRemap_USART2      ((uint32_t)0x08070200)
#define GPIO_PartialRemap5_TIM2    ((uint32_t)0x08220014)
#define GPIO_Remap_PIOC            ((uint32_t)0x00200080)
#define GPIO_Remap_SWJ_Disable     ((uint32_t)0x08300400)
```

applied with `GPIO_PinRemapConfig(macro, ENABLE)`. Remap-level counts, from the macro names:
SPI1 4, I2C1 6, USART1 4, USART2 5, USART3 4, USART4 6, TIM1 5, TIM2 7, TIM3 4, plus PIOC and SDI.

`AFIO->PCFR1` still exists, so the raw-field route would work — but **`GPIO_PinRemapConfig` is what
the EVT examples use**, it is what a user reading WCH's own code will recognise, and it is one call
instead of a hand-built mask. Propose the schema (a `macro:` per remap index alongside the existing
`lsb`/`bits`, so both families are expressible and neither is special-cased) and post
`HANDOFF(→AGENT-2)` before you fill 40 of them. Agreeing the shape first is cheaper than migrating.

Re-derive the mapping from **RM AFIO_PCFR1 §** independently of the macro names and diff the two.
The macros encode position and value; the RM says which pins each value selects. Both halves are
needed and neither is a substitute for the other.

### 6. Clock — the part with no HSE

`grep -c HSE data/sources/X035/Evt/EXAM/SRC/Peripheral/inc/ch32x035_rcc.h` → **0**.
The only oscillator is the internal 48 MHz RC; the EVT `system_ch32x035.c` offers
`SYSCLK_FREQ_8MHz_HSI / 12 / 16 / 24 / 48`, all HSI.

So `clock:` on this part has **no HSE source, no `hse_peripheral`, no `hse_signals`, no crystal
pins.** Do not add an HSE branch "for symmetry" and do not add one marked disabled — round 2's rule
is that a control is justified by the MCU data or it does not exist. This part is the first real test
of whether the clock tab reads its sources from the data; AGENT-2 and AGENT-3 need to know early, so
**post the `clock:` block on the board as soon as it validates**, ahead of the rest of the file.

### 7. DMA, NVIC, EXTI — bigger and shaped differently

- **DMA: 8 channels**, not 7 (`DMA1_Channel1_IRQn` … `DMA1_Channel8_IRQn`, `ch32x035.h:49-55,71`).
  Requests per channel from the RM's DMA request-mapping table; `channel_params` in the same schema
  you already built.
- **NVIC: 47 vectors** (`ch32x035.h:32-82`), against CH32V006's 29. New owners: `AWU_IRQn`,
  `USBFS_IRQn`, `USBFSWakeUp_IRQn`, `PIOC_IRQn`, `OPA_IRQn`, `USBPD_IRQn`, `USBPDWakeUp_IRQn`,
  `USART2/3/4_IRQn`, `TIM2_CC/TRG_COM/BRK_IRQn`, `TIM3_IRQn`, `DMA1_Channel8_IRQn`.
- **EXTI vectors are grouped**: `EXTI7_0_IRQn`, `EXTI15_8_IRQn`, `EXTI25_16_IRQn` cover **26 EXTI
  lines**. The `nvic:` schema maps a vector to an owner; here three vectors cover 26 lines, so the
  NVIC tab must list three rows and not twenty-six. Say how the data expresses that — a `lines:`
  range on the vector is the obvious shape — and tell AGENT-3 on the board.
- Check the PFIC priority scheme for **this core**. CH32V006 is a V2A with two priority bits; X035 is
  a **V4C**. Do not carry the V2A scheme across by analogy — read this RM's PFIC chapter and record
  what it actually says. If it is the same, say that you checked.

### 8. codegen — the family-level names

| Key | CH32X035 | Source |
|---|---|---|
| `header` | `ch32x035.h` | EVT `inc/` |
| `gpio_clock.fn` | `RCC_APB2PeriphClockCmd` | `ch32x035_rcc.h:53-57` |
| `gpio_clock.port` | `RCC_APB2Periph_GPIO$PORT` | same |
| `gpio_clock.afio` | `RCC_APB2Periph_AFIO` | `:53` |
| `speeds` | one entry, `GPIO_Speed_50MHz` | `ch32x035_gpio.h:25` |
| `periph_clock` domains | `AHB` / `APB1` / `APB2` | `:46-70` — **not** HB/PB1/PB2 |

Plus `params:` with `struct:` / `field:` / `sdk_call` / `sdk_args` as you defined them in round 3,
for every peripheral you land. And `pio_board` / `pio_env` per variant — `genericCH32X035G8U6` is the
only one with an environment in `data/firmware/platformio.ini` today; check the rest against the
installed platform's `boards/` the way `verify_sdk_names.py` already does, and **omit rather than
approximate** where no board ships.

### 9. The gates, pointed at the right headers

`verify_sdk_names.py` resolves a part's SDK series. For CH32X035 the authority is now the **EVT
package in this repo**, not the PlatformIO package:
`data/sources/X035/Evt/EXAM/SRC/Peripheral/inc/`. Make the resolution prefer `data/sources/<PART>/Evt/`
when it exists and fall back to `~/.platformio/packages/framework-wch-noneos-sdk` when it does not —
and say which one it used, per part, in its output. A gate that silently checks the wrong headers is
worse than one that says it could not check.

Then: `validate_mcu.py` 0 errors, `verify_sdk_names.py` 0 errors, planted-break counts in the commit
message as always.

## P1 — carried over and housekeeping

10. **D8**: RM chapter 20 "Extended Configuration" (EXTEN) on CH32V006 — model it or put it on the
    whitelist in `CH32V006.notes.md` with the reason. It is the last uncovered chapter.
11. `data/sources/README.md` — both EVT packages have landed. Rewrite the "until the EVT drop
    arrives" section into "which parts have EVT, and where its headers live", and record the X035
    EVT/DS disagreement about TouchKey.
12. `data/FORMAT.md` — document everything new this round: the remap `macro:` form, grouped NVIC
    vectors, a part with no HSE, 24-bit and non-contiguous ports, `pio_board`/`pio_env`.

## Rules
- **Extract with a parser, diff with a second one.** Eyeballing a mangled conversion is not
  available to you on this part.
- **An unanswerable question is recorded, never guessed.**
- **Post the shape before you fill it.** The `clock:` block, the `pins:` block and the remap schema
  each unblock someone else; each is worth a board entry on its own the moment it validates, ahead
  of the rest of the file.
- Every fact cites a DS/RM table or an EVT `file:line` in `CH32X035.notes.md`.

## Gate before every commit
`python tools/validate_mcu.py data/mcus/CH32X035.yaml` → 0 errors, `python tools/verify_sdk_names.py`
→ 0 errors, `python build.py && node tests/run.js` all green — **and confirm CH32V006 and CH32V005
still validate**. A second part must not cost the first one anything.

---

## Current — round 4, cycle 1

### Done

- **The CH32X035 pin table parses to 0 differences** on all seven packages against the DS
  model table's own I/O column. Three parser fixes in `tools/extract_pins.py`, none of
  them X035-specific, and CH32V006/CH32V005 re-run to 0 differences after every one.
- **Two rows the PDF destroyed are DECLARED**, in
  `data/sources/X035/Datasheets/CH32X035_pin_corrections.yaml`, printed on every run,
  each certain from the rows around it. The tool refuses an entry with no `reason:`.
- **`data/mcus/CH32X035.yaml` lands and validates** — validate_mcu 0 errors,
  verify_sdk_names 0 errors against the X035 EVT headers. Partial, and the file says so.
- **`CH32X035.notes.md`** with a source for every fact and an open question for every
  thing I could not settle.
- **QSOP28 and LQFP64M** added to `packages.yaml`; three existing geometries corrected.
- **The schema decisions** AGENT-4 asked for, posted before filling anything: a `macro:`
  per remap entry with `codegen.remap.style`, and `lines: [first, last]` on a grouped
  NVIC vector.

### What checking found that reading would not

Five, and the first two are mine:

1. **I shipped CH32V006's GPIO mode list into CH32X035 and the gate caught it.** This part
   has **no open-drain at all** — `GPIOMode_TypeDef` has six members, not eight. Real,
   correctly spelled SPL names belonging to a different chip. Round 3's defect class,
   committed by me, one round later, and caught only because I built the checker.
2. **I guessed `USBFS_DEVICE` as the register-block handle.** It is `USBFSD`, and there is
   also `USBFSH` at the same base address — two handles, one `periph_handle` slot.
3. **The brief's "47 vectors" is 45**, counted from `IRQn_Type` and the startup `.word`
   table independently; they agree on every number, name and handler.
4. **There is no RCC vector at all** on this part, where CH32V006 has `RCC_IRQn = 19`.
5. **The V4C PFIC has three priority bits at [7:5]**, not the V2A's two at [7:6] — eight
   priority levels against four. The brief was right that it must not be assumed.

And one I got wrong in public: my round-3 board entry said port C had one hole. It has
two. That was reading rather than parsing, and I corrected it on the board rather than
quietly.

### Three per-pin capabilities the schema cannot express

Raised with AGENT-2 as one problem rather than three, because one mechanism would cover
all of them: **pull-down works only on PA0-PA15 and PC16-PC17**; **every shorted pair is
"prohibited from being configured as output functions"**; and **PC10/PC11 must be floating
inputs while USB is enabled**, which is a peripheral-to-pin coupling like round 2's HSE.

### Next, in order

1. **DS Table 2-3** — ~470 lines of abbreviated per-pin tokens (`T2C1_2`, `CTS2_1`, `A13`)
   with the remap index in the suffix (DS note 2). Needs its own parser and a second pass
   diffed against the RM's AFIO_PCFR1 section, to the CH32V006 standard. This is the gate
   on every remaining peripheral.
2. The pin-bearing peripherals behind it: 4×USART, TIM1/2/3, SPI1, I2C1, ADC1, PWR, FLASH,
   EXTI, PIOC, OPA, AWU — and the 25 vectors waiting on them.
3. `dma:` with 8 channels and its request map.
4. `data/FORMAT.md` for everything new this round.
5. Whether TouchKey is a mode of the ADC here as it is on CH32V006, before modelling it.
