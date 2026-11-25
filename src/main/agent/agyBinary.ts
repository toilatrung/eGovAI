import { existsSync } from 'fs'
import { userInfo } from 'os'
import { dirname, join } from 'path'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { promisify } from 'util'
import type {
  AccountProfile,
  AccountQuota,
  AgyModel,
  AgyStatus,
  OAuthFlowEvent,
  QuotaBucket,
  QuotaGroup
} from '../../shared/types'

const execFileAsync = promisify(execFile)

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '')
}

export function extractOAuthUrl(rawText: string): string | null {
  const clean = stripAnsi(rawText).replace(/\r?\n/g, '')
  const match = clean.match(/https:\/\/(?:accounts\.google\.com|antigravity\.google)[^\s"'<>]+/i)
  if (match) return match[0]
  const fallback = clean.match(/https:\/\/[^\s"'<>]+oauth[^\s"'<>]*/i)
  return fallback ? fallback[0] : null
}

export function getBundledAgyCandidates(resourcesPathOverride?: string): string[] {
  const exeName = process.platform === 'win32' ? 'agy.exe' : 'agy'
  const candidates: string[] = []
  const resPath = resourcesPathOverride ?? process.resourcesPath
  if (resPath) {
    candidates.push(join(resPath, 'bin', exeName))
  }
  if (!resourcesPathOverride && process.execPath) {
    candidates.push(join(dirname(process.execPath), 'resources', 'bin', exeName))
  }
  return candidates
}

export function resolveAgyBinary(
  overridePath?: string,
  resourcesPathOverride?: string
): string | null {
  const candidates: string[] = []

  if (overridePath && overridePath.trim()) {
    candidates.push(overridePath.trim())
  }

  // Ưu tiên lõi agy.exe được đóng gói sẵn bên trong eGovAI (resources/bin/agy.exe).
  candidates.push(...getBundledAgyCandidates(resourcesPathOverride))

  if (process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'))
  }

  if (process.env.USERPROFILE) {
    candidates.push(join(process.env.USERPROFILE, 'AppData', 'Local', 'agy', 'bin', 'agy.exe'))
    candidates.push(join(process.env.USERPROFILE, '.local', 'bin', 'agy.exe'))
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export async function findAgyInPath(): Promise<string | null> {
  try {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which'
    const { stdout } = await execFileAsync(cmd, ['agy'], { timeout: 5000 })
    const first = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean)
    return first ?? null
  } catch {
    return null
  }
}

export async function getAgyBinaryPath(overridePath?: string): Promise<string | null> {
  const direct = resolveAgyBinary(overridePath)
  if (direct) return direct
  return await findAgyInPath()
}

export function parseAgyModelsOutput(stdout: string): AgyModel[] {
  const models: AgyModel[] = []
  const lines = stdout.split(/\r?\n/)

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('Fetching')) continue

    const tabParts = line.split('\t')
    if (tabParts.length >= 2) {
      const id = tabParts[0].trim()
      const name = tabParts.slice(1).join(' ').trim()
      if (id && name) {
        models.push({ id, name })
      }
    }
  }

  return models
}

interface RawQuotaPayload {
  command?: {
    name?: string
    data?: {
      description?: string
      groups?: Array<{
        name?: string
        description?: string
        buckets?: Array<{
          id?: string
          name?: string
          window?: string
          remaining_fraction?: number
          reset_time?: string
          description?: string
        }>
      }>
    }
  }
}

export function parseAgyQuotaJson(stdout: string, nowMs = Date.now()): AccountQuota | null {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1)) as RawQuotaPayload
    const rawGroups = parsed.command?.data?.groups
    if (!Array.isArray(rawGroups)) return null

    const groups: QuotaGroup[] = rawGroups.map((g) => {
      const buckets: QuotaBucket[] = (g.buckets ?? []).map((b) => ({
        id: b.id ?? b.name ?? 'bucket',
        name: b.name ?? 'Hạn mức',
        window: b.window ?? '',
        remainingFraction:
          typeof b.remaining_fraction === 'number'
            ? Math.max(0, Math.min(1, b.remaining_fraction))
            : 0,
        resetTime: b.reset_time,
        description: b.description
      }))
      return {
        name: g.name ?? 'Nhóm mô hình',
        description: g.description,
        buckets
      }
    })

    return {
      description: parsed.command?.data?.description,
      groups,
      fetchedAt: nowMs
    }
  } catch {
    return null
  }
}

