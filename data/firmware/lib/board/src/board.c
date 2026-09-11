#include "board.h"

#if defined(BOARD_HAS_LED)
#  if !defined(BOARD_LED_PORT) || !defined(BOARD_LED_PIN)
#    error "BOARD_HAS_LED is set but BOARD_LED_PORT and/or BOARD_LED_PIN are not. \
See the comment in board.h — an LED pin has to come from your schematic."
#  endif
#  if !defined(BOARD_LED_ACTIVE_HIGH)
#    define BOARD_LED_ACTIVE_HIGH 1
#  endif
#endif

/* BOARD_NAME is set per environment in platformio.ini (-D BOARD_NAME=...).
 * There is no sensible default: a board this file cannot name is a board it
 * knows nothing about, and it should say so rather than guess. */
#ifndef BOARD_NAME
#  define BOARD_NAME unnamed-board
#endif

#define BOARD_STR2(x) #x
#define BOARD_STR(x)  BOARD_STR2(x)

void board_init(void)
{
    SystemCoreClockUpdate();
    Delay_Init();

#if defined(SDI_PRINT) && (SDI_PRINT == 1)
    /* printf() over the WCH-Link debug data registers. Claims no pin. */
    SDI_Printf_Enable();
#endif

#if defined(BOARD_HAS_LED)
    wch_hal_gpio_config(BOARD_LED_PORT, BOARD_LED_PIN, GPIO_Mode_Out_PP);
    board_led_set(0);
#endif
}

const char *board_name(void)
{
    return BOARD_STR(BOARD_NAME);
}

int board_has_led(void)
{
#if defined(BOARD_HAS_LED)
    return 1;
#else
    return 0;
#endif
}

void board_led_set(int on)
{
#if defined(BOARD_HAS_LED)
    wch_hal_gpio_write(BOARD_LED_PORT, BOARD_LED_PIN, BOARD_LED_ACTIVE_HIGH ? on : !on);
#else
    (void)on;
#endif
}

void board_led_toggle(void)
{
#if defined(BOARD_HAS_LED)
    wch_hal_gpio_toggle(BOARD_LED_PORT, BOARD_LED_PIN);
#endif
}
