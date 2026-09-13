#!/usr/bin/env python3
"""Audit CH32H417's peripheral pin routing against the DS's own peripheral-first tables,
project-wide -- the `tools/audit_h417_dedicated.py` discipline (Table 2-2-12/16 vs the
generator's Table 2-1-1 reading) extended to every peripheral that has one.

WHY THIS TABLE SERIES AND NOT ANOTHER ONE. `CH32H417DS0.md` section 2.2 is a run of
peripheral-first tables, "Table 2-2-1" through "Table 2-2-31", one
or more per peripheral group, each SIGNAL-first: one row per function, listing every pin
(and its AF code, where AFIO mux applies) that function can reach. This is STRUCTURALLY
INDEPENDENT of Table 2-1-1 (the PIN-first table `tools/gen_h417_dedicated_pins.py` reads)
and of `tools/gen_h417_peripherals.py`'s own generation path -- so agreeing with it is
real evidence a peripheral's `signal_pins:` are right, not a restatement of how they were
produced. Re-deriving pins from the same source that produced them proves the tool is
self-consistent, never that the DATA is correct; this table exists so the check does not
make that mistake.

THE HARD GUARD, non-negotiable, the whole difference between this tool and a false one:
an unrecognised table shape is a HARD ERROR that NAMES the table -- never a skip, never a
`continue`, never a silently-empty pass. Round 5's header checks silently `continue`-ing
past three of six parts and reading green is this repo's own scar for exactly this
mistake. So `TABLES` below lists EVERY "Table 2-2-N" this datasheet has, whether or not
this run actually audits it, and `main()` cross-checks that list against every such
heading the DS itself contains -- a table appearing in the DS that is not in `TABLES` is
UNKNOWN and fails the run, by name, before anything else is printed as a result.

Four shapes have been found by inspection (`agents/BOARD.md`, this file's own history):
    af_list          "SIGNAL  PIN(AFn), PIN(AFn)..."      -- the majority; AFIO-muxed
    no_af            "SIGNAL  PIN"                         -- a dedicated pad, no AF mux
    internal_channel "SIGNAL  PIN/ALIAS, PIN/ALIAS..."     -- OPA/CMP's analog switch
    deferred         anything else, or a table under active change elsewhere
Only `af_list` has a parser in this pass (main()'s ORDER argument), per the owner's
priority and the manager's explicit sequencing: AF-list first (the majority of
peripherals), no-AF and internal-channel next, the SDMMC/UHSIF remap-column shape and
SWPMI's two-mode-column shape LAST because both are under active change elsewhere right
now and must not be asserted about out from under whoever is mid-edit on them.
A table registered here with a shape this run does not implement is PENDING, printed and
counted, never silently treated as "checked and clean".

Exit codes: 0 clean (every af_list table agrees, nothing UNKNOWN); 1 a real difference (or
an UNKNOWN table) was found; 2 the DS or the MCU file could not be read at all.
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_DS = ROOT / 'data/sources/H417/Datasheets/CH32H417DS0.md'
DEFAULT_MCU = ROOT / 'data/mcus/CH32H417.yaml'

# =============================================================================
# THE REGISTRY. Every "Table 2-2-N ... Pin function(s)" this datasheet has, found by
# reading section 2.2 start to finish (there is no table of contents this could be
# derived from mechanically without re-reading the whole thing anyway, so a hand-built,
# exhaustively cross-checked list -- verified against `main()`'s own DS scan below -- is
# the honest way to do this, not a shortcut around it).
#
# `prefix_map` names, for each "<X> function" sub-heading this table's body switches on,
# the (ds_prefix_to_strip, yaml_peripheral_id) pair. `None` for the ds_prefix half means
# "no prefix on the signal name at all" (USBPD's DS rows are bare `CC1`/`CC2`).
# =============================================================================
TABLES = {
    1: {'title': 'ADC', 'shape': 'no_af'},
    2: {'title': 'HSADC', 'shape': 'no_af'},
    3: {'title': 'DAC', 'shape': 'no_af'},
    4: {'title': 'TIM', 'shape': 'af_list',
        'prefix_map': {f'TIM{n}': ('TIM' + str(n), 'TIM' + str(n)) for n in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)}},
    5: {'title': 'LPTIM', 'shape': 'af_list',
        'prefix_map': {f'LPTIM{n}': (f'LPTIM{n}', f'LPTIM{n}') for n in (1, 2)}},
    6: {'title': 'I2C', 'shape': 'af_list',
        'prefix_map': {f'I2C{n}': (f'I2C{n}', f'I2C{n}') for n in (1, 2, 3, 4)}},
    7: {'title': 'I3C', 'shape': 'af_list', 'prefix_map': {'I3C': ('I3C', 'I3C')}},
    8: {'title': 'SPI and I2S', 'shape': 'af_list',
        'prefix_map': {
            'SPI1': ('SPI1', 'SPI1'),
            'SPI2/I2S2': ('SPI2', 'SPI2'),  # each row also carries an I2S2_* half; see split_dual()
            'SPI3/I2S3': ('SPI3', 'SPI3'),
            'SPI4': ('SPI4', 'SPI4'),
        },
        'dual_prefix_map': {'I2S2': ('I2S2', 'I2S2'), 'I2S3': ('I2S3', 'I2S3')}},
    9: {'title': 'USART', 'shape': 'af_list',
        'prefix_map': {f'USART{n}': (f'USART{n}', f'USART{n}') for n in range(1, 9)}},
    10: {'title': 'Debug', 'shape': 'no_af'},
    11: {'title': 'SDIO', 'shape': 'af_list', 'prefix_map': {'SDIO': ('SDIO', 'SDIO')}},
    12: {'title': 'SDMMC', 'shape': 'deferred'},   # remap-column shape; under active change
    13: {'title': 'CAN', 'shape': 'af_list',
         'prefix_map': {f'CAN{n}': (f'CAN{n}', f'CAN{n}') for n in (1, 2, 3)}},
    14: {'title': 'FSMC', 'shape': 'af_list', 'prefix_map': {'FSMC': ('FSMC', 'FMC')}},
    15: {'title': 'SDRAM', 'shape': 'af_list', 'prefix_map': {'SDRAM': ('SDRAM', 'FMC')}},
    16: {'title': 'UHSIF', 'shape': 'deferred'},   # remap-column shape; under active change
    17: {'title': 'USBPD', 'shape': 'af_list', 'prefix_map': {'USBPD': (None, 'USBPD')}},
    18: {'title': 'USBFS', 'shape': 'no_af'},
    19: {'title': 'USBHS', 'shape': 'no_af'},
    20: {'title': 'SerDes', 'shape': 'no_af'},
    21: {'title': 'OPA', 'shape': 'internal_channel',
         'prefix_map': {f'OPA{n}': (f'OPA{n}', 'OPA') for n in (1, 2, 3)}},
    22: {'title': 'CMP', 'shape': 'internal_channel', 'prefix_map': {'CMP': ('CMP', 'CMP')}},
    23: {'title': 'DVP', 'shape': 'af_list', 'prefix_map': {'DVP': ('DVP', 'DVP')}},
    24: {'title': 'Ethernet', 'shape': 'deferred'},  # mixed RGMII_/ETH_ prefixes, no single
                                                       # ds_prefix; ETH's own `params:` are
                                                       # explicitly parked (agents/BOARD.md
                                                       # 2026-09-14T00:20Z, AGENT-1) pending
                                                       # an init_structs mechanism for its
                                                       # PHYAddress argument -- inspect its
                                                       # signal_pins: shape again once that lands
    25: {'title': 'QSPI', 'shape': 'af_list',
         'prefix_map': {f'QSPI{n}': (f'QSPI{n}', f'QSPI{n}') for n in (1, 2)}},
    26: {'title': 'SWPMI', 'shape': 'deferred'},   # two-mode-column shape, not yet built
    27: {'title': 'SAI', 'shape': 'af_list', 'prefix_map': {'SAI': ('SAI', 'SAI')}},
    28: {'title': 'LTDC', 'shape': 'af_list', 'prefix_map': {'LTDC': ('LTDC', 'LTDC')}},
    29: {'title': 'DFSDM', 'shape': 'af_list', 'prefix_map': {'DFSDM': ('DFSDM', 'DFSDM')}},
    30: {'title': 'MCO', 'shape': 'af_list', 'prefix_map': {'MCO': (None, 'MCO')}},
    31: {'title': 'PIOC', 'shape': 'af_list', 'prefix_map': {'PIOC': ('PIOC', 'PIOC')}},
}

PIN = re.compile(r'^P[A-Z]\d{1,2}$')
# A pin cell with an AF number: `PA12(AF7)`. AF is optional-looking here on purpose --
# a cell that fails to match this AND fails PIN below is a parse anomaly to REPORT, not
# a shape to guess at (the PDF conversion drops parens and appends stray letters, e.g.
# `PF5AF9)` and `PB15(AF9s)` -- both seen for real in this datasheet).
CELL_AF = re.compile(r'^(P[A-Z]\d{1,2})\(AF(\d{1,2})\)$')
CELL_BARE = re.compile(r'^(P[A-Z]\d{1,2})$')
FUNCTION_HEADING = re.compile(r'^([A-Za-z0-9/]+)\s+function\b')
# The Chinese full-width comma the PDF conversion mixes in with ordinary commas.
SPLIT_SEP = re.compile(r'[,、]')


def ds_text(ds_path: pathlib.Path) -> str:
    return ds_path.read_text(encoding='utf-8', errors='replace')


def all_table_headings(text: str) -> dict[int, str]:
    """Every `Table 2-2-<N> <title>` this datasheet actually contains, however it is
    introduced (`Table 2-2-10` arrives as `## Table 2-2-10 ...`, everything else as a bare
    line) -- used ONLY to catch a table this file's own registry does not know about."""
    found: dict[int, str] = {}
    for m in re.finditer(r'^#*\s*Table\s*2-2-(\d+)\s+(.+)$', text, re.MULTILINE):
        found[int(m.group(1))] = m.group(2).strip()
    return found


