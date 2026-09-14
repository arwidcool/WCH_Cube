#!/usr/bin/env python3
"""Plant a break in every category verify_sdk_names.py claims to catch, and check it does.

    python tools/verify_sdk_names_selftest.py           # all of them
    python tools/verify_sdk_names_selftest.py -v        # print each verdict

Exit 0 = every planted break was caught and the unmodified file is still clean.

Why a self-test and not a unit test
-----------------------------------
`tests/` belongs to AGENT-4 and this checks a tool, not the app. More importantly a
checker that cannot fail is worth nothing: `validate_mcu.py` earned its place by
catching fourteen planted breaks, and the same bar applies here. Every break below is
a real name from a real WCH part - the CH32X035 clock spelling, the CH32V10x GPIO
speeds, the CH32V003 header - because plausible-but-wrong is the whole failure mode.
A break made of `ZZZ_NOT_A_NAME` would prove only that the tool can spell.

Each case names the YAML path it damages, the damage, and a fragment the error must
contain. A case that produces no error, or an error that does not mention its path,
fails the self-test.
"""
from __future__ import annotations

import argparse
import copy
import pathlib
import sys
import tempfile

try:
    import yaml
except ImportError:
    sys.exit("verify_sdk_names_selftest: PyYAML is required.  pip install pyyaml")

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import verify_sdk_names as V  # noqa: E402

SUBJECT = ROOT / "data" / "mcus" / "CH32V006.yaml"


# --------------------------------------------------------------- the mutations
def set_path(doc: dict, dotted: str, value) -> None:
    node = doc
    parts = dotted.split(".")
    for k in parts[:-1]:
        node = node[int(k)] if isinstance(node, list) else node[k]
    key = parts[-1]
    if isinstance(node, list):
        node[int(key)] = value
    else:
        node[key] = value


def first_param_with_options(doc: dict):
    """(peripheral id, index) of a param that has enum options - for the params cases."""
    for pid, P in (doc.get("peripherals") or {}).items():
        for i, p in enumerate((P or {}).get("params") or []):
            if isinstance(p, dict) and p.get("options"):
                return pid, i
    return None, None


def vector_index(doc: dict, name: str) -> int:
    for i, v in enumerate(doc["nvic"]["vectors"]):
        if v.get("name") == name:
            return i
    raise KeyError(name)


