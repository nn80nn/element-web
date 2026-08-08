/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { type Configuration as BaseConfiguration } from "electron-builder";

/**
 * This script has different outputs depending on your os platform.
 *
 * On Windows:
 *  Passes $ED_SIGNTOOL_THUMBPRINT and $ED_SIGNTOOL_SUBJECT_NAME to
 *      build.win.signtoolOptions.signingHashAlgorithms and build.win.signtoolOptions.certificateSubjectName respectively if specified.
 *
 * On Linux:
 *  Replaces spaces in the product name with dashes as spaces in paths can cause issues
 *  Removes libsqlcipher0 recommended dependency if env SQLCIPHER_BUNDLED is asserted.
 *  Passes $ED_DEBIAN_CHANGELOG to build.deb.fpm if specified
 */

/**
 * Interface describing relevant fields of the package.json file.
 */
interface Pkg {
    version: string;
}

/**
 * Base metadata fields, used in both package.json and the variant configuration.
 */
interface Metadata {
    name: string;
    productName: string;
    description: string;
}

/**
 * Extra metadata fields that are injected into the build to pass to the app at runtime.
 */
interface ExtraMetadata extends Metadata {
    electron_appId: string;
    electron_protocol: string;
    electron_windows_cert_sn?: string;
    homepage?: string;
}

/**
 * Interface describing the variant configuration format.
 */
interface Variant extends Metadata {
    "appId": string;
    "linux.executableName"?: string;
    "linux.deb.name"?: string;
    "linux.targets"?: string[];
    /** Goes into the Linux packages as both maintainer and vendor, in `Name <email>` form. */
    "linux.maintainer"?: string;
    /** Replaces the homepage baked into package.json, which packages surface as their URL. */
    "homepage"?: string;
    "protocols": string[];
    /**
     * Directory holding this variant's `icon.png`/`icon.ico`/`icon.icon`, relative to
     * apps/desktop. Any icon the variant doesn't provide falls back to the one in `build`.
     */
    "icons"?: string;
}

type Writable<T> = NonNullable<
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    T extends Function ? T : T extends object ? { -readonly [K in keyof T]: Writable<T[K]> } : T
>;

// Load the default variant as a base configuration
const DEFAULT_VARIANT = path.join("element.io", "release", "build.json");
let variant: Variant = JSON.parse(fs.readFileSync(DEFAULT_VARIANT, "utf8"));

/**
 * If a variant is specified, we will use it to override the build-specific values.
 * This allows us to have different builds for different purposes (e.g. stable, nightly).
 */
if (process.env.VARIANT_PATH) {
    console.log(`Using variant configuration from '${process.env.VARIANT_PATH}':`);
    variant = {
        ...variant,
        ...JSON.parse(fs.readFileSync(`${process.env.VARIANT_PATH}`, "utf8")),
    };
} else {
    console.warn(`No VARIANT_PATH specified, using default variant configuration '${DEFAULT_VARIANT}':`);
}

for (const key in variant) {
    console.log(`${key}: ${variant[key as keyof Variant]}`);
}

/**
 * Resolves an icon to the variant's own icon directory if it has one, otherwise to the
 * default `build` directory. This lets a variant ship its own branding without having to
 * provide every platform's icon format.
 */
function icon(name: `icon.${"png" | "ico" | "icon"}`): string {
    // electron-builder wants forward slashes even on Windows.
    if (variant.icons && fs.existsSync(path.join(variant.icons, name))) {
        return `${variant.icons}/${name}`;
    }
    return `build/${name}`;
}

/**
 * The macOS icon. Apple's `.icon` bundle can only really be authored on a Mac, so a variant
 * that doesn't ship one falls back to its own PNG, which electron-builder converts for us.
 * Falling back to the default variant's icon instead would ship the wrong product's brand.
 */
function macIcon(): string {
    if (
        variant.icons &&
        !fs.existsSync(path.join(variant.icons, "icon.icon")) &&
        fs.existsSync(path.join(variant.icons, "icon.png"))
    ) {
        return `${variant.icons}/icon.png`;
    }
    return icon("icon.icon");
}

