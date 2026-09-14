#!/usr/bin/env python3
"""Planted-break self-test for `codegen.channel_macros` validation.

WHY THIS EXISTS. CH32X035's ADC1 had a `params:` row using `sdk_repeat: channels`
(`ADC_RegularChannelConfig`, one call per ticked channel) with NO `codegen.channel_macros.
ADC1` anywhere in the file - so ticking any of its 14 channels compiled to a TODO
(`codegen.channel_macros.ADC1 — no macro for any channel`). Every existing gate passed:
`validate_mcu.py`, `verify_sdk_names.py`, `coverage.py --gate`, `--strict` on the default
(nothing-ticked) fixture. It was found only by generating real C for a throwaway project
with a channel selected and reading it by hand (2026-09-14).

A crude cross-part probe for the same SHAPE then found a second live instance -
CH32V003's ADC1 had the SAME gap on its two internal channels (IN8/IN9, Vrefint/Vcalint) -
confirming this was not a one-off. `check_codegen()` in `validate_mcu.py` now checks it
statically, reproducing `app/engine/codegen.js`'s own `selectedChannels()` + `sdkCalls()`
logic: any `params:` row with `sdk_repeat: channels` needs `codegen.channel_macros.<pid>`
to exist AND cover every choice name of every `type: checkboxes` setting on that
peripheral.

    python tools/validate_channel_macros_selftest.py      # 0 = every break was caught

Each case mutates `codegen.channel_macros` on a real, currently-clean part, writes it to
a scratch file, and requires validate_mcu.py both to exit non-zero AND to name that
specific problem.
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
PART = ROOT / "data" / "mcus" / "CH32X035.yaml"
PID = "ADC1"


# (label, mutate(doc), substring the refusal must contain)
CASES = [
    ("the whole codegen.channel_macros.ADC1 map removed",
     lambda d: d["codegen"]["channel_macros"].pop(PID),
     "missing, but ADC1.params has a `sdk_repeat: channels` row"),

    ("one channel's macro entry removed (the rest still present)",
     lambda d: d["codegen"]["channel_macros"][PID].pop("IN5"),
     "has no macro for IN5"),

    ("the internal channel's macro entry removed",
     lambda d: d["codegen"]["channel_macros"][PID].pop("IN15 (Vrefint, internal)"),
     "has no macro for IN15 (Vrefint, internal)"),
]


def run(doc, path: pathlib.Path) -> tuple[int, str]:
    path.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8")
    res = subprocess.run([sys.executable, str(VALIDATOR), "--quiet", str(path)],
                         capture_output=True, text=True, cwd=str(ROOT))
    return res.returncode, (res.stdout or "") + (res.stderr or "")


def main() -> int:
    if not PART.exists():
        print(f"validate_channel_macros_selftest: {PART} is missing")
        return 1
    clean = yaml.safe_load(PART.read_text(encoding="utf-8"))
    if PID not in ((clean.get("codegen") or {}).get("channel_macros") or {}):
        print(f"validate_channel_macros_selftest: {PART.name}'s codegen.channel_macros "
              f"has no {PID} entry any more - this plant needs a live target with a real "
              "sdk_repeat: channels row and a real channel_macros map to remove pieces of; "
              "find another")
        return 1
    failures = []

    with tempfile.TemporaryDirectory() as tmp:
        scratch = pathlib.Path(tmp) / PART.name
        # THE POSITIVE HALF: round-tripped through yaml.safe_dump, the real file must still
        # validate clean - without it a checker that refuses everything, or a dump that
        # mangles the file, would make every case below "pass" for the wrong reason.
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
                print(f"        got exit {code}: {flat.strip()[:400]}")

    print(f"\n{len(CASES) - len(failures)}/{len(CASES)} planted breaks caught")
    for f in failures:
        print(f"  MISSED  {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
