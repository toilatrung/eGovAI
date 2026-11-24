/**
 * Release checker + updater.
 *
 * - Checks https://api.github.com/repos/toilatrung/eGovAI/releases/latest (no auth) on startup
 *   (after ~10s) and every 6h when `autoUpdateCheck` is on, plus on demand.
 * - Download → SHA-256 vs the release's SHA256SUMS.txt → Authenticode check → detached helper
 *   PowerShell that waits for this process to exit, runs `eGovAI-Setup-<v>.exe /S /dir=<install dir>`
 *   and relaunches eGovAI.exe (Installer.cs does not relaunch after /S and would kill a running app).
 * - Installing is only allowed in packaged builds; dev builds only check.
 */
import { app, net } from 'electron'
import { execFile, spawn } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AppSettings, UpdateErrorCode, UpdateState } from '../../shared/types'
import type { AuditLogService } from './auditLogService'
import {
  AUTO_CHECK_DELAY_MS,
  AUTO_CHECK_INTERVAL_MS,
  RELEASES_LATEST_URL,
  buildInstallerArgs,
  buildUpdateHelperScript,
  evaluateSignature,
  isNewerVersion,
  parseSha256Sums,
  resolveRelease,
  type GitHubRelease,
  type ResolvedRelease
} from './updateLogic'

const USER_AGENT = 'eGovAI-Updater'
const CHECK_TIMEOUT_MS = 15_000
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024
const PENDING_FILE = 'update-pending.json'

class UpdateError extends Error {
  constructor(
    public code: UpdateErrorCode,
    detail?: string
  ) {
    super(detail ?? code)
  }
}

interface PendingUpdate {
  fromVersion: string
  toVersion: string
  resultFile: string
  logFile: string
  startedAt: string
}

export interface UpdateServiceDeps {
  getSettings: () => AppSettings
  updateSettings: (partial: Partial<AppSettings>) => void
  audit: AuditLogService
  onState: (state: UpdateState) => void
}

function log(msg: string): void {
  console.log(`[update] ${msg}`)
}

export class UpdateService {
  private state: UpdateState
  private release: ResolvedRelease | null = null
  private timer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null
  private checking: Promise<UpdateState> | null = null
  private busy = false

  constructor(private deps: UpdateServiceDeps) {
    this.state = {
      status: 'idle',
      currentVersion: app.getVersion(),
      canInstall: app.isPackaged && process.platform === 'win32',
      autoCheck: deps.getSettings().autoUpdateCheck !== false
    }
  }

  getState(): UpdateState {
    return this.state
  }