def table_body(text: str, n: int) -> str | None:
    """The raw text of Table 2-2-<n>, up to the next 2-2-<m> heading OR the next chapter
    boundary -- Table 2-2-31 (PIOC) is the LAST one, so with no next 2-2 table to stop at
    it would otherwise run straight into Chapter 3's electrical characteristics prose."""
    m = re.search(r'^#*\s*Table\s*2-2-%d\s' % n, text, re.MULTILINE)
    if not m:
        return None
    rest = text[m.end():]
    stops = [x.start() for x in (
        re.search(r'^#*\s*Table\s*2-2-\d+\s', rest, re.MULTILINE),
        re.search(r'^#*\s*Chapter\s+\d', rest, re.MULTILINE),
    ) if x]
    return rest[:min(stops)] if stops else rest[:12000]


# Page-footer/running-header noise the PDF conversion leaves behind mid-table, on its own
# line(s): the datasheet's own title banner and the "V<major>.<minor>  <page>" stamp.
# Filtered out before a line is ever offered to the row parser, rather than reported as
# an anomaly each time -- this is layout noise, not a fact about a signal named `V1`.
FOOTER_BANNER = re.compile(r'^CH32H417/H416/H415\s+Datasheet\b')
FOOTER_VERSION = re.compile(r'^V\d+\.\d+\s+\d+$')


