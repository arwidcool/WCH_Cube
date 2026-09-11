# `test/` — PlatformIO unit tests

```
cd data/firmware && pio test -e native
```

Ten Unity tests over `lib/util`'s ring buffer, running on the **development
machine** rather than on a chip. They are also part of the repository suite:
`node tests/run.js` runs them through `tests/firmware_native.test.js`, so nobody
has to remember to type the command.

## Why the ring buffer, and why on the host

`lib/util` is the one component that compiles for the host — its `library.json`
declares no framework and no platform, it takes its storage from the caller, it
allocates nothing and it never includes an SDK header (`ARCHITECTURE.md`,
"Layers"). That constraint costs something to maintain, and it only pays for
itself if something exercises it.

The ring buffer is the one piece of logic here with genuine off-by-one risk and a
concurrency contract, so the tests are the wrap-around and full/empty cases
rather than a smoke test. Several of them exist to pin down that `size` is
**capacity + 1** — one slot is spent distinguishing full from empty, and that is
exactly the kind of thing a later edit "simplifies" away.

Running them on target would be slower, flakier, would need a WCH-Link attached,
and would not be any more truthful: this is ordinary C logic with no hardware in
it.

## What `[env:native]` has to override

Everything `[env]` sets is target-only. `framework = noneos-sdk`, the `ch32v`
`lib_deps` and the SDI build flag all have to be cleared, or a host build asks
for a `board` and fails with `BoardConfig: Board is not defined`. `[env:native]`
overrides each one, `test_build_src = no` keeps `src/main.c` (target firmware)
out of the host binary, and `lib_deps = util` is deliberately the only entry —
`board` and `wch_hal` include SDK headers by design and cannot compile here.

`tests/firmware_native.test.js` asserts those overrides are still present, so the
next person to touch this file gets a sentence rather than PlatformIO's message.

## It needs a host compiler, and there is one

`pio test -e native` needs `gcc`, `clang` or MSVC. There is **no `gcc` on PATH**
on the Windows box this was written on, which made it look for a while as though
host tests could not run here at all. They can: MinGW 9.2.0 is installed at
`C:\MinGW` and PlatformIO uses it happily once it is on PATH. The QA test looks
in the usual install locations before concluding anything, and skips with a
printed reason — which the runner counts — only when it genuinely finds nothing.

## What is still not here

- **`test_hal_*/`** — tests for `lib/wch_hal`, which only run on target
  (`pio test -e CH32V006F8P6`) and need a WCH-Link attached. Nothing in this
  repository has ever been flashed.
