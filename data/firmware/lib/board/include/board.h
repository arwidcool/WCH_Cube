/* ---------------------------------------------------------------------------
 *  board.h — board support package.
 *
 *  THE RULE FOR THIS FILE: every line is a claim about physical hardware, and a
 *  claim with no source is a bug. The parts this project targets are generic
 *  chips, not a named development board with a published schematic, so almost
 *  nothing is known here beyond what the PlatformIO board file states:
 *
 *      genericCH32V006F8P6   CH32V006, TSSOP20, 62 KB flash, 8 KB SRAM,
 *                            48 MHz from HSI+PLL, flashed over WCH-Link
 *
 *  That is why there is no LED pin, no button pin and no UART pin map below.
 *  Nothing is wired to those chips until someone wires it. If your board has an
 *  LED, say so in platformio.ini (see BOARD_HAS_LED) — do not add a "probably
 *  PD4" here.
 * ------------------------------------------------------------------------- */
#ifndef BOARD_H
#define BOARD_H

#include "wch_hal.h"

#ifdef __cplusplus
extern "C" {
#endif

/* -- Optional user LED ------------------------------------------------------
 *  Off by default because no LED is known to exist. To enable, add to your
 *  environment in platformio.ini (example for an LED on PD4, active high):
 *
 *      build_flags =
 *          ${env.build_flags}
 *          -D BOARD_HAS_LED
 *          -D BOARD_LED_PORT=GPIOD
 *          -D BOARD_LED_PIN=GPIO_Pin_4
 *          -D BOARD_LED_ACTIVE_HIGH=1
 *
 *  With BOARD_HAS_LED set but a pin missing, the build fails in board.c rather
 *  than quietly driving pin 0.
 * ------------------------------------------------------------------------- */

/* Bring up the minimum the rest of the firmware assumes:
 *   - SystemCoreClock refreshed from the RCC registers
 *   - Delay_Init() so Delay_Ms()/Delay_Us() work
 *   - printf() routed to the WCH-Link debug channel when SDI_PRINT=1
 *   - the user LED configured as an output, if one was declared
 * Safe to call once, early, from main(). */
void board_init(void);

/* Human-readable identity of what we were built for, for the banner. */
const char *board_name(void);

/* User LED. When no LED is declared these are still callable and do nothing —
 * board_has_led() tells you which world you are in, so application code does
 * not need #ifdefs. */
int  board_has_led(void);
void board_led_set(int on);
void board_led_toggle(void);

#ifdef __cplusplus
}
#endif

#endif /* BOARD_H */
