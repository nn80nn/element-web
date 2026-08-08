/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { ConnectionError, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { type UploadOpts, type UploadResponse } from "matrix-js-sdk/src/http-api";
import { logger } from "matrix-js-sdk/src/logger";

/** How many times to re-send an upload that never reached the server. */
const MAX_UPLOAD_RETRIES = 4;

/** Upper bound on the backoff between upload retries. */
const MAX_UPLOAD_BACKOFF_MS = 15_000;

/**
 * Resolves after `ms`, or rejects as soon as `signal` aborts, so that cancelling an upload
 * during a backoff takes effect immediately rather than after the timer runs down.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        function onAbort(): void {
            clearTimeout(timeoutId);
            reject(new Error("Upload aborted while waiting to retry"));
        }
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * `uploadContent`, but retried if the request never made it to the server.
 *
 * Uploads don't go through the send queue, so unlike room events they get no retry at all:
 * a moment of connectivity loss part way through sending a photo fails the whole thing and
 * the user has to pick the file again. Since the media repo has no equivalent of a
 * transaction ID, a retry can leave an orphaned unreferenced blob on the server if the
 * original upload actually landed and only the response was lost — wasted storage is a much
 * better outcome than a failed send, but it's the reason this only retries connection
 * errors, and never anything the server has actually answered.
 *
 * A cancelled upload is never retried.
 */
export async function uploadContentWithRetry(
    matrixClient: MatrixClient,
    body: File | Blob,
    opts: UploadOpts,
): Promise<UploadResponse> {
    const signal = opts.abortController?.signal;

    for (let attempt = 1; ; attempt++) {
        try {
            return await matrixClient.uploadContent(body, opts);
        } catch (err) {
            if (signal?.aborted) throw err;
            if (!(err instanceof ConnectionError) || attempt > MAX_UPLOAD_RETRIES) throw err;

            const backoffMs = Math.min(1000 * Math.pow(2, attempt), MAX_UPLOAD_BACKOFF_MS);
            logger.warn(
                `Upload did not reach the server, retrying in ${backoffMs}ms ` +
                    `(attempt ${attempt} of ${MAX_UPLOAD_RETRIES})`,
                err,
            );
            await delay(backoffMs, signal);

            // The retry sends the whole body again, so put the progress bar back to the
            // start instead of leaving it frozen wherever the failed attempt got to.
            opts.progressHandler?.({ loaded: 0, total: body.size });
        }
    }
}
