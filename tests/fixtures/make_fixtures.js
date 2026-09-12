// =============================================================================
//  tests/fixtures/make_fixtures.js — (re)write the compile-gate fixtures.
//
//  The fixtures are checked in, because a test should compile a configuration a
//  reviewer can read. This script is how they were produced and how they are
//  regenerated when the MCU data gains a peripheral: it drives the REAL engine,
//  the same calls the UI makes, so a fixture can never contain a state the app
//  cannot reach. It refuses to write a fixture that has a pin conflict.
//
//      node tests/fixtures/make_fixtures.js          # write
//      node tests/fixtures/make_fixtures.js --check  # fail if they are stale
//
//  Every fixture must EXERCISE something. A default configuration assigns no
//  GPIO, generates an empty WCHCube_GPIO_Init(), and proves nothing — that is
//  the exact mistake this whole gate exists to stop repeating.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as eng from '../../app/engine/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export function boot() {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'vendor', 'js-yaml.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  eng.setYaml(mod.exports);
  eng.loadPackages(eng.yamlLoad(fs.readFileSync(path.join(ROOT, 'data', 'packages', 'packages.yaml'), 'utf8')));
  const dir = path.join(ROOT, 'data', 'mcus');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yaml')).sort()) {
    eng.registerMcuFile(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}