# Each case: (label, mutate(doc), path fragment the error must name, text it must contain)
def build_cases(doc: dict):
    pid, pi = first_param_with_options(doc)
    try:
        adc = vector_index(doc, "ADC")
    except KeyError:
        # Same principle as the `pid is None` guard below, for the OTHER way a stale
        # target can hide: this one does not build a shorter list, it raises straight
        # out of build_cases() with no case ever printed at all -- an uncaught
        # KeyError crashes main() with a raw traceback before the "N planted break(s)
        # caught" line is ever reached, which reads as a tooling failure rather than
        # the specific, nameable gap it is.
        sys.exit(f"verify_sdk_names_selftest: {SUBJECT.name}'s `nvic.vectors` no "
                  f"longer names an \"ADC\" vector -- the two `nvic irqn` cases need "
                  f"a real vector index and cannot be built. Point vector_index() at "
                  f"a vector name this part still has.")
    if pid is None:
        # THE GAP THIS GUARD CLOSES: without it, `if pid is not None:` below simply
        # never appends the 8 params-shaped cases -- no exception, no missing-key
        # error, just a shorter `cases` list that still reports "N/N caught" over
        # fewer than N real checks. That is the exact shape found in
        # tools/validate_params_selftest.py (a stale `params:` key raised before the
        # validator ran and the harness still called it a catch, 2026-09-14) one
        # layer up: here nothing even raises, the case is just never built. A
        # sibling with an enum-optioned `params:` row is not a rare fact about
        # CH32V006 worth assuming silently -- it is the premise 8 of this file's
        # cases stand on, so its absence is a hard error, not a smaller total.
        sys.exit(f"verify_sdk_names_selftest: no peripheral in {SUBJECT.name} has an "
                  f"enum-optioned `params:` row any more -- 8 cases (params struct/"
                  f"sdk_field/sdk_call/sdk_none/sdk_args/option sdk) cannot be built, "
                  f"not merely skipped. Point first_param_with_options() at a part or "
                  f"peripheral that still has one.")
    cases = [
        ("header, wrong CASE only (the round-2 defect)",
         lambda d: set_path(d, "codegen.header", "ch32v00x.h"),
         "codegen.header", "CASE"),

        ("header, a file that does not exist",
         lambda d: set_path(d, "codegen.header", "ch32v99X.h"),
         "codegen.header", "not a header"),

        ("gpio_clock.fn, the CH32X035 spelling on a V00x part",
         lambda d: set_path(d, "codegen.gpio_clock.fn", "RCC_APB2PeriphClockCmd"),
         "codegen.gpio_clock.fn", "RCC_APB2PeriphClockCmd"),

        ("gpio_clock.port, the CH32X035 spelling",
         lambda d: set_path(d, "codegen.gpio_clock.port", "RCC_APB2Periph_GPIO$PORT"),
         "codegen.gpio_clock.port", "RCC_APB2Periph_GPIO"),

        ("gpio_clock.afio, plausible but absent",
         lambda d: set_path(d, "codegen.gpio_clock.afio", "RCC_APB2Periph_AFIO"),
         "codegen.gpio_clock.afio", "AFIO"),

        ("gpio.speeds[].macro, the CH32V10x/20x/30x spelling",
         lambda d: set_path(d, "gpio.speeds.0.macro", "GPIO_Speed_50MHz"),
         "gpio.speeds[0].macro", "GPIO_Speed_50MHz"),

        ("gpio.modes[].macro, a mode macro that does not exist",
         lambda d: set_path(d, "gpio.modes.0.macro", "GPIO_Mode_Out_PushPull"),
         "gpio.modes[0].macro", "GPIO_Mode_Out_PushPull"),

        ("gpio.input_modes[].macro, the STM32 floating-input spelling",
         lambda d: set_path(d, "gpio.input_modes.0.macro", "GPIO_Mode_IN_Floating"),
         "gpio.input_modes[0].macro", "GPIO_Mode_IN_Floating"),

        ("a GPIOMode_TypeDef member no mode entry can reach -> WARN",
         lambda d: d["gpio"]["modes"].pop(),
         "gpio.modes", "unaccounted"),

        ("codegen.speeds value, the CH32V10x spelling",
         lambda d: d["codegen"]["speeds"].__setitem__("Low", "GPIO_Speed_2MHz"),
         "codegen.speeds.Low", "GPIO_Speed_2MHz"),

        ("periph_clock domain fn, wrong bus spelling",
         lambda d: set_path(d, "codegen.periph_clock.PB2.fn", "RCC_APB2PeriphClockCmd"),
         "codegen.periph_clock.PB2.fn", "RCC_APB2PeriphClockCmd"),

        ("periph_clock bit key, a peripheral with no enable macro",
         lambda d: d["codegen"]["periph_clock"]["PB2"]["bits"].__setitem__("GPIOF", 7),
         "codegen.periph_clock.PB2.bits.GPIOF", "RCC_PB2Periph_GPIOF"),

        ("dma channel_params sdk_field, not a DMA_InitTypeDef member",
         lambda d: set_path(d, "dma.channel_params.0.sdk_field", "DMA_Direction"),
         "dma.channel_params[0]", "DMA_Direction"),

        ("dma channel_params option sdk, a macro that does not exist",
         lambda d: set_path(d, "dma.channel_params.0.options.0.sdk", "DMA_DIR_PeripheralSrc"),
         "dma.channel_params[0]", "DMA_DIR_PeripheralSrc"),

        ("channel_params sdk_calls, a per-channel Init that does not exist",
         lambda d: set_path(d, "peripherals.TIM1.channel_params.sdk_calls.3", "TIM_OC3Config"),
         "peripherals.TIM1.channel_params.sdk_calls.3", "TIM_OC3Config"),

        ("channel_params sdk_field, not a member of TIM_OCInitTypeDef",
         lambda d: set_path(d, "peripherals.TIM1.channel_params.params.0.sdk_field", "TIM_OCMode_"),
         "peripherals.TIM1.channel_params.params[0]", "TIM_OCMode_"),

        ("codegen.remap.fn under style: macro, a function that does not exist",
         lambda d: (d["codegen"].setdefault("remap", {}).update(
             {"style": "macro", "fn": "GPIO_PinRemapConfigure", "enable": "ENABLE"})),
         "codegen.remap.fn", "GPIO_PinRemapConfigure"),

        ("dma.remaps macro, a plausible EXTEN bit name that does not exist",
         lambda d: set_path(d, "dma.remaps.0.macro", "EXTEN_TIM2_DMA_REMAP_EN"),
         "dma.remaps[0].macro", "EXTEN_TIM2_DMA_REMAP_EN"),

        ("nvic irqn, a name in neither the enum nor the startup table",
         lambda d: set_path(d, f"nvic.vectors.{adc}.irqn", "ADC1_IRQn"),
         "nvic.vectors", "ADC1_IRQn"),

        ("nvic irqn, the handler symbol used where the enum member belongs",
         lambda d: set_path(d, f"nvic.vectors.{adc}.irqn", "ADC1_IRQHandlerr"),
         "nvic.vectors", "ADC1_IRQHandlerr"),

        ("init_structs fn, a function the SDK does not declare",
         lambda d: set_path(d, "codegen.init_structs.USART_InitTypeDef.fn", "USART_Initialise"),
         "codegen.init_structs.USART_InitTypeDef.fn", "USART_Initialise"),

        ("init_structs keyed by a struct the SDK does not define",
         lambda d: d["codegen"]["init_structs"].__setitem__(
             "UART_InitTypeDef", {"fn": "USART_Init"}),
         "codegen.init_structs.UART_InitTypeDef", "UART_InitTypeDef"),

        ("periph_handle naming a register block that does not exist",
         lambda d: set_path(d, "codegen.periph_handle.OPA1", "OPA1"),
         "codegen.periph_handle.OPA1", "OPA1"),

        ("channel_macros naming a channel macro that does not exist",
         lambda d: set_path(d, "codegen.channel_macros.ADC1.IN0", "ADC_Channel0"),
         "codegen.channel_macros.ADC1.IN0", "ADC_Channel0"),

        ("pio_board naming a board the ch32v platform does not ship",
         lambda d: set_path(d, "mcu.variants.CH32V006F8P7.pio_board", "genericCH32V006F8P7"),
         "mcu.variants.CH32V006F8P7.pio_board", "genericCH32V006F8P7"),

        ("pio_env naming an environment platformio.ini does not define",
         lambda d: set_path(d, "mcu.variants.CH32V006F8P7.pio_env", "CH32V006F8P7"),
         "mcu.variants.CH32V006F8P7.pio_env", "CH32V006F8P7"),

        ("sdk.series unknown -> must WARN 'not checked', never pass silently",
         lambda d: (d["codegen"].pop("sdk"),
                    d["codegen"].__setitem__("sdk", {"series": "ch32vNOPE"})),
         "codegen.sdk.series", "NOT CHECKED"),

        ("no codegen.sdk at all -> must WARN, never pass silently",
         lambda d: d["codegen"].pop("sdk"),
         "codegen.sdk", "NOTHING in this file was checked"),
    ]
    if pid is not None:
        cases += [
            ("params struct, a type the SDK does not define",
             lambda d: d["peripherals"][pid]["params"][pi].update(
                 {"struct": "USART_InitTypedef"}),
             f"peripherals.{pid}.params[{pi}]", "USART_InitTypedef"),

            ("params sdk_field, not a member of the struct it claims",
             lambda d: d["peripherals"][pid]["params"][pi].update(
                 {"struct": "USART_InitTypeDef", "sdk_field": "USART_Baudrate"}),
             f"peripherals.{pid}.params[{pi}]", "USART_Baudrate"),

            ("params sdk_call, a function the SDK does not declare",
             lambda d: d["peripherals"][pid]["params"][pi].update(
                 {"sdk_call": "TIM_ARRPreloadConfigure"}),
             f"peripherals.{pid}.params[{pi}]", "TIM_ARRPreloadConfigure"),

            ("params sdk_none with no sdk_note -> an unexplained gap must WARN",
             lambda d: d["peripherals"][pid]["params"][pi].update({"sdk_none": True}),
             f"peripherals.{pid}.params[{pi}]", "no `sdk_note:`"),

            ("sdk_args using a placeholder the generator does not define",
             lambda d: d["peripherals"][pid]["params"][pi].update(
                 {"sdk_call": "ADC_Init", "sdk_args": ["$HANDEL", "$VALUE"]}),
             f"peripherals.{pid}.params[{pi}]", "$HANDEL"),

            # `pop` as well as `update`: the subject parameter may already carry sdk_args,
            # and a case that quietly depends on which parameter gets picked is a case
            # that passes for the wrong reason. It did exactly that once.
            ("sdk_call with no sdk_args -> WARN, because it becomes a TODO",
             lambda d: (d["peripherals"][pid]["params"][pi].pop("sdk_args", None),
                        d["peripherals"][pid]["params"][pi].update({"sdk_call": "ADC_Init"})),
             f"peripherals.{pid}.params[{pi}]", "how"),

            ("params option sdk, a macro that does not exist",
             lambda d: d["peripherals"][pid]["params"][pi]["options"][0].update(
                 {"sdk": "USART_WordLength_9bit"}),
             f"peripherals.{pid}.params[{pi}]", "USART_WordLength_9bit"),
        ]
    return cases


