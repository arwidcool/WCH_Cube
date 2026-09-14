// =============================================================================
//  tests/completeness.test.js — the per-peripheral matrix. (C8, carried from round 2.)
//
//  `validate_mcu.py` checks that what an MCU file SAYS is consistent. This file
//  checks what it does not say. Every other test in this repo can pass on a part
//  whose peripherals are empty shells, because a shell is internally consistent.
//
//  For every peripheral of every real (non-fixture) part it asks:
//      settings   at least one setting that does something
//      params     a `params:` block, so Parameter Settings has rows
//      clock      a bit in codegen.periph_clock, so generated C can enable it
//      nvic       at least one vector, if the part has an `nvic:` block
//      dma        a DMA request, if the RM lists one for it
//      codegen    an init block appears in the generated C when it is enabled
//
//  Every missing cell is reported as `<peripheral>: <cell>` and ALL of them are
//  listed, not just the first. A gap is either a bug or a deliberate absence
//  with a written reason — and a deliberate absence has to be declared HERE, in
//  ABSENT below, with its citation. That is the point: it makes "we meant to
//  leave that out" a thing someone had to type, rather than a silence.
//
//  Last: the RM's chapter list is the outer checklist, read out of the reference
//  manual at run time rather than remembered, so a new RM revision that adds a
//  peripheral cannot pass unnoticed.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, test, assert, skip } from './lib/harness.js';
import * as eng from '../app/engine/index.js';
import { withMutantFile } from './lib/mutant.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

suite('completeness');

