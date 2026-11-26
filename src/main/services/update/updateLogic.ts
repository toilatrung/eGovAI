/**
 * Pure helpers for the release checker / updater (no Electron imports — unit-tested in tests/).
 */

export const UPDATE_REPO = 'toilatrung/eGovAI'
export const RELEASES_LATEST_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`
/** Only assets published under this prefix are downloaded (GitHub then redirects to its CDN). */
export const RELEASE_DOWNLOAD_PREFIX = `https://github.com/${UPDATE_REPO}/releases/download/`
export const SHA256SUMS_NAME = 'SHA256SUMS.txt'

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

const SEMVER_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/

/** Parse `1.2.3`, `v1.2.3`, `1.2.3-beta.1`, `1.2.3+build`. Returns null when not semver. */
export function parseVersion(input: string | null | undefined): ParsedVersion | null {
  const m = SEMVER_RE.exec((input ?? '').trim())
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : []
  }
}

function compareIdentifiers(a: string, b: string): number {
  const an = /^\d+$/.test(a)
  const bn = /^\d+$/.test(b)
  if (an && bn) return Math.sign(Number(a) - Number(b))
  if (an) return -1 // numeric identifiers have lower precedence
  if (bn) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Semver precedence: -1 if a < b, 0 if equal, 1 if a > b. Build metadata is ignored.
 * Throws when either side is not a valid version.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) throw new Error(`Phiên bản không hợp lệ: ${!pa ? a : b}`)
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1
  }
  const ra = pa.prerelease
  const rb = pb.prerelease
  if (ra.length === 0 && rb.length === 0) return 0
  if (ra.length === 0) return 1 // release > prerelease
  if (rb.length === 0) return -1
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
    if (i >= ra.length) return -1
    if (i >= rb.length) return 1
    const c = compareIdentifiers(ra[i], rb[i])
    if (c !== 0) return c < 0 ? -1 : 1
  }
  return 0
}

/** True when `candidate` is a valid version strictly newer than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  if (!parseVersion(candidate) || !parseVersion(current)) return false
  return compareVersions(candidate, current) > 0
}

export interface GitHubReleaseAsset {
  name: string
  size: number
  browser_download_url: string
}

export interface GitHubRelease {
  tag_name: string
  name?: string | null
  body?: string | null
  draft?: boolean
  prerelease?: boolean
  html_url?: string
  published_at?: string | null
  assets?: GitHubReleaseAsset[]
}

export interface ResolvedRelease {
  version: string
  tag: string
  name: string
  notes: string
  htmlUrl: string
  publishedAt: string
  installer: GitHubReleaseAsset
  sums: GitHubReleaseAsset
}

export type ResolveReleaseResult =
  | { ok: true; release: ResolvedRelease }
  | { ok: false; reason: 'draft' | 'prerelease' | 'badTag' | 'noInstaller' | 'noChecksums' | 'badAssetUrl' }

export function installerAssetName(version: string): string {
  return `eGovAI-Setup-${version}.exe`
}

function isTrustedAssetUrl(url: string): boolean {
  return typeof url === 'string' && url.startsWith(RELEASE_DOWNLOAD_PREFIX)
}

/** Validate a `releases/latest` payload and pick the installer + SHA256SUMS assets. */
export function resolveRelease(rel: GitHubRelease): ResolveReleaseResult {
  if (rel.draft) return { ok: false, reason: 'draft' }
  if (rel.prerelease) return { ok: false, reason: 'prerelease' }
  const parsed = parseVersion(rel.tag_name)
  if (!parsed || parsed.prerelease.length > 0) return { ok: false, reason: 'badTag' }
  const version = rel.tag_name.trim().replace(/^v/, '').replace(/\+.*$/, '')
  const assets = rel.assets ?? []
  const wanted = installerAssetName(version).toLowerCase()
  const installer = assets.find((a) => a.name.toLowerCase() === wanted)
  if (!installer) return { ok: false, reason: 'noInstaller' }
  const sums = assets.find((a) => a.name.toLowerCase() === SHA256SUMS_NAME.toLowerCase())
  if (!sums) return { ok: false, reason: 'noChecksums' }
  if (!isTrustedAssetUrl(installer.browser_download_url) || !isTrustedAssetUrl(sums.browser_download_url)) {
    return { ok: false, reason: 'badAssetUrl' }
  }
  return {
    ok: true,
    release: {
      version,
      tag: rel.tag_name,
      name: rel.name?.trim() || `eGovAI ${rel.tag_name}`,
      notes: (rel.body ?? '').slice(0, 50_000),
      htmlUrl: rel.html_url ?? `https://github.com/${UPDATE_REPO}/releases/tag/${rel.tag_name}`,
      publishedAt: rel.published_at ?? '',
      installer,
      sums
    }
  }
}

/**
 * Find the SHA-256 for `fileName` in a sha256sum-style file
 * (`<hex> *name`, `<hex>  name`; BOM / CRLF tolerated). Returns lowercase hex or null.
 */
export function parseSha256Sums(text: string, fileName: string): string | null {
  const target = fileName.toLowerCase()
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(raw.trim())
    if (m && m[2].toLowerCase() === target) return m[1].toLowerCase()
  }
  return null
}

/** `Get-AuthenticodeSignature` status names (System.Management.Automation.SignatureStatus). */
export type SignatureStatus =
  | 'Valid'
  | 'NotSigned'
  | 'HashMismatch'
  | 'NotTrusted'
  | 'UnknownError'
  | 'Incompatible'
  | 'NotSupportedFileFormat'
  | string

