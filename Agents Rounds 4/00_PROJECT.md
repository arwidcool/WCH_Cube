# WCH_CubeMX — Round 4: "a second family, and a project you can flash"

Round 1 built the machinery. Round 2 made what you can click correct. Round 3 made what comes out
compile. Round 4 has **two deliverables**, and they prove each other:

**A. CH32X035, end to end** — a second MCU family, extracted from its own DS and RM, checked against
its own EVT package, configurable in the app on every package it ships in, and generating C that
builds.

**B. "Generate PlatformIO project"** — the app emits a **complete, standalone project folder**:
`platformio.ini`, `src/main.c`, the generated init code, a README. You open it in VS Code, press
Upload, and the chip does something you can see. No copying files, no editing a template, no
"now drop this into a project of your own".

B is what turns A from a green test into a working chip. Today a user can generate `wchcube_init.c`
and still be several manual steps from a running board; after round 4, Generate hands them something
they can flash.

Read this file, then your own `AGENT_n_*.md`, then `BOARD.md` in this folder, then `../PROGRESS.md`,
then `../TASKS.md`. `../agents/README.md` rules remain in force. Round 3's unfinished lines carry
over — see "Carried over"; they come first.

## Why this round is not "just another YAML file"

Everything in `data/mcus/` today is one family. CH32V005 is CH32V006 with things removed. The dummy
part was built to look like them. **Every assumption the engine, the UI and the tests have quietly
made about "an MCU" has only ever been tested against one shape of MCU.**

CH32X035 is a different shape in at least nine ways, every one of them confirmed against its own EVT
headers and datasheet, and every one of them capable of breaking something that works today:

| # | CH32X035 | What everything in this repo assumes today |
|---|---|---|
| 1 | **No HSE at all.** `grep -c HSE ch32x035_rcc.h` → **0**. One 48 MHz RC oscillator, SYSCLK divided to 48/24/16/12/8 MHz. | Round 2's P0 was *"HSE must ALWAYS be selectable"*. On this part it must not appear at all. |
| 2 | **Ports are 24 bits wide.** `GPIO_Pin_0 … GPIO_Pin_23`, `uint32_t` (`ch32x035_gpio.h:76-83`). | 16-bit pin masks, `uint16_t`, `0xFFFF`. |
| 3 | **PC has TWO holes.** The DS names PC0–PC7, PC10–PC11 and PC14–PC19, and never names PC8, PC9, PC12 or PC13 (0 occurrences each in DS and RM; PC10 and PC11 appear 12 times each). | Anything iterating a port 0..N. |
| 4 | **Remaps are named SDK macros**, not raw field values: `GPIO_PartialRemap2_USART2`, `GPIO_FullRemap_TIM2`, … **38** of them (`ch32x035_gpio.h:88-125`), applied with `GPIO_PinRemapConfig(macro, ENABLE)`. | `codegen.remap` carries `lsb`/`bits` and writes `AFIO->PCFR1` directly. |
| 5 | **Clock domains are AHB / APB1 / APB2**, and `RCC_APB2PeriphClockCmd` (`ch32x035_rcc.h:46-70`). | CH32V00x spells them HB / PB1 / PB2 with `RCC_PB2PeriphClockCmd`. |
| 6 | **Four USARTs**, TIM1/2/3, plus peripherals no part here has: **USBFS** (host *and* device), **USBPD** (Type-C source/sink/DRP), **PIOC** (programmable I/O controller), **AWU**, 2×OPA, 3×CMP, 14-channel TouchKey. | 18 peripherals, all of them classic. |
| 7 | **DMA has 8 channels** (`DMA1_Channel1_IRQn`…`DMA1_Channel8_IRQn`). | 7. |
| 8 | **45 interrupt vectors, there is NO `RCC_IRQn`, and the EXTI ones are grouped**: `EXTI7_0_IRQn`, `EXTI15_8_IRQn`, `EXTI25_16_IRQn` cover EXTI lines 0-25 between them, while `ch32x035_exti.h` defines **30** lines — 26-29 are internal events (PVD, AWU, USBFS wake-up, USBPD wake-up), each with its own vector. | 29 vectors; a vector per peripheral; and every family has an RCC interrupt. |
| 9 | **One GPIO speed, `GPIO_Speed_50MHz`** — not 30. `RCC_ClocksTypeDef` has **no** `ADCCLK_Frequency`. | Fixed in round 3 for V006; X035 proves the fix is data-driven and not a V006 special case. |

