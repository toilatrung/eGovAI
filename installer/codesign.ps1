# Ký số Authenticode cho bộ cài eGovAI (dot-source: . installer\codesign.ps1).
# Không chứa bí mật nào: chứng thư và mật khẩu chỉ lấy từ biến môi trường. Xem docs\code-signing.md.
#
# Chọn MỘT cấu hình (EGOVAI_SIGN_MODE = pfx | store | trusted; bỏ trống thì tự nhận theo biến có mặt):
#   pfx      EGOVAI_SIGN_PFX           đường dẫn tệp .pfx
#            EGOVAI_SIGN_PFX_PASSWORD  mật khẩu tệp .pfx (có thể bỏ trống nếu .pfx không có mật khẩu)
#   store    EGOVAI_SIGN_THUMBPRINT    SHA-1 thumbprint của chứng thư đã cài vào kho Cert:\CurrentUser\My
#                                      (dùng cho token USB/EV hoặc chứng thư đã import)
#   trusted  EGOVAI_SIGN_DLIB          đường dẫn Azure.CodeSigning.Dlib.dll (Azure Trusted Signing / Artifact Signing)
#            EGOVAI_SIGN_METADATA      đường dẫn metadata.json (Endpoint, CodeSigningAccountName, CertificateProfileName)
#            Đăng nhập Azure qua DefaultAzureCredential: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET hoặc `az login`.
# Tùy chọn:
#   EGOVAI_SIGN_TIMESTAMP_URL  máy chủ tem thời gian RFC 3161 (mặc định: DigiCert cho pfx/store, Microsoft cho trusted)
#   EGOVAI_SIGNTOOL            đường dẫn signtool.exe (mặc định: tự tìm trong Windows Kits / NuGet)

function Get-SignConfig {
  $mode = "$env:EGOVAI_SIGN_MODE".Trim().ToLowerInvariant()
  if (-not $mode) {
    if ($env:EGOVAI_SIGN_DLIB -or $env:EGOVAI_SIGN_METADATA) { $mode = 'trusted' }
    elseif ($env:EGOVAI_SIGN_PFX) { $mode = 'pfx' }
    elseif ($env:EGOVAI_SIGN_THUMBPRINT) { $mode = 'store' }
    else { return $null }
  }
  $cfg = @{ Mode = $mode }
  switch ($mode) {
    'pfx' {
      if (-not $env:EGOVAI_SIGN_PFX -or -not (Test-Path $env:EGOVAI_SIGN_PFX)) { throw "EGOVAI_SIGN_PFX không trỏ tới tệp .pfx hợp lệ." }
      $cfg.Args = @('/f', $env:EGOVAI_SIGN_PFX)
      if ($env:EGOVAI_SIGN_PFX_PASSWORD) { $cfg.Args += @('/p', $env:EGOVAI_SIGN_PFX_PASSWORD) }
      $cfg.Timestamp = 'http://timestamp.digicert.com'
      $cfg.Label = "PFX ($(Split-Path $env:EGOVAI_SIGN_PFX -Leaf))"
    }
    'store' {
      $tp = ("$env:EGOVAI_SIGN_THUMBPRINT" -replace '[^0-9A-Fa-f]', '')
      if ($tp.Length -ne 40) { throw 'EGOVAI_SIGN_THUMBPRINT phải là SHA-1 thumbprint 40 ký tự hex.' }
      $cfg.Args = @('/sha1', $tp, '/s', 'My')
      $cfg.Timestamp = 'http://timestamp.digicert.com'
      $cfg.Label = "kho chứng thư (thumbprint $tp)"
    }
    'trusted' {
      foreach ($v in 'EGOVAI_SIGN_DLIB', 'EGOVAI_SIGN_METADATA') {
        $p = [Environment]::GetEnvironmentVariable($v)
        if (-not $p -or -not (Test-Path $p)) { throw "$v chưa đặt hoặc không tồn tại (cần cho Azure Trusted Signing)." }
      }
      $cfg.Args = @('/dlib', $env:EGOVAI_SIGN_DLIB, '/dmdf', $env:EGOVAI_SIGN_METADATA)
      $cfg.Timestamp = 'http://timestamp.acs.microsoft.com'
      $cfg.Label = 'Azure Trusted Signing'
    }
    default { throw "EGOVAI_SIGN_MODE không hợp lệ: '$mode' (dùng pfx, store hoặc trusted)." }
  }
  if ($env:EGOVAI_SIGN_TIMESTAMP_URL) { $cfg.Timestamp = $env:EGOVAI_SIGN_TIMESTAMP_URL }
  $cfg.SignTool = Find-SignTool
  return $cfg
}

