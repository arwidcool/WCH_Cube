#!/usr/bin/env python3
"""Recover CH32L103's package pin tables from the datasheet PDF, by word position.

PDF FALLBACK: DS Table 2-1-1. This is the LAST-resort path of the rule in
`data/sources/README.md` ("Read the markdown first. The PDF is the last resort."),
and the reason it earns the fallback is concrete: the markdown conversion of this
datasheet DROPS the `-` placeholder cells, so a row for a pin that is absent from a
package has fewer than five pin numbers and its columns can no longer be told apart
by position:

    ## 19 17 23 34 PA13          <- four numbers. Which package is absent?

`tools/extract_l103_pins.py` reads the markdown and reports exactly that: LQFP48
pin 34 is missing, the same at 45, and every package's GPIO count comes up short.
CH32X035 had the identical corruption and was fixed the same way, so this is the
established method for this repo, not an invention.

**The fallback is checked, not assumed.** `markdown_short_rows()` counts the rows of
Table 2-1-1 in the conversion that start with fewer than five cells, and this script
will NOT open the PDF when that count is zero: if a future conversion keeps its
placeholders (or the flat parser learns to read a wrapped row), the markdown can
answer, and the tool says so and exits 0 without touching the PDF. A fallback that
nobody re-checks turns into the normal path, which is the thing the policy bans.

HOW IT WORKS. PyMuPDF gives every word a bounding box, and the PDF still has all
five dashes. The table is a grid of fixed columns, so the x positions do the
alignment the markdown lost:

    number columns   x ~ 61 | 81 | 104 | 125 | 147     one per package, in order
    pin name column  x ~ 163 onwards

A row is therefore "the five cells whose y coordinate matches", and a package's
pin table is read by walking those y groups in order and taking that column's cell
from each.

`page.find_tables()` finds nothing here - the table has no ruling lines - so the
grid is recovered from the header's own word positions at runtime rather than
hardcoded. Everything is then checked (`check()`): pin numbers must run 1..N with
no gaps, and each package's GPIO count must equal the datasheet model table's own
`GPIO port number` row. A plausible-looking wrong table is the one outcome worse
than no table.

WHAT TO DO WITH THE OUTPUT. `--yaml` prints the recovered `packages:` block, and it
belongs in a declared file beside the conversion so the PDF is read once, exactly as
`data/sources/X035/Datasheets/CH32X035_pin_corrections.yaml` holds X035's declared
rows: the part's `.notes.md` then cites the PDF by table **and** that file, and
nobody has to open the PDF again.

Usage:
    python tools/recover_l103_pins_from_pdf.py             # report + checks
    python tools/recover_l103_pins_from_pdf.py --json      # machine-readable
    python tools/recover_l103_pins_from_pdf.py --yaml      # packages: block
    python tools/recover_l103_pins_from_pdf.py --audit     # per-row dump
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import source_docs  # sibling module: the markdown-first policy

try:
    import pymupdf
except ImportError:  # pragma: no cover - depends on the box
    try:
        import fitz as pymupdf
    except ImportError:
        sys.exit("recover_l103_pins_from_pdf: needs PyMuPDF (pip install pymupdf)")

ROOT = pathlib.Path(__file__).resolve().parent.parent
PART, STEM = "l103", "CH32L103DS0"

# The five package columns, in the order the DS header lists them. K8U covers
# K8U6 and K8U7 - same package and pinout, different temperature grade (DS note).
COLUMNS = ["TSSOP20", "QFN20", "QSOP28", "QFN32", "LQFP48"]
COLUMN_DS = ["L103F8P6", "L103F8U6", "L103G8R6", "L103K8U", "L103C8T6"]

# DS model table, the `GPIO port number` row - the datasheet's OWN I/O count per
# package. The recovered tables are checked against it, so a mis-parse cannot pass.
DS_GPIO_COUNT = {"TSSOP20": 16, "QFN20": 19, "QSOP28": 26, "QFN32": 31, "LQFP48": 37}

NUM_CELL = re.compile(r"^(?:\d{1,2}|-)$")
PIN_NAME = re.compile(r"^(P[A-D]\d{1,2}|V[A-Z]*\d?|NRST|BOOT\d|OSC_(?:IN|OUT))$")
FOOTNOTE = re.compile(r"\(\d+\)")

# Vertical tolerance, in PDF points, for treating two words as on the same line, and
# the maximum distance a cell may sit below its row's pin name before it is treated as
# not belonging to the table at all. The latter is needed because the notes below the
# table contain digits and pin names, and the table's own last rows are taller than
# its first ones.
ROW_TOL = 3.0
ANCHOR_MAX = 140.0


def table_pages(doc):
    """Every page of Table 2-1-1: the caption page, then the pages repeating its header."""
    start = None
    for i, page in enumerate(doc):
        if "Table 2-1-1" in page.get_text():
            start = i
            break
    if start is None:
        sys.exit("recover_l103_pins_from_pdf: Table 2-1-1 not found")
    end = start
    for i in range(start + 1, len(doc)):
        t = doc[i].get_text()
        if "Pin name" in t and "Table 2-1-2" not in t:
            end = i
        else:
            break
    return list(range(start, end + 1))


def grid(words):
    """Column centres and the pin-name x range, from the header's own words."""
    found = {}
    for w in words:
        if w[4] in COLUMN_DS and w[4] not in found:
            found[w[4]] = (w[0] + w[2]) / 2
    if len(found) != len(COLUMN_DS):
        return None
    centres = [found[n] for n in COLUMN_DS]
    # The name column starts right of the last number column and ends where the
    # "Pin type" column begins. Both come from the header, not from a constant.
    pin_type = next((w[0] for w in words if w[4] == "type(1)"), None)
    name_hi = (pin_type - 3) if pin_type else centres[-1] + 60
    name_lo = centres[-1] + (centres[-1] - centres[-2]) * 0.6
    return centres, name_lo, name_hi