Read the table as a list of tests, not a list of chores. **Each row is a place where the repo either
reads its answer from the MCU file or has a CH32V006 assumption baked in, and today nobody knows
which.** That is the real deliverable of round 4: not one more part, but the proof that adding a part
is a data job.

## The sources — all three, and EVT has landed

```
data/sources/X035/
├── Datasheets/CH32X035DS0.md    DS v2.2   — 4 294 lines
├── Datasheets/CH32X035RM.md     RM        — 17 082 lines
└── Evt/                         the WCH EVT package — 2 239 files, ARRIVED
    └── EXAM/SRC/Peripheral/     inc/*.h and src/*.c — 21 headers, 17 sources
```

`data/sources/V006/Evt/` has landed too (988 files). **The "until the EVT package arrives" language
throughout the repo is now stale** and is AGENT-4's to correct.

Precedence is unchanged and now fully exercisable: **EVT sources → Reference Manual → Datasheet →
anything else.** Where EVT and the RM disagree they answer different questions — EVT says what the
SDK will compile, the RM says what the silicon does. Record the contradiction in the part's
`.notes.md`; do not average them.

**The DS markdown is badly mangled by the PDF conversion** — pin rows split across lines, all seven
package columns merged into single cells. AGENT-1 already looked and declined to eyeball it. That
call stands: this wants a parser plus a second-pass diff, the way CH32V006 got 232 remap assignments
at 0 differences.

## What "everything required" means

A part is added when **all four** of these are true, not one:

1. **DATA** — `data/mcus/CH32X035.yaml` validates, every SPL name it claims exists in the X035 EVT
   headers, and `CH32X035.notes.md` cites a DS/RM table or an EVT file:line for every fact.
2. **ENGINE** — it loads, computes, conflicts, clocks, round-trips through `.wchproj` and generates
   C, **with no code that names CH32X035**. A `grep -ri "X035\|x035" app/engine/` must come back
   empty when you are done.
3. **UI** — every package draws, every tab opens, every control is real, and the clock tab handles a
   part with no HSE without a placeholder and without an error.
4. **QA** — it compiles. Fixture → `wchcube_cli --pio` → `pio run -e CH32X035G8U6` → exit 0, with
   pins, params, DMA and NVIC actually set.

The part number for the compile gate already exists: `data/firmware/platformio.ini` has a
`[env:CH32X035G8U6]` environment, added in round 3 and building today with no generated code in it.

## Deliverable B — the generated PlatformIO project

### What it produces

One folder, self-contained, that builds with nothing but PlatformIO installed:

```
<ProjectName>/
├── platformio.ini              platform ch32v, framework noneos-sdk, the right board
├── README.md                   what this is, what was configured, how to build and flash
├── .gitignore                  .pio/
├── include/
├── src/
│   └── main.c                  calls WCHCube_Init(), then does something observable
└── lib/
    └── wchcube_generated/
        ├── include/wchcube_init.h
        └── src/wchcube_init.c
```

Mirror the layout and the conventions of `data/firmware/` — that project already works, its
`ARCHITECTURE.md` explains why each piece is where it is, and a user who outgrows the generated
project should find the two shaped the same way.

### `platformio.ini`

Every value comes from the MCU file and the chosen variant, never from a guess:

```ini
[env:<pio_env or the variant name>]
platform  = ch32v
framework = noneos-sdk
board     = <variants[<part>].pio_board>
build_flags = -D SDI_PRINT=1
upload_protocol = wch-link
monitor_speed   = 115200
```

