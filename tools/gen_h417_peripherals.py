#!/usr/bin/env python3
"""Assemble CH32H417's complete `peripherals:` block.

    python tools/gen_h417_peripherals.py             # emit every peripheral
    python tools/gen_h417_peripherals.py --list      # names only
    python tools/gen_h417_peripherals.py --missing   # what the MCU file has yet

Why this exists
---------------
CH32H417 has ~50 peripheral instances across 47 RM chapters and 41 SPL headers. The
per-pin AF map is 950 assignments. Hand-transcribing any of that is how this repository
got `ch32v00x.h` and `GPIO_Mode_Out_OD`: plausible, wrong, and invisible until a compiler
or a board disagreed. So the pin data is taken from `tools/extract_h417_pins.py`
(AGENT-4's parser, which reads DS Table 2-1-1 and re-derives every assignment) and the
peripheral list is taken from the SPL headers the vendor ships, which is the authority
for what the software can *name*.

What is in here and what is not
-------------------------------
* `signal_pins` — MECHANICAL, from the AF parser. Every pin/af pair is the datasheet's.
* `settings` — hand-authored per peripheral TYPE from the reference manual's functional
  description. They are the mode/choice structure the pin grid needs to exist at all.
* `params` — deliberately NOT generated. A parameter needs its init-struct field and its
  option macros checked against that part's own header (`tools/verify_sdk_names.py` does
  that check), and inventing them wholesale would put names nobody compiled into data/.
  The peripherals that already have them keep them; the rest say so in `notes:`.

`EXTRA` below therefore states, per peripheral, what the RM chapter gives and what is
still missing, so a reader can tell "not done" from "deliberately absent".
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PINS = ROOT / "tools" / "extract_h417_pins.py"
MCU = ROOT / "data" / "mcus" / "CH32H417.yaml"

# The generated section's opening line, used to find and REPLACE it on --refresh.
MARK_START = "\n  # " + "=" * 73 + "\n  #  Everything below this line was GENERATED"


# {package: {every pin name that package bonds}}, filled by af_map() from the same parse.
# The ordering pass below needs it: "the default" is the first option BONDED on the
# package being drawn, so an option nothing bonds is not a default anywhere.
BONDED: dict[str, set[str]] = {}


def _claim_groups(pid: str, sigs: dict) -> list[set[str]]:
    """The signal sets that are ever claimed AT ONCE, from the peripheral's own settings.

    Two signals collide only if some choice turns both on. `FMC_A5` and `FMC_D20` share a
    pad and never share a configuration - the address bus and the data bus are separate
    rows - so pulling them apart buys nothing and costs a pad that another address line
    needed. A `type: checkboxes` row is different: every box is independently tickable, so
    the whole row is one group. A signal no choice names falls back to a group of its own.
    """
    settings = MODES.get(pid) or (SETTINGS.get(TYPE_OF.get(pid) or "") or [])
    short = {(s[len(pid) + 1:] if s.startswith(pid + "_") else s): s for s in sigs}
    groups: list[set[str]] = []
    for row in settings:
        if row.get("type") == "checkboxes":
            whole = {short[x] for c in row.get("choices") or []
                     for x in (c.get("signals") or []) if x in short}
            if len(whole) > 1:
                groups.append(whole)
            continue
        for c in row.get("choices") or []:
            g = {short[x] for x in (c.get("signals") or []) if x in short}
            if len(g) > 1:
                groups.append(g)
    return groups


def order_defaults(merged: dict[str, dict[str, list]]) -> int:
    """Order each signal's pin list so the DEFAULTS of one configuration do not collide.

    `defaultSignalPin()` in the engine takes the FIRST option bonded on the package, so the
    order of `signal_pins:` is not cosmetic - it decides what a user gets by switching a
    peripheral on and touching nothing else. Emitted in datasheet order, four LTDC signals
    shared a default pad with another LTDC signal on every package (PA8 was R6 and B3, PA15
    R3 and CLK, PA6 G2 and HSYNC, PA10 B1 and B4), and `tests/h417_packages.test.js` found
    dozens more across DVP, FMC, I2C4, PIOC, SDIO, UHSIF and USART6. The conflict engine
    cannot report any of them: it compares the OWNERS of two claims, and here both claims
    belong to the same peripheral. One pad drives one bit, so each is a configuration the
    silicon cannot honour, reached by doing nothing.

    The lists were hand-reordered once, in the generator's OUTPUT, and the next `--refresh`
    threw all of it away. That is the reason this lives here.

    Greedy, and deliberately not clever: within each group of signals some choice turns on
    together, the ones with the fewest options choose first - they have the least room to
    move - and each then prefers a pad no earlier signal of that group has taken, breaking
    ties towards the pad the most packages bond and then towards datasheet order. It cannot
    always win: a signal whose only bonded pad on QFN68 is already taken has nowhere to go,
    and that is silicon, not data. It returns how many it could not place, and the ratchet
    in `tests/h417_packages.test.js` is what holds the number down.
    """
    if not BONDED:
        return 0
    # THE DEBUG PADS ARE ALREADY SPOKEN FOR. SYS routes SWCLK/SWIO to PB8/PB9 and holds
    # them out of reset - DS Table 2-1-1 spells the rows `SWCLK/USBHS_DP/...` and
    # `SWIO/SWDIO/USBHS_DM/...`, with no AF code, because the reset multiplexer selects
    # them. So a signal whose default lands on PB9 costs the user their debug port for
    # switching a peripheral on, and PB9 was the single most common casualty: DVP_D7,
    # FMC_A4, FMC_DQM2, I2C4_SDA, LTDC_B7, PIOC_IO1 and SDIO_D5 all defaulted onto it.
    # Seeded as taken everywhere, so every other signal steps around them where it can.
    reserved = {pin for sigs in (SUPPLEMENT.get("SYS") or {}).values()
                for pin, _af, _note in sigs}
    stuck = 0
    for pid in sorted(merged):
        sigs = merged[pid]
        groups = _claim_groups(pid, sigs) or [set(sigs)]
        seed = set() if pid == "SYS" else reserved
        taken: dict[tuple[str, int], set[str]] = {
            (pk, gi): set(seed) for pk in BONDED for gi in range(len(groups))}
        # A SECOND, WEAKER preference: distinct across the WHOLE peripheral. Two rows of
        # one peripheral are both live at once - LTDC's `Colour depth` and `Sync and
        # clock` are separate rows and a panel needs both - so R2 and HSYNC sharing a pad
        # is just as unbuildable as two colour lines sharing one, even though no single
        # choice names them together. It is a TIEBREAK, not a rule: forcing every signal
        # of FMC apart would spend pads on pairs (an address line and a data line) that no
        # configuration ever turns on together, and take them from pairs that do.
        wide: dict[str, set[str]] = {pk: set(seed) for pk in BONDED}
        members: dict[str, list[int]] = {}
        for i, g in enumerate(groups):
            for sig in g:
                members.setdefault(sig, []).append(i)
        for sig in sorted(sigs, key=lambda x: (len(sigs[x]), x)):
            gs = members.get(sig) or []
            opts = list(sigs[sig])
            if len(opts) > 1:
                pos = {e[0]: i for i, e in enumerate(opts)}

                def rank(e):
                    pin = e[0]
                    clash = sum(1 for pk, bond in BONDED.items() for gi in gs
                                if pin in bond and pin in taken.get((pk, gi), ()))
                    also = sum(1 for pk, bond in BONDED.items()
                               if pin in bond and pin in wide[pk])
                    width = sum(1 for pk, bond in BONDED.items() if pin in bond)
                    return (clash, also, -width, pos[pin])

                opts.sort(key=rank)
                sigs[sig] = opts
            for pk, bond in BONDED.items():
                d = next((e[0] for e in opts if e[0] in bond), None)
                if d is None:
                    continue
                wide[pk].add(d)
                for gi in gs:
                    if d in taken.setdefault((pk, gi), set()):
                        taken[(pk, gi)].add(d)
                    taken[(pk, gi)].add(d)
        stuck += _repair(sigs, groups, members, seed)
    return stuck


def _cost(sigs: dict, groups: list, members: dict, seed: set) -> tuple[int, int]:
    """(collisions inside a single choice, collisions anywhere in the peripheral).

    Both counted on every package, because "the default" is per package. The first number
    is the one `tests/h417_packages.test.js` sweeps - a configuration a user reaches by
    switching one row on - and the second is the weaker one two live rows can still
    produce (LTDC's colour depth and its sync row). Lexicographic, so a repair never buys
    a same-peripheral pair at the price of a same-choice one.
    """
    grp = wide = 0
    order = sorted(sigs)
    for bond in BONDED.values():
        seen_wide = set(seed)
        seen_g: dict[int, set[str]] = {gi: set(seed) for gi in range(len(groups))}
        for sig in order:
            d = next((e[0] for e in sigs[sig] if e[0] in bond), None)
            if d is None:
                continue
            if d in seen_wide:
                wide += 1
            seen_wide.add(d)
            for gi in members.get(sig, ()):
                if d in seen_g[gi]:
                    grp += 1
                seen_g[gi].add(d)
    return grp, wide


def _repair(sigs: dict, groups: list, members: dict, seed: set, rounds: int = 6) -> int:
    """Hill-climb the greedy's result: move one option to the front of one list and keep
    the move only if it strictly lowers the cost.

    The greedy is order-dependent - a signal that takes a pad early can be the only reason
    a later one has nowhere to go - and one pass cannot see that. This does: it tries each
    alternative of each signal, in a fixed order, and stops when no single move helps.
    Deterministic, so the generated file is stable across runs.
    """
    if not BONDED:
        return 0
    best = _cost(sigs, groups, members, seed)
    for _ in range(rounds):
        if best == (0, 0):
            break
        moved = False
        for sig in sorted(sigs):
            opts = sigs[sig]
            if len(opts) < 2:
                continue
            for i in range(1, len(opts)):
                trial = [opts[i]] + opts[:i] + opts[i + 1:]
                sigs[sig] = trial
                c = _cost(sigs, groups, members, seed)
                if c < best:
                    best, moved, opts = c, True, trial
                else:
                    sigs[sig] = opts
        if not moved:
            break
    return best[0] + best[1]


def af_map() -> dict[str, dict[str, list[tuple[str, int, str | None]]]]:
    """{peripheral: {signal: [(pin, af, note), ...]}} from the AF parser, via its JSON.

    The note is None except where one pin carries two AF codes for the same signal, which
    happens exactly once on this part (`QSPI2_SIO0` is reachable on PF8 through AF4 *and*
    AF8 - DS Table 2-1-1 lists both on one row). Both are legal; `signal_pins:` is keyed
    by pin, so the second entry would be dead, and the note is how the alternative
    survives in the data instead of being dropped.
    """
    out = pathlib.Path(os.environ.get("TEMP", "/tmp")) / "h417_af.json"
    subprocess.run([sys.executable, str(PINS), "--json", str(out)], check=True,
                   stdout=subprocess.DEVNULL)
    doc = json.loads(out.read_text(encoding="utf-8"))
    BONDED.clear()
    for pk, table in (doc.get("packages") or {}).items():
        BONDED[pk] = {n for names in table.values() for n in names}
    groups: dict[str, dict[str, list[tuple[str, int, str | None]]]] = collections.defaultdict(dict)
    for sig, opts in doc["signals"].items():
        sig = SIGNAL_FIX.get(sig, sig)
        g = sig.split("_")[0]
        bypin: dict[str, list[int]] = collections.defaultdict(list)
        for pin, af in opts:
            bypin[pin].append(int(af[2:]))
        entries: list[tuple[str, int, str | None]] = []
        for pin, afs in bypin.items():
            first, rest = afs[0], afs[1:]
            note = None
            if rest:
                note = ("DS Table 2-1-1 gives this pin " + " and ".join(f"AF{a}" for a in afs)
                        + " for this signal; `signal_pins:` takes one AF code per pin, so "
                        + f"AF{first} is used and AF" + "/AF".join(str(a) for a in rest)
                        + " also work here")
            entries.append((pin, first, note))
        # UNION, never replace. `SIGNAL_FIX` maps two parsed names onto one, so the second
        # of them arrives at a key that already holds the first - and `groups[g][sig] =
        # entries` would throw the first one away. That is exactly the mistake `MERGE` made
        # once already (see the note below), and it is invisible: the survivors look like a
        # complete signal. It cost `CS_N0` three of its four pads on the first attempt.
        bucket = groups[g].setdefault(sig, [])
        for pin, af, note in entries:
            if not any(p == pin and a == af for p, a, _ in bucket):
                bucket.append((pin, af, note))
    return groups


# ---------------------------------------------------------------- DS group -> peripheral
#
# Some DS groups are the same peripheral under two headings, and merging them wrongly
# splits a peripheral in the UART tree - and worse, splits its pins across two entries so
# neither can see a conflict on them.
#
# **This map was WRONG until 2026-09-12, and in a way worth recording.** It used to carry
# `VP: USBHS`, `C4: USBPD`, `DC: USBPD` and `DIO: USBPD` as well. Those keys did not name
# real headings: they were FRAGMENTS of signal names that Table 2-1-1's PDF conversion had
# split across a line break (`D VP_D0`, `I2 C4_SMBA`, `LT DC_G5`, `S DIO_D0`). The broken
# parse produced signal names like `VP_D0` and grouped them under a peripheral called `VP`,
# and this map then filed those under USBHS - so **DVP pins were being attributed to the
# USB controller**. Repairing the split (`extract_h417_pins.py`, `repair_split_names`)
# removed the phantom groups, and this map is now what it always claimed to be: a list of
# real DS headings that mean one peripheral.
#
# `check_merge_keys()` below fails the generator if a key here is not a heading the DS
# actually uses, so a dead entry cannot sit here looking load-bearing again.
MERGE = {
    "RGMII": "ETH",        # the RGMII pins of the same MAC (RM ch.31)
    "SDRAM": "FMC",        # the SDRAM controller is FMC's bank (RM ch.40)
    "FSMC": "FMC",         # the SPL header is ch32h417_fmc.h, so FMC is the name the SDK uses
    "CC1": "USBPD",        # Type-C CC lines (RM ch.24)
    "CC2": "USBPD",
    "MCO": "RCC",          # the clock output is RCC's, not a peripheral of its own
    # The DS spells the CAN pins `CAN_RX`/`CAN_TX` (no instance number) on the rows where
    # the controller is the first one - PA13 says `CAN_RX(AF5)` and PA14 `CAN_TX(AF5)`, and
    # DS Table 2-2-13 attributes both to CAN1. Leaving this unmapped dropped those two
    # assignments entirely: the file's CAN1_RX/CAN1_TX were short a pin each, and PA13/PA14
    # showed no CAN function at all. Found by `tools/audit_h417_af.py`.
    "CAN": "CAN1",
}
# Headings dropped outright - not a peripheral and not a signal of one. Empty today.
# `MCO` used to be in here AND in MERGE above, and this check runs first, so the clock
# output was discarded instead of being merged into RCC: DS Table 2-1-1 and Table 2-2-30
# both put `MCO(AF0)` on PB0 and the file offered four MCO sources with no pin behind any
# of them. A heading that belongs to another peripheral goes in MERGE; this set is for a
# heading that belongs to nothing.
NOT_A_PERIPHERAL: set[str] = set()

# The datasheet's own spelling slips in Table 2-1-1, normalised to what it MEANS.
#
# `SDRAM_CS_NO` - with a letter O - appears exactly ONCE in the whole source markdown, on
# PC2's row. Table 2-2-15, the independent signal-first reading, says:
#
#     SDRAM_CS_N0   PC2(AF12), PC4(AF12), PD6(AF3), PE3(AF9)
#
# One chip select, four pads. Read literally the file ended up with TWO signals for it -
# `CS_N0` carrying PC4/PD6/PE3 and `CS_NO` carrying PC2 - so the SDRAM chip select was
# split in half and the engine would report no conflict between two names for one wire.
# That is the same failure the remap-suffix defect caused on SDMMC, from a different cause.
#
# There is no `CS_O` in the datasheet and no SDRAM signal spelled that way, so this is a
# typo and not a second signal. Keyed by the parsed name, applied before grouping.
SIGNAL_FIX = {
    "SDRAM_CS_NO": "SDRAM_CS_N0",
    # PC6 is the I2S master clock. Table 2-1-1 writes it `SPI2_MCK(AF5)` and Table 2-2-8
    # writes it `I2S2_MCK PC6(AF5), PB5(AF8)` - one pad, two spellings, and SPI has no
    # master-clock output at all (RM ch.23: MCK belongs to the I2S mode of the block). Left
    # as parsed it created a signal `SPI2_MCK` that no SPI2 setting claims, and left I2S2's
    # MCK a one-pin signal where the datasheet gives it two.
    "SPI2_MCK": "I2S2_MCK",
}

# Which tree section each peripheral appears under. Matches the categories the other four
# parts use, so the UI needs no new heading.
CATEGORY = {
    "SYS": "System Core", "RCC": "System Core", "DMA1": "System Core",
    "DMA2": "System Core", "EXTI": "System Core", "PWR": "System Core",
    "FLASH": "System Core", "IWDG": "System Core", "WWDG": "System Core",
    "DBGMCU": "System Core", "HSEM": "System Core", "IPC": "System Core",
    "CRC": "System Core", "ECDC": "System Core",
    "USART1": "Connectivity", "USART2": "Connectivity", "USART3": "Connectivity",
    "USART4": "Connectivity", "USART5": "Connectivity", "USART6": "Connectivity",
    "USART7": "Connectivity", "USART8": "Connectivity",
    "SPI1": "Connectivity", "SPI2": "Connectivity", "SPI3": "Connectivity",
    "SPI4": "Connectivity", "I2S2": "Connectivity", "I2S3": "Connectivity",
    "I2C1": "Connectivity", "I2C2": "Connectivity", "I2C3": "Connectivity",
    "I2C4": "Connectivity", "I3C": "Connectivity",
    "CAN1": "Connectivity", "CAN2": "Connectivity", "CAN3": "Connectivity",
    "USBHS": "Connectivity", "USBFS": "Connectivity", "USBSS": "Connectivity",
    "USBPD": "Connectivity", "ETH": "Connectivity", "SDIO": "Connectivity",
    "SDMMC": "Connectivity", "QSPI1": "Connectivity", "QSPI2": "Connectivity",
    "SWPMI": "Connectivity", "PIOC": "Connectivity", "SERDES": "Connectivity",
    "UHSIF": "Connectivity", "IPC_CH": "System Core",
    "TIM1": "Timers", "TIM2": "Timers", "TIM3": "Timers", "TIM4": "Timers",
    "TIM5": "Timers", "TIM8": "Timers", "TIM9": "Timers", "TIM10": "Timers",
    "TIM11": "Timers", "TIM12": "Timers", "LPTIM1": "Timers", "LPTIM2": "Timers",
    "TIM6": "Timers", "TIM7": "Timers", "RTC": "Timers", "IWDG": "System Core", "WWDG": "System Core",
    "ADC1": "Analog", "ADC2": "Analog", "HSADC": "Analog", "DAC": "Analog",
    "OPA": "Analog", "CMP": "Analog", "DFSDM": "Analog", "TKEY": "Analog",
    "FSMC": "Memory", "FMC": "Memory", "GPHA": "Graphics", "LTDC": "Graphics",
    "DVP": "Graphics", "SAI": "Audio", "RNG": "Security",
}

# The mode/choice structure, per peripheral TYPE. Only the choices the reference manual
# names; a peripheral with no entry gets `signal_pins` and nothing else, which the UI
# renders as a pin grid with no mode row rather than as a peripheral that looks broken.
SETTINGS: dict[str, list[dict]] = {
    # ---- serial, same shape as the USART1-3 already in the file
    "USART": [{
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "Asynchronous", "signals": ["TX", "RX"]},
            {"name": "Synchronous", "signals": ["TX", "RX", "CK"]},
            {"name": "Single Wire (Half-Duplex)", "signals": ["TX"]},
            {"name": "Transmit only", "signals": ["TX"]},
            {"name": "Receive only", "signals": ["RX"]},
            {"name": "LIN", "signals": ["TX", "RX"]},
        ],
    }, {
        "name": "Hardware Flow Control",
        "choices": [
            {"name": "Disable"},
            {"name": "CTS only", "signals": ["CTS"]},
            {"name": "RTS only", "signals": ["RTS"]},
            {"name": "CTS/RTS", "signals": ["CTS", "RTS"]},
        ],
    }],
    "SPI": [{
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "Full-Duplex Master", "signals": ["SCK", "MISO", "MOSI"]},
            {"name": "Full-Duplex Slave", "signals": ["SCK", "MISO", "MOSI"]},
            {"name": "Half-Duplex Master", "signals": ["SCK", "MOSI"]},
            {"name": "Half-Duplex Slave", "signals": ["SCK", "MOSI"]},
            {"name": "Receive only Master", "signals": ["SCK", "MISO"]},
            {"name": "Transmit only Master", "signals": ["SCK", "MOSI"]},
        ],
    }, {
        "name": "Hardware NSS Signal",
        "choices": [
            {"name": "Disable (software NSS)"},
            {"name": "Hardware NSS Input", "signals": ["NSS"]},
            {"name": "Hardware NSS Output", "signals": ["NSS"]},
        ],
    }],
    "I2C": [{
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "I2C", "signals": ["SCL", "SDA"]},
            # DS Table 2-2-6 gives EVERY I2C instance an SMBA pad - I2C3_SMBA on PA9/PA15
            # and I2C4_SMBA on PD11/PF11/PB5/PB9 - so all four support SMBus. The two
            # hand-written blocks above already offered this; the generated I2C3/I2C4 did
            # not, which left their SMBA pads unreachable.
            {"name": "SMBus", "signals": ["SCL", "SDA", "SMBA"]},
        ],
    }],
    "TIM_ADV": [{
        "name": "Channel1",
        "choices": [
            {"name": "Disable"},
            {"name": "Input Capture", "signals": ["CH1"]},
            {"name": "PWM Generation CH1", "signals": ["CH1"]},
            {"name": "PWM Generation CH1 CH1N", "signals": ["CH1", "CH1N"]},
            {"name": "Output Compare CH1", "signals": ["CH1"]},
        ],
    }, {
        "name": "Channel2",
        "choices": [
            {"name": "Disable"},
            {"name": "Input Capture", "signals": ["CH2"]},
            {"name": "PWM Generation CH2", "signals": ["CH2"]},
            {"name": "PWM Generation CH2 CH2N", "signals": ["CH2", "CH2N"]},
            {"name": "Output Compare CH2", "signals": ["CH2"]},
        ],
    }, {
        "name": "Channel3",
        "choices": [
            {"name": "Disable"},
            {"name": "Input Capture", "signals": ["CH3"]},
            {"name": "PWM Generation CH3", "signals": ["CH3"]},
            {"name": "PWM Generation CH3 CH3N", "signals": ["CH3", "CH3N"]},
            {"name": "Output Compare CH3", "signals": ["CH3"]},
        ],
    }, {
        "name": "Channel4",
        "choices": [
            {"name": "Disable"},
            {"name": "Input Capture", "signals": ["CH4"]},
            {"name": "PWM Generation CH4", "signals": ["CH4"]},
            {"name": "Output Compare CH4", "signals": ["CH4"]},
        ],
    }, {
        # DS Table 2-2-4 gives TIM8 a second break input, and only TIM8 has one - this
        # template is used by TIM8 alone, because TIM1 is one of the hand-written blocks
        # kept in the file. `emit_peripheral()` now fails the generator if a choice names
        # a signal the peripheral does not route, so a future TIM_ADV instance without a
        # BKIN2 cannot silently inherit this row.
        "name": "Break Input",
        "choices": [
            {"name": "Disable"},
            {"name": "Break Input enabled", "signals": ["BKIN"]},
            {"name": "Break Input 2 enabled", "signals": ["BKIN2"]},
            {"name": "Break Input + Break Input 2", "signals": ["BKIN", "BKIN2"]},
        ],
    }, {
        "name": "ETR",
        "choices": [
            {"name": "Disable"},
            {"name": "External clock mode 2", "signals": ["ETR"]},
        ],
    }],
    "TIM_GP": [{
        "name": "Channel1",
        "choices": [
            {"name": "Disable"},
            {"name": "Input Capture", "signals": ["CH1"]},
            {"name": "PWM Generation CH1", "signals": ["CH1"]},
            {"name": "Output Compare CH1", "signals": ["CH1"]},
        ],
    }, {
        "name": "Channel2",
        "choices": [
            {"name": "Disable"},
            {"name": "Input Capture", "signals": ["CH2"]},
            {"name": "PWM Generation CH2", "signals": ["CH2"]},
            {"name": "Output Compare CH2", "signals": ["CH2"]},
        ],
    }, {
        "name": "Channel3",
        "choices": [
            {"name": "Disable"},
            {"name": "Input Capture", "signals": ["CH3"]},
            {"name": "PWM Generation CH3", "signals": ["CH3"]},
            {"name": "Output Compare CH3", "signals": ["CH3"]},
        ],
    }, {
        "name": "Channel4",
        "choices": [
            {"name": "Disable"},
            {"name": "Input Capture", "signals": ["CH4"]},
            {"name": "PWM Generation CH4", "signals": ["CH4"]},
            {"name": "Output Compare CH4", "signals": ["CH4"]},
        ],
    }, {
        "name": "ETR",
        "choices": [
            {"name": "Disable"},
            {"name": "External clock mode 2", "signals": ["ETR"]},
        ],
    }],
    "CAN": [{
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "Normal", "signals": ["TX", "RX"]},
            {"name": "Loopback", "signals": ["TX", "RX"]},
            {"name": "Silent", "signals": ["TX", "RX"]},
            {"name": "Loopback and Silent", "signals": ["TX", "RX"]},
        ],
    }],
    "QSPI": [{
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "Single-SPI", "signals": ["SCK", "SCSN", "SIO0", "SIO1"]},
            {"name": "Dual-SPI", "signals": ["SCK", "SCSN", "SIO0", "SIO1"]},
            {"name": "Quad-SPI", "signals": ["SCK", "SCSN", "SIO0", "SIO1", "SIO2", "SIO3"]},
        ],
    }, {
        # DS Table 2-2-25 gives both QSPIs a `SCSXN` (the active-low chip select) and four
        # extra IOs `SIOX0..SIOX3` on top of SCK/SCSN/SIO0..SIO3. Neither was reachable, so
        # ten pads across the two controllers could never be assigned.
        "name": "Extended signals",
        "type": "checkboxes",
        "choices": [
            {"name": "SCSXN (active-low chip select)", "signals": ["SCSXN"]},
            {"name": "SIOX0", "signals": ["SIOX0"]},
            {"name": "SIOX1", "signals": ["SIOX1"]},
            {"name": "SIOX2", "signals": ["SIOX2"]},
            {"name": "SIOX3", "signals": ["SIOX3"]},
        ],
    }],
    "SDIO": [{
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "SD 1-bit", "signals": ["CK", "CMD", "D0"]},
            {"name": "SD 4-bit", "signals": ["CK", "CMD", "D0", "D1", "D2", "D3"]},
            {"name": "SD 8-bit", "signals": ["CK", "CMD", "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"]},
        ],
    }],
    "ETH": [{
        # THE BUILT-IN PHY IS THE ORDINARY OPTION, AND MII/RMII WERE INVENTED. This row is
        # AGENT-4's, commit 9a502ae, and it is HERE rather than in the MCU file because it
        # was written straight into the generated block, where the next `--splice
        # --refresh` reverted it - which is what happened on 2026-09-13 before it was moved.
        # The generator's loss guard caught the notes and the four pads that came with it
        # but not the settings, because `_losses()` does not compare choice lists.
        #
        # The reasoning, kept from that commit: CH32H417DS0.md 1.4.31 - "MAC and 100M PHY
        # are fully integrated, and the periphery only needs capacitance" - so the ordinary
        # configuration needs no MAC-to-PHY interface on pins at all, just the four
        # media-dependent pads to the magnetics. Section 1.2 gives "Optional Ethernet
        # controller MAC + external 1Gbps PHY" as the alternative, reached over RGMII.
        # `RMII` appears ZERO times in this datasheet and `MII` only inside `RGMII`, so the
        # two removed choices were a mode the silicon has not got.
        #
        # The four MDI* pads are dedicated pins with no AF code; they reach this generator
        # through data/sources/H417/dedicated_pins.yaml, and they must be CLAIMED here or
        # `validate_mcu.py` calls them dead pads.
        "name": "Interface",
        "choices": [
            {"name": "Disable"},
            {"name": "Internal PHY (built-in 10/100M)",
             "signals": ["MDIRN", "MDIRP", "MDITN", "MDITP"]},
            {"name": "RGMII (external 1Gbps PHY)",
             "signals": ["GTXC", "RXC", "RXD0", "RXD1", "RXD2", "RXD3",
                         "RXDV", "TXD0", "TXD1", "TXD2", "TXD3", "TXEN"]},
        ],
    }, {
        # SMI - MDC and MDIO - is how the controller reaches a PHY's registers, and the DS
        # describes it as the interface used "to configure and manage the external PHYs".
        # So it is a choice of its own rather than bundled into Interface: the internal PHY
        # runs without it, and an external one generally needs it.
        "name": "SMI (serial management interface)",
        "choices": [
            {"name": "Disable"},
            {"name": "MDC + MDIO", "signals": ["MDC", "MDIO"]},
        ],
    }, {
        # DS Table 2-2-24 lists these OUTSIDE the RGMII group: `ETH_PHY_LED0..4` and
        # `ETH_PPS` are optional status/trigger outputs, and none of them was reachable.
        "name": "Status outputs",
        "type": "checkboxes",
        "choices": [
            {"name": "PHY_LED0", "signals": ["PHY_LED0"]},
            {"name": "PHY_LED1", "signals": ["PHY_LED1"]},
            {"name": "PHY_LED2", "signals": ["PHY_LED2"]},
            {"name": "PHY_LED3", "signals": ["PHY_LED3"]},
            {"name": "PHY_LED4", "signals": ["PHY_LED4"]},
            {"name": "PPS (pulse per second)", "signals": ["PPS"]},
        ],
    }],
    "LTDC": [{
        "name": "Colour depth",
        "choices": [
            {"name": "Disable"},
            {"name": "RGB888", "signals": ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7",
                                           "G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
                                           "B0", "B1", "B2", "B3", "B4", "B5", "B6", "B7"]},
            {"name": "RGB666", "signals": ["R2", "R3", "R4", "R5", "R6", "R7",
                                           "G2", "G3", "G4", "G5", "G6", "G7",
                                           "B2", "B3", "B4", "B5", "B6", "B7"]},
            {"name": "RGB565", "signals": ["R3", "R4", "R5", "R6", "R7",
                                           "G2", "G3", "G4", "G5", "G6", "G7",
                                           "B3", "B4", "B5", "B6", "B7"]},
        ],
    }, {
        "name": "Sync and clock",
        "choices": [
            {"name": "Disable"},
            {"name": "Enabled", "signals": ["CLK", "HSYNC", "VSYNC", "DE"]},
        ],
    }, {
        # THE TWO LAYERS, AND THEY CLAIM NO SIGNAL ON PURPOSE. `LTDC_Layer1` and
        # `LTDC_Layer2` (ch32h417.h:1770-1771) are register blocks, not pads: a layer is a
        # rectangle of memory the blender composites onto the SAME parallel RGB port the
        # `Colour depth` row above already wired. So neither choice carries `signals:` -
        # and `emit_peripheral()`'s own guard means a choice naming a signal LTDC does not
        # route would fail the generator rather than reach the file.
        #
        # The rows exist because `channel_params.instances` needs a SETTING to decide
        # whether each instance is live (deliverable E): without them the layer init would
        # be emitted for both layers always, or for neither. One row per layer rather than
        # a single "how many layers" count, because the two are independent - a design may
        # use layer 2 alone, and the blender does not require layer 1.
        "name": "Layer 1",
        "choices": [{"name": "Disable"}, {"name": "Enabled"}],
    }, {
        "name": "Layer 2",
        "choices": [{"name": "Disable"}, {"name": "Enabled"}],
    }],
    "DVP": [{
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "8-bit", "signals": ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7",
                                          "HSYNC", "VSYNC", "PCLK"]},
            {"name": "10-bit", "signals": ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7",
                                           "D8", "D9", "HSYNC", "VSYNC", "PCLK"]},
            # RM 29.4.1, RB_DVP_MSK_DAT_MOD[1:0]: "00: 8-bit mode; 01: 10-bit mode; 1x:
            # 12-bit mode." DS Table 2-2-23 lists DVP_D10 and DVP_D11, which only exist for
            # that third mode - so both pads were unreachable while the mode was missing.
            {"name": "12-bit", "signals": ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7",
                                           "D8", "D9", "D10", "D11",
                                           "HSYNC", "VSYNC", "PCLK"]},
        ],
    }],
    "SAI": [{
        "name": "Block A",
        "choices": [
            {"name": "Disable"},
            {"name": "Asynchronous", "signals": ["FS_A", "SCK_A", "SD_A", "MCLK_A"]},
            {"name": "Synchronous", "signals": ["FS_A", "SCK_A", "SD_A", "MCLK_A"]},
        ],
    }, {
        "name": "Block B",
        "choices": [
            {"name": "Disable"},
            {"name": "Asynchronous", "signals": ["FS_B", "SCK_B", "SD_B", "MCLK_B"]},
            {"name": "Synchronous", "signals": ["FS_B", "SCK_B", "SD_B", "MCLK_B"]},
        ],
    }],
    "SWPMI": [{
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "Single wire", "signals": ["IO"]},
            {"name": "Single wire with supply", "signals": ["IO", "SUP"]},
            {"name": "Loopback", "signals": ["IO", "RX", "TX"]},
        ],
    }],
    "PIOC": [{
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "Programmable IO", "signals": ["IO0", "IO1"]},
        ],
    }],
    "FSMC": [{
        "name": "NOR/PSRAM",
        "choices": [
            {"name": "Disable"},
            {"name": "Enabled", "signals": ["A0", "D0", "NOE", "NWE", "NE1", "NE2", "NE3", "NE4"]},
        ],
    }, {
        "name": "SDRAM",
        "choices": [
            {"name": "Disable"},
            {"name": "Enabled", "signals": ["A0", "D0", "A10", "BA0", "BA1", "SDCLK", "SDCKE0",
                                            "SDNE0", "NRAS", "NCAS", "NWE", "DQM0", "DQM1"]},
        ],
    }],
    "DFSDM": [{
        "name": "Channel 0",
        "choices": [
            {"name": "Disable"},
            {"name": "External clock", "signals": ["CKIN0", "DATIN0"]},
            {"name": "Internal clock", "signals": ["DATIN0"]},
        ],
    }, {
        "name": "Channel 1",
        "choices": [
            {"name": "Disable"},
            {"name": "External clock", "signals": ["CKIN1", "DATIN1"]},
            {"name": "Internal clock", "signals": ["DATIN1"]},
        ],
    }, {
        "name": "Clock output",
        "choices": [
            {"name": "Disable"},
            {"name": "CKOUT enabled", "signals": ["CKOUT"]},
        ],
    }],
    "LPTIM": [{
        "name": "Channel1",
        "choices": [
            {"name": "Disable"},
            {"name": "PWM Generation CH1", "signals": ["CH1"]},
            {"name": "Input Capture CH1", "signals": ["CH1"]},
        ],
    }, {
        "name": "Channel2",
        "choices": [
            {"name": "Disable"},
            {"name": "PWM Generation CH2", "signals": ["CH2"]},
            {"name": "Input Capture CH2", "signals": ["CH2"]},
        ],
    }, {
        # DS Table 2-2-5 gives every LPTIM an `LPTIMn_OC` output on its own pads
        # (LPTIM1_OC on PE1/PD13, LPTIM2_OC on PB13). It is a separate row rather than a
        # channel option because one LPTIM can drive CH1, CH2 and OC at once.
        "name": "Output compare",
        "choices": [
            {"name": "Disable"},
            {"name": "OC", "signals": ["OC"]},
        ],
    }, {
        "name": "ETR",
        "choices": [
            {"name": "Disable"},
            {"name": "External clock", "signals": ["ETR"]},
        ],
    }],
    "I2S": [{
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "Master Transmit", "signals": ["CK", "WS", "SD", "MCK"]},
            {"name": "Master Receive", "signals": ["CK", "WS", "SD", "MCK"]},
            {"name": "Slave Transmit", "signals": ["CK", "WS", "SD"]},
            {"name": "Slave Receive", "signals": ["CK", "WS", "SD"]},
        ],
    }],
    "I3C": [{
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "I3C", "signals": ["SCL", "SDA"]},
            {"name": "I2C", "signals": ["SCL", "SDA"]},
        ],
    }],
    "RTC": [{
        "name": "Wakeup",
        "choices": [
            {"name": "Disable"},
            # The choice existed but named no signal, so the RTC output pad (PC13) could
            # never be claimed - the same shape as the DAC's "Output on pin" with no pin.
            {"name": "Output on RTC pin", "signals": ["RTC"]},
        ],
    }],
    "USBPD": [{
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "Source", "signals": ["CC1", "CC2"]},
            {"name": "Sink", "signals": ["CC1", "CC2"]},
            {"name": "DRP", "signals": ["CC1", "CC2"]},
        ],
    }],
    "SERDES": [{
        # SERDES has differential pads of its own (SSTXA/SSTXB/SSRXA/SSRXB, DS Table
        # 2-1-1) and they carry NO AF code - they are not GPIOs - so nothing in the per-pin
        # AF map names them and `signal_pins:` cannot describe them. The entry exists so the
        # block appears in the tree; its pins are declared in `pins:` as type `sys`.
        "name": "Mode",
        "choices": [
            {"name": "Disable", "default": True},
            {"name": "Enabled"},
        ],
    }],
    # RCC is generated rather than hand-written so a `--refresh` cannot lose it. The HSE
    # choice's name must match `clock.hse_setting` and its signals must cover
    # `clock.hse_signals`, which is what makes picking HSE switch the crystal on through the
    # conflict engine and claim XI/XO on the chip.
    "RCC": [{
        "name": "High Speed Clock (HSE)",
        "choices": [
            {"name": "Disable", "default": True},
            {"name": "BYPASS clock source"},
            {"name": "Crystal / ceramic resonator", "signals": ["XI", "XO"]},
        ],
    }, {
        # RM 3.4.2 MCO[3:0]: 00xx none, 0100 SYSCLK, 0101 HSI, 0110 HSE, 0111 PLL/2,
        # 1000 UTMI, 1001 USBSS_PLL/2, 1010 ETH_PLL/8, 1011 SERDES_PLL/16.
        # Every source drives the SAME pad, PB0(AF0) - DS Table 2-2-30 "MCO Pin Functions"
        # gives the clock output one pin and DS Table 2-1-1's PB0 row says `MCO(AF0)`. The
        # choices carry it so picking a source claims the pin; without `signals:` the row
        # offered four clocks and reserved no pad, and any other peripheral could take PB0
        # out from under it.
        "name": "Master Clock Output (MCO)",
        "choices": [
            {"name": "Disable", "default": True},
            {"name": "SYSCLK", "signals": ["MCO"]}, {"name": "HSI", "signals": ["MCO"]},
            {"name": "HSE", "signals": ["MCO"]}, {"name": "PLLCLK/2", "signals": ["MCO"]},
            {"name": "UTMI clock", "signals": ["MCO"]},
            {"name": "USBSS_PLL/2", "signals": ["MCO"]},
            {"name": "ETH_PLL/8", "signals": ["MCO"]},
            {"name": "SERDES_PLL/16", "signals": ["MCO"]},
        ],
    }, {
        # RM 9.2.11.1 (CH32H417RM.md:11038): "When LSEON=0, the LSE oscillator pin
        # OSC32_IN/OSC32_OUT can be used as PC14/PC15 of GPIO respectively. When LSEON=1,
        # it is used as LSE pin." So the pads are a mode choice exactly like the HSE
        # crystal above, and the row lives on RCC because RCC_BDCTLR.LSEON is the bit that
        # decides it (RM 3.2, :1685). BYPASS feeds the clock in on OSC32_IN alone and
        # suspends OSC32_OUT (RM :1698), so it claims one pad, not two.
        # Same shape as CH32L103's `Low Speed Clock (LSE)`, and it is what makes PC14 and
        # PC15 claimable at all: DS Table 2-1-1 names those two rows `PC14(4)-OSC32_IN`
        # and `PC15(4)-OSC32_OUT`, and nothing in the file answered to either.
        "name": "Low Speed Clock (LSE)",
        "choices": [
            {"name": "Disable", "default": True},
            {"name": "BYPASS clock source", "signals": ["OSC32_IN"]},
            {"name": "Crystal / ceramic resonator", "signals": ["OSC32_IN", "OSC32_OUT"]},
        ],
    }],
}
# Which template a peripheral instance uses when its own name has no entry.
# ---- the four blocks whose signals the AF parser cannot see (see _load_dedicated_pins).
# Their pin lists come from data/sources/H417/dedicated_pins.yaml, so these are the
# CHOICES only - "which options does this block have" is a hardware question.
SETTINGS["DAC"] = [{
    "name": "Channel 1",
    "choices": [{"name": "Disable"}, {"name": "Output on pin", "signals": ["OUT1"]}],
}, {
    "name": "Channel 2",
    "choices": [{"name": "Disable"}, {"name": "Output on pin", "signals": ["OUT2"]}],
}]
SETTINGS["ADC"] = [{
    "name": "Mode",
    "choices": [{"name": "Disable"}, {"name": "Independent"},
                {"name": "Dual (with the other ADC)"}],
}, {
    # EVERY channel DS Table 2-2-1 lists, not the two this file used to offer. Fifteen of
    # the sixteen external channels were unreachable: a pin the user cannot claim is the
    # same defect as the DAC offering "Output on pin" with no pin behind it, and it was
    # worse here because the ADC's whole purpose is choosing channels.
    #
    # Checkboxes, because an ADC scans a SET of channels - and that is the shape CH32V006
    # and CH32X035 already use for this same row. IN16 and IN17 are the two the datasheet
    # gives no pad for ("Temperature sensor" and "Internal reference voltage"), so they
    # carry no `signals:`; CH32V006 writes its own internal channel that way.
    "name": "Channels",
    "type": "checkboxes",
    "choices": ([{"name": f"IN{i}", "signals": [f"IN{i}"]} for i in range(16)]
                + [{"name": "IN16 (temperature sensor, internal)"},
                   {"name": "IN17 (internal reference voltage, internal)"}]),
}]
SETTINGS["HSADC"] = [{
    "name": "Mode",
    "choices": [{"name": "Disable"}, {"name": "Enabled"}],
}, {
    # DS Table 2-2-2 gives seven channels and every one of them is on a pad (PC0-PC3,
    # PF8-PF10), so this is a plain channel list with no internal entries.
    "name": "Channels",
    "type": "checkboxes",
    "choices": [{"name": f"IN{i}", "signals": [f"IN{i}"]} for i in range(7)],
}]


def _opa_settings() -> list[dict]:
    """Three rows per OPA unit, in CH32X035's `Positive input`/`Negative input`/`Output`
    shape. DS Table 2-2-21 gives two pads for each of the three connections per unit:

        OPA1_P PB0/OPA1_P0, PA6/OPA1_P1     OPA1_OUT PC4/OPA1_OUT0, PA5/OPA1_OUT1
        OPA2_P PE9/OPA2_P0, PF11/OPA2_P1    OPA2_OUT PE7/OPA2_OUT0, PB1/OPA2_OUT1
        OPA3_P PC2/OPA3_P0, PA2/OPA3_P1     OPA3_OUT PA0/OPA3_OUT0, PA4/OPA3_OUT1

    The signal names are this file's own (`OPA1_P0` is `P01` - the generator moves the unit
    digit to the end so one flat name space holds all three units), hence `f"{sig}0{n}"`.
    """
    out = []
    for n in (1, 2, 3):
        for what, sig in (("positive input", "P"), ("negative input", "N"),
                          ("output", "OUT")):
            out.append({
                "name": f"OPA{n} {what}",
                "choices": [
                    {"name": "Disable"},
                    {"name": f"{sig}0", "signals": [f"{sig}0{n}"]},
                    {"name": f"{sig}1", "signals": [f"{sig}1{n}"]},
                ],
            })
    return out


SETTINGS["OPA"] = _opa_settings()


def _fmc_settings() -> list[dict]:
    """The FMC's controllers, with the signals each one drives.

    The rows used to say `Disable`/`Enabled` and name NO signals, so all 87 of the FMC's
    pins were unreachable - the entire external-memory bus could not be assigned, which is
    the largest single hole this pass found.

    The grouping is the DATASHEET's, not an invention. Table 2-2-14 is `FSMC Pin
    Functions` and Table 2-2-15 is `SDRAM Pin Functions`, and which signal appears in
    which table decides where it goes: A0..A12, D0..D31 and CLK appear in BOTH, so they are
    the shared bus and get their own rows; A13..A25, NBL0..NBL3, NE1..NE4, NOE, NWE, NWAIT,
    NADV, NCE2 and INT2 appear only in Table 2-2-14; BA0/BA1, CAS_N, CKE0/1, CS_N0/1,
    DQM0..DQM3, RAS_N and WE_N only in Table 2-2-15.

    Every signal is claimed by exactly ONE row. Splitting the shared bus per controller
    would make the engine report a conflict between NOR and SDRAM on A0, which would be
    wrong - they are one bus, which is exactly why the datasheet lists it twice.
    """
    return [
        {"name": "Address bus A0-A25",
         "choices": [{"name": "Disable"},
                     {"name": "Enabled", "signals": [f"A{i}" for i in range(26)]}]},
        {"name": "Data bus D0-D31",
         "choices": [{"name": "Disable"},
                     {"name": "Enabled", "signals": [f"D{i}" for i in range(32)]}]},
        {"name": "Clock",
         "choices": [{"name": "Disable"},
                     {"name": "Enabled", "signals": ["CLK"]}]},
        {"name": "NOR/PSRAM and NAND control (FSMC)",
         "choices": [{"name": "Disable"},
                     {"name": "Enabled",
                      "signals": ["NE1", "NE2", "NE3", "NE4", "NADV",
                                  "NBL0", "NBL1", "NBL2", "NBL3",
                                  "NOE", "NWE", "NWAIT", "NCE2", "INT2"]}]},
        {"name": "SDRAM control",
         "choices": [{"name": "Disable"},
                     {"name": "Enabled",
                      "signals": ["BA0", "BA1", "CAS_N", "RAS_N", "WE_N",
                                  "CKE0", "CKE1", "CS_N0", "CS_N1",
                                  "DQM0", "DQM1", "DQM2", "DQM3"]}]},
    ]


def _serdes_settings() -> list[dict]:
    """The SerDes mode used to claim nothing, leaving its four differential pads stranded.

    DS Table 2-2-20 lists SERDES_TXP/TXN/RXP/RXN on PE3/PE4/PE5/PE6. They carry no AF code
    (the pad's own function), which is why they are in the dedicated-pins file - and then
    nothing referenced them.
    """
    return [{"name": "Mode",
             "choices": [{"name": "Disable"},
                         {"name": "Enabled", "signals": ["TXP", "TXN", "RXP", "RXN"]}]}]


def _uhsif_settings() -> list[dict]:
    """UHSIF's mode used to claim nothing (all 49 ports unreachable), then claimed all 49
    regardless of width - an 8-bit bus took the same 32 data pads a 32-bit bus does,
    pads the design does not use and cannot release. Fixed the same way DVP's data width
    already is (CH32H417.yaml:2541-2546, `Mode: 8-bit/10-bit/12-bit` each naming its own
    `signals:`): width IS the claiming choice, not a second dropdown beside it.

    The function-per-port table (`tools/recover_h417_uhsif_pdf.py`, PDF Table 3-2,
    declared at data/sources/H417/UHSIF_port_functions.yaml) gives the split: CLK plus
    11 control-area ports (PORT3 SEL[0], PORT4 SEL[1], PORT5 AF#, PORT7 AE#, PORT8 EOP#,
    PORT9 WRNF, PORT11 RDNE, PORT12 RD#, PORT13 OE#, PORT14 WR#, PORT15 CS#) are needed
    at every width; PORT16..PORT(16+width-1) are the DATA[0..width-1] bits. PORT0, PORT1,
    PORT2, PORT6 and PORT10 read NC (not connected) in that same table under every
    width - genuinely unused by the shipped library's only documented mapping ("For
    other mappings, please contact technical support", the PDF's own words) - but kept
    CLAIMED here rather than dropped, so `tests/completeness.test.js` never has to carry
    an unclaimable `signal_pins:` row for them and a board that does wire a custom
    mapping still sees them reserved. Board findings 2026-09-13T02:00Z (the over-claim)
    and 2026-09-14 (the recovered table) carry the citations.
    """
    ctrl = ["PORT3", "PORT4", "PORT5", "PORT7", "PORT8", "PORT9",
            "PORT11", "PORT12", "PORT13", "PORT14", "PORT15"]
    aux = ["PORT0", "PORT1", "PORT2", "PORT6", "PORT10"]

    def data_width(n):
        return ["CLK"] + ctrl + aux + [f"PORT{16 + i}" for i in range(n)]

    return [{"name": "Mode",
             "choices": [
                 {"name": "Disable"},
                 {"name": "8-bit",  "signals": data_width(8)},
                 {"name": "16-bit", "signals": data_width(16)},
                 {"name": "24-bit", "signals": data_width(24)},
                 {"name": "32-bit", "signals": data_width(32)},
             ]}]

TYPE_OF = {
    **{f"USART{i}": "USART" for i in range(1, 9)},
    **{f"SPI{i}": "SPI" for i in range(1, 5)},
    **{f"I2C{i}": "I2C" for i in range(1, 5)},
    **{f"TIM{i}": "TIM_GP" for i in (2, 3, 4, 5, 9, 10, 11, 12)},
    **{f"TIM{i}": "TIM_ADV" for i in (1, 8)},
    **{f"CAN{i}": "CAN" for i in range(1, 4)},
    **{f"LPTIM{i}": "LPTIM" for i in (1, 2)},
    **{f"QSPI{i}": "QSPI" for i in (1, 2)},
    **{f"I2S{i}": "I2S" for i in (2, 3)},
    "FSMC": "FSMC", "ETH": "ETH", "LTDC": "LTDC", "DVP": "DVP", "SAI": "SAI",
    "SWPMI": "SWPMI", "PIOC": "PIOC", "DFSDM": "DFSDM", "SDIO": "SDIO",
    "I3C": "I3C", "RTC": "RTC", "USBPD": "USBPD", "SERDES": "SERDES",
    "RCC": "RCC",
    # The four whose pins the AF parser cannot see; their settings are added below.
    "DAC": "DAC", "ADC1": "ADC", "ADC2": "ADC", "HSADC": "HSADC", "OPA": "OPA",
}

__import__("pathlib")

# Peripherals that get an entry even when the AF map names no pin for them: they are
# claimed wholesale, or their pads carry no AF code (SERDES' differential pair), so the
# per-pin map cannot reach them. `nvic:` and `codegen.periph_clock` both name some of
# these, and `validate_mcu.py` fails a vector whose owner is not a peripheral here.
# `SYS` is not one of them - it is hand-written in the file, with its own settings.
NO_SETTINGS = {"USBHS", "USBFS", "USBSS", "SERDES", "DMA1", "DMA2", "EXTI", "PWR", "FLASH",
               "IWDG", "WWDG", "CRC", "ECDC", "HSEM", "IPC", "DBGMCU", "ADC1", "ADC2",
               "HSADC", "DAC", "OPA", "CMP", "RNG", "SDMMC", "GPHA", "SYS", "TKEY",
               "UHSIF", "TIM6", "TIM7"}

# ---- `Mode` entries ---------------------------------------------------------------
#
# `tests/completeness.test.js` requires every peripheral of every real part to offer at
# least one setting WITH A CHOICE, and it is right to: a peripheral whose settings are
# empty is a peripheral the user cannot switch on. Getting that cell right is not a
# formality - `DMA1` with no mode row means the generated C never enables its clock.
#
# The wording follows the part's own precedents rather than being invented per
# peripheral. `Mode: [Disable, Enabled]` is what H417's `HSADC` and `SERDES` already say,
# and what CH32X035 says for `PIOC` and `AWU`; `Disable`/`Activated` is CH32X035's for
# `DMA1`, `IWDG` and `WWDG`, kept verbatim so the two parts read alike. `EXTI`,
# `PWR` and `FLASH` are copied from CH32V006 and CH32X035, whose option-byte and
# trigger-edge names are already reviewed.
#
# No `signals:` key is used here: these peripherals have no pins in the AF map (their
# signals are either none at all or a whole block), so naming signals would reference
# signal names that do not exist. `HSADC` and `SERDES` are already written that way.
def _mode(choices):
    return [{"name": "Mode", "choices": [{"name": c} for c in choices]}]


ENABLED = _mode(["Disable", "Enabled"])
ACTIVATED = _mode(["Disable", "Activated"])

# Per-peripheral settings, where the mode row alone is not the whole story.
MODES: dict[str, list[dict]] = {
    "CRC": ENABLED,
    "ECDC": ENABLED,
    "GPHA": ENABLED,
    "HSEM": ENABLED,
    "IPC": ENABLED,
    "RNG": ENABLED,
    "SERDES": _serdes_settings(),
    "TKEY": ENABLED,
    "TIM6": ENABLED,
    "TIM7": ENABLED,
    "UHSIF": _uhsif_settings(),
    # CH32H417 had this row before the peripheral block was regenerated (`Debug in low
    # power`), and RM ch.45 "Debug Support" is the chapter that gives it. Keeping the
    # name and the wording it had.
    "DBGMCU": [{"name": "Debug in low power",
                "choices": [{"name": "Disable"}, {"name": "Enabled"}]}],
    # Copying CH32X035's exact wording for the three watchdogs and the DMA controller.
    "DMA1": ACTIVATED,
    "DMA2": ACTIVATED,
    "IWDG": ACTIVATED,
    "WWDG": ACTIVATED,
    # CH32X035 `EXTI`: the trigger edge is the whole of EXTI's user-visible
    # configuration on this family (EXTI_RTENR / EXTI_FTENR).
    "EXTI": [{"name": "EXTI trigger edge",
              "choices": [{"name": "Rising edge"}, {"name": "Falling edge"},
                          {"name": "Both edges"}]}],
    # CH32X035 `PWR`: RM ch.2 gives the PVD (2.2.2) and the low-power modes (2.3).
    "PWR": [
        {"name": "Programmable Voltage Detector (PVD)",
         "choices": [{"name": "Disable"}, {"name": "Enabled"}]},
        {"name": "Low power mode",
         "choices": [{"name": "None"}, {"name": "Sleep"}, {"name": "Stop"},
                     {"name": "Standby"}]},
    ],
    # CH32X035 `FLASH`, with H417's own option-byte names - RM ch.46 is
    # "Flash Memory and User Option Bytes".
    "FLASH": [
        {"name": "Independent watchdog start (IWDG_SW)",
         "choices": [{"name": "Started by software (factory default)"},
                     {"name": "Started by hardware"}]},
        {"name": "Reset on entering Standby (STANDBY_RST)",
         "choices": [{"name": "No reset (factory default)"}, {"name": "Reset"}]},
        {"name": "Reset on entering Stop (STOP_RST)",
         "choices": [{"name": "No reset (factory default)"}, {"name": "Reset"}]},
    ],
    # RM ch.40: "The FMC manages expanded connectivity to different types of memory,
    # including: SDRAM, NAND Flash, and synchronous/asynchronous static memory", and the
    # feature list names the static-memory regions and PSRAM. One row per controller,
    # which is also how the DS splits them - Table 2-2-14 FSMC, Table 2-2-15 SDRAM.
    "FMC": _fmc_settings(),
    # RM ch.35 "lists CMP's own features: selectable input pins, a selectable output pin
    # and a digital filter" - so the inputs ARE the configuration, and a bare mode row
    # left the comparator with an output and nothing to compare. DS Table 2-2-22:
    #
    #     CMP_P  PB0/CMP_P0, PB2/CMP_P1, OPA1_OUT/CMP_P2
    #     CMP_N  PB1/CMP_N0, PC4/CMP_N1, DAC1_OUT/CMP_N2
    #     CMP_OUT  PC5(AF13), PE12(AF13), PA6(AF10), PA8(AF12), PB12(AF13), PE6(AF11),
    #              PE15(AF13)
    #
    # P2 and N2 are the two that are NOT pads: `OPA1_OUT` is the op-amp's own output
    # routed internally, and the CMP's own N2 tap likewise. They are offered as choices
    # with no `signals:` - naming a signal there would reference a pad that does not
    # exist - and the internal route is in the label so the user knows no pin is being
    # claimed.
    #
    # N2's label says DAC CHANNEL 2, not DAC1 as DS Table 2-2-22 reads ("DAC1_OUT/CMP_N2")
    # - the RM's own register bit description disagrees with its own datasheet:
    # `R32_CMP_CTLR.NSEL[1:0]` = 10 is "DAC2 output (PA5)" (CH32H417RM.md:50761-50762),
    # and PA5 is DAC channel 2's own output pin (ch32h417.h / DAC_OUT2), not channel 1's
    # (PA4). Recorded as a disagreements: entry (data/coverage/CH32H417.yaml) rather than
    # silently kept wrong; the register-level RM text is followed here as the more
    # specific source for what the silicon does.
    "CMP": [
        {"name": "Positive input",
         "choices": [{"name": "Disable"},
                     {"name": "P0", "signals": ["P0"]},
                     {"name": "P1", "signals": ["P1"]},
                     {"name": "P2 (OPA1 output, internal - claims no pin)"}]},
        {"name": "Negative input",
         "choices": [{"name": "Disable"},
                     {"name": "N0", "signals": ["N0"]},
                     {"name": "N1", "signals": ["N1"]},
                     {"name": "N2 (DAC channel 2 output, internal - claims no pin)"}]},
        {"name": "Output",
         "choices": [{"name": "Disable"}, {"name": "OUT", "signals": ["OUT"]}]},
    ],
    # RM ch.30: the RNG "can be disabled individually to reduce power consumption".
    # RM ch.33 SDMMC: "Communication modes support single-wire, four-wire, and eight-wire
    # configurations" - so the mode row carries the bus width, exactly as the
    # hand-written `SDIO` above it does. Signal names are SDMMC's own (`SDCK`, not `CK`).
    "SDMMC": [{"name": "Mode",
               "choices": [
                   {"name": "Disable"},
                   {"name": "SD 1-bit", "signals": ["SDCK", "CMD", "D0"]},
                   {"name": "SD 4-bit", "signals": ["SDCK", "CMD", "D0", "D1", "D2", "D3"]},
                   {"name": "SD 8-bit", "signals": ["SDCK", "CMD", "D0", "D1", "D2", "D3",
                                                    "D4", "D5", "D6", "D7"]},
               ]}, {
        # DS Table 2-2-12 lists these three alongside the bus it already covers: it writes
        # `SDMMC_STS/SDMMC_CMD` as one row and `SDMMC_SDCK/SDMMC_SLVCK` as another, and
        # Table 2-2-12's own heading names STR (strobe) and SLVCK (slave clock) - the
        # signals eMMC HS400 and SDIO-slave mode need. None of the three was reachable.
        "name": "Strobe and status",
        "type": "checkboxes",
        "choices": [
            {"name": "STR (strobe)", "signals": ["STR"]},
            {"name": "SLVCK (slave clock)", "signals": ["SLVCK"]},
            {"name": "STS (status)", "signals": ["STS"]},
        ],
    }],
    # RM ch.25/26/27 each give the controller "USB Host functionality and USB Device
    # functionality". CH32X035's `USBFS` spells its choices "(FS)"; these keep the speed
    # in the name because H417 has all three controllers at once.
    #
    # Each role drives the controller's own data pair, which is why the choices carry
    # `signals:`. Without them the three controllers were "holds no pin on any package"
    # while DS Tables 2-2-18/2-2-19 and 2-1-1 give every one of them pads.
    #
    # USBFS is the only OTG part - RM ch.26: "OTG_FS is a dual-role USB controller
    # supporting both host and device functionality ... Additionally, this controller can
    # be configured as a host-only or device-only controller" - so it gets a third role.
    "USBFS": [
        {"name": "Mode", "choices": [
            {"name": "Disable"},
            {"name": "Device (FS)", "signals": ["DP", "DM"]},
            {"name": "Host (FS)", "signals": ["DP", "DM"]},
            {"name": "Dual-role (OTG FS)", "signals": ["DP", "DM"]},
        ]},
        # VBUS and ID are offered separately rather than tied to a role, because NEITHER
        # source says which role requires them: the DS lists all four under one "Optional
        # pin" column and RM ch.26 calls On-The-Go support "an optional feature in the
        # OTG_FS controller's physical layer". Inferring "host needs VBUS" from general
        # USB knowledge is the family-not-a-citation move this repo bans - so the board
        # decides, and both pads are reachable.
        {"name": "OTG pins", "type": "checkboxes", "choices": [
            {"name": "VBUS (bus voltage sense)", "signals": ["VBUS"]},
            {"name": "ID (role detect)", "signals": ["ID"]},
        ]},
    ],
    # DS Table 2-2-19 gives USBHS two pads and no VBUS or ID - it is not an OTG part.
    # THOSE TWO ARE THE DEBUG PADS: Table 2-1-1 spells PB8 `SWCLK/USBHS_DP/...` and PB9
    # `SWIO/SWDIO/USBHS_DM/...`, and SYS routes SWCLK/SWIO to exactly those two, so
    # enabling USBHS while the 2-wire debug port is on is a real conflict on silicon and
    # the conflict engine reports it instead of the file hiding it.
    "USBHS": [{"name": "Mode", "choices": [
        {"name": "Disable"},
        {"name": "Device (HS)", "signals": ["DP", "DM"]},
        {"name": "Host (HS)", "signals": ["DP", "DM"]},
    ]}],
    # The USB 3.0 SuperSpeed pairs, DEDICATED pads with no alternate function of any kind
    # (DS Table 2-1-1, pin type USB3.0; all three packages bond all four). The pads are
    # named A/B rather than P/N deliberately - DS Note 7: "USB3.0 pin signals support
    # positive and negative identification and exchange ... SSRXA/SSRXB default connection
    # to each other TXP/TXN, support cross-connect TXN/TXP". The polarity is swappable, so
    # the signal names follow the pad names exactly and invent no P/N.
    "USBSS": [{"name": "Mode", "choices": [
        {"name": "Disable"},
        {"name": "Device (SS)", "signals": ["TXA", "TXB", "RXA", "RXB"]},
        {"name": "Host (SS)", "signals": ["TXA", "TXB", "RXA", "RXB"]},
    ]}],
}