# --------------------------------------------------------------- the harness
def run(doc: dict, tmp: pathlib.Path):
    """Write a doc out and verify it, exactly as the command line would."""
    tmp.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return V.verify_file(tmp)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    if not SUBJECT.exists():
        print(f"verify_sdk_names_selftest: {SUBJECT} is missing")
        return 1
    clean = yaml.safe_load(SUBJECT.read_text(encoding="utf-8"))

    with tempfile.TemporaryDirectory() as td:
        tmp = pathlib.Path(td) / "CH32V006.yaml"

        # Baseline: the real file, round-tripped through the same path, must be clean.
        base = run(copy.deepcopy(clean), tmp)
        if base.errors:
            print("verify_sdk_names_selftest: the UNMODIFIED file already fails, so a")
            print("planted break would prove nothing. Fix these first:")
            for e in base.errors:
                print("   " + Report_safe(e))
            return 1
        if args.verbose:
            print("  baseline  clean, no errors on the unmodified file")

        cases = build_cases(clean)
        caught = missed = 0
        for label, mutate, path_frag, text_frag in cases:
            doc = copy.deepcopy(clean)
            try:
                mutate(doc)
            except Exception as exc:                      # noqa: BLE001
                print(f"  BROKEN CASE  {label}: could not plant it ({exc})")
                missed += 1
                continue
            rep = run(doc, tmp)
            problems = rep.errors + rep.warns
            hit = next((p for p in problems
                        if path_frag in p and text_frag in p), None)
            if hit:
                caught += 1
                if args.verbose:
                    print(f"  caught    {label}\n              {Report_safe(hit)}")
            else:
                missed += 1
                print(f"  MISSED    {label}")
                print(f"              wanted a report naming `{path_frag}` "
                      f"and containing `{text_frag}`")
                print("              got: " + (
                    "; ".join(Report_safe(p) for p in problems) or "nothing at all"))

        dh_total, dh_missed = driver_header_cases(tmp, verbose=args.verbose)
        dc_total, dc_missed = driver_c_cases(tmp, verbose=args.verbose)
        bf_total, bf_missed = bitfield_cases(tmp, verbose=args.verbose)
        missed += dh_missed + dc_missed + bf_missed
        total = len(cases) + dh_total + dc_total + bf_total
        print(f"\n{total} planted break(s), {total - missed} caught, {missed} missed")
        return 1 if missed else 0


