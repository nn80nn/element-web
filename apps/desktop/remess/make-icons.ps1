# Generates the Remess app icons (build/icon.png + build/icon.ico) from scratch so
# the fork is visually distinct from Element in the taskbar, Start menu and tray.
# Windows-only (uses System.Drawing); the generated files are committed, so this
# only needs re-running when the mark changes.
#
#   powershell -ExecutionPolicy Bypass -File apps/desktop/remess/make-icons.ps1

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "build"
New-Item -ItemType Directory -Force $outDir | Out-Null

# Discord-like blurple, matching the accent we use across the app.
$top = [System.Drawing.Color]::FromArgb(255, 106, 92, 246)
$bottom = [System.Drawing.Color]::FromArgb(255, 66, 48, 214)

function New-Mark([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded-square plate with a vertical blurple gradient.
    $r = [int]($size * 0.22)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90)
    $path.AddArc($size - 2 * $r - 1, 0, 2 * $r, 2 * $r, 270, 90)
    $path.AddArc($size - 2 * $r - 1, $size - 2 * $r - 1, 2 * $r, 2 * $r, 0, 90)
    $path.AddArc(0, $size - 2 * $r - 1, 2 * $r, 2 * $r, 90, 90)
    $path.CloseFigure()

    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $top, $bottom, 90)
    $g.FillPath($brush, $path)

    # "R" wordmark.
    $font = New-Object System.Drawing.Font("Segoe UI", ($size * 0.56), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $box = New-Object System.Drawing.RectangleF(0, -($size * 0.02), $size, $size)
    $g.DrawString("R", $font, $white, $box, $fmt)

    $g.Dispose()
    return $bmp
}

# 512px PNG, used on Linux and as the tray icon source on non-Windows.
$png = New-Mark 512
$png.Save((Join-Path $outDir "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)

# Multi-resolution ICO for Windows. System.Drawing cannot author multi-size icons,
# so write the ICONDIR/ICONDIRENTRY headers by hand around PNG-compressed frames.
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$frames = @()
foreach ($s in $sizes) {
    $bmp = New-Mark $s
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $frames += , @{ size = $s; bytes = $ms.ToArray() }
    $ms.Dispose()
    $bmp.Dispose()
}

$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($ico)
$w.Write([UInt16]0)                 # reserved
$w.Write([UInt16]1)                 # type: icon
$w.Write([UInt16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($f in $frames) {
    # 256px is encoded as 0 in the ICONDIRENTRY width/height bytes.
    $dim = if ($f.size -ge 256) { 0 } else { $f.size }
    $w.Write([Byte]$dim)
    $w.Write([Byte]$dim)
    $w.Write([Byte]0)               # palette count
    $w.Write([Byte]0)               # reserved
    $w.Write([UInt16]1)             # colour planes
    $w.Write([UInt16]32)            # bits per pixel
    $w.Write([UInt32]$f.bytes.Length)
    $w.Write([UInt32]$offset)
    $offset += $f.bytes.Length
}
foreach ($f in $frames) { $w.Write($f.bytes) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $outDir "icon.ico"), $ico.ToArray())
$w.Dispose()

Write-Output "Wrote $outDir\icon.png and $outDir\icon.ico"
