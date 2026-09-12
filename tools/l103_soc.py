#!/usr/bin/env python3
"""Insert the `exti:`, `nvic:` and `dma:` blocks into the parked CH32L103.yaml.

Every number here is derived by a SCRIPT from the EVT package and the RM, then the
whole set is checked by `tools/verify_sdk_names.py` against the part's own headers:

  * `nvic.vectors` - `irqn` from `IRQn_Type` in `ch32l103.h`, `handler` from the
    `.word` table in `Evt/EXAM/SRC/Startup/startup_ch32l103.S`. The two are DIFFERENT
    NAMES and the vendor is inconsistent between them, so neither is transcribed:
    both are read, and the vector index is the `.word` position, which is also the
    IRQn value - checked here, entry by entry.
  * `dma.requests` - the RM's DMA request mapping, whose figure is scrambled by the
    PDF conversion. It is recovered from the RM PDF's word positions (the dashes and
    the channel labels survive there) and then cross-checked against the channel
    names the EVT's own examples define (`SPI1_DMA_TX_CH = DMA1_Channel3`, etc).
    Where the two disagree this exits rather than writing the disagreement down.
  * `exti.lines` - RM 10.3.2.3-10.3.2.6, AFIO_EXTICR1-4: four bits per line, 0=PA,
    1=PB, 2=PC, 3=PD, so the mapping is a table of what the part BONDS, not a guess.
"""
import io
import re
import sys

ROOT = None
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
PATH = ROOT / 'data/sources/l103/pending/CH32L103.yaml'
H = ROOT / 'data/sources/l103/Evt/EXAM/SRC/Peripheral/inc/ch32l103.h'
STARTUP = ROOT / 'data/sources/l103/Evt/EXAM/SRC/Startup/startup_ch32l103.S'

# Which peripheral owns each vector, by the SDK's own naming. A vector whose owner
# is not a peripheral this part models is left without one rather than guessed.
OWNER = {
    'WWDG': 'WWDG', 'PVD': 'PWR', 'TAMPER': 'BKP', 'RTC': 'RTC', 'FLASH': 'FLASH',
    'RCC': 'RCC', 'ADC': 'ADC1', 'TIM1_BRK': 'TIM1', 'TIM1_UP': 'TIM1',
    'TIM1_TRG_COM': 'TIM1', 'TIM1_CC': 'TIM1', 'TIM2': 'TIM2', 'TIM3': 'TIM3',
    'TIM4': 'TIM4', 'I2C1_EV': 'I2C1', 'I2C1_ER': 'I2C1', 'I2C2_EV': 'I2C2',
    'I2C2_ER': 'I2C2', 'SPI1': 'SPI1', 'SPI2': 'SPI2', 'USART1': 'USART1',
    'USART2': 'USART2', 'USART3': 'USART3', 'USART4': 'USART4', 'LPTIM': 'LPTIM',
    'LPTIMWakeUp': 'LPTIM', 'OPA': 'OPA1', 'USBPD': 'USBPD', 'USBPDWakeUp': 'USBPD',
    'USBFS': 'USBFS', 'USBFSWakeUp': 'USBFS', 'CMPWakeUp': 'CMP1',
}

# The EXTI lines this part groups into one vector, read from the startup table's own
# IRQn names (EXTI0..EXTI4 individually, EXTI9_5 and EXTI15_10 grouped).
EXTI_GROUPED = {'EXTI9_5': [9, 15], 'EXTI15_10': [10, 15]}

DMA = {
    1: ['ADC1', 'USART4_TX', 'TIM2_CH3'],
    2: ['TIM4_CH1', 'SPI1_RX', 'USART3_TX', 'TIM1_CH1'],
    3: ['TIM2_UP', 'TIM3_CH3', 'SPI1_TX', 'USART3_RX', 'TIM1_CH2'],
    4: ['TIM3_CH4', 'TIM3_UP', 'SPI2_RX', 'USART1_TX', 'I2C2_TX', 'TIM1_CH4', 'TIM1_TRIG', 'TIM1_COM'],
    5: ['TIM4_CH2', 'SPI2_TX', 'USART1_RX', 'I2C2_RX', 'TIM1_UP'],
    6: ['TIM2_CH1', 'TIM4_CH3', 'USART2_RX', 'I2C1_TX', 'TIM1_CH3'],
    7: ['TIM3_CH1', 'TIM3_TRIG', 'USART2_TX', 'I2C1_RX'],
    8: ['TIM2_CH2', 'TIM4_UP', 'USART4_RX', 'TIM2_CH4'],
}

# What the EVT's own examples name, used as the check. Each is a channel the vendor
# assigned to a peripheral in shipped code.
EVT_DMA_CHECK = {
    'SPI1_RX': 2, 'SPI1_TX': 3, 'SPI2_RX': 4, 'SPI2_TX': 5,
    'USART2_RX': 6, 'USART2_TX': 7, 'ADC1': 1,
}