def yaml_scalar(v: str) -> str:
    """Quote a name only when it needs it, so the output reads like the other MCU files."""
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", v):
        return v
    return '"' + v.replace('"', '\\"') + '"'

# Signals a peripheral owns that carry NO AF code, so the per-pin map cannot know them.
# Their pads are dedicated (`type: sys` in `pins:`, like XI/XO) or reset-state functions,
# and the only way to say "this peripheral claims this pad" is here. Each is a citation,
# not a guess: DS Table 2-1-1 lists the pad, and RM ch.9 says the reset-state multiplexer
# selects AF0 - so the pad's function is fixed rather than chosen from a list.
SUPPLEMENT: dict[str, dict[str, list[tuple[str, int | None, str | None]]]] = {
    "RCC": {
        # `clock.hse_signals` names these two, so RCC must route them or the HSE coupling
        # cannot switch the crystal on and `validate_mcu.py` fails its coupling check.
        "XI": [("XI", None, "dedicated HSE crystal input pad; not a GPIO on any package")],
        "XO": [("XO", None, "dedicated HSE crystal output pad; not a GPIO on any package")],
    },
    "SYS": {
        "SWIO": [("PB9", None, "SWIO/SWDIO, DS Table 2-1-1 - no AF code: this is the pad's "
                               "reset-state function, selected by the reset multiplexer")],
        "SWCLK": [("PB8", None, "SWCLK, DS Table 2-1-1 - likewise")],
    },
}


