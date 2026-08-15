# Skládá vícevelikostní ICO. Velikosti do 128 px jako DIB (nejširší kompatibilita,
# NSIS na PNG uvnitř ICO historicky bývá citlivý), 256 px jako vložené PNG.
param([string]$PngDir, [string]$Out)

Add-Type -AssemblyName System.Drawing

# Zebricek, jaky mela puvodni kostka. `tauri icon` dela sest velikosti; tenhle
# soubor jich nese devatenact, aby Windows nikdy nemusely prevzorkovavat —
# 24 chce zahlavi okna a 36 hlavni panel pri 150 %, a ani jedna z nich v sestce
# nebyla.
$sizes = 16, 20, 24, 28, 30, 32, 36, 40, 44, 48, 56, 60, 64, 72, 80, 96, 128, 192
$entries = @()

foreach ($s in $sizes) {
    $bmp = [System.Drawing.Bitmap]::FromFile((Join-Path $PngDir "${s}x${s}.png"))
    $conv = New-Object System.Drawing.Bitmap $bmp.Width, $bmp.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($conv)
    $g.DrawImage($bmp, 0, 0, $bmp.Width, $bmp.Height)
    $g.Dispose(); $bmp.Dispose()

    $rect = New-Object System.Drawing.Rectangle 0, 0, $conv.Width, $conv.Height
    $data = $conv.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $raw = New-Object byte[] ($data.Stride * $conv.Height)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $raw, 0, $raw.Length)
    $conv.UnlockBits($data)

    $w = $conv.Width; $h = $conv.Height
    $maskRow = [math]::Ceiling($w / 32) * 4
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter $ms
    # BITMAPINFOHEADER - vyska dvojnasobna, protoze DIB v ICO nese XOR i AND masku
    $bw.Write([int]40); $bw.Write([int]$w); $bw.Write([int]($h * 2))
    $bw.Write([int16]1); $bw.Write([int16]32); $bw.Write([int]0)
    $bw.Write([int]($w * $h * 4 + $maskRow * $h))
    $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0)
    # XOR: rady zdola nahoru, BGRA tak, jak je LockBits vrati
    for ($y = $h - 1; $y -ge 0; $y--) { $bw.Write($raw, $y * $data.Stride, $w * 4) }
    # AND: same nuly, protoze pruhlednost nese alfa kanal
    $zero = New-Object byte[] $maskRow
    for ($y = 0; $y -lt $h; $y++) { $bw.Write($zero, 0, $maskRow) }
    $bw.Flush()
    $entries += [pscustomobject]@{ W = $w; H = $h; Bytes = $ms.ToArray() }
    $bw.Dispose(); $ms.Dispose(); $conv.Dispose()
}

$entries += [pscustomobject]@{ W = 256; H = 256; Bytes = [System.IO.File]::ReadAllBytes((Join-Path $PngDir "256x256.png")) }

# Ne $out: parametr $Out je [string] a PowerShell nerozlisuje velikost pismen,
# takze prirazeni streamu do $out ho pretypuje na retezec.
$icoStream = New-Object System.IO.MemoryStream
$w2 = New-Object System.IO.BinaryWriter $icoStream
$w2.Write([int16]0); $w2.Write([int16]1); $w2.Write([int16]$entries.Count)
$offset = 6 + 16 * $entries.Count
foreach ($e in $entries) {
    $w2.Write([byte]($(if ($e.W -ge 256) { 0 } else { $e.W })))
    $w2.Write([byte]($(if ($e.H -ge 256) { 0 } else { $e.H })))
    $w2.Write([byte]0); $w2.Write([byte]0)
    $w2.Write([int16]1); $w2.Write([int16]32)
    $w2.Write([int]$e.Bytes.Length); $w2.Write([int]$offset)
    $offset += $e.Bytes.Length
}
foreach ($e in $entries) { $w2.Write($e.Bytes, 0, $e.Bytes.Length) }
$w2.Flush()
[System.IO.File]::WriteAllBytes($Out, $icoStream.ToArray())
$w2.Dispose(); $icoStream.Dispose()

"zapsano $Out - $($entries.Count) velikosti: $(($entries | ForEach-Object { $_.W }) -join ', ')"
