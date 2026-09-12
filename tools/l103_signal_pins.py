#!/usr/bin/env python3
"""Find which pin each peripheral signal sits on, from the DS pin table.

For a peripheral with NO remap (SPI2 and I2C2 here: `AFIO_PCFR1` has no SPI2_RM and
no I2C2_RM, and `ch32l103_gpio.h` defines no SPI2/I2C2 remap macro), the pin is not
in a remap table - it is the pin whose row lists that signal. This reads it from the
row token stream, the same way the package columns and the ADC channels are read, and
prints the `pins: {...}` map to paste into that peripheral's single remap entry.

Usage:
    python tools/l103_signal_pins.py SPI2 I2C2
    python tools/l103_signal_pins.py --all      # every signal in the DS table
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import extract_l103_pins as E  # noqa: E402  sibling module: the same row parser

# Signals carry a remap-index suffix when they are remappable (`USART3_TX_2`);
# the bare name is the default mapping, which is what a no-remap peripheral has.
SIG = re.compile(r'^([A-Z][A-Z0-9]*)_([A-Z0-9]+?)(?:_(\d+))?$')


def base_pin(name):
    """`PA0-WKUP` -> `PA0`; the descriptive suffix is not part of the pin's name."""
    return re.split(r'[-/]', name)[0]


def main():
    want = [a for a in sys.argv[1:] if not a.startswith('--')]
    every = '--all' in sys.argv
    rows = E.parse_rows(E.load_lines())

    found = {}
    for r in rows:
        toks = [t for t in r['tokens'] if t]
        pin = base_pin(E.split_name(toks))
        if not re.match(r'^P[A-D]\d+$', pin):
            continue
        for t in toks:
            m = SIG.match(t)
            if not m:
                continue
            periph, sig, idx = m.group(1), m.group(2), m.group(3)
            # only the DEFAULT mapping: a suffixed signal is an alternative route
            if idx is not None:
                continue
            found.setdefault(periph, {}).setdefault(sig, pin)

    if not found:
        print('no signals found - has the DS pin table changed shape?')
        return 1

    if every:
        for periph in sorted(found):
            print('%-10s %s' % (periph, ', '.join('%s=%s' % (k, v) for k, v in sorted(found[periph].items()))))
        return 0

    if not want:
        print('name a peripheral, or use --all. Known: ' + ', '.join(sorted(found)))
        return 1
    for periph in want:
        if periph not in found:
            print('%-10s NOT FOUND in the DS pin table' % periph)
            continue
        print('%-10s %s' % (periph, ', '.join('%s=%s' % (k, v) for k, v in sorted(found[periph].items()))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
