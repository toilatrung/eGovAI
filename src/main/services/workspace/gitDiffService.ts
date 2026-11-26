import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import type { GitFileChange } from '../../../shared/types'

const execFileAsync = promisify(execFile)

function mapGitStatusLabel(code: string): string {
  const trimmed = code.trim()
  if (trimmed === '??' || trimmed === 'A') return 'Mới thêm'
  if (trimmed.includes('D')) return 'Đã xóa'
  if (trimmed.includes('R')) return 'Đổi tên'
  if (trimmed.includes('M')) return 'Đã sửa'
  return 'Thay đổi'
}

export async function getGitChanges(projectPath: string): Promise<GitFileChange[]> {
  if (!projectPath || !existsSync(projectPath)) return []
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-uall'], {
      cwd: projectPath,
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    })

    const changes: GitFileChange[] = []
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) continue
      const status = line.slice(0, 2)
      let relPath = line.slice(3).trim()
      if (relPath.startsWith('"') && relPath.endsWith('"')) {
        relPath = relPath.slice(1, -1)
      }
      const arrowIdx = relPath.indexOf(' -> ')
      if (arrowIdx >= 0) {
        relPath = relPath.slice(arrowIdx + 4)
      }
      changes.push({
        status: status.trim() || 'M',
        path: relPath,
        fullPath: join(projectPath, relPath),
        label: mapGitStatusLabel(status)
      })
    }
    return changes
  } catch {
    return []
  }
}

export async function getGitFileDiff(projectPath: string, relativePath: string): Promise<string> {
  if (!projectPath || !relativePath) return ''
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--', relativePath], {
      cwd: projectPath,
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    })
    if (stdout.trim()) return stdout

    // Check staged diff
    const staged = await execFileAsync('git', ['diff', '--cached', '--', relativePath], {
      cwd: projectPath,
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    })
    if (staged.stdout.trim()) return staged.stdout

    // Untracked text file fallback
    const full = join(projectPath, relativePath)
    if (existsSync(full)) {
      const content = readFileSync(full, 'utf8')
      if (!content.includes('\u0000')) {
        return content
          .split(/\r?\n/)
          .slice(0, 300)
          .map((l) => `+ ${l}`)
          .join('\n')
      }
      return '(Tệp nhị phân — bấm "Mở tệp" để xem trực tiếp trong Tài liệu & Bảng tính)'
    }
    return ''
  } catch {
    return ''
  }
}
