/* ---------------------------------------------------------------------------
 *  app_config.h — build-time configuration for this firmware.
 *
 *  The ESP-IDF `sdkconfig.h` role, kept deliberately small: one place where
 *  every compile-time switch is named, documented and given a default, so that
 *  a switch is never invented at its point of use.
 *
 *  Override any of these from platformio.ini rather than editing this file:
 *
 *      build_flags =
 *          ${env.build_flags}
 *          -D APP_BANNER_ENABLED=0
 *
 *  What does NOT belong here: anything that describes hardware. Pin numbers,
 *  clock sources and peripheral wiring belong to the board (lib/board) or to
 *  the configurator (lib/wchcube_generated).
 * ------------------------------------------------------------------------- */
#ifndef APP_CONFIG_H
#define APP_CONFIG_H

/* Print the identity banner over printf() at startup. */
#ifndef APP_BANNER_ENABLED
#  define APP_BANNER_ENABLED 1
#endif

/* Period of the application's idle tick, in milliseconds. */
#ifndef APP_TICK_MS
#  define APP_TICK_MS 500u
#endif

/* Print the clock tree readback once at startup. Costs a few hundred bytes of
 * flash for the format strings. */
#ifndef APP_REPORT_CLOCKS
#  define APP_REPORT_CLOCKS 1
#endif

#endif /* APP_CONFIG_H */