def _load_dedicated_pins() -> dict[str, dict[str, list[tuple[str, int | None, str | None]]]]:
    """Dedicated-function pads, from `data/sources/H417/dedicated_pins.yaml`.

    An AF parser can only see `SIGNAL(AFn)`. A pad whose UHSIF/DAC/ADC/OPA/SERDES function
    is its OWN function carries no AF code in DS Table 2-1-1, and UHSIF/SDMMC are missing
    from the parser's output entirely - so `DAC`, `ADC1`, `ADC2`, `HSADC`, `OPA`, `SDMMC`,
    `SERDES` and `UHSIF` all came out as "holds no pin on any package" while the datasheet
    gives them pins. `DAC` was the visible one: it offered "Output on pin" with no pin.

    That file is written by `tools/gen_h417_dedicated_pins.py` from the same independent
    parse as `tools/audit_h417_all_pins.py`, whose 95-pin read matches the datasheet's own
    QFN128 I/O count. This function only reads it; the citations live in the data.
    """
    path = pathlib.Path(__file__).resolve().parent.parent / "data/sources/H417/dedicated_pins.yaml"
    if not path.exists():
        return {}
    import yaml as _yaml
    doc = _yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out: dict[str, dict[str, list[tuple[str, int | None, str | None]]]] = {}
    for pid, sigs in (doc.get("dedicated_pins") or {}).items():
        for sig, rows in (sigs or {}).items():
            out.setdefault(pid, {})[sig] = [
                (r["pin"], r.get("af"), r.get("notes")) for r in rows
            ]
    return out


