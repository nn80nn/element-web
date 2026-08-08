# End-to-end build of the Remess desktop app on Windows.
#
#   powershell -ExecutionPolicy Bypass -File apps/desktop/remess/build.ps1
#
# Steps, in order, because each one has bitten us when done by hand:
#   1. build the element-call fork in "embedded" mode,
#   2. drop it over the stock element-call widget bundled with the web app
#      (skipping this silently ships upstream's widget, so our call-side
#      changes just do not exist in the installer),
#   3. build the web app,
#   4. stage it into apps/desktop/webapp together with the Remess config.json,
#   5. pack webapp.asar,
#   6. run electron-builder against the Remess variant.
#
# Pass -SkipCall / -SkipWeb to reuse the previous output of those steps.

param(
    [switch]$SkipCall,
    [switch]$SkipWeb,
    [string]$CallRepo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..\element-call")).Path
)

$ErrorActionPreference = "Stop"

$desktop = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repo = (Resolve-Path (Join-Path $desktop "..\..")).Path
$web = Join-Path $repo "apps\web"
$widget = Join-Path $web "webapp\widgets\element-call"

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

if (-not $SkipCall) {
    Step "Building element-call (embedded) from $CallRepo"
    Push-Location $CallRepo
    try {
        # Not `pnpm run build:embedded`: that script is written as `NODE_OPTIONS=... vite build`,
        # which cmd.exe cannot parse, so invoke vite ourselves with the env var set the Windows way.
        $previousNodeOptions = $env:NODE_OPTIONS
        $env:NODE_OPTIONS = "--max-old-space-size=16384"
        try {
            & (Join-Path $CallRepo "node_modules\.bin\vite.cmd") build --config vite-embedded.config.ts
            if ($LASTEXITCODE -ne 0) { throw "element-call build failed" }
        } finally { $env:NODE_OPTIONS = $previousNodeOptions }
    } finally { Pop-Location }
}

if (-not $SkipWeb) {
    Step "Building element-web"
    Push-Location $web
    try {
        & pnpm run build
        if ($LASTEXITCODE -ne 0) { throw "element-web build failed" }
    } finally { Pop-Location }
}

Step "Overlaying the element-call fork onto the bundled widget"
$callDist = Join-Path $CallRepo "dist"
if (-not (Test-Path $callDist)) { throw "No element-call build at $callDist - run without -SkipCall" }
if (-not (Test-Path $widget)) { throw "No bundled widget at $widget - run without -SkipWeb" }
Remove-Item -Recurse -Force $widget
Copy-Item -Recurse $callDist $widget

# Cheap guard against step 2 silently not having happened: our fork carries the
# DTLN processor, upstream's bundle does not.
$marker = Get-ChildItem -Recurse -File (Join-Path $widget "assets") -ErrorAction SilentlyContinue |
    Select-String -Pattern "dtln-suppressor" -List -SimpleMatch |
    Select-Object -First 1
if (-not $marker) { throw "Bundled widget does not look like our fork (no dtln-suppressor in it)" }
Write-Host "Fork marker found in $($marker.Path)"

Step "Staging apps/desktop/webapp"
$stage = Join-Path $desktop "webapp"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
Copy-Item -Recurse (Join-Path $web "webapp") $stage
Copy-Item (Join-Path $PSScriptRoot "release\config.json") (Join-Path $stage "config.json") -Force

Step "Packing webapp.asar"
$asar = Join-Path $desktop "webapp.asar"
if (Test-Path $asar) { Remove-Item -Force $asar }
Push-Location $desktop
try {
    & pnpm exec asar p webapp webapp.asar
    if ($LASTEXITCODE -ne 0) { throw "asar pack failed" }
} finally { Pop-Location }

Step "Running electron-builder (Remess variant)"
Push-Location $desktop
try {
    $env:VARIANT_PATH = "remess/release/build.json"
    # Deliberately not going through nx here: VARIANT_PATH is not part of its cache key, so
    # an nx-cached run can happily hand back a build made for a different variant.
    & pnpm exec tsc
    if ($LASTEXITCODE -ne 0) { throw "desktop TypeScript build failed" }
    & node scripts/copy-res.ts
    if ($LASTEXITCODE -ne 0) { throw "desktop resource copy failed" }
    & pnpm exec electron-builder --x64 --publish=never
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
} finally {
    Remove-Item Env:\VARIANT_PATH -ErrorAction SilentlyContinue
    Pop-Location
}

Step "Done"
Get-ChildItem (Join-Path $desktop "dist") -File | Select-Object Name, @{n = "MB"; e = { [math]::Round($_.Length / 1MB, 1) } }
