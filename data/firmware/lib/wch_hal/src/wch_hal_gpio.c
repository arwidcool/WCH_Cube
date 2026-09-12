#include "wch_hal_gpio.h"

/* The port -> clock-enable mapping is per series and is NOT guessable:
 *   CH32V003   ports A C D only — ch32v00x.h defines GPIOA/GPIOC/GPIOD and no
 *              GPIOB at all, and ch32v00x_rcc.h defines RCC_APB2Periph_GPIOA at
 *              :87, _GPIOC at :88, _GPIOD at :89 and _AFIO at :86. Falling off
 *              the end returns -1 rather than "enable something close".
 *   CH32V00Xx  ports A B C D, register RCC_PB2PCENR, SPL fn RCC_PB2PeriphClockCmd
 *              (the register really is spelled "PB2" on this family — CH32V00X
 *              RM v1.4 §3.4.7, R32_RCC_PB2PCENR at 0x40021018)
 *   CH32X035   ports A B C only, SPL fn RCC_APB2PeriphClockCmd
 *   CH32H417   ports A B C D E F — SIX, more than any other family here — in
 *              RCC_HB2PCENR, SPL fn RCC_HB2PeriphClockCmd. Note the spelling:
 *              HB2, not PB2 and not APB2. That is the FOURTH name this same idea
 *              has across four families (ch32h417_rcc.h:248-255, :650).
 */
static int port_clock(const GPIO_TypeDef *port, FunctionalState state)
{
#if defined(WCH_HAL_SERIES_CH32V003)
    uint32_t bit;
    if      (port == GPIOA) bit = RCC_APB2Periph_GPIOA;
    else if (port == GPIOC) bit = RCC_APB2Periph_GPIOC;
    else if (port == GPIOD) bit = RCC_APB2Periph_GPIOD;
    else return -1;
    RCC_APB2PeriphClockCmd(bit, state);
    return 0;
#elif defined(WCH_HAL_SERIES_CH32V00XX)
    uint32_t bit;
    if      (port == GPIOA) bit = RCC_PB2Periph_GPIOA;
    else if (port == GPIOB) bit = RCC_PB2Periph_GPIOB;
    else if (port == GPIOC) bit = RCC_PB2Periph_GPIOC;
    else if (port == GPIOD) bit = RCC_PB2Periph_GPIOD;
    else return -1;
    RCC_PB2PeriphClockCmd(bit, state);
    return 0;
#elif defined(WCH_HAL_SERIES_CH32X035)
    uint32_t bit;
    if      (port == GPIOA) bit = RCC_APB2Periph_GPIOA;
    else if (port == GPIOB) bit = RCC_APB2Periph_GPIOB;
    else if (port == GPIOC) bit = RCC_APB2Periph_GPIOC;
    else return -1;
    RCC_APB2PeriphClockCmd(bit, state);
    return 0;
#elif defined(WCH_HAL_SERIES_CH32H417)
    uint32_t bit;
    if      (port == GPIOA) bit = RCC_HB2Periph_GPIOA;
    else if (port == GPIOB) bit = RCC_HB2Periph_GPIOB;
    else if (port == GPIOC) bit = RCC_HB2Periph_GPIOC;
    else if (port == GPIOD) bit = RCC_HB2Periph_GPIOD;
    else if (port == GPIOE) bit = RCC_HB2Periph_GPIOE;
    else if (port == GPIOF) bit = RCC_HB2Periph_GPIOF;
    else return -1;
    RCC_HB2PeriphClockCmd(bit, state);
    return 0;
#else
    /* No branch matched. Previously this fell off the end of a non-void function,
     * which is a warning and undefined behaviour rather than a build failure - so
     * a new family reached the linker with a port_clock that returned garbage.
     * Fail at COMPILE time instead, naming what is missing. */
    (void)port; (void)state;
#  error "wch_hal: no GPIO port clock mapping for this series. Add it above, reading the port list and the RCC_*PeriphClockCmd spelling from this part's headers."
#endif
}

int wch_hal_gpio_clock_enable(const GPIO_TypeDef *port)
{
    return port_clock(port, ENABLE);
}

int wch_hal_gpio_config(GPIO_TypeDef *port, uint16_t pin_mask, GPIOMode_TypeDef mode)
{
    GPIO_InitTypeDef init = {0};

    if (wch_hal_gpio_clock_enable(port) != 0) {
        return -1;
    }

    init.GPIO_Pin   = pin_mask;
    init.GPIO_Mode  = mode;
    init.GPIO_Speed = WCH_HAL_GPIO_SPEED_MAX;   /* the only speed there is */
    GPIO_Init(port, &init);
    return 0;
}

void wch_hal_gpio_write(GPIO_TypeDef *port, uint16_t pin_mask, int high)
{
    /* BSHR sets in the low half and clears in the high half, so this is one
     * atomic store either way — no read-modify-write, no lost update if an
     * interrupt touches another pin of the same port in between. */
    if (high) {
        GPIO_SetBits(port, pin_mask);
    } else {
        GPIO_ResetBits(port, pin_mask);
    }
}

void wch_hal_gpio_toggle(GPIO_TypeDef *port, uint16_t pin_mask)
{
    port->OUTDR ^= pin_mask;
}

uint8_t wch_hal_gpio_read(const GPIO_TypeDef *port, uint16_t pin_mask)
{
    return (port->INDR & pin_mask) ? 1u : 0u;
}
