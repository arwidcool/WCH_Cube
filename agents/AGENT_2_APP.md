# AGENT-2 — APP, round 6

Owns `app/engine/**`, `app/template.html`, `app/tests/**`, `app/assets/**`, `build.py`,
`tools/wchcube_cli.js`. Must not edit `data/`, `tests/`, `src-tauri/`.

Read `README.md` first and follow the work cycle exactly. You never stop to ask; you decide and
log. Round 6's brief is `PROJECT.md`. Your round-5 "Current" is in `history/round5/AGENT_2_APP.md`
if you need what you were in the middle of — it had two Current sections; this file has one.

## The rule you consume, and the rule you must not break

Round 5's: *every choice the app offers must be one the silicon can honour.* The data says what
the silicon allows; the engine refuses what it does not; and **a computed number that is wrong
is worse than a missing one.** Every new clock tap this round ships with the number it computes
checked against the RM's worked example, or it does not ship.

## P0 — Deliverable D: the clock schema holds a second PLL and a per-peripheral source mux

Today `clock.pll` is one object and `clock.prescalers` has one `source:` per tap. CH32H417 has
FIVE PLLs (RM 3.3.4: SYS, USBHS 480 MHz, ETH 500 MHz, USBSS 125 MHz, SerDes) and eight
peripheral clock muxes (RM 3.4.13, `RCC_CFGR2`: RNG, I2S2, I2S3, USBFS 48M, LTDC, UHSIF, HSADC,
ETH1G), each choosing between PLL_CLK, a secondary PLL and SYSCLK, several through their own
1..64 divider. They are absent by declaration, `sysclk.sources` lists three of the seven
SYSPLL_SEL allows, and the app computes nothing for the USB 48 MHz, LTDC pixel or ETH clocks.

The deliverable is the schema, and **it must not name a part**:

1. `clock.plls:` — a map of named PLLs, each with `inputs:`, `multipliers:`, optional
   `dividers:`, and an output name other taps can cite. `clock.pll` stays as the alias for the
   SYS PLL so five parts do not change.
2. A tap whose `source:` is a *list* is a mux: the clock tab draws a `<select>`, `clockCalc()`
   computes from the chosen one, the `.wchproj` round-trips it, undo/redo covers it.
3. `sysclk.sources` may name a secondary PLL's output.
4. `data/FORMAT.md` gets the block, `validate_mcu.py` gets the checks (post the REQUEST to
   AGENT-1 with the shape, they own the validator), `tests/clock_ui.test.js` gets the sweep — it
   now runs on five parts and has planted breaks; the new controls join them.

AGENT-1 fills H417's data the cycle the schema lands. Between you, the acceptance is one
number on the clock tab: **USBFS 48 MHz computed from USBHS_PLL / 10**, matching RM 3.4.13.

## P1 — Deliverable E: the per-instance init struct

One struct, filled once per instance, applied by a call that takes the instance:
`LTDC_LayerInit(LTDC_Layerx, &s)`, `TIM_OC1Init..TIM_OC4Init`, `OPA_CMP_Init` branching on
`CMP_NUM`. Parked since round 4 as E2 (`channel_params.channels`). `const:` (yours, landed) is
half of it — the member fixed by which instance this is. The other half is the emitter: N
copies of the struct block, one `sdk_calls[n]` each, gated on the instance being enabled.

First consumers, in order: the rest of `LTDC_Layer_InitTypeDef` (window, size, alpha, blending,
address — the pixel format shipped this round as a *comment* precisely because this did not
exist), then CH32L103's CMP1–3 (unblocks AGENT-1's last 12 rows), then TIM PWM channels on
every part. `--strict` stays exit 0 throughout: a struct the emitter cannot fill is a TODO, and
a TODO fails the gate.

## P2 — carried, small, and two comments that lie

- **`USART_ClockInit` in codegen** — CH32V003's last 3 rows are USART1_CK, and the emitter has
  no path for `USART_ClockInitTypeDef`. Same shape as any second struct on one peripheral.
- **`app/tests/engine.test.js:253`** cites `agents/AGENT_2_ENGINE.md`, a file that was merged
  into this one in round 5. Comment only; fix the pointer.
- **`app/template.html:2092-2094`** says LTDC's `paramRows()` is empty "so the tab would not
  appear". It has two rows now. The reasoning about `instanceGroups` is still right; the example
  is stale.
