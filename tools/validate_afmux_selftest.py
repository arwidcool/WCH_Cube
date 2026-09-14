#!/usr/bin/env python3
"""Planted-break self-test for the `signal_pins:` + `codegen.remap.style: af` checks.

A check that cannot fail is worth nothing. `validate_mcu.py` earned its place by
catching planted breaks one at a time, and `tools/validate_constraints_selftest.py`
did the same for round 5's `constraints:`; this does it for the per-pin AF mechanism,
so "validate_mcu exits 0 on CH32H417" means the new block was actually read.

    python tools/validate_afmux_selftest.py     # 0 = every break was caught

Each case mutates one thing in the real part's YAML, writes it to a scratch file, runs
`validate_mcu.py --quiet` on that one file, and requires BOTH a non-zero exit AND that
the output names the specific problem - an unrelated error would otherwise make a
broken check look successful.

Output is ASCII only: the Windows console here is cp1252.
"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "tools" / "validate_mcu.py"
PART = ROOT / "data" / "mcus" / "CH32H417.yaml"

# (name, find, replace, substring the error must contain)
CASES = [
    ("a pin that is not in `pins:`",
     "      SCL: [{ pin: PB6, af: 4 }, { pin: PB8, af: 4 }]",
     "      SCL: [{ pin: PZ6, af: 4 }, { pin: PB8, af: 4 }]",
     "is not declared in `pins:`"),

    ("an AF code outside the four bits the register has",
     "      SDA: [{ pin: PB7, af: 4 }, { pin: PB9, af: 4 }]",
     "      SDA: [{ pin: PB7, af: 16 }, { pin: PB9, af: 4 }]",
     "must be an integer 0..15"),

    ("an AF code that is not a number at all",
     "      SMBA: [{ pin: PB5, af: 4 }]",
     "      SMBA: [{ pin: PB5, af: four }]",
     "must be an integer 0..15"),

    ("the same pin listed twice for one signal, where the second is unreachable",
     "      SCL: [{ pin: PC0, af: 9 }, { pin: PB10, af: 4 }]",
     "      SCL: [{ pin: PC0, af: 9 }, { pin: PC0, af: 4 }]",
     "is listed twice for this signal"),

    ("an unquoted comma, which truncates the value before it",
     "      SDA: [{ pin: PC1, af: 9 }, { pin: PB11, af: 4 }]",
     "      SDA: [{ pin: PC1, af: 9, notes: two, three }, { pin: PB11, af: 4 }]",
     "unknown key(s)"),

    ("a signal a setting can request that `signal_pins:` does not route",
     "      SMBA: [{ pin: PC2, af: 9 }, { pin: PB12, af: 4 }]",
     "      SMBAX: [{ pin: PC2, af: 9 }, { pin: PB12, af: 4 }]",
     "`signal_pins:` gives it no pin"),

    ("a peripheral carrying BOTH mux shapes, where the remaps would be dead",
     "  I3C:\n    category: Connectivity",
     "  I3C:\n    remaps:\n      - { name: Default, pins: { SCL: PF6, SDA: PF7 } }\n    category: Connectivity",
     "has BOTH `remaps:` and `signal_pins:`"),

    ("`style: af` with no function to apply it",
     "    style: af\n    fn: GPIO_PinAFConfig",
     "    style: af",
     "needs the function that applies it"),

    ("`style: af` alongside a per-peripheral AFIO field it cannot have",
     "    style: af\n    fn: GPIO_PinAFConfig",
     "    style: af\n    fields: { USART1: [{ lsb: 0, bits: 2 }] }\n    fn: GPIO_PinAFConfig",
     "there is no\n                                             per-peripheral AFIO field"),

    ("a style that does not exist",
     "    style: af\n",
     "    style: afio\n",
     "unknown style"),

    # The direction that is easy to forget: the peripherals are right and the STYLE is
    # wrong. Nothing is malformed, the app still shows the pinout, and the generated C
    # silently contains no GPIO_PinAFConfig at all.
    ("`signal_pins:` under a style whose emitter never runs",
     "    style: af\n    fn: GPIO_PinAFConfig",
     "    style: macro\n    fn: GPIO_PinAFConfig",
     "the AF emitter only runs on `style: af`"),

    # `signal_groups[].remap_by_package:` - landed alongside UHSIF's own QFN68/QFN88
    # override (CH32H417RM.md:11839-11845). Same shape as a peripheral-level
    # `remap_by_package:` (already covered above via `remaps:`, a different code path -
    # this is the `signal_groups:` one, and nothing exercised it before this pair).
    ("a `signal_groups` remap_by_package naming a package this MCU does not have",
     "        remap_by_package: { QFN68: 1, QFN88: 2 }",
     "        remap_by_package: { QFN68: 1, QFN99: 2 }",
     "`QFN99` is not a package of this MCU"),

    ("a `signal_groups` remap_by_package index out of range for the group's own options",
     "        remap_by_package: { QFN68: 1, QFN88: 2 }",
     "        remap_by_package: { QFN68: 9, QFN88: 2 }",
     "remap index 9 is out of range"),
]


def run(path: pathlib.Path) -> tuple[int, str]:
    r = subprocess.run([sys.executable, str(VALIDATOR), str(path), "--quiet"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def main() -> int:
    if not PART.is_file():
        print(f"ERROR: {PART} not found - this self-test needs an AF-muxed part to mutate",
              file=sys.stderr)
        return 2
    base = PART.read_text(encoding="utf-8")

    # The unmutated file must PASS, or every case below passes for the wrong reason.
    with tempfile.TemporaryDirectory() as tmp:
        clean = pathlib.Path(tmp) / "clean.yaml"
        clean.write_text(base, encoding="utf-8")
        code, out = run(clean)
        if code != 0:
            print(f"FAIL  the unmutated {PART.name} does not validate, so no case below means anything")
            print(re.sub(r"\s+", " ", out).strip()[:400])
            return 1
        print(f"  OK   {PART.name} validates before any break is planted")

    failures: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, (name, find, replace, expect) in enumerate(CASES):
            # THE ANCHOR MUST BE UNIQUE, and this guard is not paranoia: `if find not in
            # base` (what this loop used to check) only proves the anchor exists SOMEWHERE,
            # not that it is the one line the case means to mutate. An anchor with no line
            # boundary matches INSIDE a longer line elsewhere in the file, `.replace(..., 1)`
            # patches that unrelated occurrence, the real target survives untouched, and the
            # case still reports OK for a reason that has nothing to do with the break it
            # claims to plant - a planted-break test that plants nothing reads exactly like
            # one that works. Found by AGENT-1 in this file's sibling
            # (validate_clock_selftest.py), fixed there first; same shape, same fix, here.
            hits = base.count(find)
            if hits != 1:
                where = "not found" if hits == 0 else f"matches {hits} places"
                failures.append(f"{name}: anchor {where} in {PART.name}")
                print(f"FAIL  {name}\n        anchor {where}, so the break is not the one "
                      f"described: {find[:70]!r}")
                continue
            mutated = base.replace(find, replace, 1)
            if mutated == base:
                failures.append(f"{name}: the mutation changed nothing")
                print(f"FAIL  {name}\n        find and replace are identical")
                continue
            scratch = pathlib.Path(tmp) / f"case{i}.yaml"
            scratch.write_text(mutated, encoding="utf-8")
            code, out = run(scratch)
            flat = re.sub(r"\s+", " ", out)
            want = re.sub(r"\s+", " ", expect)
            caught = code != 0 and want in flat
            print(f"{'  OK  ' if caught else 'FAIL  '} {name}")
            if not caught:
                failures.append(name)
                print(f"        expected non-zero exit and {want!r}")
                print(f"        got exit {code}: {flat.strip()[:300]}")

    print(f"\n{len(CASES) - len(failures)}/{len(CASES)} planted breaks caught")
    for f in failures:
        print(f"  MISSED  {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
