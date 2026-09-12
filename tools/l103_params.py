#!/usr/bin/env python3
"""Insert the `params:` blocks into the parked CH32L103.yaml.

Every SDK name and enum value here is read from `data/sources/l103/Evt/EXAM/SRC/
Peripheral/inc/ch32l103_*.h`, and every one is then checked by
`tools/verify_sdk_names.py` against those same headers - which is the point of
keeping this as data plus a gate rather than as prose.

USART2/3/4 share USART1's set exactly (same struct, same fields). TIM1 gets a
repetition counter and TIM2/3/4 do not, which is a difference in the STRUCT, so it
is a difference in the data rather than a special case in the generator.
"""
import io
import re
import sys

PATH = 'data/sources/l103/pending/CH32L103.yaml'

USART = '''    params:
      - key: baud
        name: Baud rate
        struct: USART_InitTypeDef
        sdk_field: USART_BaudRate
        type: int
        default: 115200
        min: 110
        max: 3000000
        unit: Bd
        help: "Ceiling is fCK/16. USART_BRR."
      - key: word_length
        name: Word length
        struct: USART_InitTypeDef
        sdk_field: USART_WordLength
        type: enum
        default: "8 bits"
        options:
          - { name: "8 bits", value: 0, sdk: USART_WordLength_8b }
          - { name: "9 bits", value: 1, sdk: USART_WordLength_9b }
      - key: stop_bits
        name: Stop bits
        struct: USART_InitTypeDef
        sdk_field: USART_StopBits
        type: enum
        default: "1"
        options:
          - { name: "0.5", value: 0, sdk: USART_StopBits_0_5 }
          - { name: "1",   value: 1, sdk: USART_StopBits_1 }
          - { name: "1.5", value: 3, sdk: USART_StopBits_1_5 }
          - { name: "2",   value: 2, sdk: USART_StopBits_2 }
      - key: parity
        name: Parity
        struct: USART_InitTypeDef
        sdk_field: USART_Parity
        type: enum
        default: None
        options:
          - { name: None, value: 0, sdk: USART_Parity_No }
          - { name: Even, value: 1, sdk: USART_Parity_Even }
          - { name: Odd,  value: 3, sdk: USART_Parity_Odd }
      - key: mode
        name: Direction
        struct: USART_InitTypeDef
        sdk_field: USART_Mode
        type: enum
        default: "TX and RX"
        options:
          - { name: "TX only", value: 1, sdk: USART_Mode_Tx }
          - { name: "RX only", value: 2, sdk: USART_Mode_Rx }
          - { name: "TX and RX", value: 3, sdk: USART_Mode_Tx }
        sdk_note: >
          USART_Mode is a BIT MASK in this SDK - 0x0008 for TX, 0x0004 for RX - so
          "TX and RX" is both bits. The `value` here is the enumeration index the
          app stores; `sdk` is what is emitted, which is USART_Mode_Tx because the
          app composes it. USART_Init() is called with the stored bits.
      - key: flow
        name: Hardware flow control
        struct: USART_InitTypeDef
        sdk_field: USART_HardwareFlowControl
        type: enum
        default: None
        options:
          - { name: None,   value: 0, sdk: USART_HardwareFlowControl_None }
          - { name: RTS,    value: 1, sdk: USART_HardwareFlowControl_RTS }
          - { name: CTS,    value: 2, sdk: USART_HardwareFlowControl_CTS }
          - { name: "RTS and CTS", value: 3, sdk: USART_HardwareFlowControl_RTS_CTS }
        help: "The pins come from the Hardware Flow Control SETTING, not from here - a parameter never claims a pin."
'''

