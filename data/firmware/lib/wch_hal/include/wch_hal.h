/* ---------------------------------------------------------------------------
 *  wch_hal.h — umbrella header for the HAL component.
 *
 *  Scope of this component: a thin, honest wrapper over the vendor SPL. It adds
 *  no policy, knows nothing about the board, and never invents a capability the
 *  part does not have. Anything the SPL already does well is called directly by
 *  the caller — this is not a re-implementation of the SDK.
 * ------------------------------------------------------------------------- */
#ifndef WCH_HAL_H
#define WCH_HAL_H

#include "wch_hal_soc.h"
#include "wch_hal_gpio.h"
#include "wch_hal_clock.h"

#endif /* WCH_HAL_H */
