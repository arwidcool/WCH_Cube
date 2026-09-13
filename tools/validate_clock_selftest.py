#!/usr/bin/env python3
"""Planted-break self-test for the `clock.plls:` + mux-`source:` checks.

Round 6's rule: a gate nobody has watched run is a guess. `check_clock()` grew five new
checks for the second-PLL schema, and none of them could be exercised by a shipped part -
no file carries a `plls:` block yet, so `validate_mcu.py` exiting 0 on all six parts says
exactly nothing about them. Two of the three defects the schema exists to fix were of this
shape already: a list `source:` was merely truthy and never in `known`, so EVERY mux
reported "source is not another prescaler or SYSCLK", and nothing looked at a secondary
PLL at all.

    python tools/validate_clock_selftest.py      # 0 = every break was caught

Unlike the sibling self-tests, this one plants the POSITIVE half too. It injects a
complete, correct `plls:` + mux block into a real part and requires it to validate CLEAN
before mutating anything - because a check that refuses everything passes a
planted-break sweep just as well as one that works, and would have made the whole schema
unusable rather than merely unchecked.

The block injected is CH32H417's real USBHS_PLL shape (RM 3.3.5.6 / RCC_PLLCFGR2), carried
here on CH32V006 so the test does not wait on the H417 data landing.
"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "tools" / "validate_mcu.py"
PART = ROOT / "data" / "mcus" / "CH32V006.yaml"

# The anchor we splice after. CH32V006's clock block opens with its oscillator list.
ANCHOR = "  sysclk:"

# A correct second-PLL block: one fixed-output PLL, one multiplier PLL fed from it, and a
# tap whose `source:` is a mux with a default on each axis. Everything a file may say.
GOOD = """  plls:
    AUX_PLL:
      label: Aux PLL
      output: AUX_PLL_CLK
      output_mhz: 480
      inputs:
        - { name: HSI ref, source: HSI, div: 1 }
        - { name: "SYS PLL", source: PLLCLK, div: 2 }
    STEP_PLL:
      output: STEP_PLL_CLK
      multipliers: [2, 4]
      inputs:
        - { name: Aux, source: AUX_PLL_CLK, div: 1 }
  sysclk:"""

# (name, find, replace, substring the error must contain)
CASES = [
    ("a mux source naming a node that does not exist",
     "source: [AUX_PLL_CLK, PLLCLK]",
     "source: [AUX_PLL_CLK, NOPE_CLK]",
     "is not an oscillator, a PLL output, another prescaler or SYSCLK"),

    ("a PLL with neither multipliers nor a fixed output",
     "      output_mhz: 480\n",
     "",
     "has neither `multipliers:` nor a fixed `output_mhz:`"),

    ("a PLL with BOTH multipliers and a fixed output",
     "      output_mhz: 480\n",
     "      output_mhz: 480\n      multipliers: [2]\n",
     "a PLL is one or the other"),

    ("a PLL input naming something that is not a clock",
     "{ name: HSI ref, source: HSI, div: 1 }",
     "{ name: HSI ref, source: HSJ, div: 1 }",
     "is not an oscillator, PLLCLK or another PLL's output"),

    ("two PLLs publishing the same output name",
     "\n      output: STEP_PLL_CLK\n",
     "\n      output: AUX_PLL_CLK\n",
     "is already published by"),

    ("a PLL output that collides with an oscillator",
     "      output: AUX_PLL_CLK",
     "      output: HSI",
     "collides with the oscillator of the same name"),

    ("a PLL output using a reserved name",
     "      output: AUX_PLL_CLK",
     "      output: hclk",
     "is a reserved name"),

    ("a PLL input cycle",
     "        - { name: Aux, source: AUX_PLL_CLK, div: 1 }",
     "        - { name: Aux, source: STEP_PLL_CLK, div: 1 }",
     "PLL input cycle"),

    ("a `default:` that is not one of the tap's own options",
     "\n      default: 10\n",
     "\n      default: 7\n",
     "is not one of its own `options:`"),

    ("a `default_source:` that is not one of the tap's own sources",
     "\n      default_source: AUX_PLL_CLK\n",
     "\n      default_source: HSE\n",
     "is not one of its own `source:` entries"),

    ("a sysclk source that is neither an oscillator, PLLCLK nor a PLL output",
     "    sources: [HSI, HSE, PLLCLK]",
     "    sources: [HSI, HSE, PLLCLK, MYSTERY_CLK]",
     "nor a `clock.plls` output"),
]


def with_block(base: str) -> str:
    """The part's YAML with a correct `plls:` block and one mux tap spliced in."""
    assert ANCHOR in base, f"{PART.name} no longer has a `{ANCHOR.strip()}` line"
    out = base.replace(ANCHOR, GOOD, 1)
    # The mux tap goes in beside the existing prescalers. NEWLINE-ANCHORED on purpose:
    # `codegen.rcc` has a `prescalers:` key of its own at FOUR spaces, and a bare
    # "  prescalers:" matches INSIDE it. That spliced the tap into the register-encoding
    # block, where `check_clock` never looks, and three cases then "passed" by exiting 0
    # over a tap that was not there - this file's own failure mode, scored against the
    # test rather than the tool.
    assert "\n  prescalers:\n" in out, f"{PART.name} no longer has a `clock.prescalers` block"
    tap = (
        "\n  prescalers:\n"
        "    USBFS:\n"
        '      label: USBFS 48 MHz\n'
        "      source: [AUX_PLL_CLK, PLLCLK]\n"
        "      options: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7.5, 8, 9.5, 10]\n"
        "      default: 10\n"
        "      default_source: AUX_PLL_CLK\n"
        "      target_mhz: 48\n"
    )
    return out.replace("\n  prescalers:\n", tap, 1)


def run(path: pathlib.Path) -> tuple[int, str]:
    res = subprocess.run([sys.executable, str(VALIDATOR), "--quiet", str(path)],
                         capture_output=True, text=True, cwd=str(ROOT))
    return res.returncode, (res.stdout or "") + (res.stderr or "")


def main() -> int:
    base = with_block(PART.read_text(encoding="utf-8"))
    failures = []

    with tempfile.TemporaryDirectory() as tmp:
        # THE POSITIVE HALF. If this fails, every case below would "pass" for the wrong
        # reason and the schema would be unusable rather than merely unchecked.
        clean = pathlib.Path(tmp) / "clean.yaml"
        clean.write_text(base, encoding="utf-8")
        code, out = run(clean)
        if code != 0:
            print("FAIL  a CORRECT plls: + mux block does not validate - the checks refuse "
                  "the schema they are meant to admit:")
            print(re.sub(r"\s+", " ", out).strip()[:600])
            return 1
        print("  OK    a correct `plls:` block with a mux tap validates clean")

        for i, (name, find, replace, expect) in enumerate(CASES):
            # THE ANCHOR MUST BE UNIQUE, and this guard is not paranoia - it caught three
            # real bugs in this file. A find/replace anchor with no line boundary matches
            # INSIDE a longer line: "  prescalers:" inside `codegen.rcc`'s four-space
            # "    prescalers:", and "      default: 10" inside "        default: 100000".
            # Each mutated something unrelated, left the case's own target untouched, and
            # the case then reported PASS by exiting 0 over a file that was never broken -
            # a planted-break test that plants nothing reads exactly like one that works.
            # The sibling self-tests use the same find/replace shape without this guard.
            hits = base.count(find)
            if hits != 1:
                where = "not found" if hits == 0 else f"matches {hits} places"
                failures.append(f"{name}: anchor {where}")
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
