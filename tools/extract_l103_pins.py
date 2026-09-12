#!/usr/bin/env python3
"""Re-derive CH32L103's package pin tables from the datasheet and diff them.

The DS markdown is mangled by PDF extraction, the same way CH32X035's was, so
this file exists for the second reason `extract_pins.py` does: to read the table
a DIFFERENT way than the YAML was written, and report where the two disagree.

Its output is not the authority - the datasheet is. It is a second opinion.

Table 2-1-1 has five package columns, in this order (header row):

    L103F8P6 | L103F8U6 | L103G8R6 | L103K8U | L103C8T6

`K8U` covers both K8U6 and K8U7: same package, same pinout, different
temperature grade, which the DS states in a note under the model table.

The mangling this has to survive, all observed in the file:

  * a row's five pin numbers may be on a line with no pin name at all
    (`## - - - - 2`), with the name arriving on the next lines;
  * a pin name is split ACROSS lines mid-token (`V` + `BAT` = VBAT,
    `PC13-` + `TAMPER-RTC` = PC13-TAMPER-RTC, `OSC_OU` + `T` = OSC_OUT);
  * a trailing footnote marker is glued to the name (`PC13-TAMPER-RTC(2)`);
  * `V` / `SSA` and `V` / `DDA` split the same way.

So the rule is: after the five pin numbers, keep joining tokens until one of them
is a PIN TYPE token (`I/O/A`, `I/O`, `P`, `A`, `I`) - everything before that is
the pin name. That is deliberately not "split on whitespace", because the tokens
are not words.

**AND THE ONE THAT STOPS THIS TOOL, recorded here because it is the whole reason
this file is red rather than green.** The conversion **drops the `-` placeholder
cells**, so a row where a pin is absent from a package has FEWER than five numbers
and its columns can no longer be told apart by position:

    ## 19 17 23 34 PA13     <- four numbers. Which of QFN32 / TSSOP20 is absent?

On CH32L103 that is not an edge case: PA13 is at LQFP48 pin 34, pin 34 is missing
from the reconstructed LQFP48 table, and the same happens at 45. A row with a
dropped dash also fails the five-token test above, so it is read as a CONTINUATION
of the row before it and two pins are lost at once.

CH32X035 hit the identical corruption, and the fix there was to recover the lost
cells **from the original PDF by word position** (`data/sources/X035/Datasheets/
CH32X035_pin_corrections.yaml`). This drop has no PDF, so it needs a second
independent source or a copy of the DS that kept its dashes. Until then the
per-package tables CANNOT be trusted, and a YAML written from them would be
guessed - which is the one thing the project's rules forbid outright.

What the tool is still good for: it reports the LQFP48 column's monotonic run,
whose missing numbers (34, 45) name exactly which rows lost a dash, and it checks
every package's GPIO count against the DS model table's own column (37/31/31/26/
19/16), which is the check that would catch a wrong table even if the parse were
clean.

Usage:
    python tools/extract_l103_pins.py            # report + counts
    python tools/extract_l103_pins.py --yaml     # emit the packages:/pins: blocks
    python tools/extract_l103_pins.py --json     # machine-readable, for a diff
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DS = ROOT / "data/sources/l103/datasheets/CH32L103DS0.md"

# The five package columns, in the order the DS header lists them. `K8U` is one
# column for two orderable parts (K8U6 / K8U7) - the DS's own note says they
# differ only in temperature grade.
COLUMNS = ["TSSOP20", "QFN20", "QSOP28", "QFN32", "LQFP48"]
COLUMN_DS = ["L103F8P6", "L103F8U6", "L103G8R6", "L103K8U", "L103C8T6"]

# DS model table, the `GPIO port number` row - the datasheet's OWN I/O count per
# package. This is what makes the parser's output checkable instead of plausible.
DS_GPIO_COUNT = {"TSSOP20": 16, "QFN20": 19, "QSOP28": 26, "QFN32": 31, "LQFP48": 37}

# A pin type token, as the DS's own "Pin type" column spells it (note 1:
# I = Schmitt input, O = tri-state output, A = analog, P = power).
TYPE_TOKENS = {"I/O/A", "I/O", "P", "A", "I"}

ROW_RE = re.compile(r"^(?:##\s*)?(?:(?:\d+|-)\s+){4}(?:\d+|-)\s*(.*)$")
NUM_TOKEN = re.compile(r"^(?:\d+|-)$")
FOOTNOTE_RE = re.compile(r"\(\d+\)$")


def strip_md(line: str) -> str:
    """`## PC13-` -> `PC13-`; a page footer/header becomes an empty string."""
    s = line.strip()
    if s.startswith("##"):
        s = s[2:].strip()
    return s


def is_page_noise(line: str) -> bool:
    s = line.strip()
    return ("wch-ic.com" in s or s.startswith("CH32L103 Datasheet")
            or re.match(r"^##?\s*V2\.\d", s) is not None)


def load_lines():
    """The CH32L103 pin table only - Table 2-1-2 is CH32M103, a different part."""
    text = DS.read_text(encoding="utf-8", errors="replace").splitlines()
    start = end = None
    for i, line in enumerate(text):
        if line.startswith("Table 2-1-1"):
            start = i
        elif start is not None and line.startswith("Table 2-1-2"):
            end = i
            break
    if start is None:
        sys.exit("extract_l103_pins: Table 2-1-1 not found - has the DS moved?")
    return text[start:end or len(text)]


def parse_rows(lines):
    """One dict per datasheet row: pin numbers per package, name, type, functions.

    Rows are found in a FLAT TOKEN STREAM rather than line by line, because the
    line structure is exactly what the conversion destroyed: a row's five pin
    numbers can themselves be split across lines (`## 13 - - 13` / `## 27 V` /
    `## DD`), and a line-at-a-time parser silently reads that as a continuation of
    the row above and loses four pins. It did, on the first run of this file - 44
    rows instead of 60, and the count check said so.

    A row starts where five consecutive tokens are each a number or a dash, at
    least one of them a number. Nothing else in the table looks like that: the
    function column is full of identifiers, and the I/O-level column is one dash.
    """
    tokens = []
    for raw in lines:
        if is_page_noise(raw):
            continue
        for tok in strip_md(raw).split():
            tokens.append(tok)

    # Indices where a row's five pin numbers begin.
    starts = []
    i = 0
    while i + 4 < len(tokens):
        five = tokens[i:i + 5]
        if all(NUM_TOKEN.match(t) for t in five) and any(t != "-" for t in five):
            starts.append(i)
            i += 5
            continue
        i += 1

    rows = []
    for k, s in enumerate(starts):
        end = starts[k + 1] if k + 1 < len(starts) else len(tokens)
        rows.append({
            "nums": tokens[s:s + 5],
            "tokens": tokens[s + 5:end],
        })
    return rows


def split_name(tokens):
    """The pin name is everything before the first PIN TYPE token - see the header."""
    name_parts = []
    for tok in tokens:
        if tok in TYPE_TOKENS:
            break
        if tok.startswith("(") or tok == "-":
            break
        name_parts.append(tok)
    name = "".join(name_parts)
    name = FOOTNOTE_RE.sub("", name)
    return name.strip()


def parse():
    rows = parse_rows(load_lines())
    out = []
    for r in rows:
        name = split_name([t for t in r["tokens"] if t])
        if not name:
            continue
        out.append({"nums": r["nums"], "name": name})
    return out


def build(rows):
    """package -> {pin number: pin name}. A pin absent from a package is `-`."""
    pkgs = {p: {} for p in COLUMNS}
    for r in rows:
        for i, col in enumerate(COLUMNS):
            n = r["nums"][i]
            if n == "-":
                continue
            pkgs[col][int(n)] = r["name"]
    return pkgs


def check(pkgs):
    """Two independent checks, both of which have caught a real extraction error."""
    problems = []
    for col in COLUMNS:
        pins = pkgs[col]
        want = DS_GPIO_COUNT[col]
        io = [n for n, nm in pins.items() if re.match(r"^P[A-D]\d+$", nm)]
        # 1. pin numbers run 1..N with no gaps and nothing repeated. Pin 0 is the
        #    exposed pad on a package that has one (data/FORMAT.md: "pin 0 is the
        #    exposed pad"), so it is allowed and is not part of the 1..N run - the
        #    same convention CH32V006 already uses.
        nums = sorted(n for n in pins if n != 0)
        if nums and nums != list(range(1, max(nums) + 1)):
            missing = [n for n in range(1, max(nums) + 1) if n not in pins]
            problems.append(f"{col}: pin numbers are not 1..{max(nums)} - missing {missing}")
        # 2. the count of GPIO rows equals the DS model table's own GPIO column
        if len(io) != want:
            problems.append(f"{col}: {len(io)} GPIO pins parsed, DS model table says {want}")
    return problems


def emit_yaml(pkgs):
    L = []
    L.append("# Pin number -> pin name, one table per package. Re-derived from DS Table 2-1-1.")
    L.append("# A row the datasheet gives a pin number for but no GPIO name to is a power,")
    L.append("# ground or reset pin, and is written here under the name the DS column uses.")
    L.append("packages:")
    for col in COLUMNS:
        L.append(f"  {col}:")
        for n in sorted(pkgs[col]):
            L.append(f"    {n}: {pkgs[col][n]}")
    return "\n".join(L)


def main():
    rows = parse()
    pkgs = build(rows)
    problems = check(pkgs)

    if "--json" in sys.argv:
        print(json.dumps(pkgs, indent=1, sort_keys=True))
        return 0

    if "--yaml" in sys.argv:
        print(emit_yaml(pkgs))
        return 1 if problems else 0

    print(f"rows parsed: {len(rows)}")
    for col in COLUMNS:
        pins = pkgs[col]
        io = [n for n, nm in pins.items() if re.match(r"^P[A-D]\d+$", nm)]
        print(f"  {col:<8} {len(pins):>3} rows, {len(io):>3} GPIO  "
              f"(DS says {DS_GPIO_COUNT[col]})")
    if problems:
        print("\nPROBLEMS:")
        for p in problems:
            print("  - " + p)
        return 1
    print("\nboth checks pass: pin numbers are 1..N, and every GPIO count "
          "matches the datasheet's own model table")
    return 0


if __name__ == "__main__":
    sys.exit(main())