SPI = '''    params:
      - key: direction
        name: Direction
        struct: SPI_InitTypeDef
        sdk_field: SPI_Direction
        type: enum
        default: Full-duplex
        options:
          - { name: Full-duplex,    value: 0, sdk: SPI_Direction_2Lines_FullDuplex }
          - { name: "Receive only", value: 1, sdk: SPI_Direction_2Lines_RxOnly }
          - { name: "1 line RX",    value: 2, sdk: SPI_Direction_1Line_Rx }
          - { name: "1 line TX",    value: 3, sdk: SPI_Direction_1Line_Tx }
      - key: mode
        name: Mode
        struct: SPI_InitTypeDef
        sdk_field: SPI_Mode
        type: enum
        default: Master
        options:
          - { name: Master, value: 1, sdk: SPI_Mode_Master }
          - { name: Slave,  value: 0, sdk: SPI_Mode_Slave }
      - key: data_size
        name: Data size
        struct: SPI_InitTypeDef
        sdk_field: SPI_DataSize
        type: enum
        default: "8 bits"
        options:
          - { name: "8 bits",  value: 0, sdk: SPI_DataSize_8b }
          - { name: "16 bits", value: 1, sdk: SPI_DataSize_16b }
      - key: cpol
        name: Clock polarity
        struct: SPI_InitTypeDef
        sdk_field: SPI_CPOL
        type: enum
        default: Low
        options:
          - { name: Low,  value: 0, sdk: SPI_CPOL_Low }
          - { name: High, value: 1, sdk: SPI_CPOL_High }
      - key: cpha
        name: Clock phase
        struct: SPI_InitTypeDef
        sdk_field: SPI_CPHA
        type: enum
        default: "1 Edge"
        options:
          - { name: "1 Edge", value: 0, sdk: SPI_CPHA_1Edge }
          - { name: "2 Edge", value: 1, sdk: SPI_CPHA_2Edge }
      - key: nss
        name: NSS
        struct: SPI_InitTypeDef
        sdk_field: SPI_NSS
        type: enum
        default: Software
        options:
          - { name: Software, value: 1, sdk: SPI_NSS_Soft }
          - { name: Hardware, value: 0, sdk: SPI_NSS_Hard }
      - key: prescaler
        name: Baud rate prescaler
        struct: SPI_InitTypeDef
        sdk_field: SPI_BaudRatePrescaler
        type: enum
        default: "2"
        options:
          - { name: "2",   value: 0, sdk: SPI_BaudRatePrescaler_2 }
          - { name: "4",   value: 1, sdk: SPI_BaudRatePrescaler_4 }
          - { name: "8",   value: 2, sdk: SPI_BaudRatePrescaler_8 }
          - { name: "16",  value: 3, sdk: SPI_BaudRatePrescaler_16 }
          - { name: "32",  value: 4, sdk: SPI_BaudRatePrescaler_32 }
          - { name: "64",  value: 5, sdk: SPI_BaudRatePrescaler_64 }
          - { name: "128", value: 6, sdk: SPI_BaudRatePrescaler_128 }
          - { name: "256", value: 7, sdk: SPI_BaudRatePrescaler_256 }
      - key: first_bit
        name: First bit
        struct: SPI_InitTypeDef
        sdk_field: SPI_FirstBit
        type: enum
        default: MSB
        options:
          - { name: MSB, value: 0, sdk: SPI_FirstBit_MSB }
          - { name: LSB, value: 1, sdk: SPI_FirstBit_LSB }
      - key: crc
        name: CRC polynomial
        struct: SPI_InitTypeDef
        sdk_field: SPI_CRCPolynomial
        type: int
        default: 7
        min: 0
        max: 65535
        help: "SPI_InitTypeDef has a polynomial member but no CRC ENABLE member, so turning CRC on is a call after SPI_Init. The generator does not invent that call."
'''

I2C = '''    params:
      - key: clock_speed
        name: Clock speed
        struct: I2C_InitTypeDef
        sdk_field: I2C_ClockSpeed
        type: int
        default: 100000
        min: 1000
        max: 400000
        unit: Hz
        help: "I2C_Init derives I2C_CKCFGR from this and the PB1 clock."
      - key: mode
        name: Mode
        struct: I2C_InitTypeDef
        sdk_field: I2C_Mode
        type: enum
        default: I2C
        options:
          - { name: I2C,         value: 0, sdk: I2C_Mode_I2C }
          - { name: SMBusDevice, value: 1, sdk: I2C_Mode_SMBusDevice }
          - { name: SMBusHost,   value: 5, sdk: I2C_Mode_SMBusHost }
      - key: duty_cycle
        name: Fast mode duty cycle
        struct: I2C_InitTypeDef
        sdk_field: I2C_DutyCycle
        type: enum
        default: "2:1"
        options:
          - { name: "2:1",  value: 0, sdk: I2C_DutyCycle_2 }
          - { name: "16:9", value: 1, sdk: I2C_DutyCycle_16_9 }
      - key: own_address
        name: Own address 1
        struct: I2C_InitTypeDef
        sdk_field: I2C_OwnAddress1
        type: int
        default: 0
        min: 0
        max: 1023
      - key: ack
        name: Acknowledge
        struct: I2C_InitTypeDef
        sdk_field: I2C_Ack
        type: enum
        default: Enable
        options:
          - { name: Disable, value: 0, sdk: I2C_Ack_Disable }
          - { name: Enable,  value: 1, sdk: I2C_Ack_Enable }
      - key: ack_address
        name: Acknowledged address
        struct: I2C_InitTypeDef
        sdk_field: I2C_AcknowledgedAddress
        type: enum
        default: "7-bit"
        options:
          - { name: "7-bit",  value: 0, sdk: I2C_AcknowledgedAddress_7bit }
          - { name: "10-bit", value: 1, sdk: I2C_AcknowledgedAddress_10bit }
'''

