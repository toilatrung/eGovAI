import { existsSync, readdirSync, readFileSync } from 'fs'
import { isAbsolute, join, relative } from 'path'
import type { WorkspaceEntry } from '../../../shared/types'

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'out',
  '.next',
  'build'
])

export function searchWorkspaceEntries(
  projectPath: string,
  query: string,
  limit = 30
): WorkspaceEntry[] {
  if (!projectPath || !existsSync(projectPath)) return []

  const results: WorkspaceEntry[] = []
  const normalizedQuery = query.trim().toLowerCase()

  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || results.length >= limit * 3) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const fullPath = join(dir, entry.name)
      const rel = relative(projectPath, fullPath).replace(/\\/g, '/')

      const matches =
        !normalizedQuery ||
        entry.name.toLowerCase().includes(normalizedQuery) ||
        rel.toLowerCase().includes(normalizedQuery)

      if (matches) {
        results.push({
          name: entry.name,
          relativePath: rel,
          fullPath,
          isDirectory: entry.isDirectory()
        })
      }

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1)
      }
    }
  }

  walk(projectPath, 0)

  results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.relativePath.length - b.relativePath.length
  })

  return results.slice(0, limit)
}

export function readSkillPreview(projectPath: string, sopPathOrFull: string): string {
  const target = isAbsolute(sopPathOrFull) ? sopPathOrFull : join(projectPath, sopPathOrFull)
  if (!existsSync(target)) {
    return 'Không tìm thấy tệp hướng dẫn SOP của kỹ năng này.'
  }
  try {
    return readFileSync(target, 'utf8')
  } catch {
    return 'Không thể đọc nội dung tệp kỹ năng.'
  }
}
