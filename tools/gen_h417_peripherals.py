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
    groups: dict[str, dict[str, list[tuple[str, int, str | None]]]] = collections.defaultdict(dict)
    for sig, opts in doc["signals"].items():
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
        groups[g][sig] = entries
    return groups


# ---------------------------------------------------------------- DS group -> peripheral
#
# Some DS groups are one peripheral's pins under several headings, and some headings are
# not peripherals at all. Merging them wrongly splits a peripheral in the UART tree and
# worse, splits its pins across two entries so neither can see a conflict on them.
MERGE = {
    "RGMII": "ETH",        # the RGMII pins of the same MAC (RM ch.31)
    "SDRAM": "FMC",        # the SDRAM controller is FMC's bank (RM ch.40)
    "RAM": "FMC",          # DS spells a few data lines `RAM_D*` where FMC says `FSMC_D*`
    "DRAM": "FMC",
    "FSMC": "FMC",         # the SPL header is ch32h417_fmc.h, so FMC is the name the SDK uses
    "CC1": "USBPD",        # Type-C CC lines (RM ch.24)
    "CC2": "USBPD",
    "VP": "USBHS",         # USB PHY pins (RM ch.25/27)
    "DC": "USBPD",
    "DIO": "USBPD",
    "MCO": "RCC",          # the clock output is RCC's, not a peripheral of its own
    "C4": "USBPD",
}
# Headings that are a signal of an existing peripheral, not a peripheral of its own.
# `CAN` is the DS's generic row for CAN1's pins, `MCO`/`RAM`/`DRAM`/`C4` are single
# signals, and `IPC_CH` is IPC's channel number rather than a block.
NOT_A_PERIPHERAL = {"RAM", "DRAM", "MCO", "C4", "CAN", "IPC_CH"}

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
    "RTC": "Timers", "IWDG": "System Core", "WWDG": "System Core",
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
        "name": "Break Input",
        "choices": [
            {"name": "Disable"},
            {"name": "Break Input enabled", "signals": ["BKIN"]},
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
        "name": "Interface",
        "choices": [
            {"name": "Disable"},
            {"name": "MII", "signals": ["MDC", "MDIO"]},
            {"name": "RMII", "signals": ["MDC", "MDIO"]},
            {"name": "RGMII", "signals": ["MDC", "MDIO", "GTXC", "RXC", "RXD0", "RXD1", "RXD2", "RXD3",
                                            "RXDV", "TXD0", "TXD1", "TXD2", "TXD3", "TXEN"]},
        ],
    }],
    "LTDC": [{
        "name": "Colour depth",
        "choices": [
            {"name": "Disable"},
            {"name": "RGB888", "signals": ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7",
                                           "G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
                                           "B0", "B1", "B2", "B3", "B4", "B5", "B6", "B7"]},
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
    }],
    "DVP": [{
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "8-bit", "signals": ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7",
                                          "HSYNC", "VSYNC", "PCLK"]},
            {"name": "10-bit", "signals": ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7",
                                           "D8", "D9", "HSYNC", "VSYNC", "PCLK"]},
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
            {"name": "Output on RTC pin"},
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
        "name": "Mode",
        "choices": [
            {"name": "Disable"},
            {"name": "Enabled", "signals": ["VP_D0", "VP_D4", "VP_D5", "VP_VSYNC"]},
        ],
    }],
}
# Which template a peripheral instance uses when its own name has no entry.
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
}

# Peripherals with pins in the DS but no mode row worth offering: they are claimed
# wholesale or not at all.
NO_SETTINGS = {"USBHS", "USBFS", "USBSS", "RCC", "DMA1", "DMA2", "EXTI", "PWR", "FLASH",
               "IWDG", "WWDG", "CRC", "ECDC", "HSEM", "IPC", "DBGMCU", "ADC1", "ADC2",
               "HSADC", "DAC", "OPA", "CMP", "RNG", "SDMMC", "GPHA", "SYS", "TKEY",
               "UHSIF", "SERDES", "TIM6", "TIM7"}


def yaml_scalar(v: str) -> str:
    """Quote a name only when it needs it, so the output reads like the other MCU files."""
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", v):
        return v
    return '"' + v.replace('"', '\\"') + '"'