**A variant with no `pio_board` cannot produce a project.** Two CH32V006 variants are already in
that position and say so by omission (F4U6 and D8U7 — see AGENT-1's 16:16Z board entry). Refuse,
name the part, and say which variants *can* be generated. Do not substitute the nearest board:
F4U6 is 16 KB of flash against F8U6's 62 KB, and the nearest board would lie about the memory.

### `main.c` — observable, and honest about what it knows

This is the part where it would be easy to invent hardware. Do not. What is genuinely known:

1. **printf over the WCH-Link SDI channel claims no pin.** `SDI_Printf_Enable()` + `printf()` work
   on any board with a WCH-Link attached and cost nothing in pins. Print the part, the package, the
   SYSCLK the configuration asked for, and `SystemCoreClock` read back after `WCHCube_Init()` — if
   those two disagree, the user learns it on the first run.
2. **A GPIO the user configured as an output is not an invention — it is their configuration.** If
   the project has one or more output pins, blink the first one and name it in the banner and the
   README: `/* PA1 — "STATUS_LED" — configured as Output Push Pull in this project */`.
3. **If there is no output pin, say so and do not blink anything.** The banner reads
   "no output GPIO configured — nothing to toggle", and the README explains how to add one in the
   app and regenerate. A blink on a pin nobody configured is exactly the class of invention this
   project bans.
4. **`/* USER CODE BEGIN/END */` markers** around the loop body, so regenerating does not eat what
   the user wrote there (D3).

`main.c` calls into the generated init and the SDK and nothing else. It does not get its own HAL.

### Where it goes

- **Desktop (Tauri):** a native folder picker, then the folder is written. Refuse to write into a
  non-empty directory unless the user confirms, and never overwrite a file the generator did not
  write.
- **Browser:** a single `.zip` download. No external library — the app is one offline file, and
  `build.py` inlines what it has. A stored-entry (no compression) ZIP writer is about sixty lines
  plus a CRC-32 table; that is the price of the feature and it is worth paying. If AGENT-2 judges
  otherwise, say so on the board and ship individual downloads with the folder layout printed in
  the README, rather than shipping a half-working zip.

### The clock coupling, which is a real trap

`data/firmware/ARCHITECTURE.md` calls it "Two clock owners" and it applies to every generated
project. The board file's `build.clock_source` / `build.f_cpu` become a `SYSCLK_FREQ_*` macro that
`SystemInit()` applies **before** `main()`; `WCHCube_RCC_Init()` then runs from `main()` and wins.
So a project configured for 24 MHz boots at 48 and drops to 24. That is fine, it is what CubeMX does
too, and `SystemCoreClockUpdate()` keeps `Delay_Ms()` honest — but the generated README must say it
in one sentence, and the banner printing both numbers is what makes it visible rather than puzzling.

### Done means flashed, or honestly not

The gate is `pio run` on a generated project in a scratch directory, exit 0, for CH32V006 and
CH32X035. **`pio run -t upload` onto real silicon is a stronger claim than anyone in this repo has
ever made, and nobody has hardware attached in CI.** If a human flashes one, that goes in the
evidence file as the first hardware result this project has. If not, the DONE line says "builds,
not flashed" — and says it in exactly those words.

## Carried over from round 3 — these come FIRST

| # | Open item | Owner |
|---|---|---|
| D1 | `generateAll()` returns `{ name, language, text }` per file | AGENT-2 |
| D2 | Generator options in `S.project`, round-tripped and undoable | AGENT-2 |
| D3 | User code sections preserved across regeneration — or the option is not offered | AGENT-2 |
| D4 | `Tools` tab: implement it or remove it | AGENT-3 |
| D5 | Tauri command to write generated files to a chosen folder | AGENT-4 |
| D6 | Host-side unit tests for `lib/util` under `[env:native]` | AGENT-4 |
| D7 | `agents/README.md` "Environment facts"; round-3 section in `agents/DONE.md` | AGENT-4 |
| D8 | RM chapter 20 "Extended Configuration" (EXTEN) on V006 — modelled or whitelisted | AGENT-1 |
| D9 | `#m-open` / `#m-openproj` dead-control sweep; `Taskfile.yml` adopt-or-leave | AGENT-4 |

## Round-4 definition of done

AGENT-4 appends this to `../agents/DONE.md` as a "Round 4" section and ticks only on evidence.

- [ ] Every round-3 carry-over D1–D9 closed.
- [ ] `data/mcus/CH32X035.yaml` — 8 variants, 7 packages, every peripheral the RM describes,
      remaps re-derived by a second independent pass and diffed to **0 differences**.
- [ ] `python tools/validate_mcu.py data/mcus/CH32X035.yaml` → 0 errors; `verify_sdk_names.py`
      against the **X035 EVT headers** → 0 errors.
- [ ] `CH32X035.notes.md` cites a source for every fact, and records every open question rather
      than guessing it.
- [ ] Package geometries exist for all seven; `QSOP28` added; `LQFP64M` resolved against the DS
      mechanical drawing rather than assumed to be `LQFP64`.
- [ ] `grep -ri "x035" app/engine/ app/template.html` is **empty**. No part is special-cased.
- [ ] The clock tab on CH32X035 shows an HSI-only tree: no HSE box, no HSE row in RCC, no greyed
      placeholder, no console output. On CH32V006 it is unchanged.
- [ ] 24-bit ports and the PC hole work everywhere: pin masks, the GPIO table, the chip drawing,
      EXTI line mapping, generated `GPIO_Pin_*` masks.
- [ ] DMA tab shows 8 channels; NVIC tab shows **45** vectors with the three grouped EXTI
      vectors listed once each, not 26 times — and does not invent an `RCC_IRQn`, which this
      part does not have.
- [ ] Generated C for a fully configured CH32X035 has zero TODO sections and zero `#error`, uses
      `GPIO_PinRemapConfig` where the data gives a macro, and **compiles**:
      `pio run -e CH32X035G8U6` exits 0.
- [ ] Every existing test still passes on CH32V006 and CH32V005 — no regression paid for X035.
- [ ] `tests/smoke.js`, `layout.test.js`, `legibility.test.js`, `completeness.test.js` and
      `codegen_compile.test.js` all cover CH32X035 × every package.
- [ ] `PROGRESS.md` current; the stale "EVT has not arrived" language corrected everywhere.

Deliverable B:

- [ ] `Generate PlatformIO project` produces a folder that builds with **no manual step**:
      `pio run` in the generated directory exits 0, for CH32V006 TSSOP20 and CH32X035.
- [ ] Its `platformio.ini` names the board from `variants[*].pio_board`; a variant without one is
      refused by name, with the generatable variants listed.
- [ ] `main.c` prints the part, the configured SYSCLK and `SystemCoreClock` read back, blinks a pin
      **only** if the user configured an output, and says so plainly when they did not.
- [ ] The generated README explains the two-clock-owners behaviour in one sentence.
- [ ] Desktop writes a folder through a native picker; the browser delivers a `.zip` with no
      external library, or the alternative is argued on the board and the README carries the layout.
- [ ] `tests/generated_project.test.js`: generate to a scratch dir, `pio run`, exit 0, clean up.
      Skips with a printed reason when `pio` is absent — never silently.
- [ ] A human has flashed one generated project and the result is in `tests/evidence/round4/`, or
      the DONE line says "builds, not flashed" in those words.

## Round-4 rules

Round 3's rules all still apply. Four additions, each earned by something in the table above:

- **No part may be named in code.** If the engine, the UI or a test needs to know something about
  CH32X035, the MCU file tells it. `grep -ri "x035" app/` empty is a DONE line, not a style note.
- **A second part is a regression test for the first.** Every change you make for X035 gets run
  against CH32V006 and CH32V005 before you commit. "It works on the new part" is half a result.
- **Extract with a parser, diff with a second one.** The CH32V006 standard: an independent
  re-derivation that diffs to zero, negative-tested against planted edits. The X035 DS markdown is
  mangled enough that eyeballing it is not an option anyone should take.
- **An unanswerable question is recorded, never guessed.** The DS conversion has genuinely lost
  information in places. A row you cannot read is a line in `.notes.md` and, if it blocks, a
  `BLOCKED` on the board — not a plausible value.

## Environment facts

- Windows box. `python` (3.12), not `python3`. `node` v24. `cargo` 1.98.1 on PATH.
- PlatformIO Core 6.2.0, platform `ch32v` 1.1.0, WCH RISC-V GCC 12.2.0 — `data/firmware` builds
  **offline**, all four environments.
- CH32X035 toolchain differs from the V00x parts and comes from the board file, not from us:
  `march=rv32imacxw`, `mabi=ilp32` (V006 is `rv32ec_zmmul_xw` / `ilp32e`).
- Repo on a Google Drive mount: `npm install` fails with EBADF; test deps in
  `%LOCALAPPDATA%\wchcube-deps`.
- No git remote; CI has still never run. Shared tree, direct commits to `main`, `AGENT-n: <task>`.
- Timestamps from `date -u +%Y-%m-%dT%H:%MZ`, not guessed.
