import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { AntigravityCustomizations, RuleFileEntry } from '../../../shared/types'

function safeRead(path: string, fallback = ''): { exists: boolean; content: string } {
  if (!existsSync(path)) return { exists: false, content: fallback }
  try {
    return { exists: true, content: readFileSync(path, 'utf8') }
  } catch {
    return { exists: false, content: fallback }
  }
}

export function loadAntigravityCustomizations(projectPath?: string): AntigravityCustomizations {
  const home = homedir()
  const cliSettingsPath = join(home, '.gemini', 'antigravity-cli', 'settings.json')
  const mcpConfigPath = join(home, '.gemini', 'config', 'mcp_config.json')
  const hooksConfigPath = join(home, '.gemini', 'config', 'hooks.json')

  const cliSettings = safeRead(cliSettingsPath, '{\n}\n')
  const mcpConfig = safeRead(mcpConfigPath, '{\n  "mcpServers": {}\n}\n')
  const hooksConfig = safeRead(hooksConfigPath, '{\n}\n')

  const rulesFiles: RuleFileEntry[] = []

  if (projectPath && existsSync(projectPath)) {
    for (const fileName of ['GEMINI.md', 'AGENTS.md']) {
      const full = join(projectPath, fileName)
      const data = safeRead(full)
      rulesFiles.push({
        name: fileName,
        path: full,
        scope: 'workspace',
        exists: data.exists,
        content: data.content
      })
    }

    const rulesDir = join(projectPath, '.agents', 'rules')
    if (existsSync(rulesDir)) {
      try {
        for (const entry of readdirSync(rulesDir, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue
          const full = join(rulesDir, entry.name)
          const data = safeRead(full)
          rulesFiles.push({
            name: `.agents/rules/${entry.name}`,
            path: full,
            scope: 'workspace',
            exists: data.exists,
            content: data.content
          })
        }
      } catch {
        // ignore
      }
    }
  }

  const globalGeminiMd = join(home, '.gemini', 'GEMINI.md')
  const globalData = safeRead(globalGeminiMd)
  rulesFiles.push({
    name: '~/.gemini/GEMINI.md (Toàn cục)',
    path: globalGeminiMd,
    scope: 'global',
    exists: globalData.exists,
    content: globalData.content
  })

  return {
    cliSettingsPath,
    cliSettingsExists: cliSettings.exists,
    cliSettingsJson: cliSettings.content,
    mcpConfigPath,
    mcpConfigExists: mcpConfig.exists,
    mcpConfigJson: mcpConfig.content,
    hooksConfigPath,
    hooksConfigExists: hooksConfig.exists,
    hooksConfigJson: hooksConfig.content,
    rulesFiles
  }
}

export function saveCustomizationFile(filePath: string, content: string, validateJson = false): void {
  if (validateJson) {
    JSON.parse(content)
  }
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, content, 'utf8')
}