# MERGE per peripheral, never `dict.update`: the loaded file and the table above both
# carry an `RCC` key (XI/XO here, OSC32_IN/OSC32_OUT there), and a plain update would keep
# only the second - taking the HSE crystal pads out from under `clock.hse_signals` and
# `validate_mcu.py`'s coupling check, for a one-line edit in a data file.
for _pid, _sigs in _load_dedicated_pins().items():
    SUPPLEMENT.setdefault(_pid, {}).update(_sigs)


def _load_extras() -> dict[str, dict[str, str]]:
    """Hand-written additions to GENERATED blocks, from `peripheral_extras.yaml`.

    `--refresh` rewrites every generated block, so a fact hand-added to one is deleted the
    next time anybody regenerates - silently, with every gate green. That is not a
    hypothetical: PWR's eight supply rails, LTDC's colour-depth reasoning and the three
    USB controllers' pads all sat in generated blocks, and the refresh that added one pad
    to FMC would have taken all of them out. The USB pads moved to `dedicated_pins.yaml`
    (they are pads, and that file is for pads the AF parser cannot see); the prose that
    is not a pad lives here, where the generator can put it back every time.
    """
    path = pathlib.Path(__file__).resolve().parent.parent / "data/sources/H417/peripheral_extras.yaml"
    if not path.exists():
        return {}
    import yaml as _yaml
    doc = _yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {str(pid): {str(k): str(v) for k, v in (e or {}).items()}
            for pid, e in (doc.get("extras") or {}).items()}