def col_of(x, centres):
    """Which of the five package columns an x belongs to, or None for neither."""
    half = (centres[1] - centres[0]) / 2
    if x < centres[0] - half:
        return None
    for k in range(len(centres) - 1):
        if x < (centres[k] + centres[k + 1]) / 2:
            return k
    if x < centres[-1] + (centres[-1] - centres[-2]) * 0.6:
        return len(centres) - 1
    return None


def base_name(text):
    """`PC13-TAMPER-RTC(2)` -> `PC13`; the datasheet's descriptive suffix is dropped.

    The suffix is not part of the pin's name: `PA0-WKUP`, `PC14-OSC32_IN` and
    `PC13-TAMPER-RTC` are PA0, PC14 and PC13. Only a name whose BASE matches the
    pin-name grammar is an anchor, which is also what keeps the prose below the
    table from being read as one.
    """
    clean = FOOTNOTE.sub("", text)
    base = re.split(r"[-/]", clean)[0]
    return base if PIN_NAME.match(base) else None


def collect(words, centres, name_lo, name_hi):
    """Pin-name anchors and number cells, both with their y coordinates."""
    cells, anchors = [], []
    for w in words:
        x, y = (w[0] + w[2]) / 2, w[1]
        if NUM_CELL.match(w[4]):
            k = col_of(x, centres)
            if k is not None:
                cells.append((y, k, w[4]))
        elif name_lo <= x <= name_hi:
            b = base_name(w[4])
            if b:
                anchors.append((y, b))
    anchors.sort()
    # a wrapped name repeats its first segment on the second line (PC13- ... PC13(3));
    # keep one anchor per distinct y run so a duplicate cannot split a row in two
    dedup = []
    for y, b in anchors:
        if dedup and abs(dedup[-1][0] - y) <= ROW_TOL:
            continue
        dedup.append((y, b))
    return cells, dedup