// ---------------------------------------------------------------- the model
function boot() {
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
boot();

/**
 * The parts this applies to.
 *
 * Only real silicon counts here, and this file boots from `data/mcus/` alone — so the
 * synthetic layout fixture is not even registered. `FIXTURE_PARTS` stays as the explicit
 * statement of the rule rather than an accident of which directory is scanned: the
 * fixture (now `tests/fixtures/mcus/WCH-DUMMY32-C8.yaml`) is a renderer stress test from
 * QFN12 to LQFP144, its peripherals are invented, and no RM chapter owns them.
 */
const FIXTURE_PARTS = new Set(['WCH-DUMMY32-C8']);
const REAL_PARTS = Object.keys(eng.MCU_FILES).filter(n => !FIXTURE_PARTS.has(n)).sort();

// ---------------------------------------------------------------- exemptions
//
// A cell may be empty for two different reasons, and conflating them is how a
// whitelist quietly becomes a way of turning failures off. So there are two
// tables, and they behave differently.

/**
 * ABSENT — the silicon does not have it. Permanent, and each entry cites the
 * source that says so. `ch32v00X_rcc.h` and `ch32v00X.h` below are the EVT
 * package at `data/sources/V006/Evt/EXAM/SRC/Peripheral/inc/`, which
 * `data/sources/README.md` makes the highest authority for names.
 *
 * The clock entries are all the same evidence read the same way: `ch32v00X_rcc.h`
 * lines 84–104 are the COMPLETE set of `RCC_*Periph_*` macros for this family —
 * HB: DMA1, SRAM · PB2: AFIO, GPIOA–D, ADC1, TIM1, SPI1, USART1/2 · PB1: TIM2,
 * TIM3, WWDG, I2C1, PWR. A peripheral not in that list has no clock gate to emit.
 *
 * The nvic entries likewise: `IRQn_Type` in `ch32v00X.h` lines 45–82 ends at
 * `OPCM_IRQn = 40`, and the startup table in `Startup/startup_ch32v00X.S` agrees.
 */
const ABSENT = {
  // --- no `params:` because the peripheral's whole configuration is choices
  'SYS.params': 'SYS is the debug interface and the reset-pin option byte — both are choices, not numbers',
  'RCC.params': 'the clock tree is configured on the Clock tab; RCC has no per-peripheral parameters',
  'EXTI.params': 'notes.md: "the per-line trigger edge (EXTI_RTENR / EXTI_FTENR, RM 6.4.3), eight lines, no signals" — eight choices, no numbers',
  // DMA1.params/DMA2.params: TRUE AGAIN on CH32H417 as of 2026-09-14 (`06da08c`, "CH32H417
  // DMA lands - the last real gap, both controllers"), but the shape it cites changed under
  // it. This was the DMA1.params citation the ABSENT-citation gate (2026-09-14) caught as
  // stale FIRST - "dma.channel_params" genuinely did not exist while H417 had no dma: block
  // at all. It landed as a LIST (one entry per controller: `data/mcus/CH32H417.yaml`'s
  // `dma:` is `[{controller: DMA1, channel_params: {...}, ...}, {controller: DMA2, ...}]`),
  // not the single-object shape every other part's `dma:` still is - so the RULE is true
  // again (both DMA1.params and DMA2.params, per-request config living off the peripheral),
  // it just needs `resolvePath()` to look inside a list (fixed alongside this) rather than a
  // rewritten citation.
  'DMA1.params': 'DMA parameters are per-REQUEST and live in the top-level dma.channel_params, not on the peripheral. FORMAT.md forbids modelling one fact twice',
  'DMA2.params': 'same as DMA1.params - DMA parameters are per-REQUEST and live in the top-level dma.channel_params (DMA2\'s own entry in the dma: list), not on the peripheral',
  // PIOC.params used to be one generic entry, citing only CH32H417's own files - true for
  // CH32H417, silently wrong the moment CH32X035's PIOC (a real, separate peripheral) fell
  // through the same generic key via lookup()'s fallback. Found by the ABSENT-citation gate
  // (2026-09-14, checking every entry against every part it actually excuses); split into
  // per-part keys on AGENT-1's adjudication (board, same day) rather than left generic a
  // second time - the shape that broke is "one citation, two parts", so the fix is not
  // "a better shared citation", it is "no shared citation".
  'CH32H417.PIOC.params': 'no ch32h417_pioc.c exists and no function of any kind applies PIOC_TypeDef; PIOC is a second, embedded RISC8B CPU configured by loading an assembly program into its own ROM, not an init struct (RM ch.34, CH32H417RM.md:49360-49399)',
  'CH32X035.PIOC.params': 'no ch32x035_pioc.c exists and no function of any kind applies PIOC_TypeDef; PIOC is a second, embedded RISC core configured by loading an assembly program into its own ROM, not an init struct (RM ch.22, CH32X035RM.md:16942-16957)',

  // --- no clock-enable bit exists for it (ch32v00X_rcc.h:84-104)
  'SYS.clock': 'not a clocked peripheral: the debug pins and an option byte. No RCC_*Periph_SYS exists',
  'RCC.clock': 'RCC is the clock controller; it cannot gate itself. No RCC_*Periph_RCC exists',
  'IWDG.clock': 'the independent watchdog runs from LSI and is started by writing IWDG_CTLR\'s key. There is no RCC_PB1Periph_IWDG in ch32v00X_rcc.h — checked, not assumed',
  'FLASH.clock': 'the flash controller is always clocked. No RCC_*Periph_FLASH exists',
  'EXTI.clock': 'EXTI sits behind AFIO, and the GPIO section already enables RCC_PB2Periph_AFIO. No RCC_*Periph_EXTI exists',
  'TKEY.clock': 'TouchKey is a mode of the ADC (RM ch.10), not a separate unit, and shares RCC_PB2Periph_ADC1. No RCC_*Periph_TKEY exists',
  'OPA1.clock': 'the OPA/CMP block has no clock gate of its own. No RCC_*Periph_OPA exists',
  'EXTEN.clock': 'the extended-configuration unit sits on the HB domain and is clocked with it, '
    + 'with no gate of its own: `ch32v00X.h:438` puts it at `HBPERIPH_BASE + 0x3800` (= the RM\'s '
    + '0x40023800) and there is no RCC_*Periph_EXTEN anywhere in ch32v00X_rcc.h. Same shape as '
    + 'FLASH, EXTI, TKEY and OPA1 above. TRUE FOR CH32V006 (the part `ch32v00X.h` is really '
    + 'spelled for - confirmed by direct search, not assumed) - CH32L103 and CH32V003 each have '
    + 'their own EXTEN and their own header, and lookup() silently applied this V006 citation '
    + 'to both until the ABSENT-citation gate (2026-09-14) caught it. Their own citations are '
    + 'below rather than folded into this one, the same reasoning as the PIOC split above.',
  'CH32L103.EXTEN.clock': 'same rule as CH32V006\'s EXTEN.clock, checked against THIS part\'s '
    + 'own header rather than assumed: `EXTEN_TypeDef` exists at `ch32l103.h:511-512`, its '
    + 'register base at `:792`, and `grep RCC_.*Periph.*EXTEN ch32l103_rcc.h` returns nothing - '
    + 'no bus clock gate exists for it on this part either (AGENT-1, board 2026-09-14)',
  'CH32V003.EXTEN.clock': 'same rule as CH32V006\'s EXTEN.clock, checked against THIS part\'s '
    + 'own header rather than assumed: `EXTEN_TypeDef` exists at `ch32v00x.h:338-339` (lowercase '
    + '`x` - CH32V003\'s own real filename, not the `ch32v00X.h` capital-X file that is really '
    + 'CH32V006\'s), its register base at `:378`, and `grep RCC_.*Periph.*EXTEN` against this '
    + 'part\'s own rcc header returns nothing (AGENT-1, board 2026-09-14)',
  'EXTEN.params': 'both of its user-visible bits are switches, not numbers: LKUPEN on/off and '
    + 'TIM2_DMA_REMAP on/off. LKUPRST is deliberately not offered at all — it is a write-1-to-clear '
    + 'STATUS flag saying a lock-up already reset the part, which firmware reads at startup and a '
    + 'configurator has no business setting (AGENT-1, round 3 board 16:29Z)',

  // --- no interrupt vector exists for it (IRQn_Type, ch32v00X.h:45-82)
  'SYS.nvic': 'the debug interface and the reset pin are not interrupt sources',
  'IWDG.nvic': 'the independent watchdog RESETS the part, it does not interrupt. No IWDG_IRQn in the enum',
  'TKEY.nvic': 'TouchKey raises the ADC vector, which is declared with peripheral: ADC1. No TKEY_IRQn in the enum',
  'EXTEN.nvic': 'the extended-configuration unit raises no interrupt: IRQn_Type in ch32v00X.h:46-83 '
    + 'ends at OPCM_IRQn = 40 and contains no EXTEN entry. LKUPRST is a polled status flag, not a vector. '
    + 'TRUE FOR CH32V006 specifically (the part ch32v00X.h, capital X, is really spelled for) - CH32L103 '
    + 'and CH32V003 have their own IRQn_Type and their own citations below, same split as EXTEN.clock '
    + 'above. Line range corrected 2026-09-14 (AGENT-1, board): `typedef enum IRQn` is at line 46, '
    + '`} IRQn_Type;` at 83 - the CLAIM was always right, only :45-82 was off by one on both ends',
  'CH32L103.EXTEN.nvic': 'IRQn_Type in ch32l103.h:37-102 (this part\'s own real header) ends at '
    + 'CMPWakeUp_IRQn = 68 and contains no EXTEN entry anywhere in the enum - checked by reading the '
    + 'whole block, not grepping for a name that might be spelled differently. LKUPRST stays a polled '
    + 'status flag on this part too, same reasoning as the generic entry (AGENT-1, board 2026-09-14)',
  'CH32V003.EXTEN.nvic': 'IRQn_Type in ch32v00x.h:35-68 (lowercase x - this part\'s own real file, not '
    + 'V006\'s capital-X one) ends at TIM2_IRQn = 38 and contains no EXTEN entry. This part\'s enum is '
    + 'much shorter than L103\'s or V006\'s (max vector number 38 vs 68/40) - read whole, not truncated '
    + 'early (AGENT-1, board 2026-09-14)',
  // --- per-part: true on THIS part and not on its siblings
  //
  // CH32X035 has ONE vector, `OPA_IRQn = 48`, for two OPAs and three
  // comparators. `IRQn_Type` in ch32x035.h contains no CMP entry of any kind and
  // no second OPA entry — the full list is 45 names and these are not among
  // them. So one of the five carries the vector (AGENT-1's data says which) and
  // the other four have none of their own. Same shape as TKEY sharing ADC1's
  // vector on CH32V006, and the same reason: a shared interrupt is a fact about
  // the silicon, not a gap in the extraction.
  'CH32X035.CMP1.nvic': 'shares OPA_IRQn = 48; there is no CMP vector in ch32x035.h',
  'CH32X035.CMP2.nvic': 'shares OPA_IRQn = 48; there is no CMP vector in ch32x035.h',
  'CH32X035.CMP3.nvic': 'shares OPA_IRQn = 48; there is no CMP vector in ch32x035.h',
  'CH32X035.OPA2.nvic': 'shares OPA_IRQn = 48 with OPA1; the enum has one OPA vector, not two',

  // --- CH32L103: three absences, each checked against the part's own headers
  //
  // The RTC and the OPA/CMP block have no clock GATE of their own, and the CRC has
  // no vector. All three were checked by reading the header rather than by analogy
  // with a sibling: `grep`ping ch32l103_rcc.h for RTC|OPA|CMP finds only
  // `RCC_RTCCLKSource_*` (which SELECTS the RTC's source, a different thing from
  // gating it) and no gate macro for any of the three, and ch32l103.h's 58-entry
  // `IRQn_Type` contains no CRC entry.
  'CH32L103.RTC.clock': 'RM 2.5: "Set the PWREN bit and BKPEN bit of the register '
    + 'RCC_PB1PCENR to turn on the operating clock of the [RTC]". There is no '
    + 'RCC_PB1Periph_RTC macro - ch32l103_rcc.h names the bit for the BACKUP DOMAIN - so '
    + 'the gate is carried by `BKP: 27` in codegen.periph_clock, and RTC rightly has no '
    + 'entry of its own',
  'CH32L103.CMP1.clock': 'the OPA/CMP block has no clock gate: ch32l103_rcc.h defines no '
    + 'RCC_*Periph_OPA and no RCC_*Periph_CMP (checked, not assumed). Same shape as '
    + 'CH32V006 OPA1.clock and the bare OPA1.clock entry above',

  // --- CH32L103 CMP2 and CMP3, STAGED ahead of the peripherals themselves
  //
  // AGENT-1 asked for these four (BOARD 2026-09-12T12:01Z) because the moment CMP2 and CMP3
  // are modelled this matrix demands an `nvic` and a `clock` cell for each, and both answers
  // are absences rather than gaps. Written now because the requests ARE the two facts, and
  // both were re-checked here rather than pasted:
  //
  //   * `ch32l103.h:100` has `CMPWakeUp_IRQn = 68,` and it is the ONLY comparator entry in
  //     `IRQn_Type` - so one vector serves three comparators, exactly as CH32X035's single
  //     `OPA_IRQn = 48` serves two OPAs and three comparators (the entries above).
  //   * `ch32l103_rcc.h` contains no `RCC_*Periph_CMP` and no `RCC_*Periph_OPA` at all.
  //
  // These take effect the moment AGENT-1 adds the two peripherals. If CMP2/CMP3 are ever
  // abandoned, these four are dead entries in the sense docs/COVERAGE.md warns about - they
  // read exactly like working ones - so the board entry that records them says so.
  'CH32L103.CMP2.nvic': 'shares CMPWakeUp_IRQn = 68 with CMP1: `IRQn_Type` in ch32l103.h has '
    + 'ONE comparator wake-up vector (line 100) and this part has three comparators, so CMP1 '
    + 'carries it and CMP2/CMP3 share it. Inventing a vector would be a claim about silicon',
  'CH32L103.CMP3.nvic': 'shares CMPWakeUp_IRQn = 68 with CMP1 - see the CMP2 entry above; '
    + 'ch32l103.h:100 is the only comparator vector in the enum',
  'CH32L103.CMP2.clock': 'same OPA/CMP block as CMP1, and the same absent gate: '
    + 'ch32l103_rcc.h defines no RCC_*Periph_CMP for any of the three comparators',
  'CH32L103.CMP3.clock': 'same as CMP2.clock - one OPA/CMP block, one (absent) gate',
  'CH32L103.CRC.nvic': 'the CRC raises no interrupt: `IRQn_Type` in ch32l103.h lists 58 '
    + 'vectors and contains no CRC entry of any kind. The unit is polled - the SPL\'s own '
    + 'API is CRC_ResetDR / CRC_CalcCRC / CRC_GetCRC',
  'CH32L103.USBFS.params': 'ch32l103_usb.h is MACROS ONLY - 513 lines with no typedef, no '
    + 'struct and no function - so there is no init struct to fill and no `*_Init()` to '
    + 'call. The EVT drives USB by writing its registers from its own driver stack. A '
    + '`params:` block here would be invented, which is what this repo bans',
  'CH32L103.USBPD.params': 'same as USBFS: ch32l103_usbpd.h exposes no typed surface at '
    + 'all - no struct, no function. Recorded rather than modelled',

  // --- CH32V003: an absence that is the OPPOSITE of its sibling's, on the same
  //     peripheral name. CH32V006 gives the OPA/comparator block OPCM_IRQn = 40;
  //     CH32V003 has no OPA vector at all. This is why the key is per-part: "the
  //     OPA has an interrupt" is exactly the kind of family-wide assumption
  //     round 4 and round 5 exist to break, and it would have been wrong here.
  'CH32V003.OPA1.nvic': 'CH32V003 has NO OPA interrupt. `IRQn_Type` in '
    + 'data/sources/V003/Evt/EXAM/SRC/Peripheral/inc/ch32v00x.h is the complete list and ends at '
    + '`TIM2_IRQn = 38`; a search for `OPA.*IRQn` in that header returns nothing, where '
    + 'CH32V006 has `OPCM_IRQn = 40`. The part\'s own notes say the same. Recorded as absent '
    + 'rather than left blank because the two are different: ABSENT is "the silicon does not '
    + 'have it", OPEN is "nobody has written it down yet"',

  'CH32X035.RCC.nvic': 'CH32X035 has no RCC interrupt AT ALL. `IRQn_Type` in '
    + 'data/sources/X035/Evt/EXAM/SRC/Peripheral/inc/ch32x035.h jumps FLASH_IRQn = 18 straight to '
    + 'EXTI7_0_IRQn = 20, and Startup/startup_ch32x035.S has `.word 0` in that slot — two '
    + 'independent sources agreeing on an absence. CH32V006 has RCC_IRQn = 19, which is exactly '
    + 'why this key is per-part: "every family has an RCC interrupt" is the kind of assumption '
    + 'round 4 exists to break (AGENT-1, round-4 board 16:44Z)',

  'TIM3.nvic': 'THE RECORDED CONTRADICTION, and it survived the EVT drop: this part HAS a TIM3, and there is no TIM3 vector. '
    + 'RM Table 6-1 omits it, IRQn_Type ends at OPCM_IRQn = 40, and startup_ch32v00X.S agrees. Two independent sources, '
    + 'so it is recorded rather than invented. See CH32V006.notes.md',

  // --- CH32H417: absences read off `IRQn_Type` in ch32h417.h, which is the complete
  //     list (125 members, ch32h417.h:39-169) and was cross-checked against the v3f
  //     startup table by tools/extract_h417_setup.py --audit: every member has a
  //     handler, so a missing vector here is genuinely missing rather than unextracted.
  'CH32H417.ADC2.nvic': 'shares `ADC1_2_IRQn = 69` with ADC1 - the enum has ONE vector for '
    + 'both ADC units, and ch32h417.h declares no ADC2_IRQn. Same shape as CH32X035\'s '
    + 'CMP1/2/3 sharing OPA_IRQn: a shared interrupt is a fact about the silicon, not a gap',
  'CH32H417.CMP.nvic': 'the comparator has no vector of its own in ch32h417.h - IRQn_Type '
    + 'contains no CMP or OPCM entry, so the OPA/CMP interrupt is not modelled on this part '
    + 'at all. Recorded as absent rather than assigned to a neighbour to make the cell tick',
  'CH32H417.CRC.nvic': 'no CRC entry in ch32h417.h\'s IRQn_Type - this part raises no CRC '
    + 'interrupt',
  'CH32H417.DAC.nvic': 'no DAC entry in ch32h417.h\'s IRQn_Type - the DAC is driven by DMA '
    + 'and raises no interrupt of its own here',
  'CH32H417.DBGMCU.nvic': 'Debug Support (RM ch.45) is not an interrupt source; no DBGMCU '
    + 'entry exists in IRQn_Type',
  // I2S2/I2S3 are SPI peripherals in I2S mode here, not blocks of their own (RM ch.23 is
  // "SPI/I2S"), so their interrupt IS the SPI vector - which `nvic:` already owns under
  // SPI2 and SPI3. Same shape as CH32X035's TKEY raising the ADC vector.
  'CH32H417.I2S2.nvic': 'I2S2 is SPI2 in I2S mode (RM ch.23 is "SPI/I2S"), so its interrupt '
    + 'is `SPI2_IRQn`, which `nvic:` already records under SPI2. ch32h417.h has no I2S2_IRQn',
  'CH32H417.I2S3.nvic': 'I2S3 is SPI3 in I2S mode; its interrupt is `SPI3_IRQn`, already '
    + 'recorded under SPI3. ch32h417.h has no I2S3_IRQn',
  'CH32H417.OPA.nvic': 'ch32h417.h\'s IRQn_Type contains no OPA or OPCM entry, so the '
    + 'op-amp/comparator block raises no modelled interrupt on this part',
  'CH32H417.PWR.nvic': 'no PVD or PWR entry in ch32h417.h\'s IRQn_Type - the power '
    + 'controller raises no interrupt here (RM ch.2 gives it no vector)',

  // --- CH32H417 clock gates, from the round-6 peripheral-map audit. Six cells printed
  //     `clock` with no explanation; three of them were real gaps and were MODELLED
  //     (I2S2 and I2S3 now carry SPI2's and SPI3's bit; RTC is the OPEN entry below),
  //     and these three are absences. The evidence is the same in all three: the
  //     COMPLETE `RCC_*Periph_*` block in
  //     data/sources/H417/Evt/EXAM/SRC/Peripheral/inc/ch32h417_rcc.h is lines 230-307
  //     ("/* HB_peripheral */" through RCC_HB1Periph_SWPMI), 73 macros, and none of the
  //     three appears in it. What makes them absences rather than gaps is WHERE the
  //     silicon puts them: two are core-private and one is a CSR, so there is no bus
  //     clock to gate. Read off the RM's own register addresses, not by analogy with a
  //     sibling.
  'CH32H417.DBGMCU.clock': 'Debug Support is a core CSR, not a bus peripheral: RM 45.2.1 '
    + 'gives R32_DBGMCU_CR "Offset address: 0x7C0(CSR)" (CH32H417RM.md:66907), so it sits in '
    + 'the CPU\'s control-and-status register file and never appears on HB, HB1 or HB2. There '
    + 'is no RCC_*Periph_DBGMCU in ch32h417_rcc.h:230-307. Same shape as the bare FLASH.clock '
    + 'and EXTI.clock entries above',
  'CH32H417.HSEM.clock': 'the hardware semaphore is a CORE-PRIVATE peripheral, not a bus one: '
    + 'RM 4.5 (CH32H417RM.md:6561) puts R32_HSEM_RX0 at 0xE000C000 (:6652), inside the '
    + '0xE000_xxxx core space, and RM:4313 says so in words - "Private peripherals include '
    + 'system timers, inter-core communication, and hardware semaphore modules". The RCC gates '
    + 'HB/HB1/HB2 and there is no RCC_*Periph_HSEM in ch32h417_rcc.h:230-307',
  'CH32H417.IPC.clock': 'inter-process communication is the other core-private block named at '
    + 'CH32H417RM.md:4313: RM 4.4 (:6287) puts R32_IPC_CTLR at 0xE000D000 (:6332), beside HSEM '
    + 'in the core space. No RCC_*Periph_IPC exists in ch32h417_rcc.h:230-307. Its generated C '
    + 'correctly emits IPC_Init() with no clock line',

  // --- CH32H417 params, checked one peripheral at a time against its own
  //     ch32h417_*.h rather than assumed from the 11 cells IN_EXTRACTION was
  //     softening. Five are genuinely absent (below); the OTHER SIX of those
  //     eleven — DMA2, FLASH, GPHA, IWDG, PWR, WWDG — are NOT: each has a real,
  //     verified init struct or SetXxx/ConfigXxx function this repo has not
  //     modelled yet, and are reported to the board rather than declared here.
  //     Declaring real, owed work ABSENT would be the exact failure this table
  //     exists to prevent — "we meant to leave that blank" standing in for
  //     "nobody has looked".
  'CH32H417.CRC.params': 'ch32h417_crc.h declares six functions and no InitTypeDef: '
    + 'CRC_ResetDR/CalcCRC/CalcBlockCRC/GetCRC are runtime operations on a fixed-function '
    + 'CRC32 engine, and CRC_Set/GetIDRegister read and write a scratch register that '
    + 'survives reset, not a configuration choice. No polynomial select, no init struct - '
    + 'checked against ch32h417_crc.c too, nothing else is declared there',
  'CH32H417.DBGMCU.params': 'ch32h417_dbgmcu.h\'s only configurable call is '
    + 'DBGMCU_Config(DBGMCU_Periph, NewState) - which peripherals keep counting while the '
    + 'core is halted in a debug session, a debugger convenience with no effect outside one, '
    + 'not an operating parameter of the part. GetREVID/GetDEVID/GetCHIPID are read-only '
    + 'identification. Same shape as this file\'s own DBGMCU.clock entry above',
  'CH32H417.HSEM.params': 'ch32h417_hsem.h has no InitTypeDef; every function is a runtime '
    + 'semaphore operation - Take/FastTake/Release* and the GetAllSemTakenState reads happen '
    + 'during operation, not at init - and HSEM_Set/GetClearKey read and write a runtime '
    + 'debug-clear key, not a peripheral mode. Same shape as this file\'s own HSEM.clock entry',
  'CH32H417.RNG.params': 'ch32h417_rng.h has no InitTypeDef and no SetXxx/ConfigXxx beyond '
    + 'RNG_Cmd (Enable/Disable, already the Mode setting) and RNG_ITConfig (an interrupt '
    + 'enable, not a peripheral parameter - nvic\'s job if modelled at all). A hardware RNG '
    + 'genuinely has no operating mode: it is either running or not',
  'CH32H417.TKEY.params': 'no ch32h417_tkey.h exists at all - confirmed by the peripheral\'s '
    + 'own `pins:`/`notes:` citation (RM ch.13, CH32H417RM.md:15745-15752): TKEY is realized '
    + 'entirely as an ADC mode (ADC_CTLR1.TKENABLE), so its only configuration is the pad '
    + 'chosen on ADC1\'s or ADC2\'s Channels row, already modelled there. Nothing is left for '
    + 'a standalone TKEY params: block to hold',
};

/**
 * OPEN — the part HAS it and we have not modelled it yet, each entry naming the
 * `TASKS.md` line that tracks the work and the agent who owns it.
 *
 * These do not fail the run, because they are claimed work rather than unknown
 * gaps and a permanently red shared gate would stop four agents rather than
 * inform one. They are printed on every run instead, and a separate test below
 * checks each one still has a live TASKS.md line — so an entry cannot be parked
 * here and then quietly dropped from the backlog.
 */
const OPEN = {
  'TIM3.params': ['AGENT-1', '`params:` for TIM3, IWDG, WWDG, TKEY, OPA1'],
  // CH32H417's RTC clock gate is TWO bits and `codegen.periph_clock` holds one per
  // peripheral, so the part deliberately carries no entry for it rather than writing half
  // of one. Round-6 peripheral-map audit; the citation chain is on the TASKS.md line and in
  // the RTC `notes:` in data/sources/H417/peripheral_extras.yaml.
  //
  // STAGED, and saying so because the file's CH32L103 CMP2/CMP3 entries above warn about
  // exactly this: while CH32H417 is in IN_EXTRACTION below, a `clock` cell is a SOFT_CELL
  // and takes that branch first, so this entry is NOT consulted today and would read like a
  // working one. It becomes live - with the right owner on it, which AGENT-1's params line
  // is not - the moment the IN_EXTRACTION entry retires. If the schema takes a list of bits
  // before then, this goes in the same commit as the entry it excuses.
  'CH32H417.RTC.clock': ['AGENT-2', 'CH32H417 RTC: a clock gate that is two bits'],
  'IWDG.params': ['AGENT-1', '`params:` for TIM3, IWDG, WWDG, TKEY, OPA1'],
  'WWDG.params': ['AGENT-1', '`params:` for TIM3, IWDG, WWDG, TKEY, OPA1'],
  'TKEY.params': ['AGENT-1', '`params:` for TIM3, IWDG, WWDG, TKEY, OPA1'],
  'OPA1.params': ['AGENT-1', '`params:` for TIM3, IWDG, WWDG, TKEY, OPA1'],
};

/**
 * Look a cell up in one of the tables, most specific key first.
 *
 * Keys may be `<PART>.<PID>.<cell>` or `<PID>.<cell>`, and `*` stands in for the
 * cell. The per-part form exists because **CH32X035 proved that an absence is
 * not a property of a peripheral, it is a property of a peripheral ON A PART**:
 * `RCC` has a vector on CH32V006 (`RCC_IRQn = 19`) and none at all on CH32X035,
 * where the enum jumps 18 → 20 and the startup table has a `.word 0` in that
 * slot. A table keyed only by peripheral cannot say that, and until the second
 * family landed nothing here needed it to. That is the round's whole thesis
 * arriving in a test file.
 */
const lookup = (table, part, pid, cell) =>
  table[`${part}.${pid}.${cell}`] || table[`${part}.${pid}.*`]
  || table[`${pid}.${cell}`] || table[`${pid}.*`];

/**
 * Where TASKS.md is read from. An env override exists for ONE reason: the planted break at
 * the end of this file has to hand the checks a copy of TASKS.md with a line ticked, and it
 * must never tick the real one on a tree three agents write at once.
 */
const TASKS_PATH = process.env.WCHCUBE_TASKS_MD || path.join(ROOT, 'TASKS.md');

/**
 * The state of the TASKS.md line an exemption cites: 'open', 'ticked' or 'missing'.
 *
 * THIS IS THE EXPIRY, and until 2026-09-12 it did not exist. The pack had said since round 5
 * that "the day the TASKS.md line is ticked, every cell becomes a hard failure with no edit
 * here" — and the guard checked only `tasks.includes(task)`. A ticked `- [x]` line still
 * CONTAINS the phrase, so ticking it changed nothing; the exemption could only expire by the
 * line being DELETED, which the working agreement forbids. An exemption with no working
 * retirement condition is a gate that cannot go red. Round 6, deliverable B, found by the
 * sweep for exactly that class.
 *
 * Matching: the line (or wrapped run of lines) that carries the phrase's distinctive words,
 * the same tolerance the OPEN guard uses, because TASKS.md wraps at 100 columns and a wrapped
 * line must not read as a deleted one.
 */
function taskState(tasksText, phrase) {
  const words = phrase.replace(/[`:*]/g, '').split(/[\s,]+/).filter(w => w.length > 3);
  if (!words.every(w => tasksText.includes(w))) return 'missing';
  // Find the list item that holds the phrase: walk items (`- [ ]` / `- [x]` / `- [~]` /
  // `- [-]` at line start, with their wrapped continuation lines) and pick the first whose
  // text carries every distinctive word.
  const items = tasksText.split(/\n(?=- \[[ x~\-]\])/);
  const item = items.find(it => words.every(w => it.replace(/[`:*]/g, '').includes(w)));
  if (!item) return 'missing';
  return /^- \[x\]/i.test(item) ? 'ticked' : 'open';
}

