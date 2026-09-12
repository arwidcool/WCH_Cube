// =============================================================================
//  glossary.js — what a peripheral's name MEANS, and what that kind of block does.
//
//  The tree shows `USART1`, `SDIO`, `GPHA`, and three letters of abbreviation are not
//  a description. This module answers the two questions a user asks on hover and on
//  select: what does the name stand for, and what is that kind of block for.
//
//  WHY THIS IS IN THE ENGINE AND NOT IN THE MCU FILES. The same argument that put
//  `PIN_KIND` in app/template.html and the GPIO mode lists in constraints.js: an
//  acronym's expansion is VOCABULARY, not a hardware fact about a part. "SPI =
//  serial peripheral interface" is one sentence in every part's file if it lives in
//  the files, and six copies of a sentence is six places for a typo. What IS a fact
//  about the part - how many controllers it has, what rates it reaches, which pads it
//  reaches them on - stays in the MCU file, in `notes:`, and is shown under this.
//
//  The boundary is enforced rather than asserted: **the MCU file overrides this**.
//  A peripheral carrying `title:` or `desc:` uses those instead, so the day a part
//  needs to say something different, or a block this file has never heard of appears,
//  it is a DATA change and not an engine change. An unknown peripheral gets NO title
//  and NO description rather than a guess - the same rule as `modeMacro()` and
//  `structVar()`. `app/tests/glossary.test.js` holds both halves of that line.
//
//  WHAT THE ENTRIES ARE TRACEABLE TO, per part, from the datasheet's own feature list:
//    CH32H417DS0.md 1.2 (p.5-8)  - the block-by-block feature list, which names every
//      one of these: `Programmable protocol I/O controller PIOC` (:94), `Graphics
//      Processing Hardware Accelerator GPHA` (:161), `ECDC encryption module ... AES128/
//      192/256 ... SM4` (:171), `500MBytes universal high-speed interface UHSIF` (:12),
//      `SDIO master/slave interface: support SD/SDIO/MMC port` (:91), `200MHz SD/EMMC
//      controller` (:84), `1-wire protocol main interface SWPMI` (:93), `SerDes
//      high-speed isolated transceiver` (:11), `Digital Filter for ΣΔ Modulator DFSDM`
//      (:158), `Serial Audio Interface SAI` (:159), `LCD-TFT Display Controller LTDC`
//      (:160), `Flexible Memory Controller FMC: Support FSMC interface and SDRAM` (:162).
//    The blocks every part here has (GPIO, RCC, EXTI, DMA, USART, SPI, I2C, ADC, TIM,
//      IWDG, WWDG, CRC, PWR, FLASH, RTC, ...) are named in every one of the six
//      datasheets' feature lists and described in the reference manual; the sentence
//      here is the universal one, and the part's own `notes:` refines it.
//
//  Nothing here is a claim about a number of instances, a rate or a pad.
// =============================================================================

/**
 * `{ title, what }` per peripheral, keyed by the peripheral's own name OR by the name
 * with its instance number stripped (`USART3` looks up `USART`). An exact key wins, so
 * `TIM1` can be the advanced-control timer while `TIM` stays the general sentence.
 */
