# Đóng gói eGovAI thành bộ cài một tệp: dist\eGovAI-Setup-0.1.0.exe
# Cách dùng (tại thư mục gốc dự án):
#   powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1            # build đầy đủ
#   powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 -SkipApp   # chỉ biên dịch lại bộ cài
#   ... -RequireSign   # dừng lại nếu chưa cấu hình ký số (release.ps1 dùng mặc định)
# Ký số: đặt biến môi trường theo docs\code-signing.md (EGOVAI_SIGN_PFX, EGOVAI_SIGN_THUMBPRINT hoặc EGOVAI_SIGN_DLIB + EGOVAI_SIGN_METADATA).
param([switch]$SkipApp, [switch]$RequireSign)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$inst = Join-Path $root 'installer'
$build = Join-Path $root 'build'
$stage = Join-Path $build 'stage\eGovAI'
$dist = Join-Path $root 'dist'
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$fx = Split-Path $csc -Parent

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

. (Join-Path $inst 'codesign.ps1')
$sign = Get-SignConfig
if ($sign) { Write-Host "Ký số: $($sign.Label) — signtool: $($sign.SignTool)" -ForegroundColor Green }
elseif ($RequireSign) { throw 'Chưa cấu hình ký số mà có -RequireSign. Xem docs\code-signing.md.' }
else { Write-UnsignedWarning }

# Thông tin phiên bản cho bộ cài/gỡ cài (AssemblyFileVersion phải là số dạng a.b.c.d).
$numVer = ($version -replace '[-+].*$', '')
while (($numVer.Split('.')).Count -lt 4) { $numVer += '.0' }
New-Item -ItemType Directory $build -Force | Out-Null
function Write-AsmInfo($path, $title, $desc) {
  @"
using System.Reflection;
[assembly: AssemblyTitle("$title")]
[assembly: AssemblyDescription("$desc")]
[assembly: AssemblyProduct("eGovAI")]
[assembly: AssemblyCompany("Nhóm phát triển eGovAI")]
[assembly: AssemblyCopyright("Copyright (c) 2026 Nhóm phát triển eGovAI. MIT License")]
[assembly: AssemblyVersion("$numVer")]
[assembly: AssemblyFileVersion("$numVer")]
[assembly: AssemblyInformationalVersion("$version")]
"@ | Out-File $path -Encoding utf8
}
$asmSetup = Join-Path $build 'AssemblyInfo.Installer.cs'
$asmUninst = Join-Path $build 'AssemblyInfo.Uninstaller.cs'
Write-AsmInfo $asmSetup 'Bộ cài eGovAI' "Trình cài đặt eGovAI $version"
Write-AsmInfo $asmUninst 'Gỡ cài đặt eGovAI' "Trình gỡ cài đặt eGovAI $version"

if (-not $SkipApp) {
  Step 'Build mã nguồn ứng dụng (electron-vite)'
  & pnpm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'pnpm run build thất bại' }

  Step 'Chuẩn bị thư mục ứng dụng'
  if (Test-Path (Join-Path $build 'stage')) { Remove-Item (Join-Path $build 'stage') -Recurse -Force }
  $app = Join-Path $build 'stage\app'
  New-Item -ItemType Directory $app -Force | Out-Null
  Copy-Item package.json, pnpm-lock.yaml $app
  Copy-Item out (Join-Path $app 'out') -Recurse

  Step 'Cài thư viện chạy (production, hoisted)'
  & pnpm.cmd install --prod --frozen-lockfile --ignore-scripts --config.node-linker=hoisted --dir $app
  if ($LASTEXITCODE -ne 0) { throw 'pnpm install --prod thất bại' }
  # Các gói chỉ dùng cho giao diện đã được Vite đóng gói sẵn trong out\renderer.
  'lucide-react', 'react', 'react-dom', 'react-markdown', 'remark-gfm', 'i18next', 'react-i18next', 'zustand', '@fontsource' |
    ForEach-Object { Remove-Item (Join-Path $app "node_modules\$_") -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-Item (Join-Path $app 'pnpm-lock.yaml'), (Join-Path $app 'node_modules\.modules.yaml'), (Join-Path $app 'node_modules\.pnpm') -Recurse -Force -ErrorAction SilentlyContinue

  Step 'Ghép môi trường Electron'
  Copy-Item (Join-Path $root 'node_modules\electron\dist') $stage -Recurse
  Rename-Item (Join-Path $stage 'electron.exe') 'eGovAI.exe'
  Remove-Item (Join-Path $stage 'resources\default_app.asar') -ErrorAction SilentlyContinue
  Move-Item $app (Join-Path $stage 'resources\app')
}
if (-not (Test-Path (Join-Path $stage 'eGovAI.exe'))) { throw "Chưa có ứng dụng tại $stage. Chạy lại không kèm -SkipApp." }

