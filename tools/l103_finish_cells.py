#!/usr/bin/env python3
"""Finish CH32L103's peripheral coverage: real params where they exist, nothing invented.

Seventeen cells were open. Each is resolved one of three ways, and which way is a
question about the SILICON, not about effort:

  FILLED   the peripheral has a real, typed parameter surface on this part:
           PWR (8 cited PVD levels), FLASH (3 cited wait states), SPI2 and I2C2
           (the same init structs SPI1 and I2C1 already use), RTC, BKP and CRC
           (no init struct - configured by CALLING functions, like IWDG/WWDG),
           and CMP1 (CMP_InitTypeDef, applied by OPA_CMP_Init).
  REMOVED  the `GPIO` peripheral entry. CH32V006 and CH32X035 have none: the GPIO
           table is driven by the top-level `gpio:` block and the per-pin
           assignments, not by a peripheral entry. This file invented one, which is
           why the gate asked it for settings, params, a clock bit and a vector -
           four questions with no meaning. Deleting the invention is the fix, and
           it is what makes this part match its siblings.
  OPEN     USBFS and USBPD. Their headers are MACROS ONLY - `ch32l103_usb.h` is 513
           lines with no struct and no function, so there is no typed surface to
           model and inventing one would be the guess this repo bans.

Every macro and every number below is from the part's own EVT header or the RM, and
`tools/verify_sdk_names.py` checks the names afterwards.
"""
import io
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
YAML = ROOT / 'data/mcus/CH32L103.yaml'
PENDING = ROOT / 'data/sources/l103/pending/CH32L103.yaml'

PWR = '''    params:
      # RM 3.4.x PWR_CTLR [7:5] PLS[2:0], all eight levels quoted from the register
      # description. The two figures are the rising and falling threshold - the gap is
      # the comparator's hysteresis, not a tolerance.
      - key: pvd_level
        name: PVD threshold
        sdk_call: PWR_PVDLevelConfig
        sdk_args: [$VALUE]
        type: enum
        group: Basic
        default: "2.14 V rising / 2.08 V falling"
        options:
          - { name: "1.75 V rising / 1.70 V falling", value: 0, sdk: PWR_PVDLevel_0 }
          - { name: "1.93 V rising / 1.87 V falling", value: 1, sdk: PWR_PVDLevel_1 }
          - { name: "2.14 V rising / 2.08 V falling", value: 2, sdk: PWR_PVDLevel_2 }
          - { name: "2.35 V rising / 2.28 V falling", value: 3, sdk: PWR_PVDLevel_3 }
          - { name: "2.54 V rising / 2.46 V falling", value: 4, sdk: PWR_PVDLevel_4 }
          - { name: "2.72 V rising / 2.63 V falling", value: 5, sdk: PWR_PVDLevel_5 }
          - { name: "2.92 V rising / 2.83 V falling", value: 6, sdk: PWR_PVDLevel_6 }
          - { name: "3.10 V rising / 3.01 V falling", value: 7, sdk: PWR_PVDLevel_7 }
        help: "PWR_CTLR PLS[2:0]. Raise the PWR setting's PVD to Enable for this to reach the silicon."
        when: { Mode: Enabled }
'''

FLASH = '''    params:
      # RM 24.3.1 FLASH_ACTLR [1:0] LATENCY, with the RM's own HCLK brackets. Too few
      # wait states for the clock is a fetch that returns garbage, so the default is
      # the value that is safe at the 96 MHz this part can run.
      - key: latency
        name: Wait states
        sdk_call: FLASH_SetLatency
        sdk_args: [$VALUE]
        type: enum
        group: Basic
        default: "2 wait states"
        options:
          - { name: "0 wait states", value: 0, sdk: FLASH_Latency_0 }
          - { name: "1 wait state",  value: 1, sdk: FLASH_Latency_1 }
          - { name: "2 wait states", value: 2, sdk: FLASH_Latency_2 }
        help: "FLASH_ACTLR LATENCY[1:0]. RM 24.3.1: 0 wait up to 36 MHz HCLK, 1 above 36 up to 64, 2 above 64."
'''