export const PERIPHERAL_VOCAB = {
  // ---- the two virtual tree entries, which are not peripherals in `M.peripherals`
  GPIO: {
    title: 'General-purpose input/output',
    what: 'The port pins themselves. Each one can be an input, an output, an analog '
      + 'input, or carry a peripheral signal — and on a pin that several peripherals '
      + 'can reach, only one of them gets it.',
  },
  NVIC: {
    title: 'Vectored interrupt controller',
    what: 'Gives every interrupt a handler and a priority. On this core the controller '
      + 'is WCH\'s PFIC, which gives each vector one byte of priority and nests two deep.',
  },

  // ---- system
  SYS: {
    title: 'System configuration',
    what: 'The debug interface and the reset pin: which debug protocol is enabled, and '
      + 'whether the reset pin is the reset pin or a GPIO. Both are option-byte state '
      + 'rather than a peripheral.',
  },
  RCC: {
    title: 'Reset and clock control',
    what: 'The clock tree: which oscillator drives the system, the PLL and its '
      + 'multiplier, and the prescalers for each bus.',
  },
  PWR: {
    title: 'Power control',
    what: 'The voltage detector, the low-power modes and which events can wake the part '
      + 'from them. It also owns the supply domains, listed as Supplies.',
  },
  FLASH: {
    title: 'Flash memory controller',
    what: 'The program memory: the wait states that let the bus run faster than the '
      + 'flash, and the option bytes that decide the watchdog and reset behaviour.',
  },
  EXTI: {
    title: 'External interrupt/event controller',
    what: 'Routes a pin edge to an interrupt line. It is separate from the peripheral '
      + 'that owns the pin, so one pin can raise an interrupt without the peripheral '
      + 'being configured.',
  },
  DMA: {
    title: 'Direct memory access controller',
    what: 'Moves data between memory and a peripheral without the CPU. A channel is '
      + 'bound to one request and cannot serve two at once.',
  },
  RTC: {
    title: 'Real-time clock',
    what: 'A counter clocked from a 32.768 kHz source, with an alarm and a calendar. It '
      + 'runs from the backup supply, so it keeps time while the part is off.',
  },
  IWDG: {
    title: 'Independent watchdog',
    what: 'A counter on its own clock source. If the software fails to reload it in '
      + 'time, it resets the part — so a hung program recovers instead of staying hung.',
  },
  WWDG: {
    title: 'Window watchdog',
    what: 'Like the independent watchdog, but it also resets if it is reloaded TOO '
      + 'EARLY, which catches a loop that has stopped making progress.',
  },
  CRC: {
    title: 'Cyclic redundancy check unit',
    what: 'Computes a CRC over a block of data in hardware, and can carry its result '
      + 'forward — a bit-by-bit loop in software is much slower.',
  },
  RNG: {
    title: 'Random number generator',
    what: 'Produces random numbers from an analog entropy source, for keys and nonces '
      + 'rather than for anything repeatable.',
  },
  EXTEN: {
    title: 'Extended control',
    what: 'A few extra controls outside the clock unit, the most useful being the '
      + 'lock-up reset: with it enabled, a CPU lock-up resets the chip instead of '
      + 'leaving it stopped.',
  },
  DBGMCU: {
    title: 'Debug configuration',
    what: 'Decides what keeps running while the core is halted at a breakpoint — the '
      + 'watchdogs, the timers, and the low-power modes.',
  },
  HSEM: {
    title: 'Hardware semaphore',
    what: 'A set of flags two cores use to take a lock on shared memory without a '
      + 'software protocol.',
  },
  IPC: {
    title: 'Inter-processor communication',
    what: 'The mailbox between the cores: message registers and a way to raise an '
      + 'interrupt on the other one.',
  },

  // ---- timers
  TIM: {
    title: 'Timer',
    what: 'Counts clock edges. That gives delays, PWM output, input capture and output '
      + 'compare — the same counter, arranged differently by its channels.',
  },
  TIM1: {
    title: 'Advanced-control timer',
    what: 'A timer with complementary outputs, dead-time insertion and a break input, '
      + 'which is what a bridge or a motor drive needs so its two sides are never on at '
      + 'once.',
  },
  TIM8: {
    title: 'Advanced-control timer',
    what: 'A timer with complementary outputs, dead-time insertion and a break input, '
      + 'which is what a bridge or a motor drive needs so its two sides are never on at '
      + 'once.',
  },
  LPTIM: {
    title: 'Low-power timer',
    what: 'A timer that keeps counting in Stop mode from a low-power clock, which is how '
      + 'the part can wake itself after a delay without running the main clock.',
  },

  // ---- analog
  ADC: {
    title: 'Analog-to-digital converter',
    what: 'Samples an analog voltage into a number. A channel is a pin, and on most of '
      + 'these parts a scan converts a set of them in sequence.',
  },
  HSADC: {
    title: 'High-speed analog-to-digital converter',
    what: 'A second converter, faster than the main ADC and on its own supply and '
      + 'reference pins, so its accuracy does not depend on the digital rail.',
  },
  DAC: {
    title: 'Digital-to-analog converter',
    what: 'Drives an analog voltage from a number — a setpoint, a waveform, or a bias.',
  },
  OPA: {
    title: 'Operational amplifier',
    what: 'An on-chip op-amp. Its inputs and output come out on pins and the gain '
      + 'network is external, so it is wired as an amplifier, a follower or a filter '
      + 'rather than configured by a register.',
  },
  CMP: {
    title: 'Analog comparator',
    what: 'Compares two analog voltages and gives a digital result, optionally straight '
      + 'out on a pin or into a timer, without converting either of them.',
  },
  TKEY: {
    title: 'Touch-key controller',
    what: 'Measures the capacitance change of an electrode to detect a finger, so a '
      + 'panel can have keys with no moving parts.',
  },
  DFSDM: {
    title: 'Digital filter for sigma-delta modulators',
    what: 'Turns the 1-bit bitstream from an external sigma-delta modulator into a '
      + 'filtered digital value — a cheap way to get a high-resolution measurement.',
  },
  PIOC: {
    title: 'Programmable protocol I/O controller',
    what: 'A small logic block that drives or samples pins without the CPU, supporting '
      + 'several 1-wire and 2-wire protocols. (CH32H417DS0.md:94)',
  },

  // ---- connectivity
  USART: {
    title: 'Universal synchronous/asynchronous receiver/transmitter',
    what: 'A serial port: the asynchronous framing of a UART, plus a clock line when it '
      + 'runs synchronously. It also carries LIN, SmartCard and IrDA framing.',
  },
  SPI: {
    title: 'Serial peripheral interface',
    what: 'A synchronous four-wire bus — clock, two data lines and a select — for '
      + 'flash, displays and sensors. The master drives the clock.',
  },
  QSPI: {
    title: 'Quad serial peripheral interface',
    what: 'SPI with four data lines instead of one, which is the interface most serial '
      + 'flash and PSRAM parts use to reach their rated speed.',
  },
  I2C: {
    title: 'Inter-integrated circuit',
    what: 'A two-wire bus (clock and data) with addressing on the bus itself, for '
      + 'sensors, memory and port expanders.',
  },
  I3C: {
    title: 'Improved inter-integrated circuit',
    what: 'The successor to I2C: faster, with in-band interrupts and dynamic addressing.',
  },
  I2S: {
    title: 'Inter-IC sound',
    what: 'A serial bus for digital audio: a bit clock, a word-select line and one or '
      + 'two data lines.',
  },
  SAI: {
    title: 'Serial audio interface',
    what: 'A flexible audio serial port that can be I2S-compatible or a different '
      + 'framing, as master or slave, with several data lines.',
  },
  CAN: {
    title: 'Controller area network',
    what: 'A differential two-wire bus where every node hears every frame and '
      + 'arbitration decides who transmits — the bus vehicles and machines use.',
  },
  USBFS: {
    title: 'USB 2.0 full-speed controller',
    what: 'A USB 2.0 controller at up to 12 Mbit/s, with a full-speed PHY.',
  },
  USBHS: {
    title: 'USB 2.0 high-speed controller',
    what: 'A USB 2.0 controller at up to 480 Mbit/s, with the high-speed PHY on chip.',
  },
  USBSS: {
    title: 'USB 3.x SuperSpeed controller',
    what: 'A USB 3.x controller with its own high-speed serial lanes rather than the '
      + 'USB 2.0 pair.',
  },
  USBPD: {
    title: 'USB Power Delivery',
    what: 'The Type-C negotiation block. It talks over the CC lines to agree a voltage '
      + 'and a current with the other end, and can be the source, the sink, or either.',
  },
  ETH: {
    title: 'Ethernet media access controller',
    what: 'The MAC — framing, addressing and checksums — with the PHY interface on '
      + 'dedicated pins rather than a GPIO bus.',
  },
  SDIO: {
    title: 'SD input/output interface',
    what: 'An SD bus host: command and data lines to an SD card, an SDIO peripheral or '
      + 'an MMC device. (CH32H417DS0.md:91)',
  },
  SDMMC: {
    title: 'Secure digital / multimedia card controller',
    what: 'The SD and eMMC host controller — the same bus SDIO speaks, at the clock '
      + 'rates eMMC parts need. (CH32H417DS0.md:84)',
  },
  SWPMI: {
    title: 'Single-wire protocol master interface',
    what: 'A single-wire bus with the electrical characteristics of a SIM contact, used '
      + 'to talk to a contactless front-end. (CH32H417DS0.md:93)',
  },
  UHSIF: {
    title: 'Universal high-speed interface',
    what: 'A general-purpose high-speed parallel interface, 500 MBytes/s class, for '
      + 'moving bulk data in and out of the part without loading the core. '
      + '(CH32H417DS0.md:12)',
  },
  SERDES: {
    title: 'Serialiser/deserialiser transceiver',
    what: 'A high-speed serialiser and deserialiser: it turns a parallel word into a '
      + 'differential serial lane, and back, for long or isolated links. '
      + '(CH32H417DS0.md:11)',
  },

  // ---- graphics, memory, security, audio
  DVP: {
    title: 'Digital video port',
    what: 'A parallel camera interface: a pixel clock, horizontal and vertical sync, '
      + 'and a data bus. (CH32H417DS0.md:158)',
  },
  LTDC: {
    title: 'LCD-TFT display controller',
    what: 'Drives a parallel RGB panel, fetching the framebuffer itself and blending '
      + 'layers over each other, so the CPU is not drawing pixels. (CH32H417DS0.md:160)',
  },
  GPHA: {
    title: 'Graphics processing hardware accelerator',
    what: 'A hardware block that draws and blends for the display, so the core is not '
      + 'filling the framebuffer pixel by pixel. (CH32H417DS0.md:161)',
  },
  FMC: {
    title: 'Flexible memory controller',
    what: 'The external memory bus: SRAM, NOR and NAND flash, and SDRAM, which is a '
      + 'different protocol on the same pins. (CH32H417DS0.md:162)',
  },
  ECDC: {
    title: 'ECDC encryption module',
    what: 'A hardware encryption block supporting the AES128/192/256 and SM4 algorithms. '
      + '(CH32H417DS0.md:171)',
  },
  BKP: {
    title: 'Backup registers and tamper',
    what: 'A few bytes of RAM in the backup domain that survive Standby and power-off, '
      + 'plus the tamper input that can clear them.',
  },
  AWU: {
    title: 'Auto wake-up',
    what: 'A counter that wakes the part from Standby after a programmable interval, '
      + 'with no CPU clock running in the meantime.',
  },
};

