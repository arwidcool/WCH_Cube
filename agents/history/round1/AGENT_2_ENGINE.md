# AGENT-2 — ENGINE. You own the JS logic: model, conflict engine, clock maths, save/load, exports, codegen.

Read `agents/README.md` first and follow the work cycle exactly. You never stop to ask; you decide and log.

## Mission
The engine must be correct, tested, and independent of the DOM. Pin conflicts are the #1 feature: any
situation where two things want one physical pin must be detected, explained, and surfaced to the UI
through `E.conflicts` / `E.issues` — including shorted pin pairs, remap side-effects, package switches,
and defaults-after-reset (SWIO, RST).

## Priorities (in order)
1. Split the engine out of `app/template.html` into `app/engine/model.js`, `engine.js`, `clock.js`,
   `project.js`, `export.js` (ES modules, no DOM access). `build.py` inlines them so `dist/index.html`
   stays single-file. Keep the public API the UI already uses (`compute`, `assignSignal`, `resetPin`,
   `requiredSignals`, `isAvailable`, `clockCalc`, state shape `S`, result shape `E`).
2. `app/tests/` with `node tests/run.js` (plain Node asserts, jsdom only where DOM is unavoidable). Port the
   scenarios already exercised in this session: remap collisions, shorted pins, per-package reset pin,
   QFN12 availability, clock min/max. Every bug you fix gets a test first.
3. Project save/load: `.wchproj` YAML = { mcu, package, periph settings+remaps, manual pins, gpio settings,
   labels, clock }. Round-trip test.
4. Undo/redo (command stack over `S`).
5. Exports behind the Generate button: pin table (MD + CSV, sorted by pin number, with conflicts marked),
   clock summary (MD). Then C codegen: GPIO init, AFIO_PCFR1 value from remap indices, RCC_CFGR0 from
   clock state. Output style = WCH EVT SDK (`GPIO_InitTypeDef`, `RCC_*` calls). Syntax-check in tests.
6. Support `inherits:` in MCU files (agree semantics with AGENT-1 on BOARD): child overrides/deletes keys.

## Interface contract with AGENT-3 (UI)
- UI never mutates `S` directly except through your exported functions.
- Any new field you add to `E` gets a one-line BOARD `HANDOFF(→AGENT-3)` describing it.

## Cycle 3 priorities (your original brief is complete — this is the new list)
1. Adopt AGENT-3's `runHistory()` request (10:51Z): one undo/redo implementation for keyboard and buttons.
2. `tools/wchcube_cli.js` — headless: load MCU (+ optional `.wchproj`), print pin table / clocks / emit C to
   stdout or files. CI will diff its output. You proposed it; build it.
3. `params:` support as soon as AGENT-1's schema lands in `data/FORMAT.md` (build against a stub in
   `app/assets/params.stub.yaml` meanwhile): `S.periph[pid].params`, validation against min/max/options,
   `.wchproj` round-trip, undo, `getParams(pid)` / `setParam(pid, name, value)`. First consumer: USART BRR
   maths in `clock.js` → actual baud + error %.
4. Codegen: when `codegen:` and `analog_signals` land, the CH32V006 output must have no TODO sections; a
   real (non-dummy) part without a `codegen:` block gets `#error`, not a TODO.
5. `build.py`: refuse to emit a bundle with a duplicate top-level declaration (AGENT-4 01:35Z).

## When idle
- Fuzz test: random assignments across every MCU × package must never throw and must keep `E` consistent
  (every conflict pin has ≥2 owners; every `set` pin has exactly 1).
- Performance: `compute()` under 5 ms for a 144-pin part.

## Current
**Cycle 3 complete**, plus two backlog items and every open request answered. 240 tests green.

| Cycle 3 item | State |
|---|---|
| 1. Adopt AGENT-3's runHistory() | done — one implementation for keyboard and buttons, covered by `app/tests/glue.test.js` |
| 2. `tools/wchcube_cli.js` | done — MCU or .wchproj in, pin table / clocks / C / JSON out, exit 0-1-2 |
| 3. `params:` support | done — against AGENT-1's real schema, 35 parameters live on CH32V006 |
| 4. Codegen with no TODOs | done — V006 and V005 generate clean; a real part without `codegen:` now `#error`s |
| 5. build.py duplicate guard | done — it has already caught two real collisions, mine and the UI's |

Also this cycle
- `tools/validate_mcu.py` resolves `mcu.inherits` (CH32V005 was turning main red).
- `.wchproj` carries `PROJECT_FORMAT` with a `MIGRATIONS` table; a file from a newer
  build is refused by name instead of half applied.
- Derived readouts next to the parameters: `usartBaud()` (BRR, achievable rate, error %),
  `timerFrequency()`, `adcConversionUs()`.
- AGENT-1's two requests: `codegen.rcc.prescalers.<name>` may be a LIST of slices, so the
  V00x ADC divider can span ADCPRE[4:0] and ADC_CLK_MODE at bit 31; and `depends_on` can
  compare (`gt/gte/lt/lte/ne/in`), which the I2C duty-cycle dependency needed.

The engine, 12 modules, no DOM anywhere
`util` · `inherit` · `history` · `model` · `params` · `clock` · `resources` · `engine` ·
`project` · `codegen` · `export` · `index`.

Blocked on others, not on me
- Nothing. The `codegen:` and `params:` data both landed; the compile check still needs CI
  (no gcc here) and that is item 1 in `agents/HUMAN_TODO.md`.

Next from `agents/BACKLOG.md`
1. Project diff: two `.wchproj` in, the pins and settings that differ out.
2. KiCad symbol pin CSV, and a Markdown list of used peripherals with their pins.
3. `params:` for the remaining peripherals as AGENT-1 lands them.
