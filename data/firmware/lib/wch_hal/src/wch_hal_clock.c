#include "wch_hal_clock.h"

uint32_t wch_hal_clock_sysclk_hz(void)
{
    SystemCoreClockUpdate();
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
    out->pclk1_hz  = c.PCLK1_Frequency;
    out->pclk2_hz  = c.PCLK2_Frequency;

#if defined(WCH_HAL_SERIES_CH32V00XX)
    out->adcclk_hz    = c.ADCCLK_Frequency;
    out->adcclk_known = 1u;
#else
    out->adcclk_hz    = 0u;
    out->adcclk_known = 0u;
#endif
}