def rows_of_words(words, centres, name_lo, name_hi):
    """One record per datasheet row: the pin name, and the five package cells.

    A cell belongs to the LAST row whose pin name is at or above it, not to the
    nearest one. That is what the datasheet's own layout does: a cell is printed at
    the top of its row, and where a package does not bond the next pin the cell is
    MERGED and stretches down over the space that row would have used. TSSOP20 pin 1
    (BOOT0) is printed 70pt below its own name for exactly that reason - TSSOP20 does
    not bond PB8, so its BOOT0 cell spans both rows - and 'nearest anchor' put it on
    PB8, which the markdown's reading order disproves. Verified against the render:
    the horizontal rule between BOOT0 and PB8 stops at the TSSOP20 column's edge.
    """
    cells, anchors = collect(words, centres, name_lo, name_hi)
    rows = [[y, b, None, [None] * len(COLUMNS)] for y, b in anchors]
    for y, k, v in cells:
        best = None
        for r in rows:
            if r[0] <= y + ROW_TOL:
                best = r
            else:
                break
        if best is None or y - best[0] > ANCHOR_MAX:
            continue
        if best[3][k] is not None and best[3][k] != v:
            raise SystemExit(f"recover_l103_pins_from_pdf: two values for {COLUMNS[k]} "
                             f"in the row anchored at y={best[0]} ({best[1]}): "
                             f"{best[3][k]!r} and {v!r}")
        best[3][k] = v
    # An anchor with no cells is not a table row: it is one of the pin names the
    # DS's own notes below the table mention in prose ("neither the BOOT0 nor ...").
    return [r for r in rows if any(c is not None for c in r[3])]


def assemble(rows):
    """package -> {pin: name or [names]}, plus a per-row record for the audit.

    A package pin can carry MORE THAN ONE port name, and the datasheet proves it by
    listing two rows with the same number for that column: TSSOP20 pin 19 appears in
    the PA13 row and in the PB6 row, and the F8P6 pinout figure prints the pin as
    `PA13/SWDIO/PB6/CC1`. Overwriting on the second row (which this did first) is
    silent and costs three pins on that package alone - it is the same fact the repo
    already models as a shorted pair, so it is emitted the same way, as a list.
    """
    acc = {p: {} for p in COLUMNS}
    detail = []
    for y, name, _, slots in rows:
        detail.append({"y": round(y, 1), "slots": slots, "name": name})
        for k, v in enumerate(slots):
            if v and v != "-":
                names = acc[COLUMNS[k]].setdefault(int(v), [])
                if name not in names:
                    names.append(name)
    pkgs = {p: {n: (v[0] if len(v) == 1 else v) for n, v in acc[p].items()} for p in COLUMNS}
    return pkgs, detail


def load_corrections():
    """The cells the conversion did not carry, from the cited file beside the PDF.

    Every correction there names its source AND the datasheet number it reconciles
    with, so this function adds facts rather than guesses: a rename that broke the
    GPIO-count row would be caught by `check()` a moment later.
    """
    import json as _json  # noqa: F401  (yaml would be a dependency; the file is simple)
    path = ROOT / "data/sources/l103/Datasheets/CH32L103_pin_corrections.yaml"
    if not path.exists():
        return {}, []
    text = path.read_text(encoding="utf-8")
    try:
        import yaml
    except ImportError:
        sys.exit("recover_l103_pins_from_pdf: corrections file needs PyYAML")
    doc = yaml.safe_load(text) or {}
    adds = []
    for a in doc.get("add") or []:
        adds.append((str(a["package"]), int(a["pin"]), str(a["name"])))
    return (doc.get("renames") or {}), adds


