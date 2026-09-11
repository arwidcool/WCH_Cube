# `test/` — PlatformIO unit tests

Empty on purpose. There are no tests here yet, and an empty folder is a more
honest statement of that than a passing test that asserts nothing.

What belongs here, when someone writes it:

- **`test_util_*/`** — tests for `lib/util`, which has no hardware dependency and
  therefore runs on the host. Add a `[env:native]` environment
  (`platform = native`) and `pio test -e native` runs them without a chip.
- **`test_hal_*/`** — tests for `lib/wch_hal`, which only run on target
  (`pio test -e CH32V006F8P6`) and need a WCH-Link attached.

`lib/util` was shaped for the first of those: it declares no framework and no
platform in its `library.json`, takes its storage from the caller, and never
includes an SDK header.

The repository's existing suite (`node tests/run.js` from the repo root) covers
the configurator, not the firmware — the two do not share a runner.
