/* ---------------------------------------------------------------------------
 *  util_ringbuf.h — single-producer / single-consumer byte ring buffer.
 *
 *  No hardware, no SDK, no allocation: the caller supplies the storage. This is
 *  the shape every util in this component has to have, because `util` is the
 *  one layer that must compile for the host as well as the target (see
 *  ARCHITECTURE.md, "Layers").
 *
 *  Concurrency: safe for exactly one writer and one reader — e.g. an ISR
 *  filling it and main() draining it — because head is only written by the
 *  producer and tail only by the consumer. Two writers need a lock, which this
 *  does not provide.
 * ------------------------------------------------------------------------- */
#ifndef UTIL_RINGBUF_H
#define UTIL_RINGBUF_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint8_t         *buf;
    size_t           size;      /* capacity + 1; one slot distinguishes full from empty */
    volatile size_t  head;      /* producer writes here */
    volatile size_t  tail;      /* consumer reads here */
} util_ringbuf_t;

void   util_ringbuf_init(util_ringbuf_t *rb, uint8_t *storage, size_t storage_len);
void   util_ringbuf_reset(util_ringbuf_t *rb);
size_t util_ringbuf_capacity(const util_ringbuf_t *rb);
size_t util_ringbuf_count(const util_ringbuf_t *rb);
int    util_ringbuf_is_empty(const util_ringbuf_t *rb);
int    util_ringbuf_is_full(const util_ringbuf_t *rb);

/* Returns 1 on success, 0 when full. */
int    util_ringbuf_put(util_ringbuf_t *rb, uint8_t byte);
/* Returns 1 on success, 0 when empty. */
int    util_ringbuf_get(util_ringbuf_t *rb, uint8_t *out);

/* Bulk forms; return how many bytes were actually moved. */
size_t util_ringbuf_write(util_ringbuf_t *rb, const uint8_t *src, size_t len);
size_t util_ringbuf_read(util_ringbuf_t *rb, uint8_t *dst, size_t len);

#ifdef __cplusplus
}
#endif

#endif /* UTIL_RINGBUF_H */
