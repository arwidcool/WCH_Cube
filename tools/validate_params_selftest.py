#!/usr/bin/env python3
"""Planted-break self-test for `peripherals.*.params` validation.

WHY THIS EXISTS. `check_param_list()` in validate_mcu.py has said "Shared by
`peripherals.*.params` and `dma.channel_params`" since it was written, and it was called
for the DMA half ONLY. Every `params:` row on every part - hundreds across six parts - was
therefore unchecked: a missing `default:`, a `default:` naming something that is not one of
its own options, a duplicate `key:`, a `min` above its `max`. The function was there, the
docstring promised it, and one call site was missing.

It was found on 2026-09-13 by writing `default: 0` on a row whose options are named
"Slave, FPGA" / "Slave, SOC" / "Master" and watching `validate_mcu.py`, `verify_sdk_names.py`,
`coverage.py --gate` and `--strict` all pass. Wiring it up then found a real mirror on
CH32V003 (`USART1.ck_enable` carried `const:` AND `default:` with the same value).

    python tools/validate_params_selftest.py      # 0 = every break was caught

Each case mutates ONE row of a real part, writes it to a scratch file, and requires
validate_mcu.py both to exit non-zero AND to name that specific problem.
"""
from __future__ import annotations

import copy
import pathlib
import re
import subprocess
import sys
import tempfile

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "tools" / "validate_mcu.py"
PART = ROOT / "data" / "mcus" / "CH32H417.yaml"
PERIPH = "UHSIF"          # five enum rows, and the one whose defaults started this


def row(doc, key):
    for p in doc["peripherals"][PERIPH]["params"]:
        if p.get("key") == key:
            return p
    raise KeyError(f"{PERIPH}.{key} is not in {PART.name} any more")


# (label, mutate(doc), substring the refusal must contain)
CASES = [
    ("a default that is not one of its own options",
     lambda d: row(d, "width_bit").__setitem__("default", "48-bit"),
     "is not one of its options"),

    ("a default deleted entirely",
     lambda d: row(d, "mode_select").pop("default"),
     "no `default`"),

    ("a duplicate key",
     lambda d: d["peripherals"][PERIPH]["params"].append(copy.deepcopy(row(d, "clk_div"))),
     "duplicate key"),

    ("both `const` and `default` on one row",
     lambda d: row(d, "width_bit").__setitem__("const", "DEF_UHSIF_DATA_BIT8"),
     "two different answers to one question"),

    ("a numeric default below its own min",
     lambda d: row(d, "clk_div").update({"default": -1, "min": 0, "max": 63, "options": None}),
     "below min"),
]


def run(doc, path: pathlib.Path) -> tuple[int, str]:
    path.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8")
    res = subprocess.run([sys.executable, str(VALIDATOR), "--quiet", str(path)],
                         capture_output=True, text=True, cwd=str(ROOT))
    return res.returncode, (res.stdout or "") + (res.stderr or "")


def main() -> int:
    if not PART.exists():
        print(f"validate_params_selftest: {PART} is missing")
        return 1
    clean = yaml.safe_load(PART.read_text(encoding="utf-8"))
    failures = []

    with tempfile.TemporaryDirectory() as tmp:
        scratch = pathlib.Path(tmp) / PART.name
        # THE POSITIVE HALF: round-tripped through yaml.safe_dump, the real file must still
        # validate clean. Without it a checker that refuses everything - or a dump that
        # mangles the file - would make every case below "pass" for the wrong reason.
        code, out = run(copy.deepcopy(clean), scratch)
        if code != 0:
            print("FAIL  the unmutated part does not validate once round-tripped, so a "
                  "planted break would prove nothing:")
            print(re.sub(r"\s+", " ", out).strip()[:600])
            return 1
        print(f"  OK    {PART.name} validates clean before any break is planted")

        for label, mutate, expect in CASES:
            doc = copy.deepcopy(clean)
            try:
                mutate(doc)
            except Exception as exc:                              # noqa: BLE001
                failures.append(label)
                print(f"FAIL  {label}\n        could not plant it ({exc})")
                continue
            code, out = run(doc, scratch)
            flat = re.sub(r"\s+", " ", out)
            caught = code != 0 and expect in flat
            print(f"{'  OK  ' if caught else 'FAIL  '} {label}")
            if not caught:
                failures.append(label)
                print(f"        expected non-zero exit and {expect!r}")
                print(f"        got exit {code}: {flat.strip()[:300]}")

    print(f"\n{len(CASES) - len(failures)}/{len(CASES)} planted breaks caught")
    for f in failures:
        print(f"  MISSED  {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