def apply_corrections(pkgs):
    """Rename and add, and say out loud what was changed."""
    renames, adds = load_corrections()
    for col in COLUMNS:
        for n, v in list(pkgs[col].items()):
            if isinstance(v, str) and v in renames:
                pkgs[col][n] = renames[v]
            elif isinstance(v, list):
                pkgs[col][n] = [renames.get(x, x) for x in v]
    for col, n, name in adds:
        if col not in pkgs:
            sys.exit(f"recover_l103_pins_from_pdf: correction names package {col}, not a column")
        cur = pkgs[col].get(n)
        if cur is None:
            pkgs[col][n] = name
        elif isinstance(cur, list):
            if name not in cur:
                cur.append(name)
        elif cur != name:
            pkgs[col][n] = [cur, name]
    return renames, adds


def check(pkgs):
    """Independent checks. Each of these has already caught a real error.

    The GPIO count compares PIN POSITIONS that carry at least one GPIO name against
    the datasheet's own `GPIO port number` row, not the number of GPIO names: a pin
    carrying two names is one pin, which is exactly what that row counts. It is the
    check the corrections have to satisfy - five packages, five independent numbers
    from a row that has nothing to do with the pin table - and it is why the
    corrections are trustworthy rather than convenient.
    """
    problems = []
    is_gpio = re.compile(r"^P[A-D]\d+$")
    for col in COLUMNS:
        pins = pkgs[col]
        nums = sorted(n for n in pins if n != 0)
        if nums and nums != list(range(1, max(nums) + 1)):
            missing = [n for n in range(1, max(nums) + 1) if n not in pins]
            problems.append(f"{col}: pin numbers are not 1..{max(nums)} - missing {missing}")
        io = [n for n, nm in pins.items()
              if any(is_gpio.match(x) for x in ([nm] if isinstance(nm, str) else nm))]
        want = DS_GPIO_COUNT[col]
        if len(io) != want:
            names = len(pins) - len(io)
            problems.append(f"{col}: {len(io)} GPIO pins, DS model table says {want} "
                            f"({names} pin(s) carry no GPIO name)")
    return problems


def markdown_short_rows():
    """Rows of Table 2-1-1 in the conversion that start with fewer than five cells.

    Returns `(short, total, path)`. `short is None` means there is no markdown at
    all, which is a fallback reason of its own. This is the check behind the
    `PDF FALLBACK:` line: zero short rows means the markdown can answer, and then
    this script must not open the PDF.
    """
    md = source_docs.markdown(PART, STEM)
    if md is None:
        return None, 0, None
    lines = md.read_text(encoding="utf-8", errors="replace").splitlines()
    start = end = None
    for i, line in enumerate(lines):
        if start is None and line.startswith("Table 2-1-1"):
            start = i
        elif start is not None and line.startswith("Table 2-1-2"):
            end = i
            break
    if start is None:
        return None, 0, md
    short, total = [], 0
    for line in lines[start:end or len(lines)]:
        s = line.strip()
        if s.startswith("##"):
            s = s[2:].strip()
        cells = 0
        for tok in s.split():
            if NUM_CELL.match(tok):
                cells += 1
            else:
                break
        if cells:
            total += 1
            if cells < len(COLUMNS):
                short.append((cells, line.strip()))
    return short, total, md


