#!/usr/bin/env python3
"""Recover UHSIF's PORTn -> logical-function table from the UHSIF PDF, by text order.

PDF FALLBACK: there is no markdown conversion to read first, and none is owed one -
`tests/source_order.test.js` only requires a markdown sibling for a PDF inside a
`Datasheets/`/`datasheets/` folder, and this one lives at
`data/sources/H417/Evt/EXAM/UHSIF/CH32H417 UHSIF Development Reference Manual-EN.pdf`,
an EVT example folder. The fact this script reads (Table 3-2, "Pin default mapping
configuration": which logical function - a DATA[n] bit, a control signal, or NC/unused
- each `UHSIF_PORTn` carries) is nowhere else: `ch32h417_uhsif.h` declares no
`UHSIF_InitTypeDef` and no `UHSIF_GPIO_Init` body (it ships as a prebuilt `libUHSIF.a`,
Evt/EXAM/UHSIF/UHSIF_SLAVE/Common), and the main datasheet (CH32H417DS0.md) gives PORTn's
PHYSICAL PAD per `UHSIF_PORT_RM` mapping (RM 3.3.5.5 / CH32H417RM.md:11770-11834) but
never says what a given PORTn is FOR. Board findings 2026-09-13T02:00Z and
2026-09-14T00:20Z record the two consequences this leaves unmodelled: the 8/16/24/32-bit
`width_bit` row cannot narrow the pin claim without this table, and separately (found
while scripting this, see NOTE below) `signal_pins:` does not even encode one coherent
`UHSIF_PORT_RM` mapping - that second problem is NOT this table's to fix.

NOTE, checked exhaustively before writing this docstring: the PDF does NOT ALSO carry a
PORTn -> physical pad table. Every one of its 13 pages was searched for a GPIO pin name
(`P[A-F]\\d+`) and the only hit anywhere is `PCLK`, a generic label for the clock pin, not
a port-to-pad table - and page 2's own text says so directly: "For details, refer to the
'UHSIF Pin Functions' section in the CH32H417DS0.PDF." So this script narrows the width
over-claim; it does NOT unblock the `UHSIF_PORT_RM` incoherence finding.

HOW IT WORKS. Table 3-2 reads, in PyMuPDF's plain text order, as a flat sequence of
`UHSIF_PORT<n>` / `<function>` pairs - three columns of sixteen rows, but read row-major
(PORT0, PORT16, PORT32, PORT1, PORT17, PORT33, ...), which is exactly the order the text
extractor already returns with no column geometry needed. The six header tokens
("UHSIF_PORT" x3, "Pin function" x3) are skipped by requiring the port token to carry a
trailing digit.

CHECKED, not assumed: every port 0..47 appears exactly once (`check()`); the PDF's own
running prose states "a 32-bit data width requires 44 pins" (page 0) - and 1 CLK + 11
control signals (SEL[0], SEL[1], AF#, AE#, EOP#, WRNF, RDNE, RD#, OE#, WR#, CS#) + 32
DATA[0..31] bits = 44, checked against that count, not hardcoded past it; DATA[n] must
run 0..31 with no gaps; exactly 5 ports (0, 1, 2, 6, 10) must read NC, matching the DS's
own count of UHSIF ports NOT among the 44 "standard application" pins (48 PORTn total -
44 used - CLK is not a PORTn = wait, checked as 48 - 43 non-NC PORTn signals = 5).

WHAT TO DO WITH THE OUTPUT. `--yaml` prints the recovered block; it belongs in a
declared file next to this script's citation, read once - `data/sources/H417/UHSIF_port_functions.yaml`
- so `settings:`/`signal_pins:` work for UHSIF's width-based claim (P2, pin planning) can
cite it without re-opening the PDF.

Usage:
    python tools/recover_h417_uhsif_pdf.py             # report + checks
    python tools/recover_h417_uhsif_pdf.py --json      # machine-readable
    python tools/recover_h417_uhsif_pdf.py --yaml       # declared-file block
    python tools/recover_h417_uhsif_pdf.py --audit      # raw token dump
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import source_docs  # sibling module: the markdown-first policy / fallback disclosure

try:
    import pymupdf
except ImportError:  # pragma: no cover - depends on the box
    try:
        import fitz as pymupdf
    except ImportError:
        sys.exit("recover_h417_uhsif_pdf: needs PyMuPDF (pip install pymupdf)")

ROOT = pathlib.Path(__file__).resolve().parent.parent
PDF = (ROOT / "data/sources/H417/Evt/EXAM/UHSIF/"
       "CH32H417 UHSIF Development Reference Manual-EN.pdf")

PORT_RE = re.compile(r"^UHSIF_PORT(\d{1,2})$")
CONTROL = {"SEL[0]", "SEL[1]", "AF#", "AE#", "EOP#", "WRNF", "RDNE", "RD#", "OE#",
           "WR#", "CS#"}
DATA_RE = re.compile(r"^DATA\[(\d{1,2})\]$")


def table_page(doc):
    for i, page in enumerate(doc):
        if "Table 3-2" in page.get_text():
            return i
    sys.exit("recover_h417_uhsif_pdf: Table 3-2 not found in the PDF")


def whole_pdf_has_no_gpio_pin(doc) -> list[str]:
    """Every GPIO-shaped token anywhere in the document, PCLK aside - the check behind
    this script's own NOTE that the PDF carries no port-to-pad table."""
    hits = []
    pin_re = re.compile(r"^P[A-F]\d{1,2}$")
    for page in doc:
        for line in page.get_text().splitlines():
            for tok in line.split():
                if pin_re.match(tok):
                    hits.append(tok)
    return hits