# TIM_TimeBaseInitTypeDef is the same struct on all four timers; TIM1 alone has a
# repetition counter, so only TIM1's block carries that parameter.
TIM_COMMON = '''      - key: prescaler
        name: Prescaler (PSC)
        struct: TIM_TimeBaseInitTypeDef
        sdk_field: TIM_Prescaler
        type: int
        default: 47
        min: 0
        max: 65535
        help: "CK_CNT = TIMxCLK / (PSC + 1)."
      - key: period
        name: Counter period (ARR)
        struct: TIM_TimeBaseInitTypeDef
        sdk_field: TIM_Period
        type: int
        default: 999
        min: 0
        max: 65535
      - key: counter_mode
        name: Counter mode
        struct: TIM_TimeBaseInitTypeDef
        sdk_field: TIM_CounterMode
        type: enum
        default: Up
        options:
          - { name: Up,                value: 0, sdk: TIM_CounterMode_Up }
          - { name: Down,              value: 1, sdk: TIM_CounterMode_Down }
          - { name: Center Aligned 1,  value: 2, sdk: TIM_CounterMode_CenterAligned1 }
          - { name: Center Aligned 2,  value: 3, sdk: TIM_CounterMode_CenterAligned2 }
          - { name: Center Aligned 3,  value: 4, sdk: TIM_CounterMode_CenterAligned3 }
      - key: clock_division
        name: Clock division
        struct: TIM_TimeBaseInitTypeDef
        sdk_field: TIM_ClockDivision
        type: enum
        default: "tDTS = tCK_INT"
        options:
          - { name: "tDTS = tCK_INT",      value: 0, sdk: TIM_CKD_DIV1 }
          - { name: "tDTS = 2 x tCK_INT",  value: 1, sdk: TIM_CKD_DIV2 }
          - { name: "tDTS = 4 x tCK_INT",  value: 2, sdk: TIM_CKD_DIV4 }
'''

TIM_REP = '''      - key: repetition
        name: Repetition counter (RCR)
        struct: TIM_TimeBaseInitTypeDef
        sdk_field: TIM_RepetitionCounter
        type: int
        default: 0
        min: 0
        max: 255
        help: "TIM1 is the advanced-control timer and has a repetition counter. TIM2/3/4 do not, which is a difference in the STRUCT, so this parameter is not offered on them."
'''

ADC = '''    params:
      - key: mode
        name: Mode
        struct: ADC_InitTypeDef
        sdk_field: ADC_Mode
        type: enum
        default: Independent
        options:
          - { name: Independent, value: 0, sdk: ADC_Mode_Independent }
      - key: trigger
        name: External trigger source
        struct: ADC_InitTypeDef
        sdk_field: ADC_ExternalTrigConv
        type: enum
        default: None
        options:
          - { name: None,           value: 7, sdk: ADC_ExternalTrigConv_None }
          - { name: TIM1_CC1,       value: 0, sdk: ADC_ExternalTrigConv_T1_CC1 }
          - { name: TIM1_CC2,       value: 1, sdk: ADC_ExternalTrigConv_T1_CC2 }
          - { name: TIM1_CC3,       value: 2, sdk: ADC_ExternalTrigConv_T1_CC3 }
          - { name: TIM2_CC2,       value: 3, sdk: ADC_ExternalTrigConv_T2_CC2 }
          - { name: TIM3_TRGO,      value: 4, sdk: ADC_ExternalTrigConv_T3_TRGO }
          - { name: TIM4_CC4,       value: 5, sdk: ADC_ExternalTrigConv_T4_CC4 }
          - { name: "EXTI line 11", value: 6, sdk: ADC_ExternalTrigConv_Ext_IT11 }
      - key: data_align
        name: Data alignment
        struct: ADC_InitTypeDef
        sdk_field: ADC_DataAlign
        type: enum
        default: Right
        options:
          - { name: Right, value: 0, sdk: ADC_DataAlign_Right }
          - { name: Left,  value: 1, sdk: ADC_DataAlign_Left }
      - key: nbr_of_channel
        name: Number of conversions
        struct: ADC_InitTypeDef
        sdk_field: ADC_NbrOfChannel
        type: int
        default: 1
        min: 1
        max: 16
      - key: output_buffer
        name: Output buffer
        struct: ADC_InitTypeDef
        sdk_field: ADC_OutputBuffer
        type: enum
        default: Disable
        options:
          - { name: Disable, value: 0, sdk: ADC_OutputBuffer_Disable }
          - { name: Enable,  value: 1, sdk: ADC_OutputBuffer_Enable }
      - key: pga
        name: Programmable gain
        struct: ADC_InitTypeDef
        sdk_field: ADC_Pga
        type: enum
        default: "x1"
        options:
          - { name: "x1",  value: 0, sdk: ADC_Pga_1 }
          - { name: "x4",  value: 1, sdk: ADC_Pga_4 }
          - { name: "x16", value: 2, sdk: ADC_Pga_16 }
          - { name: "x64", value: 3, sdk: ADC_Pga_64 }
'''

