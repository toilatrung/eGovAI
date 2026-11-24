# Phát hành phiên bản mới của eGovAI lên GitHub.
# Cách dùng (tại thư mục gốc dự án):
#   1. Tăng "version" trong package.json, ví dụ 0.2.0
#   2. Viết ghi chú phát hành vào docs\releases\v0.2.0.md
#   3. powershell -ExecutionPolicy Bypass -File scripts\release.ps1
#      (thêm -SkipBuild nếu dist\eGovAI-Setup-<version>.exe đã được đóng gói sẵn)
param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
$notes = Join-Path $root "docs\releases\$tag.md"
$exe = Join-Path $root "dist\eGovAI-Setup-$version.exe"

if (-not (Test-Path $notes)) { throw "Thiếu ghi chú phát hành: $notes" }
if (git status --porcelain) { throw 'Còn thay đổi chưa commit. Hãy commit trước khi phát hành.' }
if (git tag --list $tag) { throw "Tag $tag đã tồn tại. Hãy tăng version trong package.json." }

Step 'Chạy kiểm thử'
& pnpm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Kiểm thử thất bại' }

if (-not $SkipBuild) {
  Step 'Đóng gói bộ cài'
  & pnpm.cmd run package
  if ($LASTEXITCODE -ne 0) { throw 'Đóng gói thất bại' }
}
if (-not (Test-Path $exe)) { throw "Không thấy bộ cài: $exe" }

Step 'Tính SHA-256'
$sums = Join-Path $root 'dist\SHA256SUMS.txt'
$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
"$hash *eGovAI-Setup-$version.exe" | Out-File $sums -Encoding ascii

Step "Tạo tag $tag và đẩy lên GitHub"
git tag -a $tag -m "eGovAI $tag"
git push origin HEAD
git push origin $tag

Step 'Tạo GitHub Release'
& gh release create $tag $exe $sums --title "eGovAI $tag" --notes-file $notes --latest
if ($LASTEXITCODE -ne 0) { throw 'gh release create thất bại' }
Write-Host "`nXong: phát hành $tag" -ForegroundColor Green