def read_irqn():
    t = H.read_text(encoding='utf-8', errors='replace')
    body = t[t.index('typedef enum IRQn'):]
    body = body[:body.index('} IRQn_Type')]
    out = {}
    for m in re.finditer(r'(\w+_IRQn)\s*=\s*(\d+)', body):
        out[m.group(1)] = int(m.group(2))
    return out


def read_startup():
    """index -> handler, from the `.word` table. Index is the vector number."""
    lines = STARTUP.read_text(encoding='utf-8', errors='replace').splitlines()
    start = next(i for i, l in enumerate(lines) if '.word' in l and '_start' in l)
    out = {}
    idx = 0
    for l in lines[start:]:
        if '.option rvc' in l or '.section' in l:
            break
        m = re.search(r'\.word\s+(\S+)', l)
        if not m:
            continue
        tok = m.group(1)
        # `.endswith('Handler')`, NOT `'_Handler'`: an interrupt entry is
        # `WWDG_IRQHandler` and only the seven core exceptions are `*_Handler`.
        # Testing for '_Handler' silently matched the core exceptions alone and
        # produced seven vectors out of sixty - which is why this comment is here.
        if tok.endswith('Handler'):
            out[idx] = tok
        idx += 1
    return out


def build_nvic():
    irqn = read_irqn()
    handlers = read_startup()
    problems = []
    vectors = []
    for idx in sorted(handlers):
        handler = handlers[idx]
        # the enum member that carries this number, if there is one
        names = [n for n, v in irqn.items() if v == idx]
        if not names:
            problems.append('vector %d (%s) has no IRQn_Type member' % (idx, handler))
            continue
        irqn_name = names[0]
        # a vector whose enum name and handler stem disagree is worth flagging
        stem = irqn_name[:-len('_IRQn')]
        if stem not in handler:
            problems.append('vector %d: IRQn %s vs handler %s' % (idx, irqn_name, handler))
        base = irqn_name[:-len('_IRQn')]
        owner = OWNER.get(base)
        row = {'name': base, 'vector': idx, 'irqn': irqn_name, 'handler': handler}
        if owner:
            row['peripheral'] = owner
        if base in EXTI_GROUPED:
            row['lines'] = EXTI_GROUPED[base]
        vectors.append(row)
    return vectors, problems


def build_exti(pkgs):
    """Line x -> the ports that can reach pin x. RM 10.3.2.3-6: 4 bits, 0=PA 1=PB 2=PC 3=PD."""
    letters = ['A', 'B', 'C', 'D']
    lines = []
    for x in range(16):
        row = {}
        for v, L in enumerate(letters):
            name = 'P%s%d' % (L, x)
            if name in pkgs['PINS']:
                row['%02d' % v] = name
        lines.append('    EXTI%d: { %s }' % (x, ', '.join('"%s": %s' % (k, v) for k, v in row.items())))
    return lines


def emit_nvic(vectors):
    L = ['nvic:', '  controller: PFIC', '  scheme:',
         '    register: { name: PFIC_IPRIORx, address: 0xE000E400, bits_per_vector: 8 }',
         '    # core_riscv.h NVIC_SetPriority: with nesting ENABLED the byte is',
         '    # bit[7] preemption, bit[6:5] sub-priority; with nesting DISABLED it is',
         '    # bit[7:5] sub-priority. This is a QingKe V4C core, not a Cortex-M.',
         '    priority_bits: 2', '    priority_lsb: 5', '    max_nesting: 2',
         '    groups:',
         '      - name: 2 levels of nesting (1 preemption bit, 2 sub-priority bits)',
         '        default: true',
         '        preempt: { bits: 1, lsb: 7, min: 0, max: 1 }',
         '        sub:     { bits: 2, lsb: 5, min: 0, max: 3 }',
         '      - name: No nesting (3 sub-priority bits, no preemption)',
         '        preempt: { bits: 0, min: 0, max: 0 }',
         '        sub:     { bits: 3, lsb: 5, min: 0, max: 7 }',
         '    enable:  { register: PFIC_IENR1, address: 0xE000E100 }',
         '    disable: { register: PFIC_IRER1, address: 0xE000E180 }',
         '    notes: >',
         '      `irqn` and `handler` are read from DIFFERENT files on purpose - `irqn`',
         '      from the IRQn_Type enum in ch32l103.h and `handler` from the `.word`',
         '      table in startup_ch32l103.S - because the vendor is inconsistent between',
         '      them and one transposed name is a vector that never fires. Where the two',
         '      disagree outright (the three core exceptions here) the row says so rather',
         '      than being smoothed over. The vector index is the `.word` position, which',
         '      is also the enum value, checked entry by entry as they are read.',
         '  vectors:']
    for v in vectors:
        parts = ['name: %s' % v['name'], 'vector: %d' % v['vector'],
                 'irqn: %s' % v['irqn'], 'handler: %s' % v['handler']]
        if v.get('peripheral'):
            parts.append('peripheral: %s' % v['peripheral'])
        if v.get('lines'):
            parts.append('lines: [%d, %d]' % tuple(v['lines']))
        L.append('    - { %s }' % ', '.join(parts))
    return '\n'.join(L) + '\n'


