#!/usr/bin/env python3
"""
extract_remaps.py -- AGENT-1 (DATA). Independent re-derivation of the remap tables.

The MCU YAML is written by hand from the reference manual, so a typo in it looks exactly
like correct data. This tool reads the manual again, on its own, and compares.

    PASS 2   RM section 7.2.11 pin grids (Tables 7-8, 7-9-1, 7-10..7-13-1, 7-14, 7-15)
             re-parsed from data/sources/V006/Datasheets/CH32V00XRM.md, diffed against the YAML.
             A difference here is a bug in the YAML. It fails the run.

    PASS 3   RM section 7.3.2.2, the AFIO_PCFR1 register description, which spells every
             remap out a second time in prose ("0000: Default mapping (ETR/PC5, ...)").
             Diffed against the pass-2 grids. A difference here is the manual
             contradicting itself, so it is reported but does NOT fail the run --
             somebody has to decide which source is right and record it in the .notes.md.

Usage:
    python tools/extract_remaps.py                 # all passes, human report
    python tools/extract_remaps.py --json          # dump the RM-derived tables
    python tools/extract_remaps.py --no-cross-check
    python tools/extract_remaps.py --rm PATH --yaml PATH

Exit codes:  0 = YAML matches the RM   1 = differences found   2 = could not parse the RM

Why the parsers look like this
-----------------------------
The RM markdown is a PDF text dump. Four things are broken in it, and the parsers have to
survive all four while still failing loudly rather than silently inventing data:

  1. A table row wraps across two lines, with the label only on the first:
         ## TIM1_ETR PC5 PD4 PC5 PC2
         ## PD4 PD4 PD4 PB4 PB4 PB4
     Values stay in column order across the wrap, so concatenation is safe.
  2. A row label itself wraps:  "## USART1_CT" / "## S" / "## PD3 PC6 ..."
  3. Page-break junk ("CH32V00X Reference Manual ... https://wch-ic.com", "## V1.4  73",
     "mapping mapping mapping ...") lands in the middle of a table.
  4. Section 7.3.2.2 opens with the register bit-layout diagram, which prints four field
     names on one line. Matching a bare field name there starts every paragraph at the
     top of the section, and pass 3 then reads entirely the wrong text while still
     producing plausible-looking output.

The self-check that makes pass 2 trustworthy: every row must end up with EXACTLY the
table's column count. A mis-parse almost always changes a row length, so a wrong answer
becomes a hard error instead of a plausible-looking table. Pass 3's equivalent is that it
has to agree with pass 2 on 227 of 228 values.

Both parsers are negative-tested: plant a wrong pin in the YAML and pass 2 names it and
exits 1.
"""

import argparse
import json
import re
import sys
from pathlib import Path

PIN_RE = re.compile(r"P[A-D][0-7]")

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RM = ROOT / "data" / "sources" / "V006" / "Datasheets" / "CH32V00XRM.md"
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
def _bincodes(n, width):
    return [format(i, "0" + str(width) + "b") for i in range(n)]


TABLES = [
    dict(name="Table 7-8 TIM1", periph="TIM1", strip="TIM1_", ncols=10,
         start="Table 7-8 TIM1 alternate function remapping",
         end="Table 7-9-1",
         field="TIM1_RM", codes=_bincodes(10, 4),
         signals=["TIM1_ETR", "TIM1_CH1", "TIM1_CH2", "TIM1_CH3", "TIM1_CH4",
                  "TIM1_BKIN", "TIM1_CH1N", "TIM1_CH2N", "TIM1_CH3N"]),
    dict(name="Table 7-9-1 TIM2", periph="TIM2", strip="TIM2_", ncols=8,
         start="Table 7-9-1 TIM2 alternate function remapping",
         end="Table 7-9-2",
         field="TIM2_RM", codes=_bincodes(8, 3),
         signals=["TIM2_ETR", "TIM2_CH1", "TIM2_CH2", "TIM2_CH3", "TIM2_CH4"]),
    dict(name="Table 7-10 USART1", periph="USART1", strip="USART1_", ncols=10,
         start="Table 7-10 USART1 alternate function remapping",
         end="Table 7-11",
         field="USART1_RM", codes=_bincodes(10, 4),
         signals=["USART1_TX", "USART1_RX", "USART1_CTS", "USART1_RTS"]),
    dict(name="Table 7-11 USART2", periph="USART2", strip="USART2_", ncols=7,
         start="Table 7-11 USART2 alternate function remapping",
         end="7.2.11.3",
         field="USART2_RM", codes=_bincodes(7, 3),
         signals=["USART2_TX", "USART2_RX", "USART2_CTS", "USART2_RTS"]),
    dict(name="Table 7-12 SPI", periph="SPI1", strip="SPI_", ncols=7,
         start="Table 7-12 SPI alternate function remapping",
         end="7.2.11.4",
         field="SPI1_RM", codes=_bincodes(7, 3),
         signals=["SPI_NSS", "SPI_SCK", "SPI_MISO", "SPI_MOSI"]),
    dict(name="Table 7-13-1 I2C", periph="I2C1", strip="I2C_", ncols=5,
         start="Table 7-13-1 I2C alternate function remapping",
         end="Table 7-13-2",
         field="I2C1_RM", codes=["000", "001", "010", "011", "1xx"],
         signals=["I2C_SCL", "I2C_SDA"]),
]

