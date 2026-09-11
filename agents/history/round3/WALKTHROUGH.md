# WALKTHROUGH — round 3. Configuration → C → a binary.

AGENT-4 runs this in a real browser and a real shell; anyone can. Record results in
`tests/evidence/round3/<date>.md` with a screenshot per numbered section.

`../Agents Rounds 2/WALKTHROUGH.md` §1–§7 still applies and is still the app's acceptance script —
run it first. This file only covers what round 3 adds: the path from a configuration to something
you could flash. Sections marked **(gate)** are the round's exit criterion.

---

## 8 Configure something worth generating

A default configuration assigns no pins and generates an empty `WCHCube_GPIO_Init()`. It proves the
plumbing and nothing about the code. Every section below starts from a configuration that
exercises something.

8.1 New project → CH32V006 → `CH32V006F8P7` (TSSOP20) → name `gate_tssop20` → Create.
8.2 Assign across **more than one port**: PC5 → `SPI1_SCK`; PD5 → `USART1_TX`; PD6 → `USART1_RX`;
    PA1 → a GPIO output with a user label; PD3 → `ADC1_IN4`.
8.3 Set a **remap** that moves a signal, and confirm the chip repaints.
8.4 Parameter Settings → USART1: baud 115200, 8N1. TIM1: prescaler and period set to something that
    is not the default. SPI1: a non-default baud prescaler.
8.5 DMA Settings → USART1 → Add request `USART1_TX`; leave the suggested channel; set Mode
    circular. Confirm the DMA1 panel in System Core shows it with USART1 as the owner.
8.6 NVIC Settings → USART1 → enable its vector; set preemption and sub priority. **Both ranges come
    from `nvic.scheme`** — the PFIC has two priority bits, not four.
8.7 Ctrl+S → `gate_tssop20.wchproj`. Keep it: §10 and `tests/fixtures/` both want it.

## 9 The Project Manager tab

9.1 Open **Project Manager**. It is a real tab — not `disabled`, not `title="Future"`.
9.2 **Project** section shows the MCU, part number and package that are actually loaded, and they
    agree with the breadcrumb, `#mcusel` and `#pkgsel`. (Round-2 defect: they did not.)
9.3 **Toolchain** shows PlatformIO and the environment it maps to (`CH32V006F8P6`). No greyed
    toolchains we do not support are listed.
9.4 **Code generator** options: only options the engine can actually honour are shown.
9.5 **Preview** lists `wchcube_init.h`, `wchcube_init.c`, and the pin table and clock summary if
    those options are on. Selecting each shows its real text, read-only, scrollable.
9.6 Read `wchcube_init.c` in the preview and check, by eye, before any compiler sees it:
    - the `#include` names the header for **this** part;
    - every `GPIO_Speed_*` macro is one the part actually has;
    - the GPIO blocks mention every pin from 8.2 and **not** SWIO or RST;
    - the USART/SPI/TIM init structs carry the values from 8.4;
    - a `DMA_InitTypeDef` and a `DMA_Init(DMA1_Channelx, …)` for 8.5;
    - the vector from 8.6 with its priorities;
    - **zero TODO sections and zero `#error`.** Both are emitted deliberately when the MCU data
      cannot support a section, and both must stand out visually.
9.7 Generate. In a browser the files download. On the desktop build the folder picker appears,
    defaults to `data/firmware/lib/wchcube_generated/`, and writes the header into `include/` and
    the source into `src/`.

## 10 The compile gate  **(gate)**

From the repository root, with the project from §8:

```bash
node tools/wchcube_cli.js --project gate_tssop20.wchproj --format c --pio data/firmware
cd data/firmware && pio run -e CH32V006F8P6
```

10.1 The CLI writes `lib/wchcube_generated/include/wchcube_init.h` and `.../src/wchcube_init.c`.
10.2 `pio run` exits **0**. `libwchcube_generated.a` appears in `.pio/build/CH32V006F8P6/`.
10.3 No warnings from `wchcube_init.c`. A warning here is a defect — it is machine-written code and
     nobody is going to read it twice.
10.4 The linked size is plausible: the firmware without generated code is ~7.8 KB of flash, so a
     configured build should be larger, not identical. Identical means it was not linked in.
10.5 Repeat for **QFN32** (`CH32V006K8U6`) and **CH32V005 TSSOP20** (`CH32V005F6P6`) with their own
     configurations. A part that only compiles on one package is not compiling, it is coinciding.
10.6 `node tools/wchcube_cli.js --project … --strict` exits non-zero if codegen emitted a TODO or an
     `#error`, so "it generated" is never mistaken for "it generated something usable".

## 11 Round-trip and determinism

11.1 Close the project, reopen `gate_tssop20.wchproj`. Every pin, param, DMA request and NVIC
     priority is back, and the Project Manager preview shows the same text as before.
11.2 Generate again into a second folder and diff: the two `wchcube_init.c` are **byte-identical**.
     No timestamps, no map-iteration order. If they differ, that is a bug and §10 is not trustworthy.
11.3 Undo the DMA request, regenerate: the `DMA_InitTypeDef` block is gone and the file still
     compiles. Redo, regenerate: it is back.

## 12 What this does NOT prove

Write this into the evidence file every time, so nobody quotes a green §10 as more than it is.

- **Nothing has been flashed.** A clean compile says the names exist and the types match. It does
  not say a bit is in the right place. The first `pio run -t upload` onto real hardware is a
  separate, and much stronger, claim — and nobody has made it yet.
- **Windows ignores filename case.** A header named for the wrong part still resolves here and fails
  on Linux. Until CI runs, `tools/verify_sdk_names.py` is what catches that class, not the compiler.
- **An empty section always compiles.** If a configuration assigns nothing, the generated function
  is empty and passes. That is why §8 exists.
