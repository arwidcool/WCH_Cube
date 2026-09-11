/* ---------------------------------------------------------------------------
 *  test_util_ringbuf — host-side unit tests for lib/util. (D6)
 *
 *  These run on the DEVELOPMENT MACHINE, not on a chip:
 *
 *      cd data/firmware && pio test -e native
 *
 *  `lib/util` was shaped to make this possible — it declares no framework and no
 *  platform in its `library.json`, takes its storage from the caller, allocates
 *  nothing and never includes an SDK header (ARCHITECTURE.md, "Layers"). That
 *  constraint only pays for itself if something actually exercises it, which is
 *  what this file is.
 *
 *  The ring buffer is the one piece of firmware logic here with off-by-one risk
 *  and a concurrency contract, so it gets the wrap-around and full/empty cases
 *  rather than a smoke test. Note `size` is capacity + 1: one slot is spent
 *  distinguishing full from empty, and several tests below exist to pin that
 *  down, because it is the thing a future edit would "simplify" away.
 * ------------------------------------------------------------------------- */
#include <string.h>
#include <unity.h>

#include "util_ringbuf.h"

#define CAP 8

static util_ringbuf_t rb;
static uint8_t storage[CAP + 1];

void setUp(void)
{
    memset(storage, 0, sizeof storage);
    util_ringbuf_init(&rb, storage, sizeof storage);
}

void tearDown(void) {}

/* --------------------------------------------------------------- the basics */

static void test_a_fresh_buffer_is_empty_and_has_the_capacity_it_was_given(void)
{
    TEST_ASSERT_TRUE(util_ringbuf_is_empty(&rb));
    TEST_ASSERT_FALSE(util_ringbuf_is_full(&rb));
    TEST_ASSERT_EQUAL_size_t(0, util_ringbuf_count(&rb));
    /* storage is CAP+1 bytes and one slot separates full from empty, so the
       usable capacity is CAP. A change that makes this CAP+1 has broken the
       full/empty distinction, not improved the capacity. */
    TEST_ASSERT_EQUAL_size_t(CAP, util_ringbuf_capacity(&rb));
}

static void test_a_byte_put_is_the_byte_got(void)
{
    uint8_t out = 0;
    TEST_ASSERT_EQUAL_INT(1, util_ringbuf_put(&rb, 0xA5));
    TEST_ASSERT_EQUAL_size_t(1, util_ringbuf_count(&rb));
    TEST_ASSERT_EQUAL_INT(1, util_ringbuf_get(&rb, &out));
    TEST_ASSERT_EQUAL_HEX8(0xA5, out);
    TEST_ASSERT_TRUE(util_ringbuf_is_empty(&rb));
}

static void test_get_on_an_empty_buffer_fails_and_does_not_touch_the_output(void)
{
    uint8_t out = 0x5A;
    TEST_ASSERT_EQUAL_INT(0, util_ringbuf_get(&rb, &out));
    TEST_ASSERT_EQUAL_HEX8(0x5A, out);      /* untouched, not zeroed */
}

/* ------------------------------------------------------------- full / empty */

static void test_it_fills_to_capacity_and_then_refuses(void)
{
    for (size_t i = 0; i < CAP; i++) {
        TEST_ASSERT_EQUAL_INT(1, util_ringbuf_put(&rb, (uint8_t)i));
    }
    TEST_ASSERT_TRUE(util_ringbuf_is_full(&rb));
    TEST_ASSERT_EQUAL_size_t(CAP, util_ringbuf_count(&rb));

    /* The refusal must not overwrite the oldest byte: this is a queue, not a
       most-recent-N cache, and a silent overwrite would lose data an ISR wrote. */
    TEST_ASSERT_EQUAL_INT(0, util_ringbuf_put(&rb, 0xFF));
    TEST_ASSERT_EQUAL_size_t(CAP, util_ringbuf_count(&rb));

    uint8_t out = 0;
    TEST_ASSERT_EQUAL_INT(1, util_ringbuf_get(&rb, &out));
    TEST_ASSERT_EQUAL_HEX8(0, out);         /* still the FIRST byte written */
}

static void test_full_and_empty_are_distinguishable(void)
{
    /* The reason `size` is capacity + 1. Fill, drain, and check the two states
       do not collapse onto the same head == tail. */
    for (size_t i = 0; i < CAP; i++) util_ringbuf_put(&rb, (uint8_t)i);
    TEST_ASSERT_TRUE(util_ringbuf_is_full(&rb));
    TEST_ASSERT_FALSE(util_ringbuf_is_empty(&rb));

    uint8_t out;
    for (size_t i = 0; i < CAP; i++) util_ringbuf_get(&rb, &out);
    TEST_ASSERT_TRUE(util_ringbuf_is_empty(&rb));
    TEST_ASSERT_FALSE(util_ringbuf_is_full(&rb));
}

/* ------------------------------------------------------------ wrap-around */