EXTRAS = _load_extras()

# What a peripheral says when it routes nothing. `validate_mcu.py` makes the declaration
# mandatory and `tools/coverage.py` checks the claim against the datasheet, so a generated
# block that emits only the `notes:` sentence is a validator ERROR the moment it lands -
# which is how fourteen of these came to be typed in by hand, into a section a refresh
# rewrites. The generator states it, once, for every block it writes.
PINLESS_SOURCE = ("CH32H417DS0.md Table 2-1-1 and Tables 2-2-x: no pin row carries a "
                  "function of this peripheral (checked by tools/coverage.py)")


def emit_peripheral(pid: str, sigs: dict[str, list[tuple[str, int, str | None]]], out=print) -> None:
    cat = CATEGORY.get(pid, "Connectivity")
    extra = EXTRAS.get(pid) or {}
    # a top-level key the extras fragment defines replaces the generator's own version
    extra_keys = set(re.findall(r"^([A-Za-z_][A-Za-z0-9_]*):", extra.get("yaml", ""), re.M))
    out(f"  {pid}:")
    out(f"    category: {cat}")
    for line in (extra.get("comment") or "").rstrip("\n").splitlines():
        out(("    # " + line).rstrip())

    tpl = TYPE_OF.get(pid)
    settings = MODES.get(pid) or (SETTINGS.get(tpl) if tpl else None)
    if not settings:
        # A peripheral with no settings is not a cosmetic gap: `completeness.test.js`
        # fails it, because a peripheral the user cannot switch on is a peripheral the
        # generated C never enables. Emitting `settings: {}` here is how that got in
        # once; refusing to write the block at all is how it cannot get in again.
        raise SystemExit(
            f"{pid}: no settings. Add a `Mode` row to MODES above, or a TYPE_OF entry "
            f"whose type has a SETTINGS template.")
    # Every `signals:` a choice names has to be a signal THIS peripheral routes, or the
    # choice offers a pad that cannot be claimed. `validate_mcu.py` catches it too, but
    # after the file has been written; here it fails before anything is emitted, and it is
    # what makes it safe to share one template between instances that are not identical
    # (TIM_ADV's second break input exists on TIM8 and nowhere else).
    #
    # Compared against the SHORTENED names, because that is what goes into the file and
    # what the settings refer to: `ADC1_IN0` is written as `IN0`, `FMC_SDRAM_CS_N0` as
    # `CS_N0`. Guarding the raw keys would reject every correct choice.
    short_names = {s[len(pid) + 1:] if s.startswith(pid + "_") else s for s in sigs}
    for s in settings:
        for c in s.get("choices") or []:
            for sig in c.get("signals") or []:
                if sig not in short_names:
                    raise SystemExit(
                        f"{pid}: setting `{s['name']}` choice `{c['name']}` names signal "
                        f"`{sig}`, which this peripheral does not route. Signals it has: "
                        f"{sorted(short_names)[:12]}")
    # The extras fragment may REPLACE this block outright, the same way it replaces `pins:`
    # and `notes:`. This file's own header promises that for "any top-level key it defines",
    # and until 2026-09-12 it was only honoured for those two - so an extras fragment with a
    # `settings:` key produced a block with `settings:` written TWICE.
    #
    # That is worse than it sounds, and it is why this is a guard and not a tidy-up: PyYAML's
    # safe_load takes the LAST duplicate key silently, so validate_mcu.py, verify_sdk_names.py
    # and coverage.py all reported 0 errors, while js-yaml THROWS and the app would not load
    # the part at all. Three green Python gates over a file the configurator cannot open.
    if "settings" not in extra_keys:
        out("    settings:")
    for s in (settings if "settings" not in extra_keys else []):
        out(f"      - name: {yaml_scalar(s['name'])}")
        # `type: checkboxes` was DROPPED here, and dropping it is not a cosmetic loss: a
        # checkbox row became a single-choice row, so the engine's default moved from
        # "nothing ticked" to `choices[0]` - which for a channel list is a real pin. The
        # ADC read as enabled with channel IN0 selected on a project where the user had
        # done nothing, and two ADCs then collided on PA0. Emitting it is the fix; the
        # `settings` guard above would not have caught it because the names were all valid.
        if s.get("type"):
            out(f"        type: {yaml_scalar(s['type'])}")
        out("        choices:")
        for c in s["choices"]:
            sig = c.get("signals")
            if sig:
                out(f"          - {{ name: {yaml_scalar(c['name'])}, "
                    f"signals: [{', '.join(sig)}] }}")
            else:
                out(f"          - {{ name: {yaml_scalar(c['name'])} }}")

    # signal_pins: every pin/AF pair is the datasheet's, in signal-name order.
    # An extras `signal_pins:` override REPLACES this block, same promise as `settings:`
    # a few lines up - and until this guard existed, the promise was false for this ONE
    # key: `sigs` being non-empty emitted the mechanical block regardless of `extra_keys`,
    # so an override wrote `signal_pins:` TWICE. PyYAML's safe_load takes the LAST
    # duplicate key silently (validate_mcu.py/verify_sdk_names.py/coverage.py all read
    # the override and reported clean) while js-yaml THROWS on the same file - the exact
    # trap this generator's own settings-guard was written to prevent, missed here.
    # Found narrowing SDMMC's signal_pins to the RM=00 pin set, 2026-09-13.
    #
    # An extras `remaps:` override means the SAME thing for the SAME reason: SDMMC's
    # `AFIO_PCFR1.SDMMC_RM[1:0]` moves every signal atomically, so `remaps:` replaces
    # `signal_pins:` entirely rather than living beside it (`validate_mcu.py`: "a
    # peripheral muxes one way or the other"). Missing this the first time produced
    # BOTH keys in one generated block - caught by validate_mcu's own check, not
    # silently, but exactly the same shape of miss as the signal_pins case above.
    if "signal_pins" in extra_keys or "remaps" in extra_keys:
        pass  # the override supplies pin data whole; emitted below with the rest of `extra`
    elif sigs:
        out("    signal_pins:")
        for sig in sorted(sigs):
            short = sig[len(pid) + 1:] if sig.startswith(pid + "_") else sig
            parts, seen = [], set()
            for pin, af, note in sigs[sig]:
                # `signal_pins:` is keyed by PIN - the engine stores the choice per pin - so a
                # second entry for the same pin is dead data, and `validate_mcu.py` rejects it
                # outright. It happens where two DS headings merge onto one signal name and
                # the same pad carries both (`FMC_A5` on PB6 from FSMC and from SDRAM).
                if pin in seen:
                    continue
                seen.add(pin)
                entry = f"{{ pin: {pin}"
                if af is not None:
                    entry += f", af: {af}"
                if note:
                    entry += f", notes: {yaml_scalar(note)}"
                parts.append(entry + " }")
            out(f"      {yaml_scalar(short)}: [{', '.join(parts)}]")
    else:
        # A peripheral that routes nothing DECLARES it - `validate_mcu.py` rejects the
        # silence and `tools/coverage.py` checks the claim against the datasheet.
        if "pins" not in extra_keys:
            out(f"    pins: {{ none: true, source: {yaml_scalar(PINLESS_SOURCE)} }}")
        if "notes" not in extra_keys:
            out("    notes: This peripheral holds no pin on any package; it is configured")
            out("      through its own registers and the clock tree only.")
    for line in (extra.get("yaml") or "").rstrip("\n").splitlines():
        out(("    " + line).rstrip())


