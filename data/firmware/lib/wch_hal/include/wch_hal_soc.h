/* ---------------------------------------------------------------------------
 *  wch_hal_soc.h — the one place that decides which vendor SPL header this
 *  build is talking to.
 *
 *  The series macros come from the PlatformIO board file's `build.extra_flags`
 *  (see `pio run -t envdump`), NOT from anything invented here:
 *      genericCH32V006F8P6 -> -DCH32V006 -DCH32V00X -DCH32V00x -DCH32V00Xx
 *      genericCH32V005F6P6 -> -DCH32V005 -DCH32V00X -DCH32V00x -DCH32V00Xx
 *      genericCH32V003F4P6 -> -DCH32V003 -DCH32V00X -DCH32V00x   (NO capital-Xx)
 *      genericCH32X035G8U6 -> -DCH32X035 -DCH32X03X -DCH32X03x
 *
 *  The V003 board deliberately does not define CH32V00Xx, and that is the whole
 *  reason this file exists: <ch32v00x.h> (small x) is CH32V003 and <ch32v00X.h>
 *  (capital X) is the CH32V005/006/007 family. The two headers define different
 *  ports and different clock functions, so picking the wrong one compiles and
 *  produces a binary for a chip you are not holding.
 *
 *  A part that is not listed here is a hard error. Guessing a header name is
 *  how you end up compiling CH32V003 register definitions into a CH32V006.
 * ------------------------------------------------------------------------- */
#ifndef WCH_HAL_SOC_H
#define WCH_HAL_SOC_H

#ifdef __cplusplus
extern "C" {
#endif

#if defined(CH32V003)
/* CH32V003 / CH32V003F4 — SPL series "ch32v00x", SMALL x.
 * NOTE the small x: <ch32v00X.h> is a DIFFERENT part family (CH32V005/006/007).
 * RV32EC: no hardware multiply, no bitmanip — one more reason a V006 binary is
 * not a substitute for this one. The board file sets CH32V003 and CH32V00x but
 * not CH32V00Xx, which is exactly how the two headers stay apart. */
#  include <ch32v00x.h>
#  define WCH_HAL_SERIES_CH32V003 1
#elif defined(CH32V00Xx)
/* CH32V005 / CH32V006 / CH32V007 / CH32M007 — SPL series "ch32v00Xx".
 * NOTE the capital X: <ch32v00x.h> is a DIFFERENT part (CH32V003). */
#  include <ch32v00X.h>
#  define WCH_HAL_SERIES_CH32V00XX 1
#elif defined(CH32X035) || defined(CH32X033)
#  include <ch32x035.h>
#  define WCH_HAL_SERIES_CH32X035 1
#elif defined(CH32H417) || defined(CH32H41x)
/* CH32H417 / H416 / H415 — SPL series "ch32h417". The board file sets
 * -DCH32H417QE -DCH32H41X -DCH32H41x -DCH32H417, and this is the only family here
 * that is DUAL CORE (QingKe RISC-V5F at 400 MHz plus RISC-V3F at 160 MHz); the
 * framework ships a linker script per core, Link_CH32H417_v5f.ld and
 * Link_CH32H417_v3f.ld. Which one a build uses comes from the board id, not from
 * anything this header can see. */
#  include <ch32h417.h>
#  define WCH_HAL_SERIES_CH32H417 1
#else
#  error "wch_hal: unsupported series. Add the SPL header for this part here, \
after checking the name in framework-wch-noneos-sdk/Peripheral/<series>/inc/."
#endif

/* Delay_Init / Delay_Ms / printf. Supplied by the framework's Debug/<series>
 * folder, which the platform puts on the include path unless
 * `board_build.use_builtin_debug_code = no` is set in platformio.ini. */
#include <debug.h>

/* Does this family's Debug folder offer printf over the WCH-Link debug data
 * registers? On CH32V003/V00Xx/X035 it does, and `SDI_Printf_Enable()` costs no
 * pin, which is why the firmware prefers it. **CH32H417's debug.h declares only
 * `USART_Printf_Init(uint32_t)`** — there is no SDI_Printf_Enable to call, and
 * calling it anyway compiles with an implicit declaration and fails at LINK.
 * Stated here, beside the series switch, because "what this family has" is what
 * this header is for. */
#if defined(WCH_HAL_SERIES_CH32H417)
#  define WCH_HAL_HAS_SDI_PRINTF 0
#else
#  define WCH_HAL_HAS_SDI_PRINTF 1
#endif

#ifdef __cplusplus
}
#endif

#endif /* WCH_HAL_SOC_H */
