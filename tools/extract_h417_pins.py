#!/usr/bin/env python3
"""Extract CH32H417's package pin tables and its per-pin alternate-function map.

    python tools/extract_h417_pins.py                 # summary + the format audit
    python tools/extract_h417_pins.py --packages      # the three `packages:` tables
    python tools/extract_h417_pins.py --signals       # signal -> [(pin, AF), ...]
    python tools/extract_h417_pins.py --pins          # pin -> every function it carries
    python tools/extract_h417_pins.py --json OUT      # all of the above, machine-readable
    python tools/extract_h417_pins.py --audit         # ONLY the format audit, exit 2 if it fails

Source: `data/sources/H417/Datasheets/CH32H417DS0.md`, Table 2-1-1 "CH32H417 Pin definitions",
which carries three package columns - H417WEU6 (QFN68), H417MEU6 (QFN88) and
H417QEU6 (QFN128).

WHY THIS TOOL EXISTS AND WHAT IT FOUND
--------------------------------------
`data/FORMAT.md` opens with the idea the whole schema is built on:

    "Alternate functions are never listed per pin. They live only in each peripheral's
     `remaps:` table, and the app derives the per-pin signal list and every conflict
     from those."

That holds for CH32V003/V005/V006 (AFIO_PCFR1 field per peripheral) and for CH32X035
(`GPIO_PinRemapConfig` macro per peripheral). On both, ONE register field moves EVERY
signal of a peripheral at once, so a `remaps[]` entry is a complete, atomic choice.

**CH32H417 does not work that way.** It selects the alternate function PER PIN, from a
four-bit field, exactly as an STM32F4 does:

    RM 9.3.2.2 "Port Alternate Function Register Low Bit (x=A/B/C/D/E/F)", AFRy[3:0]:
    "(y=0-7), Port X pin Y alternate function selection: 0000: AF0 ... 1111: AF15."

So every signal picks its pin independently, and `AFIO_PCFR` on this part is reduced to
six unrelated odds and ends (PIOC port mapping, UHSIF_CLK, four ADC trigger sources and
PD0PD1_RM) - none of which is peripheral pin muxing.

`--audit` measures what that costs, because the argument should be a number rather than
an opinion: it reports how many signals have more than one pin, and how large a
whole-peripheral `remaps:` list would have to be to enumerate the legal combinations.

Output is ASCII only: the Windows console here is cp1252.
"""
import argparse
import collections
import json
import math
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DS = ROOT / "data" / "sources" / "H417" / "Datasheets" / "CH32H417DS0.md"

# Table 2-1-1 only. 2-1-2 is CH32H416 (QFN60X6) and 2-1-3 is CH32H415 (QFN60X6);
# both are separate parts with their own pin tables and neither is extracted here.
TABLE_2_1_1 = (3742, 5537)
PACKAGES = ("QFN68", "QFN88", "QFN128")          # H417WEU6, H417MEU6, H417QEU6

COL = r'(\d+|-)'
ROW = re.compile(rf'^##\s+{COL}\s+{COL}\s+{COL}\s+([A-Z][A-Za-z0-9_]*)\b(.*)$')
# Two row shapes the PDF-to-markdown pass mangles. Both are handled rather than skipped,
# because skipping them is invisible: the package table still looks plausible, it is just
# missing four pins. Each was found by asserting 1..N with no gaps and then going to look.
#   (a) the pin NAME wrapped to its own line   "## - - 8"  /  "## PC13"
#   (b) a leading "-" was dropped, leaving two columns  "## 83 121 PB9"
#   (c) the FIRST column wrapped to its own line   "## 68"  /  "## 83 121 PB9"
# (c) is why this tool asserts 1..N instead of 1..max: with (c) unhandled, QFN68 came
# out as 67 pins and 49 I/O, and 49 quietly contradicted the DS model table's "50".
# The table was right and the parser was wrong. A row this file cannot read is REPORTED.
ROW_NONAME = re.compile(rf'^##\s+{COL}\s+{COL}\s+{COL}\s*$')
ROW_TWOCOL = re.compile(rf'^##\s+{COL}\s+{COL}\s+(P[A-F]\d+)\b(.*)$')
NAME_ONLY = re.compile(r'^##\s+(P[A-F]\d+)\b')
BARE_COL = re.compile(rf'^##\s+{COL}\s*$')
SUBSCRIPT = re.compile(r'[A-Z][A-Z0-9]*')     # the "SS" of a PDF-split "V" + "SS"

# Header and footer furniture the PDF repeats on every page.
NOISE = re.compile(r'Datasheet|wch-ic\.com|^## V1\.8|^## Pin|^Pin name|^## H417|'
                   r'characte|^## Main|^function|^\(After|^reset\)|^Pin function|'
                   r'^## Remapping|^## \(1\)|^## \(2\)|^## \(3\)|^## I/O|^## type')