Step 'Tạo biểu tượng'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $inst 'make-icon.ps1')
$ico = Join-Path $inst 'egovai.ico'
if (-not $SkipApp) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $inst 'set-exe-icon.ps1') -Exe (Join-Path $stage 'eGovAI.exe') -Icon $ico
}

# Ký sau khi đổi biểu tượng (đổi tài nguyên làm mất chữ ký cũ) và trước khi nén.
if ($sign) {
  Step 'Ký số các tệp thực thi trong ứng dụng'
  Invoke-CodeSign $sign @(Get-PeFiles $stage)
}

Step 'Nén gói ứng dụng (payload.zip)'
$payload = Join-Path $build 'payload.zip'
Remove-Item $payload -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $payload, [System.IO.Compression.CompressionLevel]::Optimal, $false)
'{0:N1} MB' -f ((Get-Item $payload).Length / 1MB) | Write-Host

Step 'Biên dịch trình gỡ cài đặt'
$uninst = Join-Path $build 'uninstall.exe'
& $csc /nologo /codepage:65001 /target:winexe /optimize+ /platform:anycpu "/win32icon:$ico" "/win32manifest:$(Join-Path $inst 'app.manifest')" `
  /r:System.Windows.Forms.dll "/out:$uninst" (Join-Path $inst 'Uninstaller.cs') $asmUninst
if ($LASTEXITCODE -ne 0) { throw 'Biên dịch trình gỡ cài đặt thất bại' }
if ($sign) { Step 'Ký số trình gỡ cài đặt'; Invoke-CodeSign $sign @($uninst) -Force }

Step 'Biên dịch bộ cài'
New-Item -ItemType Directory $dist -Force | Out-Null
$setup = Join-Path $dist "eGovAI-Setup-$version.exe"
& $csc /nologo /codepage:65001 /target:winexe /optimize+ /platform:anycpu "/win32icon:$ico" "/win32manifest:$(Join-Path $inst 'app.manifest')" `
  "/lib:$fx\WPF" /r:PresentationFramework.dll /r:PresentationCore.dll /r:WindowsBase.dll /r:System.Xaml.dll `
  /r:System.IO.Compression.dll /r:System.Windows.Forms.dll /r:System.Core.dll `
  "/resource:$(Join-Path $inst 'Installer.xaml'),Installer.xaml" "/resource:$ico,egovai.ico" `
  "/resource:$uninst,uninstall.exe" "/resource:$payload,payload.zip" `
  "/out:$setup" (Join-Path $inst 'Installer.cs') $asmSetup
if ($LASTEXITCODE -ne 0) { throw 'Biên dịch bộ cài thất bại' }
if ($sign) { Step 'Ký số bộ cài'; Invoke-CodeSign $sign @($setup) -Force }

$hash = (Get-FileHash $setup -Algorithm SHA256).Hash
$sigStatus = (Get-AuthenticodeSignature $setup).Status
Step "Hoàn tất: $setup"
'{0:N1} MB  SHA256 {1}  Chữ ký: {2}' -f ((Get-Item $setup).Length / 1MB), $hash, $sigStatus | Write-Host
if (-not $sign) { Write-UnsignedWarning }