def main():
    md = source_docs.markdown(PART, STEM)
    short, total, _ = markdown_short_rows()
    if short is not None and not short:
        print(f"markdown first: {md.name} gives every row of Table 2-1-1 ({total}) "
              f"{len(COLUMNS)} number cells, so the conversion can answer on its own.")
        print("The PDF is NOT needed. Use tools/extract_l103_pins.py, which reads the "
              "markdown.")
        print(f"Policy: {source_docs.POLICY}")
        return 0
    if short:
        source_docs.announce_pdf_fallback(
            f"DS Table 2-1-1: the markdown conversion drops `-` placeholder cells, so "
            f"{len(short)} of {total} rows start with fewer than {len(COLUMNS)} number "
            f"cells and their columns cannot be told apart by position.")
        for cells, line in short[:4]:
            print(f"  {cells} cell(s): {line}")
        if len(short) > 4:
            print(f"  ... and {len(short) - 4} more")
    else:
        source_docs.announce_pdf_fallback(
            f"there is no markdown conversion for {PART}/{STEM} to read first.")
    PDF = source_docs.pdf(PART, STEM)
    if PDF is None or not PDF.exists():
        sys.exit(f"recover_l103_pins_from_pdf: no PDF for {PART}/{STEM} in "
                 "data/sources/l103/Datasheets - nothing to fall back to")
    doc = pymupdf.open(PDF)
    pages = table_pages(doc)
    print(f"Table 2-1-1 on PDF page(s): {[p + 1 for p in pages]}")

    centres, all_rows = None, []
    for p in pages:
        words = doc[p].get_text("words")
        g = grid(words)
        if g:
            centres = g
        if centres is None:
            sys.exit(f"recover_l103_pins_from_pdf: no header geometry on page {p + 1}")
        c, lo, hi = centres
        all_rows += rows_of_words(words, c, lo, hi)

    c, lo, hi = centres
    print("column centres: " + " ".join(f"{n}={x:.0f}" for n, x in zip(COLUMNS, c)))
    print(f"pin-name column: x in [{lo:.0f}, {hi:.0f}]")

    pkgs, detail = assemble(all_rows)
    renames, adds = apply_corrections(pkgs)
    if renames:
        print("corrections: rename " + ", ".join(f"{k}->{v}" for k, v in renames.items()))
    for col, n, name in adds:
        print(f"corrections: add {name} at {col} pin {n}")
    problems = check(pkgs)

    if "--audit" in sys.argv:
        for d in detail:
            print(f"y={d['y']:>7} {' '.join(str(s) for s in d['slots']):<24} {d['name']}")
        return 0
    if "--json" in sys.argv:
        print(json.dumps(pkgs, indent=1, sort_keys=True))
        return 1 if problems else 0
    if "--yaml" in sys.argv:
        print("# Pin number -> pin name, recovered from DS Table 2-1-1 (PDF) by word")
        print("# position and checked against the DS model table's GPIO count per package.")
        print(f"# PDF FALLBACK: {PDF.name} - the markdown conversion drops the `-`")
        print("# placeholder cells. Policy: data/sources/README.md, 'Read the markdown")
        print("# first. The PDF is the last resort.' This table is read ONCE; it belongs")
        print("# in a declared file beside the conversion, as X035's does.")
        print("packages:")
        for col in COLUMNS:
            print(f"  {col}:")
            for n in sorted(pkgs[col]):
                v = pkgs[col][n]
                print(f"    {n}: " + ("[" + ", ".join(v) + "]" if isinstance(v, list) else v))
        return 1 if problems else 0

    print(f"rows: {len(detail)}")
    for col in COLUMNS:
        pins = pkgs[col]
        io = [n for n, nm in pins.items()
              if any(re.match(r"^P[A-D]\d+$", x)
                     for x in ([nm] if isinstance(nm, str) else nm))]
        multi = {n: v for n, v in pins.items() if isinstance(v, list)}
        print(f"  {col:<8} {len(pins):>3} pins, {len(io):>3} GPIO pins  "
              f"(DS says {DS_GPIO_COUNT[col]})"
              + (f", {len(multi)} shared: " + ", ".join(f"{n}={v}" for n, v in sorted(multi.items()))
                 if multi else ""))
    unnamed = [d for d in detail if not d["name"]]
    if unnamed:
        print(f"\nrows with no name recovered ({len(unnamed)}):")
        for d in unnamed[:12]:
            print(f"  y={d['y']} slots={d['slots']}")
    empty = [d for d in detail if all(not v or v == "-" for v in d["slots"])]
    if empty:
        print(f"rows with no package cells at all ({len(empty)}): "
              + ", ".join(f"y={d['y']} {d['name']}" for d in empty[:8]))
    if problems:
        print("\nPROBLEMS:")
        for p in problems:
            print("  - " + p)
        return 1
    print("\nall checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