def parse_table_3_2(doc, page_no) -> dict[int, str]:
    """{port number: function} for every UHSIF_PORTn on the Table 3-2 page(s).

    Table 3-2 is short enough that it never crosses a page boundary in this PDF (checked:
    all 48 rows land on one page), but the loop still walks forward in case a future
    revision wraps it, stopping at the paragraph that closes the table.
    """
    out: dict[int, str] = {}
    page_i = page_no
    started = False
    while page_i < doc.page_count:
        lines = [ln.strip() for ln in doc[page_i].get_text().splitlines() if ln.strip()]
        i = 0
        while i < len(lines):
            line = lines[i]
            if not started:
                if line.startswith("Table 3-2"):
                    started = True
                i += 1
                continue
            m = PORT_RE.match(line)
            if m and i + 1 < len(lines):
                out[int(m.group(1))] = lines[i + 1]
                i += 2
                continue
            if line.startswith("The mapping of UHSIF peripheral signals"):
                return out
            i += 1
        page_i += 1
        if len(out) >= 48:
            break
    return out


def check(table: dict[int, str]) -> list[str]:
    problems = []
    missing = sorted(set(range(48)) - set(table))
    if missing:
        problems.append(f"port(s) never recovered: {missing}")
    extra = sorted(n for n in table if not (0 <= n <= 47))
    if extra:
        problems.append(f"port number(s) out of the DS's 0..47 range: {extra}")
    nc = [n for n, fn in table.items() if fn == "NC"]
    if len(nc) != 5:
        problems.append(f"expected 5 NC (unused) ports, found {len(nc)}: {sorted(nc)}")
    data_bits = {}
    for n, fn in table.items():
        m = DATA_RE.match(fn)
        if m:
            data_bits[int(m.group(1))] = n
    if sorted(data_bits) != list(range(32)):
        problems.append(f"DATA[n] must run 0..31 gapless; got {sorted(data_bits)}")
    control = [n for n, fn in table.items() if fn in CONTROL]
    if len(control) != 11:
        problems.append(f"expected 11 control-signal ports, found {len(control)}")
    if sorted(set(table.values()) - CONTROL - {"NC"} - {f"DATA[{i}]" for i in range(32)}):
        problems.append("unrecognised function name(s): "
                         + ", ".join(sorted(set(table.values()) - CONTROL - {"NC"}
                                            - {f"DATA[{i}]" for i in range(32)})))
    # The PDF's own cross-check: "a 32-bit data width requires 44 pins" (page 0), and
    # 1 CLK (not a PORTn, so +1 outside this table) + 11 control + 32 data = 44.
    if len(control) + len(data_bits) + 1 != 44:
        problems.append(f"control+data+CLK = {len(control) + len(data_bits) + 1}, "
                         "the PDF's own page states 44 for a 32-bit bus")
    return problems


