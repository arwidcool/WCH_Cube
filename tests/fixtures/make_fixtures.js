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

      // Manual GPIO on three ports INCLUDING PE, which is past the A..D range every
      // pin regex in this repo used to assume. PE0 is here on purpose.
      eng.assignSignal('PC0', { gpio: 'GPIO_Output' });
      eng.assignSignal('PC1', { gpio: 'GPIO_Input' });
      eng.assignSignal('PE0', { gpio: 'GPIO_Output' });
      eng.setGpioField('PC0', 'label', 'LED');
      eng.setGpioField('PC0', 'speed', 'Very high');  // four speeds on this part, not one
    },
  },
];

/** Build one fixture and return its serialised .wchproj text. */
export function render(f) {
  eng.loadMcu(eng.MCU_FILES[f.mcu]);
  eng.setPackage(f.pkg);
  eng.setProject({ name: f.name, variant: null });
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