RTC = '''    params:
      # RTC has NO init struct on this part (ch32l103_rtc.h has zero typedefs), so
      # every one of these is applied by CALLING a function - the same shape IWDG and
      # WWDG use on CH32V006.
      - key: prescaler
        name: Prescaler
        sdk_call: RTC_SetPrescaler
        sdk_args: [$VALUE]
        type: int
        group: Basic
        default: 32767
        min: 0
        max: 1048575
        help: "20 bits. With the 32.768 kHz LSE the counter ticks once a second when this is 32767."
      - key: alarm
        name: Alarm value
        sdk_call: RTC_SetAlarm
        sdk_args: [$VALUE]
        type: int
        group: Advanced
        default: 0
        min: 0
        max: 4294967295
        help: "Compared against the counter. The alarm reaches the CPU through RTCAlarm_IRQn, EXTI line 17."
'''

BKP = '''    params:
      # No init struct here either (ch32l103_bkp.h has zero typedefs).
      - key: tamper_level
        name: TAMPER pin level
        sdk_call: BKP_TamperPinLevelConfig
        sdk_args: [$VALUE]
        type: enum
        group: Basic
        default: High
        options:
          - { name: High, value: 1, sdk: BKP_TamperPinLevel_High }
          - { name: Low,  value: 0, sdk: BKP_TamperPinLevel_Low }
        help: "Which level on the TAMPER pin sets the tamper flag and raises TAMPER_IRQn."
      - key: rtc_calibration
        name: RTC calibration
        sdk_call: BKP_SetRTCCalibrationValue
        sdk_args: [$VALUE]
        type: int
        group: Advanced
        default: 0
        min: 0
        max: 127
        help: "7 bits, BKP_OCTLR CAL[6:0]. Trims the RTC clock: roughly 0.95 ppm per step at 32.768 kHz."
'''

CRC = '''    params:
      - key: id
        name: ID register
        sdk_call: CRC_SetIDRegister
        sdk_args: [$VALUE]
        type: int
        group: Advanced
        default: 0
        min: 0
        max: 255
        help: "CRC_IDR, 8 bits. Free for the application to store anything; commonly used to tag which CRC algorithm a firmware image was built with."
'''

CMP1 = '''    params:
      # CMP_InitTypeDef is applied by OPA_CMP_Init (ch32l103_opa.h). The mux fields are
      # enums over the DS pin table's own CMP1_P0/P1/N0/N1 names, so a choice here
      # cannot name a pin this part does not have.
      - key: mode
        name: Mode
        struct: CMP_InitTypeDef
        sdk_field: Mode
        type: enum
        group: Basic
        default: High speed
        options:
          - { name: High speed, value: 1, sdk: CMP_HIGHSPEED }
          - { name: Low power,  value: 0, sdk: CMP_LOWPOWER }
      - key: psel
        name: Non-inverting input
        struct: CMP_InitTypeDef
        sdk_field: PSEL
        type: enum
        group: Basic
        default: "P0 (PA2)"
        options:
          - { name: "P0 (PA2)", value: 0, sdk: CMP_PSEL_P0 }
          - { name: "P1 (PB2)", value: 1, sdk: CMP_PSEL_P1 }
      - key: nsel
        name: Inverting input
        struct: CMP_InitTypeDef
        sdk_field: NSEL
        type: enum
        group: Basic
        default: "N0 (PB1)"
        options:
          - { name: "N0 (PB1)", value: 0, sdk: CMP_NSEL_N0 }
          - { name: "N1 (PB3)", value: 1, sdk: CMP_NSEL_N1 }
      - key: out_sel
        name: Output
        struct: CMP_InitTypeDef
        sdk_field: OUTSEL
        type: enum
        group: Advanced
        default: "OUT0 (PB0)"
        options:
          - { name: "OUT0 (PB0)", value: 0, sdk: CMP_OUT0 }
          - { name: "OUT1 (PB10)", value: 1, sdk: CMP_OUT1 }
'''


