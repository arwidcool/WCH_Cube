# Firmware architecture

An SDK-style layout for the firmware under `data/firmware/`, using the structural
ideas of the Espressif SDK ecosystem — NONOS SDK's hard `driver / app / include`
split and ESP-IDF's *components* — mapped onto PlatformIO and the WCH EVT
NoneOS SDK.

**What is borrowed is the shape, not the API.** No `system_os_task`, no
`esp_err_t`, no event loop, no `sdkconfig` generator. Those belong to a different
chip and a different SDK, and importing their names would be exactly the kind of
invention this repository's rules forbid. What is borrowed is the discipline:
every piece of code sits in exactly one layer, a layer may only call downwards,
and hardware facts live in one place.

## Layers

```
+--------------------------------------------------------------+
|  Application            src/                                 |   what the product does
+--------------------------------------------------------------+
|  Components             lib/<name>/                          |   reusable, one concern each
|   - lib/board              what is physically wired          |
|   - lib/wchcube_generated  the configurator's output         |
|   - lib/util               hardware-free helpers             |
+--------------------------------------------------------------+
|  HAL                    lib/wch_hal/                         |   thin wrappers over the SPL
+--------------------------------------------------------------+
|  Vendor SDK             framework-wch-noneos-sdk (external)  |   WCH EVT StdPeriph - READ ONLY
+--------------------------------------------------------------+
|  Silicon                CH32V006 / CH32V005 / CH32X035       |
+--------------------------------------------------------------+
```

| Layer | Espressif analogue | Here | Rule |
|---|---|---|---|
| Application | `main/` (IDF), `app/user/` (NONOS) | `src/main.c` | May call components and the HAL. **May not touch a register or name a pin.** |
| Components | `components/<name>/` | `lib/<name>/` | One concern each. Public surface is `include/`; everything else is private to `src/`. |
| Board support | board configs | `lib/board/` | Every line is a claim about physical hardware and needs a source. No source, no line. |
| HAL / drivers | `components/driver/`, NONOS `driver/` | `lib/wch_hal/` | Wraps the vendor SPL. Adds no policy, knows nothing about the board. |
| Vendor SDK | ESP ROM + SDK libs | `framework-wch-noneos-sdk` | External, installed by PlatformIO, never edited or vendored into this repo. |
| Configuration | `sdkconfig.h` | `include/app_config.h` + `platformio.ini` | Every compile-time switch named, defaulted and documented in one file. Overridden via `build_flags`, not by editing. |
| Generated | — | `lib/wchcube_generated/` | Machine-owned. Never hand-edited, contents `.gitignore`d. |

### Why a component is a PlatformIO library

Each `lib/<name>/` has a `library.json` naming its `dependencies`. That is not
decoration: it is the dependency graph, enforced by the build. `lib/util` cannot
accidentally start calling the SPL, because it does not depend on `wch_hal` and
its `library.json` declares no framework — it compiles for the host too, which is
what makes it unit-testable off-target.

All components are listed in `lib_deps` so that every one of them is compiled on
every build, even one the application does not include yet. A component that only
builds when somebody happens to `#include` it is a component that rots. It is
also what makes `lib/wchcube_generated` work at all: the LDF does not evaluate
`__has_include`, so the optional include in `main.c` would never be discovered on
its own.

## Integration points

These are the seams. Changing one is a cross-agent event and belongs on the
board; changing anything else is local.

| Seam | Contract | Who writes it | Who reads it |
|---|---|---|---|
| `wchcube_init.h` | `WCHCube_Init()`, `WCHCube_RCC_Init()`, `WCHCube_GPIO_Init()` | `app/engine/codegen.js` | `src/main.c` |
| `data/mcus/*.yaml` `codegen:` | SPL macro and header names for the part | DATA agent | `codegen.js`, and ultimately this compiler |
| `board.h` | `board_init()`, `board_name()`, `board_has_led()`, `board_led_*()` | board owner | application |
| `wch_hal*.h` | GPIO and clock readback | HAL owner | board, components, generated code |
| `app_config.h` | every `APP_*` build switch | application owner | application |
| `platformio.ini` `[env:*]` | which parts exist as build targets | whoever adds a part | everyone |

### Two clock owners

Worth knowing before debugging a wrong baud rate. The system clock is set up
**twice**, in this order:

