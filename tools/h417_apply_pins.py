#!/usr/bin/env python3
"""Splice the generated settings + signal_pins into CH32H417.yaml.

Replaces, for each of the seven peripherals, the whole block with one that carries the
settings and the `signal_pins` the datasheet gives it, and drops the false
"holds no pin on any package" note. The peripheral's `category` is preserved.

Reads `data/sources/H417/pending_signal_pins.json`, which
`tools/h417_give_pins.py` wrote from the DS pin table.
"""
import io
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
YAML = ROOT / 'data/mcus/CH32H417.yaml'
DATA = ROOT / 'data/sources/H417/pending_signal_pins.json'

# The settings each peripheral needs, written here because "which choices does this
# block have" is a hardware question. `signals` are the names the generator produced.
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

NOTE = {
    'DAC': 'DAC1_OUT is on PA4 and DAC2_OUT on PA5 - the DS pin table gives them as the '
           'pins\' own analog functions, not as alternate functions. Both were missing: this '
           'block used to say it held no pin while offering "Output on pin".',
    'ADC1': 'Sixteen channels, IN0-IN15, on the pins the DS lists as ADC_IN<n>. ADC2 has no '
            'channels of its own - it samples the same pins in dual mode - so its channels are '
            'declared as shared rather than duplicated.',
    'HSADC': 'Seven channels, IN0-IN6. Note IN4-IN6 are on port F, which no other peripheral '
             'in this file puts an analog signal on.',
    'OPA': 'Eighteen pins: three op-amps, each with P0/P1, N0/N1 and OUT0/OUT1 on its OWN pins, '
           'so the signal names keep their unit number - OPA1_N0 and OPA2_N0 are different pins.',
    'SDMMC': 'Forty-seven signal entries. Several signals have alternative routes (D0 is on PC8, '
             'PB13 or PD0) and every one is offered, because a signal this part can reach from '
             'three pins is three legal choices, not one.',
    'SERDES': 'TXP/TXN/RXP/RXN on PE3-PE6.',
    'UHSIF': 'Eighty-nine signal entries - this is the part\'s largest pin consumer. The DS names '
             'the port lanes UHSIF_PORT<n>, and each lane has its own pin.',
}


def build_block(pid, category, sigs):
    L = ['  %s:' % pid]
    if category:
        L.append('    category: %s' % category)
    L.append('    settings:')
    for sname, cname, signals in CHOICES[pid]:
        L.append('      - name: %s' % sname)
        L.append('        choices:')
        L.append('          - { name: Disable }')
        tail = ', signals: [%s]' % ', '.join(signals) if signals else ''
        L.append('          - { name: %s%s }' % (cname, tail))
    L.append('    signal_pins:')
    for name in sorted(sigs, key=lambda s: (len(s), s)):
        rows = ', '.join('{ pin: %s%s }' % (p, '' if af in (None, 'None') else ', af: %d' % int(af))
                         for p, af in sorted(sigs[name]))
        L.append('      %s: [%s]' % (name, rows))
    L.append('    notes: >')
    for line in re.findall(r'.{1,92}(?:\s|$)', NOTE[pid]) or [NOTE[pid]]:
        L.append('      ' + line.strip())
    return '\n'.join(L) + '\n'


def main():
    data = json.loads(DATA.read_text(encoding='utf-8'))
    # Read with universal newlines (the default): this file is CRLF, and reading it
    # with newline='\n' keeps the \r, so every `^  PID:\n` anchor silently fails and
    # the script reports "peripheral not found" for a peripheral that is right there.
    text = io.open(YAML, encoding='utf-8').read().replace('\r\n', '\n')
    n = 0
    for pid in CHOICES:
        if pid not in data:
            print('  ! %s: nothing generated, leaving as-is' % pid)
            continue
        m = re.search(r'^  ' + re.escape(pid) + r':\n', text, re.M)
        if not m:
            sys.exit('peripheral %s not found' % pid)
        start = m.start()
        # the block ends at the next 2-space key or a top-level key
        nxt = re.search(r'\n(?:  [A-Za-z]|[a-z_]+:)', text[m.end():])
        end = m.end() + nxt.start() + 1 if nxt else len(text)
        old = text[start:end]
        cat = re.search(r'^    category: (.+)$', old, re.M)
        block = build_block(pid, cat.group(1) if cat else None, data[pid])
        if block.strip() == old.strip():
            continue
        text = text[:start] + block + text[end:]
        n += 1
    io.open(YAML, 'w', encoding='utf-8', newline='\n').write(text)
    print('replaced %d peripheral blocks' % n)
    return 0


if __name__ == '__main__':
    sys.exit(main())
