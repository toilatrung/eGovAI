import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { homedir } from 'os'
import { basename, join, relative } from 'path'
import type { GlobalSkillSource, SkillItem, SkillScope } from '../../../shared/types'

interface Frontmatter {
  name?: string
  description?: string
}

const GLOBAL_STUB_PREFIX = 'egovai-global--'

export function getOfficialGlobalSkillsDir(): string {
  return join(homedir(), '.gemini', 'config', 'skills')
}

export function parseSkillFrontmatter(markdown: string): Frontmatter {
  const match = markdown.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}

  const body = match[1]
  const lines = body.split(/\r?\n/)
  const result: Frontmatter = {}

  let currentKey: 'name' | 'description' | null = null
  const descLines: string[] = []

  for (const line of lines) {
    const nameMatch = line.match(/^name:\s*(.+)$/)
    if (nameMatch) {
      currentKey = 'name'
      result.name = nameMatch[1].trim().replace(/^["']|["']$/g, '')
      continue
    }

    const descMatch = line.match(/^description:\s*(.*)$/)
    if (descMatch) {
      currentKey = 'description'
      const inline = descMatch[1].trim()
      if (inline && inline !== '>' && inline !== '>-' && inline !== '|' && inline !== '|-') {
        descLines.push(inline.replace(/^["']|["']$/g, ''))
      }
      continue
    }

    if (currentKey === 'description' && /^\s+/.test(line)) {
      descLines.push(line.trim())
    } else if (/^[a-zA-Z0-9_-]+:/.test(line)) {
      currentKey = null
    }
  }

  if (descLines.length > 0) {
    result.description = descLines.join(' ').trim()
  }

  return result
}

export function categorizeUbndSkill(code?: string, title?: string): string {
  const num = code ? parseInt(code, 10) : NaN
  const lower = (title ?? '').toLowerCase()

  if (
    code === '00' ||
    lower.includes('đúc kết') ||
    lower.includes('meta') ||
    lower.includes('điều phối')
  ) {
    return 'Điều phối & Hệ thống'
  }
  if (!Number.isNaN(num)) {
    if (num === 1 || num === 2 || num === 16) return 'Hồ sơ & Tiến độ'
    if (num >= 3 && num <= 5) return 'Văn hóa & Thể thao'
    if (num >= 6 && num <= 9) return 'Giáo dục & Sáng kiến'
    if (num >= 10 && num <= 15) return 'Nội vụ, Cải cách & Tôn giáo'
  }
  if (lower.includes('giáo dục') || lower.includes('trường') || lower.includes('sáng kiến')) {
    return 'Giáo dục & Sáng kiến'
  }
  if (lower.includes('văn hóa') || lower.includes('di tích') || lower.includes('thể thao')) {
    return 'Văn hóa & Thể thao'
  }
  if (lower.includes('hồ sơ') || lower.includes('nhiệm vụ') || lower.includes('văn thư')) {
    return 'Hồ sơ & Tiến độ'
  }
  if (
    lower.includes('cải cách') ||
    lower.includes('bầu cử') ||
    lower.includes('nhân sự') ||
    lower.includes('tôn giáo') ||
    lower.includes('thôn')
  ) {
    return 'Nội vụ, Cải cách & Tôn giáo'
  }
  return 'Kỹ năng khác'
}

export function parseIndexRouter(
  indexContent: string,
  rootPath: string,
  scope: SkillScope = 'project',
  packName?: string
): SkillItem[] {
  const beginIdx = indexContent.indexOf('<!-- ROUTER:BEGIN -->')
  const endIdx = indexContent.indexOf('<!-- ROUTER:END -->')
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    return []
  }

  const section = indexContent.slice(beginIdx, endIdx)
  const items: SkillItem[] = []
  const rowRegex = /^\|\s*(\d{2})\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*`?([^|]+?)`?\s*\|$/gm

  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(section)) !== null) {
    const code = match[1].trim()
    const title = match[2].trim()
    const relSop = match[3].trim()
    const folder = match[4].trim().replace(/\/$/, '')
    const fullSopPath = join(rootPath, relSop)

    let description = `Quy trình nghiệp vụ mã ${code} — ${title}`
    if (existsSync(fullSopPath)) {
      try {
        const md = readFileSync(fullSopPath, 'utf8')
        const fm = parseSkillFrontmatter(md)
        if (fm.description) {
          description = fm.description
        }
      } catch {
        // fallback
      }
    }

    items.push({
      id: `${scope}:${packName || basename(rootPath)}:${folder || `skill-${code}`}`,
      code,
      name: folder,
      title,
      description,
      category: categorizeUbndSkill(code, title),
      folder,
      sopPath: relSop,
      sopFullPath: fullSopPath,
      rootPath,
      scope,
      packName: packName || basename(rootPath),
      source: scope === 'global' ? 'global' : 'router'
    })
  }

  return items
}

export function discoverSkillsInDirectory(
  rootPath: string,
  scope: SkillScope,
  packName?: string
): SkillItem[] {
  if (!rootPath || !existsSync(rootPath)) {
    return []
  }

  const resolvedPack = packName || basename(rootPath)
  const results: SkillItem[] = []
  const seenKeys = new Set<string>()

  // 0. If rootPath itself is a single skill directory containing SKILL.md
  const directSkillFile = join(rootPath, 'SKILL.md')
  if (existsSync(directSkillFile)) {
    try {
      const md = readFileSync(directSkillFile, 'utf8')
      const fm = parseSkillFrontmatter(md)
      const folderName = basename(rootPath)
      const title = fm.name || folderName
      results.push({
        id: `${scope}:${resolvedPack}:${folderName}`,
        name: fm.name || folderName,
        title,
        description: fm.description || `Kỹ năng (${folderName})`,
        category: categorizeUbndSkill(undefined, title),
        folder: folderName,
        sopPath: 'SKILL.md',
        sopFullPath: directSkillFile,
        rootPath,
        scope,
        packName: resolvedPack,
        source: scope === 'global' ? 'global' : 'agents'
      })
      seenKeys.add(folderName.replace(/_/g, '-').toLowerCase())
    } catch {
      // ignore
    }
  }

  // 1. Check for UBND router entry skill (ubndthieutoan-skill/SKILL.md)
  const mainRouterSkill = join(rootPath, 'ubndthieutoan-skill', 'SKILL.md')
  if (existsSync(mainRouterSkill)) {
    try {
      const md = readFileSync(mainRouterSkill, 'utf8')
      const fm = parseSkillFrontmatter(md)
      results.push({
        id: `${scope}:${resolvedPack}:ubndthieutoan-skill`,
        code: '★',
        name: fm.name || 'ubndthieutoan-skill',
        title: 'Điều phối tổng hợp UBND xã Thiệu Toán',
        description:
          fm.description ||
          'Tự động đọc hồ sơ đầu vào, chọn đúng nghiệp vụ trong 17 quy trình chuẩn và kiểm soát chất lượng.',
        category: 'Điều phối & Hệ thống',
        folder: 'ubndthieutoan-skill',
        sopPath: 'ubndthieutoan-skill/SKILL.md',
        sopFullPath: mainRouterSkill,
        rootPath,
        scope,
        packName: resolvedPack,
        source: scope === 'global' ? 'global' : 'router'
      })
      seenKeys.add('ubndthieutoan-skill')
    } catch {
      // ignore
    }
  }

  // 2. Parse INDEX.md router table
  const indexPath = join(rootPath, 'INDEX.md')
  if (existsSync(indexPath)) {
    try {
      const content = readFileSync(indexPath, 'utf8')
      const routerItems = parseIndexRouter(content, rootPath, scope, resolvedPack)
      for (const item of routerItems) {
        results.push(item)
        seenKeys.add(item.folder.replace(/_/g, '-').toLowerCase())
        seenKeys.add(item.folder.toLowerCase())
      }
    } catch {
      // ignore
    }
  }

  // 3. Scan .agents/skills/*/SKILL.md, skills/*/SKILL.md, or direct child folders with SKILL.md
  const scanDirs = [join(rootPath, '.agents', 'skills'), join(rootPath, 'skills'), rootPath]

  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      // Skip our own generated global stub mirrors when scanning ~/.gemini/config/skills
      if (entry.name.startsWith(GLOBAL_STUB_PREFIX)) continue

      const normalized = entry.name.replace(/_/g, '-').toLowerCase()
      if (seenKeys.has(normalized) || seenKeys.has(entry.name.toLowerCase())) {
        continue
      }

      const sopFull = join(dir, entry.name, 'SKILL.md')
      if (!existsSync(sopFull)) continue

      try {
        const md = readFileSync(sopFull, 'utf8')
        const fm = parseSkillFrontmatter(md)
        const title = fm.name || entry.name
        results.push({
          id: `${scope}:${resolvedPack}:${entry.name}`,
          name: fm.name || entry.name,
          title,
          description: fm.description || `Kỹ năng tùy chỉnh (${entry.name})`,
          category: categorizeUbndSkill(undefined, title),
          folder: entry.name,
          sopPath: relative(rootPath, sopFull).replace(/\\/g, '/'),
          sopFullPath: sopFull,
          rootPath,
          scope,
          packName: resolvedPack,
          source: scope === 'global' ? 'global' : 'agents'
        })
        seenKeys.add(normalized)
        seenKeys.add(entry.name.toLowerCase())
      } catch {
        // ignore unreadable skill
      }
    }
  }

  return results
}

