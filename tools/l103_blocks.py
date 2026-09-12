#!/usr/bin/env python3
"""Emit the `packages:` and `pins:` blocks for CH32L103.yaml from the recovered tables.

Small on purpose. The two blocks are mechanical - pin number to pin name, and the
union of every pin name on the die - and both are derived from
`data/sources/l103/Datasheets/CH32L103_pins_recovered.json`, which
`tools/recover_l103_pins_from_pdf.py` produced and checked against the datasheet's
own GPIO counts. Writing them by hand would be re-typing a checked fact, which is
how a 48-row table acquires a typo.

The pin TYPES are the only judgement here, and each is read off the DS pin table's
own `Pin type` column: `P` is power, `I` is Schmitt input (BOOT0), the reset pin is
the reset pin, and everything else is an I/O. Nothing is inferred from a sibling part.

Usage:
    python tools/l103_blocks.py            # both blocks, to stdout
    python tools/l103_blocks.py --packages
    python tools/l103_blocks.py --pins
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
JSON = ROOT / "data/sources/l103/Datasheets/CH32L103_pins_recovered.json"

# The order the DS listing uses, and the order this file writes them in.
ORDER = ["LQFP48", "QFN32", "QSOP28", "QFN20", "TSSOP20"]

# DS `Pin type` column, and the DS's own labelling, for the non-I/O pins. Read per
# pin from the table rather than derived: VDD/VDDA/VBAT are `P`, VSS/VSSA are `P`
# too but they are the ground, NRST is `I`, BOOT0 is `I`.
GROUND = {"VSS", "VSSA"}
POWER = {"VDD", "VDDA", "VBAT"}


def pin_type(name):
    if name in GROUND:
        return "ground"
    if name in POWER:
        return "power"
    if name == "NRST":
        return "reset"
    if name.startswith("BOOT"):
        return "boot"
    return "io"


def load():
    return json.loads(JSON.read_text(encoding="utf-8"))


def fmt(v):
    return "[" + ", ".join(v) + "]" if isinstance(v, list) else v


def packages_block(pkgs):
    L = [
        "# Pin number -> pin name, one table per package.",
        "# Recovered from DS Table 2-1-1 (PDF) by `tools/recover_l103_pins_from_pdf.py`,",
        "# which checks pin numbering and each package's GPIO count against the DS model",
        "# table's own `GPIO port number` row - all five packages reconcile exactly.",
        "# Cell corrections the conversion dropped are cited in",
        "# `data/sources/l103/Datasheets/CH32L103_pin_corrections.yaml`.",
        "#",
        "# A LIST is more than one port name on ONE package pin, which the datasheet",
        "# shows by listing two rows with the same number for that column (and its pinout",
        "# figures print, e.g. QFN20 pin 11 as `PB6/CC1/PB13/T1CH1N`). The app treats them",
        "# as one physical pin, the same as a shorted pair.",
        "packages:",
    ]
    for col in ORDER:
        L.append(f"  {col}:")
        for n in sorted(pkgs[col], key=int):
            v = pkgs[col][n]
            L.append(f"    {n}: " + (f"[{', '.join(v)}]" if isinstance(v, list) else v))
    return "\n".join(L)


def pins_block(pkgs):
    names = set()
    for col in pkgs.values():
        for v in col.values():
            names.update(v if isinstance(v, list) else [v])
    L = [
        "# Every pin that exists on the die, not only the ones a package bonds.",
        "pins:",
    ]
    for n in sorted(names):
        t = pin_type(n)
        L.append(f"  {n}: {{ type: {t} }}")
    return "\n".join(L)


def main():
    pkgs = load()
    want = sys.argv[1] if len(sys.argv) > 1 else ""
    if want == "--pins":
        print(pins_block(pkgs))
    elif want == "--packages":
        print(packages_block(pkgs))
    else:
        print(packages_block(pkgs))
        print()
        print(pins_block(pkgs))
    return 0


if __name__ == "__main__":
    sys.exit(main())
