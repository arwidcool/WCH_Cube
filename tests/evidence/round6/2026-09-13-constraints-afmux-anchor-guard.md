# The unanchored-anchor defect, fixed in its last two siblings — round 6

AGENT-1 found and fixed this shape in `validate_clock_selftest.py` (BOARD 2026-09-13T01:14Z):
a find/replace anchor with no line boundary matches INSIDE a longer line elsewhere in the
file, `.replace(find, replace, 1)` mutates that unrelated occurrence, the real target survives
untouched, and the case still reports OK by exiting non-zero for a reason that has nothing to
do with the break it claims to plant — a planted-break test that plants nothing reads exactly
like one that works. `validate_constraints_selftest.py` and `validate_afmux_selftest.py` had
the same `if find not in base:` shape (existence, not uniqueness) and no guard against it.
This assignment: fix both, and plant a non-unique anchor in each to watch the new guard fire
before trusting it.

Both now use the same guard as the sibling: `hits = base.count(find); if hits != 1: FAIL`,
plus `mutated == base` still checked separately (an anchor that IS unique but whose `replace`
text is identical to `find` would otherwise report success while planting nothing).

## `validate_constraints_selftest.py` — the guard found a REAL bug, not a synthetic one

Adding the guard and re-running immediately failed two of the file's own 19 cases:

```
FAIL  a `when` naming hardware this part does not have
        anchor matches 2 places, so the break is not the one described: 'when: { peripheral: USBFS, enabled: true }'
FAIL  a `when` with a non-boolean `enabled`
        anchor matches 2 places, so the break is not the one described: 'when: { peripheral: USBFS, enabled: true }'

17/19 planted breaks caught
```

`data/mcus/CH32X035.yaml` gives PC10/PC11's `gpio.mode` constraint AND its `gpio.pull`
constraint the identical trailing line `when: { peripheral: USBFS, enabled: true }`
(lines 2612 and 2620). Both cases anchored on that one line alone, so
`.replace(find, replace, 1)` always mutated the FIRST (gpio.mode) occurrence — meaning
whichever of the two cases was meant to target the gpio.pull entry had, since the case was
written, actually been mutating gpio.mode's `when:` instead and still reporting OK, because
`validate_mcu.py` refused the file for the same class of reason either way. The count (19 of
19 "caught") was never wrong; which line each case actually broke was.

Fixed by anchoring each case on its own three-line block (the distinguishing `classes:`/
`choices:` line plus `not_on:` plus the shared `when:` line), each verified unique before the
fix was trusted:

```
>>> base.count("    classes: [out, af, analog]\n    not_on: [PC10, PC11]\n    when: { peripheral: USBFS, enabled: true }")
1
>>> base.count("    choices: [Pull-up, Pull-down]\n    not_on: [PC10, PC11]\n    when: { peripheral: USBFS, enabled: true }")
1
```

Re-run after the fix, `python tools/validate_constraints_selftest.py`:

```
  OK    CH32X035.yaml validates clean before any break is planted
  OK   a choice name the part does not offer
  OK   a pin that is not in `pins:`
  OK   a package the part does not have
  OK   a pin scoped to a package it is not bonded on
  OK   `only_on` and `not_on` on one entry
  OK   `choices` and `classes` on one entry
  OK   a `when` naming hardware this part does not have
  OK   a `when` with a non-boolean `enabled`
  OK   a class outside the closed set
  OK   `classes` on an option that has no classes
  OK   a mode left unclassified while `classes` is used
  OK   an unknown key in the constraint
  OK   a duplicate id
  OK   no `reason`
  OK   no `source`
  OK   an unknown `option`
  OK   the same choice allow-listed and deny-listed at once
  OK   an entry that is not a mapping
  OK   a `constraints:` block that is not a list

19/19 planted breaks caught
```

## `validate_afmux_selftest.py` — no hidden bug, but the guard is proven, not assumed

All eleven of this file's own anchors turned out to already be unique in `CH32H417.yaml` — the
fix here changed nothing about which line any case mutates. Trusting a guard that has never
fired is the same mistake this whole exercise exists to avoid, so a non-unique anchor was
planted on purpose (the first case's `find` widened from a full pin row to the bare substring
`"af: 4"`, which `data/mcus/CH32H417.yaml` contains 56 times), the guard was watched refuse it,
and the case was reverted to its real text in the same sitting:

```
  OK   CH32H417.yaml validates before any break is planted
FAIL  TEMP-DEMONSTRATION-DO-NOT-COMMIT a pin that is not in `pins:`
        anchor matches 56 places, so the break is not the one described: 'af: 4'
```

Reverted, re-run, `python tools/validate_afmux_selftest.py`:

```
  OK   CH32H417.yaml validates before any break is planted
  OK   a pin that is not in `pins:`
  OK   an AF code outside the four bits the register has
  OK   an AF code that is not a number at all
  OK   the same pin listed twice for one signal, where the second is unreachable
  OK   an unquoted comma, which truncates the value before it
  OK   a signal a setting can request that `signal_pins:` does not route
  OK   a peripheral carrying BOTH mux shapes, where the remaps would be dead
  OK   `style: af` with no function to apply it
  OK   `style: af` alongside a per-peripheral AFIO field it cannot have
  OK   a style that does not exist
  OK   `signal_pins:` under a style whose emitter never runs

11/11 planted breaks caught
```

`git diff tools/validate_afmux_selftest.py` after the revert carries only the guard itself —
the CASES list is byte-identical to before the demonstration.