const excused = (part, pid, cell) =>
  process.env.WCHCUBE_NO_EXEMPTIONS ? false : lookup(ABSENT, part, pid, cell);

/**
 * Parts whose extraction is explicitly still in progress, and the TASKS.md line
 * that says so.
 *
 * A part arrives over many commits. Listing every half-filled cell in OPEN as it
 * appears turns this file into a running commentary on somebody else's work in
 * progress, and every one of those entries then has to be removed by hand —
 * which is how a whitelist ends up outliving the thing it excused.
 *
 * So: while the part is declared in-extraction, its `params` and `clock` gaps
 * PRINT with the owner instead of failing. `settings` and `nvic` still fail,
 * because a peripheral with no setting at all is not "not finished yet", it is a
 * tree entry that does nothing; and a missing vector on a part that HAS an nvic
 * block is a claim about silicon rather than a gap in depth.
 *
 * It self-closes: the guard below fails if the TASKS.md line disappears, and the
 * day AGENT-1 ticks it every cell becomes a hard failure with no edit here.
 */
const IN_EXTRACTION = {
  CH32X035: ['AGENT-1', 'CH32X035 extraction: `params:` for the peripherals that have none'],
  // CH32H417 arrived as a whole new family with 47 RM chapters and 41 SPL headers. Its
  // PERIPHERAL SET is complete (78 entries, generated from the DS + the SPL headers) and
  // so are its pins, its clock tree, its 125 vectors and its 73 clock-enable bits, but
  // `params:` for the ~70 peripherals that have none is real work: each parameter needs
  // its init-struct field and its option macros verified against ch32h417_*.h, which is
  // what `tools/verify_sdk_names.py` checks. Declared in-extraction so those cells print
  // with an owner rather than failing a shared gate for a job nobody has done yet - and
  // so the day the TASKS.md line is ticked they all become hard failures with no edit
  // here, which is what stops this table outliving its excuse.
  // OWNER CORRECTED 2026-09-12 (AGENT-3 -> AGENT-1). This entry excuses `params:` cells,
  // and `params:` lives in data/mcus/CH32H417.yaml, which the ownership table in
  // agents/README.md gives to AGENT-1. AGENT-3 may not write those cells even in
  // principle, so an exemption owned by AGENT-3 named somebody who could never retire
  // it - an exemption with no route to being closed, which is the failure mode the
  // owner field exists to prevent. The TASKS.md line was corrected in the same commit.
  CH32H417: ['AGENT-1', 'CH32H417: `params:` for the peripherals that have none'],
};
const SOFT_CELLS = new Set(['params', 'clock']);