def clean_line(raw: str) -> str:
    return raw.strip().lstrip('#').strip()


def is_footer_noise(line: str) -> bool:
    return bool(FOOTER_BANNER.match(line) or FOOTER_VERSION.match(line))


def looks_like_cell_continuation(line: str) -> bool:
    """True when `line`'s FIRST token is pin-shaped (`PA12(AF7)` or bare `PA12`) -- a
    wrapped cell list continuing from the previous signal's row, not a new signal name.
    Real signal names in this table series never take that shape (`TIM1_CH1`, `OPA1_P`,
    `MCO`, ... -- letters and underscores, never `P` + digits alone), so this is a safe
    way to tell "more cells for the row above" from "a new row" without a lookahead that
    only checks ONE line ahead, which is exactly what missed `LTDC_B4`'s SECOND wrapped
    line (`PE1(AF15)`, alone on its own line after an already non-empty first line)."""
    first = line.split()[0] if line.split() else ''
    first = SPLIT_SEP.split(first)[0]
    return bool(CELL_AF.match(first) or CELL_BARE.match(first))


def split_cells(rest: str, anomalies: list[str], where: str) -> list[tuple[str, int | None]]:
    """The pin cells in the tail of a row, as `(pin, af_or_None)`. Every whitespace- or
    comma-separated token must resolve to a recognised cell shape or it is an ANOMALY,
    reported by name -- never dropped silently, which is exactly how a corrupted AF
    number or a torn pin name would go unnoticed."""
    out: list[tuple[str, int | None]] = []
    for tok in (t for chunk in rest.split() for t in SPLIT_SEP.split(chunk) if t):
        m = CELL_AF.match(tok)
        if m:
            out.append((m.group(1), int(m.group(2))))
            continue
        m = CELL_BARE.match(tok)
        if m:
            out.append((m.group(1), None))
            continue
        anomalies.append(f'{where}: unrecognised pin cell {tok!r}')
    return out