export function discoverWorkspaceSkills(projectPath: string): SkillItem[] {
  return discoverSkillsInDirectory(projectPath, 'project')
}

export function discoverAllSkills(
  projectPath: string | null | undefined,
  globalSources: GlobalSkillSource[] = []
): SkillItem[] {
  const projectSkills = projectPath ? discoverSkillsInDirectory(projectPath, 'project') : []

  const globalSkills: SkillItem[] = []
  const seenGlobalSops = new Set<string>()

  // 1. Official ~/.gemini/config/skills/ (manually installed global skills)
  const officialGlobalDir = getOfficialGlobalSkillsDir()
  if (existsSync(officialGlobalDir)) {
    for (const item of discoverSkillsInDirectory(
      officialGlobalDir,
      'global',
      'Kỹ năng toàn cục (~/.gemini)'
    )) {
      const key = (item.sopFullPath ?? item.sopPath).toLowerCase()
      if (!seenGlobalSops.has(key)) {
        seenGlobalSops.add(key)
        globalSkills.push(item)
      }
    }
  }

  // 2. Imported Global Skill Sources (packs or folders imported via GoogleAI / eGovAI)
  for (const src of globalSources) {
    if (!existsSync(src.path)) continue
    for (const item of discoverSkillsInDirectory(src.path, 'global', src.name)) {
      const key = (item.sopFullPath ?? item.sopPath).toLowerCase()
      if (!seenGlobalSops.has(key)) {
        seenGlobalSops.add(key)
        globalSkills.push(item)
      }
    }
  }

  return [...projectSkills, ...globalSkills]
}

