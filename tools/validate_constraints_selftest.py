#!/usr/bin/env python3
"""Planted-break self-test for the round-5 `constraints:` + `gpio.class` checks.

A check that cannot fail is worth nothing. `validate_mcu.py` earned its place by
catching 14 planted breaks one at a time; this does the same for the two functions
round 5 added, so "validate_mcu exits 0" means the new block was actually read rather
than skipped.

    python tools/validate_constraints_selftest.py     # 0 = every break was caught

Each case mutates one thing in a real part's YAML, writes it to a scratch file, runs
`validate_mcu.py --quiet` on that one file, and requires BOTH that it exits non-zero
AND that it names the specific problem - an unrelated error would otherwise make a
broken check look successful.
"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "tools" / "validate_mcu.py"
PART = ROOT / "data" / "mcus" / "CH32X035.yaml"

# (name, find, replace, substring the error must contain)
CASES = [
    ("a choice name the part does not offer",
     "    choices: [Pull-down]\n    only_on:",
     "    choices: [Pull-Down]\n    only_on:",
     "is not a choice this part offers"),

    ("a pin that is not in `pins:`",
     "only_on: [PA0, PA1, PA2, PA3, PA4, PA5, PA6, PA7, PA8, PA9, PA10, PA11, PA12, PA13, PA14, PA15, PC16, PC17]",
     "only_on: [PA0, PA1, PA2, PA3, PA4, PA5, PA6, PA7, PA8, PA9, PA10, PA11, PA12, PA13, PA14, PA15, PC16, PZ17]",
     "is not declared in `pins:`"),

    ("a package the part does not have",
     "    packages: [LQFP64M, LQFP48, QFN28, QSOP28, TSSOP20]",
     "    packages: [LQFP64M, LQFP48, QFN28, QSOP28, LQFP32]",
     "is not a package of this part"),

    ("a pin scoped to a package it is not bonded on",
     "    packages: [LQFP64M, LQFP48, QFN28, QSOP28, TSSOP20]",
     "    packages: [QFN20, QFN12]",
     "is not bonded on"),

    ("`only_on` and `not_on` on one entry",
     "    not_on: [PB1, PB5]\n    packages: [QFN28, QSOP28]",
     "    not_on: [PB1, PB5]\n    only_on: [PB1, PB5]\n    packages: [QFN28, QSOP28]",
     "exactly one of `only_on:`"),

    ("`choices` and `classes` on one entry",
     "    classes: [out]\n    not_on: [PB1, PB5]",
     "    classes: [out]\n    choices: [Output Push Pull]\n    not_on: [PB1, PB5]",
     "exactly one of `choices:`"),

    # `when: { peripheral: USBFS, enabled: true }` is not unique in this file - PC10/PC11
    # carry it on BOTH their gpio.mode and their gpio.pull entry - so each of these two
    # cases anchors on that line PLUS its own entry's other fields, which is unique.
    # Found by this file's own new anchor-uniqueness guard below: before it, both cases
    # silently mutated the FIRST (gpio.mode) occurrence and reported OK regardless of
    # which one they meant to target.
    ("a `when` naming hardware this part does not have",
     "    classes: [out, af, analog]\n    not_on: [PC10, PC11]\n"
     "    when: { peripheral: USBFS, enabled: true }",
     "    classes: [out, af, analog]\n    not_on: [PC10, PC11]\n"
     "    when: { peripheral: USB_DEVICE, enabled: true }",
     "is not a peripheral in this file"),

    ("a `when` with a non-boolean `enabled`",
     "    choices: [Pull-up, Pull-down]\n    not_on: [PC10, PC11]\n"
     "    when: { peripheral: USBFS, enabled: true }",
     "    choices: [Pull-up, Pull-down]\n    not_on: [PC10, PC11]\n"
     '    when: { peripheral: USBFS, enabled: "yes" }',
     "`enabled` must be true or false"),

    ("a class outside the closed set",
     "    classes: [out]\n    not_on: [PB1, PB5]",
     "    classes: [output]\n    not_on: [PB1, PB5]",
     "unknown class `output`"),

    ("`classes` on an option that has no classes",
     "    option: gpio.pull\n    choices: [Pull-up, Pull-down]\n    not_on: [PC10, PC11]",
     "    option: gpio.pull\n    classes: [out]\n    not_on: [PC10, PC11]",
     "only applies to `option: gpio.mode`"),

    ("a mode left unclassified while `classes` is used",
     "- { name: Analog,                       macro: GPIO_Mode_AIN,    class: analog }",
     "- { name: Analog,                       macro: GPIO_Mode_AIN }",
     "must give EVERY entry a `class:`"),

    ("an unknown key in the constraint",
     "    reason: \"PB1 and PB5 are shorted",
     "    restricts: output\n    reason: \"PB1 and PB5 are shorted",
     "unknown key(s)"),

    ("a duplicate id",
     "  - id: shorted-pb1-pb5-not-output",
     "  - id: shorted-pc10-pc11-pc16-pc17-not-output",
     "duplicate `id`"),

    ("no `reason`",
     "    reason: \"PB1 and PB5 are shorted and sealed inside the chip; neither may be configured as a GPIO output.\"\n",
     "",
     "has no `reason`"),

    ("no `source`",
     "    source: \"CH32X035DS0.md Note 5 (p.19)\"",
     "",
     "has no `source`"),

    ("an unknown `option`",
     "    option: gpio.mode\n    classes: [out]\n    not_on: [PB1, PB5]",
     "    option: gpio.drive\n    classes: [out]\n    not_on: [PB1, PB5]",
     "unknown option `gpio.drive`"),

    ("the same choice allow-listed and deny-listed at once",
     "  - id: pull-down-only-on-pa0-pa15-pc16-pc17",
     "  - id: pull-down-not-on-pa4\n    option: gpio.pull\n    choices: [Pull-down]\n"
     "    not_on: [PA4]\n    reason: \"contradiction\"\n    source: \"planted\"\n\n"
     "  - id: pull-down-only-on-pa0-pa15-pc16-pc17",
     "both allow-listed and deny-listed"),

    ("an entry that is not a mapping",
     "  - id: pull-down-only-on-pa0-pa15-pc16-pc17\n"
     "    option: gpio.pull\n"
     "    choices: [Pull-down]\n"
     "    only_on: [PA0, PA1, PA2, PA3, PA4, PA5, PA6, PA7, PA8, PA9, PA10, PA11, PA12, PA13, PA14, PA15, PC16, PC17]\n"
     '    reason: "Pull-down is available on PA0-PA15 and PC16-PC17 only; every other pin has no pull-down resistor."\n'
     '    source: "ch32x035_gpio.h:33 + CH32X035DS0.md ch.1.4.19 (p.11)"',
     '  - "not a mapping"',
     "must be a mapping"),

    # A second top-level `constraints:` replaces the first (PyYAML keeps the last), so
    # this checks the block's own shape rather than a YAML parse failure.
    ("a `constraints:` block that is not a list",
     '    reason: "PC10 and PC11 are short-joined to the USBFS data pins, so while USBFS is '
     'enabled they must stay floating inputs and carry no pull."\n'
     '    source: "CH32X035DS0.md Note 4 (p.19)"',
     '    reason: "PC10 and PC11 are short-joined to the USBFS data pins, so while USBFS is '
     'enabled they must stay floating inputs and carry no pull."\n'
     '    source: "CH32X035DS0.md Note 4 (p.19)"\n\nconstraints: nope',
     "must be a list"),
]


def run(path: pathlib.Path) -> tuple[int, str]:
    res = subprocess.run([sys.executable, str(VALIDATOR), "--quiet", str(path)],
                         capture_output=True, text=True, cwd=str(ROOT))
    return res.returncode, (res.stdout or "") + (res.stderr or "")


def main() -> int:
    base = PART.read_text(encoding="utf-8")
    failures = []

    code, out = run(PART)
    if code != 0:
        print(f"FAIL  the unmutated part does not validate:\n{out}")
        return 1
    print(f"  OK    {PART.name} validates clean before any break is planted")

    with tempfile.TemporaryDirectory() as tmp:
        for i, (name, find, replace, expect) in enumerate(CASES):
            # THE ANCHOR MUST BE UNIQUE, and this guard is not paranoia: `if find not in
            # base` (what this loop used to check) only proves the anchor exists SOMEWHERE,
            # not that it is the one line the case means to mutate. An anchor with no line
            # boundary matches INSIDE a longer line elsewhere in the file, `.replace(..., 1)`
            # patches that unrelated occurrence, the real target survives untouched, and the
            # case still reports OK by exiting non-zero for a reason that has nothing to do
            # with the break it claims to plant - a planted-break test that plants nothing
            # reads exactly like one that works. Found by AGENT-1 in this file's sibling
            # (validate_clock_selftest.py), fixed there first; same shape, same fix, here.
            hits = base.count(find)
            if hits != 1:
                where = "not found" if hits == 0 else f"matches {hits} places"
                failures.append(f"{name}: anchor {where} in {PART.name}")
                print(f"FAIL  {name}\n        anchor {where}, so the break is not the one "
                      f"described: {find[:60]!r}")
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
            caught = code != 0 and expect in flat
            print(f"{'  OK  ' if caught else 'FAIL  '} {name}")
            if not caught:
                failures.append(name)
                print(f"        expected non-zero exit and {expect!r}")
                print(f"        got exit {code}: {flat.strip()[:300]}")

    print(f"\n{len(CASES) - len(failures)}/{len(CASES)} planted breaks caught")
    if failures:
        for f in failures:
            print(f"  MISSED  {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