function Find-SignTool {
  if ($env:EGOVAI_SIGNTOOL) {
    if (Test-Path $env:EGOVAI_SIGNTOOL) { return $env:EGOVAI_SIGNTOOL }
    throw "EGOVAI_SIGNTOOL không tồn tại: $env:EGOVAI_SIGNTOOL"
  }
  $arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
  $roots = @()
  foreach ($pf in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
    if ($pf) { $roots += (Join-Path $pf 'Windows Kits\10\bin') }
  }
  $roots += (Join-Path $env:USERPROFILE '.nuget\packages\microsoft.windows.sdk.buildtools')
  $found = foreach ($r in $roots) {
    if (Test-Path $r) { Get-ChildItem $r -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue | Where-Object { $_.Directory.Name -eq $arch } }
  }
  $best = $found | Sort-Object { try { [version]$_.VersionInfo.FileVersion.Split(' ')[0] } catch { [version]'0.0' } } -Descending | Select-Object -First 1
  if (-not $best) {
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw 'Không tìm thấy signtool.exe. Cài Windows SDK (thành phần "Signing Tools") hoặc gói NuGet Microsoft.Windows.SDK.BuildTools, hoặc đặt EGOVAI_SIGNTOOL.'
  }
  return $best.FullName
}

function Test-SignedValid([string]$Path) {
  return (Get-AuthenticodeSignature -FilePath $Path).Status -eq 'Valid'
}

# Ký các tệp chưa có chữ ký hợp lệ (bỏ qua tệp đã được Microsoft/nhà cung cấp ký sẵn).
function Invoke-CodeSign($Cfg, [string[]]$Files, [switch]$Force) {
  $todo = @($Files | Where-Object { $Force -or -not (Test-SignedValid $_) })
  $skipped = $Files.Count - $todo.Count
  if ($skipped -gt 0) { Write-Host "  Bỏ qua $skipped tệp đã có chữ ký hợp lệ." }
  if ($todo.Count -eq 0) { return }
  $common = @('sign', '/fd', 'SHA256', '/tr', $Cfg.Timestamp, '/td', 'SHA256', '/d', 'eGovAI', '/du', 'https://github.com/toilatrung/eGovAI') + $Cfg.Args
  for ($i = 0; $i -lt $todo.Count; $i += 20) {
    $batch = $todo[$i..([Math]::Min($i + 19, $todo.Count - 1))]
    $batch | ForEach-Object { Write-Host "  ký  $_" }
    $ok = $false
    for ($try = 1; $try -le 3 -and -not $ok; $try++) {
      # Không in dòng lệnh để mật khẩu PFX không lọt vào nhật ký build.
      & $Cfg.SignTool @common @batch | Out-Host
      $ok = ($LASTEXITCODE -eq 0)
      if (-not $ok -and $try -lt 3) { Write-Host "  signtool lỗi (mã $LASTEXITCODE), thử lại lần $($try + 1) sau 5 giây…" -ForegroundColor Yellow; Start-Sleep -Seconds 5 }
    }
    if (-not $ok) { throw "signtool thất bại (mã $LASTEXITCODE)." }
  }
  $bad = @($todo | Where-Object { -not (Test-SignedValid $_) })
  if ($bad.Count) { throw "Chữ ký không hợp lệ sau khi ký: $($bad -join ', ')" }
}

# Các tệp thực thi (PE) cần ký trong thư mục ứng dụng đã ghép.
function Get-PeFiles([string]$Dir) {
  Get-ChildItem $Dir -Recurse -File -Include *.exe, *.dll, *.node, *.sys, *.ocx | ForEach-Object { $_.FullName }
}

function Write-UnsignedWarning {
  Write-Host ''
  Write-Host '  CẢNH BÁO: chưa cấu hình ký số — bộ cài và ứng dụng KHÔNG được ký.' -ForegroundColor Yellow
  Write-Host '  Windows 11 Smart App Control sẽ chặn eGovAI trên máy người dùng; SmartScreen sẽ cảnh báo "Unknown publisher".' -ForegroundColor Yellow
  Write-Host '  Đặt EGOVAI_SIGN_PFX / EGOVAI_SIGN_THUMBPRINT / EGOVAI_SIGN_DLIB + EGOVAI_SIGN_METADATA (xem docs\code-signing.md).' -ForegroundColor Yellow
  Write-Host ''
}