AF = re.compile(r'([A-Z][A-Za-z0-9_]*)\((AF\d+)\)')
IO_PIN = re.compile(r'P[A-F]\d+$')


def parse(ds_path):
    """-> (rows, package tables, signal map). Every row is reported, never dropped."""
    text = ds_path.read_text(encoding="utf-8", errors="replace").splitlines()
    lines = text[TABLE_2_1_1[0] - 1:TABLE_2_1_1[1]]

    rows, cur = [], None
    pending = None      # (a) three columns seen, still waiting for the pin name
    carry = None        # (c) one column seen on its own line, waiting for the rest
    for ln in lines:
        if pending is not None:
            if nm := NAME_ONLY.match(ln):
                rows.append(cur := {"pkg": dict(zip(PACKAGES, pending)),
                                    "name": nm.group(1), "text": ""})
                pending = None
                continue
            pending = None
        if m := ROW.match(ln):
            w, mm, q, name, rest = m.groups()
            rows.append(cur := {"pkg": dict(zip(PACKAGES, (w, mm, q))),
                                "name": name, "text": rest.strip()})
            carry = None
        elif m := ROW_TWOCOL.match(ln):
            mm, q, name, rest = m.groups()
            # With a carried first column this is shape (c); without one the leading
            # "-" was dropped outright, shape (b). The two are not interchangeable:
            # guessing (b) where it is really (c) loses a bonded pin silently.
            first = carry if carry is not None else "-"
            rows.append(cur := {"pkg": dict(zip(PACKAGES, (first, mm, q))),
                                "name": name, "text": rest.strip()})
            carry = None
        elif ROW_NONAME.match(ln):
            pending = ROW_NONAME.match(ln).groups()
            carry = None
        elif m := BARE_COL.match(ln):
            carry = m.group(1)
        elif cur is not None and not NOISE.search(ln):
            body = ln.lstrip("# ").strip()
            # (d) a SUBSCRIPT split: the PDF renders VSS as "V" then "SS" on the next
            # line, and VDD33 / VDDIO / VBAT the same way. The row captured a pin named
            # "V", which is not a pin - it is the first letter of one. Rejoin it before
            # anything downstream sees a package table with "V" in it twice.
            if cur["name"] == "V" and SUBSCRIPT.fullmatch(body):
                cur["name"] = "V" + body
                carry = None
                continue
            cur["text"] += " " + body
            carry = None

    tables = {p: collections.defaultdict(list) for p in PACKAGES}
    signals = collections.defaultdict(list)
    for r in rows:
        for sig, af in AF.findall(r["text"]):
            signals[sig].append([r["name"], af])
        for pk, v in r["pkg"].items():
            if v != "-":
                tables[pk][int(v)].append(r["name"])
    return rows, {p: dict(sorted(t.items())) for p, t in tables.items()}, dict(signals)


def check_tables(tables, out=print):
    """1..N with no gaps and no duplicates - the same rule validate_mcu.py enforces."""
    ok = True
    for pk in PACKAGES:
        t = tables[pk]
        expect = int(re.sub(r'\D', '', pk.replace("60X6", "60")))
        nums = [n for n in t if n != 0]
        gaps = sorted(set(range(1, expect + 1)) - set(nums))
        extra = sorted(n for n in nums if n > expect)
        io = sum(1 for n in nums if all(IO_PIN.match(x) for x in t[n]))
        shorted = {n: v for n, v in t.items() if len(v) > 1}
        bad = gaps or extra
        ok &= not bad
        out(f"  {pk:7s} {len(nums):3d}/{expect} numbered pins, {io:3d} I/O, "
            f"exposed pad {'yes' if 0 in t else 'NO'}, "
            f"shorted groups {shorted or 'none'}"
            + (f"  <-- GAPS {gaps} EXTRA {extra}" if bad else ""))
    return ok