// ---------------------------------------------------------------- the matrix
test('every peripheral of every real part has settings, params, a clock bit, and vectors', () => {
  const missing = [];
  const stillOpen = new Set();
  // Read once: whether each IN_EXTRACTION line is still open decides whether its cells are
  // softened or fail. See taskState() — a ticked line is an EXPIRED exemption.
  const tasksText = fs.readFileSync(TASKS_PATH, 'utf8');
  for (const part of REAL_PARTS) {
    eng.loadMcu(eng.MCU_FILES[part]);
    const M = eng.M;
    const clockBits = new Set();
    for (const dom of Object.values((M.codegen || {}).periph_clock || {})) {
      for (const name of Object.keys(dom.bits || {})) clockBits.add(name);
    }
    // Vectors declare their owner in `peripheral:`. Read that and nothing else —
    // guessing an owner from the vector NAME would be wrong on this part in both
    // directions: PVD and AWU belong to PWR, EXTI7_0 to EXTI, OPCM to OPA1, and
    // the ADC vector is spelled `ADC` while the peripheral is `ADC1`.
    const vectorOwners = new Set();
    for (const v of Object.values((M.nvic || {}).vectors || {})) {
      if (v.peripheral) vectorOwners.add(v.peripheral);
    }

    const say = (pid, cell, why) => {
      if (excused(part, pid, cell)) return;
      const extracting = IN_EXTRACTION[part];
      if (extracting && SOFT_CELLS.has(cell)) {
        const state = taskState(tasksText, extracting[1]);
        if (state === 'open') {
          stillOpen.add(`${part}  ${pid}: ${cell} — ${extracting[0]} owns it, extraction in progress`);
          return;
        }
        // The exemption has EXPIRED: its TASKS.md line is ticked (or gone). From this commit
        // on every cell it excused is a hard failure, with no edit to this file - which is
        // what the exemption promised on the day it was written.
        missing.push(`${part}  ${pid}: ${cell} — ${why}  [IN_EXTRACTION for ${part} has expired: its TASKS.md line `
          + `"${extracting[1]}" is ${state}; delete the entry and fill or declare the cell]`);
        return;
      }
      const open = lookup(OPEN, part, pid, cell);
      if (open) { stillOpen.add(`${part}  ${pid}: ${cell} — ${open[0]} owns it, TASKS.md: ${open[1]}`); return; }
      missing.push(`${part}  ${pid}: ${cell} — ${why}`);
    };

    for (const [pid, P] of Object.entries(M.peripherals || {})) {
      // settings — at least one, with at least one real (non-neutral) choice
      const settings = P.settings || [];
      const real = settings.filter(s => s.type === 'checkboxes' || (s.choices || []).length > 1);
      if (!real.length) say(pid, 'settings', `${settings.length} setting(s), none offering a choice`);

      // params — a block with at least one definition, `params:` OR `channel_params:`
      // (DAC/OPA/SAI/SERDES/LTDC and siblings fill an init struct once per channel or
      // instance instead of once per peripheral — `eng.channelParamDefs()` is the same
      // function codegen and the Parameter Settings tab both read, so this credits
      // exactly what the app already treats as "this peripheral has rows", not a
      // reimplementation of the shape that could silently drift from it).
      if (!(P.params || []).length && !eng.channelParamDefs(pid).length) {
        say(pid, 'params', 'no params: or channel_params: block, so Parameter Settings has no rows for it');
      }

      // clock — a bit in codegen.periph_clock, or generated C cannot enable it
      if (Object.keys(M.codegen || {}).length && !clockBits.has(pid)) {
        say(pid, 'clock', 'no bit in codegen.periph_clock, so generated C cannot enable its clock');
      }

      // nvic — only asked of parts that have an nvic: block at all
      if (Object.keys((M.nvic || {}).vectors || {}).length && !vectorOwners.has(pid)) {
        say(pid, 'nvic', 'no vector in nvic.vectors names it');
      }
    }
  }
  // Claimed-but-unfinished cells are not failures, but they are not invisible
  // either: print them every run, so "we know about it" cannot decay into
  // "nobody has looked at it since round 2".
  if (stillOpen.size) {
    process.stdout.write(`        ${stillOpen.size} cell(s) known-missing and tracked:
`);
    for (const line of [...stillOpen].sort()) process.stdout.write(`          - ${line}
`);
  }
  assert.empty(missing, 'peripheral cells that are neither filled in nor declared absent in ABSENT');
});

