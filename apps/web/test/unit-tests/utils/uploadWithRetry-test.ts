/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { ConnectionError, type MatrixClient, MatrixError } from "matrix-js-sdk/src/matrix";

import { uploadContentWithRetry } from "../../../src/utils/uploadWithRetry";

describe("uploadContentWithRetry", () => {
    const body = new Blob(["some file contents"]);

    let client: MatrixClient;
    let uploadContent: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();
        uploadContent = jest.fn();
        client = { uploadContent } as unknown as MatrixClient;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /**
     * Starts the upload and lets every backoff timer elapse. The returned promise already
     * has a rejection handler attached, so that a failure partway through the timer flush
     * doesn't surface as an unhandled rejection before the test gets to assert on it.
     */
    async function run(opts = {}): Promise<{ content_uri: string }> {
        const promise = uploadContentWithRetry(client, body, opts);
        promise.catch(() => {});
        await jest.runAllTimersAsync();
        return promise;
    }

    it("returns the response without retrying when the upload succeeds", async () => {
        uploadContent.mockResolvedValue({ content_uri: "mxc://example.com/1" });

        await expect(run()).resolves.toEqual({ content_uri: "mxc://example.com/1" });
        expect(uploadContent).toHaveBeenCalledTimes(1);
    });

    it("retries a connection error and returns the eventual success", async () => {
        uploadContent
            .mockRejectedValueOnce(new ConnectionError("network is down"))
            .mockRejectedValueOnce(new ConnectionError("network is down"))
            .mockResolvedValue({ content_uri: "mxc://example.com/2" });

        await expect(run()).resolves.toEqual({ content_uri: "mxc://example.com/2" });
        expect(uploadContent).toHaveBeenCalledTimes(3);
    });

    it("resets the progress bar when it starts an attempt over", async () => {
        const progressHandler = jest.fn();
        uploadContent
            .mockRejectedValueOnce(new ConnectionError("network is down"))
            .mockResolvedValue({ content_uri: "mxc://example.com/3" });

        await run({ progressHandler });

        expect(progressHandler).toHaveBeenCalledWith({ loaded: 0, total: body.size });
    });

    it("gives up after a bounded number of retries", async () => {
        uploadContent.mockRejectedValue(new ConnectionError("network is down"));

        await expect(run()).rejects.toThrow(ConnectionError);
        expect(uploadContent).toHaveBeenCalledTimes(5);
    });

    it("does not retry an error the server actually answered with", async () => {
        uploadContent.mockRejectedValue(new MatrixError({ errcode: "M_TOO_LARGE" }, 413));

        await expect(run()).rejects.toThrow(MatrixError);
        expect(uploadContent).toHaveBeenCalledTimes(1);
    });

    it("does not retry once the upload has been cancelled", async () => {
        const abortController = new AbortController();
        uploadContent.mockImplementation(() => {
            abortController.abort();
            return Promise.reject(new ConnectionError("aborted"));
        });

        await expect(run({ abortController })).rejects.toThrow(ConnectionError);
        expect(uploadContent).toHaveBeenCalledTimes(1);
    });
});
