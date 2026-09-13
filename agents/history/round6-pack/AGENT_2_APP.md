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

**Cycle 2, 2026-09-12T21:14Z. D IS DONE. E's MECHANISM IS DONE; ALL THREE OF ITS CONSUMERS
ARE DATA AND ARE WITH AGENT-1, EACH WITH THE BLOCK WRITTEN OUT.**

D - the clock schema (cycle 1, commit `13b948a`)
- `clock.plls:` (a map of named PLLs, `multipliers:` or a fixed `output_mhz:`, an `output:`
  other taps cite), a list-valued `source:` as a mux, `sysclk.sources` naming a PLL output,
  PLL-to-PLL inputs resolved in dependency order, `codegen.rcc.extra:` for further register
  words, and a named gap in the C for any mux or PLL the file does not encode.
- **The number: USBHS_PLL 480 MHz -> USBFS /10 = 48.0 MHz**, RM 3.4.13 (CH32H417RM.md:4048
  USBFSSRC=1, :4055-4067 USBFSDIV=0111). Read in Chrome on `dist/index.html`: light and dark,
  1280 and 1920 wide, 100 % and 125 % zoom, console empty at all eight, green not red.
- **Which taps compute on a SHIPPED part: still none new.** CH32H417 declares no `plls:` and
  no list `source:`, so USB / LTDC / ETH compute nothing there yet. The block, with a RM line
  per field, is the REQUEST on the board at 19:38Z, along with the three errors
  `validate_mcu.py` raises on it today. I read the number off the real part the cycle it lands.

E - the per-instance init struct (commit `096daa6`)
- **The mechanism is complete and covered**: one struct filled per instance, applied by a call
  that takes the instance, with the FUNCTION and the HANDLE varying independently
  (`TIM_OC1Init..OC4Init` keep the peripheral's handle; `LTDC_LayerInit(LTDC_Layer1, &s)` keeps
  the function). 16 tests in `app/tests/instances.test.js`, each with its failing half.
- **Which consumers emit: none yet, and the reason is measured rather than asserted.** All
  eight shipped `channel_params` blocks (TIM1/TIM2 on V003, V005, V006, X035) carry a complete
  `sdk_calls:` table and no `channels:` map, so picking `Channel1 = PWM Generation CH1` and
  typing a pulse of 500 produces a time base, a note, and **no `TIM_OCxInit`**. Honest, and
  still configuration that does not reach the C.
- I generated the eight `channels:` maps from each part's own settings, applied the CH32V006
  one to a derived part and read the C: `TIM_OC1Init(TIM1, &TIM_OCInitStructure)` with
  `TIM_Pulse = 500`, nothing for the input-capture channel, nothing for the two at Disable,
  note gone, no TODO. The block is proved before it is asked for; it is on the board at 20:59Z
  with LTDC's `instances:` shape and CMP's `CMP_NUM` row beside it.
- A test asserts all eight are **still silent**, so it goes red the day one lands and cannot
  outlive the gap it records.

P2, and two things that were not mine but were red
- `USART_ClockInit`: the blocker is gone and nobody had noticed. A struct all of whose params
  carry a `when:` is already emitted on the gate and not otherwise (`TWO_STRUCTS` in
  `app/tests/codegen.test.js`, both ways). CH32V003's USART1_CK is pure data now; told AGENT-1.
- `paramReachWarnings()` counted a `const:` member and the inapplicable half of a dependent
  pair as "the user changed it", and `--strict` exits 2 on a warning - so a disabled ADC1 on
  CH32H417 failed the gate. Fixed with the table's own two predicates, both clauses seen RED
  on a planted break (`6645e38`). AGENT-1's `default:` mirrors are theirs to strip; told them.
- Two `app/tests/export.test.js` tests enumerating the exact output list and option list were
  red on main after `BoardPins.h` landed without them. Updated, and each now moves one switch
  at a time so a list that changed for two reasons cannot still look right (`724334d`).
- The two stale comments (`engine.test.js:253`, `template.html` CTABS) fixed in cycle 1.

Red, and who owns it
- Nothing. Full suite ALL GREEN, 775 tests, 0 skipped, after `python build.py` on a settled
  tree. `validate_mcu` 0 errors, `verify_sdk_names` 0, `coverage --gate` 6 of 6.
- The only failures seen this cycle came from the shared tree: another agent rebuilding
  `dist/index.html` mid-run, which the runner itself prints a note about. Each was green when
  re-run alone. AGENT-1 recorded the matching hazard from my side - a half-saved engine module
  takes everyone's CLI down, because `tools/wchcube_cli.js` reads `app/engine/*` off disk.
  Write the import before the body that uses it.

Next cycle: read the board first (AGENT-1 may land the H417 clock block or a `channels:` map,
and either is a number I read in a browser the same cycle). Then `BACKLOG.md`'s APP section,
and the standing idle task: `codegen.js` end to end for an assumption that only holds for the
parts that existed when it was written.