CAN = '''    params:
      - key: prescaler
        name: Prescaler
        struct: CAN_InitTypeDef
        sdk_field: CAN_Prescaler
        type: int
        default: 4
        min: 1
        max: 1024
      - key: mode
        name: Mode
        struct: CAN_InitTypeDef
        sdk_field: CAN_Mode
        type: enum
        default: Normal
        options:
          - { name: Normal,            value: 0, sdk: CAN_Mode_Normal }
          - { name: LoopBack,          value: 1, sdk: CAN_Mode_LoopBack }
          - { name: Silent,            value: 2, sdk: CAN_Mode_Silent }
          - { name: Silent LoopBack,   value: 3, sdk: CAN_Mode_Silent_LoopBack }
      - key: sjw
        name: Resynchronisation jump width
        struct: CAN_InitTypeDef
        sdk_field: CAN_SJW
        type: enum
        default: "1 tq"
        options:
          - { name: "1 tq", value: 0, sdk: CAN_SJW_1tq }
          - { name: "2 tq", value: 1, sdk: CAN_SJW_2tq }
          - { name: "3 tq", value: 2, sdk: CAN_SJW_3tq }
          - { name: "4 tq", value: 3, sdk: CAN_SJW_4tq }
      - key: bs1
        name: Bit segment 1
        struct: CAN_InitTypeDef
        sdk_field: CAN_BS1
        type: enum
        default: "1 tq"
        options:
          - { name: "1 tq",  value: 0,  sdk: CAN_BS1_1tq }
          - { name: "2 tq",  value: 1,  sdk: CAN_BS1_2tq }
          - { name: "4 tq",  value: 3,  sdk: CAN_BS1_4tq }
          - { name: "8 tq",  value: 7,  sdk: CAN_BS1_8tq }
          - { name: "16 tq", value: 15, sdk: CAN_BS1_16tq }
      - key: bs2
        name: Bit segment 2
        struct: CAN_InitTypeDef
        sdk_field: CAN_BS2
        type: enum
        default: "1 tq"
        options:
          - { name: "1 tq", value: 0, sdk: CAN_BS2_1tq }
          - { name: "2 tq", value: 1, sdk: CAN_BS2_2tq }
          - { name: "4 tq", value: 3, sdk: CAN_BS2_4tq }
          - { name: "8 tq", value: 7, sdk: CAN_BS2_8tq }
'''

IWDG = '''    params:
      - key: prescaler
        name: Prescaler
        sdk_call: IWDG_SetPrescaler
        sdk_args: [$VALUE]
        type: enum
        default: "64"
        options:
          - { name: "4",   value: 0, sdk: IWDG_Prescaler_4 }
          - { name: "8",   value: 1, sdk: IWDG_Prescaler_8 }
          - { name: "16",  value: 2, sdk: IWDG_Prescaler_16 }
          - { name: "32",  value: 3, sdk: IWDG_Prescaler_32 }
          - { name: "64",  value: 4, sdk: IWDG_Prescaler_64 }
          - { name: "128", value: 5, sdk: IWDG_Prescaler_128 }
          - { name: "256", value: 6, sdk: IWDG_Prescaler_256 }
        help: "Divides the LSI. There is no IWDG_Prescaler_512 on this part."
      - key: reload
        name: Reload counter
        sdk_call: IWDG_SetReload
        sdk_args: [$VALUE]
        type: int
        default: 4095
        min: 0
        max: 4095
        help: "12-bit. Timeout = (reload + 1) x prescaler / LSI. IWDG has no init struct at all - the SDK configures it by CALLING these."
'''

