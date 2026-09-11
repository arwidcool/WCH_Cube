/* ---------------------------------------------------------------------------
 *  wch_hal_gpio.h — GPIO, as the part actually implements it.
 *
 *  Deliberately NOT a portable "speed" abstraction. On both series this project
 *  builds for, the GPIO output driver has exactly ONE speed setting:
 *
 *    CH32V00Xx  GPIOx_CFGLR MODEy is a single bit — "1: output mode, maximum
 *               speed 30MHz; 0: input mode" (CH32V00X RM v1.4, §7.3.1.1), and
 *               the SPL enum GPIOSpeed_TypeDef has one member,
 *               GPIO_Speed_30MHz.
 *    CH32X035   the SPL enum has one member, GPIO_Speed_50MHz.
 *
 *  So there is no Low/Medium/High to pick, and this header does not pretend
 *  there is. WCH_HAL_GPIO_SPEED_MAX is the only value the hardware offers.
 * ------------------------------------------------------------------------- */
#ifndef WCH_HAL_GPIO_H
#define WCH_HAL_GPIO_H

#include "wch_hal_soc.h"

#ifdef __cplusplus
extern "C" {
#endif

#if defined(WCH_HAL_SERIES_CH32V00XX)
#  define WCH_HAL_GPIO_SPEED_MAX GPIO_Speed_30MHz
#elif defined(WCH_HAL_SERIES_CH32X035)
#  define WCH_HAL_GPIO_SPEED_MAX GPIO_Speed_50MHz
#endif

/* Enable the port's peripheral clock. Returns 0 on success, -1 if the port is
 * not one this build knows about (which is a programming error, not a runtime
 * condition — the caller passed a GPIO_TypeDef* that does not exist here). */
/* `port` is const because it is used only as an identity here: the bit that
 * gets set lives in RCC, not in the port. */
int wch_hal_gpio_clock_enable(const GPIO_TypeDef *port);

/* Configure one or more pins of a port. `mode` is a vendor GPIOMode_TypeDef
 * (GPIO_Mode_Out_PP, GPIO_Mode_IPU, GPIO_Mode_AF_PP, GPIO_Mode_AIN, ...).
 * The port clock is enabled for you; everything else is passed straight to
 * GPIO_Init(). */
int wch_hal_gpio_config(GPIO_TypeDef *port, uint16_t pin_mask, GPIOMode_TypeDef mode);

/* Level access. `pin_mask` may name several pins for write/set/clear; read and
 * toggle act on the mask as a whole (toggle inverts every named pin). */
void    wch_hal_gpio_write(GPIO_TypeDef *port, uint16_t pin_mask, int high);
void    wch_hal_gpio_toggle(GPIO_TypeDef *port, uint16_t pin_mask);
uint8_t wch_hal_gpio_read(const GPIO_TypeDef *port, uint16_t pin_mask);

#ifdef __cplusplus
}
#endif

#endif /* WCH_HAL_GPIO_H */
