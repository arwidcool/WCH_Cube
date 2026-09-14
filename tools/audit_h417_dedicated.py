#!/usr/bin/env python3
"""Audit CH32H417's dedicated-function signals against the DS's peripheral-first tables.

WHY. `tools/gen_h417_dedicated_pins.py` reads DS Table 2-1-1, the PIN-first table. WCH
writes a remap column into the signal NAME there, so the same signal appears as
`UHSIF_PORT3`, `UHSIF_PORT3_1`, `UHSIF_PORT3_2`, `UHSIF_PORT3_3` on four different pads.
Read literally that is four signals where the DS means one - and the PIN-first table is
the only place that notation appears, so nothing else in the toolchain could notice.

Table 2-2-16 is the SAME datasheet read PERIPHERAL-first: one row per signal, one column
per remap, and no suffix in the name. It is structurally independent, so agreeing with it
is real evidence rather than a restatement.

    UHSIF function   UHSIF_PORT_RM=00   UHSIF_PORT_RM=01   UHSIF_PORT_RM=1x
    UHSIF_PORT3      PE8                PC1                PB0

So the correct model is ONE signal `PORT3` that can reach {PE8, PC1, PB0} - which is also
how every other H417 peripheral is already written (`signal_pins` lists every pin a signal
can reach; the file uses no `remaps:` at all).

The table also catches a second defect: the PDF text extractor wraps a long name, so
`UHSIF_PORT32_2` arrives as `UHSIF_PORT32_` then `2` on the next line. The digit is lost
and the name keeps a trailing underscore - a name that exists nowhere in the datasheet.

Exit codes: 0 clean, 1 differences found, 2 the tables could not be read (compare nothing).
"""
from __future__ import annotations

import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
DS = ROOT / 'data/sources/H417/Datasheets/CH32H417DS0.md'
MCU = ROOT / 'data/mcus/CH32H417.yaml'

# Which DS table holds which peripheral, and the prefix its signal names carry.
TABLES = {
    'SDMMC': (12, 'SDMMC'),
    'UHSIF': (16, 'UHSIF'),
}

PIN = re.compile(r'^P[A-F]\d{1,2}$')
# A row: optional `## ` line prefix, the signal name (possibly `A/B`), then pin cells.
ROW = re.compile(r'^#*\s*([A-Z][A-Z0-9_]*(?:/[A-Z][A-Z0-9_]*)*)((?:\s+P[A-F]\d{1,2})*)\s*$')


def cells_of(rest: str) -> list[str]:
    """The pin cells in a row's tail. Pins are whole tokens, so split rather than search."""
    return [tok for tok in rest.split() if PIN.match(tok)]
# After the prefix is stripped: a name with a remap column glued on, and the wrap case.
SUFFIX = re.compile(r'^(.*)_(\d+)$')
WRAPPED = re.compile(r'^(.*_)$')


def ds_text() -> str:
    return DS.read_text(encoding='utf-8', errors='replace')


def table_body(text: str, n: int) -> str | None:
    """The text of Table 2-2-<n>, up to the next 2-2 table."""
    m = re.search(r'Table\s*2-2-%d\s' % n, text)
    if not m:
        return None
    rest = text[m.end():]
    nxt = re.search(r'Table\s*2-2-\d+\s', rest)
    return rest[:nxt.start()] if nxt else rest[:8000]


def expected(text: str) -> dict[str, dict[str, set[str]]]:
    """{peripheral: {signal: {pin, ...}}} straight from the peripheral-first tables."""
    out: dict[str, dict[str, set[str]]] = {}
    for pid, (n, prefix) in TABLES.items():
        body = table_body(text, n)
        if body is None:
            continue
        sigs: dict[str, set[str]] = {}
        for raw in body.splitlines():
            line = raw.strip()
            if not line.startswith('#'):
                continue
            # A wrapped name: previous row ended with `_`, this line is just the digit.
            body_line = line.lstrip('#').strip()
            m = ROW.match('## ' + body_line)
            if not m:
                continue
            name, cells = m.group(1), cells_of(m.group(2))
            if not cells:
                # `UHSIF_PORT32_` then `2/` - glue the lost remap digit back on.
                w = WRAPPED.match(body_line.split()[0]) if body_line else None
                if w:
                    sigs.setdefault('__wrap__' + w.group(1), set())
                continue
            for one in name.split('/'):
                if not one.startswith(prefix):
                    continue
                short = one[len(prefix):].lstrip('_')
                if not short:
                    continue
                sigs.setdefault(short, set()).update(cells)
        if sigs:
            out[pid] = sigs
    return out


