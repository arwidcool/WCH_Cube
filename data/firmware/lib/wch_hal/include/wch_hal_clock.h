/* ---------------------------------------------------------------------------
 *  wch_hal_clock.h — read back the clock tree the startup code set up.
 *
 *  This header does NOT configure clocks. On this framework the system clock is
 *  chosen at BUILD time: the board file's `build.clock_source` and
 *  `build.f_cpu` become a SYSCLK_FREQ_* macro (see the platform's
 *  builder/frameworks/common_clk_config.py) and the SDK's SystemInit() applies
 *  it before main() runs.
 *
 *  Runtime clock configuration is what the configurator generates:
 *  WCHCube_RCC_Init() in wchcube_init.c. If both are present the generated
 *  function runs second and wins. See ../../ARCHITECTURE.md, "Two clock owners".
 * ------------------------------------------------------------------------- */
#ifndef WCH_HAL_CLOCK_H
#define WCH_HAL_CLOCK_H

#include "wch_hal_soc.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint32_t sysclk_hz;
    uint32_t hclk_hz;
    uint32_t pclk1_hz;
    uint32_t pclk2_hz;

    /* The ADC clock is NOT reported by every series. CH32V00Xx's
     * RCC_ClocksTypeDef carries ADCCLK_Frequency; CH32X035's does not, because
     * its ADC clock does not come off a CFGR prescaler the SPL can read back.
     * `adcclk_known` says which of the two you are holding, so a caller never
     * prints a zero as if it were a measurement. */
    uint32_t adcclk_hz;
    uint8_t  adcclk_known;
} wch_hal_clocks_t;

/* Refresh SystemCoreClock from the RCC registers and return it. */
uint32_t wch_hal_clock_sysclk_hz(void);

/* Every branch the SPL can report, straight from RCC_GetClocksFreq(). */
void wch_hal_clock_get(wch_hal_clocks_t *out);

#ifdef __cplusplus
}
#endif

#endif /* WCH_HAL_CLOCK_H */