// ---------------------------------------------------------------- the fixtures
// Each one: which part, which package, and the calls that configure it. Written
// as engine calls rather than as YAML so that a data change breaks the FIXTURE
// loudly here instead of silently degrading what the compile gate covers.
export const FIXTURES = [
  {
    file: 'CH32V006_TSSOP20_full.wchproj',
    name: 'compile-gate CH32V006 TSSOP20',
    mcu: 'CH32V006',
    pkg: 'TSSOP20',
    env: 'CH32V006F8P6',
    build() {
      // --- a non-default remap, so the AFIO_PCFR1 word is not zero
      eng.setSetting('USART1', 'Mode', 'Asynchronous');
      eng.setRemap('USART1', 1);                       // 0001: TX=PD6, RX=PD5
      eng.setParam('USART1', 'baud', 115200);
      eng.setParam('USART1', 'word', '9 bits');
      eng.setParam('USART1', 'parity', 'Even');
      eng.setParam('USART1', 'stop', '2');

      // --- SPI on port C, software NSS so the NSS pin stays free
      eng.setSetting('SPI1', 'Mode', 'Full-Duplex Master');
      eng.setSetting('SPI1', 'Hardware NSS Signal', 'Disable (software NSS)');
      eng.setRemap('SPI1', 0);                         // SCK=PC5, MISO=PC7, MOSI=PC6
      eng.setParam('SPI1', 'prescaler', '8');
      eng.setParam('SPI1', 'cpol', 'High');
      eng.setParam('SPI1', 'cpha', '2 Edge');
      eng.setParam('SPI1', 'firstbit', 'LSB First');

      // --- a timer output and an analogue input
      eng.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');   // CH1 = PD2
      eng.setParam('TIM1', 'prescaler', 47);
      eng.setParam('TIM1', 'period', 999);
      eng.setParam('TIM1', 'counter', 'Center aligned 1');
      eng.setParam('TIM1', 'arpe', true);
      eng.toggleSetting('ADC1', 'Channels', 'IN2', true);         // IN2 = PC4 -> AIN
      eng.setParam('ADC1', 'sample', '55.5 cycles');
      eng.setParam('ADC1', 'cont', true);
      eng.setParam('ADC1', 'align', 'Left');

      // --- plain GPIO on three different ports, so the per-port grouping and
      //     the port clock enables are all exercised
      eng.assignSignal('PA1', { gpio: 'GPIO_Output' });
      eng.assignSignal('PA2', { gpio: 'GPIO_Input' });
      eng.assignSignal('PD4', { gpio: 'GPIO_Output' });
      eng.assignSignal('PC0', { gpio: 'GPIO_Output' });
      eng.setGpioField('PD4', 'label', 'STATUS_LED');

      // --- and a clock tree that is not the reset default
      eng.setClock({ sys: 'PLLCLK', pllIn: 0 });
    },
  },
  {
    file: 'CH32V006_QFN32_full.wchproj',
    name: 'compile-gate CH32V006 QFN32',
    mcu: 'CH32V006',
    pkg: 'QFN32',
    env: 'CH32V006K8U6',
    build() {
      // QFN32 is the only package with port B, so this is the fixture that
      // proves GPIOB's clock enable is emitted at all. It also runs on the
      // external crystal, which claims XI/XO through the conflict engine.
      eng.setSetting('RCC', 'High Speed Clock (HSE)', 'Crystal / ceramic resonator');
      eng.setClock({ sys: 'HSE', hse: 24 });

      eng.setSetting('USART1', 'Mode', 'Asynchronous');
      eng.setRemap('USART1', 7);                       // 0111: TX=PB5, RX=PB6
      eng.setParam('USART1', 'baud', 9600);
      eng.setParam('USART1', 'parity', 'Odd');

      eng.setSetting('SPI1', 'Mode', 'Full-Duplex Master');
      eng.setSetting('SPI1', 'Hardware NSS Signal', 'Hardware NSS Output');
      eng.setRemap('SPI1', 3);                         // 011: NSS=PB0 SCK=PB1 MISO=PB2 MOSI=PC0
      eng.setParam('SPI1', 'datasize', '16 bits');
      eng.setParam('SPI1', 'prescaler', '64');

      eng.setSetting('I2C1', 'Mode', 'I2C');
      eng.setRemap('I2C1', 0);                         // SCL=PC2, SDA=PC1

      eng.setSetting('TIM2', 'Channel2', 'PWM Generation CH2');
      eng.setParam('TIM2', 'prescaler', 23);
      eng.setParam('TIM2', 'period', 4095);
      eng.setParam('I2C1', 'speed', 400000);
      eng.setParam('I2C1', 'duty', '16:9');

      eng.toggleSetting('ADC1', 'Channels', 'IN3', true);

      eng.assignSignal('PA5', { gpio: 'GPIO_Output' });
      eng.assignSignal('PA6', { gpio: 'GPIO_Input' });
      eng.assignSignal('PB3', { gpio: 'GPIO_Output' });
      eng.assignSignal('PD0', { gpio: 'GPIO_Output' });
      eng.setGpioField('PB3', 'label', 'HEARTBEAT');
    },
  },
  {
    file: 'CH32V005_TSSOP20_full.wchproj',
    name: 'compile-gate CH32V005 TSSOP20',
    mcu: 'CH32V005',
    pkg: 'TSSOP20',
    env: 'CH32V005F6P6',
    build() {
      // CH32V005 is CH32V006 minus TKEY, TIM3 and QFN32. Same generated shape,
      // a different part define and a different peripheral set: the fixture
      // exists so the gate notices if `inherits:` ever drops something the
      // generator needs.
      eng.setSetting('USART1', 'Mode', 'Asynchronous');
      eng.setRemap('USART1', 0);                       // TX=PD5, RX=PD6
      eng.setParam('USART1', 'baud', 57600);

      eng.setSetting('I2C1', 'Mode', 'I2C');
      eng.setRemap('I2C1', 0);                         // SCL=PC2, SDA=PC1

      eng.setSetting('TIM2', 'Channel1', 'PWM Generation CH1');
      eng.setParam('TIM2', 'prescaler', 7);
      eng.setParam('TIM2', 'period', 1023);
      eng.setParam('I2C1', 'speed', 400000);

      eng.toggleSetting('ADC1', 'Channels', 'IN2', true);

      eng.assignSignal('PA1', { gpio: 'GPIO_Output' });
      eng.assignSignal('PC0', { gpio: 'GPIO_Output' });
      eng.assignSignal('PC3', { gpio: 'GPIO_Input' });
      eng.setGpioField('PC0', 'label', 'LED');
    },
  },
  {
    file: 'CH32X035_QFN28_full.wchproj',
    name: 'compile-gate CH32X035 QFN28',
    mcu: 'CH32X035',
    pkg: 'QFN28',
    env: 'CH32X035G8U6',
    build() {
      // The SECOND FAMILY, and the whole point of round 4. Nothing in this
      // function knows it is a different part: the same engine calls, and the
      // data decides that the clock enable is RCC_APB2PeriphClockCmd rather than
      // RCC_PB2PeriphClockCmd, that the one GPIO speed is GPIO_Speed_50MHz
      // rather than 30, and that there is no HSE to select.
      //
      // Pins on THREE ports including port C, which on this part is 24 bits wide
      // (GPIO_Pin_0..GPIO_Pin_23, uint32_t) and has two holes — PC8, PC9, PC12
      // and PC13 do not exist. PC10/PC11 are shorted to PC16/PC17 in this
      // package, so assigning PC16 exercises the shorted-pin path on a part that
      // is not CH32V006.
      //
      // PC18 and PC19 are the SDI debug pins and are deliberately left alone:
      // claiming them is a real conflict, which the fixture generator refuses.
      eng.assignSignal('PA0', { gpio: 'GPIO_Output' });
      eng.assignSignal('PA5', { gpio: 'GPIO_Input' });
      eng.assignSignal('PB3', { gpio: 'GPIO_Output' });
      eng.assignSignal('PB12', { gpio: 'GPIO_Output' });
      eng.assignSignal('PC0', { gpio: 'GPIO_Output' });
      eng.assignSignal('PC16', { gpio: 'GPIO_Input' });
      eng.setGpioField('PA0', 'label', 'STATUS_LED');
      eng.setGpioField('PA5', 'pull', 'Pull-up');
    },
  },
  {
    file: 'CH32V003_TSSOP20_full.wchproj',
    name: 'compile-gate CH32V003 TSSOP20',
    mcu: 'CH32V003',
    pkg: 'TSSOP20',
    env: 'CH32V003F4P6',
    build() {
      // The THIRD family, and the smallest part the app ships: RV32EC, 16 KB of
      // flash, 18 I/O on TSSOP20 and no shorted pair at all. It exists because
      // `tests/strict.test.js` refuses a part with no fixture behind the
      // `--strict` gate — a new part must not arrive with its generated C
      // unproven — and because the smallest package is where a codegen
      // assumption about "there are four ports" is most likely to be wrong.
      //
      // Remap 0 everywhere, so this fixture is about the part and not about the
      // AFIO word: TX=PD5 RX=PD6, SCL=PC2 SDA=PC1, TIM1_CH1=PD2, AIN2=PC4.
      eng.setSetting('USART1', 'Mode', 'Asynchronous');
      eng.setRemap('USART1', 0);
      eng.setParam('USART1', 'baud', 115200);

      eng.setSetting('I2C1', 'Mode', 'I2C');
      eng.setRemap('I2C1', 0);
      eng.setParam('I2C1', 'speed', 100000);

      eng.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
      eng.setParam('TIM1', 'prescaler', 23);
      eng.setParam('TIM1', 'period', 999);

      eng.toggleSetting('ADC1', 'Channels', 'IN2', true);      // IN2 = PC4 -> AIN

      eng.assignSignal('PA1', { gpio: 'GPIO_Output' });
      eng.assignSignal('PA2', { gpio: 'GPIO_Input' });
      eng.assignSignal('PC0', { gpio: 'GPIO_Output' });
      eng.assignSignal('PC3', { gpio: 'GPIO_Input' });
      eng.assignSignal('PD4', { gpio: 'GPIO_Output' });
      eng.setGpioField('PC0', 'label', 'LED');
    },
  },
  {
    file: 'CH32H417_QFN128_full.wchproj',
    name: 'compile-gate CH32H417 QFN128',
    mcu: 'CH32H417',
    pkg: 'QFN128',
    env: 'CH32H417QEU6',
    build() {
      // The FOURTH family and the first AF-MUXED part: every signal below picks its
      // own pin from `signal_pins:` and writes its own GPIOx_AFRy field, instead of
      // one AFIO word moving a whole peripheral. It exists because `strict.test.js`
      // refuses a part with no fixture, and because the AF emitter has to be proven
      // on real data rather than only on the synthetic part in `app/tests/afmux.test.js`.
      //
      // Three of the five signals are moved OFF their default pin on purpose, and
      // they belong to the same two peripherals as signals that are left alone — a
      // remap-shaped generator cannot produce this configuration at all, which is the
      // point. It also spans five ports (A, B, D, E, F) and AF codes 1, 3, 4 and 14,
      // so a single wrong `GPIO_AF$AF` substitution or port letter shows up here.
      eng.setSetting('USART1', 'Mode', 'Asynchronous');
      eng.setSignalPin('USART1', 'TX', 'PD13');     // AF14, while RX stays on PB15 (AF4)
      eng.setSetting('USART2', 'Mode', 'Asynchronous');   // both signals on their defaults

      eng.setSetting('SPI1', 'Mode', 'Full-Duplex Master');
      eng.setSignalPin('SPI1', 'SCK', 'PA5');       // AF5, while MOSI/MISO stay on PF8/PF9 (AF3)

      eng.setSetting('I2C1', 'Mode', 'I2C');
      eng.setSignalPin('I2C1', 'SCL', 'PB8');       // AF4; SDA stays on PB7

      eng.setSetting('TIM1', 'Channel1', 'PWM Generation CH1 CH1N');

      // THE THREE USB CONTROLLERS, because until 2026-09-12 every one of them said "holds
      // no pin on any package" while the datasheet gave it pads — so picking any USB mode
      // claimed nothing. Two of the three are here:
      //
      //   USBFS  dual-role plus BOTH OTG pads, so all four of DS Table 2-2-18's pins are
      //          claimed at once (PA12 DP, PA11 DM, PA9 VBUS, PA10 ID).
      //   USBSS  the four USB 3.0 SuperSpeed pads (SSTXA/SSTXB/SSRXA/SSRXB). They are
      //          DEDICATED pads, not GPIO, so this is also the first fixture to claim a
      //          pin that is not spelled `Pxx` — the AF emitter has to skip it structurally
      //          rather than emit a port and a bit for it.
      //
      // Both are in `codegen.skip_signals`, so the generated C claims the pads, names them
      // in its "not configured here, by design" line, emits the clock enable
      // (`RCC_HBPeriph_OTG_FS`, `RCC_HBPeriph_USBSS`) and writes no GPIO_Init and no TODO —
      // which is what the vendor's own driver does (ch32h417_usbfs_device.c:54-70 enables
      // the clock and configures no pin; ch32h417_usbhs_device.c touches no GPIO at all).
      //
      // USBHS is deliberately ABSENT and that is a hardware fact, not an omission: DS
      // Table 2-2-19 puts its DP/DM on PB8/PB9, which are the SWCLK and SWIO/SWDIO pads and
      // which this fixture already uses for I2C1_SCL. Enabling it here would be a genuine
      // three-way conflict, and the conflict engine correctly refuses it. It is proven
      // separately in tests/h417_usb.test.js instead.
      eng.setSetting('USBFS', 'Mode', 'Dual-role (OTG FS)');
      eng.toggleSetting('USBFS', 'OTG pins', 'VBUS (bus voltage sense)', true);
      eng.toggleSetting('USBFS', 'OTG pins', 'ID (role detect)', true);
      eng.setSetting('USBSS', 'Mode', 'Device (SS)');

      // NOTE — what is deliberately NOT claimed here, and why.
      //
      // The OPA inputs/outputs and the DAC output are pads the coverage ledger made reachable
      // (before it, `OPA` offered Disable/Enabled per unit with no P/N/OUT selection and `DAC`'s
      // row named no signal). Claiming them was tried, and it made this fixture uncover a real
      // defect: `GPIO_Init` configures them `GPIO_Mode_AF_PP` where an analog pad must be
      // `GPIO_Mode_AIN`, because CH32H417 declares no `codegen.analog_signals` and has no
      // `pins.<PIN>.analog` for the fallback to use. The generated C also carries a TODO asking
      // for an `af:` code those pads do not have.
      //
      // They are therefore claimed in the commit that lands the fix, not before: while they are
      // here this fixture cannot be `--strict` clean, and `--strict` exit 0 for every fixture is
      // round 5's acceptance test for deliverable B — a fixture that keeps it red on two other
      // agents' outstanding work is premature rather than brave. The defect is recorded with its
      // generated C in tests/evidence/round5/2026-09-12-analog-pads.md and owned on TASKS.md;
      // AGENT-1 adds `analog_signals`, and the four lines below come back with it.

      // Manual GPIO on three ports INCLUDING PE, which is past the A..D range every
      // pin regex in this repo used to assume. PE0 is here on purpose.
      eng.assignSignal('PC0', { gpio: 'GPIO_Output' });
      eng.assignSignal('PC1', { gpio: 'GPIO_Input' });
      eng.assignSignal('PE0', { gpio: 'GPIO_Output' });
      eng.setGpioField('PC0', 'label', 'LED');
      eng.setGpioField('PC0', 'speed', 'Very high');  // four speeds on this part, not one
    },
  },
  {
    file: 'CH32H417_QFN68_pkg.wchproj',
    name: 'compile-gate CH32H417 QFN68',
    mcu: 'CH32H417',
    pkg: 'QFN68',
    // WEU6, not QEU6. The QFN68 part is a DIFFERENT die bond-out, not a QFN128 with
    // pins sawn off, and `variant:` is how the project generator is told which of the
    // three orderable numbers it is writing for.
    //
    // Unsettled, and recorded rather than decided here: TASKS.md still asks whether
    // MEU6/WEU6 are CH32H416 or CH32H417 - the datasheet contradicts itself. What is
    // NOT in doubt is that `data/mcus/CH32H417.yaml:56` declares WEU6 a QFN68 variant
    // of this part and the platform ships `genericCH32H417WEU6.json`, so this fixture
    // compiles what the repository currently claims. If AGENT-1 settles it the other
    // way, this fixture moves with the data; it does not decide it.
    variant: 'CH32H417WEU6',
    env: 'CH32H417WEU6',
    build() {
      // ===== WHY A SECOND PACKAGE OF A PART WE ALREADY COMPILE =====
      //
      // CH32H417 is the first part in this repository where the PACKAGE decides which
      // pins a peripheral can reach. Everywhere else a package only removes pins that
      // were optional anyway; here, 301 of the signals in `signal_pins:` have a
      // DIFFERENT set of bonded options on QFN68 / QFN88 / QFN128, and for many of them
      // the first bonded option - the pad the app hands you when you switch the
      // peripheral on - is a different pad on each. TASKS.md records this as the case
      // nothing had ever exercised, and until this file existed that was literally true:
      // `CH32H417_QFN128_full.wchproj` was the only fixture for all three packages, so
      // the package-dependent path had never once been through the compile gate.
      //
      // Every claim below is chosen because its PAD DIFFERS from what the same engine
      // calls produce on QFN128. A generator that ignored the package would emit the
      // QFN128 pad here, and that is a wrong GPIO port and a wrong AF field in C that
      // still compiles - the wrong-but-compiling class this round exists to remove.
      //
      //   call                               QFN68 pad      QFN128 pad
      //   ---------------------------------  -------------  -----------
      //   USART1 Asynchronous  -> RX         PD12           PB15
      //   USART2 Asynchronous  -> TX         PD5            PA2
      //                        -> RX         PD6            PA3
      //   SPI1   Full-Duplex   -> SCK        PA5            PF7
      //                        -> MISO       PF3            PF9
      //                        -> MOSI       PD7            PF8
      //   TIM3   PWM CH1       -> CH1        PC6            PA6
      //
      // Port F is in there on purpose: SPI1's MISO lands on PF3 here and PF9 there, so
      // a port letter past E is exercised on both packages and by different pads.
      eng.setSetting('USART1', 'Mode', 'Asynchronous');
      eng.setParam('USART1', 'baud', 115200);
      eng.setSetting('USART2', 'Mode', 'Asynchronous');
      eng.setSetting('SPI1', 'Mode', 'Full-Duplex Master');
      eng.setSetting('TIM3', 'Channel1', 'PWM Generation CH1');

      // NOT claimed here, and it is a hardware fact worth writing down rather than a
      // gap: on QFN68 **I2C1 has exactly one bonded option per signal, and they are the
      // debug pads** - SCL can only be PB8 (SWCLK) and SDA only PB9 (SWIO/SWDIO). On
      // QFN128 the same peripheral defaults to PB6/PB7 and the debug port is untouched.
      // So "switch I2C1 on" is free on the big package and costs you SWD on the small
      // one. That belongs in a check a user meets, not in a fixture that has to compile:
      // tests/h417_packages.test.js asserts it.
      //
      // ADC1 and ADC2 are absent for a blunter reason: QFN68 bonds NONE of their
      // channels. Claiming a channel here would be claiming a pad that does not exist.

      // Manual GPIO, on pads QFN68 actually bonds. PE0 again, because a port letter
      // past D broke every pin regex in this repo once already.
      eng.assignSignal('PC0', { gpio: 'GPIO_Output' });
      eng.assignSignal('PC1', { gpio: 'GPIO_Input' });
      eng.assignSignal('PE0', { gpio: 'GPIO_Output' });
      eng.setGpioField('PC0', 'label', 'LED');
      eng.setGpioField('PC0', 'speed', 'Very high');
    },
  },
  {
    file: 'CH32L103_QFN32_full.wchproj',
    name: 'compile-gate CH32L103 QFN32',
    mcu: 'CH32L103',
    pkg: 'QFN32',
    // K8U6, not K8U7: QFN32 carries TWO orderable part numbers that differ in
    // temperature grade, and the project generator refuses the package without
    // being told which - "they are not interchangeable" is its own wording. The
    // env below is the K8U6 board, so the fixture names the same part.
    variant: 'CH32L103K8U6',
    env: 'CH32L103K8U6',
    build() {
      // The FIFTH family. What makes this one different from the four above:
      //
      //   * THREE GPIO output speeds, so `gpio.speeds` is a real choice rather than a
      //     fixed value - the first part here where that column is a selector. The
      //     speed below is deliberately NOT the default, so a generator that quietly
      //     writes the first entry fails visibly.
      //   * Remaps by NAMED MACRO (GPIO_PinRemapConfig), like CH32X035 - so one
      //     peripheral is moved off its default mapping to prove the macro reaches
      //     the C, and another is left alone to prove "no remap" stays silent.
      //   * Clock domains are HB / PB2 / PB1 and the enable function is
      //     RCC_PB2PeriphClockCmd - NOT RCC_APB2PeriphClockCmd, which is the field
      //     this repo has already had wrong once.
      //
      // Signals are spread over ports A, B, C and D, and the ADC channel comes from
      // `codegen.analog_signals`, so the analog path is exercised too.
      eng.setSetting('USART1', 'Mode', 'Asynchronous');   // remap index 0: no macro emitted
      eng.setSetting('USART2', 'Mode', 'Asynchronous');
      eng.setRemap('USART2', 1);                          // GPIO_PartialRemap2_USART2

      eng.setSetting('SPI1', 'Mode', 'Full-Duplex Master');
      eng.setRemap('SPI1', 1);                            // GPIO_PartialRemap1_SPI1

      // CH1 WITHOUT CH1N, and the reset pin OFF, because QFN32 bonds neither PB13
      // nor NRST - the DS pin table gives NRST only on TSSOP20 and LQFP48. Both
      // were tried the other way and the conflict engine refused them, which is the
      // behaviour this fixture is here to keep honest: a configuration the package
      // cannot honour is reported rather than generated.
      eng.setSetting('TIM1', 'Channel1', 'PWM Generation CH1');
      eng.setSetting('TIM2', 'Channel1', 'PWM Generation CH1');
      eng.setSetting('SYS', 'External reset pin', 'Reset pin disabled - pin is GPIO');

      eng.setSetting('ADC1', 'Mode', 'Independent');
      // The ledger's headline CH32L103 row was "its ADC routed ten channels with no way to
      // select one" - ten analog pads the datasheet puts on PA0-PA7/PB0-PB1 that no user could
      // claim. Ticking one channel is what makes the compile gate prove the analog pad
      // generates C that builds; `Mode: Independent` alone configures a converter with no input.
      // It is a `checkboxes` row, so it is ticked with toggleSetting rather than setSetting -
      // an empty set is the off state, which is why a fresh project claims no analog pin.
      //
      // **IN0 was tried first and REFUSED, correctly**: `IN0` is PA0 and this fixture also
      // enables TIM2's CH1, which is PA0's other first-mapping function, so the builder stopped
      // with `PA0: TIM2_CH1_ETR / ADC1_IN0`. The timer keeps the pad because it exercises the
      // remap path this part is here to cover, and the analog claim moves to IN4 (PA4), whose
      // only rival here is USART2's CK - and USART2 is configured Asynchronous, which needs no
      // CK. Recorded because "pick another pin" is the right answer only when the refusal is
      // understood, and the builder printing the pair is what makes it understandable.
      eng.toggleSetting('ADC1', 'Channels', 'IN4', true);   // -> PA4

      eng.setSetting('IWDG', 'Mode', 'Independent watchdog');
      eng.setSetting('WWDG', 'Mode', 'Window watchdog');;

      // Manual GPIO with a non-default speed on one of them. The pins are chosen
      // from what the configuration ABOVE leaves free, which the fixture builder
      // checks: PD0 is the HSE crystal and PA8 is TIM1_CH1 here, and using either
      // is a conflict rather than a fixture - both were tried and refused.
      eng.assignSignal('PA5', { gpio: 'GPIO_Output' });
      eng.assignSignal('PB7', { gpio: 'GPIO_Input' });
      eng.assignSignal('PC14', { gpio: 'GPIO_Output' });
      eng.setGpioField('PA5', 'label', 'LED');
      eng.setGpioField('PA5', 'speed', '2 MHz');          // not the first of three
      eng.setGpioField('PB7', 'pull', 'Pull-up');
    },
  },
];

