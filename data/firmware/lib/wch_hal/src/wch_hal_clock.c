#include "wch_hal_clock.h"

uint32_t wch_hal_clock_sysclk_hz(void)
{
    /* The function is not called the same thing on every family. CH32H417's System/
     * folder declares `SystemAndCoreClockUpdate` (system_ch32h417.h:25) because that
     * part has TWO cores and the call refreshes both SystemCoreClock and the core
     * clock; every other family here declares `SystemCoreClockUpdate`. Calling the
     * wrong one is a link error, not a silent wrong answer, which is the one mercy
     * in this class of difference. */
#if defined(WCH_HAL_SERIES_CH32H417)
    SystemAndCoreClockUpdate();
#else
    SystemCoreClockUpdate();
#endif
    return SystemCoreClock;
}

void wch_hal_clock_get(wch_hal_clocks_t *out)
{
    RCC_ClocksTypeDef c = {0};

    if (out == 0) {
        return;
    }

    RCC_GetClocksFreq(&c);
    out->sysclk_hz = c.SYSCLK_Frequency;
    out->hclk_hz   = c.HCLK_Frequency;

    /* RCC_ClocksTypeDef is NOT the same struct on every family, and this is the
     * second member set that differs rather than the first. CH32H417's has
     * SYSCLK / HCLK / **Core** / ADCCLK (ch32h417_rcc.h:21-27) and NO PCLK1 or
     * PCLK2 at all, so naming them here would not compile. CH32X035's has no
     * ADCCLK, which is why the block below already existed. A member a part does
     * not have is reported as unknown, never as zero-that-looks-like-a-reading. */
#if defined(WCH_HAL_SERIES_CH32H417)
    out->pclk1_hz  = 0u;
    out->pclk2_hz  = 0u;
#else
    out->pclk1_hz  = c.PCLK1_Frequency;
    out->pclk2_hz  = c.PCLK2_Frequency;
#endif

#if defined(WCH_HAL_SERIES_CH32V00XX) || defined(WCH_HAL_SERIES_CH32H417)
    out->adcclk_hz    = c.ADCCLK_Frequency;
    out->adcclk_known = 1u;
#else
    out->adcclk_hz    = 0u;
    out->adcclk_known = 0u;
#endif
}