1. **Build time → startup.** The board file's `build.clock_source` and
   `build.f_cpu` become a `SYSCLK_FREQ_*` macro (the platform's
   `builder/frameworks/common_clk_config.py`), and the SDK's `SystemInit()`
   applies it before `main()` runs. For every environment here that is
   **48 MHz from HSI+PLL**.
2. **Run time → generated code.** If `wchcube_init.c` is present,
   `WCHCube_Init()` runs from `main()` and writes `RCC->CFGR0` with whatever the
   configurator's Clock tab says. That is the later write, so it wins.

So a project configured for 24 MHz HSI boots at 48 MHz and then drops to 24 MHz.
`SystemCoreClockUpdate()` is called again straight after, so `Delay_Ms()` and
`SystemCoreClock` stay honest. The generated code deliberately writes only mux
and prescaler fields — starting HSE or the PLL and waiting for lock stays with
`SystemInit()`.

## MCU EVT sources — the authority rule

WCH ships an **EVT** package per part: the Standard Peripheral Library sources,
headers, startup files, linker scripts and examples that define what the silicon
actually offers. EVT sources **will be provided for each MCU** in this
repository, under `../sources/<PART>/Evt/`. The folders exist and are empty
today (`../sources/V006/Evt/`, `../sources/X035/Evt/`).

When they land they are **authoritative** for anything the code has to name:

- register and bitfield names, and the header they live in
- SPL function names, init-struct fields and enum members
- startup code, vector table order, linker script symbols
- what a peripheral supports on **this** part, as opposed to its family

Precedence, highest first: **EVT sources → Reference Manual → Datasheet →
anything else.** Where EVT and the RM disagree, EVT describes what the SDK will
compile and the RM describes what the silicon does — record the contradiction, do
not average it.

**Both EVT packages have now landed** — `data/sources/V006/Evt/` (988 files) and
`data/sources/X035/Evt/` (2 239 files), each with `EXAM/SRC/Peripheral/{inc,src}`
and a worked example per peripheral. Anything that needs a NAME is checked
against those, and `tools/verify_sdk_names.py` does it mechanically.

The SDK PlatformIO installs, `~/.platformio/packages/framework-wch-noneos-sdk`,
is what the build actually LINKS against, and it is a packaged copy of the same
vendor code — but it is not the same bytes and it is not the authority. The V006
drop carries StdPeriph sub-version `0x05` against the package's `0x04` and
supersedes two macro values (`GPIO_Remap_LSI_CAL` `0x00200080` → `0x001A3000`,
`FLASH_FLAG_OPTERR` `0x00000001` → `0x80000001`). Where they differ, the drop
wins for what a name IS; the package decides what compiles today.

**Nothing is assumed that these sources do not support.** Not an API, not a
peripheral, not a register behaviour, not a startup detail. The concrete cost of
guessing is already on the record: `GPIO_Speed_2MHz/10MHz/50MHz` is the
CH32V10x/20x/30x spelling and does not exist on CH32V006, whose GPIO has one
speed because `GPIOx_CFGLR.MODEy` is a single bit.

## Working on this concurrently

Component boundaries are also ownership boundaries. Two agents in different
directories do not conflict.

| Area | Files | Typical owner |
|---|---|---|
| Application | `src/`, `include/app_config.h` | APP |
| HAL | `lib/wch_hal/` | HAL |
| Board support | `lib/board/` | BOARD |
| Shared utilities | `lib/util/` | whoever adds one; additive only |
| Generated | `lib/wchcube_generated/` | nobody — the configurator writes it |
| Build configuration | `platformio.ini` | shared; see below |
| Tests | `test/` | QA |

Rules that keep it that way:

1. **Add a file rather than widen one.** A new driver is
   `lib/<thing>/{include,src}` plus a `library.json`, not a new function in
   `main.c`. Two new components never conflict; two edits to `main.c` do.
2. **`platformio.ini` is shared, so touch it narrowly.** Adding an `[env:*]`
   block or a `build_flags` line to your own environment is additive. Reordering
   it, reflowing it, or "tidying" `[env]` is a conflict for everyone.
3. **Interfaces are stable and explicit.** Changing a signature in an `include/`
   header is the cross-agent event; changing the `src/` behind it is not.
4. **No repo-wide reformatting.** Not the SDK's files, not someone else's
   component. A whitespace pass across `lib/` is the single most expensive thing
   anyone can do here.
5. **Never edit `lib/wchcube_generated/`.** Regenerate.
6. **Never vendor the SDK into this repo.** It is a PlatformIO package. Pin it in
   `platformio.ini` if a version ever needs pinning.