def driver_header_cases(tmp: pathlib.Path, verbose: bool = False) -> tuple[int, int]:
    """The headers that ship OUTSIDE Peripheral/inc, and the rule that admits them.

    Not every peripheral has an SPL driver. CH32H417's UHSIF ships as a prebuilt
    `libUHSIF.a` with its header beside it in an example folder, so `evt_include_dirs()`
    indexes a header that sits next to a `.a` and follows the SPL's own `<prefix>_*.h`
    naming. Three things have to hold, and the first version of the rule failed the third:

      1. POSITIVE - the UHSIF header's folder is indexed, or every `DEF_UHSIF_*` name in
         the MCU file is reported as non-existent and the peripheral cannot be modelled.
      2. END TO END - a planted bad macro in that header's namespace is actually NAMED.
         Without this, (1) could pass while the file was read and its contents dropped.
      3. NEGATIVE - an ordinary example folder is NOT indexed. The first version of the
         rule ("a header next to a .c or .a of any name") matched 711 directories in this
         one drop, because every example ships main.h/main.c. That does not merely add
         noise: it lets a stale example's scratch header vouch for a macro the SPL has
         removed, turning this gate from "the name exists in the SDK" into "the name
         exists somewhere in the zip".
    """
    import verify_sdk_names as V                                      # noqa: PLC0415

    evt = ROOT / "data" / "sources" / "H417" / "Evt"
    part = ROOT / "data" / "mcus" / "CH32H417.yaml"
    if not evt.is_dir() or not part.is_file():
        print("  SKIP      driver-header cases: the H417 drop is not present")
        return (0, 0)

    missed = 0
    found = V.evt_include_dirs(evt)
    dirs = {p.as_posix() for p in found}
    uhsif = (evt / "EXAM/UHSIF/UHSIF_SLAVE/Common").as_posix()

    # The negative half is written as INVARIANTS OVER EVERY indexed directory, not as
    # "this one example folder is absent". The first version did the latter, naming
    # EXAM/ADC/ADC_DMA/Common - and when the rule was deliberately re-widened to 402
    # directories it still passed, because that particular folder holds no main.c and the
    # widening never reached it. A negative case that a real widening walks straight past
    # is the defect this whole file is about, scored against the test instead of the tool.
    spl = [p for p in found if p.name == "inc" and p.parent.name == "Peripheral"]
    extra = [p for p in found if p not in spl]
    no_lib = [p.as_posix() for p in extra if not any(p.glob("*.a"))]
    no_prefixed_hdr = [p.as_posix() for p in extra
                       if not any(h.stem.split("_", 1)[0].lower()
                                  in {s.stem.split("_", 1)[0].lower()
                                      for d in spl for s in d.glob("*_*.h")}
                                  for h in p.glob("*_*.h"))]

    for label, ok in (
        (f"the library driver's header folder IS indexed ({len(dirs)} dirs)", uhsif in dirs),
        (f"every indexed folder outside the SPL holds a prebuilt `.a`"
         + (f" - {len(no_lib)} do not, e.g. {no_lib[:2]}" if no_lib else ""), not no_lib),
        (f"every indexed folder outside the SPL holds an SPL-named `<prefix>_*.h`"
         + (f" - {len(no_prefixed_hdr)} do not, e.g. {no_prefixed_hdr[:2]}" if no_prefixed_hdr else ""),
         not no_prefixed_hdr),
    ):
        print(f"{'  caught  ' if ok else '  MISSED  '}{label}")
        if not ok:
            missed += 1

    # End to end: a macro that only the library driver's header could vouch for.
    doc = yaml.safe_load(part.read_text(encoding="utf-8"))
    try:
        opts = doc["peripherals"]["UHSIF"]["params"][0]["options"]
        opts[-1]["sdk"] = str(opts[-1]["sdk"]) + "_NOPE"
        planted = opts[-1]["sdk"]
    except Exception as exc:                                          # noqa: BLE001
        print(f"  MISSED    UHSIF end-to-end: could not plant it ({exc})")
        return (4, missed + 1)
    rep = run(doc, tmp.parent / "CH32H417.yaml")
    hit = next((p for p in rep.errors + rep.warns if planted in p), None)
    print(f"{'  caught  ' if hit else '  MISSED  '}a bad macro in the library driver's "
          f"namespace is named")
    if hit and verbose:
        print("              " + Report_safe(hit))
    return (4, missed + (0 if hit else 1))


