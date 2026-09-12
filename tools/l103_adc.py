#!/usr/bin/env python3
"""Extract the CH32L103 ADC channel -> pin map from the DS pin table.

The datasheet writes each ADC channel as `ADC_IN<n>` in a pin row's main-function
column, so the channel belongs to the pin that row names. This reads it the same way
`tools/extract_l103_pins.py` reads the package columns - on the row token stream -
because the rows are split across lines by the PDF conversion and a line-at-a-time
read loses the association.

Output is the `remaps:` entry for ADC1, which is what makes `codegen.analog_signals`
verifiable: an analog signal that the peripheral does not route to a pin is an error
in `validate_mcu.py`, and rightly so - it would emit an analog mode for a pin the
peripheral cannot reach.
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import extract_l103_pins as E  # noqa: E402  sibling module: the same row parser

ADC_RE = re.compile(r'^ADC_IN(\d+)$')


def main():
    rows = E.parse_rows(E.load_lines())
    chan = {}
    for r in rows:
        toks = [t for t in r['tokens'] if t]
        name = E.split_name(toks)
        if not name:
            continue
        for t in toks:
            m = ADC_RE.match(t)
            if m:
                chan.setdefault(int(m.group(1)), name)
    if not chan:
        print('no ADC_IN<n> found - has the DS pin table changed shape?')
        return 1
    print('ADC channels found: %d' % len(chan))
    for k in sorted(chan):
        print('  IN%-3d %s' % (k, chan[k]))
    # the remaps entry, in channel order, for pasting into ADC1
    print()
    print('    remaps:')
    print('      - name: Analog channels')
    print('        pins: { %s }' % ', '.join('IN%d: %s' % (k, chan[k]) for k in sorted(chan)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
