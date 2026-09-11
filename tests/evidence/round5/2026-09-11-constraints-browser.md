# Round 5 — the constraint mechanism, measured in a real browser

**Date:** 2026-09-11T22:46Z · **By:** AGENT-3 · **App:** `dist/index.html`, built by
`python build.py` at commit `720396b` (798 KB) · **Browser:** the VS Code integrated
browser (Chromium).

Round 5's rule is *every choice the app offers must be one the silicon can honour*. This
is the measurement of that claim on screen, on the shipped parts and the shipped data. It
is not a screenshot diff; it is what the page's own DOM answered when asked.

## What was measured, and what it said

Part **CH32X035**, package **QFN28** — the default, so nothing here depends on a package
switch having gone right.

| Step | Pin | What the row's controls offered | Verdict |
|---|---|---|---|
| 1 | `PC0` (outside PA0–PA15 / PC16–PC17) | pull `<select>` = `["No pull","Pull-up"]` | **Pull-down absent**, not greyed |
| 2 | `PA3` (inside it) | pull `<select>` = `["No pull","Pull-up","Pull-down"]` | **Pull-down offered** |
| 3 | both rows | mode `<select>` = `["Input","Output Push Pull","Alternate Function Push Pull","Analog"]` | identical, so step 1 reduced one column on one row, not the table |

Step 2 is the half that matters most and is the one a one-sided check misses: a mechanism
that hid the control on every row would satisfy step 1 perfectly and be just as broken. The
allow-list in the data is `gpio.constraints` id `pull-down-only-on-pa0-pa15-pc16-pc17`,
cited to `ch32x035_gpio.h:33` and the DS.

**Shorted pair.** Pin 27 is one pad under two names (`PC17/PC10`), and the picker says so
before anything is clicked: *"PC17 and PC10 are shorted inside this package — one physical
pin, never both outputs."* Selecting `GPIO_Output` on it produces a visible warning and no
silent acceptance:

```
⚠ PC17: mode "Output Push Pull" is not available on this pin - PC10 and PC17 are
short-joined inside the chip, as are PC11 and PC16; neither pin of a shorted pair may be
configured as a GPIO output. A peripheral may still drive it.
[shorted-pc10-pc11-pc16-pc17-not-output]
```

and the row's mode control then offers `["Input","Alternate Function Push Pull","Analog"]`
— the output modes are gone from that row. The engine carries the same finding in
`E.constraintIssues` with the pin, the field, the value, the constraint `id`, the sentence
and the **source** (`CH32X035DS0.md Note 4 (p.19)`), which is what the conflict engine and
a generated `TODO` both cite.

**Console.** Silent. `console.error` and `console.warn` were wrapped before exercising the
paths above — assigning a constrained pin, switching package to LQFP64M and back to QFN28,
and re-opening the shorted pin's picker — and the captured log was `[]`.

## What this pass did NOT establish, and why

**The 1280 / 1920 × 100 % / 125 % × light / dark grid was not reproduced here.** The VS Code
integrated browser panel has a fixed layout viewport — it reported `innerWidth === 550`
whatever `setViewportSize()` asked for — so a capture from it is a 550 px-wide rendering and
cannot say anything about a 1280 or 1920 layout. Setting `body { zoom: 1.25 }` was tried and
is *not* browser zoom: it truncates a viewport-fitted layout and produces a screenshot that
looks broken for a reason that does not exist. Both were discarded rather than committed; a
screenshot that misrepresents the app is worse than no screenshot.

That grid is covered by `tests/legibility.test.js`, which drives a real browser through its
own harness and measures clipping, overflow, truncated `<select>` controls, contrast and
label overlap at 1280 and 1920, 100 % and 125 %, light and dark, over **every registered
part on every one of its packages**. It is green in the 518-test run, and it asserts that it
reached a package with ≥ 60 labels and names ≥ 8 characters long — which is CH32X035's
LQFP64M and `USBPD_CC1` and nothing else.

So: the constraint behaviour above is **measured in a browser**; the layout grid is
**measured by the suite**, and this file does not claim to have produced it.

## The other thing this file is not

Nothing here was flashed. Every result in this repository is a compile or a render. See
`agents/HUMAN_TODO.md` item 8 and the DONE line that reads **"builds, not flashed"**.
