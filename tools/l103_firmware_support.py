#!/usr/bin/env python3
"""Two firmware edits the CH32L103 compile gate asked for.

  1. `wch_hal_gpio.h` has no `WCH_HAL_GPIO_SPEED_MAX` for the L103 series, so
     `wch_hal_gpio_config()` failed to compile with `'WCH_HAL_GPIO_SPEED_MAX'
     undeclared`. The value is read from ch32l103_gpio.h:25-27.
  2. `Taskfile.yml`'s `ENVS` list must match data/firmware/platformio.ini, which now
     has CH32L103K8U6. `tests/release.test.js` fails when they drift, with the right
     reason: a part in one and not the other is a configuration nobody builds.
"""
import io
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HDR = ROOT / 'data/firmware/lib/wch_hal/include/wch_hal_gpio.h'
TASK = ROOT / 'Taskfile.yml'

ANCHOR = '#  define WCH_HAL_GPIO_SPEED_MAX GPIO_Speed_Very_High\n#endif'

ADD = (
    '#  define WCH_HAL_GPIO_SPEED_MAX GPIO_Speed_Very_High\n'
    '#elif defined(WCH_HAL_SERIES_CH32L103)\n'
    '/* THREE speeds, and the FIRST part in this repo where the speed is a real choice\n'
    ' * rather than a fixed value: GPIOSpeed_TypeDef in ch32l103_gpio.h:25-27 is\n'
    ' * { GPIO_Speed_10MHz = 1, GPIO_Speed_2MHz, GPIO_Speed_50MHz }. So this macro is\n'
    ' * genuinely a MAXIMUM here rather than "the only speed there is", and the note\n'
    ' * above this block does not apply to this series. */\n'
    '#  define WCH_HAL_GPIO_SPEED_MAX GPIO_Speed_50MHz\n'
    '#endif'
)


def main():
    h = io.open(HDR, encoding='utf-8').read()
    if 'WCH_HAL_SERIES_CH32L103' in h:
        print('header: already has the L103 speed macro')
    else:
        if ANCHOR not in h:
            sys.exit('header: anchor not found')
        io.open(HDR, 'w', encoding='utf-8', newline='\n').write(h.replace(ANCHOR, ADD, 1))
        print('header: added WCH_HAL_GPIO_SPEED_MAX for CH32L103')

    t = io.open(TASK, encoding='utf-8').read()
    if 'CH32L103K8U6' in t:
        print('Taskfile: already lists CH32L103K8U6')
    else:
        old = 'ENVS: CH32V006F8P6 CH32V006K8U6 CH32V005F6P6 CH32V003F4P6 CH32X035G8U6 CH32H417QEU6'
        if old not in t:
            sys.exit('Taskfile: ENVS line not found')
        new = 'ENVS: CH32V006F8P6 CH32V006K8U6 CH32V005F6P6 CH32V003F4P6 CH32X035G8U6 CH32H417QEU6 CH32L103K8U6'
        io.open(TASK, 'w', encoding='utf-8', newline='\n').write(t.replace(old, new, 1))
        print('Taskfile: added CH32L103K8U6 to ENVS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