def driver_c_cases(tmp: pathlib.Path, verbose: bool = False) -> tuple[int, int]:
    """`codegen.sdk.driver_c:` - the THIRD indexing mode, for a name no header anywhere
    declares. CH32H417's `ETH_RegInit` is the proven case, same shape as
    `driver_header_cases()` above for UHSIF: both halves asserted as invariants, not
    "this one thing is present", because the whole point of a hand-curated file list
    (over a filesystem rule) is that NOTHING else leaks in from it.

      1. POSITIVE - `ETH_RegInit` resolves once `driver_c:` names the file that defines
         it, and does NOT resolve with `driver_c:` removed (the file this data actually
         had before this landed) - proving the citation is load-bearing, not decorative.
      2. END TO END - a planted bad `sdk_field:` on a real ETH `params:` row is actually
         NAMED, the same discipline `driver_header_cases()`'s UHSIF case uses.
      3. NEGATIVE - a real, public, non-`static` function name that exists SOMEWHERE in
         this EVT drop but is NOT in any `driver_c:`-designated file must NOT resolve.
         `FLASH_ReadID` (Evt/EXAM/USBFS/DEVICE/MSC_U-Disk/Common/SPI_FLASH.c - an
         EXTERNAL SPI-NOR-flash driver, nothing to do with the on-chip FLASH
         peripheral) is the proven false positive from the general rule this file's own
         docstring describes trying and rejecting; asserting it stays unresolved is what
         would catch a re-widening back to that rule, the same way
         `driver_header_cases()`'s 711-directories case does for UHSIF.
    """
    import verify_sdk_names as V                                      # noqa: PLC0415

    evt = ROOT / "data" / "sources" / "H417" / "Evt"
    part = ROOT / "data" / "mcus" / "CH32H417.yaml"
    if not evt.is_dir() or not part.is_file():
        print("  SKIP      driver-c cases: the H417 drop is not present")
        return (0, 0)

    missed = 0
    doc = yaml.safe_load(part.read_text(encoding="utf-8"))

    # 1a. POSITIVE - resolves with driver_c: present (the real, shipped shape).
    rep = run(copy.deepcopy(doc), tmp.parent / "CH32H417.yaml")
    ok = not any("ETH_RegInit" in p for p in rep.errors)
    print(f"{'  caught  ' if ok else '  MISSED  '}ETH_RegInit resolves with `driver_c:` present")
    if not ok:
        missed += 1

    # 1b. Removing driver_c: must make it fail again - proves (1a) is not accidental
    # (e.g. some OTHER path also declaring the name).
    without = copy.deepcopy(doc)
    without["codegen"]["sdk"].pop("driver_c", None)
    rep2 = run(without, tmp.parent / "CH32H417.yaml")
    hit = any("ETH_RegInit" in p and "is not a declared function" in p for p in rep2.errors)
    print(f"{'  caught  ' if hit else '  MISSED  '}ETH_RegInit fails WITHOUT `driver_c:` "
          f"- the citation is load-bearing")
    if not hit:
        missed += 1

    # 2. END TO END - a bad sdk_field on a real ETH row is named.
    planted = copy.deepcopy(doc)
    try:
        row = next(p for p in planted["peripherals"]["ETH"]["params"] if p["key"] == "watchdog")
        row["sdk_field"] = "ETH_NotARealField"
    except Exception as exc:                                          # noqa: BLE001
        print(f"  MISSED    ETH end-to-end: could not plant it ({exc})")
        missed += 1
    else:
        rep3 = run(planted, tmp.parent / "CH32H417.yaml")
        hit3 = any("ETH_NotARealField" in p for p in rep3.errors)
        print(f"{'  caught  ' if hit3 else '  MISSED  '}a bad `sdk_field:` on a real ETH row is named")
        if not hit3:
            missed += 1

    # 3. NEGATIVE - a real function that exists elsewhere in the drop, but not in any
    # designated file, must not resolve. Proves scanning stayed narrow.
    negative = copy.deepcopy(doc)
    negative.setdefault("codegen", {}).setdefault("init_structs", {})["ETH_InitTypeDef2"] = (
        {"fn": "FLASH_ReadID", "no_handle": True}
    )
    # A synthetic struct/fn pair just to ask the SAME question `want()` asks of `fn:`,
    # without needing a params: row of its own - does the SDK index carry this name.
    rep4 = run(negative, tmp.parent / "CH32H417.yaml")
    leaked = not any("FLASH_ReadID" in p and "is not a declared function" in p for p in rep4.errors)
    print(f"{'  caught  ' if not leaked else '  MISSED  '}`FLASH_ReadID` (a real function "
          f"outside any designated driver_c: file) stays unresolved")
    if leaked:
        missed += 1

    return (4, missed)