def strip_prefix(name: str, ds_prefix: str | None) -> str | None:
    if ds_prefix is None:
        return name
    if name == ds_prefix:
        return name  # a self-named single signal, e.g. MCO's own row is just `MCO`
    if name.startswith(ds_prefix + '_'):
        rest = name[len(ds_prefix) + 1:]
        return rest or name
    return None


def resolve_half(half: str, current: str, prefix_map: dict, dual_map: dict) -> tuple[str, str] | None:
    """Which `(ds_prefix, yaml_pid)` a signal-name HALF belongs to: the dual-prefix map
    first (checked by the half's own prefix, not an exact dict-key match -- a dual map
    keyed `I2S2` must still match the half `I2S2_MCK`), then the table's current
    sub-heading. `ds_prefix is None` means "this peripheral's DS rows carry no prefix at
    all" (USBPD's bare `CC1`/`CC2`, MCO's bare `MCO`) -- accepted outright, never run
    through a `startswith(current)` check that a bare name could never pass."""
    for dp_prefix, (ds_prefix, pid) in dual_map.items():
        if half == dp_prefix or half.startswith(dp_prefix + '_'):
            return ds_prefix, pid
    ds_prefix, pid = prefix_map[current]
    # Match against the peripheral's OWN ds_prefix (`SPI2`), never the table's compound
    # sub-heading name (`SPI2/I2S2`, which no real signal name is ever a prefix of).
    if ds_prefix is None or half == ds_prefix or half.startswith(ds_prefix):
        return ds_prefix, pid
    return None


