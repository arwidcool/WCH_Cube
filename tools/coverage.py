#!/usr/bin/env python3
"""coverage.py -- the coverage ledger, closed to zero. The loop tool and the gate.

    python tools/coverage.py CH32L103            # every OPEN row for one part; exit 1 while any remain
    python tools/coverage.py                     # every real part, one after the other
    python tools/coverage.py CH32L103 --all      # every row, not only the open ones
    python tools/coverage.py --gate              # what the test suite runs: each part against its
                                                 # declared status (complete: 0 open; in_extraction:
                                                 # the open count is exactly what its coverage file
                                                 # records, and its task line is in TASKS.md)
    python tools/coverage.py CH32L103 --json     # machine-readable rows and counts

Exit codes
    0   no open rows (or, with --gate, every part meets its declared status)
    1   open rows remain (or a part misses its status)
    2   a source or a coverage file could not be read - never a pass

The rule this enforces is one sentence, docs/COVERAGE.md has the long form:

    Every pin-bearing fact a source states about a part is a ledger row. A row is
    MODELLED by a named signal, or ABSENT with a citation, or the build is red.

What an OPEN row means, by kind
    pin          a function the datasheet puts on a pin that no peripheral of the file
                 routes on that pin (or routes elsewhere, or with the wrong AF code)
    routing      the file routes a signal to a pin the datasheet does not list it on
    periph       a peripheral with no routing and no `pins:` declaration, or a `pins: none`
                 the datasheet contradicts, or a `pins: open` still owned by someone
    chapter      a reference-manual chapter mapped to nothing and declared nothing
    instance     an SPL instance (`#define USART4 ((USART_TypeDef *)...)`) the file lacks
    resource     a declared count (the DS model table) the file does not match
    disagreement the datasheet's two readings differ on a pin and nobody recorded it
    declaration  a declaration in the coverage file that matches nothing (dead)

Take the FIRST open row, open the cited line, then do exactly one of: model it through the
generator, or declare it in data/coverage/<PART>.yaml with a file:line. Never patch the
MCU file with an ad-hoc script. Then run this again.

Output is ASCII only: the Windows console here is cp1252.
"""
from __future__ import annotations

import argparse
import json
import sys

import coverage_lib as C


def print_part(res: C.Result, show_all: bool) -> None:
    cov = res.cov
    head = f"coverage: {res.part}  ({cov['status']}" + (f", {cov.get('owner')}" if cov.get("owner") else "") + ")"
    print(C.safe(head))
    rows = res.rows if show_all else res.open
    order = {"open": 0, "disagreement": 1, "absent": 2, "modelled": 3, "unread": 4}
    for r in sorted(rows, key=lambda r: (order.get(r.status, 9), r.kind, r.key)):
        tag = {"open": "OPEN", "modelled": "ok  ", "absent": "abs ", "disagreement": "diff", "unread": "pad "}[r.status]
        print(C.safe(f"  {tag}  {r.kind:12s} {r.key:34s} {r.detail}"))
        print(C.safe(f"        {' ' * 12} {'':34s} {r.cite}"))
    n = {s: res.count(s) for s in ("modelled", "absent", "disagreement", "open", "unread")}
    print(C.safe(f"  modelled {n['modelled']} . absent {n['absent']} . disagreements {n['disagreement']} . "
                 f"pads {n['unread']} . OPEN {n['open']}"))


def main() -> int:
    ap = argparse.ArgumentParser(description="the coverage ledger: what the sources say, joined to the MCU file")
    ap.add_argument("parts", nargs="*", help="mcu.name(s); default: every real part")
    ap.add_argument("--all", action="store_true", help="print every row, not only the open ones")
    ap.add_argument("--gate", action="store_true", help="check each part against its declared status")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--quiet", action="store_true", help="only the summary lines")
    a = ap.parse_args()

    parts = a.parts or C.real_parts()
    if not parts:
        print("coverage: no MCU files under data/mcus/")
        return 2

    results: dict[str, C.Result] = {}
    errors: dict[str, str] = {}
    for part in parts:
        try:
            results[part] = C.build(part)
        except C.CoverageError as e:
            errors[part] = str(e)

    if a.json:
        out = {"parts": {}, "errors": errors}
        for part, res in results.items():
            ok, msg = C.verdict(res)
            out["parts"][part] = {
                "status": res.cov["status"], "owner": res.cov.get("owner"),
                "open_rows_recorded": res.cov.get("open_rows"),
                "counts": {s: res.count(s) for s in ("modelled", "absent", "disagreement", "open", "unread")},
                "gate_ok": ok, "gate_message": msg,
                "rows": [r.as_dict() for r in res.rows],
            }
        print(json.dumps(out, indent=1))
        if errors:
            return 2
        if a.gate:
            return 0 if all(v["gate_ok"] for v in out["parts"].values()) else 1
        return 0 if all(not r.open for r in results.values()) else 1

    for part, msg in errors.items():
        print(C.safe(f"coverage: {part}: CANNOT READ - {msg}"))

    if a.gate:
        bad = 0
        for part, res in results.items():
            ok, msg = C.verdict(res)
            print(C.safe(f"  {'PASS' if ok else 'FAIL'}  {part:10s} {msg}"))
            if not ok:
                bad += 1
                for r in res.open[:8]:
                    print(C.safe(f"          OPEN {r.kind:12s} {r.key:34s} {r.detail[:90]}"))
                if len(res.open) > 8:
                    print(C.safe(f"          ... {len(res.open) - 8} more; run: python tools/coverage.py {part}"))
        if errors:
            return 2
        print(f"\ncoverage gate: {len(results) - bad} of {len(results)} part(s) meet their declared status")
        return 1 if bad else 0

    any_open = False
    for part, res in results.items():
        if a.quiet:
            n_open = len(res.open)
            print(C.safe(f"  {part:10s} OPEN {n_open}  (modelled {res.count('modelled')}, absent "
                         f"{res.count('absent')}, disagreements {res.count('disagreement')})"))
        else:
            print_part(res, a.all)
            print()
        any_open = any_open or bool(res.open)
    if errors:
        return 2
    return 1 if any_open else 0


if __name__ == "__main__":
    sys.exit(main())