def splice(add: list[str], *, dry_run: bool = False, refresh: bool = False,
           allow_loss: bool = False) -> int:
    """Insert the generated blocks into the MCU file, keeping the hand-written ones.

    Text surgery rather than a YAML round-trip, deliberately: `PyYAML` would drop every
    comment in a 2 000-line file whose comments are the citations, and this repository's
    rule is that a fact without its citation is a guess.

    `refresh` REPLACES the generated section rather than only appending to it. Without it a
    re-run cannot correct a block it already wrote, which is exactly what was needed once
    the AF parser was fixed: the existing peripheral blocks carried signal names built from
    broken fragments (`VP_D0`, `C4_SMBA`) and appending would have left both versions.
    """
    text = MCU.read_text(encoding="utf-8")
    pend = text.index("\ngpio:")

    banner = (
        "\n  # =========================================================================\n"
        "  #  Everything below this line was GENERATED by tools/gen_h417_peripherals.py\n"
        "  #  and then reviewed. The pin data is mechanical: every `pin`/`af` pair comes\n"
        "  #  from tools/extract_h417_pins.py, which parses DS Table 2-1-1, so none of it\n"
        "  #  is transcribed by hand - 950 assignments cannot be hand-copied without an\n"
        "  #  error, and a wrong AF code compiles and drives the wrong pin.\n"
        "  #\n"
        "  #  Cross-checked against the DS's OWN second reading, Tables 2-2-x, which are\n"
        "  #  peripheral-first where 2-1-1 is pin-first: tools/audit_h417_af.py compares\n"
        "  #  the two and reports every difference in both directions. That audit is what\n"
        "  #  found 12 signal names the PDF had split across a line break.\n"
        "  #\n"
        "  #  `settings:` are per peripheral TYPE, from the reference manual's functional\n"
        "  #  description. `params:` are deliberately NOT generated: a parameter needs\n"
        "  #  its init-struct field and its option macros checked against ch32h417_*.h,\n"
        "  #  and inventing them would put names nobody compiled into data/.\n"
        "  #\n"
        "  #  Regenerate:  python tools/gen_h417_peripherals.py --splice --refresh\n"
        "  # =========================================================================\n"
    )

    if refresh:
        at = text.find(MARK_START)
        if at < 0:
            sys.exit(f"--refresh: the generated section marker is not in {MCU.name}. "
                     "--splice first, or the marker was edited away.")
        # The generated region ends at the next TOP-LEVEL key, not at `gpio:`. Ending it at
        # `gpio:` (this function's first version) swallowed every section inserted after the
        # peripherals - it silently deleted the whole `nvic:` block, 125 vectors, because
        # they sat inside the range it replaced. A generated region must be bounded by its
        # own structure, not by whatever happens to come next in the file.
        end = re.search(r"^[A-Za-z]", text[at:], re.M)
        if not end:
            sys.exit("--refresh: found no top-level key after the generated section, so the "
                     "region it should replace cannot be bounded")
        pend = at + end.start()
        head = text[:at]
        print(f"refreshing the generated section: {pend - at} bytes replaced")
    else:
        head = text[:pend]
    new = head + banner + "".join(add) + text[pend:]
    lost = _losses(text, new)
    if lost and not allow_loss:
        print("REFUSING to write: the new peripherals block DROPS facts the file already "
              "holds. A generated block is the generator's output, so the fix is to teach "
              "the generator (data/sources/H417/dedicated_pins.yaml for pads, "
              "peripheral_extras.yaml for everything else) - not to accept the loss.",
              file=sys.stderr)
        for line in lost:
            print(f"    {line}", file=sys.stderr)
        print(f"  {len(lost)} loss(es). --allow-loss overrides, and needs a reason in the "
              "commit message.", file=sys.stderr)
        return 2
    if dry_run:
        print(f"would write {len(new)} bytes (was {len(text)}), "
              f"{len(add)} peripheral block(s) written")
        return 0
    # `newline="\n"` is not cosmetic. Without it `write_text` opens the file in text mode
    # with the platform default, so on this Windows box every LF became CRLF and a refresh
    # that changed four lines rewrote all 3855 of them. Three commits in round 5 normalised
    # the file back by hand, and a 3855-line diff hides the four lines that matter. The MCU
    # files are LF in the repository; the generator now writes what it read.
    MCU.write_text(new, encoding="utf-8", newline="\n")
    print(f"wrote {MCU.relative_to(ROOT).as_posix()}: {len(new)} bytes (was {len(text)}), "
          f"{len(add)} peripheral block(s) written")
    return 0



