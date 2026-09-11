#!/usr/bin/env python3
"""
extract_pins.py -- AGENT-1 (DATA). Re-derive package pin tables from a datasheet pin
table and diff them against an MCU YAML.

The datasheet prints one row per pin with a column per orderable part:

    1 5 2 17 PA1      ->  QFN12 pin 1, TSSOP20 pin 5, QFN20 pin 2, QSOP24 pin 17
    - - - 24 PB3      ->  only bonded on QSOP24

so one table describes every package at once. This reads it back and checks the YAML
says the same thing.

Usage:
    # CH32V005 (DS Table 2-2) against the file that inherits CH32V006
    python tools/extract_pins.py --table "Table 2-2 CH32V005 Pin definitions" \
        --columns QFN12,TSSOP20,QFN20,QSOP24 --yaml data/mcus/CH32V005.yaml

    # CH32V006 (DS Table 2-1-1)
    python tools/extract_pins.py --table "Table 2-1-1 CH32V006 Pin definitions" \
        --columns QFN12,TSSOP20,QFN20,QSOP24,QFN32 --yaml data/mcus/CH32V006.yaml

Exit codes:  0 = the YAML matches the datasheet   1 = differences   2 = unreadable

Scope, deliberately: only I/O pins (Pxn) are compared. The VSS/VDD rows in this
datasheet's markdown are mangled by the PDF conversion ("## 0 7" / "## 0" / "## 5 V" /
"## SS"), so power pins are left to `validate_mcu.py`, which catches a wrong count
through mcu.variants[*].io_count. An I/O pin landing on the wrong number is the error
this tool exists to find, and that it does see.
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DS = ROOT / "data" / "sources" / "V006" / "Datasheets" / "CH32V006DS0.md"

# A pin name. Deliberately NOT `P[A-D][0-7]`, which is what this said until round 3:
# that hardcodes 8-bit ports A-D, and it is wrong on CH32X035, whose ports are 24 bits
# wide (GPIO_Pin_0..23 all exist) and whose PC runs 0-7 and then 14-19. A tool that
# assumes the shape of the parts it has already seen is the same class of mistake as an
# SPL name borrowed from another family. Override with --pin-re for a part shaped
# differently again.
DEFAULT_PIN_PAT = r"P[A-Z]\d{1,2}"
CELLS_ONLY_RE = re.compile(r"^(?:\d+|-)(?:\s+(?:\d+|-))*$")
PIN_RE = ROW_RE = NAME_ONLY_RE = None       # compiled by compile_pin_res()


def compile_pin_res(pat=DEFAULT_PIN_PAT, max_cols=8):
    """One pattern, three uses: the name alone, and a name after a row of cells."""
    global PIN_RE, ROW_RE, NAME_ONLY_RE
    PIN_RE = re.compile(rf"^{pat}$")
    ROW_RE = re.compile(rf"^((?:(?:\d+|-)\s+){{1,{max_cols}}})({pat})\b")
    # The name on its own line, optionally with a footnote marker, and optionally with
    # the pin-TYPE cell that the conversion sometimes leaves attached: CH32X035's PC3
    # arrives as "PC3 I/O/A" after its cells. The type alphabet is closed (DS Table 2-1
    # note 1: I, O, A, P) so this cannot swallow a remap-function continuation line,
    # which is what a looser "name followed by anything" pattern would have done.
    NAME_ONLY_RE = re.compile(
        rf"^({pat})\s*(?:\(\d+\))?(?:\s+[IOAP](?:/[IOAP])*)?\s*(?:\(\d+\))?\s*$")


compile_pin_res()
FOOTNOTE_RE = re.compile(r"^\(\d+\)\s*$")

# Lines the PDF conversion sprinkles through the table. None of them can match ROW_RE
# once the "## " prefix is gone, but the end-of-table marker has to be explicit.
END_MARKERS = ("Note 1: Explanation of table abbreviations",
               "Note  1:  Explanation")

# ...and so does the NEXT TABLE, which is a trap this tool fell into on its first run
# against CH32X035. That datasheet follows "Table 2-1 CH32X035 Pin definitions" with
# "Table 2-2 CH32X033 Pin definitions" - a DIFFERENT PART with FEWER package columns -
# and neither end marker appears between them. The parser read straight on and produced
# 26 rows whose cell count did not match, all of them CH32X033 rows wearing CH32X035
# pin names. They were reported as ambiguous rather than silently believed, which is
# the only reason this was visible at all.
NEXT_TABLE_RE = re.compile(r"^Table\s+\d+-\d+")


def read_table(ds_path, table_title, columns):
    lines = Path(ds_path).read_text(encoding="utf-8", errors="replace").splitlines()
    start = None
    for i, ln in enumerate(lines):
        if table_title in ln:
            start = i + 1
            break
    if start is None:
        raise LookupError("table not found: " + repr(table_title))

    out = {c: {} for c in columns}
    seen, ambiguous = [], []
    pending = []          # cells seen on their own line(s), waiting for a pin name
    for ln in lines[start:]:
        s = ln.strip()
        if s.startswith("##"):
            s = s[2:].strip()
        if any(m in s for m in END_MARKERS):
            break
        # A table ends where the next one begins, even with no end marker between them.
        if NEXT_TABLE_RE.match(s) and table_title not in s:
            break

        # Some rows are broken across lines by the PDF conversion, cells first:
        #     ## 12 4 1     ## 14     ## PD7     ## (4)     ## (5)
        # Collect bare number/dash lines and attach them to the next bare pin name.
        # The exact-cell-count rule below is what keeps this safe: if a stray page
        # number gets swept up, the count stops matching and the row is reported as
        # ambiguous instead of landing a pin on the wrong package.
        if CELLS_ONLY_RE.match(s):
            # A cell block only STARTS on a line carrying more than one cell. A lone
            # number on its own line is far more often the tail of the PREVIOUS row's
            # wrapped remap text - CH32X035's PB11 ends "…/T2C1N_" then "6" on its own
            # line - and letting that open a block poisoned the next row's cell count.
            # Once a block is open, single-cell lines legitimately extend it, which is
            # how "44 32 26 2 / 17 / 17 / 7 PC16" is read back as seven cells.
            bits = s.split()
            if pending or len(bits) > 1:
                pending.extend(bits)
            continue
        bare = NAME_ONLY_RE.match(s)
        if bare and pending:
            cells, name = pending, bare.group(1)
            pending = []
            if len(cells) != len(columns):
                ambiguous.append((name, cells, " ".join(cells) + " " + name))
                continue
            seen.append(name)
            for col, cell in zip(columns, cells):
                if cell != "-":
                    out[col].setdefault(int(cell), set()).add(name)
            continue

        m = ROW_RE.match(s)
        if not m:
            if s and not FOOTNOTE_RE.match(s):
                pending = []      # any other content breaks the association
            continue
        cells = m.group(1).split()
        name = m.group(2)
        # A row the conversion split with the NAME on the final fragment:
        #     44 32 26 2
        #     17
        #     17
        #     7 PC16
        # The leading cells arrive as their own lines and the last one carries both a
        # cell and the pin name. Joining them is only safe when the two halves add up to
        # exactly the column count - if they do not, the row stays ambiguous rather than
        # being padded into a plausible shape. CH32X035 needs this; CH32V006 never hits
        # it, which is why the regression run matters more than the new count.
        if pending and len(cells) < len(columns) and len(pending) + len(cells) == len(columns):
            cells = pending + cells
        pending = []
        if len(cells) != len(columns):
            # Most rows spell an absent package as "-", but some drop the placeholder
            # entirely, and then the cells cannot be tied to columns by position:
            # "14 31 PD7" could be any two of five packages. Assigning the first N
            # would shift the pin onto the wrong package while still looking tidy, so
            # the row is set aside and reported rather than guessed at.
            ambiguous.append((name, cells, s[:90]))
            continue
        seen.append(name)
        for col, cell in zip(columns, cells):
            if cell == "-":
                continue
            # A pin number can carry TWO names: DS notes 3 and 4 short PA1+PA6 and
            # PD7+PA4 inside the package, and the table gives each its own row. Keying
            # by number alone made the second row overwrite the first and the pair then
            # read as missing from the datasheet.
            out[col].setdefault(int(cell), set()).add(name)
    if not seen:
        raise LookupError("no pin rows parsed under " + repr(table_title))
    return out, seen, ambiguous


def yaml_tables(path):
    """Resolve `mcu.inherits` the way the engine does, then return {pkg: {num: [names]}}."""
    import yaml
    doc = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    parent = (doc.get("mcu") or {}).get("inherits")
    if parent:
        pfile = Path(path).parent / (str(parent) + ".yaml")
        if not pfile.exists():
            raise LookupError("inherits " + str(parent) + " but " + str(pfile) + " is missing")
        base = yaml.safe_load(pfile.read_text(encoding="utf-8"))
        merged = deep_merge(base, doc)
        for p in (doc.get("mcu") or {}).get("remove") or []:
            remove_path(merged, p)
        doc = merged
    out = {}
    for pkg, table in (doc.get("packages") or {}).items():
        out[pkg] = {int(k): (v if isinstance(v, list) else [v]) for k, v in table.items()}
    return out


def deep_merge(base, over):
    if not isinstance(base, dict) or not isinstance(over, dict):
        return over
    out = dict(base)
    for k, v in over.items():
        out[k] = deep_merge(base[k], v) if k in base else v
    return out


def remove_path(obj, path):
    parts = str(path).split(".")
    o = obj
    for p in parts[:-1]:
        if not isinstance(o, dict):
            return False
        o = o.get(p)
    if isinstance(o, dict) and parts[-1] in o:
        del o[parts[-1]]
        return True
    return False


def apply_corrections(ds, columns, path):
    """Rows the PDF conversion destroyed, supplied explicitly and printed every run.

    This exists because "0 differences" has to stay an honest claim. Two rows of
    CH32X035's Table 2-1 cannot be recovered by any parser: PB19 lost one of its seven
    placeholder dashes, and PC3's second row lost its name line entirely. Silently
    patching either into the YAML would turn a known gap into an invisible assumption,
    which is the failure this project keeps finding. So they live in a file, each with a
    `reason:` naming the DS line, and every run prints them before the diff.

    Format:
        PB19:
          reason: "DS line 1809 ... the conversion dropped one dash"
          cells: { LQFP64M: 40 }
    """
    import yaml
    try:
        doc = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    except Exception as exc:                       # noqa: BLE001
        print(f"CORRECTIONS: cannot read {path}: {exc}")
        return None
    print(f"CORRECTIONS: {path}")
    for name, spec in sorted(doc.items()):
        if not isinstance(spec, dict) or not spec.get("reason"):
            print(f"  REFUSED  {name}: every correction needs a `reason:` citing the DS")
            return None
        cells = spec.get("cells") or {}
        bad = [c for c in cells if c not in columns]
        if bad:
            print(f"  REFUSED  {name}: not a column of this table: {', '.join(bad)}")
            return None
        for col, num in cells.items():
            ds[col].setdefault(int(num), set()).add(name)
        where = ", ".join(f"{c} {n}" for c, n in sorted(cells.items())) or "(no pins)"
        print(f"  {name:<6} {where}")
        print(f"         {Report_safe(spec['reason'])}")
    if not doc:
        print("  (none)")
    return doc


def Report_safe(text):
    enc = getattr(sys.stdout, "encoding", None) or "ascii"
    return str(text).encode(enc, "replace").decode(enc, "replace")


def main():
    ap = argparse.ArgumentParser(description="Diff a datasheet pin table against an MCU YAML.")
    ap.add_argument("--ds", default=str(DEFAULT_DS))
    ap.add_argument("--table", required=True, help="exact table caption to search for")
    ap.add_argument("--columns", required=True,
                    help="package ids in datasheet column order, comma separated")
    ap.add_argument("--yaml", dest="yml", required=True)
    ap.add_argument("--pin-re", default=DEFAULT_PIN_PAT,
                    help=f"regex for a pin name (default: {DEFAULT_PIN_PAT})")
    ap.add_argument("--corrections",
                    help="YAML of rows the PDF conversion destroyed; every entry needs a "
                         "`reason:` citing the DS line. Printed in full on every run.")
    args = ap.parse_args()

    columns = [c.strip() for c in args.columns.split(",") if c.strip()]
    # The row pattern needs to allow one cell per package column, and this datasheet
    # has seven of them where CH32V006 had five.
    compile_pin_res(args.pin_re, max_cols=max(8, len(columns)))
    try:
        ds, seen, ambiguous = read_table(args.ds, args.table, columns)
    except LookupError as e:
        print("DS PARSE FAILURE: " + str(e))
        return 2

    if args.corrections:
        applied = apply_corrections(ds, columns, args.corrections)
        if applied is None:
            return 2

    print("DS   : " + args.ds)
    print("Table: " + args.table)
    print("YAML : " + args.yml + "\n")
    print("Parsed " + str(len(seen)) + " I/O pin rows across "
          + str(len(columns)) + " package column(s).")
    for c in columns:
        print("  " + c.ljust(9) + str(len(ds[c])) + " I/O pins")
    if ambiguous:
        print("")
        print(str(len(ambiguous)) + " row(s) could not be tied to columns "
              "(the PDF dropped the '-' placeholders). NOT CHECKED -- verify by hand:")
        for name, cells, raw in ambiguous:
            print("  ? " + name + ": cells " + " ".join(cells) + "   [" + raw + "]")
    print()

    try:
        yml = yaml_tables(args.yml)
    except LookupError as e:
        print("YAML FAILURE: " + str(e))
        return 2

    problems = []
    for pkg in columns:
        got = yml.get(pkg)
        if got is None:
            problems.append(pkg + ": in the datasheet, absent from the YAML")
            continue
        # YAML -> {name: number}, keeping both names of an internally shorted pair.
        where = {}
        for num, names in got.items():
            for n in names:
                if PIN_RE.match(n):
                    where[n] = num
        ds_names = set()
        for num, names in sorted(ds[pkg].items()):
            ds_names |= names
            for name in sorted(names):
                have = where.get(name)
                if have is None:
                    problems.append(pkg + ": DS puts " + name + " on pin " + str(num)
                                    + ", the YAML does not bond it at all")
                elif have != num:
                    problems.append(pkg + " " + name + ": DS says pin " + str(num)
                                    + ", YAML says pin " + str(have))
        unchecked = {a[0] for a in ambiguous}
        for name, num in sorted(where.items()):
            if name in ds_names or name in unchecked:
                continue
            problems.append(pkg + ": YAML bonds " + name + " on pin " + str(num)
                            + ", the DS table does not list it")

    if problems:
        print("DIFFERENCES: " + str(len(problems)))
        for p in problems:
            print("  x " + p)
        return 1
    print("DIFFERENCES: 0 -- every I/O pin sits on the number the datasheet gives"
          + (" (except the ambiguous rows listed above)." if ambiguous else "."))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
