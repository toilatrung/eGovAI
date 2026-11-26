import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import type { AiWorkDirInfo, AiWorkSession, WorkspaceEntry } from '../../../shared/types'

const WORKSPACE_CONFIG_FILE = '.vhxh-workspace.local.json'
const VAULT_RULES = 'Quy tắc'
const VAULT_KNOWLEDGE = 'Kiến thức'

function listFilesRecursive(baseDir: string, maxDepth = 2): WorkspaceEntry[] {
  if (!existsSync(baseDir)) return []
  const items: WorkspaceEntry[] = []

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const rel = relative(baseDir, fullPath).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1)
      } else {
        items.push({
          name: entry.name,
          relativePath: rel,
          fullPath,
          isDirectory: false
        })
      }
    }
  }

  walk(baseDir, 0)
  return items.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'vi'))
}

export function getAiWorkDirInfo(projectPath: string): AiWorkDirInfo {
  const empty: AiWorkDirInfo = {
    configured: false,
    folderPath: null,
    rulesFiles: [],
    knowledgeFiles: [],
    sessions: []
  }

  if (!projectPath || !existsSync(projectPath)) return empty

  const cfgPath = join(projectPath, WORKSPACE_CONFIG_FILE)
  if (!existsSync(cfgPath)) return empty

  try {
    const raw = JSON.parse(readFileSync(cfgPath, 'utf8')) as { folder?: string }
    const folderPath = raw.folder
    if (!folderPath || !existsSync(folderPath)) {
      return {
        ...empty,
        folderPath: folderPath ?? null,
        error: 'Thư mục làm việc AI đã cấu hình không còn tồn tại trên đĩa.'
      }
    }

    const rulesDir = join(folderPath, VAULT_RULES)
    const knowledgeDir = join(folderPath, VAULT_KNOWLEDGE)
    const rulesFiles = listFilesRecursive(rulesDir, 2)
    const knowledgeFiles = listFilesRecursive(knowledgeDir, 2)

    const sessions: AiWorkSession[] = []
    const topEntries = readdirSync(folderPath, { withFileTypes: true })
    for (const entry of topEntries) {
      if (!entry.isDirectory()) continue
      if (
        entry.name.toLowerCase() === VAULT_RULES.toLowerCase() ||
        entry.name.toLowerCase() === VAULT_KNOWLEDGE.toLowerCase()
      ) {
        continue
      }
      const fullPath = join(folderPath, entry.name)
      sessions.push({
        name: entry.name,
        fullPath,
        files: listFilesRecursive(fullPath, 2)
      })
    }

    sessions.sort((a, b) => b.name.localeCompare(a.name, 'vi'))

    return {
      configured: true,
      folderPath,
      rulesFiles,
      knowledgeFiles,
      sessions
    }
  } catch (err) {
    return {
      ...empty,
      error: err instanceof Error ? err.message : 'Không thể đọc cấu hình Thư mục làm việc AI.'
    }
  }
}

export function configureAiWorkDir(projectPath: string, folderPath: string): AiWorkDirInfo {
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true })
  }
  const rulesDir = join(folderPath, VAULT_RULES)
  const knowledgeDir = join(folderPath, VAULT_KNOWLEDGE)
  if (!existsSync(rulesDir)) mkdirSync(rulesDir, { recursive: true })
  if (!existsSync(knowledgeDir)) mkdirSync(knowledgeDir, { recursive: true })

  const cfgPath = join(projectPath, WORKSPACE_CONFIG_FILE)
  writeFileSync(cfgPath, JSON.stringify({ folder: folderPath }, null, 2), 'utf8')
  return getAiWorkDirInfo(projectPath)
}