interface Configuration extends BaseConfiguration {
    extraMetadata: Partial<Pick<Pkg, "version">> & ExtraMetadata;
    linux: BaseConfiguration["linux"];
    win: BaseConfiguration["win"];
    mac: BaseConfiguration["mac"];
    deb: {
        fpm: string[];
    } & BaseConfiguration["deb"];
}

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const config: Omit<Writable<Configuration>, "electronFuses"> & {
    // Make all fuses required to ensure they are all explicitly specified
    electronFuses: Required<Configuration["electronFuses"]>;
} = {
    appId: variant.appId,
    asarUnpack: "**/*.node",
    electronFuses: {
        enableCookieEncryption: true,
        onlyLoadAppFromAsar: true,
        grantFileProtocolExtraPrivileges: false,

        runAsNode: false,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        // We need to reset the signature if we are not signing on darwin otherwise it won't launch
        resetAdHocDarwinSignature: !process.env.APPLE_TEAM_ID,

        loadBrowserProcessSpecificV8Snapshot: false,
        enableEmbeddedAsarIntegrityValidation: true,
    },
    files: [
        "package.json",
        {
            from: ".hak/hakModules",
            to: "node_modules",
        },
        "lib/**",
    ],
    // The app resolves these at runtime as `<resources>/build/icon.*`, so a variant's icons
    // have to be remapped into `build` rather than kept under the variant directory.
    extraResources: [
        { from: icon("icon.png"), to: "build/icon.png" },
        { from: icon("icon.ico"), to: "build/icon.ico" },
        { from: icon("icon.icon"), to: "build/icon.icon" },
        "webapp.asar",
    ],
    extraMetadata: {
        name: variant.name,
        productName: variant.productName,
        description: variant.description,
        electron_appId: variant.appId,
        electron_protocol: variant.protocols[0],
        // Otherwise a variant's packages advertise element.io as their homepage.
        ...(variant.homepage ? { homepage: variant.homepage } : {}),
    },
    linux: {
        target: variant["linux.targets"] ?? ["tar.gz", "deb"],
        category: "Network;InstantMessaging;Chat",
        icon: icon("icon.png"),
        executableName: variant.name, // element-desktop or element-desktop-nightly
        // Both default to the author in package.json, so without this a variant's packages
        // name Element as their maintainer.
        ...(variant["linux.maintainer"]
            ? { maintainer: variant["linux.maintainer"], vendor: variant["linux.maintainer"] }
            : {}),
    },
    deb: {
        packageCategory: "net",
        depends: [
            "libgtk-3-0",
            "libnotify4",
            "libnss3",
            "libxss1",
            "libxtst6",
            "xdg-utils",
            "libatspi2.0-0",
            "libuuid1",
            "libsecret-1-0",
            "libasound2",
            "libgbm1",
        ],
        recommends: ["libsqlcipher0", "element-io-archive-keyring"],
        fpm: ["--deb-pre-depends", "libc6 (>= 2.31)"],
    },
    // electron-builder's default dependency list for the Arch package names two packages that
    // are no longer installable, and pacman refuses a package whose dependencies it cannot
    // resolve at all:
    //   error: unable to satisfy dependency 'http-parser' required by remess-desktop
    // http-parser has been dropped from the repositories outright, and libappindicator-gtk3
    // now lives only in the AUR, which `pacman -U` does not consult. Everything else in the
    // default list is still there, so this is that list with those two removed.
    pacman: {
        depends: [
            "c-ares",
            "ffmpeg",
            "gtk3",
            "libevent",
            "libvpx",
            "libxslt",
            "libxss",
            "minizip",
            "nss",
            "re2",
            "snappy",
            "libnotify",
        ],
    },
    mac: {
        target: ["dmg", "zip"],
        category: "public.app-category.social-networking",
        darkModeSupport: true,
        hardenedRuntime: true,
        gatekeeperAssess: true,
        strictVerify: true,
        entitlements: "./build/entitlements.mac.plist",
        icon: macIcon(),
        mergeASARs: true,
        x64ArchFiles: "**/matrix-seshat/*.node", // hak already runs lipo
    },
    dmg: {
        badgeIcon: macIcon(),
    },
    win: {
        target: ["squirrel", "msi"],
        signtoolOptions: {
            signingHashAlgorithms: ["sha256"],
        },
        icon: icon("icon.ico"),
    },
    msi: {
        perMachine: true,
    },
    directories: {
        output: "dist",
    },
    protocols: {
        name: variant.productName,
        schemes: variant.protocols,
    },
    nativeRebuilder: "sequential",
    nodeGypRebuild: false,
    npmRebuild: true,
};

/**
 * Allow specifying the version via env var.
 * If unspecified, it will default to the version in package.json.
 * @param {string} process.env.VERSION
 */
if (process.env.VERSION) {
    config.extraMetadata.version = process.env.VERSION;
}

if (variant["linux.deb.name"]) {
    config.deb.fpm.push("--name", variant["linux.deb.name"]);
}

/**
 * Allow specifying windows signing cert via env vars
 * @param {string} process.env.ED_SIGNTOOL_SUBJECT_NAME
 * @param {string} process.env.ED_SIGNTOOL_THUMBPRINT
 */
if (process.env.ED_SIGNTOOL_SUBJECT_NAME && process.env.ED_SIGNTOOL_THUMBPRINT) {
    config.win.signtoolOptions!.certificateSubjectName = process.env.ED_SIGNTOOL_SUBJECT_NAME;
    config.win.signtoolOptions!.certificateSha1 = process.env.ED_SIGNTOOL_THUMBPRINT;
    config.extraMetadata.electron_windows_cert_sn = config.win.signtoolOptions!.certificateSubjectName;
}

if (os.platform() === "linux") {
    // Electron crashes on debian if there's a space in the path.
    // https://github.com/vector-im/element-web/issues/13171
    config.extraMetadata.productName = config.extraMetadata.productName.replace(/ /g, "-");

    /**
     * Allow specifying deb changelog via env var
     * @param {string} process.env.ED_DEB_CHANGELOG
     */
    if (process.env.ED_DEBIAN_CHANGELOG) {
        config.deb.fpm.push(`--deb-changelog=${process.env.ED_DEBIAN_CHANGELOG}`);
    }

    if (process.env.SQLCIPHER_BUNDLED) {
        // Remove sqlcipher dependency when using bundled
        config.deb.recommends = config.deb.recommends?.filter((d) => d !== "libsqlcipher0");
    }
}

export default config;