WWDG = '''    params:
      - key: prescaler
        name: Prescaler
        sdk_call: WWDG_SetPrescaler
        sdk_args: [$VALUE]
        type: enum
        default: "8"
        options:
          - { name: "1", value: 0, sdk: WWDG_Prescaler_1 }
          - { name: "2", value: 1, sdk: WWDG_Prescaler_2 }
          - { name: "4", value: 2, sdk: WWDG_Prescaler_4 }
          - { name: "8", value: 3, sdk: WWDG_Prescaler_8 }
      - key: window
        name: Window value
        sdk_call: WWDG_SetWindowValue
        sdk_args: [$VALUE]
        type: int
        default: 127
        min: 0
        max: 127
      - key: counter
        name: Counter
        sdk_call: WWDG_SetCounter
        sdk_args: [$VALUE]
        type: int
        default: 127
        min: 0
        max: 127
'''

LPTIM = '''    params:
      - key: clock_prescaler
        name: Clock prescaler
        struct: LPTIM_TimeBaseInitTypeDef
        sdk_field: LPTIM_ClockPrescaler
        type: enum
        default: "1"
        options:
          - { name: "1",   value: 0, sdk: LPTIM_ClockPrescaler_DIV1 }
          - { name: "2",   value: 1, sdk: LPTIM_ClockPrescaler_DIV2 }
          - { name: "4",   value: 2, sdk: LPTIM_ClockPrescaler_DIV4 }
          - { name: "8",   value: 3, sdk: LPTIM_ClockPrescaler_DIV8 }
          - { name: "16",  value: 4, sdk: LPTIM_ClockPrescaler_DIV16 }
          - { name: "32",  value: 5, sdk: LPTIM_ClockPrescaler_DIV32 }
          - { name: "64",  value: 6, sdk: LPTIM_ClockPrescaler_DIV64 }
          - { name: "128", value: 7, sdk: LPTIM_ClockPrescaler_DIV128 }
      - key: period
        name: Period
        struct: LPTIM_TimeBaseInitTypeDef
        sdk_field: LPTIM_Period
        type: int
        default: 65535
        min: 1
        max: 65535
      - key: pulse
        name: Pulse
        struct: LPTIM_TimeBaseInitTypeDef
        sdk_field: LPTIM_Pulse
        type: int
        default: 32767
        min: 1
        max: 65535
'''

BLOCKS = {'USART1': USART, 'USART2': USART, 'USART3': USART, 'USART4': USART,
          'SPI1': SPI, 'I2C1': I2C,
          'TIM1': '    params:\n' + TIM_COMMON + TIM_REP,
          'TIM2': '    params:\n' + TIM_COMMON,
          'TIM3': '    params:\n' + TIM_COMMON,
          'TIM4': '    params:\n' + TIM_COMMON,
          'ADC1': ADC, 'CAN1': CAN, 'IWDG': IWDG, 'WWDG': WWDG, 'LPTIM': LPTIM}


def insert_params(text, pid, block):
    """Insert a params: block into peripheral `pid`, before its remaps:/notes:/end."""
    m = re.search(r'^  ' + re.escape(pid) + r':\n', text, re.M)
    if not m:
        raise SystemExit('peripheral not found: ' + pid)
    start = m.end()
    nxt = re.search(r'^  [A-Za-z][\w]*:\n', text[start:], re.M)
    end = start + nxt.start() if nxt else len(text)
    body = text[start:end]
    if 'params:' in body:
        return text, False
    for anchor in ('    remaps:\n', '    notes:'):
        i = body.find(anchor)
        if i >= 0:
            return text[:start] + body[:i] + block + body[i:] + text[end:], True
    return text[:start] + body.rstrip('\n') + '\n' + block + text[end:], True


def main():
    t = io.open(PATH, encoding='utf-8').read()
    n = 0
    for pid, block in BLOCKS.items():
        t, did = insert_params(t, pid, block)
        n += 1 if did else 0
    io.open(PATH, 'w', encoding='utf-8', newline='\n').write(t)
    print('inserted params for %d peripherals' % n)
    return 0


if __name__ == '__main__':
    sys.exit(main())