# Third source. RM 7.3.2.2 describes AFIO_PCFR1 field by field and spells every remap out
# again in prose -- "0000: Default mapping (ETR/PC5, CH1/PD2, ...)". It is written by hand
# from the same silicon spec as the 7.2.11 grids, so agreement between the two is real
# evidence and disagreement is a fault in the source worth knowing about.
REGISTER_SECTION = ("7.3.2.2 Remap Register 1 (AFIO_PCFR1)",
                    "Chapter 8 Direct Memory Access Control")

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


def parse_register_prose(lines, table):
    """Read one AFIO_PCFR1 field's prose into {code: {signal: pin}} (RM 7.3.2.2).

    Returns (mapping, notes). `notes` collects codes the prose describes but that carry
    no pins, such as TIM1_RM=11xx (channel 1 input comes from the internal LSI).
    """
    what = table["field"] + " prose"
    block = slice_block(lines, REGISTER_SECTION[0], REGISTER_SECTION[1], what)

    # Find this field's paragraph: from its description row to the next field's.
    #
    # The section opens with the register's bit-layout diagram, which prints four field
    # names on one line ("TIM1_RM[3:0] USART1_RM[3:0] I2C1_RM[2:0] SPI1_RM[2:0]"). Matching
    # a bare field name there starts every paragraph at the top of the section and the
    # whole pass silently reads the wrong text. A description row is the row of the
    # bit table, so it carries the access column "RW" and names exactly one field.
    all_fields = [t["field"] for t in TABLES]

    def field_row(bare):
        if "RW" not in bare:
            return None
        hits = [f for f in all_fields if f + "[" in bare]
        return hits[0] if len(hits) == 1 else None

    start = None
    chunk = []
    for ln in block:
        bare = ln.lstrip("# ").strip()
        if start is None:
            if field_row(bare) == table["field"]:
                start = True
            continue
        if field_row(bare) not in (None, table["field"]):
            break
        chunk.append(bare)
    if start is None:
        raise LookupError(what + ": field description row not found in RM 7.3.2.2")

    # Collapse to one line. The PDF dump breaks inside parentheses and uses full-width
    # commas, and page furniture lands mid-sentence.
    text = " ".join(c for c in chunk
                    if "wch-ic.com" not in c and not c.startswith("V1.4"))
    text = text.replace("，", ",").replace("。", ".")
    text = re.sub(r"\s+", " ", text)

    known = set(s[len(table["strip"]):] for s in table["signals"])
    valid = set(table["codes"])

    out, notes, bad = {}, {}, {}
    # Split on "<code>:" and keep what follows, up to the next such code.
    parts = re.split(r"(?<![0-9A-Za-z])([01x]{3,4})\s*(?=[:(])", text)
    for i in range(1, len(parts) - 1, 2):
        code, body = parts[i], parts[i + 1]
        if code not in valid and code not in ("11xx", "111"):
            continue
        groups = re.findall(r"\(([^)]*)\)", body)
        # "010 (Only for CH32V007/CH32M007): Full mapping (...)" -- skip the other family.
        if any("only for" in g.lower() and ("V007" in g or "M007" in g) for g in groups):
            continue
        pinlists = [g for g in groups if PIN_RE.search(g) and "/" in g]
        if not pinlists:
            if code in valid or code == "11xx":
                notes[code] = body.strip(" :;.")[:120]
            continue
        if code not in valid:
            notes[code] = body.strip(" :;.")[:120]
            continue

        mapping = {}
        for item in pinlists[-1].split(","):
            item = item.strip()
            if not item:
                continue
            bits = [b for b in item.split("/") if b]
            if len(bits) < 2:
                continue
            pin, sigs = bits[-1], bits[:-1]
            if table["periph"] == "TIM2" and {"CH1", "ETR"} <= set(sigs):
                key = "CH1_ETR"
            else:
                key = next((s for s in sigs if s in known), None)
            if key is None:
                continue
            if PIN_RE.fullmatch(pin):
                mapping[key] = pin
            elif re.fullmatch(r"P[A-Z]\w*", pin):
                # The prose names something pin-shaped that this part does not have --
                # RM 7.3.2.2 writes USART2_RM=101 RTS as "PA11" and port A stops at PA7.
                # Report it rather than dropping it, or the cross-check reads as a
                # missing entry and the reader has to go find the source line.
                bad.setdefault(code, {})[key] = pin
        if mapping:
            out[code] = mapping
    return out, notes, bad