def insert_params(text, pid, block):
    m = re.search(r'^  ' + re.escape(pid) + r':\n', text, re.M)
    if not m:
        sys.exit('peripheral %s not found' % pid)
    start = m.end()
    nxt = re.search(r'^  [A-Za-z][A-Za-z0-9_]*:\n', text[start:], re.M)
    end = start + (nxt.start() if nxt else len(text))
    body = text[start:end]
    if 'params:' in body:
        print('  %s already has params, skipping' % pid)
        return text
    for anchor in ('    remaps:\n', '    notes:'):
        i = body.find(anchor)
        if i >= 0:
            return text[:start] + body[:i] + block + body[i:] + text[end:]
    return text[:start] + body.rstrip('\n') + '\n' + block + text[end:]


def copy_params(text, src, dst):
    """Give `dst` the same params block as `src` - the same init struct, so the same fields."""
    ms = re.search(r'^  ' + re.escape(src) + r':\n', text, re.M)
    if not ms:
        sys.exit('source %s not found' % src)
    s0 = ms.end()
    nx = re.search(r'^  [A-Za-z][A-Za-z0-9_]*:\n', text[s0:], re.M)
    body = text[s0:s0 + (nx.start() if nx else len(text))]
    m = re.search(r'(    params:\n(?:      .*\n|        .*\n|          .*\n)+)', body)
    if not m:
        sys.exit('source %s has no params block to copy' % src)
    block = m.group(1).replace(src, dst)
    return insert_params(text, dst, block)


def drop_peripheral(text, pid):
    """Remove a whole 2-space peripheral block."""
    m = re.search(r'^  ' + re.escape(pid) + r':\n', text, re.M)
    if not m:
        print('  %s not present' % pid)
        return text
    nxt = re.search(r'^  [A-Za-z][A-Za-z0-9_]*:\n', text[m.end():], re.M)
    top = re.search(r'^[a-z_]+:\n', text[m.end():], re.M)
    ends = [x.start() for x in (nxt, top) if x]
    end = m.end() + (min(ends) if ends else len(text) - m.end())
    print('  removed the %s entry (%d lines)' % (pid, text[m.start():end].count('\n')))
    return text[:m.start()] + text[end:]


def main():
    text = io.open(YAML, encoding='utf-8').read().replace('\r\n', '\n')
    print('resolving the 17 open cells:')

    # REMOVED - the GPIO entry is this file's invention; no sibling part has one.
    text = drop_peripheral(text, 'GPIO')

    # RTC's clock is the BKP bit: RM 2.5 "Set the PWREN bit and BKPEN bit of the
    # register RCC_PB1PCENR to turn on the operating clock of the [RTC]". Both bits
    # are already in periph_clock.PB1.bits, so this only points RTC at its gate.
    if re.search(r'^      RTC: \d', text, re.M) is None:
        text = text.replace('                   BKP: 27, PWR: 28, LPTIM: 31 } }',
                            '                   BKP: 27, PWR: 28, LPTIM: 31, RTC: 27 } }')
        text = text.replace('BKP: 27, PWR: 28, LPTIM: 31 }',
                            'BKP: 27, PWR: 28, LPTIM: 31, RTC: 27 }')

    for pid, block in (('PWR', PWR), ('FLASH', FLASH), ('RTC', RTC),
                       ('BKP', BKP), ('CRC', CRC), ('CMP1', CMP1)):
        before = text
        text = insert_params(text, pid, block)
        print('  %-6s %s' % (pid, 'params added' if text != before else 'unchanged'))

    for src, dst in (('SPI1', 'SPI2'), ('I2C1', 'I2C2')):
        before = text
        text = copy_params(text, src, dst)
        print('  %-6s %s' % (dst, 'params copied from %s' % src if text != before else 'unchanged'))

    io.open(YAML, 'w', encoding='utf-8', newline='\n').write(text)
    io.open(PENDING, 'w', encoding='utf-8', newline='\n').write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
