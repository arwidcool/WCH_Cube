# Round 5 — an analog pad configured as `GPIO_Mode_AF_PP`

**Date:** 2026-09-12 · **By:** AGENT-3 · **Found by:** extending the CH32H417 fixture (P2 of the
coverage brief) to claim pads the coverage ledger made reachable.

The brief said: *"the CH32L103 and CH32H417 fixtures should claim pads that were unreachable
before the ledger (… on CH32H417 an OPA input and a DAC output, and the USB pads the day they
land), so the compile gate proves the newly modelled pads generate C that builds. A default
configuration proves nothing."*

The pads were claimed, the C built — **and the C is electrically wrong.** This file is the record,
because the gate that found it can only say "a TODO kind was not tracked".

## What was configured

`tests/fixtures/CH32H417_QFN128_full.wchproj`, built by `node tests/fixtures/make_fixtures.js`:

```js
eng.setSetting('OPA', 'OPA1 positive input', 'P0');    // -> PB0
eng.setSetting('OPA', 'OPA1 negative input', 'N0');    // -> PB1
eng.setSetting('OPA', 'OPA1 output', 'OUT0');          // -> PC4
eng.setSetting('DAC', 'Channel 1', 'Output on pin');   // -> PA4
```

All four signals were unreachable in the app before the coverage ledger: `OPA` offered
`Disable`/`Enabled` per unit with no P/N/OUT selection, and `DAC`'s row named no signal.

## What the generator emitted

`node tools/wchcube_cli.js --project tests/fixtures/CH32H417_QFN128_full.wchproj --format c`

```c
    /* PB0 — OPA_P01 */
    /* PB1 — OPA_N01 */
    GPIO_InitStructure.GPIO_Pin = GPIO_Pin_0 | GPIO_Pin_1 | GPIO_Pin_7 | GPIO_Pin_8 | GPIO_Pin_15;
    GPIO_InitStructure.GPIO_Mode = GPIO_Mode_AF_PP;     /* ← the defect */
    GPIO_InitStructure.GPIO_Speed = GPIO_Speed_Low;
    GPIO_Init(GPIOB, &GPIO_InitStructure);
```

…and beside it, for the same four pads:

```c
    /* TODO: alternate function select. These signals have a pin but the MCU file
       states no `af:` for it, and this generator does not guess an AF code:
         PA4: DAC_OUT1
         PB0: OPA_P01
         PB1: OPA_N01
         PC4: OPA_OUT01
       Add `af:` to the signal_pins entry and generate again. */
```

Two separate problems, one cause.

## The cause

`app/engine/constraints.js:255`:

```js
export function analogClaim(claim, pin) {
  const table = ((M && M.codegen) || {}).analog_signals || {};
  const listed = table[claim.who];
  if (listed) return { analog: listed.includes(bare), inferred: false };
  const P = (M.peripherals || {})[claim.who];
  const guess = !!(P && P.category === 'Analog' && ((M.pins || {})[pin] || {}).analog);
  return { analog: guess, inferred: guess };
}
```

`gpioEffectiveMode()` asks this first — *stored value, then an analog function, then any
peripheral's alternate function, then manual, then Input* — so a claim that fails the analog test
falls through to AF.

On CH32H417 **both** paths fail:

| Path | Needs | CH32H417 |
|---|---|---|
| primary | `codegen.analog_signals` | **absent** — the only shipped part without it (CH32V003, CH32V005, CH32V006 and CH32L103 all declare it) |
| fallback | `pins.<PIN>.analog` | **absent** — the file header records this as a declared gap: *"the DS's own 'I/O characteristic' column carries more — FT for 5 V tolerance, A for analog — and it is NOT extracted yet, so `analog:` and `five_volt_tolerant:` are absent rather than guessed"* |

So `analogClaim` returns `false` for a pad whose only function is analog, and the generator does
the reasonable thing with the information it has: it treats the pad as an alternate function.

**The second problem follows from the first.** `afPlan().missing` collects claimed signals with no
`af:`, and emits *"Add `af:` to the signal_pins entry"*. For an analog pad there is no AF code to
add — the pad is selected by `GPIO_Mode_AIN`, which is a **mode**, not a mux field. The advice is
unfollowable, which makes it worse than silence.

## Why no gate caught it, and what now does

Every existing gate passed, and correctly:

* the C **compiles** — `GPIO_Mode_AF_PP` is a valid macro for this part, so `codegen_compile`
  builds it;
* `validate_mcu.py` warns rather than errors about the missing `af:` (145 such warnings on
  CH32H417, all correct: *"codegen will not guess an AF code"*);
* the coverage ledger checks that a function the DS puts on a pin is **routed** — PA4, PB0, PB1 and
  PC4 are routed, and claimed, and reachable. It does not ask what *mode* the pad ends up in.

What did catch it was P2's own instruction: *claim pads that were unreachable before the ledger*.
Nothing had ever configured an analog pad on this part, so the defect had no way to appear. **The
fixture extension is the test.**

The TODO is now in `tests/codegen_compile.test.js`'s `TRACKED_TODOS` with a `TASKS.md` line, which
makes the gate green and names the gap rather than hiding it — and the entry says in its own words
that this is **not** a cosmetic TODO, because excusing a wrong-but-compiling emission without
saying so is exactly how it survives.

## Who fixes what

| Half | Owner | Fix |
|---|---|---|
| the pad is configured `AF_PP` instead of `AIN` | **AGENT-1** (`data/mcus/**`) | declare `codegen.analog_signals` for CH32H417 (`ADC1`, `ADC2`, `HSADC`, `DAC`, `OPA`, `CMP`), which is the authoritative list and needs no `pins:` flag |
| the TODO tells the reader to add an unfollowable `af:` | **AGENT-2** (`app/engine/**`) | a claimed signal on a pad that is analog has no AF to select; the message should say that instead of asking for a code that does not exist |

Neither half is mine to edit, so both are board requests. The alternative — leaving the fixture
without the analog claims — would restore a green suite by removing the only configuration that
shows the defect, which is the trade this repository exists to refuse.
