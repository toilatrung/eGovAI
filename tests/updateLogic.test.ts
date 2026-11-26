import { describe, expect, it } from 'vitest'
import {
  buildInstallerArgs,
  buildUpdateHelperScript,
  compareVersions,
  evaluateSignature,
  isNewerVersion,
  parseSha256Sums,
  parseVersion,
  psLiteral,
  quoteWindowsArg,
  resolveRelease,
  type GitHubRelease
} from '../src/main/services/update/updateLogic'

describe('compareVersions', () => {
  it('orders major/minor/patch numerically', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1)
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('2.3.4', '2.3.4')).toBe(0)
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1)
  })

  it('accepts a leading v and ignores build metadata', () => {
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('1.0.0+abc', '1.0.0+def')).toBe(0)
  })

  it('ranks prereleases below the release and per semver §11', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1)
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0'
    ]
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareVersions(ordered[i], ordered[i + 1]), `${ordered[i]} < ${ordered[i + 1]}`).toBe(-1)
      expect(compareVersions(ordered[i + 1], ordered[i])).toBe(1)
    }
  })

  it('throws on invalid input; isNewerVersion returns false instead', () => {
    expect(() => compareVersions('1.0', '1.0.0')).toThrow()
    expect(parseVersion('01.0.0')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
    expect(isNewerVersion('garbage', '0.1.0')).toBe(false)
    expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true)
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false)
    expect(isNewerVersion('0.0.9', '0.1.0')).toBe(false)
  })
})

const DL = 'https://github.com/toilatrung/eGovAI/releases/download/v0.2.0/'
function release(over: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    tag_name: 'v0.2.0',
    name: 'eGovAI v0.2.0',
    body: '## Mới\n- Tự cập nhật',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/toilatrung/eGovAI/releases/tag/v0.2.0',
    published_at: '2026-11-20T00:00:00Z',
    assets: [
      { name: 'eGovAI-Setup-0.2.0.exe', size: 123, browser_download_url: `${DL}eGovAI-Setup-0.2.0.exe` },
      { name: 'SHA256SUMS.txt', size: 90, browser_download_url: `${DL}SHA256SUMS.txt` }
    ],
    ...over
  }
}

describe('resolveRelease', () => {
  it('picks the setup and checksum assets', () => {
    const r = resolveRelease(release())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.release.version).toBe('0.2.0')
      expect(r.release.installer.name).toBe('eGovAI-Setup-0.2.0.exe')
      expect(r.release.sums.name).toBe('SHA256SUMS.txt')
      expect(r.release.notes).toContain('Tự cập nhật')
    }
  })

  it('ignores drafts and prereleases', () => {
    expect(resolveRelease(release({ draft: true }))).toEqual({ ok: false, reason: 'draft' })
    expect(resolveRelease(release({ prerelease: true }))).toEqual({ ok: false, reason: 'prerelease' })
    expect(resolveRelease(release({ tag_name: 'v0.2.0-beta.1' }))).toEqual({ ok: false, reason: 'badTag' })
    expect(resolveRelease(release({ tag_name: 'nightly' }))).toEqual({ ok: false, reason: 'badTag' })
  })

  it('requires both assets from the repo download URL', () => {
    expect(resolveRelease(release({ assets: [release().assets![1]] }))).toEqual({ ok: false, reason: 'noInstaller' })
    expect(resolveRelease(release({ assets: [release().assets![0]] }))).toEqual({ ok: false, reason: 'noChecksums' })
    const evil = release()
    evil.assets![0] = { ...evil.assets![0], browser_download_url: 'https://evil.example/eGovAI-Setup-0.2.0.exe' }
    expect(resolveRelease(evil)).toEqual({ ok: false, reason: 'badAssetUrl' })
    // An installer for another version is not picked.
    const wrong = release()
    wrong.assets![0] = { ...wrong.assets![0], name: 'eGovAI-Setup-0.1.0.exe' }
    expect(resolveRelease(wrong)).toEqual({ ok: false, reason: 'noInstaller' })
  })
})