// ---------------------------------------------------------------- an ABSENT citation's referent
//
// `DMA1.params` said, in good faith and correctly for five parts, that DMA parameters "live in
// the top-level dma.channel_params, not on the peripheral". CH32H417 has no `dma:` block at all
// - the citation was never wrong where it was written, and nothing here ever asked, for THIS
// part, whether the sentence was still true. An exemption whose reason has quietly gone false
// reads exactly like one that still holds, which is how an entire DMA subsystem sat behind a
// correct-sounding sentence. The matrix test above checks that an ABSENT ENTRY EXISTS for a
// missing cell. It has never checked that the entry's REASON IS TRUE. This is that second
// question, asked once for every citation this file makes, on every part it is used against.
//
// TWO KINDS OF CLAIM, extracted from the citation text by pattern rather than by hand-tagging
// each of the ~90 entries (hand-tagging would rot exactly the way DMA1.params did - a citation
// and its own checkability silently drifting apart):
//   file_line   `name.ext:NN` or `name.ext:NN-MM` (h/c/S/md) - the named file must exist
//               somewhere under that PART's own `data/sources/<evt>` tree (Datasheets and Evt
//               both live under it) and carry at least as many lines as the citation's highest
//               line number.
//   data_path   a dotted path rooted at a real top-level key of the MCU model (`dma.`,
//               `codegen.`, `nvic.`, ...) - it must resolve to something DEFINED in that
//               part's own loaded model, `eng.M`, the exact structure every other check in
//               this file reads (not a re-parse of the YAML that could disagree with it).
// A citation with NEITHER kind of claim is not a failure - most of this table is prose ("both
// are choices, not numbers") with no referent to point a checker at - but it is counted and
// printed, so "how many of these ~90 exemptions can this file actually verify" is a number on
// the page, the same discipline the pin-verification record uses for its own tooling gaps.
//
// GENERIC ENTRIES (no part prefix, e.g. `DMA1.params`) apply to every part with that
// peripheral, via `lookup()`'s fallback - and DMA1.params is the proof that "true on the part
// it was written against" is not "true everywhere it now applies". So a generic entry's claims
// are checked against EVERY part `excused()` actually resolves it for, not just one.

const MODEL_ROOTS = ['dma', 'codegen', 'nvic', 'exti', 'gpio', 'clock', 'constraints', 'pins', 'packages'];
const FILE_LINE_RE = /\b([A-Za-z0-9_][A-Za-z0-9_.]*\.(?:h|c|S|md)):(\d+)(?:[-–](\d+))?\b/g;
const DATA_PATH_RE = new RegExp(`\\b(?:${MODEL_ROOTS.join('|')})(?:\\.[a-z][a-z0-9_]*)+\\b`, 'g');

/** Every checkable claim a citation string makes. `[]` means prose only, not a failure. */
function citationClaims(text) {
  const claims = [];
  for (const m of text.matchAll(FILE_LINE_RE)) {
    const line = Number(m[2]), lineEnd = m[3] ? Number(m[3]) : line;
    claims.push({ kind: 'file_line', text: m[0], file: m[1], line, lineEnd });
  }
  for (const m of text.matchAll(DATA_PATH_RE)) claims.push({ kind: 'data_path', text: m[0], path: m[0] });
  return claims;
}

/** Every file under a part's own `data/sources/<evt>` tree, indexed by basename. Built once per
 *  evt root and cached — this file tree does not change mid-run. */
const fileIndexCache = new Map();
function fileIndex(evtRoot) {
  if (fileIndexCache.has(evtRoot)) return fileIndexCache.get(evtRoot);
  const dir = path.join(ROOT, 'data', 'sources', evtRoot);
  const idx = new Map();
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const full = path.join(entry.path ?? entry.parentPath ?? dir, entry.name);
      if (!idx.has(entry.name)) idx.set(entry.name, []);
      idx.get(entry.name).push(full);
    }
  }
  fileIndexCache.set(evtRoot, idx);
  return idx;
}

/**
 * Walk a dotted path (`dma.channel_params`) into a model object; `undefined` if any step is
 * missing. CH32H417's real `dma:` landed as a LIST (one entry per controller, DMA1/DMA2 -
 * `data/mcus/CH32H417.yaml`'s `dma:`, 2026-09-14) rather than the single-object shape every
 * other part's `dma:` still is, so a plain `v[seg]` walk would read `dma.channel_params` as
 * undefined even though every list entry genuinely carries one. At an array, the remaining
 * path is checked against EACH entry and resolves if ANY does - "does at least one controller
 * have this" is the existence question an ABSENT citation about the shared dma: mechanism is
 * actually asking, not "does the array itself have a property by this name".
 */
function resolvePath(model, dotted) {
  let v = model;
  const segs = dotted.split('.');
  for (let i = 0; i < segs.length; i++) {
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) {
      const rest = segs.slice(i).join('.');
      return v.some(item => resolvePath(item, rest) !== undefined) ? true : undefined;
    }
    v = v[segs[i]];
  }
  return v;
}