- **`sdk_none:`'s emitted prefix** — `"the SDK exposes nothing for it"` is wrong for the LTDC
  pixel format, where the SDK exposes a setter that is unsafe at init. The `sdk_note:` corrects
  it in the same sentence today; a `sdk_manual:` key that emits `"set by firmware: <note>"`
  would say the true thing. Low priority, additive.

## When idle

`BACKLOG.md` APP section. Then read `codegen.js` end to end for an assumption that only holds
for the parts that existed when it was written — CH32H417 is the first with AF-muxed pins,
two cores, and a 24-bit-wide port, and each of those has already found one.

## Authority

Add tests anywhere. Change what the generator emits only with a fixture that compiles it
(`node tools/wchcube_cli.js --project tests/fixtures/<f>.wchproj --new-project <tmp> && pio run`)
and say which in the commit. Verify UI in a real browser and write "verified in browser".
Never edit `dist/index.html` or `data/firmware/lib/wchcube_generated/`.

## Current

*(Rewrite every cycle: what landed, what is red and who owns it, the number - for D, which
taps compute and what they compute; for E, which consumers emit.)*

**Cycle 2, 2026-09-12T20:54Z. HUMAN-REQUESTED OUTPUT: `BoardPins.h`, and a scope that produces
it alone. Plus the tree/ETH/tooltip work below.**