export async function fetchAgyQuota(overridePath?: string): Promise<AccountQuota | null> {
  const binaryPath = await getAgyBinaryPath(overridePath)
  if (!binaryPath) return null

  try {
    const { stdout } = await execFileAsync(
      binaryPath,
      ['-p', '/quota', '--output-format', 'json'],
      {
        timeout: 15000,
        windowsHide: true
      }
    )
    return parseAgyQuotaJson(stdout)
  } catch {
    return null
  }
}

export function extractEmailFromText(rawText: string): string | null {
  const clean = stripAnsi(rawText)
  const match = clean.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  return match ? match[0] : null
}

export async function detectAccountProfile(
  customName?: string,
  customEmail?: string
): Promise<AccountProfile> {
  const trimmedName = customName?.trim() ?? ''
  const trimmedEmail = customEmail?.trim() ?? ''

  if (trimmedName || trimmedEmail) {
    return {
      displayName: trimmedName || trimmedEmail.split('@')[0] || 'Người dùng eGovAI',
      email: trimmedEmail,
      source: 'custom'
    }
  }

  let gitName = ''
  let gitEmail = ''
  try {
    const [nameRes, emailRes] = await Promise.all([
      execFileAsync('git', ['config', '--global', 'user.name'], {
        timeout: 3000,
        windowsHide: true
      }).catch(() => ({ stdout: '' })),
      execFileAsync('git', ['config', '--global', 'user.email'], {
        timeout: 3000,
        windowsHide: true
      }).catch(() => ({ stdout: '' }))
    ])
    gitName = nameRes.stdout.trim()
    gitEmail = emailRes.stdout.trim()
  } catch {
    // ignore
  }

  let osUser = ''
  try {
    osUser = userInfo().username
  } catch {
    osUser = ''
  }

  return {
    displayName: gitName || osUser || (gitEmail ? gitEmail.split('@')[0] : 'Tài khoản Google'),
    email: gitEmail,
    source: 'system'
  }
}

export async function checkAgyStatus(
  overridePath?: string,
  customName?: string,
  customEmail?: string
): Promise<AgyStatus> {
  const binaryPath = await getAgyBinaryPath(overridePath)
  if (!binaryPath) {
    return {
      installed: false,
      binaryPath: null,
      version: null,
      authenticated: false,
      models: [],
      error: 'Không tìm thấy lõi AI (agy.exe) trên máy.'
    }
  }

  // Chạy song song --version, models và phát hiện hồ sơ tài khoản để rút ngắn thời gian khởi động.
  const [versionRes, modelsRes, accountRes] = await Promise.all([
    execFileAsync(binaryPath, ['--version'], {
      timeout: 8000,
      windowsHide: true
    })
      .then((res) => ({ ok: true as const, stdout: res.stdout }))
      .catch((err) => ({ ok: false as const, err })),
    execFileAsync(binaryPath, ['models'], {
      timeout: 20000,
      windowsHide: true
    })
      .then((res) => ({ ok: true as const, stdout: res.stdout }))
      .catch((err) => ({ ok: false as const, err })),
    detectAccountProfile(customName, customEmail).catch(() => null)
  ])

  if (!versionRes.ok) {
    return {
      installed: false,
      binaryPath,
      version: null,
      authenticated: false,
      models: [],
      error:
        versionRes.err instanceof Error
          ? versionRes.err.message
          : 'Không thể kiểm tra phiên bản agy.'
    }
  }

  const version = versionRes.stdout.trim().split(/\r?\n/)[0] ?? null

  if (!modelsRes.ok) {
    const message = modelsRes.err instanceof Error ? modelsRes.err.message : String(modelsRes.err)
    return {
      installed: true,
      binaryPath,
      version,
      authenticated: false,
      models: [],
      error: message
    }
  }

  const models = parseAgyModelsOutput(modelsRes.stdout)
  const authenticated = models.length > 0
  return {
    installed: true,
    binaryPath,
    version,
    authenticated,
    models,
    account: authenticated ? accountRes : null
  }
}

