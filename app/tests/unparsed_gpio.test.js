// `gpioPlan()` used to drop an io-typed pin whose name is not `P<letter><digits>` with
// no note of any kind (`codegen.js` read-through, backlog item 3, manager-assigned).
// Right on all eight shipped parts - every one spells its pins that way - and wrong the
// moment a ninth does not: `WCHCube_GPIO_Init` would come out looking complete with one
// pin simply, silently, missing. The fix named in the backlog itself: "a named TODO,
// not a wider regex" - deriving a port/bit pair from an unfamiliar naming scheme is the
// same class of guess this generator refuses everywhere else.
import { test, assert, fresh, eng } from './_harness.js';

const src = `
mcu:
  name: UNPARSED-GPIO
  family: test
  default_package: QFN8
  variants:
    A8: { package: QFN8, flash_kb: 16, sram_kb: 2, temp: 85, io_count: 2 }
packages:
  QFN8:
    1: PA0
    2: IO5
pins:
  PA0: { type: io }
  IO5: { type: io }
peripherals: {}
codegen:
  header: unparsed.h
  sdk: { synthetic: true }
  gpio_clock: { fn: RCC_PB2PeriphClockCmd, port: RCC_PB2Periph_GPIO$PORT }
gpio:
  modes:
    - { name: Output Push Pull, macro: GPIO_Mode_Out_PP }
  input_modes:
    - { name: No pull, macro: GPIO_Mode_IN_FLOATING }
  speeds:
    - { name: 50 MHz, macro: GPIO_Speed_50MHz }
`;

const load = () => { fresh('CH32V006'); eng.loadMcu(src); };

test('an io pin named outside P<letter><digits> is reported by unparsedGpioPins()', () => {
  load();
  eng.assignSignal('IO5', { gpio: 'GPIO_Output' });
  eng.compute();
  const u = eng.unparsedGpioPins();
  assert.equal(u.length, 1);
  assert.equal(u[0].pin, 'IO5');
  assert.doesNotMatch(u[0].signal, /^$/, 'the claim is named, not blank');
});

test('gpioPlan() itself still silently excludes it — the TODO lives beside it, not inside it', () => {
  load();
  eng.assignSignal('IO5', { gpio: 'GPIO_Output' });
  eng.compute();
  assert.equal(eng.gpioPlan().some(p => p.pin === 'IO5'), false,
    'unchanged: gpioPlan() cannot invent a port/bit for it either');
});

test('a normally-named pin claimed alongside it is completely unaffected', () => {
  load();
  eng.assignSignal('PA0', { gpio: 'GPIO_Output' });
  eng.assignSignal('IO5', { gpio: 'GPIO_Output' });
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /GPIO_InitStructure\.GPIO_Pin = GPIO_Pin_0;/);
  assert.match(c, /GPIO_Init\(GPIOA, &GPIO_InitStructure\);/);
  assert.equal((c.match(/TODO/g) || []).length, 1, 'exactly the unparsed-pin TODO, nothing else');
});

test('PLANTED BREAK: before this existed, a claimed pin with an unfamiliar name vanished without a trace', () => {
  load();
  eng.assignSignal('IO5', { gpio: 'GPIO_Output' });
  eng.compute();
  const c = eng.cSource();
  assert.match(c, /TODO: 1 pin this configuration claims is not named P<port-letter><bit-number>/);
  assert.match(c, /IO5:/, 'the pin itself is named in the generated C');
});

test('the ONLY claimed pin being unparsed still produces a GPIO_Init function with the TODO in it', () => {
  load();
  eng.assignSignal('IO5', { gpio: 'GPIO_Output' });
  eng.compute();
  const c = eng.cSource();
  const start = c.indexOf('void WCHCube_GPIO_Init(void)');
  const end = c.indexOf('void WCHCube_Periph_Init');
  const body = c.slice(start, end);
  assert.doesNotMatch(body, /No pins configured/, 'a claimed pin exists — this is not the empty case');
  assert.match(body, /TODO: 1 pin/);
  assert.doesNotMatch(body, /GPIO_InitTypeDef GPIO_InitStructure/,
    'no port was parseable, so there is nothing for the struct to configure');
});