function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/**
 * Mirrors lightweight pointer SKILL.md registrations into ~/.gemini/config/skills/
 * so official Antigravity CLI/IDE automatically discovers imported global skills across ALL projects.
 */
export function syncGlobalSkillsToOfficialDir(sources: GlobalSkillSource[]): void {
  const globalDir = getOfficialGlobalSkillsDir()
  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true })
  }

  // Clean up previously managed stub folders first
  try {
    for (const entry of readdirSync(globalDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(GLOBAL_STUB_PREFIX)) {
        rmSync(join(globalDir, entry.name), { recursive: true, force: true })
      }
    }
  } catch {
    // ignore cleanup error
  }

  for (const src of sources) {
    if (!existsSync(src.path)) continue
    const items = discoverSkillsInDirectory(src.path, 'global', src.name)
    for (const sk of items) {
      const slug = sanitizeSlug(`${src.name}-${sk.folder || sk.name}`)
      if (!slug) continue
      const targetDir = join(globalDir, `${GLOBAL_STUB_PREFIX}${slug}`)
      mkdirSync(targetDir, { recursive: true })

      const safeDesc = sk.description.replace(/\r?\n/g, ' ').replace(/"/g, "'")
      const stub = `---
name: ${sanitizeSlug(sk.name || sk.folder)}
description: "${safeDesc}"
---
<!-- egovai-global-import: ${src.id} -->

# ${sk.title} (Kỹ năng chung — Global)

Kỹ năng này được import toàn cục từ bộ kỹ năng \`${src.name}\`.

- **Thư mục gốc bộ kỹ năng:** \`${src.path}\`
- **Tệp quy trình SOP gốc:** \`${sk.sopFullPath ?? sk.sopPath}\`

Khi kích hoạt kỹ năng này từ bất kỳ dự án nào, hãy đọc đầy đủ tệp SOP gốc ở đường dẫn tuyệt đối trên và chạy các script (nếu có) từ thư mục gốc \`${src.path}\`.
`
      writeFileSync(join(targetDir, 'SKILL.md'), stub, 'utf8')
    }
  }
}