`BoardPins.h` — the pin map as a C header, so somebody who already has a project drops one file
in and writes `BOARD_USART1_TX` instead of `GPIO_Pin_9`. `pinMap()` in `app/engine/export.js`
builds it from `E.pins[].claims` (which function is on which pad), `signalAf()` (the AF code) and
`S.gpio[].label` (the user's own names) — nothing derived from a peripheral's name, nothing
guessed. Per entry: `_PORT`, `_PIN`, and `_AF` **only where the data states one**, which is the
same refusal `afPlan()` makes. A label is sanitised to an identifier (`Status Led!` →
`BOARD_STATUS_LED`).

Two generator options, both auto-rendered by the Project Manager from `generatorOptions()`:
- `pin_map` (default on) — add the header to a generated project, under
  `lib/wchcube_generated/include/` so `#include "BoardPins.h"` resolves like `wchcube_init.h`.
- `pin_map_only` (default off) — **output the header alone**. It returns before `pioTarget()`
  is asked, so it works on a package with NO PlatformIO board (QSOP24, QFN12 on CH32V006),
  where the full project cannot be generated at all. That is exactly the user it is for.

**The collision rule is the interesting part.** Two different pads wanting one macro name is a
`#define` that silently keeps the last one and compiles — so on a clash **neither is emitted**,
the clash is returned in `pinMap().collisions`, and the file carries a `COLLISION (not emitted)`
comment. A build that uses the name then fails to compile, which is the loud failure. Emitting
the first would have been the quiet-wrong outcome this project exists to prevent.

CLI: `--format pins-h`, and `--option pin_map_only=1` for the scope. 9 new tests — 8 in
`app/tests/pinmap.test.js` plus one in `app/tests/cli.test.js`. Verified in a real browser: both
options render, the file list goes 9 files → 4 when the scope is on, and the sentence under
Generate changes from "the whole project" to "the pin map" (it said "whole project" at 4 files
until I fixed it).

Also this cycle, on the same tree:
- **The peripheral tree is sorted.** Within each heading, alphabetically with the instance
  number read as a NUMBER (`TIM2` before `TIM10`), and same-type adjacent — the file's own order
  had `USART1-3` at the top and `USART4-8` a dozen rows down. GPIO/NVIC stay pinned to the top
  of System Core because they are synthetic entries, not peripherals. 4 tests in
  `app/tests/tree.test.js`; plant run and confirmed. FINDING on the board: CH32L103 files its
  system peripherals under THREE headings (`System Core`, `System`, `Watchdog`) where every
  other part uses one, and `CAT_ORDER` knows neither of the extras.
- **ETH on CH32H417**: the built-in PHY is now an Interface choice and MII/RMII are gone —
  `RMII` appears ZERO times in that datasheet and `MII` only inside `RGMII`. Verified structurally
  against HEAD before committing: 78 peripherals in both, 0 signals/pins/remaps/settings lost.
- **`app/tests/layout.test.js`** — a gate hole, reported to QA: `legibility.test.js` excuses
  `overflow:auto`, so a `#mode` grid five times too wide passed four gates green. The new guard
  asks whether a grid's own columns exceed its box, and whether every child landed in a column.

**Cycle 1, 2026-09-12T19:38Z. D IS DONE AS SCHEMA; E IS NEXT AND HAS NOT STARTED.**

What landed
- `clock.plls:` - a map of named PLLs. Each has `inputs: [{name, source, div}]` and either
  `multipliers:` (plus optional `dividers:`) or a fixed `output_mhz:`, which is what H417's
  USBHS_PLL, ETH_PLL and USBSS_PLL actually are - 480 / 500 / 125 MHz whatever the input,
  so a `multipliers:` list would have been an invented number. `output:` is the name other
  taps, other PLLs and `sysclk.sources` cite. `clock.pll` is still the SYS PLL; a file that
  writes it as `plls.PLL` is read identically.
- A tap whose `source:` is a LIST is a mux: a `<select>` on the tab, `S.clock.preSrc[<tap>]`
  in state, refused by `setClock()` if it is not in the list, one undo step, round-trips.
- PLLs and taps resolve in DEPENDENCY order, not file order (a PLL may take another PLL's
  output; a mux may point at a tap declared later). A cycle resolves to 0 rather than hanging.
- `sysclk.sources` may name a PLL output, and `hseFeedsSysclk()` now WALKS the PLL chain, so
  a crystal reaching SYSCLK through a second PLL still switches the RCC setting on.
- Optional, additive: prescaler `default:` / `default_source:`; PLL `min_mhz`/`max_mhz`/
  `target_mhz`. Both exist so a default is a cited decision rather than list order.
- `codegen.rcc.extra:` - a list of further register words (H417 needs CFGR0 + CFGR2 +
  PLLCFGR2), built by the same `put()` the primary word uses, with `sources:` and `plls:`
  field specs beside `prescalers:`. And when a mux or a secondary PLL has NO encoding, the
  generated C says so by name; it used to print the whole tree in a comment and write nothing.
- P2's two stale comments (`engine.test.js:253`, `template.html` CTABS) fixed.

The number
- **USBHS_PLL 480 MHz -> USBFS /10 = 48.0 MHz**, RM 3.4.13's own worked example
  (CH32H417RM.md:4048 USBFSSRC=1, :4055-4067 USBFSDIV=0111 "Divided by 10"), read off the clock
  tab in Chrome on `dist/index.html`: light and dark, 1280 and 1920 wide, 100 % and 125 %
  zoom, console empty at all eight, box green rather than red. On a SYNTHETIC part
  (`inherits: CH32V006` + that shape) because the schema must not name a part and `data/`
  is AGENT-1's.
- Which taps compute today on a SHIPPED part: none new. CH32H417 still declares no `plls:`
  and no list `source:`, so USB / LTDC / ETH compute nothing there. That is the REQUEST on
  the board (19:38Z), with the block and a RM line per field; the tab prints the number the
  cycle the YAML lands, and I will re-read it in a browser then rather than assume it.
- At 1280 px and 125 % zoom (1024 CSS px) a SIX-column tree is 1087 px in a 980 px panel and
  `.ctreescroll` scrolls - measured, `scrollLeft` reaches the last box, body does not scroll
  horizontally. That is the documented floor (`SCALE_MIN`), not round 2's finding L2; every
  shipped five-column part still measures 977 / 980 and scrolls not at all.

Red, and who owns it
- Nothing of mine. Suite ALL GREEN, 747 tests, 0 skipped, after `python build.py`.
- `tests/codegen_compile.test.js`'s fixture-freshness check went red mid-cycle under the
  uncommitted `data/mcus/CH32H417.yaml`, NOT under any app change - proved by reverting my
  four files to HEAD and watching it stay red. Someone regenerated; it is green again.
  Filed as a FINDING to AGENT-1 on the board.
- Blocked on AGENT-1 for `data/FORMAT.md`, `validate_mcu.py` and the H417 block (three
  validator errors named in the request). Blocked on AGENT-3 for the `tests/clock_ui.test.js`
  sweep. Neither blocks E.

Next cycle: **P1 / deliverable E, the per-instance init struct** - the emitter half. N copies
of the struct block, one `sdk_calls[n]` each, gated on the instance being enabled. First
consumer is the rest of `LTDC_Layer_InitTypeDef`, then CH32L103's CMP1-3 (AGENT-1's last 12
coverage rows wait on it), then TIM PWM channels. `--strict` stays exit 0 throughout.
