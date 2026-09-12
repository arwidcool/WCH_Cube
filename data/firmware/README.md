# WCHCube firmware

The firmware half of this repository, as a PlatformIO project.

The configurator (`../../app`, built into `../../dist/index.html`) decides *what*
a pin, a clock and a peripheral should be. This project is where that decision
becomes an ELF: real toolchain, real vendor SDK, real part. It is also the only
place in the repo where "the generated C actually compiles" can be answered with
evidence instead of a claim.

## Open it in VS Code

PlatformIO needs `platformio.ini` at the workspace root, so open **this folder**,
not the repository root:

```
File -> Open Folder... -> data\firmware
```

To see the configurator and the firmware side by side instead, open
`wchcube-firmware.code-workspace` from this folder — it is a two-root workspace
(repo root + this project) and PlatformIO picks up the firmware root correctly.

The PlatformIO IDE extension provides build/upload/monitor buttons. Everything
below also works from a plain terminal.

## Build

```bash
pio run                              # the default environment (CH32V006F8P6)
pio run -e CH32V006K8U6              # one specific part
pio run -t clean
pio check                            # cppcheck over src/, lib/ and include/
```

Nothing to install first: `platformio.ini` pins the platform by **git URL**
(`Community-PIO-CH32V/platform-ch32v`), so PlatformIO fetches it on the first build. It is
pinned that way because the platform is **not in the PlatformIO registry** — `platform = ch32v`
only ever resolved on a machine where it had been installed by hand, which meant a generated
project could not build on a clean one.

### Environments

| Environment    | Board file            | Part            | Notes |
|---|---|---|---|
| `CH32V006F8P6` | `genericCH32V006F8P6` | CH32V006 TSSOP20 | default; matches `data/mcus/CH32V006.yaml`'s own `default_package` |
| `CH32V006K8U6` | `genericCH32V006K8U6` | CH32V006 QFN32   | the widest V006 pinout |
| `CH32V005F6P6` | `genericCH32V005F6P6` | CH32V005 TSSOP20 | `data/mcus/CH32V005.yaml` (inherits CH32V006) |
| `CH32X035G8U6` | `genericCH32X035G8U6` | CH32X035        | the second family. `data/mcus/CH32X035.yaml` landed in round 4 and its generated C compiles — `tests/codegen_compile.test.js` |

Flash size, RAM size, core, `-march`/`-mabi` and the 48 MHz HSI+PLL clock setup
all come from the platform's board JSON. This project does not restate them.

## Flash and debug

```bash
pio run -t upload            # WCH-Link, the board files' default protocol
pio device monitor
pio debug                    # OpenOCD (tool-openocd-riscv-wch) + GDB
```

`printf()` goes over the WCH-Link SDI debug channel (`-D SDI_PRINT=1` in
`platformio.ini`), which claims **no pin**. Routing it to USART1 instead would
silently occupy PD5 and fight whatever the configurator put there. To switch,
set `-D SDI_PRINT=0 -D DEBUG=DEBUG_UART1_NoRemap` and accept the pin cost.

## Using the configurator's output

`lib/wchcube_generated/` is a drop zone for `wchcube_init.c/.h`. From the
repository root:

```bash
node tools/wchcube_cli.js CH32V006 --package TSSOP20 --format c \
     --out data/firmware/lib/wchcube_generated/src
mv data/firmware/lib/wchcube_generated/src/wchcube_init.h \
   data/firmware/lib/wchcube_generated/include/
```

`src/main.c` picks it up through `__has_include` and calls `WCHCube_Init()`.
Nothing needs editing. With the drop zone empty the firmware still builds and
says so at startup: `config : none - nothing generated yet`.

Its contents are `.gitignore`d — machine output, regenerated per configuration,
and not something two agents should be resolving a diff over.

**As of 2026-09-11 the generated C for CH32V006 does not compile cleanly against
this SDK.** Two names in the MCU file's `codegen:` block do not exist for this
part; see `lib/wchcube_generated/README.md` and `../../PROGRESS.md`.

## What this firmware does today

Honestly, all of it:

- brings the board up — `SystemCoreClockUpdate()`, `Delay_Init()`, SDI printf
- applies the configurator's output **if** something has been generated
- prints the board identity and the clock tree read back from RCC
- ticks every `APP_TICK_MS`, toggling a user LED **if** one has been declared

There is no peripheral driver here yet, and nothing pretends there is. The parts
targeted are bare chips, not named dev boards with published schematics, so
`lib/board` declares no LED, no button and no UART pin map — see the comment at
the top of `lib/board/include/board.h` for how to declare your own.

## Layout

See `ARCHITECTURE.md` for the layering rules, the ownership table and the
integration points. In short:

```
platformio.ini              build configuration; all per-part facts come from board JSON
include/app_config.h        build-time switches (the sdkconfig role)
src/main.c                  application layer — no registers, no pins
lib/board/                  what is physically wired. Every line needs a source.
lib/wch_hal/                thin wrappers over the vendor SPL
lib/util/                   hardware-free helpers, host-buildable
lib/wchcube_generated/      drop zone for configurator output (machine-owned)
test/                       PlatformIO unit tests
```