def _losses(before: str, after: str) -> list[str]:
    """What the new `peripherals:` block no longer says that the old one did.

    A `--refresh` rewrites 65 blocks at once, and anything hand-added to one of them is
    deleted in the same stroke - with every gate still green, because a file that says
    LESS is still internally consistent. That is not hypothetical: on 2026-09-12 a refresh
    whose only intended effect was adding PB0 to `FMC_DQM3` would also have removed PWR's
    eight supply rails, LTDC's colour-depth reasoning and its notes, and the pads of
    USBFS, USBHS and USBSS - re-declaring three USB controllers as holding no pin while
    the datasheet gives all three of them pads. 200 lines of cited fact, silently.

    So the splice reads its own output back and refuses a write that loses a peripheral,
    a key of one, a (signal, pin) the file routed, a remap, or a SETTING CHOICE.

    Additions and CHANGES pass: a changed AF code is the generator correcting itself,
    which is the point of a refresh.

    THE CHOICE CHECK WAS ADDED AFTER IT WAS NEEDED, and the near-miss is worth recording
    because the guard read as working the whole time. On 2026-09-12 AGENT-4's `9a502ae`
    rewrote ETH's `Interface` row in the generated block: out went `MII` and `RMII`, two
    choices the commit demonstrated were INVENTED (`RMII` appears zero times in this
    part's datasheet), in came `Internal PHY (built-in 10/100M)`. The next refresh put the
    invented pair back and took the real one out. The guard did NOT stay silent - it
    refused the write over the `notes:` and the four MDI pads that came with the same
    commit - so it looked like it was doing its job, and the choice row rode along
    underneath. It surfaced only because `validate_mcu.py` then called the four MDI pads
    dead, one gate catching what another had let through.

    A guard that catches four facts out of five reads exactly like one that catches all
    five. Choices are compared by NAME per setting row, because that is what a user picks
    and what `.wchproj` stores; a choice whose `signals:` changed is the generator
    correcting itself and passes, like any other change.
    """
    import yaml as _yaml

    def periphs(text: str) -> dict:
        try:
            return (_yaml.safe_load(text) or {}).get("peripherals") or {}
        except _yaml.YAMLError as e:
            sys.exit(f"the spliced file is not valid YAML, so nothing was written: {e}")

    A, B = periphs(before), periphs(after)
    out: list[str] = []
    for pid in sorted(set(A) - set(B)):
        out.append(f"{pid}: the whole peripheral is gone")
    for pid in sorted(set(A) & set(B)):
        x, y = A[pid] or {}, B[pid] or {}
        for k in sorted(set(x) - set(y)):
            out.append(f"{pid}.{k}: dropped")
        for sig, opts in (x.get("signal_pins") or {}).items():
            had = {o["pin"] for o in opts or [] if isinstance(o, dict) and o.get("pin")}
            now = {o["pin"] for o in (y.get("signal_pins") or {}).get(sig, []) or []
                   if isinstance(o, dict) and o.get("pin")}
            if had - now:
                out.append(f"{pid}.{sig}: no longer routed to {', '.join(sorted(had - now))}")
        for rm in x.get("remaps") or []:
            if rm not in (y.get("remaps") or []):
                out.append(f"{pid}.remaps: `{(rm or {}).get('name', '?')}` is gone")
        # Setting rows, and the choices in them, by name. A row that disappears takes
        # every pad its choices claimed with it; a choice that disappears is a mode the
        # user could pick yesterday and cannot today.
        def rows(p: dict) -> dict:
            return {str(s.get("name")): [str(c.get("name")) for c in (s.get("choices") or [])]
                    for s in (p.get("settings") or []) if isinstance(s, dict)}
        ra, rb = rows(x), rows(y)
        for name in sorted(set(ra) - set(rb)):
            out.append(f"{pid}.settings: the row `{name}` is gone")
        for name in sorted(set(ra) & set(rb)):
            lost = [c for c in ra[name] if c not in rb[name]]
            if lost:
                out.append(f"{pid}.settings.`{name}`: choice(s) gone - "
                           + ", ".join(f"`{c}`" for c in lost))
    return out