static void test_it_wraps_and_keeps_its_order(void)
{
    uint8_t out = 0;
    /* Push the indices most of the way round, then keep going well past the end
       of the storage so head and tail both wrap more than once. */
    for (size_t i = 0; i < CAP - 1; i++) TEST_ASSERT_EQUAL_INT(1, util_ringbuf_put(&rb, (uint8_t)i));
    for (size_t i = 0; i < CAP - 1; i++) TEST_ASSERT_EQUAL_INT(1, util_ringbuf_get(&rb, &out));
    TEST_ASSERT_TRUE(util_ringbuf_is_empty(&rb));

    for (size_t round = 0; round < 4; round++) {
        for (size_t i = 0; i < CAP; i++) {
            TEST_ASSERT_EQUAL_INT(1, util_ringbuf_put(&rb, (uint8_t)(round * 100 + i)));
        }
        for (size_t i = 0; i < CAP; i++) {
            TEST_ASSERT_EQUAL_INT(1, util_ringbuf_get(&rb, &out));
            TEST_ASSERT_EQUAL_HEX8((uint8_t)(round * 100 + i), out);
        }
    }
}

/* ------------------------------------------------------------------ bulk */

static void test_bulk_write_moves_what_fits_and_reports_how_much(void)
{
    const uint8_t src[CAP + 4] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 };
    /* More than fits: it must move exactly CAP and say so, not overflow and not
       refuse the whole thing. */
    TEST_ASSERT_EQUAL_size_t(CAP, util_ringbuf_write(&rb, src, sizeof src));
    TEST_ASSERT_TRUE(util_ringbuf_is_full(&rb));

    uint8_t dst[CAP + 4];
    memset(dst, 0xEE, sizeof dst);
    TEST_ASSERT_EQUAL_size_t(CAP, util_ringbuf_read(&rb, dst, sizeof dst));
    TEST_ASSERT_EQUAL_HEX8_ARRAY(src, dst, CAP);
    TEST_ASSERT_EQUAL_HEX8(0xEE, dst[CAP]);   /* nothing written past what it returned */
}

static void test_bulk_read_and_write_survive_a_wrap(void)
{
    const uint8_t a[5] = { 10, 11, 12, 13, 14 };
    const uint8_t b[5] = { 20, 21, 22, 23, 24 };
    uint8_t dst[5];

    TEST_ASSERT_EQUAL_size_t(5, util_ringbuf_write(&rb, a, 5));
    TEST_ASSERT_EQUAL_size_t(5, util_ringbuf_read(&rb, dst, 5));
    TEST_ASSERT_EQUAL_HEX8_ARRAY(a, dst, 5);

    /* head and tail are at 5 of 9 now, so this write straddles the end. */
    TEST_ASSERT_EQUAL_size_t(5, util_ringbuf_write(&rb, b, 5));
    memset(dst, 0, sizeof dst);
    TEST_ASSERT_EQUAL_size_t(5, util_ringbuf_read(&rb, dst, 5));
    TEST_ASSERT_EQUAL_HEX8_ARRAY(b, dst, 5);
    TEST_ASSERT_TRUE(util_ringbuf_is_empty(&rb));
}

static void test_zero_length_bulk_calls_do_nothing_and_say_nothing_happened(void)
{
    uint8_t one = 0x11;
    TEST_ASSERT_EQUAL_size_t(0, util_ringbuf_write(&rb, &one, 0));
    TEST_ASSERT_TRUE(util_ringbuf_is_empty(&rb));
    TEST_ASSERT_EQUAL_size_t(0, util_ringbuf_read(&rb, &one, 0));
    TEST_ASSERT_EQUAL_HEX8(0x11, one);
}

/* ------------------------------------------------------------------ reset */

static void test_reset_empties_without_disturbing_the_storage_it_was_given(void)
{
    for (size_t i = 0; i < CAP; i++) util_ringbuf_put(&rb, (uint8_t)(i + 1));
    util_ringbuf_reset(&rb);
    TEST_ASSERT_TRUE(util_ringbuf_is_empty(&rb));
    TEST_ASSERT_EQUAL_size_t(0, util_ringbuf_count(&rb));
    TEST_ASSERT_EQUAL_PTR(storage, rb.buf);
    TEST_ASSERT_EQUAL_size_t(CAP, util_ringbuf_capacity(&rb));

    uint8_t out = 0;
    TEST_ASSERT_EQUAL_INT(0, util_ringbuf_get(&rb, &out));
    TEST_ASSERT_EQUAL_INT(1, util_ringbuf_put(&rb, 0x77));   /* still usable */
    TEST_ASSERT_EQUAL_INT(1, util_ringbuf_get(&rb, &out));
    TEST_ASSERT_EQUAL_HEX8(0x77, out);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_a_fresh_buffer_is_empty_and_has_the_capacity_it_was_given);
    RUN_TEST(test_a_byte_put_is_the_byte_got);
    RUN_TEST(test_get_on_an_empty_buffer_fails_and_does_not_touch_the_output);
    RUN_TEST(test_it_fills_to_capacity_and_then_refuses);
    RUN_TEST(test_full_and_empty_are_distinguishable);
    RUN_TEST(test_it_wraps_and_keeps_its_order);
    RUN_TEST(test_bulk_write_moves_what_fits_and_reports_how_much);
    RUN_TEST(test_bulk_read_and_write_survive_a_wrap);
    RUN_TEST(test_zero_length_bulk_calls_do_nothing_and_say_nothing_happened);
    RUN_TEST(test_reset_empties_without_disturbing_the_storage_it_was_given);
    return UNITY_END();
}
