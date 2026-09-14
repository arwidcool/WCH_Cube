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

THE SECOND HARD LESSON, found the expensive way on this tool's first real run (main,
2026-09-13/14, `agents/BOARD.md`): agreeing with a Table 2-2-x reading is real evidence a
peripheral's `signal_pins:` are right, because the two tables are independent sources --
but DISAGREEING with one is NOT evidence the FILE is wrong. It is only evidence the
DATASHEET'S TWO TABLES disagree with each other, and in `CH32H417DS0.md` specifically,
**Table 2-2-x is measurably less reliable than Table 2-1-1**: checking eight raw diffs
against Table 2-1-1 by hand (2026-09-13) found five were Table 2-2-x's own error, one was
a naming inconsistency Table 2-1-1 sides with the file on, one was `MCO` -- which turned
out not to be a file defect either, just this tool's own registry pointing `MCO` at a
top-level peripheral that never existed (it is one choice-row of `RCC`'s own setting) --
and one (`FMC.RAS_N`) was a genuine gap, confirmed by a third source (the EVT). A tool
that read every Table-2-2-x disagreement as "the file is wrong" would have been wrong 6
times out of 8.

So every diff against Table 2-2-x is now cross-checked against Table 2-1-1 (imported from
`tools/extract_h417_pins.py`, AGENT-1's own battle-tested parser for that table -- this
file does not re-parse Table 2-1-1 itself, both to avoid a second buggy parser and because
that parser already handles the PDF's line-wrap and split-name/split-AF damage this table
carries) and resolved to exactly THREE verdicts, never a fourth invented one:

**The payoff of importing rather than re-implementing, seen for real the next day**:
AGENT-1 found and fixed a THIRD line-wrap variant in `extract_h417_pins.py` (`PF11`'s
`SDRAM_RAS_N(AF12` split from its closing paren across a page boundary -- `SPLIT_AF_CLOSE`)
while chasing exactly the `FMC.RAS_N` gap this tool's own EVT cross-check had already found
by hand. One fix, and this tool's Table 2-1-1 reading improved with zero code changes here
-- re-running confirmed `file_defect` still 0 and exactly one line (the now-resolved
`FMC.RAS_N`) dropped out of the diff, nothing else moved. Two independently-written parsers
for the same PDF-mangled table would have had two different blind spots and no way to
notice they disagreed; importing means there is exactly one blind spot to find at a time,
and finding it helps both tools at once.

    file_defect                Table 2-1-1 confirms Table 2-2-x's claim, against the file
                                -- a real gap or wrong value; fix the file.
    datasheet_self_contradiction   Table 2-1-1 confirms what the FILE already has, against
                                Table 2-2-x's differing claim -- the file is right; the
                                datasheet's two tables disagree with each other.
    unresolved                  Table 2-1-1 does not confirm EITHER side for this specific
                                pin -- most often a signal Table 2-2-x adds that is missing
                                from the file, where Table 2-1-1 assigns that exact pin/AF
                                to something else entirely (`LPTIM2_CH2` claimed on `PB12`
                                AF13, where `PB12`'s own COMPLETE, gapless Table 2-1-1 AF0-15
                                list puts `CMP_OUT` there instead) -- both DS tables are
                                internally consistent with THEMSELVES and contradict each
                                other, and this tool does not pick a side without a third
                                source. Model as `disagreements:`, per main's ruling.

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

Exit codes: 0 clean (every af_list table agrees or every disagreement resolved to
`datasheet_self_contradiction`/`unresolved`, never `file_defect`, and every row parsed with
no anomaly); 1 a `file_defect` verdict, or a parse anomaly, was found; 2 an UNKNOWN table,
a registered table gone missing from the DS, or the DS/MCU file could not be read at all.
"""
from __future__ import annotations

import argparse
import importlib.util
import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_DS = ROOT / 'data/sources/H417/Datasheets/CH32H417DS0.md'
DEFAULT_MCU = ROOT / 'data/mcus/CH32H417.yaml'


def _load_extract_h417_pins():
    """Import `tools/extract_h417_pins.py` by path (it is not a package) -- reused, never
    reimplemented, for the Table 2-1-1 cross-check below. That file is AGENT-1's, already
    handles this table's PDF line-wrap and split-name/split-AF damage, and a second,
    independently-written parser for the SAME table would be a second place to have the
    exact bug this tool exists to catch in the first place."""
    path = ROOT / 'tools' / 'extract_h417_pins.py'
    spec = importlib.util.spec_from_file_location('extract_h417_pins', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def table_2_1_1_pin_functions(ds_path: pathlib.Path) -> dict[str, set[tuple[str, int]]]:
    """`{pin: {(signal, af_int), ...}}`, straight from Table 2-1-1 (the PIN-first table),
    via `extract_h417_pins.parse()`. This is the SECOND independent source `main()` uses
    to arbitrate a Table 2-2-x disagreement -- see the module docstring's three verdicts."""
    extract = _load_extract_h417_pins()
    rows, _tables, _signals = extract.parse(ds_path)
    out: dict[str, set[tuple[str, int]]] = {}
    for r in rows:
        pin = r['name']
        for sig, af in extract.AF.findall(r['text']):
            out.setdefault(pin, set()).add((sig, int(af[2:])))
    return out


def classify(pin: str, ds_full_signal: str, file_af: int | None, claimed_af: int | None,
             table_2_1_1: dict[str, set[tuple[str, int]]]) -> str:
    """One of the three verdicts (module docstring) for ONE contested pin on ONE signal.
    `file_af` is the AF the FILE gives this pin for this signal, `claimed_af` is what
    Table 2-2-x gives it -- exactly one is `None` for a missing/extra pin, both present
    (and different) for a value mismatch.

    Two independent tests against Table 2-1-1, either one decisive on its own:

    CONFIRMED - Table 2-1-1 has this exact (signal, af) on this pin. Direct positive
    evidence for that side.

    DENIED - Table 2-1-1 has THIS AF NUMBER on this pin assigned to a DIFFERENT signal.
    Positive evidence AGAINST that side, and it needs no separate "is this pin's entry a
    complete 0-15 enumeration" check first (main, 2026-09-14, on `LPTIM2.CH2`): if the
    slot is occupied by something else, that IS the fact, whether or not every other slot
    on the same pin is also documented. A slot with NOTHING recorded at all -- neither
    this signal nor another -- is simply not decided either way, which is exactly what
    `unresolved` already means; a full 0-15 walk of the pin's OTHER slots would only ever
    confirm what a direct look at the ONE contested slot already tells you.

    Confirming or denying ONE side and not the other is decisive; the same verdict on both
    (both confirmed only happens if they're equal, which never reaches this function;
    both denied means Table 2-1-1 disagrees with EVERYTHING contested, an internal
    puzzle) or neither is `unresolved` -- never guessed."""
    entries = table_2_1_1.get(pin, set())

    def confirmed(af):
        return af is not None and (ds_full_signal, af) in entries

    def denied(af):
        return af is not None and any(a == af and s != ds_full_signal for s, a in entries)

    if confirmed(claimed_af) and not confirmed(file_af):
        return 'file_defect'
    if confirmed(file_af) and not confirmed(claimed_af):
        return 'datasheet_self_contradiction'
    if denied(claimed_af) and not denied(file_af):
        return 'datasheet_self_contradiction'
    if denied(file_af) and not denied(claimed_af):
        return 'file_defect'
    return 'unresolved'

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
    # MCO is not its own peripheral: `data/mcus/CH32H417.yaml:5492-5509` models it as one
    # choice-row of RCC's own "Master Clock Output (MCO)" setting, `signal_pins.MCO` lives
    # under `peripherals.RCC`. First pass here wrongly assumed a bare-name DS table implies
    # a same-named top-level peripheral and reported it "missing" - it never was (main,
    # 2026-09-14, correcting AGENT-3's own finding 8).
    30: {'title': 'MCO', 'shape': 'af_list', 'prefix_map': {'MCO': (None, 'RCC')}},
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


def parse_af_list(body: str, spec: dict, anomalies: list[str]) -> tuple[dict[str, dict[str, set]], dict[tuple[str, str], str]]:
    """`({yaml_pid: {short_signal: {(pin, af), ...}}}, {(yaml_pid, short_signal): ds_full_name})`
    for one `af_list`-shaped table. The second dict is what the Table 2-1-1 cross-check
    needs -- `half` (the DS's own full signal name, e.g. `LTDC_CLK`) is already in hand
    here and would otherwise be thrown away the moment it is stripped to `short`."""
    prefix_map = spec.get('prefix_map', {})
    dual_map = spec.get('dual_prefix_map', {})
    current: str | None = None
    out: dict[str, dict[str, set]] = {}
    full_name_of: dict[tuple[str, str], str] = {}
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
            targets.append((pid, short, half))
        for pid, short, half in targets:
            out.setdefault(pid, {}).setdefault(short, set()).update(cells)
            full_name_of[(pid, short)] = half
    return out, full_name_of


def actual_signal_pins(doc: dict, pid: str) -> dict[str, set]:
    per = ((doc.get('peripherals') or {}).get(pid) or {}).get('signal_pins') or {}
    out: dict[str, set] = {}
    for name, entries in per.items():
        out[name] = {(e['pin'], e.get('af')) for e in entries}
    return out


def compare(pid: str, want: dict[str, set], got: dict[str, set],
            full_name_of: dict[tuple[str, str], str],
            table_2_1_1: dict[str, set[tuple[str, int]]],
            verdict_counts: dict[str, int], out: list[str]) -> int:
    """Per signal, per PIN that differs between Table 2-2-x (`want`) and the file (`got`),
    resolve one of the three verdicts against Table 2-1-1 (module docstring) rather than
    printing a raw diff and letting a reader assume the file is wrong. `bad` counts only
    `file_defect` -- a `datasheet_self_contradiction` or `unresolved` line is printed (the
    disagreement is real and worth a human's eyes) but is NOT the file's fault, so it does
    not fail the run."""
    bad = 0
    for s in sorted(set(want) | set(got)):
        want_pins = dict(want.get(s, ()))   # {pin: af}
        got_pins = dict(got.get(s, ()))
        if want_pins == got_pins:
            continue
        full = full_name_of.get((pid, s), f'{pid}_{s}')
        for pin in sorted(set(want_pins) | set(got_pins)):
            w_af, g_af = want_pins.get(pin), got_pins.get(pin)
            if w_af == g_af:
                continue
            verdict = classify(pin, full, g_af, w_af, table_2_1_1)
            verdict_counts[verdict] = verdict_counts.get(verdict, 0) + 1
            shape = ('missing from the file' if g_af is None else
                     'not in Table 2-2-x' if w_af is None else 'value mismatch')
            label = {'file_defect': 'FILE DEFECT', 'datasheet_self_contradiction':
                     'DATASHEET SELF-CONTRADICTION (file is right)', 'unresolved': 'UNRESOLVED'}[verdict]
            out.append(f'   [{label}] {pid}.{s} ({full}) on {pin}: Table-2-2-x says AF{w_af}, '
                       f'file says AF{g_af} ({shape})')
            if verdict == 'file_defect':
                bad += 1
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

    print('Loading Table 2-1-1 (the PIN-first table) via tools/extract_h417_pins.py, for '
          'the three-verdict cross-check every Table-2-2-x disagreement now goes through...')
    table_2_1_1 = table_2_1_1_pin_functions(ds_path)
    print(f'  {len(table_2_1_1)} pin(s) with at least one AF-numbered function.\n')

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
    full_name_of: dict[tuple[str, str], str] = {}
    for n in sorted(by_shape.get('af_list', [])):
        spec = TABLES[n]
        body = table_body(text, n)
        if body is None:
            print(f'Table 2-2-{n} ({spec["title"]}) heading matched but its body could not be '
                  f'sliced out -- treating as a parse failure, not a clean table.')
            bad += 1
            continue
        got_from_ds, names = parse_af_list(body, spec, anomalies)
        full_name_of.update(names)
        for pid, sigs in got_from_ds.items():
            dest = merged.setdefault(pid, {})
            for short, cells in sigs.items():
                dest.setdefault(short, set()).update(cells)

    covered_pids = set(merged)
    verdict_counts: dict[str, int] = {}
    for pid, sigs in merged.items():
        got_from_yaml = actual_signal_pins(doc, pid)
        bad += compare(pid, sigs, got_from_yaml, full_name_of, table_2_1_1, verdict_counts, diffs)

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
        total = sum(verdict_counts.values())
        tally = ', '.join(f'{v}={verdict_counts.get(v, 0)}'
                           for v in ('file_defect', 'datasheet_self_contradiction', 'unresolved'))
        print(f'{total} raw disagreement(s) against Table 2-2-x, resolved against Table 2-1-1 ({tally}):')
        for d in diffs:
            print(d)
        print(f'\nOnly file_defect ({verdict_counts.get("file_defect", 0)}) fails this run - a '
              f'datasheet_self_contradiction means the FILE is right and the datasheet disagrees '
              f'with itself, and an unresolved case is printed for a human, never asserted either way.')
    else:
        print('Every af_list-covered peripheral agrees with its DS Table 2-2-x entry, signal for '
              'signal, pin for pin, AF for AF.')

    if anomalies or bad:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