/**
 * Policy: a valid signature passes; an unsigned installer is allowed for now (logged) unless the
 * running app itself is validly signed (no silent downgrade from signed to unsigned); any other
 * status means a signature is present but broken/untrusted → refuse.
 */
export function evaluateSignature(
  installerStatus: SignatureStatus,
  currentAppStatus?: SignatureStatus
): { allow: boolean; unsigned: boolean } {
  if (installerStatus === 'Valid') return { allow: true, unsigned: false }
  if (installerStatus === 'NotSigned') {
    return { allow: currentAppStatus !== 'Valid', unsigned: true }
  }
  return { allow: false, unsigned: false }
}

/** Quote a value for a Windows command line (CommandLineToArgvW rules). */
export function quoteWindowsArg(value: string): string {
  if (value !== '' && !/[\s"]/.test(value)) return value
  let out = '"'
  let backslashes = 0
  for (const ch of value) {
    if (ch === '\\') {
      backslashes++
    } else if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"'
      backslashes = 0
    } else {
      out += '\\'.repeat(backslashes) + ch
      backslashes = 0
    }
  }
  return out + '\\'.repeat(backslashes * 2) + '"'
}

/**
 * Argument string for a silent upgrade with Installer.cs: `/S "/dir=<dir>"` plus
 * `/nodesktop` / `/nostartmenu` when the user had removed those shortcuts (silent mode
 * would otherwise recreate them).
 */
export function buildInstallerArgs(
  installDir: string,
  opts: { desktopShortcut: boolean; startMenuShortcut: boolean }
): string {
  const dir = installDir.replace(/[\\/]+$/, '')
  const parts = ['/S', quoteWindowsArg(`/dir=${dir}`)]
  if (!opts.desktopShortcut) parts.push('/nodesktop')
  if (!opts.startMenuShortcut) parts.push('/nostartmenu')
  return parts.join(' ')
}

/** PowerShell single-quoted literal (no variable expansion; `'` doubled). */
export function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export interface UpdateHelperScriptInput {
  appPid: number
  installerPath: string
  installerArgs: string
  installDir: string
  appExe: string
  logFile: string
  resultFile: string
  /** Run the installer through UAC (install dir not writable by the current user). */
  elevate: boolean
}

/**
 * Helper run detached by the app right before it quits. Installer.cs in /S mode does NOT relaunch
 * the app (launchAfter=false) and force-kills any eGovAI.exe still running from the install dir,
 * so the helper waits for this process to exit cleanly first, runs the installer silently,
 * records its exit code, then starts eGovAI.exe again (as the normal, non-elevated user).
 * All values are embedded as single-quoted literals — nothing is passed on the command line.
 */
export function buildUpdateHelperScript(i: UpdateHelperScriptInput): string {
  return [
    '# eGovAI update helper (tạo tự động — có thể xoá)',
    "$ErrorActionPreference = 'Continue'",
    `$appPid = ${Math.trunc(i.appPid)}`,
    `$installer = ${psLiteral(i.installerPath)}`,
    `$installArgs = ${psLiteral(i.installerArgs)}`,
    `$installDir = ${psLiteral(i.installDir)}`,
    `$appExe = ${psLiteral(i.appExe)}`,
    `$log = ${psLiteral(i.logFile)}`,
    `$resultFile = ${psLiteral(i.resultFile)}`,
    `$elevate = $${i.elevate ? 'true' : 'false'}`,
    'function Write-UpdateLog([string]$m) { try { Add-Content -LiteralPath $log -Value ((Get-Date -Format s) + \'  \' + $m) -Encoding UTF8 } catch {} }',
    'Write-UpdateLog ("Cho eGovAI (PID " + $appPid + ") thoat")',
    'try {',
    '  $p = Get-Process -Id $appPid -ErrorAction Stop',
    '  if (-not $p.WaitForExit(60000)) {',
    "    Write-UpdateLog 'Qua 60 giay, buoc dung tien trinh'",
    '    Stop-Process -Id $appPid -Force -ErrorAction SilentlyContinue',
    '    Start-Sleep -Seconds 2',
    '  }',
    '} catch { }',
    'Start-Sleep -Seconds 1',
    '$code = -1',
    'try {',
    '  $sp = @{ FilePath = $installer; ArgumentList = $installArgs; PassThru = $true; Wait = $true }',
    "  if ($elevate) { $sp.Verb = 'RunAs' }",
    '  Write-UpdateLog ("Chay bo cai: " + $installer + " " + $installArgs)',
    '  $proc = Start-Process @sp',
    '  $code = $proc.ExitCode',
    '  Write-UpdateLog ("Bo cai ket thuc, ma thoat " + $code)',
    '} catch { Write-UpdateLog ("Khong chay duoc bo cai: " + $_.Exception.Message) }',
    'try { Set-Content -LiteralPath $resultFile -Value (@{ exitCode = $code; finishedAt = (Get-Date).ToString(\'o\') } | ConvertTo-Json -Compress) -Encoding UTF8 } catch {}',
    "if (Test-Path -LiteralPath $appExe) { Start-Process -FilePath $appExe -WorkingDirectory $installDir } else { Write-UpdateLog 'Khong thay eGovAI.exe de mo lai' }",
    ''
  ].join('\r\n')
}

export const AUTO_CHECK_DELAY_MS = 10_000
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
