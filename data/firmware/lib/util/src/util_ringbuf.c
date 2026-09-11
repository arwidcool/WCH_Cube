#include "util_ringbuf.h"

static size_t next(const util_ringbuf_t *rb, size_t i)
{
    return (i + 1u == rb->size) ? 0u : i + 1u;
}

void util_ringbuf_init(util_ringbuf_t *rb, uint8_t *storage, size_t storage_len)
{
    rb->buf  = storage;
    rb->size = storage_len;
    rb->head = 0u;
    rb->tail = 0u;
}

void util_ringbuf_reset(util_ringbuf_t *rb)
{
    rb->head = 0u;
    rb->tail = 0u;
}

size_t util_ringbuf_capacity(const util_ringbuf_t *rb)
{
    return (rb->size == 0u) ? 0u : rb->size - 1u;
}

size_t util_ringbuf_count(const util_ringbuf_t *rb)
{
    size_t head = rb->head;
    size_t tail = rb->tail;
    return (head >= tail) ? (head - tail) : (rb->size - tail + head);
}

int util_ringbuf_is_empty(const util_ringbuf_t *rb)
{
    return rb->head == rb->tail;
}

int util_ringbuf_is_full(const util_ringbuf_t *rb)
{
    return next(rb, rb->head) == rb->tail;
}

int util_ringbuf_put(util_ringbuf_t *rb, uint8_t byte)
{
    size_t h = rb->head;
    size_t n = next(rb, h);

    if (n == rb->tail) {
        return 0;
    }
    rb->buf[h] = byte;
    rb->head = n;            /* publish only after the byte is stored */
    return 1;
}

int util_ringbuf_get(util_ringbuf_t *rb, uint8_t *out)
{
    size_t t = rb->tail;

    if (t == rb->head) {
        return 0;
    }
    *out = rb->buf[t];
    rb->tail = next(rb, t);
    return 1;
}

size_t util_ringbuf_write(util_ringbuf_t *rb, const uint8_t *src, size_t len)
{
    size_t i;
    for (i = 0u; i < len; i++) {
        if (!util_ringbuf_put(rb, src[i])) {
            break;
        }
    }
    return i;
}

size_t util_ringbuf_read(util_ringbuf_t *rb, uint8_t *dst, size_t len)
{
    size_t i;
    for (i = 0u; i < len; i++) {
        if (!util_ringbuf_get(rb, &dst[i])) {
            break;
        }
    }
    return i;
}
