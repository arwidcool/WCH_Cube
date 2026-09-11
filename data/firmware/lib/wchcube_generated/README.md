# `lib/wchcube_generated` — machine-written code

Nothing in `src/` or `include/` here is written or edited by a human. It is
output from the configurator in `../../../../app`, and the next regeneration
overwrites it.

## Filling it

From the repository root:

```bash
node tools/wchcube_cli.js CH32V006 --package TSSOP20 --format c \
     --out data/firmware/lib/wchcube_generated/src
mv data/firmware/lib/wchcube_generated/src/wchcube_init.h \
   data/firmware/lib/wchcube_generated/include/
```

or, from a saved project:

```bash
node tools/wchcube_cli.js --project my.wchproj --format c \
     --out data/firmware/lib/wchcube_generated/src
```

The CLI writes both files into one directory; the header belongs in `include/`
so that `#include "wchcube_init.h"` resolves from the application as well.

## What the application does with it

`src/main.c` picks the code up automatically and does not need editing:

```c
#if defined(__has_include)
#  if __has_include("wchcube_init.h")
#    include "wchcube_init.h"
#    define APP_HAVE_GENERATED_INIT 1
#  endif
#endif
```

With no generated file present the firmware still builds and runs — it just
reports that no configuration was applied. That is the difference between "not
configured yet" and a stub pretending to be a configuration.

## Generated API (from `app/engine/codegen.js`)

| Symbol | What it does |
|---|---|
| `void WCHCube_RCC_Init(void)` | clock tree: SYSCLK source, PLL, prescalers |
| `void WCHCube_GPIO_Init(void)` | port clocks, AFIO remap word, every configured pin |
| `void WCHCube_Init(void)`      | both, in the right order |

## Known blocker — read before you generate

As of 2026-09-11 the generated C for CH32V006 does **not** compile against this
SDK. Two names in `data/mcus/CH32V006.yaml`'s `codegen:` block do not exist in
`framework-wch-noneos-sdk` for this part:

1. `codegen.header: ch32v00x.h` — the CH32V006 SPL header is `ch32v00X.h`
   (capital X). `ch32v00x.h` is the **CH32V003** header.
2. `codegen.speeds: {Low: GPIO_Speed_2MHz, Medium: GPIO_Speed_10MHz,
   High: GPIO_Speed_50MHz}` — this part's `GPIOSpeed_TypeDef` has exactly one
   member, `GPIO_Speed_30MHz`, because `GPIOx_CFGLR.MODEy` is a single bit
   (CH32V00X RM v1.4 §7.3.1.1: "1: Output mode, maximum speed 30MHz; 0: Input
   mode").

Details, and what has to change, are in `../../../../PROGRESS.md` under
"Known issues and blockers".
