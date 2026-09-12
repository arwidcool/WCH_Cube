/* ---------------------------------------------------------------------------
 *  main.c — the application layer, and nothing else.
 *
 *  This file is allowed to know about lib/board, lib/util and the generated
 *  configuration. It is NOT allowed to touch registers, pick pins, or call the
 *  vendor SPL directly — that is what the layers below it are for. Keeping that
 *  line is what lets one agent work here while another reworks the HAL.
 *
 *  What this firmware genuinely does today, and nothing more:
 *    - brings the board up (clock readback, delay timer, printf over WCH-Link)
 *    - applies the configurator's output, IF a generated file has been dropped
 *      into lib/wchcube_generated (see its README)
 *    - reports what it found
 *    - ticks
 *
 *  There is no peripheral driver here yet. When one arrives it arrives as a
 *  component under lib/, not as code in this file.
 * ------------------------------------------------------------------------- */
#include "app_config.h"
#include "board.h"

/* The configurator's output is optional: this project has to build before
 * anyone has generated anything. __has_include is the only thing that makes
 * "optional" possible without a hand-edited switch that someone forgets to
 * flip. GCC 12 (the toolchain this platform ships) supports it in C. */
#if defined(__has_include)
#  if __has_include("wchcube_init.h")
#    include "wchcube_init.h"
#    define APP_HAVE_GENERATED_INIT 1
#  endif
#endif

#ifndef APP_HAVE_GENERATED_INIT
#  define APP_HAVE_GENERATED_INIT 0
#endif

static void app_banner(void)
{
#if APP_BANNER_ENABLED
    printf("\r\n=== WCHCube firmware ===\r\n");
    printf("board   : %s\r\n", board_name());
    printf("sysclk  : %lu Hz\r\n", (unsigned long)wch_hal_clock_sysclk_hz());
    printf("config  : %s\r\n",
           APP_HAVE_GENERATED_INIT ? "wchcube_init.c (generated)"
                                   : "none - nothing generated yet, see lib/wchcube_generated/README.md");
    printf("user LED: %s\r\n", board_has_led() ? "declared" : "none declared for this board");
#endif
}

static void app_report_clocks(void)
{
#if APP_REPORT_CLOCKS
    wch_hal_clocks_t c;

    wch_hal_clock_get(&c);
    printf("clocks  : SYSCLK %lu  HCLK %lu  PCLK1 %lu  PCLK2 %lu  ADCCLK %lu\r\n",
           (unsigned long)c.sysclk_hz, (unsigned long)c.hclk_hz,
           (unsigned long)c.pclk1_hz,  (unsigned long)c.pclk2_hz,
           (unsigned long)c.adcclk_hz);
#endif
}

int main(void)
{
    board_init();

#if APP_HAVE_GENERATED_INIT
    /* Runs after board_init() on purpose: if the configuration changes the
     * clock tree, everything read back below has to reflect the new tree.
     * See ARCHITECTURE.md, "Two clock owners". */
    WCHCube_Init();
    /* Through the HAL: the SDK spells this SystemAndCoreClockUpdate on CH32H417
     * and SystemCoreClockUpdate everywhere else (wch_hal_clock.c knows which). */
    (void)wch_hal_clock_sysclk_hz();
#endif

    app_banner();
    app_report_clocks();

    for (;;) {
        board_led_toggle();     /* no-op when no LED is declared */
        Delay_Ms(APP_TICK_MS);
    }
}