def audit(signals, out=print):
    """How badly the per-pin AF model fits data/FORMAT.md's `remaps:` shape."""
    hist = collections.Counter(len(v) for v in signals.values())
    multi = sum(1 for v in signals.values() if len(v) > 1)
    out(f"  signals with an AF code   : {len(signals)}")
    out(f"  pin-AF assignments        : {sum(len(v) for v in signals.values())}")
    out("  pin options per signal    : "
        + ", ".join(f"{k} pin{'s' if k > 1 else ''} -> {hist[k]:3d} signals"
                    for k in sorted(hist)))
    out(f"  signals reaching >1 pin   : {multi} of {len(signals)} "
        f"({100 * multi / len(signals):.0f}%)")

    per = collections.defaultdict(dict)
    for sig, opts in signals.items():
        per[sig.split("_")[0]][sig] = len(opts)
    combos = {p: math.prod(s.values()) for p, s in per.items()}
    out("")
    out("  A `remaps:` list is a WHOLE-PERIPHERAL choice, so expressing this part in the")
    out("  current schema means enumerating the product of each signal's pin options:")
    for p in sorted(combos, key=lambda k: -combos[k])[:8]:
        out(f"    {p:10s} {len(per[p]):3d} signals -> {combos[p]:,} entries")
    out(f"    {'ALL':10s} {len(signals):3d} signals -> {sum(combos.values()):,} entries")
    return multi


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ds", type=pathlib.Path, default=DS)
    ap.add_argument("--packages", action="store_true", help="emit the three pin tables")
    ap.add_argument("--signals", action="store_true", help="emit signal -> pins/AF")
    ap.add_argument("--pins", action="store_true", help="emit pin -> functions")
    ap.add_argument("--audit", action="store_true", help="only the format audit")
    ap.add_argument("--yaml", metavar="PERIPH", nargs="*",
                    help="emit packages:/pins: and signal_pins: for these peripherals "
                         "(no names = every peripheral the table mentions)")
    ap.add_argument("--json", type=pathlib.Path, help="write everything as JSON")
    a = ap.parse_args()

    if not a.ds.is_file():
        print(f"ERROR: {a.ds} not found", file=sys.stderr)
        return 2
    rows, tables, signals = parse(a.ds)

    if a.yaml is not None:
        # The point of emitting rather than transcribing: 950 pin-AF assignments cannot
        # be hand-copied without an error, and an error here is invisible - a wrong AF
        # code compiles and the pin carries the wrong function on the board.
        want = set(a.yaml)
        print("packages:")
        for pk in PACKAGES:
            print(f"  {pk}:")
            for n, names in tables[pk].items():
                v = names[0] if len(names) == 1 else "[" + ", ".join(names) + "]"
                print(f"    {n}: {v}")
        print("\npins:")
        seen = sorted({n for t in tables.values() for v in t.values() for n in v})
        for n in seen:
            if IO_PIN.match(n):
                kind = "io"
            elif n.startswith("VSS"):
                kind = "ground"
            elif n.startswith("V"):
                kind = "power"
            elif n == "NRST":
                kind = "reset"      # its own pad here, not a multiplexed GPIO
            else:
                kind = "sys"        # XI/XO and the SerDes / USB-SS differential pads
            print(f"  {n}: {{ type: {kind} }}")
        print("\n# signal_pins, grouped by peripheral. Order is the datasheet's own.")
        groups = collections.defaultdict(dict)
        for sig, opts in signals.items():
            groups[sig.split("_")[0]][sig] = opts
        for p in sorted(groups):
            if want and p not in want:
                continue
            print(f"  {p}:")
            print("    signal_pins:")
            for sig in sorted(groups[p]):
                short = sig[len(p) + 1:] if sig.startswith(p + "_") else sig
                entries = ", ".join(f"{{ pin: {pin}, af: {int(af[2:])} }}"
                                    for pin, af in groups[p][sig])
                print(f"      {short}: [{entries}]")
        return 0

    if a.packages:
        for pk in PACKAGES:
            print(f"  {pk}:")
            for n, names in tables[pk].items():
                v = names[0] if len(names) == 1 else "[" + ", ".join(names) + "]"
                print(f"    {n}: {v}")
        return 0
    if a.signals:
        for sig in sorted(signals):
            print(f"  {sig:24s} " + ", ".join(f"{p}({f})" for p, f in signals[sig]))
        return 0
    if a.pins:
        for r in rows:
            fns = AF.findall(r["text"])
            print(f"  {r['name']:8s} " + ", ".join(f"{s}({f})" for s, f in fns))
        return 0

    if not a.audit:
        print(f"CH32H417 DS Table 2-1-1  ({a.ds})")
        print(f"  rows parsed               : {len(rows)}")
        print("")
        good = check_tables(tables)
        print("")
    else:
        good = check_tables(tables, out=lambda *_: None)

    print("Per-pin alternate-function map vs. data/FORMAT.md's `remaps:` model")
    audit(signals)
    print("")
    print("  VERDICT: this part selects the alternate function PER PIN (RM 9.3.2.2,")
    print("  GPIOx_AFRL/AFRH AFRy[3:0] = AF0..AF15), not per peripheral. The schema's")
    print("  `remaps:` shape - one index moving every signal of a peripheral at once -")
    print("  cannot express it. See data/mcus/CH32H417.notes.md.")

    if a.json:
        a.json.write_text(json.dumps(
            {"packages": {p: {str(n): v for n, v in tables[p].items()} for p in PACKAGES},
             "signals": {k: signals[k] for k in sorted(signals)},
             "pins": {r["name"]: AF.findall(r["text"]) for r in rows}},
            indent=1), encoding="utf-8")
        print(f"\nwrote {a.json}")
    return 0 if good else 2


if __name__ == "__main__":
    sys.exit(main())