def parse_af_list(body: str, spec: dict, anomalies: list[str]) -> dict[str, dict[str, set]]:
    """`{yaml_pid: {short_signal: {(pin, af), ...}}}` for one `af_list`-shaped table."""
    prefix_map = spec.get('prefix_map', {})
    dual_map = spec.get('dual_prefix_map', {})
    current: str | None = None
    out: dict[str, dict[str, set]] = {}
    lines = [clean_line(l) for l in body.splitlines() if not is_footer_noise(clean_line(l))]
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        if not line:
            continue
        head = FUNCTION_HEADING.match(line)
        if head and head.group(1) in prefix_map:
            current = head.group(1)
            continue
        if current is None:
            continue  # front matter (the table's own title line, notes) before the first heading
        m = re.match(r'^([A-Za-z][A-Za-z0-9_/]*)\s*(.*)$', line)
        if not m:
            anomalies.append(f'{current}: unparsed line {line!r}')
            continue
        name, rest = m.group(1), m.group(2)
        # A row's pin list can wrap across MORE THAN ONE physical line (`LTDC_B4`'s cells
        # span three lines total) -- keep pulling lines in as long as each one's first
        # token is pin-shaped, not just one lookahead line, and not just when `rest` on
        # the name's own line was empty (a line can start non-empty and still continue).
        parts = [rest] if rest else []
        while i < len(lines) and lines[i] and looks_like_cell_continuation(lines[i]):
            parts.append(lines[i])
            i += 1
        cells = split_cells(' '.join(parts), anomalies, f'{current}.{name}') if parts else []
        if not cells:
            anomalies.append(f'{current}: {name!r} has no parseable pin cell (row: {line!r})')
            continue
        # A dual-labelled pad (`SPI2_NSS/I2S2_WS`): each half goes to its OWN peripheral,
        # both with the identical pin set -- the physical pad is one, the claim is two.
        targets: list[tuple[str, str]] = []
        for half in name.split('/'):
            hit = resolve_half(half, current, prefix_map, dual_map)
            if hit is None:
                anomalies.append(f'{current}: {name!r} half {half!r} matches neither '
                                  f'{current!r} nor a dual prefix in {sorted(dual_map)}')
                continue
            ds_prefix, pid = hit
            short = strip_prefix(half, ds_prefix)
            if short is None:
                anomalies.append(f'{current}: {half!r} does not start with expected prefix {ds_prefix!r}')
                continue
            targets.append((pid, short))
        for pid, short in targets:
            out.setdefault(pid, {}).setdefault(short, set()).update(cells)
    return out


def actual_signal_pins(doc: dict, pid: str) -> dict[str, set]:
    per = ((doc.get('peripherals') or {}).get(pid) or {}).get('signal_pins') or {}
    out: dict[str, set] = {}
    for name, entries in per.items():
        out[name] = {(e['pin'], e.get('af')) for e in entries}
    return out


