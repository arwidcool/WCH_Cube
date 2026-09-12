#!/usr/bin/env python3
"""Cross-check CH32H417's per-pin AF map against the DS's OWN second reading.

    python tools/audit_h417_af.py            # report differences
    python tools/audit_h417_af.py --source   # what tables 2-2-x say, per signal

Why
---
`data/mcus/CH32H417.yaml` carries every pin/AF assignment from ONE reading: DS Table 2-1-1,
which is PIN-first (one row per package pin, listing every function on it). This repository's
standing rule is that a mechanical extraction is confirmed against an INDEPENDENT second
source - CH32V006's 232 remap assignments were re-derived that way with 0 differences - and
`CH32H417.notes.md` records that this map has not been.

The DS supplies the second reading itself, and it is structurally independent. Tables
2-2-1 .. 2-2-31 are PERIPHERAL-first: one table per peripheral family, giving each signal's
optional pins and AF code. A pin row read top-down and a signal row read left-to-right are
different parsing problems over differently laid-out text, so a bug in one does not
reproduce in the other.

Both directions are reported, and they mean different things:
  * the file has a pair the 2-2 tables do not  -> possibly INVENTED. That is a defect.
  * the 2-2 tables have a pair the file does not -> possibly a GAP. Not a defect.
Conflating the two is how an audit becomes a way of switching failures off.
"""
from __future__ import annotations

import argparse
import collections
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DS = ROOT / "data" / "sources" / "H417" / "Datasheets" / "CH32H417DS0.md"
MCU = ROOT / "data" / "mcus" / "CH32H417.yaml"

# The 2-2 tables' cell format: `PA8(AF7)`, `PB6(AF7), PB14(AF4)`.
CELL = re.compile(r"\bP([A-F])(\d{1,2})\s*\(\s*AF(\d{1,2})\s*\)")
# A row begins with a signal name, sometimes behind markdown's `## ` or a stray bullet.
SIGNAL = re.compile(r"^[#\s*]*([A-Z][A-Za-z0-9]*_[A-Za-z0-9_]+)\b")
# `Table 2-2-9 USART Pin functions`
TABLE = re.compile(r"^Table 2-2-(\d+)\s+(.*)$", re.M)


def ds_text() -> str:
    if not DS.is_file():
        sys.exit(f"audit_h417_af: {DS} not found")
    return DS.read_text(encoding="utf-8", errors="replace")


def ds_pairs() -> dict[str, set[tuple[str, int]]]:
    """{signal: {(pin, af)}} read from the DS's Tables 2-2-*.

    The PDF conversion interleaves a table's signal labels with its cells, so this walks
    the body and attaches each cell to the most recent signal name above it. That is the
    same `signal -> (pin, af)` shape the MCU file stores, which is what makes the two
    comparable at all.
    """
    text = ds_text()
    heads = [(m.start(), m.group(1)) for m in TABLE.finditer(text)]
    out: dict[str, set[tuple[str, int]]] = collections.defaultdict(set)

    for i, (start, _num) in enumerate(heads):
        end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
        body = text[start:end]
        current = None
        for line in body.splitlines():
            m = SIGNAL.match(line)
            if m:
                current = m.group(1)
            # A line can carry the label and cells together, so read the cells after the
            # label on the same line rather than skipping it.
            for port, num, af in CELL.findall(line):
                if current is None:
                    continue
                out[current].add((f"P{port}{num}", int(af)))
    return out


def mcu_pairs() -> dict[str, set[tuple[str, int]]]:
    """{peripheral-qualified signal: {(pin, af)}} from the MCU file's `signal_pins:`."""
    import yaml
    doc = yaml.safe_load(MCU.read_text(encoding="utf-8"))
    out: dict[str, set[tuple[str, int]]] = collections.defaultdict(set)
    for pid, P in (doc.get("peripherals") or {}).items():
        for sig, entries in ((P or {}).get("signal_pins") or {}).items():
            full = sig if sig.startswith(pid + "_") else f"{pid}_{sig}"
            for e in entries:
                if isinstance(e, dict) and e.get("pin") and e.get("af") is not None:
                    out[full].add((e["pin"], int(e["af"])))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--source", action="store_true",
                    help="print what the DS's tables 2-2-x say, per signal")
    ap.add_argument("--limit", type=int, default=25, help="differences to print per side")
    a = ap.parse_args()

    ds = ds_pairs()
    mcu = mcu_pairs()

    if a.source:
        for sig in sorted(ds):
            pairs = ", ".join(f"{p}(AF{af})" for p, af in sorted(ds[sig]))
            print(f"  {sig:26} {pairs}")
        print(f"\n{len(ds)} signal(s) from the DS's tables 2-2-x")
        return 0

    print(f"DS tables 2-2-x : {len(ds)} signal(s), {sum(len(v) for v in ds.values())} pair(s)")
    print(f"MCU file        : {len(mcu)} signal(s), {sum(len(v) for v in mcu.values())} pair(s)")

    # Compare only signals BOTH sides name. A naming difference is then reported as a
    # naming difference rather than as hundreds of invented pins.
    common = sorted(set(ds) & set(mcu))
    only_ds = sorted(set(ds) - set(mcu))
    only_mcu = sorted(set(mcu) - set(ds))

    invented, missing = [], []
    for sig in common:
        invented += [f"{sig} {p} AF{af}" for p, af in sorted(mcu[sig] - ds[sig])]
        missing += [f"{sig} {p} AF{af}" for p, af in sorted(ds[sig] - mcu[sig])]

    print(f"\n  signals in both readings                  : {len(common)}")
    print(f"  only in the DS tables 2-2-x               : {len(only_ds)}")
    if only_ds[:8]:
        print(f"      {', '.join(only_ds[:8])}")
    print(f"  only in the MCU file                      : {len(only_mcu)}")
    if only_mcu[:8]:
        print(f"      {', '.join(only_mcu[:8])}")
    print(f"\n  MCU pairs the 2-2 tables do NOT have (possible inventions): {len(invented)}")
    for line in invented[:a.limit]:
        print(f"      {line}")
    print(f"  DS 2-2 pairs the MCU file does NOT have (possible gaps)   : {len(missing)}")
    for line in missing[:a.limit]:
        print(f"      {line}")

    # A cross-check that compares nothing is worse than no check at all.
    if not common:
        print("\n  AUDIT FAILED: the two readings share no signal name, so nothing was "
              "compared - the parser or the naming convention moved.")
        return 2
    return 1 if invented else 0


if __name__ == "__main__":
    sys.exit(main())