def check_merge_keys(groups: dict) -> list[str]:
    """Every MERGE / NOT_A_PERIPHERAL key must name a heading the DS actually uses.

    This is the guard that would have caught the phantom-key bug: `VP`, `C4`, `DC` and
    `DIO` were keys for headings that no real DS table produces - they were fragments of
    signal names broken by a page break - and the map silently filed DVP pins under the
    USB controller. A key that matches nothing is either dead (remove it) or, as here, a
    symptom of a parse that is inventing names.
    """
    bad = []
    for key in sorted(set(MERGE) | NOT_A_PERIPHERAL):
        if key not in groups:
            bad.append(key)
    return bad


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--list", action="store_true", help="names only")
    ap.add_argument("--missing", action="store_true",
                    help="which peripherals the MCU file does not have yet")
    ap.add_argument("--splice", action="store_true",
                    help="insert the missing blocks into data/mcus/CH32H417.yaml")
    ap.add_argument("--allow-loss", action="store_true",
                    help="write even though the new block drops a fact the file holds "
                         "(say why in the commit message)")
    ap.add_argument("--refresh", action="store_true",
                    help="with --splice: REPLACE the generated section instead of adding to it")
    ap.add_argument("--dry-run", action="store_true", help="with --splice: show, do not write")
    a = ap.parse_args()

    groups = af_map()

    # A MERGE / NOT_A_PERIPHERAL key that names no real DS heading is a dead entry, and the
    # last time this file had four of them they were hiding a parse bug that moved pins to
    # the wrong peripheral. Refuse rather than warn.
    dead = check_merge_keys(groups)
    if dead:
        sys.exit("gen_h417_peripherals: MERGE / NOT_A_PERIPHERAL names heading(s) the DS does "
                 f"not produce: {', '.join(dead)}. Either they are dead (remove them) or the "
                 "pin parser is inventing names, which is how DVP pins ended up on USBHS.")

    # Fold the DS's extra headings into the peripheral they belong to.
    #
    # **A merge must UNION, not replace.** The first version did `merged[target][name] = opts`,
    # so when two headings re-prefixed onto the same signal name one silently overwrote the
    # other: `CAN: CAN1` wiped CAN1's own RX/TX pins, leaving `CAN1_RX: PA13(AF5)` where Table
    # 2-2-13 lists four; and `SDRAM`/`FSMC -> FMC` both produce `FMC_A0`, `FMC_D0` and the
    # other shared names, so whichever came second replaced the first. A replaced entry looks
    # exactly like a correct one, which is why nothing else caught it -
    # `tools/audit_h417_af.py` reported the lost pins as gaps.
    merged: dict[str, dict[str, list[tuple[str, int, str | None]]]] = collections.defaultdict(dict)
    for g, sigs in groups.items():
        if g in NOT_A_PERIPHERAL:
            continue
        target = MERGE.get(g, g)
        for sig, opts in sigs.items():
            # RE-PREFIX on merge. `RGMII_GTXC` becomes `GTXC` under ETH, because every
            # signal_pins key is the signal name the settings and the pin grid use, and
            # leaving the old heading on makes a signal nothing can select - which the
            # validator catches as "can be selected but gives it no pin".
            name = target + "_" + sig[len(g) + 1:] if sig.startswith(g + "_") else sig
            bucket = merged[target].setdefault(name, [])
            for pin, af, note in opts:
                if not any(p == pin and a == af for p, a, _ in bucket):
                    bucket.append((pin, af, note))
            merged[target][name] = sorted(bucket, key=lambda e: (e[0], e[1]))

    # Add the peripherals the SPL ships that hold no pin, so the tree shows them.
    for pid in sorted(NO_SETTINGS):
        merged.setdefault(pid, {})

    # Signals with no AF code, which the per-pin map cannot carry. Applied last so a
    # supplement entry wins: these are pads the peripheral owns by construction, not
    # choices, and for XI/XO `validate_mcu.py` requires exactly this to hold the HSE
    # coupling together.
    for pid, sigs in SUPPLEMENT.items():
        merged.setdefault(pid, {})
        for sig, entries in sigs.items():
            full = sig if sig.startswith(pid + "_") else f"{pid}_{sig}"
            merged[pid][full] = list(entries)

    # LAST, once every pin a peripheral has is in one place: choose the defaults.
    collisions = order_defaults(merged)
    if collisions:
        print(f"  default pads: {collisions} signal(s) across all three packages still share "
              f"a default with another signal of the same peripheral (no free pad on that "
              f"package)", file=sys.stderr)

    if a.missing:
        text = MCU.read_text(encoding="utf-8")
        have = set(re.findall(r"^  ([A-Z][A-Za-z0-9]*):$", text, re.M))
        missing = sorted(set(merged) - have)
        print(f"{len(merged)} peripheral(s) from the DS/SPL; {len(missing)} not in the MCU file:")
        for m in missing:
            print(f"  {m}")
        return 0

    if a.list:
        for pid in sorted(merged):
            print(f"  {pid:<10} {len(merged[pid]):>3} signal(s)  {CATEGORY.get(pid, '?')}")
        return 0

    if a.splice or a.dry_run:
        # On a refresh every generated peripheral is rewritten; otherwise only the ones the
        # file does not already model by hand, because the hand-written blocks carry
        # `params:` verified against the SPL and a generated block would empty them.
        text = MCU.read_text(encoding="utf-8")
        pstart = text.index("\nperipherals:")
        pend = text.index("\ngpio:", pstart)
        own = set(re.findall(r"^  ([A-Z][A-Za-z0-9]*):$", text[pstart:pend], re.M))
        if a.refresh:
            # Everything after the marker is generated, so all of it is rewritten - but the
            # HAND-WRITTEN blocks that sit BEFORE the marker must still be excluded, or the
            # file would carry two definitions of the same peripheral and YAML would keep
            # the last one, silently discarding the hand-written `params:` and its citations.
            at = text.find(MARK_START)
            if at >= 0:
                generated = set(re.findall(r"^  ([A-Z][A-Za-z0-9]*):$", text[at:pend], re.M))
                hand = own - generated
            else:
                hand = set()
            add = []
            for pid in sorted(merged):
                if pid in hand:
                    continue
                buf: list[str] = []
                emit_peripheral(pid, merged[pid], out=buf.append)
                add.append("\n".join(buf) + "\n")
            print(f"refresh: rewriting {len(add)} generated peripheral(s); "
                  f"{len(hand)} hand-written block(s) kept: {', '.join(sorted(hand))}")
            return splice(add, dry_run=a.dry_run, refresh=True,
                          allow_loss=a.allow_loss)
        add = []
        for pid in sorted(merged):
            if pid in own:
                continue
            buf = []
            emit_peripheral(pid, merged[pid], out=buf.append)
            add.append("\n".join(buf) + "\n")
        print(f"{len(own)} modelled by hand (kept): {', '.join(sorted(own))}")
        print(f"{len(add)} to add")
        return splice(add, dry_run=a.dry_run, allow_loss=a.allow_loss)

    for pid in sorted(merged):
        emit_peripheral(pid, merged[pid])
    return 0


if __name__ == "__main__":
    sys.exit(main())
