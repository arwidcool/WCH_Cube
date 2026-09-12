#!/usr/bin/env python3
"""Update CH32L103.notes.md: the part ships now, so the notes must stop saying it does not.

The notes were written in two earlier passes - one before the DS PDF arrived (when the
pin tables were blocked) and one after (which parked the file). Both are stale now: the
part is in `data/mcus/`, both gates are clean, and it compiles. Leaving "NOT EXTRACTED"
at the top of the file is the kind of stale claim this repo treats as a defect, and
`tests/source_paths.test.js` had already caught the one hard error in it - a citation to
the parked path that no longer exists.
"""
import io
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
NOTES = ROOT / 'data/mcus/CH32L103.notes.md'

OLD_HEAD = """**Status: NOT EXTRACTED. There is no `data/mcus/CH32L103.yaml`, and this file says
why.** Everything below is established from the sources and cited; the pin tables are
the blocker and are recorded in §4."""

NEW_HEAD = """**Status: EXTRACTED AND COMPILING.** `data/mcus/CH32L103.yaml` ships, all six variants
and five packages, and the generated C compiles and links for CH32L103K8U6 (measured:
`pio run`, 9 016 B of 65 536 B flash). `tools/validate_mcu.py` and
`tools/verify_sdk_names.py` are both clean, and the part is behind the compile gate
through `tests/fixtures/CH32L103_QFN32_full.wchproj`.

**Read §4 and §8 before editing.** §4 records the DS defect the pin tables were
RECOVERED from, and §8 lists what is still open. This file keeps the earlier passes'
reasoning rather than deleting it, because the reasoning is why the data looks the way
it does."""


def main():
    t = io.open(NOTES, encoding='utf-8').read()
    before = t

    if OLD_HEAD in t:
        t = t.replace(OLD_HEAD, NEW_HEAD, 1)
        print('replaced the stale "NOT EXTRACTED" status')
    else:
        print('status block not found verbatim - checking for the parked-path citation')

    # §7 described the file as parked. It is in data/mcus now.
    t = t.replace(
        '`data/sources/l103/pending/CH32L103.yaml` holds a working part file. It is **parked**\n'
        'rather than shipped because it is not complete, and a shipped part goes red on five\n'
        'gates at once — all of them correctly. What it DOES have, all cited and passing\n'
        '`validate_mcu.py` (0 errors, 0 warnings) and `verify_sdk_names.py` (0 errors):',
        'The part file was parked at `data/sources/l103/pending/CH32L103.yaml` while it was\n'
        'incomplete, because an incomplete part turns five gates red at once. **It now ships\n'
        'as `data/mcus/CH32L103.yaml`** and those gates are green. What it has, all cited:\n')

    if t == before:
        print('nothing changed')
        return 1
    io.open(NOTES, 'w', encoding='utf-8', newline='\n').write(t)
    return 0


if __name__ == '__main__':
    sys.exit(main())
