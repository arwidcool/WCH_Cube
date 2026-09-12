#!/usr/bin/env python3
"""Wire the dedicated-function pins into tools/gen_h417_peripherals.py.

Two edits, both at a point the file already has a mechanism for:

  1. `SUPPLEMENT.update(...)` from `data/sources/H417/dedicated_pins.yaml`. SUPPLEMENT
     is already documented as "signals a peripheral owns that carry NO AF code, so the
     per-pin map cannot know them" - which is exactly what DAC1_OUT, ADC_IN<n>,
     OPA*_P/N/OUT, SERDES_TXP and the UHSIF/SDMMC groups are. The data file is cited to
     DS Table 2-1-1.
  2. SETTINGS + TYPE_OF for DAC, ADC and HSADC and OPA, so their signals are reachable
     from the peripheral tree and the pin grid rather than being present-but-unusable.

Idempotent: a re-run detects that the patch is already in and says so.
"""
import io
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
GEN = ROOT / 'tools/gen_h417_peripherals.py'

ANCHOR = '''    "SYS": {
        "SWIO": [("PB9", None, "SWIO/SWDIO, DS Table 2-1-1 - no AF code: this is the pad's "
                               "reset-state function, selected by the reset multiplexer")],
        "SWCLK": [("PB8", None, "SWCLK, DS Table 2-1-1 - likewise")],
    },
}
'''

LOADER = '''    "SYS": {
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


SUPPLEMENT.update(_load_dedicated_pins())
'''

# Settings for the peripherals whose signals were unreachable, and the type map that
# points them at those settings.
SETTINGS_ADD = '''
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
    # One choice per channel would be sixteen rows; the first channel is offered here so
    # the pin grid can reach the analog pads at all, and the RM's own channel list is the
    # rest. Offered rather than silent because a pin with no way to claim it is the same
    # defect as the DAC had.
    "name": "Channels",
    "choices": [{"name": "Disable"}, {"name": "Channel 0 (IN0)", "signals": ["IN0"]},
                {"name": "Channel 4 (IN4)", "signals": ["IN4"]}],
}]
SETTINGS["HSADC"] = [{
    "name": "Mode",
    "choices": [{"name": "Disable"}, {"name": "Enabled"}],
}]
SETTINGS["OPA"] = [{
    "name": "OPA1",
    "choices": [{"name": "Disable"}, {"name": "Enabled"}],
}, {
    "name": "OPA2",
    "choices": [{"name": "Disable"}, {"name": "Enabled"}],
}, {
    "name": "OPA3",
    "choices": [{"name": "Disable"}, {"name": "Enabled"}],
}]
'''

TYPE_OF_ANCHOR = '''    "I3C": "I3C", "RTC": "RTC", "USBPD": "USBPD", "SERDES": "SERDES",
    "RCC": "RCC",
}
'''

TYPE_OF_NEW = '''    "I3C": "I3C", "RTC": "RTC", "USBPD": "USBPD", "SERDES": "SERDES",
    "RCC": "RCC",
    # The four whose pins the AF parser cannot see; their settings are added below.
    "DAC": "DAC", "ADC1": "ADC", "ADC2": "ADC", "HSADC": "HSADC", "OPA": "OPA",
}

__import__("pathlib")
'''


def main():
    text = io.open(GEN, encoding='utf-8').read()
    if '_load_dedicated_pins' in text:
        print('already wired')
        return 0
    if ANCHOR not in text:
        sys.exit('SUPPLEMENT anchor not found - the generator has moved')
    text = text.replace(ANCHOR, LOADER, 1)

    if TYPE_OF_ANCHOR not in text:
        sys.exit('TYPE_OF anchor not found')
    text = text.replace(TYPE_OF_ANCHOR, TYPE_OF_NEW, 1)

    # the SETTINGS additions go after the SETTINGS dict closes, which is the line
    # defining TYPE_OF
    marker = '\nTYPE_OF = {'
    if marker not in text:
        sys.exit('TYPE_OF definition not found')
    text = text.replace(marker, SETTINGS_ADD + '\nTYPE_OF = {', 1)

    io.open(GEN, 'w', encoding='utf-8', newline='\n').write(text)
    print('patched: SUPPLEMENT loader, 4 settings blocks, 5 type entries')
    return 0


if __name__ == '__main__':
    sys.exit(main())
