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
    adc = vector_index(doc, "ADC")
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

        print(f"\n{len(cases)} planted break(s), {caught} caught, {missed} missed")
        return 1 if missed else 0


def Report_safe(text: str) -> str:
    enc = getattr(sys.stdout, "encoding", None) or "ascii"
    return str(text).encode(enc, "replace").decode(enc, "replace")


if __name__ == "__main__":
    sys.exit(main())
