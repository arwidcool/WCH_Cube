#include "wch_hal_gpio.h"

/* The port -> clock-enable mapping is per series and is NOT guessable:
 *   CH32V00Xx  ports A B C D, register RCC_PB2PCENR, SPL fn RCC_PB2PeriphClockCmd
 *              (the register really is spelled "PB2" on this family — CH32V00X
 *              RM v1.4 §3.4.7, R32_RCC_PB2PCENR at 0x40021018)
 *   CH32X035   ports A B C only, SPL fn RCC_APB2PeriphClockCmd
 * Falling off the end returns -1 rather than enabling "something close". */
static int port_clock(const GPIO_TypeDef *port, FunctionalState state)
{
#if defined(WCH_HAL_SERIES_CH32V00XX)
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