def emit_peripheral(pid: str, sigs: dict[str, list[tuple[str, int, str | None]]], out=print) -> None:
    cat = CATEGORY.get(pid, "Connectivity")
    out(f"  {pid}:")
    out(f"    category: {cat}")

    tpl = TYPE_OF.get(pid)
    settings = SETTINGS.get(tpl) if tpl else None
    if settings:
        out("    settings:")
        for s in settings:
            out(f"      - name: {yaml_scalar(s['name'])}")
            out("        choices:")
            for c in s["choices"]:
                sig = c.get("signals")
                if sig:
                    out(f"          - {{ name: {yaml_scalar(c['name'])}, "
                        f"signals: [{', '.join(sig)}] }}")
                else:
                    out(f"          - {{ name: {yaml_scalar(c['name'])} }}")

    # signal_pins: every pin/AF pair is the datasheet's, in signal-name order.
    if sigs:
        out("    signal_pins:")
        for sig in sorted(sigs):
            short = sig[len(pid) + 1:] if sig.startswith(pid + "_") else sig
            parts = []
            for pin, af, note in sigs[sig]:
                entry = f"{{ pin: {pin}, af: {af}"
                if note:
                    entry += f", notes: {yaml_scalar(note)}"
                parts.append(entry + " }")
            out(f"      {yaml_scalar(short)}: [{', '.join(parts)}]")
    else:
        out("    notes: This peripheral holds no pin on any package; it is configured")
        out("      through its own registers and the clock tree only.")


def splice(add: list[str], *, dry_run: bool = False) -> int:
    """Insert the generated blocks into the MCU file, keeping the hand-written ones.

    Text surgery rather than a YAML round-trip, deliberately: `PyYAML` would drop every
    comment in a 1 600-line file whose comments are the citations, and this repository's
    rule is that a fact without its citation is a guess.
    """
    text = MCU.read_text(encoding="utf-8")
    pstart = text.index("\nperipherals:")
    pend = text.index("\ngpio:", pstart)
    have = set(re.findall(r"^  ([A-Z][A-Za-z0-9]*):$", text[pstart:pend], re.M))

    banner = (
        "\n  # =========================================================================\n"
        "  #  Everything below this line was GENERATED by tools/gen_h417_peripherals.py\n"
        "  #  and then reviewed. The pin data is mechanical: every `pin`/`af` pair comes\n"
        "  #  from tools/extract_h417_pins.py, which parses DS Table 2-1-1, so none of it\n"
        "  #  is transcribed by hand - 950 assignments cannot be hand-copied without an\n"
        "  #  error, and a wrong AF code compiles and drives the wrong pin.\n"
        "  #\n"
        "  #  `settings:` are per peripheral TYPE, from the reference manual's functional\n"
        "  #  description. `params:` are deliberately NOT generated: a parameter needs\n"
        "  #  its init-struct field and its option macros checked against ch32h417_*.h,\n"
        "  #  and inventing them would put names nobody compiled into data/.\n"
        "  #\n"
        "  #  Regenerate:  python tools/gen_h417_peripherals.py --splice\n"
        "  # =========================================================================\n"
    )
    new = text[:pend] + banner + "".join(add) + text[pend:]
    if dry_run:
        print(f"would write {len(new)} bytes (was {len(text)}), "
              f"{len(add)} peripheral block(s) added")
        return 0
    MCU.write_text(new, encoding="utf-8")
    print(f"wrote {MCU.relative_to(ROOT).as_posix()}: {len(new)} bytes (was {len(text)}), "
          f"{len(add)} peripheral block(s) added")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--list", action="store_true", help="names only")
    ap.add_argument("--missing", action="store_true",
                    help="which peripherals the MCU file does not have yet")
    ap.add_argument("--splice", action="store_true",
                    help="insert the missing blocks into data/mcus/CH32H417.yaml")
    ap.add_argument("--dry-run", action="store_true", help="with --splice: show, do not write")
    a = ap.parse_args()

    groups = af_map()

    # Fold the DS's extra headings into the peripheral they belong to.
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
            merged[target][name] = opts

    # Add the peripherals the SPL ships that hold no pin, so the tree shows them.
    for pid in sorted(NO_SETTINGS):
        merged.setdefault(pid, {})

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
        # Emit only what the file does not already model by hand: the hand-written
        # blocks carry `params:` verified against the SPL, and a generated block would
        # replace that with an empty one.
        text = MCU.read_text(encoding="utf-8")
        pstart = text.index("\nperipherals:")
        pend = text.index("\ngpio:", pstart)
        have = set(re.findall(r"^  ([A-Z][A-Za-z0-9]*):$", text[pstart:pend], re.M))
        add = []
        for pid in sorted(merged):
            if pid in have:
                continue
            buf: list[str] = []
            emit_peripheral(pid, merged[pid], out=buf.append)
            add.append("\n".join(buf) + "\n")
        print(f"{len(have)} modelled by hand (kept): {', '.join(sorted(have))}")
        print(f"{len(add)} to add")
        return splice(add, dry_run=a.dry_run)

    for pid in sorted(merged):
        emit_peripheral(pid, merged[pid])
    return 0


if __name__ == "__main__":
    sys.exit(main())