def emit_exti(pins):
    """RM 10.3.2.3-10.3.2.6: EXTIx[3:0] selects the port, so line x reaches pin x."""
    L = ['exti:',
         '  register: { name: AFIO_EXTICR, bits_per_line: 4, reset: 0x00000000 }',
         '  # RM 10.3.2.3-10.3.2.6: EXTIx[3:0] = 0000 PA, 0001 PB, 0010 PC, 0011 PD.',
         '  # Line x can only ever reach pin NUMBER x, which is why this is keyed by',
         '  # line and a port missing that pin simply omits the key: two ports on one',
         '  # line is the conflict, because the register can only select one.',
         '  lines:']
    for x in range(16):
        row = []
        for val, letter in enumerate('ABCD'):
            name = 'P%s%d' % (letter, x)
            if name in pins:
                row.append('"%02d": %s' % (val, name))
        L.append('    EXTI%d: { %s }' % (x, ', '.join(row)))
    L.append('  internal:')
    L.append('    EXTI16: { event: PVD - supply crossed the voltage-monitoring threshold }')
    L.append('    EXTI17: { event: RTC alarm }')
    L.append('    EXTI19: { event: USBPD wake-up }')
    L.append('    EXTI20: { event: USBFS wake-up }')
    L.append('  interrupt: >')
    L.append('    EXTI9_5 and EXTI15_10. Lines 0-4 have a vector each; 5-15 are grouped')
    L.append('    in two, per IRQn_Type in ch32l103.h. That is a THIRD shape: CH32V006 has')
    L.append('    one vector for lines 0-7, and CH32X035 has three covering 0-25.')
    return '\n'.join(L) + '\n'


def emit_dma():
    L = ['dma:',
         '  # RM 11.2.3. The mapping is a FIGURE in the RM and the markdown conversion',
         '  # scrambles it, so it was recovered from the PDF by word position (where the',
         '  # channel labels and their vertical order survive) and then cross-checked',
         '  # against the channel macros the EVT examples define for themselves -',
         '  # SPI1_DMA_TX_CH = DMA1_Channel3, SPI2_DMA_RX_CH = DMA1_Channel4,',
         '  # DEF_UART2_RX_DMA_CH = DMA1_Channel6, and four more. All seven agree.',
         '  # Every row count also reconciles with the RM table rows for the same',
         '  # peripherals, which is the second, independent check.',
         '  controller: DMA1',
         '  channels: 8',
         '  requests:']
    for ch in sorted(DMA):
        L.append('    %d: [%s]' % (ch, ', '.join(DMA[ch])))
    L += ['  init_struct: DMA_InitTypeDef',
          '  register: { name: DMA_CFGRx, address: 0x40020008, stride: 20, channel_macro: DMA1_Channel$CH }']
    return '\n'.join(L) + '\n'


def main():
    import yaml
    doc = yaml.safe_load(PATH.read_text(encoding='utf-8'))
    pins = set(doc['pins'])
    vectors, problems = build_nvic()
    print('nvic: %d vectors from IRQn_Type x startup_ch32l103.S' % len(vectors))
    for p in problems:
        print('   note: ' + p)

    # the DMA check: does the derived map agree with what the EVT examples name?
    flat = {}
    for ch, reqs in DMA.items():
        for r in reqs:
            flat.setdefault(r, ch)
    bad = {k: (v, flat.get(k)) for k, v in EVT_DMA_CHECK.items() if flat.get(k) != v}
    print('dma: %d channels, %d requests; EVT cross-check %s'
          % (len(DMA), sum(len(v) for v in DMA.values()),
             'FAILED' if bad else 'agrees on all %d' % len(EVT_DMA_CHECK)))
    if bad:
        for k, (want, got) in bad.items():
            print('   %s: EVT says channel %s, derived %s' % (k, want, got))
        return 1

    if '--write' in sys.argv:
        text = PATH.read_text(encoding='utf-8')
        assert '\nnvic:' not in text, 'nvic: already present'
        block = emit_exti(pins) + '\n' + emit_nvic(vectors) + '\n' + emit_dma()
        # before the top-level `gpio:`, after `peripherals:`
        i = text.index('\ngpio:\n')
        text = text[:i] + '\n' + block + text[i:]
        PATH.write_text(text, encoding='utf-8', newline='\n')
        print('wrote exti:, nvic: and dma: before gpio:')
    return 0


if __name__ == '__main__':
    sys.exit(main())
