param([string]$Out = "$PSScriptRoot\egovai.ico", [string]$PngOut = "$PSScriptRoot\egovai-256.png")
# Tạo biểu tượng ứng dụng Windows (.ico nhiều kích thước) theo biến thể "Biểu tượng ứng dụng" trong design/egovai-logo.html:
# nền vuông bo góc đỏ chuyển sắc (#C41821 -> #8E0E15) + biểu trưng đảo màu (#mark-rev: đĩa vàng #F2C230, họa tiết đỏ #B3121B).
Add-Type -AssemblyName System.Drawing
$red = [System.Drawing.Color]::FromArgb(0xB3,0x12,0x1B)
$redTop = [System.Drawing.Color]::FromArgb(0xC4,0x18,0x21)
$redDeep = [System.Drawing.Color]::FromArgb(0x8E,0x0E,0x15)
$gold = [System.Drawing.Color]::FromArgb(0xF2,0xC2,0x30)
$dots = @(@(37.90,6.16),@(48.52,11.28),@(55.88,20.50),@(58.50,32.00),@(55.88,43.50),@(48.52,52.72),@(37.90,57.84),@(26.10,57.84),@(15.48,52.72),@(8.12,43.50),@(5.50,32.00),@(8.12,20.50),@(15.48,11.28),@(26.10,6.16))
$star = "32.00,17.00 33.16,26.93 38.51,18.49 35.24,27.93 43.73,22.65 36.69,29.74 46.62,28.66 37.20,32.00 46.62,35.34 36.69,34.26 43.73,41.35 35.24,36.07 38.51,45.51 33.16,37.07 32.00,47.00 30.84,37.07 25.49,45.51 28.76,36.07 20.27,41.35 27.31,34.26 17.38,35.34 26.80,32.00 17.38,28.66 27.31,29.74 20.27,22.65 28.76,27.93 25.49,18.49 30.84,26.93"
$pts = $star.Split(' ') | ForEach-Object { $xy = $_.Split(','); New-Object System.Drawing.PointF([float]$xy[0], [float]$xy[1]) }

function RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $d = $r * 2
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Render([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)

  # Ô vuông bo góc nền đỏ chuyển sắc 160deg (như .appicon 96x96, border-radius 24px)
  $pad = if ($size -ge 32) { $size * 0.04 } else { 0.0 }
  $box = $size - 2 * $pad
  $rad = $box * 0.25
  $rectPath = RoundedRectPath $pad $pad $box $box $rad
  $gradRect = New-Object System.Drawing.RectangleF $pad, $pad, $box, $box
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $gradRect, $redTop, $redDeep, 70.0
  $g.FillPath($bgBrush, $rectPath)

  # Biểu trưng đảo màu (#mark-rev) chiếm 68.75% kích thước ô (66/96)
  $markSize = $box * (66.0 / 96.0)
  $offset = $pad + ($box - $markSize) / 2.0
  $g.TranslateTransform($offset, $offset)
  $s = $markSize / 64.0
  $g.ScaleTransform($s, $s)

  $rb = New-Object System.Drawing.SolidBrush $red
  $gb = New-Object System.Drawing.SolidBrush $gold
  $g.FillEllipse($gb, 1, 1, 62, 62)
  if ($size -ge 32) {
    $p1 = New-Object System.Drawing.Pen $red, 1.0; $g.DrawEllipse($p1, 32-29.4, 32-29.4, 58.8, 58.8)
    $p2 = New-Object System.Drawing.Pen $red, 1.2; $g.DrawEllipse($p2, 32-22.6, 32-22.6, 45.2, 45.2)
    foreach ($d in $dots) { $g.FillEllipse($rb, $d[0]-1.3, $d[1]-1.3, 2.6, 2.6) }
  }
  $g.FillPolygon($rb, [System.Drawing.PointF[]]$pts)
  $g.FillEllipse($gb, 32-3.4, 32-3.4, 6.8, 6.8)
  $g.FillEllipse($rb, 32-1.6, 32-1.6, 3.2, 3.2)

  $bgBrush.Dispose(); $rectPath.Dispose(); $rb.Dispose(); $gb.Dispose(); $g.Dispose()
  return $bmp
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = foreach ($sz in $sizes) {
  $b = Render $sz; $ms = New-Object System.IO.MemoryStream
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  if ($sz -eq 256) { $b.Save($PngOut, [System.Drawing.Imaging.ImageFormat]::Png) }
  $b.Dispose(); ,$ms.ToArray()
}
$fs = [System.IO.File]::Create($Out); $w = New-Object System.IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $sz = $sizes[$i]; $dim = if ($sz -ge 256) { 0 } else { $sz }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$pngs[$i].Length); $w.Write([UInt32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Close()
Write-Host "Icon: $Out"