describe('parseSha256Sums', () => {
  const h = 'ab'.repeat(32)
  it('reads the release.ps1 format (BOM, CRLF, *name)', () => {
    const text = `\uFEFF${h.toUpperCase()} *eGovAI-Setup-0.2.0.exe\r\n`
    expect(parseSha256Sums(text, 'eGovAI-Setup-0.2.0.exe')).toBe(h)
  })
  it('accepts two-space format and is case-insensitive on name', () => {
    expect(parseSha256Sums(`${'cd'.repeat(32)}  other.zip\n${h}  egovai-setup-0.2.0.EXE\n`, 'eGovAI-Setup-0.2.0.exe')).toBe(h)
  })
  it('returns null when missing or malformed', () => {
    expect(parseSha256Sums(`${h} *eGovAI-Setup-0.1.0.exe`, 'eGovAI-Setup-0.2.0.exe')).toBeNull()
    expect(parseSha256Sums('deadbeef *eGovAI-Setup-0.2.0.exe', 'eGovAI-Setup-0.2.0.exe')).toBeNull()
  })
})

describe('evaluateSignature', () => {
  it('allows valid, allows unsigned (flagged), refuses broken signatures', () => {
    expect(evaluateSignature('Valid')).toEqual({ allow: true, unsigned: false })
    expect(evaluateSignature('NotSigned', 'NotSigned')).toEqual({ allow: true, unsigned: true })
    for (const s of ['HashMismatch', 'NotTrusted', 'UnknownError', 'Incompatible', 'NotSupportedFileFormat']) {
      expect(evaluateSignature(s).allow, s).toBe(false)
    }
  })
  it('refuses an unsigned installer when the running app is validly signed', () => {
    expect(evaluateSignature('NotSigned', 'Valid')).toEqual({ allow: false, unsigned: true })
  })
})

describe('installer command line', () => {
  it('quotes per Windows rules', () => {
    expect(quoteWindowsArg('/S')).toBe('/S')
    expect(quoteWindowsArg('/dir=C:\\Program Files\\eGovAI')).toBe('"/dir=C:\\Program Files\\eGovAI"')
    expect(quoteWindowsArg('a"b')).toBe('"a\\"b"')
    expect(quoteWindowsArg('C:\\x y\\')).toBe('"C:\\x y\\\\"')
  })
  it('builds /S /dir and keeps removed shortcuts removed', () => {
    expect(
      buildInstallerArgs('C:\\Users\\Tên Người\\AppData\\Local\\Programs\\eGovAI\\', {
        desktopShortcut: true,
        startMenuShortcut: true
      })
    ).toBe('/S "/dir=C:\\Users\\Tên Người\\AppData\\Local\\Programs\\eGovAI"')
    expect(buildInstallerArgs('D:\\eGovAI', { desktopShortcut: false, startMenuShortcut: false })).toBe(
      '/S /dir=D:\\eGovAI /nodesktop /nostartmenu'
    )
  })
  it('embeds values as PowerShell literals in the helper script', () => {
    expect(psLiteral("O'Brien $env:X")).toBe("'O''Brien $env:X'")
    const script = buildUpdateHelperScript({
      appPid: 4242,
      installerPath: "C:\\Temp\\it's\\eGovAI-Setup-0.2.0.exe",
      installerArgs: '/S "/dir=C:\\eGovAI"',
      installDir: 'C:\\eGovAI',
      appExe: 'C:\\eGovAI\\eGovAI.exe',
      logFile: 'C:\\Temp\\update.log',
      resultFile: 'C:\\Temp\\result.json',
      elevate: true
    })
    expect(script).toContain('$appPid = 4242')
    expect(script).toContain("$installer = 'C:\\Temp\\it''s\\eGovAI-Setup-0.2.0.exe'")
    expect(script).toContain('$installArgs = \'/S "/dir=C:\\eGovAI"\'')
    expect(script).toContain('$elevate = $true')
    expect(script).toContain('WaitForExit(60000)')
    expect(script).toContain('Start-Process -FilePath $appExe')
  })
})