/**
 * Runs the official `agy acp --login` Google OAuth2 browser authentication flow
 * completely hidden (no black terminal window). Emits OAuth URL and lifecycle events
 * directly to the eGovAI GUI modal.
 */
export class GoogleOAuthManager {
  private proc: ChildProcessWithoutNullStreams | null = null
  private cancelled = false

  start(
    binaryPath: string,
    onEvent: (evt: OAuthFlowEvent) => void,
    onOpenUrl?: (url: string) => void
  ): void {
    this.cancel()
    this.cancelled = false

    onEvent({
      stage: 'started',
      message: 'Đang khởi tạo phiên đăng nhập Google OAuth2 chính thức...'
    })

    const child = spawn(binaryPath, ['acp', '--login'], {
      windowsHide: true,
      env: { ...process.env }
    })

    this.proc = child
    let combinedLog = ''
    let emittedUrl: string | null = null

    const inspectChunk = (raw: string): void => {
      const clean = stripAnsi(raw)
      combinedLog += clean

      const foundUrl = extractOAuthUrl(combinedLog)
      if (foundUrl && foundUrl !== emittedUrl) {
        emittedUrl = foundUrl
        onEvent({
          stage: 'url',
          url: foundUrl,
          message: 'Trình duyệt đang mở trang xác thực Google OAuth2...'
        })
        if (onOpenUrl) {
          onOpenUrl(foundUrl)
        }
      }

      if (/paste.*code|authorization code|nhập mã|enter code/i.test(clean)) {
        onEvent({
          stage: 'needs_input',
          url: emittedUrl ?? undefined,
          message: 'Hãy dán mã xác thực từ trình duyệt Google vào ô bên dưới.'
        })
      }
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', inspectChunk)

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', inspectChunk)

    child.on('error', (err) => {
      if (this.proc === child) this.proc = null
      if (!this.cancelled) {
        onEvent({
          stage: 'error',
          message: `Không thể khởi chạy quy trình Google OAuth2: ${err.message}`
        })
      }
    })

    child.on('close', (code) => {
      if (this.proc === child) this.proc = null
      if (this.cancelled) return

      if (code === 0) {
        const detectedEmail = extractEmailFromText(combinedLog) ?? undefined
        onEvent({
          stage: 'success',
          email: detectedEmail,
          message: detectedEmail
            ? `Đăng nhập thành công với tài khoản ${detectedEmail}!`
            : 'Đăng nhập Google OAuth2 thành công! Đang đồng bộ tài khoản...'
        })
      } else {
        const lastLine =
          combinedLog
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(-2)
            .join(' — ') || `Quá trình đăng nhập kết thúc với mã ${code}.`
        onEvent({
          stage: 'error',
          url: emittedUrl ?? undefined,
          message: lastLine
        })
      }
    })
  }

  submitInput(input: string): boolean {
    if (!this.proc || !this.proc.stdin.writable) return false
    this.proc.stdin.write(`${input.trim()}\n`)
    return true
  }

  cancel(): void {
    if (!this.proc) return
    this.cancelled = true
    const current = this.proc
    this.proc = null
    try {
      current.kill('SIGTERM')
    } catch {
      try {
        current.kill()
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Runs the official Google Antigravity CLI installer on Windows in a visible PowerShell window.
 */
export function launchOfficialAgyInstaller(): void {
  if (process.platform === 'win32') {
    spawn(
      'powershell.exe',
      [
        '-NoExit',
        '-Command',
        'Write-Host "Đang cài đặt lõi AI cho eGovAI..." -ForegroundColor Cyan; irm https://antigravity.google/cli/install.ps1 | iex; Write-Host "Hoàn tất! Hãy đóng cửa sổ này và bấm Kiểm tra lại trong eGovAI." -ForegroundColor Green'
      ],
      {
        detached: true,
        stdio: 'ignore'
      }
    ).unref()
  }
}