def cross_check(rm, rm_path):
    """Diff the 7.2.11 grids against the 7.3.2.2 register prose. Returns (problems, notes)."""
    lines = Path(rm_path).read_text(encoding="utf-8", errors="replace").splitlines()
    problems, notes, checked = [], [], 0

    for t in TABLES:
        periph = t["periph"]
        grid = rm.get(periph)
        if not grid:
            continue
        try:
            prose, extra, bad = parse_register_prose(lines, t)
        except LookupError as e:
            problems.append(str(e))
            continue
        for code, body in sorted(extra.items()):
            notes.append(t["field"] + "=" + code + ": " + body)

        for i, code in enumerate(t["codes"]):
            if code not in prose:
                problems.append(t["field"] + "=" + code
                                + ": Table has this column, the register prose does not")
                continue
            for sig, pins in sorted(grid.items()):
                want = pins[i]
                got = prose[code].get(sig)
                if got is None:
                    stray = bad.get(code, {}).get(sig)
                    if stray:
                        problems.append(
                            t["field"] + "=" + code + " " + sig + ": Table 7.2.11 says "
                            + want + ", register prose says " + stray
                            + " -- which is not a pin on this part, so the table wins")
                    else:
                        problems.append(t["field"] + "=" + code + " " + sig
                                        + ": missing from the register prose (table says "
                                        + want + ")")
                elif got != want:
                    problems.append(t["field"] + "=" + code + " " + sig
                                    + ": Table 7.2.11 says " + want
                                    + ", register prose says " + got)
                else:
                    checked += 1
    return problems, notes, checked


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
    ap.add_argument("--no-cross-check", action="store_true",
                    help="skip pass 3 (the AFIO_PCFR1 register-prose cross-check)")
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

    print("PASS 2 -- RM section 7.2.11 tables vs the YAML")
    if problems:
        print("  DIFFERENCES: " + str(len(problems)))
        for p in problems:
            print("    x " + p)
    else:
        print("  DIFFERENCES: 0 -- every pin in the YAML matches the RM table it cites.")

    # Pass 3 disagreements are faults in the RM itself, not in the YAML, so they are
    # reported separately and do not fail the run. Read them, decide which source is
    # right, and record the decision in the .notes.md.
    if not args.no_cross_check:
        xp, notes, checked = cross_check(rm, args.rm)
        print("\nPASS 3 -- RM section 7.2.11 tables vs the AFIO_PCFR1 register prose (RM 7.3.2.2)")
        print("  " + str(checked) + " pin assignments confirmed by both.")
        if notes:
            print("  Codes the prose describes that carry no pin:")
            for n in notes:
                print("    - " + n)
        if xp:
            print("  SOURCE DISAGREEMENTS: " + str(len(xp))
                  + "  (the RM contradicts itself here -- judgement required, not a YAML bug)")
            for p in xp:
                print("    ? " + p)
        else:
            print("  SOURCE DISAGREEMENTS: 0 -- the two independent descriptions agree.")

    if parse_problems:
        return 2
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