// Which peripheral an id belongs to, for a lookup that has to survive an instance
// number. `USART3` -> `USART`, `I2C1` -> `I2C`, `LPTIM2` -> `LPTIM`. A trailing run of
// digits is the INSTANCE: `USBFS` has none and is looked up as itself, and `TIM10` is
// still a `TIM`. The regex is anchored and the prefix must be non-empty, so an id that
// is nothing but digits cannot produce an empty base.
const instanceOf = id => {
  const m = /^([A-Za-z][A-Za-z0-9_]*?)(\d+)$/.exec(String(id));
  return m ? { base: m[1], instance: m[2] } : { base: String(id), instance: '' };
};

/**
 * What a peripheral's name means: `{ title, what, base, instance, source }`.
 *
 * `title` is the expansion of the name, `what` is what that kind of block does, and
 * `source` says WHERE the answer came from — `'mcu'` when the MCU file overrode it,
 * `'glossary'` when it is vocabulary, `''` when nothing knows. An id nobody knows gets
 * empty strings rather than a guess, and the UI then shows the bare name, which is
 * what it showed before this module existed.
 */
export function peripheralName(M, pid) {
  const P = (M && M.peripherals && M.peripherals[pid]) || null;
  const { base, instance } = instanceOf(pid);
  // The data wins, and each half is checked separately: a part may have its own name for
  // a block and nothing to add to the description, or the reverse.
  const dataTitle = P && typeof P.title === 'string' ? P.title.trim() : '';
  const dataWhat = P && typeof P.desc === 'string' ? P.desc.trim() : '';
  const hit = PERIPHERAL_VOCAB[pid] || PERIPHERAL_VOCAB[base] || null;
  const title = dataTitle || (hit ? hit.title : '');
  const what = dataWhat || (hit ? hit.what : '');
  if (!title && !what) return { title: '', what: '', base, instance, source: '' };
  return {
    title, what, base, instance,
    source: dataTitle || dataWhat ? (hit ? 'mcu+glossary' : 'mcu') : 'glossary',
  };
}

/**
 * The one line a hover tooltip shows: `USART3 — universal synchronous/asynchronous
 * receiver/transmitter`. Falls back to the bare id when nothing knows it, so a caller
 * can put this in a `title=` attribute unconditionally.
 */
export function peripheralLabel(M, pid) {
  const n = peripheralName(M, pid);
  return n.title ? `${pid} — ${n.title}` : String(pid);
}

/**
 * Every peripheral id the glossary cannot name, for the Tools tab's gap list. This is
 * the honest half of the boundary: an unknown block is not described rather than
 * described wrongly, and this is how it becomes visible instead of silently blank.
 */
export function unnamedPeripherals(M) {
  return Object.keys((M && M.peripherals) || {})
    .filter(pid => !peripheralName(M, pid).title)
    .sort();
}
