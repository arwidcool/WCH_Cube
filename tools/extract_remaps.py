#!/usr/bin/env python3
"""
extract_remaps.py -- AGENT-1 (DATA), second-pass verification.

Re-derives every alternate-function remap table in RM section 7.2.11 straight from
`data/sources/CH32V00XRM.md`, independently of how `data/mcus/CH32V006.yaml` was first
written, then diffs the two.

Usage:
    python tools/extract_remaps.py                 # diff RM vs YAML, human report
    python tools/extract_remaps.py --json          # dump the RM-derived tables as JSON
    python tools/extract_remaps.py --rm PATH --yaml PATH

Exit codes:  0 = identical   1 = differences found   2 = could not parse the RM

Why the parser looks like this
------------------------------
The RM markdown is a PDF text dump. Three things are broken in it and the parser has to
survive all three, while still failing loudly rather than silently inventing data:

  1. A table row wraps across two lines, with the label only on the first:
         ## TIM1_ETR PC5 PD4 PC5 PC2
         ## PD4 PD4 PD4 PB4 PB4 PB4
     Values stay in column order across the wrap, so concatenation is safe.
  2. A row label itself wraps:  "## USART1_CT" / "## S" / "## PD3 PC6 ..."
  3. Page-break junk ("CH32V00X Reference Manual ... https://wch-ic.com", "## V1.4  73",
     "mapping mapping mapping ...") lands in the middle of a table.

The self-check that makes this trustworthy: every row must end up with EXACTLY the
table's column count. A mis-parse almost always changes a row length, so a wrong answer
becomes a hard error instead of a plausible-looking table.
"""

import argparse
import json
import re
import sys
from pathlib import Path

PIN_RE = re.compile(r"P[A-D][0-7]")

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RM = ROOT / "data" / "sources" / "CH32V00XRM.md"
DEFAULT_YAML = ROOT / "data" / "mcus" / "CH32V006.yaml"

# --------------------------------------------------------------------------------------
# Which tables to read, and how each maps onto the YAML.
#   signals  -- RM row labels, in the order the RM prints them
#   ncols    -- number of remap columns = number of register values
#   periph   -- peripheral key in the YAML
#   strip    -- prefix removed from the RM label to get the YAML signal key
# CH32V006 is a CH32V002/004/005/006-class part, so it uses Table 7-9-1 (not 7-9-2) and
# Table 7-13-1 (not 7-13-2). Picking the wrong twin is the classic error here, so the
# `end` marker for each table is the heading of its twin.
# --------------------------------------------------------------------------------------
TABLES = [
    dict(name="Table 7-8 TIM1", periph="TIM1", strip="TIM1_", ncols=10,
         start="Table 7-8 TIM1 alternate function remapping",
         end="Table 7-9-1",
         signals=["TIM1_ETR", "TIM1_CH1", "TIM1_CH2", "TIM1_CH3", "TIM1_CH4",
                  "TIM1_BKIN", "TIM1_CH1N", "TIM1_CH2N", "TIM1_CH3N"]),
    dict(name="Table 7-9-1 TIM2", periph="TIM2", strip="TIM2_", ncols=8,
         start="Table 7-9-1 TIM2 alternate function remapping",
         end="Table 7-9-2",
         signals=["TIM2_ETR", "TIM2_CH1", "TIM2_CH2", "TIM2_CH3", "TIM2_CH4"]),
    dict(name="Table 7-10 USART1", periph="USART1", strip="USART1_", ncols=10,
         start="Table 7-10 USART1 alternate function remapping",
         end="Table 7-11",
         signals=["USART1_TX", "USART1_RX", "USART1_CTS", "USART1_RTS"]),
    dict(name="Table 7-11 USART2", periph="USART2", strip="USART2_", ncols=7,
         start="Table 7-11 USART2 alternate function remapping",
         end="7.2.11.3",
         signals=["USART2_TX", "USART2_RX", "USART2_CTS", "USART2_RTS"]),
    dict(name="Table 7-12 SPI", periph="SPI1", strip="SPI_", ncols=7,
         start="Table 7-12 SPI alternate function remapping",
         end="7.2.11.4",
         signals=["SPI_NSS", "SPI_SCK", "SPI_MISO", "SPI_MOSI"]),
    dict(name="Table 7-13-1 I2C", periph="I2C1", strip="I2C_", ncols=5,
         start="Table 7-13-1 I2C alternate function remapping",
         end="Table 7-13-2",
         signals=["I2C_SCL", "I2C_SDA"]),
]