  private setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.deps.onState(this.state)
  }

  private audit(summary: string, details?: Record<string, string | number | boolean>): void {
    this.deps.audit.log({ project: '', conversationId: '', event: 'app_update', summary, details })
  }

  /** Start the automatic schedule and report the outcome of an update started last session. */
  start(): void {
    this.reportPreviousInstall()
    this.startupTimer = setTimeout(() => void this.autoCheck(), AUTO_CHECK_DELAY_MS)
    this.timer = setInterval(() => void this.autoCheck(), AUTO_CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.timer) clearInterval(this.timer)
    this.startupTimer = this.timer = null
  }

  setAutoCheck(enabled: boolean): UpdateState {
    this.deps.updateSettings({ autoUpdateCheck: enabled })
    this.setState({ autoCheck: enabled })
    return this.state
  }

  skipVersion(version: string): UpdateState {
    this.deps.updateSettings({ skippedUpdateVersion: version })
    this.audit(`Người dùng bỏ qua phiên bản ${version}`, { version })
    this.setState({ skipped: this.state.latest?.version === version })
    return this.state
  }

  private async autoCheck(): Promise<void> {
    if (this.deps.getSettings().autoUpdateCheck === false || this.busy) return
    await this.check(false)
  }

  /** Query GitHub. `manual` checks also show a skipped version. Never throws. */
  check(manual: boolean): Promise<UpdateState> {
    if (this.busy) return Promise.resolve(this.state)
    if (!this.checking) {
      this.checking = this.doCheck(manual).finally(() => {
        this.checking = null
      })
    }
    return this.checking
  }

  private async doCheck(manual: boolean): Promise<UpdateState> {
    this.setState({ status: 'checking', lastCheckManual: manual, errorCode: undefined, errorDetail: undefined })
    try {
      const res = await this.fetchWithTimeout(RELEASES_LATEST_URL, CHECK_TIMEOUT_MS, {
        Accept: 'application/vnd.github+json'
      })
      if (res.status === 404) {
        // No published (non-prerelease) release yet.
        this.release = null
        this.setState({ status: 'not-available', latest: undefined, lastCheckedAt: Date.now() })
        return this.state
      }
      if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
        throw new UpdateError('rateLimit')
      }
      if (!res.ok) throw new UpdateError('badResponse', `HTTP ${res.status}`)
      const body = (await res.json()) as GitHubRelease
      const resolved = resolveRelease(body)
      if (!resolved.ok) {
        // Draft / prerelease are never offered; a newer tag without assets is reported.
        if (resolved.reason === 'noInstaller' || resolved.reason === 'noChecksums' || resolved.reason === 'badAssetUrl') {
          if (isNewerVersion(body.tag_name ?? '', this.state.currentVersion)) {
            throw new UpdateError('noAsset', resolved.reason)
          }
        }
        this.release = null
        this.setState({ status: 'not-available', latest: undefined, lastCheckedAt: Date.now() })
        return this.state
      }
      const rel = resolved.release
      if (!isNewerVersion(rel.version, this.state.currentVersion)) {
        this.release = null
        this.setState({ status: 'not-available', latest: undefined, lastCheckedAt: Date.now() })
        return this.state
      }
      const skipped = this.deps.getSettings().skippedUpdateVersion === rel.version
      this.release = rel
      log(`có phiên bản mới ${rel.version} (đang dùng ${this.state.currentVersion})`)
      this.setState({
        status: skipped && !manual ? 'not-available' : 'available',
        skipped,
        latest: {
          version: rel.version,
          name: rel.name,
          notes: rel.notes,
          htmlUrl: rel.htmlUrl,
          publishedAt: rel.publishedAt,
          sizeBytes: rel.installer.size
        },
        lastCheckedAt: Date.now()
      })
    } catch (err) {
      const e = toUpdateError(err, 'network')
      log(`kiểm tra thất bại: ${e.code} ${e.message}`)
      this.setState({ status: 'error', errorCode: e.code, errorDetail: e.message, lastCheckedAt: Date.now() })
    }
    return this.state
  }

  /** Download, verify and hand over to the installer. Quits the app on success. */
  async downloadAndInstall(): Promise<UpdateState> {
    if (this.busy) return this.state
    if (!this.state.canInstall) {
      this.setState({ status: 'error', errorCode: 'notPackaged' })
      return this.state
    }
    const rel = this.release
    if (!rel) {
      await this.check(true)
      if (!this.release) return this.state
      return this.downloadAndInstall()
    }
    this.busy = true
    const workDir = join(app.getPath('temp'), 'eGovAI-update', rel.version)
    try {
      rmSync(workDir, { recursive: true, force: true })
      mkdirSync(workDir, { recursive: true })

      // 1. Checksums first (small), so a missing entry fails before the big download.
      this.setState({ status: 'downloading', progress: { received: 0, total: rel.installer.size }, errorCode: undefined, errorDetail: undefined })
      const sumsRes = await this.fetchWithTimeout(rel.sums.browser_download_url, CHECK_TIMEOUT_MS)
      if (!sumsRes.ok) throw new UpdateError('download', `SHA256SUMS: HTTP ${sumsRes.status}`)
      const expected = parseSha256Sums(await sumsRes.text(), rel.installer.name)
      if (!expected) throw new UpdateError('checksum', `SHA256SUMS.txt không có dòng cho ${rel.installer.name}`)

      // 2. Installer with progress + streaming hash.
      const installerPath = join(workDir, rel.installer.name)
      const actual = await this.downloadFile(rel.installer.browser_download_url, installerPath, rel.installer.size)

      // 3. Verify.
      this.setState({ status: 'verifying' })
      if (actual !== expected) {
        safeUnlink(installerPath)
        this.audit(`Từ chối bộ cài ${rel.version}: SHA-256 không khớp`, { version: rel.version, expected, actual })
        throw new UpdateError('checksum', `SHA-256 không khớp (mong đợi ${expected.slice(0, 12)}…, nhận ${actual.slice(0, 12)}…)`)
      }
      const sig = await getAuthenticodeStatus(installerPath)
      const current = await getAuthenticodeStatus(process.execPath).catch(() => null)
      const verdict = evaluateSignature(sig.status, current?.status)
      if (!verdict.allow) {
        safeUnlink(installerPath)
        this.audit(`Từ chối bộ cài ${rel.version}: chữ ký số ${sig.status}`, {
          version: rel.version,
          signature: sig.status,
          currentAppSignature: current?.status ?? 'unknown'
        })
        throw new UpdateError(
          'signature',
          sig.status === 'NotSigned'
            ? 'Bộ cài mới chưa ký số trong khi bản đang dùng đã ký số'
            : `Trạng thái chữ ký: ${sig.status}${sig.message ? ` — ${sig.message}` : ''}`
        )
      }
      if (verdict.unsigned) log(`cảnh báo: bộ cài ${rel.version} chưa được ký số (Authenticode) — vẫn cho phép`)

      // 4. Hand over to the detached helper, then quit.
      this.setState({ status: 'installing' })
      this.launchInstaller(installerPath, workDir, rel, actual, sig.status, sig.subject)
      setTimeout(() => app.quit(), 400)
    } catch (err) {
      const e = toUpdateError(err, 'download')
      log(`cập nhật thất bại: ${e.code} ${e.message}`)
      this.busy = false
      this.setState({ status: 'error', errorCode: e.code, errorDetail: e.message, progress: undefined })
    }
    return this.state
  }

  private launchInstaller(
    installerPath: string,
    workDir: string,
    rel: ResolvedRelease,
    sha256: string,
    signature: string,
    signer: string
  ): void {
    const installDir = dirname(process.execPath)
    const appExe = process.execPath
    const desktopLnk = join(app.getPath('desktop'), 'eGovAI.lnk')
    const startLnk = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'eGovAI.lnk')
    const installerArgs = buildInstallerArgs(installDir, {
      desktopShortcut: existsSync(desktopLnk),
      startMenuShortcut: existsSync(startLnk)
    })
    const elevate = !canWriteDir(installDir)
    const logFile = join(workDir, 'update.log')
    const resultFile = join(workDir, 'result.json')
    const scriptPath = join(workDir, 'run-update.ps1')
    const script = buildUpdateHelperScript({
      appPid: process.pid,
      installerPath,
      installerArgs,
      installDir,
      appExe,
      logFile,
      resultFile,
      elevate
    })
    try {
      // UTF-8 with BOM so Windows PowerShell 5.1 reads non-ASCII paths correctly.
      writeFileSync(scriptPath, '﻿' + script, 'utf8')
      const pending: PendingUpdate = {
        fromVersion: this.state.currentVersion,
        toVersion: rel.version,
        resultFile,
        logFile,
        startedAt: new Date().toISOString()
      }
      writeFileSync(join(app.getPath('userData'), PENDING_FILE), JSON.stringify(pending), 'utf8')
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
        { detached: true, stdio: 'ignore', windowsHide: true, cwd: workDir }
      )
      child.unref()
    } catch (err) {
      safeUnlink(join(app.getPath('userData'), PENDING_FILE))
      throw new UpdateError('launch', err instanceof Error ? err.message : String(err))
    }
    this.audit(`Bắt đầu cập nhật ${this.state.currentVersion} → ${rel.version}`, {
      version: rel.version,
      sha256,
      signature,
      ...(signer ? { signer } : {}),
      elevate,
      installDir
    })
    log(`đã chạy trình trợ giúp cập nhật (${scriptPath}), thoát ứng dụng`)
  }

  /** Called on startup: log the result of an update the previous session handed over. */
  private reportPreviousInstall(): void {
    const pendingPath = join(app.getPath('userData'), PENDING_FILE)
    if (!existsSync(pendingPath)) return
    let pending: PendingUpdate | null = null
    try {
      pending = JSON.parse(readFileSync(pendingPath, 'utf8')) as PendingUpdate
    } catch {
      // ignore corrupt marker
    }
    safeUnlink(pendingPath)
    if (!pending) return
    let exitCode: number | undefined
    try {
      const raw = readFileSync(pending.resultFile, 'utf8').replace(/^﻿/, '')
      exitCode = (JSON.parse(raw) as { exitCode?: number }).exitCode
    } catch {
      // helper may not have finished writing
    }
    if (this.state.currentVersion === pending.toVersion) {
      this.audit(`Đã cập nhật ${pending.fromVersion} → ${pending.toVersion}`, {
        version: pending.toVersion,
        ...(exitCode !== undefined ? { exitCode } : {})
      })
      try {
        rmSync(dirname(pending.resultFile), { recursive: true, force: true })
      } catch {
        // ignore
      }
      return
    }
    this.audit(`Cập nhật lên ${pending.toVersion} không thành công`, {
      version: pending.toVersion,
      exitCode: exitCode ?? -1,
      log: pending.logFile
    })
    this.setState({
      status: 'error',
      errorCode: 'installFailed',
      errorDetail: `Mã thoát ${exitCode ?? 'không rõ'}. Nhật ký: ${pending.logFile}; %TEMP%\\eGovAI-Setup.log`
    })
  }

  private async fetchWithTimeout(
    url: string,
    timeoutMs: number,
    headers: Record<string, string> = {}
  ): Promise<Response> {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      return await net.fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...headers },
        signal: ctrl.signal,
        cache: 'no-store',
        redirect: 'follow'
      } as RequestInit)
    } catch (err) {
      throw new UpdateError('network', ctrl.signal.aborted ? 'Hết thời gian chờ' : errMessage(err))
    } finally {
      clearTimeout(t)
    }
  }

  /** Stream to disk, emitting progress; returns the lowercase SHA-256 hex. */
  private async downloadFile(url: string, dest: string, expectedSize: number): Promise<string> {
    const ctrl = new AbortController()
    let idle: NodeJS.Timeout | null = null
    const bumpIdle = (): void => {
      if (idle) clearTimeout(idle)
      idle = setTimeout(() => ctrl.abort(), DOWNLOAD_IDLE_TIMEOUT_MS)
    }
    bumpIdle()
    const hash = createHash('sha256')
    const out = createWriteStream(dest)
    const outDone = new Promise<void>((resolve, reject) => {
      out.on('finish', () => resolve())
      out.on('error', reject)
    })
    try {
      let res: Response
      try {
        res = await net.fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctrl.signal, redirect: 'follow' } as RequestInit)
      } catch (err) {
        throw new UpdateError('network', ctrl.signal.aborted ? 'Hết thời gian chờ' : errMessage(err))
      }
      if (!res.ok || !res.body) throw new UpdateError('download', `HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length')) || expectedSize
      const reader = res.body.getReader()
      let received = 0
      let lastEmit = 0
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>
        try {
          chunk = await reader.read()
        } catch (err) {
          throw new UpdateError('download', ctrl.signal.aborted ? 'Hết thời gian chờ khi tải' : errMessage(err))
        }
        if (chunk.done) break
        bumpIdle()
        const buf = Buffer.from(chunk.value)
        received += buf.length
        if (received > MAX_INSTALLER_BYTES) throw new UpdateError('download', 'Tệp tải về quá lớn')
        hash.update(buf)
        if (!out.write(buf)) await new Promise<void>((r) => out.once('drain', () => r()))
        const now = Date.now()
        if (now - lastEmit > 200) {
          lastEmit = now
          this.setState({ progress: { received, total } })
        }
      }
      out.end()
      await outDone
      if (expectedSize > 0 && received !== expectedSize) {
        throw new UpdateError('download', `Kích thước không khớp (${received}/${expectedSize} byte)`)
      }
      this.setState({ progress: { received, total: Math.max(total, received) } })
      return hash.digest('hex')
    } catch (err) {
      out.destroy()
      safeUnlink(dest)
      throw err
    } finally {
      if (idle) clearTimeout(idle)
    }
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function toUpdateError(err: unknown, fallback: UpdateErrorCode): UpdateError {
  return err instanceof UpdateError ? err : new UpdateError(fallback, errMessage(err))
}

function safeUnlink(p: string): void {
  try {
    if (existsSync(p)) unlinkSync(p)
  } catch {
    // ignore
  }
}

function canWriteDir(dir: string): boolean {
  const probe = join(dir, `.egovai-write-test-${randomUUID()}`)
  try {
    writeFileSync(probe, 'ok')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/** Authenticode status via Windows PowerShell `Get-AuthenticodeSignature` (path passed via env). */
function getAuthenticodeStatus(filePath: string): Promise<{ status: string; message: string; subject: string }> {
  const command =
    '$ErrorActionPreference="Stop"; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
    '$s = Get-AuthenticodeSignature -LiteralPath $env:EGOVAI_SIG_PATH; ' +
    '@{ status = $s.Status.ToString(); message = [string]$s.StatusMessage; ' +
    'subject = $(if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { "" }) } | ConvertTo-Json -Compress'
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { env: { ...process.env, EGOVAI_SIG_PATH: filePath }, windowsHide: true, timeout: 30_000 },
      (err, stdout) => {
        if (err) {
          reject(new UpdateError('signatureCheck', err.message))
          return
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as { status?: string; message?: string; subject?: string }
          if (!parsed.status) throw new Error('no status')
          resolve({ status: parsed.status, message: parsed.message ?? '', subject: parsed.subject ?? '' })
        } catch {
          reject(new UpdateError('signatureCheck', `Không đọc được kết quả kiểm tra chữ ký: ${stdout.slice(0, 200)}`))
        }
      }
    )
  })
}
