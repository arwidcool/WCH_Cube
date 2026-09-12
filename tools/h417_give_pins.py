#!/usr/bin/env python3
"""Give CH32H417's pin-holding peripherals the pins the datasheet gives them.

Seven peripherals claimed "holds no pin on any package" while the DS pin table gives
them pins - `DAC` (PA4/PA5), `ADC1` (16 channels), `HSADC` (7), `OPA` (18), `SDMMC`
(39), `SERDES` (4) and `UHSIF` (88). Found by `tools/audit_h417_all_pins.py`, which
reads the table independently of this file; the DAC is the one a human noticed first.

Signal names are the DS's own, minus the peripheral prefix where that is unambiguous,
so `ADC_IN4` becomes `IN4` under ADC1 and `DAC1_OUT`/`DAC2_OUT` stay `OUT1`/`OUT2`
because they are two channels with one pin each. Where the DS names a unit explicitly
and the units differ (`OPA1_N0` / `OPA2_N0` / `OPA3_N0` are on different pins) the
full name is kept, because collapsing them would merge three real signals into one.

Alternative routes (`_1`, `_2`, `_3` suffixes) are all kept as separate `{pin, af}`
entries: that is exactly what `signal_pins` means on this part - a signal reachable
from more than one pin - and dropping them would refuse choices the silicon honours.
"""
import io
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import audit_h417_all_pins as A  # noqa: E402

YAML = ROOT / 'data/mcus/CH32H417.yaml'

# Which peripheral a DS function belongs to, and what to call the signal under it.
# `prefix` is stripped from the DS name; `keep_unit` leaves a unit digit in place
# (needed where two units of one peripheral have different pins).
SPEC = {
    'DAC':   {'prefix': 'DAC', 'keep_unit': True},
    'ADC1':  {'prefix': 'ADC', 'keep_unit': False},
    'HSADC': {'prefix': 'HSADC', 'keep_unit': False},
    'OPA':   {'prefix': 'OPA', 'keep_unit': True},
    'SDMMC': {'prefix': 'SDMMC', 'keep_unit': False},
    'SERDES': {'prefix': 'SERDES', 'keep_unit': False},
    'UHSIF': {'prefix': 'UHSIF', 'keep_unit': False},
}

# The settings each peripheral needs so its signals are reachable from the UI, and
# which signal each choice claims. Written per peripheral rather than derived, because
# "which choices does this peripheral have" is a hardware question, not a naming one.
CHOICES = {
    'DAC': [('Channel 1', 'Output on pin', ['OUT1']),
            ('Channel 2', 'Output on pin', ['OUT2'])],
    'ADC1': [('Mode', 'Independent', []), ('Channels', 'Channel 0 (IN0)', ['IN0'])],
    'HSADC': [('Mode', 'Enabled', [])],
    'OPA': [('OPA1', 'Enabled', []), ('OPA2', 'Enabled', []), ('OPA3', 'Enabled', [])],
    'SDMMC': [('Mode', 'SD 4-bit', ['D0', 'D1', 'D2', 'D3', 'CMD', 'SDCK'])],
    'SERDES': [('Mode', 'Enabled', ['TXP', 'TXN', 'RXP', 'RXN'])],
    'UHSIF': [('Mode', 'Enabled', [])],
}


def strip_prefix(func, prefix, keep_unit):
    """`ADC_IN4` -> `IN4`;  `DAC1_OUT` -> `OUT1` when keep_unit; `SDMMC_D4_1` -> `D4_1`."""
    rest = func[len(prefix):]
    if keep_unit:
        m = re.match(r'^(\d+)_?(.*)$', rest)
        if m:
            return m.group(2) + m.group(1)
        return rest.lstrip('_')
    return rest.lstrip('_').strip()


def main():
    pins = A.parse_pins()
    doc_pins = set()
    import yaml
    doc = yaml.safe_load(YAML.read_text(encoding='utf-8'))
    doc_pins = set(doc['pins'])

    # signal -> [(pin, af)] per peripheral
    table = {pid: {} for pid in SPEC}
    for pin, d in pins.items():
        if pin not in doc_pins:
            continue
        for sig, af in d['af'].items():
            for pid, spec in SPEC.items():
                if not sig.startswith(spec['prefix']):
                    continue
                if sig == spec['prefix'] or sig.startswith(spec['prefix'] + '_') \
                        or re.match('^' + spec['prefix'] + r'\d', sig):
                    name = strip_prefix(sig, spec['prefix'], spec['keep_unit'])
                    table[pid].setdefault(name, [])
                    if (pin, af) not in table[pid][name]:
                        table[pid][name].append((pin, af))
                    break
        for fn in d['analog']:
            for pid, spec in SPEC.items():
                if not fn.startswith(spec['prefix']):
                    continue
                if fn == spec['prefix'] or fn.startswith(spec['prefix'] + '_') \
                        or re.match('^' + spec['prefix'] + r'\d', fn):
                    name = strip_prefix(fn, spec['prefix'], spec['keep_unit'])
                    table[pid].setdefault(name, [])
                    if (pin, None) not in table[pid][name]:
                        table[pid][name].append((pin, None))
                    break

    for pid in SPEC:
        sigs = table[pid]
        print('%-8s %3d signals, %3d pin assignments'
              % (pid, len(sigs), sum(len(v) for v in sigs.values())))

    out = {}
    for pid, sigs in table.items():
        if not sigs:
            continue
        L = ['settings:']
        for sname, cname, signals in CHOICES[pid]:
            L.append('      - name: %s' % sname)
            L.append('        choices:')
            L.append('          - { name: Disable }')
            sig_txt = 'signals: [%s]' % ', '.join(signals) if signals else ''
            L.append('          - { name: %s%s }' % (cname, ', ' + sig_txt if sig_txt else ''))
        L.append('    signal_pins:')
        for name in sorted(sigs, key=lambda s: (len(s), s)):
            rows = ', '.join('{ pin: %s%s }' % (p, '' if af is None else ', af: %d' % af)
                             for p, af in sorted(sigs[name]))
            L.append('      %s: [%s]' % (name, rows))
        out[pid] = '\n'.join(L) + '\n'
    (ROOT / 'data/sources/H417/pending_signal_pins.json').write_text(
        json.dumps({k: {s: v for s, v in sigs.items()} for k, sigs in table.items()},
                   indent=1, default=str), encoding='utf-8')
    print('\nemitted %d peripherals; full tables in data/sources/H417/pending_signal_pins.json'
          % len(out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
