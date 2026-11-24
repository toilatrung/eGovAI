import { app } from 'electron'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ComputerUseStatus, DesktopWindowItem } from '../../shared/types'
import { detectSystemBrowser } from './playwrightService'

const execFileAsync = promisify(execFile)

export function resolveAgentDesktopBinary(): { binaryPath: string | null; binDir: string | null } {
  const candidates: string[] = []
  const roots: string[] = [process.cwd()]

  try {
    roots.push(app.getAppPath())
    if (process.resourcesPath) {
      roots.push(join(process.resourcesPath, 'app.asar.unpacked'))
      roots.push(process.resourcesPath)
    }
  } catch {
    // Running outside Electron (e.g. Vitest)
  }

  for (const root of roots) {
    // Direct native Windows executable (fastest, 0 Node launcher overhead)
    candidates.push(join(root, 'node_modules', 'agent-desktop', 'bin', 'agent-desktop-win32-x64.exe'))
    candidates.push(join(root, 'node_modules', '.bin', 'agent-desktop.cmd'))
  }

  if (process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, 'npm', 'agent-desktop.cmd'))
    candidates.push(
      join(
        process.env.APPDATA,
        'npm',
        'node_modules',
        'agent-desktop',
        'bin',
        'agent-desktop-win32-x64.exe'
      )
    )
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { binaryPath: candidate, binDir: dirname(candidate) }
    }
  }

  return { binaryPath: null, binDir: null }
}

function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

export function parseAgentDesktopStatus(
  stdout: string,
  binaryPath: string | null,
  binDir: string | null
): ComputerUseStatus {
  const parsed = extractFirstJsonObject(stdout)
  if (!parsed || parsed.ok !== true || !parsed.data || typeof parsed.data !== 'object') {
    return {
      installed: Boolean(binaryPath),
      binaryPath,
      binDir,
      version: null,
      platform: process.platform,
      accessibilityGranted: false,
      supportedSurfaces: [],
      error: 'Không đọc được phản hồi trạng thái từ agent-desktop.'
    }
  }

  const data = parsed.data as {
    version?: string
    platform?: string
    supported_surfaces?: string[]
    permissions?: {
      accessibility?: { state?: string }
    }
  }

  const accState = data.permissions?.accessibility?.state ?? ''
  return {
    installed: true,
    binaryPath,
    binDir,
    version: data.version ?? null,
    platform: data.platform ?? process.platform,
    accessibilityGranted: accState === 'granted' || accState === 'not_required',
    supportedSurfaces: Array.isArray(data.supported_surfaces) ? data.supported_surfaces : []
  }
}

export function parseAgentDesktopWindows(stdout: string): DesktopWindowItem[] {
  const parsed = extractFirstJsonObject(stdout)
  if (!parsed || parsed.ok !== true) return []

  const data = parsed.data as unknown
  const rawList: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { windows?: unknown[] }).windows)
      ? (data as { windows: unknown[] }).windows
      : []

  const items: DesktopWindowItem[] = []
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const id = String(rec.id ?? rec.window_id ?? rec.handle ?? items.length)
    const appName = String(rec.app ?? rec.app_name ?? rec.process_name ?? 'Ứng dụng')
    const title = String(rec.title ?? rec.name ?? '')
    if (!title && !appName) continue
    items.push({ id, app: appName, title: title || appName })
  }
  return items
}

export async function execAgentDesktopArgs(
  args: string[]
): Promise<{ stdout: string; stderr: string; binaryPath: string; binDir: string }> {
  const { binaryPath, binDir } = resolveAgentDesktopBinary()
  if (!binaryPath || !binDir) {
    throw new Error('Chưa tìm thấy agent-desktop. Hãy chạy: pnpm add agent-desktop')
  }

  const isCmd = binaryPath.toLowerCase().endsWith('.cmd')
  const { stdout, stderr } = isCmd
    ? await execFileAsync('cmd.exe', ['/c', binaryPath, ...args], {
        timeout: 20000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024
      })
    : await execFileAsync(binaryPath, args, {
        timeout: 20000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024
      })

  return { stdout, stderr, binaryPath, binDir }
}

export async function checkComputerUseStatus(): Promise<ComputerUseStatus> {
  const { binaryPath, binDir } = resolveAgentDesktopBinary()
  const browser = detectSystemBrowser()
  const browserFields = {
    browserAvailable: browser.available,
    browserName: browser.name
  }

  if (!binaryPath) {
    return {
      installed: false,
      binaryPath: null,
      binDir: null,
      version: null,
      platform: process.platform,
      accessibilityGranted: false,
      supportedSurfaces: [],
      ...browserFields,
      error: 'Chưa cài đặt agent-desktop trên máy.'
    }
  }

  try {
    const res = await execAgentDesktopArgs(['status'])
    return {
      ...parseAgentDesktopStatus(res.stdout, res.binaryPath, res.binDir),
      ...browserFields
    }
  } catch (err) {
    return {
      installed: true,
      binaryPath,
      binDir,
      version: null,
      platform: process.platform,
      accessibilityGranted: false,
      supportedSurfaces: [],
      ...browserFields,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export async function listDesktopWindows(): Promise<DesktopWindowItem[]> {
  try {
    const res = await execAgentDesktopArgs(['list-windows'])
    return parseAgentDesktopWindows(res.stdout)
  } catch {
    return []
  }
}