def bitfield_cases(tmp: pathlib.Path, verbose: bool = False) -> tuple[int, int]:
    """A C bitfield member (`NAME : N;`) must read as a field; padding must not.

    Found modelling CH32H417's SERDES: `SDS_CFG_TypeDef` (ch32h417_serdes.h:62-79) is
    packed entirely out of `uint32_t NAME : 1;` rows, and `add_header()`'s field
    extraction required a comma or end-of-string right after the name - which `: 1` is
    neither - so every one of twelve real, correct fields read as "not a member of its
    own struct" before the fix (`BITFIELD_WIDTH_RE`, stripping `: <width>` ahead of
    `FIELD_RE` rather than teaching that regex a second terminator). This is the case
    that fix never had: the gate changed and `verify_sdk_names_selftest.py` stayed at
    35/35, which means the new code path had never been seen to go red. Four checks
    against a synthetic header exercise `Index.add_header()` directly - named bitfield,
    plain member, array member, anonymous padding - and a fifth runs the change
    END TO END against the real CH32H417.yaml, because the synthetic checks alone would
    not have caught a regression in how `verify_file()` WIRES field lookups together.

    The negative half is the one that matters, twice over: an anonymous bitfield must
    contribute no field name (a looser fix that also swallowed `uint32_t : 5;` would
    hide the next FMC/SAI-shaped struct's genuinely absent member the same way this bug
    hid twelve genuinely present ones), and a bogus field name inside a real bitfield
    struct must still be REJECTED by the full pipeline, not just parsed.
    """
    missed = 0
    src = (
        "typedef struct\n"
        "{\n"
        "    uint32_t RealOne : 1;\n"
        "    uint32_t RealTwo : 1;\n"
        "    uint32_t : 5;\n"
        "    uint16_t Plain;\n"
        "    uint8_t ArrA[4];\n"
        "} SELFTEST_BitfieldTypeDef;\n"
    )
    with tempfile.TemporaryDirectory() as td:
        hp = pathlib.Path(td) / "selftest_bitfield.h"
        hp.write_text(src, encoding="utf-8")
        idx = V.Index("selftest")
        idx.add_header(hp)
        fields = idx.fields.get("SELFTEST_BitfieldTypeDef", set())

    for label, ok in (
        (f"named bitfield members are captured ({sorted(fields)})",
         {"RealOne", "RealTwo"} <= fields),
        ("a plain member and an array member are still captured (no regression)",
         {"Plain", "ArrA"} <= fields),
        ("anonymous bitfield padding contributes no field name",
         len(fields) == 4),
        ("a name the header never wrote is still rejected (negative half, in isolation)",
         "NotARealField" not in fields),
    ):
        print(f"{'  caught  ' if ok else '  MISSED  '}{label}")
        if not ok:
            missed += 1

    # End to end, negative: a bogus field name inside a REAL bitfield struct, run
    # through verify_file() exactly as the command line would. The four checks above
    # would not by themselves have caught a wiring defect where add_header()'s result
    # is parsed correctly but never actually consulted for `params.*.sdk_field`.
    part = ROOT / "data" / "mcus" / "CH32H417.yaml"
    if not part.is_file():
        print("  SKIP      bitfield end-to-end: CH32H417.yaml is missing")
        return (4, missed)
    doc = yaml.safe_load(part.read_text(encoding="utf-8"))
    try:
        cp = doc["peripherals"]["SERDES"]["channel_params"]["params"]
        row = next(p for p in cp if p.get("key") == "clear_all")
        assert row["sdk_field"] == "ClearALL"
        row["sdk_field"] = "ClearALLNotAField"
    except Exception as exc:                                          # noqa: BLE001
        print(f"  MISSED    bitfield end-to-end: could not plant it ({exc})")
        return (5, missed + 1)
    rep = run(doc, tmp.parent / "CH32H417.yaml")
    hit = next((p for p in rep.errors + rep.warns
                if "ClearALLNotAField" in p and "SDS_CFG_TypeDef" in p), None)
    print(f"{'  caught  ' if hit else '  MISSED  '}a bogus field name inside a real "
          f"bitfield struct is rejected end to end")
    if hit and verbose:
        print("              " + Report_safe(hit))
    return (5, missed + (0 if hit else 1))


def Report_safe(text: str) -> str:
    enc = getattr(sys.stdout, "encoding", None) or "ascii"
    return str(text).encode(enc, "replace").decode(enc, "replace")


if __name__ == "__main__":
    sys.exit(main())
