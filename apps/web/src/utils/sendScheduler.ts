/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { ConnectionError, MatrixScheduler, type MatrixError, type MatrixEvent } from "matrix-js-sdk/src/matrix";

/**
 * How many times to retry a send that failed because we couldn't reach the server at all.
 * With {@link MAX_CONNECTION_ERROR_BACKOFF_MS} this rides out roughly 75 seconds of
 * connectivity loss before the message is marked as not sent.
 */
const MAX_CONNECTION_ERROR_RETRIES = 7;

/** Upper bound on the backoff between connection-error retries. */
const MAX_CONNECTION_ERROR_BACKOFF_MS = 15_000;

/**
 * Retry algorithm for the send queue.
 *
 * The js-sdk default gives up on a {@link ConnectionError} immediately, on the first attempt:
 * it calls `calculateRetryBackoff` with `retryConnectionError` false, which returns -1 for
 * that error class. Since the scheduler clears the whole queue when it gives up
 * on an event, a momentary blip doesn't just fail the message you were sending, it fails every
 * message queued behind it. On a connection that drops for a few seconds at a time that is the
 * difference between "the client is fine" and "the client is broken".
 *
 * A connection error is exactly the case that is worth retrying, though: the request never
 * reached the server, and a retry reuses the same transaction ID, so the server dedupes it if
 * it turns out the request did land after all. So retry those with exponential backoff, and
 * defer to the js-sdk's own logic for everything else (4xx and oversized events stay fatal,
 * rate limiting keeps honouring Retry-After).
 */
export function sendRetryAlgorithm(event: MatrixEvent | null, attempts: number, err: MatrixError): number {
    if (err instanceof ConnectionError) {
        if (attempts > MAX_CONNECTION_ERROR_RETRIES) return -1;
        // Jittered so that a whole client's queues don't all wake up at the same instant when
        // connectivity comes back.
        const backoff = Math.min(1000 * Math.pow(2, attempts), MAX_CONNECTION_ERROR_BACKOFF_MS);
        return backoff + Math.floor(Math.random() * 1000);
    }

    // eslint-disable-next-line new-cap -- js-sdk names this constant-style, it isn't a constructor
    return MatrixScheduler.RETRY_BACKOFF_RATELIMIT(event, attempts, err);
}

/**
 * Builds the scheduler to hand to `createClient`, which is otherwise left to default-construct
 * one with the js-sdk's own retry algorithm.
 */
export function createSendScheduler(): MatrixScheduler {
    return new MatrixScheduler(sendRetryAlgorithm);
}