def compare(pid: str, want: dict[str, set], got: dict[str, set], out: list[str]) -> int:
    bad = 0
    missing = sorted(set(want) - set(got))
    extra = sorted(set(got) - set(want))
    if missing:
        bad += 1
        out.append(f'   {pid}: MISSING from the file ({len(missing)}): {missing}')
    if extra:
        bad += 1
        out.append(f'   {pid}: NOT IN THE DS ({len(extra)}): {extra}')
    for s in sorted(set(want) & set(got)):
        if want[s] != got[s]:
            bad += 1
            out.append(f'   {pid}.{s}: DS {sorted(want[s])}  file {sorted(got[s])}')
    return bad


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ds', default=str(DEFAULT_DS))
    ap.add_argument('--yaml', dest='yml', default=str(DEFAULT_MCU))
    args = ap.parse_args()

    ds_path = pathlib.Path(args.ds)
    yml_path = pathlib.Path(args.yml)
    if not ds_path.exists():
        print(f'DS not found: {ds_path}', file=sys.stderr)
        return 2
    if not yml_path.exists():
        print(f'MCU file not found: {yml_path}', file=sys.stderr)
        return 2

    text = ds_text(ds_path)
    try:
        doc = yaml.safe_load(yml_path.read_text(encoding='utf-8'))
    except Exception as e:  # noqa: BLE001 - a YAML parse failure is reported, not swallowed
        print(f'YAML FAILURE reading {yml_path}: {e}', file=sys.stderr)
        return 2

    # THE HARD GUARD: every "Table 2-2-N" the DS actually contains must be in TABLES.
    present = all_table_headings(text)
    unknown = sorted(set(present) - set(TABLES))
    if unknown:
        print('UNKNOWN TABLE(S) -- present in the datasheet, absent from this tool\'s registry:')
        for n in unknown:
            print(f'  Table 2-2-{n}: {present[n]!r} -- add it to TABLES before trusting this run')
        print('\nRefusing to report a clean result while a table this tool has never seen exists.')
        return 2
    missing_from_ds = sorted(set(TABLES) - set(present))
    if missing_from_ds:
        print('TABLE(S) IN THE REGISTRY NO LONGER IN THE DATASHEET (the parse pattern moved, '
              'or the table was renumbered) -- also refusing to report a clean result:')
        for n in missing_from_ds:
            print(f'  Table 2-2-{n}: {TABLES[n]["title"]!r}')
        return 2

    by_shape: dict[str, list[int]] = {}
    for n, spec in TABLES.items():
        by_shape.setdefault(spec['shape'], []).append(n)

    print(f'{len(TABLES)} table(s) known (Table 2-2-1 .. 2-2-31), all present in the DS.')
    for shape in ('af_list', 'no_af', 'internal_channel', 'deferred'):
        ns = sorted(by_shape.get(shape, []))
        if not ns:
            continue
        names = ', '.join(f'{n}:{TABLES[n]["title"]}' for n in ns)
        audited = ' -- AUDITED THIS RUN' if shape == 'af_list' else ' -- NOT audited this run (pending)'
        print(f'  {shape} ({len(ns)}): {names}{audited}')
    print()

    anomalies: list[str] = []
    diffs: list[str] = []
    bad = 0
    # Merge EVERY af_list table's contribution to a `pid` BEFORE comparing against the
    # YAML, never compare table by table: two different DS tables can legitimately feed
    # the same peripheral (FSMC's address/data bus and SDRAM's control signals both land
    # on the yaml's single `FMC` entry, one external memory controller with two modes).
    # Comparing table 14 alone against `FMC`'s full signal set would read every
    # SDRAM-only signal as "not in the DS" -- true only of THAT table, not of the DS as a
    # whole, and exactly the false positive a per-table compare would have shipped.
    merged: dict[str, dict[str, set]] = {}
    for n in sorted(by_shape.get('af_list', [])):
        spec = TABLES[n]
        body = table_body(text, n)
        if body is None:
            print(f'Table 2-2-{n} ({spec["title"]}) heading matched but its body could not be '
                  f'sliced out -- treating as a parse failure, not a clean table.')
            bad += 1
            continue
        got_from_ds = parse_af_list(body, spec, anomalies)
        for pid, sigs in got_from_ds.items():
            dest = merged.setdefault(pid, {})
            for short, cells in sigs.items():
                dest.setdefault(short, set()).update(cells)

    covered_pids = set(merged)
    for pid, sigs in merged.items():
        got_from_yaml = actual_signal_pins(doc, pid)
        bad += compare(pid, sigs, got_from_yaml, diffs)

    if anomalies:
        print(f'{len(anomalies)} PARSE ANOMALY/ANOMALIES (a row this run could not read with confidence '
              f'-- NOT counted as agreement, and not silently dropped either):')
        for a in anomalies:
            print(f'  ! {a}')
        print()

    print(f'{len(covered_pids)} peripheral(s) covered by the af_list tables audited this run: '
          f'{", ".join(sorted(covered_pids))}')
    print()

    if diffs:
        print(f'{bad} difference(s) against the DS Table 2-2-x series:')
        for d in diffs:
            print(d)
    else:
        print('Every af_list-covered peripheral agrees with its DS Table 2-2-x entry, signal for '
              'signal, pin for pin, AF for AF.')

    if anomalies or bad:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
