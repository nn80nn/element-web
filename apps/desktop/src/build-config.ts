/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type JsonObject } from "shared-types";

import { loadJsonFile } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let buildConfig: BuildConfig;

interface BuildConfig {
    // Application User Model ID
    appId: string;
    // Protocol string used for OIDC callbacks
    protocol: string;
    // Subject name of the code signing cert used for Windows packages, if signed
    // used as a basis for the Tray GUID which must be rolled if the certificate changes.
    windowsCertSubjectName: string | undefined;
}

export function getBuildConfig(): BuildConfig {
    if (!buildConfig) {
        const packageJson = loadJsonFile(path.join(__dirname, "..", "package.json")) as JsonObject;
        buildConfig = {
            // electron-builder injects these from the build variant; the fallbacks only apply to
            // unpackaged dev runs. They deliberately match the Remess variant rather than
            // Element's, so that `pnpm start` doesn't claim an installed Element's taskbar
            // identity or steal its `io.element.desktop` OIDC callbacks.
            appId: (packageJson["electron_appId"] as string) || "chat.remess.desktop",
            protocol: (packageJson["electron_protocol"] as string) || "chat.remess.desktop",
            windowsCertSubjectName: packageJson["electron_windows_cert_sn"] as string,
        };
    }

    return buildConfig;
}