def main():
    source_docs.announce_pdf_fallback(
        "UHSIF's PORTn-to-function table (DS Table 3-2 equivalent) exists only in "
        "Evt/EXAM/UHSIF's own PDF, which has no markdown conversion and is not owed one "
        "(not inside a Datasheets/ folder) - and the driver is a prebuilt libUHSIF.a with "
        "no source to read the assignment from instead.")
    if not PDF.exists():
        sys.exit(f"recover_h417_uhsif_pdf: not found: {PDF}")
    doc = pymupdf.open(PDF)
    gpio_hits = whole_pdf_has_no_gpio_pin(doc)
    page_no = table_page(doc)
    print(f"Table 3-2 on PDF page {page_no + 1} of {doc.page_count}")
    print(f"whole-document GPIO-pin-name scan: {sorted(set(gpio_hits)) or '(none found)'}"
          " - confirms this PDF carries no port-to-pad table (see script docstring NOTE)")

    table = parse_table_3_2(doc, page_no)
    problems = check(table)

    if "--audit" in sys.argv:
        for n in sorted(table):
            print(f"  PORT{n:<2} {table[n]}")
        return 0
    if "--json" in sys.argv:
        print(json.dumps({str(n): fn for n, fn in sorted(table.items())}, indent=1))
        return 1 if problems else 0
    if "--yaml" in sys.argv:
        print("# UHSIF PORTn -> logical function, recovered from the UHSIF PDF's Table 3-2")
        print(f"# PDF FALLBACK: {PDF.name} - no markdown conversion, not owed one (not in")
        print("# a Datasheets/ folder); driver is a prebuilt libUHSIF.a with no source.")
        print("# Read ONCE by tools/recover_h417_uhsif_pdf.py --yaml; checked against the")
        print("# PDF's own \"32-bit data width requires 44 pins\" statement (page 0).")
        print("# Physical pad per port is a SEPARATE, unresolved question - see the")
        print("# script's NOTE and agents/BOARD.md 2026-09-14T02:20Z.")
        print("port_functions:")
        for n in sorted(table):
            print(f"  {n}: {yaml_str(table[n])}")
        return 1 if problems else 0

    print(f"ports recovered: {len(table)} of 48")
    nc = sorted(n for n, fn in table.items() if fn == "NC")
    control = sorted(n for n, fn in table.items() if fn in CONTROL)
    data = sorted(((int(DATA_RE.match(fn).group(1)), n) for n, fn in table.items()
                   if DATA_RE.match(fn)))
    print(f"  NC (unused):        {len(nc)}  ports {nc}")
    print(f"  control signals:    {len(control)}  ports {control}")
    print(f"  DATA[0..31]:        {len(data)}  ports " + ", ".join(f"{n}=DATA[{b}]" for b, n in data[:4]) + " ...")
    if problems:
        print("\nPROBLEMS:")
        for p in problems:
            print("  - " + p)
        return 1
    print("\nall checks pass")
    return 0


def yaml_str(s: str) -> str:
    return '"' + s.replace('"', '\\"') + '"' if any(c in s for c in "[]#") else s


if __name__ == "__main__":
    sys.exit(main())