def collapse(name: str) -> str:
    """`PORT3_1` -> `PORT3`; a trailing underscore from a lost digit is dropped too."""
    n = name.rstrip('_')
    m = SUFFIX.match(n)
    return m.group(1) if m else n


def actual(doc: dict, pid: str) -> dict[str, set[str]]:
    """{signal: {pin, ...}}, from whichever shape this peripheral actually uses.

    SDMMC moved off `signal_pins:` onto `remaps:` (AGENT-2's ruling, 2026-09-13T23:23Z,
    landed by AGENT-1 `a15eaf5`) precisely because ONE register field moves every SDMMC
    signal to one of three pin sets AT ONCE — `signal_pins:`'s independent per-signal
    choice would let the picker offer `CMD` from one remap value beside `D0` from another,
    a combination the silicon cannot produce. That does not change what THIS AUDIT is
    checking: whether the file's signals reach the DS's pins, signal for signal — a
    `remaps:` peripheral's real reach is the UNION of every named remap's `pins:` map (the
    three RM values are three alternative wirings of the same signal, not three different
    signals), so reading only `signal_pins:` here would have found "0 signals" against a
    peripheral that genuinely has 13 — exactly what happened the moment SDMMC's restore
    landed and this file had not been told about the new shape yet.
    """
    per = (doc['peripherals'].get(pid) or {}).get('signal_pins') or {}
    out: dict[str, set[str]] = {}
    for name, entries in per.items():
        out.setdefault(collapse(name), set()).update(e['pin'] for e in entries)
    for remap in (doc['peripherals'].get(pid) or {}).get('remaps') or []:
        for name, pin in (remap.get('pins') or {}).items():
            out.setdefault(collapse(name), set()).add(pin)
    return out


def main() -> int:
    text = ds_text()
    exp = expected(text)
    if not exp:
        print('COULD NOT READ the 2-2 tables - comparing nothing', file=sys.stderr)
        return 2

    doc = yaml.safe_load(MCU.read_text(encoding='utf-8'))
    bad = 0
    for pid, sigs in exp.items():
        got = actual(doc, pid)
        want = {s: set(p) for s, p in sigs.items() if not s.startswith('__wrap__')}
        missing = sorted(set(want) - set(got))
        extra = sorted(set(got) - set(want))
        print(f'== {pid}: DS names {len(want)} signals; file names {len(got)}')
        if missing:
            bad += 1
            print(f'   MISSING from the file ({len(missing)}): {missing[:12]}')
        if extra:
            bad += 1
            print(f'   NOT IN THE DS ({len(extra)}): {extra[:12]}')
        for s in sorted(set(want) & set(got)):
            if want[s] != got[s]:
                bad += 1
                print(f'   {s}: DS {sorted(want[s])}  file {sorted(got[s])}')
        # Any name the file still carries with a torn suffix is a defect either way.
        torn = sorted(n for n in ((doc['peripherals'].get(pid) or {}).get('signal_pins') or {})
                      if SUFFIX.match(n) or n.endswith('_'))
        if torn:
            bad += 1
            print(f'   TORN NAMES still in the file ({len(torn)}): {torn[:12]}')

    print()
    if bad:
        print(f'{bad} difference group(s) against DS Tables 2-2-12/2-2-16')
        return 1
    print('SDMMC and UHSIF agree with DS Tables 2-2-12/2-2-16, signal for signal')
    return 0


if __name__ == '__main__':
    sys.exit(main())