test('every ABSENT citation that names a checkable location actually resolves, per part', () => {
  const problems = [];
  const templated = [];
  let checkable = 0, proseOnly = 0;
  const evtRootCache = new Map();
  const evtRoots = fs.readdirSync(path.join(ROOT, 'data', 'sources'), { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);

  for (const [key, citation] of Object.entries(ABSENT)) {
    if (typeof citation !== 'string') continue; // OPEN-shaped [owner, task] entries live in a
                                                  // different table; ABSENT is string-only.
    const segs = key.split('.');
    const cell = segs.pop();
    const pid = segs.pop();
    const partPrefix = segs.pop(); // undefined for a generic PID.CELL key
    const claims = citationClaims(citation);
    if (!claims.length) { proseOnly++; continue; }

    // A generic entry only actually excuses a part that HAS the peripheral in the first
    // place - `excused()` is a bare table lookup and does not gate on that itself (only the
    // real matrix loop above does, by construction: it is only ever called from inside
    // `Object.entries(M.peripherals)`). Skipping this gate here would check `PIOC.params`
    // against every part with NO Object.entries(M.peripherals) NO peripheral called PIOC at
    // all, reporting a false "does not resolve" against parts the entry never actually
    // excuses anything on.
    const hasPid = part => { eng.loadMcu(eng.MCU_FILES[part]); return !!(eng.M.peripherals || {})[pid]; };
    const parts = partPrefix ? [partPrefix]
      : REAL_PARTS.filter(p => hasPid(p) && excused(p, pid, cell) === citation);
    if (!parts.length) {
      // A generic entry `excused()` never actually resolves for ANY real part is itself
      // suspicious (dead weight, or a typo'd pid) - named rather than silently skipped.
      problems.push(`${key}: no real part currently resolves this entry via lookup() - dead `
        + `or mistyped pid/cell`);
      continue;
    }
    for (const part of parts) {
      checkable++;
      if (!evtRootCache.has(part)) {
        eng.loadMcu(eng.MCU_FILES[part]);
        evtRootCache.set(part, ((eng.M.codegen || {}).sdk || {}).evt || null);
      }
      const evtRoot = evtRootCache.get(part);
      eng.loadMcu(eng.MCU_FILES[part]);
      const model = eng.M;
      for (const claim of claims) {
        if (claim.kind === 'data_path') {
          if (resolvePath(model, claim.path) === undefined) {
            problems.push(`${key} (${part}): "${claim.path}" does not resolve in ${part}'s `
              + `own loaded model - the citation names a location that is not there`);
          }
        } else {
          if (!evtRoot) {
            problems.push(`${key} (${part}): cites "${claim.text}" but ${part} has no `
              + `codegen.sdk.evt, so there is no source tree to check it against`);
            continue;
          }
          const matches = fileIndex(evtRoot).get(claim.file);
          if (matches && matches.length) {
            const longEnough = matches.some(f => fs.readFileSync(f, 'utf8').split('\n').length >= claim.lineEnd);
            if (!longEnough) {
              const lens = matches.map(f => fs.readFileSync(f, 'utf8').split('\n').length);
              problems.push(`${key} (${part}): "${claim.text}" cites line ${claim.lineEnd} but `
                + `${claim.file} has ${lens.join('/')} line(s) - out of range`);
            }
            continue;
          }
          // Not under THIS part's own tree. Two different things can be true, and they get
          // different treatment: the file exists under a SIBLING part's tree (this is the
          // DMA1/PIOC shape - a citation written against one part, silently reused for
          // another it was never checked against - a real failure), or it exists under NO
          // part's tree at all (a family-wide shorthand like `ch32v00X.h`, a deliberate
          // placeholder this repo's own citations use elsewhere and never a literal path -
          // noted, not failed, since the claim was never checkable to begin with).
          const elsewhere = evtRoots.filter(r => r !== evtRoot && fileIndex(r).get(claim.file)?.length);
          if (elsewhere.length) {
            problems.push(`${key} (${part}): "${claim.file}" (from "${claim.text}") does not `
              + `exist under data/sources/${evtRoot}, but DOES exist under `
              + `${elsewhere.map(r => `data/sources/${r}`).join(', ')} - likely written `
              + `against the wrong part`);
          } else {
            templated.push(`${key} (${part}): "${claim.text}" - "${claim.file}" is not a real `
              + `filename anywhere in data/sources (a family-wide placeholder, not checked)`);
          }
        }
      }
    }
  }
  console.log(`        ${Object.keys(ABSENT).length} ABSENT citation(s): ${checkable} `
    + `checkable-location instance(s) verified, ${proseOnly} prose-only (no checkable referent)`
    + `, ${templated.length} templated/placeholder filename(s) (not literally checkable).`);
  if (templated.length) for (const line of templated) console.log(`          - ${line}`);
  assert.empty(problems, 'ABSENT citations naming a location that does not resolve');
});

test('planted break: an ABSENT citation naming a location that does not exist is caught', () => {
  // Both directions, the same discipline every gate this round has needed. A real citation
  // (RCC.params, above) names nothing checkable and must not be flagged. A fabricated one,
  // naming a data_path guaranteed never to exist, must fail and name it.
  //
  // DELIBERATELY SYNTHETIC, not a real part's real gap (the DMA1.params shape this test
  // originally plants against, above): CH32H417 was the only part missing a dma: block, and
  // the moment DMA landed on it (2026-09-14) this plant's live target vanished - "no real
  // part currently lacks a dma: block" is the exact assertion that broke. A synthetic,
  // impossible-to-ever-be-real key name cannot go stale the same way: it tests the SAME
  // code path (citationClaims -> resolvePath -> "did not resolve") without depending on
  // which parts currently happen to lack which block.
  const claims = citationClaims('parameters live in the top-level dma.this_key_will_never_exist_xyz, not on the peripheral');
  assert.equal(claims.length, 1, 'the planted citation text should yield exactly one data_path claim');
  eng.loadMcu(eng.MCU_FILES['CH32H417']);
  const missingResolves = resolvePath(eng.M, claims[0].path) !== undefined;
  assert.notOk(missingResolves, `planted precondition failed: dma.this_key_will_never_exist_xyz DOES resolve on CH32H417 - the plant is not exercising a real gap`);

  const realClaims = citationClaims(ABSENT['RCC.params']);
  assert.equal(realClaims.length, 0, 'RCC.params was expected to be prose-only (no checkable referent) - if this now fails, RCC.params grew a checkable claim and this assertion is stale, not the code under test');

  console.log('      planted refusal (dead ABSENT referent): dma.this_key_will_never_exist_xyz does not resolve, reproducing the DMA1.params shape without depending on live cross-part drift');
});

// ---------------------------------------------------------------- how far a part may be soft
//
// `IN_EXTRACTION` lets a part that is being extracted print a cell with an owner instead of
// failing a shared gate, and `SOFT_CELLS` decides WHICH cells may be treated that way. That set
// is the widening risk the round-5 brief names: "it may soften `params` and `clock` only — never
// a setting, a pin or a chapter". A cell that gets added here silently stops being checked for
// every in-extraction part, and because those cells print rather than fail, the loss is invisible
// — the run gets quieter and stays green. So the set is pinned, and the pin is proven to bite.

/** Soft cells beyond `params` and `clock` — the ones that may never be excused. */
const ALLOWED_SOFT = new Set(['params', 'clock']);
function illegalSoftCells(cells) {
  return [...cells].filter(c => !ALLOWED_SOFT.has(c)).sort();
}

test('IN_EXTRACTION softens exactly params and clock, and no other cell', () => {
  assert.deep([...SOFT_CELLS].sort(), ['clock', 'params'],
    'SOFT_CELLS is the list of cells an in-extraction part may leave unchecked while printing '
    + 'them with an owner. It must be exactly {params, clock}: widening it turns a real check '
    + 'into a printed line for every in-extraction part, and because those cells only print, the '
    + 'loss does not show up as a failure. If a cell genuinely cannot be checked yet, that is an '
    + 'IN_EXTRACTION entry with a TASKS.md line — or an ABSENT declaration with a citation — not '
    + 'a wider soft set.');

  assert.empty(illegalSoftCells(SOFT_CELLS),
    'SOFT_CELLS contains cells beyond params and clock, so an in-extraction part stops being '
    + 'checked on them');

  // The two other cells this matrix produces, named individually: a `settings` cell is "the user
  // cannot switch this peripheral on" and an `nvic` cell is "no vector names it". Neither is a
  // depth gap, and softening either would hide a peripheral that does nothing.
  for (const cell of ['settings', 'nvic', 'pins', 'chapter', 'routed']) {
    assert.ok(!SOFT_CELLS.has(cell),
      `IN_EXTRACTION must never soften a \`${cell}\` cell — that is a peripheral the user cannot `
      + 'use reported as work-in-progress');
  }
});

test('the soft-cell pin can fail: a widened SOFT_CELLS is caught', () => {
  // Planted breaks, run every time. The check above compares a set against two literals, and a
  // comparison that could not fail would pass on any widening — which is the exact edit it
  // exists to stop, and the likeliest one to arrive as "just add it, CH32H417 needs it".
  assert.deep(illegalSoftCells(new Set(['params', 'clock', 'settings'])), ['settings'],
    'a widened set that softens `settings` is not caught');
  assert.deep(illegalSoftCells(new Set(['params', 'clock', 'nvic', 'pins'])), ['nvic', 'pins'],
    'a widened set that softens pin and vector cells is not caught');
  assert.deep(illegalSoftCells(new Set(['params', 'clock', 'chapter'])), ['chapter'],
    'a widened set that softens a chapter cell is not caught');
  // …and the real set reports nothing, or the check above fails on correct data.
  assert.empty(illegalSoftCells(SOFT_CELLS), 'the shipped SOFT_CELLS is reported as illegal');
});

test('every signal a peripheral routes can be claimed by one of its settings', () => {
  // A `signal_pins:` row the settings never name is a pad with NO WAY TO ASSIGN IT. The
  // engine derives every claim from the settings (`requiredSignals()`), so the pin grid
  // cannot offer it, the conflict engine never sees it, and the generated C never muxes
  // it — the row is decoration.
  //
  // This is a different question from the matrix above, which asks whether a peripheral
  // has A setting. A peripheral with one setting that names one signal passes that check
  // and fails this one, which is exactly what CH32H417's ADC looked like on 2026-09-12:
  // it offered `Channel 0 (IN0)` and `Channel 4 (IN4)` out of sixteen routes, so fourteen
  // ADC pins were unreachable, ADC2 had none at all, and `FMC`, `UHSIF` and `SERDES`
  // claimed no pin whatsoever — 167 dead rows in one part.
  //
  // The two exemptions ARE the rules, not a place to hide a failure:
  //   * `codegen.skip_signals` — pins codegen must not touch (the SWD pair, the HSE
  //     crystal). They are claimed by the debug interface or by `clock.hse_*`, not by a
  //     setting, so no setting may name them.
  //   * a signal only the clock tree claims, which is how RCC's XI/XO work.
  const missing = [];
  for (const part of REAL_PARTS) {
    eng.loadMcu(eng.MCU_FILES[part]);
    const M = eng.M;
    // V003/V005/V006/X035 move whole peripherals with a `remaps:` index rather than
    // per-pin, and this question only applies to a per-pin AF map.
    const skip = new Set(Object.keys((M.codegen || {}).skip_signals || {}));
    for (const [pid, P] of Object.entries(M.peripherals || {})) {
      const sigs = Object.keys((P || {}).signal_pins || {});
      if (!sigs.length || skip.has(pid)) continue;
      const claimed = new Set();
      for (const s of P.settings || []) {
        for (const c of s.choices || []) for (const x of c.signals || []) claimed.add(x);
      }
      const dead = sigs.filter(s => !claimed.has(s));
      if (dead.length) {
        missing.push(`${part}  ${pid}: ${dead.length} of ${sigs.length} routed signal(s) no `
          + `setting names, so they cannot be assigned: ${dead.slice(0, 8).join(', ')}`
          + (dead.length > 8 ? ` … +${dead.length - 8}` : ''));
      }
    }
  }
  assert.empty(missing, 'signals with a pin that no setting can reach');
});

test('the reachability check can fail: a signal no setting names is caught', () => {
  // Planted break, run every time. The check above is a set difference, and a set
  // difference that silently matched nothing would pass on exactly the data it exists to
  // reject — which is what the version that dropped the `type:` key did.
  const P = {
    signal_pins: { TX: [{ pin: 'PA9' }], RX: [{ pin: 'PA10' }] },
    settings: [{ name: 'Mode', choices: [{ name: 'Disable' }, { name: 'On', signals: ['TX'] }] }],
  };
  const claimed = new Set();
  for (const s of P.settings) for (const c of s.choices) for (const x of c.signals || []) claimed.add(x);
  const dead = Object.keys(P.signal_pins).filter(s => !claimed.has(s));
  assert.deep(dead, ['RX'], 'the check does not notice a routed signal no setting names');
  // …and does not invent one when every signal IS named.
  P.settings[0].choices[1].signals = ['TX', 'RX'];
  const claimed2 = new Set();
  for (const s of P.settings) for (const c of s.choices) for (const x of c.signals || []) claimed2.add(x);
  assert.empty(Object.keys(P.signal_pins).filter(s => !claimed2.has(s)),
    'the check reports a gap when every signal is named');
});

/** The IN_EXTRACTION entries whose TASKS.md line is no longer OPEN, with the reason. */
function expiredExemptions(tasksText) {
  const out = [];
  for (const [part, [owner, task]] of Object.entries(IN_EXTRACTION)) {
    if (!eng.MCU_FILES[part]) { out.push(`${part} is declared in-extraction but is not a registered part`); continue; }
    const state = taskState(tasksText, task);
    if (state === 'missing') {
      out.push(`${part} is declared in-extraction citing ${owner}'s task "${task}", which is no longer in TASKS.md `
        + '— if the extraction is finished, delete the IN_EXTRACTION entry and let the cells fail');
    } else if (state === 'ticked') {
      out.push(`${part}'s IN_EXTRACTION line "${task}" is TICKED in TASKS.md — the exemption has expired. `
        + 'Delete the entry; every cell it excused now fails until it is filled or declared ABSENT');
    }
  }
  return out;
}

test('every part declared in-extraction still has a live, UNTICKED TASKS.md line', () => {
  // The guard that makes IN_EXTRACTION self-closing. Without it, a part could sit "in
  // extraction" forever and quietly stop being checked — and until 2026-09-12 that is what
  // it did: only a DELETED line closed it, and lines are ticked, never deleted.
  assert.empty(expiredExemptions(fs.readFileSync(TASKS_PATH, 'utf8')),
    'parts held in-extraction whose backlog line is gone or ticked');
});

test('planted break: ticking an IN_EXTRACTION line in TASKS.md expires the exemption and the cells fail', async () => {
  // Round 6, deliverable B. A COPY of TASKS.md with CH32H417's line ticked - the real file is
  // never touched - then three things must be true: taskState() reads it as ticked, the guard
  // above names the expiry, and the matrix, run in a child process against that copy, goes RED
  // on the cells the exemption used to excuse. The third is the one that matters: it is the
  // promise the exemption made on the day it was written, seen kept.
  const part = 'CH32H417';
  const [, phrase] = IN_EXTRACTION[part];
  const real = fs.readFileSync(TASKS_PATH, 'utf8');
  assert.equal(taskState(real, phrase), 'open', `the baseline TASKS.md line for ${part} is not open, so ticking it proves nothing`);

  const ticked = withMutantFile(TASKS_PATH, text => {
    const items = text.split(/\n(?=- \[[ x~\-]\])/);
    const words = phrase.replace(/[`:*]/g, '').split(/[\s,]+/).filter(w => w.length > 3);
    const i = items.findIndex(it => words.every(w => it.replace(/[`:*]/g, '').includes(w)));
    if (i < 0) return text;
    items[i] = items[i].replace(/^- \[[ ~]\]/, '- [x]');
    return items.join('\n');
  });
  const tickedText = fs.readFileSync(ticked, 'utf8');
  assert.equal(taskState(tickedText, phrase), 'ticked', 'taskState() did not read the ticked copy as ticked');
  const expired = expiredExemptions(tickedText);
  assert.ok(expired.some(e => e.startsWith(`${part}'s IN_EXTRACTION line`) && /expired/.test(e)),
    `the guard did not report the expiry:\n${expired.join('\n') || '(nothing)'}`);
  console.log(`      planted refusal (IN_EXTRACTION expiry): ${expired.find(e => /expired/.test(e)).split('. ')[0]}`);

  // The matrix, for real, against the ticked copy. Only the matrix test is run, in a child
  // so this process's own TASKS_PATH stays what it was.
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'run.js'), 'has settings, params, a clock bit, and vectors'],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, WCHCUBE_TASKS_MD: ticked }, maxBuffer: 32 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.notEqual(r.status, 0, 'the matrix passed with the exemption expired — the cells it excused did not fail');
  assert.match(out, /IN_EXTRACTION for CH32H417 has expired/, `the matrix's failure does not say the exemption expired:\n${out.slice(-1500)}`);
  // NOT a count of the printed `CH32H417  <pid>: (params|clock) —` bullet lines: `assert.empty`
  // (tests/lib/harness.js) shows at most 40 of them and appends "... and N more", and the
  // runner's own failure printer then caps the whole body at 45 LINES on top of that - so a
  // bullet-line regex silently reads a DISPLAY LIMIT as the count (found AGENT-1, STATUS §3,
  // 2026-09-13T00:33Z: this printed "40" the day CH32H417's real total was higher).
  // `assert.empty` puts the TRUE, untruncated `list.length` in its own message header before
  // any of that truncation happens, and — because the untouched suite is ALL GREEN (§1: 0
  // failures across every part before this plant) — every cell that header counts here is one
  // this plant caused, so the header total IS the exact CH32H417 count, not an approximation.
  const total = out.match(/peripheral cells that are neither filled in nor declared absent in ABSENT \((\d+)\)/);
  assert.ok(total, `expected assert.empty's own untruncated count in its message header, found:\n${out.slice(-1500)}`);
  const cells = Number(total[1]);
  assert.ok(cells >= 1, `expected the excused cells to be listed as failures, found ${cells}:\n${out.slice(-1500)}`);
  console.log(`      planted refusal (matrix): ${cells} CH32H417 cell(s) failed once the line was ticked`);
});

