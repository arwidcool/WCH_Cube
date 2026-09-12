#!/usr/bin/env python3
"""Write the dedicated-function pins of CH32H417 as cited data for the generator.

`tools/extract_h417_pins.py` emits 406 signals and, for a systematic reason, not these:

  * **No-AF functions.** `DAC1_OUT`, `ADC_IN<n>`, `HSADC_IN<n>`, `OPA*_P/N/OUT`,
    `SERDES_TXP/TXN/RXP/RXN` are a pad's OWN function, not an alternate one, so the DS
    writes them with no `(AFn)` code and an AF parser has nothing to capture. Their
    absence is why `DAC` said "holds no pin on any package" while offering
    "Output on pin" - a choice with no pin behind it.
  * **Whole groups.** `UHSIF_PORT<n>`, `UHSIF_CLK` and `SDMMC_*` are absent from the
    JSON entirely, so those two peripherals are empty too.

Found by `tools/audit_h417_all_pins.py`, which reads the table independently and now
agrees with it on all 95 pins. This file writes what that audit found, sourced from the
DS, so the generator can consume it without re-parsing.

Output: data/sources/H417/dedicated_pins.yaml
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import audit_h417_all_pins as A  # noqa: E402

OUT = ROOT / 'data/sources/H417/dedicated_pins.yaml'

# Peripheral -> the DS prefix its signals carry, and how to shorten the signal name.
# `keep_unit` keeps the unit digit where two units of one peripheral sit on different
# pins (OPA1_N0 and OPA2_N0 are different pads; DAC1_OUT and DAC2_OUT likewise).
SPEC = {
    'DAC':    ('DAC', True),
    'ADC1':   ('ADC', False),
    'ADC2':   ('ADC', False),
    'HSADC':  ('HSADC', False),
    'OPA':    ('OPA', True),
    'SDMMC':  ('SDMMC', False),
    'SERDES': ('SERDES', False),
    'UHSIF':  ('UHSIF', False),
}
import re

# SDMMC and UHSIF are read from the DS's PERIPHERAL-first tables instead of Table 2-1-1.
#
# WHY. DS Note 3, under Table 2-1-1, says: "The value after the remap function underline
# indicates the configuration value of the corresponding bit in the AFIO_PCFR1 register.
# For example, UHSIF_CLK_1 indicates that the corresponding bit of the register is
# configured as 01b." So `UHSIF_CLK_1` and `UHSIF_CLK` are ONE signal, and reading the
# suffix as part of the name invents a second one on a different pad. That is what this
# file did for SDMMC and UHSIF: 74 signals where the datasheet has 62, four of SDMMC's
# eight data lines split in two, and `CMD_2`/`CMD_3` naming the SAME pad (PC10) twice, so
# the engine would report no conflict between two things that are the same thing.
#
# Table 2-2-x is the same datasheet read signal-first - one row per signal, one column per
# remap, no suffix in the name - so it says the same thing without needing the convention
# decoded:
#
#     UHSIF function   UHSIF_PORT_RM=00   UHSIF_PORT_RM=01   UHSIF_PORT_RM=1x
#     UHSIF_PORT3      PE8                PC1                PB0
#
# A second defect lived in the same place: the PDF text extractor wraps a long name, so
# `UHSIF_PORT32_2` arrives as `UHSIF_PORT32_` with the `2` on the following line. The digit
# was lost and 48 names kept a trailing underscore that appears nowhere in the datasheet.
# Reading 2-2-16 avoids the wrap entirely.
#
# Nothing is lost by switching: SDMMC and UHSIF functions carry no AF code in either table
# (they are the pad's own function), which is why they are in this file at all.
PERIPHERAL_FIRST = {'SDMMC': (12, 'SDMMC'), 'UHSIF': (16, 'UHSIF')}

DS_MD = ROOT / 'data/sources/H417/Datasheets/CH32H417DS0.md'
_ROW = re.compile(r'^#*\s*([A-Z][A-Z0-9_]*(?:/[A-Z][A-Z0-9_]*)*)((?:\s+P[A-F]\d{1,2})*)\s*$')
_PIN = re.compile(r'^P[A-F]\d{1,2}$')


def peripheral_first(table_no, prefix):
    """{signal: [(pin, None), ...]} from DS Table 2-2-<table_no>, signal-first.

    Every column of every remap row contributes, in the table's own column order, which is
    remap 00 first. Order is kept so the file reads like the datasheet.
    """
    text = DS_MD.read_text(encoding='utf-8', errors='replace')
    m = re.search(r'Table\s*2-2-%d\s' % table_no, text)
    if not m:
        raise SystemExit('DS Table 2-2-%d not found in %s' % (table_no, DS_MD.name))
    rest = text[m.end():]
    nxt = re.search(r'Table\s*2-2-\d+\s', rest)
    body = rest[:nxt.start()] if nxt else rest[:8000]

    out = {}
    for raw in body.splitlines():
        line = raw.strip()
        if not line.startswith('#'):
            continue
        mm = _ROW.match('## ' + line.lstrip('#').strip())
        if not mm:
            continue
        cells = [c for c in mm.group(2).split() if _PIN.match(c)]
        if not cells:
            continue
        for one in mm.group(1).split('/'):
            if not one.startswith(prefix):
                continue
            name = one[len(prefix):].lstrip('_')
            if not name:
                continue
            rows = out.setdefault(name, [])
            for pin in cells:
                if (pin, None) not in rows:
                    rows.append((pin, None))
    if not out:
        raise SystemExit('DS Table 2-2-%d yielded no %s signals' % (table_no, prefix))
    return out


def short(func, prefix, keep_unit):
    rest = func[len(prefix):]
    if keep_unit:
        m = re.match(r'^(\d+)_?(.*)$', rest)
        if m:
            return m.group(2) + m.group(1)
        return rest.lstrip('_')
    return rest.lstrip('_').strip()


def main():
    import yaml
    doc = yaml.safe_load((ROOT / 'data/mcus/CH32H417.yaml').read_text(encoding='utf-8'))
    known = set(doc['pins'])
    pins = A.parse_pins()

    table = {pid: {} for pid in SPEC}
    for pin, d in pins.items():
        if pin not in known:
            continue
        for name, entries in (('af', d['af']), ('analog', d['analog'])):
            for sig in entries:
                for pid, (prefix, keep) in SPEC.items():
                    if not sig.startswith(prefix):
                        continue
                    if not (sig == prefix or sig.startswith(prefix + '_')
                            or re.match('^' + prefix + r'\d', sig)):
                        continue
                    key = short(sig, prefix, keep)
                    table[pid].setdefault(key, [])
                    rec = (pin, entries[sig] if name == 'af' else None)
                    if rec not in table[pid][key]:
                        table[pid][key].append(rec)
                    break

    # SDMMC and UHSIF come from the DS's signal-first tables instead - see PERIPHERAL_FIRST.
    for pid, (no, prefix) in PERIPHERAL_FIRST.items():
        got = peripheral_first(no, prefix)
        dropped = sorted(table[pid])
        table[pid] = {k: v for k, v in got.items()}
        print('%-8s from DS Table 2-2-%d: %d signals (pin-first read gave %d)'
              % (pid, no, len(got), len(dropped)))

    L = ['# CH32H417 dedicated-function pins, for tools/gen_h417_peripherals.py',
         '#',
         '# WHY THIS FILE EXISTS. The AF parser behind the generator reads `SIGNAL(AFn)`',
         '# entries. A pad whose UHSIF/DAC/ADC/OPA/SERDES function is its OWN function rather',
         '# than an alternate one carries NO AF code in DS Table 2-1-1, so the parser cannot',
         '# see it - and UHSIF_CLK/PORT<n> and SDMMC_* are missing from its output entirely.',
         '# Result: DAC, ADC1, ADC2, HSADC, OPA, SDMMC, SERDES and UHSIF all read as',
         '# "holds no pin on any package" while the datasheet gives them pins.',
         '#',
         '# SOURCE: data/sources/H417/Datasheets/CH32H417DS0.md.',
         '#   DAC, ADC1, ADC2, HSADC, OPA, SERDES - Table 2-1-1 (pin-first), read by',
         '#     tools/gen_h417_dedicated_pins.py via tools/audit_h417_all_pins.py, whose parse',
         '#     agrees with the datasheet on all 95 pins (the QFN128 I/O count).',
         '#   SDMMC, UHSIF - Table 2-2-12 and Table 2-2-16 (signal-first). Table 2-1-1 writes',
         '#     the AFIO_PCFR1 remap value into the name (`UHSIF_CLK_1`, DS Note 3), which read',
         '#     literally turns one signal into up to four, and its wrapped lines lose the digit',
         '#     and leave a trailing underscore that appears nowhere in the datasheet.',
         '# A `None` AF means the DS gives no AF code: the pad function is dedicated.',
         '',
         'dedicated_pins:']
    total = 0
    for pid in SPEC:
        sigs = table[pid]
        if not sigs:
            continue
        L.append('  %s:' % pid)
        for key in sorted(sigs, key=lambda s: (len(s), s)):
            rows = ', '.join('{ pin: %s%s }' % (p, '' if af is None else ', af: %d' % af)
                             for p, af in sorted(sigs[key]))
            L.append('    %s: [%s]' % (key, rows))
            total += 1
        print('%-8s %3d signals, %3d pin assignments'
              % (pid, len(sigs), sum(len(v) for v in sigs.values())))
    OUT.write_text('\n'.join(L) + '\n', encoding='utf-8', newline='\n')
    print('\nwrote %s (%d signals)' % (OUT.relative_to(ROOT), total))
    return 0


if __name__ == '__main__':
    sys.exit(main())