# ADC triggers are printed as prose, not as a pin grid (RM Tables 7-14 / 7-15).
ADC_TABLES = [
    dict(name="Table 7-14 ADC injected trigger", keys=["IETR0", "IETR1"],
         start="Table 7-14 ADC external trigger injection", end="Table 7-15"),
    dict(name="Table 7-15 ADC regular trigger", keys=["RETR0", "RETR1"],
         start="Table 7-15 ADC external trigger rule", end="7.3 Register Description"),
]


def slice_block(lines, start_sub, end_sub, what):
    """Return the lines between the two markers. Raises if the block is not found."""
    first = last = None
    for i, ln in enumerate(lines):
        if first is None:
            if start_sub in ln:
                first = i + 1
            continue
        if end_sub in ln:
            last = i
            break
    if first is None:
        raise LookupError(what + ": start marker not found: " + repr(start_sub))
    if last is None:
        raise LookupError(what + ": end marker not found: " + repr(end_sub))
    return lines[first:last]


def parse_grid(block, signals, ncols, what):
    """Parse a wrapped pin grid into {signal: [pin per column]}."""
    rows, order = {}, []
    idx = 0            # index of the signal we are currently looking for
    pending = ""       # partially assembled row label
    cur = None         # pin list of the row being filled

    for raw in block:
        s = raw.strip()
        if s.startswith("##"):
            s = s[2:].strip()
        if not s:
            continue
        toks = s.split()
        pins = [t for t in toks if PIN_RE.fullmatch(t)]
        nonpins = [t for t in toks if not PIN_RE.fullmatch(t)]

        # A row is open and still short: only pure pin lines continue it. Anything else
        # on this line is page-break junk and is skipped.
        if cur is not None and len(cur) < ncols:
            if pins and not nonpins:
                cur.extend(pins)
            continue

        if idx >= len(signals):
            break
        if not nonpins:
            continue   # stray pins with no row open

        want = signals[idx]
        frag = "".join(nonpins)          # "USART1_CT" + "S" -> "USART1_CTS"
        matched = False
        for cand in (pending + frag, frag):
            if want.startswith(cand):
                pending = cand
                matched = True
                if pending == want:
                    cur = list(pins)
                    rows[want] = cur
                    order.append(want)
                    idx += 1
                    pending = ""
                break
        if not matched:
            pending = ""

    missing = [s for s in signals if s not in rows]
    if missing:
        raise LookupError(what + ": rows never found: " + ", ".join(missing))
    bad = [(s, len(rows[s])) for s in signals if len(rows[s]) != ncols]
    if bad:
        raise LookupError(
            what + ": wrong column count (expected " + str(ncols) + "): "
            + ", ".join(s + "=" + str(n) for s, n in bad))
    if order != signals:
        raise LookupError(what + ": rows out of order: " + str(order))
    return rows


def parse_adc(block, keys, what):
    """RM 7-14 / 7-15 read as prose: '... conversion connect to PD1'."""
    pins = []
    for raw in block:
        m = re.search(r"connect to\s+(P[A-D][0-7])", raw)
        if m:
            pins.append(m.group(1))
    if len(pins) != len(keys):
        raise LookupError(what + ": expected " + str(len(keys))
                          + " 'connect to' pins, got " + str(pins))
    return dict(zip(keys, pins))


def extract(rm_path):
    """RM -> {periph: {signal: [pin, ...]}} plus a flat ADC trigger map."""
    lines = Path(rm_path).read_text(encoding="utf-8", errors="replace").splitlines()
    out, problems = {}, []

    for t in TABLES:
        try:
            block = slice_block(lines, t["start"], t["end"], t["name"])
            rows = parse_grid(block, t["signals"], t["ncols"], t["name"])
        except LookupError as e:
            problems.append(str(e))
            continue
        table = {sig[len(t["strip"]):]: pins for sig, pins in rows.items()}

        # TIM2 shares one pin between CH1 and ETR; the RM prints two identical rows.
        # Verify that before collapsing them into the YAML's single CH1_ETR signal.
        if t["periph"] == "TIM2":
            if table.get("ETR") != table.get("CH1"):
                problems.append(
                    t["name"] + ": ETR and CH1 rows differ, so they cannot be merged into "
                    "CH1_ETR. ETR=" + str(table.get("ETR")) + " CH1=" + str(table.get("CH1")))
                continue
            merged = {"CH1_ETR": table["CH1"]}
            for k, v in table.items():
                if k not in ("ETR", "CH1"):
                    merged[k] = v
            table = merged
        out[t["periph"]] = table

    adc = {}
    for t in ADC_TABLES:
        try:
            block = slice_block(lines, t["start"], t["end"], t["name"])
            adc.update(parse_adc(block, t["keys"], t["name"]))
        except LookupError as e:
            problems.append(str(e))
    if adc:
        out["ADC1"] = {k: [v] for k, v in adc.items()}   # single-column "table"

    return out, problems