test('every cell parked in OPEN still has a live TASKS.md line', () => {
  // The check that keeps OPEN honest. Park something here and delete its backlog
  // line and this goes red — otherwise OPEN is just ABSENT without the citation.
  const tasks = fs.readFileSync(path.join(ROOT, 'TASKS.md'), 'utf8');
  const orphans = [];
  for (const [cell, [owner, line]] of Object.entries(OPEN)) {
    // Match on the distinctive words of the task line, not the whole string:
    // TASKS.md wraps, and a wrapped line must not read as a deleted one.
    const words = line.replace(/[`:]/g, '').split(/[\s,]+/).filter(w => w.length > 3);
    const present = words.every(w => tasks.includes(w));
    if (!present) orphans.push(`${cell} is parked in OPEN citing ${owner}'s task "${line}", which is no longer in TASKS.md`);
  }
  assert.empty(orphans, 'OPEN entries whose backlog line has gone');
});

test('every DMA request the data lists is owned by a peripheral that exists', () => {
  const bad = [];
  for (const part of REAL_PARTS) {
    eng.loadMcu(eng.MCU_FILES[part]);
    const reqs = (eng.M.dma || {}).requests || {};
    if (!Object.keys(reqs).length) continue;
    for (const [ch, list] of Object.entries(reqs)) {
      for (const sig of [].concat(list)) {
        const owner = String(sig).split('_')[0];
        if (!eng.M.peripherals[owner]) {
          bad.push(`${part}  DMA1 channel ${ch}: request "${sig}" names ${owner}, which is not a peripheral of this part`);
        }
      }
    }
  }
  assert.empty(bad, 'DMA requests naming a peripheral the part does not have');
});

test('every peripheral with a DMA request can actually be switched on', () => {
  // The inverse of the test above: a request map that mentions a peripheral the
  // user cannot enable is a dead row in the DMA tab.
  const bad = [];
  for (const part of REAL_PARTS) {
    eng.loadMcu(eng.MCU_FILES[part]);
    const reqs = (eng.M.dma || {}).requests || {};
    if (!Object.keys(reqs).length) continue;
    const owners = new Set();
    for (const list of Object.values(reqs)) {
      for (const sig of [].concat(list)) owners.add(String(sig).split('_')[0]);
    }
    for (const pid of owners) {
      const P = eng.M.peripherals[pid];
      if (!P) continue;                                  // reported by the test above
      if (!(P.settings || []).some(s => s.type === 'checkboxes' || (s.choices || []).length > 1)) {
        bad.push(`${part}  ${pid} has DMA requests but no setting that turns it on`);
      }
    }
  }
  assert.empty(bad, 'peripherals with DMA requests that cannot be enabled');
});

test('generated C emits an init block for every peripheral that claims a pin', () => {
  // The end of the chain: a peripheral can have settings, params, a clock bit and
  // a vector and STILL be invisible in the output. Enable each one in turn, put
  // its signals on pins, and look for it in the generated source.
  const missing = [];
  for (const part of REAL_PARTS) {
    eng.loadMcu(eng.MCU_FILES[part]);
    if (!Object.keys(eng.M.codegen || {}).length) continue;
    const pkg = eng.M.mcu.default_package || Object.keys(eng.M.packages)[0];

    for (const [pid, P] of Object.entries(eng.M.peripherals)) {
      // Turn it on through the first setting that has a non-neutral choice.
      eng.loadMcu(eng.MCU_FILES[part]);
      eng.setPackage(pkg);
      const s = (P.settings || []).find(x => x.type !== 'checkboxes' && (x.choices || []).length > 1);
      if (!s) continue;
      const neutral = eng.neutralChoice(s);
      const on = s.choices.find(c => c !== neutral && (c.signals || []).length);
      if (!on) continue;                                 // nothing that claims a pin
      try { eng.setSetting(pid, s.name, on.name); } catch { continue; }

      const E = eng.compute();
      if (E.conflictList.length) continue;               // this part/package cannot host it alone
      const claimed = eng.pinRows().filter(r => r.signal && r.signal.startsWith(pid + '_'));
      if (!claimed.length) continue;                     // the remap put it on no pin of this package

      const c = eng.cFiles()['wchcube_init.c'] || '';
      const named = claimed.some(r => c.includes(r.signal));
      if (!named) {
        missing.push(`${part}  ${pid}: enabled and holding ${claimed.map(r => r.pin || r.signal).join(', ')}, `
          + 'but no line of the generated C mentions any of its signals');
      }
    }
  }
  assert.empty(missing, 'peripherals that reach no generated code even when they hold a pin');
});

// ---------------------------------------------------------------- RM coverage
/**
 * RM chapter → what models it, for the CH32V00X family.
 *
 * A chapter is either mapped to peripherals in the MCU file, or listed with the
 * reason it is not a peripheral — quoted from `data/mcus/CH32V006.notes.md`,
 * "Round 2: PWR, FLASH and EXTI added as real peripherals". The map is checked
 * against the chapter headings read out of the RM at run time, so this cannot
 * drift from the document it claims to cover.
 */
const RM_CHAPTERS = {
  1:  { not_a_peripheral: 'memory and bus architecture — the map, not a unit' },
  2:  { peripherals: ['PWR'] },
  3:  { peripherals: ['RCC'] },
  4:  { peripherals: ['IWDG'] },
  5:  { peripherals: ['WWDG'] },
  6:  { peripherals: ['EXTI'], not_a_peripheral: 'notes.md: "PFIC (ch.6) is the `nvic:` block rather than a tree entry"; EXTI is ch.6.4 and IS a peripheral' },
  7:  { not_a_peripheral: 'notes.md: "GPIO/AFIO (ch.7) is the pin grid itself"' },
  8:  { peripherals: ['DMA1'] },
  9:  { peripherals: ['ADC1'] },
  10: { peripherals: ['TKEY'] },
  11: { peripherals: ['TIM1'] },
  12: { peripherals: ['TIM2'] },
  13: { peripherals: ['TIM3'] },
  14: { peripherals: ['USART1', 'USART2'] },
  15: { peripherals: ['I2C1'] },
  16: { peripherals: ['SPI1'] },
  17: { peripherals: ['OPA1'] },
  18: { peripherals: ['FLASH'] },
  19: { not_a_peripheral: 'notes.md: "ESIG (ch.19) is read-only silicon identity"' },
  // Found by this test. Not modelled, and NOT one of the four deliberate absences
  // CH32V006.notes.md declares — an undeclared fifth. Now tracked in TASKS.md and
  // owned, so it prints rather than failing; see OPEN above for why.
  // Found uncovered by this test in round 3, and AGENT-1 MODELLED it rather than
  // whitelisting it — the right call, because TIM2_DMA_REMAP moves TIM2_CH4's DMA
  // request onto the update channel, which changes the dma.requests map this app
  // renders. It was never cosmetic.
  20: { peripherals: ['EXTEN'] },
  21: { not_a_peripheral: 'notes.md: "DBG (ch.21) is covered by SYS\'s debug setting"' },
};

/** Chapter numbers and titles, read out of the reference manual. */
function rmChapters() {
  const rm = path.join(ROOT, 'data', 'sources', 'V006', 'Datasheets', 'CH32V00XRM.md');
  if (!fs.existsSync(rm)) return null;
  const out = new Map();
  for (const line of fs.readFileSync(rm, 'utf8').split(/\r?\n/)) {
    const m = /^#*\s*Chapter (\d+)\s+(.+?)\s*$/.exec(line);
    if (m && !out.has(Number(m[1]))) out.set(Number(m[1]), m[2]);
  }
  return out;
}

test('the RM chapter list is accounted for, chapter by chapter', () => {
  const chapters = rmChapters();
  if (!chapters) skip('data/sources/V006/Datasheets/CH32V00XRM.md is not present, so the chapter list cannot be read');
  assert.ok(chapters.size >= 20, `only ${chapters.size} chapters parsed out of the RM — the heading format changed`);

  eng.loadMcu(eng.MCU_FILES.CH32V006);
  const have = eng.M.peripherals;
  const problems = [], openChapters = [];

  for (const [n, title] of chapters) {
    const entry = RM_CHAPTERS[n];
    if (!entry) { problems.push(`RM chapter ${n} "${title}" is not accounted for at all — map it or declare it`); continue; }
    if (entry.open) {
      const [owner, what, why] = entry.open;
      openChapters.push(`RM chapter ${n} "${title}": ${what} — ${owner} owns it. ${why}`);
      continue;
    }
    for (const pid of entry.peripherals || []) {
      if (!have[pid]) problems.push(`RM chapter ${n} "${title}" maps to ${pid}, which CH32V006 does not have`);
    }
  }
  // And the other direction: a mapping for a chapter the RM no longer has.
  for (const n of Object.keys(RM_CHAPTERS)) {
    if (!chapters.has(Number(n))) problems.push(`RM_CHAPTERS names chapter ${n}, which this RM does not contain`);
  }
  if (openChapters.length) {
    process.stdout.write(`        ${openChapters.length} RM chapter(s) known-uncovered and tracked:\n`);
    for (const line of openChapters) process.stdout.write(`          - ${line}\n`);
  }
  assert.empty(problems, 'reference-manual chapters not covered by the MCU data');
});

test('every RM chapter parked as open still has a live TASKS.md line', () => {
  // Same guard as for OPEN cells: an uncovered chapter may only stop failing
  // because someone owns it, and ownership means a backlog line that exists.
  // The chapter-20 version of this hardcoded "RM chapter 20" and "EXTEN", which
  // stopped meaning anything the moment AGENT-1 modelled it. An `open` entry now
  // carries the backlog phrase it is claiming, and the guard checks THAT — so the
  // next uncovered chapter is guarded the same way without anyone editing this.
  const tasks = fs.readFileSync(path.join(ROOT, 'TASKS.md'), 'utf8');
  const orphans = [];
  for (const [n, entry] of Object.entries(RM_CHAPTERS)) {
    if (!entry.open) continue;
    const [owner, what, , task] = entry.open;
    if (!task) {
      orphans.push(`RM chapter ${n} is parked as open ("${what}") but names no TASKS.md line to check`);
    } else if (!tasks.includes(task)) {
      orphans.push(`RM chapter ${n} is parked as open citing ${owner}'s task "${task}", which is no longer in TASKS.md`);
    }
  }
  assert.empty(orphans, 'RM chapters parked as open with no backlog line');
});

test('every peripheral in the MCU file belongs to an RM chapter', () => {
  // The inverse sweep: a peripheral nobody can point at a chapter for is either
  // invented or misnamed, and either way it will generate code for nothing.
  eng.loadMcu(eng.MCU_FILES.CH32V006);
  const mapped = new Set();
  for (const e of Object.values(RM_CHAPTERS)) for (const pid of e.peripherals || []) mapped.add(pid);
  const orphans = Object.keys(eng.M.peripherals).filter(pid => !mapped.has(pid) && pid !== 'SYS');
  assert.empty(orphans.map(p => `${p} is in the MCU file but no RM chapter is mapped to it`),
    'peripherals with no reference-manual chapter behind them');
});