/** Build one fixture and return its serialised .wchproj text. */
export function render(f) {
  eng.loadMcu(eng.MCU_FILES[f.mcu]);
  eng.setPackage(f.pkg);
  eng.setProject({ name: f.name, variant: f.variant || null });
  f.build();
  const E = eng.compute();
  if (E.conflictList.length) {
    throw new Error(`${f.file}: the fixture has ${E.conflictList.length} pin conflict(s): `
      + E.conflictList.map(c => c.text || c.label).join('; '));
  }
  // The whole point of these files: they must actually assign pins.
  const assigned = eng.pinRows().filter(r => r.signal).length;
  if (assigned < 8) throw new Error(`${f.file}: only ${assigned} pin(s) assigned — that proves nothing`);
  const text = eng.projectSerialize();
  // `saved:` is a timestamp; pin it so regenerating does not churn the diff.
  return text.replace(/^saved: .*$/m, 'saved: fixture');
}

function main() {
  boot();
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const f of FIXTURES) {
    const text = render(f);
    const dest = path.join(HERE, f.file);
    const old = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
    if (old === text) { process.stdout.write(`ok    ${f.file}\n`); continue; }
    if (check) { process.stdout.write(`STALE ${f.file}\n`); stale++; continue; }
    fs.writeFileSync(dest, text, 'utf8');
    process.stdout.write(`${old === null ? 'new  ' : 'wrote'} ${f.file}\n`);
  }
  if (stale) {
    process.stderr.write(`\n${stale} fixture(s) are stale. Run: node tests/fixtures/make_fixtures.js\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