def from_yaml(yaml_path):
    """YAML -> the same {periph: {signal: [pin per remap index]}} shape."""
    try:
        import yaml
    except ImportError:
        print("PyYAML is required:  pip install pyyaml", file=sys.stderr)
        raise SystemExit(2)
    doc = yaml.safe_load(Path(yaml_path).read_text(encoding="utf-8"))
    out = {}
    for periph, spec in (doc.get("peripherals") or {}).items():
        remaps = (spec or {}).get("remaps")
        if not remaps:
            continue
        table = {}
        for i, rm in enumerate(remaps):
            for sig, pin in (rm.get("pins") or {}).items():
                table.setdefault(sig, [None] * len(remaps))[i] = pin
        out[periph] = table
    return out, doc


def diff(rm, yml):
    """Compare the RM-derived tables against the YAML. Returns a list of complaints."""
    problems = []
    for periph in sorted(rm):
        rm_table = rm[periph]
        yml_table = yml.get(periph)
        if yml_table is None:
            problems.append(periph + ": RM has a remap table, YAML has no peripheral with remaps")
            continue

        if periph == "ADC1":
            # ADC triggers live in ADC1's single "Default" remap alongside IN0..IN7,
            # so compare only the four trigger keys.
            for sig in sorted(rm_table):
                want = rm_table[sig][0]
                got = yml_table.get(sig)
                if got is None:
                    problems.append("ADC1." + sig + ": missing from YAML (RM says " + want + ")")
                elif got[0] != want:
                    problems.append("ADC1." + sig + ": RM says " + want
                                    + ", YAML says " + str(got[0]))
            continue

        ncols = len(next(iter(rm_table.values())))
        got_cols = len(next(iter(yml_table.values()))) if yml_table else 0
        if got_cols != ncols:
            problems.append(periph + ": RM has " + str(ncols) + " remap columns, YAML has "
                            + str(got_cols))

        for sig in sorted(set(rm_table) | set(yml_table)):
            if sig not in yml_table:
                problems.append(periph + "." + sig + ": in RM, missing from YAML")
                continue
            if sig not in rm_table:
                problems.append(periph + "." + sig + ": in YAML, not a row in the RM table")
                continue
            for i, (a, b) in enumerate(zip(rm_table[sig], yml_table[sig])):
                if a != b:
                    problems.append(periph + "." + sig + "[remap " + str(i) + "]: RM says "
                                    + str(a) + ", YAML says " + str(b))
    return problems


def main():
    ap = argparse.ArgumentParser(description="Re-derive RM 7.2.11 remap tables and diff them against an MCU YAML.")
    ap.add_argument("--rm", default=str(DEFAULT_RM))
    ap.add_argument("--yaml", dest="yml", default=str(DEFAULT_YAML))
    ap.add_argument("--json", action="store_true", help="print the RM-derived tables and exit")
    args = ap.parse_args()

    rm, parse_problems = extract(args.rm)
    if args.json:
        print(json.dumps(rm, indent=2, sort_keys=True))
        return 2 if parse_problems else 0

    print("RM   : " + args.rm)
    print("YAML : " + args.yml + "\n")

    if parse_problems:
        print("RM PARSE FAILURES -- the extractor could not read these tables:")
        for p in parse_problems:
            print("  ! " + p)
        print()

    rows = sum(len(t) for t in rm.values())
    cells = sum(len(v) for t in rm.values() for v in t.values())
    print("Re-derived from the RM: " + str(len(rm)) + " peripherals, " + str(rows)
          + " signal rows, " + str(cells) + " pin assignments.")
    for periph in sorted(rm):
        n = len(next(iter(rm[periph].values())))
        print("  " + periph.ljust(8) + " " + str(len(rm[periph])) + " signals x "
              + str(n) + " remap(s)")
    print()

    yml, _doc = from_yaml(args.yml)
    problems = diff(rm, yml)

    if problems:
        print("DIFFERENCES: " + str(len(problems)))
        for p in problems:
            print("  x " + p)
    else:
        print("DIFFERENCES: 0 -- every pin in the YAML matches the RM table it cites.")

    if parse_problems:
        return 2
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
