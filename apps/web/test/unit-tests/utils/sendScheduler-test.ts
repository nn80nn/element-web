/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { ConnectionError, MatrixError } from "matrix-js-sdk/src/matrix";

import { sendRetryAlgorithm } from "../../../src/utils/sendScheduler";

describe("sendRetryAlgorithm", () => {
    const connectionError = new ConnectionError("network is down");

    it("retries a connection error instead of giving up on the first failure", () => {
        // The js-sdk default returns -1 here, which fails the message and clears the queue.
        expect(sendRetryAlgorithm(null, 1, connectionError as unknown as MatrixError)).toBeGreaterThan(0);
    });

    it("backs off exponentially between connection error retries", () => {
        const first = sendRetryAlgorithm(null, 1, connectionError as unknown as MatrixError);
        const second = sendRetryAlgorithm(null, 2, connectionError as unknown as MatrixError);
        const third = sendRetryAlgorithm(null, 3, connectionError as unknown as MatrixError);

        expect(second).toBeGreaterThan(first);
        expect(third).toBeGreaterThan(second);
    });

    it("caps the backoff so a queue never stalls for minutes at a time", () => {
        // 16s of backoff plus up to 1s of jitter.
        expect(sendRetryAlgorithm(null, 6, connectionError as unknown as MatrixError)).toBeLessThanOrEqual(16000);
    });

    it("eventually gives up on a connection error", () => {
        expect(sendRetryAlgorithm(null, 8, connectionError as unknown as MatrixError)).toBe(-1);
    });

    it("still gives up immediately on client errors", () => {
        const forbidden = new MatrixError({ errcode: "M_FORBIDDEN" }, 403);
        expect(sendRetryAlgorithm(null, 1, forbidden)).toBe(-1);
    });

    it("still retries server errors", () => {
        const serverError = new MatrixError({ errcode: "M_UNKNOWN" }, 500);
        expect(sendRetryAlgorithm(null, 1, serverError)).toBeGreaterThan(0);
    });
});
